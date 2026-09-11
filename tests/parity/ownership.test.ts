import { describe, it, expect } from 'vitest';
import {
  ownershipOf, canTransition, aiMaySpeak, ownerMayReply,
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

  it('the sentinels round-trip through ownershipOf', () => {
    // `agentFor` was deleted in M34.11 — an ownership→assigned_to mapping with
    // no caller. takeover.ts writes the sentinels directly, so the property
    // worth keeping is that THOSE values interpret back to what wrote them.
    expect(ownershipOf(null)).toBe('AI');
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');
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
    // G12 — one person hands it to another. It stays inside the same state:
    // a person holds it either way and the AI is silent either way; only the
    // name in the column changes.
    expect(canTransition('OWNER_CONTROLLED', 'OWNER_CONTROLLED')).toBe(true);
  });

  it('rejects every invalid transition', () => {
    // G12 — the ONE self-transition is person-to-person, and it is deliberate.
    // The others stay refused: a conversation cannot hand itself back to the
    // queue, and the AI cannot re-take one it already has.
    expect(canTransition('OWNER_CONTROLLED', 'WAITING_HUMAN')).toBe(false);
    expect(canTransition('AI', 'AI')).toBe(false);
    expect(canTransition('WAITING_HUMAN', 'WAITING_HUMAN')).toBe(false);
    // count: exactly 6 of the 9 ordered pairs are legal
    const legal = ALL.flatMap((a) => ALL.map((b) => canTransition(a, b))).filter(Boolean).length;
    expect(legal).toBe(6);
  });
});

/* ── M34.11 · one predicate, not four copies of it ───────────────────────── */

describe('M34.11 · every gate asks the ownership model whether she may speak', () => {
  /**
   * `aiMaySpeak` had no caller. decideTurn's Gate 0, the turn pipeline's cheap
   * gate and the send gate each wrote `assignedTo !== null` themselves — three
   * copies of the predicate plus the model, with only the copies running.
   *
   * They agreed, so nothing was broken. But agreement that nothing enforces is
   * a coincidence with a shelf life: the day the model gains a state where the
   * AI may speak despite being assigned — or a new sentinel — the copies stay
   * behind, and this is the invariant the README names.
   */
  const GATES: readonly (readonly [string, string, RegExp])[] = [
    ['decideTurn Gate 0', '../../src/core/conversation/decide.ts', /if \(!aiMaySpeak\(ownershipOf\(state\.assignedTo\)\)\)/],
    ['the turn pipeline', '../../src/pipeline/turn.ts', /!aiMaySpeak\(ownershipOf\(state\.assignedTo\)\)/],
    ['the send gate', '../../src/core/channel/sendGate.ts', /!aiMaySpeak\(ownershipOf\(g\.assignedTo\)\)/],
  ];

  it.each(GATES)('%s goes through the predicate', async (_name, file, re) => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL(file, import.meta.url), 'utf8');
    expect(src).toMatch(re);
  });

  it('the predicate and a raw null check agree on every value assigned_to can hold', () => {
    // Checked, not reasoned about. Includes the values nobody intends to write.
    for (const v of [null, WAITING_HUMAN_AGENT, OWNER_AGENT, 'agent-42', '', ' ', 'AI', 'null']) {
      expect(aiMaySpeak(ownershipOf(v)), JSON.stringify(v)).toBe(v === null);
    }
  });

  it('the AI and the owner are never both permitted to speak', () => {
    for (const o of ALL) expect(aiMaySpeak(o) && ownerMayReply(o)).toBe(false);
  });
});
