import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { assessFix } from '../../core/geo';
import { friendlyError } from '../../data/errors';
import type { Earnings, Offer } from '../../data/types';
import { type MapMarker, MapView } from '../../maps/MapView';
import { Badge, Banner, Button, Card, Skeleton, useToast } from '../../ui/components';
import { formatBRL, formatDistance, formatDuration } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { useApp } from '../shared/AppContext';
import { Money, useHiddenValues } from '../shared/Bank';
import { GpsWarnings } from '../shared/ride';
import { useDriver } from './runtime';

const SEND_REASON: Record<string, string> = {
  stale: 'sinal antigo',
  throttled: 'aguardando intervalo',
  out_of_order: 'sinal repetido',
  implausible_jump: 'salto de GPS ignorado',
  invalid_accuracy: 'precisão inválida',
  future: 'relógio do aparelho adiantado',
};

export function DriverHome() {
  const { backend, settings, theme } = useApp();
  const d = useDriver();
  const nav = useNavigate();
  const toast = useToast();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toggling, setToggling] = useState(false);
  const [today, setToday] = useState<Earnings | null>(null);
  const [hidden, toggleHidden] = useHiddenValues();
  const [name, setName] = useState('');
  useEffect(() => {
    backend.getProfile().then((p) => setName(p.fullName)).catch(() => undefined);
  }, [backend]);
  useEffect(() => {
    backend.getEarnings(1).then(setToday).catch(() => undefined);
  }, [backend, d.activeRideId]);

  useEffect(() => {
    if (d.activeRideId) nav(`/corrida/${d.activeRideId}`, { replace: true });
  }, [d.activeRideId, nav]);

  const loadOffers = useCallback(async () => {
    if (!d.setup?.isAvailable) return setOffers([]);
    try {
      setOffers(await backend.listOpenRides());
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  }, [backend, d.setup?.isAvailable, toast]);

  useEffect(() => {
    void loadOffers();
    if (!d.setup?.isAvailable) return;
    const unsub = backend.subscribeNotifications((n) => n.kind === 'ride_offer' && void loadOffers());
    const poll = window.setInterval(() => document.visibilityState === 'visible' && void loadOffers(), 8000);
    return () => {
      unsub();
      window.clearInterval(poll);
    };
  }, [backend, d.setup?.isAvailable, loadOffers]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const accept = async (o: Offer) => {
    setBusyId(o.rideId);
    try {
      const r = await backend.acceptRide(o.rideId);
      if (!r.accepted) {
        toast('Outro motorista aceitou primeiro ou a corrida não está mais disponível.', 'warn');
        await loadOffers();
        return;
      }
      await d.refreshActive();
      nav(`/corrida/${o.rideId}`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (d.fix) m.push({ id: 'me', kind: 'driver', position: d.fix, accuracyM: d.fix.accuracy, stale: assessFix(d.fix, now).stale, label: 'Você' });
    offers?.forEach((o) => m.push({ id: o.rideId, kind: 'pickup', position: o.pickupArea, label: 'Região de embarque' }));
    return m;
  }, [d.fix, offers, now]);

  if (!d.setup)
    return (
      <div className="mx-auto max-w-lg space-y-3 p-4 pt-24">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );

  const s = d.setup;
  const missing = [!s.vehicle && 'veículo', !s.pixKey && 'chave Pix de recebimento'].filter(Boolean) as string[];
  const center = d.fix ?? settings?.map_defaults.center ?? { lat: -23.153, lng: -47.0577 };
  const fixA = d.fix ? assessFix(d.fix, now) : null;

  return (
    <div className="relative h-dvh overflow-hidden">
      <MapView className="absolute inset-0" center={center} zoom={14} markers={markers} fitKey={offers?.map((o) => o.rideId).join(',') || (d.fix ? 'me' : undefined)} dark={theme.dark} />

      {/* topo mínimo: configurações, ganhos de hoje e GPS */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+2.25rem)]">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <Link
            to="/perfil"
            aria-label="Configurações"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-base font-extrabold text-navy shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:text-white dark:ring-white/10"
          >
            {(name || 'M').slice(0, 1).toUpperCase()}
          </Link>
          {s.status === 'aprovado' && (
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white py-1 pl-4 pr-1 shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:ring-white/10">
              <Link to="/ganhos" className="flex items-baseline gap-1.5" aria-label="Ver ganhos" data-testid="today-earnings">
                <span className="text-[11px] font-bold uppercase tracking-wide text-navy-500 dark:text-navy-300">Ganhos de hoje</span>
                <Money cents={today?.netCents ?? 0} hidden={hidden} size="sm" />
              </Link>
              <button onClick={toggleHidden} aria-label={hidden ? 'Mostrar valores' : 'Esconder valores'} className="flex h-9 w-9 items-center justify-center rounded-full text-navy-500 hover:bg-navy/5 dark:text-navy-300 dark:hover:bg-white/10">
                <Icon name={hidden ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[calc(env(safe-area-inset-bottom)+4.75rem)]">
        <div className="max-h-[62dvh] space-y-2 overflow-y-auto">
          {s.status !== 'aprovado' && (
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <Icon name="clock" className="text-amber-500" />
                <p className="font-bold">{s.status === 'pendente' ? 'Cadastro em análise' : s.status === 'suspenso' ? 'Cadastro suspenso' : 'Acesso revogado'}</p>
              </div>
              <p className="mb-2 text-sm text-navy-500 dark:text-navy-300">
                {s.status === 'pendente' ? 'O administrador precisa aprovar seu cadastro. Complete os dados.' : 'Fale com o administrador do piloto.'}
              </p>
              <Checklist ok={!!s.vehicle} label="Dados do veículo e placa" />
              <Checklist ok={!!s.pixKey} label="Chave Pix e nome do recebedor" />
              <Link to="/perfil">
                <Button block variant="secondary" className="mt-2">
                  Completar cadastro
                </Button>
              </Link>
            </Card>
          )}

          {s.isAvailable &&
            offers?.map((o) => {
              const left = Math.max(0, Math.round((Date.parse(o.searchExpiresAt) - now) / 1000));
              return (
                <Card key={o.rideId} className={`animate-rise p-4 shadow-sheet ${o.targeted ? 'ring-2 ring-coral' : ''}`} data-testid="offer-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="num text-[28px] font-extrabold leading-none">{formatBRL(o.driverNetCents)}</p>
                      <p className="mt-1 text-xs text-navy-500 dark:text-navy-300">
                        seu líquido · total {formatBRL(o.totalCents)}
                        {settings?.pilot_mode && ' (simulado)'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={left < 30 ? 'red' : 'amber'}>{left}s</Badge>
                      {o.targeted ? <Badge tone="red">Escolheu você</Badge> : <Badge tone="navy">{formatBRL(o.perKmCents)}/km</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <p className="min-w-0 truncate">
                      <Icon name="pin" size={14} className="mr-1 inline text-coral" />
                      <strong>{o.pickupHint}</strong>
                      {o.distanceToPickupM !== null && <span className="text-navy-500 dark:text-navy-300"> · {formatDistance(o.distanceToPickupM)}</span>}
                    </p>
                    <p className="min-w-0 truncate">
                      <Icon name="flag" size={14} className="mr-1 inline" />
                      <strong>{o.destHint}</strong>
                      <span className="text-navy-500 dark:text-navy-300"> · {formatDistance(o.routeDistanceM)} · {formatDuration(o.routeDurationS)}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-navy-500 dark:text-navy-300">Endereço exato liberado após aceitar.{o.routeSource === 'simulada' && ' Rota simulada.'}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Button variant="secondary" onClick={async () => { await backend.declineRide(o.rideId); await loadOffers(); }}>
                      Recusar
                    </Button>
                    <Button className="col-span-2" loading={busyId === o.rideId} onClick={() => accept(o)} data-testid="accept-offer">
                      Aceitar
                    </Button>
                  </div>
                </Card>
              );
            })}

          {s.status === 'aprovado' && (
            <Card className="p-4 shadow-sheet">
              {!d.consent ? (
                <div>
                  <p className="font-bold">Autorizar localização</p>
                  <p className="mb-3 mt-1 text-sm text-navy-500 dark:text-navy-300">
                    Enviada só enquanto você está disponível ou em corrida, e vista apenas pelo passageiro da sua corrida e pelo administrador. Ao ficar offline, é apagada do servidor.
                  </p>
                  <Button block onClick={() => d.setConsent(true)}>
                    Autorizar e continuar
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-base font-extrabold">
                        <span className={`h-2.5 w-2.5 rounded-full ${s.isAvailable ? 'bg-brand' : 'bg-navy-300'}`} />
                        {s.isAvailable ? 'Você está online' : 'Você está offline'}
                      </p>
                      <p className="truncate text-xs text-navy-500 dark:text-navy-300">
                        {missing.length
                          ? `Cadastre: ${missing.join(' e ')}`
                          : s.isAvailable
                            ? offers?.length
                              ? `${offers.length} solicitação(ões) perto de você`
                              : 'Procurando corridas perto de você…'
                            : 'Fique online para receber corridas'}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.isAvailable}
                      aria-label={s.isAvailable ? 'Ficar offline' : 'Ficar online'}
                      disabled={missing.length > 0 || toggling}
                      onClick={async () => {
                        setToggling(true);
                        await d.setAvailable(!s.isAvailable);
                        setToggling(false);
                      }}
                      className={`h-12 shrink-0 rounded-full px-5 text-sm font-extrabold transition active:scale-95 disabled:opacity-50 ${
                        s.isAvailable ? 'bg-mist text-navy ring-1 ring-navy/10 dark:bg-navy-800 dark:text-white dark:ring-white/10' : 'bg-coral text-white'
                      }`}
                    >
                      {s.isAvailable ? 'Ficar offline' : 'Ficar online'}
                    </button>
                  </div>
                  {s.isAvailable && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      <Badge tone={fixA && !fixA.stale ? 'green' : 'amber'}>{d.simulated ? 'GPS SIMULADO' : fixA ? fixA.label : 'Aguardando GPS…'}</Badge>
                      {d.lastSent && (
                        <Badge>{d.lastSent.accepted ? `Enviado há ${Math.round((now - d.lastSent.at) / 1000)}s` : `Posição não enviada: ${SEND_REASON[d.lastSent.reason ?? ''] ?? 'aguardando novo sinal'}`}</Badge>
                      )}
                      {!d.wakeLock && <Badge>Mantenha o app aberto</Badge>}
                    </div>
                  )}
                  {d.sendError && <Banner tone="error" className="mt-2">{d.sendError}</Banner>}
                  {s.isAvailable && !d.simulated && (
                    <div className="mt-2">
                      <GpsWarnings geo={d.geo} />
                    </div>
                  )}
                  {backend.mode === 'demo' && s.isAvailable && (
                    <label className="mt-2 flex items-center gap-2 rounded-xl bg-fuchsia-50 p-2 text-[11px] font-semibold text-fuchsia-900 dark:bg-fuchsia-950/50 dark:text-fuchsia-100">
                      <input type="checkbox" checked={d.simulated} onChange={(e) => d.setSimulated(e.target.checked)} className="accent-fuchsia-600" data-testid="sim-gps" />
                      Simulador de deslocamento (GPS fictício, só no modo demo)
                    </label>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Checklist({ ok, label }: { ok: boolean; label: string }) {
  return (
    <p className="flex items-center gap-2 py-1 text-sm">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? 'bg-brand text-navy-950' : 'bg-navy/10 text-navy-500 dark:bg-white/10'}`}>
        <Icon name={ok ? 'check' : 'close'} size={12} />
      </span>
      {label}
    </p>
  );
}
