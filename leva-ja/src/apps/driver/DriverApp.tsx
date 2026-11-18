import { useEffect, useState } from 'react';
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { normalizePixKey, type PixKeyType } from '../../core/pix';
import { normalizePlate } from '../../core/validation';
import { friendlyError } from '../../data/errors';
import type { DriverPreferences, Earnings, Ride } from '../../data/types';
import { Banner, Button, Card, EmptyState, Field, Input, KeyValue, SectionTitle, Select, Skeleton, ToastProvider, Toggle, useToast } from '../../ui/components';
import { formatBRL, formatDateTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { AppProvider, useApp } from '../shared/AppContext';
import { captureInviteFromUrl, Gate } from '../shared/Auth';
import { BottomNav, StatusRibbons, TopBar, UpdateBanner } from '../shared/Chrome';
import { InstallGuide } from '../shared/InstallPage';
import { ProfilePage } from '../shared/ProfilePage';
import { RideStatusPill, useNotificationFeed } from '../shared/ride';
import { DriverHome } from './DriverHome';
import { DriverRidePage } from './DriverRidePage';
import { DriverRuntime, useDriver } from './runtime';

captureInviteFromUrl('motorista');

export function DriverRoot({ updateApply }: { updateApply: (() => void) | null }) {
  return (
    <ToastProvider>
      <AppProvider app="motorista">
        <HashRouter>
          <StatusRibbons />
          <Gate>
            <DriverRuntime>
              <Shell />
            </DriverRuntime>
          </Gate>
          <UpdateBanner apply={updateApply} />
        </HashRouter>
      </AppProvider>
    </ToastProvider>
  );
}

function Shell() {
  const d = useDriver();
  const nav = useNavigate();
  useNotificationFeed((kind, rideId) => {
    if (kind === 'driver_status') void d.reloadSetup();
    if (kind === 'ride_cancelled' || kind === 'payment_informed') void d.refreshActive();
    if (kind === 'payment_informed' && rideId) nav(`/corrida/${rideId}`);
  });
  return (
    <>
      <Routes>
        <Route path="/" element={<DriverHome />} />
        <Route path="/corrida/:id" element={<DriverRidePage />} />
        <Route path="/ganhos" element={<EarningsPage />} />
        <Route path="/perfil" element={<Page title="Perfil do motorista"><ProfilePage extra={<DriverSetupForms />} /></Page>} />
        <Route path="/instalar" element={<Page title="Instalar Leva Já Motorista"><div className="mx-auto max-w-lg px-4 pb-28 pt-2"><InstallGuide app="motorista" /></div></Page>} />
        <Route path="*" element={<DriverHome />} />
      </Routes>
      <BottomNav
        items={[
          { to: '/', label: 'Corridas', icon: 'steering' },
          { to: '/ganhos', label: 'Ganhos', icon: 'wallet' },
          { to: '/perfil', label: 'Perfil', icon: 'user' },
        ]}
      />
    </>
  );
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <TopBar variant="motorista" title={title} />
      {children}
    </div>
  );
}

