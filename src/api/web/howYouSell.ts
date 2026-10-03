import { PRODUCT_CATEGORIES, CATEGORY_CLAIMS } from '../../core/safety/claims.js';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { SELLING_DEFAULTS } from '../../core/owner/sellingStyle.js';
import { OFFERED_INCOTERMS, incotermMeaning, menuRow, menuGroup } from './settings.js';
import { MAX_PAYMENT_TERMS } from '../../core/commerce/terms.js';
import {
  questionsFor, linesFor, parseAnswer, tickedLines, nextQuestion, paysByTerms, isQuestion,
  PROMISES_OF, CERT_KEYS, MAX_CLOSURES, MAX_TOLD, MAX_HOURS, TOLD_QUESTIONS, certKind, promiseKind,
  type Answer, type AnswerError, type Line, type Question, type SellingState,
} from '../../core/owner/howYouSell.js';
import {
  sellingFacts, loadProgress, loadSellingState, saveDraft, skipQuestion, applyLines, answeredIn,
  type Progress, type SellingFacts,
} from '../../db/howYouSell.js';
import { t, assistantName } from './say.js';
import { esc, back, deeper } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import * as show from './values.js';

/**
 * HS (0096) — "How you sell": the pages. One question a page; then every line
 * its answer would write, each with its own tick; nothing is written that she
 * did not tick. The hub lists the questions for her kind of business, where
 * she is in them, and a door to each. Money and going live are the owner's
 * (rule 11): every route is `price_rules`.
 */

export const HS_BASE = '/app/business/selling';

export type HubView = { readonly facts: SellingFacts; readonly order: readonly Question[]; readonly progress: Progress };
export type QuestionView = HubView & { readonly q: Question; readonly state: SellingState };

const bidOf = (raw: string): BusinessId | null => { const b = parseBusinessId(raw); return b.ok ? b.value : null; };

export async function loadHub(db: Db, businessIdRaw: string): Promise<HubView | null> {
  const bid = bidOf(businessIdRaw);
  if (!bid) return null;
  return withTenantTx(db, bid, async (tx) => {
    const facts = await sellingFacts(tx, bid);
    return { facts, order: questionsFor(facts.profile, facts.pricesToOwner), progress: await loadProgress(tx, bid) };
  });
}

export async function loadQuestion(db: Db, businessIdRaw: string, q: Question): Promise<QuestionView | null> {
  const bid = bidOf(businessIdRaw);
  if (!bid) return null;
  return withTenantTx(db, bid, async (tx) => {
    const facts = await sellingFacts(tx, bid);
    const order = questionsFor(facts.profile, facts.pricesToOwner);
    if (!order.includes(q)) return null;
    return { facts, order, q, progress: await loadProgress(tx, bid), state: await loadSellingState(tx, bid) };
  });
}

export type AnswerOutcome =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'invalid'; readonly errors: Readonly<Record<string, AnswerError>> }
  | { readonly kind: 'gone' };

/** Her answer, read and kept as a draft; the confirm page shows its lines. */
export async function submitAnswer(db: Db, businessIdRaw: string, q: Question, body: Record<string, unknown>, actor: string): Promise<AnswerOutcome> {
  const bid = bidOf(businessIdRaw);
  if (!bid) return { kind: 'gone' };
  return withTenantTx(db, bid, async (tx) => {
    const facts = await sellingFacts(tx, bid);
    if (!questionsFor(facts.profile, facts.pricesToOwner).includes(q)) return { kind: 'gone' as const };
    const r = parseAnswer(q, body, facts);
    if (!r.ok) return { kind: 'invalid' as const, errors: r.errors };
    await saveDraft(tx, bid, q, r.answer, actor);
    return { kind: 'confirm' as const };
  });
}

export type ConfirmOutcome =
  | { readonly kind: 'saved'; readonly next: Question | null }
  | { readonly kind: 'none_ticked' }
  | { readonly kind: 'no_draft' }
  | { readonly kind: 'gone' };

