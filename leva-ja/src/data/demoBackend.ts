/**
 * MODO DEMO LOCAL — backend simulado no próprio navegador.
 * Serve para testar todos os fluxos sem Supabase/Google configurados.
 * - Dados no localStorage do aparelho (não sincroniza entre aparelhos diferentes).
 * - Abas do mesmo navegador conversam via BroadcastChannel (passageiro e motorista lado a lado).
 * - Operações críticas (aceite, transições) são serializadas com Web Locks → atômicas entre abas.
 * - Aplica as MESMAS regras do servidor usando src/core (tarifa, estados, Pix).
 * A UI exibe a faixa "MODO DEMO LOCAL" sempre que esta implementação está ativa.
 */
import { calcFare, DEFAULT_FARE_CONFIG, type FareConfig } from '../core/fare';
import { coarsen, haversineM, isValidLatLng, type LatLng, pointInPolygon } from '../core/geo';
import { buildStaticBrCode, canTransitionPayment, PILOT_SIMULATION_KEY, type PixKeyType } from '../core/pix';
import { canTransition, DRIVER_ACTIVE_STATUSES, ACTIVE_RIDE_STATUSES, type RideActor, type RideStatus } from '../core/ride';
import { sha256Hex } from '../core/validation';
import {
  type Access,
  type AppKind,
  type AppNotification,
  type AuditEntry,
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
  type Role,
  type Session,
  type SettingChange,
  type Unsubscribe,
  type Vehicle,
} from './types';

interface DemoUser {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  locationConsentAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  mfaEnrolled: boolean;
}
interface DemoDriver {
  userId: string;
  status: DriverStatus;
  isAvailable: boolean;
  vehicle: Vehicle | null;
}
interface DemoPixKey extends PixKeyInfo {
  ownerId: string;
  purpose: 'recebimento_motorista' | 'passageiro_opcional';
}
interface DemoQuote extends Quote {
  passengerId: string;
  usedAt: string | null;
}
interface DemoPayment extends Payment {
  rideId: string;
  payerId: string;
  payeeId: string;
  createdAt: string;
  events: { from: string | null; to: string; by: string; at: string; key?: string }[];
}
export interface DemoDB {
  v: 1;
  users: DemoUser[];
  roles: { userId: string; role: Role }[];
  drivers: DemoDriver[];
  pixKeys: DemoPixKey[];
  invites: (Invite & { tokenHash: string })[];
  redemptions: { inviteId: string; userId: string }[];
  fares: FareConfigRow[];
  quotes: DemoQuote[];
  rides: Ride[];
  assignments: { rideId: string; driverId: string; outcome: 'aceita' | 'recusada' | 'desistiu' }[];
  events: { rideId: string; from: RideStatus | null; to: RideStatus; by: string; reason: string | null; at: string }[];
  locations: Record<string, DriverLocation>;
  payments: DemoPayment[];
  ratings: { rideId: string; raterId: string; rateeId: string; stars: number; comment: string | null }[];
  notifications: (AppNotification & { userId: string })[];
  audit: AuditEntry[];
  settings: Record<string, unknown>;
  settingsHistory: SettingChange[];
}

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const DB_KEY = 'levaja-demo-db-v1';
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_ADMIN_MFA_CODE = '123456';
export const DEMO_ACCOUNTS = {
  passageiro: 'passageiro@demo.levaja',
  motorista: 'motorista@demo.levaja',
  admin: 'admin@demo.levaja',
} as const;

/** Locais FICTÍCIOS de teste (não representam endereços reais), usados no modo demo/mapa simulado. */
export const DEMO_PLACES = [
  { label: 'Ponto de teste A — "Praça Central" (fictício)', dlat: 0, dlng: 0 },
  { label: 'Ponto de teste B — "Estação" (fictício)', dlat: -0.012, dlng: 0.009 },
  { label: 'Ponto de teste C — "Mercado" (fictício)', dlat: 0.008, dlng: -0.014 },
  { label: 'Ponto de teste D — "Escola" (fictício)', dlat: 0.017, dlng: 0.011 },
  { label: 'Ponto de teste E — "Parque" (fictício)', dlat: -0.021, dlng: -0.018 },
  { label: 'Ponto de teste F — "Hospital" (fictício)', dlat: 0.026, dlng: 0.024 },
];

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

function defaultSettings(): Record<string, unknown> {
  return {
    pilot_mode: true,
    operations_enabled: true,
    passenger_invite_required: true,
    allow_simulated_routes: true,
    admin_require_mfa: true,
    offer_timeout_seconds: 180,
    offer_radius_km: 15,
    pilot_pix_key: PILOT_SIMULATION_KEY,
    pix_city: 'ITUPEVA',
    public_base_url: null,
    map_defaults: { center: { lat: -23.153, lng: -47.0577 }, zoom: 14, region: 'BR', language: 'pt-BR' },
    service_area: { name: 'Itupeva/SP (aproximado — revisar)', polygon: [] },
    support_contact: null,
  };
}
const PUBLIC_KEYS = ['pilot_mode', 'operations_enabled', 'passenger_invite_required', 'allow_simulated_routes', 'offer_timeout_seconds', 'offer_radius_km', 'pix_city', 'public_base_url', 'map_defaults', 'service_area', 'support_contact'];

async function seed(): Promise<DemoDB> {
  const pw = await sha256Hex(DEMO_PASSWORD);
  const mk = (email: string, fullName: string, phone: string): DemoUser => ({
    id: uid(),
    email,
    passwordHash: pw,
    fullName,
    phone,
    avatarUrl: null,
    locationConsentAt: null,
    createdAt: now(),
    deletedAt: null,
    mfaEnrolled: false,
  });
  const p = mk(DEMO_ACCOUNTS.passageiro, 'Paula Demo', '+5511900000001');
  const d = mk(DEMO_ACCOUNTS.motorista, 'Diego Demo', '+5511900000002');
  const a = mk(DEMO_ACCOUNTS.admin, 'Admin Demo', '+5511900000003');
  d.locationConsentAt = null;
  return {
    v: 1,
    users: [p, d, a],
    roles: [
      { userId: p.id, role: 'passageiro' },
      { userId: d.id, role: 'motorista' },
      { userId: a.id, role: 'admin' },
    ],
    drivers: [{ userId: d.id, status: 'aprovado', isAvailable: false, vehicle: { make: 'Demo', model: 'Sedan Simulado', color: 'Prata', plate: 'DEM0A00', year: 2022 } }],
    pixKeys: [{ ownerId: d.id, purpose: 'recebimento_motorista', type: 'email', value: 'motorista@demo.levaja.invalid', holder: 'Diego Demo' }],
    invites: [],
    redemptions: [],
    fares: [{ ...toRow(DEFAULT_FARE_CONFIG), active: true, note: 'Valores iniciais fictícios de teste', createdAt: now() }],
    quotes: [],
    rides: [],
    assignments: [],
    events: [],
    locations: {},
    payments: [],
    ratings: [],
    notifications: [],
    audit: [],
    settings: defaultSettings(),
    settingsHistory: [],
  };
}

