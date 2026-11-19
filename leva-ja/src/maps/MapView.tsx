import { useEffect, useRef, useState } from 'react';
import { type LatLng, lerpLatLng } from '../core/geo';
import { Icon } from '../ui/icons';
import { GOOGLE_MAP_ID, hasGoogleMaps, loadGoogleMaps } from './google';

export interface MapMarker {
  id: string;
  position: LatLng;
  kind: 'pickup' | 'dest' | 'driver' | 'me';
  accuracyM?: number | null;
  stale?: boolean;
  label?: string;
  /** etiqueta exibida ao lado do marcador (ex.: "4 min · 1,2 km" do motorista chegando) */
  badge?: string | null;
}

export interface MapViewProps {
  center: LatLng;
  zoom?: number;
  markers: MapMarker[];
  path?: LatLng[] | null;
  /** muda quando o mapa deve reenquadrar todos os marcadores */
  fitKey?: string;
  /** modo "pino fixo no centro": usuário arrasta o mapa para ajustar o ponto de embarque */
  pickMode?: boolean;
  onPick?: (p: LatLng) => void;
  className?: string;
  dark?: boolean;
  /** mapa pequeno (dentro de um cartão): avisos ficam no canto, não abaixo do cabeçalho */
  compact?: boolean;
}

const COLORS = { pickup: '#00C896', dest: '#102A43', driver: '#00C896', me: '#2F80ED' };

export function MapView(props: MapViewProps) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const onFail = () => setFailed('A chave do Google Maps foi recusada para este domínio. Usando mapa simulado.');
    window.addEventListener('levaja:maps-auth-failure', onFail);
    return () => window.removeEventListener('levaja:maps-auth-failure', onFail);
  }, []);
  if (hasGoogleMaps() && !failed) return <GoogleMap {...props} onFail={setFailed} />;
  return <SimulatedMap {...props} reason={failed} />;
}

// ======================= Google Maps =======================
function markerIcon(kind: MapMarker['kind'], stale?: boolean): google.maps.Symbol | google.maps.Icon {
  const color = stale ? '#94A3B8' : COLORS[kind];
  if (kind === 'driver') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="${color}" stroke="#fff" stroke-width="3"/><path fill="#fff" d="M15 25v-4l2-5h10l2 5v4zM14.5 25h15v3h-15z"/></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(40, 40), anchor: new google.maps.Point(20, 20) };
  }
  if (kind === 'me') return { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46"><path d="M18 1C8.6 1 1 8.6 1 18c0 12.4 15.2 25.4 16 26.1.6.5 1.4.5 2 0C19.8 43.4 35 30.4 35 18 35 8.6 27.4 1 18 1z" fill="${color}" stroke="#fff" stroke-width="2"/><circle cx="18" cy="18" r="6" fill="#fff"/></svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(32, 41), anchor: new google.maps.Point(16, 41) };
}

/** Etiqueta em forma de pílula, desenhada como imagem para acompanhar o marcador no Google Maps. */
function badgeIcon(text: string): google.maps.Icon {
  const w = Math.round(text.length * 7.4 + 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" viewBox="0 0 ${w} 28"><rect x="1" y="1" width="${w - 2}" height="26" rx="13" fill="#0A1B2C" stroke="#00C896" stroke-width="2"/><text x="${w / 2}" y="18.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="13" font-weight="800" fill="#ffffff">${text.replace(/[<&>]/g, '')}</text></svg>`;
  // ancorado à esquerda do centro: a pílula fica à direita do carrinho
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(w, 28), anchor: new google.maps.Point(-26, 14) };
}

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#132a3f' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9fb3c8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1b2c' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#243b53' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1b2c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

