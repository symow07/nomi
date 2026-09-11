import { createHmac, timingSafeEqual } from 'node:crypto';
import { CONTACT_CHANNELS, type ContactChannel } from '../core/outreach/consent.js';
import { LOCALES, type Locale } from '../core/owner/i18n/locale.js';

/**
 * M40.2 — the link at the bottom of every message she sends.
 *
 * ── IT IS STATELESS, AND THAT IS THE POINT ────────────────────────────────
 *
 * A stored token needs a row per recipient per send, written before the message
 * goes out and read when it comes back. That is a table whose only job is to
 * remember something the link could carry itself, and a send path that must
 * write before it sends is a send path that can fail between the two — leaving
 * a message in someone's inbox whose unsubscribe link resolves to nothing.
 *
 * The token carries who it is for and is signed, so it cannot be forged and
 * cannot be edited into somebody else's address.
 *
 * ── WHAT IS IN IT IS NOT SECRET ───────────────────────────────────────────
 *
 * The address is inside the token, encoded rather than encrypted, and that is
 * a deliberate acceptance rather than an oversight: the link is delivered to
 * the inbox of the person it names, so anyone who can read it already knows the
 * address. What the signature prevents is the other direction — nobody can
 * craft a link that unsubscribes an address they were never given.
 *
 * The tenant is not in it. The route resolves the business from the signature's
 * payload, never from anything a visitor supplies, and the page it renders says
 * nothing about whose list it was.
 *
 * ── AND IT LIVES HERE RATHER THAN IN core/ ────────────────────────────────
 *
 * It signs, so it needs `node:crypto`, and ADR-0002 keeps `src/core` free of
 * node built-ins — the boundary check caught this on the way in. `outbound/dns.ts`
 * sits here for the same reason, and `api/web/people.ts` hashes access codes in
 * the same spirit: the rule that core is pure is worth more than the tidiness of
 * keeping every outreach concept under one directory.
 */

export type UnsubscribeClaim = {
  readonly businessId: string;
  readonly channel: ContactChannel;
  readonly identity: string;
  /** The BUYER's language, carried because the page has no other way to know. */
  readonly locale: Locale;
};

const enc = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const dec = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

/**
 * G14 — signed with a key DERIVED from the installation's secret for this
 * purpose alone, rather than with the secret itself.
 *
 * The `unsubscribe:` prefix already makes one of these useless as a session
 * and a session useless here. This is the second half of the same idea: the
 * KEY differs too, so a leak of one — in a log, a backup, a support
 * transcript — is not a leak of the other. Derived inside both functions
 * below, so no caller can hold the wrong key.
 */
export const unsubscribeKey = (sessionSecret: string): string =>
  createHmac('sha256', sessionSecret).update('yf-unsubscribe-v1').digest('hex');

const mac = (sessionSecret: string, payload: string): string =>
  createHmac('sha256', unsubscribeKey(sessionSecret)).update(`unsubscribe:${payload}`).digest('base64url');

/** Constant-time, like every other comparison of a secret in this product. */
const same = (a: string, b: string): boolean => {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export function mintUnsubscribe(secret: string, claim: UnsubscribeClaim): string {
  const payload = enc(JSON.stringify([claim.businessId, claim.channel, claim.identity, claim.locale]));
  return `${payload}.${mac(secret, payload)}`;
}

/**
 * NULL IS THE ONLY FAILURE. A forged signature, a truncated link, a payload
 * that is not what we write — all resolve to nothing, and the route answers
 * every one of them the same way. A token that told a visitor WHICH part was
 * wrong would be a way to probe for valid ones.
 */
export function readUnsubscribe(secret: string, token: string): UnsubscribeClaim | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!same(token.slice(dot + 1), mac(secret, payload))) return null;

  try {
    const parsed: unknown = JSON.parse(dec(payload));
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [businessId, channel, identity, locale] = parsed as unknown[];
    if (typeof businessId !== 'string' || typeof identity !== 'string') return null;
    if (!CONTACT_CHANNELS.some((c) => c === channel)) return null;
    if (!LOCALES.some((l) => l === locale)) return null;
    if (!businessId || !identity) return null;
    return {
      businessId, identity,
      channel: channel as ContactChannel,
      locale: locale as Locale,
    };
  } catch {
    return null;
  }
}

/**
 * RFC 8058 — the headers that put "unsubscribe" in the mail client's own
 * furniture rather than in eight-point grey text at the bottom.
 *
 * THE ACTION IS A POST, AND THAT IS NOT A DETAIL. Mail providers, link
 * scanners and security proxies fetch every URL in a message before a human
 * sees it. A GET that unsubscribed would unsubscribe half her list on delivery,
 * silently, and the suppressions it wrote would be permanent.
 */
export function unsubscribeHeaders(url: string): Readonly<Record<string, string>> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
