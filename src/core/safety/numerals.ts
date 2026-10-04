import { type Result, ok, err } from '../types/result.js';
import type { Quote } from '../types/commerce.js';
import { type Currency, DOT_THOUSANDS } from '../types/money.js';
import type { ConversationState } from '../types/conversation.js';
import { ownSku } from '../owner/sku.js';

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
    /\d[\d,]*(?:\.\d+)?\s*(?:[₹₩₽₺₫₪]|(?:aed|sar|qar|kwd|omr|bhd|egp|inr|idr|gbp|hkd|aud|cad|sgd|jpy|cny|try|mxn|brl)\b|درهم|دراهم|ريال|دينار|جنيه|روبية|بيزو|元|块|美元|欧元|英镑)/.source,
    /(?:aed|sar|qar|kwd|omr|bhd|egp|inr|idr|gbp|hkd|aud|cad|sgd|jpy|cny|try|mxn|brl)\s*\d[\d,]*(?:\.\d+)?/.source,
    // CUR — the new currencies' own marks: "Rp 150.000", "Rs 500", "R$ 49",
    // and their names, so a small figure beside them is a price too.
    /(?:\brp\.?|\brs\.?|د\.إ|ر\.س)\s*\d[\d.,]*/.source,
    /\d[\d.,]*\s*(?:rupiah|rupees?|reais|pesos?|riyals?|dirhams?)\b/.source,
    /\d[\d,]*(?:\.\d+)?\s*%/.source,                             // 12%, 5 %
    /\d[\d,]*(?:\.\d+)?\s*(?:percent|dollars?|usd|rmb|yuan|euros?|por\s+ciento|por\s+cento|pour\s+cent|d[oó]lares|dollars?\s+am[ée]ricains?)/.source,
    // Spanish, French and Portuguese: "descuento del 3", "une remise de 5", "desconto de 10".
    /(?:descuento|rebaja|dep[oó]sito|anticipo|remise|r[ée]duction|acompte|frais|desconto|abatimento|sinal|entrada)\s+(?:de(?:l)?\s+|d['’])?\d[\d,]*(?:\.\d+)?/.source,
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

export type ExtractedNumeral = {
  readonly value: number;
  readonly commercial: boolean;
  /** CUR — where it stands in the text: the currency beside it is read from there. */
  readonly at?: readonly [number, number];
};

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

/** Where a figure would stand in a commercial position: every COMMERCIAL_CONTEXT match. */
function commercialSpansOf(text: string): Array<[number, number]> {
  return [...text.matchAll(COMMERCIAL_CONTEXT)].map((m) => [m.index, m.index + m[0].length]);
}

export function extractNumerals(raw: string): ExtractedNumeral[] {
  const text = asciiDigits(raw);
  const commercialSpans = commercialSpansOf(text);
  const inCommercialSpan = (start: number, end: number): boolean =>
    commercialSpans.some(([s, e]) => start < e && end > s);

  const out: ExtractedNumeral[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    out.push({ value: n, commercial: inCommercialSpan(m.index, m.index + m[0].length), at: [m.index, m.index + m[0].length] });
  }
  for (const m of text.matchAll(ZH_FIGURE)) {
    const n = zhNumber(m[0]);
    if (n === null) continue;
    const end = m.index + m[0].length;
    out.push({ value: n, commercial: ZH_MONEY.test(text.slice(end)) || inCommercialSpan(m.index, end), at: [m.index, end] });
  }
  return out;
}

/**
 * CUR (2026-09-30) — ONE CURRENCY PER WORKSPACE, NO CONVERSION. A price is
 * sourced only in the currency it was worked out in: "$12" for a quote of
 * AED 12 is the right number in the wrong money, and it reaches a customer as
 * a price nobody set. The marks below say which of this product's currencies
 * the words beside a figure can mean — "$" is the dollar AND the peso, "¥" the
 * yuan, "ريال" the riyal; a mark for money this product does not hold (€, £,
 * euros, 日元) means none of them. Longest first, so "R$" is never read as "$".
 * A three-letter code of someone else's money is matched in capitals only:
 * "try", "mad" and "won" are English words.
 */
type Mark = { readonly re: string; readonly means: readonly Currency[]; readonly word?: true; readonly caps?: true };
const MARKS: readonly Mark[] = [
  { re: 'US\\$', means: ['USD'] }, { re: 'R\\$', means: ['BRL'] }, { re: 'MEX\\$|MX\\$', means: ['MXN'] },
  { re: '(?:HK|NT|NZ|C|A|S)\\$', means: [] }, { re: '[$＄]', means: ['USD', 'MXN'] },
  { re: '[€£₩₽₺₫₪₱₦฿]', means: [] }, { re: '[¥￥]', means: ['CNY'] }, { re: '₹', means: ['INR'] },
  { re: 'د\\.إ\\.?', means: ['AED'] }, { re: 'ر\\.س\\.?', means: ['SAR'] },
  { re: 'usd|dollars?|d[oó]lares', means: ['USD'], word: true },
  { re: 'cny|rmb|yuan|renminbi', means: ['CNY'], word: true },
  { re: 'aed|dirhams?|dhs?', means: ['AED'], word: true },
  { re: 'sar|riyals?', means: ['SAR'], word: true },
  { re: 'brl|reais', means: ['BRL'], word: true },
  { re: 'mxn|pesos', means: ['MXN'], word: true },
  { re: 'inr|rupees?|rs\\.?', means: ['INR'], word: true },
  { re: 'idr|rupiah|rp\\.?', means: ['IDR'], word: true },
  { re: 'euros?|pounds sterling|yen', means: [], word: true },
  { re: 'EUR|GBP|JPY|HKD|AUD|CAD|SGD|NZD|CHF|QAR|KWD|OMR|BHD|EGP|MAD|TRY|KRW|RUB|VND|THB|PHP|MYR|PKR|NGN|KES|ZAR|TWD', means: [], word: true, caps: true },
  { re: '美元|美金', means: ['USD'] }, { re: '人民币|元|块', means: ['CNY'] },
  { re: '欧元|英镑|日元|港元|港币|韩元|卢布', means: [] },
  { re: '迪拉姆', means: ['AED'] }, { re: '里亚尔', means: ['SAR'] }, { re: '雷亚尔', means: ['BRL'] },
  { re: '比索', means: ['MXN'] }, { re: '卢比', means: ['INR'] }, { re: '印尼盾', means: ['IDR'] },
  { re: 'دولار(?:ات)?', means: ['USD'] }, { re: 'درهم|دراهم', means: ['AED'] },
  { re: 'ريال(?:ات)?\\s+برازيلي(?:ة)?', means: ['BRL'] }, { re: 'ريال(?:ات)?', means: ['SAR'] },
  { re: 'روبية\\s+إندونيسية', means: ['IDR'] }, { re: 'روبية', means: ['INR', 'IDR'] },
  { re: 'بيزو', means: ['MXN'] }, { re: 'يوان', means: ['CNY'] }, { re: 'يورو|جنيه|دينار', means: [] },
];
const markRe = (m: Mark, side: 'before' | 'after'): RegExp => {
  const flags = m.caps ? 'u' : 'iu';
  return side === 'before'
    ? new RegExp(`${m.word ? '(?<![\\p{L}])' : ''}(?:${m.re})\\s*$`, flags)
    : new RegExp(`^\\s*(?:${m.re})${m.word ? '(?![\\p{L}])' : ''}`, flags);
};
const BEFORE = MARKS.map((m) => ({ re: markRe(m, 'before'), means: m.means }));
const AFTER = MARKS.map((m) => ({ re: markRe(m, 'after'), means: m.means }));

/**
 * The currencies the words right beside a figure can mean, or null when they
 * name none. `text` is the text the figure's `at` indexes (digits made ASCII).
 */
export function currencyBeside(text: string, at: readonly [number, number]): readonly Currency[] | null {
  const before = text.slice(Math.max(0, at[0] - 16), at[0]);
  const after = text.slice(at[1], at[1] + 24);
  const named: Currency[][] = [];
  const b = BEFORE.find((m) => m.re.test(before));
  if (b) named.push([...b.means]);
  const a = AFTER.find((m) => m.re.test(after));
  if (a) named.push([...a.means]);
  if (named.length === 0) return null;
  // "$12 USD": both marks must allow it.
  return named.reduce((x, y) => x.filter((c) => y.includes(c)));
}

/**
 * CUR — Brazil and Indonesia write "R$ 1.250,50" and "Rp 150.000". For a quote
 * in their currency the SAME figure may be written that way; the ordinary
 * reading would take "150.000" for 150 and hold a right reply. Each such
 * figure, read their way, with its place in the text.
 */
const DOT_FIGURE = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2})(?![\d.,]*\d)/g;
function dotFigures(text: string): { value: number; at: [number, number] }[] {
  const out: { value: number; at: [number, number] }[] = [];
  for (const m of text.matchAll(DOT_FIGURE)) {
    const value = Number(m[1]!.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(value)) out.push({ value, at: [m.index, m.index + m[0].length] });
  }
  return out;
}

