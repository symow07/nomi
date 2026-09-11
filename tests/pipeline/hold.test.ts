import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT, policy } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import { NO_KILL_SWITCHES } from '../../src/core/ops/killSwitch.js';
import { usd } from '../../src/core/types/money.js';

/**
 * G7a — her "ask me above this discount" line holds the reply, through the
 * production caller.
 *
 * The parity suite proves the rule; this proves the TURN obeys it. Before G7a
 * the quote carried `requiresHuman: true`, the audit stored it, and with
 * `quote` in auto the reply went straight to the buyer anyway.
 */

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  return {
    tenant: new FakeTenant(),
    retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(),
    replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
}

const analysis = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: {
    primary: 'inquiry', productCandidate: null, quantityMentioned: null,
    nextLogicalQuestion: null, missingFields: [],
  },
  recommendedPhase: 'commercial_discussion',
});

/** 5,000 pcs on the $0.45 tier, `quote` in auto, and a negotiation rule giving `pct` off. */
function quoting(pct: number, text = 'what is your best price for 5000?') {
  const p = ports();
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'commercial_discussion',
    product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
    quantity: { value: 5000, unit: 'pcs' },
  }));
  p.analyzer.next = analysis();
  p.replyWriter.replies = ['Here is what we can do for that volume.'];
  p.tenant.grantRows = [{ capability: 'quote', mode: 'auto', timeWindow: null }];
  // Her rules: floor $0.35, never more than 10% off, ask her above 7%.
  p.tenant.policies.set(PRODUCT, policy({ maxDiscountPct: 10, humanRequiredAbovePct: 7 }));
  p.tenant.rules = [{
    businessId: policy().businessId, priority: 1, condition: {},
    action: { kind: 'discount_pct', value: pct },
  }];
  return { p, req: { conversationId: CONVERSATION, messageId: `m-${pct}`, text } };
}

describe('G7a · a discount past her ask line waits for her', () => {
  it('9% off, past her 7% line — a draft, however her autonomy is set', async () => {
    const { p, req } = quoting(9);
    const r = await computeTurn(p, req);
    expect(r.quote?.discountPct).toBe(9);
    expect(r.hold).toBe('discount_needs_owner');

    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).not.toBeNull();
    // Priced, so it is the quote capability that waits — the one she granted.
    expect(p.tenant.draftsCreated[0]!.capability).toBe('quote');
    // And the reason travels with the draft, so her card can say why.
    const pending = p.tenant.eventRows.find((e) => e.type === 'draft_pending');
    expect(pending?.payload).toMatchObject({ heldBecause: 'discount_needs_owner' });
  });

  it('5% off, inside her line — it sends, exactly as her auto grant says', async () => {
    const { p, req } = quoting(5);
    const r = await computeTurn(p, req);
    expect(r.hold).toBeNull();
    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound).not.toBeNull();
    expect(fx.draftCreated).toBeNull();
  });

  it('AT her line is not past it — 7% sends', async () => {
    const { p, req } = quoting(7);
    const r = await computeTurn(p, req);
    expect(r.hold).toBeNull();
    expect((await commitTurn(p, req, r, Date.now())).outbound).not.toBeNull();
  });

  it('a hold never WIDENS permission — a silenced capability stays silent, and nothing is sent', async () => {
    const { p, req } = quoting(9);
    p.tenant.switches = { ...NO_KILL_SWITCHES, silenceCapability: ['quote'] };
    const r = await computeTurn(p, req);
    expect(r.hold).toBe('discount_needs_owner');
    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).toBeNull();   // "never auto-sends", not "always a draft"
    expect(p.tenant.eventRows.some((e) => e.type === 'send_suppressed')).toBe(true);
  });

  it('a heard quantity is the reason given when both apply — the price may be built on a mishearing', async () => {
    const { p, req } = quoting(9, 'can you do 5000 pieces?');
    const r = await computeTurn(p, { ...req, provenance: 'transcribed' });
    expect(r.hold).toBe('quantity_heard_not_typed');
    await commitTurn(p, { ...req, provenance: 'transcribed' }, r, Date.now());
    const pending = p.tenant.eventRows.find((e) => e.type === 'draft_pending');
    expect(pending?.payload).toMatchObject({ heldBecause: 'quantity_heard_not_typed' });
  });

  it('auto-demotion still keys off her grant, not the hold — a held reply is not a guard failure', async () => {
    const { p, req } = quoting(9);
    const r = await computeTurn(p, req);
    await commitTurn(p, req, r, Date.now());
    expect(p.tenant.selfDemoted).toEqual([]);
  });
});

describe('G7b · a price above what he was given waits for her', () => {
  const march = new Date('2026-03-04T10:00:00Z');

  it('held — as a QUOTE, with both prices on the event — however her autonomy is set', async () => {
    const { p, req } = quoting(0);                       // $0.45, no discount
    p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(0.40), at: march }];
    const r = await computeTurn(p, req);
    expect(r.quote?.unitPrice).toEqual(usd(0.45));       // the quote EXISTS — not refused
    expect(r.hold).toBe('contradicts_history');

    const fx = await commitTurn(p, req, r, Date.now());
    expect(fx.outbound).toBeNull();
    expect(p.tenant.draftsCreated[0]!.capability).toBe('quote');
    const pending = p.tenant.eventRows.find((e) => e.type === 'draft_pending');
    expect(pending?.payload).toMatchObject({
      heldBecause: 'contradicts_history',
      contradicts: { prior: { unitPrice: usd(0.40), at: march }, proposedUnitPrice: usd(0.45), how: 'higher_same_quantity' },
    });
  });

  it('contradicting him outranks her discount line — and the card still gets both prices', async () => {
    const { p, req } = quoting(9);                       // $0.41, past her 7% line
    p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(0.38), at: march }];
    const r = await computeTurn(p, req);
    expect(r.quote?.requiresHuman).toBe(true);
    expect(r.hold).toBe('contradicts_history');
  });

  it('the same price again, or a lower one, is not held', async () => {
    for (const before of [0.45, 0.50]) {
      const { p, req } = quoting(0);
      p.tenant.priorQuotes = [{ quantity: 5000, unitPrice: usd(before), at: march }];
      const r = await computeTurn(p, req);
      expect(r.hold, String(before)).toBeNull();
      expect((await commitTurn(p, req, r, Date.now())).outbound, String(before)).not.toBeNull();
    }
  });
});
