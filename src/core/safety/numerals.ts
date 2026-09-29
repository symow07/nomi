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

/** A figure the guard lets pass as an ordinary word (the owner's page lists no source for it). */
export const isSafeSmall = (n: ExtractedNumeral): boolean => !n.commercial && SAFE_SMALL_INTEGERS.has(n.value);

/**
 * A numeral in a commercial position — "12%", "$7", "7 dollars", "5% off",
 * "discount of 3" — is NEVER safe-small. A hallucinated single-digit discount
 * is exactly as much of an invented commitment as a hallucinated price; the
 * small-integer allowlist must not create a hole for it.
 */
const COMMERCIAL_CONTEXT = new RegExp(
  [
    /[$€£¥]\s*\d[\d,]*(?:\.\d+)?/.source,                       // $7, ¥1,200
    // T2 — a small number beside ANY currency is a price: "9 AED" and "₹9"
    // passed as ordinary words. Symbols, ISO codes, and the words for them.
    /[₹₩₽₺₫₪]\s*\d[\d,]*(?:\.\d+)?/.source,
    /\d[\d,]*(?:\.\d+)?\s*(?:[₹₩₽₺₫₪]|(?:aed|sar|qar|kwd|omr|bhd|egp|inr|gbp|hkd|aud|cad|sgd|jpy|cny|try|mxn|brl)\b|درهم|دراهم|ريال|دينار|جنيه|元|块|美元|欧元|英镑)/.source,
    /(?:aed|sar|qar|kwd|omr|bhd|egp|inr|gbp|hkd|aud|cad|sgd|jpy|cny|try|mxn|brl)\s*\d[\d,]*(?:\.\d+)?/.source,
    /\d[\d,]*(?:\.\d+)?\s*%/.source,                             // 12%, 5 %
    /\d[\d,]*(?:\.\d+)?\s*(?:percent|dollars?|usd|rmb|yuan|euros?|por\s+ciento|pour\s+cent|d[oó]lares|dollars?\s+am[ée]ricains?)/.source,
    // Spanish and French: "descuento del 3", "une remise de 5".
    /(?:descuento|rebaja|dep[oó]sito|anticipo|remise|r[ée]duction|acompte|frais)\s+(?:de(?:l)?\s+|d['’])?\d[\d,]*(?:\.\d+)?/.source,
    /(?:discount|off|deposit|surcharge|fee)\s+(?:of\s+)?\d[\d,]*(?:\.\d+)?/.source,
    // 0081 — a MINIMUM ORDER is a commitment like a price: "minimum order is
    // 1" for a product with no minimum is as invented as "$1". A figure after
    // the word for it — en, zh, ar, es, fr — must be sourced (the product's
    // stated minimum), never waved through as a small number.
    /(?:minimum|moq|min\.)(?:\s+(?:order|quantity|purchase))*(?:\s+(?:is|of))?\s*[:：]?\s*\d[\d,]*/.source,
    /起订量?\s*[:：]?\s*\d[\d,]*|\d[\d,]*\s*(?:个|件|套|箱|双)?\s*起订/.source,
    /(?:ال)?حد\s*(?:ال)?أدنى[^\d\n]{0,16}\d[\d,]*/.source,
    /(?:pedido|compra|cantidad)\s+m[ií]nim[oa][^\d\n]{0,12}\d[\d,]*|m[ií]nimo\s+(?:de\s+)?\d[\d,]*/.source,
    /(?:commande|quantit[ée])\s+minim(?:um|ale)[^\d\n]{0,12}\d[\d,]*|minimum\s+de\s+(?:commande\s+)?\d[\d,]*/.source,
  ].join('|'),
  'gi',
);

export type ExtractedNumeral = { readonly value: number; readonly commercial: boolean };

/**
 * Extract numerals with position context:
 * "5,000" -> 5000 · "0.45" -> 0.45 · "12%" -> 12 (commercial)
 */
/**
 * T2 — Arabic-Indic digits (٠-٩, and the Persian ۰-۹) and their separators
 * read as the figures they are: "٥٠٠ قطعة" is 500, and it was invisible to
 * this guard. One character for one, so positions are kept.
 */
export function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹٫٬]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 0x066b) return '.';
    if (code === 0x066c) return ',';
    return String((code >= 0x06f0 ? code - 0x06f0 : code - 0x0660));
  });
}

const ZH_DIGIT: Readonly<Record<string, number>> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const ZH_UNIT: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };

/** "五百" → 500, "一千五百" → 1500, "十二" → 12, "两万" → 20000; null when it is not a number. */
function zhNumber(s: string): number | null {
  let total = 0, section = 0, digit = 0, seen = false;
  for (const ch of s) {
    const d = ZH_DIGIT[ch];
    const u = ZH_UNIT[ch];
    if (d !== undefined) { digit = d; seen = true; }
    else if (u !== undefined) { section += (seen ? digit : 1) * u; digit = 0; seen = false; }
    else if (ch === '万') { total += (section + digit) * 10_000; section = 0; digit = 0; seen = false; }
    else return null;
  }
  return total + section + digit;
}

/**
 * T2 — a figure written in Chinese numerals, where it counts something or
 * prices it: "五百个", "三十天", "十二元". Never inside a word that happens to
 * hold a numeral character — 一下, 一起, 一样, 万一, 十分 — which is why a unit
 * must follow. Before 元/块/美元/欧元 it is a price.
 */
const ZH_FIGURE = /[零〇一二两三四五六七八九十百千万]+(?=\s*(?:个|件|套|箱|双|只|条|张|台|米|厘米|天|周|个月|年|元|块|美元|欧元|%))/g;
const ZH_MONEY = /^\s*(?:元|块|美元|欧元)/;

export function extractNumerals(raw: string): ExtractedNumeral[] {
  const text = asciiDigits(raw);
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
  for (const m of text.matchAll(ZH_FIGURE)) {
    const n = zhNumber(m[0]);
    if (n === null) continue;
    const end = m.index + m[0].length;
    out.push({ value: n, commercial: ZH_MONEY.test(text.slice(end)) || inCommercialSpan(m.index, end) });
  }
  return out;
}

/** Two figures the guard counts as the same one. */
export const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

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
      quote.quantity.value,
    );
    // 0081 — a stated minimum is a sourced figure; no minimum adds nothing.
    if (quote.moq !== null) sourced.push(quote.moq);
    if (quote.leadTimeDays !== null) sourced.push(quote.leadTimeDays);
  }
  if (state.quantity) sourced.push(state.quantity.value);

  const unsourced = extractNumerals(reply)
    .filter((n) => {
      // Commercial position ("12%", "$7", "5% off"): the small-integer
      // allowlist does NOT apply. Every such figure must be sourced.
      return !isSafeSmall(n) && !sourced.some((s) => near(s, n.value));
    })
    .map((n) => n.value);

  return unsourced.length === 0
    ? ok(reply)
    : err({ kind: 'unsourced_numeral', numerals: unsourced, reply });
}