/** Two figures the guard counts as the same one. */
export const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * PC (2026-10-04, the owner's decision; docs/PRODUCT-CODE-CHECK.md) — A
 * PRODUCT'S OWN WORDS ARE NOT A FIGURE ANYBODY INVENTED.
 *
 * "The ZX-300 comes in blue" was held for its 300, and every product of the
 * live workspace carried such a figure in its name or code. The exemption is by
 * TEXT, never by VALUE: an exact occurrence of this business's own product name,
 * or of a code the owner typed herself, is set aside before the figures are
 * checked, and every figure outside it is checked exactly as before. The code's
 * 300 is never added to the sourced values, so "The ZX-300 is $300 each" is
 * still held for its $300, and "We can do 300 pieces" for its 300.
 *
 * A product as the exemption reads it: the names it is written under, in every
 * language a column holds, and its code.
 */
export type ProductWords = {
  readonly names: readonly (string | null)[];
  readonly sku: string | null;
};

/**
 * The catalogue text the guard may set aside: every name, and the owner's OWN
 * codes. A code the import made up (CC-31, `ownSku`) is never shown to a
 * customer, so a reply that carries one is still held for its figures.
 */
export function catalogueWords(products: readonly ProductWords[]): string[] {
  const out = new Set<string>();
  for (const p of products) {
    for (const n of p.names) if (n && n.trim() !== '') out.add(n.trim());
    const own = ownSku(p.sku);
    if (own) out.add(own.trim());
  }
  return [...out];
}

/** A base character with its marks, folded as one: "é" and "é" are the same letter. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

/**
 * The text as the exemption compares it: NFKC, lower case, every digit ASCII
 * (Arabic-Indic and Persian as the guard reads them, full-width by NFKC),
 * invisible format marks dropped, whitespace runs one space. `from[i]`/`to[i]`
 * give, for the i-th folded code unit, the span of the original it came from.
 */
function fold(raw: string): { text: string; from: number[]; to: number[] } {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  for (const m of raw.matchAll(CLUSTER)) {
    const start = m.index, end = start + m[0].length;
    let f = asciiDigits(m[0].normalize('NFKC').toLowerCase()).replace(/\p{Cf}/gu, '');
    if (f === '') continue;
    if (/^\s+$/u.test(f)) {
      if (text.endsWith(' ')) { to[to.length - 1] = end; continue; }
      f = ' ';
    }
    for (let k = 0; k < f.length; k++) { text += f[k]; from.push(start); to.push(end); }
  }
  return { text, from, to };
}

const charAt = (s: string, i: number): string | undefined => {
  const c = s.codePointAt(i);
  return c === undefined ? undefined : String.fromCodePoint(c);
};
const charBefore = (s: string, i: number): string | undefined => {
  if (i <= 0) return undefined;
  const lo = s.charCodeAt(i - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && i >= 2 ? s.slice(i - 2, i) : s[i - 1];
};

/** Scripts written without spaces between words: a name inside them needs none around it. */
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}]/u;
const WORDISH = /[\p{L}\p{N}\p{M}]/u;
const SCRIPTS = [/\p{sc=Latin}/u, /\p{sc=Arabic}/u, /\p{sc=Cyrillic}/u, /\p{sc=Greek}/u, /\p{sc=Hebrew}/u, /\p{sc=Hangul}/u, /\p{sc=Devanagari}/u];
const scriptOf = (c: string): number => SCRIPTS.findIndex((re) => re.test(c));

