import type { MessageKey } from '../../core/owner/i18n/messages.js';

/**
 * D7 (the owner's decision, 2026-10-07) — WHAT A BROWSER MAY BE ASKED TO FETCH
 * FROM ANYONE BUT NOMI, AND EVERY COOKIE NOMI SETS. One module, one list each.
 *
 * "No banner while every cookie is strictly necessary. Widen the gate to every
 * third-party request the browser makes (fonts, scripts, stylesheets, images,
 * frames, beacons from hosts Nomi doesn't serve). Keep one allow-list with a
 * reason for each entry; a test fails on anything off the list."
 *
 * A request to another host tells that host who is reading which page, from
 * where, and when, whether or not it sets a cookie. So the rule is about
 * requests, not cookies: a page Nomi draws loads its fonts, its stylesheets,
 * its script and its pictures from Nomi, and from nobody else unless this list
 * names the host, the page and the reason. What a person CHOOSES to open (a
 * link, a form they send) is a navigation, not a request the page makes, and
 * is not on this list.
 *
 * What holds it:
 *   · tests/parity/third-party-gate.test.ts renders the pages and reads every
 *     stylesheet and script Nomi serves, and fails on a request to a host this
 *     list does not name for that page; it also reads every cookie the code
 *     sets and fails on one this registry does not list;
 *   · tests/integration/surface-walk.test.ts does the same on every page there
 *     is, on real rows, and checks every cookie a response actually sets;
 *   · the sign-up page draws the bot check's script only where `mayLoad` says
 *     it may (layout.ts `signupPage`).
 *
 * An optional cookie or an optional request (analytics, an advertiser, a
 * third-party font) needs a recorded "yes" from a consent banner before it.
 * There is no banner because there is nothing optional: the first optional
 * entry on either list comes with the banner, and this gate makes sure it does.
 */

/** A host outside Nomi that a page may load something from, and why. */
export type ThirdPartyHost = {
  /** The host, exactly, or `*.` and a domain for any host under it (not the domain itself). */
  readonly host: string;
  /** What the browser loads from it. */
  readonly loads: string;
  /** The only paths whose pages may load it. */
  readonly where: readonly string[];
  /** Why Nomi lets a stranger's browser talk to this host at all. */
  readonly reason: string;
};

/**
 * THE ALLOW-LIST. Today only the sign-up bot check (botCheck.ts), and only
 * when the operator configures one: its script, and the frames, images and
 * checks that script opens, on the sign-up page alone. The hosts are the ones
 * each provider's own documentation tells a site to allow (Cloudflare's
 * "Turnstile: Content Security Policy"; hCaptcha's "Content Security Policy
 * settings"). The provider may set its own cookie inside its frame; the
 * privacy page's cookie section says so (`legal.privacy.cookies.botCheck`).
 */
export const THIRD_PARTY_HOSTS: readonly ThirdPartyHost[] = [
  {
    host: 'challenges.cloudflare.com',
    loads: 'Cloudflare Turnstile: its script, and the frame it draws the check in',
    where: ['/signup'],
    reason: 'Security for sign-up: every sign-up e-mails a code to the address typed, so a script that could post the form could make Nomi mail anyone (BOT, decision 36).',
  },
  {
    host: 'js.hcaptcha.com',
    loads: 'hCaptcha: its script',
    where: ['/signup'],
    reason: 'Security for sign-up, as above, when the operator chose hCaptcha.',
  },
  {
    host: 'hcaptcha.com',
    loads: 'hCaptcha: the checks its script makes',
    where: ['/signup'],
    reason: 'Security for sign-up, as above: hCaptcha asks a site to allow its own domain beside its subdomains.',
  },
  {
    host: '*.hcaptcha.com',
    loads: 'hCaptcha: the frames, pictures and checks its script opens (newassets., imgs., api.)',
    where: ['/signup'],
    reason: 'Security for sign-up, as above: the challenge is drawn in frames served from hCaptcha\'s subdomains.',
  },
];

/** Whether `host` is the entry's host (or, for `*.domain`, a host under it). */
const matches = (entry: string, host: string): boolean =>
  entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry;

