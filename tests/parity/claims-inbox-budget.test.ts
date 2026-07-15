import { describe, it, expect } from 'vitest';
import { detectClaims, guardClaims, type AllowedClaim } from '../../src/core/safety/claims.js';
import { claim, release, slaCheck, type Handoff } from '../../src/inbox/transitions.js';
import { checkBudget } from '../../src/core/budget.js';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';
import { emptyState, CONVERSATION } from './fixtures.js';

/* ─────────────────────────── CLAIMS GUARD (P4) ─────────────────────────── */
describe('claims guard — numeral-free commitments, default-deny', () => {
  const policy: AllowedClaim[] = [
    { kind: 'payment_terms', claimKey: 'deposit_30_70', allowed: true },
    { kind: 'incoterm', claimKey: 'FOB', allowed: true },
    { kind: 'certification', claimKey: 'food_grade', allowed: true },
  ];

  it.each([
    ['This product is CE certified for the EU market.', 'CE'],
    ['Yes, we can ship DDP to Hamburg.', 'DDP'],
    ['All items come with a full refund guarantee.', 'refund'],
    ['We are FDA approved.', 'FDA'],
    ['Delivery guaranteed before Ramadan.', 'event_deadline'],
  ])('REJECTS unpolicied commitment: %s', (reply, key) => {
    const r = guardClaims({ reply, policy });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.claims.map((c) => c.claimKey)).toContain(key);
  });

  it.each([
    'Payment is 30% deposit, 70% before shipment.',   // policied
    'We can offer FOB Ningbo.',                        // policied
    'These zip-lock bags are food-grade LDPE.',        // policied
    'What quantity are you considering?',              // no claims at all
  ])('allows policied or claim-free replies: %s', (reply) => {
    expect(guardClaims({ reply, policy }).ok).toBe(true);
  });

  it('a client ASKING for DDP does not license the reply to promise it', () => {
    // (unlike numerals, nothing is allowlisted from the client's message)
    const bad = guardClaims({ reply: 'Sure, DDP is no problem!', policy: [] });
    expect(bad.ok).toBe(false);
    const good = guardClaims({ reply: 'Let me confirm the shipping terms with my colleague.', policy: [] });
    expect(good.ok).toBe(true);
  });

  it('an allowed:false row is an explicit deny, same as absence', () => {
    const r = guardClaims({
      reply: 'We can do DDP.',
      policy: [{ kind: 'incoterm', claimKey: 'DDP', allowed: false }],
    });
    expect(r.ok).toBe(false);
  });

  it('detection is multilingual-safe on the token level (DDP inside Chinese text)', () => {
    expect(detectClaims('我们可以做DDP到迪拜').map((c) => c.claimKey)).toContain('DDP');
  });
});

describe('claims guard wired into the pipeline', () => {
  it('a reply promising CE certification is rejected twice, then templated', async () => {
    const p: TurnPorts & { tenant: FakeTenant; replyWriter: FakeReplyWriter } = {
      tenant: new FakeTenant(),
      retriever: new FakeRetriever(),
      analyzer: new FakeAnalyzer(),
      replyWriter: new FakeReplyWriter(),
      now: () => new Date(),
    };
    (p.analyzer as FakeAnalyzer).next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null,
                nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
    p.replyWriter.replies = [
      'Absolutely, these are CE certified and FDA approved!',  // rejected
      'They are definitely CE certified.',                     // rejected again
    ];
    p.tenant.seed(CONVERSATION, emptyState());

    const r = await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-claims', text: 'are these certified for the EU?' });
    expect(r.guardViolations).toBe(2);
    expect(r.replyDeterministic).toBe(true);
    expect(r.reply).not.toMatch(/CE certified|FDA/);
  });
});

/* ─────────────────────────── INBOX (P3) ─────────────────────────── */
describe('inbox transitions', () => {
  const now = new Date('2026-07-15T10:00:00Z');
  const open = (over: Partial<Handoff> = {}): Handoff => ({
    id: 'h1', conversationId: 'd1', requestedAt: new Date('2026-07-15T09:50:00Z'),
    slaDeadlineAt: new Date('2026-07-15T10:05:00Z'),
    holdingSentAt: null, claimedAt: null, claimedBy: null, releasedAt: null, ...over,
  });

  it('claim: first agent wins, second is refused', () => {
    expect(claim(open(), 'agent-a', now).ok).toBe(true);
    const second = claim(open({ claimedBy: 'agent-a', claimedAt: now }), 'agent-b', now);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('already_claimed');
  });

  it('release: requires the claimer AND a real summary', () => {
    const h = open({ claimedBy: 'agent-a', claimedAt: now });
    expect(release(h, 'agent-b', 'agreed 5% discount on 10k units', now).ok).toBe(false);
    expect(release(h, 'agent-a', 'ok', now).ok).toBe(false); // summary too short
    const good = release(h, 'agent-a', 'Agreed 5% discount at 10k units, quote issued; client will confirm email tomorrow.', now);
    expect(good.ok).toBe(true);
  });

  it('SLA: holding message exactly once, then re-alerts only', () => {
    const before = new Date('2026-07-15T10:04:00Z');
    const after = new Date('2026-07-15T10:06:00Z');
    expect(slaCheck(open(), before)).toEqual({ kind: 'none' });
    expect(slaCheck(open(), after)).toEqual({ kind: 'send_holding_and_realert' });
    expect(slaCheck(open({ holdingSentAt: after }), new Date('2026-07-15T10:30:00Z')))
      .toEqual({ kind: 'realert_only' });
    expect(slaCheck(open({ claimedBy: 'agent-a', claimedAt: after }), after)).toEqual({ kind: 'none' });
  });
});

/* ─────────────────────────── BUDGETS (P5) ─────────────────────────── */
describe('tenant budgets', () => {
  const budget = { dailyLlmCalls: 1000, dailyTokens: 1_000_000, softWarnPct: 80, onExceeded: 'throttle' as const };

  it('under budget → ok', () => {
    expect(checkBudget({ llmCalls: 100, tokens: 50_000 }, budget)).toEqual({ kind: 'ok' });
  });
  it('80%+ → soft warn (notify, keep serving)', () => {
    const v = checkBudget({ llmCalls: 850, tokens: 0 }, budget);
    expect(v.kind).toBe('soft_warn');
  });
  it('over → throttle with bounded backoff; the tenant degrades, not the platform', () => {
    const v = checkBudget({ llmCalls: 1200, tokens: 0 }, budget);
    expect(v.kind).toBe('throttle');
    if (v.kind === 'throttle') expect(v.retryAfterSeconds).toBeLessThanOrEqual(900);
  });
  it('pause mode → deterministic fallback, never silence', () => {
    const v = checkBudget({ llmCalls: 1200, tokens: 0 }, { ...budget, onExceeded: 'pause' });
    expect(v.kind).toBe('pause');
  });
  it('token overshoot triggers independently of call count', () => {
    const v = checkBudget({ llmCalls: 10, tokens: 2_000_000 }, budget);
    expect(v.kind).toBe('throttle');
  });
});
