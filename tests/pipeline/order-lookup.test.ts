import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { SAFE_REPLIES } from '../../src/core/conversation/templates.js';
import { ORDER_LOOKUP_REFUSAL, readOrderAnswer, type OrderContext } from '../../src/core/commerce/shopifyOrders.js';
import type { OrderLookup, OrderLookupResult } from '../../src/pipeline/orderLookup.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * BLOCK 5.5 — THE TURN AND A SHOPIFY ORDER (the approved v2 patch). The port is faked here: what Shopify says and how
 * the lookup is claimed are proven over Postgres in tests/integration/shopify-orders.test.ts.
 *
 *   · No `#` number, or no port: the port is never asked and the turn is what it was.
 *   · 'off': nothing changes — no order on the writer's input, no `order_facts`.
 *   · 'refused': the fixed 43-byte sentence, no writer, and it waits for the owner (`order_facts`), in auto too.
 *     Blocked by her forbidden words: the stand-in, held (`guards_failed_twice`), the words named, still `order_facts`.
 *   · 'verified': the facts reach the writer as `order`, their figures sourced; the reply drafts with `order_facts`; a
 *     "delivered" with no delivery date is written again.
 */

const NOW = new Date('2026-11-10T04:00:00Z');
const ASK = 'Where is my order #1001? My email is ana@example.test';
const ORDER: OrderContext = {
  name: '#1001', placed_on: '2026-11-01', fulfillment: 'Fulfilled', payment: 'Paid',
  shipments: [{ status: 'SUCCESS', display_status: 'In transit', expected_on: '2026-11-14', tracking: [{ number: '1Z999AA10123456784' }] }],
};

