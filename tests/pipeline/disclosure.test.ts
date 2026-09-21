import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * ITEM 3 — a message nobody approved says what it is, once, at the top.
 *
 * Two rules meet in this file and they are not the same rule:
 *
 *   · THE DISCLOSURE. Anything reaching a buyer without a person having read
 *     it carries the sentence first — the first such message in a conversation,
 *     and only the first. A draft the owner pressed send on carries nothing:
 *     she read it, and she is a person.
 *
 *   · THE HELD TURN THAT STILL ANSWERS. He asked what he was talking to, she
 *     failed twice to say, and the turn is held. In draft that is the whole
 *     answer. In auto it is not: he was going to get a message, and turning
 *     that into silence is the one outcome worse than a clumsy answer.
 *
 * And the line between them: a reply that CLAIMED to be human sends nothing,
 * in either mode, ever.
 */

const NOW = new Date('2026-09-22T04:00:00Z');

type Mode = 'auto' | 'draft';

function ports(mode: Mode): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => NOW,
  };
  p.tenant.grantRows = (['qualify', 'recommend', 'quote'] as const)
    .map((capability) => ({ capability, mode, timeWindow: null }));
  // The name the owner confirmed in Getting ready, and her business's name.
  // Without both there is nothing honest to substitute and nothing is sent.
  p.tenant.speakerIs = {
    name: 'Lily', role: 'sales', note: null,
    business: { name: 'Yiwu Canvas Co', kind: null, country: null, description: null },
  };
  return p;
}

const analysis = (detected = 'en'): Analysis => ({
  language: { detected, replyIn: detected },
  intent: {
    primary: 'inquiry', productCandidate: null, quantityMentioned: null,
    nextLogicalQuestion: null, missingFields: [],
  },
  recommendedPhase: 'clarification',
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });

async function run(p: ReturnType<typeof ports>, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx, sent: fx.outbound?.reply ?? null, drafts: p.tenant.draftsCreated, events: p.tenant.eventRows };
}

const seed = (p: ReturnType<typeof ports>, over = {}) =>
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'clarification',
    product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
    ...over,
  }));

describe('the disclosure rides on the first message nobody approved', () => {
  it('AUTO · the first reply carries it, in front of what she was going to say', async () => {
    const p = ports('auto');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts } = await run(p, 'Hello, do you make canvas bags?');
    expect(drafts).toHaveLength(0);                       // auto: nobody was going to look
    expect(sent).toContain("I'm Lily, Yiwu Canvas Co's AI assistant");
    expect(sent).toContain('as soon as they can');        // never "any time": a solo owner sleeps
    expect(sent).toContain('We make canvas totes in several sizes.');
    expect(sent!.indexOf('AI assistant')).toBeLessThan(sent!.indexOf('We make canvas totes'));
  });

  it('AUTO · and never twice in the same conversation', async () => {
    const p = ports('auto');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.', 'Yes, we ship to Morocco.'];

    const first = await run(p, 'Hello, do you make canvas bags?');
    expect(first.sent).toContain('AI assistant');
    expect(p.tenant.disclosedAt.get(CONVERSATION)).toEqual(NOW);

    const second = await run(p, 'Do you ship to Morocco?');
    expect(second.sent).toBe('Yes, we ship to Morocco.');
    expect(second.sent).not.toContain('AI assistant');
  });

  it('AUTO · in the buyer’s language, from what he wrote', async () => {
    const zh = ports('auto');
    seed(zh);
    zh.analyzer.next = analysis('zh');
    zh.replyWriter.replies = ['我们做帆布袋。'];
    expect((await run(zh, '你们做帆布袋吗？')).sent).toContain('的AI助手');

    const ar = ports('auto');
    seed(ar);
    ar.analyzer.next = analysis('ar');
    ar.replyWriter.replies = ['نعم، نصنع حقائب القماش.'];
    expect((await run(ar, 'هل تصنعون حقائب قماشية؟')).sent).toContain('المساعد الذكي لدى');
  });

  it('DRAFT · carries nothing, because a person will read it before he does', async () => {
    const p = ports('draft');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.draftText).toBe('We make canvas totes in several sizes.');
    expect(p.tenant.disclosedAt.has(CONVERSATION)).toBe(false);
  });

  it('with no name confirmed, nothing is invented and nothing is sent in front', async () => {
    const p = ports('auto');
    p.tenant.speakerIs = null;                             // Getting ready not finished
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toBe('We make canvas totes in several sizes.');
  });
});

describe('a buyer who asked is never left in silence — but only in AUTO', () => {
  /**
   * She answers something else entirely. No denial: nothing a phrase list can
   * find — and no NUMERALS either, or the numeral guard would refuse it first
   * and this would be testing that instead.
   */
  const evades = (p: ReturnType<typeof ports>) => {
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill('What size were you looking for?');
  };

  it('AUTO · the disclosure goes out instead, and the turn is STILL held for her', async () => {
    const p = ports('auto');
    seed(p);
    evades(p);

    const { r, sent, drafts, events } = await run(p, 'Quick question — are you a bot?');
    expect(r.identityViolation?.kind).toBe('identity_question_unanswered');
    expect(r.hold).toBe('guards_failed_twice');

    // He was told.
    expect(sent).toContain("I'm Lily, Yiwu Canvas Co's AI assistant");
    expect(sent).not.toContain('What size');               // not the evasion, only the sentence
    // …and she was told to look.
    expect(drafts).toHaveLength(1);
    const held = events.find((e) => e.type === 'draft_pending');
    expect((held?.payload as { heldBecause?: string }).heldBecause).toBe('guards_failed_twice');
    expect((held?.payload as { identity?: { kind: string } }).identity?.kind)
      .toBe('identity_question_unanswered');
    expect(events.some((e) => e.type === 'ai_disclosed')).toBe(true);
  });

  it('DRAFT · holds exactly as before — nothing was ever going out without her', async () => {
    const p = ports('draft');
    seed(p);
    evades(p);

    const { r, sent, drafts } = await run(p, 'Quick question — are you a bot?');
    expect(r.identityViolation?.kind).toBe('identity_question_unanswered');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(p.tenant.disclosedAt.has(CONVERSATION)).toBe(false);
  });

  it('AUTO · a claim to be HUMAN sends nothing at all', async () => {
    // The line the addition does not cross. There is no version of this turn a
    // buyer should receive, and the disclosure would answer a question he did
    // not ask — he asked about totes.
    const p = ports('auto');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill("Don't worry, I'm a real person!");

    const { r, sent, drafts } = await run(p, 'Can you do 5,000 totes?');
    expect(r.identityViolation?.kind).toBe('denied_being_ai');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(p.tenant.disclosedAt.has(CONVERSATION)).toBe(false);
  });

  it('DRAFT · a claim to be HUMAN sends nothing at all', async () => {
    const p = ports('draft');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill("Don't worry, I'm a real person!");

    const { r, sent, drafts } = await run(p, 'Can you do 5,000 totes?');
    expect(r.identityViolation?.kind).toBe('denied_being_ai');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
  });

  it('AUTO · a denial while he ALSO asked still sends nothing', async () => {
    // Both rules could fire. The denial wins, in the direction of silence.
    const p = ports('auto');
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill("No, I'm not a bot — I'm a real person.");

    const { r, sent } = await run(p, 'are you a bot?');
    expect(r.identityViolation?.kind).toBe('denied_being_ai');
    expect(sent).toBeNull();
  });
});
