/**
 * M16.1 — Conversation ownership: the safety boundary for human takeover.
 *
 * `conversations.assigned_to` carries the truth; this module is the ONLY place
 * its string sentinels are interpreted, so the AI-silent gate (decideTurn), the
 * takeover services, and the inbox UI can never disagree. Pure: no I/O.
 *
 * There is exactly one ownership model. This file does not store anything new —
 * it names what `assigned_to` already means.
 *
 * M34.11 — THAT PARAGRAPH WAS AN ASPIRATION, NOT A FACT. `aiMaySpeak` had no
 * caller: decideTurn's Gate 0, the turn pipeline's cheap gate and the send
 * gate each wrote `assignedTo !== null` themselves. Three copies of the
 * predicate and a fourth here, with only the copies running — the same shape as
 * the pause rule and cancelableOnTakeover, in the place the README names as an
 * invariant.
 *
 * The four were checked against each other across every value assigned_to can
 * hold, including '' and unknown agent ids. THEY AGREED — this was a latent
 * duplication, not a live defect — and all three gates now call the predicate,
 * so the paragraph above is true rather than hopeful.
 */

/** Written to assigned_to when the AI has handed off and a human is needed. */
export const WAITING_HUMAN_AGENT = 'unclaimed';
/** Written to assigned_to when the owner has taken control. */
export const OWNER_AGENT = 'owner';

export type ConversationOwnership = 'AI' | 'WAITING_HUMAN' | 'OWNER_CONTROLLED';

/** Interpret raw assigned_to. null = AI; the waiting sentinel = WAITING_HUMAN;
 *  ANY other non-null agent (owner sentinel or a future human id) = OWNER_CONTROLLED. */
export function ownershipOf(assignedTo: string | null): ConversationOwnership {
  if (assignedTo === null) return 'AI';
  if (assignedTo === WAITING_HUMAN_AGENT) return 'WAITING_HUMAN';
  return 'OWNER_CONTROLLED';
}

/*
 * `agentFor` (ownership → assigned_to) was deleted in M34.11. It had no caller:
 * takeover.ts writes OWNER_AGENT and null directly, which already goes through
 * this module's sentinels and reads more plainly at the two sites that do it
 * than an enum round-trip would. A second mapping nobody used is a second thing
 * that can drift from the first.
 */

/** The AI may speak only when it owns the conversation. */
export const aiMaySpeak = (o: ConversationOwnership): boolean => o === 'AI';

/** The owner may reply directly only while they hold control. */
export const ownerMayReply = (o: ConversationOwnership): boolean => o === 'OWNER_CONTROLLED';

/**
 * The allowed ownership transitions — the state machine. Everything not listed
 * is REJECTED; that rejection is the safety property, not a convenience.
 *
 *   AI            → WAITING_HUMAN     (automatic problem handoff — existing gate)
 *   AI            → OWNER_CONTROLLED  (owner takes over a healthy conversation)
 *   WAITING_HUMAN → OWNER_CONTROLLED  (owner claims a handoff)
 *   WAITING_HUMAN → AI                (owner waves the AI back on)
 *   OWNER_CONTROLLED → AI             (resume)
 */
const ALLOWED: ReadonlySet<string> = new Set([
  'AI>WAITING_HUMAN',
  'AI>OWNER_CONTROLLED',
  'WAITING_HUMAN>OWNER_CONTROLLED',
  'WAITING_HUMAN>AI',
  'OWNER_CONTROLLED>AI',
]);

export function canTransition(from: ConversationOwnership, to: ConversationOwnership): boolean {
  return ALLOWED.has(`${from}>${to}`);
}