/**
 * Would a name ending between these two characters be part of a longer word?
 * A letter or digit beside a letter or digit is one word — "ZX-300" is not in
 * "ZX-3000", nor "12oz natural" in "12oz naturals" — except a letter beside a
 * letter of another script (a Latin code inside Arabic), and Chinese, Japanese
 * and Thai, which put no space between words.
 */
function glued(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (!WORDISH.test(a) || !WORDISH.test(b)) return false;
  if (UNSPACED.test(a) || UNSPACED.test(b)) return false;
  if (/\p{L}/u.test(a) && /\p{L}/u.test(b)) return scriptOf(a) === scriptOf(b);
  return true;
}

/**
 * A name or code that could carry a price is never set aside: money (the
 * guard's own marks, below), a percent, or the words for a price, a discount,
 * a minimum, a deposit or a fee — en, zh, ar, es, fr and pt.
 */
const MONEY_IN_NAME: readonly RegExp[] = [
  ...MARKS.map((m) => new RegExp(`${m.word ? '(?<![\\p{L}])' : ''}(?:${m.re})${m.word ? '(?![\\p{L}])' : ''}`, m.caps ? 'u' : 'iu')),
  /[%٪]/u,
  /(?<![\p{L}\p{N}])(?:prices?|priced|pricing|costs?|discount(?:s|ed)?|off|sale|minimum|min\.|moq|deposit|fees?|percent|precios?|descuentos?|rebajas?|m[ií]nim[oa]s?|dep[oó]sitos?|anticipo|oferta|prix|remises?|r[ée]ductions?|acompte|frais|soldes?|promo|pre[çc]os?|descontos?)(?![\p{L}])/iu,
  /价|元|折扣|打折|优惠|起订|最低|定金|订金|运费/u,
  /سعر|أسعار|اسعار|ثمن|خصم|تخفيض|أدنى|ادنى|عربون|رسوم/u,
];

