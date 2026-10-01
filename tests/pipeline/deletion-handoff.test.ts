import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, UNCLAIMED_AGENT, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { HANDOFF_REPLIES } from '../../src/core/conversation/templates.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';
import { alertKindFor } from '../../src/pipeline/notify.js';
import { handToPerson } from '../../src/pipeline/received.js';
import { OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import type { AgentId } from '../../src/core/types/ids.js';
import { NOT_REQUESTS } from '../parity/deletion-corpus.js';

/**
 * 0075 — a buyer who asks for their data to be deleted is answered by a
 * PERSON, and the assistant says NOTHING: no reply, no receipt, no
 * acknowledgment (the owner's decision, 2026-09-27).
 *
 * Driven through the real turn (computeTurn → commitTurn) with every
 * capability on AUTO, the setting in which any reply would have gone out
 * alone:
 *
 *   · layer 1 — the buyer's own words, in en / zh / ar: no model is asked
 *     anything, nothing is sent or drafted, the conversation waits for a
 *     person with the reason recorded;
 *   · with a request for a person in the same message, still nothing — not
 *     even the hand-off sentence;
 *   · layer 2 — a request in words layer 1 does not know, answered by a reply
 *     that promises the deletion: that reply is thrown away, in auto AND in
 *     draft, and no quote is recorded as told;
 *   · the comparison: a passing mention ("delete that line from the quote") is
 *     answered as usual, and goes out alone.
 */

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter; retriever: FakeRetriever } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.grantRows = CAPABILITIES.filter((c) => c !== 'confirm_order')
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  p.tenant.seed(CONVERSATION, emptyState({
    phase: 'qualification',
    // Told on an earlier turn, so an auto reply here is the reply itself.
    aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
    aiDisclosureDeliveredAt: new Date('2026-07-14T03:00:00Z'),   // …and it reached them (0079)
  }));
  p.analyzer.next = analysis();
  return p;
}

const analysis = (over: Partial<Analysis['intent']> = {}, replyIn = 'en'): Analysis => ({
  language: { detected: replyIn, replyIn },
  intent: {
    primary: 'inquiry', productCandidate: null, quantityMentioned: null,
    nextLogicalQuestion: null, missingFields: [], ...over,
  },
  recommendedPhase: 'qualification',
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });

async function run(p: ReturnType<typeof ports>, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx };
}

/** Everything the owner's rule forbids, asserted together. `noted`: this message wrote the request down. */
function expectSilentHandoff(
  p: ReturnType<typeof ports>, r: Awaited<ReturnType<typeof run>>['r'], fx: Awaited<ReturnType<typeof run>>['fx'],
  noted = true,
) {
  expect(r.reply).toBeNull();
  expect(r.answerPath).toBe('silent');
  expect(r.decision.action).toEqual({ kind: 'handoff', notifyOnly: false });
  expect(r.newState.assignedTo).toBe(UNCLAIMED_AGENT);
  expect(fx.outbound).toBeNull();
  expect(fx.draftCreated).toBeNull();
  expect(p.tenant.draftsCreated).toEqual([]);
  expect(fx.handoffAlert).toBe(true);
  expect(p.tenant.eventRows.map((e) => e.type)).toContain('handoff');
  expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).toContain('deletion_requested');
  expect(p.tenant.states.get(CONVERSATION)?.assignedTo).toBe(UNCLAIMED_AGENT);
  // 0076 — written down with the hand-off, and the owner told in its own words.
  if (noted) expect(p.tenant.deletionAsksNoted.map((x) => x.conversationId)).toContain(CONVERSATION);
  expect(fx.deletionAlert).toBe(true);
  expect(alertKindFor(fx)).toBe('deletion_requested');
}

const LAYER_ONE: Record<'en' | 'zh' | 'ar', readonly string[]> = {
  en: ['Please delete my data.', 'Remove me from your database', 'I am exercising my right to be forgotten'],
  zh: ['请删除我的数据', '把我的个人信息删了', '我要求行使被遗忘权'],
  ar: ['أرجو حذف بياناتي', 'امسحوا جميع رسائلي', 'أطالب بالحق في النسيان'],
};

