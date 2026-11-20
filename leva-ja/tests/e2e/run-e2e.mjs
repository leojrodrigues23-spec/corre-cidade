// E2E em MODO DEMO LOCAL: passageiro e motorista em abas separadas do mesmo navegador
// (BroadcastChannel = tempo real entre abas). Valida fluxo completo, manifests e escopos dos SWs.
// Uso: npm run build && node tests/e2e/run-e2e.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shots = resolve(root, 'tests/e2e/screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 4183;
const BASE = `http://localhost:${PORT}`;
const ITUPEVA = { latitude: -23.153, longitude: -47.0577, accuracy: 12 };

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('preview não subiu')), 20000);
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), ok()));
});

let failures = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log('✔', name);
  } catch (e) {
    failures++;
    console.error('✘', name, '\n   ', e.message.split('\n').slice(0, 3).join(' / '));
  }
};
const expect = (c, m) => {
  if (!c) throw new Error(m);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], geolocation: ITUPEVA, permissions: ['geolocation'], locale: 'pt-BR' });
const errors = [];
ctx.on('weberror', (e) => errors.push(e.error().message));

try {
  await step('landing separa perfis', async () => {
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.getByRole('heading', { name: 'Sou Passageiro' }).waitFor();
    await p.getByRole('heading', { name: 'Sou Motorista' }).waitFor();
    expect((await p.locator('a[href="/passageiro/"]').count()) === 1, 'link passageiro');
    expect((await p.locator('a[href="/motorista/"]').count()) === 1, 'link motorista');
    await p.screenshot({ path: `${shots}/01-landing.png`, fullPage: true });
    await p.close();
  });

  await step('manifests independentes (id/scope/start_url/nome/ícones)', async () => {
    const p = await ctx.newPage();
    // caminhos relativos ao próprio manifesto: funcionam em domínio próprio e em subpasta (GitHub Pages)
    const load = async (app) => {
      const url = `${BASE}/${app}/manifest.webmanifest`;
      const m = await (await p.goto(url)).json();
      const abs = (x) => new URL(x, url).pathname;
      return { ...m, id: abs(m.id), scope: abs(m.scope), start_url: abs(m.start_url), icons: m.icons.map((i) => ({ ...i, src: abs(i.src) })) };
    };
    const m1 = await load('passageiro');
    const m2 = await load('motorista');
    expect(m1.name === 'Leva Já' && m2.name === 'Leva Já Motorista', 'nomes');
    expect(m1.id !== m2.id && m1.scope === '/passageiro/' && m2.scope === '/motorista/', 'escopos distintos');
    expect(m1.start_url.startsWith(m1.scope) && m2.start_url.startsWith(m2.scope), 'start_url dentro do escopo');
    for (const m of [m1, m2]) {
      expect(m.display === 'standalone', 'standalone');
      expect(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'), 'ícones');
      for (const i of m.icons) expect((await p.goto(BASE + i.src)).ok(), 'ícone ' + i.src);
    }
    await p.close();
  });

  const driver = await ctx.newPage();
  const pass = await ctx.newPage();

  await step('SW do motorista registrado só no escopo /motorista/', async () => {
    await driver.goto(BASE + '/motorista/');
    const scope = await driver.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope === `${BASE}/motorista/`, scope);
  });

  await step('motorista: login demo, consentimento e disponibilidade', async () => {
    await driver.getByTestId('demo-ribbon').waitFor();
    await driver.getByRole('button', { name: 'Entrar como motorista demo' }).click();
    await driver.getByRole('button', { name: 'Autorizar e continuar' }).click();
    await driver.getByRole('switch', { name: 'Ficar online' }).click();
    await driver.getByText('Você está online').waitFor();
    await driver.getByText(/Enviado há/).waitFor({ timeout: 15000 });
    await driver.screenshot({ path: `${shots}/02-motorista-disponivel.png` });
  });

  await step('SW do passageiro registrado só no escopo /passageiro/', async () => {
    await pass.goto(BASE + '/passageiro/');
    const scope = await pass.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope === `${BASE}/passageiro/`, scope);
  });

  await step('sessões separadas por app (passageiro não herda login do motorista)', async () => {
    await pass.getByRole('button', { name: 'Entrar como passageira demo' }).waitFor();
  });

  await step('passageiro: busca, confirma embarque, vê preço e solicita', async () => {
    await pass.getByRole('button', { name: 'Entrar como passageira demo' }).click();
    await pass.getByRole('button', { name: 'Permitir localização' }).click();
    await pass.getByText(/GPS bom/).first().waitFor({ timeout: 10000 });
    await pass.getByTestId('open-search').click();
    await pass.getByTestId('dest-input').fill('Estação');
    await pass.getByText(/Ponto de teste B/).click();
    await pass.getByTestId('confirm-pickup').click({ timeout: 10000 });
    const total = await pass.getByTestId('quote-total').textContent({ timeout: 10000 });
    expect(/R\$\s?\d+,\d{2}/.test(total), 'total ' + total);
    await pass.getByText('Detalhamento do preço').waitFor();
    await pass.screenshot({ path: `${shots}/03-passageiro-cotacao.png` });
    // escolher motorista pelo preço: lista com o motorista disponível e o preço dele
    await pass.getByTestId('price-mode-escolher').click();
    await pass.getByTestId('driver-option').first().waitFor({ timeout: 10000 });
    await pass.getByTestId('driver-option').first().click();
    await pass.getByRole('button', { name: /Pedir com/ }).waitFor();
    await pass.screenshot({ path: `${shots}/03b-passageiro-escolher-motorista.png` });
    await pass.getByTestId('price-mode-automatico').click();
    await pass.getByTestId('request-ride').click();
    await pass.getByTestId('searching').waitFor();
    await pass.screenshot({ path: `${shots}/04-passageiro-procurando.png` });
  });

  await step('motorista recebe oferta em tempo real (só região aproximada) e aceita', async () => {
    await driver.getByTestId('offer-card').waitFor({ timeout: 15000 });
    await driver.getByText('Endereço exato liberado após aceitar.', { exact: false }).waitFor();
    await driver.screenshot({ path: `${shots}/05-motorista-oferta.png` });
    await driver.getByTestId('accept-offer').click();
    await driver.getByTestId('driver-advance').waitFor();
  });

  await step('passageiro vê motorista, veículo e posição ao vivo', async () => {
    await pass.getByTestId('driver-card').waitFor({ timeout: 15000 });
    await pass.getByText('DEM0A00').waitFor();
    await pass.getByText(/Posição ao vivo|Aguardando a posição|Último sinal/).waitFor({ timeout: 15000 });
    await pass.getByTestId('ride-pin').waitFor({ timeout: 10000 });
    await pass.getByTestId('driver-eta-badge').waitFor({ timeout: 15000 });
    const badge = await pass.getByTestId('driver-eta-badge').textContent();
    expect(/\d+ min · \d/.test(badge), 'etiqueta do carrinho ' + badge);
    await pass.screenshot({ path: `${shots}/06-passageiro-motorista-a-caminho.png` });
  });

  await step('estado sobrevive a recarregar a página', async () => {
    await pass.reload();
    await pass.getByTestId('driver-card').waitFor({ timeout: 15000 });
  });

  await step('motorista: a caminho → chegou → PIN → iniciar → finalizar (com confirmação)', async () => {
    for (const label of ['Estou a caminho', 'Cheguei']) {
      await driver.getByRole('button', { name: label }).waitFor({ timeout: 10000 });
      await driver.getByTestId('driver-advance').click();
    }
    // sem PIN o botão de iniciar nem aparece; PIN errado é recusado; PIN certo libera
    await driver.getByTestId('pin-check').waitFor({ timeout: 10000 });
    const aria = await pass.locator('[data-testid=ride-pin] [aria-label^="PIN"]').getAttribute('aria-label');
    const pin = aria.replace(/\D/g, '');
    expect(/^\d{4}$/.test(pin), 'pin ' + aria);
    await driver.getByTestId('pin-input').fill(pin === '0000' ? '1111' : '0000');
    await driver.getByTestId('pin-submit').click();
    await driver.getByText(/PIN incorreto/).waitFor({ timeout: 10000 });
    await driver.screenshot({ path: `${shots}/06b-motorista-pin.png` });
    await driver.getByTestId('pin-input').fill(pin);
    await driver.getByTestId('pin-submit').click();
    for (const label of ['Iniciar corrida', 'Finalizar corrida', 'Confirmar: finalizar corrida']) {
      const b = driver.getByTestId('driver-advance');
      await driver.getByRole('button', { name: label }).waitFor({ timeout: 10000 });
      await b.click();
    }
    await driver.getByText('Resumo financeiro (simulado)').waitFor({ timeout: 10000 });
    await driver.screenshot({ path: `${shots}/07-motorista-finalizada.png`, fullPage: true });
  });

  await step('passageiro: recibo + Pix SIMULADO + informar pagamento', async () => {
    await pass.getByTestId('pix-panel').waitFor({ timeout: 15000 });
    await pass.getByText('SIMULAÇÃO — não pague').waitFor();
    await pass.getByRole('button', { name: 'Ver QR Code de demonstração' }).click();
    await pass.getByText('Simulação · não pague').waitFor();
    await pass.getByRole('button', { name: 'Informar que paguei' }).click();
    await pass.getByText('Passageiro informou pagamento').first().waitFor({ timeout: 10000 });
    await pass.getByTestId('pix-panel').scrollIntoViewIfNeeded();
    await pass.screenshot({ path: `${shots}/08-passageiro-pix-simulado.png` });
  });

  await step('motorista confirma recebimento manualmente', async () => {
    await driver.getByRole('button', { name: 'Confirmar recebimento (manual)' }).click({ timeout: 15000 });
    await driver.getByText('Confirmado manualmente').waitFor({ timeout: 10000 });
  });

  await step('passageiro avalia a corrida', async () => {
    await pass.getByRole('radio', { name: '5 estrelas' }).click();
    await pass.getByRole('button', { name: 'Enviar avaliação' }).click();
    await pass.getByText('Obrigado!').waitFor();
  });

  await step('admin: MFA obrigatório, dashboard e distribuição sem URL pública', async () => {
    const a = await ctx.newPage();
    await a.setViewportSize({ width: 1280, height: 860 });
    await a.goto(BASE + '/admin/');
    await a.getByRole('button', { name: 'Entrar como admin demo' }).click();
    await a.getByText('Verificação em duas etapas').waitFor();
    await a.getByLabel('Código de 6 dígitos').fill('123456');
    await a.getByRole('button', { name: 'Verificar' }).click();
    await a.getByRole('heading', { name: 'Dashboard' }).waitFor();
    await a.getByText('Finalizadas (30d)').waitFor();
    await a.screenshot({ path: `${shots}/09-admin-dashboard.png` });
    await a.getByRole('link', { name: 'Distribuição' }).click();
    await a.getByText('Defina a URL pública primeiro').waitFor();
    await a.getByRole('link', { name: 'Tarifas' }).click();
    await a.getByText('Simulação: 6 km, 15 min').waitFor();
    await a.getByText('R$ 22,25').first().waitFor();
    await a.screenshot({ path: `${shots}/10-admin-tarifas.png` });
    await a.close();
  });

  await step('motorista: preferências de PIN e preço próprio por km', async () => {
    await driver.goto(`${BASE}/motorista/#/perfil`);
    await driver.getByTestId('driver-preferences').waitFor({ timeout: 10000 });
    await driver.getByTestId('driver-price-proprio').click();
    await driver.getByTestId('driver-per-km').fill('3,50');
    await driver.getByTestId('save-driver-preferences').click();
    await driver.getByText('Preferências salvas').waitFor({ timeout: 10000 });
    await driver.getByTestId('driver-preferences').scrollIntoViewIfNeeded();
    await driver.screenshot({ path: `${shots}/11-motorista-preferencias.png` });
  });

  await step('visual: mapa em destaque, configurações e modo noturno', async () => {
    await pass.goto(`${BASE}/passageiro/#/`);
    await pass.reload();
    await pass.getByTestId('open-search').waitFor({ timeout: 10000 });
    await pass.waitForTimeout(500);
    await pass.screenshot({ path: `${shots}/12-passageiro-inicio.png` });
    await pass.goto(`${BASE}/passageiro/#/historico`);
    await pass.getByText('Movimentações').waitFor({ timeout: 10000 });
    await pass.waitForTimeout(500);
    await pass.screenshot({ path: `${shots}/13-passageiro-extrato.png` });
    await pass.goto(`${BASE}/passageiro/#/perfil`);
    await pass.getByTestId('theme-dark').click();
    await pass.waitForTimeout(500);
    await pass.screenshot({ path: `${shots}/16-passageiro-configuracoes-noturno.png` });
    await pass.goto(`${BASE}/passageiro/#/`);
    await pass.getByTestId('open-search').waitFor({ timeout: 10000 });
    await pass.waitForTimeout(500);
    await pass.screenshot({ path: `${shots}/17-passageiro-inicio-noturno.png` });
    await pass.goto(`${BASE}/passageiro/#/perfil`);
    await pass.getByTestId('theme-light').click();
    await driver.goto(`${BASE}/motorista/#/`);
    await driver.reload();
    await driver.getByTestId('today-earnings').waitFor({ timeout: 10000 });
    await driver.waitForTimeout(500);
    await driver.screenshot({ path: `${shots}/14-motorista-inicio.png` });
    await driver.goto(`${BASE}/motorista/#/ganhos`);
    await driver.getByText('Líquido no período').waitFor({ timeout: 10000 });
    await driver.waitForTimeout(500);
    await driver.screenshot({ path: `${shots}/15-motorista-ganhos.png` });
  });

  await step('sem erros de JavaScript nas páginas', async () => expect(errors.length === 0, errors.join(' | ')));
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `\n${failures} falha(s)` : '\nTodos os passos E2E passaram');
process.exit(failures ? 1 : 0);