/**
 * May this catalogue text be set aside at all? Only a name with letters in it
 * (a bare figure is a value, never a name), with a figure to set aside, and
 * with nothing in it that could make one of its figures a price.
 */
function exemptable(entry: string): boolean {
  const t = asciiDigits(entry.normalize('NFKC'));
  if (!/\p{L}/u.test(t)) return false;
  const figures = extractNumerals(t);
  if (figures.length === 0) return false;
  if (figures.some((n) => n.commercial || (n.at && currencyBeside(t, n.at) !== null))) return false;
  return !MONEY_IN_NAME.some((re) => re.test(t));
}

/** Where `reply` holds, exactly and as a whole word, this business's own catalogue text. */
function catalogueSpans(reply: string, catalogue: readonly string[]): Array<[number, number]> {
  if (catalogue.length === 0) return [];
  const r = fold(reply);
  const spans: Array<[number, number]> = [];
  for (const entry of catalogue) {
    const name = fold(entry).text.trim();
    if (name === '' || !r.text.includes(name) || !exemptable(entry)) continue;
    for (let i = r.text.indexOf(name); i !== -1; i = r.text.indexOf(name, i + 1)) {
      const j = i + name.length;
      if (glued(charBefore(r.text, i), charAt(r.text, i)) || glued(charBefore(r.text, j), charAt(r.text, j))) continue;
      spans.push([r.from[i]!, r.to[j - 1]!]);
    }
  }
  return spans;
}

