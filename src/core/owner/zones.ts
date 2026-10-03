import { canonicalCountry } from './business.js';
import type { Locale } from './i18n/locale.js';

/**
 * TZ (the owner's decision, 2026-09-30) — ONE TIME ZONE PER WORKSPACE, chosen
 * at sign-up. Shanghai time for everyone was a leftover of the export
 * positioning: a shop in London saw a message sent at 15:40 as 22:40.
 *
 * The zones each country uses, from the tz database's `zone.tab` (public
 * domain), keyed by ISO 3166-1 alpha-2 — the shape `businesses.country`
 * stores. A country with one zone gets it without being asked; a country with
 * several is asked which (sign-up returns with the question, like any missing
 * answer). The owner changes it on the profile page. A country this table does
 * not know offers the full list.
 *
 * Pure: no I/O. `tests/parity/workspace-zone.test.ts` holds that every zone
 * here is one this build's Intl knows, and that every country the sign-up
 * form offers has at least one.
 */
const ZONES: Readonly<Record<string, readonly string[]>> = {
  AD: ['Europe/Andorra'],
  AE: ['Asia/Dubai'],
  AF: ['Asia/Kabul'],
  AG: ['America/Antigua'],
  AI: ['America/Anguilla'],
  AL: ['Europe/Tirane'],
  AM: ['Asia/Yerevan'],
  AO: ['Africa/Luanda'],
  AQ: ['Antarctica/McMurdo', 'Antarctica/Casey', 'Antarctica/Davis', 'Antarctica/DumontDUrville', 'Antarctica/Mawson', 'Antarctica/Palmer', 'Antarctica/Rothera', 'Antarctica/Syowa', 'Antarctica/Troll', 'Antarctica/Vostok'],
  AR: ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Salta', 'America/Argentina/Jujuy', 'America/Argentina/Tucuman', 'America/Argentina/Catamarca', 'America/Argentina/La_Rioja', 'America/Argentina/San_Juan', 'America/Argentina/Mendoza', 'America/Argentina/San_Luis', 'America/Argentina/Rio_Gallegos', 'America/Argentina/Ushuaia'],
  AS: ['Pacific/Pago_Pago'],
  AT: ['Europe/Vienna'],
  AU: ['Australia/Lord_Howe', 'Antarctica/Macquarie', 'Australia/Hobart', 'Australia/Melbourne', 'Australia/Sydney', 'Australia/Broken_Hill', 'Australia/Brisbane', 'Australia/Lindeman', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Eucla'],
  AW: ['America/Aruba'],
  AX: ['Europe/Mariehamn'],
  AZ: ['Asia/Baku'],
  BA: ['Europe/Sarajevo'],
  BB: ['America/Barbados'],
  BD: ['Asia/Dhaka'],
  BE: ['Europe/Brussels'],
  BF: ['Africa/Ouagadougou'],
  BG: ['Europe/Sofia'],
  BH: ['Asia/Bahrain'],
  BI: ['Africa/Bujumbura'],
  BJ: ['Africa/Porto-Novo'],
  BL: ['America/St_Barthelemy'],
  BM: ['Atlantic/Bermuda'],
  BN: ['Asia/Brunei'],
  BO: ['America/La_Paz'],
  BQ: ['America/Kralendijk'],
  BR: ['America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Araguaina', 'America/Maceio', 'America/Bahia', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba', 'America/Santarem', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Manaus', 'America/Eirunepe', 'America/Rio_Branco'],
  BS: ['America/Nassau'],
  BT: ['Asia/Thimphu'],
  BW: ['Africa/Gaborone'],
  BY: ['Europe/Minsk'],
  BZ: ['America/Belize'],
  CA: ['America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay', 'America/Blanc-Sablon', 'America/Toronto', 'America/Iqaluit', 'America/Atikokan', 'America/Winnipeg', 'America/Resolute', 'America/Rankin_Inlet', 'America/Regina', 'America/Swift_Current', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Inuvik', 'America/Vancouver', 'America/Creston', 'America/Dawson_Creek', 'America/Fort_Nelson', 'America/Whitehorse', 'America/Dawson'],
  CC: ['Indian/Cocos'],
  CD: ['Africa/Kinshasa', 'Africa/Lubumbashi'],
  CF: ['Africa/Bangui'],
  CG: ['Africa/Brazzaville'],
  CH: ['Europe/Zurich'],
  CI: ['Africa/Abidjan'],
  CK: ['Pacific/Rarotonga'],
  CL: ['America/Santiago', 'America/Coyhaique', 'America/Punta_Arenas', 'Pacific/Easter'],
  CM: ['Africa/Douala'],
  CN: ['Asia/Shanghai', 'Asia/Urumqi'],
  CO: ['America/Bogota'],
  CR: ['America/Costa_Rica'],
  CU: ['America/Havana'],
  CV: ['Atlantic/Cape_Verde'],
  CW: ['America/Curacao'],
  CX: ['Indian/Christmas'],
  CY: ['Asia/Nicosia', 'Asia/Famagusta'],
  CZ: ['Europe/Prague'],
  DE: ['Europe/Berlin', 'Europe/Busingen'],
  DJ: ['Africa/Djibouti'],
  DK: ['Europe/Copenhagen'],
  DM: ['America/Dominica'],
  DO: ['America/Santo_Domingo'],
  DZ: ['Africa/Algiers'],
  EC: ['America/Guayaquil', 'Pacific/Galapagos'],
  EE: ['Europe/Tallinn'],
  EG: ['Africa/Cairo'],
  EH: ['Africa/El_Aaiun'],
  ER: ['Africa/Asmara'],
  ES: ['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary'],
  ET: ['Africa/Addis_Ababa'],
  FI: ['Europe/Helsinki'],
  FJ: ['Pacific/Fiji'],
  FK: ['Atlantic/Stanley'],
  FM: ['Pacific/Chuuk', 'Pacific/Pohnpei', 'Pacific/Kosrae'],
  FO: ['Atlantic/Faroe'],
  FR: ['Europe/Paris'],
  GA: ['Africa/Libreville'],
  GB: ['Europe/London'],
  GD: ['America/Grenada'],
  GE: ['Asia/Tbilisi'],
  GF: ['America/Cayenne'],
  GG: ['Europe/Guernsey'],
  GH: ['Africa/Accra'],
  GI: ['Europe/Gibraltar'],
  GL: ['America/Nuuk', 'America/Danmarkshavn', 'America/Scoresbysund', 'America/Thule'],
  GM: ['Africa/Banjul'],
  GN: ['Africa/Conakry'],
  GP: ['America/Guadeloupe'],
  GQ: ['Africa/Malabo'],
  GR: ['Europe/Athens'],
  GS: ['Atlantic/South_Georgia'],
  GT: ['America/Guatemala'],
  GU: ['Pacific/Guam'],
  GW: ['Africa/Bissau'],
  GY: ['America/Guyana'],
  HK: ['Asia/Hong_Kong'],
  // zone1970.tab keeps Heard Island with Kerguelen; zone.tab leaves it out.
  HM: ['Indian/Kerguelen'],
  HN: ['America/Tegucigalpa'],
  HR: ['Europe/Zagreb'],
  HT: ['America/Port-au-Prince'],
  HU: ['Europe/Budapest'],
  ID: ['Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura'],
  IE: ['Europe/Dublin'],
  IL: ['Asia/Jerusalem'],
  IM: ['Europe/Isle_of_Man'],
  IN: ['Asia/Kolkata'],
  IO: ['Indian/Chagos'],
  IQ: ['Asia/Baghdad'],
  IR: ['Asia/Tehran'],
  IS: ['Atlantic/Reykjavik'],
  IT: ['Europe/Rome'],
  JE: ['Europe/Jersey'],
  JM: ['America/Jamaica'],
  JO: ['Asia/Amman'],
  JP: ['Asia/Tokyo'],
  KE: ['Africa/Nairobi'],
  KG: ['Asia/Bishkek'],
  KH: ['Asia/Phnom_Penh'],
  KI: ['Pacific/Tarawa', 'Pacific/Kanton', 'Pacific/Kiritimati'],
  KM: ['Indian/Comoro'],
  KN: ['America/St_Kitts'],
  KP: ['Asia/Pyongyang'],
  KR: ['Asia/Seoul'],
  KW: ['Asia/Kuwait'],
  KY: ['America/Cayman'],
  KZ: ['Asia/Almaty', 'Asia/Qyzylorda', 'Asia/Qostanay', 'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Atyrau', 'Asia/Oral'],
  LA: ['Asia/Vientiane'],
  LB: ['Asia/Beirut'],
  LC: ['America/St_Lucia'],
  LI: ['Europe/Vaduz'],
  LK: ['Asia/Colombo'],
  LR: ['Africa/Monrovia'],
  LS: ['Africa/Maseru'],
  LT: ['Europe/Vilnius'],
  LU: ['Europe/Luxembourg'],
  LV: ['Europe/Riga'],
  LY: ['Africa/Tripoli'],
  MA: ['Africa/Casablanca'],
  MC: ['Europe/Monaco'],
  MD: ['Europe/Chisinau'],
  ME: ['Europe/Podgorica'],
  MF: ['America/Marigot'],
  MG: ['Indian/Antananarivo'],
  MH: ['Pacific/Majuro', 'Pacific/Kwajalein'],
  MK: ['Europe/Skopje'],
  ML: ['Africa/Bamako'],
  MM: ['Asia/Yangon'],
  MN: ['Asia/Ulaanbaatar', 'Asia/Hovd'],
  MO: ['Asia/Macau'],
  MP: ['Pacific/Saipan'],
  MQ: ['America/Martinique'],
  MR: ['Africa/Nouakchott'],
  MS: ['America/Montserrat'],
  MT: ['Europe/Malta'],
  MU: ['Indian/Mauritius'],
  MV: ['Indian/Maldives'],
  MW: ['Africa/Blantyre'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas', 'America/Hermosillo', 'America/Tijuana'],
  MY: ['Asia/Kuala_Lumpur', 'Asia/Kuching'],
  MZ: ['Africa/Maputo'],
  NA: ['Africa/Windhoek'],
  NC: ['Pacific/Noumea'],
  NE: ['Africa/Niamey'],
  NF: ['Pacific/Norfolk'],
  NG: ['Africa/Lagos'],
  NI: ['America/Managua'],
  NL: ['Europe/Amsterdam'],
  NO: ['Europe/Oslo'],
  NP: ['Asia/Kathmandu'],
  NR: ['Pacific/Nauru'],
  NU: ['Pacific/Niue'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
  OM: ['Asia/Muscat'],
  PA: ['America/Panama'],
  PE: ['America/Lima'],
  PF: ['Pacific/Tahiti', 'Pacific/Marquesas', 'Pacific/Gambier'],
  PG: ['Pacific/Port_Moresby', 'Pacific/Bougainville'],
  PH: ['Asia/Manila'],
  PK: ['Asia/Karachi'],
  PL: ['Europe/Warsaw'],
  PM: ['America/Miquelon'],
  PN: ['Pacific/Pitcairn'],
  PR: ['America/Puerto_Rico'],
  PS: ['Asia/Gaza', 'Asia/Hebron'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
  PW: ['Pacific/Palau'],
  PY: ['America/Asuncion'],
  QA: ['Asia/Qatar'],
  RE: ['Indian/Reunion'],
  RO: ['Europe/Bucharest'],
  RS: ['Europe/Belgrade'],
  RU: ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Kirov', 'Europe/Volgograd', 'Europe/Astrakhan', 'Europe/Saratov', 'Europe/Ulyanovsk', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Barnaul', 'Asia/Tomsk', 'Asia/Novokuznetsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Chita', 'Asia/Yakutsk', 'Asia/Khandyga', 'Asia/Vladivostok', 'Asia/Ust-Nera', 'Asia/Magadan', 'Asia/Sakhalin', 'Asia/Srednekolymsk', 'Asia/Kamchatka', 'Asia/Anadyr'],
  RW: ['Africa/Kigali'],
  SA: ['Asia/Riyadh'],
  SB: ['Pacific/Guadalcanal'],
  SC: ['Indian/Mahe'],
  SD: ['Africa/Khartoum'],
  SE: ['Europe/Stockholm'],
  SG: ['Asia/Singapore'],
  SH: ['Atlantic/St_Helena'],
  SI: ['Europe/Ljubljana'],
  SJ: ['Arctic/Longyearbyen'],
  SK: ['Europe/Bratislava'],
  SL: ['Africa/Freetown'],
  SM: ['Europe/San_Marino'],
  SN: ['Africa/Dakar'],
  SO: ['Africa/Mogadishu'],
  SR: ['America/Paramaribo'],
  SS: ['Africa/Juba'],
  ST: ['Africa/Sao_Tome'],
  SV: ['America/El_Salvador'],
  SX: ['America/Lower_Princes'],
  SY: ['Asia/Damascus'],
  SZ: ['Africa/Mbabane'],
  TC: ['America/Grand_Turk'],
  TD: ['Africa/Ndjamena'],
  TF: ['Indian/Kerguelen'],
  TG: ['Africa/Lome'],
  TH: ['Asia/Bangkok'],
  TJ: ['Asia/Dushanbe'],
  TK: ['Pacific/Fakaofo'],
  TL: ['Asia/Dili'],
  TM: ['Asia/Ashgabat'],
  TN: ['Africa/Tunis'],
  TO: ['Pacific/Tongatapu'],
  TR: ['Europe/Istanbul'],
  TT: ['America/Port_of_Spain'],
  TV: ['Pacific/Funafuti'],
  TW: ['Asia/Taipei'],
  TZ: ['Africa/Dar_es_Salaam'],
  UA: ['Europe/Simferopol', 'Europe/Kyiv'],
  UG: ['Africa/Kampala'],
  UM: ['Pacific/Midway', 'Pacific/Wake'],
  US: ['America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello', 'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox', 'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu'],
  UY: ['America/Montevideo'],
  UZ: ['Asia/Samarkand', 'Asia/Tashkent'],
  VA: ['Europe/Vatican'],
  VC: ['America/St_Vincent'],
  VE: ['America/Caracas'],
  VG: ['America/Tortola'],
  VI: ['America/St_Thomas'],
  VN: ['Asia/Ho_Chi_Minh'],
  VU: ['Pacific/Efate'],
  WF: ['Pacific/Wallis'],
  WS: ['Pacific/Apia'],
  // Kosovo is not in the tz tables (no ISO code of its own there); it keeps Belgrade's time.
  XK: ['Europe/Belgrade'],
  YE: ['Asia/Aden'],
  YT: ['Indian/Mayotte'],
  ZA: ['Africa/Johannesburg'],
  ZM: ['Africa/Lusaka'],
  ZW: ['Africa/Harare'],
};

/** The zones a country uses, in the tz database's order; none for a code it does not know. */
export const zonesOf = (country: string | null | undefined): readonly string[] =>
  country ? ZONES[canonicalCountry(country.trim().toUpperCase())] ?? [] : [];

/** The one zone a country uses, or null when it has several (ask) or is unknown. */
export const onlyZoneOf = (country: string | null | undefined): string | null => {
  const z = zonesOf(country);
  return z.length === 1 ? z[0]! : null;
};

/** Is this an IANA zone this build can format in? */
export function isZone(zone: string | null | undefined): zone is string {
  if (!zone || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Every zone a country table names, for a country it does not know. */
export const ALL_ZONES: readonly string[] = [...new Set(Object.values(ZONES).flat())].sort();

/**
 * The zones an owner in this country chooses from: the country's own, or every
 * zone when the table has none for it (Bouvet Island) — never an empty list,
 * so no country is asked a question it cannot answer. None before a country is
 * given.
 */
export const zoneChoices = (country: string | null | undefined): readonly string[] =>
  !country?.trim() ? [] : zonesOf(country).length ? zonesOf(country) : ALL_ZONES;

/**
 * The zone a sign-up gives a workspace: the country's only one, or the one the
 * owner picked from the country's list; null when the owner must still be
 * asked (several zones, none picked, or one not in the country's list).
 */
export function zoneForSignup(country: string, picked: string | null | undefined): string | null {
  const only = onlyZoneOf(country);
  if (only) return only;
  return picked && zoneChoices(country).includes(picked) && isZone(picked) ? picked : null;
}

const INTL_TAG: Record<Locale, string> = { en: 'en-US', zh: 'zh-CN', ar: 'ar', es: 'es', fr: 'fr' };

/**
 * A zone as an owner reads it: the place, then the time it keeps in the
 * owner's language — "New York — Eastern Time", "纽约 — 北美东部时间" (the
 * place stays as the tz database names it). Two zones of one country can keep
 * the same time; the place tells them apart.
 */
export function zoneLabel(locale: Locale, zone: string): string {
  const place = zoneCity(locale, zone) ?? zonePlace(zone);
  const kept = zoneKept(locale, zone);
  return kept ? `${place} — ${kept}` : place;
}

/** The place a zone is named after, as the tz database names it: "Buenos Aires, Argentina". */
export const zonePlace = (zone: string): string =>
  zone.split('/').slice(1).reverse().join(', ').replace(/_/g, ' ') || zone;

/**
 * THE WARMTH RUN, phase 9 (w4-settings-b-outreach-09, -10) — a zone is named
 * by the time it keeps NOW. It was named at 1970-01-01, the epoch: Lord Howe
 * then kept Sydney's time and Galápagos Ecuador's, so both carried a name
 * that is no longer theirs, and a zone that has a name today but had none
 * then fell back to the bare "heure : Soudan". A fixed day of this year keeps
 * every render alike; the names are generic, so the season does not matter.
 */
const NAMED_AT = new Date(Date.UTC(2026, 0, 15, 12));

const nameOf = (locale: Locale, zone: string, style: 'longGeneric' | 'shortGeneric'): string => {
  const key = `${style}|${locale}|${zone}`;
  const hit = KEPT.get(key);
  if (hit !== undefined) return hit;
  let name = '';
  try {
    name = new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: zone, timeZoneName: style })
      .formatToParts(NAMED_AT).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch { /* this build cannot name it */ }
  KEPT.set(key, name);
  return name;
};
/** A list of every zone names each a few hundred times a render; the names never change within a build. */
const KEPT = new Map<string, string>();

/**
 * The time a zone keeps, in the owner's language ("北美东部时间"); '' when this
 * build cannot name it — or names it only by its place ("乌鲁木齐时间",
 * "heure : Maroc"), which says nothing the place beside it does not.
 */
export function zoneKept(locale: Locale, zone: string): string {
  const name = nameOf(locale, zone, 'longGeneric');
  return name && !(name === nameOf(locale, zone, 'shortGeneric') && BY_PLACE[locale].test(name)) ? name : '';
}

/**
 * Phase 9 (V1-522) — the place a zone is named after, in the owner's
 * language: the city this build's own data names ("科尔多瓦", "كوردوبا",
 * "Córdoba"), read out of the zone's name by its place ("科尔多瓦时间",
 * "توقيت كوردوبا", "heure : Córdoba"). Null for the zone a country is named
 * by ("西班牙时间": Madrid is Spain's own), where the country says it all.
 * Where this build names the place no other way ("CT" in English), the city
 * as the tz database names it — never the country again inside it
 * ("Buenos Aires", not "Buenos Aires, Argentina").
 */
const BY_PLACE: Readonly<Record<Locale, RegExp>> = {
  en: /^(.+) Time$/u, zh: /^(.+)时间$/u, ar: /^توقيت (.+)$/u, es: /^hora de (.+)$/u, fr: /^heure : (.+)$/u,
};
const REGION_NAMES = new Map<Locale, Intl.DisplayNames>();
const regionName = (locale: Locale, cc: string): string | null => {
  let names = REGION_NAMES.get(locale);
  if (!names) { names = new Intl.DisplayNames([INTL_TAG[locale]], { type: 'region' }); REGION_NAMES.set(locale, names); }
  try { return names.of(cc) ?? null; } catch { return null; }
};
export function zoneCity(locale: Locale, zone: string): string | null {
  const cc = countryOfZone(zone);
  const read = BY_PLACE[locale].exec(nameOf(locale, zone, 'shortGeneric'))?.[1]?.trim() ?? '';
  if (read && cc && read === regionName(locale, cc)) return null;
  if (read) return read;
  const parts = zone.split('/').slice(1).map((x) => x.replace(/_/g, ' '));
  const city = parts[parts.length - 1] ?? zone;
  // America/Argentina/Cordoba: the middle is the country, said already; America/Indiana/Knox: the state, kept.
  const middle = parts.length === 3 && cc && parts[1] !== regionName('en', cc) ? parts[1] : null;
  return middle ? `${city}, ${middle}` : city;
}

/**
 * Phase 9 (V1-522) — the zones of one country that keep the same time all
 * year, today, are one choice for a shop: Argentina's twelve, Indiana's
 * eight towns on Eastern Time. Each set is offered once, by the zone the
 * workspace already keeps when it is one of them, else by its best-known
 * city, else by the tz database's first. What is stored for a new choice is
 * that zone; every member keeps the same clock.
 */
const PRINCIPAL: ReadonlySet<string> = new Set([
  'America/Sao_Paulo', 'Australia/Sydney', 'America/Toronto', 'America/Mexico_City', 'America/Argentina/Buenos_Aires',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage',
]);
const OFFSETS = new Map<string, string>();
const offsetsOf = (zone: string): string => {
  const hit = OFFSETS.get(zone);
  if (hit !== undefined) return hit;
  let sig = zone;
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    sig = Array.from({ length: 24 }, (_, i) => f.formatToParts(new Date(Date.UTC(2026, Math.floor(i / 2), i % 2 ? 16 : 1, 12)))
      .find((p) => p.type === 'timeZoneName')?.value ?? '').join(',');
  } catch { /* unknown: its own choice */ }
  OFFSETS.set(zone, sig);
  return sig;
};
export function zonesKeptApart(zones: readonly string[], kept: string | null = null): readonly string[] {
  const groups = new Map<string, string[]>();
  for (const z of zones) {
    const k = `${countryOfZone(z) ?? z}|${offsetsOf(z)}|${zoneKept('en', z)}`;
    const g = groups.get(k);
    if (g) g.push(z); else groups.set(k, [z]);
  }
  const first = (g: readonly string[]): string => {
    const own = zonesOf(countryOfZone(g[0]!));
    return [...g].sort((a, b) => own.indexOf(a) - own.indexOf(b))[0]!;
  };
  const pick = (g: readonly string[]): string =>
    (kept && g.includes(kept) ? kept : g.find((z) => PRINCIPAL.has(z)) ?? first(g));
  const chosen = new Set([...groups.values()].map(pick));
  return zones.filter((z) => chosen.has(z));
}

/**
 * Phase 9 (V1-522) — the zones of ONE list, each named by the time it keeps in
 * the owner's language ("北美东部时间", "北美中部时间"); the city, in the
 * owner's language too (`zoneCity`), is added only where two zones of the list
 * keep the same time ("巴西利亚标准时间（累西腓）"), or where the time has no name.
 */
export function zoneLabelsAmong(locale: Locale, zones: readonly string[]): (zone: string) => string {
  const times = new Map<string, number>();
  for (const z of zones) { const k = zoneKept(locale, z); if (k) times.set(k, (times.get(k) ?? 0) + 1); }
  const open = (s: string) => (locale === 'zh' ? `（${s}）` : ` (${s})`);
  // Phase 9 (V1-522) — the city in the owner's language; the country's own zone needs none.
  return (zone) => {
    const kept = zoneKept(locale, zone);
    const city = zoneCity(locale, zone);
    if (!kept) return city ?? zonePlace(zone);
    return (times.get(kept) ?? 0) > 1 && city ? `${kept}${open(city)}` : kept;
  };
}

/**
 * Phase 9 (V1-522, V1-528) — the profile's full list, when the workspace has
 * no country to narrow it: every zone an owner could keep a shop in, without
 * the research stations of Antarctica and Svalbard, under the region the tz
 * database files it in. A zone the workspace already keeps stays offered.
 */
export const REGIONS = ['Africa', 'America', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'] as const;
export type ZoneRegion = (typeof REGIONS)[number];
const STATIONS = /^(Antarctica|Arctic)\//;
export const regionOf = (zone: string): ZoneRegion | null =>
  REGIONS.find((r) => zone.startsWith(`${r}/`)) ?? null;
export const SHOP_ZONES: readonly string[] = ALL_ZONES.filter((z) => !STATIONS.test(z) && regionOf(z) !== null);

/**
 * The groups the full list is shown in. A continent is named by the owner's
 * language itself (`Intl.DisplayNames`, its UN M.49 code: Oceania holds
 * Australia and the Pacific); the two oceans' islands, which no continent
 * holds, by the catalogue (`settings.zone.region.<key>`).
 */
export const ZONE_GROUPS: readonly { readonly regions: readonly ZoneRegion[]; readonly m49?: string; readonly key?: 'Atlantic' | 'Indian' }[] = [
  { regions: ['Africa'], m49: '002' }, { regions: ['America'], m49: '019' }, { regions: ['Asia'], m49: '142' },
  { regions: ['Atlantic'], key: 'Atlantic' }, { regions: ['Europe'], m49: '150' }, { regions: ['Indian'], key: 'Indian' },
  { regions: ['Australia', 'Pacific'], m49: '009' },
];

/** The one country the table files this zone under, or null when it is several or none. */
export function countryOfZone(zone: string): string | null {
  const hit = COUNTRY_OF.get(zone);
  if (hit !== undefined) return hit;
  const found = Object.entries(ZONES).filter(([, zs]) => zs.includes(zone)).map(([c]) => c);
  const cc = found.length === 1 ? found[0]! : null;
  COUNTRY_OF.set(zone, cc);
  return cc;
}
const COUNTRY_OF = new Map<string, string | null>();
