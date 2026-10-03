import { createHash } from 'node:crypto';
import { t } from './say.js';
import { TERMS_KEYS } from '../../core/legal/terms.js';
import { processorLabel, type Processor } from '../../core/legal/processors.js';
import { dirOf, type Locale } from '../../core/owner/i18n/locale.js';
import { cssVariables } from '../../core/owner/css.js';
import { publicDocument, esc, publicTop, PUBLIC_TOP_CSS } from './layout.js';

/** G1 — the version of the terms a sign-up agrees to: their English words, digested (src/core/legal/terms.ts). */
export const TERMS_VERSION: string = createHash('sha256')
  .update(TERMS_KEYS.map((k) => t('en', k)).join('\n'))
  .digest('hex').slice(0, 12);

/**
 * The two pages a stranger may read without writing to anyone: what is kept
 * about the people who write to a business through this product, and how they
 * have it removed.
 *
 * Meta reads both before an app may leave development mode — Instagram
 * messages are delivered only to a published app — and a buyer may follow them
 * from a Page. They are built to the unsubscribe page's rules (no script, no
 * stylesheet, no font; the same tokens as everything else) with one
 * difference: they are INDEXABLE. A privacy page nobody can find is not one.
 *
 * The contact address is the installation's (`LEGAL_CONTACT_EMAIL`). Absent,
 * the page does not go blank where an address should be: it says to write to
 * the business from the account you used, which is always true here and is
 * the way most people will ask anyway.
 *
 * What these pages promise, `docs/LEGAL.md` says how the operator keeps.
 */

/**
 * Phase 9 (V1-058, V1-066, V1-073) — each page opens like the site: the mark
 * and the name, leading to the site (`home`), and the language switch, which
 * returns to the same page (`path`).
 */
const SHELL = (locale: Locale, title: string, body: string, home: string, path: string): string =>
  publicDocument({ locale, title: `${title} · Nomi`, body: `${publicTop(locale, home, path)}${body}`, extraCss: PUBLIC_TOP_CSS });

/** A sentence from the catalogue with one placeholder made a link — the rest escaped. */
const withLink = (l: Locale, key: string, param: string, href: string, label: string): string =>
  esc(t(l, key as Parameters<typeof t>[1], { [param]: '\u0000' })).replace('\u0000', `<a href="${esc(href)}">${esc(label)}</a>`);

/**
 * How to reach us. The address, with the language's own full stop (V1-062).
 * `business`: the line for a person who wrote to a business — the privacy page's
 * (V1-059); the deletion page's only where there is no address, since its first
 * step already says it (public-missed-22); never the terms', which are the
 * business's own (V1-064). A page with neither has no section at all.
 */
const contact = (l: Locale, email: string | null, business: boolean): string => {
  const write = email ? `<p>${withLink(l, 'legal.contact.write', 'email', `mailto:${email}`, email)}</p>` : '';
  const ask = business ? `<p>${esc(t(l, 'legal.contact.same'))}</p>` : '';
  return write || ask ? `
  <h2>${esc(t(l, 'legal.contact.title'))}</h2>
  ${write}
  ${ask}` : '';
};

/**
 * When the page last changed. The terms keep their own date: a date that moved
 * with no change to the terms would read as a change to them. The privacy and
 * deletion pages changed together (CC-02a) and share theirs.
 */
const updated = (l: Locale, key: 'legal.updated' | 'legal.updated.privacy' | 'legal.updated.terms' = 'legal.updated'): string =>
  `<p class="updated">${esc(t(l, key))}</p>`;

/**
 * Everything the legal pages must state about where a buyer's words go. Passed
 * in, never written down here: the privacy page named a processor this
 * installation had stopped using, and said "Nobody else" underneath it.
 */
export type LegalFacts = { readonly processor: Processor; readonly hosting: Processor };

