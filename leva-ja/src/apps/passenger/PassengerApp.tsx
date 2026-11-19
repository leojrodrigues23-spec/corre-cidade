import { useEffect, useState } from 'react';
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { normalizePixKey, type PixKeyType } from '../../core/pix';
import { friendlyError } from '../../data/errors';
import type { PixKeyInfo, Ride } from '../../data/types';
import { Banner, Button, Card, EmptyState, Field, Input, SectionTitle, Select, Skeleton, ToastProvider, useToast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { AppProvider, useApp } from '../shared/AppContext';
import { captureInviteFromUrl, Gate } from '../shared/Auth';
import { BottomNav, StatusRibbons, TopBar, UpdateBanner } from '../shared/Chrome';
import { ScrollToTop } from '../shared/ScrollToTop';
import { InstallGuide } from '../shared/InstallPage';
import { ProfilePage } from '../shared/ProfilePage';
import { RideStatusPill, useNotificationFeed } from '../shared/ride';
import { BankSection, Money, Statement, type StatementItem, useHiddenValues } from '../shared/Bank';
import { RIDE_STATUS_LABEL } from '../../core/ride';
import { PassengerHome } from './Home';
import { PassengerRidePage } from './RidePage';

captureInviteFromUrl('passageiro');

export function PassengerRoot({ updateApply }: { updateApply: (() => void) | null }) {
  return (
    <ToastProvider>
      <AppProvider app="passageiro">
        <HashRouter>
          <StatusRibbons />
          <ScrollToTop />
          <Gate>
            <Shell />
          </Gate>
          <UpdateBanner apply={updateApply} />
        </HashRouter>
      </AppProvider>
    </ToastProvider>
  );
}

function Shell() {
  const nav = useNavigate();
  useNotificationFeed((kind, rideId) => {
    if (rideId && (kind === 'ride_accepted' || kind === 'ride_finalizada')) nav(`/corrida/${rideId}`);
  });
  return (
    <>
      <Routes>
        <Route path="/" element={<PassengerHome />} />
        <Route path="/corrida/:id" element={<PassengerRidePage />} />
        <Route path="/historico" element={<History />} />
        <Route path="/perfil" element={<Page title="Perfil"><ProfilePage extra={<OptionalPixKey />} /></Page>} />
        <Route path="/instalar" element={<Page title="Instalar Leva Já"><div className="mx-auto max-w-lg px-4 pb-28 pt-2"><InstallGuide app="passageiro" /></div></Page>} />
        <Route path="*" element={<PassengerHome />} />
      </Routes>
      <BottomNav
        items={[
          { to: '/', label: 'Início', icon: 'home' },
          { to: '/historico', label: 'Corridas', icon: 'receipt' },
          { to: '/perfil', label: 'Perfil', icon: 'user' },
        ]}
      />
    </>
  );
}

function Page({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <TopBar variant="passageiro" title={title} right={right} />
      {children}
    </div>
  );
}

function History() {
  const { backend, settings } = useApp();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, toggleHidden] = useHiddenValues();
  useEffect(() => {
    backend.listMyRides().then(setRides).catch((e) => setError(friendlyError(e)));
  }, [backend]);
  const done = (rides ?? []).filter((r) => r.status === 'finalizada');
  const total = done.reduce((a, r) => a + r.totalCents, 0);
  const items: StatementItem[] = (rides ?? []).map((r) => ({
    id: r.id,
    at: r.finishedAt ?? r.createdAt,
    icon: 'car',
    title: r.dest.address.split(',')[0],
    subtitle: r.status === 'finalizada' ? `de ${r.pickup.address.split(',')[0]}` : RIDE_STATUS_LABEL[r.status],
    cents: r.totalCents,
    muted: r.status === 'cancelada' || r.status === 'expirada',
    tag: r.status === 'finalizada' || r.status === 'cancelada' || r.status === 'expirada' ? undefined : <RideStatusPill status={r.status} />,
    to: `/corrida/${r.id}`,
  }));
  return (
    <Page title="Extrato de corridas" right={<button onClick={toggleHidden} aria-label={hidden ? 'Mostrar valores' : 'Esconder valores'} className="rounded-full p-2 hover:bg-navy/5 dark:hover:bg-white/10"><Icon name={hidden ? 'eyeOff' : 'eye'} /></button>}>
      <div className="mx-auto max-w-lg space-y-4 px-4 pb-28 pt-2">
        {error && <Banner tone="error">{error}</Banner>}
        <BankSection>
          <p className="eyebrow">Total em corridas finalizadas</p>
          <Money cents={total} hidden={hidden} size="lg" className="mt-1 block" />
          <p className="mt-1 text-sm text-navy-500 dark:text-navy-300">
            {done.length} corrida{done.length === 1 ? '' : 's'}
            {settings?.pilot_mode ? ' · valores simulados' : ''}
          </p>
        </BankSection>
        <BankSection title="Movimentações">
          {!rides && !error ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <Statement
              items={items}
              hidden={hidden}
              empty={<EmptyState icon="history" title="Nenhuma corrida ainda" text="Suas corridas e recibos aparecerão aqui." action={<Link to="/"><Button>Pedir corrida</Button></Link>} />}
            />
          )}
        </BankSection>
      </div>
    </Page>
  );
}

/** Chave Pix do passageiro: OPCIONAL, apenas para eventual uso futuro (ex.: reembolsos). Não é necessária para pagar. */
function OptionalPixKey() {
  const { backend } = useApp();
  const toast = useToast();
  const [key, setKey] = useState<PixKeyInfo | null>(null);
  const [type, setType] = useState<PixKeyType>('celular');
  const [value, setValue] = useState('');
  const [holder, setHolder] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    backend.getMyPixKey('passageiro_opcional').then(setKey).catch(() => undefined);
  }, [backend]);
  return (
    <>
      <SectionTitle>Chave Pix (opcional)</SectionTitle>
      <Card>
        <p className="mb-3 text-sm text-navy-600 dark:text-navy-100">
          Você <strong>não</strong> precisa de chave Pix para pagar: basta ler o QR Code ao final da corrida. Cadastrar uma chave é opcional e só seria usado no futuro para devoluções/reembolsos, com seu aviso.
        </p>
        {key ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              <strong>{key.type}</strong> · {key.value}
            </p>
            <Button size="sm" variant="secondary" onClick={async () => { await backend.savePassengerPixKey(null); setKey(null); toast('Chave removida', 'success'); }}>
              Remover
            </Button>
          </div>
        ) : !open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Cadastrar chave opcional
          </Button>
        ) : (
          <>
            <Field label="Tipo">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value as PixKeyType)}><option value="cpf_cnpj">CPF/CNPJ</option><option value="celular">Celular</option><option value="email">E-mail</option><option value="aleatoria">Aleatória</option></Select>}</Field>
            <Field label="Chave">{(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
            <Field label="Nome do titular">{(id) => <Input id={id} value={holder} onChange={(e) => setHolder(e.target.value)} />}</Field>
            <Button
              onClick={async () => {
                const n = normalizePixKey(type, value);
                if (!n.ok) return toast(n.error, 'error');
                if (holder.trim().length < 2) return toast('Informe o titular', 'error');
                try {
                  await backend.savePassengerPixKey({ type, value: n.key, holder: holder.trim() });
                  setKey({ type, value: n.key, holder });
                  setOpen(false);
                } catch (e) {
                  toast(friendlyError(e), 'error');
                }
              }}
            >
              Salvar
            </Button>
          </>
        )}
      </Card>
    </>
  );
}
