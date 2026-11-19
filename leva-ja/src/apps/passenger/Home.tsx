import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { decodePolyline, haversineM, type LatLng } from '../../core/geo';
import { errorCode, friendlyError } from '../../data/errors';
import type { DriverPriceOption, Place, Profile, Quote } from '../../data/types';
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
  const [recent, setRecent] = useState<Place[]>([]);
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

      {/* topo mínimo: avatar (configurações), GPS e, durante o pedido, voltar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+2.25rem)]">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          {step === 'idle' || step === 'consent' ? (
            <Link
              to="/perfil"
              aria-label="Configurações"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-base font-extrabold text-navy shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:text-white dark:ring-white/10"
            >
              {(profile?.fullName || 'L').slice(0, 1).toUpperCase()}
            </Link>
          ) : (
            <button
              onClick={reset}
              aria-label="Cancelar"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white text-navy shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:text-white dark:ring-white/10"
            >
              <Icon name="close" size={20} />
            </button>
          )}
          <div className="pointer-events-auto rounded-full bg-white px-1 py-1 shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:ring-white/10">
            <GpsBadge geo={geo} label="" />
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 mx-auto max-w-lg px-3 pb-[calc(env(safe-area-inset-bottom)+4.75rem)]">
        <Card className="max-h-[58dvh] overflow-y-auto p-4 shadow-sheet animate-rise">
          {step === 'consent' && (
            <div>
              <p className="text-base font-extrabold">Usar sua localização?</p>
              <p className="mb-3 mt-1 text-sm text-navy-500 dark:text-navy-300">Só para sugerir o embarque e mostrar o motorista chegando. Você pode revogar no Perfil.</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep('idle')}>
                  Agora não
                </Button>
                <Button
                  block
                  onClick={async () => {
                    await backend.setLocationConsent(true);
                    setProfile((p) => (p ? { ...p, locationConsentAt: new Date().toISOString() } : p));
                    setStep('idle');
                  }}
                >
                  Permitir localização
                </Button>
              </div>
            </div>
          )}

          {step === 'idle' && (
            <div>
              <button
                onClick={() => setStep('search')}
                className="flex h-14 w-full items-center gap-3 rounded-2xl bg-mist px-4 text-left transition active:scale-[.99] dark:bg-navy-800"
                data-testid="open-search"
              >
                <Icon name="search" className="text-petrol dark:text-brand" />
                <span className="flex-1 text-[17px] font-extrabold">Para onde?</span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-navy-500 shadow-sm dark:bg-navy-900 dark:text-navy-300">Agora</span>
              </button>
              {recent.length > 0 && (
                <ul className="mt-1">
                  {recent.slice(0, 2).map((r) => (
                    <li key={r.address}>
                      <button onClick={() => startPickup(r)} className="flex w-full items-center gap-3 py-2.5 text-left">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist text-navy dark:bg-navy-800 dark:text-white">
                          <Icon name="history" size={18} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.label}</span>
                        <Icon name="chevronRight" size={16} className="text-navy-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <GpsWarnings geo={geo} />
            </div>
          )}

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
              {/* linha única: carro, distância/tempo e o preço em destaque */}
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-petrol dark:bg-petrol dark:text-white">
                  <Icon name="car" size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 whitespace-nowrap font-extrabold">
                    Leva Já Carro
                    {settings?.pilot_mode && <span className="rounded-full bg-sun px-1.5 py-px text-[9px] font-extrabold uppercase text-navy-950">Simulação</span>}
                  </p>
                  <p className="truncate text-xs text-navy-500 dark:text-navy-300">
                    {formatDistance(quote.distanceM)} · {formatDuration(quote.durationS)} ·{' '}
                    {priceMode === 'escolher'
                      ? chosen
                        ? `${chosen.name} · ${formatBRL(chosen.perKmCents)}/km`
                        : 'escolha um motorista'
                      : quote.pricingMode === 'variavel'
                        ? 'pode variar'
                        : 'preço fechado'}
                  </p>
                </div>
                <p className="num text-[28px] font-extrabold leading-none text-navy dark:text-white" data-testid="quote-total">
                  {formatBRL(priceMode === 'escolher' && chosen ? chosen.totalCents : quote.totalCents)}
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
                    className={`rounded-xl px-2 py-1.5 text-center transition ${priceMode === v ? 'bg-white text-navy shadow-sm dark:bg-petrol dark:text-white' : 'text-navy-500 hover:text-navy dark:text-navy-300'}`}
                  >
                    <span className="block text-[13px] font-extrabold">{t}</span>
                    <span className="block text-[10px] font-semibold opacity-70">{sub}</span>
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
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-lg font-extrabold text-navy-950">{d.name.slice(0, 1)}</span>
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
              <details className="my-2 rounded-2xl bg-mist px-3 py-2 dark:bg-navy-800">
                <summary className="cursor-pointer text-sm font-semibold">Detalhamento do preço e trajeto</summary>
                <div className="mt-2">
                  <PlaceLine icon="pin" title="Embarque" text={pickup.address} />
                  <PlaceLine icon="flag" title="Destino" text={dest.address} />
                </div>
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
              <details className="mb-1">
                <summary className="cursor-pointer py-1 text-sm font-semibold text-petrol dark:text-brand">+ Observação para o motorista</summary>
                <Textarea className="mt-1" placeholder="Ponto de referência, portão… (opcional)" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </details>
              {error && <Banner tone="error" className="mt-2">{error}</Banner>}
              <Button block size="lg" className="mt-2" loading={busy} onClick={request} disabled={settings?.operations_enabled === false || (priceMode === 'escolher' && !chosen)} data-testid="request-ride">
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