describe('0075 · layer 1 — the buyer asks, and nothing at all is sent', () => {
  for (const [lang, texts] of Object.entries(LAYER_ONE)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)} — no model, no reply, no draft; a person has it`, async () => {
        const p = ports();
        const { r, fx } = await run(p, text);
        expect(p.analyzer.calls).toBe(0);
        expect(p.replyWriter.calls).toBe(0);
        expect(p.retriever.calls).toBe(0);
        expect(r.usage.llmCalls).toBe(0);
        expectSilentHandoff(p, r, fx);
      });
    }
  }

  it('asked together with a request for a person, it is STILL silent — not even the hand-off sentence', async () => {
    const p = ports();
    const { r, fx } = await run(p, 'Delete my data, and I want to speak to a real person.');
    expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind).sort())
      .toEqual(['deletion_requested', 'human_requested']);
    expectSilentHandoff(p, r, fx);
  });

  it('an earlier request still unresolved keeps any later hand-off silent', async () => {
    const p = ports();
    p.tenant.signalRows.set(CONVERSATION, [{ kind: 'deletion_requested' }]);
    const { r, fx } = await run(p, 'hello?');
    expect(p.analyzer.calls).toBe(0);
    // Written down when it came, not again for "hello?" — and still its own alert.
    expectSilentHandoff(p, r, fx, false);
    expect(p.tenant.deletionAsksNoted).toEqual([]);
  });

  it('a request for a person on its own still gets the hand-off sentence (unchanged)', async () => {
    const p = ports();
    const { r, fx } = await run(p, 'I want to speak to a real person.');
    expect(r.reply).toBe(HANDOFF_REPLIES.en);
    expect(r.answerPath).toBe('handoff');
    expect(fx.outbound?.reply).toBe(HANDOFF_REPLIES.en);
  });
});

describe('0075 · layer 2 — a reply that promises the deletion is never sent', () => {
  // "get rid of everything about me" is outside layer 1's words on purpose.
  const SLIPS_PAST = "Can you get rid of everything about me? I don't want to be in your files.";

  it('the words slip past layer 1, and the reply promising the deletion is thrown away (auto)', async () => {
    const p = ports();
    p.replyWriter.replies = ["Of course — I've deleted your data."];
    const { r, fx } = await run(p, SLIPS_PAST);
    expect(p.analyzer.calls).toBe(1);              // it was asked; that is what layer 2 is for
    expect(r.deletionPromiseWithheld).toMatch(/deleted your data/);
    expectSilentHandoff(p, r, fx);
    expect(p.tenant.eventRows.find((e) => e.type === 'deletion_promise_withheld')?.payload)
      .toEqual({ words: expect.stringMatching(/deleted your data/) });
  });

  it('in DRAFT too: no draft of the promise waits to be approved', async () => {
    const p = ports();
    p.tenant.grantRows = [];
    p.replyWriter.replies = ['We will delete your personal information.'];
    const { r, fx } = await run(p, SLIPS_PAST);
    expectSilentHandoff(p, r, fx);
  });

  it('an attempt that ALSO fails another guard still decides it — no retry, no stand-in goes out', async () => {
    // "30" is an unsourced number: the numeral guard alone would have spent
    // both attempts and sent the fixed stand-in. The promise is read first.
    const p = ports();
    p.replyWriter.replies = ['We will delete your personal information within 30 days.'];
    const { r, fx } = await run(p, SLIPS_PAST);
    expect(p.replyWriter.calls).toBe(1);
    expect(r.hold).toBeNull();
    expectSilentHandoff(p, r, fx);
  });

  it('a promise in the SECOND attempt is caught as well', async () => {
    const p = ports();
    p.replyWriter.replies = ['Our price is 99 dollars.', 'All the data we hold about you has been deleted.'];
    const { r, fx } = await run(p, SLIPS_PAST);
    expect(p.replyWriter.calls).toBe(2);
    expectSilentHandoff(p, r, fx);
  });

  it('a quote computed on that turn is not recorded as told — the buyer was told nothing', async () => {
    const p = ports();
    p.analyzer.next = analysis({
      productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantityMentioned: { value: 5000, unit: 'pcs' },
    });
    p.replyWriter.replies = ['Your data has been removed from our records.'];
    const { r, fx } = await run(p, '5000 bags please, and get rid of everything about me afterwards');
    expectSilentHandoff(p, r, fx);
    expect(r.quote).toBeNull();
    expect(p.tenant.quotesRecorded).toEqual([]);
    expect(p.tenant.eventRows.map((e) => e.type)).not.toContain('knowledge_used');
  });

  it('a reply that promises nothing about their data goes out as usual', async () => {
    const p = ports();
    p.replyWriter.replies = ["I'll pass that to the team and they will reply to you."];
    const { r, fx } = await run(p, SLIPS_PAST);
    expect(r.deletionPromiseWithheld).toBeNull();
    expect(fx.outbound?.reply).toBe("I'll pass that to the team and they will reply to you.");
  });
});

describe('0075 · the comparison — a passing mention is answered as usual, and alone', () => {
  const PASSING: readonly [string, string, string][] = [
    ['en', 'delete that line from the quote', 'Done — that line is gone.'],
    ['en', 'Please remove the logo from the bag', 'Sure, no logo.'],
    ['zh', '把报价里那一行删掉', '好的，已删除那一行。'],
    ['zh', '我的邮箱写错了，删掉重发', '好的，请重新发一下。'],
    ['ar', 'احذف السطر من عرض السعر', 'تم حذف السطر من عرض السعر.'],
    ['ar', 'امسح الشعار من الحقيبة', 'حسنًا، بدون شعار.'],
  ];
  for (const [lang, text, answer] of PASSING) {
    it(`${lang}: ${JSON.stringify(text)} — the assistant answers, and it sends`, async () => {
      const p = ports();
      p.analyzer.next = analysis({}, lang);
      p.replyWriter.replies = [answer];
      const { r, fx } = await run(p, text);
      expect(p.analyzer.calls).toBe(1);
      expect(r.decision.action.kind).toBe('generate_reply');
      expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind)).not.toContain('deletion_requested');
      expect(r.newState.assignedTo).toBeNull();
      expect(fx.outbound?.reply).toBe(answer);
    });
  }
});

describe('0076 · the request is written down when the hand-off fires', () => {
  it('with the conversation and the message that asked', async () => {
    const p = ports();
    const r = await computeTurn(p, req('Please delete my data.'));
    await commitTurn(p, req('Please delete my data.'), r, Date.now());
    expect(r.deletionAsked).toBe(true);
    expect(p.tenant.deletionAsksNoted).toEqual([
      { conversationId: CONVERSATION, messageId: req('Please delete my data.').messageId, outcome: 'noted' },
    ]);
  });

  it('when a person already holds the conversation: nothing sent, still written down, and the owner told', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState({ assignedTo: OWNER_AGENT as AgentId }));
    const { r, fx } = await run(p, '请删除我的个人信息');
    expect(r.decision.action.kind).toBe('silent');
    expect(p.analyzer.calls).toBe(0);
    expect(fx.outbound).toBeNull();
    expect(fx.draftCreated).toBeNull();
    expect(p.tenant.deletionAsksNoted).toHaveLength(1);
    expect(alertKindFor(fx)).toBe('deletion_requested');
  });

  it('asked again into a conversation a person holds: the same request, counted — and no second alert', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState({ assignedTo: OWNER_AGENT as AgentId }));
    await run(p, 'أرجو حذف بياناتي');
    const { fx } = await run(p, 'أرجو حذف بياناتي مرة أخرى');
    expect(p.tenant.deletionAsksNoted.map((x) => x.outcome)).toEqual(['noted', 'asked_again']);
    expect(alertKindFor(fx)).toBeNull();
  });

  it('already recorded by the owner, and the assistant held it again: nothing new noted, the owner told', async () => {
    const p = ports();
    p.tenant.deletionRecorded = true;
    const { r, fx } = await run(p, 'Delete my account');
    expect(r.reply).toBeNull();
    expect(p.tenant.deletionAsksNoted.map((x) => x.outcome)).toEqual(['already_recorded']);
    expect(alertKindFor(fx)).toBe('deletion_requested');
  });

  it('a reply that promised it (layer 2) writes it down too', async () => {
    const p = ports();
    p.replyWriter.replies = ["Of course — I've deleted your data."];
    const { r, fx } = await run(p, "Can you get rid of everything about me? I don't want to be in your files.");
    expect(r.deletionAsked).toBe(true);
    expect(p.tenant.deletionAsksNoted).toHaveLength(1);
    expect(alertKindFor(fx)).toBe('deletion_requested');
  });

  it('a request for a person alone writes nothing down, and keeps the ordinary alert', async () => {
    const p = ports();
    const { r, fx } = await run(p, 'I want to speak to a real person.');
    expect(r.deletionAsked).toBe(false);
    expect(p.tenant.deletionAsksNoted).toEqual([]);
    expect(alertKindFor(fx)).toBe('handoff');
  });
});

describe('0076 · where no turn runs — stopped, paused, not on the list, an e-mail answer', () => {
  const tenant = () => {
    const t = new FakeTenant();
    t.seed(CONVERSATION, emptyState());
    return t;
  };

  it('a deletion request in what they wrote is written down, named as its own reason, and alerted as one', async () => {
    const t = tenant();
    const fx = await handToPerson(t, CONVERSATION, { kind: 'assistant_stopped' },
      [{ messageId: 'wamid.1', text: 'hello' }, { messageId: 'wamid.2', text: 'Please delete my data' }]);
    expect((t.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind).sort()).toEqual(['assistant_stopped', 'deletion_requested']);
    expect(t.deletionAsksNoted).toEqual([{ conversationId: CONVERSATION, messageId: 'wamid.2', outcome: 'noted' }]);
    expect(alertKindFor(fx)).toBe('deletion_requested');
  });

  it('anything else is the ordinary hand-off, with nothing written down', async () => {
    const t = tenant();
    const fx = await handToPerson(t, CONVERSATION, { kind: 'unlisted_number' },
      [{ messageId: 'wamid.3', text: 'delete that line from the quote' }]);
    expect(t.deletionAsksNoted).toEqual([]);
    expect(alertKindFor(fx)).toBe('handoff');
  });
});

/**
 * Found 2026-09-27: "my account manager" handed off — the request-for-a-person
 * list matched "manager" anywhere. Fixed 2026-09-28 (the buyer's own manager is
 * not a request for a person, src/core/scoring/detect.ts), so all 45 are now
 * answered as usual, and none may hand off for ANY reason.
 */
describe('0076 · the 45 passing mentions, through the real turn: none hands off, none is written down', () => {
  for (const [lang, texts] of Object.entries(NOT_REQUESTS)) {
    for (const text of texts) {
      it(`${lang}: ${JSON.stringify(text)}`, async () => {
        const p = ports();
        p.analyzer.next = analysis({}, lang);
        p.replyWriter.replies = ['Noted.'];
        const { r, fx } = await run(p, text);
        expect(r.deletionAsked, text).toBe(false);
        expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind), text).not.toContain('deletion_requested');
        expect(p.tenant.deletionAsksNoted, text).toEqual([]);
        expect(alertKindFor(fx), text).not.toBe('deletion_requested');
        expect(r.decision.action.kind, text).not.toBe('handoff');
        expect((p.tenant.signalRows.get(CONVERSATION) ?? []).map((s) => s.kind), text).not.toContain('human_requested');
        expect(fx.outbound?.reply, text).toBe('Noted.');
      });
    }
  }
});
