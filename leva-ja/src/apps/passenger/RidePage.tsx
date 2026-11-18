import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { decodePolyline, haversineM } from '../../core/geo';
import { PASSENGER_CANCEL_REASONS, TERMINAL_STATUSES } from '../../core/ride';
import { friendlyError } from '../../data/errors';
import { type MapMarker, MapView } from '../../maps/MapView';
import { Banner, Button, Card, IconButton, KeyValue, Modal, Select, Skeleton, StarRating, Textarea, useToast } from '../../ui/components';
import { formatBRL, formatDateTime, formatDistance, formatDuration } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { useApp } from '../shared/AppContext';
import { FareBreakdown, PixPanel, PlaceLine, RideStatusPill, RideTimeline, useDriverLocation, useRideDetails } from '../shared/ride';

export function PassengerRidePage() {
  const { id } = useParams();
  const { backend, theme } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const { details, error, reload } = useRideDetails(id ?? null);
  const ride = details?.ride;
  const tracking = !!ride && ['aceita', 'motorista_a_caminho', 'motorista_chegou', 'em_andamento'].includes(ride.status);
  const { loc, ageS, live } = useDriverLocation(tracking ? ride!.driverId : null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(PASSENGER_CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const markers: MapMarker[] = useMemo(() => {
    if (!ride) return [];
    const m: MapMarker[] = [
      { id: 'pickup', kind: 'pickup', position: ride.pickup, label: 'Embarque' },
      { id: 'dest', kind: 'dest', position: ride.dest, label: 'Destino' },
    ];
    if (loc && tracking) m.push({ id: 'driver', kind: 'driver', position: loc, accuracyM: loc.accuracyM, stale: !live, label: 'Motorista' });
    return m;
  }, [ride, loc, live, tracking]);

  if (error && !details)
    return (
      <div className="mx-auto max-w-lg p-4 pt-24">
        <Banner tone="error" title="Não foi possível carregar a corrida" action={<Button size="sm" onClick={reload}>Tentar de novo</Button>}>
          {error}
        </Banner>
      </div>
    );
  if (!details || !ride)
    return (
      <div className="mx-auto max-w-lg space-y-3 p-4 pt-24">
        <Skeleton className="h-64" />
        <Skeleton className="h-32" />
      </div>
    );

  // ETA de aproximação: estimativa local (linha reta × 1,35 a 25 km/h) para não chamar a API paga a cada sinal
  const approachM = loc && ['aceita', 'motorista_a_caminho'].includes(ride.status) ? haversineM(loc, ride.pickup) * 1.35 : null;
  const path = details.fare.routePolyline ? decodePolyline(details.fare.routePolyline) : [ride.pickup, ride.dest];
  const terminal = TERMINAL_STATUSES.includes(ride.status);
  const searchLeft = ride.searchExpiresAt ? Math.max(0, Math.round((Date.parse(ride.searchExpiresAt) - now) / 1000)) : null;

  const doCancel = async () => {
    setBusy(true);
    try {
      await backend.cancelRide(ride.id, reason);
      setCancelOpen(false);
      await reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-dvh">
      <div className="relative h-[46dvh]">
        <MapView className="absolute inset-0" center={ride.pickup} markers={markers} path={path} fitKey={`${ride.id}-${ride.status}`} dark={theme.dark} />
        <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+2.25rem)]">
          <IconButton icon="chevronLeft" label="Voltar" onClick={() => nav('/')} />
        </div>
      </div>
      <div className="relative z-10 mx-auto -mt-6 max-w-lg space-y-3 px-3 pb-28">
        <Card className="shadow-sheet">
          <div className="mb-2 flex items-center justify-between">
            <RideStatusPill status={ride.status} />
            {ride.isSimulation && <span className="text-xs font-bold uppercase text-fuchsia-700 dark:text-fuchsia-300">Corrida simulada</span>}
          </div>

          {ride.status === 'procurando_motorista' && (
            <div className="py-3 text-center" data-testid="searching">
              <div className="relative mx-auto mb-3 h-16 w-16">
                <span className="absolute inset-0 animate-pulseRing rounded-full bg-brand/40" />
                <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand text-navy-950">
                  <Icon name="car" size={28} />
                </span>
              </div>
              <p className="text-lg font-bold">Procurando motorista…</p>
              {searchLeft !== null && <p className="text-sm text-navy-500 dark:text-navy-300">A busca expira em {Math.floor(searchLeft / 60)}:{String(searchLeft % 60).padStart(2, '0')}</p>}
            </div>
          )}

          {details.driver && tracking && (
            <div className="flex items-center gap-3 py-2" data-testid="driver-card">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy text-lg font-bold text-white dark:bg-white dark:text-navy">{details.driver.name.slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {details.driver.name} {details.driver.rating && <span className="text-sm font-semibold text-amber-500">★ {details.driver.rating}</span>}
                </p>
                {details.driver.vehicle && (
                  <p className="text-sm text-navy-500 dark:text-navy-300">
                    {details.driver.vehicle.make} {details.driver.vehicle.model} · {details.driver.vehicle.color}
                  </p>
                )}
              </div>
              {details.driver.vehicle && <span className="rounded-xl bg-mist px-2.5 py-1.5 font-mono text-sm font-bold tracking-wider ring-1 ring-navy/10 dark:bg-navy-800">{details.driver.vehicle.plate}</span>}
            </div>
          )}

          {tracking && (
            <div className="mt-1 rounded-2xl bg-mist p-3 text-sm dark:bg-navy-800">
              {ride.status === 'motorista_chegou' ? (
                <p className="font-bold text-brand-700 dark:text-brand">Seu motorista chegou ao ponto de embarque.</p>
              ) : ride.status === 'em_andamento' ? (
                <p className="font-semibold">Boa viagem! Destino: {ride.dest.address}</p>
              ) : approachM !== null ? (
                <p className="font-semibold">
                  Chegada estimada ≈ {formatDuration(approachM / (25000 / 3600))} · {formatDistance(approachM)} <span className="font-normal text-navy-500">(estimativa)</span>
                </p>
              ) : (
                <p className="font-semibold">Aguardando a posição do motorista…</p>
              )}
              {loc ? (
                <p className={`mt-1 text-xs ${live ? 'text-navy-500 dark:text-navy-300' : 'font-semibold text-red-600 dark:text-red-400'}`}>
                  {live ? `Posição ao vivo · ±${Math.round(loc.accuracyM)} m · atualizada há ${ageS}s` : `Último sinal do motorista há ${ageS! < 120 ? `${ageS}s` : `${Math.round(ageS! / 60)} min`} — posição pode estar desatualizada`}
                </p>
              ) : (
                <p className="mt-1 text-xs text-navy-500">Sem sinal de localização do motorista ainda.</p>
              )}
            </div>
          )}

          <div className="mt-3">
            <PlaceLine icon="pin" title="Embarque" text={ride.pickup.address} />
            <PlaceLine icon="flag" title="Destino" text={ride.dest.address} />
          </div>

          {!terminal && ride.status !== 'em_andamento' && (
            <Button block variant="secondary" className="mt-3" onClick={() => setCancelOpen(true)} data-testid="cancel-ride">
              Cancelar corrida
            </Button>
          )}

          {(ride.status === 'cancelada' || ride.status === 'expirada') && (
            <div className="mt-3">
              <Banner tone="warn">{ride.status === 'expirada' ? 'Nenhum motorista aceitou dentro do tempo limite.' : `Corrida cancelada${ride.cancelReason ? `: ${ride.cancelReason}` : ''}.`}</Banner>
              <Button block className="mt-3" onClick={() => nav('/')}>
                Solicitar novamente
              </Button>
            </div>
          )}
        </Card>

        {ride.status === 'finalizada' && (
          <>
            <Card>
              <p className="mb-2 font-bold">Recibo</p>
              <p className="mb-2 text-xs text-navy-500 dark:text-navy-300">
                Corrida {ride.id.slice(0, 8)} · {formatDateTime(ride.finishedAt)}
                {ride.manualPrice && ' · preço manual definido pelo administrador'}
              </p>
              <FareBreakdown q={{ ...details.fare, totalCents: ride.totalCents, commissionCents: ride.commissionCents, driverNetCents: ride.driverNetCents, fareVersion: details.fare.version, pricingMode: details.fare.pricingMode as 'fixa_na_solicitacao' }} />
            </Card>
            {details.payment && (
              <Card data-testid="pix-panel">
                <PixPanel payment={details.payment} role="passageiro" onInform={async () => { await backend.setPaymentStatus(ride.id, 'informado', `inform-${ride.id}`); await reload(); }} />
              </Card>
            )}
            <Card>
              <p className="mb-2 font-bold">Avalie sua corrida</p>
              {details.myRating ? (
                <div className="flex items-center gap-2">
                  <StarRating value={details.myRating} size={24} />
                  <span className="text-sm text-navy-500">Obrigado!</span>
                </div>
              ) : (
                <>
                  <StarRating value={stars} onChange={setStars} />
                  <Textarea className="mt-2" placeholder="Comentário (opcional)" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <Button
                    block
                    className="mt-2"
                    disabled={!stars}
                    onClick={async () => {
                      try {
                        await backend.rateRide(ride.id, stars, comment || undefined);
                        await reload();
                      } catch (e) {
                        toast(friendlyError(e), 'error');
                      }
                    }}
                  >
                    Enviar avaliação
                  </Button>
                </>
              )}
            </Card>
          </>
        )}

        <Card>
          <details>
            <summary className="cursor-pointer font-bold">Histórico de status</summary>
            <div className="mt-3">
              <RideTimeline events={details.events} />
            </div>
          </details>
          <KeyValue k="Valor" v={formatBRL(ride.totalCents)} />
        </Card>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar corrida">
        <p className="mb-2 text-sm">Qual o motivo?</p>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo">
          {PASSENGER_CANCEL_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <Button block variant="danger" className="mt-4" loading={busy} onClick={doCancel} data-testid="confirm-cancel">
          Confirmar cancelamento
        </Button>
      </Modal>
    </div>
  );
}
