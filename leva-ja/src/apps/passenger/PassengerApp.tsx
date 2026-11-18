import { useEffect, useState } from 'react';
import { HashRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import { normalizePixKey, type PixKeyType } from '../../core/pix';
import { friendlyError } from '../../data/errors';
import type { PixKeyInfo, Ride } from '../../data/types';
import { Banner, Button, Card, EmptyState, Field, Input, SectionTitle, Select, Skeleton, ToastProvider, useToast } from '../../ui/components';
import { formatBRL, formatDateTime } from '../../ui/format';
import { Icon } from '../../ui/icons';
import { AppProvider, useApp } from '../shared/AppContext';
import { captureInviteFromUrl, Gate } from '../shared/Auth';
import { BottomNav, StatusRibbons, TopBar, UpdateBanner } from '../shared/Chrome';
import { InstallGuide } from '../shared/InstallPage';
import { ProfilePage } from '../shared/ProfilePage';
import { RideStatusPill, useNotificationFeed } from '../shared/ride';
import { PassengerHome } from './Home';
import { PassengerRidePage } from './RidePage';

captureInviteFromUrl('passageiro');

export function PassengerRoot({ updateApply }: { updateApply: (() => void) | null }) {
  return (
    <ToastProvider>
      <AppProvider app="passageiro">
        <HashRouter>
          <StatusRibbons />
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
          { to: '/', label: 'Início', icon: 'pin' },
          { to: '/historico', label: 'Corridas', icon: 'history' },
          { to: '/perfil', label: 'Perfil', icon: 'user' },
        ]}
      />
    </>
  );
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <TopBar variant="passageiro" title={title} />
      {children}
    </div>
  );
}

function History() {
  const { backend } = useApp();
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.listMyRides().then(setRides).catch((e) => setError(friendlyError(e)));
  }, [backend]);
  return (
    <Page title="Suas corridas">
      <div className="mx-auto max-w-lg px-4 pb-28">
        {error && <Banner tone="error">{error}</Banner>}
        {!rides && !error && (
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {rides?.length === 0 && <EmptyState icon="history" title="Nenhuma corrida ainda" text="Suas corridas e recibos aparecerão aqui." action={<Link to="/"><Button>Pedir corrida</Button></Link>} />}
        <div className="mt-3 space-y-2">
          {rides?.map((r) => (
            <Link key={r.id} to={`/corrida/${r.id}`}>
              <Card className="mb-2 flex items-center gap-3 transition hover:ring-brand/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.dest.address}</p>
                  <p className="text-xs text-navy-500 dark:text-navy-300">{formatDateTime(r.createdAt)}</p>
                  <div className="mt-1">
                    <RideStatusPill status={r.status} />
                  </div>
                </div>
                <p className="font-bold tabular-nums">{formatBRL(r.totalCents)}</p>
                <Icon name="chevronRight" size={18} className="text-navy-300" />
              </Card>
            </Link>
          ))}
        </div>
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
