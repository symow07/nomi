import { type Money, usd } from '../types/money.js';
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
   * T4 — the line has a price this parser will not guess at: written two ways
   * at once (`1.250,00`), in a currency other than US dollars (only dollars
   * for now, until a workspace can have its own currency), or a spreadsheet
   * row with several numbers and nothing saying which is the price. The line
   * is refused with that reason, never priced wrongly without a word.
   */
  readonly problem?: ReadingProblem;
};

/** T4 — why a line's price was not read. Each is a reject reason the review names. */
export type ReadingProblem = 'ambiguous_price' | 'not_usd' | 'several_numbers';

/** LLM port for messy input (photos of price lists, rambling messages). */
export interface CatalogExtractor {
  extract(input: { text: string | null; imageBase64: string | null }): Promise<{
    products: readonly ExtractedProduct[];
    usage: { inputTokens: number; outputTokens: number };
  }>;
}

const UNIT_WORDS = 'pcs|pieces?|sets?|pairs?|boxes|cartons?|个|件|套|双|箱';

/** "Minimum order", as owners write it: MOQ, 起订, 最低, and Arabic «حد أدنى» / «الحد الأدنى». */
const MOQ_WORD = String.raw`(?:MOQ|起订|最低|(?:ال)?حد\s*(?:ال)?أدنى)`;

/**
 * T4 — a figure as written, read one way or refused. Thousands commas
 * (`1,250.00`) are thousands: that line was read as $1.00. A comma used as the
 * decimal point, or a dot before exactly three digits after a non-zero whole
 * part (`1.250,00`, `12,50`, `1.250`), could be read two ways, and a wrong
 * reading is a price a customer is quoted — so it is refused. Sentence
 * punctuation after the figure is not part of it.
 */
function readAmount(raw: string): number | 'ambiguous' {
  const s = raw.replace(/[.,]+$/, '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^[1-9]\d{0,2}\.\d{3}$/.test(s)) return 'ambiguous';
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return 'ambiguous';
}

/** Dollars that are not US dollars — HK$, A$, C$, NT$, S$ — written as a prefix. */
const OTHER_DOLLAR = /(?<![A-Za-z])(?!US[$＄])[A-Z]{1,3}[$＄]/;
/** Every other currency an owner is likely to write. Only US dollars are read for now (until CUR). */
const OTHER_CURRENCY = /[€£¥￥₹₩₽]|(?<!美)元|人民币|\b(?:RMB|CNY|EUR|GBP|JPY|AED|SAR|HKD|AUD|CAD|SGD|TWD|INR)\b|د\.إ|ر\.س|درهم|ريال/i;
const NUMBER_CELL = /^\d[\d.,]*$/;

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
export function parsePriceLines(text: string): readonly ExtractedProduct[] {
  const out: ExtractedProduct[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.length < 3) continue;

    const article = line.match(ARTICLE_NO)?.[1] ?? null;

    // T4 — a price in any currency but US dollars is refused, not ignored:
    // today "18元" came in as a product with no price, and "HK$25" as $25.
    let problem: ReadingProblem | null =
      OTHER_DOLLAR.test(line) || OTHER_CURRENCY.test(line) ? 'not_usd' : null;
    let price: number | null = null;
    const written =
      line.match(/(?:US)?[$＄]\s*(\d[\d.,]*)/i)?.[1] ??
      line.match(/(\d[\d.,]*)\s*(?:美元|美金|USD)/i)?.[1] ?? null;
    if (!problem && written !== null) {
      const a = readAmount(written);
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
        const a = readAmount(nums[0]!);
        if (a === 'ambiguous') problem = 'ambiguous_price';
        else price = a;
        rowMoq = nums[1] ?? null;
      } else if (nums.length >= 2) {
        problem = 'several_numbers';
      }
    }

    const moq =
      line.match(new RegExp(`${MOQ_WORD}\\s*[:：]?\\s*(\\d[\\d,]*)`, 'i'))?.[1] ??
      line.match(/(\d[\d,]*)\s*(?:个|件|套|pcs)?\s*起/)?.[1] ??
      rowMoq ??
      line.match(/\t(\d{2,})\s*$/)?.[1] ?? null;

    // Name = the line minus the article number, price/moq/currency fragments.
    const name = (article ? line.slice(article.length) : line)
      .replace(/(?:US)?[$＄]\s*\d[\d.,]*/gi, ' ')
      .replace(/\d[\d.,]*\s*(?:美元|美金|USD)/gi, ' ')
      .replace(new RegExp(`${MOQ_WORD}\\s*[:：]?\\s*\\d[\\d,]*`, 'gi'), ' ')
      .replace(/\d[\d,]*\s*(?:个|件|套|pcs)?\s*起/g, ' ')
      .replace(/\t\d[\d.,]*/g, ' ')
      .replace(new RegExp(`\\b(${UNIT_WORDS})\\b`, 'gi'), ' ')
      .replace(/\s+/g, ' ').trim();
    // A line that is ONLY an article number has no name to sell under; keep it
    // as the name rather than dropping the product or inventing a description.
    const finalName = name || article;
    if (!finalName) continue;

    const zh = /[一-鿿]/.test(finalName);
    out.push({
      sku: article,
      name: finalName,
      nameZh: zh ? finalName : null,
      price: price !== null ? usd(price) : null,
      moq: moq ? Number(moq.replace(/,/g, '')) : null,
      unit: 'pcs',
      sourceLine: line,
      ...(problem ? { problem } : {}),
    });
  }
  return out;
}

/** Neutral reject code (ADR-0008); reasonZh is kept for the P3 onboarding flow. */
export type RejectReason = 'bad_name' | 'duplicate' | 'bad_price' | 'bad_moq' | 'no_price_on_page' | ReadingProblem;

const PROBLEM_ZH: Record<ReadingProblem, string> = {
  ambiguous_price: '价格有两种读法',
  not_usd: '目前只认美元',
  several_numbers: '这行数字太多，不知道哪个是价格',
};

export type ValidatedImport = {
  readonly accepted: readonly ExtractedProduct[];
  /** Rejected with a reason the confirm card can show — a code plus zh text. */
  readonly rejected: readonly { readonly product: ExtractedProduct; readonly reason: RejectReason; readonly reasonZh: string }[];
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
    } else if (p.price !== null && (p.price.amount <= 0 || p.price.amount > 100_000)) {
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
