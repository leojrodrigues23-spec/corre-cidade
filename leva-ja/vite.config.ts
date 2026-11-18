import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Uma única build gera 4 entradas HTML independentes:
//   /            landing pública
//   /passageiro/ PWA "Leva Já"
//   /motorista/  PWA "Leva Já Motorista"
//   /admin/      painel administrativo (não instalável)
// Cada PWA tem manifest e service worker próprios em public/<perfil>/.
export default defineConfig({
  plugins: [react()],
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
  },
} as never);
