import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { MARK_FIGURE, markDetail, markSmall, faviconDataUri } from '../../src/core/owner/brand.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * M30 — the Nomi mark.
 *
 * The product inlines the mark rather than fetching it, so there are two copies
 * of the drawing: `assets/brand/*.svg` (the source of record) and
 * `src/core/owner/brand.ts` (what ships). Two copies of anything is how this
 * repo has been bitten six times, so the first test here is the one that
 * matters: the inline geometry must equal the file's, byte for byte.
 */

const page = (locale: 'en' | 'zh' | 'ar' = 'en', avatar = markSmall(30, null)) =>
  shell({ title: 'T', active: 'home', locale, path: '/app', avatar, bodyHtml: '<p>body</p>' });

/** The three shapes, pulled out of a source file with the fills ignored. */
const figureOf = (svg: string): string =>
  (svg.match(/<(?:circle cx="50" cy="19"[^>]*|path [^>]*)\/>/g) ?? []).join('');

describe('M30 · the inline mark cannot drift from assets/brand/', () => {
  it('matches the source of record, in every cut', async () => {
    for (const cut of ['mark-detail', 'mark-small', 'mark-mono', 'mark-night']) {
      const src = await readFile(new URL(`../../assets/brand/${cut}.svg`, import.meta.url), 'utf8');
      expect(figureOf(src), `${cut}.svg has drifted from brand.ts`).toBe(MARK_FIGURE);
    }
  });

  it('is TWO cuts — a reversed ground, not one drawing scaled', () => {
    const detail = markDetail(40);
    const small = markSmall(30);
    // same geometry…
    expect(figureOf(detail)).toBe(figureOf(small));
    // …opposite ground: pale disc for the large cut, SOLID jade for the small
    expect(detail).toContain('r="50" fill="var(--color-jade-wash)"');
    expect(small).toContain('r="50" fill="var(--color-jade)"');
    expect(detail).toContain('<g fill="var(--color-jade)">');
    expect(small).toContain('<g fill="var(--color-paper)">');
  });

  it('carries no literal colour — it inherits the tokens, night included', () => {
    for (const svg of [markDetail(40), markSmall(30)]) {
      expect(svg.match(/#[0-9a-fA-F]{3,8}/g) ?? []).toEqual([]);
    }
  });
});

describe('M30 · the shell wears the mark', () => {
  it('renders it in all three locales', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain('class="mark"');
      expect(html, l).toContain(MARK_FIGURE);
      expect(html, l).toContain('Nomi');
    }
  });

  it('uses the DETAIL cut in the brand block, at the size that cut is for', () => {
    const brand = page().split('class="brand"')[1]?.split('</div>')[0] ?? '';
    expect(brand).toContain('width="40"');
    expect(brand).toContain('var(--color-jade-wash)');   // the pale disc = detail cut
  });

  it('does not mirror in RTL — only directional glyphs do', () => {
    const style = page('ar').match(/<style>[\s\S]*?<\/style>/)![0];
    expect(style).toContain('[dir="rtl"] .go');          // the chevron still mirrors
    expect(style).not.toMatch(/\[dir="rtl"\][^{]*\.mark/);
    // and the Arabic page draws the same mark as the English one
    expect(page('ar')).toContain(MARK_FIGURE);
  });
});

describe('M30 · the favicon', () => {
  const href = () => page().match(/<link rel="icon" href="([^"]+)"/)![1]!;
  const decoded = () => atob(href().replace('data:image/svg+xml;base64,', ''));

  it('is a data URI, so no static route is added', () => {
    expect(href()).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(page()).not.toContain('apple-touch-icon');   // no manifest, nothing installable
  });

  it('the login page carries it too — it has its own head, which is how it got missed', () => {
    expect(loginPage({ locale: 'en', path: '/login' })).toContain('data:image/svg+xml;base64,');
  });

  it('carries the SMALL cut — reversed, because a favicon is 16px', () => {
    const svg = decoded();
    expect(figureOf(svg)).toBe(MARK_FIGURE);
    expect(svg).toContain(`r="50" fill="${DESIGN_TOKENS.color.jade}"`);      // solid disc
    expect(svg).toContain(`<g fill="${DESIGN_TOKENS.color.paper}">`);        // knocked out
  });

  it('takes its colours FROM the tokens — the one place the mark cannot use var()', () => {
    const values = new Set(Object.values(DESIGN_TOKENS.color).map((v) => v.toLowerCase()));
    for (const hex of decoded().match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(values, `${hex} is not a token value`).toContain(hex.toLowerCase());
    }
  });

  it('contains no % — the character this product bans in owner copy', () => {
    expect(href()).not.toContain('%');
    expect(loginPage({ locale: 'en', path: '/login' })).toBeTruthy();
  });
});

describe('M30 · the avatar — retired by V1 step three (2026-09-24)', () => {
  // Decision 4: "the assistant has the owner's chosen name, not a face." The
  // header band shows the name and nothing beside it; the mark is the
  // product's and sits with the product's nav. Whatever a caller passes as
  // `avatar` is ignored, and main.ts no longer reads EMPLOYEE_AVATAR.
  it('shows no face, whatever it is given', () => {
    expect(page('en', '🦊')).not.toContain('🦊');
    expect(page('en', '🦊')).not.toContain('class="avatar"');
    expect(page('en', markSmall(30, null))).toMatch(/<div class="who"><div><div class="whoname">/);
  });

  it('main.ts no longer reads EMPLOYEE_AVATAR, and no emoji stands in for anyone', async () => {
    const src = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/process\.env\['EMPLOYEE_AVATAR'\]/);
    expect(src).not.toContain(`'👩‍💼'`);
  });
});
