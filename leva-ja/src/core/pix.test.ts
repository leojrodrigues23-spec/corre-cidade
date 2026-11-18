import { describe, expect, it } from 'vitest';
import { buildStaticBrCode, canTransitionPayment, crc16ccitt, normalizePixKey, parseBrCode, sanitizePixText } from './pix';

describe('CRC16-CCITT-FALSE', () => {
  it('vetor de verificação padrão "123456789" = 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
  it('exemplo do Manual de Padrões do BCB', () => {
    const body =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16ccitt(body)).toBe('1D3D');
  });
});

describe('buildStaticBrCode', () => {
  it('gera payload válido com valor exato e CRC correto', () => {
    const code = buildStaticBrCode({ key: 'simulacao@levaja.invalid', amountCents: 2225, merchantName: 'João Motorista', merchantCity: 'Itupeva' });
    const p = parseBrCode(code);
    expect(p.valid).toBe(true);
    expect(p.fields['54']).toBe('22.25');
    expect(p.fields['53']).toBe('986');
    expect(p.fields['58']).toBe('BR');
    expect(p.fields['59']).toBe('JOAO MOTORISTA');
    expect(p.fields['60']).toBe('ITUPEVA');
    expect(p.fields['26']).toContain('br.gov.bcb.pix');
    expect(p.fields['62']).toBe('0503***');
  });
  it('vetor compartilhado com o teste SQL (build_static_brcode)', () => {
    expect(buildStaticBrCode({ key: 'simulacao@levaja.invalid', amountCents: 2225, merchantName: 'SIMULACAO LEVA JA', merchantCity: 'ITUPEVA', txid: 'LJTESTE123' })).toBe(
      '00020126460014br.gov.bcb.pix0124simulacao@levaja.invalid520400005303986540522.255802BR5917SIMULACAO LEVA JA6007ITUPEVA62140510LJTESTE123630419F4',
    );
  });
  it('corrompido falha na validação', () => {
    const code = buildStaticBrCode({ key: 'a@b.co', amountCents: 800, merchantName: 'X', merchantCity: 'Y' });
    const tampered = code.replace('8.00', '9.00');
    expect(parseBrCode(tampered).valid).toBe(false);
  });
  it('rejeita valor zero ou fracionário', () => {
    expect(() => buildStaticBrCode({ key: 'a@b.co', amountCents: 0, merchantName: 'X', merchantCity: 'Y' })).toThrow();
    expect(() => buildStaticBrCode({ key: 'a@b.co', amountCents: 10.5, merchantName: 'X', merchantCity: 'Y' })).toThrow();
  });
  it('limita nome a 25 e cidade a 15 caracteres', () => {
    expect(sanitizePixText('Ação Ãéíõú Çidade de São José dos Campos', 15)).toBe('ACAO AEIOU CIDA');
  });
});

describe('normalizePixKey', () => {
  it('CPF válido/inválido', () => {
    expect(normalizePixKey('cpf_cnpj', '529.982.247-25')).toEqual({ ok: true, key: '52998224725' });
    expect(normalizePixKey('cpf_cnpj', '111.111.111-11').ok).toBe(false);
  });
  it('CNPJ válido', () => {
    expect(normalizePixKey('cpf_cnpj', '11.222.333/0001-81')).toEqual({ ok: true, key: '11222333000181' });
  });
  it('celular com +55', () => {
    expect(normalizePixKey('celular', '(11) 99999-8888')).toEqual({ ok: true, key: '+5511999998888' });
    expect(normalizePixKey('celular', '1133334444').ok).toBe(false);
  });
  it('e-mail e aleatória', () => {
    expect(normalizePixKey('email', ' Fulano@Exemplo.com ')).toEqual({ ok: true, key: 'fulano@exemplo.com' });
    expect(normalizePixKey('aleatoria', '123e4567-e12b-12d1-a456-426655440000').ok).toBe(true);
    expect(normalizePixKey('aleatoria', 'abc').ok).toBe(false);
  });
});

describe('status de pagamento', () => {
  it('passageiro só pode informar; nunca confirmar', () => {
    expect(canTransitionPayment('aguardando', 'informado', 'passageiro')).toBe(true);
    expect(canTransitionPayment('aguardando', 'confirmado_manual', 'passageiro')).toBe(false);
    expect(canTransitionPayment('informado', 'confirmado_manual', 'passageiro')).toBe(false);
  });
  it('confirmado é terminal', () => {
    expect(canTransitionPayment('confirmado_manual', 'cancelado', 'admin')).toBe(false);
  });
});
