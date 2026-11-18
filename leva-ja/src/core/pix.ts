import { type Cents, centsToDecimalString } from './money';

/**
 * Gerador de BR Code Pix ESTÁTICO (padrão EMV® QRCPS-MPM conforme Manual de Padrões
 * para Iniciação do Pix do Banco Central). CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF).
 *
 * Primeira fase: DEMONSTRATIVO. Em modo piloto a chave usada é uma chave de simulação
 * inexistente (domínio .invalid) e a UI marca o QR como SIMULAÇÃO — ninguém deve pagar.
 */

export type PixKeyType = 'cpf_cnpj' | 'celular' | 'email' | 'aleatoria';

export const PILOT_SIMULATION_KEY = 'simulacao@levaja.invalid';

export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(payload);
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  const len = new TextEncoder().encode(value).length;
  if (len > 99) throw new Error(`campo ${id} excede 99 bytes`);
  return id + len.toString().padStart(2, '0') + value;
}

/** Remove acentos e caracteres fora do conjunto aceito pelos bancos para nome/cidade. */
export function sanitizePixText(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max);
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');

function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function validCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(cnpj[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

/** Valida e normaliza a chave conforme o tipo. Retorna a chave no formato do DICT. */
export function normalizePixKey(type: PixKeyType, raw: string): { ok: true; key: string } | { ok: false; error: string } {
  const v = raw.trim();
  switch (type) {
    case 'cpf_cnpj': {
      const d = onlyDigits(v);
      if (d.length === 11 && validCpf(d)) return { ok: true, key: d };
      if (d.length === 14 && validCnpj(d)) return { ok: true, key: d };
      return { ok: false, error: 'CPF/CNPJ inválido' };
    }
    case 'celular': {
      let d = onlyDigits(v);
      if (d.length === 11) d = '55' + d;
      if (/^55\d{2}9\d{8}$/.test(d)) return { ok: true, key: '+' + d };
      return { ok: false, error: 'Celular inválido (use DDD + número com 9 dígitos)' };
    }
    case 'email': {
      const e = v.toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 77) return { ok: true, key: e };
      return { ok: false, error: 'E-mail inválido' };
    }
    case 'aleatoria': {
      const k = v.toLowerCase();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k)) return { ok: true, key: k };
      return { ok: false, error: 'Chave aleatória inválida (formato UUID)' };
    }
  }
}

export interface StaticBrCodeInput {
  key: string;
  amountCents: Cents;
  merchantName: string;
  merchantCity: string;
  txid?: string; // até 25 alfanuméricos; '***' quando ausente
  description?: string;
}

export function buildStaticBrCode(input: StaticBrCodeInput): string {
  if (!input.key) throw new Error('chave Pix obrigatória');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error('valor deve ser positivo em centavos');
  const name = sanitizePixText(input.merchantName, 25) || 'RECEBEDOR';
  const city = sanitizePixText(input.merchantCity, 15) || 'ITUPEVA';
  const txid = (input.txid ?? '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***';
  let mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', input.key);
  if (input.description) {
    const desc = sanitizePixText(input.description, 40);
    if (desc && mai.length + 4 + desc.length <= 99) mai += tlv('02', desc);
  }
  const payload =
    tlv('00', '01') +
    tlv('26', mai) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', centsToDecimalString(input.amountCents)) +
    tlv('58', 'BR') +
    tlv('59', name) +
    tlv('60', city) +
    tlv('62', tlv('05', txid)) +
    '6304';
  return payload + crc16ccitt(payload);
}

/** Decodifica TLV de primeiro nível e confere CRC. Usado em testes e na verificação antes de exibir. */
export function parseBrCode(code: string): { valid: boolean; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < code.length) {
    const id = code.slice(i, i + 2);
    const len = Number(code.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || Number.isNaN(len)) return { valid: false, fields };
    fields[id] = code.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  const crcOk = fields['63'] === crc16ccitt(code.slice(0, code.length - 4));
  return { valid: crcOk && fields['00'] === '01', fields };
}

export type PaymentStatus = 'aguardando' | 'informado' | 'confirmacao_manual' | 'confirmado_manual' | 'cancelado';

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  aguardando: 'Aguardando pagamento',
  informado: 'Passageiro informou pagamento',
  confirmacao_manual: 'Em conferência manual',
  confirmado_manual: 'Confirmado manualmente',
  cancelado: 'Cancelado',
};

type Actor = 'passageiro' | 'motorista' | 'admin';
const PAYMENT_TRANSITIONS: Record<PaymentStatus, Partial<Record<PaymentStatus, Actor[]>>> = {
  aguardando: { informado: ['passageiro'], confirmacao_manual: ['motorista', 'admin'], confirmado_manual: ['motorista', 'admin'], cancelado: ['admin'] },
  informado: { confirmacao_manual: ['motorista', 'admin'], confirmado_manual: ['motorista', 'admin'], cancelado: ['admin'] },
  confirmacao_manual: { confirmado_manual: ['motorista', 'admin'], aguardando: ['motorista', 'admin'], cancelado: ['admin'] },
  confirmado_manual: {},
  cancelado: {},
};

/** Exibir QR, copiar código ou enviar imagem NUNCA marcam como pago: só confirmação manual explícita. */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus, actor: Actor): boolean {
  return PAYMENT_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}
