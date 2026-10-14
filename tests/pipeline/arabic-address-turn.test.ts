import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES, SAFE_REPLIES } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * Rule 6 through a whole turn (2026-10-14): what reaches the buyer. A reply
 * that addresses them as a man or a woman is written again, told why; twice
 * and it waits for a person, and the stand-in that waits addresses nobody
 * either — even when the analyser's own question did. The matcher itself is
 * tests/parity/arabic-address.test.ts.
 */
const GENDERED = 'هل تبحث عن مقاس معين؟';
const NEUTRAL = 'هل هناك مقاس معين مطلوب؟';

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = (['greet', 'qualify', 'recommend', 'quote'] as const)
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  return p;
}
const arabic = (nextQuestion: string | null = null): Analysis => ({
  language: { detected: 'ar', replyIn: 'ar' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: nextQuestion, missingFields: [] },
  recommendedPhase: 'clarification',
});

async function turn(replies: string[], opts: { nextQuestion?: string; forbidden?: string[]; text?: string } = {}) {
  const p = ports();
  p.analyzer.next = arabic(opts.nextQuestion ?? null);
  p.replyWriter.replies = replies;
  if (opts.forbidden) p.tenant.forbidden = opts.forbidden;
  const req = { conversationId: CONVERSATION, messageId: `m-${replies.join('|').length}`, text: opts.text ?? 'أريد حقيبة قماش' };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  const said = [fx.outbound?.reply ?? '', ...p.tenant.draftsCreated.map((d) => d.draftText)].filter(Boolean);
  return { p, r, fx, said };
}

describe('rule 6 · a reply that addresses the buyer in a gender never reaches them', () => {
  it('a neutral reply goes out as written, at the first writing', async () => {
    const { p, r, fx } = await turn([NEUTRAL]);
    expect(r.guardViolations).toBe(0);
    expect(r.genderedAddress).toBeNull();
    expect(fx.outbound?.reply).toBe(NEUTRAL);
    expect(p.replyWriter.calls).toBe(1);
  });

  it('a gendered reply is written again, told why — and the second, neutral, goes out', async () => {
    const { p, r, fx, said } = await turn([GENDERED, NEUTRAL]);
    expect(r.guardViolations).toBe(1);
    expect(r.genderedAddress).toBe('تبحث');
    expect(fx.outbound?.reply).toBe(NEUTRAL);
    for (const s of said) expect(s).not.toContain('تبحث');
    expect(p.replyWriter.inputs[0]?.violation).toBeUndefined();
    expect(p.replyWriter.inputs[1]?.violation).toBe('gendered_address');
    // The words are on the record, with the violation.
    const ev = p.tenant.eventRows.find((e) => e.type === 'guard_violation');
    expect(ev?.payload).toMatchObject({ address: 'تبحث', final: false });
  });

  // CHANGED BY DESIGN (2026-10-14, 0158): this held the turn as a draft — the buyer waited on it with nothing said.
  // The owner: "a buyer who gets nothing is not a pass". Gendered twice is now a hand-over the buyer is told about.
  it('gendered twice: a person answers, and the buyer is TOLD — the hand-off sentence, which addresses nobody', async () => {
    const { r, fx, said } = await turn([GENDERED, 'تحب تشوف الموديلات؟']);
    expect(r.signals.map((s) => s.kind)).toContain('address_unwritten');
    expect(r.decision.action.kind).toBe('handoff');
    expect(r.hold).toBeNull();
    expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES.ar);
    expect(fx.draftCreated).toBeFalsy();
    for (const s of said) {
      expect(s).not.toContain('تبحث');
      expect(s).not.toContain('تحب');
    }
  });

  // Rule 3 — and when the buyer had asked what they are talking to, the hand-over answers that too (seen live through
  // the turn, 2026-10-14: three «هل أنت روبوت؟» handed over with only "a person will reply").
  it('gendered twice on «هل أنت روبوت؟»: handed over, and the buyer is told what is answering — the disclosure', async () => {
    const { r, fx } = await turn([GENDERED, 'تحب تشوف الموديلات؟'], { text: 'هل أنت روبوت؟' });
    expect(r.signals.map((s) => s.kind)).toContain('address_unwritten');
    expect(fx.outbound?.reply).toContain(HANDOFF_REPLIES.ar);
    expect(fx.outbound?.reply).toContain('مساعد آلي');
  });

  // The stand-in is for a turn whose LAST attempt failed another guard: here, a number nobody gave.
  it("the stand-in never carries the analyser's own gendered question: the fixed sentence instead", async () => {
    const { r, said } = await turn([GENDERED, 'السعر 9.99 دولار للقطعة.'], { nextQuestion: 'هل تريد معرفة السعر؟' });
    expect(r.hold).toBe('guards_failed_twice');
    expect(r.reply).toBe(SAFE_REPLIES.ar);
    for (const s of said) expect(s).not.toContain('تريد');
  });

  it("a neutral analyser's question still stands in, as before", async () => {
    const { r } = await turn([GENDERED, 'السعر 9.99 دولار للقطعة.'], { nextQuestion: 'ما الكمية المطلوبة تقريبًا؟' });
    expect(r.reply).toBe('ما الكمية المطلوبة تقريبًا؟');
  });

  it('another guard\'s failure does not tell the next writing it was the address', async () => {
    const { p } = await turn(['هذا السعر حرام', NEUTRAL], { forbidden: ['حرام'] });
    expect(p.replyWriter.inputs[1]?.retryAfterViolation).toBe(true);
    expect(p.replyWriter.inputs[1]?.violation).toBeUndefined();
  });
});
