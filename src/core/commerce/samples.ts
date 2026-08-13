import { type Money, type Currency, currencySymbol } from '../types/money.js';

/**
 * M45 — "Can you send a sample?"
 *
 * It is the second question in nearly every Yiwu conversation, after price, and
 * she meets it on day one of the pilot. Until now the product had no answer at
 * all: no sample cost, no policy, nothing. A language model asked that question
 * with nothing behind it will answer it anyway — plausibly, helpfully, and out
 * of nowhere. "Yes, samples are free, we just charge the courier" is a sentence
 * that costs her money every time a buyer holds her to it.
 *
 * ── THE FACTS ARE HERS ────────────────────────────────────────────────────
 *
 * Two things she states, and neither has a default:
 *
 *   price     — what a sample costs. Zero is a legitimate answer and it means
 *               FREE; absent means she has not said, which is not the same
 *               thing and must never be rendered as one.
 *   credited  — whether that cost comes off the first order. This is the half
 *               buyers actually negotiate on, and it is a real commitment: a
 *               $30 sample credited against a $9,000 order is a discount she
 *               agreed to in advance.
 *
 * The third moving part of a sample is the ADDRESS, and that one is the
 * BUYER's, not hers. It is captured on the request rather than stated in a
 * policy — see `sample_requests`. Nothing here infers an address from a
 * message: extracting a shipping address from free text is a guess with a
 * courier attached to it.
 *
 * ── AND SHE STATES THEM, OR NOMI SAYS NOTHING ─────────────────────────────
 *
 * Unstated is a refusal, enforced the same way M44's is: the numerals a reply
 * may contain come from what the owner has actually written down, so a sample
 * price she has not stated cannot appear in a sentence. There is no fallback
 * policy, no "usually free", no industry norm. This module invents nothing —
 * it is a small amount of arithmetic over two rows.
 *
 * NOT IN SCOPE, deliberately: courier accounts, shipping cost, tracking. Those
 * need watching how she actually ships, and a flow built on guesses about that
 * is worth less than a request that reaches her with the address attached.
 *
 * Pure per ADR-0002.
 */

/** What she states about samples. Both halves, or she has stated nothing. */
export type SamplePolicy = {
  /** What one sample costs. `amount: 0` means free — a real answer. */
  readonly price: Money;
  /** Does the cost come off the first order? */
  readonly creditedOnFirstOrder: boolean;
  /** When she stated it, so a change is visible as a change. */
  readonly statedAt: Date;
};

export type SampleRefusal = { readonly kind: 'no_sample_policy' };

/**
 * What a reply may say about samples, and which numbers it may contain.
 *
 * Shaped exactly like `quoteRefusalContext`: a note the deterministic fallback
 * can use, plus the ALLOWED numerals. Nothing outside `allow` can survive
 * `guardNumerals`, so this function is the only door a sample price has.
 */
export function sampleAnswerContext(
  policy: SamplePolicy | null,
): { ok: true; note: string; allow: readonly number[] } | { ok: false; error: SampleRefusal } {
  if (!policy) return { ok: false, error: { kind: 'no_sample_policy' } };

  const free = policy.price.amount === 0;
  const note = free
    ? (policy.creditedOnFirstOrder
      // Free AND credited is not a contradiction — she may credit the courier
      // cost she still charges — but it is very likely a mistake in her own
      // rules, so the sentence says only what is certain.
      ? 'Samples are free.'
      : 'Samples are free.')
    : (policy.creditedOnFirstOrder
      ? `A sample costs ${currencySymbol(policy.price.currency)}${policy.price.amount}, and that comes off the first order.`
      : `A sample costs ${currencySymbol(policy.price.currency)}${policy.price.amount}.`);

  // Zero is not offered as a numeral: "0" in a reply is never a price a buyer
  // needs to read, and allowing it widens the guard for nothing.
  return { ok: true, note, allow: free ? [] : [policy.price.amount] };
}

export type SamplePolicyError = 'price_missing' | 'not_a_number' | 'negative';

/**
 * What she typed.
 *
 * No upper bound. A $200 sample of a machined part is ordinary, and a ceiling
 * here would be this module holding an opinion about her goods. Negative is
 * refused because it is not a price; zero is accepted because it is an answer.
 */
export function validateSamplePolicy(input: {
  readonly price: string | number | null | undefined;
  readonly creditedOnFirstOrder: boolean;
  readonly currency: Currency;
  readonly now: Date;
}): { ok: true; value: SamplePolicy } | { ok: false; error: SamplePolicyError } {
  if (input.price === null || input.price === undefined) return { ok: false, error: 'price_missing' };
  const raw = typeof input.price === 'number' ? String(input.price) : input.price.trim();
  if (raw === '') return { ok: false, error: 'price_missing' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: 'not_a_number' };
  if (n < 0) return { ok: false, error: 'negative' };
  return {
    ok: true,
    value: {
      price: { amount: Number(n.toFixed(2)), currency: input.currency },
      creditedOnFirstOrder: input.creditedOnFirstOrder,
      statedAt: input.now,
    },
  };
}

/**
 * Did this buyer ask for a sample?
 *
 * DETERMINISTIC, and deliberately so. This decides whether the owner sees a
 * request in her inbox; a model deciding it would mean sample requests appear
 * and disappear between two identical messages. Phrases in the three languages
 * a Yiwu buyer actually writes in, plus the two spellings of the word itself.
 *
 * Matching is substring and case-insensitive, for the same reason the forbidden
 * list matches that way: Chinese does not delimit words with spaces, and a
 * missed request is a buyer left waiting while a false positive is one row the
 * owner glances at and ignores.
 */
const SAMPLE_PHRASES: readonly string[] = [
  // English
  'sample', 'samples', 'swatch',
  // 中文
  '样品', '样板', '打样', '寄样', '样单',
  // العربية
  'عينة', 'عينات', 'نموذج',
];

export function asksForSample(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return SAMPLE_PHRASES.some((p) => t.includes(p.toLowerCase()));
}
