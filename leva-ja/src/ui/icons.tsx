import type { SVGProps } from 'react';

/** Conjunto de ícones padronizado (traço 2px, 24×24, cantos arredondados). */
const paths: Record<string, string> = {
  car: 'M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2.5M19 16v2.5M7.5 13.5h.01M16.5 13.5h.01M4 11h16',
  pin: 'M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7zM3 7l12-3v3M16.5 13.5h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  nav: 'M3 11l18-8-8 18-2-8-8-2z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  download: 'M12 3v12M7 10l5 5 5-5M5 19h14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.5-2.9M22 8.8A15 15 0 0 0 10.7 5M12 20h.01',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  steering: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 10.5h6.5M14 10.5h6.5M12 14v7',
  dashboard: 'M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  ticket: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7zM13 5v14',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  money: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9h.01M18 15h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  plus: 'M12 5v14M5 12h14',
  install: 'M12 3v10M8 9l4 4 4-4M5 15v4h14v-4',
  apple: 'M16 13c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8s-1.7-.8-2.9-.8C6.9 8 5 9.4 5 12.2c0 3.6 2.6 8.3 4.6 8.3.8 0 1.5-.6 2.6-.6s1.6.6 2.6.6c1.4 0 2.6-2.2 3.2-3.6-1.4-.6-2-1.8-2-3.9zM14.3 6.4c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.4-.6.7-1 1.7-.9 2.7 1 .1 2-.5 2.6-1.2z',
  android: 'M7 10v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-7H7zM7 9a5 5 0 0 1 10 0H7zM9.5 7h.01M14.5 7h.01M8 4l1.2 2M16 4l-1.2 2M4.5 10.5v5M19.5 10.5v5M10 18v3M14 18v3',
  whatsapp: 'M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2.2-1.6-2.6-2.6l.8-1-1-2L9.3 8.5H9z',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, className = '', ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/**
 * Símbolo simplificado da marca (pino + carro), derivado da logomarca para uso em tamanhos pequenos.
 * variant "motorista" troca o carro por um volante para diferenciar os dois apps.
 */
export function BrandSymbol({ size = 36, variant = 'passageiro', className = '' }: { size?: number; variant?: 'passageiro' | 'motorista'; className?: string }) {
  const gid = `lj-g-${variant}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Leva Já">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9BE33A" />
          <stop offset="1" stopColor="#00C896" />
        </linearGradient>
      </defs>
      <path d="M32 3C19.3 3 9 13.3 9 26c0 16 19.4 31.4 21.2 32.8a3 3 0 0 0 3.6 0C35.6 57.4 55 42 55 26 55 13.3 44.7 3 32 3z" fill={`url(#${gid})`} />
      <circle cx="32" cy="26" r="15" fill="#102A43" />
      {variant === 'passageiro' ? (
        <g fill="#fff">
          <path d="M26.4 16.5h11.2c.9 0 1.7.6 2 1.4l1.9 4.6h1c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H42v1.6a1.4 1.4 0 0 1-2.8 0V32H24.8v1.6a1.4 1.4 0 0 1-2.8 0V32h-.5c-.8 0-1.5-.7-1.5-1.5v-6c0-.8.7-1.5 1.5-1.5h1l1.9-4.6c.3-.8 1.1-1.4 2-1.4z" />
          <path d="M26.9 22.5l1.4-3.6h7.4l1.4 3.6z" fill="#102A43" />
          <circle cx="25.2" cy="27" r="1.7" fill="#102A43" />
          <circle cx="38.8" cy="27" r="1.7" fill="#102A43" />
          <rect x="29.5" y="28.6" width="5" height="1.6" rx=".8" fill="#102A43" />
        </g>
      ) : (
        <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
          <circle cx="32" cy="26" r="8.5" />
          <circle cx="32" cy="26" r="2" fill="#fff" />
          <path d="M23.8 24.5h6.2M34 24.5h6.2M32 28v6.4" />
        </g>
      )}
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`}>
      <span className="text-current">Leva</span> <span className="text-brand">Já</span>
    </span>
  );
}
