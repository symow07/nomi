import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { promisesWhatNothingKeeps } from '../../src/core/safety/unkeptPromise.js';
import { acknowledgesAi } from '../../src/core/safety/identity.js';
import { emptyState, CONVERSATION } from './fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * THE IDENTITY PATH, IN ENGLISH (the finishing roadmap, Block 1 #1; 2026-11-06).
 *
 * An identity reply once said "I'll hand this conversation over" and nothing handed it over: a customer who asks for
 * a person is handed over BEFORE the writer (rule 19), so a writer that offers it is promising what nothing keeps.
 * Since #425 the prompt says so and `promisesWhatNothingKeeps` holds it. This file pins both on the identity path:
 *   · the prompt tells the writer to answer and stop — no team, no hand-over;
 *   · an honest "I" answer goes out alone, unchanged, with no hand-off and nothing drafted;
 *   · an answer that offers a hand-over is caught, written again, and the honest second attempt is what leaves;
 *   · the net reads the identity sentences customers really get, both ways.
 * The live counterpart is tools/check-identity.mjs (three calls, the owner's yes).
 */

type Ports = TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever };

function ports(): Ports {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-11-06T09:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  // Told once already, so the disclosure's "first message" rule is spent and only the words themselves count.
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-11-06T08:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-11-06T08:00:00Z'),
  }));
  return p;
}
const analysis = (): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'qualification', wantsPerson: false,
});
const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });
async function run(p: Ports, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

describe('Block 1 #1 · the writer is told to answer and stop', () => {
  const prompt = readFileSync(new URL('../../prompts/response.txt', import.meta.url), 'utf8');
  it('the identity section says: first person, answer briefly, no team, no hand-over offer', () => {
    expect(prompt).toContain('IF A CUSTOMER ASKS WHETHER THEY ARE TALKING TO A PERSON OR A BOT');
    expect(prompt).toContain('Do not mention the team and do not offer to hand anything over');
    expect(prompt).toContain('A customer who asks for a person is handled before you write');
  });
  it('and it is never told to say it will hand the conversation over', () => {
    expect(prompt).not.toMatch(/hand (?:this|the) conversation over/i);
    expect(prompt).not.toMatch(/(?<!not )offer to (?:transfer|escalate|hand)/i);
  });
});

describe('Block 1 #1 · an honest "I" answer goes out alone, with nothing promised', () => {
  for (const [text, honest] of [
    ['Are you a bot?', "I'm an AI assistant for Rose & Oak. What can I help you with today?"],
    ['Am I talking to a real person right now?', "No — I'm an AI assistant, answering for Rose & Oak. Happy to help with anything about the products."],
    ['Is this an AI or a human typing?', "It's an AI assistant writing. Which product were you looking at?"],
  ] as const) {
    it(text, async () => {
      const p = ports();
      p.analyzer.next = analysis();
      p.replyWriter.replies = [honest];
      const { r, fx } = await run(p, text);
      expect(p.replyWriter.calls).toBe(1);
      expect(r.reply).toBe(honest);
      expect(r.identityViolation).toBeNull();
      expect(r.unkeptPromise).toBeNull();
      expect(r.hold).toBeNull();
      expect(r.decision.action.kind).not.toBe('handoff');
      expect(fx.outbound?.reply).toBe(honest);
      expect(p.tenant.draftsCreated).toEqual([]);
      expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).not.toContain('human_requested');
    });
  }
});

describe('Block 1 #1 · an answer that offers a hand-over is written again', () => {
  it('"I\'ll hand this conversation over" is caught as a promise nothing keeps; the honest second attempt leaves', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    const offered = "I'm an automated assistant. I'll hand this conversation over to the team so someone can help you.";
    const honest = "I'm an AI assistant for Rose & Oak — happy to answer your questions here.";
    p.replyWriter.replies = [offered, honest];
    const { r, fx } = await run(p, 'Are you a bot?');
    expect(p.replyWriter.calls).toBe(2);
    expect(p.replyWriter.inputs[1]?.retryAfterViolation).toBe(true);
    expect(r.reply).toBe(honest);
    expect(r.hold).toBeNull();
    expect(fx.outbound?.reply).toBe(honest);
    expect(p.tenant.eventRows.some((e) => e.type === 'guard_violation')).toBe(true);
    // Nothing was handed over: the words that promised it never left, and no person holds the conversation.
    expect(r.decision.action.kind).not.toBe('handoff');
    expect(p.tenant.draftsCreated).toEqual([]);
  });

  it('twice: neither promise leaves — the fixed disclosure answers instead (G4b), and what waits promises nothing', async () => {
    const p = ports();
    p.analyzer.next = analysis();
    const first = "I'm a bot — let me pass you to a colleague.";
    const second = "I'm an AI assistant; someone from our team will take over.";
    p.replyWriter.replies = [first, second];
    const { r, fx } = await run(p, 'Are you a bot?');
    expect(p.replyWriter.calls).toBe(2);
    expect(r.hold).not.toBeNull();
    // In auto the identity question is still answered — by the disclosure sentence, which is the one fixed sentence
    // that may name the team: asking for a person IS handled (rule 19, before the writer), so it keeps what it says.
    expect(fx.outbound?.reply).not.toBe(first);
    expect(fx.outbound?.reply).not.toBe(second);
    expect(acknowledgesAi(fx.outbound?.reply ?? '')).toBe(true);
    for (const d of p.tenant.draftsCreated) expect(promisesWhatNothingKeeps(d.draftText)).toBeNull();
  });
});

describe('Block 1 #1 · the net on the identity sentences themselves', () => {
  const CAUGHT = [
    "I'm an AI assistant. I'll hand this conversation over to the team.",
    "Yes, I'm a bot — I can transfer you to a real person.",
    "I'm an automated assistant; a member of our team will reply shortly.",
    "I'm an AI. Let me pass you to someone who can help.",
  ];
  const LEFT_ALONE = [
    "I'm an AI assistant for Rose & Oak. How can I help?",
    "No, I'm not a person — I'm an AI assistant. Which product were you asking about?",
    "I'm an automated assistant answering for the shop. The shop itself is run by real people.",
    "I'm an AI assistant. If you'd like to talk to a person, just say so.",   // an offer to ask, not a promise to act
  ];
  for (const reply of CAUGHT) it(`caught: ${reply}`, () => expect(promisesWhatNothingKeeps(reply)).not.toBeNull());
  for (const reply of LEFT_ALONE) it(`left alone: ${reply}`, () => expect(promisesWhatNothingKeeps(reply)).toBeNull());
});
