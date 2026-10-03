import { describe, it, expect } from 'vitest';
import { shell, deeper, NAV, CONTEXTUAL_ROUTES } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { linkedCss, sheetLinks } from './linked-css.js';

/**
 * Phase F — the shared shell, enforced. Every owner surface is drawn inside it,
 * so anything wrong here is wrong four times over.
 */
const page = (locale: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en', active = 'home') =>
  shell({ title: 'T', active, locale, path: '/app', avatar: '👩', bodyHtml: '<p>body</p>' });

describe('Phase F · five destinations, and nothing else competing', () => {
  // D (2026-09-21) — Setup joined as the fifth: how the installation is wired,
  // split out of the drawer that also held what you sell.
  // THE WARMTH RUN (2026-10-03), phase 1 — the owner's rail: Today; Customers
  // (Inbox, Calendar); the assistant; Settings.
  it('the nav is exactly Today, Inbox, Calendar, the assistant, Settings', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/app', '/app/inbox', '/app/calendar', '/app/employee', '/app/settings']);
  });

  it('names them in the owner’s language, in every locale', () => {
    expect(page('en')).toContain('Today'); expect(page('en')).toContain('Customers');
    expect(page('zh')).toContain('今天'); expect(page('zh')).toContain('客户');
    expect(page('zh')).toContain(t('zh', 'nav.employee'));   // no name chosen: 你的助手
    expect(page('ar')).toContain('اليوم'); expect(page('ar')).toContain('العملاء');
    // The warmth run: "Inbox (rename from 'Customer list')", under the Customers heading.
    expect(page('en')).toContain('>Inbox<');
    expect(page('zh')).toContain('收件箱');
    expect(page('en')).not.toContain('Customer list');
  });

  /**
   * The nav carried 🏠 💬 👩 🏭. Emoji render as a different picture on every
   * platform, sit badly beside Arabic, and were the loudest thing on a screen
   * arguing for restraint. The field is gone from NAV, not blanked — so this
   * checks the SHAPE as well as the output, and a re-added icon fails to
   * compile before it ever reaches a page.
   */
  const navOf = (l: 'en' | 'zh' | 'ar' | 'es' | 'fr') => page(l).split('<nav class="side"')[1]?.split('</nav>')[0] ?? '';

  it('the nav carries words, not pictures', () => {
    for (const n of NAV) expect(Object.keys(n).sort()).toEqual(['href', 'id']);
    const pictographs = navOf('en').match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(pictographs, `emoji in the nav: ${pictographs.join(' ')}`).toEqual([]);
    // and the destinations are still named, in every locale
    for (const l of LOCALES) {
      expect(navOf(l).match(/\p{Extended_Pictographic}/gu) ?? [], l).toEqual([]);
      for (const n of NAV) expect(navOf(l), `${l}/${n.id}`).toContain(n.href);
    }
  });

  it('no surface that is reached contextually also holds a nav slot', () => {
    const navHrefs = new Set(NAV.map((n) => n.href));
    for (const r of CONTEXTUAL_ROUTES) expect(navHrefs.has(r), r).toBe(false);
    // and the ones that were demoted are still real routes someone links to
    for (const r of ['/app/onboarding', '/app/sandbox', '/app/analytics'])
      expect(CONTEXTUAL_ROUTES, r).toContain(r);
    // A — Customers is not a route of its own any more: it merged into Buyers,
    // and its address answers with a redirect there, so nothing links to it.
    expect(CONTEXTUAL_ROUTES).not.toContain('/app/conversations');
  });

  it('marks the active destination, and only that one', () => {
    // A7 — the PATH decides now, not the `active` string, so this asks for a
    // page that really is My business. The two used to be able to disagree,
    // and when they did the sidebar lit nothing at all on twenty pages.
    const html = shell({
      title: 'T', active: 'factory', locale: 'en', path: '/app/calendar',
      avatar: '👩', bodyHtml: '<p>body</p>',
    });
    expect(html.match(/class="navlink[^"]* active"/g)).toHaveLength(1);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/app/calendar" class="navlink sub active"');
    // and My business, a row of Settings now, lights Settings
    const mine = shell({ title: 'T', active: 'factory', locale: 'en', path: '/app/business', avatar: '👩', bodyHtml: '' });
    expect(mine).toContain('href="/app/settings" class="navlink active"');
  });
});

describe('V1 close-out · the stylesheet is a file', () => {
  it('the shell links one sheet and its language\'s type, by their content, and carries no rules of its own', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).not.toContain('<style');
      expect(sheetLinks(html), l).toEqual([
        expect.stringMatching(/^\/assets\/app\.[0-9a-f]{16}\.css$/),
        expect.stringMatching(l === 'zh' ? /^\/assets\/typezh\.[0-9a-f]{16}\.css$/ : /^\/assets\/type\.[0-9a-f]{16}\.css$/),
      ]);
      expect(linkedCss(html).length, l).toBeGreaterThan(10_000);
    }
    // one sheet for every page and every language: the address does not vary
    expect(new Set(LOCALES.map((l) => sheetLinks(page(l))[0])).size).toBe(1);
  });
});

