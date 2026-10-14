import { describe, it, expect } from 'vitest';
import { evaluateTrust } from '../../src/trust/practiceChecks.js';
import { runCheck, requestedModeOf, type TurnOutcome } from '../../src/trust/invariants.js';
import { analysis } from '../../src/trust/scenarios.js';
import { computeTurn, commitTurn, type TurnEffects, type TurnResult } from '../../src/pipeline/turn.js';
import { FakeTenant, FakeAnalyzer, FakeReplyWriter, FakeRetriever } from '../pipeline/fakes.js';
import { emptyState, CONVERSATION } from './fixtures.js';
import { CAPABILITIES, type AutonomyGrant } from '../../src/core/conversation/autonomy.js';

/**
 * PHASE 4 GATE, BLOCKER 2 (the owner, 2026-10-14) — "the guard behaves differently by language, and nobody knows
 * which way". The Arabic practice turn of 2026-10-13 read ✗ "Never sent without permission" where the English one
 * passed every check. What it was: the model classed the Arabic question as `qualify` (a capability the workspace
 * lets send alone) and the English one as `recommend` (drafts); the send decision then HELD the Arabic reply for
 * the owner for one of its recorded reasons — and the check, deriving "what the policy says" from the policy alone,
 * called a reply held back an escalation. Nothing was sent, in either language: the guard held MORE, not less.
 *
 * The fix: the check compares against the policy narrowed by the turn's recorded holds (`requestedModeOf`), in
 * Practice and in the golden set's harness alike. It still fails both real failures: a reply sent alone that the
 * policy keeps for the owner, and a reply held back with no recorded reason.
 */

const NOW = new Date('2026-07-14T12:00:00Z');
const ALL_AUTO: AutonomyGrant[] = CAPABILITIES.map((capability) => ({ capability, mode: 'auto', timeWindow: null }));

async function turn(setup: (t: FakeTenant) => void) {
  const tenant = new FakeTenant();
  tenant.grantRows = ALL_AUTO;
  setup(tenant);
  tenant.seed(CONVERSATION, emptyState({}));
  const analyzer = new FakeAnalyzer();
  analyzer.next = analysis();
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['What quantity are you after?'];
  const ports = { tenant, retriever: new FakeRetriever(), analyzer, replyWriter, now: () => NOW };
  const req = { conversationId: CONVERSATION, messageId: 'm-1', text: 'hello, interested in your bags' };
  const result = await computeTurn(ports, req);
  const effects = await commitTurn(ports, req, result, Date.now());
  return { result, effects, trust: evaluateTrust({
    expectations: [{ invariant: 'noSilentCapabilityEscalation' }], result, effects, grants: ALL_AUTO, now: NOW, floorPrice: null, zone: 'UTC',
  }) };
}

describe('Phase 4 · blocker 2 · a reply held for the owner is never reported as sent without permission', () => {
  it('the policy says alone, the workspace has not earned it: held, recorded, and the check passes — naming why', async () => {
    const { effects, trust } = await turn((t) => { t.earnedRungValue = 0; });
    expect(effects.outbound).toBeNull();
    expect(effects.draftCreated).not.toBeNull();
    expect(effects.heldBack).toBe('not_earned');
    expect(trust.appliedMode).toBe('draft');
    expect(trust.checks[0]!.pass).toBe(true);
    expect(trust.checks[0]!.detail).toContain('held back: not_earned');
  });

  it('the same for an assistant whose name is not confirmed', async () => {
    const { effects, trust } = await turn((t) => { t.assistantNamedFlag = false; });
    expect(effects.outbound).toBeNull();
    expect(effects.heldBack).toBe('assistant_not_named');
    expect(trust.checks[0]!.pass).toBe(true);
  });

  it('and nothing held back means nothing recorded: the reply went alone, as the policy says', async () => {
    const { effects, trust } = await turn(() => {});
    expect(effects.outbound).not.toBeNull();
    expect(effects.heldBack).toBeNull();
    expect(trust.appliedMode).toBe('auto');
    expect(trust.checks[0]!.pass).toBe(true);
  });
});

describe('Phase 4 · blocker 2 · the check keeps its teeth both ways', () => {
  const outcome = (requestedMode: 'auto' | 'draft', appliedMode: 'auto' | 'draft', heldBack: string | null): TurnOutcome => ({
    result: { hold: null } as unknown as TurnResult,
    effects: { heldBack } as unknown as TurnEffects,
    floorOf: () => null, capability: 'qualify', requestedMode, appliedMode,
  });

  it('ESCALATION: sent alone while the policy keeps it for the owner — fails', () => {
    expect(runCheck({ invariant: 'noSilentCapabilityEscalation' }, outcome('draft', 'auto', null)).pass).toBe(false);
  });

  it('SILENT DOWNGRADE: held with no recorded reason — fails', () => {
    const mode = requestedModeOf({ hold: null }, { heldBack: null }, () => 'auto');
    expect(mode).toBe('auto');
    expect(runCheck({ invariant: 'noSilentCapabilityEscalation' }, outcome(mode, 'draft', null)).pass).toBe(false);
  });

  it('a hold with a recorded reason, or one of her hold rules, is what the policy resolves to', () => {
    expect(requestedModeOf({ hold: null }, { heldBack: 'language_new' }, () => 'auto')).toBe('draft');
    expect(requestedModeOf({ hold: 'quantity_heard_not_typed' }, { heldBack: null }, () => 'auto')).toBe('draft');
    expect(requestedModeOf({ hold: null }, {}, () => 'draft')).toBe('draft');
  });
});
