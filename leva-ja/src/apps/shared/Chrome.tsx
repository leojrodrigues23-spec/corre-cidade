import { type ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Banner, Button, cx } from '../../ui/components';
import { BrandSymbol, Icon, type IconName } from '../../ui/icons';
import { useApp } from './AppContext';

/** Faixas de status sempre visíveis: modo demo local, piloto/simulação e conexão. */
export function StatusRibbons() {
  const { backend, settings, online } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 pt-safe">
      {backend.mode === 'demo' && (
        <div className="pointer-events-auto bg-fuchsia-700 px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white" data-testid="demo-ribbon">
          Modo demo local · dados apenas neste aparelho · nada é real
        </div>
      )}
      {settings?.pilot_mode && backend.mode !== 'demo' && (
        <div className="bg-amber-500 px-3 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-navy-950">Piloto privado · corridas e pagamentos simulados</div>
      )}
      {!online && (
        <div className="pointer-events-auto flex items-center justify-center gap-2 bg-red-600 px-3 py-1.5 text-center text-xs font-semibold text-white" role="status">
          <Icon name="wifiOff" size={14} /> Sem conexão — tentando reconectar. Dados exibidos podem estar desatualizados.
        </div>
      )}
    </div>
  );
}

export function UpdateBanner({ apply }: { apply: (() => void) | null }) {
  if (!apply) return null;
  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md animate-rise">
      <Banner tone="info" title="Nova versão disponível" action={<Button size="sm" onClick={apply}>Atualizar</Button>}>
        Atualize para receber correções.
      </Banner>
    </div>
  );
}

export function TopBar({ title, variant, right, back }: { title?: string; variant: 'passageiro' | 'motorista' | 'admin'; right?: ReactNode; back?: () => void }) {
  const { backend, settings } = useApp();
  const offset = backend.mode === 'demo' || settings?.pilot_mode ? 'mt-6' : '';
  return (
    <header className={cx('sticky top-0 z-30 bg-mist/85 pt-safe backdrop-blur dark:bg-navy-950/85', offset)}>
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        {back ? (
          <button onClick={back} className="-ml-2 rounded-xl p-2 hover:bg-navy/5 dark:hover:bg-white/10" aria-label="Voltar">
            <Icon name="chevronLeft" />
          </button>
        ) : (
          <BrandSymbol size={30} variant={variant === 'motorista' ? 'motorista' : 'passageiro'} />
        )}
        <h1 className="flex-1 truncate text-lg font-bold">{title ?? (variant === 'motorista' ? 'Leva Já Motorista' : variant === 'admin' ? 'Leva Já · Admin' : 'Leva Já')}</h1>
        {right}
      </div>
    </header>
  );
}

export function BottomNav({ items }: { items: { to: string; label: string; icon: IconName }[] }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-navy/5 bg-white/95 pb-safe backdrop-blur dark:border-white/5 dark:bg-navy-900/95" aria-label="Navegação principal">
      <div className="mx-auto flex max-w-md justify-around px-2 pt-1.5">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) => cx('flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-semibold transition', isActive ? 'text-brand-700 dark:text-brand' : 'text-navy-500 dark:text-navy-300')}
          >
            <Icon name={i.icon} size={22} />
            {i.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function FullScreenLoader({ label = 'Carregando…' }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-navy text-white">
      <BrandSymbol size={64} />
      <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 animate-shimmer rounded-full bg-brand" />
      </div>
      <p className="text-sm text-navy-100">{label}</p>
      {slow && <p className="max-w-xs text-center text-xs text-navy-300">Está demorando mais que o normal. Verifique sua conexão.</p>}
    </div>
  );
}
