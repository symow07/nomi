import { createHash } from 'node:crypto';

/**
 * 0078 — the one-time link that lets an owner choose a password
 * (tools/add-login.mjs makes it; `/login/set-password` spends it).
 *
 * The token is 32 random bytes in base64url — 43 characters, far past
 * guessing — so a plain SHA-256 of it is enough to store: nothing a keyed or
 * slow hash would add matters against 256 bits, and the operator's tool can
 * compute the same digest without the installation's secrets. The row keeps
 * only the digest, so it cannot give the link back.
 */
export const SETUP_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const setupTokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
