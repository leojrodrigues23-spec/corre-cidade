// Gera os ícones PNG dos dois PWAs a partir do símbolo simplificado (pino + carro / pino + volante).
// Uso: node scripts/generate-icons.mjs   (usa o Chromium do Playwright)
import { createRequire } from 'node:module';
// Playwright pré-instalado globalmente (require resolve via NODE_PATH); em outra máquina: npm i -D playwright
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function symbol(variant) {
  const inner =
    variant === 'passageiro'
      ? `<g fill="#fff"><path d="M26.4 16.5h11.2c.9 0 1.7.6 2 1.4l1.9 4.6h1c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H42v1.6a1.4 1.4 0 0 1-2.8 0V32H24.8v1.6a1.4 1.4 0 0 1-2.8 0V32h-.5c-.8 0-1.5-.7-1.5-1.5v-6c0-.8.7-1.5 1.5-1.5h1l1.9-4.6c.3-.8 1.1-1.4 2-1.4z"/><path d="M26.9 22.5l1.4-3.6h7.4l1.4 3.6z" fill="#102A43"/><circle cx="25.2" cy="27" r="1.7" fill="#102A43"/><circle cx="38.8" cy="27" r="1.7" fill="#102A43"/><rect x="29.5" y="28.6" width="5" height="1.6" rx=".8" fill="#102A43"/></g>`
      : `<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><circle cx="32" cy="26" r="8.5"/><circle cx="32" cy="26" r="2" fill="#fff"/><path d="M23.8 24.5h6.2M34 24.5h6.2M32 28v6.4"/></g>`;
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9BE33A"/><stop offset="1" stop-color="#00C896"/></linearGradient></defs>
<path d="M32 3C19.3 3 9 13.3 9 26c0 16 19.4 31.4 21.2 32.8a3 3 0 0 0 3.6 0C35.6 57.4 55 42 55 26 55 13.3 44.7 3 32 3z" fill="url(#g)"/>
<circle cx="32" cy="26" r="15" fill="#102A43"/>${inner}`;
}

// any: fundo arredondado; maskable: fundo cheio e símbolo dentro da zona segura (80%)
function iconSvg(variant, { maskable = false, rounded = true } = {}) {
  const bg = variant === 'motorista' ? '#0A1B2C' : '#102A43';
  const scale = maskable ? 0.58 : 0.74;
  const size = 64 * scale;
  const off = (64 - size) / 2;
  const band = variant === 'motorista' ? `<rect x="0" y="${maskable ? 50 : 52}" width="64" height="${maskable ? 4 : 12}" fill="#00C896" opacity="${maskable ? 0 : 1}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
<defs><clipPath id="c"><rect width="64" height="64" rx="${rounded && !maskable ? 14 : 0}"/></clipPath></defs>
<g clip-path="url(#c)"><rect width="64" height="64" fill="${bg}"/>${band}</g>
<g transform="translate(${off} ${off - (variant === 'motorista' && !maskable ? 3 : 0)}) scale(${scale})">${symbol(variant)}</g></svg>`;
}

const targets = [];
for (const v of ['passageiro', 'motorista']) {
  targets.push([v, 'icon-512.png', 512, iconSvg(v)]);
  targets.push([v, 'icon-192.png', 192, iconSvg(v)]);
  targets.push([v, 'maskable-512.png', 512, iconSvg(v, { maskable: true })]);
  targets.push([v, 'apple-touch-icon.png', 180, iconSvg(v, { rounded: false })]);
  targets.push([v, 'favicon-32.png', 32, iconSvg(v)]);
  writeFileSync(resolve(root, `public/icons/${v}-icon.svg`), iconSvg(v));
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [v, name, px, svg] of targets) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${px}" height="${px}"`)}</body></html>`);
  const dir = resolve(root, 'public/icons', v);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  console.log('✔', v, name);
}
await browser.close();
