/**
 * E2 (Phase 5; 0206) — THE BUSINESS'S OWN IDENTIFIERS, as its books and its FEC carry them: the ICE, the IF and the
 * RC with its court. A rule is checked only where an official source publishes one (docs/PHASE-5.md, E2):
 *
 *   · ICE — fifteen positions (OMPIC: « composé de 15 positions »; the ICE portal's guide). Spaces as typed are
 *     taken out. Neither "digits only" nor the check key is checked: no official text states either.
 *   · IF — no official format found: kept as typed, trimmed.
 *   · RC — the number and its court together (Code de commerce, art. 49 and 154), both or neither; no official format
 *     of the number found.
 *
 * The lengths are the database's storage bounds (0206), not formats.
 *
 * The ICE's rule is ONE rule, for the business and for every party in its books (0208): `iceAsTyped` and `isIce` are
 * what the profile, the parties form, the workbook and every connector check, and the database holds the same.
 */
export type IdentifiersInput = { readonly ice: string; readonly taxId: string; readonly rc: string; readonly rcCourt: string };
export type Identifiers = { readonly ice: string | null; readonly taxId: string | null; readonly rc: string | null; readonly rcCourt: string | null };
export type IdentifierField = 'ice' | 'taxId' | 'rc' | 'rcCourt';
export type IdentifierError = 'iceLength' | 'tooLong' | 'rcNeedsCourt' | 'courtNeedsRc';

export const ICE_POSITIONS = 15;

/** An ICE as it is kept: the spaces it was typed with taken out. */
export const iceAsTyped = (raw: string): string => raw.replace(/\s+/g, '');
/** Fifteen positions, none a space (OMPIC) — nothing more is checked. */
export const isIce = (ice: string): boolean => [...ice].length === ICE_POSITIONS && !/\s/.test(ice);
/** A connected system's registry field, kept as the party's ICE only when it is one. */
export const iceOrNull = (raw: string | null): string | null => {
  const ice = raw === null ? '' : iceAsTyped(raw);
  return isIce(ice) ? ice : null;
};
const BOUND: Record<IdentifierField, number> = { ice: ICE_POSITIONS, taxId: 40, rc: 40, rcCourt: 80 };

/** Every bad field at once. Empty clears a field. */
export function validateIdentifiers(input: IdentifiersInput):
  { readonly ok: true; readonly value: Identifiers } | { readonly ok: false; readonly errors: Partial<Record<IdentifierField, IdentifierError>> } {
  const errors: Partial<Record<IdentifierField, IdentifierError>> = {};
  const ice = iceAsTyped(input.ice);
  const [taxId, rc, rcCourt] = [input.taxId.trim(), input.rc.trim(), input.rcCourt.trim()];
  if (ice !== '' && !isIce(ice)) errors.ice = 'iceLength';
  if (taxId.length > BOUND.taxId) errors.taxId = 'tooLong';
  if (rc.length > BOUND.rc) errors.rc = 'tooLong';
  if (rcCourt.length > BOUND.rcCourt) errors.rcCourt = 'tooLong';
  if (rc !== '' && rcCourt === '' && !errors.rcCourt) errors.rcCourt = 'rcNeedsCourt';
  if (rc === '' && rcCourt !== '' && !errors.rc) errors.rc = 'courtNeedsRc';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const nz = (s: string) => (s === '' ? null : s);
  return { ok: true, value: { ice: nz(ice), taxId: nz(taxId), rc: nz(rc), rcCourt: nz(rcCourt) } };
}
