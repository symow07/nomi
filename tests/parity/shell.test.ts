import { describe, it, expect } from 'vitest';
import { shell, deeper, NAV, CONTEXTUAL_ROUTES } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * Phase F — the shared shell, enforced. Every owner surface is drawn inside it,
 * so anything wrong here is wrong four times over.
 */
/** The scale the product settled on. Anything else is a one-off. */
const SCALE = [12, 13, 14, 15, 17, 19, 22, 26];

const page = (locale: 'en' | 'zh' | 'ar' = 'en', active = 'home') =>
  shell({ title: 'T', active, locale, path: '/app', avatar: '👩', bodyHtml: '<p>body</p>' });

describe('Phase F · four destinations, and nothing else competing', () => {
  it('the nav is exactly Today, Buyers, 小雅, My factory', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/app', '/app/inbox', '/app/employee', '/app/factory']);
  });

  it('names them in the owner’s language, in every locale', () => {
    expect(page('en')).toContain('Today'); expect(page('en')).toContain('Buyers');
    expect(page('zh')).toContain('今天'); expect(page('zh')).toContain('买家');
    expect(page('zh')).toContain('小雅');
    expect(page('ar')).toContain('اليوم'); expect(page('ar')).toContain('المشترون');
    // the retired name for the buyers surface is gone from the nav
    expect(page('en')).not.toContain('>Inbox<');
    expect(page('zh')).not.toContain('收件箱');
  });

  it('no surface that is reached contextually also holds a nav slot', () => {
    const navHrefs = new Set(NAV.map((n) => n.href));
    for (const r of CONTEXTUAL_ROUTES) expect(navHrefs.has(r), r).toBe(false);
    // and the ones that were demoted are still real routes someone links to
    for (const r of ['/app/onboarding', '/app/sandbox', '/app/conversations', '/app/analytics'])
      expect(CONTEXTUAL_ROUTES, r).toContain(r);
  });

  it('marks the active destination, and only that one', () => {
    const html = page('en', 'factory');
    expect(html.split('navlink active').length - 1).toBe(1);
    expect(html).toContain('href="/app/factory" class="navlink active"');
  });
});

describe('Phase F · the shell is usable with a thumb', () => {
  const style = page().match(/<style>[\s\S]*?<\/style>/)![0];

  it('every header and nav control clears a 44px target', () => {
    expect(style).toMatch(/nav\.side a\.navlink \{[^}]*min-height: 44px/);
    expect(style).toMatch(/header\.top \.logout \{[^}]*min-height:44px/);
    expect(style).toMatch(/\.langsw a \{[^}]*min-height:44px/);
    expect(style).toMatch(/\.deeper \{[^}]*min-height:44px/);
  });

  it('no control breaks mid-word, and nothing is pushed off a 390px screen', () => {
    expect(style).toMatch(/header\.top \.logout \{[^}]*white-space:nowrap/);
    expect(style).toMatch(/\.langsw a \{[^}]*white-space:nowrap/);
    // nowrap controls in a nowrap header pushed every page 16px past the viewport
    expect(style).toMatch(/header\.top \{[^}]*flex-wrap: wrap/);
  });

  it('one type scale — the product had nineteen sizes, ten of them a pixel apart', () => {
    const sizes = new Set([...style.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])));
    for (const size of sizes) expect(SCALE, `${size}px is off the scale`).toContain(size);
  });

  it('section headings are sentence case everywhere — the eyebrow was the SaaS tell', () => {
    expect(style).toMatch(/\.card h2, \.block h2, main h2 \{[^}]*text-transform:none/);
    expect(style).not.toContain('text-transform:uppercase');
  });

  it('on a phone the four destinations are one row of equal targets', () => {
    const phone = style.slice(style.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/nav\.side a\.navlink \{[^}]*flex:1/);
    expect(phone).toMatch(/nav\.side a\.navlink \{[^}]*min-height:56px/);
    expect(phone).not.toContain('flex-wrap');       // never three ragged rows
  });

  it('keyboard focus is visible on every interactive element, app-wide', () => {
    expect(style).toContain('a:focus-visible');
    expect(style).toContain('button:focus-visible');
    expect(style).toContain('outline:2px solid #60a5fa');
  });
});

