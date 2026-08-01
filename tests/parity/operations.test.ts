import { describe, it, expect } from 'vitest';
import { ATTENTION_PRIORITY, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { ownershipOf, WAITING_HUMAN_AGENT, OWNER_AGENT } from '../../src/core/conversation/ownership.js';

/**
 * M16.2a — the Operations snapshot is a neutral, honest shape. These pure tests
 * pin down that it invents nothing (no scores/percentages/confidence/rankings)
 * and that the ownership mapping the read model relies on is the M16.1 one.
 */

const sample = (): OperationsSnapshot => ({
  range: 'week',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' },
  hasAttention: true,
});

describe('M16.2a · operations snapshot (pure)', () => {
  it('is a neutral shape — exactly the expected sections, all plain integers', () => {
    const s = sample();
    expect(Object.keys(s).sort()).toEqual(['activity', 'attention', 'channel', 'hasAttention', 'knowledge', 'range']);
    for (const grp of [s.attention, s.activity, s.knowledge]) {
      for (const v of Object.values(grp)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('invents no metric — no score / percentage / confidence / ranking anywhere', () => {
    const blob = JSON.stringify(sample()).toLowerCase();
    for (const banned of ['score', 'percent', '%', 'confidence', 'rank', 'rating', 'weight']) {
      expect(blob.includes(banned), banned).toBe(false);
    }
  });

  it('attention priority is explicit and ordered — no urgency scoring', () => {
    // Human waiting first, then approvals, then knowledge gaps. Context buckets
    // (ownerHandling, activity) are NOT attention demands and are excluded.
    expect(ATTENTION_PRIORITY).toEqual(['handoffs', 'pendingApprovals', 'openGaps']);
    expect(ATTENTION_PRIORITY).not.toContain('ownerHandling');
    expect(ATTENTION_PRIORITY).not.toContain('activity');
  });

  it('ownership mapping is the M16.1 one (handoffs vs owner-handling)', () => {
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');   // → handoffs
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');        // → ownerHandling
    expect(ownershipOf(null)).toBe('AI');                            // → neither
    expect(ownershipOf('agent-9')).toBe('OWNER_CONTROLLED');         // any human id counts as handling
  });
});
