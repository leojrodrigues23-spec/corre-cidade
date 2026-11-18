import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type GeoFix, haversineM, type LatLng, shouldSendLocation } from '../../core/geo';
import { friendlyError } from '../../data/errors';
import type { DriverSetup } from '../../data/types';
import { type GeoState, useGeolocation } from '../../geo/useGeolocation';
import { useToast } from '../../ui/components';
import { useApp } from '../shared/AppContext';

interface Runtime {
  setup: DriverSetup | null;
  reloadSetup: () => Promise<void>;
  activeRideId: string | null;
  refreshActive: () => Promise<void>;
  geo: GeoState;
  /** fix efetivo: GPS real, ou SIMULADO (somente modo demo, claramente sinalizado) */
  fix: GeoFix | null;
  simulated: boolean;
  setSimulated: (v: boolean) => void;
  simTarget: LatLng | null;
  setSimTarget: (p: LatLng | null) => void;
  lastSent: { at: number; accepted: boolean; reason?: string } | null;
  sendError: string | null;
  consent: boolean;
  setConsent: (v: boolean) => Promise<void>;
  setAvailable: (v: boolean) => Promise<void>;
  wakeLock: boolean;
}

const Ctx = createContext<Runtime | null>(null);
export const useDriver = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('fora do DriverRuntime');
  return c;
};

/**
 * Estado de execução do motorista (vive acima das rotas para não interromper o envio de GPS ao navegar):
 * - GPS ativo apenas enquanto disponível OU em corrida
 * - envio adaptativo (corrida: 4–15 s; disponível: 10–30 s), tolerante a falhas de rede
 * - Wake Lock de tela quando suportado (PWA não garante GPS com tela bloqueada)
 */
export function DriverRuntime({ children }: { children: ReactNode }) {
  const { backend } = useApp();
  const toast = useToast();
  const [setup, setSetup] = useState<DriverSetup | null>(null);
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [consent, setConsentState] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [simTarget, setSimTarget] = useState<LatLng | null>(null);
  const [simFix, setSimFix] = useState<GeoFix | null>(null);
  const [lastSent, setLastSent] = useState<Runtime['lastSent']>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState(false);

  const reloadSetup = useCallback(async () => {
    setSetup(await backend.getDriverSetup());
    const p = await backend.getProfile();
    setConsentState(!!p.locationConsentAt);
  }, [backend]);
  const refreshActive = useCallback(async () => {
    setActiveRideId(await backend.getDriverActiveRideId());
  }, [backend]);

  useEffect(() => {
    void reloadSetup().catch(() => undefined);
    void refreshActive().catch(() => undefined);
  }, [reloadSetup, refreshActive]);

  const tracking = consent && (!!setup?.isAvailable || !!activeRideId);
  const geo = useGeolocation({ enabled: tracking && !simulated });
  const fix = simulated ? simFix : geo.fix;

  // ----- GPS SIMULADO (apenas modo demo) -----
  useEffect(() => {
    if (!simulated || !tracking) return;
    const start = simFix ?? { lat: -23.1545, lng: -47.0612, accuracy: 8, timestamp: Date.now() };
    setSimFix({ ...start, timestamp: Date.now() });
    const t = window.setInterval(() => {
      setSimFix((prev) => {
        const p = prev ?? start;
        if (!simTarget) return { ...p, timestamp: Date.now(), speed: 0 };
        const d = haversineM(p, simTarget);
        const stepM = 10 * 2; // 10 m/s, passo de 2 s
        const k = d <= stepM ? 1 : stepM / d;
        return { lat: p.lat + (simTarget.lat - p.lat) * k, lng: p.lng + (simTarget.lng - p.lng) * k, accuracy: 8, timestamp: Date.now(), speed: d > 1 ? 10 : 0, heading: null };
      });
    }, 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulated, tracking, simTarget]);

  // heartbeat: reavalia o envio periodicamente mesmo sem leitura nova (parado no semáforo, por ex.)
  const [heartbeat, tick] = useState(0);
  useEffect(() => {
    if (!tracking) return;
    const t = window.setInterval(() => tick((x) => x + 1), 5000);
    return () => window.clearInterval(t);
  }, [tracking]);

  // ----- envio ao servidor com throttling -----
  const sentRef = useRef<(GeoFix & { sentAt: number }) | null>(null);
  const inflight = useRef(false);
  useEffect(() => {
    if (!tracking || !fix || inflight.current) return;
    const now = Date.now();
    if (now - fix.timestamp > 60_000) return; // não envia leitura velha como se fosse atual
    if (!shouldSendLocation({ mode: activeRideId ? 'corrida' : 'disponivel', last: sentRef.current, fix, now })) return;
    inflight.current = true;
    backend
      .pushLocation({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading ?? null, speed: fix.speed ?? null, timestamp: fix.timestamp })
      .then((r) => {
        if (r.accepted || r.reason === 'throttled') sentRef.current = { ...fix, sentAt: Date.now() };
        setLastSent({ at: Date.now(), accepted: r.accepted, reason: r.reason });
        setSendError(null);
      })
      .catch((e) => setSendError(friendlyError(e)))
      .finally(() => {
        inflight.current = false;
      });
  }, [fix, tracking, activeRideId, backend, heartbeat]);

  // ----- Wake Lock -----
  useEffect(() => {
    if (!tracking || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        setWakeLock(true);
        lock.addEventListener('release', () => setWakeLock(false));
      } catch {
        setWakeLock(false);
      }
    };
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [tracking]);

  const setConsent = async (v: boolean) => {
    await backend.setLocationConsent(v);
    setConsentState(v);
    if (!v) await reloadSetup();
  };
  const setAvailable = async (v: boolean) => {
    try {
      await backend.setAvailability(v);
      sentRef.current = null;
      await reloadSetup();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <Ctx.Provider value={{ setup, reloadSetup, activeRideId, refreshActive, geo, fix, simulated, setSimulated, simTarget, setSimTarget, lastSent, sendError, consent, setConsent, setAvailable, wakeLock }}>
      {children}
    </Ctx.Provider>
  );
}