/** The ticked lines written, in one transaction; the lines are drawn again against what is in force now. */
export async function confirmAnswer(
  db: Db, businessIdRaw: string, q: Question, body: Record<string, unknown>, actor: string, locale: Locale,
): Promise<ConfirmOutcome> {
  const bid = bidOf(businessIdRaw);
  if (!bid) return { kind: 'gone' };
  return withTenantTx(db, bid, async (tx) => {
    const facts = await sellingFacts(tx, bid);
    const order = questionsFor(facts.profile, facts.pricesToOwner);
    if (!order.includes(q)) return { kind: 'gone' as const };
    const progress = await loadProgress(tx, bid);
    const draft = progress[q]?.state === 'draft' ? progress[q]?.answer ?? null : null;
    if (!draft) return { kind: 'no_draft' as const };
    const lines = linesFor(draft, await loadSellingState(tx, bid));
    const chosen = tickedLines(lines, body);
    if (lines.length > 0 && chosen.length === 0) return { kind: 'none_ticked' as const };
    const label = TOLD_QUESTIONS.has(q) ? t(locale, `hs.faq.${q}` as MessageKey) : '';
    await applyLines(tx, bid, q, chosen, actor, { label, language: locale });
    const done = new Set([...answeredIn(progress), q]);
    return { kind: 'saved' as const, next: nextQuestion(order, q, done) };
  });
}

export async function skipAnswer(db: Db, businessIdRaw: string, q: Question, actor: string): Promise<{ readonly next: Question | null } | null> {
  const bid = bidOf(businessIdRaw);
  if (!bid) return null;
  return withTenantTx(db, bid, async (tx) => {
    const facts = await sellingFacts(tx, bid);
    const order = questionsFor(facts.profile, facts.pricesToOwner);
    if (!order.includes(q)) return null;
    await skipQuestion(tx, bid, q, actor);
    const done = new Set([...answeredIn(await loadProgress(tx, bid)), q]);
    return { next: nextQuestion(order, q, done) };
  });
}

export const questionOf = (raw: string): Question | null => (isQuestion(raw) ? raw : null);

/* ── rendering ─────────────────────────────────────────────────────────── */

const title = (l: Locale, q: Question, name: string) =>
  q === 'price' ? t(l, 'selling.quantityFirst.q', { name }) : t(l, `hs.q.${q}` as MessageKey, { name });

/**
 * Phase 9 — the hub: the back link at the top, as on the question pages; how
 * many of the questions are answered; the way in as the page's one filled
 * button, saying which question it opens.
 *
 * The fix wave (w4-business-assistant-22) — the questions are menu rows, like
 * every other screen under My business: each question, where it stands (its
 * value, the "done" colour once answered; a setting not answered yet is said
 * in plain words, never in the waiting colour), and the door.
 */
export function renderHub(v: HubView, locale: Locale, flash: Flash | null): string {
  const name = assistantName(locale);
  const done = answeredIn(v.progress);
  const first = v.order.find((q) => !done.has(q)) ?? null;
  const stateOf = (q: Question) => v.progress[q]?.state ?? 'open';
  const answered = v.order.filter((q) => stateOf(q) === 'answered').length;
  const rows = v.order.map((q) => {
    const s = stateOf(q);
    return menuRow({ href: `${HS_BASE}/${q}`, label: title(locale, q, name),
      value: t(locale, `hs.state.${s}` as MessageKey),
      ...(s === 'answered' ? { tone: 'ok' as const } : {}) });
  });
  const position = (q: Question) => ({ i: v.order.indexOf(q) + 1, n: v.order.length });
  // Phase 7 — reached from My business › How you sell, a menu of the same
  // name: the page is named for what it holds, the questions, and leads back.
  return `<div class="dhead">${back('/app/business/how-you-sell', t(locale, 'factory.sellhow.title'))}</div>
    <h1 class="page">${esc(t(locale, 'hs.questions.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'hs.lede', { name }))}</p>
    <p class="hs-count">${esc(t(locale, 'hs.count', { done: show.count(locale, answered), total: show.count(locale, v.order.length) }))}</p>
    ${first ? `<form method="get" action="${HS_BASE}/${first}" class="hs-start"><button class="btn send" type="submit">${esc(t(locale,
        done.size === 0 ? 'hs.start' : 'hs.continue', { i: show.count(locale, position(first).i), n: show.count(locale, position(first).n) }))}</button></form>`
      : `<p class="muted">${esc(t(locale, 'hs.allDone', { name }))}</p>`}
    ${menuGroup('questions', null, rows)}`;
}

