-- Testes de regras de negócio, RLS e concorrência. Executado por run_sql_tests.sh.
\set ON_ERROR_STOP 1
create schema tests;
grant usage on schema tests to authenticated;

create function tests.login(p uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p, 'aal', p_aal, 'role', 'authenticated')::text, false); end $$;

create function tests.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then return; end if;
    raise exception 'esperado erro "%" mas veio "%" em: %', p_like, sqlerrm, p_sql;
  end;
  raise exception 'esperado erro "%" mas executou com sucesso: %', p_like, p_sql;
end $$;

create function tests.eq(p_got anyelement, p_expected anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_expected then raise exception 'FALHOU %: esperado %, obtido %', p_msg, p_expected, p_got; end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on all functions in schema tests to authenticated;
create table tests.ctx (k text primary key, v text);
grant select on tests.ctx to authenticated;

-- ========== Usuários ==========
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@teste', '{"full_name":"Admin Teste"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'pass@teste', '{"full_name":"Paula Passageira","phone":"+5511987654321"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@teste', '{"full_name":"Davi Motorista"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@teste', '{"full_name":"Dora Motorista"}'),
  ('00000000-0000-0000-0000-0000000000ff', 'outro@teste', '{"full_name":"Olavo Intruso"}');
select tests.eq((select count(*) from public.profiles)::int, 5, 'trigger cria perfis');
insert into public.roles (user_id, role) values ('00000000-0000-0000-0000-00000000000a', 'admin');

-- ========== Funções puras ==========
select tests.eq((select total_cents from public.calc_fare(500,200,35,800,1200,6000,900)), 2225, 'tarifa 6km/15min = 2225');
select tests.eq((select commission_cents from public.calc_fare(500,200,35,800,1200,6000,900)), 267, 'comissão 267');
select tests.eq((select driver_net_cents from public.calc_fare(500,200,35,800,1200,6000,900)), 1958, 'líquido 1958');
select tests.eq((select total_cents from public.calc_fare(500,200,35,800,1200,1234,100)), 805, 'arredondamento half-up igual ao TS');
select tests.eq((select total_cents from public.calc_fare(500,200,35,800,1200,500,60)), 800, 'tarifa mínima');
select tests.eq(public.crc16_ccitt('123456789'), '29B1', 'CRC16 vetor padrão');
select tests.eq(public.crc16_ccitt('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D', 'CRC16 exemplo BCB');
select tests.eq(public.build_static_brcode('simulacao@levaja.invalid', 2225, 'SIMULACAO LEVA JA', 'ITUPEVA', 'LJTESTE123'),
  '00020126460014br.gov.bcb.pix0124simulacao@levaja.invalid520400005303986540522.255802BR5917SIMULACAO LEVA JA6007ITUPEVA62140510LJTESTE123630419F4',
  'BR Code SQL idêntico ao TS');
select tests.eq(public.pix_sanitize('João da Conceição', 25), 'JOAO DA CONCEICAO', 'sanitização de nome Pix');
select tests.eq(public.point_in_polygon(0.5, 0.5, '[{"lat":0,"lng":0},{"lat":0,"lng":1},{"lat":1,"lng":1},{"lat":1,"lng":0}]'), true, 'ponto dentro do polígono');
select tests.eq(public.point_in_polygon(1.5, 0.5, '[{"lat":0,"lng":0},{"lat":0,"lng":1},{"lat":1,"lng":1},{"lat":1,"lng":0}]'), false, 'ponto fora do polígono');
select tests.eq(public.ride_transition_allowed('procurando_motorista', 'aceita', 'passageiro'), false, 'passageiro não aceita corrida');
select tests.eq(public.ride_transition_allowed('em_andamento', 'cancelada', 'passageiro'), false, 'passageiro não cancela em andamento');

-- ========== Admin exige MFA (aal2) ==========
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal1');
select tests.eq(public.is_admin(), false, 'admin sem MFA não é admin');
select tests.expect_error($$select public.create_invite('motorista', 24, 2)$$, 'FORBIDDEN');
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal2');
select tests.eq(public.is_admin(), true, 'admin com MFA aal2');
reset role;
-- guarda os tokens gerados (somente no teste; em produção só o hash fica no banco)
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal2');
create temp table tok as select
  (public.create_invite('motorista', 24, 2, 'motoristas piloto') ->> 'token') as driver_token,
  (public.create_invite('passageiro', 24, 1, 'passageira') ->> 'token') as pass_token,
  (public.create_invite('passageiro', 24, 5, 'revogado') ->> 'token') as revoked_token;
select tests.eq((select count(*) from public.invites)::int, 3, 'admin vê convites');
select public.revoke_invite((select id from public.invites where note = 'revogado'));
select tests.eq((select count(*) from public.invites where token_hash ~ '^[0-9a-f]{64}$')::int, 3, 'apenas hash armazenado');

-- ========== Resgate de convites ==========
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.eq((public.redeem_invite((select pass_token from tok)) ->> 'role'), 'passageiro', 'passageira resgata convite');
select tests.eq((select count(*) from public.invites)::int, 0, 'não-admin não vê convites (RLS)');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select public.redeem_invite((select driver_token from tok));
select tests.login('00000000-0000-0000-0000-0000000000d2');
select public.redeem_invite((select driver_token from tok));
select tests.login('00000000-0000-0000-0000-0000000000ff');
select tests.expect_error($$select public.redeem_invite((select driver_token from tok))$$, 'INVITE_EXHAUSTED');
select tests.expect_error($$select public.redeem_invite((select revoked_token from tok))$$, 'INVITE_REVOKED');
select tests.expect_error($$select public.redeem_invite('token-que-nao-existe-1234567890')$$, 'INVITE_INVALID');
select tests.expect_error($$select public.self_enroll_passenger()$$, 'INVITE_REQUIRED');
select tests.eq((public.get_my_access() -> 'roles'), '[]'::jsonb, 'intruso sem papéis');

-- ========== Escrita direta bloqueada ==========
select tests.expect_error($$insert into public.roles (user_id, role) values ('00000000-0000-0000-0000-0000000000ff', 'admin')$$, 'permission denied%');
select tests.expect_error($$update public.driver_profiles set status = 'aprovado'$$, 'permission denied%');
select tests.expect_error($$select public.create_fare_snapshot('00000000-0000-0000-0000-0000000000ff', -23.15, -47.05, -23.16, -47.06, 1, 1, null, 'google_routes')$$, 'permission denied%');
select tests.expect_error($$select public.admin_dashboard()$$, 'FORBIDDEN');

-- ========== Motorista: aprovação e disponibilidade ==========
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.eq((public.get_my_access() ->> 'driver_status'), 'pendente', 'motorista começa pendente');
select tests.expect_error($$select public.set_driver_availability(true)$$, 'DRIVER_NOT_APPROVED');
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal2');
select public.admin_set_driver_status('00000000-0000-0000-0000-0000000000d1', 'aprovado');
select public.admin_set_driver_status('00000000-0000-0000-0000-0000000000d2', 'aprovado');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.expect_error($$select public.set_driver_availability(true)$$, 'VEHICLE_REQUIRED');
select public.save_driver_vehicle('Fiat', 'Argo', 'Prata', 2021, 'ABC1D23');
select tests.expect_error($$select public.set_driver_availability(true)$$, 'PIX_KEY_REQUIRED');
select tests.expect_error($$select public.save_pix_key('recebimento_motorista', 'cpf_cnpj', '123', 'Davi')$$, 'INVALID_PIX_KEY');
select public.save_pix_key('recebimento_motorista', 'email', 'davi@exemplo.com', 'Davi Motorista');
select tests.expect_error($$select public.set_driver_availability(true)$$, 'LOCATION_CONSENT_REQUIRED');
select public.set_location_consent(true);
select public.set_driver_availability(true);
select tests.eq((public.push_driver_location(-23.1530, -47.0577, 12, 0, 0, now()) ->> 'accepted')::boolean, true, 'posição aceita');
select tests.login('00000000-0000-0000-0000-0000000000d2');
select public.save_driver_vehicle('VW', 'Gol', 'Branco', 2019, 'XYZ9876');
select public.save_pix_key('recebimento_motorista', 'aleatoria', '123e4567-e12b-12d1-a456-426655440000', 'Dora Motorista');
select public.set_location_consent(true);
select public.set_driver_availability(true);
select public.push_driver_location(-23.1540, -47.0590, 8, 0, 0, now());
-- intruso não vê posição de motoristas
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.eq((select count(*) from public.driver_locations)::int, 0, 'passageira não vê motoristas antes da corrida');
select tests.eq((select count(*) from public.pix_keys)::int, 0, 'passageira não vê chaves Pix de motoristas');

-- ========== Cotação e solicitação ==========
select tests.expect_error($$select public.quote_ride_simulated(-23.1530, -47.0577, -23.1700, -47.0800)$$, 'SIMULATED_ROUTES_DISABLED');
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal2');
select public.admin_set_setting('allow_simulated_routes', 'true');
select tests.eq((select count(*) from public.settings_history where key = 'allow_simulated_routes')::int, 1, 'histórico de configuração registrado');
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table q as select * from public.quote_ride_simulated(-23.1530, -47.0577, -23.1700, -47.0800);
select tests.eq((select route_source::text from q), 'simulada', 'cotação marcada como simulada');
select tests.eq((select commission_cents + driver_net_cents = total_cents from q), true, 'split soma o total');
select tests.expect_error($$select public.request_ride((select id from q), -23.20, -47.10, 'Longe', 10, 'Destino')$$, 'PICKUP_TOO_FAR_FROM_QUOTE');
create temp table r1 as select public.request_ride((select id from q), -23.1531, -47.0578, 'Rua Teste, 100, Centro, Itupeva', 10, 'Av. Destino, 500, Bairro B, Itupeva') as id;
select tests.eq((select status::text from public.ride_requests where id = (select id from r1)), 'procurando_motorista', 'corrida procurando motorista');
select tests.eq((select total_cents from public.ride_requests where id = (select id from r1)), (select total_cents from q), 'preço vem da cotação do servidor');
select tests.expect_error($$select public.request_ride((select id from q), -23.1531, -47.0578, 'x', 10, 'y')$$, 'QUOTE_ALREADY_USED');
select tests.eq((select count(*) from public.ride_events where ride_id = (select id from r1))::int, 2, 'eventos solicitada + procurando');

-- motoristas recebem oferta, intruso não vê corrida
select tests.login('00000000-0000-0000-0000-0000000000ff');
select tests.eq((select count(*) from public.ride_requests)::int, 0, 'intruso não vê corridas (RLS)');
select tests.expect_error($$select public.get_ride_details((select id from r1))$$, 'FORBIDDEN');
select tests.expect_error($$select * from public.list_open_rides()$$, 'DRIVER_NOT_APPROVED');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.eq((select count(*) from public.notifications where kind = 'ride_offer')::int, 1, 'motorista recebeu oferta');
select tests.eq((select count(*) from public.ride_requests)::int, 0, 'motorista não vê linha da corrida antes de aceitar');
select tests.eq((select pickup_area_lat from public.list_open_rides()), -23.153::double precision, 'oferta mostra apenas região aproximada');

-- ========== Aceite atômico ==========
select tests.eq((public.accept_ride((select id from r1)) ->> 'accepted')::boolean, true, 'D1 aceita');
select tests.login('00000000-0000-0000-0000-0000000000d2');
select tests.eq((public.accept_ride((select id from r1)) ->> 'accepted')::boolean, false, 'D2 não consegue aceitar corrida já aceita');
select tests.expect_error($$select public.advance_ride((select id from r1), 'motorista_a_caminho')$$, 'FORBIDDEN');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.eq((select count(*) from public.driver_locations)::int, 1, 'passageira vê SOMENTE o motorista da corrida ativa');
select tests.eq((select driver_id from public.driver_locations), '00000000-0000-0000-0000-0000000000d1'::uuid, 'é o motorista certo');
select tests.eq((public.get_ride_details((select id from r1)) -> 'driver' -> 'vehicle' ->> 'plate'), 'ABC1D23', 'passageira vê placa');
select tests.eq((public.get_ride_details((select id from r1)) -> 'driver' ? 'phone'), false, 'telefone do motorista não exposto');

-- ========== Transições ==========
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.expect_error($$select public.advance_ride((select id from r1), 'em_andamento')$$, 'INVALID_TRANSITION');
select public.advance_ride((select id from r1), 'motorista_a_caminho');
select public.advance_ride((select id from r1), 'motorista_chegou');
-- ========== PIN de embarque ==========
select tests.eq((select pin_required from public.ride_requests where id = (select id from r1)), true, 'PIN ligado por padrão para o motorista');
select tests.expect_error($$select public.advance_ride((select id from r1), 'em_andamento')$$, 'PIN_REQUIRED');
select tests.expect_error($$select * from public.ride_pins$$, 'permission denied%');
select tests.eq((public.get_ride_details((select id from r1)) ->> 'pin'), null, 'motorista não recebe o PIN');
select tests.eq((public.verify_ride_pin((select id from r1), 'abcd') ->> 'ok')::boolean, false, 'PIN errado recusado');
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table pin1 as select public.get_ride_details((select id from r1)) ->> 'pin' as pin;
select tests.eq((select pin ~ '^[0-9]{4}$' from pin1), true, 'passageira vê PIN de 4 dígitos');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.eq((public.verify_ride_pin((select id from r1), (select pin from pin1)) ->> 'ok')::boolean, true, 'PIN certo libera o embarque');
select public.advance_ride((select id from r1), 'em_andamento');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.eq((public.get_ride_details((select id from r1)) ->> 'pin'), null, 'PIN some depois que a corrida começa');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.expect_error($$select public.cancel_ride((select id from r1), 'quero sair')$$, 'INVALID_TRANSITION');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select public.advance_ride((select id from r1), 'finalizada');
select tests.eq((select count(*) from public.ride_events where ride_id = (select id from r1))::int, 7, 'eventos registrados com data/hora');

-- ========== Pix demonstrativo ==========
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table pay as select (public.get_ride_details((select id from r1)) -> 'payment') as p;
select tests.eq((select (p ->> 'is_simulation')::boolean from pay), true, 'modo piloto: Pix SIMULADO');
select tests.eq((select p ->> 'brcode' like '%simulacao@levaja.invalid%' from pay), true, 'modo piloto usa chave de simulação, não a do motorista');
select tests.eq((select right(p ->> 'brcode', 4) = public.crc16_ccitt(left(p ->> 'brcode', length(p ->> 'brcode') - 4)) from pay), true, 'CRC do BR Code confere');
select tests.eq((select p ->> 'status' from pay), 'aguardando', 'pagamento aguardando');
select tests.expect_error($$select public.set_payment_status((select id from r1), 'confirmado_manual')$$, 'INVALID_PAYMENT_TRANSITION');
select public.set_payment_status((select id from r1), 'informado', 'idem-1');
select tests.eq(public.set_payment_status((select id from r1), 'informado', 'idem-1')::text, 'informado', 'idempotência');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select public.set_payment_status((select id from r1), 'confirmado_manual');
select tests.eq((public.driver_earnings() ->> 'confirmed_net_cents')::int, (select driver_net_cents from public.ride_requests where id = (select id from r1)), 'ganhos confirmados');
select public.rate_ride((select id from r1), 5, 'ótima passageira');
select tests.expect_error($$select public.rate_ride((select id from r1), 4)$$, 'duplicate key%');

-- ========== Desistência do motorista → reoferta ==========
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table q2 as select * from public.quote_ride_simulated(-23.1530, -47.0577, -23.1600, -47.0700);
create temp table r2 as select public.request_ride((select id from q2), -23.1530, -47.0577, 'Rua A, 1, Centro', 10, 'Rua B, 2, Bairro') as id;
select tests.login('00000000-0000-0000-0000-0000000000d1');
select public.accept_ride((select id from r2));
select tests.expect_error($$select public.cancel_ride((select id from r2), '')$$, 'REASON_REQUIRED');
select tests.eq(public.cancel_ride((select id from r2), 'Problema com o veículo')::text, 'procurando_motorista', 'desistência volta para reoferta');
select tests.eq((select count(*) from public.list_open_rides() where ride_id = (select id from r2))::int, 0, 'quem desistiu não recebe de novo');
select tests.login('00000000-0000-0000-0000-0000000000d2');
select tests.eq((select count(*) from public.list_open_rides() where ride_id = (select id from r2))::int, 1, 'outro motorista vê a reoferta');
select public.decline_ride((select id from r2));
select tests.eq((select count(*) from public.list_open_rides() where ride_id = (select id from r2))::int, 0, 'recusada some da lista');
-- expiração
reset role;
update public.ride_requests set search_expires_at = now() - interval '1 second' where id = (select id from r2);
select tests.eq(public.expire_stale_rides(), 1, 'expira busca vencida');
select tests.eq((select status::text from public.ride_requests where id = (select id from r2)), 'expirada', 'status expirada');

-- ========== Preço por km do motorista + corrida direcionada ==========
set role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d2');
select tests.expect_error($$select public.set_driver_preferences(false, 'proprio', 5)$$, 'PRICE_OUT_OF_RANGE');
select public.set_driver_preferences(false, 'proprio', 300);
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table q4 as select * from public.quote_ride_simulated(-23.1530, -47.0577, -23.1700, -47.0800);
create temp table prices as select * from public.list_driver_prices((select id from q4), -23.1530, -47.0577);
select tests.eq((select count(*) from prices)::int, 2, 'passageira vê os 2 motoristas disponíveis');
select tests.eq((select per_km_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d2'), 300, 'preço próprio da Dora');
select tests.eq((select per_km_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d1'), 200, 'Davi na tarifa automática');
select tests.eq((select total_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d2') >
                (select total_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d1'), true, 'preço maior por km = total maior');
select tests.expect_error($$select public.request_ride((select id from q4), -23.1530, -47.0577, 'Rua A, 1, Centro', 10, 'Rua B, 2, Bairro', null,
  '00000000-0000-0000-0000-0000000000d2', 1)$$, 'PRICE_CHANGED');
create temp table r4 as select public.request_ride((select id from q4), -23.1530, -47.0577, 'Rua A, 1, Centro', 10, 'Rua B, 2, Bairro', null,
  '00000000-0000-0000-0000-0000000000d2', (select total_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d2')) as id;
select tests.eq((select price_source from public.ride_requests where id = (select id from r4)), 'motorista', 'corrida no preço do motorista');
select tests.eq((select total_cents from public.ride_requests where id = (select id from r4)),
                (select total_cents from prices where driver_id = '00000000-0000-0000-0000-0000000000d2'), 'total igual ao mostrado');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.eq((select count(*) from public.list_open_rides() where ride_id = (select id from r4))::int, 0, 'outro motorista não vê corrida direcionada');
select tests.eq((public.accept_ride((select id from r4)) ->> 'accepted')::boolean, false, 'outro motorista não aceita corrida direcionada');
select tests.login('00000000-0000-0000-0000-0000000000d2');
select tests.eq((select targeted from public.list_open_rides() where ride_id = (select id from r4)), true, 'motorista escolhido vê a oferta');
select public.decline_ride((select id from r4));
select tests.eq((select status::text from public.ride_requests where id = (select id from r4) ), null, 'motorista não vê linha antes de aceitar');
reset role;
select tests.eq((select status::text from public.ride_requests where id = (select id from r4)), 'expirada', 'recusa do escolhido encerra a busca na hora');
set role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d2');
select public.set_driver_preferences(true, 'automatico', null);
reset role;

-- ========== Tarifa versionada, sem retroatividade ==========
set role authenticated;
select tests.login('00000000-0000-0000-0000-00000000000a', 'aal2');
select tests.eq(public.admin_set_fare(600, 250, 40, 900, 1000, 'fixa_na_solicitacao', false, 'reajuste teste'), 2, 'nova versão de tarifa');
select tests.eq((select fare_version from public.fare_snapshots where id = (select id from q)), 1, 'corrida antiga mantém versão 1');
select tests.expect_error($$select public.admin_set_manual_price((select id from r1), 1000, 'x')$$, 'MANUAL_PRICE_DISABLED');
select tests.eq((public.admin_dashboard() ->> 'rides_finished_30d')::int, 1, 'dashboard admin');
select tests.eq((select count(*) from public.audit_logs where action = 'fare_changed')::int, 1, 'auditoria de tarifa');

-- ========== Desligar disponibilidade apaga posição ==========
select tests.login('00000000-0000-0000-0000-0000000000d2');
select public.set_driver_availability(false);
select tests.eq((select count(*) from public.driver_locations)::int, 0, 'posição removida ao ficar indisponível');
select tests.expect_error($$select public.push_driver_location(-23.15, -47.05, 10, 0, 0, now())$$, 'NOT_TRACKABLE');
select public.set_driver_availability(true);
select public.push_driver_location(-23.1540, -47.0590, 8, 0, 0, now() - interval '10 seconds');

-- ========== Salto impossível ==========
select tests.login('00000000-0000-0000-0000-0000000000d1');
reset role;
update public.driver_locations set received_at = now() - interval '10 seconds' where driver_id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.eq(public.push_driver_location(-22.90, -43.20, 10, 0, 0, now()) ->> 'reason', 'implausible_jump', 'salto Itupeva→Rio rejeitado');
select tests.expect_error($$select public.push_driver_location(0, 0, 10, 0, 0, now())$$, 'INVALID_COORDS');

-- ========== LGPD ==========
select tests.login('00000000-0000-0000-0000-0000000000ff');
select public.delete_my_account();
reset role;
select tests.eq((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000ff'), 'Usuário removido', 'conta anonimizada');
select tests.eq((public.purge_retention() ->> 'locations')::int, 0, 'retenção executa');

-- ========== Preparação do teste de concorrência real ==========
set role authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a1');
create temp table q3 as select * from public.quote_ride_simulated(-23.1530, -47.0577, -23.1650, -47.0750);
reset role;
insert into tests.ctx values ('race_ride', (select public_request.id::text from (select 1) x,
  lateral (select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', false)) s,
  lateral (select public.request_ride((select id from q3), -23.1530, -47.0577, 'Rua C, 3, Centro', 10, 'Rua D, 4, Bairro') as id) public_request));
select 'preparado' as concorrencia;
