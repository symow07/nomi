/**
 * T3 — the names a product is found by, for operator tools that run without
 * a build (the integration job has no dist/). A copy of
 * src/core/onboard/aliases.ts `aliasRowsFor`; tests/parity/findability.test.ts
 * runs both on the same names and holds their answers equal.
 */
export const MAX_ALIAS_LENGTH = 120;

const HAN = /\p{Script=Han}/u;
const ARABIC = /\p{Script=Arabic}/u;

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return s === '' ? null : s;
}

export function aliasRow(name) {
  if (HAN.test(name)) return { alias: name, language: 'zh', aliasType: 'zh' };
  if (ARABIC.test(name)) return { alias: name, language: 'ar', aliasType: 'ar' };
  return { alias: name, language: 'und', aliasType: 'common' };
}

export function aliasRowsFor(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const n = cleanName(raw);
    if (n === null || n.length > MAX_ALIAS_LENGTH) continue;
    const key = n.toLocaleLowerCase('und');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(aliasRow(n));
  }
  return out;
}
