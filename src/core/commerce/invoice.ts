import type { Quote } from '../types/commerce.js';
import { type Money, currencySymbol } from '../types/money.js';

/**
 * M6 — Wow #3: negotiation → formatted proforma invoice in one tap (开票).
 * Every number is copied from the confirmed Quote; this module does zero
 * arithmetic beyond what the quote already fixed. Deterministic PI number
 * from business prefix + date + conversation tail — reissuing is idempotent.
 */

export type InvoiceData = {
  readonly piNumber: string;                 // PI-HF-20260718-0301
  readonly issuedAt: Date;
  readonly seller: string;
  readonly buyerName: string;
  readonly productName: string;
  readonly productSku: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly total: Money;
  readonly incoterm: string;                 // e.g. FOB Ningbo
  readonly leadTimeDays: number | null;
  readonly paymentTermsZh: string;           // from business policy, owner-set
  readonly paymentTermsEn: string;
  /**
   * M45/G15 — the sample he already paid for, coming off this first order
   * because she said it would. Absent when she credits nothing, when this is
   * not his first order, or when he asked for no sample.
   */
  readonly sampleCredit?: Money | null;
};

export function buildInvoice(input: {
  readonly quote: Quote;
  readonly sellerName: string;
  readonly sellerPrefix: string;             // e.g. 'HF'
  readonly buyerName: string;
  readonly productName: string;
  readonly productSku: string;
  readonly incoterm: string;
  readonly paymentTermsZh: string;
  readonly paymentTermsEn: string;
  readonly conversationRef: string;          // stable per conversation
  /** M45/G15 — what he already paid for a sample, in the order's own currency. */
  readonly sampleCredit?: Money | null;
  readonly now: Date;
}): InvoiceData {
  const q = input.quote;
  const d = input.now;
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return {
    piNumber: `PI-${input.sellerPrefix}-${ymd}-${input.conversationRef.slice(-4)}`,
    issuedAt: input.now,
    seller: input.sellerName,
    buyerName: input.buyerName,
    productName: input.productName,
    productSku: input.productSku,
    quantity: q.quantity.value,
    unit: q.quantity.unit,
    unitPrice: q.unitPrice,
    total: q.total,
    incoterm: input.incoterm,
    leadTimeDays: q.leadTimeDays,
    paymentTermsZh: input.paymentTermsZh,
    paymentTermsEn: input.paymentTermsEn,
    ...(input.sampleCredit ? { sampleCredit: input.sampleCredit } : {}),
  };
}

/** Buyer-facing proforma text (English). Numbers verbatim from the invoice. */
export function renderInvoiceEn(inv: InvoiceData): string {
  // The symbol comes from the money, not from a literal in the template: a
  // line reading "$" beside an amount that is not dollars is the exact defect
  // M43a exists to make impossible.
  const money = (m: Money) => `${currencySymbol(m.currency)}${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    `PROFORMA INVOICE ${inv.piNumber}`,
    `Seller: ${inv.seller}`,
    `Buyer: ${inv.buyerName}`,
    ``,
    `${inv.productName} (${inv.productSku})`,
    `Qty: ${inv.quantity.toLocaleString('en-US')} ${inv.unit}`,
    `Unit price: ${money(inv.unitPrice)} ${inv.incoterm}`,
    `Total: ${money(inv.total)}`,
    // M45/G15 — she promised the sample comes off the first order, and the
    // document is where that promise is kept. Two lines, not one adjusted
    // total: a buyer comparing this against her earlier message must be able
    // to see the price he was quoted AND the deduction he was promised.
    ...(inv.sampleCredit ? [
      `Less sample already paid: -${money(inv.sampleCredit)}`,
      `Amount due: ${money({ amount: inv.total.amount - inv.sampleCredit.amount, currency: inv.total.currency })}`,
    ] : []),
    inv.leadTimeDays !== null ? `Lead time: ${inv.leadTimeDays} days` : null,
    `Payment: ${inv.paymentTermsEn}`,
  ].filter((l): l is string => l !== null).join('\n');
}
