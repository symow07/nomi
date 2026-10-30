import { describe, it, expect } from 'vitest';
import { linkedCss } from './linked-css.js';
import { readFile } from 'node:fs/promises';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { MARK_GEOMETRY, markDetail, markSmall, faviconDataUri } from '../../src/core/owner/brand.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * M30 — the Nomi mark: the seal (2026-10-31), "nomi" in two rows with its "o"
 * a cash coin.
 *
 * The product inlines the mark rather than fetching it, so there are two copies
 * of the drawing: `assets/brand/*.svg` (the source of record) and
 * `src/core/owner/brand.ts` (what ships). Two copies of anything is how this
 * repo has been bitten six times, so the first test here is the one that
 * matters: the inline geometry must equal the file's, byte for byte.
 */

const page = (locale: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en', avatar = markSmall(32, null)) =>
  shell({ title: 'T', active: 'home', locale, path: '/app', avatar, bodyHtml: '<p>body</p>' });

/** The drawing of an SVG: its paths' `d`, in order, the fills ignored. */
const pathsOf = (svg: string): string[] => [...svg.matchAll(/<path [^>]*\bd="([^"]+)"/g)].map((m) => m[1]!);

describe('M30 · the inline mark cannot drift from assets/brand/', () => {
  it('matches the source of record, in every cut', async () => {
    const src = async (f: string) => readFile(new URL(`../../assets/brand/${f}.svg`, import.meta.url), 'utf8');
    const { detail, small, favicon } = MARK_GEOMETRY;
    expect(pathsOf(await src('mark-detail')), 'mark-detail.svg has drifted from brand.ts').toEqual([detail.seal, detail.coin]);
    expect(pathsOf(await src('mark-mono')), 'mark-mono.svg has drifted from brand.ts').toEqual([detail.seal, detail.coin]);
    expect(pathsOf(await src('mark-small')), 'mark-small.svg has drifted from brand.ts').toEqual([small.seal, small.coin]);
    expect(pathsOf(await src('favicon')), 'favicon.svg has drifted from brand.ts').toEqual([favicon.coin]);
    // the sources carry the same two colours as the tokens
    for (const f of ['mark-detail', 'mark-small']) {
      const svg = await src(f);
      expect(svg, f).toContain(`fill="${DESIGN_TOKENS.color.brand}"`);
      expect(svg, f).toContain(`fill="${DESIGN_TOKENS.color.coin}"`);
    }
  });

  it('is TWO cuts — a drawing on the pixel grid for small sizes, not one drawing scaled', () => {
    const detail = markDetail(40);
    const small = markSmall(32);
    expect(detail).toContain('viewBox="0 0 400 400"');
    expect(small).toContain('viewBox="0 0 32 32"');
    expect(pathsOf(detail)).toEqual([MARK_GEOMETRY.detail.seal, MARK_GEOMETRY.detail.coin]);
    expect(pathsOf(small)).toEqual([MARK_GEOMETRY.small.seal, MARK_GEOMETRY.small.coin]);
    // the detail coin has its two rims (six edges); the small one is a disc and a hole
    expect(MARK_GEOMETRY.detail.coin.match(/z/g)).toHaveLength(6);
    expect(MARK_GEOMETRY.small.coin.match(/z/g)).toHaveLength(2);
    // the seal in the brand, the coin in its own wine — never a meaning's shade, never ink
    for (const svg of [detail, small]) {
      expect(svg).toContain('<path fill="var(--color-brand)" fill-rule="evenodd"');
      expect(svg).toContain('<path fill="var(--color-coin)" fill-rule="evenodd"');
      expect(svg).not.toMatch(/--color-(needs|assistant|ink)\b/);
    }
  });

  it('carries no literal colour — it inherits the tokens', () => {
    for (const svg of [markDetail(40), markSmall(32)]) {
      expect(svg.match(/#[0-9a-fA-F]{3,8}/g) ?? []).toEqual([]);
    }
  });
});

describe('M30 · the shell wears the mark', () => {
  it('renders it in every locale', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain('class="mark"');
      expect(html, l).toContain(MARK_GEOMETRY.detail.seal);
      expect(html, l).toContain('Nomi');
    }
  });

  it('uses the DETAIL cut in the brand block, at the size that cut is for', () => {
    const brand = page().split('class="brand"')[1]?.split('</div>')[0] ?? '';
    expect(brand).toContain('viewBox="0 0 400 400" width="40"');
    expect(brand).toContain('viewBox="0 0 32 32" width="32"');   // the phone's cut, on its pixel grid
  });

  it('does not mirror in RTL — only directional glyphs do', () => {
    const style = linkedCss(page('ar'));
    expect(style).toContain('[dir="rtl"] .go');          // the chevron still mirrors
    expect(style).not.toMatch(/\[dir="rtl"\][^{]*\.mark/);
    // and the Arabic page draws the same mark as the English one
    expect(page('ar')).toContain(MARK_GEOMETRY.detail.seal);
  });
});

describe('M30 · the favicon', () => {
  const href = () => page().match(/<link rel="icon" href="([^"]+)"/)![1]!;
  const decoded = () => atob(href().replace('data:image/svg+xml;base64,', ''));

  it('is a data URI, so no page needs a static route for it', () => {
    expect(href()).toMatch(/^data:image\/svg\+xml;base64,/);
    // G5b — the app is installable: the home-screen icons are their own static routes; the favicon stays a data URI.
    expect(page()).toContain('<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">');
    expect(page()).toContain('<link rel="manifest" href="/manifest.webmanifest">');
  });

  it('the login page carries it too — it has its own head, which is how it got missed', () => {
    expect(loginPage({ locale: 'en', path: '/login' })).toContain('data:image/svg+xml;base64,');
  });

  it('is the COIN alone — no letters, because a favicon is 16px', () => {
    const svg = decoded();
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(pathsOf(svg)).toEqual([MARK_GEOMETRY.favicon.coin]);
    expect(svg).toContain(`fill="${DESIGN_TOKENS.color.coin}"`);
    expect(svg).not.toContain(MARK_GEOMETRY.small.seal);
  });

  it('takes its colours FROM the tokens — the one place the mark cannot use var()', () => {
    const values = new Set(Object.values(DESIGN_TOKENS.color).map((v) => v.toLowerCase()));
    for (const hex of decoded().match(/#[0-9a-fA-F]{3,8}/g) ?? []) {
      expect(values, `${hex} is not a token value`).toContain(hex.toLowerCase());
    }
  });

  it('contains no % — the character this product bans in owner copy', () => {
    expect(href()).not.toContain('%');
    expect(faviconDataUri()).not.toContain('%');
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
    expect(page('en', markSmall(32, null))).not.toContain('class="who"');   // V1 · option A: no band at all
  });

  it('main.ts no longer reads EMPLOYEE_AVATAR, and no emoji stands in for anyone', async () => {
    const src = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/process\.env\['EMPLOYEE_AVATAR'\]/);
    expect(src).not.toContain(`'👩‍💼'`);
  });
});
