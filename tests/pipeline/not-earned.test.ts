import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * G4 (0102) — A WORKSPACE THAT SIGNED ITSELF UP SENDS NOTHING ALONE until it
 * has earned it, at the one place that decides (`commitTurn`). The fall back
 * is a draft, never silence; the timeline and the card say why. Monotone: it
 * only ever takes authority away. Over Postgres: tests/integration/g4-earned.test.ts.
 */

const NOW = new Date('2026-10-01T04:00:00Z');

function ports(mode: 'auto' | 'draft'): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = { tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(), now: () => NOW };
  p.tenant.grantRows = (['qualify', 'recommend', 'quote'] as const).map((capability) => ({ capability, mode, timeWindow: null }));
  p.tenant.speakerIs = { name: 'Lily', role: 'sales', note: null, business: { name: 'Juniper Candles', kind: null, country: null, description: null } };
  p.analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  } satisfies Analysis;
  p.replyWriter.replies = ['Yes, we have it in stock.'];
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'clarification', product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
  }));
  return p;
}

async function run(p: ReturnType<typeof ports>) {
  const req = { conversationId: CONVERSATION, messageId: 'm-1', text: 'Do you have the juniper candle?' };
  const fx = await commitTurn(p, req, await computeTurn(p, req), Date.now());
  return { sent: fx.outbound?.reply ?? null, drafts: p.tenant.draftsCreated, events: p.tenant.eventRows };
}

describe('G4 · sending alone is earned', () => {
  it('NOT EARNED: auto as set, and the reply drafts — not_earned on the timeline and beside the draft', async () => {
    const p = ports('auto');
    p.tenant.earnedRungValue = 0;
    const { sent, drafts, events } = await run(p);
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    const withheld = events.find((e) => e.type === 'autonomy_withheld');
    expect(withheld?.payload).toMatchObject({ reason: 'not_earned' });
    // The card reads the reason from the draft's own event.
    expect(events.find((e) => e.type === 'draft_pending')?.payload).toMatchObject({ withheld: { reason: 'not_earned' } });
  });
  it('named first when the disclosure is also unread: earning is the one the owner cannot do anything about today', async () => {
    const p = ports('auto');
    p.tenant.earnedRungValue = 0;
    p.tenant.releasedFlag = false;
    const { events } = await run(p);
    expect(events.find((e) => e.type === 'autonomy_withheld')?.payload).toMatchObject({ reason: 'not_earned' });
  });
  it('DRAFT is untouched: nothing was going to go alone, so nothing was withheld', async () => {
    const p = ports('draft');
    p.tenant.earnedRungValue = 0;
    const { events } = await run(p);
    expect(events.some((e) => e.type === 'autonomy_withheld')).toBe(false);
  });
  it('R2 · rung 1 is enough for a talks reply (this one is recommend); rung 0 is not', async () => {
    const one = ports('auto');
    one.tenant.earnedRungValue = 1;
    const sent = await run(one);
    expect(sent.drafts).toHaveLength(0);
    expect(sent.sent).toContain('Yes, we have it in stock.');
    const none = ports('auto');
    none.tenant.earnedRungValue = 0;
    expect((await run(none)).drafts[0]?.capability).toBe('recommend');
  });
  it('EARNED: the same reply goes alone', async () => {
    const { sent, drafts } = await run(ports('auto'));
    expect(drafts).toHaveLength(0);
    expect(sent).toContain('Yes, we have it in stock.');
  });
});
