import type { SuppressionReason } from './consent.js';

/**
 * M40.2 — what a sending provider tells us happened, and what it means.
 *
 * Every provider has its own vocabulary and its own JSON. This is the one place
 * that translates, so the rest of the product deals in the three reasons M38
 * already knows and never in a provider's words.
 *
 * ── A SOFT BOUNCE IS NOT A SUPPRESSION ────────────────────────────────────
 *
 * "Mailbox full" and "server temporarily unavailable" are ordinary and they
 * pass. Suppressing on one would permanently remove a real buyer because his
 * inbox was full on a Tuesday, and permanent is the whole point of the
 * suppression list — there is no undo to reach for when it turns out to be
 * wrong. Only a HARD bounce, an unsubscribe, or a complaint suppresses.
 *
 * ── AND ANYTHING WE DO NOT RECOGNISE DOES NOTHING ─────────────────────────
 *
 * A new event type from a provider update returns null and is ignored, rather
 * than being guessed into the nearest reason. The failure mode of guessing here
 * is a permanent suppression nobody asked for.
 */

export type ProviderEvent = {
  /** The provider's own type string, lower-cased by the caller. */
  readonly type: string;
  /** Hard vs soft, when the provider distinguishes. Absent means unknown. */
  readonly permanent?: boolean;
  readonly recipient: string;
  /** Whatever detail the provider gave. Never shown to a buyer. */
  readonly detail?: string | null;
};

/**
 * The event types that mean "never write to this address again".
 *
 * Listed rather than pattern-matched: `/bounce/` would catch
 * `bounce.transient` and suppress a mailbox that was full for an hour.
 */
const COMPLAINT = ['complaint', 'spamcomplaint', 'spam_complaint', 'complained'];
const UNSUBSCRIBE = ['unsubscribe', 'unsubscribed', 'list_unsubscribe'];
const BOUNCE = ['bounce', 'bounced', 'hardbounce', 'hard_bounce', 'permanent_fail'];

export function suppressionFor(event: ProviderEvent): SuppressionReason | null {
  const type = event.type.trim().toLowerCase().replace(/[\s-]/g, '_');
  if (COMPLAINT.includes(type)) return 'complained';
  if (UNSUBSCRIBE.includes(type)) return 'unsubscribed';
  if (!BOUNCE.includes(type)) return null;

  // A bounce the provider calls temporary, or does not classify at all, is not
  // grounds for a permanent decision. Unknown is treated as soft, which is the
  // fail-closed direction for an action that cannot be undone.
  if (type === 'hardbounce' || type === 'hard_bounce' || type === 'permanent_fail') return 'bounced';
  return event.permanent === true ? 'bounced' : null;
}
