import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { orderBlockedReply } from '../../src/core/conversation/templates.js';
import type { ConversationState } from '../../src/core/types/conversation.js';
import type { Email } from '../../src/core/types/ids.js';
import { usd } from '../../src/core/types/money.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * The language sweep's finding 1, through a whole turn (the owner, 2026-10-14): "a buyer who just said yes gets
 * quoted the price AGAIN, alone, without me ever seeing it… Fail toward me, not toward a wrong reply."
 *
 * Every capability on auto — the setting in which a re-quote goes out alone. After a price was given, a yes the
 * list does not know is handed to the owner as `maybe_confirmation`: the buyer hears the order's own line in their
 * language, the writer is never asked, no price is worked out or said, and no order is proposed. A question is still
 * answered; a word on the list still proposes the order. Over Postgres: tests/integration/order-proposal.test.ts.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter };

function ports(): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.replyWriter.replies = ['That is 0.45 each, 2,250.00 in total — shall I go ahead?'];
  p.analyzer.next = analysis();
  return p;
}

const analysis = (primary = 'inquiry'): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary, productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'confirmation',
  wantsPerson: false,
});

const told = { aiDisclosedAt: new Date('2026-07-14T11:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T11:00:05Z') };
const product = { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' as const };
/** "Shall I go ahead?" asked, waiting for the answer. */
const waiting = (): ConversationState => emptyState({
  phase: 'confirmation', pendingQuestion: 'order_confirmation', product, quantity: { value: 5000, unit: 'pcs' },
  contact: { email: 'customer@example.com' as Email }, ...told,
});
/** A price given, nothing asked yet. */
const priced = (): ConversationState => emptyState({
  phase: 'commercial_discussion', pendingQuestion: null, product, quantity: { value: 5000, unit: 'pcs' }, ...told,
});

async function run(p: Ports, state: ConversationState, text: string) {
  p.tenant.seed(CONVERSATION, state);
  const req = { conversationId: CONVERSATION, messageId: `m-${text.slice(0, 16)}`, text };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, fx };
}

/** Deliberately NOT on the list, one per language — and the order's line each is answered with. */
const NOT_ON_THE_LIST = [
  { lang: 'en' as const, text: 'Sounds great, let us go with that' },
  { lang: 'zh' as const, text: '那就这么定了吧' },
  { lang: 'ar' as const, text: 'تمام كذا، نمشي على هذا' },
];

describe('a yes the list does not know goes to the owner — never answered with the price again', () => {
  for (const { lang, text } of NOT_ON_THE_LIST) {
    it(`${lang}, "shall I go ahead?" waiting: ${text}`, async () => {
      const p = ports();
      const { r, fx } = await run(p, waiting(), text);
      expect(r.signals.map((s) => s.kind)).toContain('maybe_confirmation');
      expect(r.decision.action.kind).toBe('handoff');
      expect(fx.outbound?.reply).toBe(orderBlockedReply(['conversation_handed_off'], null, lang));
      expect(p.replyWriter.calls, 'the writer is never asked').toBe(0);
      expect(r.quote, 'no price is worked out').toBeNull();
      expect(fx.outbound?.reply ?? '').not.toMatch(/0\.45|2,250/);
      expect(p.tenant.orderProposals_, 'no order is proposed on a maybe').toHaveLength(0);
    });
  }

  for (const text of ['Send the invoice to the usual address.', '发票开给我吧']) {
    it(`"shall I go ahead?" waiting, an answer with none of the words is the owner's too: ${text}`, async () => {
      const p = ports();
      const { r, fx } = await run(p, waiting(), text);
      expect(r.signals.map((s) => s.kind)).toContain('maybe_confirmation');
      expect(fx.outbound?.reply ?? '').not.toMatch(/0\.45|2,250/);
    });
  }

  it('a price given, nothing asked yet: a yes in words is the owner\'s too', async () => {
    for (const text of ['sounds good', '好的，就这个']) {
      const p = ports();
      p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(0.45), at: new Date('2026-07-14T10:00:00Z') }];
      const { r } = await run(p, priced(), text);
      expect(r.signals.map((s) => s.kind), text).toContain('maybe_confirmation');
      expect(p.replyWriter.calls, text).toBe(0);
    }
  });

  it('the owner\'s card is told what to show: their words verbatim, and the LAST price given — "5000" after a price for 1,000', async () => {
    const p = ports();
    p.tenant.priorQuotes = [
      { quantity: 5000, unitPrice: usd(0.45), at: new Date('2026-07-14T09:00:00Z') },
      { quantity: 1000, unitPrice: usd(0.5), at: new Date('2026-07-14T10:00:00Z') },
    ];
    const { r } = await run(p, priced(), 'ok, 5000 again please');
    const s = r.signals.find((x) => x.kind === 'maybe_confirmation');
    expect(s).toMatchObject({
      said: 'ok, 5000 again please',
      offer: { quantity: 1000, unitPrice: usd(0.5), total: usd(500), givenAt: '2026-07-14T10:00:00.000Z' },
    });
    expect(s && 'offer' in s ? s.offer?.productName : null).toBeTruthy();
  });

  it('a "shall I go ahead?" waiting with no price on record: the card says so (offer null), their words still kept', async () => {
    const p = ports();
    const { r } = await run(p, waiting(), 'Sounds great, let us go with that');
    expect(r.signals.find((x) => x.kind === 'maybe_confirmation')).toMatchObject({ said: 'Sounds great, let us go with that', offer: null });
  });

  it('a yes with none of the words, read by the analysis as an order, after a price: the owner\'s', async () => {
    const p = ports();
    p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(0.45), at: new Date('2026-07-14T10:00:00Z') }];
    p.analyzer.next = analysis('order_intent');
    const { r } = await run(p, priced(), 'Please put it through.');
    expect(r.signals.map((s) => s.kind)).toContain('maybe_confirmation');
  });
});

describe('what is NOT a maybe', () => {
  it('a word on the list — even with its full stop — proposes the order, as before', async () => {
    const p = ports();
    const { r } = await run(p, waiting(), '好的。');
    expect(r.decision.action.kind).toBe('confirm_order');
    expect(r.signals.map((s) => s.kind)).not.toContain('maybe_confirmation');
  });

  for (const text of ['Can you do 0.40 each?', '太贵了', 'لا، غالي']) {
    it(`a question or a hesitation is answered: ${text}`, async () => {
      const p = ports();
      const { r } = await run(p, waiting(), text);
      expect(r.signals.map((s) => s.kind)).not.toContain('maybe_confirmation');
      expect(r.decision.action.kind).toBe('generate_reply');
    });
  }

  it('no price given yet: "ok" is just "ok"', async () => {
    const p = ports();
    const { r } = await run(p, emptyState({ phase: 'clarification', ...told }), 'ok');
    expect(r.signals.map((s) => s.kind)).not.toContain('maybe_confirmation');
  });

  it('a price given, and the analysis reads no order in words with no yes: answered', async () => {
    const p = ports();
    p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(0.45), at: new Date('2026-07-14T10:00:00Z') }];
    const { r } = await run(p, priced(), 'What colours does it come in');
    expect(r.signals.map((s) => s.kind)).not.toContain('maybe_confirmation');
  });
});
