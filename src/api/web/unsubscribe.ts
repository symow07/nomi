import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { readUnsubscribe, type UnsubscribeClaim } from '../../outbound/unsubscribe.js';
import { suppress } from '../../db/contacts.js';
import { t } from '../../core/owner/i18n/messages.js';
import { dirOf, type Locale } from '../../core/owner/i18n/locale.js';
import { cssVariables } from '../../core/owner/css.js';
import { esc } from './layout.js';

/**
 * M40.2 — the second buyer-facing surface this product has, after M35's proof
 * link, and it is built to the same rules.
 *
 *   404 NEVER 403. A bad token, a forged signature, a business that no longer
 *     exists — every failure is "not found". A page that distinguished them
 *     would be a way to probe for valid links.
 *   IT NAMES NOBODY. Not the factory, not the buyer, not what he was sent. He
 *     arrived here to leave; the page's whole job is to let him, quickly.
 *   NO SCRIPT, NO STYLESHEET, NO FONT. It renders in a mail client's browser
 *     on a phone in an airport.
 */

const SHELL = (locale: Locale, title: string, body: string): string => `<!doctype html>
<html lang="${esc(locale)}" dir="${esc(dirOf(locale))}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
${cssVariables()}
/*
 * THE SAME TOKENS as the owner's app and the proof page, emitted into a
 * standalone document. A second hand-rolled palette here would drift from the
 * first the week after it shipped — shell.test.ts and m49-layout.test.ts caught
 * exactly that on this file, correctly, and the proof page carries the same
 * comment for the same reason.
 */
  * { box-sizing:border-box; }
  body { margin:0; background:var(--color-paper); color:var(--color-ink);
         font: var(--font-size-base)/var(--line-height) var(--font-family);
         -webkit-text-size-adjust:100%; }
  main { max-width:var(--measure-prose); margin:0 auto;
         padding:var(--space-48) var(--space-16); }
  h1 { font-size:var(--font-size-title); line-height:1.25; margin:0 0 var(--space-12);
       font-weight:600; }
  p { margin:0 0 var(--space-24); color:var(--color-ink-secondary); }
  button { font:inherit; padding:var(--space-12) var(--space-24); border:0;
           border-radius:var(--radius-card); background:var(--color-jade);
           color:var(--color-surface); cursor:pointer; }
</style>
</head><body><main>${body}</main></body></html>`;

export function renderUnsubscribe(claim: UnsubscribeClaim, token: string): string {
  const l = claim.locale;
  return SHELL(l, t(l, 'unsub.title'), `
    <h1>${esc(t(l, 'unsub.title'))}</h1>
    <p>${esc(t(l, 'unsub.body'))}</p>
    <form method="post" action="/u?t=${encodeURIComponent(token)}">
      <button type="submit">${esc(t(l, 'unsub.button'))}</button>
    </form>`);
}

export function renderUnsubscribed(locale: Locale): string {
  return SHELL(locale, t(locale, 'unsub.done.title'), `
    <h1>${esc(t(locale, 'unsub.done.title'))}</h1>
    <p>${esc(t(locale, 'unsub.done.body'))}</p>`);
}

/**
 * Write the suppression.
 *
 * IDEMPOTENT AND UNCONDITIONAL. It does not check whether he is already
 * suppressed, whether a contact row exists, or whether he ever consented —
 * `suppress` is `on conflict do nothing`, and a person asking to be left alone
 * must never meet a branch that could decide not to record it.
 */
export async function applyUnsubscribe(db: Db, claim: UnsubscribeClaim): Promise<boolean> {
  const bid = parseBusinessId(claim.businessId);
  if (!bid.ok) return false;
  try {
    await withTenantTx(db, bid.value, (tx) => suppress(tx, bid.value, {
      channel: claim.channel, identity: claim.identity,
      reason: 'unsubscribed', detail: 'link',
    }));
    return true;
  } catch {
    // A business that no longer exists, or a database that is down. He is told
    // nothing either way: the page cannot be a probe for which tenants exist.
    return false;
  }
}

export const claimFrom = (secret: string, token: string): UnsubscribeClaim | null =>
  token.length > 16 ? readUnsubscribe(secret, token) : null;
