import { createHash } from 'node:crypto';
import { t } from './say.js';
import { TERMS_KEYS } from '../../core/legal/terms.js';
import { processorLabel, type Processor } from '../../core/legal/processors.js';
import { dirOf, type Locale } from '../../core/owner/i18n/locale.js';
import { cssVariables } from '../../core/owner/css.js';
import { publicDocument, esc } from './layout.js';

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

const SHELL = (locale: Locale, title: string, body: string): string =>
  publicDocument({ locale, title: `${title} · Nomi`, body });

const contact = (l: Locale, email: string | null): string => `
  <h2>${esc(t(l, 'legal.contact.title'))}</h2>
  ${email ? `<p>${esc(t(l, 'legal.contact.write'))} <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : ''}
  <p>${esc(t(l, 'legal.contact.same'))}</p>`;

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

export function renderPrivacy(l: Locale, email: string | null, facts: LegalFacts): string {
  const section = (title: string, body: string): string =>
    `<h2>${esc(t(l, title as Parameters<typeof t>[1]))}</h2><p>${esc(t(l, body as Parameters<typeof t>[1]))}</p>`;
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
    ${section('legal.privacy.howLong.title', 'legal.privacy.howLong.body')}
    ${section('legal.privacy.choices.title', 'legal.privacy.choices.body')}
    <p><a href="/data-deletion">${esc(t(l, 'legal.privacy.deletionLink'))}</a> · <a href="/terms">${esc(t(l, 'legal.termsLink'))}</a></p>
    ${contact(l, email)}
    ${updated(l, 'legal.updated.privacy')}`);
}

/**
 * The terms — for the BUSINESS that uses this product, which is who Meta's
 * "Terms of Service URL" is about. The people who write in are covered by the
 * privacy page, and the first paragraph says so.
 */
export function renderLegalTerms(l: Locale, email: string | null): string {
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
    ${contact(l, email)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a></p>
    ${updated(l, 'legal.updated.terms')}`);
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
export function renderDataDeletion(l: Locale, email: string | null): string {
  const k = (key: string) => esc(t(l, key as Parameters<typeof t>[1]));
  const list = (keys: readonly string[]) => keys.map((x) => `<li>${k(x)}</li>`).join('');
  return SHELL(l, t(l, 'legal.deletion.title'), `
    <h1>${k('legal.deletion.title')}</h1>
    <p>${k('legal.deletion.intro')}</p>
    <h2>${k('legal.deletion.how.title')}</h2>
    <ol>
      <li>${k('legal.deletion.step1')}${email ? `<br>${k('legal.deletion.viaUs')}` : ''}</li>
      ${list(['legal.deletion.step2', 'legal.deletion.step3', 'legal.deletion.step4'])}
    </ol>
    <h2>${k('legal.deletion.erased.title')}</h2>
    <ul>${list([
      'legal.deletion.erased.identity', 'legal.deletion.erased.messages', 'legal.deletion.erased.prepared',
      'legal.deletion.erased.notes', 'legal.deletion.erased.conversations',
    ])}</ul>
    <h2>${k('legal.deletion.kept.title')}</h2>
    <ul>${list([
      'legal.deletion.kept.orders', 'legal.deletion.kept.doNotContact', 'legal.deletion.kept.record',
      'legal.deletion.kept.meta', 'legal.deletion.kept.elsewhere', 'legal.deletion.kept.backups',
    ])}</ul>
    ${contact(l, email)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a> · <a href="/terms">${k('legal.termsLink')}</a></p>
    ${updated(l, 'legal.updated.privacy')}`);
}
