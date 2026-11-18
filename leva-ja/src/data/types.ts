import type { LatLng } from '../core/geo';
import type { PaymentStatus, PixKeyType } from '../core/pix';
import type { RideStatus } from '../core/ride';

export type Role = 'passageiro' | 'motorista' | 'admin';
export type AppKind = 'passageiro' | 'motorista' | 'admin';
export type DriverStatus = 'pendente' | 'aprovado' | 'suspenso' | 'revogado';
export type RouteSource = 'google_routes' | 'simulada';
export type PriceMode = 'automatico' | 'proprio';
export type PriceSource = 'automatico' | 'motorista';

export interface Session {
  userId: string;
  email: string;
  aal: 'aal1' | 'aal2';
}

export interface Access {
  userId: string;
  roles: Role[];
  driverStatus: DriverStatus | null;
  isAdmin: boolean;
  adminNeedsMfa: boolean;
}

export interface Profile {
  id: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  locationConsentAt: string | null;
}

export interface MapDefaults {
  center: LatLng;
  zoom: number;
  region: string;
  language: string;
}

export interface PublicSettings {
  pilot_mode: boolean;
  operations_enabled: boolean;
  passenger_invite_required: boolean;
  allow_simulated_routes: boolean;
  offer_timeout_seconds: number;
  offer_radius_km: number;
  pix_city: string;
  public_base_url: string | null;
  map_defaults: MapDefaults;
  service_area: { name: string; polygon: LatLng[] };
  support_contact: string | null;
  driver_custom_price_enabled: boolean;
  driver_price_per_km_min_cents: number;
  driver_price_per_km_max_cents: number;
  pin_max_attempts: number;
}

export interface Place extends LatLng {
  label: string;
  address: string;
  source: 'google' | 'simulado' | 'gps' | 'mapa';
  placeId?: string;
}

export interface Quote {
  id: string;
  fareVersion: number;
  pricingMode: 'fixa_na_solicitacao' | 'variavel';
  distanceM: number;
  durationS: number;
  polyline: string | null;
  routeSource: RouteSource;
  baseCents: number;
  distanceCents: number;
  timeCents: number;
  subtotalCents: number;
  minimumCents: number;
  totalCents: number;
  commissionBps: number;
  commissionCents: number;
  driverNetCents: number;
  expiresAt: string;
  origin: LatLng;
  dest: LatLng;
}

export interface Ride {
  id: string;
  passengerId: string;
  driverId: string | null;
  status: RideStatus;
  pickup: LatLng & { address: string };
  dest: LatLng & { address: string };
  notes: string | null;
  totalCents: number;
  commissionCents: number;
  driverNetCents: number;
  manualPrice: boolean;
  isSimulation: boolean;
  /** corrida pedida para um motorista específico (escolhido pelo preço) */
  targetDriverId: string | null;
  priceSource: PriceSource;
  /** o motorista desta corrida exige PIN para iniciar */
  pinRequired: boolean;
  pinVerifiedAt: string | null;
  cancelReason: string | null;
  cancelledBy: Role | null;
  searchExpiresAt: string | null;
  requestedAt: string | null;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  status: PaymentStatus;
  amountCents: number;
  brcode: string;
  isSimulation: boolean;
  holderName: string;
  commissionCents: number;
  driverNetCents: number;
}

export interface Vehicle {
  make: string;
  model: string;
  color: string;
  plate: string;
  year: number | null;
}

export interface RideDetails {
  ride: Ride;
  viewerRole: Role;
  /** PIN de embarque: SOMENTE para o passageiro, até a corrida começar */
  pin: string | null;
  fare: {
    perKmCents: number;
    version: number;
    pricingMode: string;
    distanceM: number;
    durationS: number;
    baseCents: number;
    distanceCents: number;
    timeCents: number;
    minimumCents: number;
    subtotalCents: number;
    commissionBps: number;
    routeSource: RouteSource;
    routePolyline: string | null;
  };
  driver: { id: string; name: string; avatarUrl: string | null; rating: number | null; vehicle: Vehicle | null } | null;
  passenger: { id: string; name: string; rating: number | null } | null;
  payment: Payment | null;
  myRating: number | null;
  events: { to: RideStatus; at: string; by: string; reason: string | null }[];
}

