import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { SELLING_DEFAULTS } from '../../core/owner/sellingStyle.js';
import { INCOTERM_KEYS } from '../../core/safety/claims.js';
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

export function renderHub(v: HubView, locale: Locale, flash: Flash | null): string {
  const name = assistantName(locale);
  const done = answeredIn(v.progress);
  const first = v.order.find((q) => !done.has(q)) ?? null;
  const stateOf = (q: Question) => v.progress[q]?.state ?? 'open';
  const rows = v.order.map((q) => {
    const s = stateOf(q);
    const chip = s === 'answered' ? 'auto' : s === 'draft' ? 'draft' : '';
    return `<li class="row lines">
      <div><b>${esc(title(locale, q, name))}</b> <span class="chip${chip ? ` ${chip}` : ''}">${esc(t(locale, `hs.state.${s}` as MessageKey))}</span></div>
      ${deeper(`${HS_BASE}/${q}`, t(locale, s === 'answered' || s === 'skipped' ? 'hs.change' : 'hs.answer'))}
    </li>`;
  }).join('');
  return `<h1 class="page">${esc(t(locale, 'hs.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'hs.lede', { name }))}</p>
    ${first ? `<div class="block">${deeper(`${HS_BASE}/${first}`, t(locale, done.size === 0 ? 'hs.start' : 'hs.continue'))}</div>`
      : `<p class="muted">${esc(t(locale, 'hs.allDone', { name }))}</p>`}
    <section class="block"><ul class="rows">${rows}</ul></section>
    ${back('/app/business', t(locale, 'hs.backToBusiness'))}`;
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
  const radio = (fieldName: string, value: string, on: boolean, label: string, extra = '') =>
    `<label class="pcheck"><input type="radio" name="${esc(fieldName)}" value="${esc(value)}"${on ? ' checked' : ''} /> <span>${esc(label)}${extra}</span></label>`;
  const toldBox = (fallback: string) => `<label class="fld"><span class="muted">${esc(t(locale, q === 'returns' || q === 'delivery' ? 'hs.told.optional' : 'hs.told'))}</span>
      <textarea name="told" rows="4" dir="auto" maxlength="${MAX_TOLD}">${val('told', fallback)}</textarea>${errLine(locale, errors['told'])}
      <span class="caption muted">${esc(t(locale, 'hs.told.hint', { name }))}</span></label>`;
  const toldNow = (kept && 'told' in kept ? kept.told : null) ?? v.state.told[q] ?? '';

  let fields = '';
  switch (q) {
    case 'price': {
      const now = kept?.q === 'price' ? kept.quantityFirst : v.state.quantityFirst;
      const usual = SELLING_DEFAULTS[v.facts.profile].quantityFirst;
      const mark = (yes: boolean) => usual === yes ? ` <span class="muted small">${esc(t(locale, `selling.usual.${v.facts.profile}` as MessageKey))}</span>` : '';
      fields = `<fieldset class="choices">${radio('quantityFirst', 'no', !now, t(locale, 'selling.quantityFirst.no', { name }), mark(false))}${
        radio('quantityFirst', 'yes', now, t(locale, 'selling.quantityFirst.yes', { name }), mark(true))}</fieldset>
        ${errLine(locale, errors['quantityFirst'])}
        <p class="muted small">${esc(t(locale, 'selling.quantityFirst.hint', { name }))}</p>`;
      break;
    }
    case 'minimum': {
      if (v.state.products.length === 0) {
        fields = `<p class="fwarn">${esc(t(locale, 'hs.minimum.noProducts'))}</p>${deeper('/app/products/add', t(locale, 'product.teach'))}`;
        break;
      }
      const mode = kept?.q === 'minimum' ? kept.mode : (v.facts.profile === 'bulk' ? 'depends' : 'none');
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
        const options = INCOTERM_KEYS.map((k) => `<option value="${esc(k)}"${terms?.incoterm === k ? ' selected' : ''}>${esc(k)}</option>`).join('');
        fields = `<label class="fld"><span class="muted">${esc(t(locale, 'terms.payment.label'))}</span>
            <input name="payment" maxlength="${MAX_PAYMENT_TERMS}" placeholder="${esc(t(locale, 'terms.payment.placeholder'))}" value="${val('payment', terms?.payment ?? '')}" />${errLine(locale, errors['payment'])}</label>
          <label class="fld"><span class="muted">${esc(t(locale, 'terms.incoterm.label'))}</span>
            <select name="incoterm">${terms ? '' : '<option value="" selected disabled></option>'}${options}</select>${errLine(locale, errors['incoterm'])}
            <span class="muted">${esc(t(locale, 'terms.incoterm.hint', { name }))}</span></label>`;
      } else fields = toldBox(toldNow);
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
  return `<div class="dhead">${back(HS_BASE, t(locale, 'hs.back'))}</div>
    <h1 class="page">${esc(title(locale, q, name))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, `hs.lede.${q}` as MessageKey, { name }))}</p>
    ${canAnswer ? `<form method="post" action="${HS_BASE}/${q}" class="pform">${fields}
      <button class="btn send" type="submit">${esc(t(locale, 'hs.next'))}</button></form>` : fields}
    <form method="post" action="${HS_BASE}/${q}/skip"><button class="btn" type="submit">${esc(t(locale, 'hs.skip'))}</button></form>`;
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
