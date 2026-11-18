import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { assessFix } from '../../core/geo';
import { friendlyError } from '../../data/errors';
import type { Earnings, Offer } from '../../data/types';
import { type MapMarker, MapView } from '../../maps/MapView';
import { Badge, Banner, Button, Card, EmptyState, Skeleton, useToast } from '../../ui/components';
import { formatBRL, formatDistance, formatDuration } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { useApp } from '../shared/AppContext';
import { GpsWarnings } from '../shared/ride';
import { useDriver } from './runtime';

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
    <div className="min-h-dvh pb-28">
      <div className="relative h-[38dvh]">
        <MapView className="absolute inset-0" center={center} zoom={14} markers={markers} fitKey={offers?.map((o) => o.rideId).join(',') || (d.fix ? 'me' : undefined)} dark={theme.dark} />
      </div>
      <div className="relative z-10 mx-auto -mt-6 max-w-lg space-y-3 px-3">
        {s.status !== 'aprovado' && (
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <Icon name="clock" className="text-amber-500" />
              <p className="font-bold">{s.status === 'pendente' ? 'Cadastro em análise' : s.status === 'suspenso' ? 'Cadastro suspenso' : 'Acesso revogado'}</p>
            </div>
            <p className="mb-3 text-sm text-navy-600 dark:text-navy-100">
              {s.status === 'pendente' ? 'O administrador precisa aprovar seu cadastro antes de você receber corridas. Complete os dados abaixo.' : 'Fale com o administrador do piloto.'}
            </p>
            <Checklist ok={!!s.vehicle} label="Dados do veículo e placa" />
            <Checklist ok={!!s.pixKey} label="Chave Pix e nome do recebedor" />
            <Link to="/perfil">
              <Button block variant="secondary" className="mt-3">
                Completar cadastro
              </Button>
            </Link>
          </Card>
        )}

        {s.status === 'aprovado' && today && (
          <Link to="/ganhos" className="block">
            <div className="relative overflow-hidden rounded-[28px] bg-price-grad p-4 text-white shadow-float">
              <div className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-lime-neon/30 blur-2xl" />
              <div className="relative flex items-end justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-navy-100">Ganhos de hoje</p>
                  <p className="text-3xl font-extrabold tabular-nums">{formatBRL(today.netCents)}</p>
                  <p className="text-xs text-navy-100">{today.rides} corrida{today.rides === 1 ? '' : 's'} · líquido{settings?.pilot_mode ? ' simulado' : ''}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-grad text-navy-950 shadow-glow">
                  <Icon name="wallet" />
                </span>
              </div>
            </div>
          </Link>
        )}

        {s.status === 'aprovado' && (
          <Card className="shadow-sheet">
            {!d.consent ? (
              <div>
                <p className="mb-1 font-bold">Autorizar localização</p>
                <p className="mb-3 text-sm text-navy-600 dark:text-navy-100">
                  Sua posição é enviada somente enquanto você está disponível ou em corrida, e só é visível ao passageiro da sua corrida ativa e ao administrador. Ao ficar indisponível, a posição é apagada do servidor.
                </p>
                <Button block onClick={() => d.setConsent(true)}>
                  Autorizar e continuar
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col items-center py-2">
                  <div className="relative">
                  {s.isAvailable && <span className="pointer-events-none absolute inset-0 animate-radar rounded-full bg-brand/35" />}
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
                    className={`relative flex h-36 w-36 flex-col items-center justify-center rounded-full font-extrabold transition-all duration-300 active:scale-95 disabled:opacity-50 ${
                      s.isAvailable ? 'bg-brand-grad text-navy-950 shadow-glow-lg' : 'bg-night-grad text-white shadow-float ring-4 ring-brand/40'
                    }`}
                  >
                    <Icon name="steering" size={40} className={s.isAvailable ? 'relative animate-spin-slow' : 'relative'} />
                    <span className="relative mt-1 text-lg leading-tight">{s.isAvailable ? 'ONLINE' : 'Ficar online'}</span>
                  </button>
                  </div>
                  <p className="mt-3 text-center text-sm font-semibold">{s.isAvailable ? 'Disponível para corridas' : 'Indisponível'}</p>
                  <p className="text-center text-xs text-navy-500 dark:text-navy-300">
                    {missing.length ? `Cadastre: ${missing.join(' e ')}` : s.isAvailable ? 'Toque para ficar offline' : 'Toque para receber solicitações'}
                  </p>
                </div>
                {s.isAvailable && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <Badge tone={fixA && !fixA.stale ? 'green' : 'amber'}>{d.simulated ? 'GPS SIMULADO' : fixA ? fixA.label : 'Aguardando GPS…'}</Badge>
                    {d.lastSent && <Badge>{d.lastSent.accepted ? `Enviado há ${Math.round((now - d.lastSent.at) / 1000)}s` : `Envio recusado: ${d.lastSent.reason}`}</Badge>}
                    <Badge tone={d.wakeLock ? 'green' : 'neutral'}>{d.wakeLock ? 'Tela mantida ligada' : 'Mantenha o app aberto'}</Badge>
                  </div>
                )}
                {d.sendError && <Banner tone="error" className="mt-2">{d.sendError}</Banner>}
                {s.isAvailable && !d.simulated && (
                  <div className="mt-2">
                    <GpsWarnings geo={d.geo} />
                  </div>
                )}
                {backend.mode === 'demo' && s.isAvailable && (
                  <label className="mt-3 flex items-center gap-2 rounded-xl bg-fuchsia-50 p-2 text-xs font-semibold text-fuchsia-900 dark:bg-fuchsia-950/50 dark:text-fuchsia-100">
                    <input type="checkbox" checked={d.simulated} onChange={(e) => d.setSimulated(e.target.checked)} className="accent-fuchsia-600" data-testid="sim-gps" />
                    Simulador de deslocamento (GPS fictício, apenas modo demo)
                  </label>
                )}
              </>
            )}
          </Card>
        )}

        {s.isAvailable && (
          <>
            <div className="flex items-center justify-between px-1 pt-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-navy-500 dark:text-navy-300">Solicitações próximas</h2>
              <button className="text-xs font-semibold text-brand-700 dark:text-brand" onClick={loadOffers}>
                Atualizar
              </button>
            </div>
            {!offers && <Skeleton className="h-40" />}
            {offers?.length === 0 && <EmptyState icon="car" title="Nenhuma solicitação no momento" text="Mantenha o app aberto. Avisaremos quando surgir uma corrida." />}
            {offers?.map((o) => {
              const left = Math.max(0, Math.round((Date.parse(o.searchExpiresAt) - now) / 1000));
              return (
                <Card key={o.rideId} className="animate-rise" data-testid="offer-card">
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <p className="bg-brand-grad bg-clip-text text-3xl font-extrabold tabular-nums text-transparent">{formatBRL(o.driverNetCents)}</p>
                      <p className="text-xs text-navy-500 dark:text-navy-300">
                        seu líquido · total {formatBRL(o.totalCents)} {settings?.pilot_mode && '(simulado)'}
                      </p>
                    </div>
                    <Badge tone={left < 30 ? 'red' : 'amber'}>expira em {left}s</Badge>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p>
                      <Icon name="pin" size={14} className="mr-1 inline text-brand" />
                      Embarque: <strong>{o.pickupHint}</strong> {o.distanceToPickupM !== null && <span className="text-navy-500">· a {formatDistance(o.distanceToPickupM)}</span>}
                    </p>
                    <p>
                      <Icon name="flag" size={14} className="mr-1 inline" />
                      Destino: <strong>{o.destHint}</strong> · {formatDistance(o.routeDistanceM)} · {formatDuration(o.routeDurationS)}
                    </p>
                    <p className="text-xs text-navy-500">Endereço exato liberado após aceitar.{o.routeSource === 'simulada' && ' Rota simulada.'}</p>
                  </div>
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
          </>
        )}
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
