import { gateOutreach, type OutreachInput, type OutreachRefusal } from './gate.js';

/**
 * C4.b — when the next e-mail in a sequence may go, and when the sequence ends.
 *
 * A sequence is the one thing in this product that keeps writing to a stranger
 * after she has stopped looking. Everything about whether it should is decided
 * HERE, in one pure function, and the scheduler only carries the answer out.
 * "Kill conditions in code rather than judgement" is the roadmap's phrase; this
 * is the code.
 *
 * ── IT DOES NOT DECIDE WHETHER A MESSAGE MAY LEAVE ────────────────────────
 *
 * That is `gateOutbound`, at send time, and nothing here replaces it. The step
 * this function releases is queued as an ordinary outbound row and meets the
 * gate like every other. What this adds is the question the gate cannot ask,
 * because it sees one message at a time: given what has happened since she
 * started writing to him, should there be a NEXT one at all?
 *
 * Pure per ADR-0002: no clock but the `now` it is handed.
 */

/**
 * Every way an enrolment ends other than finishing. The migration's CHECK holds
 * exactly this list (0047), and an integration test compares the two.
 */
export const SEQUENCE_STOPS = [
  'replied',             // he wrote back — a person answers now, not a schedule
  'unsubscribed',        // } a suppression, by its own reason: she is told which
  'bounced',             // }
  'complained',          // }
  'handed_off',          // somebody took the conversation over
  'previous_not_sent',   // a follow-up to a mail that never arrived reads as nonsense
  'no_consent',          // the consent it started with is gone
  'outreach_not_enabled',// she turned writing first off
  'cap',                 // held back by her daily cap for too long
  'domain',              // held back by an unverified domain for too long
  'unreachable',         // nothing here can send to that address (another factory holds it)
  'stopped_by_owner',    // she stopped it
  'sequence_archived',   // she archived the sequence it was on
] as const;
export type SequenceStop = (typeof SEQUENCE_STOPS)[number];

/**
 * How long a step may be HELD BACK — by her cap, or by a domain check that has
 * lapsed — before the sequence stops instead of waiting.
 *
 * A follow-up that means "a few days after my first mail" means nothing three
 * weeks later. Waiting a day for tomorrow's quota is right; waiting forever is a
 * sequence nobody is watching that will one day fire into a conversation that
 * has moved on.
 */
export const MAX_HOLD_DAYS = 7;

/** What became of the step before this one. */
export type PreviousStep =
  | 'none'       // this is the first step
  | 'sent'       // the provider accepted it
  | 'pending'    // queued or sending — not yet known
  | 'not_sent';  // refused, canceled or failed

export type StepInput = {
  readonly now: Date;
  /** Positions that exist, ascending, with their delays. */
  readonly steps: readonly { readonly position: number; readonly delayDays: number }[];
  readonly nextPosition: number;
  readonly nextDueAt: Date;
  /** When the step now due first became due — see `MAX_HOLD_DAYS`. */
  readonly stepDueSince: Date;
  readonly sequenceArchived: boolean;
  /** Any message from him, on any of his threads, since he was enrolled. */
  readonly repliedSinceEnrolment: boolean;
  /** A person holds his conversation. */
  readonly handedOff: boolean;
  readonly previous: PreviousStep;
  /**
   * Everything the outreach gate needs about him, with `ceilingReached`
   * counting the day's QUEUED outreach as well as the sent — see
   * `outreachFacts`' `counting`. The gate is asked in here rather than its
   * answer handed in, so his suppression and the gate's verdict cannot come
   * from two different reads and disagree.
   */
  readonly outreach: OutreachInput;
};

export type StepDecision =
  | { readonly kind: 'send'; readonly position: number }
  | { readonly kind: 'wait'; readonly until: Date; readonly why: 'not_due' | 'previous_pending' | 'cap' | 'domain' }
  | { readonly kind: 'stop'; readonly reason: SequenceStop }
  | { readonly kind: 'complete' };

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** China has one zone and no daylight saving, so the day boundary is arithmetic. */
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;

/** The start of the next day in Shanghai — when her cap resets. */
export function nextShanghaiDay(now: Date): Date {
  const local = now.getTime() + SHANGHAI_OFFSET_MS;
  const nextMidnight = (Math.floor(local / DAY_MS) + 1) * DAY_MS - SHANGHAI_OFFSET_MS;
  return new Date(nextMidnight);
}

