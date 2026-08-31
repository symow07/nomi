/**
 * M47 — more than one human.
 *
 * The access code was a single owner. A real Yiwu factory is a boss and two or
 * three sales staff, and the first thing that breaks when the pilot succeeds is
 * that `assigned_to` can say "a human holds this" but not WHICH human. Nobody
 * can see who is on what, and a takeover cannot be routed to anyone.
 *
 * ── THIS EXTENDS THE OWNERSHIP MODEL. IT DOES NOT REPLACE IT ──────────────
 *
 * `conversations.assigned_to` already carried the answer. Read its own words,
 * written before any of this existed:
 *
 *   "ANY other non-null agent (owner sentinel or a future human id) =
 *    OWNER_CONTROLLED"
 *
 * That future human id is what this milestone writes. `ownershipOf` is
 * UNCHANGED, `aiMaySpeak` is unchanged, and `canTransition` is unchanged —
 * there is still exactly one predicate deciding whether she may speak, unified
 * across three gates in M34.11, and this milestone does not add a second one.
 * What changes is only that the value in the column is now a person.
 *
 * ── NO ROLES. NO PERMISSIONS MATRIX. NO ROUTING ───────────────────────────
 *
 * There is one distinction — owner or not — and it exists because four things
 * genuinely belong to the person whose business it is. Anything finer (who may
 * quote which product, whose conversations route where) needs watching a real
 * factory divide work, and inventing it now would be guessing at an
 * organisation chart nobody has drawn.
 *
 * Pure per ADR-0002.
 */

/** Someone who can log in. The owner is one of these, with `isOwner` true. */
export type Person = {
  readonly id: string;
  readonly name: string;
  readonly isOwner: boolean;
};

/**
 * THE FOUR THINGS ONLY THE OWNER MAY DO, named here rather than left to a
 * comment in a commit message.
 *
 *   grant or revoke a capability — deciding what Nomi may do unsupervised is
 *     the whole trust ladder, and it is the owner's judgement about her own
 *     business risk.
 *   activate or deactivate messaging — the one step that cannot be undone: a
 *     buyer who has been written to has been written to.
 *   change the price rules — the floor, the discount authority, the ask-above
 *     threshold. Staff negotiate inside them; they do not move them.
 *   add or remove a person — including handing someone a way in.
 *
 * A sales assistant can do everything else: reply, take over, hand back, record
 * an order, capture a sample address, teach a fact. That is the job.
 *
 * This is a LIST, not a matrix. Adding a row is a product decision each time,
 * and if this ever needs a second axis it will need a real organisation chart
 * behind it rather than a guess.
 */
export const OWNER_ONLY = [
  'capability_grant',
  'messaging_activation',
  'price_rules',
  'people',
  // M42 — letting her write to someone who never wrote first. On WhatsApp it
  // risks the number permanently, which is the same class of decision as
  // turning messaging on at all.
  'outreach',
] as const;
export type OwnerOnlyAction = (typeof OWNER_ONLY)[number];

/**
 * May this person do an owner-only thing?
 *
 * One predicate, one distinction. Every owner-only route calls this; a route
 * that forgets is caught by a test that walks them.
 */
export const mayDo = (person: Person, _action: OwnerOnlyAction): boolean => person.isOwner;

/**
 * Who is holding this conversation, in words a person reads.
 *
 * `assigned_to` values written before this milestone are still interpreted:
 * 'owner' means the owner, because that is what it meant when it was written.
 * An id that no longer resolves to anyone — a person she removed — reads as
 * "someone who has left" rather than as a raw uuid, and never as "nobody",
 * which would be a different fact.
 */
export function heldByName(
  assignedTo: string | null, people: readonly Person[], words: {
    readonly ai: string; readonly waiting: string; readonly owner: string; readonly gone: string;
  },
): string {
  if (assignedTo === null) return words.ai;
  if (assignedTo === 'unclaimed') return words.waiting;
  if (assignedTo === 'owner') return words.owner;
  return people.find((p) => p.id === assignedTo)?.name ?? words.gone;
}

export type PersonError = 'name_missing' | 'name_too_long';

/**
 * What she typed when adding someone.
 *
 * Only a name. No email, no phone, no role — a person is someone who can log
 * in and hold a conversation, and every extra field here would be a field
 * nothing reads.
 */
export function validatePerson(name: string | null | undefined):
{ ok: true; value: string } | { ok: false; error: PersonError } {
  const clean = (name ?? '').trim();
  if (!clean) return { ok: false, error: 'name_missing' };
  if (clean.length > 60) return { ok: false, error: 'name_too_long' };
  return { ok: true, value: clean };
}
