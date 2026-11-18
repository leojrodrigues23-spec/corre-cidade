#!/usr/bin/env node
/**
 * Cria (ou atualiza) as CONTAS DEMO do Leva Já num projeto Supabase real.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/seed-demo-supabase.mjs [--dry-run] [--remover] [--senha=...] [--dominio=...]
 *
 * - Roda SÓ no seu computador/terminal. A service_role ignora RLS: nunca coloque essa chave
 *   no frontend, no .env.local do Vite nem no repositório.
 * - Idempotente: pode rodar várias vezes; contas existentes são atualizadas, não duplicadas.
 * - Recusa rodar se o Modo Piloto estiver DESLIGADO (contas demo só fazem sentido em simulação).
 * - Todas as contas têm "DEMO" no nome; a chave Pix do motorista usa domínio .invalid (não existe no DICT).
 * - A conta admin precisará cadastrar o autenticador (TOTP) no primeiro acesso ao /admin/.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DRY = !!args['dry-run'];
const REMOVE = !!args.remover;
const DOMAIN = String(args.dominio ?? 'demo.levaja.invalid');
const PASSWORD = String(args.senha ?? randomBytes(9).toString('base64url'));

if (PASSWORD.length < 8) fail('A senha precisa ter pelo menos 8 caracteres.');
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(DOMAIN)) fail('Domínio de e-mail inválido.');

const DEMO_ACCOUNTS = [
  { key: 'passageiro', email: `passageiro@${DOMAIN}`, fullName: 'Paula DEMO', phone: '+5511900000001', roles: ['passageiro'] },
  { key: 'motorista', email: `motorista@${DOMAIN}`, fullName: 'Diego DEMO', phone: '+5511900000002', roles: ['motorista'] },
  { key: 'admin', email: `admin@${DOMAIN}`, fullName: 'Admin DEMO', phone: '+5511900000003', roles: ['admin'] },
];
const DEMO_VEHICLE = { make: 'Demo', model: 'Sedan Simulado', color: 'Prata', year: 2022, plate: 'DEM0A00' };
const DEMO_PIX = { purpose: 'recebimento_motorista', key_type: 'email', key_value: `motorista.pix@${DOMAIN}`, holder_name: 'Diego DEMO' };

function fail(msg) {
  console.error('✘ ' + msg);
  process.exit(1);
}
const log = (m) => console.log((DRY ? '[simulação] ' : '') + m);

if (DRY) {
  log(`Contas que seriam ${REMOVE ? 'removidas' : 'criadas/atualizadas'}:`);
  for (const a of DEMO_ACCOUNTS) log(`  - ${a.email}  papéis: ${a.roles.join(', ')}`);
  if (!REMOVE) log(`  motorista: aprovado, veículo ${DEMO_VEHICLE.plate}, Pix ${DEMO_PIX.key_value}`);
  process.exit(0);
}

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) fail('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (não no .env do frontend).');
if (!/^https:\/\//.test(URL_)) fail('SUPABASE_URL deve começar com https://');

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) fail(`${what}: ${error.message}`);
  return data;
}

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`listar usuários: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

// Segurança: só cria contas demo com o Modo Piloto ligado
const pilot = await must(sb.from('app_settings').select('value').eq('key', 'pilot_mode').maybeSingle(), 'ler pilot_mode');
if (!pilot) fail('Configuração pilot_mode não encontrada. As migrações foram aplicadas (supabase db push)?');
if (pilot.value !== true && !REMOVE) fail('Modo Piloto está DESLIGADO. Contas demo só podem ser criadas em modo de simulação.');

if (REMOVE) {
  for (const a of DEMO_ACCOUNTS) {
    const u = await findUserByEmail(a.email);
    if (!u) {
      log(`- ${a.email}: não existe`);
      continue;
    }
    const { error } = await sb.auth.admin.deleteUser(u.id);
    if (error) {
      // corridas registradas impedem a exclusão física (histórico/auditoria): desativa a conta
      await must(sb.from('roles').delete().eq('user_id', u.id), 'remover papéis');
      await must(sb.from('driver_profiles').update({ is_available: false, status: 'revogado' }).eq('user_id', u.id), 'revogar motorista');
      await sb.auth.admin.updateUserById(u.id, { ban_duration: '876000h' });
      log(`~ ${a.email}: tem histórico de corridas; papéis removidos e login bloqueado`);
    } else log(`✔ ${a.email}: removida`);
  }
  process.exit(0);
}

const created = {};
for (const a of DEMO_ACCOUNTS) {
  let user = await findUserByEmail(a.email);
  if (user) {
    await must(sb.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true, ban_duration: 'none', user_metadata: { full_name: a.fullName, phone: a.phone, demo: true } }), `atualizar ${a.email}`);
    log(`↻ ${a.email}: já existia, senha redefinida`);
  } else {
    const data = await must(
      sb.auth.admin.createUser({ email: a.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: a.fullName, phone: a.phone, demo: true } }),
      `criar ${a.email}`,
    );
    user = data.user;
    log(`✔ ${a.email}: criada`);
  }
  created[a.key] = user.id;

  // o trigger handle_new_user cria o perfil; garantimos nome/telefone e consentimento de localização
  await must(
    sb.from('profiles').upsert({ id: user.id, full_name: a.fullName, phone: a.phone, location_consent_at: a.key === 'admin' ? null : new Date().toISOString(), deleted_at: null }),
    `perfil ${a.email}`,
  );
  for (const role of a.roles) await must(sb.from('roles').upsert({ user_id: user.id, role }, { onConflict: 'user_id,role', ignoreDuplicates: true }), `papel ${role}`);
}

// Motorista demo: aprovado, com veículo e chave Pix de SIMULAÇÃO
const driverId = created.motorista;
await must(
  sb.from('driver_profiles').upsert({ user_id: driverId, status: 'aprovado', is_available: false, approved_by: created.admin, approved_at: new Date().toISOString(), admin_notes: 'Conta DEMO criada por script' }),
  'perfil de motorista',
);
const existingVehicle = await must(sb.from('vehicles').select('id').eq('driver_id', driverId).eq('active', true).maybeSingle(), 'ler veículo');
if (existingVehicle) await must(sb.from('vehicles').update(DEMO_VEHICLE).eq('id', existingVehicle.id), 'atualizar veículo');
else await must(sb.from('vehicles').insert({ ...DEMO_VEHICLE, driver_id: driverId }), 'criar veículo (placa DEM0A00 já usada por outro motorista?)');
await must(sb.from('pix_keys').upsert({ owner_id: driverId, ...DEMO_PIX }, { onConflict: 'owner_id,purpose' }), 'chave Pix demo');

await must(sb.from('audit_logs').insert({ action: 'demo_accounts_seeded', entity: 'script', entity_id: 'seed-demo-supabase', data: { emails: DEMO_ACCOUNTS.map((a) => a.email) } }), 'auditoria');

console.log('\nContas demo prontas (anote a senha — ela não fica salva em lugar nenhum):');
for (const a of DEMO_ACCOUNTS) console.log(`  ${a.key.padEnd(10)} ${a.email}`);
console.log(`  senha      ${PASSWORD}`);
console.log('\nPróximos passos: entre no /admin/ com a conta admin e cadastre o autenticador (TOTP).');
console.log('O passageiro demo já tem acesso; o motorista demo está aprovado, falta ficar disponível no app.');
