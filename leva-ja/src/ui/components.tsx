import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------- Botões ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'navy';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-coral text-white shadow-[0_6px_16px_-6px_rgba(255,87,85,.55)] hover:bg-coral-600 active:brightness-95',
  navy: 'bg-navy text-white hover:bg-navy-800 active:bg-navy-950 dark:bg-white dark:text-navy dark:hover:bg-navy-100',
  secondary: 'bg-white text-navy ring-1 ring-navy/15 hover:bg-mist dark:bg-navy-800 dark:text-white dark:ring-white/10 dark:hover:bg-navy-700',
  ghost: 'bg-transparent text-navy hover:bg-navy/5 dark:text-white dark:hover:bg-white/10',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  block,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: IconName; block?: boolean }) {
  const sizes = { sm: 'h-9 px-3 text-sm rounded-xl', md: 'h-11 px-4 text-[15px] rounded-2xl', lg: 'h-14 px-5 text-base rounded-2xl' };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[.98] dark:focus-visible:ring-offset-navy-950',
        VARIANTS[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-navy shadow-card ring-1 ring-navy/5 transition hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-95 dark:bg-navy-800 dark:text-white dark:ring-white/10',
        className,
      )}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} role="status" aria-label="Carregando" />;
}

// ---------- Superfícies ----------
export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('rounded-[28px] bg-white p-4 shadow-card ring-1 ring-navy/5 dark:bg-navy-900/90 dark:ring-white/10 dark:backdrop-blur', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-center justify-between px-1">
      <h2 className="text-xs font-bold uppercase tracking-wider text-navy-500 dark:text-navy-300">{children}</h2>
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cx('animate-pulse rounded-xl bg-navy/5 dark:bg-white/5', className)} />
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center animate-rise">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand/10 dark:text-brand">
        <Icon name={icon} size={26} />
      </div>
      <p className="font-semibold text-navy dark:text-white">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-navy-500 dark:text-navy-300">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type Tone = 'info' | 'warn' | 'error' | 'success' | 'demo';
const TONES: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-100 dark:ring-sky-800',
  warn: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-800',
  error: 'bg-red-50 text-red-900 ring-red-200 dark:bg-red-950/60 dark:text-red-100 dark:ring-red-800',
  success: 'bg-brand-50 text-brand-700 ring-brand-100 dark:bg-brand/10 dark:text-brand-100 dark:ring-brand/30',
  demo: 'bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-200 dark:bg-fuchsia-950/60 dark:text-fuchsia-100 dark:ring-fuchsia-800',
};
const TONE_ICON: Record<Tone, IconName> = { info: 'info', warn: 'alert', error: 'alert', success: 'check', demo: 'info' };
export function Banner({ tone = 'info', children, title, className, action }: { tone?: Tone; children?: ReactNode; title?: string; className?: string; action?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-2xl p-3 text-sm ring-1', TONES[tone], className)}>
      <Icon name={TONE_ICON[tone]} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'navy' | 'demo'; className?: string }) {
  const t = {
    neutral: 'bg-navy/5 text-navy-700 dark:bg-white/10 dark:text-navy-100',
    green: 'bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand-100',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
    navy: 'bg-navy text-white dark:bg-white dark:text-navy',
    demo: 'bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/50 dark:text-fuchsia-100',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', t, className)}>{children}</span>;
}

// ---------- Formulários ----------
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-navy-700 dark:text-navy-100">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-navy-500 dark:text-navy-300">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'block h-12 w-full rounded-2xl border-0 bg-mist px-4 text-[15px] text-navy ring-1 ring-inset ring-navy/10 placeholder:text-navy-500/60 focus:bg-white focus:ring-2 focus:ring-brand dark:bg-navy-800 dark:text-white dark:ring-white/10 dark:placeholder:text-navy-300/50 dark:focus:bg-navy-800';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, 'appearance-none pr-10', props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, 'h-auto min-h-[88px] py-3', props.className)} />;
}

export function Toggle({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; description?: string }) {
  return (
    <label className={cx('flex cursor-pointer items-center justify-between gap-4 py-2', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        <span className="block font-semibold text-navy dark:text-white">{label}</span>
        {description && <span className="block text-sm text-navy-500 dark:text-navy-300">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-8 w-14 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2', checked ? 'bg-petrol dark:bg-brand' : 'bg-navy/20 dark:bg-white/20')}
      >
        <span className={cx('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-7' : 'left-1')} />
      </button>
    </label>
  );
}

// ---------- Sheet / Modal ----------
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-safe shadow-sheet outline-none animate-rise dark:bg-navy-900 sm:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy dark:text-white">{title}</h2>
          <button onClick={onClose} className="rounded-xl p-2 text-navy-500 hover:bg-navy/5 dark:hover:bg-white/10" aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Toasts ----------
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}
const ToastCtx = createContext<(text: string, tone?: Tone) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-safe z-[60] flex flex-col items-center gap-2 px-4 pt-10" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto w-full max-w-md rounded-2xl px-4 py-3 text-sm font-medium shadow-card ring-1 animate-rise', TONES[t.tone])}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Tema claro/escuro ----------
export type ThemePref = 'system' | 'light' | 'dark';
export function useTheme(storageKey: string, fallback: ThemePref = 'system') {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem(storageKey) as ThemePref) || fallback);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0A1B2C' : '#102A43');
    };
    apply();
    localStorage.setItem(storageKey, pref);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref, storageKey]);
  return { pref, setPref };
}

export function ThemeSwitch({ pref, setPref }: { pref: ThemePref; setPref: (p: ThemePref) => void }) {
  const opts: { v: ThemePref; label: string; icon: IconName }[] = [
    { v: 'light', label: 'Claro', icon: 'sun' },
    { v: 'dark', label: 'Noturno', icon: 'moon' },
    { v: 'system', label: 'Automático', icon: 'settings' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tema">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={pref === o.v}
          onClick={() => setPref(o.v)}
          data-testid={`theme-${o.v}`}
          className={cx(
            'flex flex-col items-center gap-1.5 rounded-2xl py-3 text-sm font-bold ring-2 transition',
            pref === o.v ? 'bg-brand-50 text-petrol ring-brand dark:bg-petrol dark:text-white' : 'bg-mist text-navy-500 ring-transparent dark:bg-navy-800 dark:text-navy-300',
          )}
        >
          <Icon name={o.icon} size={22} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StarRating({ value, onChange, size = 32 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Avaliação">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(s)}
          role={onChange ? 'radio' : undefined}
          aria-checked={onChange ? value === s : undefined}
          aria-label={`${s} estrela${s > 1 ? 's' : ''}`}
          className={cx('transition', s <= value ? 'text-amber-400' : 'text-navy/15 dark:text-white/15', onChange && 'hover:scale-110')}
        >
          <Icon name="star" size={size} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'border-t border-navy/10 pt-2.5 text-base font-bold dark:border-white/10')}>
      <span className={strong ? 'text-navy dark:text-white' : 'text-navy-500 dark:text-navy-300'}>{k}</span>
      <span className="text-right font-semibold tabular-nums text-navy dark:text-white">{v}</span>
    </div>
  );
}
