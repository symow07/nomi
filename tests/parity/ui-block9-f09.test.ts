import { describe, expect, it } from 'vitest';
import { renderCustomers } from '../../src/api/web/customers.js';
import { renderCustomerOrders } from '../../src/api/web/customerOrders.js';
import { renderProductList, type ProductListItem } from '../../src/api/web/products.js';
import { renderInvoices } from '../../src/api/web/booksInvoices.js';
import { LISTS_CSS } from '../../src/api/web/listsStyle.js';
import { renderAssistantKnowledge } from '../../src/api/web/assistantKnowledge.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { moneyFromRow, usd } from '../../src/core/types/money.js';
import { decimal as d } from '../../src/core/types/decimal.js';
import type { CustomersPage } from '../../src/db/customers.js';
import type { InvoiceView } from '../../src/db/booksInvoices.js';

// UI correction, Block 9 — F09 "Long lists repeat labels instead of using columns". On a desk a list names its columns
// once, in a header above the rows (aria-hidden: each row keeps its own keys, read aloud and shown on a phone), and its
// figures sit end-aligned in tabular digits; on a phone a row is two or three lines; the pager is near the list at the
// top too. Measured in a browser by the harness's f09probe.mjs (base fails, head passes); this file holds the markup.

const now = new Date('2026-11-06T09:00:00Z');
const id = '00000000-0000-0000-0000-000000000001';
const value = { clientId: id, spent: moneyFromRow('50', 'EUR')!, orders: 3, lastOrderAt: now, regular: true, quietSince: null, omittedCurrencyOrders: 0, unknownAmountOrders: 0 };
const customers: CustomersPage = { rows: [{ clientId: id, name: 'A', phone: null, email: null, photo: null, channels: ['email'], lastContactAt: now, lastWrote: null, waiting: false, conversationId: null, value, labels: [] }], total: 60, from: 26, to: 50, next: 'n', prev: 'p', q: '', label: null };
const product: ProductListItem = { id: '11111111-1111-4111-8111-111111111111', name: 'Canvas tote', nameZh: null, sku: 'TOTE', unit: 'item', moq: 500, entryQty: 1, entryPrice: usd('20'), learned: true, status: 'learned', imageMatchable: true, isActive: true };
const billedTo = { code: 'C1', name: 'Customer One', address: 'x', country: 'GB', ice: null, taxNumber: null, registry: null, siret: null, registro: null, asIssued: true };
const invoice: InvoiceView = { id: 'invoice', key: 'F-2026-0001', party: 'Customer One', issueDate: '2026-11-01', dueDate: '2026-11-30', currency: 'GBP', total: d('120'), credited: d('0'), paid: d('30'), status: 'partly_paid', label: 'x', entryId: 'entry', billedTo, lines: [], payments: [], creditNotes: [] };
const order = { id: 'o-1', clientId: id, customerName: 'A', conversationId: null, reference: 'REF-1', productId: null, productName: 'Tote', productNameZh: null, quantity: 4, unit: 'pcs', unitPrice: null, total: null, state: 'confirmed' as const, stateAt: null, createdAt: now, confirmedAt: null };

