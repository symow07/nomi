import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import { usd, type Money } from '../../src/core/types/money.js';

/**
 * G18 · M43a + M43b — money shows its currency everywhere.
 *
 * M43a made money a pair, amount and currency, so that a euro price added to a
 * dollar floor could not compile. The owner surfaces then undid it one row at a
 * time: each read a stored amount and rebuilt it with `usd(...)`, so whatever
 * the column said, the screen said "$". The type was honest and the page was
 * not.
 *
 * Two rules hold that shut, and they are different in kind:
 *   · the RENDERERS show the currency they are handed (asserted with ￥ here,
 *     because a test that only ever passes dollars cannot fail);
 *   · no surface REBUILDS a row as dollars (a source rule, because the next
 *     read is written a year from now by someone who has not read this file).
 *
 * The database still refuses a second currency in five of the six tables that
 * hold one (tests/integration/currency.test.ts pins that). So this is not yet
 * observable behaviour — it is the day it becomes observable, decided now.
 */

const WEB_DIR = new URL('../../src/api/web/', import.meta.url);
const cny = (amount: number): Money => ({ amount, currency: 'CNY' });

const analytics = (totals: readonly Money[]): AnalyticsData => ({
  range: 'month', hasActivity: true,
  summary: { newClients: 2, activeConvos: 3, quotes: 4, orders: 2 },
  activity: { inbound: 9, replied: 7, waiting: 1 },
  commerce: { quotes: 4, orders: 2, deals: [{ status: 'confirmed', n: 2 }], totals },
  employee: { handled: 3, waiting: 1, edits: 1 },
});

const order = (over: Partial<OrderView> = {}): OrderView => ({
  orderId: 'o1', reference: 'YW-2026-09-0001', conversationId: 'c1',
  buyer: 'Ahmed Al-Rashid', productName: 'Canvas Tote Bag', productSku: 'ZX-100',
  quantity: 5000, unit: 'pcs', unitPriceAmount: 0.92, totalAmount: 4600, currency: 'USD',
  email: null, confirmedAt: new Date('2026-09-01T08:00:00Z'), history: [],
  sellerName: 'Yiwu Factory', paymentTerms: '30% deposit, 70% before shipment', incoterm: 'FOB',
  sampleCredit: null, ...over,
});

describe('G18 · the screen says what the row says', () => {
  it('ANALYTICS TOTALS ARE ONE PER CURRENCY — never one number made of two', () => {
    const html = renderAnalytics(analytics([usd(4600), cny(31000)]), 'en');
    expect(html).toContain('$4,600');
    expect(html).toContain('￥31,000');
    // the sum of the two would be this, and it must appear nowhere
    expect(html).not.toContain('35,600');
  });

  it('and no total at all is said when there are no orders to total', () => {
    const html = renderAnalytics({ ...analytics([]), commerce: { quotes: 0, orders: 0, deals: [], totals: [] } }, 'en');
    expect(html).not.toContain('$');
  });

  it('AN ORDER IN HER OWN MONEY IS SHOWN, not hidden for not being dollars', () => {
    // It used to render only `currency === 'USD'`: an order taken in ￥ showed
    // her no total and no proforma at all — a blank where her own order was.
    const html = renderOrder(order({ currency: 'CNY', unitPriceAmount: 6.5, totalAmount: 32500 }), 'en', null);
    expect(html).toContain('￥32,500');
    expect(html).not.toContain('$32,500');
    // and the document she sends a buyer carries the same currency
    expect(html).toContain('￥6.50');
  });

  it('a currency this build cannot price shows no total — it does not invent one', () => {
    const html = renderOrder(order({ currency: 'XYZ' }), 'en', null);
    expect(html).not.toContain('4,600');
    expect(html).not.toContain('$');
  });
});

describe('G18 · no owner surface rebuilds a stored amount as dollars', () => {
  it('nothing calls usd() on a value that came out of a row', async () => {
    /**
     * `usd(Number(row.something))` is the exact shape of the defect: an amount
     * read from the database, given a currency by the code rather than by the
     * column beside it. `moneyFromRow` is the honest form — it returns null for
     * a currency this build does not know, and every caller here drops the row
     * rather than pricing it in dollars.
     */
    const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts'));
    const rogue: string[] = [];
    for (const f of files) {
      const src = await readFile(new URL(f, WEB_DIR), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        const s = line.trim();
        if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue;
        if (/\busd\(\s*Number\(/.test(line)) rogue.push(`${f}:${i + 1}  ${s.slice(0, 80)}`);
      }
    }
    expect(rogue, `these price a row in dollars whatever it says:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('and the money type no longer claims there is only one currency', async () => {
    // M43b added CNY; the header kept saying "USD is still the only currency",
    // which is a comment lying about the thing it documents.
    const src = await readFile(new URL('../../src/core/types/money.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('USD is still the only currency');
    expect(src).not.toContain('a union of ONE');
    expect(src).toMatch(/Currency = 'USD' \| 'CNY'/);
  });
});
