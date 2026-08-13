import { type Result, ok, err } from '../types/result.js';
import type { Quote } from '../types/commerce.js';
import type { ConversationState } from '../types/conversation.js';

/**
 * THE ENFORCEMENT POINT FOR PRINCIPLE 2.
 *
 * "The LLM never generates prices, MOQ values, discounts, lead times, shipping
 * costs, or business commitments" is, without this function, a comment in a
 * document. Nothing in the n8n system enforced it: the response model was handed
 * price and MOQ in context and asked to write free-form prose. A hallucinated
 * unit price, in writing, to a B2B buyer, is a commercial and legal exposure —
 * and prompt injection makes it reachable ON PURPOSE.
 *
 * With this guard, a number that did not come from SQL cannot physically reach a
 * customer. It also largely defuses prompt injection, because the model no
 * longer has the authority to commit to anything.
 */

export type NumeralViolation = {
  readonly kind: 'unsourced_numeral';
  readonly numerals: readonly number[];
  readonly reply: string;
};

/**
 * Numbers that are never commercially meaningful and would be noise to flag —
 * UNLESS they appear in a commercial position (see `commercial` below).
 */
const SAFE_SMALL_INTEGERS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

/**
 * A numeral in a commercial position — "12%", "$7", "7 dollars", "5% off",
 * "discount of 3" — is NEVER safe-small. A hallucinated single-digit discount
 * is exactly as much of an invented commitment as a hallucinated price; the
 * small-integer allowlist must not create a hole for it.
 */
const COMMERCIAL_CONTEXT = new RegExp(
  [
    /[$€£¥]\s*\d[\d,]*(?:\.\d+)?/.source,                       // $7, ¥1,200
    /\d[\d,]*(?:\.\d+)?\s*%/.source,                             // 12%, 5 %
    /\d[\d,]*(?:\.\d+)?\s*(?:percent|dollars?|usd|rmb|yuan|euros?)/.source,
    /(?:discount|off|deposit|surcharge|fee)\s+(?:of\s+)?\d[\d,]*(?:\.\d+)?/.source,
  ].join('|'),
  'gi',
);

export type ExtractedNumeral = { readonly value: number; readonly commercial: boolean };

/**
 * Extract numerals with position context:
 * "5,000" -> 5000 · "0.45" -> 0.45 · "12%" -> 12 (commercial)
 */
export function extractNumerals(text: string): ExtractedNumeral[] {
  const commercialSpans: Array<[number, number]> = [];
  for (const m of text.matchAll(COMMERCIAL_CONTEXT)) {
    commercialSpans.push([m.index, m.index + m[0].length]);
  }
  const inCommercialSpan = (start: number, end: number): boolean =>
    commercialSpans.some(([s, e]) => start < e && end > s);

  const out: ExtractedNumeral[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    out.push({ value: n, commercial: inCommercialSpan(m.index, m.index + m[0].length) });
  }
  return out;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * Every numeral in `reply` must trace to the quote, the conversation state, or
 * something the client themselves said. Anything else means the model invented
 * a commercial fact, and the reply must not be sent.
 */
export function guardNumerals(input: {
  reply: string;
  quote: Quote | null;
  state: ConversationState;
  /** The client's own message — they may quote numbers back at us. */
  clientText: string;
  /** Extra values the caller knows are legitimate (e.g. an order reference). */
  allow?: readonly number[];
}): Result<string, NumeralViolation> {
  const { reply, quote, state, clientText, allow = [] } = input;

  const sourced: number[] = [
    ...allow,
    ...extractNumerals(clientText).map((n) => n.value), // the client's own figures
  ];

  if (quote) {
    sourced.push(
      quote.unitPrice.amount,
      quote.total.amount,
      quote.discountPct,
      quote.moq,
      quote.quantity.value,
    );
    if (quote.leadTimeDays !== null) sourced.push(quote.leadTimeDays);
  }
  if (state.quantity) sourced.push(state.quantity.value);

  const unsourced = extractNumerals(reply)
    .filter((n) => {
      // Commercial position ("12%", "$7", "5% off"): the small-integer
      // allowlist does NOT apply. Every such figure must be sourced.
      const safeSmall = !n.commercial && SAFE_SMALL_INTEGERS.has(n.value);
      return !safeSmall && !sourced.some((s) => near(s, n.value));
    })
    .map((n) => n.value);

  return unsourced.length === 0
    ? ok(reply)
    : err({ kind: 'unsourced_numeral', numerals: unsourced, reply });
}
