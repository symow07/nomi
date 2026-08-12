import { type Result, ok, err } from '../types/result.js';

/**
 * M37.5 — the words she may never say.
 *
 * `claims_policy` governs what may be CLAIMED. This governs what may be SAID.
 * Same shape, same default-deny instinct, a different axis — and the same
 * reason: a sentence that reaches a buyer cannot be taken back.
 *
 * ── THIS IS NOT `BANNED_OWNER_TERMS`, AND THE TWO WILL BE CONFLATED ────────
 *
 * `core/owner/vocabulary.ts` → BANNED_OWNER_TERMS governs what the PRODUCT
 * shows the OWNER: no "model", no "confidence", no "系统". It is about OUR
 * register when we speak to HER, it is one global list, and it is enforced by
 * tests over the i18n catalogue.
 *
 * THIS list governs what SHE says to a BUYER. It is per-tenant, free text in
 * whatever language the owner types, and enforced at reply time against a live
 * table. Two lists, two audiences, two enforcement points. They share no
 * contents and must never share an implementation: merging them would either
 * leak software vocabulary into buyer messages or let a tenant switch off the
 * product's own register.
 *
 * ── THE FLOOR ─────────────────────────────────────────────────────────────
 *
 * A short list she can EXTEND but never REMOVE: never curse, never insult a
 * buyer. Enforced, not advisory. A tenant that could switch off "do not abuse
 * the customer" is a tenant that will, by accident, on the day someone pastes a
 * competitor's phrasing into the catalogue and it comes back out of a reply.
 *
 * Pure per ADR-0002: matching only. Loading the tenant's own terms is the
 * caller's job.
 */

/**
 * The floor, in the three languages the product speaks plus the ones a Yiwu
 * buyer writes in. Deliberately SHORT: this is a floor, not a moderation
 * service. Anything subtler is the owner's judgement to add.
 *
 * Kept as data so the runtime check and any test read the same list.
 */
export const FORBIDDEN_FLOOR: readonly string[] = [
  // English
  'fuck', 'shit', 'bastard', 'idiot', 'stupid', 'moron', 'liar',
  // 中文
  '傻逼', '白痴', '蠢货', '滚', '骗子',
  // العربية
  'غبي', 'كذاب', 'أحمق',
];

export type ForbiddenTerm = {
  /** The term itself, as the owner typed it. */
  readonly term: string;
  /** Whether it came from the immutable floor or from her own list. */
  readonly source: 'floor' | 'owner';
};

export type ForbiddenViolation = {
  readonly kind: 'forbidden_word';
  /** Every term that matched, so the owner is told WHICH word stopped it. */
  readonly terms: readonly ForbiddenTerm[];
};

/**
 * The tenant's effective list: her terms, plus the floor she cannot remove.
 *
 * The floor is appended AFTER hers and de-duplicated, so an owner who types a
 * floor word into her own list changes nothing rather than shadowing it — there
 * is no ordering by which her row can win.
 */
export function effectiveForbidden(ownerTerms: readonly string[]): readonly ForbiddenTerm[] {
  const seen = new Set<string>();
  const out: ForbiddenTerm[] = [];
  for (const t of ownerTerms) {
    const norm = t.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ term: t.trim(), source: 'owner' });
  }
  for (const t of FORBIDDEN_FLOOR) {
    const norm = t.toLowerCase();
    if (seen.has(norm)) continue;   // she typed it too; it is still the floor's
    seen.add(norm);
    out.push({ term: t, source: 'floor' });
  }
  return out;
}

/**
 * Does this reply contain a forbidden term?
 *
 * MATCHING IS DELIBERATELY BLUNT, and the asymmetry is the reason: a false
 * positive costs one regeneration, a false negative is an insult delivered to a
 * customer in writing. So it is case-insensitive substring matching, which
 * catches "Fucking" from "fuck" and "傻逼的" from "傻逼".
 *
 * Word boundaries are NOT used. They would be correct for English and wrong for
 * Chinese, which does not delimit words with spaces — and the owner's list is
 * free text in whatever language she types. Substring matching is the only rule
 * that behaves the same in all three.
 */
export function findForbidden(
  reply: string, terms: readonly ForbiddenTerm[],
): readonly ForbiddenTerm[] {
  const haystack = reply.toLowerCase();
  return terms.filter((t) => t.term.length > 0 && haystack.includes(t.term.toLowerCase()));
}

/** The guard, shaped exactly like `guardClaims`: Result, never a side effect. */
export function guardForbidden(input: {
  reply: string;
  ownerTerms: readonly string[];
}): Result<string, ForbiddenViolation> {
  const hits = findForbidden(input.reply, effectiveForbidden(input.ownerTerms));
  if (hits.length === 0) return ok(input.reply);
  return err({ kind: 'forbidden_word', terms: hits });
}
