import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * 0159 (the owner, 2026-10-14) — "If (b) fails, Arabic stays out." A language held out of ONE workspace is not
 * answered there, though it is signed for the product: the buyer goes to a person under its own reason, and hears the
 * ordinary hand-off sentence — never silence, never a reply. Every capability on auto, so nothing else holds it.
 * Over Postgres, with the operator's tool: tests/integration/language-hold.test.ts.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter };

function ports(held: readonly string[]): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.heldLanguages = held;
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),
  }));
  return p;
}
const analysis = (lang: string): Analysis => ({
  language: { detected: lang, replyIn: lang },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'warm_intake',
  wantsPerson: false,
});

async function turn(held: readonly string[], text: string, lang: string) {
  const p = ports(held);
  p.analyzer.next = analysis(lang);
  p.replyWriter.replies = [lang === 'ar' ? 'أهلًا بكم، يسعدنا المساعدة.' : 'Hello, happy to help.'];
  const req = { conversationId: CONVERSATION, messageId: `m-${lang}-${held.join('')}`, text };
  const r = await computeTurn(p, req);
  const fx = await commitTurn(p, req, r, Date.now());
  return { p, r, fx };
}

const ARABIC = 'مرحبا، عندكم حقائب قماش؟';

describe('a language held out of this workspace', () => {
  it('Arabic held: a person answers — the buyer is told so, in Arabic; nothing written, nothing drafted', async () => {
    const { p, r, fx } = await turn(['ar'], ARABIC, 'ar');
    expect(r.signals.map((s) => s.kind)).toContain('language_held');
    expect(r.decision.action.kind).toBe('handoff');
    expect(fx.outbound?.reply, 'the buyer is told — never silence').toContain(HANDOFF_REPLIES.ar);
    expect(p.replyWriter.calls, 'no reply is written').toBe(0);
    expect(p.tenant.draftsCreated).toHaveLength(0);
  });

  it('English in the same workspace is answered as before', async () => {
    const { r, fx } = await turn(['ar'], 'Hello, do you have canvas bags?', 'en');
    expect(r.signals.map((s) => s.kind)).not.toContain('language_held');
    expect(fx.outbound?.reply).toBe('Hello, happy to help.');
  });

  it('released (nothing held): Arabic is answered as every signed language is', async () => {
    const { r, fx } = await turn([], ARABIC, 'ar');
    expect(r.signals.map((s) => s.kind)).not.toContain('language_held');
    expect(fx.outbound?.reply).toBe('أهلًا بكم، يسعدنا المساعدة.');
  });

  it('the gate\'s language decides, never the analysis\'s word alone: Arabic words read as English are still held', async () => {
    const { r } = await turn(['ar'], ARABIC, 'en');
    expect(r.signals.map((s) => s.kind)).toContain('language_held');
  });
});
