import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { SAFE_REPLY } from '../../src/core/conversation/templates.js';
import { emptyState, CONVERSATION, PRODUCT } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * G8 — nothing unguarded reaches a buyer.
 *
 * A forbidden term and a reply that fails the guards twice, driven through
 * every path a reply takes: the generated reply, the stand-in after two
 * failures, her taught answer, and the order-status line. In every case the
 * term never reaches the buyer; when the employee could not write it, the
 * owner gets a draft; and a word found in HER OWN text is shown to her without
 * being counted against the employee.
 */

const FORBIDDEN = 'Guangzhou Textile';

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T04:00:00Z'),
  };
  p.tenant.forbidden = [FORBIDDEN];
  // Every capability she might exercise here is in AUTO: the point is what
  // happens when nobody would have looked.
  p.tenant.grantRows = (['qualify', 'recommend', 'quote'] as const)
    .map((capability) => ({ capability, mode: 'auto' as const, timeWindow: null }));
  return p;
}

const analysis = (over: Partial<Analysis['intent']> = {}, phase = 'clarification'): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: {
    primary: 'inquiry', productCandidate: null, quantityMentioned: null,
    nextLogicalQuestion: null, missingFields: [], ...over,
  },
  recommendedPhase: phase as Analysis['recommendedPhase'],
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 10)}`, text });

/** Everything that could reach the buyer, or the owner's desk, from one turn. */
async function run(p: ReturnType<typeof ports>, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  const said = [fx.outbound?.reply ?? '', ...p.tenant.draftsCreated.map((d) => d.draftText)];
  return { r, fx, said, events: p.tenant.eventRows };
}

describe('G8 · the generated reply fails twice', () => {
  it('the stand-in is sourced and guarded, the term never appears, and it WAITS FOR HER', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState({
      // Told on an earlier turn: this file is about what the reply
      // itself says, not about the disclosure in front of the first one.
      aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
      phase: 'commercial_discussion',
      product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantity: { value: 5000, unit: 'pcs' },
    }));
    p.analyzer.next = analysis({}, 'commercial_discussion');
    p.replyWriter.replies = [`We are cheaper than ${FORBIDDEN}.`];   // both attempts

    const { r, fx, said, events } = await run(p, 'price for 5000?');
    expect(r.guardViolations).toBe(2);
    expect(r.hold).toBe('guards_failed_twice');
    expect(fx.outbound).toBeNull();                       // auto grant or not
    expect(fx.draftCreated).not.toBeNull();
    for (const s of said) expect(s).not.toContain(FORBIDDEN);
    // The stand-in states the quote's own figures and nothing else.
    expect(p.tenant.draftsCreated[0]!.draftText).toContain('0.45');
    // The owner is told which word kept stopping her...
    const pending = events.find((e) => e.type === 'draft_pending');
    expect(pending?.payload).toMatchObject({ heldBecause: 'guards_failed_twice', forbidden: [FORBIDDEN] });
    // ...and it IS the employee's failure: evidence, as before.
    expect(events.some((e) => e.type === 'guard_violation')).toBe(true);
  });

  it('the analyser’s question is model text, so it is guarded too — failing that, one fixed sentence', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = analysis({ nextLogicalQuestion: `Are you comparing us with ${FORBIDDEN}?` });
    p.replyWriter.replies = [`Unlike ${FORBIDDEN}, we…`];

    const { said, r } = await run(p, 'hello, do you make bags?');
    expect(r.reply).toBe(SAFE_REPLY);
    for (const s of said) expect(s).not.toContain(FORBIDDEN);
  });

  it('a clean analyser question is still used — the stand-in is guarded, not discarded', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = analysis({ nextLogicalQuestion: 'Which size are you looking for?' });
    p.replyWriter.replies = [`Unlike ${FORBIDDEN}, we…`];
    const { r } = await run(p, 'hello, do you make bags?');
    expect(r.reply).toBe('Which size are you looking for?');
    expect(r.hold).toBe('guards_failed_twice');
  });

  it('NEVER an internal note — a refused quote’s guidance to the writer is not words for the buyer', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState({
      // Told on an earlier turn: this file is about what the reply
      // itself says, not about the disclosure in front of the first one.
      aiDisclosedAt: new Date('2026-07-14T03:00:00Z'),
      product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantity: { value: 10, unit: 'pcs' },                 // below the 1,000 MOQ → a refusal
    }));
    p.analyzer.next = analysis();                            // no question of its own
    p.replyWriter.replies = [`Unlike ${FORBIDDEN}, we…`];
    const { r, said } = await run(p, 'can I get 10?');
    expect(r.quoteRefusal?.kind).toBe('below_moq');
    // It used to fall back to the refusal note itself: "Quantity 10 is below the minimum of 1000."
    for (const s of said) expect(s).not.toMatch(/below the minimum/i);
    expect(r.hold).toBe('guards_failed_twice');
  });
});

describe('G8 · a forbidden word in HER OWN text', () => {
  it('her taught answer: not sent, shown to her, tagged — and NOT counted against the employee', async () => {
    const p = ports();
    // Told on an earlier turn: this test is about her own words reaching a
    // buyer, not about the disclosure in front of the first message.
    p.tenant.seed(CONVERSATION, emptyState({ aiDisclosedAt: new Date('2026-07-14T03:00:00Z') }));
    p.analyzer.next = analysis();
    p.tenant.knowledgeRows.push({
      id: 'k-faq', productId: null, kind: 'faq', label: 'Who else do you supply?',
      content: `We also supply ${FORBIDDEN} and others.`, source: 'owner_confirmed', status: 'active',
    });
    p.replyWriter.replies = ['We supply retailers across the Gulf.'];

    const { r, fx, said, events } = await run(p, 'who else do you supply?');
    expect(r.forbiddenInHerText).toEqual([{ term: FORBIDDEN, source: 'owner', path: 'taught_answer' }]);
    for (const s of said) expect(s).not.toContain(FORBIDDEN);
    expect(fx.outbound?.reply).toBe('We supply retailers across the Gulf.');
    expect(events.find((e) => e.type === 'forbidden_in_her_text')?.payload)
      .toEqual({ hits: [{ term: FORBIDDEN, source: 'owner', path: 'taught_answer' }] });
    // The employee did not write it: no violation, no demotion.
    expect(events.some((e) => e.type === 'guard_violation')).toBe(false);
    expect(p.tenant.selfDemoted).toEqual([]);
  });

  it('the order-status line: not sent, tagged as hers', async () => {
    const p = ports();
    p.tenant.forbidden = ['DHL'];
    p.tenant.seed(CONVERSATION, emptyState());
    p.analyzer.next = analysis();
    p.tenant.latestOrder = {
      orderId: 'o1', reference: 'PI-T-0001',
      update: { state: 'shipped', at: new Date('2026-07-10T00:00:00Z'), note: null, trackingReference: 'DHL 4471', by: 'owner' },
    };
    p.replyWriter.replies = ['Let me check on that for you.'];

    const { r, said, events } = await run(p, 'where is my order?');
    expect(r.forbiddenInHerText.map((x) => x.path)).toEqual(['order_status']);
    for (const s of said) expect(s).not.toContain('DHL');
    expect(events.some((e) => e.type === 'guard_violation')).toBe(false);
  });
});
