/**
 * R3 (Phase 5; 0210; the owner, 2026-10-23) — A PARTY'S COMPANY REGISTRY NUMBER, country by country. The database
 * holds the same hard rules (migrations/0210_party_registry.sql); the sources are in docs/PHASE-5.md, R3.
 *
 *   · HARD (refused): the shape each issuing authority publishes.
 *       FR  SIREN, nine digits ("9 chiffres"); SIRET optional, fourteen digits, its first nine the SIREN.
 *       GB  Companies House number: eight digits, or two capitals and six digits — any two capitals (the official
 *           list of prefixes is incomplete); a number typed shorter than eight is zero-padded (1234567 → 01234567).
 *       ES  the NIF: nine characters, capitals and digits. Its finer shape waits on the owner (PHASE-5.md, R3): the
 *           entity form alone would refuse a sole trader's NIF.
 *       elsewhere: kept as typed — no rule because no source.
 *   · SOFT (a warning the owner may override, never a refusal): a check NO issuing authority publishes.
 *       FR  the Luhn sum over the SIREN's nine digits (INSEE states only "9 chiffres"; La Poste's numbers break it).
 *       ES  the control character of an entity's NIF (Orden EHA/451/2008, Decreto 2423/1975, RD 1065/2007 say only
 *           "un carácter de control", with no formula).
 *       GB  none: the number has no check digit, and none is invented.
 *   · ACROSS FIELDS (refused): a French VAT number present ends with the SIREN; a Spanish one is ES and the NIF.
 *     Nothing ties a UK VAT number to a company number. A missing VAT number is never wrong.
 *   · NOTHING IS DERIVED: no VAT key computed from a SIREN, no control character "fixed", no VAT number from a CRN.
 */
export type RegistryInput = {
  readonly country: string | null; readonly registry: string; readonly siret: string; readonly registro: string; readonly taxNumber: string;
};
export type Registry = { readonly registry: string | null; readonly siret: string | null; readonly registro: string | null };
export type RegistryError = 'registry_shape' | 'siret_shape' | 'siret_not_siren' | 'siret_not_fr' | 'registro_not_es' | 'registro_long'
  | 'vat_not_siren' | 'vat_not_nif' | 'registry_long';
export type RegistryWarning = 'siren_check' | 'nif_check';

/** As kept: spaces out, capitals (a registry number never holds a space or a small letter in these three countries). */
const squeeze = (s: string): string => s.replace(/\s+/g, '').toUpperCase();

/** The SIREN's Luhn sum — NOT published by INSEE: a typo warning only. */
export function sirenLooksRight(siren: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(siren[8 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * An entity NIF's control character, as the tax software everyone writes computes it — NOT published by AEAT: a typo
 * warning only. Null where the NIF is not of the entity form (a letter, seven digits, a control), as for a sole
 * trader's: nothing is said of what is not computed.
 */
export function nifLooksRight(nif: string): boolean | null {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(nif);
  if (!m) return null;
  const digits = m[2]!;
  let even = 0; let odd = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 1) even += d;
    else { const x = d * 2; odd += Math.floor(x / 10) + (x % 10); }
  }
  const c = (10 - ((even + odd) % 10)) % 10;
  const control = m[3]!;
  return control === String(c) || control === 'JABCDEFGHI'[c];
}

/** Every refusal and every warning at once. Empty clears a field. */
export function checkRegistry(input: RegistryInput):
  { readonly ok: true; readonly value: Registry; readonly warnings: readonly RegistryWarning[] } | { readonly ok: false; readonly errors: readonly RegistryError[] } {
  const country = input.country;
  const raw = input.registry.trim();
  let registry = country === 'FR' || country === 'ES' || country === 'GB' ? squeeze(raw) : raw;
  if (country === 'GB' && /^\d{1,7}$/.test(registry)) registry = registry.padStart(8, '0');
  const siret = squeeze(input.siret);
  const registro = input.registro.trim();
  const vat = squeeze(input.taxNumber).replace(/[^0-9A-Z]/g, '');
  const errors: RegistryError[] = [];
  const warnings: RegistryWarning[] = [];
  if (registry.length > 40) errors.push('registry_long');
  else if (registry !== '') {
    const shape = country === 'FR' ? /^\d{9}$/ : country === 'GB' ? /^(\d{8}|[A-Z]{2}\d{6})$/ : country === 'ES' ? /^[0-9A-Z]{9}$/ : null;
    if (shape && !shape.test(registry)) errors.push('registry_shape');
  }
  if (siret !== '') {
    if (country !== 'FR') errors.push('siret_not_fr');
    else if (!/^\d{14}$/.test(siret)) errors.push('siret_shape');
    else if (siret.slice(0, 9) !== registry) errors.push('siret_not_siren');
  }
  if (registro !== '' && country !== 'ES') errors.push('registro_not_es');
  if (registro.length > 200) errors.push('registro_long');
  if (errors.length === 0 && registry !== '' && vat !== '') {
    if (country === 'FR' && vat.slice(-9) !== registry) errors.push('vat_not_siren');
    if (country === 'ES' && vat !== `ES${registry}`) errors.push('vat_not_nif');
  }
  if (errors.length > 0) return { ok: false, errors };
  if (country === 'FR' && registry !== '' && !sirenLooksRight(registry)) warnings.push('siren_check');
  if (country === 'ES' && registry !== '' && nifLooksRight(registry) === false) warnings.push('nif_check');
  const nz = (s: string) => (s === '' ? null : s);
  return { ok: true, value: { registry: nz(registry), siret: nz(siret), registro: nz(registro) }, warnings };
}

/** What the registry number is called, by country: SIREN, NIF ("CIF" only as a hint), the company number. */
export const registryLabelKey = (country: string | null): 'books.party.registry.fr' | 'books.party.registry.es' | 'books.party.registry.gb' | 'books.party.registry.other' =>
  country === 'FR' ? 'books.party.registry.fr' : country === 'ES' ? 'books.party.registry.es' : country === 'GB' ? 'books.party.registry.gb' : 'books.party.registry.other';
