/**
 * Peças visuais "estilo app de banco": cabeçalho com saudação e olho para esconder valores,
 * cartão de saldo, atalhos redondos e extrato agrupado por dia.
 */
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../ui/components';
import { Icon, type IconName } from '../../ui/icons';
import { useApp } from './AppContext';

const HIDE_KEY = 'levaja-hide-values';

/** Preferência "esconder valores" compartilhada entre telas do mesmo app (como nos bancos). */
export function useHiddenValues(): [boolean, () => void] {
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY) === '1');
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === HIDE_KEY && setHidden(e.newValue === '1');
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const toggle = useCallback(() => {
    setHidden((h) => {
      localStorage.setItem(HIDE_KEY, h ? '0' : '1');
      return !h;
    });
  }, []);
  return [hidden, toggle];
}

/** Valor em reais com centavos menores, como no saldo de banco. */
export function Money({ cents, hidden, className, size = 'lg' }: { cents: number; hidden?: boolean; className?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const big = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl', xl: 'text-[40px] leading-none' }[size];
  const small = { sm: 'text-xs', md: 'text-sm', lg: 'text-lg', xl: 'text-xl' }[size];
  if (hidden)
    return (
      <span className={cx('num inline-flex items-baseline gap-1 font-extrabold', className)} aria-label="Valor oculto">
        <span className={cx(small, 'font-bold opacity-70')}>R$</span>
        <span className={big}>••••</span>
      </span>
    );
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const int = Math.floor(abs / 100).toLocaleString('pt-BR');
  const dec = String(abs % 100).padStart(2, '0');
  return (
    <span className={cx('num inline-flex items-baseline font-extrabold', className)} aria-label={`${neg ? 'menos ' : ''}R$ ${int},${dec}`}>
      <span className={cx(small, 'mr-1 font-bold opacity-70')}>{neg ? '− R$' : 'R$'}</span>
      <span className={big}>{int}</span>
      <span className={cx(small, 'font-bold')}>,{dec}</span>
    </span>
  );
}

/** Cabeçalho de banco: avatar, saudação, olho e atalhos de topo. O conteúdo extra vem logo abaixo, no mesmo bloco colorido. */
export function BankHeader({
  name,
  subtitle,
  hidden,
  onToggleHidden,
  right,
  children,
  tone = 'passageiro',
}: {
  name: string;
  subtitle?: ReactNode;
  hidden: boolean;
  onToggleHidden: () => void;
  right?: ReactNode;
  children?: ReactNode;
  tone?: 'passageiro' | 'motorista';
}) {
  const { backend, settings } = useApp();
  const ribbon = backend.mode === 'demo' || settings?.pilot_mode;
  return (
    <header
      className={cx(
        'relative overflow-hidden rounded-b-[36px] px-5 pb-6 text-white shadow-float',
        tone === 'motorista' ? 'bg-[linear-gradient(160deg,#0A1B2C_0%,#0F3B3A_100%)]' : 'bg-[linear-gradient(160deg,#102A43_0%,#0B4D45_100%)]',
        ribbon ? 'pt-[calc(env(safe-area-inset-top)+2.75rem)]' : 'pt-[calc(env(safe-area-inset-top)+1.25rem)]',
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand/25 blur-3xl" />
      <div className="pointer-events-none absolute -left-10 bottom-0 h-32 w-32 rounded-full bg-lime-neon/10 blur-2xl" />
      <div className="relative mx-auto max-w-lg">
        <div className="flex items-center gap-3">
          <Link to="/perfil" aria-label="Perfil" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-extrabold ring-2 ring-white/20 transition hover:bg-white/20">
            {(name || 'L').slice(0, 1).toUpperCase()}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="title truncate text-[19px] font-extrabold leading-tight">Olá, {name?.split(' ')[0] || 'bem-vindo(a)'}</p>
            {subtitle && <div className="mt-0.5 text-xs font-medium text-white/70">{subtitle}</div>}
          </div>
          <HeaderIcon icon={hidden ? 'eyeOff' : 'eye'} label={hidden ? 'Mostrar valores' : 'Esconder valores'} onClick={onToggleHidden} />
          {right}
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </header>
  );
}

export function HeaderIcon({ icon, label, onClick, to }: { icon: IconName; label: string; onClick?: () => void; to?: string }) {
  const cls = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-95';
  if (to)
    return (
      <Link to={to} aria-label={label} className={cls}>
        <Icon name={icon} size={20} />
      </Link>
    );
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cls}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export interface QuickAction {
  icon: IconName;
  label: string;
  onClick?: () => void;
  to?: string;
  highlight?: boolean;
  testId?: string;
}

/** Fileira de atalhos redondos com rótulo embaixo (Pix, Pagar, Transferir… versão corridas). */
export function QuickActions({ items }: { items: QuickAction[] }) {
  return (
    <div className={cx('flex gap-2 pb-1', items.length > 5 ? '-mx-4 overflow-x-auto px-4 [scrollbar-width:none]' : 'justify-between')} role="list">
      {items.map((a) => {
        const circle = (
          <span
            className={cx(
              'flex h-[60px] w-[60px] items-center justify-center rounded-full transition group-active:scale-95',
              a.highlight ? 'bg-brand-grad text-navy-950 shadow-glow' : 'bg-white text-navy ring-1 ring-navy/5 shadow-card group-hover:ring-brand/40 dark:bg-navy-800 dark:text-white dark:ring-white/10',
            )}
          >
            <Icon name={a.icon} size={24} />
          </span>
        );
        const label = <span className="mt-2 block w-[66px] text-center text-[12px] font-bold leading-tight">{a.label}</span>;
        const cls = 'group flex shrink-0 flex-col items-center';
        return a.to ? (
          <Link key={a.label} to={a.to} className={cls} role="listitem" data-testid={a.testId}>
            {circle}
            {label}
          </Link>
        ) : (
          <button key={a.label} type="button" onClick={a.onClick} className={cls} role="listitem" data-testid={a.testId}>
            {circle}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Bloco branco de seção (como "Cartões", "Investimentos"…), com título e ação opcional. */
export function BankSection({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-[28px] bg-white p-5 shadow-card ring-1 ring-navy/5 dark:bg-navy-900 dark:ring-white/5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="title text-[17px] font-extrabold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export interface StatementItem {
  id: string;
  at: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  cents: number;
  /** linha riscada/apagada (cancelada, expirada) */
  muted?: boolean;
  tag?: ReactNode;
  to?: string;
  tone?: 'out' | 'in';
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoje';
  if (same(d, y)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

/** Extrato agrupado por dia: ícone redondo, descrição, horário e valor alinhado à direita. */
export function Statement({ items, hidden, empty }: { items: StatementItem[]; hidden?: boolean; empty?: ReactNode }) {
  if (!items.length) return <>{empty}</>;
  const groups: { label: string; items: StatementItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="eyebrow mb-1">{g.label}</p>
          <ul className="divide-y divide-navy/5 dark:divide-white/5">
            {g.items.map((it) => {
              const row = (
                <div className="flex items-center gap-3 py-3">
                  <span
                    className={cx(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                      it.muted ? 'bg-navy/5 text-navy-400 dark:bg-white/5 dark:text-navy-300' : it.tone === 'in' ? 'bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand' : 'bg-mist text-navy dark:bg-navy-800 dark:text-white',
                    )}
                  >
                    <Icon name={it.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[15px] font-bold', it.muted && 'text-navy-400 dark:text-navy-300')}>{it.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-navy-500 dark:text-navy-300">
                      {new Date(it.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {it.subtitle && <span className="truncate">· {it.subtitle}</span>}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Money
                      cents={it.tone === 'in' ? it.cents : -it.cents}
                      hidden={hidden}
                      size="sm"
                      className={cx(it.muted ? 'text-navy-400 line-through dark:text-navy-300' : it.tone === 'in' ? 'text-brand-700 dark:text-brand' : '')}
                    />
                    {it.tag}
                  </span>
                  {it.to && <Icon name="chevronRight" size={16} className="shrink-0 text-navy-300" />}
                </div>
              );
              return <li key={it.id}>{it.to ? <Link to={it.to}>{row}</Link> : row}</li>;
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