export interface Offer {
  rideId: string;
  pickupArea: LatLng;
  pickupHint: string;
  destHint: string;
  distanceToPickupM: number | null;
  routeDistanceM: number;
  routeDurationS: number;
  totalCents: number;
  driverNetCents: number;
  requestedAt: string;
  searchExpiresAt: string;
  routeSource: RouteSource;
  /** o passageiro escolheu este motorista pelo preço */
  targeted: boolean;
  priceSource: PriceSource;
  perKmCents: number;
}

/** Motorista disponível e o preço que ele cobraria por esta cotação */
export interface DriverPriceOption {
  driverId: string;
  name: string;
  rating: number | null;
  vehicle: string | null;
  distanceM: number;
  priceMode: PriceMode;
  perKmCents: number;
  totalCents: number;
  requiresPin: boolean;
}

export interface DriverPreferences {
  requirePin: boolean;
  priceMode: PriceMode;
  perKmCents: number | null;
}

export interface PinCheck {
  ok: boolean;
  locked: boolean;
  attemptsLeft: number;
}

export interface DriverLocation extends LatLng {
  driverId: string;
  accuracyM: number;
  heading: number | null;
  speedMs: number | null;
  recordedAt: string;
  receivedAt: string;
}

export interface PixKeyInfo {
  type: PixKeyType;
  value: string;
  holder: string;
}

export interface DriverSetup {
  status: DriverStatus;
  isAvailable: boolean;
  vehicle: Vehicle | null;
  pixKey: PixKeyInfo | null;
  preferences: DriverPreferences;
}

export interface Earnings {
  rides: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  confirmedNetCents: number;
  pendingNetCents: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  rideId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface FareConfigRow {
  version: number;
  baseCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumCents: number;
  commissionBps: number;
  pricingMode: 'fixa_na_solicitacao' | 'variavel';
  manualPriceEnabled: boolean;
  active: boolean;
  note: string | null;
  createdAt: string;
}

export interface DashboardStats {
  users: number;
  passengers: number;
  drivers_pending: number;
  drivers_approved: number;
  drivers_available: number;
  rides_active: number;
  rides_today: number;
  rides_finished_30d: number;
  gross_30d_cents: number;
  commission_30d_cents: number;
  payments_pending: number;
}

export interface AdminUser {
  id: string;
  fullName: string;
  phone: string | null;
  roles: Role[];
  driverStatus: DriverStatus | null;
  vehicle: Vehicle | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface Invite {
  id: string;
  role: 'passageiro' | 'motorista';
  note: string | null;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
}

export interface CreatedInvite extends Invite {
  token: string; // exibido UMA vez
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  createdAt: string;
}

export interface SettingChange {
  id: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string | null;
  changedAt: string;
}

export interface LiveRide {
  ride: Ride;
  driverLocation: DriverLocation | null;
}

export type Unsubscribe = () => void;

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
}

/**
 * Contrato único entre as interfaces e o servidor. Implementações:
 *  - SupabaseBackend: produção/piloto real (Postgres + RLS + RPC + Realtime)
 *  - DemoBackend: MODO DEMO LOCAL, claramente identificado na UI, para testes sem credenciais
 */
export interface Backend {
  readonly mode: 'supabase' | 'demo';

