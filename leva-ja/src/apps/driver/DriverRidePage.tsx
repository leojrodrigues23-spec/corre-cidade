import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assessFix, decodePolyline, haversineM } from '../../core/geo';
import { DRIVER_CANCEL_REASONS, nextDriverAction } from '../../core/ride';
import { friendlyError } from '../../data/errors';
import { type MapMarker, MapView } from '../../maps/MapView';
import { googleMapsNavUrl, wazeUrl } from '../../maps/navigation';
import { Banner, Button, Card, IconButton, Input, KeyValue, Modal, Select, Skeleton, StarRating, useToast } from '../../ui/components';
import { formatBRL, formatDateTime, formatEtaBadge } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { useApp } from '../shared/AppContext';
import { PixPanel, PlaceLine, RideStatusPill, RideTimeline, useRideDetails } from '../shared/ride';
import { useDriver } from './runtime';

export function DriverRidePage() {
  const { id } = useParams();
  const { backend, theme } = useApp();
  const d = useDriver();
  const nav = useNavigate();
  const toast = useToast();
  const { details, error, reload } = useRideDetails(id ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(DRIVER_CANCEL_REASONS[0]);
  const [stars, setStars] = useState(0);
  const [pin, setPin] = useState('');
  const [pinMsg, setPinMsg] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null);
  const [pinLocked, setPinLocked] = useState(false);
  const ride = details?.ride;

  // simulador (modo demo): desloca em direção ao embarque e depois ao destino
  useEffect(() => {
    if (!ride) return;
    if (['aceita', 'motorista_a_caminho'].includes(ride.status)) d.setSimTarget(ride.pickup);
    else if (ride.status === 'em_andamento') d.setSimTarget(ride.dest);
    else d.setSimTarget(null);
    if (['finalizada', 'cancelada', 'expirada', 'procurando_motorista'].includes(ride.status)) void d.refreshActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride?.status]);

  const markers: MapMarker[] = useMemo(() => {
    if (!ride) return [];
    const m: MapMarker[] = [
      { id: 'pickup', kind: 'pickup', position: ride.pickup, label: 'Embarque' },
      { id: 'dest', kind: 'dest', position: ride.dest, label: 'Destino' },
    ];
    if (d.fix) {
      const goal = ['aceita', 'motorista_a_caminho'].includes(ride.status) ? ride.pickup : ride.status === 'em_andamento' ? ride.dest : null;
      m.push({
        id: 'me',
        kind: 'driver',
        position: d.fix,
        accuracyM: d.fix.accuracy,
        stale: assessFix(d.fix, Date.now()).stale,
        label: 'Você',
        badge: goal ? formatEtaBadge(haversineM(d.fix, goal) * 1.35) : null,
      });
    }
    return m;
  }, [ride, d.fix]);

  if (error && !details) return <div className="mx-auto max-w-lg p-4 pt-24"><Banner tone="error" action={<Button size="sm" onClick={reload}>Tentar de novo</Button>}>{error}</Banner></div>;
  if (!details || !ride) return <div className="mx-auto max-w-lg space-y-3 p-4 pt-24"><Skeleton className="h-64" /><Skeleton className="h-32" /></div>;

  // se a corrida voltou para reoferta (desistência), este motorista não é mais o responsável
  if (details.viewerRole !== 'motorista') return <div className="mx-auto max-w-lg p-4 pt-24"><Banner tone="info" action={<Button size="sm" onClick={() => nav('/')}>Início</Button>}>Esta corrida não está mais atribuída a você.</Banner></div>;

  const next = nextDriverAction(ride.status);
  const target = ride.status === 'em_andamento' || ride.status === 'motorista_chegou' ? ride.dest : ride.pickup;
  const path = details.fare.routePolyline ? decodePolyline(details.fare.routePolyline) : [ride.pickup, ride.dest];

  const needsPin = ride.status === 'motorista_chegou' && ride.pinRequired && !ride.pinVerifiedAt;
  const checkPin = async () => {
    if (!/^\d{4}$/.test(pin)) return setPinMsg({ tone: 'error', text: 'Digite os 4 números do PIN.' });
    setBusy(true);
    try {
      const r = await backend.verifyRidePin(ride.id, pin);
      if (r.ok) {
        setPinMsg(null);
        toast('PIN confirmado. Pode iniciar a corrida.', 'success');
        await reload();
      } else {
        setPin('');
        setPinLocked(r.locked);
        setPinMsg(
          r.locked
            ? { tone: 'warn', text: 'Muitas tentativas. Confirme pessoalmente quem é o passageiro; se houver dúvida, cancele a corrida.' }
            : { tone: 'error', text: `PIN incorreto. ${r.attemptsLeft} tentativa(s) restante(s). Confira se é o passageiro certo.` },
        );
      }
    } catch (e) {
      setPinMsg({ tone: 'error', text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  };

  const advance = async () => {
    if (!next) return;
    if (next.to === 'finalizada' && !confirmFinish) return setConfirmFinish(true);
    setBusy(true);
    try {
      await backend.advanceRide(ride.id, next.to as 'motorista_a_caminho');
      setConfirmFinish(false);
      await reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh pb-28">
      <div className="relative h-[56dvh]">
        <MapView className="absolute inset-0" center={ride.pickup} markers={markers} path={path} fitKey={`${ride.id}-${ride.status}`} dark={theme.dark} />
        <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+2.25rem)]">
          <IconButton icon="chevronLeft" label="Início" onClick={() => nav('/')} />
        </div>
      </div>
      <div className="relative z-10 mx-auto -mt-6 max-w-lg space-y-3 px-3">
        <Card className="shadow-sheet">
          <div className="mb-2 flex items-center justify-between">
            <RideStatusPill status={ride.status} />
            <span className="text-lg font-extrabold tabular-nums">{formatBRL(ride.totalCents)}</span>
          </div>
          {details.passenger && (
            <p className="mb-2 text-sm">
              Passageiro(a): <strong>{details.passenger.name}</strong> {details.passenger.rating && <span className="text-amber-500">★ {details.passenger.rating}</span>}
            </p>
          )}
          <PlaceLine icon="pin" title="Embarque" text={ride.pickup.address} />
          <PlaceLine icon="flag" title="Destino" text={ride.dest.address} />
          {ride.notes && <Banner tone="info" className="mt-2" title="Observação do passageiro">{ride.notes}</Banner>}
          {ride.manualPrice && <Banner tone="warn" className="mt-2">Preço definido manualmente pelo administrador.</Banner>}
          {ride.priceSource === 'motorista' && <Banner tone="info" className="mt-2">Corrida no seu preço ({formatBRL(details.fare.perKmCents)}/km): o passageiro escolheu você.</Banner>}

          {next && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={wazeUrl(target)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#33CCFF] px-3 text-sm font-bold text-navy-950">
                <Icon name="nav" size={18} /> Navegar no Waze
              </a>
              <a href={googleMapsNavUrl(target, d.fix ?? undefined)} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-bold text-navy ring-1 ring-navy/15 dark:bg-navy-800 dark:text-white">
                <Icon name="map" size={18} /> Google Maps
              </a>
              <p className="col-span-2 text-center text-xs text-navy-500 dark:text-navy-300">Navegando até o {target === ride.pickup ? 'embarque' : 'destino'}. Volte ao Leva Já para atualizar o status — a corrida continua de onde parou.</p>
            </div>
          )}

          {needsPin && (
            <div className="mt-3 rounded-2xl bg-royal/10 p-3 ring-1 ring-royal/20 dark:bg-royal-400/15 dark:ring-royal-400/30" data-testid="pin-check">
              <p className="font-extrabold">Peça o PIN ao passageiro</p>
              <p className="mb-2 text-xs text-navy-600 dark:text-navy-100">Ele aparece no app de quem pediu a corrida. Só inicie se o código bater.</p>
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="0000"
                  aria-label="PIN do passageiro"
                  value={pin}
                  disabled={pinLocked}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={(e) => e.key === 'Enter' && void checkPin()}
                  className="text-center font-mono text-2xl font-extrabold tracking-[0.5em]"
                  data-testid="pin-input"
                />
                <Button size="lg" loading={busy} disabled={pinLocked || pin.length !== 4} onClick={checkPin} data-testid="pin-submit">
                  Conferir
                </Button>
              </div>
              {pinMsg && <Banner tone={pinMsg.tone} className="mt-2">{pinMsg.text}</Banner>}
            </div>
          )}
          {ride.status === 'motorista_chegou' && ride.pinVerifiedAt && <Banner tone="success" className="mt-3">PIN confirmado. Passageiro certo!</Banner>}

          {next && !needsPin && (
            <Button block size="lg" className="mt-3" loading={busy} onClick={advance} data-testid="driver-advance">
              {confirmFinish ? 'Confirmar: finalizar corrida' : next.label}
            </Button>
          )}
          {confirmFinish && (
            <Button block variant="ghost" className="mt-1" onClick={() => setConfirmFinish(false)}>
              Ainda não
            </Button>
          )}
          {['aceita', 'motorista_a_caminho', 'motorista_chegou'].includes(ride.status) && (
            <Button block variant="ghost" className="mt-1 text-red-600 dark:text-red-400" onClick={() => setCancelOpen(true)}>
              {ride.status === 'motorista_chegou' ? 'Passageiro não apareceu / cancelar' : 'Desistir da corrida'}
            </Button>
          )}
        </Card>

        {ride.status === 'finalizada' && (
          <>
            <Card>
              <p className="mb-2 font-bold">Resumo financeiro (simulado)</p>
              <KeyValue k="Valor bruto" v={formatBRL(ride.totalCents)} />
              <KeyValue k="Comissão da plataforma (simulada)" v={`− ${formatBRL(ride.commissionCents)}`} />
              <KeyValue k="Seu líquido" v={formatBRL(ride.driverNetCents)} strong />
              <p className="mt-2 text-xs text-navy-500 dark:text-navy-300">
                Nesta fase o passageiro paga o valor total diretamente; a plataforma ainda não separa comissões automaticamente (sem provedor de pagamento integrado). {formatDateTime(ride.finishedAt)}
              </p>
            </Card>
            {details.payment && (
              <Card>
                <PixPanel payment={details.payment} role="motorista" onConfirm={async () => { await backend.setPaymentStatus(ride.id, 'confirmado_manual', `confirm-${ride.id}`); await reload(); }} />
              </Card>
            )}
            <Card>
              <p className="mb-2 font-bold">Avalie o passageiro</p>
              {details.myRating ? (
                <StarRating value={details.myRating} size={24} />
              ) : (
                <>
                  <StarRating value={stars} onChange={setStars} />
                  <Button className="mt-2" disabled={!stars} onClick={async () => { try { await backend.rateRide(ride.id, stars); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>
                    Enviar
                  </Button>
                </>
              )}
            </Card>
            <Button block variant="secondary" onClick={() => nav('/')}>
              Voltar ao início
            </Button>
          </>
        )}

        {ride.status === 'cancelada' && <Banner tone="warn">Corrida cancelada{ride.cancelReason ? `: ${ride.cancelReason}` : ''}.</Banner>}

        <Card>
          <details>
            <summary className="cursor-pointer font-bold">Histórico de status</summary>
            <div className="mt-3">
              <RideTimeline events={details.events} />
            </div>
          </details>
        </Card>
      </div>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar participação">
        <p className="mb-2 text-sm">
          {ride.status === 'motorista_chegou'
            ? 'A corrida será cancelada.'
            : ride.targetDriverId
              ? 'O passageiro escolheu você; ele será avisado para escolher outro motorista.'
              : 'A corrida volta para a fila e será oferecida a outro motorista.'}
        </p>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo">
          {DRIVER_CANCEL_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
        <Button
          block
          variant="danger"
          className="mt-4"
          onClick={async () => {
            try {
              await backend.cancelRide(ride.id, reason);
              setCancelOpen(false);
              await d.refreshActive();
              nav('/');
            } catch (e) {
              toast(friendlyError(e), 'error');
            }
          }}
        >
          Confirmar
        </Button>
      </Modal>
    </div>
  );
}
