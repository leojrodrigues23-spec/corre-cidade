-- =====================================================================
-- Leva Já — regras de negócio no servidor (RPC)
-- Todas as funções expostas são SECURITY DEFINER com search_path fixo,
-- verificam auth.uid() e papel no banco (nunca confiam no navegador).
-- =====================================================================

-- ---------- Utilidades de autorização ----------
create or replace function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

create or replace function public.has_role(p_role public.app_role, p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.roles r join public.profiles p on p.id = r.user_id
    where r.user_id = p_user and r.role = p_role and p.deleted_at is null
  )
$$;

-- Admin exige papel + (MFA aal2 quando configurado). Autenticação forte de verdade, no servidor.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('admin')
     and (coalesce((public.setting('admin_require_mfa'))::boolean, true) = false
          or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
$$;

create or replace function public.is_approved_driver(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('motorista', p_user)
     and exists (select 1 from public.driver_profiles d where d.user_id = p_user and d.status = 'aprovado')
$$;

create or replace function public.require_user() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_data jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (actor_id, action, entity, entity_id, data) values (auth.uid(), p_action, p_entity, p_entity_id, p_data);
$$;

-- Limite de requisições por usuário/ação em janelas fixas.
create or replace function public.check_rate_limit(p_action text, p_max int, p_window_s int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  v_hits int;
begin
  insert into public.rate_limits (user_id, action, window_start, hits) values (v_uid, p_action, v_window, 1)
  on conflict (user_id, action, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then raise exception 'RATE_LIMITED' using errcode = 'P0001', hint = p_action; end if;
end $$;

-- ---------- Geo ----------
create or replace function public.haversine_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))
$$;

-- Ponto em polígono (ray casting). Polígono: jsonb [{"lat":..,"lng":..}, ...]
create or replace function public.point_in_polygon(p_lat double precision, p_lng double precision, p_poly jsonb)
returns boolean language plpgsql immutable as $$
declare
  n int := jsonb_array_length(p_poly);
  i int; j int; inside boolean := false;
  ai_lat double precision; ai_lng double precision; aj_lat double precision; aj_lng double precision;
begin
  if n < 3 then return true; end if; -- sem área configurada = sem restrição
  j := n - 1;
  for i in 0..n - 1 loop
    ai_lat := (p_poly -> i ->> 'lat')::double precision; ai_lng := (p_poly -> i ->> 'lng')::double precision;
    aj_lat := (p_poly -> j ->> 'lat')::double precision; aj_lng := (p_poly -> j ->> 'lng')::double precision;
    if ((ai_lat > p_lat) <> (aj_lat > p_lat))
       and (p_lng < (aj_lng - ai_lng) * (p_lat - ai_lat) / (aj_lat - ai_lat) + ai_lng) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end $$;

create or replace function public.in_service_area(p_lat double precision, p_lng double precision) returns boolean
language sql stable security definer set search_path = public as $$
  select public.point_in_polygon(p_lat, p_lng, coalesce(public.setting('service_area') -> 'polygon', '[]'::jsonb))
$$;

-- ---------- Tarifa (espelho exato de src/core/fare.ts) ----------
create or replace function public.round_half_up(v numeric) returns int language sql immutable as $$
  select floor(v + 0.5)::int
$$;

create or replace function public.calc_fare(
  p_base int, p_per_km int, p_per_min int, p_minimum int, p_commission_bps int,
  p_distance_m int, p_duration_s int,
  out distance_cents int, out time_cents int, out subtotal_cents int, out total_cents int,
  out commission_cents int, out driver_net_cents int)
language plpgsql immutable as $$
begin
  if p_distance_m < 0 or p_duration_s < 0 then raise exception 'INVALID_ROUTE'; end if;
  distance_cents := public.round_half_up(p_distance_m::numeric * p_per_km / 1000);
  time_cents := public.round_half_up(p_duration_s::numeric * p_per_min / 60);
  subtotal_cents := p_base + distance_cents + time_cents;
  total_cents := greatest(p_minimum, subtotal_cents);
  commission_cents := public.round_half_up(total_cents::numeric * p_commission_bps / 10000);
  driver_net_cents := total_cents - commission_cents;
end $$;

-- ---------- Pix BR Code (espelho de src/core/pix.ts) ----------
create or replace function public.crc16_ccitt(p text) returns text language plpgsql immutable as $$
declare
  crc int := 65535;
  b bytea := convert_to(p, 'UTF8');
  i int; j int;
begin
  for i in 0..length(b) - 1 loop
    crc := crc # (get_byte(b, i) << 8);
    for j in 1..8 loop
      if (crc & 32768) <> 0 then crc := ((crc << 1) # 4129) & 65535;
      else crc := (crc << 1) & 65535; end if;
    end loop;
  end loop;
  return upper(lpad(to_hex(crc), 4, '0'));
end $$;

create or replace function public.pix_sanitize(p text, p_max int) returns text language sql immutable as $$
  select left(upper(trim(regexp_replace(regexp_replace(
    translate(coalesce(p, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Za-z0-9 .\-]', '', 'g'), '\s+', ' ', 'g'))), p_max)
$$;

create or replace function public.pix_tlv(p_id text, p_value text) returns text language plpgsql immutable as $$
begin
  if octet_length(p_value) > 99 then raise exception 'PIX_FIELD_TOO_LONG %', p_id; end if;
  return p_id || lpad(octet_length(p_value)::text, 2, '0') || p_value;
end $$;

create or replace function public.build_static_brcode(p_key text, p_amount_cents int, p_name text, p_city text, p_txid text default '***')
returns text language plpgsql immutable as $$
declare
  v_name text := coalesce(nullif(public.pix_sanitize(p_name, 25), ''), 'RECEBEDOR');
  v_city text := coalesce(nullif(public.pix_sanitize(p_city, 15), ''), 'ITUPEVA');
  v_amount text;
  v_payload text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'PIX_INVALID_AMOUNT'; end if;
  v_amount := (p_amount_cents / 100)::text || '.' || lpad((p_amount_cents % 100)::text, 2, '0');
  v_payload := public.pix_tlv('00', '01')
    || public.pix_tlv('26', public.pix_tlv('00', 'br.gov.bcb.pix') || public.pix_tlv('01', p_key))
    || public.pix_tlv('52', '0000') || public.pix_tlv('53', '986') || public.pix_tlv('54', v_amount)
    || public.pix_tlv('58', 'BR') || public.pix_tlv('59', v_name) || public.pix_tlv('60', v_city)
    || public.pix_tlv('62', public.pix_tlv('05', coalesce(nullif(p_txid, ''), '***')))
    || '6304';
  return v_payload || public.crc16_ccitt(v_payload);
end $$;

-- ---------- Novo usuário → perfil ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
          case when (new.raw_user_meta_data ->> 'phone') ~ '^\+55\d{10,11}$' then new.raw_user_meta_data ->> 'phone' end)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Perfil ----------
create or replace function public.update_my_profile(p_full_name text, p_phone text, p_avatar_url text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if char_length(trim(p_full_name)) < 2 then raise exception 'INVALID_NAME'; end if;
  if p_phone is not null and p_phone !~ '^\+55\d{10,11}$' then raise exception 'INVALID_PHONE'; end if;
  update public.profiles set full_name = trim(p_full_name), phone = p_phone, avatar_url = p_avatar_url where id = v_uid;
end $$;

create or replace function public.set_location_consent(p_granted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  update public.profiles set location_consent_at = case when p_granted then now() end where id = v_uid;
  if not p_granted then
    -- revogar consentimento: apaga a última posição e tira o motorista de disponibilidade
    delete from public.driver_locations where driver_id = v_uid;
    update public.driver_profiles set is_available = false, available_since = null where user_id = v_uid;
  end if;
  perform public.audit('location_consent', 'profile', v_uid::text, jsonb_build_object('granted', p_granted));
end $$;

-- Retorna papéis e estado do motorista do usuário atual (a UI usa para rotear, o servidor revalida sempre)
create or replace function public.get_my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'roles', coalesce((select jsonb_agg(role) from public.roles where user_id = auth.uid()), '[]'::jsonb),
    'driver_status', (select status from public.driver_profiles where user_id = auth.uid()),
    'is_admin', public.is_admin(),
    'admin_needs_mfa', public.has_role('admin') and not public.is_admin()
  )
$$;

-- ---------- Convites ----------
create or replace function public.create_invite(p_role public.app_role, p_valid_hours int, p_max_uses int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
  v_exp timestamptz;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_role not in ('passageiro', 'motorista') then raise exception 'INVALID_ROLE'; end if;
  if p_valid_hours < 1 or p_valid_hours > 24 * 90 then raise exception 'INVALID_VALIDITY'; end if;
  v_exp := now() + make_interval(hours => p_valid_hours);
  insert into public.invites (token_hash, role, note, created_by, expires_at, max_uses)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_role, p_note, auth.uid(), v_exp, p_max_uses)
  returning id into v_id;
  perform public.audit('invite_created', 'invite', v_id::text, jsonb_build_object('role', p_role, 'max_uses', p_max_uses, 'expires_at', v_exp));
  -- token em claro retornado UMA vez; o banco guarda só o hash
  return jsonb_build_object('id', v_id, 'token', v_token, 'role', p_role, 'expires_at', v_exp, 'max_uses', p_max_uses);
end $$;

create or replace function public.revoke_invite(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.invites set revoked_at = now() where id = p_id and revoked_at is null;
  perform public.audit('invite_revoked', 'invite', p_id::text);
end $$;

create or replace function public.redeem_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_inv public.invites%rowtype;
begin
  perform public.check_rate_limit('redeem_invite', 10, 3600);
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 128 then raise exception 'INVITE_INVALID'; end if;
  select * into v_inv from public.invites where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found then raise exception 'INVITE_INVALID'; end if;
  if v_inv.revoked_at is not null then raise exception 'INVITE_REVOKED'; end if;
  if v_inv.expires_at < now() then raise exception 'INVITE_EXPIRED'; end if;
  if exists (select 1 from public.invite_redemptions where invite_id = v_inv.id and user_id = v_uid) then
    return jsonb_build_object('role', v_inv.role, 'already', true);
  end if;
  if v_inv.uses >= v_inv.max_uses then raise exception 'INVITE_EXHAUSTED'; end if;

  update public.invites set uses = uses + 1 where id = v_inv.id;
  insert into public.invite_redemptions (invite_id, user_id) values (v_inv.id, v_uid);
  insert into public.roles (user_id, role, granted_by) values (v_uid, v_inv.role, v_inv.created_by) on conflict do nothing;
  if v_inv.role = 'motorista' then
    -- motorista só fica disponível após aprovação do administrador
    insert into public.driver_profiles (user_id, status) values (v_uid, 'pendente') on conflict do nothing;
  end if;
  perform public.audit('invite_redeemed', 'invite', v_inv.id::text, jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('role', v_inv.role, 'already', false);
end $$;

-- Passageiro sem convite quando o piloto permite cadastro aberto de passageiros
create or replace function public.self_enroll_passenger() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if coalesce((public.setting('passenger_invite_required'))::boolean, true) then raise exception 'INVITE_REQUIRED'; end if;
  insert into public.roles (user_id, role) values (v_uid, 'passageiro') on conflict do nothing;
end $$;

-- ---------- Motorista: cadastro ----------
create or replace function public.save_driver_vehicle(p_make text, p_model text, p_color text, p_year int, p_plate text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if not public.has_role('motorista') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if exists (select 1 from public.ride_requests where driver_id = v_uid and status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then
    raise exception 'RIDE_IN_PROGRESS';
  end if;
  update public.vehicles set active = false where driver_id = v_uid and active;
  insert into public.vehicles (driver_id, make, model, color, year, plate)
  values (v_uid, trim(p_make), trim(p_model), trim(p_color), p_year, upper(regexp_replace(p_plate, '[^A-Za-z0-9]', '', 'g')));
  perform public.audit('vehicle_saved', 'vehicle', v_uid::text, jsonb_build_object('plate', upper(p_plate)));
end $$;

create or replace function public.save_pix_key(p_purpose text, p_type public.pix_key_type, p_value text, p_holder text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if p_purpose = 'recebimento_motorista' and not public.has_role('motorista') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_purpose not in ('recebimento_motorista', 'passageiro_opcional') then raise exception 'INVALID_PURPOSE'; end if;
  -- validação de formato (a validação completa de dígitos ocorre também no cliente, src/core/pix.ts)
  if (p_type = 'cpf_cnpj' and p_value !~ '^(\d{11}|\d{14})$')
     or (p_type = 'celular' and p_value !~ '^\+55\d{2}9\d{8}$')
     or (p_type = 'email' and p_value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
     or (p_type = 'aleatoria' and p_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'INVALID_PIX_KEY';
  end if;
  insert into public.pix_keys (owner_id, purpose, key_type, key_value, holder_name)
  values (v_uid, p_purpose, p_type, p_value, trim(p_holder))
  on conflict (owner_id, purpose) do update set key_type = excluded.key_type, key_value = excluded.key_value, holder_name = excluded.holder_name;
  perform public.audit('pix_key_saved', 'pix_key', v_uid::text, jsonb_build_object('purpose', p_purpose, 'type', p_type));
end $$;

create or replace function public.delete_pix_key(p_purpose text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.pix_keys where owner_id = public.require_user() and purpose = p_purpose;
end $$;

create or replace function public.set_driver_availability(p_available boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if p_available then
    if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
    if not exists (select 1 from public.vehicles where driver_id = v_uid and active) then raise exception 'VEHICLE_REQUIRED'; end if;
    if not exists (select 1 from public.pix_keys where owner_id = v_uid and purpose = 'recebimento_motorista') then raise exception 'PIX_KEY_REQUIRED'; end if;
    if (select location_consent_at from public.profiles where id = v_uid) is null then raise exception 'LOCATION_CONSENT_REQUIRED'; end if;
  end if;
  update public.driver_profiles
     set is_available = p_available, available_since = case when p_available then now() end
   where user_id = v_uid;
  if not p_available then
    -- sem disponibilidade e sem corrida ativa, a posição deixa de existir no servidor
    delete from public.driver_locations dl where dl.driver_id = v_uid
      and not exists (select 1 from public.ride_requests r where r.driver_id = v_uid and r.status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento'));
  end if;
end $$;

-- Localização do motorista: só enquanto disponível ou em corrida; valida idade e plausibilidade.
create or replace function public.push_driver_location(p_lat double precision, p_lng double precision, p_accuracy real,
  p_heading real, p_speed real, p_recorded_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_prev public.driver_locations%rowtype;
  v_dt double precision;
  v_dist double precision;
  v_max_speed double precision := 55; -- m/s (~200 km/h)
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  if not exists (select 1 from public.driver_profiles where user_id = v_uid and is_available)
     and not exists (select 1 from public.ride_requests where driver_id = v_uid and status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then
    raise exception 'NOT_TRACKABLE';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 or (p_lat = 0 and p_lng = 0) then raise exception 'INVALID_COORDS'; end if;
  if p_accuracy is null or p_accuracy <= 0 or p_accuracy > 1000 then raise exception 'INVALID_ACCURACY'; end if;
  if p_recorded_at > now() + interval '30 seconds' then raise exception 'FUTURE_TIMESTAMP'; end if;
  if p_recorded_at < now() - interval '2 minutes' then return jsonb_build_object('accepted', false, 'reason', 'stale'); end if;

  select * into v_prev from public.driver_locations where driver_id = v_uid;
  if found then
    if v_prev.received_at > now() - interval '2 seconds' then return jsonb_build_object('accepted', false, 'reason', 'throttled'); end if;
    if p_recorded_at <= v_prev.recorded_at then return jsonb_build_object('accepted', false, 'reason', 'out_of_order'); end if;
    v_dt := extract(epoch from (p_recorded_at - v_prev.recorded_at));
    v_dist := greatest(0, public.haversine_m(v_prev.lat, v_prev.lng, p_lat, p_lng) - v_prev.accuracy_m - p_accuracy);
    if v_dt > 0 and v_dist / v_dt > v_max_speed then return jsonb_build_object('accepted', false, 'reason', 'implausible_jump'); end if;
  end if;

  insert into public.driver_locations (driver_id, lat, lng, accuracy_m, heading, speed_ms, recorded_at, received_at)
  values (v_uid, p_lat, p_lng, p_accuracy, p_heading, p_speed, p_recorded_at, now())
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m,
    heading = excluded.heading, speed_ms = excluded.speed_ms, recorded_at = excluded.recorded_at, received_at = now();
  return jsonb_build_object('accepted', true);
end $$;

-- ---------- Cotação e solicitação ----------
-- Grava a cotação calculada NO SERVIDOR. Chamada pela Edge Function route-quote (service_role)
-- com distância/duração da Routes API, ou por quote_ride_simulated quando permitido.
create or replace function public.create_fare_snapshot(p_passenger uuid, p_origin_lat double precision, p_origin_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision, p_distance_m int, p_duration_s int, p_polyline text, p_source public.route_source)
returns public.fare_snapshots language plpgsql security definer set search_path = public as $$
declare
  c public.fare_configs%rowtype;
  f record;
  s public.fare_snapshots%rowtype;
begin
  select * into c from public.fare_configs where active;
  if not found then raise exception 'NO_ACTIVE_FARE'; end if;
  select * into f from public.calc_fare(c.base_cents, c.per_km_cents, c.per_minute_cents, c.minimum_cents, c.commission_bps, p_distance_m, p_duration_s);
  insert into public.fare_snapshots (passenger_id, fare_config_id, fare_version, pricing_mode, origin_lat, origin_lng, dest_lat, dest_lng,
    distance_m, duration_s, route_polyline, route_source, base_cents, distance_cents, time_cents, subtotal_cents, minimum_cents,
    total_cents, commission_bps, commission_cents, driver_net_cents, expires_at)
  values (p_passenger, c.id, c.version, c.pricing_mode, p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng,
    p_distance_m, p_duration_s, p_polyline, p_source, c.base_cents, f.distance_cents, f.time_cents, f.subtotal_cents, c.minimum_cents,
    f.total_cents, c.commission_bps, f.commission_cents, f.driver_net_cents, now() + interval '10 minutes')
  returning * into s;
  return s;
end $$;

-- Cotação SIMULADA (sem Google Routes): distância em linha reta × 1,35 e 25 km/h.
-- Só funciona se o admin habilitar 'allow_simulated_routes'; a corrida fica marcada como rota simulada.
create or replace function public.quote_ride_simulated(p_origin_lat double precision, p_origin_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision)
returns public.fare_snapshots language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_d int;
begin
  if not public.has_role('passageiro') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not coalesce((public.setting('allow_simulated_routes'))::boolean, false) then raise exception 'SIMULATED_ROUTES_DISABLED'; end if;
  perform public.check_rate_limit('quote', 60, 3600);
  v_d := round(public.haversine_m(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng) * 1.35);
  return public.create_fare_snapshot(v_uid, p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, v_d, round(v_d / (25000.0 / 3600))::int, null, 'simulada');
end $$;

create or replace function public.record_ride_event(p_ride uuid, p_from public.ride_status, p_to public.ride_status, p_role text, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.ride_events (ride_id, from_status, to_status, actor_id, actor_role, reason) values (p_ride, p_from, p_to, auth.uid(), p_role, p_reason);
$$;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_ride uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, ride_id) values (p_user, p_kind, p_title, p_body, p_ride);
$$;

-- Fonte da verdade das transições (espelhada em src/core/ride.ts)
create or replace function public.ride_transition_allowed(p_from public.ride_status, p_to public.ride_status, p_actor text)
returns boolean language sql immutable as $$
  select case
    when p_from = 'rascunho' and p_to = 'solicitada' then p_actor = 'passageiro'
    when p_from = 'rascunho' and p_to = 'cancelada' then p_actor = 'passageiro'
    when p_from = 'solicitada' and p_to = 'procurando_motorista' then p_actor = 'sistema'
    when p_from = 'solicitada' and p_to = 'cancelada' then p_actor in ('passageiro', 'admin')
    when p_from = 'solicitada' and p_to = 'expirada' then p_actor = 'sistema'
    when p_from = 'procurando_motorista' and p_to = 'aceita' then p_actor = 'motorista'
    when p_from = 'procurando_motorista' and p_to = 'cancelada' then p_actor in ('passageiro', 'admin')
    when p_from = 'procurando_motorista' and p_to = 'expirada' then p_actor = 'sistema'
    when p_from = 'aceita' and p_to = 'motorista_a_caminho' then p_actor = 'motorista'
    when p_from = 'aceita' and p_to = 'procurando_motorista' then p_actor in ('motorista', 'sistema')
    when p_from = 'aceita' and p_to = 'cancelada' then p_actor in ('passageiro', 'admin')
    when p_from = 'motorista_a_caminho' and p_to = 'motorista_chegou' then p_actor = 'motorista'
    when p_from = 'motorista_a_caminho' and p_to = 'procurando_motorista' then p_actor = 'motorista'
    when p_from = 'motorista_a_caminho' and p_to = 'cancelada' then p_actor in ('passageiro', 'admin')
    when p_from = 'motorista_chegou' and p_to = 'em_andamento' then p_actor = 'motorista'
    when p_from = 'motorista_chegou' and p_to = 'cancelada' then p_actor in ('passageiro', 'motorista', 'admin')
    when p_from = 'em_andamento' and p_to = 'finalizada' then p_actor in ('motorista', 'admin')
    when p_from = 'em_andamento' and p_to = 'cancelada' then p_actor = 'admin'
    else false
  end
$$;

create or replace function public.request_ride(p_snapshot uuid, p_pickup_lat double precision, p_pickup_lng double precision,
  p_pickup_address text, p_pickup_accuracy real, p_dest_address text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  s public.fare_snapshots%rowtype;
  v_ride uuid;
  v_timeout int := coalesce((public.setting('offer_timeout_seconds'))::int, 180);
  v_radius_km double precision := coalesce((public.setting('offer_radius_km'))::double precision, 15);
  v_pilot boolean := coalesce((public.setting('pilot_mode'))::boolean, true);
  d record;
begin
  if not public.has_role('passageiro') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not coalesce((public.setting('operations_enabled'))::boolean, true) then raise exception 'OPERATIONS_PAUSED'; end if;
  perform public.check_rate_limit('request_ride', 10, 3600);
  select * into s from public.fare_snapshots where id = p_snapshot and passenger_id = v_uid for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if s.used_at is not null then raise exception 'QUOTE_ALREADY_USED'; end if;
  if s.expires_at < now() then raise exception 'QUOTE_EXPIRED'; end if;
  -- o ponto de embarque confirmado não pode divergir muito da origem cotada (senão o preço muda)
  if public.haversine_m(s.origin_lat, s.origin_lng, p_pickup_lat, p_pickup_lng) > 300 then raise exception 'PICKUP_TOO_FAR_FROM_QUOTE'; end if;
  if not public.in_service_area(p_pickup_lat, p_pickup_lng) then raise exception 'PICKUP_OUTSIDE_SERVICE_AREA'; end if;
  if not public.in_service_area(s.dest_lat, s.dest_lng) then raise exception 'DEST_OUTSIDE_SERVICE_AREA'; end if;
  if exists (select 1 from public.ride_requests where passenger_id = v_uid
             and status in ('solicitada','procurando_motorista','aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then
    raise exception 'PASSENGER_HAS_ACTIVE_RIDE';
  end if;

  update public.fare_snapshots set used_at = now() where id = s.id;
  insert into public.ride_requests (passenger_id, status, fare_snapshot_id, pickup_lat, pickup_lng, pickup_address, pickup_accuracy_m,
    dest_lat, dest_lng, dest_address, notes, total_cents, commission_cents, driver_net_cents, is_simulation, requested_at, search_expires_at)
  values (v_uid, 'solicitada', s.id, p_pickup_lat, p_pickup_lng, left(p_pickup_address, 200), p_pickup_accuracy,
    s.dest_lat, s.dest_lng, left(p_dest_address, 200), left(p_notes, 200), s.total_cents, s.commission_cents, s.driver_net_cents, v_pilot,
    now(), now() + make_interval(secs => v_timeout))
  returning id into v_ride;
  perform public.record_ride_event(v_ride, null, 'solicitada', 'passageiro');
  update public.ride_requests set status = 'procurando_motorista' where id = v_ride;
  perform public.record_ride_event(v_ride, 'solicitada', 'procurando_motorista', 'sistema');

  -- oferta para motoristas aprovados, disponíveis, sem corrida ativa e com sinal recente no raio
  for d in
    select dp.user_id from public.driver_profiles dp
    join public.driver_locations dl on dl.driver_id = dp.user_id
    where dp.is_available and dp.status = 'aprovado' and dp.user_id <> v_uid
      and dl.received_at > now() - interval '5 minutes'
      and public.haversine_m(dl.lat, dl.lng, p_pickup_lat, p_pickup_lng) <= v_radius_km * 1000
      and not exists (select 1 from public.ride_requests r where r.driver_id = dp.user_id
                      and r.status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento'))
  loop
    perform public.notify(d.user_id, 'ride_offer', 'Nova solicitação de corrida', null, v_ride);
  end loop;
  return v_ride;
end $$;

-- Expira buscas vencidas. Agendar com pg_cron a cada minuto; também é chamada de forma preguiçosa.
create or replace function public.expire_stale_rides() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id, passenger_id from public.ride_requests
           where status in ('solicitada', 'procurando_motorista') and search_expires_at < now() for update skip locked
  loop
    update public.ride_requests set status = 'expirada' where id = r.id;
    insert into public.ride_events (ride_id, from_status, to_status, actor_role, reason) values (r.id, 'procurando_motorista', 'expirada', 'sistema', 'timeout');
    perform public.notify(r.passenger_id, 'ride_expired', 'Nenhum motorista aceitou a tempo', 'Você pode solicitar novamente.', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Ofertas visíveis ao motorista: só região aproximada antes do aceite (privacidade)
create or replace function public.list_open_rides() returns table (
  ride_id uuid, pickup_area_lat double precision, pickup_area_lng double precision, pickup_hint text, dest_hint text,
  distance_to_pickup_m int, route_distance_m int, route_duration_s int, total_cents int, driver_net_cents int,
  requested_at timestamptz, search_expires_at timestamptz, route_source public.route_source)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_loc public.driver_locations%rowtype;
  v_radius_km double precision := coalesce((public.setting('offer_radius_km'))::double precision, 15);
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  perform public.expire_stale_rides();
  if not exists (select 1 from public.driver_profiles where user_id = v_uid and is_available) then return; end if;
  if exists (select 1 from public.ride_requests where driver_id = v_uid and status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then return; end if;
  select * into v_loc from public.driver_locations where driver_id = v_uid;
  return query
    select r.id, round(r.pickup_lat::numeric, 3)::double precision, round(r.pickup_lng::numeric, 3)::double precision,
           split_part(r.pickup_address, ',', 2), split_part(r.dest_address, ',', 2),
           case when v_loc.driver_id is null then null else round(public.haversine_m(v_loc.lat, v_loc.lng, r.pickup_lat, r.pickup_lng))::int end,
           s.distance_m, s.duration_s, r.total_cents, r.driver_net_cents, r.requested_at, r.search_expires_at, s.route_source
    from public.ride_requests r join public.fare_snapshots s on s.id = r.fare_snapshot_id
    where r.status = 'procurando_motorista' and r.passenger_id <> v_uid
      and not exists (select 1 from public.ride_assignments a where a.ride_id = r.id and a.driver_id = v_uid and a.outcome in ('recusada', 'desistiu'))
      and (v_loc.driver_id is null or public.haversine_m(v_loc.lat, v_loc.lng, r.pickup_lat, r.pickup_lng) <= v_radius_km * 1000)
    order by r.requested_at;
end $$;

-- ACEITE ATÔMICO: UPDATE condicional ao status + índice único por motorista ativo.
-- Dois motoristas concorrentes: apenas um UPDATE encontra status='procurando_motorista'.
create or replace function public.accept_ride(p_ride uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_vehicle uuid;
  v_passenger uuid;
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  if not exists (select 1 from public.driver_profiles where user_id = v_uid and is_available) then raise exception 'DRIVER_NOT_AVAILABLE'; end if;
  select id into v_vehicle from public.vehicles where driver_id = v_uid and active;
  if v_vehicle is null then raise exception 'VEHICLE_REQUIRED'; end if;
  perform public.expire_stale_rides();
  begin
    update public.ride_requests
       set status = 'aceita', driver_id = v_uid, vehicle_id = v_vehicle, accepted_at = now()
     where id = p_ride and status = 'procurando_motorista' and passenger_id <> v_uid
     returning passenger_id into v_passenger;
  exception when unique_violation then
    raise exception 'DRIVER_HAS_ACTIVE_RIDE';
  end;
  if v_passenger is null then
    return jsonb_build_object('accepted', false, 'reason', 'ALREADY_TAKEN_OR_UNAVAILABLE');
  end if;
  insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, v_uid, 'aceita');
  perform public.record_ride_event(p_ride, 'procurando_motorista', 'aceita', 'motorista');
  perform public.notify(v_passenger, 'ride_accepted', 'Motorista a confirmar embarque', 'Seu motorista aceitou a corrida.', p_ride);
  return jsonb_build_object('accepted', true);
end $$;

create or replace function public.decline_ride(p_ride uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, auth.uid(), 'recusada') on conflict do nothing;
end $$;

-- Avanço de estado pelo motorista (a caminho → chegou → em andamento → finalizada)
create or replace function public.advance_ride(p_ride uuid, p_to public.ride_status) returns public.ride_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  r public.ride_requests%rowtype;
  s public.fare_snapshots%rowtype;
  c public.fare_configs%rowtype;
  f record;
  k public.pix_keys%rowtype;
  v_key text; v_holder text; v_pilot boolean;
  v_title text;
begin
  select * into r from public.ride_requests where id = p_ride for update;
  if not found or r.driver_id is distinct from v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_to not in ('motorista_a_caminho', 'motorista_chegou', 'em_andamento', 'finalizada') then raise exception 'INVALID_TRANSITION'; end if;
  if not public.ride_transition_allowed(r.status, p_to, 'motorista') then raise exception 'INVALID_TRANSITION'; end if;

  update public.ride_requests set status = p_to,
    arrived_at = case when p_to = 'motorista_chegou' then now() else arrived_at end,
    started_at = case when p_to = 'em_andamento' then now() else started_at end,
    finished_at = case when p_to = 'finalizada' then now() else finished_at end
  where id = p_ride;
  perform public.record_ride_event(p_ride, r.status, p_to, 'motorista');

  if p_to = 'finalizada' then
    select * into s from public.fare_snapshots where id = r.fare_snapshot_id;
    -- tarifa variável: recalcula só o componente de tempo com a duração real, MESMA versão de tarifa (sem retroatividade)
    if s.pricing_mode = 'variavel' and not r.manual_price then
      select * into c from public.fare_configs where id = s.fare_config_id;
      select * into f from public.calc_fare(c.base_cents, c.per_km_cents, c.per_minute_cents, c.minimum_cents, c.commission_bps,
        s.distance_m, greatest(0, extract(epoch from (now() - r.started_at)))::int);
      update public.ride_requests set total_cents = f.total_cents, commission_cents = f.commission_cents, driver_net_cents = f.driver_net_cents where id = p_ride;
      r.total_cents := f.total_cents; r.commission_cents := f.commission_cents; r.driver_net_cents := f.driver_net_cents;
    end if;
    v_pilot := coalesce((public.setting('pilot_mode'))::boolean, true);
    select * into k from public.pix_keys where owner_id = v_uid and purpose = 'recebimento_motorista';
    if v_pilot or k.id is null then
      v_key := coalesce(public.setting('pilot_pix_key') #>> '{}', 'simulacao@levaja.invalid');
      v_holder := 'SIMULACAO LEVA JA';
    else
      v_key := k.key_value; v_holder := k.holder_name;
    end if;
    insert into public.payment_intents_demo (ride_id, payer_id, payee_driver_id, amount_cents, commission_cents, driver_net_cents,
      pix_key_type, pix_key_value, holder_name, brcode, is_simulation)
    values (p_ride, r.passenger_id, v_uid, r.total_cents, r.commission_cents, r.driver_net_cents,
      case when v_pilot or k.id is null then 'email'::public.pix_key_type else k.key_type end, v_key, v_holder,
      public.build_static_brcode(v_key, r.total_cents, v_holder, coalesce(public.setting('pix_city') #>> '{}', 'ITUPEVA'),
        'LJ' || upper(left(replace(p_ride::text, '-', ''), 20))),
      v_pilot or k.id is null)
    on conflict (ride_id) do nothing;
    insert into public.payment_status_events (payment_id, to_status, actor_id, actor_role, note)
      select id, 'aguardando', v_uid, 'motorista', 'criado na finalização' from public.payment_intents_demo where ride_id = p_ride;
  end if;

  v_title := case p_to when 'motorista_a_caminho' then 'Motorista a caminho' when 'motorista_chegou' then 'Seu motorista chegou'
    when 'em_andamento' then 'Corrida iniciada' else 'Corrida finalizada' end;
  perform public.notify(r.passenger_id, 'ride_' || p_to::text, v_title, null, p_ride);
  return p_to;
end $$;

create or replace function public.cancel_ride(p_ride uuid, p_reason text) returns public.ride_status
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  r public.ride_requests%rowtype;
  v_actor text;
  v_to public.ride_status;
  v_timeout int := coalesce((public.setting('offer_timeout_seconds'))::int, 180);
begin
  if p_reason is null or char_length(trim(p_reason)) < 2 then raise exception 'REASON_REQUIRED'; end if;
  select * into r from public.ride_requests where id = p_ride for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.passenger_id = v_uid then v_actor := 'passageiro';
  elsif r.driver_id = v_uid then v_actor := 'motorista';
  elsif public.is_admin() then v_actor := 'admin';
  else raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  -- motorista que desiste antes do embarque devolve a corrida para reoferta a outros motoristas
  if v_actor = 'motorista' and r.status in ('aceita', 'motorista_a_caminho') then
    v_to := 'procurando_motorista';
    if not public.ride_transition_allowed(r.status, v_to, v_actor) then raise exception 'INVALID_TRANSITION'; end if;
    update public.ride_requests set status = v_to, driver_id = null, vehicle_id = null, accepted_at = null,
      search_expires_at = now() + make_interval(secs => v_timeout) where id = p_ride;
    insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, v_uid, 'desistiu');
    perform public.record_ride_event(p_ride, r.status, v_to, v_actor, left(p_reason, 200));
    perform public.notify(r.passenger_id, 'ride_reoffered', 'O motorista desistiu', 'Estamos procurando outro motorista.', p_ride);
    return v_to;
  end if;

  v_to := 'cancelada';
  if not public.ride_transition_allowed(r.status, v_to, v_actor) then raise exception 'INVALID_TRANSITION'; end if;
  update public.ride_requests set status = v_to, cancel_reason = left(p_reason, 200), cancelled_by = v_actor::public.app_role, cancelled_at = now() where id = p_ride;
  perform public.record_ride_event(p_ride, r.status, v_to, v_actor, left(p_reason, 200));
  if v_actor <> 'passageiro' then perform public.notify(r.passenger_id, 'ride_cancelled', 'Corrida cancelada', left(p_reason, 200), p_ride); end if;
  if r.driver_id is not null and v_actor <> 'motorista' then perform public.notify(r.driver_id, 'ride_cancelled', 'Corrida cancelada', left(p_reason, 200), p_ride); end if;
  return v_to;
end $$;

-- Detalhes da corrida para os ENVOLVIDOS (e admin). Motorista só vê endereço exato após aceitar.
create or replace function public.get_ride_details(p_ride uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  r public.ride_requests%rowtype;
  s public.fare_snapshots%rowtype;
  v_role text;
begin
  select * into r from public.ride_requests where id = p_ride;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.passenger_id = v_uid then v_role := 'passageiro';
  elsif r.driver_id = v_uid then v_role := 'motorista';
  elsif public.is_admin() then v_role := 'admin';
  else raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into s from public.fare_snapshots where id = r.fare_snapshot_id;
  return jsonb_build_object(
    'ride', to_jsonb(r) - 'pickup_accuracy_m',
    'viewer_role', v_role,
    'fare', jsonb_build_object('version', s.fare_version, 'pricing_mode', s.pricing_mode, 'distance_m', s.distance_m, 'duration_s', s.duration_s,
      'base_cents', s.base_cents, 'distance_cents', s.distance_cents, 'time_cents', s.time_cents, 'minimum_cents', s.minimum_cents,
      'subtotal_cents', s.subtotal_cents, 'commission_bps', s.commission_bps, 'route_source', s.route_source, 'route_polyline', s.route_polyline),
    'driver', case when r.driver_id is null then null else (
      select jsonb_build_object('id', p.id, 'name', split_part(p.full_name, ' ', 1), 'avatar_url', p.avatar_url,
        'rating', (select round(avg(stars)::numeric, 1) from public.ratings where ratee_id = p.id),
        'vehicle', (select jsonb_build_object('make', v.make, 'model', v.model, 'color', v.color, 'plate', v.plate, 'year', v.year)
                    from public.vehicles v where v.id = r.vehicle_id))
      from public.profiles p where p.id = r.driver_id) end,
    'passenger', case when v_role in ('motorista', 'admin') then (
      select jsonb_build_object('id', p.id, 'name', split_part(p.full_name, ' ', 1),
        'rating', (select round(avg(stars)::numeric, 1) from public.ratings where ratee_id = p.id))
      from public.profiles p where p.id = r.passenger_id) end,
    'payment', (select jsonb_build_object('id', pi.id, 'status', pi.status, 'amount_cents', pi.amount_cents, 'brcode', pi.brcode,
                  'is_simulation', pi.is_simulation, 'holder_name', pi.holder_name, 'commission_cents', pi.commission_cents,
                  'driver_net_cents', pi.driver_net_cents)
                from public.payment_intents_demo pi where pi.ride_id = p_ride),
    'my_rating', (select stars from public.ratings where ride_id = p_ride and rater_id = v_uid),
    'events', (select jsonb_agg(jsonb_build_object('to', e.to_status, 'at', e.created_at, 'by', e.actor_role, 'reason', e.reason) order by e.id)
               from public.ride_events e where e.ride_id = p_ride)
  );
end $$;

-- ---------- Pagamento demonstrativo ----------
create or replace function public.set_payment_status(p_ride uuid, p_to public.payment_status, p_idempotency_key text default null, p_note text default null)
returns public.payment_status language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  pi public.payment_intents_demo%rowtype;
  r public.ride_requests%rowtype;
  v_actor text;
  v_ok boolean;
begin
  if p_idempotency_key is not null and exists (select 1 from public.payment_status_events where idempotency_key = p_idempotency_key) then
    return (select status from public.payment_intents_demo where ride_id = p_ride);
  end if;
  select * into pi from public.payment_intents_demo where ride_id = p_ride for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into r from public.ride_requests where id = p_ride;
  if r.passenger_id = v_uid then v_actor := 'passageiro';
  elsif r.driver_id = v_uid then v_actor := 'motorista';
  elsif public.is_admin() then v_actor := 'admin';
  else raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  -- espelho de src/core/pix.ts canTransitionPayment
  v_ok := case
    when pi.status = 'aguardando' and p_to = 'informado' then v_actor = 'passageiro'
    when pi.status in ('aguardando', 'informado') and p_to in ('confirmacao_manual', 'confirmado_manual') then v_actor in ('motorista', 'admin')
    when pi.status = 'confirmacao_manual' and p_to in ('confirmado_manual', 'aguardando') then v_actor in ('motorista', 'admin')
    when pi.status in ('aguardando', 'informado', 'confirmacao_manual') and p_to = 'cancelado' then v_actor = 'admin'
    else false end;
  if not v_ok then raise exception 'INVALID_PAYMENT_TRANSITION'; end if;
  update public.payment_intents_demo set status = p_to where id = pi.id;
  insert into public.payment_status_events (payment_id, from_status, to_status, actor_id, actor_role, note, idempotency_key)
  values (pi.id, pi.status, p_to, v_uid, v_actor, left(p_note, 200), p_idempotency_key);
  if v_actor = 'passageiro' then perform public.notify(r.driver_id, 'payment_informed', 'Passageiro informou pagamento', 'Confira no seu banco antes de confirmar.', p_ride); end if;
  return p_to;
end $$;

create or replace function public.rate_ride(p_ride uuid, p_stars int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  r public.ride_requests%rowtype;
  v_ratee uuid;
begin
  select * into r from public.ride_requests where id = p_ride;
  if not found or r.status <> 'finalizada' then raise exception 'RIDE_NOT_FINISHED'; end if;
  if r.passenger_id = v_uid then v_ratee := r.driver_id;
  elsif r.driver_id = v_uid then v_ratee := r.passenger_id;
  else raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_stars not between 1 and 5 then raise exception 'INVALID_STARS'; end if;
  insert into public.ratings (ride_id, rater_id, ratee_id, stars, comment) values (p_ride, v_uid, v_ratee, p_stars, left(p_comment, 300));
end $$;

create or replace function public.driver_earnings(p_days int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rides', count(*),
    'gross_cents', coalesce(sum(r.total_cents), 0),
    'commission_cents', coalesce(sum(r.commission_cents), 0),
    'net_cents', coalesce(sum(r.driver_net_cents), 0),
    'confirmed_net_cents', coalesce(sum(r.driver_net_cents) filter (where pi.status = 'confirmado_manual'), 0),
    'pending_net_cents', coalesce(sum(r.driver_net_cents) filter (where pi.status is distinct from 'confirmado_manual'), 0)
  )
  from public.ride_requests r left join public.payment_intents_demo pi on pi.ride_id = r.id
  where r.driver_id = auth.uid() and r.status = 'finalizada' and r.finished_at > now() - make_interval(days => p_days)
$$;

create or replace function public.get_public_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.app_settings where is_public
$$;

create or replace function public.get_active_fare() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(f) - 'created_by' from public.fare_configs f where active
$$;

-- ---------- Admin ----------
create or replace function public.admin_set_driver_status(p_user uuid, p_status public.driver_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  update public.driver_profiles set status = p_status,
    is_available = case when p_status = 'aprovado' then is_available else false end,
    approved_by = case when p_status = 'aprovado' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'aprovado' then now() else approved_at end,
    admin_notes = coalesce(p_note, admin_notes)
  where user_id = p_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.audit('driver_status', 'driver', p_user::text, jsonb_build_object('status', p_status, 'note', p_note));
  perform public.notify(p_user, 'driver_status', case p_status when 'aprovado' then 'Cadastro aprovado' else 'Status do cadastro atualizado' end, p_status::text, null);
end $$;

create or replace function public.admin_set_fare(p_base int, p_per_km int, p_per_min int, p_minimum int, p_commission_bps int,
  p_pricing_mode text, p_manual_price_enabled boolean, p_note text) returns int
language plpgsql security definer set search_path = public as $$
declare v_version int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.fare_configs;
  update public.fare_configs set active = false where active;
  -- nova versão: corridas existentes continuam com a versão gravada no snapshot (sem retroatividade)
  insert into public.fare_configs (version, base_cents, per_km_cents, per_minute_cents, minimum_cents, commission_bps, pricing_mode,
    manual_price_enabled, active, note, created_by)
  values (v_version, p_base, p_per_km, p_per_min, p_minimum, p_commission_bps, p_pricing_mode, p_manual_price_enabled, true, p_note, auth.uid());
  perform public.audit('fare_changed', 'fare_config', v_version::text, jsonb_build_object('base', p_base, 'per_km', p_per_km, 'per_min', p_per_min,
    'minimum', p_minimum, 'commission_bps', p_commission_bps, 'mode', p_pricing_mode, 'manual', p_manual_price_enabled));
  return v_version;
end $$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select value into v_old from public.app_settings where key = p_key;
  if not found then raise exception 'UNKNOWN_SETTING'; end if;
  update public.app_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  insert into public.settings_history (key, old_value, new_value, changed_by) values (p_key, v_old, p_value, auth.uid());
  perform public.audit('setting_changed', 'app_setting', p_key, jsonb_build_object('old', v_old, 'new', p_value));
end $$;

create or replace function public.admin_set_manual_price(p_ride uuid, p_total_cents int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.ride_requests%rowtype;
  c public.fare_configs%rowtype;
  v_comm int;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.ride_requests where id = p_ride for update;
  select f.* into c from public.fare_configs f join public.fare_snapshots s on s.fare_config_id = f.id where s.id = r.fare_snapshot_id;
  if not c.manual_price_enabled then raise exception 'MANUAL_PRICE_DISABLED'; end if;
  if r.status not in ('procurando_motorista', 'aceita', 'motorista_a_caminho', 'motorista_chegou') then raise exception 'INVALID_STATE'; end if;
  if p_total_cents <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_comm := public.round_half_up(p_total_cents::numeric * c.commission_bps / 10000);
  update public.ride_requests set total_cents = p_total_cents, commission_cents = v_comm, driver_net_cents = p_total_cents - v_comm, manual_price = true where id = p_ride;
  perform public.audit('manual_price', 'ride', p_ride::text, jsonb_build_object('old', r.total_cents, 'new', p_total_cents, 'reason', p_reason));
  perform public.notify(r.passenger_id, 'manual_price', 'Preço definido manualmente pelo administrador', p_reason, p_ride);
end $$;

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles where deleted_at is null),
    'passengers', (select count(*) from public.roles where role = 'passageiro'),
    'drivers_pending', (select count(*) from public.driver_profiles where status = 'pendente'),
    'drivers_approved', (select count(*) from public.driver_profiles where status = 'aprovado'),
    'drivers_available', (select count(*) from public.driver_profiles where is_available),
    'rides_active', (select count(*) from public.ride_requests where status in ('procurando_motorista','aceita','motorista_a_caminho','motorista_chegou','em_andamento')),
    'rides_today', (select count(*) from public.ride_requests where created_at > date_trunc('day', now())),
    'rides_finished_30d', (select count(*) from public.ride_requests where status = 'finalizada' and finished_at > now() - interval '30 days'),
    'gross_30d_cents', (select coalesce(sum(total_cents), 0) from public.ride_requests where status = 'finalizada' and finished_at > now() - interval '30 days'),
    'commission_30d_cents', (select coalesce(sum(commission_cents), 0) from public.ride_requests where status = 'finalizada' and finished_at > now() - interval '30 days'),
    'payments_pending', (select count(*) from public.payment_intents_demo where status in ('aguardando', 'informado', 'confirmacao_manual'))
  );
end $$;

-- Mapa de corridas em andamento (admin): posição do motorista com idade do sinal
create or replace function public.admin_live_rides() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('ride', to_jsonb(r), 'driver_location', to_jsonb(dl)))
    from public.ride_requests r left join public.driver_locations dl on dl.driver_id = r.driver_id
    where r.status in ('procurando_motorista','aceita','motorista_a_caminho','motorista_chegou','em_andamento')), '[]'::jsonb);
end $$;

-- ---------- LGPD: exclusão de conta e retenção ----------
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if exists (select 1 from public.ride_requests where (passenger_id = v_uid or driver_id = v_uid)
             and status in ('solicitada','procurando_motorista','aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then
    raise exception 'RIDE_IN_PROGRESS';
  end if;
  delete from public.driver_locations where driver_id = v_uid;
  delete from public.pix_keys where owner_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  update public.driver_profiles set is_available = false, status = 'revogado' where user_id = v_uid;
  -- corridas finalizadas são mantidas (obrigação contábil/auditoria) com o perfil anonimizado
  update public.profiles set full_name = 'Usuário removido', phone = null, avatar_url = null, location_consent_at = null, deleted_at = now() where id = v_uid;
  delete from public.roles where user_id = v_uid;
  perform public.audit('account_deleted', 'profile', v_uid::text);
end $$;

create or replace function public.purge_retention() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int;
begin
  delete from public.driver_locations dl where dl.received_at < now() - interval '24 hours'; get diagnostics a = row_count;
  delete from public.notifications where created_at < now() - interval '90 days'; get diagnostics b = row_count;
  delete from public.rate_limits where window_start < now() - interval '2 days'; get diagnostics c = row_count;
  delete from public.fare_snapshots s where s.used_at is null and s.created_at < now() - interval '7 days'; get diagnostics d = row_count;
  -- endereços exatos de corridas antigas são reduzidos (mantém só valores e datas) após 180 dias
  update public.ride_requests set pickup_lat = round(pickup_lat::numeric, 2), pickup_lng = round(pickup_lng::numeric, 2),
    dest_lat = round(dest_lat::numeric, 2), dest_lng = round(dest_lng::numeric, 2), pickup_address = 'removido (retenção)',
    dest_address = 'removido (retenção)', notes = null
  where finished_at < now() - interval '180 days' and pickup_address <> 'removido (retenção)'; get diagnostics e = row_count;
  return jsonb_build_object('locations', a, 'notifications', b, 'rate_limits', c, 'quotes', d, 'rides_minimized', e);
end $$;
