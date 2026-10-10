import type { ExtractedLine } from './extract.js';
import { type Money, type Currency, DOT_THOUSANDS } from '../types/money.js';
/**
 * M6 — Tolerant catalog import. Messy Excel pastes, forwarded messages,
 * price-list photos (via the M4 vision path) — anything goes in; what comes
 * out is a CONFIRM list the owner approves. No rigid template, ever.
 *
 * Two stages: a deterministic line parser catches the common shapes for
 * free; an LLM extractor port handles the truly messy rest. Both feed the
 * same validator — nothing enters the catalog unvalidated or unconfirmed.
 */

export type ExtractedProduct = {
  /**
   * M22 (F-02) — the owner's OWN article number, when the line carried one.
   * This is how she, her buyers and her factory floor all refer to the product;
   * a generated `NEW-<timestamp>` in its place means she can no longer find her
   * own goods, and a re-import creates a second copy of everything.
   * null when the line had none — then, and only then, one is generated.
   */
  readonly sku: string | null;
  readonly name: string;
  readonly nameZh: string | null;
  /** null = owner must fill at confirm. M43a — a Money once it has one. */
  readonly price: Money | null;
  readonly moq: number | null;
  /**
   * M37 — the line this was read from, verbatim.
   *
   * Shown beside the extracted product so the owner checks a TRANSCRIPTION
   * rather than approving a list. That is M34's "Heard as" pattern applied to a
   * page: she can see that "ZX-100 帆布袋 $0.85 起订500" became those four
   * fields, and catch the one that did not.
   *
   * Optional so every existing caller is unchanged; the paste flow fills it too
   * because the same review screen serves both.
   */
  readonly sourceLine?: string;
  readonly unit: string;               // default 'pcs'
  /**
   * Phase 9 (V1-334) — the line held two products ("Mug 8 or bowl 12"): this is
   * the first or the second of them. Both keep the whole line as `sourceLine`,
   * and the review asks the owner to check each.
   */
  readonly half?: 1 | 2;
  /**
   * T4 — the line has a price this parser will not guess at: written two ways
   * at once (`1.250,00` in a dollar workspace), in a currency other than the
   * workspace's own (CUR: one currency per workspace, nothing converted), or a
   * spreadsheet row with several numbers and nothing saying which is the
   * price. The line is refused with that reason, never priced wrongly without
   * a word.
   */
  readonly problem?: ReadingProblem;
};

/** T4 — why a line's price was not read. Each is a reject reason the review names. */
export type ReadingProblem = 'ambiguous_price' | 'other_currency' | 'several_numbers';

/** LLM port for messy input (photos of price lists, rambling messages). */
/**
 * EXT — the model extractor, asked only by the owner and only for the lines
 * the parser could not make a product of. It returns, per line, what it read
 * and how sure it is of each field; `containExtracted` (./extract.ts) decides
 * what of that may become a row. Text in, never a photo: a page is first
 * transcribed (M37).
 */
export interface CatalogExtractor {
  extract(input: { readonly lines: readonly string[]; readonly currency: string }): Promise<{
    readonly items: readonly ExtractedLine[];
    readonly promptVersion: string; readonly modelId: string;
    readonly usage: { inputTokens: number; outputTokens: number };
  }>;
}

const UNIT_WORDS = 'pcs|pieces?|sets?|pairs?|boxes|cartons?|个|件|套|双|箱';

/** "Minimum order", as owners write it: MOQ, 起订, 最低, and Arabic «حد أدنى» / «الحد الأدنى». */
const MOQ_WORD = String.raw`(?:MOQ|起订|最低|(?:ال)?حد\s*(?:ال)?أدنى)`;

/**
 * T4 — a figure as written, read one way or refused. Thousands commas
 * (`1,250.00`) are thousands: that line was read as $1.00. A dot before
 * exactly three digits after a non-zero whole part, or both marks at once
 * (`1.250`, `1.250,00`), could be read two ways, and a wrong reading is a price
 * a customer is quoted — so it is refused. Sentence punctuation after the
 * figure is not part of it.
 *
 * The warmth run, phase 9 (V1-334) — a comma before exactly two digits and
 * nothing else (`24,50`) reads ONE way: no thousands group is two digits long
 * (the rupee's lakhs end in a group of three, "1,50,000"). It is how French and
 * Spanish write a price, and it is read as 24.50; the review flags the row for
 * its own tick (`decimal_comma`), so the owner sees the figure it became.
 */
