import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, UNCLAIMED_AGENT, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { isProblemSignal, toTriggerReason, SIGNAL_SAMPLES } from '../../src/core/scoring/signals.js';
import { alertKindFor } from '../../src/pipeline/notify.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * "WANTS A PERSON" THROUGH THE REAL TURN (computeTurn → commitTurn), 2026-09-28.
 *
 * Where each layer sits, and what the buyer gets:
 *
 *   · layer 1 (the words) — before the analyser: no model is asked anything,
 *     the ordinary hand-off sentence goes out;
 *   · layer 2 (`wantsPerson`) — inside the analyser's answer, which comes
 *     BEFORE any reply is written: true hands off with the ordinary sentence
 *     and the reply writer is never called; false answers as usual;
 *   · null (the answer could not be read) — handed to a person as
 *     `not_answered`, and nothing is written at all: nobody understood the
 *     message, so there is nothing true to say to the buyer yet;
 *   · absent (an analyser that was not asked) — exactly as before.
 *
 * Every capability is on AUTO unless a test says draft: the setting in which a
 * reply would have gone out alone.
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(mode: 'auto' | 'draft' = 'auto'): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  if (mode === 'auto') {
    p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
      .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  }
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    // Told on an earlier turn, so an auto reply here is the reply itself.
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
    aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),   // …and it reached them (0079)
  }));
  p.replyWriter.replies = [ANSWER];
  return p;
}

/** No figure in it: the numeral guard would rightly refuse one nobody sourced. */
const ANSWER = 'Happy to help — which colour would you like?';

const analysis = (wantsPerson?: boolean | null): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification',
  ...(wantsPerson === undefined ? {} : { wantsPerson }),
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });

async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

const signalsOf = (p: Ports) => (p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind);

/** Only the meaning says it: no word on any list. */
const MEANING_ONLY = 'Hello?? Is anybody actually reading these messages?';

describe('layer 2 · true — the ordinary hand-off, and the writer is never called', () => {
  for (const mode of ['auto', 'draft'] as const) {
    it(`${mode}: ${JSON.stringify(MEANING_ONLY)}`, async () => {
      const p = ports(mode);
      p.analyzer.next = analysis(true);
      const { r, fx } = await run(p, MEANING_ONLY);
      expect(p.analyzer.calls).toBe(1);
      expect(p.replyWriter.calls).toBe(0);
      expect(r.decision.action).toEqual({ kind: 'handoff', notifyOnly: false });
      expect(r.reply).toBe(HANDOFF_REPLIES.en);
      expect(r.answerPath).toBe('handoff');
      expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
      expect(p.tenant.states.get(CONVERSATION)?.assignedTo).toBe(UNCLAIMED_AGENT);
      expect(signalsOf(p)).toEqual(['human_requested']);
      expect(alertKindFor(fx)).toBe('handoff');
      if (mode === 'auto') expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES.en);
      else expect(p.tenant.draftsCreated.map((d) => d.draftText)).toEqual([HANDOFF_REPLIES.en]);
    });
  }
});

describe('layer 2 · false — answered as usual, the analyser having read it', () => {
  // Layer 1 leaves every one of these to the analyser (tests/person).
  for (const text of [
    MEANING_ONLY,
    'Do you sell human hair wigs?',
    '我们在找人工成本低的工厂',
    'اريد احدث موديل',
    "I'll speak to someone in my team and get back to you",
    'Hi, you can call me Ahmed',
  ]) {
    it(JSON.stringify(text), async () => {
      const p = ports();
      p.analyzer.next = analysis(false);
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls).toBe(1);
      expect(p.analyzer.texts).toEqual([text]);
      expect(p.replyWriter.calls).toBe(1);
      expect(r.decision.action.kind).toBe('generate_reply');
      expect(r.newState.assignedTo).toBeNull();
      expect(signalsOf(p)).not.toContain('human_requested');
      expect(signalsOf(p)).not.toContain('not_answered');
      expect(fx.handoffAlert).toBe(false);
      expect(fx.outbound?.reply).toBe(ANSWER);
    });
  }
});

