-- =====================================================================
-- Leva Já — RLS, permissões e dados iniciais
-- Princípio: cliente só LÊ o que é seu (ou o que a corrida ativa permite);
-- todas as escritas passam pelas funções validadas do arquivo anterior.
-- =====================================================================

-- RLS em TODAS as tabelas
do $$
declare t text;
begin
  foreach t in array array['app_settings','settings_history','profiles','roles','driver_profiles','vehicles','pix_keys','invites',
    'invite_redemptions','rate_limits','fare_configs','fare_snapshots','ride_requests','ride_assignments','ride_events',
    'driver_locations','payment_intents_demo','payment_status_events','ratings','notifications','audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Leitura restrita (SELECT) para authenticated; anon não lê nada.
grant select on public.profiles, public.roles, public.driver_profiles, public.vehicles, public.pix_keys, public.invites,
  public.fare_configs, public.fare_snapshots, public.ride_requests, public.ride_events, public.driver_locations,
  public.payment_intents_demo, public.payment_status_events, public.ratings, public.notifications, public.audit_logs,
  public.app_settings, public.settings_history to authenticated;
-- Única escrita direta permitida: marcar a própria notificação como lida.
grant update (read_at) on public.notifications to authenticated;

-- profiles
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
-- roles
create policy roles_self on public.roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- driver_profiles
create policy driver_profiles_self on public.driver_profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- vehicles: dono e admin (passageiro vê dados do veículo via get_ride_details)
create policy vehicles_self on public.vehicles for select to authenticated using (driver_id = auth.uid() or public.is_admin());
-- pix_keys: SOMENTE o dono (admin não precisa ver chave para operar)
create policy pix_keys_self on public.pix_keys for select to authenticated using (owner_id = auth.uid());
-- invites / auditoria / histórico: admin
create policy invites_admin on public.invites for select to authenticated using (public.is_admin());
create policy audit_admin on public.audit_logs for select to authenticated using (public.is_admin());
create policy settings_history_admin on public.settings_history for select to authenticated using (public.is_admin());
create policy app_settings_read on public.app_settings for select to authenticated using (is_public or public.is_admin());
-- tarifas: versão ativa visível para todos os autenticados; histórico para admin
create policy fare_configs_read on public.fare_configs for select to authenticated using (active or public.is_admin());
create policy fare_snapshots_self on public.fare_snapshots for select to authenticated using (passenger_id = auth.uid() or public.is_admin());

-- ride_requests: passageiro dono, motorista ATRIBUÍDO, admin
create policy rides_participants on public.ride_requests for select to authenticated
  using (passenger_id = auth.uid() or driver_id = auth.uid() or public.is_admin());
create policy ride_events_participants on public.ride_events for select to authenticated
  using (exists (select 1 from public.ride_requests r where r.id = ride_id and (r.passenger_id = auth.uid() or r.driver_id = auth.uid())) or public.is_admin());

-- driver_locations: o próprio motorista; o passageiro SOMENTE durante corrida ativa com ESTE motorista; admin
create policy driver_locations_visibility on public.driver_locations for select to authenticated using (
  driver_id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.ride_requests r where r.driver_id = driver_locations.driver_id and r.passenger_id = auth.uid()
             and r.status in ('aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'))
);

create policy payments_participants on public.payment_intents_demo for select to authenticated
  using (payer_id = auth.uid() or payee_driver_id = auth.uid() or public.is_admin());
create policy payment_events_participants on public.payment_status_events for select to authenticated
  using (exists (select 1 from public.payment_intents_demo p where p.id = payment_id and (p.payer_id = auth.uid() or p.payee_driver_id = auth.uid())) or public.is_admin());