function readAmount(raw: string, currency: Currency): number | 'ambiguous' {
  const s = raw.replace(/[.,]+$/, '');
  // CUR — reais and rupiah group thousands with a dot and mark decimals with a
  // comma ("R$ 1.250,50", "Rp 150.000"): there, one reading is the right one.
  if (DOT_THOUSANDS.has(currency)) {
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
    if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
    if (/^\d+(?:\.\d{1,2})?$/.test(s)) return Number(s);
    return 'ambiguous';
  }
  if (/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (DECIMAL_COMMA_FIGURE.test(s)) return Number(s.replace(',', '.'));
  if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) return 'ambiguous';
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return 'ambiguous';
}

/** Phase 9 (V1-334) — "24,50": a decimal comma and its cents, the only way such a figure reads. */
const DECIMAL_COMMA_FIGURE = /^\d+,\d{2}$/;

/**
 * Phase 9 (V1-334) — does this line carry a price written with a decimal comma
 * ("24,50"), in a currency whose own lists write a decimal point? The review
 * flags such a row, so the owner checks the figure it was read as.
 */
export function readWithDecimalComma(line: string, currency: Currency): boolean {
  return !DOT_THOUSANDS.has(currency) && /(?<![\d.,])\d+,\d{2}(?![\d]|[.,]\d)/.test(line);
}

/**
 * CUR — the marks each currency is written with. `before` and `after` are the
 * workspace's OWN (a figure beside them is its price); `tells` names that
 * currency so unmistakably that a line carrying it, in another workspace, is in
 * someone else's money. "$" is the dollar's and the peso's own, and no one's
 * tell: in a dirham workspace a bare "$" is still another currency, by the
 * rule below.
 */
const L = '(?<![A-Za-z])';
const E = '(?![A-Za-z])';
const MARKS: Readonly<Record<Currency, { readonly before: string; readonly after: string; readonly tells: string }>> = {
  USD: { before: `(?:US)?[$＄]|${L}USD\\s*`, after: `美元|美金|USD${E}`, tells: `${L}US[$＄]|${L}USD${E}|美元|美金` },
  MXN: { before: `(?:MX|MEX)?[$＄]|${L}MXN\\s*`, after: `MXN${E}|${L}pesos?${E}|比索`, tells: `${L}(?:MX|MEX)[$＄]|${L}MXN${E}|${L}pesos${E}|比索` },
  BRL: { before: `${L}R[$＄]|${L}BRL\\s*`, after: `BRL${E}|${L}reais${E}|雷亚尔`, tells: `${L}R[$＄]|${L}BRL${E}|${L}reais${E}|雷亚尔` },
  CNY: { before: `[¥￥]|${L}(?:RMB|CNY)\\s*`, after: `(?<![美欧港日韩澳加新台])元|块|人民币|${L}(?:RMB|CNY)${E}`, tells: `[¥￥]|(?<![美欧港日韩澳加新台])元|人民币|${L}(?:RMB|CNY)${E}` },
  AED: { before: `${L}AED\\s*|د\\.إ\\.?\\s*|${L}Dhs?\\.?\\s*`, after: `AED${E}|درهم|دراهم|${L}dirhams?${E}|${L}Dhs?${E}`, tells: `${L}AED${E}|د\\.إ|درهم|دراهم|${L}dirhams?${E}` },
  SAR: { before: `${L}SAR\\s*|ر\\.س\\.?\\s*|${L}SR\\s*`, after: `SAR${E}|ريال|${L}riyals?${E}|${L}SR${E}`, tells: `${L}SAR${E}|ر\\.س|ريال|${L}riyals?${E}` },
  INR: { before: `₹|${L}Rs\\.?\\s*|${L}INR\\s*`, after: `INR${E}|${L}rupees?${E}|卢比`, tells: `₹|${L}INR${E}|${L}Rs\\.?\\s*\\d|${L}rupees?${E}|卢比` },
  IDR: { before: `${L}Rp\\.?\\s*|${L}IDR\\s*`, after: `IDR${E}|${L}rupiah${E}|印尼盾`, tells: `${L}Rp\\.?\\s*\\d|${L}IDR${E}|${L}rupiah${E}|印尼盾` },
};
/** Money no workspace here sells in: the euro, the pound, the yen, other dollars. */
const NO_ONES = /[€£₩₽₺₫₪]|欧元|港元|港币|日元|韩元|澳元|加元|新元|台币|英镑|\b(?:EUR|GBP|JPY|HKD|AUD|CAD|SGD|TWD)\b/i;
const NO_ONES_CAPS = /(?<![A-Za-z])(?:CHF|NZD|QAR|KWD|OMR|BHD|EGP|MAD|TRY|KRW|RUB)(?![A-Za-z])/;
/** Dollars that are nobody's here — HK$, A$, C$, NT$, S$ — written as a prefix. */
const OTHER_DOLLAR = /(?<![A-Za-z])(?!(?:US|R|MX|MEX)[$＄])[A-Z]{1,3}[$＄]/;