const errLine = (l: Locale, e: AnswerError | undefined): string => {
  if (!e) return '';
  const key: MessageKey = (e === 'payment_missing' || e === 'payment_too_long' || e === 'incoterm_invalid') ? `terms.flash.${e}` as MessageKey
    : (e === 'label_missing' || e === 'from_missing' || e === 'to_missing' || e === 'not_a_date' || e === 'ends_before_starts') ? `closures.flash.${e}` as MessageKey
    : `hs.error.${e}` as MessageKey;
  return `<p class="perr" role="alert">${esc(t(l, key))}</p>`;
};

/** What the form starts with: her draft, else what is in force. */
function startingAnswer(v: QuestionView): Answer | null {
  const kept = v.progress[v.q]?.answer;
  return kept && kept.q === v.q ? kept : null;
}

export function renderQuestion(
  v: QuestionView, locale: Locale, flash: Flash | null,
  errors: Readonly<Record<string, AnswerError>> = {}, typed: Record<string, unknown> | null = null,
): string {
  const name = assistantName(locale);
  const q = v.q;
  const kept = startingAnswer(v);
  const val = (field: string, fallback: string): string => esc(typed && typeof typed[field] === 'string' ? String(typed[field]) : fallback);
  const box = (fieldName: string, on: boolean, label: string) =>
    `<label class="pcheck"><input type="checkbox" name="${esc(fieldName)}"${on ? ' checked' : ''} /> <span>${esc(label)}</span></label>`;
  const radio = (fieldName: string, value: string, on: boolean, label: string, extra = '', required = false) =>
    `<label class="pcheck"><input type="radio" name="${esc(fieldName)}" value="${esc(value)}"${on ? ' checked' : ''}${required ? ' required' : ''} /> <span>${esc(label)}${extra}</span></label>`;
  const answeredHere = v.progress[q]?.state === 'answered';
  const toldBox = (fallback: string) => `<label class="fld"><span class="muted">${esc(t(locale, q === 'returns' || q === 'delivery' ? 'hs.told.optional' : 'hs.told'))}</span>
      <textarea name="told" rows="4" dir="auto" maxlength="${MAX_TOLD}">${val('told', fallback)}</textarea>${errLine(locale, errors['told'])}
      <span class="caption muted">${esc(t(locale, 'hs.told.hint', { name }))}</span></label>`;
  const toldNow = (kept && 'told' in kept ? kept.told : null) ?? v.state.told[q] ?? '';

  let fields = '';
  switch (q) {
    case 'price': {
      // Phase 9 (V1-412) — a question she has not answered starts with nothing
      // chosen: what is in force now is said in words, and Next asks for her
      // own choice. Her draft, or an answer she gave, is what the form keeps.
      const chosen: boolean | null = kept?.q === 'price' ? kept.quantityFirst
        : answeredHere ? v.state.quantityFirst : null;
      const usual = SELLING_DEFAULTS[v.facts.profile].quantityFirst;
      const mark = (yes: boolean) => usual === yes ? `<span class="muted small hs-usual">${esc(t(locale, `selling.usual.${v.facts.profile}` as MessageKey))}</span>` : '';
      fields = `${chosen === null ? `<p class="small">${esc(t(locale, v.state.quantityFirst ? 'hs.price.now.yes' : 'hs.price.now.no', { name }))}</p>` : ''}
        <fieldset class="choices hs-choices">${radio('quantityFirst', 'no', chosen === false, t(locale, 'selling.quantityFirst.no', { name }), mark(false), true)}${
        radio('quantityFirst', 'yes', chosen === true, t(locale, 'selling.quantityFirst.yes', { name }), mark(true), true)}</fieldset>
        ${errLine(locale, errors['quantityFirst'])}
        <p class="muted small hs-hint">${esc(t(locale, 'selling.quantityFirst.hint', { name }))}</p>`;
      break;
    }
    case 'minimum': {
      if (v.state.products.length === 0) {
        fields = `<p class="fwarn">${esc(t(locale, 'hs.minimum.noProducts'))}</p>${deeper('/app/products/add', t(locale, 'product.teach'))}`;
        break;
      }
      // Phase 9 — nothing chosen for her on a question she has not answered.
      const mode = kept?.q === 'minimum' ? kept.mode : answeredHere ? (v.facts.profile === 'bulk' ? 'depends' : 'none') : null;
      const qty = kept?.q === 'minimum' && kept.qty !== null ? String(kept.qty) : '';
      fields = `<fieldset class="choices">${radio('mode', 'none', mode === 'none', t(locale, 'hs.minimum.none'))}${
        radio('mode', 'same', mode === 'same', t(locale, 'hs.minimum.same'))}${
        radio('mode', 'depends', mode === 'depends', t(locale, 'hs.minimum.depends'))}</fieldset>${errLine(locale, errors['mode'])}
        <label class="fld"><span class="muted">${esc(t(locale, 'hs.minimum.qty'))}</span>
          <input name="qty" inputmode="numeric" value="${val('qty', qty)}" />${errLine(locale, errors['qty'])}</label>
        <p class="muted small">${esc(t(locale, 'hs.minimum.hint'))}</p>`;
      break;
    }
    case 'returns':
    case 'delivery': {
      const offered = (k: string) => kept && 'offers' in kept ? kept.offers.includes(k) : v.state.allowed.has(`${promiseKind(k)}:${k}`);
      fields = `<fieldset class="choices"><legend class="muted">${esc(t(locale, 'hs.offers', { name }))}</legend>${
        (PROMISES_OF[q] ?? []).map((k) => box(`offer:${k}`, offered(k), t(locale, `claim.${k}` as MessageKey))).join('')}</fieldset>
        ${toldBox(toldNow)}`;
      break;
    }
    case 'payment': {
      if (paysByTerms(v.facts)) {
        const terms = kept?.q === 'payment' && kept.terms ? kept.terms : v.state.terms;
        // Phase 9 — the terms page's own list and words (V1-537): each term with
        // what it means, and DDU only for a workspace that already chose it.
        const choices: readonly string[] = terms && !(OFFERED_INCOTERMS as readonly string[]).includes(terms.incoterm)
          ? [...OFFERED_INCOTERMS, terms.incoterm] : OFFERED_INCOTERMS;
        const options = choices.map((k) => `<option value="${esc(k)}"${terms?.incoterm === k ? ' selected' : ''}>${esc(incotermMeaning(locale, k))}</option>`).join('');
        fields = `<label class="fld"><span class="muted">${esc(t(locale, 'terms.payment.label'))}</span>
            <input name="payment" maxlength="${MAX_PAYMENT_TERMS}" placeholder="${esc(t(locale, 'terms.payment.placeholder'))}" value="${val('payment', terms?.payment ?? '')}" />${errLine(locale, errors['payment'])}</label>
          <label class="fld"><span class="muted">${esc(t(locale, 'terms.incoterm.label'))}</span>
            <select name="incoterm">${terms ? '' : '<option value="" selected disabled></option>'}${options}</select>${errLine(locale, errors['incoterm'])}
            <span class="muted">${esc(t(locale, 'terms.incoterm.hint', { name }))}</span></label>`;
      } else fields = toldBox(toldNow);
      break;
    }
    case 'product_claims': {
      // CK — what the shop sells, then which of its claims are true. Every
      // category's claims are on the page (no script); only the chosen one's
      // ticks are kept.
      const category = kept?.q === 'product_claims' ? kept.category : v.state.productCategory ?? null;
      const held = (k: string) => kept?.q === 'product_claims' ? kept.keys.includes(k) : v.state.allowed.has(`product_attribute:${k}`);
      fields = `<fieldset class="choices">${PRODUCT_CATEGORIES.map((c) => radio('category', c, category === c, t(locale, `hs.category.${c}` as MessageKey))).join('')}</fieldset>
        ${errLine(locale, errors['category'])}
        ${(['cosmetics', 'apparel'] as const).map((c) => `<fieldset class="choices"><legend class="muted small">${esc(t(locale, `hs.category.${c}` as MessageKey))}</legend>${
          CATEGORY_CLAIMS[c].map((k) => box(`attr:${k}`, held(k), t(locale, `claim.${k}` as MessageKey))).join('')}</fieldset>`).join('')}
        <p class="muted small">${esc(t(locale, 'hs.product_claims.hint', { name }))}</p>`;
      break;
    }
    case 'certifications': {
      const held = (k: string) => kept?.q === 'certifications' ? kept.keys.includes(k) : v.state.allowed.has(`${certKind(k)}:${k}`);
      fields = `<fieldset class="choices">${CERT_KEYS.map((k) => box(`cert:${k}`, held(k), t(locale, `claim.${k}` as MessageKey))).join('')}</fieldset>
        <p class="muted small">${esc(t(locale, 'hs.certifications.hint', { name }))}</p>`;
      break;
    }
    case 'hours': {
      const hours = kept?.q === 'hours' ? kept.hours : v.state.workingHours ?? '';
      const rows = Array.from({ length: MAX_CLOSURES }, (_, i) => {
        const c = kept?.q === 'hours' ? kept.closures[i] : undefined;
        return `<div class="pform">
          <label class="fld"><span class="muted">${esc(t(locale, 'hs.closure.label'))}</span>
            <input name="closure${i}.label" dir="auto" maxlength="80" value="${val(`closure${i}.label`, c?.label ?? '')}" /></label>
          <label class="fld"><span class="muted">${esc(t(locale, 'hs.closure.from'))}</span>
            <input type="date" name="closure${i}.from" value="${val(`closure${i}.from`, c?.from ?? '')}" /></label>
          <label class="fld"><span class="muted">${esc(t(locale, 'hs.closure.to'))}</span>
            <input type="date" name="closure${i}.to" value="${val(`closure${i}.to`, c?.to ?? '')}" /></label>
          ${errLine(locale, errors[`closure${i}`])}</div>`;
      }).join('');
      const already = v.state.closures.length
        ? `<p class="muted small">${esc(t(locale, 'hs.closure.already'))} ${v.state.closures.map((c) => `<bdi>${esc(c.label)} ${esc(c.from)} – ${esc(c.to)}</bdi>`).join(' · ')}</p>` : '';
      fields = `<label class="fld"><span class="muted">${esc(t(locale, 'hs.hours.label'))}</span>
          <input name="hours" dir="auto" maxlength="${MAX_HOURS}" placeholder="${esc(t(locale, 'hs.hours.placeholder'))}" value="${val('hours', hours)}" />${errLine(locale, errors['hours'])}</label>
        <h2>${esc(t(locale, 'hs.closure.title'))}</h2>
        <p class="muted small">${esc(t(locale, 'hs.closure.zone', { zone: v.facts.zone }))}</p>
        ${rows}${already}`;
      break;
    }
    case 'words': {
      const terms = kept?.q === 'words' ? kept.terms.join('\n') : '';
      const own = [...v.state.words];
      fields = `<label class="fld"><span class="muted">${esc(t(locale, 'hs.words.label'))}</span>
          <textarea name="terms" rows="5" dir="auto">${val('terms', terms)}</textarea>${errLine(locale, errors['terms'])}
          <span class="caption muted">${esc(t(locale, 'hs.words.hint', { name }))}</span></label>
        ${own.length ? `<p class="muted small">${esc(t(locale, 'hs.words.already'))} ${own.map((w) => `<bdi>${esc(w)}</bdi>`).join(' · ')}</p>` : ''}`;
      break;
    }
    case 'offered':
    case 'area':
    case 'duration':
    case 'next_step':
      fields = toldBox(toldNow);
      break;
  }
  const canAnswer = !(q === 'minimum' && v.state.products.length === 0);
  // Phase 9 — "one at a time" says which one; Next and Later sit side by side
  // in one row (Later posts to its own address and needs no choice).
  const at = v.order.indexOf(q);
  const position = at < 0 ? '' : `<p class="muted hs-pos">${esc(t(locale, 'hs.position', { i: show.count(locale, at + 1), n: show.count(locale, v.order.length) }))}</p>`;
  return `<div class="dhead">${back(HS_BASE, t(locale, 'hs.questions.title'))}</div>
    ${position}
    <h1 class="page">${esc(title(locale, q, name))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, `hs.lede.${q}` as MessageKey, { name }))}</p>
    ${canAnswer ? `<form method="post" action="${HS_BASE}/${q}" class="pform">${fields}
      <div class="acts hs-acts"><button class="btn send" type="submit">${esc(t(locale, 'hs.next'))}</button>
        <button class="btn" type="submit" formaction="${HS_BASE}/${q}/skip" formnovalidate>${esc(t(locale, 'hs.skip'))}</button></div></form>`
      : `${fields}<form method="post" action="${HS_BASE}/${q}/skip"><button class="btn" type="submit">${esc(t(locale, 'hs.skip'))}</button></form>`}`;
}

