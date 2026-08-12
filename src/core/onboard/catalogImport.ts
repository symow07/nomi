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
  readonly priceUsd: number | null;    // null = owner must fill at confirm
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
};

/** LLM port for messy input (photos of price lists, rambling messages). */
export interface CatalogExtractor {
  extract(input: { text: string | null; imageBase64: string | null }): Promise<{
    products: readonly ExtractedProduct[];
    usage: { inputTokens: number; outputTokens: number };
  }>;
}

const UNIT_WORDS = 'pcs|pieces?|sets?|pairs?|boxes|cartons?|个|件|套|双|箱';

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

    const price =
      line.match(/[$＄]\s*(\d+(?:\.\d+)?)/)?.[1] ??
      line.match(/(\d+(?:\.\d+)?)\s*(?:美元|美金|USD)/i)?.[1] ??
      line.match(/\t(\d+(?:\.\d+)?)\t/)?.[1] ?? null;

    const moq =
      line.match(/(?:MOQ|起订|最低)\s*[:：]?\s*(\d[\d,]*)/i)?.[1] ??
      line.match(/(\d[\d,]*)\s*(?:个|件|套|pcs)?\s*起/)?.[1] ??
      line.match(/\t(\d{2,})\s*$/)?.[1] ?? null;

    // Name = the line minus the article number, price/moq/currency fragments.
    const name = (article ? line.slice(article.length) : line)
      .replace(/[$＄]\s*\d+(?:\.\d+)?/g, ' ')
      .replace(/\d+(?:\.\d+)?\s*(?:美元|美金|USD)/gi, ' ')
      .replace(/(?:MOQ|起订|最低)\s*[:：]?\s*\d[\d,]*/gi, ' ')
      .replace(/\d[\d,]*\s*(?:个|件|套|pcs)?\s*起/g, ' ')
      .replace(/\t\d+(?:\.\d+)?/g, ' ')
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
      priceUsd: price ? Number(price) : null,
      moq: moq ? Number(moq.replace(/,/g, '')) : null,
      unit: 'pcs',
      sourceLine: line,
    });
  }
  return out;
}

/** Neutral reject code (ADR-0008); reasonZh is kept for the P3 onboarding flow. */
export type RejectReason = 'bad_name' | 'duplicate' | 'bad_price' | 'bad_moq' | 'no_price_on_page';

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
    if (p.name.length < 2 || p.name.length > 120) {
      rejected.push({ product: p, reason: 'bad_name', reasonZh: '名字没认出来' });
    } else if (seen.has(key)) {
      rejected.push({ product: p, reason: 'duplicate', reasonZh: '重复了' });
    } else if (p.priceUsd !== null && (p.priceUsd <= 0 || p.priceUsd > 100_000)) {
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
    if (p.priceUsd === null) rejected.push({ product: p, reason: 'no_price_on_page', reasonZh: '这行没有价格' });
    else accepted.push(p);
  }
  return { accepted, rejected };
}
