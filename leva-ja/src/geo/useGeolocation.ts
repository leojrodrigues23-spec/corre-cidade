import { useCallback, useEffect, useRef, useState } from 'react';
import { assessFix, type FixAssessment, type GeoFix, PlausibilityFilter } from '../core/geo';

export type GeoStatus = 'idle' | 'requesting' | 'watching' | 'denied' | 'unavailable' | 'unsupported' | 'insecure';

export interface GeoState {
  status: GeoStatus;
  permission: PermissionState | 'unknown';
  fix: GeoFix | null; // última leitura ACEITA (real, sem alteração)
  assessment: FixAssessment | null;
  rejected: number; // leituras descartadas pelo filtro de plausibilidade
  lastRejectReason: string | null;
  error: string | null;
  timedOut: boolean;
}

/**
 * Geolocalização do dispositivo com consentimento.
 * - watchPosition + enableHighAccuracy (configurável)
 * - descarta leituras implausíveis (saltos impossíveis, precisão absurda, fora de ordem)
 * - marca posição como DESATUALIZADA quando não chega leitura nova (ex.: tela bloqueada no iOS)
 * - nunca inventa coordenadas: sem leitura válida, fix = null
 */
export function useGeolocation(opts: { enabled: boolean; highAccuracy?: boolean; maxAgeMs?: number }) {
  const { enabled, highAccuracy = true, maxAgeMs = 30_000 } = opts;
  const [state, setState] = useState<GeoState>({ status: 'idle', permission: 'unknown', fix: null, assessment: null, rejected: 0, lastRejectReason: null, error: null, timedOut: false });
  const filter = useRef(new PlausibilityFilter());
  const watchId = useRef<number | null>(null);

  // estado da permissão (permite detectar revogação pelo usuário nas configurações)
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const onChange = () => status && setState((s) => ({ ...s, permission: status!.state, status: status!.state === 'denied' ? 'denied' : s.status }));
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        status = p;
        setState((s) => ({ ...s, permission: p.state }));
        p.addEventListener('change', onChange);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener('change', onChange);
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      setState((s) => ({ ...s, status: s.status === 'denied' ? 'denied' : 'idle' }));
      return;
    }
    if (!window.isSecureContext) {
      setState((s) => ({ ...s, status: 'insecure', error: 'Localização exige HTTPS.' }));
      return;
    }
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'unsupported', error: 'Este navegador não oferece geolocalização.' }));
      return;
    }
    setState((s) => ({ ...s, status: 'requesting', error: null }));
    filter.current.reset();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: GeoFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
        };
        const r = filter.current.accept(fix);
        setState((s) =>
          r.accepted
            ? { ...s, status: 'watching', permission: 'granted', fix, assessment: assessFix(fix, Date.now(), maxAgeMs), error: null, timedOut: false }
            : { ...s, status: 'watching', rejected: s.rejected + 1, lastRejectReason: r.reason ?? null },
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          setState((s) => ({ ...s, status: 'denied', permission: 'denied', error: 'Permissão de localização negada.' }));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setState((s) => ({ ...s, status: s.fix ? 'watching' : 'unavailable', error: 'Sinal de localização indisponível no momento.' }));
        } else {
          // TIMEOUT: continua observando; a UI mostra o aviso
          setState((s) => ({ ...s, timedOut: true, error: 'Demorando para obter localização…' }));
        }
      },
      { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 20000 },
    );
    return stop;
  }, [enabled, highAccuracy, maxAgeMs, stop]);

  // reavalia idade a cada segundo: posição antiga NÃO é apresentada como atual
  useEffect(() => {
    if (!state.fix) return;
    const t = window.setInterval(() => setState((s) => (s.fix ? { ...s, assessment: assessFix(s.fix, Date.now(), maxAgeMs) } : s)), 1000);
    return () => window.clearInterval(t);
  }, [state.fix, maxAgeMs]);

  return state;
}

/** Leitura única (para confirmar embarque). Rejeita após timeout em vez de devolver posição inventada. */
export function getCurrentFix(highAccuracy = true, timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolocalização indisponível'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp, speed: p.coords.speed, heading: p.coords.heading }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Permissão de localização negada' : 'Não foi possível obter a localização')),
      { enableHighAccuracy: highAccuracy, maximumAge: 10000, timeout: timeoutMs },
    );
  });
}
