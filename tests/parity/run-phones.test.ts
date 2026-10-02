import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DEMO_BUYERS, demoPhone } from '../../src/demo/factory.js';
import { runPhoneIn } from '../integration/tenant.js';

/**
 * A test's buyer number must be its own. `demoPhone` moves only the eight
 * digits after the country code, so 971500007701 and the demo buyer
 * 971500000101 are one number in a run — M22's conversation was demo buyer
 * 1's, and the boot test failed whenever another test had left a refusal on it.
 */
const NS = 'f1234567';

describe('integration buyer numbers never land on another number', () => {
  it('the guard refuses a number that becomes a seeded buyer\'s, or one already given', () => {
    const ph = runPhoneIn(NS);
    expect(() => ph('971500007701')).toThrow(/971500000101/);
    expect(ph('971500000101')).toBe(demoPhone('971500000101', NS));    // the buyer's own number is fine
    expect(ph('971500009999')).toBe(ph('971500009999'));                // asked twice, the same answer
    expect(() => ph('971509999999')).toThrow(/971500009999/);
  });

  it('no literal number in an integration file collides', () => {
    const dir = new URL('../integration/', import.meta.url);
    const problems: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      const names = ['runPhone', ...[...src.matchAll(/const (\w+) = runPhone\b/g)].map((m) => m[1]!)];
      const ph = runPhoneIn(NS);
      for (const n of names) {
        for (const m of src.matchAll(new RegExp(`\\b${n}\\(\\s*'(\\d+)'\\s*\\)`, 'g'))) {
          try { ph(m[1]!); } catch (e) { problems.push(`${f}: ${(e as Error).message}`); }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the demo buyers themselves stay apart', () => {
    const mapped = DEMO_BUYERS.map((b) => demoPhone(b.phone, NS));
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});