type Reading = {
  readonly foreign: (line: string) => boolean;
  readonly before: RegExp; readonly after: RegExp;
  readonly beforeAll: RegExp; readonly afterAll: RegExp;
};
const READINGS = new Map<Currency, Reading>();
/** How a workspace in `currency` reads a line: its own marks, and everyone else's. */
function readingFor(currency: Currency): Reading {
  const known = READINGS.get(currency);
  if (known) return known;
  const own = MARKS[currency];
  const others = new RegExp((Object.keys(MARKS) as Currency[]).filter((c) => c !== currency).map((c) => MARKS[c].tells).join('|'), 'i');
  // A bare "$" is the dollar's or the peso's; anywhere else it is someone else's.
  const bareDollar = currency === 'USD' || currency === 'MXN' ? null : new RegExp(`${L}[$＄]\\s*\\d`);
  const r: Reading = {
    foreign: (line) => OTHER_DOLLAR.test(line) || NO_ONES.test(line) || NO_ONES_CAPS.test(line) || others.test(line)
      || (bareDollar !== null && bareDollar.test(line)),
    before: new RegExp(`(?:${own.before})\\s*(\\d[\\d.,]*)`, 'i'),
    after: new RegExp(`(\\d[\\d.,]*)\\s*(?:${own.after})`, 'i'),
    beforeAll: new RegExp(`(?:${own.before})\\s*\\d[\\d.,]*`, 'gi'),
    afterAll: new RegExp(`\\d[\\d.,]*\\s*(?:${own.after})`, 'gi'),
  };
  READINGS.set(currency, r);
  return r;
}
const NUMBER_CELL = /^\d[\d.,]*$/;

/**
 * Phase 9 (V1-334) — a price written with no sign at all, as most lists are
 * pasted: "Canvas tote 18.00", "Mug 2.50 each". Only a figure with exactly two
 * decimals, at the END of the line (an "each" after it allowed), is read — a
 * size ("500ml"), a quantity or a model number has no cents. Read through the
 * same `readAmount`, so "24,50" in a dollar workspace is refused as the
 * ambiguous figure T4 refuses with a sign, never priced. The review flags
 * every such row for its own tick (`no_sign`): nothing on the line said it
 * was money.
 */
