import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * A1 — a password she chose, kept so that it cannot be read back.
 *
 * scrypt, from the platform: no dependency, memory-hard, and the parameters
 * travel INSIDE the stored string — `scrypt$N$r$p$salt$hash` — so a row made
 * today can be recognised and re-made stronger on some later sign-in without
 * guessing how it was produced. A bare digest cannot say that about itself,
 * which is why migration 0055 refuses one.
 *
 * Staff access codes (M47) are a different thing and stay an HMAC: they are
 * long random strings the product mints, so a fast keyed hash is enough and
 * lets a code name its own business by equality. A password is chosen by a
 * person, which is exactly the case a slow hash exists for.
 */

const N = 32768; // 2^15 — about 32 MB and well under a tenth of a second here
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
/** scrypt needs 128·N·r bytes; the platform's default ceiling is below that. */
const MAX_MEM = 128 * N * R * 2;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, len, { N: n, r, p, maxmem: Math.max(MAX_MEM, 128 * n * r * 2) },
      (err, key) => (err ? reject(err) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, N, R, P, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * True only for the password that made the hash. Never throws: a stored value
 * that cannot be parsed is a password that does not match, not a server error
 * at the door.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // Bounded on purpose: the parameters come from a row, and a row must not be
  // able to ask this process for a gigabyte.
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)
    || n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  try {
    const salt = Buffer.from(parts[4]!, 'base64url');
    const want = Buffer.from(parts[5]!, 'base64url');
    if (salt.length < 8 || want.length < 16) return false;
    const got = await derive(password, salt, n, r, p, want.length);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

/**
 * What is spent when the e-mail is unknown, so that "no such login" and "wrong
 * password" take the same time and the door does not say which addresses have
 * an account.
 */
let decoy: Promise<string> | null = null;
export async function spendAVerification(password: string): Promise<void> {
  decoy ??= hashPassword('nobody-signs-in-with-this');
  await verifyPassword(password, await decoy);
}
