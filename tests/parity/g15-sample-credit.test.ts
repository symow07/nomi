import { describe, it, expect } from 'vitest';
import { usd, type Money } from '../../src/core/types/money.js';
import { buildInvoice, renderInvoiceEn } from '../../src/core/commerce/invoice.js';
import { sampleAnswerContext } from '../../src/core/commerce/samples.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import type { Quote } from '../../src/core/types/commerce.js';

/**
 * G15 — the sample credit reaches the proforma. Derived from rows that already
 * exist; the derivation itself is proven against Postgres in
 * tests/integration/samples.test.ts.
 */

const quote: Quote = {
  productId: 'p1' as never, quantity: { value: 1000, unit: 'pcs' },
  unitPrice: usd(0.5), discountPct: 0, total: usd(500), moq: 500,
  leadTimeDays: 25, leadTimeBlocked: null, requiresHuman: false, contradicts: null, appliedRules: [],
};
const invoice = (sampleCredit: Money | null) => renderInvoiceEn(buildInvoice({
  quote, sellerName: 'Yiwu Sunrise', sellerPrefix: 'PI', buyerName: 'Karim',
  productName: 'Canvas tote bag', productSku: 'CT-1', incoterm: 'CIF',
  paymentTermsZh: '50%', paymentTermsEn: '50% with order',
  conversationRef: 'c1234', sampleCredit, now: new Date('2026-09-11T00:00:00Z'),
}));

describe('G15 · the deduction she promised, on the document she promised it on', () => {
  it('two lines, never one adjusted total', () => {
    const text = invoice(usd(25));
    expect(text).toContain('Total: $500.00');
    expect(text).toContain('Less sample already paid: -$25.00');
    expect(text).toContain('Amount due: $475.00');
    // A buyer comparing this against her earlier message must see BOTH the
    // price he was quoted and the deduction he was promised.
    expect(text.indexOf('Total: $500.00')).toBeLessThan(text.indexOf('Amount due'));
  });

  it('nothing owed, nothing said — the document is unchanged', () => {
    const text = invoice(null);
    expect(text).not.toContain('Less sample');
    expect(text).not.toContain('Amount due');
    expect(text).toContain('Total: $500.00');
  });
});

describe('G15 · the order page', () => {
  const view = (over: Partial<OrderView> = {}): OrderView => ({
    orderId: 'o1', reference: 'PI-1', conversationId: 'c1', buyer: 'Karim',
    productName: 'Canvas tote bag', productSku: 'CT-1', quantity: 1000, unit: 'pcs',
    unitPriceAmount: 0.5, totalAmount: 500, currency: 'USD', email: null,
    paymentTerms: '50% with order', incoterm: 'CIF', sellerName: 'Yiwu Sunrise',
    confirmedAt: new Date('2026-09-11T00:00:00Z'), history: [], ...over,
  });

  it('shows the credit on the proforma', () => {
    const html = renderOrder(view({ sampleCredit: { kind: 'credit', amount: usd(25) } }), 'en', null);
    expect(html).toContain('Less sample already paid: -$25.00');
  });

  it('ANOTHER CURRENCY IS NOT CONVERTED — she is told to take it off herself', () => {
    for (const l of LOCALES) {
      const html = renderOrder(view({ sampleCredit: { kind: 'mismatch', amount: { amount: 180, currency: 'CNY' } } }), l, null);
      expect(html, l).toContain(esc(t(l, 'order.invoice.sampleMismatch', { amount: '￥180.00' })));
      expect(html, l).not.toContain('Less sample already paid');
      expect(t(l, 'order.invoice.sampleMismatch' as MessageKey, { amount: 'x' }), l).not.toContain('{');
    }
  });
});

describe('G15 · what she says about samples', () => {
  it('free is one sentence, not a branch with two identical arms', () => {
    const credited = sampleAnswerContext({ price: usd(0), creditedOnFirstOrder: true, statedAt: new Date() });
    const not = sampleAnswerContext({ price: usd(0), creditedOnFirstOrder: false, statedAt: new Date() });
    expect(credited.ok && credited.note).toBe('Samples are free.');
    expect(not.ok && not.note).toBe('Samples are free.');
    // Nothing to deduct from an order, so nothing is promised about one.
    expect(credited.ok && credited.allow).toEqual([]);
  });

  it('a priced, credited sample still says so in the reply', () => {
    const paid = sampleAnswerContext({ price: usd(25), creditedOnFirstOrder: true, statedAt: new Date() });
    expect(paid.ok && paid.note).toContain('comes off the first order');
    expect(paid.ok && paid.allow).toEqual([25]);
  });
});
