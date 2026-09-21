import { t } from './say.js';
import { processorLabel, type Processor } from '../../core/legal/processors.js';
import { dirOf, type Locale } from '../../core/owner/i18n/locale.js';
import { cssVariables } from '../../core/owner/css.js';
import { esc } from './layout.js';

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

const SHELL = (locale: Locale, title: string, body: string): string => `<!doctype html>
<html lang="${esc(locale)}" dir="${esc(dirOf(locale))}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Nomi</title>
<style>
${cssVariables()}
/*
 * THE SAME TOKENS as the owner's app, the proof page and the unsubscribe page,
 * emitted into a standalone document, for the reason those two give.
 */
  * { box-sizing:border-box; }
  body { margin:0; background:var(--color-paper); color:var(--color-ink);
         font: var(--font-size-base)/var(--line-height) var(--font-family);
         -webkit-text-size-adjust:100%; }
  main { max-width:var(--measure-prose); margin:0 auto;
         padding:var(--space-48) var(--space-16); }
  h1 { font-size:var(--font-size-title); line-height:1.25; margin:0 0 var(--space-12);
       font-weight:600; }
  h2 { font-size:inherit; font-weight:600; margin:var(--space-32) 0 var(--space-8); }
  p, li { margin:0 0 var(--space-12); color:var(--color-ink-secondary); }
  ul, ol { margin:0 0 var(--space-12); padding-inline-start:var(--space-24); }
  a { color:var(--color-ink); }
  .updated { margin-top:var(--space-48); }
</style>
</head><body><main>${body}</main></body></html>`;

const contact = (l: Locale, email: string | null): string => `
  <h2>${esc(t(l, 'legal.contact.title'))}</h2>
  ${email ? `<p>${esc(t(l, 'legal.contact.write'))} <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : ''}
  <p>${esc(t(l, 'legal.contact.same'))}</p>`;

const updated = (l: Locale): string => `<p class="updated">${esc(t(l, 'legal.updated'))}</p>`;

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
    <!-- Who a buyer is actually talking to. High on the page rather than
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
    ${updated(l)}`);
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
    <h2>${k('legal.terms.ours.title')}</h2>
    ${list(['legal.terms.ours.we1', 'legal.terms.ours.we2', 'legal.terms.ours.we3', 'legal.terms.ours.we4'])}
    <h2>${k('legal.terms.fees.title')}</h2><p>${k('legal.terms.fees.body')}</p>
    <h2>${k('legal.terms.liability.title')}</h2><p>${k('legal.terms.liability.body')}</p>
    <h2>${k('legal.terms.changes.title')}</h2><p>${k('legal.terms.changes.body')}</p>
    ${contact(l, email)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a></p>
    ${updated(l)}`);
}

export function renderDataDeletion(l: Locale, email: string | null): string {
  return SHELL(l, t(l, 'legal.deletion.title'), `
    <h1>${esc(t(l, 'legal.deletion.title'))}</h1>
    <p>${esc(t(l, 'legal.deletion.intro'))}</p>
    <ol>
      <li>${esc(t(l, 'legal.deletion.step1'))}</li>
      <li>${esc(t(l, 'legal.deletion.step2'))}</li>
      <li>${esc(t(l, 'legal.deletion.step3'))}</li>
    </ol>
    <p>${esc(t(l, 'legal.deletion.revoked'))}</p>
    ${contact(l, email)}
    <p><a href="/privacy">${esc(t(l, 'legal.privacyLink'))}</a> · <a href="/terms">${esc(t(l, 'legal.termsLink'))}</a></p>
    ${updated(l)}`);
}
