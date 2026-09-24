import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
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

  it('a line-height per script: 1.5 Latin, 1.7 Chinese, 1.75 Arabic, one for every locale', () => {
    expect(DESIGN_TOKENS.font.lineHeight).toEqual({ en: 1.5, zh: 1.7, ar: 1.75 });
    for (const l of LOCALES) expect(DESIGN_TOKENS.font.lineHeight[l], l).toBeGreaterThan(1);
  });

  it('the emitter keys the override on the lang the shell writes on <html>', () => {
    const css = cssVariables();
    expect(css).toContain('--line-height: 1.5;');
    expect(css).toContain('html[lang="zh"] { --line-height: 1.7; }');
    expect(css).toContain('html[lang="ar"] { --line-height: 1.75; }');
    for (const locale of LOCALES) {
      const page = shell({ title: 'T', active: 'home', locale, path: '/app', avatar: '', bodyHtml: '<p>x</p>' });
      expect(page, locale).toContain(`<html lang="${locale}"`);
      expect(page).toMatch(/body \{[^}]*var\(--line-height\)/);
    }
  });

  it('the retired sizes are gone from every source file', () => {
    const bad = SRC.filter(({ s }) => /--font-size-(micro|note|numeral)\b/.test(s)).map(({ f }) => f);
    expect(bad).toEqual([]);
  });

  it('no weight below 400 anywhere — the CJK floor at 15 px and under holds by having nothing under it', () => {
    // Decision 1 scopes the floor to 15 px and under in Chinese. Nothing in
    // the product declares a lighter weight at any size, so the guard is the
    // wider, simpler one; a light display weight above 15 px, if ever wanted,
    // relaxes this deliberately.
    expect(DESIGN_TOKENS.font.weightFloor).toEqual({ min: 400, cjkAtOrBelowPx: 15 });
    const bad = SRC.flatMap(({ f, s }) =>
      [...s.matchAll(/font-weight:\s*(lighter|[1-3]00)\b/g)].map((m) => `${f}: ${m[0]}`));
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
