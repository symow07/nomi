import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * A3 — the six digits, and the two small cookies that go with them.
 *
 * Everything here is keyed off the installation's session secret and carries a
 * PURPOSE in what is signed, so a token minted for one thing can never be read
 * as another (the same rule as the staff-code cookie, people.ts).
 */

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_DIGITS = 6;

export type OtpPurpose = 'signup' | 'device';

/** Uniform over 000000–999999; `randomInt` is the platform's unbiased source. */
export const newOtpCode = (): string => String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');

/** What is stored. Bound to the address and the purpose, so a code is good for one thing only. */
export const otpHash = (secret: string, email: string, purpose: OtpPurpose, code: string): string =>
  createHmac('sha256', secret).update(`otp:${purpose}:${email.trim().toLowerCase()}:${code.replace(/\D/g, '')}`).digest('base64url');

const mac = (secret: string, purpose: string, payload: string): string =>
  createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('base64url');

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function mint(secret: string, purpose: string, body: unknown[]): string {
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payload}.${mac(secret, purpose, payload)}`;
}

function read(secret: string, purpose: string, token: string | undefined): unknown[] | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!same(token.slice(dot + 1), mac(secret, purpose, payload))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/**
 * WHICH code this browser is waiting to type. Holds the row's id and the
 * address — never the code — and lasts as long as a re-issue is allowed.
 */
export const PENDING_TTL_MS = 30 * 60 * 1000;
export type PendingOtp = { readonly id: string; readonly email: string; readonly purpose: OtpPurpose };

export const mintPendingOtp = (secret: string, p: PendingOtp, now: number): string =>
  mint(secret, 'otp-pending', [p.id, p.email, p.purpose, now + PENDING_TTL_MS]);

export function readPendingOtp(secret: string, token: string | undefined, now: number): PendingOtp | null {
  const v = read(secret, 'otp-pending', token);
  if (!v || v.length !== 4) return null;
  const [id, email, purpose, exp] = v;
  if (typeof id !== 'string' || typeof email !== 'string' || typeof exp !== 'number' || exp < now) return null;
  if (purpose !== 'signup' && purpose !== 'device') return null;
  return { id, email, purpose };
}

/**
 * "A browser we have seen", for ONE login. 180 days. Signing in with a password
 * from a browser that holds no such cookie for that login asks for a code.
 */
export const DEVICE_TTL_MS = 180 * 24 * 3600 * 1000;

export const mintKnownDevice = (secret: string, loginId: string, now: number): string =>
  mint(secret, 'known-device', [loginId, now + DEVICE_TTL_MS]);

export function isKnownDevice(secret: string, token: string | undefined, loginId: string, now: number): boolean {
  const v = read(secret, 'known-device', token);
  if (!v || v.length !== 2) return false;
  const [id, exp] = v;
  return typeof id === 'string' && typeof exp === 'number' && exp >= now && same(id, loginId);
}

/** `m••@atlas.example` — enough for her to recognise her address, not enough to read it over her shoulder. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, 1)}${'•'.repeat(Math.min(6, Math.max(2, at - 1)))}${email.slice(at)}`;
}