export function renderPrivacy(l: Locale, email: string | null, facts: LegalFacts, home = '/site'): string {
  const section = (title: string, body: string): string =>
    `<h2>${esc(t(l, title as Parameters<typeof t>[1]))}</h2><p>${esc(t(l, body as Parameters<typeof t>[1]))}</p>`;
  // public-missed-15 — the deletion page by its own name, and a link wherever it is named.
  const toDeletion = (title: string, body: string): string =>
    `<h2>${esc(t(l, title as Parameters<typeof t>[1]))}</h2><p>${withLink(l, body, 'deletion', '/data-deletion', t(l, 'legal.deletion.title'))}</p>`;
  return SHELL(l, t(l, 'legal.privacy.title'), `
    <h1>${esc(t(l, 'legal.privacy.title'))}</h1>
    <p>${esc(t(l, 'legal.privacy.intro'))}</p>
    <!-- Who the person writing in is actually talking to. High on the page rather than
         buried in the processor list below, because it is the first thing a
         person wants to know and the last thing they should have to hunt
         for. It says "may be sent without a person reviewing them" because
         whether they are is the business's own autonomy setting — stating it
         as always or never would be wrong for half the businesses here. -->
    <p>${esc(t(l, 'legal.privacy.ai'))}</p>
    ${section('legal.privacy.kept.title', 'legal.privacy.kept.body')}
    ${/* w4-public-01 — since 0123 an Instagram or Messenger customer's profile photo is kept
         (client_faces, src/worker/faces.ts): its own line, so the list above stays the owner's words. */ ''}
    <p>${esc(t(l, 'legal.privacy.kept.photo'))}</p>
    ${section('legal.privacy.why.title', 'legal.privacy.why.body')}
    <h2>${esc(t(l, 'legal.privacy.who.title'))}</h2>
    <p>${esc(t(l, 'legal.privacy.who.body'))}</p>
    <ul>
      <li>${esc(t(l, 'legal.privacy.who.meta'))}</li>
      <li>${esc(t(l, 'legal.privacy.who.ai', { processor: processorLabel(facts.processor, l) }))}</li>
      <li>${esc(t(l, 'legal.privacy.who.hosting', { hosting: processorLabel(facts.hosting, l) }))}</li>
      <li>${esc(t(l, 'legal.privacy.who.mail'))}</li>
    </ul>
    <p>${esc(t(l, 'legal.privacy.who.nobody'))}</p>
    ${toDeletion('legal.privacy.howLong.title', 'legal.privacy.howLong.body')}
    ${toDeletion('legal.privacy.choices.title', 'legal.privacy.choices.body')}
    <p><a href="/data-deletion">${esc(t(l, 'legal.deletion.title'))}</a> · <a href="/terms">${esc(t(l, 'legal.termsLink'))}</a></p>
    ${contact(l, email, true)}
    ${updated(l, 'legal.updated.privacy')}`, home, '/privacy');
}

/**
 * The terms — for the BUSINESS that uses this product, which is who Meta's
 * "Terms of Service URL" is about. The people who write in are covered by the
 * privacy page, and the first paragraph says so.
 */
export function renderLegalTerms(l: Locale, email: string | null, home = '/site'): string {
  const k = (key: string) => esc(t(l, key as Parameters<typeof t>[1]));
  const list = (keys: readonly string[]) => `<ul>${keys.map((x) => `<li>${k(x)}</li>`).join('')}</ul>`;
  return SHELL(l, t(l, 'legal.terms.title'), `
    <h1>${k('legal.terms.title')}</h1>
    <p>${k('legal.terms.intro')}</p>
    <h2>${k('legal.terms.service.title')}</h2><p>${k('legal.terms.service.body')}</p>
    <h2>${k('legal.terms.yours.title')}</h2>
    ${list(['legal.terms.yours.you1', 'legal.terms.yours.you2', 'legal.terms.yours.you3'])}
    <h2>${k('legal.terms.use.title')}</h2>
    ${list(['legal.terms.use.use1', 'legal.terms.use.use2', 'legal.terms.use.use3', 'legal.terms.use.use4'])}
    <p>${k('legal.terms.use.after')}</p>
    <h2>${k('legal.terms.ours.title')}</h2>
    ${list(['legal.terms.ours.we1', 'legal.terms.ours.we2', 'legal.terms.ours.we3', 'legal.terms.ours.we4'])}
    <h2>${k('legal.terms.fees.title')}</h2><p>${k('legal.terms.fees.body')}</p>
    <h2>${k('legal.terms.liability.title')}</h2><p>${k('legal.terms.liability.body')}</p>
    <h2>${k('legal.terms.changes.title')}</h2><p>${k('legal.terms.changes.body')}</p>
    ${contact(l, email, false)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a></p>
    ${updated(l, 'legal.updated.terms')}`, home, '/terms');
}

