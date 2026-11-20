import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBrPhone, normalizeBrPhone, validName } from '../../core/validation';
import { friendlyError } from '../../data/errors';
import type { Profile } from '../../data/types';
import { Banner, Button, Card, Field, Input, Modal, SectionTitle, Skeleton, ThemeSwitch, useToast } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useApp } from './AppContext';

export function ProfilePage({ extra }: { extra?: ReactNode }) {
  const { backend, theme, session, refreshAccess } = useApp();
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>('Notification' in window ? Notification.permission : 'unsupported');

  useEffect(() => {
    backend.getProfile().then((x) => {
      setP(x);
      setName(x.fullName);
      setPhone(x.phone ? formatBrPhone(x.phone) : '');
    });
  }, [backend]);

  const save = async () => {
    if (!validName(name)) return toast('Nome inválido.', 'error');
    const ph = phone ? normalizeBrPhone(phone) : null;
    if (phone && !ph) return toast('Telefone inválido.', 'error');
    setBusy(true);
    try {
      await backend.updateProfile({ fullName: name, phone: ph });
      toast('Perfil atualizado', 'success');
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-28">
      {/* cartão de identificação, no estilo de configurações de banco */}
      <div className="mt-2 flex items-center gap-4 rounded-[28px] bg-petrol p-5 text-white">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl font-extrabold">{(p?.fullName || name || 'L').slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="title truncate text-lg font-extrabold">{p?.fullName || 'Sua conta'}</p>
          <p className="truncate text-sm text-white/75">{session?.email}</p>
        </div>
      </div>

      <SectionTitle>Aparência</SectionTitle>
      <Card>
        <p className="mb-2 text-sm text-navy-500 dark:text-navy-300">Escolha o modo claro, o modo noturno ou siga o do celular.</p>
        <ThemeSwitch pref={theme.pref} setPref={theme.setPref} />
      </Card>

      <SectionTitle>Seus dados</SectionTitle>
      <Card>
        {!p ? (
          <div className="space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <>
            <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Celular">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
            <Button onClick={save} loading={busy}>
              Salvar
            </Button>
          </>
        )}
      </Card>

      {extra}

      <SectionTitle>Privacidade e permissões</SectionTitle>
      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Uso da localização</p>
            <p className="text-sm text-navy-500 dark:text-navy-300">{p?.locationConsentAt ? 'Autorizado no app' : 'Não autorizado no app'}</p>
          </div>
          {p?.locationConsentAt ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await backend.setLocationConsent(false);
                setP({ ...p, locationConsentAt: null });
                toast('Consentimento revogado. Sua última posição foi apagada do servidor.', 'success');
              }}
            >
              Revogar
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                await backend.setLocationConsent(true);
                setP((x) => (x ? { ...x, locationConsentAt: new Date().toISOString() } : x));
              }}
            >
              Autorizar
            </Button>
          )}
        </div>
        <p className="text-xs text-navy-500 dark:text-navy-300">Para bloquear de vez, desative também a permissão de localização deste site nas configurações do aparelho.</p>
        <div className="flex items-center justify-between gap-3 border-t border-navy/10 pt-3 dark:border-white/10">
          <div>
            <p className="font-semibold">Notificações</p>
            <p className="text-sm text-navy-500 dark:text-navy-300">
              {notifPerm === 'granted' ? 'Permitidas' : notifPerm === 'denied' ? 'Bloqueadas no navegador' : notifPerm === 'unsupported' ? 'Não suportadas aqui (no iPhone, instale o app primeiro)' : 'Não solicitadas'}
            </p>
          </div>
          {notifPerm === 'default' && (
            <Button size="sm" variant="secondary" onClick={async () => setNotifPerm(await Notification.requestPermission())}>
              Permitir
            </Button>
          )}
        </div>
        <a href={`${import.meta.env.BASE_URL}privacidade.html`} target="_blank" rel="noopener" className="flex items-center justify-between border-t border-navy/10 pt-3 text-sm font-semibold dark:border-white/10">
          Política de privacidade <Icon name="chevronRight" size={18} />
        </a>
      </Card>

      <SectionTitle>Aplicativo</SectionTitle>
      <Card className="space-y-2">
        <Link to="/instalar" className="flex items-center justify-between py-1 text-sm font-semibold">
          Instalar na tela inicial <Icon name="chevronRight" size={18} />
        </Link>
        <p className="text-xs text-navy-500 dark:text-navy-300">Sem publicidade e sem rastreadores de anúncios.</p>
      </Card>

      <div className="mt-6 space-y-2">
        <Button block variant="secondary" icon="logout" onClick={() => backend.signOut().then(refreshAccess)}>
          Sair da conta
        </Button>
        <Button block variant="ghost" className="text-red-600 dark:text-red-400" icon="trash" onClick={() => setConfirmDelete(true)}>
          Excluir minha conta
        </Button>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Excluir conta">
        <Banner tone="warn" className="mb-3">
          Seus dados pessoais, chaves Pix e localização serão apagados. Registros de corridas concluídas são mantidos anonimizados para auditoria.
        </Banner>
        <Button
          block
          variant="danger"
          onClick={async () => {
            try {
              await backend.deleteMyAccount();
              await refreshAccess();
            } catch (e) {
              toast(friendlyError(e), 'error');
            }
          }}
        >
          Excluir definitivamente
        </Button>
      </Modal>
    </div>
  );
}
