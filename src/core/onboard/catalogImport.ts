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
  readonly name: string;
  readonly nameZh: string | null;
  readonly priceUsd: number | null;    // null = owner must fill at confirm
  readonly moq: number | null;
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
 * Deterministic parser for the shapes owners actually paste:
 *   帆布袋 1.05美元 500个起
 *   ZX-200 Thermos 500ml  $2.60  MOQ 1000
 *   保温杯\t2.6\t1000        (Excel tab row)
 * One product per line; unparseable lines are skipped, never fatal.
 */
export function parsePriceLines(text: string): readonly ExtractedProduct[] {
  const out: ExtractedProduct[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.length < 3) continue;

    const price =
      line.match(/[$＄]\s*(\d+(?:\.\d+)?)/)?.[1] ??
      line.match(/(\d+(?:\.\d+)?)\s*(?:美元|美金|USD)/i)?.[1] ??
      line.match(/\t(\d+(?:\.\d+)?)\t/)?.[1] ?? null;

    const moq =
      line.match(/(?:MOQ|起订|最低)\s*[:：]?\s*(\d[\d,]*)/i)?.[1] ??
      line.match(/(\d[\d,]*)\s*(?:个|件|套|pcs)?\s*起/)?.[1] ??
      line.match(/\t(\d{2,})\s*$/)?.[1] ?? null;

    // Name = the line minus price/moq/currency fragments.
    const name = line
      .replace(/[$＄]\s*\d+(?:\.\d+)?/g, ' ')
      .replace(/\d+(?:\.\d+)?\s*(?:美元|美金|USD)/gi, ' ')
      .replace(/(?:MOQ|起订|最低)\s*[:：]?\s*\d[\d,]*/gi, ' ')
      .replace(/\d[\d,]*\s*(?:个|件|套|pcs)?\s*起/g, ' ')
      .replace(/\t\d+(?:\.\d+)?/g, ' ')
      .replace(new RegExp(`\\b(${UNIT_WORDS})\\b`, 'gi'), ' ')
      .replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const zh = /[一-鿿]/.test(name);
    out.push({
      name,
      nameZh: zh ? name : null,
      priceUsd: price ? Number(price) : null,
      moq: moq ? Number(moq.replace(/,/g, '')) : null,
      unit: 'pcs',
    });
  }
  return out;
}

/** Neutral reject code (ADR-0008); reasonZh is kept for the P3 onboarding flow. */
export type RejectReason = 'bad_name' | 'duplicate' | 'bad_price' | 'bad_moq';

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
    const key = p.name.toLowerCase();
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
