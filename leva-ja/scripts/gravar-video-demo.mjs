#!/usr/bin/env node
/**
 * Grava um vídeo de demonstração do Leva Já (modo demo local), com passageiro e motorista lado a lado
 * e legendas em português, e depois o painel admin. Saída: tests/e2e/video/leva-ja-demo.mp4
 *
 * Uso: npm run build && node scripts/gravar-video-demo.mjs
 * Requer: Playwright (já instalado no ambiente) e ffmpeg.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tests/e2e/video');
const raw = resolve(out, 'raw');
rmSync(out, { recursive: true, force: true });
mkdirSync(raw, { recursive: true });

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const server = spawn(resolve(root, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('preview não subiu')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), ok()));
});

const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: PHONE,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
  geolocation: { latitude: -23.153, longitude: -47.0577, accuracy: 12 },
  permissions: ['geolocation'],
  recordVideo: { dir: raw, size: PHONE },
});
const pass = await ctx.newPage();
const driver = await ctx.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Legenda fixa no topo da tela (fica gravada no vídeo). */
async function cap(page, text) {
  if (text) console.log('·', text);
  await page.evaluate((t) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:84px;z-index:99999;padding:10px 14px;border-radius:16px;background:#31466F;color:#fff;font:700 15px/1.3 system-ui,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none;transition:opacity .3s';
      document.body.appendChild(el);
    }
    el.textContent = t;
    el.style.opacity = t ? '1' : '0';
  }, text);
}
/** Recoloca a legenda depois de navegar (a página nova não tem o elemento). */
async function go(page, url, text) {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  if (text) await cap(page, text);
}