/** One line, as she reads it before ticking it. */
function lineText(l: Line, locale: Locale, name: string): string {
  const claim = (k: string) => t(locale, `claim.${k}` as MessageKey);
  const qty = (n: number | null) => (n === null ? t(locale, 'product.noMinimum') : show.quantity(locale, n));
  switch (l.kind) {
    case 'quantity_first': return esc(t(locale, l.to ? 'selling.quantityFirst.yes' : 'selling.quantityFirst.no', { name }));
    case 'minimum': return `<bdi>${esc(l.product)}</bdi>: ${esc(qty(l.from))} → ${esc(qty(l.to))}`;
    case 'promise': return esc(t(locale, l.to ? 'hs.line.promise.on' : 'hs.line.promise.off', { name, claim: claim(l.claim) }));
    case 'cert': return esc(t(locale, l.to ? 'hs.line.cert.on' : 'hs.line.cert.off', { name, claim: claim(l.claim) }));
    case 'attr': return esc(t(locale, l.to ? 'hs.line.attr.on' : 'hs.line.attr.off', { name, claim: claim(l.claim) }));
    case 'category': return esc(t(locale, 'hs.line.category', { category: t(locale, `hs.category.${l.to}` as MessageKey) }));
    case 'terms': return esc(t(locale, 'hs.line.terms')) + ` <bdi>${esc(l.payment)}</bdi> · <bdi>${esc(l.incoterm)}</bdi>`;
    case 'hours': return esc(t(locale, 'hs.line.hours')) + ` <bdi>${esc(l.text)}</bdi>`;
    case 'closure': return esc(t(locale, 'hs.line.closure')) + ` <bdi>${esc(l.label)}</bdi> <bdi>${esc(l.from)} – ${esc(l.to)}</bdi>`;
    case 'word': return esc(t(locale, 'hs.line.word')) + ` <bdi>${esc(l.term)}</bdi>`;
    case 'told': {
      const notAllowed = l.promises.filter((p) => !p.allowed);
      return `${esc(t(locale, 'hs.line.told', { topic: t(locale, `hs.faq.${l.question}` as MessageKey) }))}
        <div class="disclose" dir="auto">${esc(l.text)}</div>
        ${l.figures.length ? `<p class="muted small">${esc(t(locale, 'hs.line.figures'))} ${l.figures.map((f) => `<bdi>${esc(f)}</bdi>`).join(' · ')}</p>` : ''}
        ${notAllowed.map((p) => `<p class="fwarn">${esc(t(locale, 'hs.line.promiseNotAllowed', { name, claim: claim(p.claim) }))}</p>`).join('')}`;
    }
  }
}

