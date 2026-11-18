/** Telefone brasileiro: DDD válido + 8 (fixo) ou 9 dígitos começando com 9 (celular). Retorna E.164. */
const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);

export function normalizeBrPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (!DDDS.has(ddd)) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return '+55' + d;
}

export function formatBrPhone(e164: string): string {
  const d = e164.replace(/^\+55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}

export function validName(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 80 && /^[\p{L}][\p{L}' .-]*$/u.test(n);
}

/** Placas brasileiras: antiga (ABC1234) e Mercosul (ABC1D23). */
export function normalizePlate(raw: string): string | null {
  const p = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p) ? p : null;
}

/** Token de convite: 32 bytes aleatórios em base64url (256 bits). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