try {
  // ---------- Abertura ----------
  await go(pass, `${BASE}/`, 'Leva Já · página inicial');
  await go(driver, `${BASE}/motorista/`, 'App do motorista');
  await wait(3000);

  // ---------- Motorista fica online ----------
  await cap(driver, 'Motorista entra e fica online');
  await driver.getByRole('button', { name: 'Entrar como motorista demo' }).click();
  await driver.getByRole('button', { name: 'Autorizar e continuar' }).click({ timeout: 15000 });
  await cap(driver, 'Motorista entra e fica online');
  await wait(1200);
  await driver.getByRole('switch', { name: 'Ficar online' }).click();
  await driver.getByText('Você está online').waitFor();
  await driver.getByTestId('sim-gps').check(); // carro andando no mapa (simulação)
  await cap(driver, 'Online: o carro aparece no mapa e aguarda corridas');
  await wait(1500);

  // ---------- Passageiro pede corrida ----------
  await go(pass, `${BASE}/passageiro/`, 'App do passageiro');
  await wait(1200);
  await pass.getByRole('button', { name: 'Entrar como passageira demo' }).click();
  await pass.getByRole('button', { name: 'Permitir localização' }).click({ timeout: 15000 });
  await cap(pass, 'Mapa em tela cheia e só o essencial: "Para onde?"');
  await wait(2500);
  await pass.getByTestId('open-search').click();
  await cap(pass, 'Busca do destino');
  await pass.getByTestId('dest-input').pressSequentially('Estação', { delay: 90 });
  await wait(900);
  await pass.getByText(/Ponto de teste B/).click();
  await cap(pass, 'Ajuste o ponto de embarque arrastando o mapa');
  await wait(2200);
  await pass.getByTestId('confirm-pickup').click({ timeout: 10000 });
  await pass.getByTestId('quote-total').waitFor({ timeout: 10000 });
  await cap(pass, 'Preço completo antes de pedir');
  await wait(2500);
  await pass.getByTestId('price-mode-escolher').click();
  await cap(pass, 'Ou escolha o motorista pelo preço de cada um');
  await pass.getByTestId('driver-option').first().waitFor({ timeout: 10000 });
  await wait(1200);
  await pass.getByTestId('driver-option').first().click();
  await wait(2200);
  await pass.getByTestId('price-mode-automatico').click();
  await cap(pass, 'Tarifa automática: vai para qualquer motorista');
  await wait(1500);
  await pass.getByTestId('request-ride').click();
  await pass.getByTestId('searching').waitFor();
  await cap(pass, 'Procurando motorista…');

  // ---------- Motorista recebe e aceita ----------
  await driver.getByTestId('offer-card').waitFor({ timeout: 20000 });
  await cap(driver, 'Nova corrida: valor líquido e só a região do embarque');
  await wait(3000);
  await driver.getByTestId('accept-offer').click();
  await cap(driver, 'Aceitou: endereço exato e atalhos para Waze / Google Maps');
  await driver.getByTestId('driver-advance').waitFor();
  await wait(1500);
  await driver.getByRole('button', { name: 'Estou a caminho' }).click();

  // ---------- Passageiro acompanha ----------
  await pass.getByTestId('driver-card').waitFor({ timeout: 15000 });
  await cap(pass, 'Motorista, carro e placa confirmados');
  await wait(2500);
  await pass.getByTestId('ride-pin').waitFor({ timeout: 10000 });
  await cap(pass, 'PIN da corrida: só o passageiro vê');
  await wait(2500);
  await cap(pass, 'Tempo e distância ao lado do carrinho, ao vivo');
  await cap(driver, 'Indo até o embarque…');
  await wait(9000);

  // ---------- Embarque com PIN ----------
  await driver.getByRole('button', { name: 'Cheguei' }).click();
  await cap(driver, 'Chegou: o app pede o PIN ao passageiro');
  await cap(pass, 'Seu motorista chegou');
  await driver.getByTestId('pin-check').waitFor({ timeout: 10000 });
  await driver.getByTestId('pin-check').scrollIntoViewIfNeeded();
  await wait(1500);
  const aria = await pass.locator('[data-testid=ride-pin] [aria-label^="PIN"]').getAttribute('aria-label');
  const pin = aria.replace(/\D/g, '');
  await driver.getByTestId('pin-input').pressSequentially(pin, { delay: 250 });
  await wait(600);
  await driver.getByTestId('pin-submit').click();
  await cap(driver, 'PIN confirmado: pode iniciar');
  await wait(1800);
  await driver.getByRole('button', { name: 'Iniciar corrida' }).click();
  await cap(driver, 'Corrida em andamento');
  await cap(pass, 'Boa viagem! Acompanhe até o destino');
  await wait(5000);
  await driver.getByRole('button', { name: 'Finalizar corrida' }).click();
  await cap(driver, 'Finalizar pede confirmação (evita toque acidental)');
  await wait(1500);
  await driver.getByRole('button', { name: 'Confirmar: finalizar corrida' }).click();

  // ---------- Pagamento e avaliação ----------
  await pass.getByTestId('pix-panel').waitFor({ timeout: 15000 });
  await cap(pass, 'Recibo e Pix (simulado no piloto)');
  await pass.getByTestId('pix-panel').scrollIntoViewIfNeeded();
  await wait(2000);
  await pass.getByRole('button', { name: 'Ver QR Code de demonstração' }).click();
  await wait(2500);
  await pass.getByRole('button', { name: 'Informar que paguei' }).click();
  await cap(driver, 'Motorista confere e confirma o recebimento');
  await driver.getByRole('button', { name: 'Confirmar recebimento (manual)' }).click({ timeout: 15000 });
  await wait(1500);
  await cap(pass, 'Avaliação do motorista');
  await pass.getByRole('radio', { name: '5 estrelas' }).scrollIntoViewIfNeeded();
  await pass.getByRole('radio', { name: '5 estrelas' }).click();
  await wait(800);
  await pass.getByRole('button', { name: 'Enviar avaliação' }).click();
  await wait(1500);

  // ---------- Extrato, ganhos e configurações ----------
  await go(pass, `${BASE}/passageiro/#/historico`, 'Extrato de corridas');
  await go(driver, `${BASE}/motorista/#/ganhos`, 'Ganhos do motorista');
  await wait(3500);
  await go(driver, `${BASE}/motorista/#/perfil`, 'Preferências: PIN e preço por km');
  await driver.getByTestId('driver-preferences').scrollIntoViewIfNeeded();
  await wait(1200);
  await driver.getByTestId('driver-price-proprio').click();
  await driver.getByTestId('driver-per-km').fill('');
  await driver.getByTestId('driver-per-km').pressSequentially('3,50', { delay: 150 });
  await wait(1200);
  await driver.getByTestId('save-driver-preferences').click();
  await go(pass, `${BASE}/passageiro/#/perfil`, 'Configurações: modo claro, noturno ou automático');
  await wait(1500);
  await pass.getByTestId('theme-dark').click();
  await wait(1800);
  await go(pass, `${BASE}/passageiro/#/`, 'Modo noturno');
  await go(driver, `${BASE}/motorista/#/`, 'Motorista no modo noturno');
  await wait(3500);
  await cap(pass, '');
  await cap(driver, '');
  await wait(500);
} finally {
  await pass.close();
  await driver.close();
}
const vPass = await pass.video().path();
const vDriver = await driver.video().path();
// o modo demo guarda os dados no navegador: o painel admin herda os mesmos dados para mostrar a corrida feita
const state = await ctx.storageState();

