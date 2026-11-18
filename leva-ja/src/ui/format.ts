export { formatBRL } from '../core/money';

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

const dt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const tm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dt.format(new Date(iso)) : '—';
}
export function formatTime(iso: string | null | undefined): string {
  return iso ? tm.format(new Date(iso)) : '—';
}

export function centsFromInput(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function centsToInput(c: number): string {
  return (c / 100).toFixed(2).replace('.', ',');
}

/** Velocidade média urbana usada nas estimativas locais (sem chamar API paga a cada sinal de GPS). */
export const URBAN_SPEED_MS = 25000 / 3600;

/** Etiqueta curta para o carrinho no mapa: "4 min · 850 m" / "12 min · 3,4 km". */
export function formatEtaBadge(distanceM: number): string {
  const d = distanceM < 1000 ? Math.max(10, Math.round(distanceM / 10) * 10) : distanceM;
  return `${formatDuration(distanceM / URBAN_SPEED_MS)} · ${formatDistance(d)}`;
}