/**
 * Which figures of the reply stand inside the business's own catalogue text,
 * and may be set aside. Never one in a commercial position: not as the reply
 * is written, and not with the name's own words taken away ("Minimum order:
 * Tote 300" is a minimum of 300, whatever the product is called), and never
 * one with money beside it.
 */
function catalogueFigures(reply: string, text: string, catalogue: readonly string[]): (n: ExtractedNumeral) => boolean {
  const spans = catalogueSpans(reply, catalogue);
  if (spans.length === 0) return () => false;
  const figures = extractNumerals(text).flatMap((n) => (n.at ? [n.at] : []));
  const inSpan = (k: number): boolean => spans.some(([s, e]) => k >= s && k < e);
  const inFigure = (k: number): boolean => figures.some(([s, e]) => k >= s && k < e);
  // The reply with each name's words blanked and its figures left where they stand.
  let bare = '';
  for (let k = 0; k < text.length; k++) bare += inSpan(k) && !inFigure(k) ? ' ' : text[k];
  const commercialBare = commercialSpansOf(bare);
  return (n) => {
    if (!n.at || n.commercial) return false;
    const [a, b] = n.at;
    if (!spans.some(([s, e]) => a >= s && b <= e)) return false;
    if (commercialBare.some(([s, e]) => a < e && b > s) || ZH_MONEY.test(bare.slice(b))) return false;
    return currencyBeside(text, n.at) === null && currencyBeside(bare, n.at) === null;
  };
}

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
  /**
   * PC — this business's own catalogue text (`catalogueWords`): its product
   * names and the owner's own codes. Their exact words are set aside; their
   * figures are never sourced values.
   */
  catalogue?: readonly string[];
}): Result<string, NumeralViolation> {
  const { reply, quote, state, clientText, allow = [], catalogue = [] } = input;

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

  // CUR — the quote's currency is the only one a price is said in. A figure
  // the words beside it put in another currency is unsourced, whatever its
  // value — unless the customer wrote that figure themselves (they may quote
  // their own budget in their own money back at us).
  const currency = quote?.unitPrice.currency ?? null;
  const text = asciiDigits(reply);
  const theirs = extractNumerals(clientText).map((n) => n.value);
  const foreign = (n: ExtractedNumeral): boolean => {
    if (currency === null || !n.at) return false;
    const named = currencyBeside(text, n.at);
    return named !== null && !named.includes(currency) && !theirs.some((c) => near(c, n.value));
  };
  // A figure written the Brazilian or Indonesian way, in a quote of theirs,
  // counts for what it says there ("Rp 150.000" is 150000).
  const covered = currency !== null && DOT_THOUSANDS.has(currency)
    ? dotFigures(text).filter((d) => sourced.some((s) => near(s, d.value))
      && !foreign({ value: d.value, commercial: true, at: d.at }))
    : [];
  const inCovered = (n: ExtractedNumeral): boolean =>
    !!n.at && covered.some((d) => n.at![0] >= d.at[0] && n.at![1] <= d.at[1]);
  // PC — a figure that is part of her own product's name or code.
  const ownWords = catalogueFigures(reply, text, catalogue);

  const unsourced = extractNumerals(reply)
    .filter((n) => {
      if (inCovered(n)) return false;
      if (foreign(n)) return true;
      if (ownWords(n)) return false;
      // Commercial position ("12%", "$7", "5% off"): the small-integer
      // allowlist does NOT apply. Every such figure must be sourced.
      return !isSafeSmall(n) && !sourced.some((s) => near(s, n.value));
    })
    .map((n) => n.value);

  return unsourced.length === 0
    ? ok(reply)
    : err({ kind: 'unsourced_numeral', numerals: unsourced, reply });
}
