import { createHash } from 'node:crypto';
import { t } from './say.js';
import { TERMS_KEYS } from '../../core/legal/terms.js';
import { processorLabel, providerLineKey, type Processor } from '../../core/legal/processors.js';
import { formatLifetime } from '../../core/owner/i18n/format.js';
import { COOKIES } from './thirdParty.js';
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
const SHELL = (locale: Locale, title: string, body: string, home: string, path: string, css: string = PUBLIC_TOP_CSS): string =>
  publicDocument({ locale, title: `${title} · Nomi`, body: `${publicTop(locale, home, path)}${body}`, extraCss: css });

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
 * When the page last changed. Each page keeps its own date: a date that moved
 * with no change to a page would read as a change to it. The privacy and
 * deletion pages changed together until the advisor's history (2026-10-07),
 * which changed the privacy page and the terms and left the deletion page as
 * it was.
 */
const updated = (l: Locale, key: 'legal.updated' | 'legal.updated.privacy' | 'legal.updated.terms' | 'legal.updated.deletion' = 'legal.updated'): string =>
  `<p class="updated">${esc(t(l, key))}</p>`;

/**
 * Everything the legal pages must state about where a buyer's words go. Passed
 * in, never written down here: the privacy page named a processor this
 * installation had stopped using, and said "Nobody else" underneath it.
 *
 * The advisor's history (2026-10-07, docs/ADVISOR-MEMORY.md §9) adds three,
 * each optional so a composition that does not know them yet says the safe thing:
 *   transcriber     the speech-to-text service, named in the "who" list only
 *                   when one is configured (`transcriberProcessor`); absent or
 *                   null, none is named, because none runs;
 *   botCheck        the sign-up bot check (BOT_CHECK_WIDGET's name), named in
 *                   the "who" list and the cookie section only when configured;
 *   advisorHistory  whether this installation can keep advisor conversations.
 *                   ABSENT MEANS YES: the page then describes the history. A
 *                   page that describes a keeping that may not happen is a
 *                   smaller wrong than keeping something the page does not
 *                   describe, and nothing may be kept before the page says so.
 *                   `false` (no working ADVISOR_KEY: nothing is kept) leaves the
 *                   advisor's line as it was and draws no history section.
 */
export type LegalFacts = {
  readonly processor: Processor;
  readonly hosting: Processor;
  readonly transcriber?: Processor | null;
  readonly botCheck?: Processor | null;
  readonly advisorHistory?: boolean;
};

/**
 * §9.3 — the sentence that names where an advisor question goes, with the line
 * that says what that provider keeps. This batch has ONE provider (`LLM_*`), so
 * `{processors}` is that one, named as the "who" list names it.
 *
 * A provider this build has no line for (Anthropic until its terms are checked,
 * or a host it cannot name) gets none: the sentence is said up to its own end
 * and stops there, with the language's full stop where the colon was, so it
 * neither ends on a dangling colon nor claims anything about what that provider
 * keeps. Every locale's sentence ends in a colon and `{providerLines}`, which
 * privacy-advisor-cookies.test.ts holds, so the cut is always the same cut.
 */
function advisorProviders(l: Locale, p: Processor): string {
  const processors = processorLabel(p, l);
  const line = providerLineKey(p);
  if (line) return t(l, 'legal.privacy.advisor.providers', { processors, providerLines: t(l, line, { provider: p.name }) });
  const said = t(l, 'legal.privacy.advisor.providers', { processors, providerLines: '\u0000' });
  return said.replace(/\s*[:：]\s*\u0000$/u, l === 'zh' ? '。' : '.').replace('\u0000', '');
}

/**
 * §9.4 — the cookies, drawn from the registry the code is checked against
 * (thirdParty.ts `COOKIES`), so the page cannot list a cookie the code does not
 * set or miss one it does. Cookies with the same purpose and lifetime share a
 * row, as the three connection cookies do. Each name is its own left-to-right
 * island, so an Arabic row keeps "yf_oauth، yf_meta" in order.
 */