// ---------- Painel admin (tela de computador) ----------
const actx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 800 }, locale: 'pt-BR', recordVideo: { dir: resolve(raw, 'admin'), size: { width: 1280, height: 800 } } });
const a = await actx.newPage();
await a.goto(`${BASE}/admin/`);
await cap(a, 'Painel do administrador');
await a.getByRole('button', { name: 'Entrar como admin demo' }).click();
await a.getByLabel('Código de 6 dígitos').fill('123456');
await cap(a, 'Admin entra com verificação em duas etapas');
await wait(1200);
await a.getByRole('button', { name: 'Verificar' }).click();
await a.getByRole('heading', { name: 'Dashboard' }).waitFor();
await cap(a, 'Dashboard do piloto');
await wait(3000);
for (const [link, text] of [
  ['Usuários', 'Aprovação de motoristas'],
  ['Convites', 'Convites para o piloto'],
  ['Tarifas', 'Tarifas editáveis, com histórico de versões'],
  ['Configurações', 'Configurações gerais (inclui limites de preço por km e PIN)'],
]) {
  const l = a.getByRole('link', { name: link });
  if (await l.count()) {
    await l.first().click();
    await cap(a, text);
    await wait(2600);
  }
}
await a.close();
const adminVid = await a.video().path();
await actx.close();
await ctx.close();
await browser.close();
server.kill();

// ---------- Montagem com ffmpeg ----------
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1200;
const H = 1260;
const label = (t, x) => `drawtext=fontfile=${FONT}:text='${t}':fontcolor=0x31466F:fontsize=34:x=${x}-text_w/2:y=34`;
const final = resolve(out, 'leva-ja-demo.mp4');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i', vPass,
    '-i', vDriver,
    '-i', adminVid,
    '-filter_complex',
    [
      `[0:v]scale=540:-2,setsar=1[a]`,
      `[1:v]scale=540:-2,setsar=1[b]`,
      `color=c=0xF3F6F9:s=${W}x${H}:r=25[bg]`,
      `[bg][a]overlay=40:100:shortest=1[t1]`,
      `[t1][b]overlay=620:100,${label('PASSAGEIRO', 310)},${label('MOTORISTA', 890)},fps=25,format=yuv420p[main]`,
      `[2:v]scale=${W}:-2,setsar=1,pad=${W}:${H}:0:(oh-ih)/2:color=0xF3F6F9,drawtext=fontfile=${FONT}:text='ADMIN':fontcolor=0x31466F:fontsize=34:x=(w-text_w)/2:y=34,fps=25,format=yuv420p[adm]`,
      `[main][adm]concat=n=2:v=1:a=0[v]`,
    ].join(';'),
    '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-movflags', '+faststart',
    final,
  ],
  { stdio: 'inherit' },
);
console.log('Vídeo pronto:', final);
