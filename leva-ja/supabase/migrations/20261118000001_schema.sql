-- =====================================================================
-- Leva Já — esquema base
-- Valores monetários em centavos (integer). Datas em timestamptz (UTC).
-- Escritas sensíveis acontecem SOMENTE via funções (RPC) security definer
-- que validam papel, estado e regras; o cliente recebe apenas SELECT
-- restrito por RLS (ver 20261118000003_rls.sql).
-- =====================================================================

-- ---------- Tipos ----------
create type public.app_role as enum ('passageiro', 'motorista', 'admin');
create type public.driver_status as enum ('pendente', 'aprovado', 'suspenso', 'revogado');
create type public.ride_status as enum (
  'rascunho', 'solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho',
  'motorista_chegou', 'em_andamento', 'finalizada', 'cancelada', 'expirada'
);
create type public.payment_status as enum ('aguardando', 'informado', 'confirmacao_manual', 'confirmado_manual', 'cancelado');
create type public.pix_key_type as enum ('cpf_cnpj', 'celular', 'email', 'aleatoria');
create type public.route_source as enum ('google_routes', 'simulada');

-- ---------- Configurações ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false, -- legível por qualquer usuário autenticado
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.settings_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

-- ---------- Usuários ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text check (phone is null or phone ~ '^\+55\d{10,11}$'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  location_consent_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.driver_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status public.driver_status not null default 'pendente',
  is_available boolean not null default false,
  available_since timestamptz,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint available_only_if_approved check (not is_available or status = 'aprovado')
);
create index driver_profiles_available_idx on public.driver_profiles (is_available) where is_available;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles (user_id) on delete cascade,
  make text not null check (char_length(make) between 1 and 40),
  model text not null check (char_length(model) between 1 and 40),
  color text not null check (char_length(color) between 1 and 30),
  year int check (year between 1980 and 2100),
  plate text not null check (plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index vehicles_plate_active_uq on public.vehicles (plate) where active;
create unique index vehicles_one_active_per_driver on public.vehicles (driver_id) where active;

create table public.pix_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  purpose text not null check (purpose in ('recebimento_motorista', 'passageiro_opcional')),
  key_type public.pix_key_type not null,
  key_value text not null check (char_length(key_value) between 3 and 77),
  holder_name text not null check (char_length(holder_name) between 2 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, purpose)
);

-- ---------- Convites ----------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique, -- sha256 hex; o token em claro nunca é armazenado
  role public.app_role not null check (role in ('passageiro', 'motorista')),
  note text check (char_length(note) <= 120),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses between 1 and 500),
  uses int not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  constraint uses_le_max check (uses <= max_uses)
);

create table public.invite_redemptions (
  id bigint generated always as identity primary key,
  invite_id uuid not null references public.invites (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_id, user_id)
);

create table public.rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (user_id, action, window_start)
);

-- ---------- Tarifas ----------
create table public.fare_configs (
  id bigint generated always as identity primary key,
  version int not null unique,
  base_cents int not null check (base_cents >= 0),
  per_km_cents int not null check (per_km_cents >= 0),
  per_minute_cents int not null check (per_minute_cents >= 0),
  minimum_cents int not null check (minimum_cents >= 0),
  commission_bps int not null check (commission_bps between 0 and 10000),
  pricing_mode text not null default 'fixa_na_solicitacao' check (pricing_mode in ('fixa_na_solicitacao', 'variavel')),
  manual_price_enabled boolean not null default false,
  active boolean not null default false,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index fare_configs_one_active on public.fare_configs (active) where active;

create table public.fare_snapshots (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id) on delete cascade,
  fare_config_id bigint not null references public.fare_configs (id),
  fare_version int not null,
  pricing_mode text not null,
  origin_lat double precision not null check (origin_lat between -90 and 90),
  origin_lng double precision not null check (origin_lng between -180 and 180),
  dest_lat double precision not null check (dest_lat between -90 and 90),
  dest_lng double precision not null check (dest_lng between -180 and 180),
  distance_m int not null check (distance_m >= 0),
  duration_s int not null check (duration_s >= 0),
  route_polyline text,
  route_source public.route_source not null,
  base_cents int not null,
  distance_cents int not null,
  time_cents int not null,
  subtotal_cents int not null,
  minimum_cents int not null,
  total_cents int not null check (total_cents >= 0),
  commission_bps int not null,
  commission_cents int not null,
  driver_net_cents int not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint split_sums check (commission_cents + driver_net_cents = total_cents)
);
create index fare_snapshots_passenger_idx on public.fare_snapshots (passenger_id, created_at desc);

