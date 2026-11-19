import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { decodePolyline, haversineM, type LatLng } from '../../core/geo';
import { errorCode, friendlyError } from '../../data/errors';
import type { DriverPriceOption, Place, Profile, Quote, Ride } from '../../data/types';
import { useGeolocation } from '../../geo/useGeolocation';
import { type MapMarker, MapView } from '../../maps/MapView';
import { resolveSuggestion, reverseGeocode, searchPlaces, type Suggestion } from '../../maps/places';
import { Banner, Button, Card, IconButton, Input, Modal, Skeleton, Textarea, useToast } from '../../ui/components';
import { formatBRL, formatDistance, formatDuration } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { RIDE_STATUS_LABEL } from '../../core/ride';
import { useApp } from '../shared/AppContext';
import { BankHeader, BankSection, HeaderIcon, Money, QuickActions, Statement, type StatementItem, useHiddenValues } from '../shared/Bank';
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
  const [recent, setRecent] = useState<Place[]>([]);
  const [rides, setRides] = useState<Ride[] | null>(null);
  // modo de preço: tarifa automática (todos os motoristas) ou escolher um motorista pelo preço dele
  const [priceMode, setPriceMode] = useState<'automatico' | 'escolher'>('automatico');
  const [drivers, setDrivers] = useState<DriverPriceOption[] | null>(null);
  const [driversLoading, setDriversLoading] = useState(false);
  const [chosen, setChosen] = useState<DriverPriceOption | null>(null);

  const loadDrivers = async () => {
    if (!quote || !pickup) return;
    setDriversLoading(true);
    try {
      const list = await backend.listDriverPrices(quote.id, pickup);
      setDrivers(list);
      setChosen((c) => (c ? list.find((d) => d.driverId === c.driverId) ?? null : null));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setDriversLoading(false);
    }
  };
  useEffect(() => {
    if (step !== 'quote' || priceMode !== 'escolher') return;
    void loadDrivers();
    const t = window.setInterval(() => void loadDrivers(), 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, priceMode, quote?.id]);

  const consent = !!profile?.locationConsentAt;
  const geo = useGeolocation({ enabled: consent });
  const defaults = settings?.map_defaults ?? { center: { lat: -23.153, lng: -47.0577 }, zoom: 14 };

  // recupera corrida ativa após recarregar/fechar o app
  useEffect(() => {
    backend.getActiveRideId().then((id) => id && nav(`/corrida/${id}`, { replace: true }));
    // atalhos: últimos destinos de corridas finalizadas (sem duplicar)
    backend
      .listMyRides()
      .then((rides) => {
        setRides(rides);
        const seen = new Set<string>();
        const out: Place[] = [];
        for (const r of rides) {
          if (r.status !== 'finalizada' || seen.has(r.dest.address)) continue;
          seen.add(r.dest.address);
          out.push({ lat: r.dest.lat, lng: r.dest.lng, address: r.dest.address, label: r.dest.address.split(',')[0], source: 'mapa' });
          if (out.length === 4) break;
        }
        setRecent(out);
      })
      .catch(() => undefined);
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
      setChosen(null);
      setDrivers(null);
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
      if (priceMode === 'escolher' && !chosen) {
        setError('Escolha um motorista da lista ou use a tarifa automática.');
        return;
      }
      const id = await backend.requestRide({
        quoteId: quote.id,
        pickup: { ...pickup, accuracyM: pickup.manual ? null : geo.fix?.accuracy ?? null },
        destAddress: dest.address,
        notes: notes.trim() || undefined,
        ...(priceMode === 'escolher' && chosen ? { driverId: chosen.driverId, expectedTotalCents: chosen.totalCents } : {}),
      });
      nav(`/corrida/${id}`);
    } catch (e) {
      setError(friendlyError(e));
      const code = errorCode(e);
      if (code === 'PRICE_CHANGED' || code === 'DRIVER_UNAVAILABLE') {
        setChosen(null);
        void loadDrivers();
      }
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
    setPriceMode('automatico');
    setDrivers(null);
    setChosen(null);
  };

  if (step === 'idle' || step === 'consent')
    return (
      <PassengerDashboard
        profile={profile}
        geo={geo}
        rides={rides}
        recent={recent}
        askConsent={step === 'consent'}
        onConsent={async (granted) => {
          if (granted) {
            await backend.setLocationConsent(true);
            setProfile((p) => (p ? { ...p, locationConsentAt: new Date().toISOString() } : p));
          }
          setStep('idle');
        }}
        onSearch={() => setStep('search')}
        onPick={startPickup}
      />
    );

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

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <div className="pointer-events-auto mx-auto flex max-w-lg items-center gap-3 rounded-[24px] bg-night-grad p-3 pr-2 text-white shadow-float ring-1 ring-white/10">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-grad text-lg font-extrabold text-navy-950 shadow-glow">
            {(profile?.fullName || 'L').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold leading-tight">Olá, {profile?.fullName?.split(' ')[0] || 'bem-vindo(a)'}!</p>
            <div className="mt-1 [&>span]:bg-white/10 [&>span]:text-white">
              <GpsBadge geo={geo} label="" />
            </div>
          </div>
          <button onClick={reset} aria-label="Cancelar" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 transition hover:bg-white/20">
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[calc(env(safe-area-inset-bottom)+4.75rem)]">
        <Card className="max-h-[62dvh] overflow-y-auto shadow-sheet animate-rise">
          {settings && !settings.operations_enabled && <Banner tone="warn" className="mb-3">Solicitações pausadas pelo administrador no momento.</Banner>}

          {step === 'search' && <DestinationSearch bias={myPos ?? defaults.center} onPick={startPickup} onBack={reset} />}

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
              <div className="relative mb-3 overflow-hidden rounded-3xl bg-price-grad p-4 text-white shadow-float">
                <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand/30 blur-2xl" />
                <div className="relative flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-grad text-navy-950 shadow-glow">
                    <Icon name="car" size={24} />
                  </span>
                  <div className="flex-1">
                    <p className="font-extrabold">Leva Já Carro</p>
                    <p className="text-xs text-navy-100">
                      {formatDistance(quote.distanceM)} · {formatDuration(quote.durationS)} de viagem
                    </p>
                  </div>
                  {settings?.pilot_mode && <span className="rounded-full bg-sun px-2 py-0.5 text-[10px] font-extrabold uppercase text-navy-950">Simulação</span>}
                </div>
                <p className="relative mt-3 text-4xl font-extrabold tabular-nums tracking-tight" data-testid="quote-total">
                  {formatBRL(priceMode === 'escolher' && chosen ? chosen.totalCents : quote.totalCents)}
                </p>
                <p className="relative text-xs text-navy-100">
                  {priceMode === 'escolher'
                    ? chosen
                      ? `Preço de ${chosen.name}: ${formatBRL(chosen.perKmCents)}/km`
                      : 'Escolha um motorista abaixo'
                    : quote.pricingMode === 'variavel'
                      ? 'Tarifa automática · pode variar com o tempo real da viagem'
                      : 'Tarifa automática · preço fechado na solicitação'}
                </p>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-mist p-1 dark:bg-navy-800" role="radiogroup" aria-label="Como escolher o preço">
                {([
                  ['automatico', 'Tarifa automática', 'Qualquer motorista'],
                  ['escolher', 'Escolher motorista', 'Pelo preço de cada um'],
                ] as const).map(([v, t, sub]) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={priceMode === v}
                    onClick={() => {
                      setPriceMode(v);
                      setError(null);
                    }}
                    data-testid={`price-mode-${v}`}
                    className={`rounded-xl px-2 py-2 text-center transition ${priceMode === v ? 'bg-brand-grad text-navy-950 shadow-glow' : 'text-navy-600 hover:bg-white dark:text-navy-100 dark:hover:bg-navy-700'}`}
                  >
                    <span className="block text-sm font-extrabold">{t}</span>
                    <span className="block text-[11px] font-semibold opacity-80">{sub}</span>
                  </button>
                ))}
              </div>

              {priceMode === 'escolher' && (
                <div className="mb-3" data-testid="driver-prices">
                  {driversLoading && !drivers && (
                    <div className="space-y-2">
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                    </div>
                  )}
                  {drivers && drivers.length === 0 && (
                    <Banner tone="info">Nenhum motorista disponível por perto agora. Tente a tarifa automática ou aguarde alguns instantes.</Banner>
                  )}
                  <ul className="space-y-2">
                    {drivers?.map((d) => {
                      const sel = chosen?.driverId === d.driverId;
                      return (
                        <li key={d.driverId}>
                          <button
                            onClick={() => setChosen(d)}
                            aria-pressed={sel}
                            data-testid="driver-option"
                            className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-2 transition ${sel ? 'bg-brand-50 ring-brand dark:bg-brand/10' : 'bg-white ring-navy/5 hover:ring-brand/50 dark:bg-navy-900 dark:ring-white/10'}`}
                          >
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-grad text-lg font-extrabold text-navy-950">{d.name.slice(0, 1)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold">
                                {d.name} {d.rating != null && <span className="text-sm font-semibold text-amber-500">★ {d.rating}</span>}
                              </span>
                              <span className="block truncate text-xs text-navy-500 dark:text-navy-300">{d.vehicle ?? 'Veículo cadastrado'}</span>
                              <span className="mt-0.5 flex flex-wrap gap-1 text-[11px] font-bold">
                                <span className="rounded-full bg-navy/5 px-2 py-0.5 dark:bg-white/10">a {formatDistance(d.distanceM)}</span>
                                <span className={`rounded-full px-2 py-0.5 ${d.priceMode === 'proprio' ? 'bg-royal/10 text-royal dark:bg-royal-400/20 dark:text-royal-400' : 'bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand'}`}>
                                  {d.priceMode === 'proprio' ? `${formatBRL(d.perKmCents)}/km` : 'Tarifa automática'}
                                </span>
                                {d.requiresPin && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-400/15 dark:text-sun">PIN</span>}
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block text-lg font-extrabold tabular-nums">{formatBRL(d.totalCents)}</span>
                              {sel && <span className="text-[11px] font-bold text-brand-700 dark:text-brand">Escolhido</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <PlaceLine icon="pin" title="Embarque" text={pickup.address} />
              <PlaceLine icon="flag" title="Destino" text={dest.address} />
              <details className="my-2 rounded-2xl bg-mist p-3 dark:bg-navy-800" open>
                <summary className="cursor-pointer text-sm font-semibold">Detalhamento do preço</summary>
                <div className="mt-2">
                  {priceMode === 'escolher' && chosen && chosen.priceMode === 'proprio' ? (
                    <p className="text-sm text-navy-600 dark:text-navy-100">
                      Mesma base e tempo da tarifa Leva Já, com o preço por km de {chosen.name} ({formatBRL(chosen.perKmCents)}/km). O valor é recalculado e conferido no servidor.
                    </p>
                  ) : (
                    <FareBreakdown q={quote} />
                  )}
                </div>
              </details>
              <Textarea placeholder="Observações para o motorista (opcional): ponto de referência, portão…" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {error && <Banner tone="error" className="mt-2">{error}</Banner>}
              <Button block size="lg" className="mt-3" loading={busy} onClick={request} disabled={settings?.operations_enabled === false || (priceMode === 'escolher' && !chosen)} data-testid="request-ride">
                {priceMode === 'escolher' ? (chosen ? `Pedir com ${chosen.name}` : 'Escolha um motorista') : 'Solicitar corrida'}
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

/** Tela inicial estilo app de banco: saudação, "saldo" de corridas do mês, atalhos e extrato. */
function PassengerDashboard({
  profile,
  geo,
  rides,
  recent,
  askConsent,
  onConsent,
  onSearch,
  onPick,
}: {
  profile: Profile | null;
  geo: ReturnType<typeof useGeolocation>;
  rides: Ride[] | null;
  recent: Place[];
  askConsent: boolean;
  onConsent: (granted: boolean) => Promise<void>;
  onSearch: () => void;
  onPick: (p: Place) => void;
}) {
  const { settings } = useApp();
  const [hidden, toggleHidden] = useHiddenValues();
  const [info, setInfo] = useState<'seguranca' | 'ajuda' | null>(null);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthRides = (rides ?? []).filter((r) => r.status === 'finalizada' && Date.parse(r.finishedAt ?? r.createdAt) >= monthStart.getTime());
  const monthCents = monthRides.reduce((a, r) => a + r.totalCents, 0);
  const statement: StatementItem[] = (rides ?? []).slice(0, 4).map((r) => ({
    id: r.id,
    at: r.finishedAt ?? r.createdAt,
    icon: 'car',
    title: r.dest.address.split(',')[0],
    subtitle: r.status === 'finalizada' ? 'Corrida' : RIDE_STATUS_LABEL[r.status],
    cents: r.totalCents,
    muted: r.status === 'cancelada' || r.status === 'expirada',
    to: `/corrida/${r.id}`,
  }));
  const monthName = new Date().toLocaleDateString('pt-BR', { month: 'long' });

  return (
    <div className="min-h-dvh bg-mist pb-28 dark:bg-transparent">
      <BankHeader
        name={profile?.fullName ?? ''}
        hidden={hidden}
        onToggleHidden={toggleHidden}
        subtitle={
          <span className="[&>span]:bg-white/10 [&>span]:text-white">
            <GpsBadge geo={geo} label="" />
          </span>
        }
        right={<HeaderIcon icon="help" label="Ajuda" onClick={() => setInfo('ajuda')} />}
      >
        <p className="text-[13px] font-semibold text-white/70">Para onde vamos hoje?</p>
        <button
          onClick={onSearch}
          className="mt-2 flex h-14 w-full items-center gap-3 rounded-2xl bg-white px-4 text-left text-navy shadow-float transition active:scale-[.99]"
          data-testid="open-search"
        >
          <Icon name="search" className="text-brand-700" />
          <span className="flex-1 text-[15px] font-bold text-navy-500">Buscar destino</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-grad text-navy-950">
            <Icon name="chevronRight" size={18} />
          </span>
        </button>
      </BankHeader>

      <div className="mx-auto max-w-lg space-y-4 px-4 pt-5">
        {settings && !settings.operations_enabled && <Banner tone="warn">Solicitações pausadas pelo administrador no momento.</Banner>}

        {askConsent && (
          <BankSection title="Usar sua localização?">
            <p className="mb-3 text-sm leading-relaxed text-navy-600 dark:text-navy-100">
              Usamos sua localização apenas para sugerir o ponto de embarque e mostrar o motorista a caminho. Ela não é compartilhada com outros passageiros e você pode revogar quando quiser no Perfil.
            </p>
            <Button block size="lg" onClick={() => void onConsent(true)}>
              Permitir localização
            </Button>
            <Button block variant="ghost" className="mt-1" onClick={() => void onConsent(false)}>
              Agora não (escolher no mapa)
            </Button>
          </BankSection>
        )}

        <QuickActions
          items={[
            { icon: 'car', label: 'Pedir corrida', onClick: onSearch, highlight: true },
            { icon: 'receipt', label: 'Extrato', to: '/historico' },
            { icon: 'qr', label: 'Pix', to: '/perfil' },
            { icon: 'shield', label: 'Segurança', onClick: () => setInfo('seguranca') },
            { icon: 'install', label: 'Instalar app', to: '/instalar' },
          ]}
        />

        <BankSection>
          <Link to="/historico" className="flex items-center gap-3" aria-label="Ver extrato de corridas">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Corridas em {monthName}</p>
              <Money cents={monthCents} hidden={hidden} size="lg" className="mt-1 block" />
              <p className="mt-1 text-sm text-navy-500 dark:text-navy-300">
                {monthRides.length} corrida{monthRides.length === 1 ? '' : 's'} finalizada{monthRides.length === 1 ? '' : 's'}
                {settings?.pilot_mode ? ' · valores simulados' : ''}
              </p>
            </div>
            <Icon name="chevronRight" className="text-navy-300" />
          </Link>
        </BankSection>

        {recent.length > 0 && (
          <BankSection title="Destinos recentes">
            <ul className="divide-y divide-navy/5 dark:divide-white/5">
              {recent.map((r) => (
                <li key={r.address}>
                  <button onClick={() => onPick(r)} className="flex w-full items-center gap-3 py-3 text-left">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-royal/10 text-royal dark:bg-royal-400/20 dark:text-royal-400">
                      <Icon name="history" size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{r.label}</span>
                      <span className="block truncate text-xs text-navy-500 dark:text-navy-300">{r.address}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="text-navy-300" />
                  </button>
                </li>
              ))}
            </ul>
          </BankSection>
        )}

        <button onClick={() => setInfo('seguranca')} className="relative block w-full overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#1B4FD8_0%,#102A43_100%)] p-5 text-left text-white shadow-float">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-royal-400/40 blur-2xl" />
          <div className="relative flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <Icon name="shield" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-extrabold">PIN em toda corrida</span>
              <span className="block text-sm text-white/75">Motorista aprovado, placa conferida e código de embarque só seu.</span>
            </span>
            <Icon name="chevronRight" className="text-white/60" />
          </div>
        </button>

        <BankSection title="Últimas corridas" action={<Link to="/historico" className="text-sm font-bold text-brand-700 dark:text-brand">Ver tudo</Link>}>
          {!rides ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (
            <Statement items={statement} hidden={hidden} empty={<p className="py-2 text-sm text-navy-500 dark:text-navy-300">Suas corridas aparecem aqui, como um extrato.</p>} />
          )}
        </BankSection>

        <GpsWarnings geo={geo} />
      </div>

      <Modal open={info === 'seguranca'} onClose={() => setInfo(null)} title="Sua segurança">
        <ul className="space-y-3 text-sm leading-relaxed">
          <li><strong>PIN de embarque:</strong> quando o motorista pede, diga os 4 números que aparecem no seu app. Ele só inicia a corrida se o código bater.</li>
          <li><strong>Confira a placa e o carro</strong> antes de entrar. Os dados aparecem assim que o motorista aceita.</li>
          <li><strong>Motoristas aprovados:</strong> só entram no piloto depois de aprovados pela equipe Leva Já.</li>
          <li><strong>Preço antes:</strong> você vê o valor completo antes de confirmar e paga por Pix no final.</li>
        </ul>
      </Modal>
      <Modal open={info === 'ajuda'} onClose={() => setInfo(null)} title="Ajuda">
        <p className="text-sm leading-relaxed">{settings?.support_contact ? `Fale com o suporte: ${settings.support_contact}` : 'Durante o piloto, fale diretamente com a equipe que enviou o seu convite.'}</p>
      </Modal>
    </div>
  );
}
