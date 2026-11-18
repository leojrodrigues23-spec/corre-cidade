import { describe, expect, it } from 'vitest';
import { calcFare, DEFAULT_FARE_CONFIG } from './fare';
import { formatBRL, roundHalfUp } from './money';

describe('calcFare', () => {
  it('exemplo do enunciado: 6 km, 15 min => R$ 22,25; comissão R$ 2,67; motorista R$ 19,58', () => {
    const f = calcFare(DEFAULT_FARE_CONFIG, 6000, 15 * 60);
    expect(f.baseCents).toBe(500);
    expect(f.distanceCents).toBe(1200);
    expect(f.timeCents).toBe(525);
    expect(f.totalCents).toBe(2225);
    expect(f.commissionCents).toBe(267);
    expect(f.driverNetCents).toBe(1958);
    expect(formatBRL(f.totalCents)).toBe('R$ 22,25');
  });

  it('aplica tarifa mínima', () => {
    const f = calcFare(DEFAULT_FARE_CONFIG, 500, 60);
    expect(f.subtotalCents).toBe(500 + 100 + 35);
    expect(f.minimumApplied).toBe(true);
    expect(f.totalCents).toBe(800);
    expect(f.commissionCents).toBe(96);
    expect(f.driverNetCents).toBe(704);
  });

  it('arredonda half-up por componente', () => {
    // 1234 m * 200/1000 = 246.8 -> 247 ; 100 s * 35/60 = 58.333 -> 58
    const f = calcFare(DEFAULT_FARE_CONFIG, 1234, 100);
    expect(f.distanceCents).toBe(247);
    expect(f.timeCents).toBe(58);
    expect(f.totalCents).toBe(805);
    // 2.5 centavos -> 3
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(266.99999999)).toBe(267);
  });

  it('comissão + líquido sempre somam o total', () => {
    for (let m = 0; m < 40000; m += 777) {
      for (let s = 0; s < 4000; s += 333) {
        const f = calcFare(DEFAULT_FARE_CONFIG, m, s);
        expect(Number.isInteger(f.totalCents)).toBe(true);
        expect(f.commissionCents + f.driverNetCents).toBe(f.totalCents);
      }
    }
  });

  it('rejeita entradas inválidas', () => {
    expect(() => calcFare(DEFAULT_FARE_CONFIG, -1, 0)).toThrow();
    expect(() => calcFare({ ...DEFAULT_FARE_CONFIG, perKmCents: 1.5 }, 1, 1)).toThrow();
    expect(() => calcFare({ ...DEFAULT_FARE_CONFIG, commissionBps: 20000 }, 1, 1)).toThrow();
  });
});