-- ---------- Corridas ----------
create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles (id),
  driver_id uuid references public.profiles (id),
  vehicle_id uuid references public.vehicles (id),
  status public.ride_status not null default 'rascunho',
  fare_snapshot_id uuid not null unique references public.fare_snapshots (id),
  pickup_lat double precision not null check (pickup_lat between -90 and 90),
  pickup_lng double precision not null check (pickup_lng between -180 and 180),
  pickup_address text not null check (char_length(pickup_address) between 1 and 200),
  pickup_accuracy_m real,
  dest_lat double precision not null check (dest_lat between -90 and 90),
  dest_lng double precision not null check (dest_lng between -180 and 180),
  dest_address text not null check (char_length(dest_address) between 1 and 200),
  notes text check (char_length(notes) <= 200),
  total_cents int not null check (total_cents >= 0),
  commission_cents int not null,
  driver_net_cents int not null,
  manual_price boolean not null default false,
  is_simulation boolean not null default true,
  cancel_reason text check (char_length(cancel_reason) <= 200),
  cancelled_by public.app_role,
  search_expires_at timestamptz,
  requested_at timestamptz,
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ride_split check (commission_cents + driver_net_cents = total_cents),
  constraint driver_required check (status in ('rascunho', 'solicitada', 'procurando_motorista', 'cancelada', 'expirada') or driver_id is not null)
);
-- Impede duas corridas ativas para o mesmo motorista (garantia no banco, não só na UI)
create unique index ride_one_active_per_driver on public.ride_requests (driver_id)
  where status in ('aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento');
-- Um passageiro tem no máximo uma corrida ativa
create unique index ride_one_active_per_passenger on public.ride_requests (passenger_id)
  where status in ('solicitada', 'procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento');
create index ride_status_idx on public.ride_requests (status, search_expires_at);
create index ride_passenger_idx on public.ride_requests (passenger_id, created_at desc);
create index ride_driver_idx on public.ride_requests (driver_id, created_at desc);
-- Busca de corridas abertas por região (bounding box) — suficiente na escala do piloto.
create index ride_pickup_bbox_idx on public.ride_requests (pickup_lat, pickup_lng) where status = 'procurando_motorista';

create table public.ride_assignments (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.ride_requests (id) on delete cascade,
  driver_id uuid not null references public.profiles (id),
  outcome text not null check (outcome in ('aceita', 'recusada', 'desistiu')),
  created_at timestamptz not null default now()
);
create unique index ride_assignments_decline_uq on public.ride_assignments (ride_id, driver_id) where outcome = 'recusada';
create index ride_assignments_ride_idx on public.ride_assignments (ride_id);

create table public.ride_events (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.ride_requests (id) on delete cascade,
  from_status public.ride_status,
  to_status public.ride_status not null,
  actor_id uuid,
  actor_role text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index ride_events_ride_idx on public.ride_events (ride_id, id);

-- Apenas a ÚLTIMA posição de cada motorista (sem histórico contínuo de GPS).
create table public.driver_locations (
  driver_id uuid primary key references public.profiles (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real not null check (accuracy_m > 0),
  heading real,
  speed_ms real,
  recorded_at timestamptz not null, -- horário da leitura no aparelho
  received_at timestamptz not null default now() -- horário em que o servidor recebeu
);
create index driver_locations_bbox_idx on public.driver_locations (lat, lng);

-- ---------- Pagamentos (demonstrativo) ----------
create table public.payment_intents_demo (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null unique references public.ride_requests (id) on delete cascade,
  payer_id uuid not null references public.profiles (id),
  payee_driver_id uuid not null references public.profiles (id),
  amount_cents int not null check (amount_cents > 0),
  commission_cents int not null,
  driver_net_cents int not null,
  pix_key_type public.pix_key_type,
  pix_key_value text not null,
  holder_name text not null,
  brcode text not null,
  is_simulation boolean not null,
  status public.payment_status not null default 'aguardando',
  provider text not null default 'nenhum', -- futuro: PSP integrado
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_status_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payment_intents_demo (id) on delete cascade,
  from_status public.payment_status,
  to_status public.payment_status not null,
  actor_id uuid,
  actor_role text not null,
  note text,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

-- ---------- Avaliações, notificações, auditoria ----------
create table public.ratings (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.ride_requests (id) on delete cascade,
  rater_id uuid not null references public.profiles (id),
  ratee_id uuid not null references public.profiles (id),
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  unique (ride_id, rater_id)
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  ride_id uuid references public.ride_requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger driver_profiles_touch before update on public.driver_profiles for each row execute function public.touch_updated_at();
create trigger pix_keys_touch before update on public.pix_keys for each row execute function public.touch_updated_at();
create trigger ride_requests_touch before update on public.ride_requests for each row execute function public.touch_updated_at();
create trigger payment_touch before update on public.payment_intents_demo for each row execute function public.touch_updated_at();
