import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * R1 (fix 3) IN THE TURN — found 2026-10-14 by the Arabic release run (tools/check-language-release.mjs): "a reply
 * caught and rewritten clean was the guard working, not evidence against her." The evidence loader and the ramp
 * already skipped such a trip (tests/integration/r1-evidence.test.ts), but the turn handed it to `selfDemote` as this
 * turn's violations, so ONE clean rewrite withdrew the capability for every buyer in every language — in the run, an
 * Arabic greeting's «تبحث», rewritten and sent neutral, turned greetings in English into drafts. Only a trip on the
 * reply that was KEPT (`guards_failed_twice`) demotes.
 */

const FORBIDDEN = 'Guangzhou Textile';
type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter };

function ports(lang: 'en' | 'ar'): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.forbidden = [FORBIDDEN];
  p.tenant.grantRows = (['greet', 'qualify', 'recommend', 'quote'] as const)
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  const analysis: Analysis = {
    language: { detected: lang, replyIn: lang },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  p.analyzer.next = analysis;
  return p;
}

async function turn(p: Ports, text: string, replies: string[]) {
  p.replyWriter.replies = replies;
  const req = { conversationId: CONVERSATION, messageId: `m-${replies.join('|').length}`, text };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { r, fx, violation: p.tenant.eventRows.find((e) => e.type === 'guard_violation')?.payload };
}

describe('R1 in the turn · only the kept reply\'s guard trip withdraws a capability', () => {
  it('a forbidden word caught and rewritten clean: sent, recorded, nothing withdrawn', async () => {
    const p = ports('en');
    const { fx, violation } = await turn(p, 'do you make bags?', [`We work with ${FORBIDDEN}.`, 'Yes, we make bags.']);
    expect(fx.outbound?.reply).toBe('Yes, we make bags.');
    expect(violation).toMatchObject({ final: false });
    expect(p.tenant.selfDemoted).toEqual([]);
  });

  it('an Arabic reply caught addressing the buyer in a gender and rewritten neutral: sent, nothing withdrawn', async () => {
    const p = ports('ar');
    const { fx, violation } = await turn(p, 'أريد حقيبة قماش', ['هل تبحث عن مقاس معين؟', 'هل هناك مقاس معين مطلوب؟']);
    expect(fx.outbound?.reply).toBe('هل هناك مقاس معين مطلوب؟');
    expect(violation).toMatchObject({ address: 'تبحث', final: false });
    expect(p.tenant.selfDemoted).toEqual([]);
  });

  it('the forbidden word written twice — the kept reply failed: withdrawn, as before', async () => {
    const p = ports('en');
    const { r, violation } = await turn(p, 'do you make bags?', [`We work with ${FORBIDDEN}.`, `${FORBIDDEN} makes them.`]);
    expect(r.hold).toBe('guards_failed_twice');
    expect(violation).toMatchObject({ final: true });
    expect(p.tenant.selfDemoted).toHaveLength(1);
  });
});
