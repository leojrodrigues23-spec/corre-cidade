import { useCallback, useEffect, useRef, useState } from 'react';
import type { FixAssessment } from '../../core/geo';
import { PAYMENT_STATUS_LABEL } from '../../core/pix';
import { RIDE_STATUS_LABEL, type RideStatus } from '../../core/ride';
import { friendlyError } from '../../data/errors';
import type { DriverLocation, Payment, Quote, RideDetails } from '../../data/types';
import type { GeoState } from '../../geo/useGeolocation';
import { localNotify } from '../../pwa/install';
import { Badge, Banner, Button, KeyValue, useToast } from '../../ui/components';
import { formatBRL, formatDistance, formatDuration, formatTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { QrCodeView } from '../../ui/QrCode';
import { useApp } from './AppContext';

/** Detalhes da corrida em tempo real, com recarga ao reconectar/voltar ao app (estado sobrevive a reload). */
export function useRideDetails(rideId: string | null) {
  const { backend } = useApp();
  const [details, setDetails] = useState<RideDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!rideId) return;
    try {
      setDetails(await backend.getRideDetails(rideId));
      setLastSync(Date.now());
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [backend, rideId]);
  useEffect(() => {
    setDetails(null);
    if (!rideId) return;
    void load();
    const unsub = backend.subscribeRide(rideId, () => void load());
    // fallback caso o canal realtime caia: consulta periódica leve
    const poll = window.setInterval(() => document.visibilityState === 'visible' && void load(), 15000);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      unsub();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [rideId, backend, load]);
  return { details, error, reload: load, lastSync };
}

export function useDriverLocation(driverId: string | null) {
  const { backend } = useApp();
  const [loc, setLoc] = useState<DriverLocation | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setLoc(null);
    if (!driverId) return;
    return backend.subscribeDriverLocation(driverId, setLoc);
  }, [driverId, backend]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  // "ao vivo" = sinal recebido há menos de 30 s; caso contrário, mostra como último sinal conhecido
  const ageS = loc ? Math.round((now - Date.parse(loc.receivedAt)) / 1000) : null;
  return { loc, ageS, live: ageS !== null && ageS <= 30 };
}

/** Notificações do servidor → toast no app + notificação local quando em segundo plano. */
export function useNotificationFeed(onEvent?: (kind: string, rideId: string | null) => void) {
  const { backend, session } = useApp();
  const toast = useToast();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!session) return;
    return backend.subscribeNotifications((n) => {
      toast(n.title + (n.body ? ` — ${n.body}` : ''), n.kind.includes('cancel') || n.kind.includes('expired') ? 'warn' : 'info');
      if (document.visibilityState !== 'visible') void localNotify(n.title, n.body ?? undefined, n.rideId ?? n.kind);
      cb.current?.(n.kind, n.rideId);
    });
  }, [backend, session, toast]);
}

export function RideStatusPill({ status }: { status: RideStatus }) {
  const tone = status === 'finalizada' ? 'green' : status === 'cancelada' || status === 'expirada' ? 'red' : status === 'procurando_motorista' ? 'amber' : 'navy';
  return <Badge tone={tone}>{RIDE_STATUS_LABEL[status]}</Badge>;
}

export function FareBreakdown({ q, showDriverSplit }: { q: Pick<Quote, 'baseCents' | 'distanceCents' | 'timeCents' | 'subtotalCents' | 'minimumCents' | 'totalCents' | 'distanceM' | 'durationS' | 'routeSource' | 'pricingMode' | 'commissionCents' | 'driverNetCents' | 'fareVersion'>; showDriverSplit?: boolean }) {
  return (
    <div>
      <KeyValue k="Bandeirada" v={formatBRL(q.baseCents)} />
      <KeyValue k={`Distância (${formatDistance(q.distanceM)})`} v={formatBRL(q.distanceCents)} />
      <KeyValue k={`Tempo estimado (${formatDuration(q.durationS)})`} v={formatBRL(q.timeCents)} />
      {q.totalCents > q.subtotalCents && <KeyValue k={`Ajuste para tarifa mínima (${formatBRL(q.minimumCents)})`} v={formatBRL(q.totalCents - q.subtotalCents)} />}
      <KeyValue k="Total" v={formatBRL(q.totalCents)} strong />
      {showDriverSplit && (
        <>
          <KeyValue k="Comissão da plataforma (simulada)" v={`− ${formatBRL(q.commissionCents)}`} />
          <KeyValue k="Líquido do motorista" v={formatBRL(q.driverNetCents)} />
        </>
      )}
      <p className="mt-2 text-xs text-navy-500 dark:text-navy-300">
        Tarifa v{q.fareVersion} · {q.pricingMode === 'variavel' ? 'valor final recalculado pelo tempo real da viagem (mesma tabela)' : 'preço fixado na solicitação'}
        {q.routeSource === 'simulada' && ' · distância ESTIMADA por rota simulada (sem Routes API)'}
      </p>
    </div>
  );
}

export function GpsBadge({ geo, label = 'Seu GPS' }: { geo: GeoState; label?: string }) {
  if (geo.status === 'denied') return <Badge tone="red">Localização negada</Badge>;
  if (geo.status === 'unsupported' || geo.status === 'insecure') return <Badge tone="red">Sem geolocalização</Badge>;
  if (geo.status === 'requesting' || (!geo.fix && geo.status === 'watching')) return <Badge tone="amber">Obtendo localização…</Badge>;
  if (!geo.fix || !geo.assessment) return <Badge>GPS desligado</Badge>;
  const a: FixAssessment = geo.assessment;
  const tone = a.stale ? 'red' : a.quality === 'bom' ? 'green' : a.quality === 'moderado' ? 'neutral' : 'amber';
  return (
    <Badge tone={tone}>
      <span className={`h-2 w-2 rounded-full ${a.stale ? 'bg-red-500' : a.quality === 'bom' ? 'bg-brand' : 'bg-amber-500'}`} />
      {label ? `${label}: ` : ''}
      {a.label}
    </Badge>
  );
}

