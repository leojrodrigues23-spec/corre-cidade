/**
 * Implementação real: Supabase Auth + Postgres (RLS) + RPC + Realtime + Edge Function route-quote.
 * Cada PWA usa um storageKey de sessão próprio, então passageiro e motorista no MESMO aparelho
 * mantêm sessões independentes (sem vazamento de dados entre perfis).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { LatLng } from '../core/geo';
import type { PixKeyType } from '../core/pix';
import type { RideStatus } from '../core/ride';
import {
  type Access,
  type AppKind,
  type AppNotification,
  type Backend,
  BackendError,
  type DriverLocation,
  type DriverStatus,
  type FareConfigRow,
  type Invite,
  type Payment,
  type PixKeyInfo,
  type PublicSettings,
  type Quote,
  type Ride,
  type RideDetails,
  type Role,
  type Session,
  type Unsubscribe,
  type Vehicle,
} from './types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ACTIVE = ['solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'];
const DRIVER_ACTIVE = ['aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'];

function toRide(r: Row): Ride {
  return {
    id: r.id,
    passengerId: r.passenger_id,
    driverId: r.driver_id,
    status: r.status,
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng, address: r.pickup_address },
    dest: { lat: r.dest_lat, lng: r.dest_lng, address: r.dest_address },
    notes: r.notes,
    totalCents: r.total_cents,
    commissionCents: r.commission_cents,
    driverNetCents: r.driver_net_cents,
    manualPrice: r.manual_price,
    isSimulation: r.is_simulation,
    cancelReason: r.cancel_reason,
    cancelledBy: r.cancelled_by,
    searchExpiresAt: r.search_expires_at,
    requestedAt: r.requested_at,
    acceptedAt: r.accepted_at,
    arrivedAt: r.arrived_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
  };
}
function toQuote(s: Row): Quote {
  return {
    id: s.id,
    fareVersion: s.fare_version,
    pricingMode: s.pricing_mode,
    distanceM: s.distance_m,
    durationS: s.duration_s,
    polyline: s.route_polyline,
    routeSource: s.route_source,
    baseCents: s.base_cents,
    distanceCents: s.distance_cents,
    timeCents: s.time_cents,
    subtotalCents: s.subtotal_cents,
    minimumCents: s.minimum_cents,
    totalCents: s.total_cents,
    commissionBps: s.commission_bps,
    commissionCents: s.commission_cents,
    driverNetCents: s.driver_net_cents,
    expiresAt: s.expires_at,
    origin: { lat: s.origin_lat, lng: s.origin_lng },
    dest: { lat: s.dest_lat, lng: s.dest_lng },
  };
}
function toLoc(l: Row): DriverLocation {
  return { driverId: l.driver_id, lat: l.lat, lng: l.lng, accuracyM: l.accuracy_m, heading: l.heading, speedMs: l.speed_ms, recordedAt: l.recorded_at, receivedAt: l.received_at };
}
function toFare(f: Row): FareConfigRow {
  return {
    version: f.version,
    baseCents: f.base_cents,
    perKmCents: f.per_km_cents,
    perMinuteCents: f.per_minute_cents,
    minimumCents: f.minimum_cents,
    commissionBps: f.commission_bps,
    pricingMode: f.pricing_mode,
    manualPriceEnabled: f.manual_price_enabled,
    active: f.active,
    note: f.note,
    createdAt: f.created_at,
  };
}
function toNotif(n: Row): AppNotification {
  return { id: String(n.id), kind: n.kind, title: n.title, body: n.body, rideId: n.ride_id, createdAt: n.created_at, readAt: n.read_at };
}
function toInvite(i: Row): Invite {
  return { id: i.id, role: i.role, note: i.note, createdAt: i.created_at, expiresAt: i.expires_at, maxUses: i.max_uses, uses: i.uses, revokedAt: i.revoked_at };
}
function fail(error: { message: string; code?: string } | null): void {
  if (!error) return;
  const m = error.message.match(/[A-Z][A-Z_]{3,}/);
  throw new BackendError(m ? m[0] : 'UNKNOWN', error.message);
}

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;
  private cachedSession: Session | null = null;

  constructor(url: string, anonKey: string, app: AppKind) {
    this.sb = createClient(url, anonKey, {
      auth: { storageKey: `levaja-auth-${app}`, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }

  private async rpc<T>(fn: string, args?: Row): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args ?? {});
    fail(error);
    return data as T;
  }
  private async uid(): Promise<string> {
    const s = await this.getSession();
    if (!s) throw new BackendError('AUTH_REQUIRED');
    return s.userId;
  }

  // ---------- auth ----------
  private toSession(s: { user: { id: string; email?: string }; access_token: string } | null): Session | null {
    if (!s) return null;
    let aal: 'aal1' | 'aal2' = 'aal1';
    try {
      aal = JSON.parse(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal ?? 'aal1';
    } catch {
      /* token malformado: mantém aal1 */
    }
    return { userId: s.user.id, email: s.user.email ?? '', aal };
  }
  async getSession() {
    const { data } = await this.sb.auth.getSession();
    this.cachedSession = this.toSession(data.session);
    return this.cachedSession;
  }
  onAuthChange(cb: (s: Session | null) => void): Unsubscribe {
    const { data } = this.sb.auth.onAuthStateChange((_e, s) => {
      this.cachedSession = this.toSession(s);
      cb(this.cachedSession);
    });
    return () => data.subscription.unsubscribe();
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new BackendError(/invalid/i.test(error.message) ? 'INVALID_CREDENTIALS' : 'UNKNOWN', error.message);
  }
  async signUp(input: { email: string; password: string; fullName: string; phone: string }) {
    const { data, error } = await this.sb.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { full_name: input.fullName.trim(), phone: input.phone }, emailRedirectTo: window.location.href.split('#')[0] },
    });
    if (error) throw new BackendError(/registered/i.test(error.message) ? 'EMAIL_IN_USE' : 'UNKNOWN', error.message);
    return { needsEmailConfirmation: !data.session };
  }
  async signOut() {
    await this.sb.auth.signOut();
  }
  mfa = {
    status: async () => {
      const { data } = await this.sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const factors = await this.sb.auth.mfa.listFactors();
      return { enrolled: (factors.data?.totp ?? []).some((f) => f.status === 'verified'), aal: (data?.currentLevel ?? 'aal1') as 'aal1' | 'aal2' };
    },
    enroll: async () => {
      const { data, error } = await this.sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Leva Já Admin' });
      if (error) throw new BackendError('MFA_ENROLL', error.message);
      return { factorId: data.id, qrSvg: data.totp.qr_code, secret: data.totp.secret };
    },
    verify: async (factorId: string | null, code: string) => {
      let id = factorId;
      if (!id) {
        const f = await this.sb.auth.mfa.listFactors();
        id = f.data?.totp.find((x) => x.status === 'verified')?.id ?? null;
      }
      if (!id) throw new BackendError('MFA_INVALID');
      const { error } = await this.sb.auth.mfa.challengeAndVerify({ factorId: id, code });
      if (error) throw new BackendError('MFA_INVALID', error.message);
      await this.sb.auth.refreshSession();
    },
  };

  // ---------- perfil/acesso ----------
  async getAccess(): Promise<Access> {
    const a = await this.rpc<Row>('get_my_access');
    return { userId: a.user_id, roles: a.roles ?? [], driverStatus: a.driver_status, isAdmin: a.is_admin, adminNeedsMfa: a.admin_needs_mfa };
  }
  async getProfile() {
    const id = await this.uid();
    const { data, error } = await this.sb.from('profiles').select('id, full_name, phone, avatar_url, location_consent_at').eq('id', id).single();
    fail(error);
    return { id: data!.id, fullName: data!.full_name, phone: data!.phone, avatarUrl: data!.avatar_url, locationConsentAt: data!.location_consent_at };
  }
  async updateProfile(p: { fullName: string; phone: string | null }) {
    await this.rpc('update_my_profile', { p_full_name: p.fullName, p_phone: p.phone, p_avatar_url: null });
  }
  async setLocationConsent(granted: boolean) {
    await this.rpc('set_location_consent', { p_granted: granted });
  }
  async redeemInvite(token: string) {
    const r = await this.rpc<Row>('redeem_invite', { p_token: token });
    return { role: r.role as Role, already: !!r.already };
  }
  async selfEnrollPassenger() {
    await this.rpc('self_enroll_passenger');
  }
  async deleteMyAccount() {
    await this.rpc('delete_my_account');
    await this.sb.auth.signOut();
  }
  async getPublicSettings() {
    return this.rpc<PublicSettings>('get_public_settings');
  }
  async getActiveFare() {
    return toFare(await this.rpc<Row>('get_active_fare'));
  }

  // ---------- passageiro ----------
  async quoteRide(origin: LatLng, dest: LatLng) {
    const { data, error } = await this.sb.functions.invoke('route-quote', { body: { origin, destination: dest } });
    if (!error && data) return toQuote(data as Row);
    // Se a Routes API não estiver configurada, só usa rota SIMULADA quando o admin permitir explicitamente.
    let code = 'ROUTES_API_ERROR';
    try {
      const ctx = (error as { context?: Response })?.context;
      const body = ctx ? await ctx.json() : null;
      code = body?.error ?? code;
    } catch {
      /* corpo indisponível */
    }
    if (code === 'ROUTES_NOT_CONFIGURED' || code === 'ROUTES_API_ERROR' || code === 'UNKNOWN') {
      const settings = await this.getPublicSettings();
      if (settings.allow_simulated_routes) {
        return toQuote(await this.rpc<Row>('quote_ride_simulated', { p_origin_lat: origin.lat, p_origin_lng: origin.lng, p_dest_lat: dest.lat, p_dest_lng: dest.lng }));
      }
    }
    throw new BackendError(code);
  }
  async requestRide(input: { quoteId: string; pickup: LatLng & { address: string; accuracyM: number | null }; destAddress: string; notes?: string }) {
    return this.rpc<string>('request_ride', {
      p_snapshot: input.quoteId,
      p_pickup_lat: input.pickup.lat,
      p_pickup_lng: input.pickup.lng,
      p_pickup_address: input.pickup.address,
      p_pickup_accuracy: input.pickup.accuracyM,
      p_dest_address: input.destAddress,
      p_notes: input.notes ?? null,
    });
  }
  async getActiveRideId() {
    const id = await this.uid();
    const { data, error } = await this.sb.from('ride_requests').select('id').eq('passenger_id', id).in('status', ACTIVE).limit(1).maybeSingle();
    fail(error);
    return data?.id ?? null;
  }
  async getRideDetails(id: string): Promise<RideDetails> {
    const d = await this.rpc<Row>('get_ride_details', { p_ride: id });
    const f = d.fare;
    const p = d.payment;
    return {
      ride: toRide(d.ride),
      viewerRole: d.viewer_role,
      fare: {
        version: f.version,
        pricingMode: f.pricing_mode,
        distanceM: f.distance_m,
        durationS: f.duration_s,
        baseCents: f.base_cents,
        distanceCents: f.distance_cents,
        timeCents: f.time_cents,
        minimumCents: f.minimum_cents,
        subtotalCents: f.subtotal_cents,
        commissionBps: f.commission_bps,
        routeSource: f.route_source,
        routePolyline: f.route_polyline,
      },
      driver: d.driver ? { id: d.driver.id, name: d.driver.name, avatarUrl: d.driver.avatar_url, rating: d.driver.rating, vehicle: d.driver.vehicle } : null,
      passenger: d.passenger,
      payment: p
        ? { id: p.id, status: p.status, amountCents: p.amount_cents, brcode: p.brcode, isSimulation: p.is_simulation, holderName: p.holder_name, commissionCents: p.commission_cents, driverNetCents: p.driver_net_cents }
        : null,
      myRating: d.my_rating,
      events: (d.events ?? []).map((e: Row) => ({ to: e.to as RideStatus, at: e.at, by: e.by, reason: e.reason })),
    };
  }
  async listMyRides() {
    const id = await this.uid();
    const { data, error } = await this.sb.from('ride_requests').select('*').eq('passenger_id', id).order('created_at', { ascending: false }).limit(50);
    fail(error);
    return (data ?? []).map(toRide);
  }
  async cancelRide(id: string, reason: string) {
    await this.rpc('cancel_ride', { p_ride: id, p_reason: reason });
  }
  async rateRide(id: string, stars: number, comment?: string) {
    await this.rpc('rate_ride', { p_ride: id, p_stars: stars, p_comment: comment ?? null });
  }
  async setPaymentStatus(rideId: string, to: Payment['status'], idempotencyKey?: string) {
    await this.rpc('set_payment_status', { p_ride: rideId, p_to: to, p_idempotency_key: idempotencyKey ?? null, p_note: null });
  }
  async savePassengerPixKey(key: PixKeyInfo | null) {
    if (!key) await this.rpc('delete_pix_key', { p_purpose: 'passageiro_opcional' });
    else await this.rpc('save_pix_key', { p_purpose: 'passageiro_opcional', p_type: key.type, p_value: key.value, p_holder: key.holder });
  }
  async getMyPixKey(purpose: 'recebimento_motorista' | 'passageiro_opcional') {
    const id = await this.uid();
    const { data, error } = await this.sb.from('pix_keys').select('key_type, key_value, holder_name').eq('owner_id', id).eq('purpose', purpose).maybeSingle();
    fail(error);
    return data ? { type: data.key_type as PixKeyType, value: data.key_value, holder: data.holder_name } : null;
  }

  // ---------- motorista ----------
  async getDriverSetup() {
    const id = await this.uid();
    const [d, v, k] = await Promise.all([
      this.sb.from('driver_profiles').select('status, is_available').eq('user_id', id).maybeSingle(),
      this.sb.from('vehicles').select('make, model, color, plate, year').eq('driver_id', id).eq('active', true).maybeSingle(),
      this.getMyPixKey('recebimento_motorista'),
    ]);
    fail(d.error);
    if (!d.data) throw new BackendError('FORBIDDEN');
    return { status: d.data.status as DriverStatus, isAvailable: d.data.is_available, vehicle: (v.data as Vehicle) ?? null, pixKey: k };
  }
  async saveVehicle(v: Vehicle) {
    await this.rpc('save_driver_vehicle', { p_make: v.make, p_model: v.model, p_color: v.color, p_year: v.year, p_plate: v.plate });
  }
  async saveDriverPixKey(k: PixKeyInfo) {
    await this.rpc('save_pix_key', { p_purpose: 'recebimento_motorista', p_type: k.type, p_value: k.value, p_holder: k.holder });
  }
  async setAvailability(available: boolean) {
    await this.rpc('set_driver_availability', { p_available: available });
  }
  async pushLocation(fix: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; timestamp: number }) {
    const r = await this.rpc<Row>('push_driver_location', {
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy: fix.accuracy,
      p_heading: fix.heading,
      p_speed: fix.speed,
      p_recorded_at: new Date(fix.timestamp).toISOString(),
    });
    return { accepted: !!r.accepted, reason: r.reason };
  }
  async listOpenRides() {
    const rows = await this.rpc<Row[]>('list_open_rides');
    return (rows ?? []).map((r) => ({
      rideId: r.ride_id,
      pickupArea: { lat: r.pickup_area_lat, lng: r.pickup_area_lng },
      pickupHint: (r.pickup_hint || 'Região do embarque').trim(),
      destHint: (r.dest_hint || 'Região do destino').trim(),
      distanceToPickupM: r.distance_to_pickup_m,
      routeDistanceM: r.route_distance_m,
      routeDurationS: r.route_duration_s,
      totalCents: r.total_cents,
      driverNetCents: r.driver_net_cents,
      requestedAt: r.requested_at,
      searchExpiresAt: r.search_expires_at,
      routeSource: r.route_source,
    }));
  }
  async acceptRide(id: string) {
    const r = await this.rpc<Row>('accept_ride', { p_ride: id });
    return { accepted: !!r.accepted, reason: r.reason };
  }
  async declineRide(id: string) {
    await this.rpc('decline_ride', { p_ride: id });
  }
  async advanceRide(id: string, to: 'motorista_a_caminho' | 'motorista_chegou' | 'em_andamento' | 'finalizada') {
    await this.rpc('advance_ride', { p_ride: id, p_to: to });
  }
  async getDriverActiveRideId() {
    const id = await this.uid();
    const { data, error } = await this.sb.from('ride_requests').select('id').eq('driver_id', id).in('status', DRIVER_ACTIVE).limit(1).maybeSingle();
    fail(error);
    return data?.id ?? null;
  }
  async listDriverRides() {
    const id = await this.uid();
    const { data, error } = await this.sb.from('ride_requests').select('*').eq('driver_id', id).order('created_at', { ascending: false }).limit(50);
    fail(error);
    return (data ?? []).map(toRide);
  }
  async getEarnings(days: number) {
    const e = await this.rpc<Row>('driver_earnings', { p_days: days });
    return { rides: e.rides, grossCents: e.gross_cents, commissionCents: e.commission_cents, netCents: e.net_cents, confirmedNetCents: e.confirmed_net_cents, pendingNetCents: e.pending_net_cents };
  }

  // ---------- realtime (respeita RLS) ----------
  private channel(name: string): RealtimeChannel {
    return this.sb.channel(`${name}-${Math.random().toString(36).slice(2, 8)}`);
  }
  subscribeRide(id: string, cb: () => void): Unsubscribe {
    const ch = this.channel(`ride-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `id=eq.${id}` }, () => cb())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_intents_demo', filter: `ride_id=eq.${id}` }, () => cb())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') cb(); // ao (re)conectar, recarrega o estado para não perder eventos
      });
    return () => void this.sb.removeChannel(ch);
  }
  subscribeDriverLocation(driverId: string, cb: (loc: DriverLocation | null) => void): Unsubscribe {
    const load = async () => {
      const { data } = await this.sb.from('driver_locations').select('*').eq('driver_id', driverId).maybeSingle();
      cb(data ? toLoc(data) : null);
    };
    const ch = this.channel(`loc-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` }, (p) => {
        if (p.eventType === 'DELETE') cb(null);
        else cb(toLoc(p.new as Row));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void load();
      });
    return () => void this.sb.removeChannel(ch);
  }
  subscribeNotifications(cb: (n: AppNotification) => void): Unsubscribe {
    let ch: RealtimeChannel | null = null;
    let cancelled = false;
    void this.uid().then((id) => {
      if (cancelled) return;
      ch = this.channel(`notif-${id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` }, (p) => cb(toNotif(p.new as Row)))
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (ch) void this.sb.removeChannel(ch);
    };
  }
  onConnectionChange(cb: (online: boolean) => void): Unsubscribe {
    const on = () => cb(true);
    const off = () => cb(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = window.setInterval(() => cb(navigator.onLine && this.sb.realtime.isConnected()), 5000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.clearInterval(t);
    };
  }
  async listNotifications() {
    const { data, error } = await this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    fail(error);
    return (data ?? []).map(toNotif);
  }
  async markNotificationRead(id: string) {
    await this.sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  }

  // ---------- admin (RLS libera leitura só para admin com MFA; escritas via RPC auditadas) ----------
  admin = {
    dashboard: async () => this.rpc<never>('admin_dashboard'),
    listUsers: async () => {
      const [p, r, d, v] = await Promise.all([
        this.sb.from('profiles').select('id, full_name, phone, created_at, deleted_at').order('created_at', { ascending: false }),
        this.sb.from('roles').select('user_id, role'),
        this.sb.from('driver_profiles').select('user_id, status'),
        this.sb.from('vehicles').select('driver_id, make, model, color, plate, year').eq('active', true),
      ]);
      fail(p.error);
      return (p.data ?? []).map((u) => ({
        id: u.id,
        fullName: u.full_name,
        phone: u.phone,
        createdAt: u.created_at,
        deletedAt: u.deleted_at,
        roles: (r.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.role as Role),
        driverStatus: ((d.data ?? []).find((x) => x.user_id === u.id)?.status as DriverStatus) ?? null,
        vehicle: ((v.data ?? []).find((x) => x.driver_id === u.id) as Vehicle | undefined) ?? null,
      }));
    },
    setDriverStatus: async (userId: string, status: DriverStatus, note?: string) => {
      await this.rpc('admin_set_driver_status', { p_user: userId, p_status: status, p_note: note ?? null });
    },
    listInvites: async () => {
      const { data, error } = await this.sb.from('invites').select('*').order('created_at', { ascending: false });
      fail(error);
      return (data ?? []).map(toInvite);
    },
    createInvite: async (role: 'passageiro' | 'motorista', validHours: number, maxUses: number, note?: string) => {
      const r = await this.rpc<Row>('create_invite', { p_role: role, p_valid_hours: validHours, p_max_uses: maxUses, p_note: note ?? null });
      return { id: r.id, token: r.token, role: r.role, note: note ?? null, createdAt: new Date().toISOString(), expiresAt: r.expires_at, maxUses: r.max_uses, uses: 0, revokedAt: null };
    },
    revokeInvite: async (id: string) => {
      await this.rpc('revoke_invite', { p_id: id });
    },
    listRides: async (limit = 100) => {
      const { data, error } = await this.sb.from('ride_requests').select('*').order('created_at', { ascending: false }).limit(limit);
      fail(error);
      return (data ?? []).map(toRide);
    },
    liveRides: async () => {
      const rows = await this.rpc<Row[]>('admin_live_rides');
      return (rows ?? []).map((x) => ({ ride: toRide(x.ride), driverLocation: x.driver_location ? toLoc(x.driver_location) : null }));
    },
    cancelRide: async (id: string, reason: string) => this.cancelRide(id, reason),
    setManualPrice: async (rideId: string, totalCents: number, reason: string) => {
      await this.rpc('admin_set_manual_price', { p_ride: rideId, p_total_cents: totalCents, p_reason: reason });
    },
    fareHistory: async () => {
      const { data, error } = await this.sb.from('fare_configs').select('*').order('version', { ascending: false });
      fail(error);
      return (data ?? []).map(toFare);
    },
    setFare: async (f: Omit<FareConfigRow, 'version' | 'active' | 'createdAt'>) =>
      this.rpc<number>('admin_set_fare', {
        p_base: f.baseCents,
        p_per_km: f.perKmCents,
        p_per_min: f.perMinuteCents,
        p_minimum: f.minimumCents,
        p_commission_bps: f.commissionBps,
        p_pricing_mode: f.pricingMode,
        p_manual_price_enabled: f.manualPriceEnabled,
        p_note: f.note,
      }),
    getAllSettings: async () => {
      const { data, error } = await this.sb.from('app_settings').select('key, value');
      fail(error);
      return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    },
    setSetting: async (key: string, value: unknown) => {
      await this.rpc('admin_set_setting', { p_key: key, p_value: value });
    },
    settingsHistory: async () => {
      const { data, error } = await this.sb.from('settings_history').select('*').order('changed_at', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []).map((h) => ({ id: String(h.id), key: h.key, oldValue: h.old_value, newValue: h.new_value, changedBy: h.changed_by, changedAt: h.changed_at }));
    },
    auditLog: async () => {
      const { data, error } = await this.sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []).map((a) => ({ id: String(a.id), actorId: a.actor_id, action: a.action, entity: a.entity, entityId: a.entity_id, data: a.data, createdAt: a.created_at }));
    },
    listPayments: async () => {
      const { data, error } = await this.sb.from('payment_intents_demo').select('*').order('created_at', { ascending: false }).limit(200);
      fail(error);
      return (data ?? []).map((p) => ({
        id: p.id,
        rideId: p.ride_id,
        createdAt: p.created_at,
        status: p.status,
        amountCents: p.amount_cents,
        brcode: p.brcode,
        isSimulation: p.is_simulation,
        holderName: p.holder_name,
        commissionCents: p.commission_cents,
        driverNetCents: p.driver_net_cents,
      }));
    },
    setPaymentStatus: async (rideId: string, to: Payment['status']) => this.setPaymentStatus(rideId, to),
  };
}
