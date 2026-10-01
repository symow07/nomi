import { describe, it, expect } from 'vitest';
import { createECDH, createHmac, createDecipheriv, verify as cryptoVerify, generateKeyPairSync } from 'node:crypto';
import { encryptPushPayload, vapidAuthorization, vapidFrom, sendPush, isPushEndpoint, type PushFetch } from '../../src/net/webPush.js';

/**
 * G5b — web push, the two standards held by their own oracles: RFC 8291's
 * worked example (Appendix A), a round trip opened with the browser's private
 * key the way a browser opens it, and the VAPID signature checked with the
 * public key the push service checks it with.
 */

const b = (s: string) => Buffer.from(s, 'base64url');

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** A browser opening it: the header, its key, the same derivations from its side, the record. */
function open(message: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = message.subarray(0, 16);
  const idLength = message.readUInt8(20);
  const senderPublic = message.subarray(21, 21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(senderPublic);
  const hk = (s: Buffer, k: Buffer, info: Buffer, n: number) =>
    createHmac('sha256', createHmac('sha256', s).update(k).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
  const ikm = hk(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, senderPublic]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const record = message.subarray(21 + idLength);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
  expect(padded.at(-1)).toBe(2);   // the last record's delimiter
  return padded.subarray(0, padded.length - 1).toString('utf8');
}

describe('G5b · RFC 8291: the message only the browser can open', () => {
  it('the RFC\'s own worked example, byte for byte', () => {
    const out = encryptPushPayload({
      plaintext: Buffer.from(RFC.plaintext), p256dh: b(RFC.uaPublic), auth: b(RFC.auth),
      senderPrivate: b(RFC.asPrivate), salt: b(RFC.salt),
    });
    expect(out.toString('base64url')).toBe(RFC.body);
  });
  it('a fresh one opens with the browser\'s key, and with no other', () => {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const text = JSON.stringify({ title: 'A reply is waiting for you', body: 'سارا', url: 'https://app.nomidoes.com/app/inbox/x#latest' });
    const sealed = encryptPushPayload({ plaintext: Buffer.from(text), p256dh: ua.getPublicKey(), auth });
    expect(open(sealed, ua.getPrivateKey(), auth)).toBe(text);
    const other = createECDH('prime256v1'); other.generateKeys();
    expect(() => open(sealed, other.getPrivateKey(), auth)).toThrow();
  });
});

describe('G5b · RFC 8292: who sends it', () => {
  const pair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' }) as { d: string };
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65);
    return { publicKey: raw.toString('base64url'), privateKey: jwk.d, subject: 'mailto:alerts@nomidoes.com', key: publicKey };
  };
  it('a JWT for the push service\'s origin, twelve hours long, signed with the installation\'s key', () => {
    const k = pair();
    const auth = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', k, new Date('2026-10-01T10:00:00Z'));
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)!;
    expect(m[4]).toBe(k.publicKey);
    const claims = JSON.parse(b(m[2]!).toString());
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Date.parse('2026-10-01T22:00:00Z') / 1000, sub: 'mailto:alerts@nomidoes.com' });
    expect(JSON.parse(b(m[1]!).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const ok = cryptoVerify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: k.key, dsaEncoding: 'ieee-p1363' }, b(m[3]!));
    expect(ok).toBe(true);
  });
  it('the variables are read and checked: all three, the right lengths, a contact', () => {
    const k = pair();
    expect(vapidFrom({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: k.subject })).not.toBeNull();
    expect(vapidFrom({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey })).toBeNull();
    expect(vapidFrom({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: k.subject })).toBeNull();
    expect(vapidFrom({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'nobody' })).toBeNull();
  });
  it('the push service\'s answer: sent, gone (archive it), or failed — retryable only when it may pass', async () => {
    const k = pair();
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const sub = { endpoint: 'https://push.example.com/abc', p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') };
    const at = (status: number): PushFetch => async (_url, init) => {
      expect(init.headers['Content-Encoding']).toBe('aes128gcm');
      expect(init.headers['TTL']).toBe('86400');
      return { status };
    };
    const msg = { title: 't', body: 'b', url: null };
    expect(await sendPush(sub, msg, k, at(201))).toEqual({ kind: 'sent' });
    expect(await sendPush(sub, msg, k, at(410))).toEqual({ kind: 'gone' });
    expect(await sendPush(sub, msg, k, at(404))).toEqual({ kind: 'gone' });
    expect(await sendPush(sub, msg, k, at(429))).toEqual({ kind: 'failed', retryable: true, status: 429 });
    expect(await sendPush(sub, msg, k, at(400))).toEqual({ kind: 'failed', retryable: false, status: 400 });
    // An address that is not a push service's is never asked.
    expect(await sendPush({ ...sub, endpoint: 'http://push.example.com/x' }, msg, k, async () => { throw new Error('asked'); })).toEqual({ kind: 'gone' });
    expect(isPushEndpoint('https://localhost/x')).toBe(false);
  });
});
