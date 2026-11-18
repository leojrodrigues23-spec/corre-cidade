/** Valores monetários são SEMPRE inteiros em centavos. */
export type Cents = number;

/** Arredondamento "meio para cima" (half-up) para valores não negativos. Regra única do sistema. */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new Error('valor inválido');
  // Corrige ruído de ponto flutuante (ex.: 266.99999999) antes de arredondar.
  const fixed = Math.round(value * 1e6) / 1e6;
  return Math.floor(fixed + 0.5);
}

export function assertCents(v: number): asserts v is Cents {
  if (!Number.isInteger(v) || v < 0) throw new Error(`valor em centavos inválido: ${v}`);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100).replace(/ /g, ' ');
}

/** "22.25" — formato exigido no campo 54 do BR Code. */
export function centsToDecimalString(cents: Cents): string {
  assertCents(cents);
  const reais = Math.floor(cents / 100);
  const cent = cents % 100;
  return `${reais}.${cent.toString().padStart(2, '0')}`;
}
