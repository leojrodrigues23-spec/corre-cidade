import { DemoBackend } from './demoBackend';
import { SupabaseBackend } from './supabaseBackend';
import type { AppKind, Backend } from './types';

/**
 * Seleção do backend:
 *  - VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY definidos → Supabase real
 *  - caso contrário → MODO DEMO LOCAL (faixa de aviso visível em todas as telas)
 * A chave "anon" do Supabase é pública por natureza; a segurança vem da RLS + RPC no servidor.
 */
export function createBackend(app: AppKind): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const forceDemo = import.meta.env.VITE_FORCE_DEMO === 'true';
  if (url && key && !forceDemo) return new SupabaseBackend(url, key, app);
  return new DemoBackend(app);
}

export * from './types';
