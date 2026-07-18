import { formatQtyZh } from '../owner/format.js';

/**
 * M6 — Wow #2: buyer memory, surfaced IN CONTEXT (on the approval card),
 * never as a separate CRM screen. Pure derivation from recorded history —
 * the recall line only states what the tables prove.
 */

export type BuyerHistory = {
  readonly buyerName: string;
  readonly countryZh: string | null;
  readonly isVip: boolean;
  readonly preferenceNoteZh: string | null;      // clients.notes — owner-authored
  readonly lastContactAt: Date | null;
  readonly pastInquiries: readonly {
    readonly at: Date;
    readonly productSku: string;
    readonly productNameZh: string;
    readonly quantity: number | null;
    readonly lastUnitPriceUsd: number | null;    // from recorded quotes only
  }[];
};

/** A buyer is "returning" after this much silence — memory becomes the wow. */
export const RETURNING_AFTER_MS = 30 * 24 * 3600 * 1000;

const monthZh = (d: Date): string => `${d.getUTCMonth() + 1}月`;

/**
 * The owner-side recall line: 这是Ahmed，3月询过保温杯（ZX-200），谈到$2.10/个
 * Null when there is nothing recorded to recall — no fake memory.
 */
export function recallLineZh(h: BuyerHistory, now: Date): string | null {
  const last = h.pastInquiries.at(-1);
  if (!last) return null;
  if (!h.lastContactAt) return null;
  if (now.getTime() - h.lastContactAt.getTime() < RETURNING_AFTER_MS) return null;

  const qty = last.quantity !== null ? `${formatQtyZh(last.quantity)}个` : null;
  const price = last.lastUnitPriceUsd !== null ? `谈到$${last.lastUnitPriceUsd.toFixed(2)}/个` : null;
  const tail = [qty, price].filter(Boolean).join('，');
  return `这是${h.buyerName}，${monthZh(last.at)}询过${last.productNameZh}（${last.productSku}）` +
    (tail ? `，${tail}` : '');
}

/** Context handed to the reply writer so the greeting shows real memory. */
export function recallContextEn(h: BuyerHistory): string | null {
  const last = h.pastInquiries.at(-1);
  if (!last) return null;
  return `Returning buyer. Last inquiry: ${last.productNameZh} (${last.productSku})` +
    (last.quantity !== null ? `, qty ${last.quantity}` : '') +
    (last.lastUnitPriceUsd !== null ? `, discussed $${last.lastUnitPriceUsd.toFixed(2)}/pc` : '') +
    (h.preferenceNoteZh ? `. Owner note: ${h.preferenceNoteZh}` : '');
}