const BARE_PRICE = /(?:^|\s)(\d{1,7}[.,]\d{2})(?:\s*(?:each|ea\.?|apiece|a\s+piece|per\s+(?:piece|pc|item|unit)|\/\s*(?:pc|pcs|piece|item|unit)|cada\s+un[oa]|c\/u|la\s+pi[eè]ce|l['’]unit[eé]|pi[eè]ce|每个|一个|\/个|للقطعة|لكل\s+قطعة))?\s*[.;]?\s*$/i;

/** Phase 9 — the bare figure at the end of a line, if that is how its price is written. */
export function barePrice(line: string): RegExpMatchArray | null {
  return line.includes('\t') ? null : line.match(BARE_PRICE);
}

/**
 * K1 — how many prices in the workspace's own currency a line carries. The
 * parser takes the first; a second is a struck price, a "was/now", or one price
 * per size ("Hoodie S-M $40 / L-XL $45"), and the review flags it. A figure
 * written with a sign on both sides ("$12 USD") is one price, not two.
 */
export function ownPriceCount(line: string, currency: Currency): number {
  const r = readingFor(currency);
  const starts = new Set<number>();
  for (const re of [r.beforeAll, r.afterAll]) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) {
      const at = m.index + m[0].search(/\d/);
      starts.add(at);
    }
  }
  return starts.size;
}

/**
 * An article number at the START of the line — where suppliers put it. Two
 * shapes, both requiring letters AND digits so a plain word or a bare quantity
 * can never be mistaken for one:
 *
 *   ZX-200, BAG-NW-001    dash-joined alphanumeric
 *   HX2035                letters followed by at least two digits
 *
 * Deliberately narrow. `A4 paper` keeps A4 in the name (one digit), `500ml cup`
 * is untouched (leads with digits), and 帆布袋 has no Latin prefix at all.
 * Guessing wrong here renames the owner's product, so it only fires when the
 * shape is unmistakable.
 */
const ARTICLE_NO = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+|[A-Za-z]{1,6}\d{2,})\s+/;
/** The hyphenated article number alone: the shape no price is ever written in. */
const CODE_FIRST = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\s+/;

/**
 * Deterministic parser for the shapes owners actually paste:
 *   帆布袋 1.05美元 500个起
 *   ZX-200 Thermos 500ml  $2.60  MOQ 1000
 *   保温杯\t2.6\t1000        (Excel tab row)
 * One product per line; unparseable lines are skipped, never fatal.
 *
 * M22 (F-02): a leading article number is kept AS the sku rather than glued
 * into the name. This is the shape the doc line above always showed and the
 * import always threw away.
 */
export function parsePriceLines(text: string, currency: Currency): readonly ExtractedProduct[] {
  const reading = readingFor(currency);
  const out: ExtractedProduct[] = [];
  for (const raw of text.split('\n')) {
    const whole = raw.trim();
    if (!whole || whole.length < 3) continue;
    // Phase 9 (V1-334) — "Mug 8 or bowl 12" is two products, each read on its own.
    const halves = twoProducts(whole);
    (halves ?? [whole]).forEach((line, i) => {
      const p = readLine(line, whole, reading, currency, halves !== null);
      if (p) out.push(halves ? { ...p, half: (i + 1) as 1 | 2 } : p);
    });
  }
  return out;
}

/**
 * Phase 9 (V1-334) — a line that names two products, each with its figure,
 * joined by "or" or "and" in the languages owners write their lists in: "Mug 8
 * or bowl 12", "Tote $18 and bag $24", "杯子 8元 或 碗 12元". Each half must start
 * with a letter, carry no figure but its last, and end in that figure — so a
 * size range ("Pillow 40 or 60"), a tab row or a "S-M $40 / L-XL $45" is never
 * cut in two. Null when the line is one product.
 */
const AND_OR = /\s+(?:or|and|ou|et|o|y|oder|und|ou bien|或者|或|和|أو)\s+/iu;
const HALF = /^(\p{L}[^\d]*?)\s*((?:[$＄¥￥€£₹]|US\$)?\s*\d+(?:[.,]\d{1,2})?\s*(?:美元|元|USD|درهم|ريال)?)\s*[.;]?$/u;
export function twoProducts(line: string): readonly [string, string] | null {
  if (line.includes('\t')) return null;
  const parts = line.split(AND_OR);
  if (parts.length !== 2) return null;
  const [a, b] = [parts[0]!.trim(), parts[1]!.trim()];
  const ok = (s: string) => {
    const m = HALF.exec(s);
    return m !== null && (m[1]!.match(/\p{L}/gu) ?? []).length >= 2;
  };
  return ok(a) && ok(b) ? [a, b] : null;
}