function EarningsPage() {
  const { backend, settings } = useApp();
  const [days, setDays] = useState(7);
  const [e, setE] = useState<Earnings | null>(null);
  const [rides, setRides] = useState<Ride[] | null>(null);
  useEffect(() => {
    setE(null);
    backend.getEarnings(days).then(setE);
  }, [backend, days]);
  useEffect(() => {
    backend.listDriverRides().then(setRides);
  }, [backend]);
  return (
    <Page title="Ganhos">
      <div className="mx-auto max-w-lg px-4 pb-28">
        {settings?.pilot_mode && <Banner tone="warn" className="mt-2">Valores simulados do piloto. Comissão é apenas calculada, não é cobrada automaticamente.</Banner>}
        <div className="mt-3 inline-flex rounded-2xl bg-white p-1 ring-1 ring-navy/10 dark:bg-navy-900 dark:ring-white/10">
          {[1, 7, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-xl px-4 py-1.5 text-sm font-semibold ${days === d ? 'bg-navy text-white dark:bg-white dark:text-navy' : 'text-navy-500'}`}>
              {d === 1 ? 'Hoje' : `${d} dias`}
            </button>
          ))}
        </div>
        <Card className="mt-3">
          {!e ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <p className="text-sm text-navy-500 dark:text-navy-300">Líquido no período</p>
              <p className="mb-3 text-3xl font-extrabold tabular-nums">{formatBRL(e.netCents)}</p>
              <KeyValue k="Corridas finalizadas" v={e.rides} />
              <KeyValue k="Ganhos brutos" v={formatBRL(e.grossCents)} />
              <KeyValue k="Comissão simulada" v={`− ${formatBRL(e.commissionCents)}`} />
              <KeyValue k="Pagamentos confirmados (manual)" v={formatBRL(e.confirmedNetCents)} />
              <KeyValue k="Pendentes de confirmação" v={formatBRL(e.pendingNetCents)} />
            </>
          )}
        </Card>
        <SectionTitle>Histórico</SectionTitle>
        {!rides && <Skeleton className="h-24" />}
        {rides?.length === 0 && <EmptyState icon="history" title="Nenhuma corrida ainda" />}
        {rides?.map((r) => (
          <Link key={r.id} to={`/corrida/${r.id}`}>
            <Card className="mb-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.dest.address}</p>
                <p className="text-xs text-navy-500">{formatDateTime(r.createdAt)}</p>
                <div className="mt-1">
                  <RideStatusPill status={r.status} />
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{formatBRL(r.driverNetCents)}</p>
                <p className="text-xs text-navy-500">bruto {formatBRL(r.totalCents)}</p>
              </div>
              <Icon name="chevronRight" size={18} className="text-navy-300" />
            </Card>
          </Link>
        ))}
      </div>
    </Page>
  );
}

function DriverSetupForms() {
  const { backend } = useApp();
  const d = useDriver();
  const toast = useToast();
  const s = d.setup;
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [ptype, setPtype] = useState<PixKeyType>('celular');
  const [pval, setPval] = useState('');
  const [holder, setHolder] = useState('');
  const [errV, setErrV] = useState<string | null>(null);
  const [errP, setErrP] = useState<string | null>(null);
  useEffect(() => {
    if (s?.vehicle) {
      setMake(s.vehicle.make);
      setModel(s.vehicle.model);
      setColor(s.vehicle.color);
      setYear(s.vehicle.year ? String(s.vehicle.year) : '');
      setPlate(s.vehicle.plate);
    }
    if (s?.pixKey) {
      setPtype(s.pixKey.type);
      setPval(s.pixKey.value);
      setHolder(s.pixKey.holder);
    }
  }, [s]);
  if (!s) return <Skeleton className="mt-4 h-40" />;
  return (
    <>
      <SectionTitle>Situação do cadastro</SectionTitle>
      <Card>
        <p className="font-semibold">{{ pendente: 'Aguardando aprovação', aprovado: 'Aprovado', suspenso: 'Suspenso', revogado: 'Revogado' }[s.status]}</p>
      </Card>
      <DriverPreferencesCard prefs={s.preferences} onSaved={d.reloadSetup} />
      <SectionTitle>Veículo</SectionTitle>
      <Card>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label="Marca">{(id) => <Input id={id} value={make} onChange={(e) => setMake(e.target.value)} />}</Field>
          <Field label="Modelo">{(id) => <Input id={id} value={model} onChange={(e) => setModel(e.target.value)} />}</Field>
          <Field label="Cor">{(id) => <Input id={id} value={color} onChange={(e) => setColor(e.target.value)} />}</Field>
          <Field label="Ano">{(id) => <Input id={id} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />}</Field>
        </div>
        <Field label="Placa" hint="Formato antigo (ABC1234) ou Mercosul (ABC1D23)">{(id) => <Input id={id} value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="font-mono tracking-wider" />}</Field>
        {errV && <Banner tone="error" className="mb-2">{errV}</Banner>}
        <Button
          onClick={async () => {
            const p = normalizePlate(plate);
            if (!p) return setErrV('Placa inválida.');
            if (!make.trim() || !model.trim() || !color.trim()) return setErrV('Preencha marca, modelo e cor.');
            const y = year ? Number(year) : null;
            if (y !== null && (y < 1980 || y > new Date().getFullYear() + 1)) return setErrV('Ano inválido.');
            setErrV(null);
            try {
              await backend.saveVehicle({ make: make.trim(), model: model.trim(), color: color.trim(), year: y, plate: p });
              await d.reloadSetup();
              toast('Veículo salvo', 'success');
            } catch (e) {
              setErrV(friendlyError(e));
            }
          }}
        >
          Salvar veículo
        </Button>
      </Card>
      <SectionTitle>Recebimento via Pix</SectionTitle>
      <Card>
        <p className="mb-3 text-sm text-navy-600 dark:text-navy-100">A chave é usada para gerar o QR Code Pix que o passageiro lê ao final da corrida. No modo piloto o QR é sempre uma simulação e não usa sua chave.</p>
        <Field label="Tipo de chave">
          {(id) => (
            <Select id={id} value={ptype} onChange={(e) => setPtype(e.target.value as PixKeyType)}>
              <option value="cpf_cnpj">CPF/CNPJ</option>
              <option value="celular">Celular</option>
              <option value="email">E-mail</option>
              <option value="aleatoria">Chave aleatória</option>
            </Select>
          )}
        </Field>
        <Field label="Chave Pix">{(id) => <Input id={id} value={pval} onChange={(e) => setPval(e.target.value)} />}</Field>
        <Field label="Nome do recebedor" hint="Como aparece no seu banco">{(id) => <Input id={id} value={holder} onChange={(e) => setHolder(e.target.value)} />}</Field>
        {errP && <Banner tone="error" className="mb-2">{errP}</Banner>}
        <Button
          onClick={async () => {
            const n = normalizePixKey(ptype, pval);
            if (!n.ok) return setErrP(n.error);
            if (holder.trim().length < 2) return setErrP('Informe o nome do recebedor.');
            setErrP(null);
            try {
              await backend.saveDriverPixKey({ type: ptype, value: n.key, holder: holder.trim() });
              await d.reloadSetup();
              toast('Chave Pix salva', 'success');
            } catch (e) {
              setErrP(friendlyError(e));
            }
          }}
        >
          Salvar chave Pix
        </Button>
      </Card>
    </>
  );
}

/** Preferências de corrida: PIN de embarque e modo de preço (automático ou preço próprio por km). */
function DriverPreferencesCard({ prefs, onSaved }: { prefs: DriverPreferences; onSaved: () => Promise<void> }) {
  const { backend, settings } = useApp();
  const toast = useToast();
  const [requirePin, setRequirePin] = useState(prefs.requirePin);
  const [mode, setMode] = useState(prefs.priceMode);
  const [perKm, setPerKm] = useState(prefs.perKmCents != null ? (prefs.perKmCents / 100).toFixed(2).replace('.', ',') : '');
  const [defaultPerKm, setDefaultPerKm] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend.getActiveFare().then((f) => setDefaultPerKm(f.perKmCents)).catch(() => undefined);
  }, [backend]);
  const min = settings?.driver_price_per_km_min_cents ?? 100;
  const max = settings?.driver_price_per_km_max_cents ?? 1000;
  const customEnabled = settings?.driver_custom_price_enabled !== false;
  const cents = Math.round(Number(perKm.replace(/\./g, '').replace(',', '.')) * 100);

  const save = async () => {
    if (mode === 'proprio' && (!Number.isFinite(cents) || cents < min || cents > max)) return setErr(`Informe um valor entre ${formatBRL(min)} e ${formatBRL(max)} por km.`);
    setErr(null);
    setBusy(true);
    try {
      await backend.saveDriverPreferences({ requirePin, priceMode: mode, perKmCents: mode === 'proprio' ? cents : prefs.perKmCents });
      await onSaved();
      toast('Preferências salvas', 'success');
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle>Preferências de corrida</SectionTitle>
      <Card data-testid="driver-preferences">
        <Toggle
          checked={requirePin}
          onChange={setRequirePin}
          label="Exigir PIN no embarque"
          description="O passageiro diz um código de 4 números antes de entrar. Você confere e só então inicia a corrida."
        />
        <div className="my-3 h-px bg-navy/5 dark:bg-white/10" />
        <p className="font-semibold">Como você cobra</p>
        <p className="mb-2 text-sm text-navy-500 dark:text-navy-300">Os passageiros podem escolher motoristas pelo preço. Seu modo aparece na lista para eles.</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Modo de preço">
          {([
            ['automatico', 'Automático', defaultPerKm != null ? `Tarifa Leva Já (${formatBRL(defaultPerKm)}/km)` : 'Tarifa Leva Já'],
            ['proprio', 'Meu preço por km', customEnabled ? `Entre ${formatBRL(min)} e ${formatBRL(max)}` : 'Desativado pelo Leva Já'],
          ] as const).map(([v, t, sub]) => (
            <button
              key={v}
              role="radio"
              aria-checked={mode === v}
              disabled={v === 'proprio' && !customEnabled}
              onClick={() => setMode(v)}
              data-testid={`driver-price-${v}`}
              className={`rounded-2xl p-3 text-left ring-2 transition disabled:opacity-50 ${mode === v ? 'bg-brand-50 ring-brand dark:bg-brand/10' : 'bg-mist ring-transparent dark:bg-navy-800'}`}
            >
              <span className="block font-extrabold">{t}</span>
              <span className="block text-xs text-navy-500 dark:text-navy-300">{sub}</span>
            </button>
          ))}
        </div>
        {mode === 'proprio' && (
          <div className="mt-3">
            <Field label="Quanto você quer ganhar por km (R$)" hint="Base e tempo seguem a tarifa Leva Já; só o valor por km muda.">
              {(id) => (
                <div className="flex items-center gap-2">
                  <span className="font-bold">R$</span>
                  <Input id={id} inputMode="decimal" placeholder="3,00" value={perKm} onChange={(e) => setPerKm(e.target.value.replace(/[^\d,]/g, '').slice(0, 6))} data-testid="driver-per-km" />
                  <span className="text-sm text-navy-500">/km</span>
                </div>
              )}
            </Field>
            {Number.isFinite(cents) && cents > 0 && defaultPerKm != null && (
              <p className="text-xs text-navy-500 dark:text-navy-300">
                Exemplo: numa corrida de 5 km, a parte da distância fica {formatBRL(cents * 5)} (na automática seria {formatBRL(defaultPerKm * 5)}).
              </p>
            )}
          </div>
        )}
        {err && <Banner tone="error" className="mt-2">{err}</Banner>}
        <Button className="mt-3" loading={busy} onClick={save} data-testid="save-driver-preferences">
          Salvar preferências
        </Button>
      </Card>
    </>
  );
}
