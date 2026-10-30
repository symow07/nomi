import { checkRegistry } from './registry.js';
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
 *
 * And ONLY A PARTY IN MOROCCO HAS AN ICE (0208; the owner, 2026-10-23). The ICE is Morocco's register; a Spanish or
 * French company's registry number of fifteen characters is not one, and stored as one it would be wrong data a FEC
 * then carries. A connected system's registry field is read as an ICE only for a party whose country is MA; anyone
 * else's is left in that system, not copied (the books have no field for another country's registry number).
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
/** The country whose register the ICE is. */
export const ICE_COUNTRY = 'MA';
/**
 * Audit B17 — books kept to Morocco's rules: a business in Morocco, or one that already gave its ICE, IF or RC (the
 * Settings page asks for them only then). Only these see the FEC of CNC Avis n° 24 and the CGNC chart; books with no
 * country on record, or another country, are offered neither, and their addresses answer as an unknown one.
 */
export const keepsMoroccanBooks = (b: { readonly country: string | null; readonly ice?: string | null; readonly taxId?: string | null; readonly rc?: string | null }): boolean =>
  b.country === ICE_COUNTRY || Boolean(b.ice || b.taxId || b.rc);
/** A connected system's registry field, kept as the party's ICE only for a party in Morocco, and only when it is one. */
export const partyIce = (country: string | null, raw: string | null): string | null => {
  const ice = country !== ICE_COUNTRY || raw === null ? '' : iceAsTyped(raw);
  return isIce(ice) ? ice : null;
};
/**
 * 0216 — a connected system's ONE registry field, split (Odoo's `company_registry`, Xero's `CompanyNumber`): the ICE for
 * a party in Morocco when it is one; otherwise the company registry number, by R3's rules for the party's country
 * (`checkRegistry`: FR nine digits, GB eight or two letters and six, ES nine capitals or digits, elsewhere as typed).
 * A number those rules refuse is not kept, and `bad` says so (a problem on the row, never a guess).
 */
export function registryFieldOf(country: string | null, raw: string | null, taxNumber: string | null):
  { readonly ice: string | null; readonly registry: string | null; readonly bad: boolean } {
  if (raw === null || raw.trim() === '') return { ice: null, registry: null, bad: false };
  const ice = partyIce(country, raw);
  if (ice !== null) return { ice, registry: null, bad: false };
  const r = checkRegistry({ country, registry: raw, siret: '', registro: '', taxNumber: taxNumber ?? '' });
  return r.ok ? { ice: null, registry: r.value.registry, bad: false } : { ice: null, registry: null, bad: true };
}
/** The one field written back: the ICE where there is one, else the registry number. */
export const registryFieldFor = (p: { readonly ice: string | null; readonly registry?: string | null }): string | null => p.ice ?? p.registry ?? null;

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