describe('Phase F · the shell is usable with a thumb', () => {
  const style = linkedCss(page());

  it('every header and nav control clears a 44px target', () => {
    expect(style).toMatch(/nav\.side a\.navlink \{[^}]*min-height: 44px/);
    // V1 · option A: there is no header band; log out is a door on Setup.
    expect(style).toMatch(/\.langsw a \{[^}]*min-height:44px/);
    expect(style).toMatch(/\.deeper \{[^}]*min-height:44px/);
  });

  it('no control breaks mid-word, and nothing is pushed off a 390px screen', () => {
    expect(style).toMatch(/\.langsw a \{[^}]*white-space:nowrap/);
    expect(style).not.toContain('header.top');   // V1 · option A: the band is gone, so nothing there can overflow
  });

  /**
   * The product had nineteen sizes, ten of them a pixel apart. The old form of
   * this test carried its own copy of the scale — `const SCALE = [12,13,14,15,
   * 17,19,22,26]` — which is why 19px and 26px counted as "on the scale" while
   * belonging to no token. Now the scale comes from the tokens, and the check
   * is that every variable the stylesheet REFERENCES is one the token block
   * actually declares. A `var(--font-size-huge)` typo renders as nothing and is
   * invisible by eye; here it fails.
   */
  it('every var() the shell references is a variable the tokens emit', () => {
    const declared = new Set([...cssVariables().matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]));
    const referenced = new Set([...style.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(referenced.size, 'the shell should consume tokens').toBeGreaterThan(10);
    const undeclared = [...referenced].filter((r) => !declared.has(r));
    expect(undeclared, `referenced but never emitted: ${undeclared.join(', ')}`).toEqual([]);
  });

  /**
   * The same check across every renderer, because an undeclared custom property
   * is the one CSS error with no symptom: `var(--color-inkk)` resolves to
   * nothing, the rule is dropped, and the element silently inherits. Nothing
   * throws, no test fails, and it is invisible unless you happen to look at that
   * state on that page.
   */
  /**
   * A wash, a paper tint and a border are GROUNDS. Setting one as `color:`
   * paints text the colour of the thing behind it. This is not hypothetical:
   * converting the renderers to tokens sent `#d8e3db` — a pale green that was
   * TEXT on a dark panel — to `--color-jade-wash`, and `.fnext-t` rendered an
   * invisible label on `/app/business` in both light and dark. Every test still
   * passed; only a screenshot showed it.
   *
   * `--color-surface` is deliberately allowed: white on graphite is how the
   * primary button is drawn.
   */
  it('no ground colour is used as a foreground', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    const grounds = /(^|[^-])color:\s*var\(--color-(paper|paper-sunk|border|[a-z]+-wash|[a-z]+-line)\)/g;
    const offences: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(grounds)) offences.push(`${f}: ${m[0].trim()}`);
    }
    expect(offences, `invisible text: ${offences.join(' · ')}`).toEqual([]);
  });

  /**
   * COLOUR CARRIES STATE OR IT DOES NOT APPEAR. The visual form of the
   * no-invented-numbers rule: a colour that marks nothing is a metric nobody
   * computed. Enforced by provenance, the way the percentage ban is — not by
   * whitelisting hex values but by naming the components that ARE states.
   * The state palette (ok / warn / waiting, their washes and lines) may be
   * referenced only from a selector containing one of these state-bearing
   * fragments. The assistant's magenta has rules of its own
   * (`palette.test.ts`).
   *
   * Adding a name here is a reviewable act. Ask first whether the thing is a
   * STATE the owner must react to; if it is decoration, it does not get in.
   */
  it('the state palette appears only on state-marking components', async () => {
    const STATE_FRAGMENTS = [
      'pill', 'tag', 'badge', 'flash', 'err', 'prob', 'need', 'knew',
      'draft', 'refused', 'takeover', 'verdict', 'banner', 'chk', 'cert',
      'cond', 'ditem', 'fconn', 'calm-mark', 'sbx-trust', '.ev', '.pr', '.mk',
      '.ok', '.bad', 'warn', 'pass', 'fail', 'met', 'danger', 'blocked',
      'chip',   // an authorised claim (.fchip) or a granted autonomy (.chip.auto)
      '.rf',    // the refusal explanation panel — a refused send IS a state
      'unsure', // 0052 — a send nobody can account for is a state, and an amber one
      'aria-invalid', // phase 9 (cross-new-03) — a field sent back is a state the owner reacts to
      'navcount', 'pc-wait', // the warmth run — customers waiting for the owner: the waiting signal
    ];
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    const offences: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = (await readFile(new URL(f, dir), 'utf8')).replace(cssVariables(), '');
      for (const m of src.matchAll(/([^{};]+)\{([^}]*)\}/g)) {
        const [, selector, body] = m as unknown as [string, string, string];
        if (!/var\(--color-(ok|warn|waiting)[a-z-]*\)/.test(body)) continue;
        if (!STATE_FRAGMENTS.some((frag) => selector.includes(frag))) {
          offences.push(`${f}: ${selector.trim().slice(0, 60)}`);
        }
      }
    }
    expect(offences, `state colour on a non-state component: ${offences.join(' · ')}`).toEqual([]);
  });

  it('no renderer references a custom property the tokens do not emit', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const declared = new Set([...cssVariables().matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]));
    const dir = new URL('../../src/api/web/', import.meta.url);
    const undeclared: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
        if (!declared.has(m[1])) undeclared.push(`${f}: --${m[1]}`);
      }
    }
    expect(undeclared, `undeclared custom propert(ies): ${undeclared.join(' · ')}`).toEqual([]);
  });

  it('the emitted type scale is exactly the token scale', () => {
    const emitted = [...cssVariables().matchAll(/--font-size-[a-z]+: (\d+)px/g)].map((m) => Number(m[1]));
    expect(emitted.sort((a, b) => a - b))
      .toEqual(Object.values(DESIGN_TOKENS.font.sizePx).slice().sort((a, b) => a - b));
  });

  it('section headings are sentence case everywhere — the eyebrow was the SaaS tell', () => {
    expect(style).toMatch(/\.card h2, \.block h2, main h2 \{[^}]*text-transform:none/);
    expect(style).not.toContain('text-transform:uppercase');
  });

  it('on a phone the four destinations are one row of equal targets', () => {
    const phone = style.slice(style.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/nav\.side a\.navlink, nav\.side a\.navlink\.sub \{[^}]*flex:1 1 0/);
    expect(phone).toMatch(/nav\.side a\.navlink, nav\.side a\.navlink\.sub \{[^}]*min-height:56px/);
    // never three ragged rows: the ROW does not wrap. (V1 step three lets the
    // words INSIDE one entry wrap, so "Setup 2/5" can break under its word.)
    expect(phone).not.toMatch(/nav\.side \{[^}]*flex-wrap/);
  });

  it('keyboard focus is visible on every interactive element, app-wide', () => {
    expect(style).toContain('a:focus-visible');
    expect(style).toContain('button:focus-visible');
    // the colour comes from the token, not from a hex typed into this test
    expect(style).toContain('outline:2px solid var(--color-ink)');
  });
});

