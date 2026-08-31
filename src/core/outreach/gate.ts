import { type Result, ok, err } from '../types/result.js';
import { mayContact, type Consent, type Suppression } from './consent.js';
import { mayInitiate, type OutreachChannel, type Requirement } from '../channel/registry.js';

/**
 * M42 — where reach meets the invariant.
 *
 * The product can now describe a message that no buyer asked for. This is the
 * one thing that decides whether it may leave the building, and it decides by
 * ASKING the two milestones that already know rather than by knowing anything
 * itself:
 *
 *   can this CHANNEL carry a first message   → M39 `mayInitiate`
 *   may this PERSON be written to            → M38 `mayContact`
 *
 * What is genuinely new here is only what neither of those could know: whether
 * the owner has decided to write first at all, and whether today's quota is
 * spent. Everything else is composition, and it is composition on purpose —
 * a gate that re-derived consent would be a second answer to the question M38
 * exists to answer once.
 *
 * Pure per ADR-0002.
 */

export const OUTREACH_REFUSALS = [
  'channel_cannot_initiate',   // M39 — the platform cannot, or is not ready
  'outreach_not_enabled',      // her decision, per channel, and she has not made it
  'suppressed',                // M38 — permanent
  'no_consent',                // M38 — absence is "no"
  'outreach_ceiling',          // today's quota, separate from the reply ceiling
] as const;
export type OutreachRefusal = (typeof OUTREACH_REFUSALS)[number];

export type OutreachInput = {
  readonly channel: OutreachChannel;
  /**
   * Whether THIS PRODUCT can send on the channel today, resolved by the caller
   * from the registry's `availableHere`.
   *
   * Separate from what the channel allows, and it has to be. `mayInitiate`
   * answers the platform's question and the connections page renders that
   * answer — "e-mail lets you write first" is true and worth her knowing. But a
   * message still cannot go, and without this the list told her the reason was
   * a decision she had not made, about a switch she cannot reach yet.
   */
  readonly availableHere: boolean;
  /** Her decision, per channel. Absent is NOT enabled — she has to say so. */
  readonly enabled: boolean;
  /** What the installation satisfies of the channel's requirements (M39). */
  readonly satisfied: ReadonlySet<Requirement>;
  readonly consent: Consent | null;
  readonly suppression: Suppression | null;
  /**
   * Today's outreach quota for this channel is spent.
   *
   * REQUIRED, not optional like a defaulted field would be — the `silenced`
   * precedent in `gateOutbound`, for the same reason. Nothing counts outreach
   * attempts yet because nothing makes one: the counter and `outreach_log`
   * arrive with the first sender (M40). A required field makes the compiler
   * name that sender when it is written, by someone who will not have read
   * this. An optional one would let it ship uncapped and silent.
   */
  readonly ceilingReached: boolean;
};

/**
 * May this message go to this person, on this channel, today?
 *
 * ── THE ORDER IS PHYSICS, THEN HER DECISION, THEN THIS PERSON ─────────────
 *
 * 1. Whether a message can leave at all — what the channel permits, and whether
 *    this product can send on it. First, because no decision she makes changes
 *    either, and because reporting anything else advises an action that cannot
 *    help: "turn on writing first" is useless counsel on Instagram, and equally
 *    useless for a channel whose switch does not exist yet.
 * 2. Whether she has turned writing-first on here. This mirrors `not_activated`
 *    in `gateOutbound`, and for the same reason: before she has decided to
 *    initiate at all, nothing about a particular buyer matters.
 * 3. Who this person is — suppression, then consent, in M38's own order and by
 *    M38's own function. Not re-implemented: `mayContact` already knows that
 *    suppression outranks every consent record that exists or ever will.
 * 4. The ceiling, last, because it is the only refusal here that is true today
 *    and false tomorrow.
 *
 * FAIL CLOSED throughout. Every field that could be forgotten defaults to the
 * refusing value at the call site — `enabled: false`, an empty `satisfied`, a
 * null consent — so a caller that omits one gets silence, never a send.
 */
export function gateOutreach(input: OutreachInput): Result<void, OutreachRefusal> {
  if (!input.availableHere || !mayInitiate(input.channel, input.satisfied).ok) {
    return err('channel_cannot_initiate');
  }
  if (!input.enabled) return err('outreach_not_enabled');

  const person = mayContact({ consent: input.consent, suppression: input.suppression });
  if (!person.ok) {
    return err(person.error.kind === 'suppressed' ? 'suppressed' : 'no_consent');
  }
  if (input.ceilingReached) return err('outreach_ceiling');
  return ok(undefined);
}
