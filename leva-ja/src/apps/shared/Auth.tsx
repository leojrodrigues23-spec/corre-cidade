import { type ReactNode, useEffect, useRef, useState } from 'react';
import { normalizeBrPhone, validName } from '../../core/validation';
import { DEMO_ACCOUNTS, DEMO_ADMIN_MFA_CODE, DEMO_PASSWORD, DemoBackend } from '../../data/demoBackend';
import { friendlyError } from '../../data/errors';
import type { AppKind } from '../../data/types';
import { Banner, Button, Card, Field, Input, useToast } from '../../ui/components';
import { BrandSymbol, Icon } from '../../ui/icons';
import { useApp } from './AppContext';
import { FullScreenLoader } from './Chrome';

const inviteKey = (app: AppKind) => `levaja-invite-${app}`;

/** Captura o token de convite do link (#/convite/TOKEN) antes de qualquer tela. */
export function captureInviteFromUrl(app: AppKind) {
  const m = window.location.hash.match(/#\/convite\/([A-Za-z0-9_-]{20,128})/);
  if (m) {
    sessionStorage.setItem(inviteKey(app), m[1]);
    window.history.replaceState(null, '', window.location.pathname + '#/');
  }
}

const APP_LABEL: Record<AppKind, string> = { passageiro: 'Leva Já', motorista: 'Leva Já Motorista', admin: 'Painel administrativo' };

export function AuthScreen() {
  const { app, backend, refreshAccess } = useApp();
  const toast = useToast();
  const [mode, setMode] = useState<'login' | 'signup'>(sessionStorage.getItem(inviteKey(app)) ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const hasInvite = !!sessionStorage.getItem(inviteKey(app));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup') {
      if (!validName(fullName)) return setError('Informe seu nome completo (apenas letras).');
      if (!normalizeBrPhone(phone)) return setError('Telefone inválido. Use DDD + número, ex.: (11) 98765-4321.');
      if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
      if (!consent) return setError('É preciso aceitar a política de privacidade.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await backend.signIn(email, password);
      else {
        const r = await backend.signUp({ email, password, fullName, phone: normalizeBrPhone(phone)! });
        if (r.needsEmailConfirmation) {
          setInfo('Enviamos um e-mail de confirmação. Abra o link e depois entre com sua senha.');
          setMode('login');
          return;
        }
      }
      await refreshAccess();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async (email: string) => {
    setBusy(true);
    try {
      await backend.signIn(email, DEMO_PASSWORD);
      await refreshAccess();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-navy via-navy to-navy-800 pb-safe">
      <div className="mx-auto flex max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
        <div className="mb-6 flex items-center gap-3 text-white">
          <BrandSymbol size={52} variant={app === 'motorista' ? 'motorista' : 'passageiro'} />
          <div>
            <p className="text-2xl font-extrabold leading-tight">
              Leva <span className="text-brand">Já</span>
              {app === 'motorista' && <span className="ml-2 align-middle text-sm font-bold text-navy-100">Motorista</span>}
            </p>
            <p className="text-sm text-navy-100">Seu destino começa aqui!</p>
          </div>
        </div>
        <Card className="animate-rise">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-mist p-1 dark:bg-navy-800" role="tablist">
            {(['login', 'signup'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-xl py-2 text-sm font-bold transition ${mode === m ? 'bg-white shadow-sm dark:bg-navy-600' : 'text-navy-500 dark:text-navy-300'}`}>
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>
          {hasInvite && (
            <Banner tone="success" className="mb-3" title="Convite recebido">
              Entre ou crie sua conta para ativar o convite.
            </Banner>
          )}
          {info && <Banner tone="info" className="mb-3">{info}</Banner>}
          <form onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <>
                <Field label="Nome completo">{(id) => <Input id={id} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />}</Field>
                <Field label="Celular" hint="Usado apenas para contato sobre suas corridas.">
                  {(id) => <Input id={id} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98765-4321" value={phone} onChange={(e) => setPhone(e.target.value)} required />}
                </Field>
              </>
            )}
            <Field label="E-mail">{(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
            <Field label="Senha" hint={mode === 'signup' ? 'Mínimo de 8 caracteres.' : undefined}>
              {(id) => <Input id={id} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />}
            </Field>
            {mode === 'signup' && (
              <label className="mb-3 flex items-start gap-2 text-sm text-navy-600 dark:text-navy-100">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  Li e aceito a{' '}
                  <a href="/privacidade.html" target="_blank" rel="noopener" className="font-semibold text-brand-700 underline dark:text-brand">
                    Política de Privacidade
                  </a>{' '}
                  do piloto.
                </span>
              </label>
            )}
            {error && <Banner tone="error" className="mb-3">{error}</Banner>}
            <Button type="submit" block size="lg" loading={busy}>
              {mode === 'login' ? `Entrar no ${APP_LABEL[app]}` : 'Criar conta'}
            </Button>
          </form>
        </Card>
        {backend.mode === 'demo' && (
          <Card className="mt-4 animate-rise">
            <p className="mb-2 text-sm font-bold">Contas de demonstração (modo demo local)</p>
            <p className="mb-3 text-xs text-navy-500 dark:text-navy-300">Senha de todas: {DEMO_PASSWORD}{app === 'admin' && ` · código MFA demo: ${DEMO_ADMIN_MFA_CODE}`}</p>
            <div className="grid gap-2">
              {app === 'passageiro' && <Button variant="secondary" onClick={() => demoLogin(DEMO_ACCOUNTS.passageiro)} disabled={busy}>Entrar como passageira demo</Button>}
              {app === 'motorista' && <Button variant="secondary" onClick={() => demoLogin(DEMO_ACCOUNTS.motorista)} disabled={busy}>Entrar como motorista demo</Button>}
              {app === 'admin' && <Button variant="secondary" onClick={() => demoLogin(DEMO_ACCOUNTS.admin)} disabled={busy}>Entrar como admin demo</Button>}
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await (backend as DemoBackend).resetDemo();
                  toast('Dados demo reiniciados', 'success');
                }}
              >
                Reiniciar dados demo
              </Button>
            </div>
          </Card>
        )}
        <p className="mt-6 text-center text-xs text-navy-300">Piloto privado por convite · sem publicidade</p>
      </div>
    </div>
  );
}

function NoRoleScreen() {
  const { app, backend, settings, refreshAccess } = useApp();
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const redeem = async () => {
    const token = link.match(/convite\/([A-Za-z0-9_-]{20,128})/)?.[1] ?? link.trim();
    setBusy(true);
    setError(null);
    try {
      await backend.redeemInvite(token);
      await refreshAccess();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <Icon name="ticket" size={40} className="mx-auto mb-3 text-brand" />
      <h1 className="mb-1 text-center text-xl font-bold">Acesso por convite</h1>
      <p className="mb-4 text-center text-sm text-navy-500 dark:text-navy-300">
        {app === 'motorista' ? 'O app do motorista exige convite e aprovação do administrador.' : 'O piloto do Leva Já está aberto apenas para convidados.'}
      </p>
      <Field label="Link ou código do convite">{(id) => <Input id={id} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/convite/…" />}</Field>
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}
      <Button block onClick={redeem} loading={busy} disabled={link.trim().length < 20}>
        Ativar convite
      </Button>
      {app === 'passageiro' && settings && !settings.passenger_invite_required && (
        <Button
          block
          variant="secondary"
          className="mt-2"
          onClick={async () => {
            try {
              await backend.selfEnrollPassenger();
              await refreshAccess();
            } catch (e) {
              setError(friendlyError(e));
            }
          }}
        >
          Entrar como passageiro
        </Button>
      )}
      <Button block variant="ghost" className="mt-2" onClick={() => backend.signOut()}>
        Sair
      </Button>
    </Centered>
  );
}

function MfaScreen() {
  const { backend, refreshAccess } = useApp();
  const [stage, setStage] = useState<'check' | 'enroll' | 'verify'>('check');
  const [enroll, setEnroll] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    backend.mfa.status().then((s) => setStage(s.enrolled ? 'verify' : 'enroll')).catch(() => setStage('enroll'));
  }, [backend]);
  useEffect(() => {
    if (stage === 'enroll' && !enroll) backend.mfa.enroll().then(setEnroll).catch((e) => setError(friendlyError(e)));
  }, [stage, enroll, backend]);
  const verify = async () => {
    setError(null);
    try {
      await backend.mfa.verify(enroll?.factorId ?? null, code.trim());
      await refreshAccess();
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  return (
    <Centered>
      <Icon name="shield" size={40} className="mx-auto mb-3 text-brand" />
      <h1 className="mb-1 text-center text-xl font-bold">Verificação em duas etapas</h1>
      <p className="mb-4 text-center text-sm text-navy-500 dark:text-navy-300">O painel administrativo exige autenticação forte (TOTP).</p>
      {stage === 'enroll' && enroll && (
        <div className="mb-4 text-center">
          <p className="mb-2 text-sm">Escaneie no seu app autenticador (Google Authenticator, Authy, 1Password…):</p>
          <img alt="QR Code do autenticador" className="mx-auto h-44 w-44 rounded-xl bg-white p-2" src={enroll.qrSvg.startsWith('data:') ? enroll.qrSvg : `data:image/svg+xml;utf8,${encodeURIComponent(enroll.qrSvg)}`} />
          <p className="mt-2 break-all font-mono text-xs text-navy-500">{enroll.secret}</p>
        </div>
      )}
      {backend.mode === 'demo' && <Banner tone="demo" className="mb-3">Modo demo: use o código {DEMO_ADMIN_MFA_CODE}.</Banner>}
      <Field label="Código de 6 dígitos">{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}
      <Button block onClick={verify} disabled={code.length !== 6}>
        Verificar
      </Button>
      <Button block variant="ghost" className="mt-2" onClick={() => backend.signOut()}>
        Sair
      </Button>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh pb-safe">
      <div className="mx-auto max-w-md px-5 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <Card className="animate-rise">{children}</Card>
      </div>
    </div>
  );
}

/** Portão de acesso. A UI esconde o que não é do perfil, mas a proteção real está no servidor (RLS/RPC). */
export function Gate({ children }: { children: ReactNode }) {
  const { app, backend, session, access, loading, refreshAccess } = useApp();
  const toast = useToast();
  const redeeming = useRef(false);

  useEffect(() => {
    const token = sessionStorage.getItem(inviteKey(app));
    if (!session || !token || redeeming.current) return;
    redeeming.current = true;
    backend
      .redeemInvite(token)
      .then((r) => {
        toast(r.role === 'motorista' ? 'Convite ativado! Complete seu cadastro para aprovação.' : 'Convite ativado! Bem-vindo(a) ao Leva Já.', 'success');
        return refreshAccess();
      })
      .catch((e) => toast(friendlyError(e), 'error'))
      .finally(() => {
        sessionStorage.removeItem(inviteKey(app));
        redeeming.current = false;
      });
  }, [session, app, backend, refreshAccess, toast]);

  if (loading) return <FullScreenLoader />;
  if (!session) return <AuthScreen />;
  if (!access) return <FullScreenLoader label="Verificando acesso…" />;
  if (app === 'admin') {
    if (access.isAdmin) return <>{children}</>;
    if (access.adminNeedsMfa) return <MfaScreen />;
    return (
      <Centered>
        <h1 className="mb-2 text-center text-xl font-bold">Acesso restrito</h1>
        <p className="mb-4 text-center text-sm text-navy-500">Esta conta não tem permissão de administrador.</p>
        <Button block variant="secondary" onClick={() => backend.signOut()}>
          Sair
        </Button>
      </Centered>
    );
  }
  if (!access.roles.includes(app)) return <NoRoleScreen />;
  return <>{children}</>;
}
