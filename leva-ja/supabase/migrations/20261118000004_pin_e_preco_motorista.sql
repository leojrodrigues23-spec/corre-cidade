-- =====================================================================
-- Leva Já — PIN de embarque e preço por km definido pelo motorista
--
-- PIN: cada corrida ganha um código de 4 dígitos que SÓ o passageiro vê.
--      Se o motorista usa PIN (preferência dele, padrão: ligado), a corrida
--      só pode ser iniciada depois que ele digitar o código certo.
-- Preço: o motorista escolhe "automático" (tarifa Leva Já) ou "meu preço por km"
--      dentro dos limites do admin. O passageiro escolhe entre a tarifa automática
--      (oferta para todos) ou escolher um motorista específico pelo preço.
-- =====================================================================

-- ---------- Esquema ----------
alter table public.driver_profiles
  add column require_pin boolean not null default true,
  add column price_mode text not null default 'automatico' check (price_mode in ('automatico', 'proprio')),
  add column price_per_km_cents int check (price_per_km_cents is null or price_per_km_cents between 0 and 100000),
  add constraint driver_price_needs_value check (price_mode = 'automatico' or price_per_km_cents is not null);

alter table public.fare_snapshots
  add column per_km_cents int check (per_km_cents is null or per_km_cents >= 0);

alter table public.ride_requests
  add column target_driver_id uuid references public.profiles (id),
  add column price_source text not null default 'automatico' check (price_source in ('automatico', 'motorista')),
  add column pin_required boolean not null default false,
  add column pin_verified_at timestamptz;
create index ride_target_driver_idx on public.ride_requests (target_driver_id) where status = 'procurando_motorista';

-- O PIN fica numa tabela sem nenhuma permissão de leitura: só sai pelas funções abaixo,
-- e somente para o passageiro da corrida. O motorista nunca consegue ler o código.
create table public.ride_pins (
  ride_id uuid primary key references public.ride_requests (id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.ride_pins enable row level security;
revoke all on public.ride_pins from anon, authenticated;

insert into public.app_settings (key, value, is_public) values
  ('driver_custom_price_enabled', 'true', true),   -- motoristas podem definir o próprio preço por km
  ('driver_price_per_km_min_cents', '100', true),  -- R$ 1,00/km
  ('driver_price_per_km_max_cents', '1000', true), -- R$ 10,00/km
  ('pin_max_attempts', '5', true)
on conflict (key) do nothing;

-- ---------- Utilidades ----------
create or replace function public.random_pin() returns text language sql volatile as $$
  -- gen_random_uuid() usa gerador criptográfico
  select lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7))::bit(28)::int % 10000)::text, 4, '0')
$$;