describe('Phase F · one “go deeper” affordance for the whole product', () => {
  it('renders one shape, with a chevron that mirrors in RTL', () => {
    expect(deeper('/app/products', 'See your products'))
      .toBe('<a class="deeper" href="/app/products">See your products<span class="go" aria-hidden="true">›</span></a>');
    const style = linkedCss(page());
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
    const style = linkedCss(page());
    // the grid mirrors itself; re-flipping it is what broke Arabic desktop
    expect(style).not.toMatch(/\[dir="rtl"\]\s*\.layout/);
    expect(style).not.toMatch(/\[dir="rtl"\]\s*nav\.side/);
    for (const physical of ['margin-left', 'margin-right', 'padding-left', 'padding-right',
                            'border-left', 'border-right', 'text-align:left', 'text-align:right'])
      expect(style.includes(physical), physical).toBe(false);
  });

  it('every locale renders the whole shell without leaking another locale’s words', () => {
    for (const l of LOCALES) expect(page(l).length).toBeGreaterThan(1000);
    expect(page('ar')).not.toContain('My business');
    expect(page('zh')).not.toContain('My business');
  });
});

describe('Phase F · every surface draws from the same tokens', () => {
  /**
   * Stronger than the rule it replaces. This used to check that any literal
   * `font-size: NNpx` a renderer wrote appeared in a list kept in this file —
   * so a renderer could type its own size forever, provided the number was
   * blessed. A size is not allowed to be literal at all now: it comes from
   * `--font-size-*` or it is a bug. Same for colour, which had no rule here and
   * is how the whole surface drifted to blue-grey.
   */
  it('no renderer writes a literal font size or colour — tokens or nothing', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    const offences: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      // layout.ts embeds the generated token block; everything else is authored
      const authored = f === 'layout.ts' ? src.replace(cssVariables(), '') : src;
      for (const m of authored.matchAll(/font-size:\s*(\d+)px/g)) offences.push(`${f}: ${m[0]}`);
      for (const m of authored.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) offences.push(`${f}: ${m[0]}`);
    }
    expect(offences, `literal design values: ${offences.join(' · ')}`).toEqual([]);
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
    const style = linkedCss(page());
    expect(style).toMatch(/\.back \{[^}]*min-height:44px/);
  });
});
