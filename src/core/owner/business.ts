/**
 * A2 — what KIND of business this is, in the words sign-up uses.
 *
 * Nomi was built for one factory and said "factory" everywhere. It is for any
 * business that talks to buyers on social channels, so sign-up asks which kind,
 * and the copy says "business". These lists are the single source for the form,
 * the validation and the database check (migration 0056 repeats the values; a
 * test holds the two together).
 */

export const BUSINESS_KINDS = ['manufacturer', 'trading', 'wholesale', 'brand', 'retail', 'agency', 'services', 'other'] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];

export const TEAM_SIZES = ['1', '2-5', '6-20', '21-100', '100+'] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

/** Where she talks to buyers TODAY. Asked for whoever sells Nomi; connecting is done elsewhere. */
export const CHANNELS_USED = ['whatsapp', 'instagram', 'messenger', 'email', 'wechat', 'tiktok', 'other'] as const;
export type ChannelUsed = (typeof CHANNELS_USED)[number];

export const isBusinessKind = (v: string): v is BusinessKind => (BUSINESS_KINDS as readonly string[]).includes(v);
export const isTeamSize = (v: string): v is TeamSize => (TEAM_SIZES as readonly string[]).includes(v);
export const isChannelUsed = (v: string): v is ChannelUsed => (CHANNELS_USED as readonly string[]).includes(v);

/**
 * Region codes the platform knows a name for that are NOT places a business is
 * registered: groupings, reserved codes, and countries that no longer exist.
 */
const NOT_COUNTRIES = new Set([
  'AC', 'AN', 'BU', 'CP', 'CQ', 'CS', 'DD', 'DG', 'EA', 'EU', 'EZ', 'FX', 'IC', 'NT',
  'QO', 'SU', 'TA', 'TP', 'UN', 'XA', 'XB', 'YD', 'YU', 'ZR', 'ZZ',
]);

/**
 * Codes the platform still answers to, each under the SAME name as a code that
 * is current. Left in, the dropdown listed six countries twice — "Benin"
 * above "Benin", "United Kingdom" above "United Kingdom" — with nothing to
 * tell them apart, so whichever one she picked was a coin toss, and the same
 * country was stored two ways.
 *
 * Dropped from the list, KEPT AS A READING. Five are the names of countries
 * that no longer exist and one is the everyday abbreviation people expect;
 * a workspace that already stored one of them must still open its own page
 * with its own country selected, so each maps to the code in force today:
 */
const SUPERSEDED: Readonly<Record<string, string>> = {
  DY: 'BJ', // Dahomey → Benin
  HV: 'BF', // Upper Volta → Burkina Faso
  NH: 'VU', // New Hebrides → Vanuatu
  RH: 'ZW', // Southern Rhodesia → Zimbabwe
  UK: 'GB', // the abbreviation everyone types; ISO's own code is GB
  VD: 'VN', // North Vietnam → Vietnam
};

/**
 * The code in force today for whatever is stored. A superseded code reads back
 * as its successor; anything else is returned untouched, including a code this
 * build does not know — deciding that is `isCountryCode`'s job, not this one's.
 */
export const canonicalCountry = (code: string): string => SUPERSEDED[code] ?? code;

let codes: readonly string[] | null = null;
/** Every ISO 3166-1 alpha-2 code the platform can name, one name per country. */
export function countryCodes(): readonly string[] {
  if (codes) return codes;
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (!NOT_COUNTRIES.has(code) && !(code in SUPERSEDED) && names.of(code) !== undefined) out.push(code);
  }
  codes = out;
  return out;
}

/**
 * Is this a country this product can store? A superseded code is — it is
 * already in the database — so a workspace that answered before this change
 * can still save its profile without being made to pick its country again.
 */
export const isCountryCode = (v: string): boolean => countryCodes().includes(canonicalCountry(v));

/** The list for a `<select>`, named and sorted in the reader's own language. */
export function countryOptions(locale: string): readonly { readonly code: string; readonly name: string }[] {
  const names = new Intl.DisplayNames([locale === 'zh' ? 'zh-Hans' : locale], { type: 'region' });
  const collator = new Intl.Collator(locale === 'zh' ? 'zh-Hans' : locale);
  return countryCodes().map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((x, y) => collator.compare(x.name, y.name));
}

/**
 * A web address as she might type it — "atlas.example", "www.atlas.example/shop",
 * "HTTP://…" — made into the one shape that is stored: https, no spaces. Empty
 * is allowed (the question is optional); anything that is not an address is not.
 */
export function normalizeWebsite(raw: string): { ok: true; value: string | null } | { ok: false } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t.replace(/^http:\/\//i, 'https://') : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || /\s/.test(t) || u.username || u.password) return { ok: false };
    const value = u.toString().replace(/\/$/, '');
    return value.length <= 200 ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}
