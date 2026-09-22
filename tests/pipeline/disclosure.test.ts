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

  /*
   * There used to be a case here asserting that with no name, the reply went
   * out WITHOUT a disclosure — "nothing is invented". That was the hole: it
   * described a message going to a buyer unsupervised and unannounced, and
   * called it correct because nothing was fabricated. Nothing being fabricated
   * was never the requirement. A workspace with no name to say does not send
   * alone at all now; see "she may not speak alone until she can say what she
   * is" below, which is what replaced it.
   */
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

describe('having said it before does not answer a question asked now', () => {
  it('AUTO · already disclosed, he asks anyway, and he is told again', async () => {
    const p = ports('auto');
    // The conversation was told on an earlier turn — days ago, four messages up.
    seed(p, { aiDisclosedAt: new Date('2026-09-20T09:00:00Z') });
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill('What size were you looking for?');

    const { r, sent, drafts, events } = await run(p, 'Wait — are you a bot?');
    expect(r.identityViolation?.kind).toBe('identity_question_unanswered');
    expect(sent).toContain("I'm Lily, Yiwu Canvas Co's AI assistant");
    expect(drafts).toHaveLength(1);                        // and still held for her
    expect(events.filter((e) => e.type === 'ai_disclosed')).toHaveLength(1);
  });

  it('…and the column still records the FIRST telling, not this one', async () => {
    const first = new Date('2026-09-20T09:00:00Z');
    const p = ports('auto');
    seed(p, { aiDisclosedAt: first });
    p.analyzer.next = analysis();
    p.replyWriter.replies = Array(3).fill('What size were you looking for?');

    await run(p, 'Wait — are you a bot?');
    // The event trail carries every telling; the column carries the first.
    expect(p.tenant.disclosedAt.get(CONVERSATION)).toBeUndefined();
  });

  it('an ordinary auto reply after disclosure still carries nothing', async () => {
    const p = ports('auto');
    seed(p, { aiDisclosedAt: new Date('2026-09-20T09:00:00Z') });
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['Yes, we ship to Morocco.'];

    expect((await run(p, 'Do you ship to Morocco?')).sent).toBe('Yes, we ship to Morocco.');
  });
});

describe('she may not speak alone until she can say what she is', () => {
  /**
   * The fleet this is for: every workspace activated BEFORE Getting ready
   * asked for the name is live today with no confirmation on file. Without
   * this, autonomy on such a workspace sends messages that skip the disclosure
   * silently — the rule quietly not applying to exactly the accounts that
   * predate it.
   */
  it('AUTO with no confirmation falls back to draft, and says so on the timeline', async () => {
    const p = ports('auto');
    p.tenant.assistantNamedFlag = false;                   // activated before the gate existed
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts, events } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toBeNull();                               // nothing went out unsupervised
    expect(drafts).toHaveLength(1);                        // she keeps working; the owner reads it
    expect(drafts[0]!.draftText).toBe('We make canvas totes in several sizes.');
    const withheld = events.find((e) => e.type === 'autonomy_withheld');
    expect((withheld?.payload as { reason?: string }).reason).toBe('assistant_not_named');
  });

  it('AUTO with a confirmation but no NAME to say also falls back', async () => {
    // The attestation and the row can disagree — an assistant archived after
    // the fact, a workspace restored from an older backup. Either way there is
    // no sentence, so there is no unsupervised send.
    const p = ports('auto');
    p.tenant.speakerIs = null;
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts, events } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    const withheld = events.find((e) => e.type === 'autonomy_withheld');
    expect((withheld?.payload as { reason?: string }).reason).toBe('no_assistant_name');
  });

  it('DRAFT is untouched by the gate — it was already drafting', async () => {
    const p = ports('draft');
    p.tenant.assistantNamedFlag = false;
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts, events } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toBeNull();
    expect(drafts).toHaveLength(1);
    // Nothing was withheld: nothing was ever going to be sent alone.
    expect(events.some((e) => e.type === 'autonomy_withheld')).toBe(false);
  });

  it('and once she confirms the name, auto works as set', async () => {
    const p = ports('auto');
    p.tenant.assistantNamedFlag = true;
    seed(p);
    p.analyzer.next = analysis();
    p.replyWriter.replies = ['We make canvas totes in several sizes.'];

    const { sent, drafts } = await run(p, 'Hello, do you make canvas bags?');
    expect(sent).toContain('AI assistant');
    expect(drafts).toHaveLength(0);
  });
});
