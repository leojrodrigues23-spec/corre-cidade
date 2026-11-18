import { describe, expect, it } from 'vitest';
import { formatBrPhone, generateInviteToken, normalizeBrPhone, normalizePlate, sha256Hex, validName } from './validation';

describe('validação', () => {
  it('telefone', () => {
    expect(normalizeBrPhone('(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizeBrPhone('+55 11 98765-4321')).toBe('+5511987654321');
    expect(normalizeBrPhone('(11) 88765-4321')).toBeNull();
    expect(normalizeBrPhone('(20) 98765-4321')).toBeNull();
    expect(formatBrPhone('+5511987654321')).toBe('(11) 98765-4321');
  });
  it('nome', () => {
    expect(validName('Ana Lúcia')).toBe(true);
    expect(validName('1')).toBe(false);
    expect(validName('<script>')).toBe(false);
  });
  it('placa', () => {
    expect(normalizePlate('abc-1234')).toBe('ABC1234');
    expect(normalizePlate('BRA2E19')).toBe('BRA2E19');
    expect(normalizePlate('AB12345')).toBeNull();
  });
  it('token de convite aleatório e hash', async () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
