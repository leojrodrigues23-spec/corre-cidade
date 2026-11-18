import { type Cents, assertCents, roundHalfUp } from './money';

/**
 * Configuração de tarifa. Todos os valores em centavos; comissão em basis points (1200 = 12%).
 * Os valores padrão abaixo são FICTÍCIOS, apenas para o piloto de testes.
 */
export interface FareConfig {
  version: number;
  baseCents: Cents; // bandeirada
  perKmCents: Cents;
  perMinuteCents: Cents;
  minimumCents: Cents;
  commissionBps: number;
  pricingMode: 'fixa_na_solicitacao' | 'variavel';
  manualPriceEnabled: boolean;
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  version: 1,
  baseCents: 500,
  perKmCents: 200,
  perMinuteCents: 35,
  minimumCents: 800,
  commissionBps: 1200,
  pricingMode: 'fixa_na_solicitacao',
  manualPriceEnabled: false,
};

export interface FareBreakdown {
  fareVersion: number;
  distanceM: number;
  durationS: number;
  baseCents: Cents;
  distanceCents: Cents;
  timeCents: Cents;
  subtotalCents: Cents;
  minimumCents: Cents;
  minimumApplied: boolean;
  totalCents: Cents;
  commissionBps: number;
  commissionCents: Cents;
  driverNetCents: Cents;
}

/**
 * Fórmula: max(minima, bandeirada + km_rota*valor_km + minutos*valor_minuto)
 * Arredondamento: cada componente é arredondado half-up para centavos; comissão = half-up(total*bps/10000).
 * Espelhada exatamente em SQL (public.calc_fare) — os testes garantem a equivalência.
 */
export function calcFare(cfg: FareConfig, distanceM: number, durationS: number): FareBreakdown {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error('distância inválida');
  if (!Number.isFinite(durationS) || durationS < 0) throw new Error('duração inválida');
  for (const v of [cfg.baseCents, cfg.perKmCents, cfg.perMinuteCents, cfg.minimumCents]) assertCents(v);
  if (!Number.isInteger(cfg.commissionBps) || cfg.commissionBps < 0 || cfg.commissionBps > 10000) {
    throw new Error('comissão inválida');
  }
  const dM = Math.round(distanceM);
  const dS = Math.round(durationS);
  const distanceCents = roundHalfUp((dM * cfg.perKmCents) / 1000);
  const timeCents = roundHalfUp((dS * cfg.perMinuteCents) / 60);
  const subtotal = cfg.baseCents + distanceCents + timeCents;
  const minimumApplied = subtotal < cfg.minimumCents;
  const total = minimumApplied ? cfg.minimumCents : subtotal;
  const commission = roundHalfUp((total * cfg.commissionBps) / 10000);
  return {
    fareVersion: cfg.version,
    distanceM: dM,
    durationS: dS,
    baseCents: cfg.baseCents,
    distanceCents,
    timeCents,
    subtotalCents: subtotal,
    minimumCents: cfg.minimumCents,
    minimumApplied,
    totalCents: total,
    commissionBps: cfg.commissionBps,
    commissionCents: commission,
    driverNetCents: total - commission,
  };
}
