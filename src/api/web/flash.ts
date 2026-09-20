/**
 * A1 + D5 — the one sentence a page says after she pressed something.
 *
 * WHAT IT USED TO BE. Every route that finished a POST redirected to
 * `?flash=<the rendered sentence>`, and the page printed whatever was in the
 * query. Three things were wrong with that, and this module fixes all three
 * with one change of transport:
 *
 *   SPOOFABLE.  `…/app/factory?flash=Your%20card%20was%20declined` is a link
 *               anyone can write, and the product renders it in its own voice.
 *               Nothing about the text said where it came from.
 *   STALE.      The sentence was translated by the route, in the locale of the
 *               request that POSTed. Switch language on the page that follows
 *               and the banner stays in the old one, because it was already
 *               words. What travels now is a KEY; the page that draws it
 *               translates it, so it is always in the language being read.
 *   WRITTEN DOWN. A full sentence in a URL is a full sentence in the access
 *               log, the browser history and any proxy in between — including
 *               ones naming a buyer or an e-mail address.
 *
 * So the sentence rides a signed, HttpOnly cookie for one request and the URL
 * goes back to being an address. Signed WITH ITS OWN PURPOSE, never the
 * session codec — the same rule `people.ts` states for the issued-code cookie:
 * that codec verifies any payload it signed, and reads a session with no
 * person as the OWNER, so one token must never be readable as the other.
 *
 * AND THE TONE (D5). One `.flash` class painted every notice in the jade of a
 * success, refusals included — "Only the owner may do that" arrived looking
 * like good news. A flash now carries whether it is a refusal, the banner
 * paints it accordingly, and a refusal is announced to a screen reader as an
 * alert rather than a passing status.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey, messages } from '../../core/owner/i18n/messages.js';
import { flashTone } from '../../core/owner/flashTone.js';
import { esc } from './layout.js';
import { t } from './say.js';

/** Good news, or a refusal. Nothing in between — two tones is a decision, not a palette. */
export type FlashTone = 'ok' | 'bad';

/** A notice as a PAGE receives it: already in the reader's language, and toned. */
export type Flash = { readonly text: string; readonly bad: boolean };

export const FLASH_COOKIE = 'yf_flash';
/**
 * Long enough to survive the redirect and a slow phone; short enough that a
 * tab left open overnight does not greet her with yesterday's confirmation.
 */
export const FLASH_TTL_MS = 60 * 1000;

const flashMac = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(`flash:${payload}`).digest('base64url');

const sameHash = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * One sentence of a notice: which sentence, and what it needs to say it.
 *
 * MOST NOTICES ARE ONE PART. A few are genuinely several — importing a page of
 * products can add some, change some, leave some alone and refuse some, and
 * says all four. That composition used to happen in the route, which is why
 * the finished sentence had to travel; keeping the parts lets the key travel
 * instead, and it is the page that joins them, in its own language.
 */
export type FlashPart = { readonly key: MessageKey; readonly params?: Record<string, string | number> };

/**
 * A notice on its way to the next page: which sentences and what they need.
 * Never the sentence itself, and never the tone — the tone belongs to the key
 * (`core/owner/flashTone.ts`) and is looked up when the page is drawn, so a
 * token minted before a sentence was reclassified cannot outlive the decision.
 */
export function mintFlash(
  secret: string, parts: readonly FlashPart[], now: number,
): string {
  const payload = Buffer.from(
    JSON.stringify([parts.map((p) => [p.key, p.params ?? null]), now + FLASH_TTL_MS]), 'utf8',
  ).toString('base64url');
  return `${payload}.${flashMac(secret, payload)}`;
}

/**
 * The notice, in the language of the page now being drawn — or null for
 * anything this installation did not mint a minute ago, which includes every
 * `?flash=` link a stranger can compose.
 */
export function readFlash(
  secret: string, token: string | undefined, locale: Locale, now: number,
): Flash | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!sameHash(token.slice(dot + 1), flashMac(secret, payload))) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [rawParts, exp] = parsed as unknown[];
    if (typeof exp !== 'number' || exp < now) return null;
    if (!Array.isArray(rawParts) || rawParts.length === 0) return null;
    const said: string[] = [];
    let bad = false;
    for (const part of rawParts) {
      if (!Array.isArray(part) || part.length !== 2) return null;
      const [key, params] = part as unknown[];
      // A key this build no longer has reads as nothing, not as the raw key: a
      // deploy that renames a message must not paint `inbox.flash.sent` across
      // a page. Nothing is shown at all rather than half a notice.
      if (typeof key !== 'string' || !(key in messages.en)) return null;
      const safe: Record<string, string | number> = {};
      if (params !== null && typeof params === 'object' && !Array.isArray(params)) {
        for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
          if (typeof v === 'string' || typeof v === 'number') safe[k] = v;
        }
      }
      said.push(t(locale, key as MessageKey, safe));
      // Several sentences, one banner: a refusal anywhere in it makes it one.
      if (flashTone(key as MessageKey) === 'bad') bad = true;
    }
    return { text: said.join(' '), bad };
  } catch { return null; }
}

/**
 * A notice for a page that is being rendered RIGHT NOW, with no redirect in
 * between — her words came back with the form, so there is no journey for a
 * cookie to survive. Same two tones, same one table.
 */
export const saidFlash = (
  locale: Locale, key: MessageKey, params?: Record<string, string | number>,
): Flash => ({ text: t(locale, key, params), bad: flashTone(key) === 'bad' });

/**
 * The banner itself, in one place — so a route cannot accidentally paint a
 * refusal green by forgetting a class, and so the role a screen reader hears
 * follows the tone rather than being copied `role="status"` twenty-seven times.
 */
export const flashBanner = (f: Flash | null): string =>
  f === null ? ''
    : `<div class="flash${f.bad ? ' bad' : ''}" role="${f.bad ? 'alert' : 'status'}">${esc(f.text)}</div>`;