function cookieTable(l: Locale): string {
  const rows: { names: string[]; purpose: (typeof COOKIES)[number]['purpose']; life: number }[] = [];
  for (const c of COOKIES) {
    const same = rows.find((r) => r.purpose === c.purpose && r.life === c.lifetimeSec);
    if (same) same.names.push(c.name); else rows.push({ names: [c.name], purpose: c.purpose, life: c.lifetimeSec });
  }
  const comma = l === 'zh' ? '、' : l === 'ar' ? '، ' : ', ';
  return `<table class="cookies"><thead><tr><th scope="col">${esc(t(l, 'legal.privacy.cookies.name'))}</th><th scope="col">${esc(t(l, 'legal.privacy.cookies.purpose'))}</th><th scope="col">${esc(t(l, 'legal.privacy.cookies.lifetime'))}</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${r.names.map((n) => `<code dir="ltr">${esc(n)}</code>`).join(comma)}</td><td>${esc(t(l, r.purpose))}</td><td>${esc(formatLifetime(l, r.life))}</td></tr>`).join('')
  }</tbody></table>`;
}

/** The cookie table's rules: the page's tokens, a rule under each row, nothing wider than the page. */
const PRIVACY_CSS = `${PUBLIC_TOP_CSS}
  table.cookies { border-collapse:collapse; margin:0 0 var(--space-12); color:var(--color-ink-secondary); }
  table.cookies th, table.cookies td { text-align:start; vertical-align:top; padding-block:var(--space-8); padding-inline:0 var(--space-12);
    border-bottom:1px solid var(--color-border); overflow-wrap:anywhere; }
  table.cookies th { color:var(--color-ink); font-weight:600; }
  table.cookies code { font-size:var(--font-size-small); }