function GoogleMap({ center, zoom = 15, markers, path, fitKey, pickMode, onPick, className, dark, onFail }: MapViewProps & { onFail: (r: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const objs = useRef(new Map<string, { marker: google.maps.Marker; badge?: google.maps.Marker; circle?: google.maps.Circle; shown: LatLng; anim?: number }>());
  const line = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !el.current) return;
        map.current = new g.maps.Map(el.current, {
          center,
          zoom,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
          ...(GOOGLE_MAP_ID ? { mapId: GOOGLE_MAP_ID } : { styles: dark ? DARK_STYLE : undefined }),
        });
        map.current.addListener('idle', () => {
          const c = map.current!.getCenter();
          if (c) onPickRef.current?.({ lat: c.lat(), lng: c.lng() });
        });
        setReady(true);
      })
      .catch((e: Error) => onFail(e.message === 'GOOGLE_MAPS_NOT_CONFIGURED' ? 'Google Maps não configurado.' : 'Falha ao carregar o Google Maps. Usando mapa simulado.'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && !GOOGLE_MAP_ID) map.current?.setOptions({ styles: dark ? DARK_STYLE : null });
  }, [dark, ready]);

  // marcadores: anima SÓ o desenho entre a posição exibida e a nova posição real
  useEffect(() => {
    if (!ready || !map.current) return;
    const seen = new Set<string>();
    for (const m of pickMode ? markers.filter((x) => x.kind !== 'pickup') : markers) {
      seen.add(m.id);
      let o = objs.current.get(m.id);
      if (!o) {
        const marker = new google.maps.Marker({ map: map.current, position: m.position, icon: markerIcon(m.kind, m.stale), title: m.label, zIndex: m.kind === 'driver' ? 10 : 5 });
        o = { marker, shown: m.position };
        objs.current.set(m.id, o);
      } else {
        o.marker.setIcon(markerIcon(m.kind, m.stale));
        const from = o.shown;
        const to = m.position;
        if (o.anim) cancelAnimationFrame(o.anim);
        const start = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - start) / 900);
          const p = lerpLatLng(from, to, k);
          o!.marker.setPosition(p);
          o!.badge?.setPosition(p);
          o!.shown = p;
          if (k < 1) o!.anim = requestAnimationFrame(step);
        };
        o.anim = requestAnimationFrame(step);
      }
      if (m.badge) {
        if (!o.badge) o.badge = new google.maps.Marker({ map: map.current, position: o.shown, clickable: false, zIndex: 11 });
        o.badge.setIcon(badgeIcon(m.badge));
      } else if (o.badge) {
        o.badge.setMap(null);
        o.badge = undefined;
      }
      if (m.accuracyM && (m.kind === 'driver' || m.kind === 'me')) {
        if (!o.circle) o.circle = new google.maps.Circle({ map: map.current, strokeColor: COLORS[m.kind], strokeOpacity: 0.5, strokeWeight: 1, fillColor: COLORS[m.kind], fillOpacity: 0.12, clickable: false });
        o.circle.setCenter(m.position);
        o.circle.setRadius(m.accuracyM);
      } else if (o.circle) {
        o.circle.setMap(null);
        o.circle = undefined;
      }
    }
    for (const [id, o] of objs.current) {
      if (!seen.has(id)) {
        o.marker.setMap(null);
        o.badge?.setMap(null);
        o.circle?.setMap(null);
        objs.current.delete(id);
      }
    }
  }, [markers, ready, pickMode]);

  useEffect(() => {
    if (!ready || !map.current) return;
    line.current?.setMap(null);
    line.current = path && path.length > 1 ? new google.maps.Polyline({ map: map.current, path, strokeColor: '#00C896', strokeWeight: 5, strokeOpacity: 0.9 }) : null;
  }, [path, ready]);

  useEffect(() => {
    if (!ready || !map.current || !fitKey) return;
    const pts = [...markers.map((m) => m.position), ...(path ?? [])];
    if (pts.length >= 2) {
      const b = new google.maps.LatLngBounds();
      pts.forEach((p) => b.extend(p));
      map.current.fitBounds(b, { top: 80, bottom: 320, left: 40, right: 40 });
    } else if (pts.length === 1) map.current.panTo(pts[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  useEffect(() => {
    if (ready && pickMode) map.current?.panTo(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode, ready]);

  return (
    <div className={`${className?.includes('absolute') ? '' : 'relative'} ${className ?? ''}`}>
      <div ref={el} className="absolute inset-0" aria-label="Mapa" role="application" />
      {!ready && <div className="absolute inset-0 animate-pulse bg-navy/5 dark:bg-white/5" />}
      {pickMode && <CenterPin />}
    </div>
  );
}

function CenterPin() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full" aria-hidden="true">
      <svg width="40" height="52" viewBox="0 0 36 46" className="drop-shadow-lg">
        <path d="M18 1C8.6 1 1 8.6 1 18c0 12.4 15.2 25.4 16 26.1.6.5 1.4.5 2 0C19.8 43.4 35 30.4 35 18 35 8.6 27.4 1 18 1z" fill="#00C896" stroke="#fff" strokeWidth="2" />
        <circle cx="18" cy="18" r="6" fill="#fff" />
      </svg>
      <div className="mx-auto mt-0.5 h-1.5 w-3 rounded-full bg-navy/30" />
    </div>
  );
}

// ======================= Mapa simulado (sem chave) =======================
const mPerPx = (lat: number, z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function SimulatedMap({ center, zoom = 15, markers, path, pickMode, onPick, className, reason, fitKey, compact }: MapViewProps & { reason?: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  const [view, setView] = useState({ c: center, z: zoom });
  const drag = useRef<{ x: number; y: number; c: LatLng } | null>(null);
  const [shown, setShown] = useState<Record<string, LatLng>>({});

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fitKey) return;
    const pts = [...markers.map((m) => m.position), ...(path ?? [])];
    if (pts.length === 0) return;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    let z = 16;
    const spanM = Math.max((Math.max(...lats) - Math.min(...lats)) * 111_320, (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((c.lat * Math.PI) / 180));
    while (z > 10 && spanM / mPerPx(c.lat, z) > Math.min(size.w, size.h) * 0.55) z--;
    setView({ c, z });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (!pickMode) return;
    setView((v) => ({ ...v, c: center }));
    onPick?.(center); // informa o ponto inicial do pino sem exigir arraste
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode, center.lat, center.lng]);

  // animação visual suave do marcador (o dado real não é alterado)
  useEffect(() => {
    const start = performance.now();
    const from = { ...shown };
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const next: Record<string, LatLng> = {};
      for (const m of markers) next[m.id] = from[m.id] ? lerpLatLng(from[m.id], m.position, k) : m.position;
      setShown(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  const scale = mPerPx(view.c.lat, view.z);
  const project = (p: LatLng) => ({
    x: size.w / 2 + ((p.lng - view.c.lng) * 111_320 * Math.cos((view.c.lat * Math.PI) / 180)) / scale,
    y: size.h / 2 - ((p.lat - view.c.lat) * 111_320) / scale,
  });
  const unproject = (dx: number, dy: number, c: LatLng): LatLng => ({
    lat: c.lat + (dy * scale) / 111_320,
    lng: c.lng - (dx * scale) / (111_320 * Math.cos((c.lat * Math.PI) / 180)),
  });

  // cidade estilizada (puramente ilustrativa): quarteirões, praças e avenidas que acompanham o arraste
  const grid = 128;
  const offX = (((size.w / 2 - (view.c.lng * 111_320 * Math.cos((view.c.lat * Math.PI) / 180)) / scale) % grid) + grid) % grid;
  const offY = (((size.h / 2 + (view.c.lat * 111_320) / scale) % grid) + grid) % grid;

  return (
    <div
      ref={box}
      className={`${className?.includes('absolute') ? '' : 'relative'} touch-none select-none overflow-hidden bg-[#dfe8e2] dark:bg-[#0c2236] ${className ?? ''}`}
      role="application"
      aria-label="Mapa simulado"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, c: view.c };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setView((v) => ({ ...v, c: unproject(e.clientX - drag.current!.x, e.clientY - drag.current!.y, drag.current!.c) }));
      }}
      onPointerUp={() => {
        drag.current = null;
        onPick?.(view.c);
      }}
      onWheel={(e) => setView((v) => ({ ...v, z: Math.max(10, Math.min(19, v.z + (e.deltaY < 0 ? 1 : -1))) }))}
    >
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <pattern id="lj-city" width={grid} height={grid} patternUnits="userSpaceOnUse" x={offX} y={offY}>
            <rect width={grid} height={grid} className="fill-white dark:fill-[#1a3a5c]" />
            <rect x="6" y="6" width="54" height="54" rx="8" className="fill-[#eef1f4] dark:fill-[#10304d]" />
            <rect x="68" y="6" width="54" height="54" rx="8" className="fill-[#c9ecd2] dark:fill-[#0f3d3a]" />
            <circle cx="95" cy="33" r="9" className="fill-[#b3e3c0] dark:fill-[#12504a]" />
            <rect x="6" y="68" width="54" height="54" rx="8" className="fill-[#f3eee6] dark:fill-[#132f4a]" />
            <rect x="68" y="68" width="54" height="54" rx="8" className="fill-[#eef1f4] dark:fill-[#10304d]" />
            <rect x="14" y="14" width="18" height="14" rx="3" className="fill-[#e2e7ec] dark:fill-[#163a5c]" />
            <rect x="78" y="80" width="22" height="16" rx="3" className="fill-[#e2e7ec] dark:fill-[#163a5c]" />
            <path d={`M 0 ${grid - 1} H ${grid}`} className="stroke-[#ffd66b] dark:stroke-[#b8892a]" strokeWidth="3" opacity=".7" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#lj-city)" />
        {path && path.length > 1 && <polyline points={path.map((p) => `${project(p).x},${project(p).y}`).join(' ')} fill="none" stroke="#00C896" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 8" />}
        {markers.map((m) => {
          const p = project(shown[m.id] ?? m.position);
          return m.accuracyM && (m.kind === 'driver' || m.kind === 'me') ? <circle key={`acc-${m.id}`} cx={p.x} cy={p.y} r={Math.max(6, m.accuracyM / scale)} fill={COLORS[m.kind]} fillOpacity="0.14" stroke={COLORS[m.kind]} strokeOpacity="0.5" /> : null;
        })}
      </svg>
      {markers
        .filter((m) => !(pickMode && m.kind === 'pickup'))
        .map((m) => {
          const p = project(shown[m.id] ?? m.position);
          const color = m.stale ? '#94A3B8' : COLORS[m.kind];
          if (m.kind === 'driver' || m.kind === 'me')
            return (
              <div key={m.id} className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white shadow-lg ${m.kind === 'driver' && !m.stale ? 'lj-pulse' : ''}`} style={{ left: p.x, top: p.y, width: m.kind === 'driver' ? 38 : 18, height: m.kind === 'driver' ? 38 : 18, background: color }} title={m.label}>
                {m.kind === 'driver' && <Icon name="car" size={18} className="relative z-10 text-white" />}
                {m.badge && (
                  <span className="absolute left-[calc(100%+6px)] top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-full bg-navy-950 px-2.5 py-1 text-xs font-extrabold tabular-nums text-white shadow-float ring-2 ring-brand" data-testid="driver-eta-badge">
                    {m.badge}
                  </span>
                )}
              </div>
            );
          return (
            <svg key={m.id} width="32" height="41" viewBox="0 0 36 46" className="absolute -translate-x-1/2 -translate-y-full drop-shadow" style={{ left: p.x, top: p.y }} aria-label={m.label}>
              <path d="M18 1C8.6 1 1 8.6 1 18c0 12.4 15.2 25.4 16 26.1.6.5 1.4.5 2 0C19.8 43.4 35 30.4 35 18 35 8.6 27.4 1 18 1z" fill={color} stroke="#fff" strokeWidth="2" />
              <circle cx="18" cy="18" r="6" fill="#fff" />
            </svg>
          );
        })}
      {pickMode && <CenterPin />}
      <div className={`pointer-events-none absolute left-3 ${compact ? 'top-3' : 'top-[calc(env(safe-area-inset-top)+8.75rem)]'} rounded-full bg-fuchsia-600/85 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow`}>
        Mapa ilustrativo{reason ? '' : ' · sem Google Maps'}
      </div>
      {reason && <div className="pointer-events-none absolute inset-x-4 top-[calc(env(safe-area-inset-top)+7rem)] rounded-xl bg-white/90 p-2 text-center text-xs text-navy shadow">{reason}</div>}
    </div>
  );
}
