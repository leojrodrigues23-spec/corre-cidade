/**
 * Qualidade e plausibilidade de localização.
 * Regras: nunca inventar coordenadas, nunca apresentar posição antiga como atual,
 * descartar saltos fisicamente impossíveis, suavizar apenas a ANIMAÇÃO (o dado guardado é o real).
 */
export interface LatLng {
  lat: number;
  lng: number;
}
export interface GeoFix extends LatLng {
  accuracy: number; // metros (raio 68%)
  timestamp: number; // ms epoch (do dispositivo)
  speed?: number | null; // m/s
  heading?: number | null;
}

export type FixQuality = 'bom' | 'moderado' | 'fraco' | 'ruim';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0);
}

export function qualityOf(accuracyM: number): FixQuality {
  if (accuracyM <= 20) return 'bom';
  if (accuracyM <= 50) return 'moderado';
  if (accuracyM <= 150) return 'fraco';
  return 'ruim';
}

export const QUALITY_LABEL: Record<FixQuality, string> = {
  bom: 'GPS bom',
  moderado: 'GPS moderado',
  fraco: 'GPS fraco',
  ruim: 'GPS muito impreciso',
};

export interface FixAssessment {
  quality: FixQuality;
  ageMs: number;
  stale: boolean;
  label: string;
}

export function assessFix(fix: GeoFix, now: number, maxAgeMs = 30_000): FixAssessment {
  const ageMs = Math.max(0, now - fix.timestamp);
  const quality = qualityOf(fix.accuracy);
  const stale = ageMs > maxAgeMs;
  return { quality, ageMs, stale, label: stale ? `Localização desatualizada (${formatAge(ageMs)})` : `${QUALITY_LABEL[quality]} · ±${Math.round(fix.accuracy)} m` };
}

export function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}

/**
 * Filtro de plausibilidade: rejeita leituras que exigiriam velocidade impossível,
 * descontando a incerteza das duas leituras. Não altera coordenadas aceitas.
 */
export class PlausibilityFilter {
  private last: GeoFix | null = null;
  constructor(
    private maxSpeedMs = 55, // ~200 km/h
    private maxAccuracyM = 500,
  ) {}

  accept(fix: GeoFix): { accepted: boolean; reason?: string } {
    if (!isValidLatLng(fix)) return { accepted: false, reason: 'coordenada inválida' };
    if (!Number.isFinite(fix.accuracy) || fix.accuracy <= 0) return { accepted: false, reason: 'precisão ausente' };
    if (fix.accuracy > this.maxAccuracyM) return { accepted: false, reason: 'precisão muito baixa' };
    const prev = this.last;
    if (prev) {
      if (fix.timestamp <= prev.timestamp) return { accepted: false, reason: 'leitura fora de ordem' };
      const dt = (fix.timestamp - prev.timestamp) / 1000;
      const d = haversineM(prev, fix);
      const effective = Math.max(0, d - prev.accuracy - fix.accuracy);
      if (effective / dt > this.maxSpeedMs) return { accepted: false, reason: 'salto impossível' };
    }
    this.last = fix;
    return { accepted: true };
  }

  reset() {
    this.last = null;
  }
}

/**
 * Decide quando enviar a posição do motorista ao servidor (frequência adaptativa + throttling).
 * - em corrida: a cada 4 s se moveu >= 15 m, ou no máximo a cada 15 s parado (heartbeat)
 * - disponível sem corrida: a cada 30 s ou movimento >= 150 m
 */
export function shouldSendLocation(opts: {
  mode: 'corrida' | 'disponivel';
  last: (GeoFix & { sentAt: number }) | null;
  fix: GeoFix;
  now: number;
}): boolean {
  const { mode, last, fix, now } = opts;
  if (!last) return true;
  const elapsed = now - last.sentAt;
  const moved = haversineM(last, fix);
  if (mode === 'corrida') {
    if (elapsed < 4000) return false;
    return moved >= 15 || elapsed >= 15_000;
  }
  if (elapsed < 10_000) return false;
  return moved >= 150 || elapsed >= 30_000;
}

/** Interpolação linear só para animação do marcador. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}

/** Decodificador de polyline codificada (formato Google). */
export function decodePolyline(encoded: string): LatLng[] {
  const pts: LatLng[] = [];
  let index = 0,
    lat = 0,
    lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1]) {
      let result = 0,
        shift = 0,
        b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

export function encodePolyline(points: LatLng[]): string {
  let out = '',
    pLat = 0,
    pLng = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  for (const p of points) {
    const la = Math.round(p.lat * 1e5),
      ln = Math.round(p.lng * 1e5);
    out += enc(la - pLat) + enc(ln - pLng);
    pLat = la;
    pLng = ln;
  }
  return out;
}

/** Arredonda coordenada para exibir só a região aproximada (~110 m com 3 casas). */
export function coarsen(p: LatLng, decimals = 3): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}

/** Ponto dentro de polígono (ray casting) — área atendida. */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}
