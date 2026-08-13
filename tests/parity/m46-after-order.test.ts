import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  ORDER_STATES, isOrderState, asksOrderStatus, orderStatusReply, type OrderUpdate,
} from '../../src/core/commerce/orderState.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M46 — after the order.
 *
 * `confirmable.ts` and `invoice.ts` existed and the trail stopped at
 * confirmation, so three weeks later "where is my order?" had no answer. The
 * risk in answering it is not silence, it is helpfulness: a model given a state
 * and a lead time will produce "should ship around the 20th", which is a
 * delivery promise assembled by arithmetic and held against HER.
 *
 * So the reply is built here, from two fields, by no model at all.
 */

const at = new Date('2026-08-03T02:00:00Z');
const update = (over: Partial<OrderUpdate> = {}): OrderUpdate =>
  ({ state: 'in_production', at, note: null, trackingReference: null, by: 'owner', ...over });
const fmt = (d: Date) => d.toISOString().slice(0, 10);

describe('M46 · she reports the state and its date, and nothing more', () => {
  it('names the state and the day SHE set it', () => {
    const r = orderStatusReply({ reference: 'PI-HF-20260803-0301', update: update(), formatDate: fmt });
    expect(r.reply).toContain('PI-HF-20260803-0301');
    expect(r.reply).toContain('in production');
    expect(r.reply).toContain('2026-08-03');
  });

  it('NO ESTIMATE — not a date, not a window, not a "should"', () => {
    for (const state of ORDER_STATES) {
      const r = orderStatusReply({ reference: 'PI-1', update: update({ state }), formatDate: fmt });
      expect(r.reply.toLowerCase(), state).not.toMatch(/expect|estimate|should|around|approximately|by the|next week|eta/);
    }
  });

  it('the tracking reference appears only when she pasted one', () => {
    expect(orderStatusReply({ reference: 'PI-1', update: update(), formatDate: fmt }).reply)
      .not.toContain('tracking');
    const withRef = orderStatusReply({
      reference: 'PI-1', update: update({ trackingReference: 'SF1234567890' }), formatDate: fmt,
    });
    expect(withRef.reply).toContain('SF1234567890');
  });

  it('HER NOTE IS NEVER SENT — it is a note to herself', () => {
    const r = orderStatusReply({
      reference: 'PI-1',
      update: update({ note: 'ask Wang to chase the dye lot' }),
      formatDate: fmt,
    });
    expect(r.reply).not.toContain('Wang');
    expect(r.reply).not.toContain('dye lot');
  });

  it('every digit in the sentence is sourced, so the numeral guard passes it', async () => {
    const { guardNumerals } = await import('../../src/core/safety/numerals.js');
    const { emptyState } = await import('./fixtures.js');
    const r = orderStatusReply({
      reference: 'PI-HF-20260803-0301',
      update: update({ trackingReference: 'SF1234567890' }),
      formatDate: fmt,
    });
    expect(guardNumerals({
      reply: r.reply, quote: null, state: emptyState(), clientText: '', allow: [...r.allow],
    }).ok).toBe(true);
  });

  it('and a sentence with an invented figure in it would NOT pass', async () => {
    // The guard is what makes the no-estimate rule enforceable rather than
    // aspirational: any figure not in `allow` stops the reply.
    const { guardNumerals } = await import('../../src/core/safety/numerals.js');
    const { emptyState } = await import('./fixtures.js');
    const r = orderStatusReply({ reference: 'PI-1', update: update(), formatDate: fmt });
    expect(guardNumerals({
      reply: `${r.reply} It should arrive in 14 days.`,
      quote: null, state: emptyState(), clientText: '', allow: [...r.allow],
    }).ok).toBe(false);
  });
});

describe('M46 · the question is recognised deterministically', () => {
  it('in the three languages a buyer writes in', () => {
    for (const text of [
      'where is my order?', 'any update on my order', 'has it shipped yet?', 'tracking number please',
      '我的订单到哪了', '什么时候发货', '快递单号是多少',
      'أين طلبي؟', 'هل تم الشحن؟',
    ]) expect(asksOrderStatus(text), text).toBe(true);
  });

  it('and not on an ordinary message', () => {
    for (const text of ['price for 5000?', 'can you send a sample?', '有没有帆布袋']) {
      expect(asksOrderStatus(text), text).toBe(false);
    }
  });
});