export function renderConfirm(v: QuestionView, locale: Locale, flash: Flash | null): string | null {
  const name = assistantName(locale);
  const draft = v.progress[v.q]?.state === 'draft' ? v.progress[v.q]?.answer ?? null : null;
  if (!draft) return null;
  const lines = linesFor(draft, v.state);
  const body = lines.length === 0
    ? `<p class="muted">${esc(t(locale, 'hs.confirm.nothing', { name }))}</p>
       <button class="btn send" type="submit">${esc(t(locale, 'hs.confirm.done'))}</button>`
    : `<p class="muted">${esc(t(locale, 'hs.confirm.lede'))}</p>
       <ul class="rows">${lines.map((l) => `<li class="row lines"><label class="pcheck"><input type="checkbox" name="line:${esc(l.key)}" />
         <span>${lineText(l, locale, name)}</span></label></li>`).join('')}</ul>
       <button class="btn send" type="submit">${esc(t(locale, 'hs.confirm.save'))}</button>`;
  return `<div class="dhead">${back(`${HS_BASE}/${v.q}`, t(locale, 'hs.confirm.back'))}</div>
    <h1 class="page">${esc(t(locale, 'hs.confirm.title'))}</h1>
    ${flashBanner(flash)}
    <p class="muted">${esc(title(locale, v.q, name))}</p>
    <form method="post" action="${HS_BASE}/${v.q}/confirm" class="pform">${body}</form>`;
}