-- Preço por km efetivo de um motorista (respeita a chave geral e os limites atuais)
create or replace function public.driver_effective_per_km(p_driver uuid, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((public.setting('driver_custom_price_enabled'))::boolean, true)
         and d.price_mode = 'proprio' and d.price_per_km_cents is not null
      then least(greatest(d.price_per_km_cents, coalesce((public.setting('driver_price_per_km_min_cents'))::int, 0)),
                 coalesce((public.setting('driver_price_per_km_max_cents'))::int, 100000))
    else p_default end
  from public.driver_profiles d where d.user_id = p_driver
$$;

-- ---------- Preferências do motorista ----------
create or replace function public.set_driver_preferences(p_require_pin boolean, p_price_mode text, p_per_km_cents int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_min int := coalesce((public.setting('driver_price_per_km_min_cents'))::int, 0);
  v_max int := coalesce((public.setting('driver_price_per_km_max_cents'))::int, 100000);
begin
  if not public.has_role('motorista') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_price_mode not in ('automatico', 'proprio') then raise exception 'INVALID_PRICE_MODE'; end if;
  if p_price_mode = 'proprio' then
    if not coalesce((public.setting('driver_custom_price_enabled'))::boolean, true) then raise exception 'CUSTOM_PRICE_DISABLED'; end if;
    if p_per_km_cents is null or p_per_km_cents < v_min or p_per_km_cents > v_max then
      raise exception 'PRICE_OUT_OF_RANGE' using hint = v_min || '-' || v_max;
    end if;
  end if;
  update public.driver_profiles
     set require_pin = coalesce(p_require_pin, true),
         price_mode = p_price_mode,
         price_per_km_cents = case when p_price_mode = 'proprio' then p_per_km_cents else price_per_km_cents end,
         updated_at = now()
   where user_id = v_uid;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- ---------- Motoristas disponíveis e seus preços para uma cotação ----------
create or replace function public.list_driver_prices(p_snapshot uuid, p_pickup_lat double precision, p_pickup_lng double precision)
returns table (driver_id uuid, name text, rating numeric, vehicle text, distance_m int, price_mode text,
  per_km_cents int, total_cents int, requires_pin boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  s public.fare_snapshots%rowtype;
  c public.fare_configs%rowtype;
  v_radius_km double precision := coalesce((public.setting('offer_radius_km'))::double precision, 15);
begin
  if not public.has_role('passageiro') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.check_rate_limit('driver_prices', 120, 3600);
  select * into s from public.fare_snapshots fs where fs.id = p_snapshot and fs.passenger_id = v_uid;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if s.expires_at < now() then raise exception 'QUOTE_EXPIRED'; end if;
  select * into c from public.fare_configs where id = s.fare_config_id;
  return query
    with elig as (
      select dp.user_id, dp.require_pin, public.driver_effective_per_km(dp.user_id, c.per_km_cents) as pk,
             (case when coalesce((public.setting('driver_custom_price_enabled'))::boolean, true) then dp.price_mode else 'automatico' end) as mode,
             public.haversine_m(dl.lat, dl.lng, p_pickup_lat, p_pickup_lng) as dist
      from public.driver_profiles dp
      join public.driver_locations dl on dl.driver_id = dp.user_id
      where dp.is_available and dp.status = 'aprovado' and dp.user_id <> v_uid
        and dl.received_at > now() - interval '5 minutes'
        and public.haversine_m(dl.lat, dl.lng, p_pickup_lat, p_pickup_lng) <= v_radius_km * 1000
        and not exists (select 1 from public.ride_requests r where r.driver_id = dp.user_id
                        and r.status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento'))
    )
    select e.user_id, split_part(p.full_name, ' ', 1),
           (select round(avg(stars)::numeric, 1) from public.ratings where ratee_id = e.user_id),
           (select v.make || ' ' || v.model || ' · ' || v.color from public.vehicles v where v.driver_id = e.user_id and v.active limit 1),
           (round(e.dist / 100) * 100)::int,   -- distância arredondada (privacidade)
           e.mode, e.pk,
           (select f.total_cents from public.calc_fare(c.base_cents, e.pk, c.per_minute_cents, c.minimum_cents, c.commission_bps, s.distance_m, s.duration_s) f),
           e.require_pin
    from elig e join public.profiles p on p.id = e.user_id
    order by 8, 5
    limit 20;
end $$;

-- ---------- Solicitação (automática ou com motorista escolhido) ----------
drop function public.request_ride(uuid, double precision, double precision, text, real, text, text);
create function public.request_ride(p_snapshot uuid, p_pickup_lat double precision, p_pickup_lng double precision,
  p_pickup_address text, p_pickup_accuracy real, p_dest_address text, p_notes text default null,
  p_driver uuid default null, p_expected_total_cents int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  s public.fare_snapshots%rowtype;
  c public.fare_configs%rowtype;
  f record;
  v_ride uuid;
  v_timeout int := coalesce((public.setting('offer_timeout_seconds'))::int, 180);
  v_radius_km double precision := coalesce((public.setting('offer_radius_km'))::double precision, 15);
  v_pilot boolean := coalesce((public.setting('pilot_mode'))::boolean, true);
  v_per_km int;
  v_source text := 'automatico';
  d record;
begin
  if not public.has_role('passageiro') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not coalesce((public.setting('operations_enabled'))::boolean, true) then raise exception 'OPERATIONS_PAUSED'; end if;
  perform public.check_rate_limit('request_ride', 10, 3600);
  select * into s from public.fare_snapshots where id = p_snapshot and passenger_id = v_uid for update;
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if s.used_at is not null then raise exception 'QUOTE_ALREADY_USED'; end if;
  if s.expires_at < now() then raise exception 'QUOTE_EXPIRED'; end if;
  if public.haversine_m(s.origin_lat, s.origin_lng, p_pickup_lat, p_pickup_lng) > 300 then raise exception 'PICKUP_TOO_FAR_FROM_QUOTE'; end if;
  if not public.in_service_area(p_pickup_lat, p_pickup_lng) then raise exception 'PICKUP_OUTSIDE_SERVICE_AREA'; end if;
  if not public.in_service_area(s.dest_lat, s.dest_lng) then raise exception 'DEST_OUTSIDE_SERVICE_AREA'; end if;
  if exists (select 1 from public.ride_requests where passenger_id = v_uid
             and status in ('solicitada','procurando_motorista','aceita','motorista_a_caminho','motorista_chegou','em_andamento')) then
    raise exception 'PASSENGER_HAS_ACTIVE_RIDE';
  end if;

  select * into c from public.fare_configs where id = s.fare_config_id;
  v_per_km := c.per_km_cents;
  if p_driver is not null then
    -- motorista escolhido precisa estar apto AGORA (mesmos critérios da lista)
    if not exists (
      select 1 from public.driver_profiles dp join public.driver_locations dl on dl.driver_id = dp.user_id
      where dp.user_id = p_driver and dp.user_id <> v_uid and dp.is_available and dp.status = 'aprovado'
        and dl.received_at > now() - interval '5 minutes'
        and public.haversine_m(dl.lat, dl.lng, p_pickup_lat, p_pickup_lng) <= v_radius_km * 1000
        and not exists (select 1 from public.ride_requests r where r.driver_id = dp.user_id
                        and r.status in ('aceita','motorista_a_caminho','motorista_chegou','em_andamento'))
    ) then raise exception 'DRIVER_UNAVAILABLE'; end if;
    v_per_km := public.driver_effective_per_km(p_driver, c.per_km_cents);
    if v_per_km <> c.per_km_cents then v_source := 'motorista'; end if;
  end if;

  -- recalcula no servidor com o preço por km aplicável e grava na própria cotação
  select * into f from public.calc_fare(c.base_cents, v_per_km, c.per_minute_cents, c.minimum_cents, c.commission_bps, s.distance_m, s.duration_s);
  if p_expected_total_cents is not null and p_expected_total_cents <> f.total_cents then raise exception 'PRICE_CHANGED'; end if;
  update public.fare_snapshots set used_at = now(), per_km_cents = v_per_km, distance_cents = f.distance_cents,
    subtotal_cents = f.subtotal_cents, total_cents = f.total_cents, commission_cents = f.commission_cents, driver_net_cents = f.driver_net_cents
  where id = s.id;

  insert into public.ride_requests (passenger_id, status, fare_snapshot_id, pickup_lat, pickup_lng, pickup_address, pickup_accuracy_m,
    dest_lat, dest_lng, dest_address, notes, total_cents, commission_cents, driver_net_cents, is_simulation, requested_at, search_expires_at,
    target_driver_id, price_source)
  values (v_uid, 'solicitada', s.id, p_pickup_lat, p_pickup_lng, left(p_pickup_address, 200), p_pickup_accuracy,
    s.dest_lat, s.dest_lng, left(p_dest_address, 200), left(p_notes, 200), f.total_cents, f.commission_cents, f.driver_net_cents, v_pilot,
    now(), now() + make_interval(secs => v_timeout), p_driver, v_source)
  returning id into v_ride;
  insert into public.ride_pins (ride_id, pin) values (v_ride, public.random_pin());
  perform public.record_ride_event(v_ride, null, 'solicitada', 'passageiro');
  update public.ride_requests set status = 'procurando_motorista' where id = v_ride;
  perform public.record_ride_event(v_ride, 'solicitada', 'procurando_motorista', 'sistema');

  if p_driver is not null then
    perform public.notify(p_driver, 'ride_offer', 'Um passageiro escolheu você', 'Corrida no seu preço por km.', v_ride);
  else
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
  end if;
  return v_ride;
end $$;

-- Encerra uma corrida direcionada que o motorista escolhido não vai fazer.
create or replace function public.end_targeted_ride(p_ride uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ride_requests%rowtype;
begin
  select * into r from public.ride_requests where id = p_ride for update;
  if r.status <> 'procurando_motorista' then return; end if;
  update public.ride_requests set status = 'expirada' where id = p_ride;
  insert into public.ride_events (ride_id, from_status, to_status, actor_role, reason) values (p_ride, 'procurando_motorista', 'expirada', 'sistema', p_reason);
  perform public.notify(r.passenger_id, 'ride_expired', 'O motorista escolhido não pôde atender', 'Escolha outro motorista ou peça pela tarifa automática.', p_ride);
end $$;

-- ---------- Ofertas ----------
drop function public.list_open_rides();
create function public.list_open_rides() returns table (
  ride_id uuid, pickup_area_lat double precision, pickup_area_lng double precision, pickup_hint text, dest_hint text,
  distance_to_pickup_m int, route_distance_m int, route_duration_s int, total_cents int, driver_net_cents int,
  requested_at timestamptz, search_expires_at timestamptz, route_source public.route_source,
  targeted boolean, price_source text, per_km_cents int)
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
           s.distance_m, s.duration_s, r.total_cents, r.driver_net_cents, r.requested_at, r.search_expires_at, s.route_source,
           r.target_driver_id is not null, r.price_source, coalesce(s.per_km_cents, (select fc.per_km_cents from public.fare_configs fc where fc.id = s.fare_config_id))
    from public.ride_requests r join public.fare_snapshots s on s.id = r.fare_snapshot_id
    where r.status = 'procurando_motorista' and r.passenger_id <> v_uid
      and (r.target_driver_id is null or r.target_driver_id = v_uid)
      and not exists (select 1 from public.ride_assignments a where a.ride_id = r.id and a.driver_id = v_uid and a.outcome in ('recusada', 'desistiu'))
      and (r.target_driver_id = v_uid or v_loc.driver_id is null or public.haversine_m(v_loc.lat, v_loc.lng, r.pickup_lat, r.pickup_lng) <= v_radius_km * 1000)
    order by (r.target_driver_id is not null) desc, r.requested_at;
end $$;

create or replace function public.accept_ride(p_ride uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  v_vehicle uuid;
  v_passenger uuid;
  v_pin boolean;
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  if not exists (select 1 from public.driver_profiles where user_id = v_uid and is_available) then raise exception 'DRIVER_NOT_AVAILABLE'; end if;
  select id into v_vehicle from public.vehicles where driver_id = v_uid and active;
  if v_vehicle is null then raise exception 'VEHICLE_REQUIRED'; end if;
  select require_pin into v_pin from public.driver_profiles where user_id = v_uid;
  perform public.expire_stale_rides();
  begin
    update public.ride_requests
       set status = 'aceita', driver_id = v_uid, vehicle_id = v_vehicle, accepted_at = now(),
           pin_required = coalesce(v_pin, true), pin_verified_at = null
     where id = p_ride and status = 'procurando_motorista' and passenger_id <> v_uid
       and (target_driver_id is null or target_driver_id = v_uid)
     returning passenger_id into v_passenger;
  exception when unique_violation then
    raise exception 'DRIVER_HAS_ACTIVE_RIDE';
  end;
  if v_passenger is null then
    return jsonb_build_object('accepted', false, 'reason', 'ALREADY_TAKEN_OR_UNAVAILABLE');
  end if;
  update public.ride_pins set attempts = 0 where ride_id = p_ride;
  insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, v_uid, 'aceita');
  perform public.record_ride_event(p_ride, 'procurando_motorista', 'aceita', 'motorista');
  perform public.notify(v_passenger, 'ride_accepted', 'Motorista a confirmar embarque', 'Seu motorista aceitou a corrida.', p_ride);
  return jsonb_build_object('accepted', true);
end $$;

create or replace function public.decline_ride(p_ride uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public.require_user();
begin
  if not public.is_approved_driver() then raise exception 'DRIVER_NOT_APPROVED'; end if;
  insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, v_uid, 'recusada') on conflict do nothing;
  -- se a corrida era só para este motorista, avisa o passageiro na hora em vez de esperar o tempo esgotar
  if exists (select 1 from public.ride_requests where id = p_ride and target_driver_id = v_uid and status = 'procurando_motorista') then
    perform public.end_targeted_ride(p_ride, 'motorista_escolhido_recusou');
  end if;
end $$;

-- ---------- PIN ----------
create or replace function public.verify_ride_pin(p_ride uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_user();
  r public.ride_requests%rowtype;
  k public.ride_pins%rowtype;
  v_max int := coalesce((public.setting('pin_max_attempts'))::int, 5);
begin
  select * into r from public.ride_requests where id = p_ride for update;
  if not found or r.driver_id is distinct from v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.status not in ('motorista_a_caminho', 'motorista_chegou') then raise exception 'INVALID_TRANSITION'; end if;
  if r.pin_verified_at is not null or not r.pin_required then return jsonb_build_object('ok', true, 'attempts_left', v_max); end if;
  select * into k from public.ride_pins where ride_id = p_ride for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if k.attempts >= v_max then return jsonb_build_object('ok', false, 'locked', true, 'attempts_left', 0); end if;
  if coalesce(p_pin, '') = k.pin then
    update public.ride_requests set pin_verified_at = now() where id = p_ride;
    return jsonb_build_object('ok', true, 'attempts_left', v_max - k.attempts);
  end if;
  update public.ride_pins set attempts = attempts + 1 where ride_id = p_ride;
  return jsonb_build_object('ok', false, 'locked', k.attempts + 1 >= v_max, 'attempts_left', greatest(0, v_max - k.attempts - 1));
end $$;

-- Avanço de estado: igual ao anterior + PIN obrigatório para iniciar + preço por km do motorista na tarifa variável
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
  if p_to = 'em_andamento' and r.pin_required and r.pin_verified_at is null then raise exception 'PIN_REQUIRED'; end if;

  update public.ride_requests set status = p_to,
    arrived_at = case when p_to = 'motorista_chegou' then now() else arrived_at end,
    started_at = case when p_to = 'em_andamento' then now() else started_at end,
    finished_at = case when p_to = 'finalizada' then now() else finished_at end
  where id = p_ride;
  perform public.record_ride_event(p_ride, r.status, p_to, 'motorista');

  if p_to = 'finalizada' then
    select * into s from public.fare_snapshots where id = r.fare_snapshot_id;
    if s.pricing_mode = 'variavel' and not r.manual_price then
      select * into c from public.fare_configs where id = s.fare_config_id;
      select * into f from public.calc_fare(c.base_cents, coalesce(s.per_km_cents, c.per_km_cents), c.per_minute_cents, c.minimum_cents, c.commission_bps,
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

  if v_actor = 'motorista' and r.status in ('aceita', 'motorista_a_caminho') then
    v_to := 'procurando_motorista';
    if not public.ride_transition_allowed(r.status, v_to, v_actor) then raise exception 'INVALID_TRANSITION'; end if;
    update public.ride_requests set status = v_to, driver_id = null, vehicle_id = null, accepted_at = null,
      pin_required = false, pin_verified_at = null,
      search_expires_at = now() + make_interval(secs => v_timeout) where id = p_ride;
    insert into public.ride_assignments (ride_id, driver_id, outcome) values (p_ride, v_uid, 'desistiu');
    perform public.record_ride_event(p_ride, r.status, v_to, v_actor, left(p_reason, 200));
    if r.target_driver_id is not null then
      -- corrida no preço deste motorista não é repassada a outros: o passageiro escolhe de novo
      perform public.end_targeted_ride(p_ride, 'motorista_escolhido_desistiu');
      return 'expirada';
    end if;
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

-- Detalhes: inclui o PIN SOMENTE para o passageiro (enquanto a corrida não começou)
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
    'pin', case when v_role = 'passageiro' and r.status in ('solicitada','procurando_motorista','aceita','motorista_a_caminho','motorista_chegou')
                then (select pin from public.ride_pins where ride_id = p_ride) end,
    'fare', jsonb_build_object('version', s.fare_version, 'pricing_mode', s.pricing_mode, 'distance_m', s.distance_m, 'duration_s', s.duration_s,
      'base_cents', s.base_cents, 'distance_cents', s.distance_cents, 'time_cents', s.time_cents, 'minimum_cents', s.minimum_cents,
      'subtotal_cents', s.subtotal_cents, 'commission_bps', s.commission_bps, 'route_source', s.route_source, 'route_polyline', s.route_polyline,
      'per_km_cents', coalesce(s.per_km_cents, (select fc.per_km_cents from public.fare_configs fc where fc.id = s.fare_config_id))),
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

-- ---------- Permissões ----------
revoke execute on function public.random_pin(), public.driver_effective_per_km(uuid, int), public.end_targeted_ride(uuid, text) from public, anon, authenticated;
grant execute on function
  public.set_driver_preferences(boolean, text, int),
  public.list_driver_prices(uuid, double precision, double precision),
  public.request_ride(uuid, double precision, double precision, text, real, text, text, uuid, int),
  public.list_open_rides(),
  public.verify_ride_pin(uuid, text)
to authenticated;
revoke execute on function public.request_ride(uuid, double precision, double precision, text, real, text, text, uuid, int),
  public.list_open_rides(), public.set_driver_preferences(boolean, text, int),
  public.list_driver_prices(uuid, double precision, double precision), public.verify_ride_pin(uuid, text) from public, anon;
