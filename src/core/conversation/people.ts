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
 * ── NO ROLES. NO PERMISSIONS MATRIX. AND ONE PIECE OF ROUTING ─────────────
 *
 * There is one distinction — owner or not — and it exists because four things
 * genuinely belong to the person whose business it is. Anything finer (who may
 * quote which product, which buyers belong to whom) still needs watching a real
 * factory divide work, and inventing it now would be guessing at an
 * organisation chart nobody has drawn.
 *
 * G12 — routing, though, turned out to be one move rather than a system: the
 * boss opens a conversation she cannot answer and hands it to the colleague who
 * can (`handTo`, conversations/takeover.ts). It adds no role and no rule about
 * WHOSE conversations these are; it only lets a person put one in another
 * person's hands, and the receiving person sees it under "Mine". That is what a
 * factory floor does, and it is as far as this goes until someone asks for more.
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
  // Phase 2 — taking a copy of everything, and asking for everything to go.
  // The export is every buyer, every message and every price in one file: the
  // first thing a stolen staff session would reach for, and not something a
  // sales assistant needs to do their job. The deletion request is the one
  // action in the product that cannot be undone from inside it.
  'data_rights',
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
 * G9a — who is LOOKING at a page, for hiding the controls behind an
 * owner-only action. The routes are the gate; this only spares a sales
 * assistant a button that can only refuse her. Renderers default to the
 * owner's view, which is what every page was before staff existed.
 */
export type Viewer = Pick<Person, 'isOwner'> & {
  /** G9b — so an action of theirs reads as "you". Absent = the owner's view. */
  readonly id?: string;
};
export const OWNER_VIEW: Viewer = { isOwner: true };

/**
 * G9b — WHO DID IT, in words, for the person reading.
 *
 * Actor columns hold a person id since G9b; before, the 'owner' sentinel,
 * which could only ever have meant her. The reader's own action reads as
 * "you" — so the owner's sentinel is "you" to the owner and "the owner" to a
 * sales assistant. An id that no longer resolves is someone who has left,
 * never a raw uuid on her screen.
 */
export function actorName(
  actor: string | null, people: readonly Person[], viewer: Viewer, words: {
    readonly you: string; readonly owner: string; readonly gone: string;
  },
): string {
  if (actor === null || actor === '') return viewer.isOwner ? words.you : words.owner;
  if (viewer.id !== undefined && actor === viewer.id) return words.you;
  if (actor === 'owner') return viewer.isOwner ? words.you : words.owner;
  const p = people.find((x) => x.id === actor);
  if (!p) return words.gone;
  return p.isOwner && viewer.isOwner ? words.you : p.name;
}

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
