import type { Quote } from '../types/commerce.js';

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
  readonly unitPriceUsd: number;
  readonly totalUsd: number;
  readonly incoterm: string;                 // e.g. FOB Ningbo
  readonly leadTimeDays: number | null;
  readonly paymentTermsZh: string;           // from business policy, owner-set
  readonly paymentTermsEn: string;
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
    unitPriceUsd: q.unitPriceUsd,
    totalUsd: q.totalUsd,
    incoterm: input.incoterm,
    leadTimeDays: q.leadTimeDays,
    paymentTermsZh: input.paymentTermsZh,
    paymentTermsEn: input.paymentTermsEn,
  };
}

/** Buyer-facing proforma text (English). Numbers verbatim from the invoice. */
export function renderInvoiceEn(inv: InvoiceData): string {
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [
    `PROFORMA INVOICE ${inv.piNumber}`,
    `Seller: ${inv.seller}`,
    `Buyer: ${inv.buyerName}`,
    ``,
    `${inv.productName} (${inv.productSku})`,
    `Qty: ${inv.quantity.toLocaleString('en-US')} ${inv.unit}`,
    `Unit price: $${money(inv.unitPriceUsd)} ${inv.incoterm}`,
    `Total: $${money(inv.totalUsd)}`,
    inv.leadTimeDays !== null ? `Lead time: ${inv.leadTimeDays} days` : null,
    `Payment: ${inv.paymentTermsEn}`,
  ].filter((l): l is string => l !== null).join('\n');
}
