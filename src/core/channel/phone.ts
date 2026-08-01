/**
 * M18.2 — phone normalization for the pilot allowlist.
 *
 * An owner types "+971 50 000 1234"; WhatsApp delivers "971500001234". If those
 * two do not compare equal, the allowlist would silently fail to match and the
 * gate would block a number the owner believes is allowed — or worse, a typo'd
 * entry would sit there looking correct. So both sides are normalized to the
 * SAME canonical shape: digits only, no '+', no separators — exactly a wa_id.
 *
 * Pure: no I/O, no clock. This is a comparison key, not a validation service —
 * it deliberately does not check that a country code exists or that the number
 * is reachable, because only Meta can answer that.
 */

/** E.164 allows at most 15 digits; fewer than 7 is not a dialable number. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/**
 * Canonicalize a phone number for comparison.
 * Returns null when the input cannot be a phone number — the caller must treat
 * null as "reject", never as "allow".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip the common written forms: +, spaces, dashes, dots, parens.
  s = s.replace(/[\s\-(). ‐-―]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  // 00 is the international access prefix in most of the world — 0097150…
  // and +97150… are the same number.
  else if (s.startsWith('00')) s = s.slice(2);

  // Anything left that is not a digit means this was never a phone number
  // (letters, another '+', a URL). Reject rather than silently dropping it.
  if (!/^[0-9]+$/.test(s)) return null;
  if (s.length < MIN_DIGITS || s.length > MAX_DIGITS) return null;
  return s;
}

/** True iff both normalize to the same canonical number. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && na === nb;
}

/**
 * Display form for the owner: the canonical digits with a leading '+'. Used
 * only for showing a number back; never for comparison.
 */
export function displayPhone(normalized: string): string {
  return `+${normalized}`;
}
