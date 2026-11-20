import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carimba um BUILD_ID nos service workers: cada deploy muda o SW e dispara o aviso "Nova versão disponível".
function stampServiceWorkers() {
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  let outDir = resolve(__dirname, 'dist');
  return {
    name: 'levaja-stamp-sw',
    apply: 'build' as const,
    configResolved(c: { root: string; build: { outDir: string } }) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const app of ['passageiro', 'motorista']) {
        const f = resolve(outDir, app, 'sw.js');
        if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replace('__BUILD_ID__', id));
      }
    },
  };
}

// Uma única build gera 4 entradas HTML independentes:
//   /            landing pública
//   /passageiro/ PWA "Leva Já"
//   /motorista/  PWA "Leva Já Motorista"
//   /admin/      painel administrativo (não instalável)
// Cada PWA tem manifest e service worker próprios em public/<perfil>/.
export default defineConfig({
  // Endereço base: '/' (domínio próprio) ou '/corre-cidade/' (GitHub Pages). Defina LEVAJA_BASE no build.
  base: process.env.LEVAJA_BASE || '/',
  plugins: [react(), stampServiceWorkers()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        passageiro: resolve(__dirname, 'passageiro/index.html'),
        motorista: resolve(__dirname, 'motorista/index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
  },
} as never);