  // Autenticação
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (s: Session | null) => void): Unsubscribe;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }>;
  signOut(): Promise<void>;
  mfa: {
    status(): Promise<{ enrolled: boolean; aal: 'aal1' | 'aal2' }>;
    enroll(): Promise<{ factorId: string; qrSvg: string; secret: string }>;
    verify(factorId: string | null, code: string): Promise<void>;
  };

  // Perfil e acesso
  getAccess(): Promise<Access>;
  getProfile(): Promise<Profile>;
  updateProfile(p: { fullName: string; phone: string | null }): Promise<void>;
  setLocationConsent(granted: boolean): Promise<void>;
  redeemInvite(token: string): Promise<{ role: Role; already: boolean }>;
  selfEnrollPassenger(): Promise<void>;
  deleteMyAccount(): Promise<void>;
  getPublicSettings(): Promise<PublicSettings>;
  getActiveFare(): Promise<FareConfigRow>;

  // Passageiro
  quoteRide(origin: LatLng, dest: LatLng): Promise<Quote>;
  /** motoristas disponíveis perto do embarque, com o preço de cada um para esta cotação */
  listDriverPrices(quoteId: string, pickup: LatLng): Promise<DriverPriceOption[]>;
  requestRide(input: {
    quoteId: string;
    pickup: LatLng & { address: string; accuracyM: number | null };
    destAddress: string;
    notes?: string;
    /** pedir direto a um motorista escolhido (preço dele); sem isso, tarifa automática para todos */
    driverId?: string;
    /** total que o passageiro viu; se o preço mudou, o servidor recusa com PRICE_CHANGED */
    expectedTotalCents?: number;
  }): Promise<string>;
  getActiveRideId(): Promise<string | null>;
  getRideDetails(id: string): Promise<RideDetails>;
  listMyRides(): Promise<Ride[]>;
  cancelRide(id: string, reason: string): Promise<void>;
  rateRide(id: string, stars: number, comment?: string): Promise<void>;
  setPaymentStatus(rideId: string, to: Payment['status'], idempotencyKey?: string): Promise<void>;
  savePassengerPixKey(key: PixKeyInfo | null): Promise<void>;
  getMyPixKey(purpose: 'recebimento_motorista' | 'passageiro_opcional'): Promise<PixKeyInfo | null>;

  // Motorista
  getDriverSetup(): Promise<DriverSetup>;
  saveVehicle(v: Vehicle): Promise<void>;
  saveDriverPixKey(k: PixKeyInfo): Promise<void>;
  saveDriverPreferences(p: DriverPreferences): Promise<void>;
  verifyRidePin(rideId: string, pin: string): Promise<PinCheck>;
  setAvailability(available: boolean): Promise<void>;
  pushLocation(fix: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; timestamp: number }): Promise<{ accepted: boolean; reason?: string }>;
  listOpenRides(): Promise<Offer[]>;
  acceptRide(id: string): Promise<{ accepted: boolean; reason?: string }>;
  declineRide(id: string): Promise<void>;
  advanceRide(id: string, to: 'motorista_a_caminho' | 'motorista_chegou' | 'em_andamento' | 'finalizada'): Promise<void>;
  getDriverActiveRideId(): Promise<string | null>;
  listDriverRides(): Promise<Ride[]>;
  getEarnings(days: number): Promise<Earnings>;

  // Tempo real
  subscribeRide(id: string, cb: () => void): Unsubscribe;
  subscribeDriverLocation(driverId: string, cb: (loc: DriverLocation | null) => void): Unsubscribe;
  subscribeNotifications(cb: (n: AppNotification) => void): Unsubscribe;
  onConnectionChange(cb: (online: boolean) => void): Unsubscribe;
  listNotifications(): Promise<AppNotification[]>;
  markNotificationRead(id: string): Promise<void>;

  // Admin
  admin: {
    dashboard(): Promise<DashboardStats>;
    listUsers(): Promise<AdminUser[]>;
    setDriverStatus(userId: string, status: DriverStatus, note?: string): Promise<void>;
    listInvites(): Promise<Invite[]>;
    createInvite(role: 'passageiro' | 'motorista', validHours: number, maxUses: number, note?: string): Promise<CreatedInvite>;
    revokeInvite(id: string): Promise<void>;
    listRides(limit?: number): Promise<Ride[]>;
    liveRides(): Promise<LiveRide[]>;
    cancelRide(id: string, reason: string): Promise<void>;
    setManualPrice(rideId: string, totalCents: number, reason: string): Promise<void>;
    fareHistory(): Promise<FareConfigRow[]>;
    setFare(f: Omit<FareConfigRow, 'version' | 'active' | 'createdAt'>): Promise<number>;
    getAllSettings(): Promise<Record<string, unknown>>;
    setSetting(key: string, value: unknown): Promise<void>;
    settingsHistory(): Promise<SettingChange[]>;
    auditLog(): Promise<AuditEntry[]>;
    listPayments(): Promise<(Payment & { rideId: string; createdAt: string })[]>;
    setPaymentStatus(rideId: string, to: Payment['status']): Promise<void>;
  };
}

export class BackendError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
