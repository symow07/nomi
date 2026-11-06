/**
 * Block 1 #9 — THE ZONE AND CURRENCY TABLES, READ FROM THE SOURCE THE APP USES.
 *
 * tools/backfill-zones.mjs runs where `dist/` may not exist (CI's integration job builds nothing), and the tables are
 * hundreds of lines nobody should copy by hand. So the tool reads the three literals out of the TypeScript sources —
 * `ZONES` (zones.ts), `OWN` (currencies.ts) and `SUPERSEDED` (business.ts) — exactly as written, and a parity test
 * (tests/parity/backfill-zones.test.ts) holds every answer here equal to the app's own `zonesOf` and `currencyOfCountry`.
 * A literal rewritten in a shape this does not read fails that test, never the owner's database.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

/** The body of `const NAME: … = { … };` in a source file. */
function literal(src, name) {
  const at = src.indexOf(`const ${name}:`);
  if (at < 0) throw new Error(`${name} not found`);
  const open = src.indexOf('{', at);
  const close = src.indexOf('\n};', open);
  if (open < 0 || close < 0) throw new Error(`${name} has no body`);
  return src.slice(open + 1, close);
}

const superseded = () => Object.fromEntries([...literal(read('src/core/owner/business.ts'), 'SUPERSEDED').matchAll(/\b([A-Z]{2}):\s*'([A-Z]{2})'/g)].map((m) => [m[1], m[2]]));
const zoneRows = () => Object.fromEntries([...literal(read('src/core/owner/zones.ts'), 'ZONES').matchAll(/\b([A-Z]{2}):\s*\[([^\]]*)\]/g)]
  .map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((z) => z[1])]));
const currencyRows = () => Object.fromEntries([...literal(read('src/core/owner/currencies.ts'), 'OWN').matchAll(/\b([A-Z]{2}):\s*'([A-Z]{3})'/g)].map((m) => [m[1], m[2]]));

let tables = null;
const load = () => (tables ??= { superseded: superseded(), zones: zoneRows(), own: currencyRows() });

export const canonicalCountry = (code) => load().superseded[code] ?? code;
const key = (country) => (country ? canonicalCountry(country.trim().toUpperCase()) : null);

/** The zones a country uses; none for a code the table does not know. */
export const zonesOf = (country) => { const k = key(country); return k ? load().zones[k] ?? [] : []; };
/** The one zone a country uses, or null when it has several or is unknown. */
export const onlyZoneOf = (country) => { const z = zonesOf(country); return z.length === 1 ? z[0] : null; };
/** The currency a country's own shops count in, when it is on Nomi's list; null otherwise. */
export const currencyOfCountry = (country) => { const k = key(country); return k ? load().own[k] ?? null : null; };
/** Every country code the zone table names (the parity test walks them). */
export const zoneCountries = () => Object.keys(load().zones);
export const currencyCountries = () => Object.keys(load().own);