function toRow(c: FareConfig): Omit<FareConfigRow, 'active' | 'note' | 'createdAt'> {
  return {
    version: c.version,
    baseCents: c.baseCents,
    perKmCents: c.perKmCents,
    perMinuteCents: c.perMinuteCents,
    minimumCents: c.minimumCents,
    commissionBps: c.commissionBps,
    pricingMode: c.pricingMode,
    manualPriceEnabled: c.manualPriceEnabled,
  };
}
function toConfig(r: FareConfigRow): FareConfig {
  return { ...r };
}

type ChangeMsg = { t: 'change'; rideIds: string[]; driverIds: string[]; userIds: string[] };

// Fallback de exclusão mútua no mesmo processo quando Web Locks não existe.
let localQueue: Promise<unknown> = Promise.resolve();
function withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = localQueue.then(fn, fn);
  localQueue = next.catch(() => undefined);
  return next;
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private kv: KV;
  private channel: BroadcastChannel | null;
  private listeners = new Set<(m: ChangeMsg) => void>();
  private authListeners = new Set<(s: Session | null) => void>();
  private sessionKey: string;

  constructor(app: AppKind, kv?: KV) {
    this.kv = kv ?? {
      get: (k) => localStorage.getItem(k),
      set: (k, v) => localStorage.setItem(k, v),
      remove: (k) => localStorage.removeItem(k),
    };
    this.sessionKey = `levaja-demo-session-${app}`;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('levaja-demo') : null;
    this.channel?.addEventListener('message', (ev) => this.emitLocal(ev.data as ChangeMsg));
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev) => {
        if (ev.key === DB_KEY) this.emitLocal({ t: 'change', rideIds: ['*'], driverIds: ['*'], userIds: ['*'] });
      });
    }
  }

  // ---------- infraestrutura ----------
  private emitLocal(m: ChangeMsg) {
    for (const l of this.listeners) l(m);
  }
  private broadcast(m: Omit<ChangeMsg, 't'>) {
    const msg: ChangeMsg = { t: 'change', ...m };
    this.emitLocal(msg);
    this.channel?.postMessage(msg);
  }
  private async load(): Promise<DemoDB> {
    const raw = this.kv.get(DB_KEY);
    if (raw) return JSON.parse(raw) as DemoDB;
    const db = await seed();
    this.kv.set(DB_KEY, JSON.stringify(db));
    return db;
  }
  /** Leitura-modificação-escrita exclusiva entre abas (Web Locks). */
  private async tx<T>(fn: (db: DemoDB) => T | Promise<T>, change?: Omit<ChangeMsg, 't'>): Promise<T> {
    const run = async () => {
      const db = await this.load();
      const out = await fn(db);
      this.kv.set(DB_KEY, JSON.stringify(db));
      return out;
    };
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    const out = locks ? await locks.request('levaja-demo-db', run) : await withLocalLock(run);
    if (change) this.broadcast(change);
    return out as T;
  }
  private session(): Session | null {
    const raw = this.kv.get(this.sessionKey);
    return raw ? (JSON.parse(raw) as Session) : null;
  }
  private requireUser(): Session {
    const s = this.session();
    if (!s) throw new BackendError('AUTH_REQUIRED');
    return s;
  }
  private hasRole(db: DemoDB, userId: string, role: Role) {
    const u = db.users.find((x) => x.id === userId);
    return !!u && !u.deletedAt && db.roles.some((r) => r.userId === userId && r.role === role);
  }
  private isAdmin(db: DemoDB, s: Session) {
    return this.hasRole(db, s.userId, 'admin') && (db.settings.admin_require_mfa === false || s.aal === 'aal2');
  }
  private requireAdmin(db: DemoDB) {
    const s = this.requireUser();
    if (!this.isAdmin(db, s)) throw new BackendError('FORBIDDEN');
    return s;
  }
  private approvedDriver(db: DemoDB, userId: string) {
    return this.hasRole(db, userId, 'motorista') && db.drivers.some((d) => d.userId === userId && d.status === 'aprovado');
  }
  private audit(db: DemoDB, actor: string | null, action: string, entity: string, entityId: string | null, data?: unknown) {
    db.audit.unshift({ id: uid(), actorId: actor, action, entity, entityId, data: data ?? null, createdAt: now() });
    db.audit = db.audit.slice(0, 500);
  }
  private notify(db: DemoDB, userId: string, kind: string, title: string, body: string | null, rideId: string | null) {
    db.notifications.unshift({ id: uid(), userId, kind, title, body, rideId, createdAt: now(), readAt: null });
    db.notifications = db.notifications.slice(0, 300);
  }
  private event(db: DemoDB, rideId: string, from: RideStatus | null, to: RideStatus, by: string, reason: string | null = null) {
    db.events.push({ rideId, from, to, by, reason, at: now() });
  }
  private expire(db: DemoDB) {
    const t = Date.now();
    for (const r of db.rides) {
      if ((r.status === 'procurando_motorista' || r.status === 'solicitada') && r.searchExpiresAt && Date.parse(r.searchExpiresAt) < t) {
        this.event(db, r.id, r.status, 'expirada', 'sistema', 'timeout');
        r.status = 'expirada';
        this.notify(db, r.passengerId, 'ride_expired', 'Nenhum motorista aceitou a tempo', 'Você pode solicitar novamente.', r.id);
      }
    }
  }
  private activeFare(db: DemoDB): FareConfigRow {
    const f = db.fares.find((x) => x.active);
    if (!f) throw new BackendError('NO_ACTIVE_FARE');
    return f;
  }
  private inArea(db: DemoDB, p: LatLng) {
    const poly = (db.settings.service_area as PublicSettings['service_area'])?.polygon ?? [];
    return poly.length < 3 || pointInPolygon(p, poly);
  }

  // ---------- autenticação ----------
  async getSession() {
    return this.session();
  }
  onAuthChange(cb: (s: Session | null) => void): Unsubscribe {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }
  private setSession(s: Session | null) {
    if (s) this.kv.set(this.sessionKey, JSON.stringify(s));
    else this.kv.remove(this.sessionKey);
    for (const l of this.authListeners) l(s);
  }
  async signIn(email: string, password: string) {
    const db = await this.load();
    const u = db.users.find((x) => x.email === email.trim().toLowerCase() && !x.deletedAt);
    if (!u || u.passwordHash !== (await sha256Hex(password))) throw new BackendError('INVALID_CREDENTIALS');
    this.setSession({ userId: u.id, email: u.email, aal: 'aal1' });
  }
  async signUp(input: { email: string; password: string; fullName: string; phone: string }) {
    const email = input.email.trim().toLowerCase();
    const hash = await sha256Hex(input.password);
    const id = await this.tx((db) => {
      if (db.users.some((u) => u.email === email)) throw new BackendError('EMAIL_IN_USE');
      const id = uid();
      db.users.push({ id, email, passwordHash: hash, fullName: input.fullName.trim(), phone: input.phone, avatarUrl: null, locationConsentAt: null, createdAt: now(), deletedAt: null, mfaEnrolled: false });
      return id;
    });
    this.setSession({ userId: id, email, aal: 'aal1' });
    return { needsEmailConfirmation: false };
  }
  async signOut() {
    this.setSession(null);
  }
  mfa = {
    status: async () => {
      const s = this.requireUser();
      const db = await this.load();
      return { enrolled: !!db.users.find((u) => u.id === s.userId)?.mfaEnrolled, aal: s.aal };
    },
    enroll: async () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><rect width="200" height="60" fill="#fff"/><text x="100" y="35" font-size="12" text-anchor="middle" fill="#102A43">DEMO — use o código ${DEMO_ADMIN_MFA_CODE}</text></svg>`;
      return { factorId: 'demo-factor', qrSvg: svg, secret: 'DEMO-SEM-SEGREDO-REAL' };
    },
    verify: async (_factorId: string | null, code: string) => {
      const s = this.requireUser();
      if (code !== DEMO_ADMIN_MFA_CODE) throw new BackendError('MFA_INVALID');
      await this.tx((db) => {
        const u = db.users.find((x) => x.id === s.userId);
        if (u) u.mfaEnrolled = true;
      });
      this.setSession({ ...s, aal: 'aal2' });
    },
  };

  // ---------- perfil e acesso ----------
  async getAccess(): Promise<Access> {
    const s = this.requireUser();
    const db = await this.load();
    const roles = db.roles.filter((r) => r.userId === s.userId).map((r) => r.role);
    return {
      userId: s.userId,
      roles,
      driverStatus: db.drivers.find((d) => d.userId === s.userId)?.status ?? null,
      isAdmin: this.isAdmin(db, s),
      adminNeedsMfa: roles.includes('admin') && !this.isAdmin(db, s),
    };
  }
  async getProfile() {
    const s = this.requireUser();
    const db = await this.load();
    const u = db.users.find((x) => x.id === s.userId);
    if (!u) throw new BackendError('NOT_FOUND');
    return { id: u.id, fullName: u.fullName, phone: u.phone, avatarUrl: u.avatarUrl, locationConsentAt: u.locationConsentAt };
  }
  async updateProfile(p: { fullName: string; phone: string | null }) {
    const s = this.requireUser();
    await this.tx((db) => {
      const u = db.users.find((x) => x.id === s.userId)!;
      u.fullName = p.fullName.trim();
      u.phone = p.phone;
    });
  }
  async setLocationConsent(granted: boolean) {
    const s = this.requireUser();
    await this.tx(
      (db) => {
        const u = db.users.find((x) => x.id === s.userId)!;
        u.locationConsentAt = granted ? now() : null;
        if (!granted) {
          delete db.locations[s.userId];
          const d = db.drivers.find((x) => x.userId === s.userId);
          if (d) d.isAvailable = false;
        }
        this.audit(db, s.userId, 'location_consent', 'profile', s.userId, { granted });
      },
      { rideIds: [], driverIds: [s.userId], userIds: [] },
    );
  }
  async redeemInvite(token: string) {
    const s = this.requireUser();
    const hash = await sha256Hex(token);
    return this.tx((db) => {
      const inv = db.invites.find((i) => i.tokenHash === hash);
      if (!inv) throw new BackendError('INVITE_INVALID');
      if (inv.revokedAt) throw new BackendError('INVITE_REVOKED');
      if (Date.parse(inv.expiresAt) < Date.now()) throw new BackendError('INVITE_EXPIRED');
      if (db.redemptions.some((r) => r.inviteId === inv.id && r.userId === s.userId)) return { role: inv.role as Role, already: true };
      if (inv.uses >= inv.maxUses) throw new BackendError('INVITE_EXHAUSTED');
      inv.uses += 1;
      db.redemptions.push({ inviteId: inv.id, userId: s.userId });
      if (!db.roles.some((r) => r.userId === s.userId && r.role === inv.role)) db.roles.push({ userId: s.userId, role: inv.role });
      if (inv.role === 'motorista' && !db.drivers.some((d) => d.userId === s.userId)) db.drivers.push({ userId: s.userId, status: 'pendente', isAvailable: false, vehicle: null });
      this.audit(db, s.userId, 'invite_redeemed', 'invite', inv.id, { role: inv.role });
      return { role: inv.role as Role, already: false };
    });
  }
  async selfEnrollPassenger() {
    const s = this.requireUser();
    await this.tx((db) => {
      if (db.settings.passenger_invite_required !== false) throw new BackendError('INVITE_REQUIRED');
      if (!db.roles.some((r) => r.userId === s.userId && r.role === 'passageiro')) db.roles.push({ userId: s.userId, role: 'passageiro' });
    });
  }
  async deleteMyAccount() {
    const s = this.requireUser();
    await this.tx((db) => {
      if (db.rides.some((r) => (r.passengerId === s.userId || r.driverId === s.userId) && ACTIVE_RIDE_STATUSES.includes(r.status))) throw new BackendError('RIDE_IN_PROGRESS');
      const u = db.users.find((x) => x.id === s.userId)!;
      Object.assign(u, { fullName: 'Usuário removido', phone: null, avatarUrl: null, locationConsentAt: null, deletedAt: now(), email: `removido-${u.id}@invalid` });
      delete db.locations[s.userId];
      db.pixKeys = db.pixKeys.filter((k) => k.ownerId !== s.userId);
      db.notifications = db.notifications.filter((n) => n.userId !== s.userId);
      db.roles = db.roles.filter((r) => r.userId !== s.userId);
      const d = db.drivers.find((x) => x.userId === s.userId);
      if (d) Object.assign(d, { isAvailable: false, status: 'revogado' });
      this.audit(db, s.userId, 'account_deleted', 'profile', s.userId);
    });
    this.setSession(null);
  }
  async getPublicSettings(): Promise<PublicSettings> {
    const db = await this.load();
    const out: Record<string, unknown> = {};
    for (const k of PUBLIC_KEYS) out[k] = db.settings[k];
    return out as unknown as PublicSettings;
  }
  async getActiveFare() {
    return this.activeFare(await this.load());
  }

  // ---------- passageiro ----------
  async quoteRide(origin: LatLng, dest: LatLng): Promise<Quote> {
    const s = this.requireUser();
    if (!isValidLatLng(origin) || !isValidLatLng(dest)) throw new BackendError('INVALID_COORDS');
    return this.tx((db) => {
      if (!this.hasRole(db, s.userId, 'passageiro')) throw new BackendError('FORBIDDEN');
      if (!db.settings.allow_simulated_routes) throw new BackendError('SIMULATED_ROUTES_DISABLED');
      const f = this.activeFare(db);
      // ROTA SIMULADA: linha reta × 1,35 a 25 km/h — claramente marcada como simulada na UI
      const distanceM = Math.round(haversineM(origin, dest) * 1.35);
      const durationS = Math.round(distanceM / (25000 / 3600));
      const b = calcFare(toConfig(f), distanceM, durationS);
      const q: DemoQuote = {
        id: uid(),
        fareVersion: f.version,
        pricingMode: f.pricingMode,
        distanceM: b.distanceM,
        durationS: b.durationS,
        polyline: null,
        routeSource: 'simulada',
        baseCents: b.baseCents,
        distanceCents: b.distanceCents,
        timeCents: b.timeCents,
        subtotalCents: b.subtotalCents,
        minimumCents: b.minimumCents,
        totalCents: b.totalCents,
        commissionBps: b.commissionBps,
        commissionCents: b.commissionCents,
        driverNetCents: b.driverNetCents,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        origin,
        dest,
        passengerId: s.userId,
        usedAt: null,
      };
      db.quotes.push(q);
      db.quotes = db.quotes.slice(-200);
      return q;
    });
  }

  async requestRide(input: { quoteId: string; pickup: LatLng & { address: string; accuracyM: number | null }; destAddress: string; notes?: string }) {
    const s = this.requireUser();
    let offered: string[] = [];
    const id = await this.tx((db) => {
      if (!this.hasRole(db, s.userId, 'passageiro')) throw new BackendError('FORBIDDEN');
      if (db.settings.operations_enabled === false) throw new BackendError('OPERATIONS_PAUSED');
      this.expire(db);
      const q = db.quotes.find((x) => x.id === input.quoteId && x.passengerId === s.userId);
      if (!q) throw new BackendError('QUOTE_NOT_FOUND');
      if (q.usedAt) throw new BackendError('QUOTE_ALREADY_USED');
      if (Date.parse(q.expiresAt) < Date.now()) throw new BackendError('QUOTE_EXPIRED');
      if (haversineM(q.origin, input.pickup) > 300) throw new BackendError('PICKUP_TOO_FAR_FROM_QUOTE');
      if (!this.inArea(db, input.pickup)) throw new BackendError('PICKUP_OUTSIDE_SERVICE_AREA');
      if (!this.inArea(db, q.dest)) throw new BackendError('DEST_OUTSIDE_SERVICE_AREA');
      if (db.rides.some((r) => r.passengerId === s.userId && ACTIVE_RIDE_STATUSES.includes(r.status))) throw new BackendError('PASSENGER_HAS_ACTIVE_RIDE');
      q.usedAt = now();
      const ride: Ride = {
        id: uid(),
        passengerId: s.userId,
        driverId: null,
        status: 'solicitada',
        pickup: { lat: input.pickup.lat, lng: input.pickup.lng, address: input.pickup.address.slice(0, 200) },
        dest: { lat: q.dest.lat, lng: q.dest.lng, address: input.destAddress.slice(0, 200) },
        notes: input.notes?.slice(0, 200) || null,
        totalCents: q.totalCents,
        commissionCents: q.commissionCents,
        driverNetCents: q.driverNetCents,
        manualPrice: false,
        isSimulation: db.settings.pilot_mode !== false,
        cancelReason: null,
        cancelledBy: null,
        searchExpiresAt: new Date(Date.now() + Number(db.settings.offer_timeout_seconds ?? 180) * 1000).toISOString(),
        requestedAt: now(),
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        finishedAt: null,
        cancelledAt: null,
        createdAt: now(),
      };
      (ride as Ride & { quoteId: string }).quoteId = q.id;
      db.rides.unshift(ride);
      this.event(db, ride.id, null, 'solicitada', 'passageiro');
      ride.status = 'procurando_motorista';
      this.event(db, ride.id, 'solicitada', 'procurando_motorista', 'sistema');
      const radius = Number(db.settings.offer_radius_km ?? 15) * 1000;
      offered = db.drivers
        .filter((d) => d.isAvailable && d.status === 'aprovado' && d.userId !== s.userId)
        .filter((d) => {
          const loc = db.locations[d.userId];
          return loc && Date.now() - Date.parse(loc.receivedAt) < 5 * 60_000 && haversineM(loc, input.pickup) <= radius;
        })
        .filter((d) => !db.rides.some((r) => r.driverId === d.userId && DRIVER_ACTIVE_STATUSES.includes(r.status)))
        .map((d) => d.userId);
      for (const d of offered) this.notify(db, d, 'ride_offer', 'Nova solicitação de corrida', null, ride.id);
      return ride.id;
    });
    this.broadcast({ rideIds: [id], driverIds: [], userIds: offered });
    return id;
  }

  async getActiveRideId() {
    const s = this.requireUser();
    return this.tx((db) => {
      this.expire(db);
      return db.rides.find((r) => r.passengerId === s.userId && ACTIVE_RIDE_STATUSES.includes(r.status))?.id ?? null;
    });
  }

  async getRideDetails(id: string) {
    const s = this.requireUser();
    const db = await this.load();
    const r = db.rides.find((x) => x.id === id);
    if (!r) throw new BackendError('NOT_FOUND');
    let viewerRole: Role;
    if (r.passengerId === s.userId) viewerRole = 'passageiro';
    else if (r.driverId === s.userId) viewerRole = 'motorista';
    else if (this.isAdmin(db, s)) viewerRole = 'admin';
    else throw new BackendError('FORBIDDEN');
    const q = db.quotes.find((x) => x.id === (r as Ride & { quoteId?: string }).quoteId);
    const rating = (userId: string) => {
      const rs = db.ratings.filter((x) => x.rateeId === userId);
      return rs.length ? Math.round((rs.reduce((a, b) => a + b.stars, 0) / rs.length) * 10) / 10 : null;
    };
    const du = r.driverId ? db.users.find((u) => u.id === r.driverId) : null;
    const pu = db.users.find((u) => u.id === r.passengerId);
    const pay = db.payments.find((p) => p.rideId === id) ?? null;
    return {
      ride: r,
      viewerRole,
      fare: {
        version: q?.fareVersion ?? 0,
        pricingMode: q?.pricingMode ?? 'fixa_na_solicitacao',
        distanceM: q?.distanceM ?? 0,
        durationS: q?.durationS ?? 0,
        baseCents: q?.baseCents ?? 0,
        distanceCents: q?.distanceCents ?? 0,
        timeCents: q?.timeCents ?? 0,
        minimumCents: q?.minimumCents ?? 0,
        subtotalCents: q?.subtotalCents ?? 0,
        commissionBps: q?.commissionBps ?? 0,
        routeSource: q?.routeSource ?? 'simulada',
        routePolyline: q?.polyline ?? null,
      },
      driver: du
        ? { id: du.id, name: du.fullName.split(' ')[0], avatarUrl: du.avatarUrl, rating: rating(du.id), vehicle: db.drivers.find((d) => d.userId === du.id)?.vehicle ?? null }
        : null,
      passenger: viewerRole !== 'passageiro' && pu ? { id: pu.id, name: pu.fullName.split(' ')[0], rating: rating(pu.id) } : null,
      payment: pay
        ? { id: pay.id, status: pay.status, amountCents: pay.amountCents, brcode: pay.brcode, isSimulation: pay.isSimulation, holderName: pay.holderName, commissionCents: pay.commissionCents, driverNetCents: pay.driverNetCents }
        : null,
      myRating: db.ratings.find((x) => x.rideId === id && x.raterId === s.userId)?.stars ?? null,
      events: db.events.filter((e) => e.rideId === id).map((e) => ({ to: e.to, at: e.at, by: e.by, reason: e.reason })),
    };
  }

  async listMyRides() {
    const s = this.requireUser();
    const db = await this.load();
    return db.rides.filter((r) => r.passengerId === s.userId).slice(0, 50);
  }

  async cancelRide(id: string, reason: string) {
    const s = this.requireUser();
    if (!reason || reason.trim().length < 2) throw new BackendError('REASON_REQUIRED');
    let affected: string[] = [];
    await this.tx((db) => {
      const r = db.rides.find((x) => x.id === id);
      if (!r) throw new BackendError('NOT_FOUND');
      let actor: RideActor;
      if (r.passengerId === s.userId) actor = 'passageiro';
      else if (r.driverId === s.userId) actor = 'motorista';
      else if (this.isAdmin(db, s)) actor = 'admin';
      else throw new BackendError('FORBIDDEN');
      affected = [r.passengerId, r.driverId ?? ''].filter(Boolean);
      if (actor === 'motorista' && (r.status === 'aceita' || r.status === 'motorista_a_caminho')) {
        if (!canTransition(r.status, 'procurando_motorista', actor)) throw new BackendError('INVALID_TRANSITION');
        this.event(db, r.id, r.status, 'procurando_motorista', actor, reason);
        db.assignments.push({ rideId: r.id, driverId: s.userId, outcome: 'desistiu' });
        Object.assign(r, { status: 'procurando_motorista', driverId: null, acceptedAt: null, searchExpiresAt: new Date(Date.now() + Number(db.settings.offer_timeout_seconds ?? 180) * 1000).toISOString() });
        this.notify(db, r.passengerId, 'ride_reoffered', 'O motorista desistiu', 'Estamos procurando outro motorista.', r.id);
        return;
      }
      if (!canTransition(r.status, 'cancelada', actor)) throw new BackendError('INVALID_TRANSITION');
      this.event(db, r.id, r.status, 'cancelada', actor, reason);
      Object.assign(r, { status: 'cancelada', cancelReason: reason.slice(0, 200), cancelledBy: actor, cancelledAt: now() });
      if (actor !== 'passageiro') this.notify(db, r.passengerId, 'ride_cancelled', 'Corrida cancelada', reason, r.id);
      if (r.driverId && actor !== 'motorista') this.notify(db, r.driverId, 'ride_cancelled', 'Corrida cancelada', reason, r.id);
    });
    this.broadcast({ rideIds: [id], driverIds: [], userIds: affected });
  }

  async rateRide(id: string, stars: number, comment?: string) {
    const s = this.requireUser();
    await this.tx(
      (db) => {
        const r = db.rides.find((x) => x.id === id);
        if (!r || r.status !== 'finalizada') throw new BackendError('RIDE_NOT_FINISHED');
        const ratee = r.passengerId === s.userId ? r.driverId : r.driverId === s.userId ? r.passengerId : null;
        if (!ratee) throw new BackendError('FORBIDDEN');
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new BackendError('INVALID_STARS');
        if (db.ratings.some((x) => x.rideId === id && x.raterId === s.userId)) throw new BackendError('ALREADY_RATED', 'Você já avaliou esta corrida.');
        db.ratings.push({ rideId: id, raterId: s.userId, rateeId: ratee, stars, comment: comment?.slice(0, 300) ?? null });
      },
      { rideIds: [id], driverIds: [], userIds: [] },
    );
  }

  async setPaymentStatus(rideId: string, to: Payment['status'], idempotencyKey?: string) {
    const s = this.requireUser();
    await this.tx(
      (db) => {
        const p = db.payments.find((x) => x.rideId === rideId);
        if (!p) throw new BackendError('NOT_FOUND');
        if (idempotencyKey && p.events.some((e) => e.key === idempotencyKey)) return;
        const r = db.rides.find((x) => x.id === rideId)!;
        const actor = r.passengerId === s.userId ? 'passageiro' : r.driverId === s.userId ? 'motorista' : this.isAdmin(db, s) ? 'admin' : null;
        if (!actor) throw new BackendError('FORBIDDEN');
        if (!canTransitionPayment(p.status, to, actor)) throw new BackendError('INVALID_PAYMENT_TRANSITION');
        p.events.push({ from: p.status, to, by: actor, at: now(), key: idempotencyKey });
        p.status = to;
        if (actor === 'passageiro' && r.driverId) this.notify(db, r.driverId, 'payment_informed', 'Passageiro informou pagamento', 'Confira antes de confirmar.', rideId);
      },
      { rideIds: [rideId], driverIds: [], userIds: [] },
    );
  }

  async savePassengerPixKey(key: PixKeyInfo | null) {
    const s = this.requireUser();
    await this.tx((db) => {
      db.pixKeys = db.pixKeys.filter((k) => !(k.ownerId === s.userId && k.purpose === 'passageiro_opcional'));
      if (key) db.pixKeys.push({ ...key, ownerId: s.userId, purpose: 'passageiro_opcional' });
    });
  }
  async getMyPixKey(purpose: 'recebimento_motorista' | 'passageiro_opcional') {
    const s = this.requireUser();
    const db = await this.load();
    const k = db.pixKeys.find((x) => x.ownerId === s.userId && x.purpose === purpose);
    return k ? { type: k.type as PixKeyType, value: k.value, holder: k.holder } : null;
  }

  // ---------- motorista ----------
  async getDriverSetup() {
    const s = this.requireUser();
    const db = await this.load();
    const d = db.drivers.find((x) => x.userId === s.userId);
    if (!d) throw new BackendError('FORBIDDEN');
    const k = db.pixKeys.find((x) => x.ownerId === s.userId && x.purpose === 'recebimento_motorista');
    return { status: d.status, isAvailable: d.isAvailable, vehicle: d.vehicle, pixKey: k ? { type: k.type, value: k.value, holder: k.holder } : null };
  }
  async saveVehicle(v: Vehicle) {
    const s = this.requireUser();
    await this.tx((db) => {
      if (!this.hasRole(db, s.userId, 'motorista')) throw new BackendError('FORBIDDEN');
      if (db.rides.some((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status))) throw new BackendError('RIDE_IN_PROGRESS');
      if (db.drivers.some((d) => d.userId !== s.userId && d.vehicle?.plate === v.plate)) throw new BackendError('PLATE_IN_USE', 'Placa já cadastrada por outro motorista.');
      db.drivers.find((d) => d.userId === s.userId)!.vehicle = v;
      this.audit(db, s.userId, 'vehicle_saved', 'vehicle', s.userId, { plate: v.plate });
    });
  }
  async saveDriverPixKey(k: PixKeyInfo) {
    const s = this.requireUser();
    await this.tx((db) => {
      if (!this.hasRole(db, s.userId, 'motorista')) throw new BackendError('FORBIDDEN');
      db.pixKeys = db.pixKeys.filter((x) => !(x.ownerId === s.userId && x.purpose === 'recebimento_motorista'));
      db.pixKeys.push({ ...k, ownerId: s.userId, purpose: 'recebimento_motorista' });
      this.audit(db, s.userId, 'pix_key_saved', 'pix_key', s.userId, { type: k.type });
    });
  }
  async setAvailability(available: boolean) {
    const s = this.requireUser();
    await this.tx(
      (db) => {
        const d = db.drivers.find((x) => x.userId === s.userId);
        if (!d) throw new BackendError('FORBIDDEN');
        if (available) {
          if (!this.approvedDriver(db, s.userId)) throw new BackendError('DRIVER_NOT_APPROVED');
          if (!d.vehicle) throw new BackendError('VEHICLE_REQUIRED');
          if (!db.pixKeys.some((k) => k.ownerId === s.userId && k.purpose === 'recebimento_motorista')) throw new BackendError('PIX_KEY_REQUIRED');
          if (!db.users.find((u) => u.id === s.userId)?.locationConsentAt) throw new BackendError('LOCATION_CONSENT_REQUIRED');
        }
        d.isAvailable = available;
        if (!available && !db.rides.some((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status))) delete db.locations[s.userId];
      },
      { rideIds: [], driverIds: [s.userId], userIds: [] },
    );
  }
  async pushLocation(fix: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; timestamp: number }) {
    const s = this.requireUser();
    const res = await this.tx((db) => {
      if (!this.approvedDriver(db, s.userId)) throw new BackendError('DRIVER_NOT_APPROVED');
      const d = db.drivers.find((x) => x.userId === s.userId)!;
      const onRide = db.rides.some((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status));
      if (!d.isAvailable && !onRide) throw new BackendError('NOT_TRACKABLE');
      if (!isValidLatLng(fix)) throw new BackendError('INVALID_COORDS');
      if (!(fix.accuracy > 0 && fix.accuracy <= 1000)) return { accepted: false, reason: 'invalid_accuracy' };
      if (fix.timestamp > Date.now() + 30_000) return { accepted: false, reason: 'future' };
      if (fix.timestamp < Date.now() - 120_000) return { accepted: false, reason: 'stale' };
      const prev = db.locations[s.userId];
      if (prev) {
        if (Date.now() - Date.parse(prev.receivedAt) < 2000) return { accepted: false, reason: 'throttled' };
        const prevT = Date.parse(prev.recordedAt);
        if (fix.timestamp <= prevT) return { accepted: false, reason: 'out_of_order' };
        const dt = (fix.timestamp - prevT) / 1000;
        const dist = Math.max(0, haversineM(prev, fix) - prev.accuracyM - fix.accuracy);
        if (dist / dt > 55) return { accepted: false, reason: 'implausible_jump' };
      }
      db.locations[s.userId] = { driverId: s.userId, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracy, heading: fix.heading, speedMs: fix.speed, recordedAt: new Date(fix.timestamp).toISOString(), receivedAt: now() };
      return { accepted: true };
    });
    if (res.accepted) this.broadcast({ rideIds: [], driverIds: [s.userId], userIds: [] });
    return res;
  }
  async listOpenRides() {
    const s = this.requireUser();
    return this.tx((db) => {
      if (!this.approvedDriver(db, s.userId)) throw new BackendError('DRIVER_NOT_APPROVED');
      this.expire(db);
      const d = db.drivers.find((x) => x.userId === s.userId)!;
      if (!d.isAvailable) return [];
      if (db.rides.some((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status))) return [];
      const loc = db.locations[s.userId];
      const radius = Number(db.settings.offer_radius_km ?? 15) * 1000;
      return db.rides
        .filter((r) => r.status === 'procurando_motorista' && r.passengerId !== s.userId)
        .filter((r) => !db.assignments.some((a) => a.rideId === r.id && a.driverId === s.userId && a.outcome !== 'aceita'))
        .filter((r) => !loc || haversineM(loc, r.pickup) <= radius)
        .map((r) => {
          const q = db.quotes.find((x) => x.id === (r as Ride & { quoteId?: string }).quoteId);
          return {
            rideId: r.id,
            pickupArea: coarsen(r.pickup),
            pickupHint: r.pickup.address.split(',')[1]?.trim() || 'Região do embarque',
            destHint: r.dest.address.split(',')[1]?.trim() || 'Região do destino',
            distanceToPickupM: loc ? Math.round(haversineM(loc, r.pickup)) : null,
            routeDistanceM: q?.distanceM ?? 0,
            routeDurationS: q?.durationS ?? 0,
            totalCents: r.totalCents,
            driverNetCents: r.driverNetCents,
            requestedAt: r.requestedAt ?? r.createdAt,
            searchExpiresAt: r.searchExpiresAt ?? r.createdAt,
            routeSource: q?.routeSource ?? 'simulada',
          };
        });
    });
  }
  async acceptRide(id: string) {
    const s = this.requireUser();
    let passenger = '';
    const res = await this.tx((db) => {
      if (!this.approvedDriver(db, s.userId)) throw new BackendError('DRIVER_NOT_APPROVED');
      const d = db.drivers.find((x) => x.userId === s.userId)!;
      if (!d.isAvailable) throw new BackendError('DRIVER_NOT_AVAILABLE');
      if (!d.vehicle) throw new BackendError('VEHICLE_REQUIRED');
      this.expire(db);
      if (db.rides.some((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status))) throw new BackendError('DRIVER_HAS_ACTIVE_RIDE');
      const r = db.rides.find((x) => x.id === id);
      // mesmo princípio do UPDATE condicional no Postgres: só aceita se AINDA estiver procurando
      if (!r || r.status !== 'procurando_motorista' || r.passengerId === s.userId) return { accepted: false, reason: 'ALREADY_TAKEN_OR_UNAVAILABLE' };
      Object.assign(r, { status: 'aceita', driverId: s.userId, acceptedAt: now() });
      db.assignments.push({ rideId: id, driverId: s.userId, outcome: 'aceita' });
      this.event(db, id, 'procurando_motorista', 'aceita', 'motorista');
      this.notify(db, r.passengerId, 'ride_accepted', 'Motorista confirmado', 'Seu motorista aceitou a corrida.', id);
      passenger = r.passengerId;
      return { accepted: true };
    });
    this.broadcast({ rideIds: [id], driverIds: [s.userId], userIds: [passenger] });
    return res;
  }
  async declineRide(id: string) {
    const s = this.requireUser();
    await this.tx((db) => {
      if (!db.assignments.some((a) => a.rideId === id && a.driverId === s.userId && a.outcome === 'recusada')) db.assignments.push({ rideId: id, driverId: s.userId, outcome: 'recusada' });
    });
  }
  async advanceRide(id: string, to: 'motorista_a_caminho' | 'motorista_chegou' | 'em_andamento' | 'finalizada') {
    const s = this.requireUser();
    let passenger = '';
    await this.tx((db) => {
      const r = db.rides.find((x) => x.id === id);
      if (!r || r.driverId !== s.userId) throw new BackendError('FORBIDDEN');
      if (!canTransition(r.status, to, 'motorista')) throw new BackendError('INVALID_TRANSITION');
      this.event(db, id, r.status, to, 'motorista');
      r.status = to;
      if (to === 'motorista_chegou') r.arrivedAt = now();
      if (to === 'em_andamento') r.startedAt = now();
      if (to === 'finalizada') {
        r.finishedAt = now();
        const q = db.quotes.find((x) => x.id === (r as Ride & { quoteId?: string }).quoteId);
        if (q?.pricingMode === 'variavel' && !r.manualPrice && r.startedAt) {
          const f = db.fares.find((x) => x.version === q.fareVersion) ?? this.activeFare(db);
          const b = calcFare(toConfig(f), q.distanceM, (Date.now() - Date.parse(r.startedAt)) / 1000);
          Object.assign(r, { totalCents: b.totalCents, commissionCents: b.commissionCents, driverNetCents: b.driverNetCents });
        }
        const pilot = db.settings.pilot_mode !== false;
        const key = db.pixKeys.find((k) => k.ownerId === s.userId && k.purpose === 'recebimento_motorista');
        const simulate = pilot || !key;
        const pixKey = simulate ? String(db.settings.pilot_pix_key ?? PILOT_SIMULATION_KEY) : key!.value;
        const holder = simulate ? 'SIMULACAO LEVA JA' : key!.holder;
        db.payments.push({
          id: uid(),
          rideId: id,
          payerId: r.passengerId,
          payeeId: s.userId,
          status: 'aguardando',
          amountCents: r.totalCents,
          commissionCents: r.commissionCents,
          driverNetCents: r.driverNetCents,
          brcode: buildStaticBrCode({ key: pixKey, amountCents: r.totalCents, merchantName: holder, merchantCity: String(db.settings.pix_city ?? 'ITUPEVA'), txid: 'LJ' + id.replace(/-/g, '').slice(0, 20).toUpperCase() }),
          isSimulation: simulate,
          holderName: holder,
          createdAt: now(),
          events: [{ from: null, to: 'aguardando', by: 'motorista', at: now() }],
        });
      }
      const titles: Record<string, string> = { motorista_a_caminho: 'Motorista a caminho', motorista_chegou: 'Seu motorista chegou', em_andamento: 'Corrida iniciada', finalizada: 'Corrida finalizada' };
      this.notify(db, r.passengerId, 'ride_' + to, titles[to], null, id);
      passenger = r.passengerId;
    });
    this.broadcast({ rideIds: [id], driverIds: [s.userId], userIds: [passenger] });
  }
  async getDriverActiveRideId() {
    const s = this.requireUser();
    const db = await this.load();
    return db.rides.find((r) => r.driverId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status))?.id ?? null;
  }
  async listDriverRides() {
    const s = this.requireUser();
    const db = await this.load();
    return db.rides.filter((r) => r.driverId === s.userId).slice(0, 50);
  }
  async getEarnings(days: number) {
    const s = this.requireUser();
    const db = await this.load();
    const since = Date.now() - days * 86400_000;
    const rides = db.rides.filter((r) => r.driverId === s.userId && r.status === 'finalizada' && r.finishedAt && Date.parse(r.finishedAt) > since);
    const confirmed = (r: Ride) => db.payments.find((p) => p.rideId === r.id)?.status === 'confirmado_manual';
    const sum = (arr: Ride[], f: (r: Ride) => number) => arr.reduce((a, r) => a + f(r), 0);
    return {
      rides: rides.length,
      grossCents: sum(rides, (r) => r.totalCents),
      commissionCents: sum(rides, (r) => r.commissionCents),
      netCents: sum(rides, (r) => r.driverNetCents),
      confirmedNetCents: sum(rides.filter(confirmed), (r) => r.driverNetCents),
      pendingNetCents: sum(rides.filter((r) => !confirmed(r)), (r) => r.driverNetCents),
    };
  }

  // ---------- tempo real ----------
  subscribeRide(id: string, cb: () => void): Unsubscribe {
    const l = (m: ChangeMsg) => {
      if (m.rideIds.includes(id) || m.rideIds.includes('*')) cb();
    };
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  subscribeDriverLocation(driverId: string, cb: (loc: DriverLocation | null) => void): Unsubscribe {
    const s = this.session();
    const emit = async () => {
      const db = await this.load();
      // mesma regra da RLS: só o próprio motorista, admin, ou passageiro com corrida ativa com ele
      const allowed =
        !!s &&
        (s.userId === driverId || this.isAdmin(db, s) || db.rides.some((r) => r.driverId === driverId && r.passengerId === s.userId && DRIVER_ACTIVE_STATUSES.includes(r.status)));
      cb(allowed ? db.locations[driverId] ?? null : null);
    };
    const l = (m: ChangeMsg) => {
      if (m.driverIds.includes(driverId) || m.driverIds.includes('*') || m.rideIds.length) void emit();
    };
    this.listeners.add(l);
    void emit();
    return () => this.listeners.delete(l);
  }
  subscribeNotifications(cb: (n: AppNotification) => void): Unsubscribe {
    let seen = new Set<string>();
    let primed = false;
    const check = async () => {
      const s = this.session();
      if (!s) return;
      const db = await this.load();
      const mine = db.notifications.filter((n) => n.userId === s.userId);
      if (primed) for (const n of mine) if (!seen.has(n.id)) cb(n);
      seen = new Set(mine.map((n) => n.id));
      primed = true;
    };
    void check();
    const l = () => void check();
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onConnectionChange(cb: (online: boolean) => void): Unsubscribe {
    const on = () => cb(true);
    const off = () => cb(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }
  async listNotifications() {
    const s = this.requireUser();
    const db = await this.load();
    return db.notifications.filter((n) => n.userId === s.userId).slice(0, 50);
  }
  async markNotificationRead(id: string) {
    const s = this.requireUser();
    await this.tx((db) => {
      const n = db.notifications.find((x) => x.id === id && x.userId === s.userId);
      if (n) n.readAt = now();
    });
  }

  // ---------- admin ----------
  admin = {
    dashboard: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      const since = Date.now() - 30 * 86400_000;
      const fin = db.rides.filter((r) => r.status === 'finalizada' && r.finishedAt && Date.parse(r.finishedAt) > since);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return {
        users: db.users.filter((u) => !u.deletedAt).length,
        passengers: db.roles.filter((r) => r.role === 'passageiro').length,
        drivers_pending: db.drivers.filter((d) => d.status === 'pendente').length,
        drivers_approved: db.drivers.filter((d) => d.status === 'aprovado').length,
        drivers_available: db.drivers.filter((d) => d.isAvailable).length,
        rides_active: db.rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status)).length,
        rides_today: db.rides.filter((r) => Date.parse(r.createdAt) > today.getTime()).length,
        rides_finished_30d: fin.length,
        gross_30d_cents: fin.reduce((a, r) => a + r.totalCents, 0),
        commission_30d_cents: fin.reduce((a, r) => a + r.commissionCents, 0),
        payments_pending: db.payments.filter((p) => ['aguardando', 'informado', 'confirmacao_manual'].includes(p.status)).length,
      };
    },
    listUsers: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.users.map((u) => {
        const d = db.drivers.find((x) => x.userId === u.id);
        return { id: u.id, fullName: u.fullName, phone: u.phone, roles: db.roles.filter((r) => r.userId === u.id).map((r) => r.role), driverStatus: d?.status ?? null, vehicle: d?.vehicle ?? null, createdAt: u.createdAt, deletedAt: u.deletedAt };
      });
    },
    setDriverStatus: async (userId: string, status: DriverStatus, note?: string) => {
      await this.tx(
        (db) => {
          const a = this.requireAdmin(db);
          const d = db.drivers.find((x) => x.userId === userId);
          if (!d) throw new BackendError('NOT_FOUND');
          d.status = status;
          if (status !== 'aprovado') d.isAvailable = false;
          this.audit(db, a.userId, 'driver_status', 'driver', userId, { status, note });
          this.notify(db, userId, 'driver_status', status === 'aprovado' ? 'Cadastro aprovado' : 'Status do cadastro atualizado', status, null);
        },
        { rideIds: [], driverIds: [userId], userIds: [userId] },
      );
    },
    listInvites: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.invites.map(({ tokenHash: _h, ...i }) => i).reverse();
    },
    createInvite: async (role: 'passageiro' | 'motorista', validHours: number, maxUses: number, note?: string) => {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      const tokenHash = await sha256Hex(token);
      return this.tx((db) => {
        const a = this.requireAdmin(db);
        if (validHours < 1 || validHours > 24 * 90) throw new BackendError('INVALID_VALIDITY', 'Validade deve ser entre 1 hora e 90 dias.');
        if (maxUses < 1 || maxUses > 500) throw new BackendError('INVALID_MAX_USES', 'Limite de usos entre 1 e 500.');
        const inv = { id: uid(), role, note: note ?? null, createdAt: now(), expiresAt: new Date(Date.now() + validHours * 3600_000).toISOString(), maxUses, uses: 0, revokedAt: null, tokenHash };
        db.invites.push(inv);
        this.audit(db, a.userId, 'invite_created', 'invite', inv.id, { role, maxUses });
        const { tokenHash: _t, ...pub } = inv;
        return { ...pub, token };
      });
    },
    revokeInvite: async (id: string) => {
      await this.tx((db) => {
        const a = this.requireAdmin(db);
        const inv = db.invites.find((i) => i.id === id);
        if (inv && !inv.revokedAt) inv.revokedAt = now();
        this.audit(db, a.userId, 'invite_revoked', 'invite', id);
      });
    },
    listRides: async (limit = 100) => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.rides.slice(0, limit);
    },
    liveRides: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status)).map((r) => ({ ride: r, driverLocation: r.driverId ? db.locations[r.driverId] ?? null : null }));
    },
    cancelRide: async (id: string, reason: string) => this.cancelRide(id, reason),
    setManualPrice: async (rideId: string, totalCents: number, reason: string) => {
      await this.tx(
        (db) => {
          const a = this.requireAdmin(db);
          const r = db.rides.find((x) => x.id === rideId);
          if (!r) throw new BackendError('NOT_FOUND');
          const q = db.quotes.find((x) => x.id === (r as Ride & { quoteId?: string }).quoteId);
          const f = db.fares.find((x) => x.version === q?.fareVersion);
          if (!f?.manualPriceEnabled) throw new BackendError('MANUAL_PRICE_DISABLED');
          if (!['procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou'].includes(r.status)) throw new BackendError('INVALID_TRANSITION');
          if (!Number.isInteger(totalCents) || totalCents <= 0) throw new BackendError('INVALID_AMOUNT', 'Valor inválido.');
          const comm = Math.floor((totalCents * f.commissionBps) / 10000 + 0.5);
          this.audit(db, a.userId, 'manual_price', 'ride', rideId, { old: r.totalCents, new: totalCents, reason });
          Object.assign(r, { totalCents, commissionCents: comm, driverNetCents: totalCents - comm, manualPrice: true });
          this.notify(db, r.passengerId, 'manual_price', 'Preço definido manualmente pelo administrador', reason, rideId);
        },
        { rideIds: [rideId], driverIds: [], userIds: [] },
      );
    },
    fareHistory: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return [...db.fares].reverse();
    },
    setFare: async (f: Omit<FareConfigRow, 'version' | 'active' | 'createdAt'>) => {
      return this.tx((db) => {
        const a = this.requireAdmin(db);
        for (const v of [f.baseCents, f.perKmCents, f.perMinuteCents, f.minimumCents]) if (!Number.isInteger(v) || v < 0) throw new BackendError('INVALID_FARE', 'Valores devem ser inteiros em centavos.');
        if (!Number.isInteger(f.commissionBps) || f.commissionBps < 0 || f.commissionBps > 10000) throw new BackendError('INVALID_FARE', 'Comissão inválida.');
        const version = Math.max(...db.fares.map((x) => x.version)) + 1;
        db.fares.forEach((x) => (x.active = false));
        db.fares.push({ ...f, version, active: true, createdAt: now() });
        this.audit(db, a.userId, 'fare_changed', 'fare_config', String(version), f);
        return version;
      });
    },
    getAllSettings: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return { ...db.settings };
    },
    setSetting: async (key: string, value: unknown) => {
      await this.tx(
        (db) => {
          const a = this.requireAdmin(db);
          if (!(key in db.settings)) throw new BackendError('UNKNOWN_SETTING', 'Configuração desconhecida.');
          db.settingsHistory.unshift({ id: uid(), key, oldValue: db.settings[key], newValue: value, changedBy: a.userId, changedAt: now() });
          this.audit(db, a.userId, 'setting_changed', 'app_setting', key, { old: db.settings[key], new: value });
          db.settings[key] = value;
        },
        { rideIds: ['*'], driverIds: [], userIds: [] },
      );
    },
    settingsHistory: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.settingsHistory;
    },
    auditLog: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.audit.slice(0, 200);
    },
    listPayments: async () => {
      const db = await this.load();
      this.requireAdmin(db);
      return db.payments.map(({ events: _e, payerId: _p, payeeId: _q, ...p }) => p).reverse();
    },
    setPaymentStatus: async (rideId: string, to: Payment['status']) => this.setPaymentStatus(rideId, to),
  };

  close() {
    this.channel?.close();
    this.listeners.clear();
  }

  /** Reinicia o banco demo (botão no painel/login demo). */
  async resetDemo() {
    this.kv.remove(DB_KEY);
    await this.load();
    this.broadcast({ rideIds: ['*'], driverIds: ['*'], userIds: ['*'] });
  }
}