/**
 * May a page at `path` make the browser load `url`? Nomi's own addresses
 * (a path from the root, never `//`) always; another host only where the
 * allow-list names it for that path. Anything else is no.
 */
export function mayLoad(url: string, path: string): boolean {
  if (/^\/(?![/\\])/.test(url)) return true;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return THIRD_PARTY_HOSTS.some((e) => e.where.includes(path) && matches(e.host, host));
}

/**
 * THE COOKIE REGISTRY. Every cookie Nomi's code sets, with what it is for, how
 * long it lasts, and why it is strictly necessary. All first-party, all
 * `necessary`: there is no other class today, and the type says so, so an
 * optional one cannot be added here without changing it (and bringing the
 * consent banner it needs).
 *
 * The privacy page's cookie table is drawn from this list (legal.ts), so the
 * page and the code cannot say different things. The lifetimes are the ones
 * the code writes — `third-party-gate.test.ts` reads every `Max-Age` the code
 * sets and compares — and the names are every name the code writes.
 */
export type NomiCookie = {
  readonly name: string;
  /** What it is for, as the privacy page says it (`legal.privacy.cookies.for.*`). */
  readonly purpose: MessageKey;
  /** How long the browser keeps it, in seconds, as the code sets it. */
  readonly lifetimeSec: number;
  readonly class: 'necessary';
  /** Why the app cannot work without it. */
  readonly reason: string;
};

export const COOKIES: readonly NomiCookie[] = [
  {
    name: 'yf_session', purpose: 'legal.privacy.cookies.for.session', lifetimeSec: 7 * 24 * 3600, class: 'necessary',
    reason: 'The signed sign-in itself (session.ts, SESSION_TTL_MS): without it nobody stays signed in past one page.',
  },
  {
    name: 'yf_locale', purpose: 'legal.privacy.cookies.for.locale', lifetimeSec: 365 * 24 * 3600, class: 'necessary',
    reason: 'The language chosen before signing in (the switcher\'s /locale): a preference the person set, kept so every page answers in it.',
  },
  {
    name: 'yf_flash', purpose: 'legal.privacy.cookies.for.flash', lifetimeSec: 60, class: 'necessary',
    reason: 'The one notice after a form is sent, signed and read once (flash.ts): the page that follows says what happened.',
  },
  {
    name: 'yf_otp', purpose: 'legal.privacy.cookies.for.otp', lifetimeSec: 30 * 60, class: 'necessary',
    reason: 'Which sign-in a code being typed belongs to (security/otp.ts PENDING_TTL_MS): the second step of signing in.',
  },
  {
    name: 'yf_dev', purpose: 'legal.privacy.cookies.for.device', lifetimeSec: 180 * 24 * 3600, class: 'necessary',
    reason: 'A browser the person confirmed with a code (security/otp.ts DEVICE_TTL_MS): security, so a known device is not asked again.',
  },
  {
    name: 'yf_setlink', purpose: 'legal.privacy.cookies.for.setlink', lifetimeSec: 3600, class: 'necessary',
    reason: 'The one-time link to choose a password, moved out of the address bar while it is used (0078).',
  },
  {
    name: 'yf_issued', purpose: 'legal.privacy.cookies.for.issued', lifetimeSec: 5 * 60, class: 'necessary',
    reason: 'A team member\'s access code, shown to the owner once right after it is made (people.ts ISSUED_TTL_MS).',
  },
  {
    name: 'yf_oauth', purpose: 'legal.privacy.cookies.for.connect', lifetimeSec: 10 * 60, class: 'necessary',
    reason: 'The state of a mailbox connection in progress (Google or Microsoft), checked when the provider sends the person back.',
  },
  {
    name: 'yf_meta', purpose: 'legal.privacy.cookies.for.connect', lifetimeSec: 10 * 60, class: 'necessary',
    reason: 'The state of an Instagram or Messenger connection in progress, checked when Meta sends the person back.',
  },
  {
    name: 'yf_wa', purpose: 'legal.privacy.cookies.for.connect', lifetimeSec: 10 * 60, class: 'necessary',
    reason: 'The state of a WhatsApp number connection in progress, checked when Meta sends the person back.',
  },
];