create policy ratings_participants on public.ratings for select to authenticated using (rater_id = auth.uid() or ratee_id = auth.uid() or public.is_admin());
create policy notifications_self on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Funções: execução explícita ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.get_my_access(), public.update_my_profile(text, text, text), public.set_location_consent(boolean),
  public.redeem_invite(text), public.self_enroll_passenger(),
  public.save_driver_vehicle(text, text, text, int, text), public.save_pix_key(text, public.pix_key_type, text, text), public.delete_pix_key(text),
  public.set_driver_availability(boolean), public.push_driver_location(double precision, double precision, real, real, real, timestamptz),
  public.quote_ride_simulated(double precision, double precision, double precision, double precision),
  public.request_ride(uuid, double precision, double precision, text, real, text, text),
  public.list_open_rides(), public.accept_ride(uuid), public.decline_ride(uuid), public.advance_ride(uuid, public.ride_status),
  public.cancel_ride(uuid, text), public.get_ride_details(uuid), public.set_payment_status(uuid, public.payment_status, text, text),
  public.rate_ride(uuid, int, text), public.driver_earnings(int), public.get_public_settings(), public.get_active_fare(),
  public.create_invite(public.app_role, int, int, text), public.revoke_invite(uuid),
  public.admin_set_driver_status(uuid, public.driver_status, text),
  public.admin_set_fare(int, int, int, int, int, text, boolean, text), public.admin_set_setting(text, jsonb),
  public.admin_set_manual_price(uuid, int, text), public.admin_dashboard(), public.admin_live_rides(),
  public.delete_my_account(),
  -- usados pelas políticas RLS
  public.is_admin(), public.has_role(public.app_role, uuid), public.is_approved_driver(uuid),
  -- funções puras (sem acesso a dados)
  public.calc_fare(int, int, int, int, int, int, int), public.crc16_ccitt(text), public.build_static_brcode(text, int, text, text, text),
  public.haversine_m(double precision, double precision, double precision, double precision)
to authenticated;
-- create_fare_snapshot recebe distância/duração: SOMENTE o servidor (Edge Function com service_role) pode chamar.
grant execute on function public.create_fare_snapshot(uuid, double precision, double precision, double precision, double precision, int, int, text, public.route_source),
  public.expire_stale_rides(), public.purge_retention() to service_role;

-- ---------- Realtime (respeita RLS) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ride_requests, public.driver_locations, public.notifications, public.payment_intents_demo;
  end if;
end $$;

-- ---------- Agendamentos (pg_cron, se disponível no projeto) ----------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('levaja-expire-rides', '* * * * *', 'select public.expire_stale_rides()');
    perform cron.schedule('levaja-retention', '17 3 * * *', 'select public.purge_retention()');
  end if;
end $$;

-- ---------- Dados iniciais ----------
-- Tarifa inicial FICTÍCIA de teste (editável no painel; cada edição cria nova versão)
insert into public.fare_configs (version, base_cents, per_km_cents, per_minute_cents, minimum_cents, commission_bps, pricing_mode, manual_price_enabled, active, note)
values (1, 500, 200, 35, 800, 1200, 'fixa_na_solicitacao', false, true, 'Valores iniciais fictícios de teste');

insert into public.app_settings (key, value, is_public) values
  ('pilot_mode', 'true', true),                        -- Modo Piloto / Simulação: Pix sempre simulado
  ('operations_enabled', 'true', true),                -- pausa geral de solicitações
  ('passenger_invite_required', 'true', true),
  ('allow_simulated_routes', 'false', true),           -- só habilitar se a Routes API não estiver configurada
  ('admin_require_mfa', 'true', false),
  ('offer_timeout_seconds', '180', true),
  ('offer_radius_km', '15', true),
  ('pilot_pix_key', '"simulacao@levaja.invalid"', false),
  ('pix_city', '"ITUPEVA"', true),
  ('public_base_url', 'null', true),                   -- domínio HTTPS público; QR Codes só são gerados quando definido
  ('map_defaults', '{"center":{"lat":-23.1530,"lng":-47.0577},"zoom":14,"region":"BR","language":"pt-BR"}', true),
  ('service_area', '{"name":"Itupeva/SP (aproximado — revisar)","polygon":[]}', true),
  ('support_contact', 'null', true);
