import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign as cryptoSign } from 'node:crypto';

/**
 * G5b — WEB PUSH: an alert on the owner's phone, from the page they installed.
 *
 * Two standards, built on `node:crypto` alone (no package between Nomi and the
 * owner's phone):
 *   · RFC 8291 / RFC 8188 — the message is encrypted to the browser's own key
 *     (`p256dh`) and secret (`auth`): the push service carries it and cannot
 *     read it. One record, `aes128gcm`.
 *   · RFC 8292 (VAPID) — the request is signed with the installation's key
 *     pair, so the push service knows who sends it. The pair is the operator's:
 *     `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url, P-256) and
 *     `VAPID_SUBJECT` (a `mailto:` or `https:` contact), pasted into Railway
 *     (`tools/vapid-keys.mjs` prints a fresh pair for whoever runs it). Unset:
 *     no phone alerts, and the page says so.
 *
 * The send answers in three ways, by the push service's status: `sent` (201),
 * `gone` (404/410 — the browser dropped it: the subscription is archived), and
 * `failed` (anything else; `retryable` for 429 and 5xx).
 */

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

/** HKDF-SHA-256 with one block of output: all RFC 8291 needs. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/** The record size written in the header; one record always fits a push message. */
const RECORD_SIZE = 4096;

/**
 * RFC 8291 §3 — `plaintext` encrypted to the browser's `p256dh` (65-byte
 * uncompressed P-256 point) and `auth` (16 bytes). `senderPrivate` and `salt`
 * are for the RFC's own test vector; a real send makes both fresh.
 */
export function encryptPushPayload(input: {
  readonly plaintext: Buffer; readonly p256dh: Buffer; readonly auth: Buffer;
  readonly senderPrivate?: Buffer; readonly salt?: Buffer;
}): Buffer {
  const ecdh = createECDH('prime256v1');
  if (input.senderPrivate) ecdh.setPrivateKey(input.senderPrivate); else ecdh.generateKeys();
  const senderPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(input.p256dh);
  const salt = input.salt ?? randomBytes(16);
  const ikm = hkdf(input.auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), input.p256dh, senderPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // The last (and only) record: the text, then the 0x02 delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([input.plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, body]);
}

export type VapidKeys = { readonly publicKey: string; readonly privateKey: string; readonly subject: string };

/** The three variables, read and checked; null when any is missing or malformed. */
export function vapidFrom(env: Record<string, string | undefined>): VapidKeys | null {
  const publicKey = env['VAPID_PUBLIC_KEY']?.trim();
  const privateKey = env['VAPID_PRIVATE_KEY']?.trim();
  const subject = env['VAPID_SUBJECT']?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  try {
    if (fromB64u(publicKey).length !== 65 || fromB64u(privateKey).length !== 32) return null;
  } catch { return null; }
  return { publicKey, privateKey, subject };
}

/** RFC 8292 — `Authorization: vapid t=<jwt>, k=<public key>` for this endpoint's origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): string {
  const pub = fromB64u(keys.publicKey);
  const key = createPrivateKey({ key: {
    kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)),
  }, format: 'jwk' });
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: keys.subject,
  })));
  const signature = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export type PushSubscription = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };
export type PushMessage = { readonly title: string; readonly body: string; readonly url: string | null };
export type PushResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly retryable: boolean; readonly status: number | null };

export type PushFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer; signal?: AbortSignal }) =>
  Promise<{ status: number }>;

export const PUSH_TIMEOUT_MS = 10_000;
/** How long the push service may hold it for a phone that is off: a day — the reply window. */
export const PUSH_TTL_SECONDS = 24 * 3600;

/** Only a push service's https address is ever asked: the browser gave it, and nothing else is reached. */
export const isPushEndpoint = (s: string): boolean => {
  try { const u = new URL(s); return u.protocol === 'https:' && !!u.hostname && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname); }
  catch { return false; }
};

export async function sendPush(sub: PushSubscription, message: PushMessage, keys: VapidKeys, fetchImpl: PushFetch, now = new Date()): Promise<PushResult> {
  if (!isPushEndpoint(sub.endpoint)) return { kind: 'gone' };
  let body: Buffer;
  try {
    body = encryptPushPayload({ plaintext: Buffer.from(JSON.stringify(message)), p256dh: fromB64u(sub.p256dh), auth: fromB64u(sub.auth) });
  } catch {
    return { kind: 'gone' };   // keys the browser gave that are not keys: nothing can ever reach it
  }
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST', body, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys, now),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SECONDS), Urgency: 'high',
      },
    });
    if (res.status >= 200 && res.status < 300) return { kind: 'sent' };
    if (res.status === 404 || res.status === 410) return { kind: 'gone' };
    return { kind: 'failed', retryable: res.status === 429 || res.status >= 500, status: res.status };
  } catch {
    return { kind: 'failed', retryable: true, status: null };
  }
}
