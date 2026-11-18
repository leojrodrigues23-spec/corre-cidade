import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { calcFare } from '../../core/fare';
import { PAYMENT_STATUS_LABEL } from '../../core/pix';
import { ACTIVE_RIDE_STATUSES, RIDE_STATUS_LABEL, type RideStatus } from '../../core/ride';
import { friendlyError } from '../../data/errors';
import type { AdminUser, AuditEntry, CreatedInvite, DashboardStats, DriverStatus, FareConfigRow, Invite, LiveRide, Payment, Ride, SettingChange } from '../../data/types';
import { type MapMarker, MapView } from '../../maps/MapView';
import { Badge, Banner, Button, Card, cx, EmptyState, Field, Input, KeyValue, Modal, Select, Skeleton, Textarea, ThemeSwitch, Toggle, ToastProvider, useToast } from '../../ui/components';
import { centsFromInput, centsToInput, formatBRL, formatDateTime } from '../../ui/format';
import { BrandSymbol, Icon, type IconName } from '../../ui/icons';
import { QrCodeView } from '../../ui/QrCode';
import { AppProvider, useApp } from '../shared/AppContext';
import { Gate } from '../shared/Auth';
import { StatusRibbons } from '../shared/Chrome';
import { RideStatusPill } from '../shared/ride';

export function AdminRoot() {
  return (
    <ToastProvider>
      <AppProvider app="admin">
        <HashRouter>
          <StatusRibbons />
          <Gate>
            <Layout />
          </Gate>
        </HashRouter>
      </AppProvider>
    </ToastProvider>
  );
}

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/usuarios', label: 'Usuários', icon: 'users' },
  { to: '/convites', label: 'Convites', icon: 'ticket' },
  { to: '/distribuicao', label: 'Distribuição', icon: 'qr' },
  { to: '/corridas', label: 'Corridas', icon: 'list' },
  { to: '/mapa', label: 'Mapa ao vivo', icon: 'map' },
  { to: '/tarifas', label: 'Tarifas', icon: 'money' },
  { to: '/pagamentos', label: 'Pagamentos', icon: 'wallet' },
  { to: '/config', label: 'Configurações', icon: 'settings' },
  { to: '/auditoria', label: 'Auditoria', icon: 'shield' },
];

function Layout() {
  const { backend, theme, settings, refreshAccess } = useApp();
  return (
    <div className={cx('min-h-dvh lg:flex', (backend.mode === 'demo' || settings?.pilot_mode) && 'pt-6')}>
      <aside className="border-b border-navy/10 bg-navy text-white lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-4 pt-safe">
          <BrandSymbol size={32} />
          <div>
            <p className="font-extrabold leading-tight">
              Leva <span className="text-brand">Já</span>
            </p>
            <p className="text-xs text-navy-300">Painel administrativo</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-white/10 text-brand' : 'text-navy-100 hover:bg-white/5')}>
              <Icon name={n.icon} size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-2 p-4 lg:block">
          <ThemeSwitch pref={theme.pref} setPref={theme.setPref} />
          <Button size="sm" variant="ghost" className="text-white" icon="logout" onClick={() => backend.signOut().then(refreshAccess)}>
            Sair
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 pb-16 pt-4 lg:px-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/usuarios" element={<Users />} />
          <Route path="/convites" element={<Invites />} />
          <Route path="/distribuicao" element={<Distribution />} />
          <Route path="/corridas" element={<Rides />} />
          <Route path="/mapa" element={<LiveMap />} />
          <Route path="/tarifas" element={<Fares />} />
          <Route path="/pagamentos" element={<Payments />} />
          <Route path="/config" element={<Settings />} />
          <Route path="/auditoria" element={<Audit />} />
        </Routes>
        <div className="mt-8 lg:hidden">
          <Button size="sm" variant="secondary" icon="logout" onClick={() => backend.signOut().then(refreshAccess)}>
            Sair
          </Button>
        </div>
      </main>
    </div>
  );
}

function H1({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-extrabold">{children}</h1>
      {action}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, reload: load };
}