describe('layer 2 · "are you a human?" is answered, not handed off — and answered honestly', () => {
  it('the identity rule still decides what may be said (rule 3): an honest answer goes out', async () => {
    const p = ports();
    p.analyzer.next = analysis(false);
    const honest = "I'm an AI assistant for this business. If you'd like a person from our team, say so and someone will reply.";
    p.replyWriter.replies = [honest];
    const { r, fx } = await run(p, 'Are you a human?');
    expect(p.replyWriter.calls).toBe(1);
    expect(r.decision.action.kind).toBe('generate_reply');
    expect(r.identityViolation).toBeNull();
    expect(r.newState.assignedTo).toBeNull();
    expect(fx.outbound?.reply).toBe(honest);
  });

  it('and a reply that dodges the question is still held for the owner, as before', async () => {
    const p = ports();
    p.analyzer.next = analysis(false);
    const { r } = await run(p, 'Are you a human?');
    expect(r.identityViolation?.kind).toBe('identity_question_unanswered');
    expect(r.hold).not.toBeNull();
  });
});

describe('layer 2 · null — the answer could not be read: a person answers, nothing is written', () => {
  for (const mode of ['auto', 'draft'] as const) {
    it(`${mode}: handed over as not_answered — no reply, no draft, no writer; the ordinary alert`, async () => {
      const p = ports(mode);
      p.analyzer.next = analysis(null);
      const { r, fx } = await run(p, 'Do you sell human hair wigs?');
      expect(p.analyzer.calls).toBe(1);
      expect(p.replyWriter.calls).toBe(0);
      expect(r.decision.action).toEqual({ kind: 'handoff', notifyOnly: false });
      expect(r.reply).toBeNull();
      expect(r.answerPath).toBe('silent');
      expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
      expect(fx.outbound).toBeNull();
      expect(fx.draftCreated).toBeNull();
      expect(p.tenant.draftsCreated).toEqual([]);
      expect(signalsOf(p)).toEqual(['not_answered']);
      expect(p.tenant.eventRows.map((e) => e.type)).toContain('handoff');
      expect(alertKindFor(fx)).toBe('handoff');
      expect(p.tenant.deletionAsksNoted).toEqual([]);
    });
  }

  it('and the next message waits for the person, like every hand-off: silent, no model', async () => {
    const p = ports();
    p.analyzer.next = analysis(null);
    await run(p, 'Do you sell human hair wigs?');
    const { r } = await run(p, 'hello?');
    expect(p.analyzer.calls).toBe(1);
    expect(r.decision.action.kind).toBe('silent');
    expect(r.reply).toBeNull();
  });

  it('is a problem the hand-back resolves, with its own escalation reason', () => {
    expect(isProblemSignal(SIGNAL_SAMPLES.not_answered)).toBe(true);
    expect(toTriggerReason(SIGNAL_SAMPLES.not_answered)).toBe('not_answered');
  });
});

describe('layer 1 · the unambiguous request hands off with ZERO analyser calls — in the customer\'s language (LG)', () => {
  for (const [text, lang] of [
    ['Can I talk to someone?', 'en'],
    ['I want to speak with a person', 'en'],
    ['أريد أحدًا يساعدني', 'ar'],
    ['我要找你们经理', 'zh'],
    ['أريد التحدث مع مديركم', 'ar'],
    ['I want to speak to a real person now', 'en'],
  ] as const) {
    const HANDOFF = HANDOFF_REPLIES[lang];
    it(JSON.stringify(text), async () => {
      const p = ports();
      p.analyzer.next = analysis(false);   // it would say no — it is never asked
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls).toBe(0);
      expect(p.retriever.calls).toBe(0);
      expect(p.replyWriter.calls).toBe(0);
      expect(r.usage.llmCalls).toBe(0);
      expect(r.analysis).toBeNull();
      expect(r.reply).toBe(HANDOFF);
      expect(r.answerPath).toBe('handoff');
      expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
      expect(signalsOf(p)).toEqual(['human_requested']);
      expect(fx.outbound?.reply).toBe(HANDOFF);
      expect(alertKindFor(fx)).toBe('handoff');
    });
  }
});

describe('absent — an analyser that does not answer the question changes nothing', () => {
  it('the scripted analyses of the sandbox and the trust harness answer as they always did', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    const { r, fx } = await run(p, MEANING_ONLY);
    expect(r.decision.action.kind).toBe('generate_reply');
    expect(p.replyWriter.calls).toBe(1);
    expect(fx.outbound?.reply).toBe(ANSWER);
    expect(signalsOf(p)).toEqual([]);
  });
});