/** When a step is due, counted from the moment the one before it was queued. */
export function dueAfter(from: Date, delayDays: number): Date {
  return new Date(from.getTime() + delayDays * DAY_MS);
}

/**
 * What each outreach refusal means for a sequence. A mapped type over the
 * gate's own vocabulary, so a sixth refusal added there fails to compile here
 * until someone decides whether it stops a sequence or holds it.
 */
const ON_REFUSAL: { readonly [R in OutreachRefusal]: SequenceStop | 'hold_cap' | 'hold_domain' } = {
  // E-mail is the only channel a sequence runs on and it has one requirement,
  // so this can only be the domain check.
  channel_cannot_initiate: 'hold_domain',
  outreach_not_enabled: 'outreach_not_enabled',
  // Unreachable: `gateOutreach` answers `suppressed` exactly when a suppression
  // exists (`mayContact`), and `decideStep` has already stopped on that with its
  // real reason. The entry exists because the type demands every refusal.
  suppressed: 'unsubscribed',
  no_consent: 'no_consent',
  outreach_ceiling: 'hold_cap',
};


/**
 * ── THE ORDER IS THE POLICY ───────────────────────────────────────────────
 *
 * 1. What ENDS it, most final first. Her archiving the sequence, then what HE
 *    did — a reply outranks everything, because a person answering is exactly
 *    what a sequence exists to produce and the worst thing it can do is keep
 *    going after he did. Then a suppression, by its own reason. Then a person
 *    holding the thread.
 * 2. What happened to the LAST step. Not arrived → stop, at once. Not known
 *    yet → wait an hour and look again, but only once the next step is due, so
 *    that the hour can delay a follow-up and never bring one forward.
 * 3. Whether HE may still be written to — the outreach gate. The refusals that
 *    are true forever (no consent, her switch off) stop it; the two that are
 *    true today and false tomorrow (her cap, a lapsed domain check) hold it,
 *    until `MAX_HOLD_DAYS` turns holding into stopping.
 * 4. Whether there is anything left, and whether it is due.
 *
 * FAIL CLOSED where it cannot be exhaustive: holding is reserved for the two
 * refusals named as temporary, and every other refusal stops. `ON_REFUSAL` makes
 * the compiler ask the question again the day the gate learns a new one.
 */
export function decideStep(input: StepInput): StepDecision {
  if (input.sequenceArchived) return { kind: 'stop', reason: 'sequence_archived' };
  if (input.repliedSinceEnrolment) return { kind: 'stop', reason: 'replied' };
  if (input.outreach.suppression) return { kind: 'stop', reason: input.outreach.suppression.reason };
  if (input.handedOff) return { kind: 'stop', reason: 'handed_off' };

  if (input.previous === 'not_sent') return { kind: 'stop', reason: 'previous_not_sent' };

  const step = input.steps.find((s) => s.position === input.nextPosition);
  // Nothing left — but only once the last one is known to have gone, so a
  // sequence never reads "finished" while its final mail could still be refused.
  if (!step) {
    return input.previous === 'pending'
      ? { kind: 'wait', until: new Date(input.now.getTime() + HOUR_MS), why: 'previous_pending' }
      : { kind: 'complete' };
  }
  if (input.now.getTime() < input.nextDueAt.getTime()) {
    return { kind: 'wait', until: input.nextDueAt, why: 'not_due' };
  }
  // Due, and the one before has not been accepted yet. Checked AFTER the due
  // date, so the hour it waits can only ever delay a step, never bring one
  // forward: the scheduler writes this `until` over `next_due_at`.
  if (input.previous === 'pending') {
    return { kind: 'wait', until: new Date(input.now.getTime() + HOUR_MS), why: 'previous_pending' };
  }

  const reach = gateOutreach(input.outreach);
  if (!reach.ok) {
    const meaning = ON_REFUSAL[reach.error];
    if (meaning !== 'hold_cap' && meaning !== 'hold_domain') return { kind: 'stop', reason: meaning };
    const held = meaning === 'hold_cap' ? 'cap' as const : 'domain' as const;
    const heldFor = input.now.getTime() - input.stepDueSince.getTime();
    if (heldFor >= MAX_HOLD_DAYS * DAY_MS) return { kind: 'stop', reason: held };
    return { kind: 'wait', until: nextShanghaiDay(input.now), why: held };
  }

  return { kind: 'send', position: step.position };
}