describe('Phase F · one “go deeper” affordance for the whole product', () => {
  it('renders one shape, with a chevron that mirrors in RTL', () => {
    expect(deeper('/app/products', 'See your products'))
      .toBe('<a class="deeper" href="/app/products">See your products<span class="go" aria-hidden="true">›</span></a>');
    const style = page().match(/<style>[\s\S]*?<\/style>/)![0];
    expect(style).toContain('[dir="rtl"] .go { transform:scaleX(-1)');
  });

  it('escapes its label', () => {
    expect(deeper('/x', '<script>bad()</script>')).not.toContain('<script>bad()');
  });
});

describe('Phase F · direction', () => {
  it('sets dir per locale and mirrors the layout with logical properties only', () => {
    expect(page('ar')).toContain('dir="rtl"');
    expect(page('en')).toContain('dir="ltr"');
    expect(page('zh')).toContain('dir="ltr"');
    const style = page().match(/<style>[\s\S]*?<\/style>/)![0];
    // the grid mirrors itself; re-flipping it is what broke Arabic desktop
    expect(style).not.toMatch(/\[dir="rtl"\]\s*\.layout/);
    expect(style).not.toMatch(/\[dir="rtl"\]\s*nav\.side/);
    for (const physical of ['margin-left', 'margin-right', 'padding-left', 'padding-right',
                            'border-left', 'border-right', 'text-align:left', 'text-align:right'])
      expect(style.includes(physical), physical).toBe(false);
  });

  it('every locale renders the whole shell without leaking another locale’s words', () => {
    for (const l of LOCALES) expect(page(l).length).toBeGreaterThan(1000);
    expect(page('ar')).not.toContain('My factory');
    expect(page('zh')).not.toContain('My factory');
  });
});

describe('Phase F · every surface draws from the same tokens', () => {
  it('no renderer invents a font size off the scale', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/font-size:\s*(\d+)px/g))
        expect(SCALE, `${f}: ${m[1]}px`).toContain(Number(m[1]));
    }
  });

  it('no renderer redeclares a component the shell owns', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    // A BARE rule redefines the component for the whole app; a scoped one
    // (`.acts .btn { ... }`) is a local adjustment and is allowed.
    const OWNED = ['btn', 'pill', 'flash', 'tabs', 'tab', 'empty', 'list', 'back', 'stats', 'stat', 'inline'];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts') && x !== 'layout.ts')) {
      const src = await readFile(new URL(f, dir), 'utf8');
      for (const owned of OWNED)
        expect(new RegExp(`(^|[;{}\\n])\\s*\\.${owned} \\{`, 'm').test(src),
          `${f} redeclares .${owned}`).toBe(false);
      expect(/(^|[;{}\n])\s*[a-z, ]*:focus-visible \{ ?outline/m.test(src),
        `${f} redeclares the focus ring`).toBe(false);
    }
  });
});

describe('Phase F · direction is never baked into the copy', () => {
  it('the back link carries a mirrored arrow, not an arrow character', async () => {
    const { back } = await import('../../src/api/web/layout.js');
    expect(back('/app/inbox', 'Buyers'))
      .toBe('<a class="back" href="/app/inbox"><span class="go" aria-hidden="true">‹</span>Buyers</a>');
    const { messages } = await import('../../src/core/owner/i18n/messages.js');
    for (const locale of LOCALES)
      for (const [key, s] of Object.entries(messages[locale]))
        expect(/[←→]/.test(s), `${locale}/${key} bakes a direction into the copy`).toBe(false);
  });

  it('the back link is a real touch target', () => {
    const style = page().match(/<style>[\s\S]*?<\/style>/)![0];
    expect(style).toMatch(/\.back \{[^}]*min-height:44px/);
  });
});
