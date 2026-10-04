import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { withSheets } from './linked-css.js';
import { shell } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * V1 · decision 1 (type) and decision 2 (spacing), as Symow decided them on
 * 2026-09-24 (docs/DESIGN-V1-BRIEF.md §8). These are the values the whole
 * product now derives from, so they are held here by value — the one place
 * a literal number is the point rather than the defect.
 *
 * The retired tokens (`micro` 12, `note` 14, `numeral` 22, `--space-64`) are
 * held ABSENT: a page that reached for one would render at the browser's
 * default, which is exactly the silent drift the token file exists to stop.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
const SRC = walk('src').map((f) => ({ f, s: readFileSync(join(ROOT, f), 'utf8') }));

describe('V1 · type — decision 1', () => {
  it('the scale is 13/15/17/20/26/34, base 17 kept', () => {
    expect(Object.values(DESIGN_TOKENS.font.sizePx).sort((a, b) => a - b)).toEqual([13, 15, 17, 20, 26, 34]);
    expect(DESIGN_TOKENS.font.sizePx.base).toBe(17);
  });

  // The type pass (2026-10-04) opened them up: 1.6 Latin, 1.75 Chinese, 1.8 Arabic (they were 1.5 / 1.7 / 1.75).
  it('a line-height per script: 1.6 Latin, 1.75 Chinese, 1.8 Arabic, one for every locale', () => {
    expect(DESIGN_TOKENS.font.lineHeight).toEqual({ en: 1.6, zh: 1.75, ar: 1.8, es: 1.6, fr: 1.6 });
    for (const l of LOCALES) expect(DESIGN_TOKENS.font.lineHeight[l], l).toBeGreaterThan(1);
  });

  it('the emitter keys the override on the lang the shell writes on <html>', () => {
    const css = cssVariables();
    expect(css).toContain('--line-height: 1.6;');
    expect(css).toContain('html[lang="zh"] { --line-height: 1.75; ');
    expect(css).toContain('html[lang="ar"] { --line-height: 1.8; ');
    for (const locale of LOCALES) {
      const page = withSheets(shell({ title: 'T', active: 'home', locale, path: '/app', avatar: '', bodyHtml: '<p>x</p>' }));
      expect(page, locale).toContain(`<html lang="${locale}"`);
      expect(page).toMatch(/body \{[^}]*var\(--line-height\)/);
    }
  });

  it('the retired sizes are gone from every source file', () => {
    const bad = SRC.filter(({ s }) => /--font-size-(micro|note|numeral)\b/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  // The type pass (2026-10-04) relaxed this deliberately, as the note here said it would: a light display
  // weight now exists — for a large, quiet figure or sentence, 20 px and up — and decision 1's floor holds by
  // its own words (nothing under 400 at 15 px and under), widened to every script.
  it('nothing under 400 at 15 px and under, in any script; light 300 only at 20 px and up; nothing lighter than 300', () => {
    expect(DESIGN_TOKENS.font.weightFloor).toEqual({ min: 400, cjkAtOrBelowPx: 15, lightFromPx: 20 });
    const px = DESIGN_TOKENS.font.sizePx;
    const sizeOf = (body: string): number | null => {
      const m = /font-size:\s*var\(--font-size-([a-z]+)\)/.exec(body);
      return m ? (px as Record<string, number>)[m[1]!] ?? null : null;
    };
    const bad: string[] = [];
    for (const { f, s } of SRC) {
      for (const m of s.matchAll(/font-weight:\s*(lighter|[1-3]00)\b/g)) {
        // the rule the weight sits in: its own declarations, back to the brace that opened it
        const open = s.lastIndexOf('{', m.index!);
        const close = s.indexOf('}', m.index!);
        const body = s.slice(open, close);
        const size = sizeOf(body);
        if (m[1] !== '300' || size === null || size < DESIGN_TOKENS.font.weightFloor.lightFromPx) bad.push(`${f}: ${m[0]} at ${size ?? 'an inherited size'}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V1 · spacing — decision 2', () => {
  it('the scale is 4/8/12/16/24/32/48', () => {
    expect([...DESIGN_TOKENS.spacingPx]).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });

  it('--space-64 is gone from every source file', () => {
    expect(SRC.filter(({ s }) => /--space-64\b/.test(s)).map(({ f }) => f)).toEqual([]);
  });
});