describe('M46 · nothing is inferred', () => {
  it('there is no rule that advances a state', async () => {
    // An order is in production when she says it is. A schedule that advanced
    // it would be a promise made by arithmetic.
    const src = await readFile(new URL('../../src/core/commerce/orderState.ts', import.meta.url), 'utf8');
    expect(src).toContain('SHE SETS IT. NOTHING IS INFERRED');
    // The CODE, not the comments — the comments say the word "advance" while
    // explaining why nothing does. Same lesson as M44's holiday-table check.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toMatch(/leadTime|daysSince|addDays|advance|nextState/i);
  });

  it('the states are a fixed vocabulary, not an owner-defined one', () => {
    // A state only she understands cannot be reported to a buyer in his
    // language. What she calls it in her own words goes in the note.
    expect([...ORDER_STATES]).toEqual(['confirmed', 'in_production', 'shipped', 'cancelled']);
    expect(isOrderState('in_production')).toBe(true);
    expect(isOrderState('almost_ready')).toBe(false);
  });

  it('ONE FUNCTION writes both the log and the current state', async () => {
    // Two representations that can drift is worse than one materialised in the
    // same transaction by the same writer.
    const src = await readFile(new URL('../../src/api/web/orders.ts', import.meta.url), 'utf8');
    expect(src).toContain('THE ONLY WRITER');
    expect(src).toMatch(/insert into order_updates[\s\S]{0,600}update orders set status/);
    // and a tracking reference she did not repeat is not erased
    expect(src).toContain('coalesce(${tracking}, tracking_reference)');
  });

  it('THE PRODUCTION CALLER answers from the row, before any model is asked', async () => {
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(turn).toContain('if (asksOrderStatus(req.text)) {');
    expect(turn).toContain('await tenant.orders.latestForConversation(req.conversationId)');
    expect(turn).toContain('orderStatusReply({');
    // It sits BEFORE the taught-answer path and the generative path.
    expect(turn.indexOf('asksOrderStatus(req.text)'))
      .toBeLessThan(turn.indexOf('const faq = knowledge.find'));
  });
});

describe('M46 · the owner page', () => {
  const view = (over: Partial<OrderView> = {}): OrderView => ({
    orderId: 'o1', reference: 'PI-HF-20260803-0301', conversationId: 'c1',
    buyer: 'Ahmed', productName: 'Vacuum cup', productSku: 'ZX-200',
    quantity: 5000, unit: 'pcs', unitPriceAmount: 0.92, totalAmount: 4600,
    currency: 'USD', email: 'a@example.com', paymentTerms: '30% deposit',
    confirmedAt: new Date('2026-08-01T00:00:00Z'),
    history: [update({ state: 'in_production', note: 'chase the dye lot' })],
    ...over,
  });

  it('shows what she recorded, and the note she wrote to herself', () => {
    const html = renderOrder(view(), 'en', null);
    expect(html).toContain('PI-HF-20260803-0301');
    expect(html).toContain(t('en', 'order.state.in_production'));
    expect(html).toContain('chase the dye lot');
    expect(html).toContain('/app/orders/o1/update');
  });

  it('THE PROFORMA IS REACHABLE — invoice.ts is wired, not exempt', () => {
    const html = renderOrder(view(), 'en', null);
    expect(html).toContain('PROFORMA INVOICE');
    expect(html).toContain('Qty: 5,000 pcs');
    // Its figures are the order's own; this page does no arithmetic.
    expect(html).toContain('$0.92');
    expect(html).toContain('$4,600.00');
  });

  it('offers every state, and no others', () => {
    const html = renderOrder(view(), 'en', null);
    for (const s of ORDER_STATES) expect(html, s).toContain(`value="${s}"`);
    expect(html).not.toContain('value="pending_confirmation"');
  });

  it('an order with nothing recorded says so rather than showing an empty list', () => {
    for (const locale of LOCALES) {
      const html = renderOrder(view({ history: [] }), locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'order.history.empty'));
      expect(visible, locale).toContain(t(locale, 'order.update.save'));
    }
  });

  it('it is reachable from the conversation, and registered as routes', async () => {
    const inbox = await readFile(new URL('../../src/api/web/inbox.ts', import.meta.url), 'utf8');
    expect(inbox).toContain('/app/orders/${esc(d.order.id)}');
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app/orders/:id'");
    expect(app).toContain("app.post('/app/orders/:id/update'");
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'order.state.confirmed', 'order.state.in_production', 'order.state.shipped',
      'order.state.cancelled', 'order.back', 'order.since', 'order.field.buyer',
      'order.field.product', 'order.field.quantity', 'order.field.total',
      'order.field.confirmed', 'order.field.tracking', 'order.update.title',
      'order.update.intro', 'order.update.state', 'order.update.tracking',
      'order.update.tracking.placeholder', 'order.update.note', 'order.update.note.placeholder',
      'order.update.save', 'order.history.title', 'order.history.empty',
      'order.invoice.title', 'order.invoice.intro', 'order.flash.recorded',
      'order.flash.unknown_state', 'order.flash.failed', 'order.open', 'order.notFound',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { date: '3 Aug' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