export function GpsWarnings({ geo }: { geo: GeoState }) {
  if (geo.status === 'denied')
    return (
      <Banner tone="error" title="Localização bloqueada">
        Libere a localização nas configurações do navegador/aparelho para este site. Você ainda pode escolher o ponto manualmente no mapa.
      </Banner>
    );
  if (geo.assessment?.stale)
    return (
      <Banner tone="warn" title="Localização desatualizada">
        Não recebemos leitura nova do GPS {geo.assessment.label.replace('Localização desatualizada ', '')}. Em PWA, o envio pode parar com a tela bloqueada ou o app em segundo plano.
      </Banner>
    );
  if (geo.assessment && (geo.assessment.quality === 'fraco' || geo.assessment.quality === 'ruim'))
    return (
      <Banner tone="warn" title="GPS fraco">
        Precisão de ±{Math.round(geo.fix!.accuracy)} m. Confirme o ponto no mapa; ao ar livre a precisão costuma melhorar.
      </Banner>
    );
  if (geo.timedOut && !geo.fix) return <Banner tone="warn">Está demorando para obter sua localização. Verifique se o GPS do aparelho está ligado.</Banner>;
  return null;
}

export function RideTimeline({ events }: { events: RideDetails['events'] }) {
  return (
    <ol className="relative ml-2 border-l border-navy/10 dark:border-white/10">
      {events.map((e, i) => (
        <li key={i} className="mb-3 ml-4">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
          <p className="text-sm font-semibold">{RIDE_STATUS_LABEL[e.to]}</p>
          <p className="text-xs text-navy-500 dark:text-navy-300">
            {formatTime(e.at)} · por {e.by}
            {e.reason ? ` · ${e.reason}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Pix demonstrativo: QR + copia-e-cola. Exibir/copiar NUNCA marca como pago. */
export function PixPanel({ payment, role, onInform, onConfirm }: { payment: Payment; role: 'passageiro' | 'motorista'; onInform?: () => Promise<void>; onConfirm?: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const act = async (fn?: () => Promise<void>) => {
    if (!fn) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-bold">Pagamento via Pix</p>
        <Badge tone={payment.status === 'confirmado_manual' ? 'green' : payment.status === 'cancelado' ? 'red' : 'amber'}>{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
      </div>
      {payment.isSimulation && (
        <Banner tone="demo" className="mb-3" title="SIMULAÇÃO — não pague">
          Modo piloto: este QR usa uma chave de teste inexistente e serve apenas para demonstrar o fluxo. Nenhum dinheiro deve ser transferido.
        </Banner>
      )}
      <p className="mb-1 text-center text-3xl font-extrabold tabular-nums">{formatBRL(payment.amountCents)}</p>
      <p className="mb-3 text-center text-xs text-navy-500 dark:text-navy-300">Recebedor: {payment.holderName}</p>
      {role === 'passageiro' && (
        <>
          {payment.isSimulation && !revealed ? (
            <Button block variant="secondary" onClick={() => setRevealed(true)} className="mb-3">
              Ver QR Code de demonstração
            </Button>
          ) : (
            <div className="mb-3">
              <QrCodeView text={payment.brcode} overlay={payment.isSimulation ? 'Simulação · não pague' : undefined} />
              <div className="mt-3 rounded-2xl bg-mist p-3 dark:bg-navy-800">
                <p className="mb-1 text-xs font-semibold text-navy-500 dark:text-navy-300">Pix Copia e Cola{payment.isSimulation ? ' (simulação)' : ''}</p>
                <p className="break-all font-mono text-[11px] leading-snug">{payment.brcode}</p>
              </div>
              <Button
                block
                variant="secondary"
                icon="copy"
                className="mt-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(payment.brcode);
                  toast(payment.isSimulation ? 'Código de SIMULAÇÃO copiado — não use para pagar' : 'Código copiado', payment.isSimulation ? 'warn' : 'success');
                }}
              >
                Copiar código
              </Button>
            </div>
          )}
          {payment.status === 'aguardando' && (
            <Button block loading={busy} onClick={() => act(onInform)}>
              Informar que paguei
            </Button>
          )}
          <p className="mt-2 text-xs text-navy-500 dark:text-navy-300">O pagamento só é considerado confirmado após conferência manual do motorista ou administrador. Não é preciso cadastrar chave Pix para pagar.</p>
        </>
      )}
      {role === 'motorista' && payment.status !== 'confirmado_manual' && payment.status !== 'cancelado' && (
        <>
          <Banner tone="info" className="mb-3">
            Confira o recebimento no seu banco antes de confirmar. Comprovante enviado por imagem não é confirmação.
          </Banner>
          <Button block loading={busy} onClick={() => act(onConfirm)} icon="check">
            Confirmar recebimento (manual)
          </Button>
        </>
      )}
    </div>
  );
}

export function PlaceLine({ icon, title, text }: { icon: 'pin' | 'flag'; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${icon === 'pin' ? 'bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand' : 'bg-navy/5 text-navy dark:bg-white/10 dark:text-white'}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-500 dark:text-navy-300">{title}</p>
        <p className="truncate text-sm font-medium">{text}</p>
      </div>
    </div>
  );
}