/** What Shopify answers for that order when it names the carrier and a link on the carrier's own site. */
const SHOPIFY_SAYS_UPS = { data: { orders: { pageInfo: { hasNextPage: false }, nodes: [{
  name: '#1001', createdAt: '2026-11-01T10:00:00Z', cancelledAt: null, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
  email: 'ana@example.test', fulfillments: [{ status: 'SUCCESS', displayStatus: 'IN_TRANSIT', deliveredAt: null, estimatedDeliveryAt: '2026-11-14T12:00:00Z',
    trackingInfo: [{ company: 'UPS', number: '1Z999AA10123456784', url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784' }] }],
}] } } };

class FakeLookup implements OrderLookup {
  asked: Parameters<OrderLookup['look']>[0][] = [];
  constructor(private readonly answer: OrderLookupResult) {}
  async look(input: Parameters<OrderLookup['look']>[0]): Promise<OrderLookupResult> { this.asked.push(input); return this.answer; }
}

function ports(mode: 'sells' | 'waits' = 'sells') {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => NOW };
  p.tenant.selling = { pricesToOwner: false, kind: 'online_shop', quantityFirst: false };
  const modes = modesFor(mode);
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: modes[capability], timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({ phase: 'clarification', aiDisclosedAt: new Date('2026-11-10T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-11-10T03:00:00Z') }));
  p.replyWriter.replies = ['Thanks for waiting! How else can I help?'];
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'other', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification', wantsPerson: false,
  } satisfies Analysis;
  return p;
}
type P = ReturnType<typeof ports>;
const req = (text = ASK) => ({ conversationId: CONVERSATION, messageId: 'm-order', text });

async function run(p: P & { orderLookup?: OrderLookup }, text = ASK) {
  const r = await computeTurn(p as TurnPorts, req(text));
  const fx = await commitTurn(p as TurnPorts, req(text), r, Date.now());
  const pending = p.tenant.eventRows.find((e) => e.type === 'draft_pending')?.payload as Record<string, unknown> | undefined;
  const withheld = p.tenant.eventRows.find((e) => e.type === 'autonomy_withheld')?.payload as Record<string, unknown> | undefined;
  return { r, fx, pending, withheld };
}
const anyOrderFacts = (p: P) => JSON.stringify(p.tenant.eventRows).includes('order_facts');

describe('5.5 · the turn and a Shopify order', () => {
  it('no port: the turn is what it was — no order on the input, nothing held for it', async () => {
    const p = ports();
    const { r, fx } = await run(p);
    expect(r.orderLookup).toBeNull();
    expect(p.replyWriter.inputs.every((i) => !('order' in i))).toBe(true);
    expect(fx.outbound).not.toBeNull();
    expect(anyOrderFacts(p)).toBe(false);
  });

  it('no `#` number: the port is never asked', async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'refused' }) };
    const { r } = await run(p, 'Where is my order? ana@example.test');
    expect(p.orderLookup.asked).toHaveLength(0);
    expect(r.orderLookup).toBeNull();
    expect(anyOrderFacts(p)).toBe(false);
  });

  it("'off': nothing changes — the writer answers, no order, no order_facts", async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'off' }) };
    const { r, fx } = await run(p);
    expect(p.orderLookup.asked).toEqual([{ conversationId: CONVERSATION, orderName: '#1001', email: 'ana@example.test' }]);
    expect(r.orderLookup).toBeNull();
    expect(p.replyWriter.inputs.every((i) => !('order' in i))).toBe(true);
    expect(fx.outbound).not.toBeNull();
    expect(anyOrderFacts(p)).toBe(false);
  });

  it("'refused', clean: the fixed sentence, no writer, held as order_facts even in auto", async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'refused' }) };
    const { r, fx, pending, withheld } = await run(p);
    expect(r.reply).toBe(ORDER_LOOKUP_REFUSAL);
    expect(Buffer.byteLength(ORDER_LOOKUP_REFUSAL)).toBe(43);
    expect(r.answerPath).toBe('canned');
    expect(r.orderLookup).toBe('refused');
    expect(p.replyWriter.calls).toBe(0);
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).not.toBeNull();
    expect(withheld).toMatchObject({ reason: 'order_facts' });
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' } });
  });

  it("'refused', blocked by her forbidden word: the stand-in, held, the word named, still order_facts", async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'refused' }) };
    p.tenant.forbidden = ['find'];
    const { r, fx, pending } = await run(p);
    expect(r.reply).toBe(SAFE_REPLIES.en);
    expect(r.answerPath).toBe('stand_in');
    expect(r.hold).toBe('guards_failed_twice');
    expect(r.forbiddenHits.map((h) => h.term)).toContain('find');
    expect(r.orderLookup).toBe('refused');
    expect(p.replyWriter.calls).toBe(0);
    expect(fx.outbound).toBeNull();
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' }, forbidden: ['find'] });
  });

  it("'verified': the facts reach the writer, its figures are sourced, and the reply drafts with order_facts", async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'verified', order: ORDER }) };
    p.replyWriter.replies = ['Your order #1001 is in transit, tracking 1Z999AA10123456784, expected on 14 November.'];
    const { r, fx, pending, withheld } = await run(p);
    expect(p.replyWriter.inputs.at(-1)?.order).toEqual(ORDER);
    expect(r.reply).toContain('1Z999AA10123456784');
    expect(r.orderLookup).toBe('verified');
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).not.toBeNull();
    expect(withheld).toMatchObject({ reason: 'order_facts' });
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' } });
  });

  it("'verified' in draft mode: order_facts is on the card there too", async () => {
    const p = { ...ports('waits'), orderLookup: new FakeLookup({ kind: 'verified', order: ORDER }) };
    p.replyWriter.replies = ['Your order #1001 is in transit.'];
    const { fx, pending } = await run(p);
    expect(fx.outbound).toBeNull();
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' } });
  });

  it('OPEN (the owner\'s) — a carrier named in a reply is still a shipping claim: the claims guard is unchanged, so "UPS" falls to the held stand-in', async () => {
    // The existing guard reads "UPS" as an express-courier promise the owner has not ticked. Loosening it is the owner's
    // call, not this block's; the writer is never given the carrier (above), and one it names anyway is held.
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'verified', order: ORDER }) };
    p.replyWriter.replies = ['Your order #1001 is with UPS, tracking 1Z999AA10123456784.'];
    const { r, fx, pending } = await run(p);
    expect(r.answerPath).toBe('stand_in');
    expect(r.reply).not.toContain('UPS');
    expect(r.hold).toBe('guards_failed_twice');
    expect(fx.outbound).toBeNull();
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' } });
  });

  it('a verified order whose carrier Shopify named: no carrier and no carrier link reach the writer; a reply naming one anyway is still held', async () => {
    const read = readOrderAnswer(SHOPIFY_SAYS_UPS, { orderName: '#1001', email: 'ana@example.test', readsAllOrders: false, now: NOW, zone: 'UTC' });
    expect(read.outcome).toBe('verified');
    const order = (read as { order: OrderContext }).order;
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'verified', order }) };
    p.replyWriter.replies = ['Your order #1001 is on its way with UPS, tracking 1Z999AA10123456784.'];
    const { r, fx, pending } = await run(p);
    const told = JSON.stringify(p.replyWriter.inputs);
    expect(told).toContain('1Z999AA10123456784');
    expect(told).not.toMatch(/UPS|ups\.com|carrier/);
    expect(r.answerPath).toBe('stand_in');
    expect(r.reply).not.toContain('UPS');
    expect(r.hold).toBe('guards_failed_twice');
    expect(fx.outbound).toBeNull();
    expect(pending).toMatchObject({ withheld: { reason: 'order_facts' } });
  });

  it('"delivered" with no delivery date is written again', async () => {
    const p = { ...ports(), orderLookup: new FakeLookup({ kind: 'verified', order: ORDER }) };
    p.replyWriter.replies = ['Your order #1001 has been delivered.', 'Your order #1001 is in transit.'];
    const { r } = await run(p);
    expect(p.replyWriter.calls).toBe(2);
    expect(r.reply).toContain('in transit');
    expect(r.reply).not.toContain('delivered');
  });
});
