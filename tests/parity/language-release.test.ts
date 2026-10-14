import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { CONVERSATIONS as CONVERSATIONS_, WORDS as WORDS_, ENDS as ENDS_, verdict as verdict_ } from '../../tools/check-language-release.words.mjs';
import { SERVED_LANGUAGES } from '../../src/core/owner/i18n/locale.js';
import { addressesInGender } from '../../src/core/safety/address.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * Arabic, pre-approved and conditional (the owner, 2026-10-14): held out of one workspace until (a) its products carry
 * Arabic names and (b) a 60-turn Arabic run over its REAL catalogue comes back with nothing gendered sent, nothing
 * held silent, and no split against English or Chinese. The pure parts of (b) — its words and its verdict — and the
 * hold's migration and tool. The hold through a turn: tests/pipeline/language-hold.test.ts; over Postgres with the
 * tool: tests/integration/language-hold.test.ts.
 */

type Step = string;
type Words = Record<'en' | 'zh' | 'ar', Record<Step, (p: string, q: number) => string>>;
type End = 'sent' | 'told' | 'held' | 'nothing';
type Verdict = { turns: number; gendered: unknown[]; silent: unknown[]; splits: unknown[]; failed: number; pass: boolean };
const CONVERSATIONS = CONVERSATIONS_ as readonly (readonly [string, readonly Step[]])[];
const WORDS = WORDS_ as Words;
const ENDS = ENDS_ as readonly End[];
const verdict = verdict_ as (runs: readonly unknown[], o?: { lang?: string; against?: string[]; atLeast?: number; failed?: number }) => Verdict;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');

describe('(b) · the conversations, the same in every language', () => {
  it('every step has its words in en, zh and ar; twelve messages in all', () => {
    const steps = CONVERSATIONS.flatMap(([, s]) => s);
    expect(steps).toHaveLength(12);
    for (const lang of ['en', 'zh', 'ar'] as const) {
      for (const s of steps) expect(typeof WORDS[lang][s], `${lang} ${s}`).toBe('function');
      expect(Object.keys(WORDS[lang]).sort(), lang).toEqual(Object.keys(WORDS.en).sort());
    }
  });
  it('the product and the quantity are in the words where the step names them', () => {
    expect(WORDS.ar['priceFor']!('حقيبة قماشية', 1000)).toContain('حقيبة قماشية');
    expect(WORDS.ar['priceFor']!('حقيبة قماشية', 1000)).toContain('1000');
    expect(WORDS.zh['looking']!('帆布袋', 0)).toContain('帆布袋');
    expect(WORDS.en['yes']!('x', 2000)).toContain('2000');
  });
  it('the buyer\'s own Arabic addresses nobody in a gender either — the guard reads replies, not these', () => {
    for (const s of Object.keys(WORDS.ar)) {
      expect(addressesInGender(WORDS.ar[s]!('حقيبة', 500)), s).toBeNull();
    }
  });
});

type Run = { lang: string; step: string; end: End; gendered: string | null };
const run = (lang: string, step: string, end: Run['end'], gendered: string | null = null): Run => ({ lang, step, end, gendered });
const clean = (n: number): Run[] => Array.from({ length: n }, (_, i) => [
  run('ar', `find#${(i % 7) + 1}`, 'sent'), run('en', `find#${(i % 7) + 1}`, 'sent'), run('zh', `find#${(i % 7) + 1}`, 'sent'),
]).flat();

describe('(b) · the verdict', () => {
  it('60 Arabic turns, all sent, nothing gendered, the same as en and zh: a pass', () => {
    expect(verdict(clean(60)).pass).toBe(true);
  });
  it('fewer than 60 Arabic turns is not a pass', () => {
    const v = verdict(clean(59));
    expect(v.turns).toBe(59);
    expect(v.pass).toBe(false);
  });
  it('one reply that reached the buyer still gendered fails it', () => {
    const v = verdict([...clean(60), run('ar', 'bot#1', 'sent', 'تحتاج')]);
    expect(v.gendered).toHaveLength(1);
    expect(v.pass).toBe(false);
  });
  it('a buyer who got nothing — a draft or nothing at all — fails it: "nothing held silent"', () => {
    for (const end of ['held', 'nothing'] as const) {
      const v = verdict([...clean(60), run('ar', 'yes#2', end), run('en', 'yes#2', end), run('zh', 'yes#2', end)]);
      expect(v.silent, end).toHaveLength(1);
      expect(v.splits, `${end}: the same in every language is no split — and still a fail`).toEqual([]);
      expect(v.pass).toBe(false);
    }
  });
  it('a hand-off the buyer is told of is not silence', () => {
    const v = verdict([...clean(60), run('ar', 'person#2', 'told'), run('en', 'person#2', 'told'), run('zh', 'person#2', 'told')]);
    expect(v.silent).toEqual([]);
    expect(v.pass).toBe(true);
  });
  it('a step that ends one way in Arabic and another in English or Chinese is a split', () => {
    const v = verdict([...clean(60),
      run('ar', 'yes#2', 'told'), run('ar', 'yes#2', 'told'), run('en', 'yes#2', 'sent'), run('en', 'yes#2', 'sent'),
      run('zh', 'yes#2', 'told')]);
    expect(v.splits).toEqual([{ step: 'yes#2', ar: 'told', en: 'sent' }]);
    expect(v.pass).toBe(false);
  });
  it('by the most common end, ties broken the same way whatever order the runs came in', () => {
    const a = [run('ar', 's#1', 'sent'), run('ar', 's#1', 'told'), run('en', 's#1', 'sent'), run('zh', 's#1', 'sent')];
    expect(verdict(a, { atLeast: 0 }).splits).toEqual([]);
    expect(verdict([...a].reverse(), { atLeast: 0 }).splits).toEqual([]);
  });
  it('a failed turn fails it', () => {
    expect(verdict(clean(60), { failed: 1 }).pass).toBe(false);
  });
});

describe('the hold · 0159 and the operator\'s tool', () => {
  it('the migration adds the column (empty for everyone) and the reason on both lists; the build needs it', () => {
    const m = read('migrations/0159_language_held.sql');
    expect(m).toMatch(/add column if not exists languages_held text\[\] not null default '\{\}'/);
    expect(m.match(/'language_held'\)\);/g)).toHaveLength(2);
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(159);
  });
  it('the tool may hold exactly the languages a workspace may serve, and the column allows no other', () => {
    const tool = read('tools/language-hold.mjs');
    const list = JSON.parse(/export const HOLDABLE = (\[[^\]]+\])/.exec(tool)![1]!.replace(/'/g, '"'));
    expect(list).toEqual([...SERVED_LANGUAGES]);
    const m = read('migrations/0159_language_held.sql');
    expect(m).toContain(`array[${SERVED_LANGUAGES.map((l) => `'${l}'`).join(',')}]::text[]`);
  });
  it('the owner reads why the buyer is theirs, in every language', () => {
    for (const l of LOCALES) expect(t(l, 'takeover.reason.language_held'), l).toBeTruthy();
  });
  it('the run never reaches a database that is not this machine\'s, and drops the service\'s own address first', () => {
    const tool = read('tools/check-language-release.mjs');
    expect(tool).toMatch(/must be a database on this machine/);
    expect(tool.indexOf('delete process.env[k]')).toBeLessThan(tool.indexOf("await import('../dist/db/client.js')"));
    expect(tool).toMatch(/begin transaction read only/);
  });
});