// ---------------- Dashboard ----------------
function Dashboard() {
  const { backend, settings, refreshSettings } = useApp();
  const { data, error, reload } = useLoad<DashboardStats>(() => backend.admin.dashboard(), [backend]);
  useEffect(() => {
    const t = window.setInterval(reload, 15000);
    return () => window.clearInterval(t);
  }, [reload]);
  const cards: [string, string | number, IconName][] = data
    ? [
        ['Usuários', data.users, 'users'],
        ['Motoristas pendentes', data.drivers_pending, 'clock'],
        ['Motoristas aprovados', data.drivers_approved, 'steering'],
        ['Disponíveis agora', data.drivers_available, 'locate'],
        ['Corridas ativas', data.rides_active, 'car'],
        ['Corridas hoje', data.rides_today, 'list'],
        ['Finalizadas (30d)', data.rides_finished_30d, 'check'],
        ['Bruto (30d)', formatBRL(data.gross_30d_cents), 'money'],
        ['Comissão simulada (30d)', formatBRL(data.commission_30d_cents), 'wallet'],
        ['Pagamentos pendentes', data.payments_pending, 'alert'],
      ]
    : [];
  return (
    <>
      <H1 action={<Button size="sm" variant="secondary" icon="refresh" onClick={reload}>Atualizar</Button>}>Dashboard</H1>
      {settings && <PilotModeCard pilot={settings.pilot_mode} onChanged={refreshSettings} />}
      {error && <Banner tone="error">{error}</Banner>}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {!data && !error && Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        {cards.map(([label, value, icon]) => (
          <Card key={label}>
            <Icon name={icon} size={18} className="mb-2 text-brand-700 dark:text-brand" />
            <p className="text-2xl font-extrabold tabular-nums">{value}</p>
            <p className="text-xs text-navy-500 dark:text-navy-300">{label}</p>
          </Card>
        ))}
      </div>
    </>
  );
}

function PilotModeCard({ pilot, onChanged }: { pilot: boolean; onChanged: () => Promise<void> }) {
  const { backend } = useApp();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Card className={cx('ring-2', pilot ? 'ring-amber-400' : 'ring-red-500')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-bold">
            <Icon name="shield" size={18} /> Modo Piloto / Simulação: {pilot ? <Badge tone="amber">ATIVO</Badge> : <Badge tone="red">DESATIVADO</Badge>}
          </p>
          <p className="text-sm text-navy-500 dark:text-navy-300">
            {pilot ? 'Corridas marcadas como simuladas e QR Pix sempre de demonstração (chave inexistente).' : 'ATENÇÃO: QR Pix usará as chaves reais dos motoristas. Só desative após validar exigências legais.'}
          </p>
        </div>
        <Button variant={pilot ? 'secondary' : 'primary'} onClick={() => (pilot ? setConfirm(true) : backend.admin.setSetting('pilot_mode', true).then(onChanged))}>
          {pilot ? 'Desativar modo piloto…' : 'Reativar modo piloto'}
        </Button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Desativar modo piloto">
        <Banner tone="error" className="mb-3" title="Operação sensível">
          Com o modo piloto desativado, os QR Codes Pix passam a usar as chaves reais dos motoristas e podem movimentar dinheiro. Confirme que o transporte remunerado está regularizado no município e que os participantes estão cientes.
        </Banner>
        <Field label='Digite "DESATIVAR" para confirmar'>{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
        <Button
          block
          variant="danger"
          disabled={typed !== 'DESATIVAR'}
          onClick={async () => {
            try {
              await backend.admin.setSetting('pilot_mode', false);
              await onChanged();
              setConfirm(false);
              toast('Modo piloto desativado e registrado na auditoria', 'warn');
            } catch (e) {
              toast(friendlyError(e), 'error');
            }
          }}
        >
          Desativar
        </Button>
      </Modal>
    </Card>
  );
}

// ---------------- Usuários ----------------
function Users() {
  const { backend } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<AdminUser[]>(() => backend.admin.listUsers(), [backend]);
  const [filter, setFilter] = useState<'todos' | 'pendentes' | 'motoristas' | 'passageiros'>('todos');
  const rows = (data ?? []).filter((u) => (filter === 'pendentes' ? u.driverStatus === 'pendente' : filter === 'motoristas' ? u.roles.includes('motorista') : filter === 'passageiros' ? u.roles.includes('passageiro') : true));
  const setStatus = async (u: AdminUser, s: DriverStatus) => {
    try {
      await backend.admin.setDriverStatus(u.id, s);
      toast(`Motorista ${s}`, 'success');
      await reload();
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <>
      <H1>Usuários</H1>
      <div className="mb-3 flex flex-wrap gap-2">
        {(['todos', 'pendentes', 'motoristas', 'passageiros'] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'navy' : 'secondary'} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-64" />}
      {data && rows.length === 0 && <EmptyState icon="users" title="Nenhum usuário neste filtro" />}
      <div className="grid gap-2">
        {rows.map((u) => (
          <Card key={u.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{u.fullName || '(sem nome)'} {u.deletedAt && <Badge tone="red">excluído</Badge>}</p>
              <p className="text-xs text-navy-500 dark:text-navy-300">
                {u.phone ?? 'sem telefone'} · desde {formatDateTime(u.createdAt)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {u.roles.map((r) => (
                  <Badge key={r} tone={r === 'admin' ? 'navy' : 'neutral'}>{r}</Badge>
                ))}
                {u.driverStatus && <Badge tone={u.driverStatus === 'aprovado' ? 'green' : u.driverStatus === 'pendente' ? 'amber' : 'red'}>motorista: {u.driverStatus}</Badge>}
                {u.vehicle && <Badge>{u.vehicle.make} {u.vehicle.model} · {u.vehicle.plate}</Badge>}
              </div>
            </div>
            {u.driverStatus && (
              <div className="flex flex-wrap gap-2">
                {u.driverStatus !== 'aprovado' && <Button size="sm" onClick={() => setStatus(u, 'aprovado')}>Aprovar</Button>}
                {u.driverStatus === 'aprovado' && <Button size="sm" variant="secondary" onClick={() => setStatus(u, 'suspenso')}>Suspender</Button>}
                {u.driverStatus !== 'revogado' && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setStatus(u, 'revogado')}>Revogar</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

// ---------------- Convites ----------------
function appBase(settings: { public_base_url: string | null } | null) {
  const url = settings?.public_base_url?.replace(/\/+$/, '') || null;
  return url && /^https:\/\//.test(url) ? url : null;
}

function ShareBox({ url, title, fileName, qr }: { url: string; title: string; fileName: string; qr: boolean }) {
  const toast = useToast();
  return (
    <div className="space-y-3">
      <div className="break-all rounded-2xl bg-mist p-3 font-mono text-xs dark:bg-navy-800">{url}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon="copy" onClick={async () => { await navigator.clipboard.writeText(url); toast('Link copiado', 'success'); }}>
          Copiar
        </Button>
        <a className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#25D366] px-3 text-sm font-semibold text-white" href={`https://wa.me/?text=${encodeURIComponent(`${title}: ${url}`)}`} target="_blank" rel="noopener noreferrer">
          <Icon name="whatsapp" size={16} /> WhatsApp
        </a>
        {'share' in navigator && (
          <Button size="sm" variant="secondary" icon="share" onClick={() => navigator.share({ title, url }).catch(() => undefined)}>
            Compartilhar
          </Button>
        )}
      </div>
      {qr && <QrCodeView text={url} exportable fileName={fileName} size={200} />}
    </div>
  );
}

function Invites() {
  const { backend, settings } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<Invite[]>(() => backend.admin.listInvites(), [backend]);
  const [role, setRole] = useState<'motorista' | 'passageiro'>('motorista');
  const [hours, setHours] = useState('72');
  const [uses, setUses] = useState('1');
  const [note, setNote] = useState('');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const base = appBase(settings);
  const linkFor = (inv: CreatedInvite) => `${base ?? window.location.origin}/${inv.role}/#/convite/${inv.token}`;
  return (
    <>
      <H1>Convites</H1>
      {!base && <Banner tone="warn" className="mb-3" title="Domínio público não configurado">Defina a URL pública HTTPS em Configurações para gerar QR Codes. Enquanto isso, os links usam o endereço atual ({window.location.origin}).</Banner>}
      <Card className="mb-4 max-w-xl">
        <p className="mb-3 font-bold">Novo convite</p>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label="Perfil">{(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value as 'motorista')}><option value="motorista">Motorista</option><option value="passageiro">Passageiro</option></Select>}</Field>
          <Field label="Validade (horas)">{(id) => <Input id={id} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value.replace(/\D/g, ''))} />}</Field>
          <Field label="Limite de usos">{(id) => <Input id={id} inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))} />}</Field>
        </div>
        <Field label="Identificação (para quem é)">{(id) => <Input id={id} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: João — motorista amigo" />}</Field>
        <p className="mb-3 text-xs text-navy-500 dark:text-navy-300">{role === 'motorista' ? 'Motoristas convidados ficam "pendentes" até você aprová-los em Usuários.' : 'Passageiros convidados ganham acesso imediato.'} O token é aleatório (256 bits) e só o hash fica salvo — o link aparece uma única vez.</p>
        <Button
          icon="plus"
          onClick={async () => {
            try {
              setCreated(await backend.admin.createInvite(role, Number(hours), Number(uses), note || undefined));
              setNote('');
              await reload();
            } catch (e) {
              toast(friendlyError(e), 'error');
            }
          }}
        >
          Gerar convite
        </Button>
      </Card>
      <Modal open={!!created} onClose={() => setCreated(null)} title={`Convite de ${created?.role ?? ''}`}>
        {created && (
          <>
            <Banner tone="warn" className="mb-3">Copie ou exporte agora: por segurança este link não poderá ser exibido de novo.</Banner>
            <ShareBox url={linkFor(created)} title={`Convite Leva Já ${created.role === 'motorista' ? 'Motorista' : ''}`} fileName={`convite-${created.role}-${created.id.slice(0, 6)}`} qr={!!base} />
          </>
        )}
      </Modal>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-40" />}
      {data?.length === 0 && <EmptyState icon="ticket" title="Nenhum convite criado" />}
      <div className="grid gap-2">
        {data?.map((i) => {
          const expired = Date.parse(i.expiresAt) < Date.now();
          const state = i.revokedAt ? 'revogado' : expired ? 'expirado' : i.uses >= i.maxUses ? 'esgotado' : 'ativo';
          return (
            <Card key={i.id} className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{i.note || '(sem identificação)'} <Badge tone={i.role === 'motorista' ? 'navy' : 'neutral'}>{i.role}</Badge></p>
                <p className="text-xs text-navy-500 dark:text-navy-300">
                  usos {i.uses}/{i.maxUses} · expira {formatDateTime(i.expiresAt)}
                </p>
              </div>
              <Badge tone={state === 'ativo' ? 'green' : 'red'}>{state}</Badge>
              {state === 'ativo' && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { await backend.admin.revokeInvite(i.id); await reload(); }}>
                  Revogar
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ---------------- Distribuição ----------------
function Distribution() {
  const { settings } = useApp();
  const base = appBase(settings);
  return (
    <>
      <H1>Distribuição do aplicativo</H1>
      {!base ? (
        <Banner tone="warn" title="Defina a URL pública primeiro">
          Os QR Codes de instalação só são gerados depois que o domínio HTTPS público for configurado em Configurações → URL pública. Não geramos QR para endereços provisórios.
        </Banner>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="mb-1 flex items-center gap-2 text-lg font-bold"><BrandSymbol size={28} /> Leva Já (Passageiro)</p>
            <p className="mb-3 text-sm text-navy-500 dark:text-navy-300">Abre a página de instalação do app do passageiro. Instalação depende de ação do usuário.</p>
            <ShareBox url={`${base}/passageiro/#/instalar`} title="Instale o Leva Já" fileName="levaja-passageiro" qr />
          </Card>
          <Card>
            <p className="mb-1 flex items-center gap-2 text-lg font-bold"><BrandSymbol size={28} variant="motorista" /> Leva Já Motorista</p>
            <p className="mb-3 text-sm text-navy-500 dark:text-navy-300">Página de instalação do app do motorista. O acesso continua exigindo convite e aprovação.</p>
            <ShareBox url={`${base}/motorista/#/instalar`} title="Instale o Leva Já Motorista" fileName="levaja-motorista" qr />
          </Card>
        </div>
      )}
      <p className="mt-4 text-sm text-navy-500 dark:text-navy-300">Para convites individuais (com validade, limite de usos e revogação), use a página Convites.</p>
    </>
  );
}

// ---------------- Corridas ----------------
function Rides() {
  const { backend } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<Ride[]>(() => backend.admin.listRides(200), [backend]);
  const [status, setStatus] = useState<'todas' | RideStatus>('todas');
  const [manual, setManual] = useState<Ride | null>(null);
  const [cancel, setCancel] = useState<Ride | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const rows = (data ?? []).filter((r) => status === 'todas' || r.status === status);
  return (
    <>
      <H1 action={<Button size="sm" variant="secondary" icon="refresh" onClick={reload}>Atualizar</Button>}>Corridas</H1>
      <Select className="mb-3 max-w-xs" value={status} onChange={(e) => setStatus(e.target.value as RideStatus)} aria-label="Filtrar status">
        <option value="todas">Todos os status</option>
        {Object.entries(RIDE_STATUS_LABEL).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </Select>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-64" />}
      {data && rows.length === 0 && <EmptyState icon="car" title="Nenhuma corrida" />}
      <div className="grid gap-2">
        {rows.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <RideStatusPill status={r.status} />
                {r.isSimulation && <Badge tone="demo">simulada</Badge>}
                {r.manualPrice && <Badge tone="amber">preço manual</Badge>}
                <span className="text-xs text-navy-500">{formatDateTime(r.createdAt)} · #{r.id.slice(0, 8)}</span>
              </div>
              <p className="mt-1 truncate text-sm">{r.pickup.address} → {r.dest.address}</p>
              {r.cancelReason && <p className="text-xs text-navy-500">Motivo: {r.cancelReason}</p>}
            </div>
            <p className="font-bold tabular-nums">{formatBRL(r.totalCents)}</p>
            {ACTIVE_RIDE_STATUSES.includes(r.status) && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setManual(r); setValue(centsToInput(r.totalCents)); setReason(''); }}>Preço manual</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { setCancel(r); setReason(''); }}>Cancelar</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
      <Modal open={!!manual} onClose={() => setManual(null)} title="Definir preço manual">
        <Banner tone="info" className="mb-3">Só funciona se a tarifa da corrida permitir preço manual. O passageiro é notificado e o recibo identifica o preço manual.</Banner>
        <Field label="Novo valor (R$)">{(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
        <Field label="Justificativa">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Button block disabled={reason.length < 3} onClick={async () => { const c = centsFromInput(value); if (!c) return toast('Valor inválido', 'error'); try { await backend.admin.setManualPrice(manual!.id, c, reason); setManual(null); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>
          Aplicar
        </Button>
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Cancelar corrida (admin)">
        <Field label="Motivo">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Button block variant="danger" disabled={reason.length < 3} onClick={async () => { try { await backend.admin.cancelRide(cancel!.id, reason); setCancel(null); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>
          Cancelar corrida
        </Button>
      </Modal>
    </>
  );
}

// ---------------- Mapa ao vivo ----------------
function LiveMap() {
  const { backend, settings, theme } = useApp();
  const { data, error, reload } = useLoad<LiveRide[]>(() => backend.admin.liveRides(), [backend]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => { void reload(); setNow(Date.now()); }, 8000);
    return () => window.clearInterval(t);
  }, [reload]);
  const markers: MapMarker[] = useMemo(
    () =>
      (data ?? []).flatMap((l) => {
        const m: MapMarker[] = [{ id: `p-${l.ride.id}`, kind: 'pickup', position: l.ride.pickup, label: `Embarque #${l.ride.id.slice(0, 6)}` }];
        if (l.driverLocation) m.push({ id: `d-${l.ride.id}`, kind: 'driver', position: l.driverLocation, accuracyM: l.driverLocation.accuracyM, stale: now - Date.parse(l.driverLocation.receivedAt) > 30000, label: 'Motorista' });
        return m;
      }),
    [data, now],
  );
  return (
    <>
      <H1>Mapa de corridas em andamento</H1>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden p-0">
          <MapView className="h-[60dvh]" center={settings?.map_defaults.center ?? { lat: -23.153, lng: -47.0577 }} zoom={13} markers={markers} fitKey={data?.map((d) => d.ride.id).join(',')} dark={theme.dark} />
        </Card>
        <div className="space-y-2">
          {data?.length === 0 && <EmptyState icon="map" title="Nenhuma corrida em andamento" />}
          {data?.map((l) => {
            const age = l.driverLocation ? Math.round((now - Date.parse(l.driverLocation.receivedAt)) / 1000) : null;
            return (
              <Card key={l.ride.id}>
                <div className="flex items-center justify-between"><RideStatusPill status={l.ride.status} /><span className="text-xs">#{l.ride.id.slice(0, 8)}</span></div>
                <p className="mt-1 truncate text-sm">{l.ride.pickup.address}</p>
                <p className={cx('mt-1 text-xs', age !== null && age > 30 ? 'font-semibold text-red-600' : 'text-navy-500')}>
                  {age === null ? 'Sem posição do motorista' : age <= 30 ? `Ao vivo · ±${Math.round(l.driverLocation!.accuracyM)} m · ${age}s` : `Último sinal há ${age}s (desatualizado)`}
                </p>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------------- Tarifas ----------------
function Fares() {
  const { backend } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<FareConfigRow[]>(() => backend.admin.fareHistory(), [backend]);
  const active = data?.find((f) => f.active);
  const [form, setForm] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'fixa_na_solicitacao' | 'variavel'>('fixa_na_solicitacao');
  const [manual, setManual] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!active) return;
    setForm({ base: centsToInput(active.baseCents), km: centsToInput(active.perKmCents), min: centsToInput(active.perMinuteCents), minimum: centsToInput(active.minimumCents), comm: String(active.commissionBps / 100).replace('.', ',') });
    setMode(active.pricingMode);
    setManual(active.manualPriceEnabled);
  }, [active]);
  const parsed = {
    baseCents: centsFromInput(form.base ?? ''),
    perKmCents: centsFromInput(form.km ?? ''),
    perMinuteCents: centsFromInput(form.min ?? ''),
    minimumCents: centsFromInput(form.minimum ?? ''),
    commissionBps: Math.round(Number((form.comm ?? '').replace(',', '.')) * 100),
  };
  const valid = Object.values(parsed).every((v) => v !== null && Number.isInteger(v) && v >= 0) && parsed.commissionBps <= 10000;
  const preview = valid ? calcFare({ version: 0, ...(parsed as { baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number; commissionBps: number }), pricingMode: mode, manualPriceEnabled: manual }, 6000, 900) : null;
  const F = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}>{(id) => <Input id={id} inputMode="decimal" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}</Field>;
  return (
    <>
      <H1>Tarifas e comissão</H1>
      <Banner tone="info" className="mb-4">Valores iniciais são FICTÍCIOS de teste. Cada alteração cria uma nova versão; corridas já cotadas mantêm a versão usada (sem alteração retroativa). Os preços são calculados no servidor em centavos.</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 font-bold">Nova versão {active && <span className="text-sm font-normal text-navy-500">(vigente: v{active.version})</span>}</p>
          <div className="grid grid-cols-2 gap-x-3">
            {F('base', 'Bandeirada (R$)')}
            {F('km', 'Por km (R$)')}
            {F('min', 'Por minuto (R$)')}
            {F('minimum', 'Tarifa mínima (R$)')}
            {F('comm', 'Comissão (%)', 'Simulada no piloto')}
          </div>
          <Field label="Modo de preço">
            {(id) => (
              <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as 'variavel')}>
                <option value="fixa_na_solicitacao">Fixo na solicitação</option>
                <option value="variavel">Variável (recalcula tempo real ao finalizar)</option>
              </Select>
            )}
          </Field>
          <Toggle checked={manual} onChange={setManual} label="Permitir preço manual pelo admin" description="Identificado ao passageiro quando usado" />
          <Field label="Motivo da alteração">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Button
            disabled={!valid || note.length < 3}
            onClick={async () => {
              try {
                const v = await backend.admin.setFare({ ...(parsed as { baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number; commissionBps: number }), pricingMode: mode, manualPriceEnabled: manual, note });
                toast(`Tarifa v${v} ativada`, 'success');
                setNote('');
                await reload();
              } catch (e) {
                toast(friendlyError(e), 'error');
              }
            }}
          >
            Publicar nova versão
          </Button>
        </Card>
        <Card>
          <p className="mb-2 font-bold">Simulação: 6 km, 15 min</p>
          {preview ? (
            <>
              <KeyValue k="Bandeirada" v={formatBRL(preview.baseCents)} />
              <KeyValue k="Distância" v={formatBRL(preview.distanceCents)} />
              <KeyValue k="Tempo" v={formatBRL(preview.timeCents)} />
              <KeyValue k="Total" v={formatBRL(preview.totalCents)} strong />
              <KeyValue k="Comissão" v={formatBRL(preview.commissionCents)} />
              <KeyValue k="Motorista" v={formatBRL(preview.driverNetCents)} />
            </>
          ) : (
            <p className="text-sm text-red-600">Valores inválidos.</p>
          )}
          <p className="mb-2 mt-5 font-bold">Histórico de versões</p>
          {!data && <Skeleton className="h-24" />}
          <div className="space-y-2">
            {data?.map((f) => (
              <div key={f.version} className="rounded-2xl bg-mist p-3 text-sm dark:bg-navy-800">
                <p className="font-semibold">v{f.version} {f.active && <Badge tone="green">vigente</Badge>} <span className="text-xs font-normal text-navy-500">{formatDateTime(f.createdAt)}</span></p>
                <p className="text-xs">
                  {formatBRL(f.baseCents)} + {formatBRL(f.perKmCents)}/km + {formatBRL(f.perMinuteCents)}/min · mín {formatBRL(f.minimumCents)} · comissão {f.commissionBps / 100}% · {f.pricingMode === 'variavel' ? 'variável' : 'fixa'}{f.manualPriceEnabled ? ' · manual permitido' : ''}
                </p>
                {f.note && <p className="text-xs text-navy-500">{f.note}</p>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

// ---------------- Pagamentos ----------------
function Payments() {
  const { backend } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<(Payment & { rideId: string; createdAt: string })[]>(() => backend.admin.listPayments(), [backend]);
  return (
    <>
      <H1>Pagamentos (demonstrativo)</H1>
      <Banner tone="info" className="mb-4">Sem provedor Pix integrado: a confirmação é manual. Exibir QR, copiar código ou receber imagem de comprovante não confirma pagamento. A integração futura com PSP (webhook autenticado + idempotência) está descrita em docs/PAGAMENTOS.md.</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-40" />}
      {data?.length === 0 && <EmptyState icon="wallet" title="Nenhum pagamento" />}
      <div className="grid gap-2">
        {data?.map((p) => (
          <Card key={p.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{formatBRL(p.amountCents)} {p.isSimulation && <Badge tone="demo">simulação</Badge>}</p>
              <p className="text-xs text-navy-500">Corrida #{p.rideId.slice(0, 8)} · {formatDateTime(p.createdAt)} · comissão {formatBRL(p.commissionCents)} · motorista {formatBRL(p.driverNetCents)}</p>
            </div>
            <Badge tone={p.status === 'confirmado_manual' ? 'green' : p.status === 'cancelado' ? 'red' : 'amber'}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
            {['aguardando', 'informado', 'confirmacao_manual'].includes(p.status) && (
              <div className="flex gap-2">
                <Button size="sm" onClick={async () => { try { await backend.admin.setPaymentStatus(p.rideId, 'confirmado_manual'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>Confirmar</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => { try { await backend.admin.setPaymentStatus(p.rideId, 'cancelado'); await reload(); } catch (e) { toast(friendlyError(e), 'error'); } }}>Cancelar</Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

// ---------------- Configurações ----------------
const SETTING_META: Record<string, { label: string; type: 'bool' | 'int' | 'text' | 'json'; help: string }> = {
  operations_enabled: { label: 'Solicitações habilitadas', type: 'bool', help: 'Desligue para pausar novas corridas (limite de operação).' },
  passenger_invite_required: { label: 'Passageiro exige convite', type: 'bool', help: 'Piloto fechado: só convidados.' },
  allow_simulated_routes: { label: 'Permitir rotas simuladas', type: 'bool', help: 'Somente se a Routes API não estiver configurada. Corridas ficam marcadas.' },
  admin_require_mfa: { label: 'Admin exige MFA (TOTP)', type: 'bool', help: 'Recomendado manter ligado.' },
  offer_timeout_seconds: { label: 'Tempo de busca (s)', type: 'int', help: 'Após esse tempo a corrida expira.' },
  offer_radius_km: { label: 'Raio de oferta (km)', type: 'int', help: 'Motoristas dentro do raio recebem a oferta.' },
  driver_custom_price_enabled: { label: 'Motorista pode definir preço por km', type: 'bool', help: 'Passageiros escolhem motoristas pelo preço. Desligado: todos usam a tarifa automática.' },
  driver_price_per_km_min_cents: { label: 'Preço por km mínimo do motorista (centavos)', type: 'int', help: 'Ex.: 100 = R$ 1,00/km.' },
  driver_price_per_km_max_cents: { label: 'Preço por km máximo do motorista (centavos)', type: 'int', help: 'Ex.: 1000 = R$ 10,00/km.' },
  pin_max_attempts: { label: 'Tentativas de PIN', type: 'int', help: 'Depois disso o motorista não consegue mais digitar o PIN daquela corrida.' },
  public_base_url: { label: 'URL pública HTTPS', type: 'text', help: 'Ex.: https://levaja.seudominio.com.br — necessária para QR Codes.' },
  pix_city: { label: 'Cidade no BR Code', type: 'text', help: 'Até 15 caracteres.' },
  support_contact: { label: 'Contato de suporte', type: 'text', help: 'Exibido aos usuários.' },
  map_defaults: { label: 'Parâmetros do mapa', type: 'json', help: '{"center":{"lat":..,"lng":..},"zoom":14,"region":"BR","language":"pt-BR"}' },
  service_area: { label: 'Área atendida', type: 'json', help: '{"name":"...","polygon":[{"lat":..,"lng":..},...]} — polígono vazio = sem restrição.' },
};

function Settings() {
  const { backend, refreshSettings } = useApp();
  const toast = useToast();
  const { data, error, reload } = useLoad<Record<string, unknown>>(() => backend.admin.getAllSettings(), [backend]);
  const hist = useLoad<SettingChange[]>(() => backend.admin.settingsHistory(), [backend]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const save = async (key: string, value: unknown) => {
    try {
      await backend.admin.setSetting(key, value);
      toast('Configuração salva e registrada no histórico', 'success');
      await Promise.all([reload(), hist.reload(), refreshSettings()]);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };
  return (
    <>
      <H1>Configurações</H1>
      <p className="mb-4 text-sm text-navy-500 dark:text-navy-300">Alterações valem imediatamente, sem republicar o app. O Modo Piloto fica no Dashboard.</p>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-64" />}
      <div className="grid gap-3 lg:grid-cols-2">
        {data &&
          Object.entries(SETTING_META).map(([key, meta]) => {
            const v = data[key];
            if (meta.type === 'bool')
              return (
                <Card key={key}>
                  <Toggle checked={!!v} onChange={(x) => save(key, x)} label={meta.label} description={meta.help} />
                </Card>
              );
            const current = meta.type === 'json' ? JSON.stringify(v, null, 1) : v === null || v === undefined ? '' : String(v);
            const draft = drafts[key] ?? current;
            return (
              <Card key={key}>
                <Field label={meta.label} hint={meta.help}>
                  {(id) => (meta.type === 'json' ? <Textarea id={id} className="font-mono text-xs" rows={5} value={draft} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} /> : <Input id={id} value={draft} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} />)}
                </Field>
                <Button
                  size="sm"
                  disabled={draft === current}
                  onClick={() => {
                    let val: unknown = draft;
                    if (meta.type === 'int') {
                      val = Number(draft);
                      if (!Number.isInteger(val) || (val as number) <= 0) return toast('Número inteiro positivo', 'error');
                    } else if (meta.type === 'json') {
                      try {
                        val = JSON.parse(draft);
                      } catch {
                        return toast('JSON inválido', 'error');
                      }
                    } else if (key === 'public_base_url') {
                      val = draft.trim() ? draft.trim().replace(/\/+$/, '') : null;
                      if (val && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(val as string)) return toast('Use https://dominio (sem caminho).', 'error');
                    } else val = draft.trim() || null;
                    void save(key, val);
                  }}
                >
                  Salvar
                </Button>
              </Card>
            );
          })}
      </div>
      <h2 className="mb-2 mt-6 font-bold">Histórico de alterações</h2>
      {hist.data?.length === 0 && <p className="text-sm text-navy-500">Nenhuma alteração registrada.</p>}
      <div className="space-y-1">
        {hist.data?.map((h) => (
          <div key={h.id} className="rounded-xl bg-white p-2 text-xs ring-1 ring-navy/5 dark:bg-navy-900">
            <strong>{h.key}</strong> · {formatDateTime(h.changedAt)} · {JSON.stringify(h.oldValue)} → {JSON.stringify(h.newValue)}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------- Auditoria ----------------
function Audit() {
  const { backend } = useApp();
  const { data, error } = useLoad<AuditEntry[]>(() => backend.admin.auditLog(), [backend]);
  return (
    <>
      <H1>Auditoria</H1>
      {error && <Banner tone="error">{error}</Banner>}
      {!data && <Skeleton className="h-64" />}
      {data?.length === 0 && <EmptyState icon="shield" title="Sem eventos" />}
      <div className="space-y-1">
        {data?.map((a) => (
          <div key={a.id} className="rounded-xl bg-white p-2 text-xs ring-1 ring-navy/5 dark:bg-navy-900">
            <span className="font-semibold">{a.action}</span> · {a.entity} {a.entityId?.slice(0, 12)} · {formatDateTime(a.createdAt)} · ator {a.actorId?.slice(0, 8) ?? 'sistema'}
            {a.data != null && <span className="ml-1 text-navy-500">{JSON.stringify(a.data)}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