/** One product from one line (or one half of a line that holds two). */
function readLine(line: string, whole: string, reading: Reading, currency: Currency, half: boolean): ExtractedProduct | null {
  const article = line.match(ARTICLE_NO)?.[1] ?? null;

  // T4 — a price in any currency but the workspace's is refused, not ignored:
  // "18元" once came in as a product with no price, and "HK$25" as $25.
  //
  // Read without a leading code: an article number never carries the price or
  // its money, and "D1-FFF4AED6-TOTE" or "TA-3AED7" is a code, not dirhams
  // (found 2026-10-10: one test run in a thousand drew a SKU with "AED" in it,
  // and every line of the list was refused as another currency). Only the
  // hyphenated shape: a leading "AED12" may be a price, and is still read.
  const code = CODE_FIRST.exec(line);
  const priced = code ? line.slice(code[0].length) : line;
  let problem: ReadingProblem | null = reading.foreign(priced) ? 'other_currency' : null;
  let price: number | null = null;
  const written = priced.match(reading.before)?.[1] ?? priced.match(reading.after)?.[1] ?? null;
  if (!problem && written !== null) {
    const a = readAmount(written, currency);
    if (a === 'ambiguous') problem = 'ambiguous_price';
    else price = a;
  }

  // A spreadsheet row: the price is the one number after the name, or the
  // first of two when the second is a whole minimum ("保温杯\t2.6\t1000").
  // More numbers than that, and nothing marks the price: refused, not priced
  // from whichever came first.
  let rowMoq: string | null = null;
  if (!problem && price === null && line.includes('\t')) {
    const nums = line.split('\t').map((c) => c.trim()).filter(Boolean).slice(1).filter((c) => NUMBER_CELL.test(c));
    if (nums.length === 1 || (nums.length === 2 && /^\d{2,}$/.test(nums[1]!))) {
      const a = readAmount(nums[0]!, currency);
      if (a === 'ambiguous') problem = 'ambiguous_price';
      else price = a;
      rowMoq = nums[1] ?? null;
    } else if (nums.length >= 2) {
      problem = 'several_numbers';
    }
  }

  // Phase 9 (V1-334) — no sign anywhere, and the line ends in a price: that is
  // its price. Half of a line that holds two products ends in its figure by
  // the shape that split it, so a whole figure there is its price too.
  const bare = !problem && price === null && written === null
    ? (half ? line.match(/(?:^|\s)(\d+(?:[.,]\d{1,2})?)\s*[.;]?\s*$/) : barePrice(line)) : null;
  if (bare) {
    const a = readAmount(bare[1]!, currency);
    if (a === 'ambiguous') problem = 'ambiguous_price';
    else price = a;
  }
  const body = bare ? line.slice(0, line.length - bare[0].length) : line;

  const moq =
    line.match(new RegExp(`${MOQ_WORD}\\s*[:：]?\\s*(\\d[\\d,]*)`, 'i'))?.[1] ??
    line.match(/(\d[\d,]*)\s*(?:个|件|套|pcs)?\s*起/)?.[1] ??
    rowMoq ??
    line.match(/\t(\d{2,})\s*$/)?.[1] ?? null;

  // Name = the line minus the article number, price/moq/currency fragments.
  const name = (article ? body.slice(article.length) : body)
    .replace(reading.beforeAll, ' ')
    .replace(reading.afterAll, ' ')
    .replace(new RegExp(`${MOQ_WORD}\\s*[:：]?\\s*\\d[\\d,]*`, 'gi'), ' ')
    .replace(/\d[\d,]*\s*(?:个|件|套|pcs)?\s*起/g, ' ')
    .replace(/\t\d[\d.,]*/g, ' ')
    .replace(new RegExp(`\\b(${UNIT_WORDS})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ').trim();
  // A line that is ONLY an article number has no name to sell under; keep it
  // as the name rather than dropping the product or inventing a description.
  const finalName = name || article;
  if (!finalName) return null;

  const zh = /[一-鿿]/.test(finalName);
  return {
    sku: article,
    name: finalName,
    nameZh: zh ? finalName : null,
    price: price !== null ? { amount: price, currency } : null,
    moq: moq ? Number(moq.replace(/,/g, '')) : null,
    unit: 'pcs',
    sourceLine: whole,
    ...(problem ? { problem } : {}),
  };
}

/** Neutral reject code (ADR-0008); reasonZh is kept for the P3 onboarding flow. */
export type RejectReason = 'bad_name' | 'duplicate' | 'bad_price' | 'bad_moq' | 'no_price_on_page' | ReadingProblem;

const PROBLEM_ZH: Record<ReadingProblem, string> = {
  ambiguous_price: '价格有两种读法',
  other_currency: '这行是别的货币',
  several_numbers: '这行数字太多，不知道哪个是价格',
};

export type ValidatedImport = {
  readonly accepted: readonly ExtractedProduct[];
  /** Rejected with a reason the confirm card can show — a code plus zh text. */
  readonly rejected: readonly { readonly product: ExtractedProduct; readonly reason: RejectReason; readonly reasonZh: string }[];
};

/**
 * CUR — a price past this is taken for a misread (a sku or a phone number read
 * as the price), in each currency's own figures: 100,000 was the one line, and
 * a phone in rupiah costs more than that. Round figures, never a conversion.
 */
const PRICE_CEILING: Readonly<Record<Currency, number>> = {
  USD: 100_000, CNY: 700_000, AED: 400_000, SAR: 400_000, BRL: 500_000, MXN: 2_000_000, INR: 8_000_000, IDR: 1_500_000_000,
};

export function validateExtracted(products: readonly ExtractedProduct[]): ValidatedImport {
  const accepted: ExtractedProduct[] = [];
  const rejected: ValidatedImport['rejected'][number][] = [];
  const seen = new Set<string>();
  for (const p of products) {
    // M22 (F-02): the owner's article number identifies the product; the name
    // only does when she gave no number.
    const key = (p.sku ?? p.name).toLowerCase();
    if (p.problem) {
      // T4 — a price the parser would not guess at: said, and not brought in.
      rejected.push({ product: p, reason: p.problem, reasonZh: PROBLEM_ZH[p.problem] });
    } else if (p.name.length < 2 || p.name.length > 120) {
      rejected.push({ product: p, reason: 'bad_name', reasonZh: '名字没认出来' });
    } else if (seen.has(key)) {
      rejected.push({ product: p, reason: 'duplicate', reasonZh: '重复了' });
    } else if (p.price !== null && (p.price.amount <= 0 || p.price.amount > PRICE_CEILING[p.price.currency])) {
      rejected.push({ product: p, reason: 'bad_price', reasonZh: '价格看着不对' });
    } else if (p.moq !== null && (!Number.isInteger(p.moq) || p.moq <= 0)) {
      rejected.push({ product: p, reason: 'bad_moq', reasonZh: '起订量看着不对' });
    } else {
      seen.add(key);
      accepted.push(p);
    }
  }
  return { accepted, rejected };
}

/**
 * M37 — the same validator, for a page she PHOTOGRAPHED rather than pasted.
 *
 * One rule differs, and it exists because the two inputs differ in what they
 * contain. A paste is what the owner CHOSE to paste, so a line without a price
 * is a product she means to price later — accepted, marked "Needs a price".
 * A photograph contains the WHOLE page: the letterhead, the address, the
 * "Thank you for your order", the column headings. Under the paste rule every
 * one of those becomes a priceless product in her catalogue.
 *
 * So on a page, a line without a price is not imported — and it is not dropped
 * silently either. It is REJECTED, with a reason, into the list the review
 * already shows, because a line the page had and the catalogue did not get is
 * exactly the thing she needs to see.
 *
 * It is not a threshold and it guesses nothing: no line is judged by how much
 * it looks like a heading, only by whether it carries a price.
 */
export function validatePage(products: readonly ExtractedProduct[]): ValidatedImport {
  const base = validateExtracted(products);
  const accepted: ExtractedProduct[] = [];
  const rejected = [...base.rejected];
  for (const p of base.accepted) {
    if (p.price === null) rejected.push({ product: p, reason: 'no_price_on_page', reasonZh: '这行没有价格' });
    else accepted.push(p);
  }
  return { accepted, rejected };
}
