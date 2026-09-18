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

let codes: readonly string[] | null = null;
/** Every ISO 3166-1 alpha-2 code the platform can name. Computed once. */
export function countryCodes(): readonly string[] {
  if (codes) return codes;
  const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  const out: string[] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (!NOT_COUNTRIES.has(code) && names.of(code) !== undefined) out.push(code);
  }
  codes = out;
  return out;
}

export const isCountryCode = (v: string): boolean => countryCodes().includes(v);

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
