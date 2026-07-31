import { describe, it, expect } from 'vitest';
import {
  ownershipOf, canTransition, agentFor, aiMaySpeak, ownerMayReply,
  WAITING_HUMAN_AGENT, OWNER_AGENT, type ConversationOwnership,
} from '../../src/core/conversation/ownership.js';

/**
 * M16.1 — the ownership state machine (pure). This is the safety boundary; its
 * rejections matter as much as its acceptances.
 */

const ALL: ConversationOwnership[] = ['AI', 'WAITING_HUMAN', 'OWNER_CONTROLLED'];

describe('M16.1 · conversation ownership (pure)', () => {
  it('interprets assigned_to consistently', () => {
    expect(ownershipOf(null)).toBe('AI');
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');
    expect(ownershipOf('agent-7')).toBe('OWNER_CONTROLLED');   // any human id = controlled
  });

  it('round-trips ownership ↔ assigned_to', () => {
    expect(agentFor('AI')).toBeNull();
    expect(agentFor('WAITING_HUMAN')).toBe(WAITING_HUMAN_AGENT);
    expect(agentFor('OWNER_CONTROLLED')).toBe(OWNER_AGENT);
    for (const o of ALL) expect(ownershipOf(agentFor(o))).toBe(o);
  });

  it('the AI speaks only when it owns; the owner replies only when they hold control', () => {
    expect(aiMaySpeak('AI')).toBe(true);
    expect(aiMaySpeak('WAITING_HUMAN')).toBe(false);
    expect(aiMaySpeak('OWNER_CONTROLLED')).toBe(false);
    expect(ownerMayReply('OWNER_CONTROLLED')).toBe(true);
    expect(ownerMayReply('AI')).toBe(false);
    expect(ownerMayReply('WAITING_HUMAN')).toBe(false);
  });

  it('allows exactly the lifecycle transitions', () => {
    expect(canTransition('AI', 'WAITING_HUMAN')).toBe(true);          // auto handoff
    expect(canTransition('AI', 'OWNER_CONTROLLED')).toBe(true);       // manual takeover
    expect(canTransition('WAITING_HUMAN', 'OWNER_CONTROLLED')).toBe(true); // claim
    expect(canTransition('WAITING_HUMAN', 'AI')).toBe(true);          // wave AI back on
    expect(canTransition('OWNER_CONTROLLED', 'AI')).toBe(true);       // resume
  });

  it('rejects every invalid transition', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);     // no self-transition
    expect(canTransition('OWNER_CONTROLLED', 'WAITING_HUMAN')).toBe(false);
    expect(canTransition('AI', 'AI')).toBe(false);
    // count: exactly 5 of the 9 ordered pairs are legal
    const legal = ALL.flatMap((a) => ALL.map((b) => canTransition(a, b))).filter(Boolean).length;
    expect(legal).toBe(5);
  });
});
