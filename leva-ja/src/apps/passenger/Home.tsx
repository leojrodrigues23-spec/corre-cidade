import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { decodePolyline, haversineM, type LatLng } from '../../core/geo';
import { friendlyError } from '../../data/errors';
import type { Place, Profile, Quote } from '../../data/types';
import { useGeolocation } from '../../geo/useGeolocation';
import { type MapMarker, MapView } from '../../maps/MapView';
import { resolveSuggestion, reverseGeocode, searchPlaces, type Suggestion } from '../../maps/places';
import { Banner, Button, Card, IconButton, Input, Skeleton, Textarea, useToast } from '../../ui/components';
import { formatBRL, formatDistance, formatDuration } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { useApp } from '../shared/AppContext';
import { FareBreakdown, GpsBadge, GpsWarnings, PlaceLine } from '../shared/ride';

type Step = 'consent' | 'idle' | 'search' | 'pickup' | 'quote';

export function PassengerHome() {
  const { backend, settings, theme } = useApp();
  const nav = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [dest, setDest] = useState<Place | null>(null);
  const [pickup, setPickup] = useState<(LatLng & { address: string; ambiguous: boolean; manual: boolean }) | null>(null);
  const [mapCenter, setMapCenter] = useState<LatLng | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consent = !!profile?.locationConsentAt;
  const geo = useGeolocation({ enabled: consent });
  const defaults = settings?.map_defaults ?? { center: { lat: -23.153, lng: -47.0577 }, zoom: 14 };

  // recupera corrida ativa após recarregar/fechar o app
  useEffect(() => {
    backend.getActiveRideId().then((id) => id && nav(`/corrida/${id}`, { replace: true }));
    backend.getProfile().then((p) => {
      setProfile(p);
      if (!p.locationConsentAt) setStep('consent');
    });
  }, [backend, nav]);

  const myPos = geo.fix && !geo.assessment?.stale ? { lat: geo.fix.lat, lng: geo.fix.lng } : null;
  const initialCenter = useRef<LatLng | null>(null);
  if (!initialCenter.current && myPos) initialCenter.current = myPos;

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (geo.fix) m.push({ id: 'me', kind: 'me', position: geo.fix, accuracyM: geo.fix.accuracy, stale: geo.assessment?.stale, label: 'Você' });
    if (pickup && step === 'quote') m.push({ id: 'pickup', kind: 'pickup', position: pickup, label: 'Embarque' });
    if (dest && step === 'quote') m.push({ id: 'dest', kind: 'dest', position: dest, label: 'Destino' });
    return m;
  }, [geo.fix, geo.assessment?.stale, pickup, dest, step]);

  const path = quote?.polyline ? decodePolyline(quote.polyline) : quote && pickup && dest ? [pickup, dest] : null;

  const startPickup = (d: Place) => {
    setDest(d);
    setStep('pickup');
    setMapCenter(myPos ?? defaults.center);
  };

  // geocodificação reversa do pino (somente quando o mapa para de mover)
  const [pickAddr, setPickAddr] = useState<{ address: string; ambiguous: boolean } | null>(null);
  const [picked, setPicked] = useState<LatLng | null>(null);
  useEffect(() => {
    if (step !== 'pickup' || !picked) return;
    setPickAddr(null);
    const t = window.setTimeout(() => {
      reverseGeocode(picked)
        .then(setPickAddr)
        .catch(() => setPickAddr({ address: `Ponto no mapa (${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)})`, ambiguous: true }));
    }, 450);
    return () => window.clearTimeout(t);
  }, [picked, step]);

  const confirmPickup = async () => {
    if (!picked || !dest) return;
    if (haversineM(picked, dest) < 100) return setError('Embarque e destino estão muito próximos.');
    const manual = !myPos || haversineM(picked, myPos) > 25;
    const p = { ...picked, address: pickAddr?.address ?? 'Ponto escolhido no mapa', ambiguous: !!pickAddr?.ambiguous, manual };
    setPickup(p);
    setError(null);
    setBusy(true);
    try {
      const q = await backend.quoteRide(p, dest);
      setQuote(q);
      setStep('quote');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const request = async () => {
    if (!quote || !pickup || !dest) return;
    if (Date.parse(quote.expiresAt) < Date.now()) {
      setError('O preço expirou. Recalculando…');
      return confirmPickup();
    }
    setBusy(true);
    setError(null);
    try {
      const id = await backend.requestRide({ quoteId: quote.id, pickup: { ...pickup, accuracyM: pickup.manual ? null : geo.fix?.accuracy ?? null }, destAddress: dest.address, notes: notes.trim() || undefined });
      nav(`/corrida/${id}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('idle');
    setDest(null);
    setPickup(null);
    setQuote(null);
    setError(null);
  };

  return (
    <div className="relative h-dvh overflow-hidden">
      <MapView
        className="absolute inset-0"
        center={step === 'pickup' ? mapCenter ?? defaults.center : initialCenter.current ?? defaults.center}
        zoom={step === 'pickup' ? 17 : defaults.zoom}
        markers={markers}
        path={step === 'quote' ? path : null}
        fitKey={step === 'quote' ? quote?.id : undefined}
        pickMode={step === 'pickup'}
        onPick={step === 'pickup' ? setPicked : undefined}
        dark={theme.dark}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-4 pt-[calc(env(safe-area-inset-top)+2.25rem)]">
        <div className="pointer-events-auto">
          <GpsBadge geo={geo} label="Você" />
        </div>
        {step !== 'idle' && step !== 'consent' && <IconButton className="pointer-events-auto" icon="close" label="Cancelar" onClick={reset} />}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[calc(env(safe-area-inset-bottom)+4.75rem)]">
        <Card className="max-h-[62dvh] overflow-y-auto shadow-sheet animate-rise">
          {settings && !settings.operations_enabled && <Banner tone="warn" className="mb-3">Solicitações pausadas pelo administrador no momento.</Banner>}

          {step === 'consent' && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand">
                  <Icon name="locate" />
                </span>
                <p className="text-lg font-bold">Usar sua localização?</p>
              </div>
              <p className="mb-3 text-sm text-navy-600 dark:text-navy-100">
                Usamos sua localização apenas para sugerir o ponto de embarque e mostrar o motorista a caminho. Ela não é compartilhada com outros passageiros e você pode revogar quando quiser no Perfil.
              </p>
              <Button
                block
                size="lg"
                onClick={async () => {
                  await backend.setLocationConsent(true);
                  setProfile((p) => (p ? { ...p, locationConsentAt: new Date().toISOString() } : p));
                  setStep('idle');
                }}
              >
                Permitir localização
              </Button>
              <Button block variant="ghost" className="mt-1" onClick={() => setStep('idle')}>
                Agora não (escolher no mapa)
              </Button>
            </div>
          )}

          {step === 'idle' && (
            <div>
              <p className="mb-3 text-xl font-extrabold">Para onde vamos?</p>
              <button onClick={() => setStep('search')} className="flex h-14 w-full items-center gap-3 rounded-2xl bg-mist px-4 text-left text-navy-500 ring-1 ring-navy/10 transition hover:ring-brand dark:bg-navy-800 dark:text-navy-300 dark:ring-white/10" data-testid="open-search">
                <Icon name="search" />
                Buscar destino
              </button>
              <div className="mt-3">
                <GpsWarnings geo={geo} />
              </div>
            </div>
          )}

          {step === 'search' && <DestinationSearch bias={myPos ?? defaults.center} onPick={startPickup} onBack={() => setStep('idle')} />}

          {step === 'pickup' && dest && (
            <div>
              <p className="text-lg font-bold">Confirme o ponto de embarque</p>
              <p className="mb-3 text-sm text-navy-500 dark:text-navy-300">Arraste o mapa para posicionar o pino exatamente onde você estará.</p>
              <PlaceLine icon="pin" title="Embarque" text={pickAddr?.address ?? 'Localizando endereço…'} />
              <PlaceLine icon="flag" title="Destino" text={dest.label} />
              {pickAddr?.ambiguous && (
                <Banner tone="warn" className="my-2">
                  Endereço aproximado. Confira o pino no mapa e use as observações para indicar uma referência.
                </Banner>
              )}
              {myPos && picked && haversineM(myPos, picked) > 150 && <Banner tone="info" className="my-2">O ponto está a {formatDistance(haversineM(myPos, picked))} da sua localização atual.</Banner>}
              <div className="my-2">
                <GpsWarnings geo={geo} />
              </div>
              {error && <Banner tone="error" className="my-2">{error}</Banner>}
              <div className="mt-3 flex gap-2">
                {myPos && <IconButton icon="locate" label="Centralizar na minha posição" onClick={() => setMapCenter({ ...myPos })} />}
                <Button block size="lg" loading={busy} disabled={!picked || !pickAddr} onClick={confirmPickup} data-testid="confirm-pickup">
                  Confirmar embarque
                </Button>
              </div>
            </div>
          )}

          {step === 'quote' && quote && pickup && dest && (
            <div>
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <p className="text-sm text-navy-500 dark:text-navy-300">
                    {formatDistance(quote.distanceM)} · {formatDuration(quote.durationS)}
                  </p>
                  <p className="text-3xl font-extrabold tabular-nums" data-testid="quote-total">
                    {formatBRL(quote.totalCents)}
                  </p>
                </div>
                {settings?.pilot_mode && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Simulação</span>}
              </div>
              <PlaceLine icon="pin" title="Embarque" text={pickup.address} />
              <PlaceLine icon="flag" title="Destino" text={dest.address} />
              <details className="my-2 rounded-2xl bg-mist p-3 dark:bg-navy-800" open>
                <summary className="cursor-pointer text-sm font-semibold">Detalhamento do preço</summary>
                <div className="mt-2">
                  <FareBreakdown q={quote} />
                </div>
              </details>
              <Textarea placeholder="Observações para o motorista (opcional): ponto de referência, portão…" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <Banner tone="error" className="mt-2">{error}</Banner>}
              <Button block size="lg" className="mt-3" loading={busy} onClick={request} disabled={settings?.operations_enabled === false} data-testid="request-ride">
                Solicitar corrida
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function DestinationSearch({ bias, onPick, onBack }: { bias: LatLng; onPick: (p: Place) => void; onBack: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (q.trim().length < 3) {
      setItems(null);
      return;
    }
    setLoading(true);
    // debounce: evita chamadas excessivas (e custo) ao Places
    const t = window.setTimeout(() => {
      searchPlaces(q, bias)
        .then((r) => {
          setItems(r);
          setError(null);
        })
        .catch(() => setError('Busca de endereços indisponível agora.'))
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [q, bias]);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="rounded-xl p-2 hover:bg-navy/5 dark:hover:bg-white/10" aria-label="Voltar">
          <Icon name="chevronLeft" />
        </button>
        <Input autoFocus placeholder="Digite o endereço de destino" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Destino" data-testid="dest-input" />
      </div>
      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {!loading && items && items.length === 0 && <p className="py-4 text-center text-sm text-navy-500">Nenhum endereço encontrado. Tente incluir número e bairro.</p>}
      {!loading && items && items.length > 1 && items[0].source === 'google' && <p className="mb-1 text-xs text-navy-500">Vários resultados: confira bairro e cidade antes de escolher.</p>}
      <ul className="divide-y divide-navy/5 dark:divide-white/5">
        {!loading &&
          items?.map((s) => (
            <li key={s.id}>
              <button
                className="flex w-full items-start gap-3 py-3 text-left"
                onClick={async () => {
                  try {
                    onPick(await resolveSuggestion(s));
                  } catch (e) {
                    toast(friendlyError(e), 'error');
                  }
                }}
              >
                <Icon name="pin" size={18} className="mt-0.5 shrink-0 text-navy-500" />
                <span>
                  <span className="block text-sm font-semibold">{s.primary}</span>
                  <span className="block text-xs text-navy-500 dark:text-navy-300">{s.secondary}</span>
                </span>
              </button>
            </li>
          ))}
      </ul>
      {q.trim().length < 3 && <p className="text-xs text-navy-500 dark:text-navy-300">Digite pelo menos 3 caracteres.</p>}
      {items?.[0]?.source === 'simulado' && <p className="mt-2 text-xs text-fuchsia-700 dark:text-fuchsia-300">Sem Google Maps configurado: exibindo apenas pontos fictícios de teste.</p>}
    </div>
  );
}