`;

export function renderPrivacy(l: Locale, email: string | null, facts: LegalFacts, home = '/site'): string {
  const history = facts.advisorHistory !== false;
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
      ${/* The advisor batch (2026-10-06) — the advisor's answers are phrased by the same provider: said before it goes live.
           The advisor's history (2026-10-07) — and Nomi keeps those conversations for whoever allows it: said here, told below. */ ''}<li>${esc(t(l, 'legal.privacy.who.advisor', { processor: processorLabel(facts.processor, l) }))}${
        history ? `${l === 'zh' ? '' : ' '}${esc(t(l, 'legal.privacy.who.advisorKept'))}` : ''}</li>
      ${/* §9.3 — the transcriber, only when one is configured: a voice message's sound goes there. */
        facts.transcriber ? `<li>${esc(t(l, 'legal.privacy.who.transcriber', { transcriber: processorLabel(facts.transcriber, l) }))}</li>` : ''}
      <li>${esc(t(l, 'legal.privacy.who.hosting', { hosting: processorLabel(facts.hosting, l) }))}</li>
      <li>${esc(t(l, 'legal.privacy.who.mail'))}</li>
      ${/* §9.3 — the sign-up bot check, only when one is configured: it sees the sign-up page, never a message. */
        facts.botCheck ? `<li>${esc(t(l, 'legal.privacy.who.botCheck', { botCheck: processorLabel(facts.botCheck, l) }))}</li>` : ''}
    </ul>
    <p>${esc(t(l, 'legal.privacy.who.nobody'))}</p>
    ${toDeletion('legal.privacy.howLong.title', 'legal.privacy.howLong.body')}
    ${toDeletion('legal.privacy.choices.title', 'legal.privacy.choices.body')}
    ${/* §9.3 — THE ADVISOR'S HISTORY, before anything is kept: what, on what basis, where the question goes
         and what that provider keeps, who reads it (nobody), and what a customer's deletion reaches. */
      history ? `<h2 id="advisor">${esc(t(l, 'legal.privacy.advisor.title'))}</h2>
    <p>${esc(t(l, 'legal.privacy.advisor.what'))}</p>
    <p>${esc(t(l, 'legal.privacy.advisor.basis'))}</p>
    <p>${esc(advisorProviders(l, facts.processor))}</p>
    <p>${esc(t(l, 'legal.privacy.advisor.nobody'))}</p>
    <p>${esc(t(l, 'legal.privacy.advisor.customers'))}</p>` : ''}
    ${/* §9.4 — D7: every cookie is strictly necessary, so there is no banner; the list is the code's own. */ ''}<h2 id="cookies">${esc(t(l, 'legal.privacy.cookies.title'))}</h2>
    <p>${esc(t(l, 'legal.privacy.cookies.body'))}</p>
    ${cookieTable(l)}
    ${facts.botCheck ? `<p>${esc(t(l, 'legal.privacy.cookies.botCheck', { provider: processorLabel(facts.botCheck, l) }))}</p>` : ''}
    <p><a href="/data-deletion">${esc(t(l, 'legal.deletion.title'))}</a> · <a href="/terms">${esc(t(l, 'legal.termsLink'))}</a></p>
    ${contact(l, email, true)}
    ${updated(l, 'legal.updated.privacy')}`, home, '/privacy', PRIVACY_CSS);
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
    ${/* §9.5 — the advisor's history: what the business instructs Nomi, its processor, to keep. */ ''}<p>${k('legal.terms.service.advisor')}</p>
    <h2>${k('legal.terms.yours.title')}</h2>
    ${list(['legal.terms.yours.you0', 'legal.terms.yours.you1', 'legal.terms.yours.you2', 'legal.terms.yours.you3'])}
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
 *   HOW (0126, the owner's direction of 2026-10-04) — the customer asks the
 *   business, from the account they wrote from (or writes to the legal
 *   address, and the operator passes it on); the business deletes their data
 *   in Nomi, at once and for good (`erase_customer`); nothing writes to the
 *   customer by itself, and the page says so. There is NO FORM here, and the
 *   page says why: only the business knows which conversation is the
 *   asker's, and a form anyone could fill in could erase someone else.
 *   Closing a workspace erases everything in it (`close_workspace`).
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
      ${list(['legal.deletion.step2', 'legal.deletion.step3'])}
    </ol>
    ${/* V1-071 — the other way to ask is its own sentence, not a second route inside step 1. */
      email ? `<p>${k('legal.deletion.viaUs')}</p>` : ''}
    ${/* 0126 — why there is no form here, and what closing a workspace does. */ ''}<p>${k('legal.deletion.noForm')}</p>
    <p>${k('legal.deletion.closed')}</p>
    <h2>${k('legal.deletion.erased.title')}</h2>
    <ul>${list([
      // w4-public-02 — the photo, which the operator's buyer erasure erases (`client_faces: { do: 'erase' }`).
      'legal.deletion.erased.identity', 'legal.deletion.erased.photo', 'legal.deletion.erased.messages', 'legal.deletion.erased.prepared',
      'legal.deletion.erased.notes', 'legal.deletion.erased.conversations',
      // 0130 — the advisor's kept turns that name them, whole (erase-buyer's `advisor_turn_subjects`, `advisor_turns`).
      'legal.deletion.erased.advisor',
    ])}</ul>
    <h2>${k('legal.deletion.kept.title')}</h2>
    <ul>${list([
      'legal.deletion.kept.orders', 'legal.deletion.kept.doNotContact', 'legal.deletion.kept.record',
      'legal.deletion.kept.meta', 'legal.deletion.kept.elsewhere', 'legal.deletion.kept.backups',
      // 0126 — a restore brings nobody back: tools/replay-erasures.mjs, docs/BACKUP-RESTORE.md.
      'legal.deletion.kept.restored',
      // 0130 — the honest limit: a name in the business's own words, with no record behind it.
      'legal.deletion.kept.advisorUnlinked',
    ])}</ul>
    ${contact(l, email, !email)}
    <p><a href="/privacy">${k('legal.privacyLink')}</a> · <a href="/terms">${k('legal.termsLink')}</a></p>
    ${updated(l, 'legal.updated.deletion')}`, home, '/data-deletion');
}
