import { describe, it, expect } from 'vitest';
import { buildInvoice, renderInvoiceEn } from '../../src/core/commerce/invoice.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { BOX } from '../../src/core/owner/tokens.js';
import { product, tiers, policy } from './fixtures.js';

const NOW = new Date('2026-07-18T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

/*
 * M34.8 — the buyer-memory, plans/subscription and commercial-copy blocks went
 * with their modules. No live surface recalls a returning buyer, sells a plan,
 * or renders a pricing page; the invoice builder below stays because ROADMAP
 * M46 names invoice.ts as the foundation for post-order tracking.
 */

/* ── Wow #3: instant invoice ─────────────────────────────────────────────── */
describe('M6 · instant invoice', () => {
  const quote = (() => {
    const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!r.ok) throw new Error('fixture');
    return r.value;
  })();
  const inv = buildInvoice({
    quote, sellerName: 'Yiwu Hongfa Daily Goods Factory', sellerPrefix: 'HF',
    buyerName: 'Mohammed Noor', productName: product().name, productSku: 'ZX-100',
    incoterm: 'FOB Ningbo', paymentTermsZh: 'TT 30% 定金，发货前付清',
    paymentTermsEn: 'T/T 30% deposit, balance before shipment',
    conversationRef: 'de300000-0000-4000-8000-000000000304', now: NOW,
  });

  it('every number is the quote\'s number — zero new arithmetic', () => {
    expect(inv.quantity).toBe(quote.quantity.value);
    expect(inv.unitPriceUsd).toBe(quote.unitPriceUsd);
    expect(inv.totalUsd).toBe(quote.totalUsd);
    expect(inv.leadTimeDays).toBe(quote.leadTimeDays);
  });

  it('PI number is deterministic and idempotent to reissue', () => {
    expect(inv.piNumber).toBe('PI-HF-20260718-0304');
    const again = buildInvoice({
      quote, sellerName: 'x', sellerPrefix: 'HF', buyerName: 'y', productName: 'p',
      productSku: 's', incoterm: 'FOB', paymentTermsZh: 'a', paymentTermsEn: 'b',
      conversationRef: 'de300000-0000-4000-8000-000000000304', now: NOW,
    });
    expect(again.piNumber).toBe(inv.piNumber);
  });

  it('the buyer PI carries only quote-derived money figures', () => {
    const en = renderInvoiceEn(inv);
    const moneyFigures = [...en.matchAll(/\$([\d,]+\.\d{2})/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
    for (const f of moneyFigures) {
      expect([quote.unitPriceUsd, quote.totalUsd]).toContain(f);
    }
    expect(en).toContain(`Qty: ${quote.quantity.value.toLocaleString('en-US')}`);
  });

  // The zh invoice CARD went with core/owner/commerce.ts; buildInvoice and its
  // English rendering stay, because ROADMAP M46 builds on them.
});
