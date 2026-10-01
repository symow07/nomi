/**
 * HS — "HOW YOU SELL" (the onboarding plan's Stage 3; decisions 29 and 41).
 *
 * Plain questions, one at a time, in the owner's language. Each answer writes
 * rows that already exist — the price-first choice, products' minimums, the
 * claim switches, trade terms, hours and closures, forbidden words, and
 * business-level answers the assistant sends word for word — and nothing is
 * written until the owner has ticked it, line by line. There is no model
 * extraction: what she typed is what is kept.
 *
 *   · A business with a catalogue (a shop, a brand, a maker) is asked about
 *     price, the minimum, returns, delivery, payment, certifications, hours
 *     and words to avoid.
 *   · A business with no catalogue (services, an agency, or one whose prices
 *     go to the owner) is asked instead what it offers and for whom, the area
 *     it serves, how long a job takes, how customers pay, how a customer takes
 *     the next step, its hours, and words to avoid.
 *
 * An answer customers receive word for word (a strong match sends it with no
 * model at all — turn.ts, the taught-answer path) is its own line, with its
 * figures listed and every promise in it named; a promise she has not allowed
 * keeps it from being sent. Pure: the routes read the state and write the
 * ticked lines (src/db/howYouSell.ts).
 */
import { detectClaims, SHOP_PROMISES, type ClaimKind } from '../safety/claims.js';
import { extractNumerals } from '../safety/numerals.js';
import { validateTradeTerms, type TradeTermsError } from '../commerce/terms.js';
import { validateClosure, type ClosureError } from '../commerce/closures.js';
import type { SellingProfile } from './sellingStyle.js';

export const CATALOGUE_QUESTIONS = ['price', 'minimum', 'returns', 'delivery', 'payment', 'certifications', 'hours', 'words'] as const;
export const SERVICE_QUESTIONS = ['offered', 'area', 'duration', 'payment', 'next_step', 'hours', 'words'] as const;
export type Question = (typeof CATALOGUE_QUESTIONS)[number] | (typeof SERVICE_QUESTIONS)[number];
export const ALL_QUESTIONS: readonly Question[] = [...new Set<Question>([...CATALOGUE_QUESTIONS, ...SERVICE_QUESTIONS])];
export const isQuestion = (q: string): q is Question => (ALL_QUESTIONS as readonly string[]).includes(q);

/** No catalogue: a services business, or one whose prices go to the owner (K5). */
export const hasNoCatalogue = (profile: SellingProfile, pricesToOwner: boolean): boolean =>
  profile === 'services' || pricesToOwner;

export function questionsFor(profile: SellingProfile, pricesToOwner: boolean): readonly Question[] {
  return hasNoCatalogue(profile, pricesToOwner) ? SERVICE_QUESTIONS : CATALOGUE_QUESTIONS;
}

/** The questions whose answer is prose a customer receives word for word. */
export const TOLD_QUESTIONS: ReadonlySet<Question> = new Set(['returns', 'delivery', 'payment', 'offered', 'area', 'duration', 'next_step']);

/** Which of the shop promises each question asks about. */
export const PROMISES_OF: Readonly<Partial<Record<Question, readonly string[]>>> = {
  returns: ['returns', 'refund', 'warranty', 'free_replacement'],
  delivery: ['free_shipping', 'express'],
};

/** The certifications the claims guard knows (the knowledge page's nine). */
export const CERT_KEYS: readonly string[] = ['CE', 'FDA', 'RoHS', 'ISO9001', 'BSCI', 'food_grade', 'BPA_free', 'REACH', 'CPSIA'];
export const certKind = (key: string): ClaimKind => (key === 'REACH' || key === 'CPSIA' ? 'compliance' : 'certification');
export const promiseKind = (key: string): ClaimKind => SHOP_PROMISES.find((p) => p.key === key)?.kind ?? 'guarantee';

export const MAX_TOLD = 1000;
export const MAX_CLOSURES = 3;
export const MAX_WORDS = 30;
export const MAX_HOURS = 200;

export type Answer =
  | { readonly q: 'price'; readonly quantityFirst: boolean }
  | { readonly q: 'minimum'; readonly mode: 'none' | 'same' | 'depends'; readonly qty: number | null }
  | { readonly q: 'returns' | 'delivery'; readonly offers: readonly string[]; readonly told: string }
  | { readonly q: 'payment'; readonly told: string; readonly terms: { readonly payment: string; readonly incoterm: string } | null }
  | { readonly q: 'certifications'; readonly keys: readonly string[] }
  | { readonly q: 'hours'; readonly hours: string; readonly closures: readonly { readonly label: string; readonly from: string; readonly to: string }[] }
  | { readonly q: 'words'; readonly terms: readonly string[] }
  | { readonly q: 'offered' | 'area' | 'duration' | 'next_step'; readonly told: string };

export type AnswerError = 'required' | 'qty' | 'too_long' | 'too_many' | TradeTermsError | ClosureError;

/** Where the answer is read: the profile decides whether payment is trade terms (bulk) or words. */
export type AskContext = { readonly profile: SellingProfile; readonly pricesToOwner: boolean };

