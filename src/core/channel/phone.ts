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

/**
 * M34.10 — the MASKED display form, and the reason this function exists.
 *
 * `api/web/channels.ts` promised "masked phone only — never a secret" and then
 * rendered `channels.display_phone` verbatim, so the promise held only if
 * whatever wrote the column had already masked it. Nothing in production writes
 * that column yet, which means the promise was true by luck and would have
 * stopped being true the moment a connect flow stored a full number.
 *
 * Masking at RENDER makes it true regardless of what is stored: the country
 * prefix and the last four digits are enough for an owner to recognise her own
 * number, and the middle is never shown.
 *
 *   '971500001234' → '+9715****1234'
 *
 * A number too short to mask is not rendered at all. Returning it unmasked
 * "because it is short" would be the fail-open branch.
 */
export function maskPhone(raw: string | null | undefined): string | null {
  const n = normalizePhone(raw);
  if (n === null) return null;
  const KEEP_TAIL = 4;
  const KEEP_HEAD = 4;
  if (n.length < KEEP_HEAD + KEEP_TAIL + 1) return null;
  return `+${n.slice(0, KEEP_HEAD)}****${n.slice(-KEEP_TAIL)}`;
}

/**
 * Display form for the owner: the canonical digits with a leading '+'. Used
 * only for showing a number back; never for comparison.
 *
 * `samePhone` used to live here too — a two-line wrapper over `normalizePhone`
 * that nothing called. The allowlist compares normalized values directly, which
 * is the same thing with one fewer name to keep true.
 */
export function displayPhone(normalized: string): string {
  return `+${normalized}`;
}
