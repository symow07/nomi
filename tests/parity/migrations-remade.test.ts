import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D2 (2026-10-22) — A FUNCTION RE-MADE SAYS SO, FROM ITS LATEST DEFINITION. 0189 first defined `books_settings_rules`
 * for the lock date, not knowing 0173 already had a function by that name (it keeps the books' currency): the new one
 * replaced the old, and the currency rule was gone until a test caught it. So from 0189 on, a migration that creates a
 * function an earlier migration already made must say, in the lines just above, that it is re-made — and from WHICH
 * migration: the latest one that defined it. A name used by accident fails here; a re-make copied from an old
 * definition (and so losing what came after) fails here too.
 */
const DIR = join(__dirname, '..', '..', 'migrations');
const FROM = 189;

describe('migrations · a function re-made says so, naming its latest definition', () => {
  it(`from ${String(FROM).padStart(4, '0')} on`, () => {
    const files = readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const latest = new Map<string, string>();
    const wrong: string[] = [];
    for (const f of files) {
      const n = Number(f.slice(0, 4));
      const lines = readFileSync(join(DIR, f), 'utf8').split('\n');
      const madeHere: string[] = [];
      lines.forEach((l, i) => {
        const m = /^\s*create or replace function (\w+)\(/i.exec(l);
        if (!m) return;
        const name = m[1]!.toLowerCase();
        const before = latest.get(name);
        if (n >= FROM && before !== undefined) {
          const ctx = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
          if (!/re-made/i.test(ctx) || !ctx.includes(before.slice(0, 4))) wrong.push(`${f}: ${name} (last made in ${before})`);
        }
        madeHere.push(name);
      });
      for (const name of madeHere) latest.set(name, f);
    }
    expect(wrong).toEqual([]);
  });
});