const text = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] ?? '') : '').trim();
const ticked = (body: Record<string, unknown>, name: string): boolean => text(body[name]) === 'on';
/** Trade terms are a bulk seller's: a proforma names them. Everyone else says how customers pay in words. */
export const paysByTerms = (ctx: AskContext): boolean => ctx.profile === 'bulk' && !ctx.pricesToOwner;

/** The form, read. Every field's problem at once, so one fix is enough. */
export function parseAnswer(q: Question, body: Record<string, unknown>, ctx: AskContext):
  { readonly ok: true; readonly answer: Answer } | { readonly ok: false; readonly errors: Readonly<Record<string, AnswerError>> } {
  const errors: Record<string, AnswerError> = {};
  const told = (): string => {
    const v = text(body['told']);
    if (v.length > MAX_TOLD) errors['told'] = 'too_long';
    return v.slice(0, MAX_TOLD);
  };
  const done = (answer: Answer) => (Object.keys(errors).length > 0 ? { ok: false as const, errors } : { ok: true as const, answer });
  switch (q) {
    case 'price': {
      const v = text(body['quantityFirst']);
      if (v !== 'yes' && v !== 'no') errors['quantityFirst'] = 'required';
      return done({ q, quantityFirst: v === 'yes' });
    }
    case 'minimum': {
      const mode = text(body['mode']);
      if (mode !== 'none' && mode !== 'same' && mode !== 'depends') { errors['mode'] = 'required'; return done({ q, mode: 'none', qty: null }); }
      let qty: number | null = null;
      if (mode === 'same') {
        const n = Number(text(body['qty']).replace(/[,\s]/g, ''));
        if (!Number.isInteger(n) || n < 1) errors['qty'] = 'qty';
        else qty = n;
      }
      return done({ q, mode, qty });
    }
    case 'returns':
    case 'delivery': {
      const offers = (PROMISES_OF[q] ?? []).filter((k) => ticked(body, `offer:${k}`));
      return done({ q, offers, told: told() });
    }
    case 'payment': {
      if (paysByTerms(ctx)) {
        const v = validateTradeTerms({ payment: text(body['payment']), incoterm: text(body['incoterm']), now: new Date(0) });
        if (!v.ok) errors[v.error === 'incoterm_invalid' ? 'incoterm' : 'payment'] = v.error;
        return done({ q, told: '', terms: v.ok ? { payment: v.value.paymentTerms, incoterm: v.value.incoterm } : null });
      }
      const v = told();
      if (!v && !errors['told']) errors['told'] = 'required';
      return done({ q, told: v, terms: null });
    }
    case 'certifications':
      return done({ q, keys: CERT_KEYS.filter((k) => ticked(body, `cert:${k}`)) });
    case 'hours': {
      const hours = text(body['hours']);
      if (hours.length > MAX_HOURS) errors['hours'] = 'too_long';
      const closures: { label: string; from: string; to: string }[] = [];
      for (let i = 0; i < MAX_CLOSURES; i++) {
        const label = text(body[`closure${i}.label`]), from = text(body[`closure${i}.from`]), to = text(body[`closure${i}.to`]);
        if (!label && !from && !to) continue;
        const v = validateClosure({ label, from, to });
        if (!v.ok) errors[`closure${i}`] = v.error;
        else closures.push({ label: v.value.label, from, to });
      }
      if (!hours && closures.length === 0 && Object.keys(errors).length === 0) errors['hours'] = 'required';
      return done({ q, hours: hours.slice(0, MAX_HOURS), closures });
    }
    case 'words': {
      const seen = new Set<string>();
      const terms = text(body['terms']).split(/\r?\n/).map((w) => w.trim()).filter((w) => {
        const k = w.toLowerCase();
        if (!w || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (terms.length === 0) errors['terms'] = 'required';
      else if (terms.length > MAX_WORDS) errors['terms'] = 'too_many';
      else if (terms.some((w) => w.length > 80)) errors['terms'] = 'too_long';
      return done({ q, terms });
    }
    case 'offered':
    case 'area':
    case 'duration':
    case 'next_step': {
      const v = told();
      if (!v && !errors['told']) errors['told'] = 'required';
      return done({ q, told: v });
    }
  }
}

/** What is in force now, read before the lines are drawn: a line is drawn only for what would change. */
export type SellingState = {
  readonly quantityFirst: boolean;
  readonly products: readonly { readonly id: string; readonly name: string; readonly moq: number | null }[];
  /** `${kind}:${key}` of every allowed claim. */
  readonly allowed: ReadonlySet<string>;
  readonly terms: { readonly payment: string; readonly incoterm: string } | null;
  readonly workingHours: string | null;
  readonly closures: readonly { readonly label: string; readonly from: string; readonly to: string }[];
  /** Lower-cased forbidden terms in force. */
  readonly words: ReadonlySet<string>;
  /** The answer this flow last wrote for a question, as customers receive it. */
  readonly told: Readonly<Partial<Record<Question, string>>>;
};

export type Line =
  | { readonly key: string; readonly kind: 'quantity_first'; readonly to: boolean }
  | { readonly key: string; readonly kind: 'minimum'; readonly productId: string; readonly product: string; readonly from: number | null; readonly to: number | null }
  | { readonly key: string; readonly kind: 'promise' | 'cert'; readonly claimKind: ClaimKind; readonly claim: string; readonly to: boolean }
  | { readonly key: string; readonly kind: 'terms'; readonly payment: string; readonly incoterm: string }
  | { readonly key: string; readonly kind: 'hours'; readonly text: string }
  | { readonly key: string; readonly kind: 'closure'; readonly label: string; readonly from: string; readonly to: string }
  | { readonly key: string; readonly kind: 'word'; readonly term: string }
  | {
      readonly key: string; readonly kind: 'told'; readonly question: Question; readonly text: string;
      /** The figures in it, exactly as written: sent as they are. */
      readonly figures: readonly string[];
      /** Every promise in it, and whether she allows it once this answer's own lines are saved. */
      readonly promises: readonly { readonly claim: string; readonly allowed: boolean }[];
    };

/** The figures a text states, as written ("14", "3–5" gives 3 and 5). */
export function figuresIn(s: string): string[] {
  return [...new Set(extractNumerals(s).map((n) => (n.at ? s.slice(n.at[0], n.at[1]) : String(n.value)).trim()).filter(Boolean))];
}

/** The lines an answer would write, given what is in force. Empty: nothing would change. */
export function linesFor(answer: Answer, state: SellingState): Line[] {
  const lines: Line[] = [];
  const allowedAfter = new Set(state.allowed);
  const claimLine = (kind: 'promise' | 'cert', claimKind: ClaimKind, claim: string, to: boolean) => {
    const id = `${claimKind}:${claim}`;
    if (state.allowed.has(id) !== to) lines.push({ key: `${kind}:${claim}`, kind, claimKind, claim, to });
    if (to) allowedAfter.add(id); else allowedAfter.delete(id);
  };
  const told = (q: Question, said: string) => {
    if (!said || said === state.told[q]) return;
    const promises = [...new Map(detectClaims(said).map((c) => [`${c.kind}:${c.claimKey}`, c])).values()]
      .map((c) => ({ claim: c.claimKey, allowed: allowedAfter.has(`${c.kind}:${c.claimKey}`) }));
    lines.push({ key: `told:${q}`, kind: 'told', question: q, text: said, figures: figuresIn(said), promises });
  };
  switch (answer.q) {
    case 'price':
      if (answer.quantityFirst !== state.quantityFirst) lines.push({ key: 'quantity_first', kind: 'quantity_first', to: answer.quantityFirst });
      break;
    case 'minimum': {
      if (answer.mode === 'depends') break;
      const to = answer.mode === 'same' ? answer.qty : null;
      for (const p of state.products) {
        if (p.moq !== to) lines.push({ key: `minimum:${p.id}`, kind: 'minimum', productId: p.id, product: p.name, from: p.moq, to });
      }
      break;
    }
    case 'returns':
    case 'delivery':
      for (const k of PROMISES_OF[answer.q] ?? []) claimLine('promise', promiseKind(k), k, answer.offers.includes(k));
      told(answer.q, answer.told);
      break;
    case 'payment':
      if (answer.terms) {
        if (state.terms?.payment !== answer.terms.payment || state.terms?.incoterm !== answer.terms.incoterm) {
          lines.push({ key: 'terms', kind: 'terms', payment: answer.terms.payment, incoterm: answer.terms.incoterm });
        }
      } else told('payment', answer.told);
      break;
    case 'certifications':
      for (const k of CERT_KEYS) claimLine('cert', certKind(k), k, answer.keys.includes(k));
      break;
    case 'hours': {
      if (answer.hours && answer.hours !== (state.workingHours ?? '')) lines.push({ key: 'hours', kind: 'hours', text: answer.hours });
      answer.closures.forEach((c, i) => {
        if (!state.closures.some((x) => x.label === c.label && x.from === c.from && x.to === c.to)) {
          lines.push({ key: `closure:${i}`, kind: 'closure', ...c });
        }
      });
      break;
    }
    case 'words':
      for (const term of answer.terms) {
        if (!state.words.has(term.toLowerCase())) lines.push({ key: `word:${term.toLowerCase()}`, kind: 'word', term });
      }
      break;
    case 'offered':
    case 'area':
    case 'duration':
    case 'next_step':
      told(answer.q, answer.told);
      break;
  }
  return lines;
}

/** The ticked lines, by key, from the confirm form; a key the lines do not hold is ignored. */
export function tickedLines(lines: readonly Line[], body: Record<string, unknown>): Line[] {
  return lines.filter((l) => text(body[`line:${l.key}`]) === 'on');
}

/** The next question after this one, for this business; null at the end. */
export function nextQuestion(order: readonly Question[], q: Question, done: ReadonlySet<Question>): Question | null {
  const after = order.slice(order.indexOf(q) + 1).find((x) => !done.has(x));
  return after ?? order.find((x) => x !== q && !done.has(x)) ?? null;
}