describe('F09 — long lists: one header, figures in columns, the pager at the top too', () => {
  it('Customers: one aria-hidden header names the columns; each row keeps its keys; a pager above and below, named apart', () => {
    const html = renderCustomers(customers, 'en', now);
    expect(html).toContain('<div class="ca-head" aria-hidden="true">');
    expect(html.indexOf('class="ca-head"')).toBeLessThan(html.indexOf('<ul class="ca-customers">'));
    for (const c of ['ca-f-value', 'ca-f-orders', 'ca-f-last']) expect(html).toContain(`<div class="${c}"><dt>`);
    expect(html).toContain('ca-pager ca-pager-above');expect(html).toContain('ca-pager ca-pager-below');
    expect(html.indexOf('ca-pager-above')).toBeLessThan(html.indexOf('class="ca-head"'));
    expect(html).toContain(`aria-label="${esc(t('en', 'assistantArea.pagesAbove'))}"`);
    const one = renderCustomers({ ...customers, next: null, prev: null }, 'en', now);
    // The text pass (the owner, 2026-11-26): a list that fits on one page draws no pager at all.
    expect(one).not.toContain('ca-pager');
  });
  it('Orders: a header with the amount as a figure column; three fact columns when no state time is recorded', () => {
    const html = renderCustomerOrders({ rows: [order], total: 1, from: 1, to: 1, next: null, prev: null, q: '', clientId: null, state: null }, 'en', now);
    expect(html).toContain('<div class="ca-order-head ca-of3" aria-hidden="true">');expect(html).toContain('<ul class="ca-orders ca-of3">');
    expect(html).toContain('<div class="ca-of-amount"><dt>');
    const four = renderCustomerOrders({ rows: [{ ...order, stateAt: now }], total: 1, from: 1, to: 1, next: null, prev: null, q: '', clientId: null, state: null }, 'en', now);
    expect(four).toContain('<div class="ca-order-head" aria-hidden="true">');expect(four).toContain(`<span>${t('en', 'customers.stateAt')}</span>`);
  });
  it('Products: a header (product, price, minimum); the minimum\'s key is its own span; the row still reads "Min. order: …"', () => {
    const html = renderProductList([product], 'en', null, OWNER_VIEW, null, { page: { items: [product], q: '', total: 121, page: 2, pageSize: 50, next: '/app/products?page=3', prev: '/app/products' } });
    expect(html).toContain('<div class="pa-head" aria-hidden="true">');
    expect(html).toContain('<span class="prod-price">');expect(html).toContain('<span class="prod-moq"><span class="prod-k">Min. order: </span>');
    expect(html).toContain('pa-pager pa-pager-above');expect(html).toContain('pa-pager pa-pager-below');
    const none = renderProductList([{ ...product, moq: null }], 'en', null, OWNER_VIEW, 'retail');
    expect(none).not.toContain('pa-pager-above');
  });
  it('Invoices: the books\' table — one header, the money columns end-aligned, a pager above, a draft never shown as zero', () => {
    const html = renderInvoices('en', { isOwner: true }, [invoice, { ...invoice, id: 'draft', key: null, status: 'draft' }], { page: { from: 51, to: 52, total: 120, next: '/app/books/invoices?page=3', prev: '/app/books/invoices?page=1' } });
    expect(html).toContain('bk-cards bd-inv');expect(html).not.toContain('<ul class="bd-invoices">');
    expect(html.match(/<th scope="col" class="num">/g)).toHaveLength(2);
    expect(html).toContain('bd-pager bd-pager-above');expect(html).toContain('bd-pager bd-pager-below');
    const draft = html.match(/<tr class="bd-inv-row" id="invoice-draft"[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(draft).toContain(t('en', 'booksDocs.notIssued'));expect(draft).not.toContain('£0.00');
  });
  it('Knowledge readings: the Lines column is a figure column — its header word and its cells end-aligned', () => {
    const readings = { rows: [{ id: 'r1', source: 'https://example.test/a', lineCount: 6, createdAt: now, decidedAt: null, written: null, replacedBy: null, state: 'pending' as const }], total: 1, page: 1, pageSize: 50, from: 1, to: 1, next: null, prev: null };
    const empty = { rows: [], total: 0, page: 1, pageSize: 50, from: 0, to: 0, next: null, prev: null };
    const html = renderAssistantKnowledge('en', { view: 'readings', q: '', state: 'all', range: '', prefill: '', returnHref: '/app/assistant/knowledge?view=readings', flash: null, gaps: '', suggestions: '', period: '', readingForm: '', products: empty, facts: empty, readings } as Parameters<typeof renderAssistantKnowledge>[1]);
    expect(html).toContain(`<span class="num">${t('en', 'knowledgeList.lines')}</span>`);
    expect(html).toContain('<span class="ak-cell ak-num">');
    expect(LISTS_CSS).toContain('.ak-head .num,.ak-cell.ak-num{text-align:end;font-variant-numeric:tabular-nums;}');
  });
  it('the list sheet: headers only on a desk, the row keys hidden there (not removed), two or three lines on a phone', () => {
    expect(LISTS_CSS).toContain('.ca-head,.pa-head{display:none;}');
    expect(LISTS_CSS).toMatch(/@media\(min-width:1100px\)\{[\s\S]*\.ca-head\{display:grid;/);
    expect(LISTS_CSS).toContain('.ca-customer .ca-row-facts dt,.pa-products .prod-k{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%)');
    // Pin moved (tester round 2): a customer's value no longer shares the first line with the person, which squeezed a
    // 13-digit number until it broke at 320; the person has the whole line, value and orders the next (ui-block9-r3).
    expect(LISTS_CSS).toContain('grid-template-areas:"p p" "s s" "v o" "l l" "n n"');
    expect(LISTS_CSS).toContain('grid-template-areas:"t t" "p a" "c s"');
    expect(LISTS_CSS).not.toMatch(/\/\*|token|stack/);
  });
  it('the column words exist in all five catalogues (they were English only)', () => {
    for (const k of ['customers.orderValue', 'customers.standingOrders', 'customers.lastContact', 'customers.labels', 'customers.product', 'customers.amount', 'customers.created', 'customers.stateAt'] as const)
      for (const l of ['zh', 'ar', 'es', 'fr'] as const) expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]);
  });
});