/**
 * CC-02a — what actually happens when a buyer asks, and nothing more.
 *
 * The page used to promise that "a person at the business" removes the
 * records by hand within 30 days and tells the buyer "on the same channel".
 * None of it was true: the business could not record the request, nothing
 * counted the days, and nothing told anyone. Every sentence here now names a
 * step the product or its operator performs:
 *
 *   HOW — the buyer asks the business (or writes to the legal address, and
 *   the operator passes it on); the business records it on the buyer's page
 *   (`askBuyerDeletion`); Nomi's operator carries it out by hand within 30
 *   days of that (docs/DATA-DELETION-RUNBOOK.md), told a week ahead by the
 *   daily check (`deletionDueAlert`); the business then sees it marked done
 *   and can tell the buyer. Nothing writes to the buyer by itself, and the
 *   page says so rather than leaving it to be assumed.
 *
 *   WHAT IS DELETED and WHAT IS KEPT — the operator's contract, item by item,
 *   including the copies no deletion inside Nomi reaches (Meta's, the
 *   business's own mailbox, the service's backups).
 *
 * tests/parity/deletion-page.test.ts holds every one of these in all three
 * languages, and holds the old promises out.
 */
export function renderDataDeletion(l: Locale, email: string | null, home = '/site'): string {
  const k = (key: string) => esc(t(l, key as Parameters<typeof t>[1]));
  const list = (keys: readonly string[]) => keys.map((x) => `<li>${k(x)}</li>`).join('');
  return SHELL(l, t(l, 'legal.deletion.title'), `
    <h1>${k('legal.deletion.title')}</h1>
    <p>${k('legal.deletion.intro')}</p>
    <h2>${k('legal.deletion.how.title')}</h2>
    <ol>
      <li>${k('legal.deletion.step1')}</li>
      ${list(['legal.deletion.step2', 'legal.deletion.step3', 'legal.deletion.step4'])}
    </ol>
    ${/* V1-071 — the other way to ask is its own sentence, not a second route inside step 1. */
      email ? `<p>${k('legal.deletion.viaUs')}</p>` : ''}
    <h2>${k('legal.deletion.erased.title')}</h2>
    <ul>${list([
      // w4-public-02 — the photo, which the operator's buyer erasure erases (`client_faces: { do: 'erase' }`).
      'legal.deletion.erased.identity', 'legal.deletion.erased.photo', 'legal.deletion.erased.messages', 'legal.deletion.erased.prepared',
      'legal.deletion.erased.notes', 'legal.deletion.erased.conversations',
    ])}</ul>
    <h2>${k('legal.deletion.kept.title')}</h2>
    <ul>${list([
      'legal.deletion.kept.orders', 'legal.deletion.kept.doNotContact', 'legal.deletion.kept.record',
      'legal.deletion.kept.meta', 'legal.deletion.kept.elsewhere', 'legal.deletion.kept.backups',
    ])}</ul>
    ${contact(l, email, !email)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a> · <a href="/terms">${k('legal.termsLink')}</a></p>
    ${updated(l, 'legal.updated.privacy')}`, home, '/data-deletion');
}
