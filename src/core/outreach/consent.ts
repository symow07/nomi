import { type Result, ok, err } from '../types/result.js';
import { normalizePhone } from '../channel/phone.js';

/**
 * M38 — who may be contacted, and how we know.
 *
 * This is `claims_policy` on a new axis, and the shape is deliberately the
 * same. `claims_policy` says what may be CLAIMED and every claim carries
 * provenance; this says who may be CONTACTED and every contact carries
 * provenance. Same fail-closed posture, same rule that ABSENCE IS THE ONLY
 * HONEST REPRESENTATION of "not asked yet".
 *
 * ── NO ROW MEANS NO CONSENT ───────────────────────────────────────────────
 *
 * There is no default, no implied consent, no "they gave us their card at a
 * trade show so probably". A contact with no consent row may not be written
 * to, and the refusal names which of the two things is missing so the owner
 * can supply it if she legitimately can.
 *
 * ── AND SUPPRESSION BEATS CONSENT, ALWAYS ─────────────────────────────────
 *
 * An unsubscribe, a bounce or a complaint outranks every consent record that
 * exists or will ever exist. It is permanent and it is never overridden — not
 * by a later consent row, not by the owner, not by a fresh import of the same
 * address. That ordering is the whole reason a suppression list is worth
 * having: a list that can be argued with is a list that will be.
 *
 * Pure per ADR-0002. Loading the rows is the caller's job, and the GATE that
 * refuses the send is M42's.
 */

/**
 * The channels an identity can exist on.
 *
 * WhatsApp and email are what this product can reach today. Instagram and
 * Messenger are absent on purpose: their APIs cannot carry an uninvited
 * message at all (M39 states that per channel), so a consent record for one
 * would describe a permission nothing could exercise.
 */
export const CONTACT_CHANNELS = ['email', 'whatsapp'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/**
 * Where a contact record came from. Two values, because two things write one.
 *
 * `csv` and `apollo` are named in the roadmap and are NOT here: a source
 * nothing can write is a source nothing can display honestly, and M43a
 * established the rule — a value the code cannot produce must not be storable.
 * The importer and the constraint land together.
 */
export const CONTACT_SOURCES = ['inbound', 'manual'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/**
 * HOW consent was obtained. This is the provenance, and it is the point.
 *
 *   inbound_message   — they wrote to her first. The strongest evidence there
 *                       is, and the only one this product can observe rather
 *                       than be told.
 *   owner_attestation — she says so, and her name is on it. A real category:
 *                       a buyer who handed her a card at the Canton Fair did
 *                       consent, and no system saw it. Recorded as HER claim,
 *                       never as an observation.
 *
 * `replied_to_email` and `form_submission` are named in the roadmap and absent
 * for the same reason as the sources above: nothing can write them yet. The
 * first arrives with M40, where a reply to her email is what legitimately
 * opens WhatsApp for that buyer later.
 */
export const CONSENT_EVIDENCE = ['inbound_message', 'owner_attestation'] as const;
export type ConsentEvidence = (typeof CONSENT_EVIDENCE)[number];

/** Why an identity may never be written to again. */
export const SUPPRESSION_REASONS = ['unsubscribed', 'bounced', 'complained'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type Consent = {
  readonly evidence: ConsentEvidence;
  readonly obtainedAt: Date;
  /** Who recorded it. For an attestation this is the person standing behind it. */
  readonly recordedBy: string;
};

export type Suppression = {
  readonly reason: SuppressionReason;
  readonly at: Date;
};

export type ContactRefusal =
  | { readonly kind: 'no_consent' }
  | { readonly kind: 'suppressed'; readonly reason: SuppressionReason; readonly at: Date };

/**
 * May this identity be written to?
 *
 * The order is the safety property: suppression is checked FIRST, so no
 * consent record can ever outvote it. A caller that checked consent first and
 * suppression second would produce the same answer today and the wrong one on
 * the first day someone re-imports an unsubscribed address with a fresh
 * attestation attached.
 */
export function mayContact(input: {
  readonly consent: Consent | null;
  readonly suppression: Suppression | null;
}): Result<Consent, ContactRefusal> {
  if (input.suppression) {
    return err({
      kind: 'suppressed',
      reason: input.suppression.reason,
      at: input.suppression.at,
    });
  }
  if (!input.consent) return err({ kind: 'no_consent' });
  return ok(input.consent);
}

export type IdentityError = 'missing' | 'not_an_email' | 'not_a_phone';

/**
 * What she typed, canonicalised so the same person is one row.
 *
 * An address differing only in case, or a phone written with spaces, would
 * otherwise become a second identity — with its own consent state and its own
 * suppression state, which is how an unsubscribed buyer gets written to again.
 * Canonicalisation here IS the suppression guarantee.
 *
 * ── AND THE PHONE FORM IS NOT A CHOICE ────────────────────────────────────
 *
 * It delegates to `normalizePhone`, which is M18.2's and produces exactly a
 * wa_id: digits, no '+', no separators. That is not tidiness, it is the whole
 * thing working. `client_channels.channel_user_id` holds the wa_id, and the
 * derived consent below and the gate in M42 both compare against it. A second
 * normaliser here that produced '+971…' would compile, pass its own tests,
 * match nothing in production, and fail OPEN on the suppression check for
 * every buyer she ever spoke to.
 */
export function normalizeIdentity(
  channel: ContactChannel, raw: string | null | undefined,
): Result<string, IdentityError> {
  const value = (raw ?? '').trim();
  if (!value) return err('missing');

  if (channel === 'email') {
    const lower = value.toLowerCase();
    // Deliberately loose: one @, something either side, a dot in the domain, no
    // spaces. A stricter pattern rejects addresses that exist, and a bounce —
    // which becomes a suppression — is the real check.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower) ? ok(lower) : err('not_an_email');
  }

  const digits = normalizePhone(value);
  return digits === null ? err('not_a_phone') : ok(digits);
}
