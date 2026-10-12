import { THROWAWAY_DOMAINS } from './throwawayDomains.js';

/**
 * Phase 1 (the owner's roadmap, 2026-10-13) — TRIAL-ABUSE SCORING. Open sign-up gives a stranger a workspace,
 * and the free trial is the thing worth taking twice. Every sign-up is scored on what it shares with the
 * workspaces signed up before it, and on how fast it comes:
 *
 *   low     a free trial, as the installation offers one
 *   medium  a card before the first channel, and no free trial
 *   high    refused — said plainly, with a way to reach a person (never a silent block)
 *
 * Pure: the route gathers the signals (each kept only as a one-way code, never raw), the database counts the
 * matches (`signup_marks`, 0148), and this decides. The thresholds are here, in one place, with the reason
 * each point is given.
 */

export type SignupTier = 'low' | 'medium' | 'high';

export type SignupReason =
  /** The sign-up cookie of a browser that already made a workspace. */
  | 'repeat_device'
  /** An address that is, once its dots and "+tag" are set aside, one an earlier workspace signed up with. */
  | 'repeat_email'
  /** The same browser fingerprint from the same network as an earlier workspace. */
  | 'repeat_fingerprint'
  /** The same network as earlier workspaces (an office or a mobile network shares one, so it weighs little). */
  | 'repeat_network'
  /** A throwaway mailbox (core/owner/throwawayDomains.ts). */
  | 'fresh_email'
  /** Many sign-up attempts from one network or one browser within a day. */
  | 'velocity';

/** What the database counted for this sign-up. Each "earlier" is a workspace signed up within the window (0148). */
export type SignupSignals = {
  readonly earlierFromDevice: number;
  readonly earlierWithEmail: number;
  readonly earlierFromFingerprintAndNetwork: number;
  readonly earlierFromNetwork: number;
  readonly throwawayEmail: boolean;
  /** Attempts in the last 24 hours, this one not counted. */
  readonly attemptsFromNetwork: number;
  readonly attemptsFromDevice: number;
};

export type SignupScore = { readonly tier: SignupTier; readonly points: number; readonly reasons: readonly SignupReason[] };

/** How long a workspace's sign-up marks count, and are kept: long enough to see a second trial taken months later. */
export const SIGNUP_MARK_DAYS = 180;
/** Points from which a sign-up asks for a card, and from which it is refused. */
export const MEDIUM_FROM = 2;
export const HIGH_FROM = 4;

export function scoreSignup(s: SignupSignals): SignupScore {
  const reasons: SignupReason[] = [];
  let points = 0;
  const add = (n: number, why: SignupReason) => { if (n > 0) { points += n; if (!reasons.includes(why)) reasons.push(why); } };
  // A browser or an address that already has a workspace: that is the second trial itself. Either alone refuses.
  add(s.earlierFromDevice > 0 ? 4 : 0, 'repeat_device');
  add(s.earlierWithEmail > 0 ? 4 : 0, 'repeat_email');
  // The same fingerprint on the same network: likely the same person with the cookie cleared — or a colleague on
  // the same browser in the same office. With the network's own point, a card; with anything more, refused.
  add(s.earlierFromFingerprintAndNetwork > 0 ? 2 : 0, 'repeat_fingerprint');
  // The same network alone: an office, a café or a mobile network is shared by strangers. A little, and more
  // only when several workspaces came from it.
  add(s.earlierFromNetwork >= 3 ? 2 : s.earlierFromNetwork > 0 ? 1 : 0, 'repeat_network');
  // A throwaway mailbox: alone, a card.
  add(s.throwawayEmail ? 2 : 0, 'fresh_email');
  // Speed: a script, or someone trying address after address.
  add(s.attemptsFromNetwork >= 10 ? 3 : s.attemptsFromNetwork >= 6 ? 2 : s.attemptsFromNetwork >= 3 ? 1 : 0, 'velocity');
  add(s.attemptsFromDevice >= 3 ? 2 : 0, 'velocity');
  const tier: SignupTier = points >= HIGH_FROM ? 'high' : points >= MEDIUM_FROM ? 'medium' : 'low';
  return { tier, points, reasons };
}

/**
 * The address as a mailbox, not as typed: lower case, a "+tag" set aside (most providers deliver
 * `name+anything@` to `name@`), and Gmail's dots, which Gmail ignores. Used only to compare, as a one-way code.
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** A throwaway mailbox's address: its domain, or a subdomain of one, is on the list. */
export function isThrowawayEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const parts = email.slice(at + 1).trim().toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) if (THROWAWAY_DOMAINS.has(parts.slice(i).join('.'))) return true;
  return false;
}

/**
 * The network a caller's address belongs to: an IPv4 address's first three parts (a /24), an IPv6 address's first
 * three groups (a /48, what one site is usually given). The whole address would miss the same person moving
 * between neighbouring addresses; the network is what is compared. Null for anything that is not an address.
 */
export function networkOf(ip: string): string | null {
  const raw = ip.trim().toLowerCase().replace(/^::ffff:/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(raw);
  if (v4) return v4.slice(1, 5).every((p) => Number(p) <= 255) ? `${v4[1]}.${v4[2]}.${v4[3]}.0/24` : null;
  if (!/^[0-9a-f:]+$/.test(raw) || !raw.includes(':')) return null;
  const [head = '', tail = ''] = raw.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((g) => g.length > 4)) return null;
  return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/48`;
}

/**
 * THE BROWSER FINGERPRINT: what every browser sends with every request — what it is and which version, its
 * languages, its platform. No script runs for it and nothing is stored on the device. Alone it is shared by many
 * people; with the same network it points at one browser. Kept only as a one-way code.
 */
export function fingerprintSource(headers: Readonly<Record<string, string | string[] | undefined>>): string {
  const h = (name: string): string => {
    const v = headers[name];
    return (Array.isArray(v) ? v.join(',') : v ?? '').trim().slice(0, 300);
  };
  return ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile']
    .map((n) => `${n}=${h(n)}`).join('\n');
}
