import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shell, NEEDS_DOT } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { PHOSPHOR } from '../../src/api/web/phosphor.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { linkedCss } from './linked-css.js';

/**
 * THE ICONS RUN (2026-10-04), the nav trial — the owner: "Move the whole app
 * to one crafted, consistent icon family. Trial Phosphor across the nav
 * first … Match icon stroke weight to the adjacent text weight … Size icons
 * up slightly … Remove the generic four-point 'sparkle' on the agent entirely
 * … The active item's icon is filled and in deep magenta; inactive items are
 * calm outlines … Hover and tap get a small settle."
 */

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const PKG = 'node_modules/@phosphor-icons/core';
type Drawn = Readonly<Record<string, Readonly<Record<string, string>>>>;
const DRAWN = PHOSPHOR as unknown as Drawn;

const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Hana Skincare', needsYou: 3, zone: 'Asia/Shanghai' };
const LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
const ENTRIES = [['home', '/app'], ['inbox', '/app/inbox'], ['calendar', '/app/calendar'], ['employee', '/app/employee'], ['settings', '/app/settings']] as const;
const RAIL_ICON: Readonly<Record<string, string>> = { home: 'sun', inbox: 'tray', calendar: 'calendar-blank', employee: 'user-circle', settings: 'gear-six' };
const navOf = (html: string) => html.slice(html.indexOf('<nav class="side">'), html.indexOf('</nav>'));
const page = (active: string, path: string, locale: typeof LOCALES[number] = 'en', needsYou = 3) =>
  withWorkspace({ ...SCOPE, needsYou }, () => shell({ title: 'T', active, locale, path, bodyHtml: '<p>x</p>' }));

const css = linkedCss(page('home', '/app'));
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const bodyOf = (sel: string) => rules.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');
const pathOf = (svg: string) => /<path d="([^"]+)"\/>/.exec(svg)?.[1];
/** The phone's block: the one that dissolves the rail into its row of tiles. */
const phoneBlock = (() => {
  const at = css.indexOf('nav.side .nl-body { display:contents; }');
  const from = css.lastIndexOf('@media (max-width: 720px)', at);
  return css.slice(from, css.indexOf('\n  }\n', at));
})();

describe('one family: Phosphor, copied as the package ships it, under its own licence', () => {
  it('the package is pinned to one version, and the drawings and the licence name that version', () => {
    const pinned = JSON.parse(read('package.json')).devDependencies['@phosphor-icons/core'];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);   // exact: a drawing never changes under a range
    expect(JSON.parse(read(`${PKG}/package.json`)).version).toBe(pinned);
    expect(read('src/api/web/phosphor.ts')).toContain(`@phosphor-icons/core ${pinned} (MIT`);
    expect(read('assets/icons/PHOSPHOR-LICENSE.txt')).toContain(`@phosphor-icons/core ${pinned}`);
  });

  it('the licence is the MIT notice from the package itself, word for word', () => {
    expect(JSON.parse(read(`${PKG}/package.json`)).license).toBe('MIT');
    const licence = read(`${PKG}/LICENSE`);
    expect(licence).toMatch(/^MIT License\s+Copyright \(c\) 2023 Phosphor Icons/);
    expect(read('assets/icons/PHOSPHOR-LICENSE.txt').endsWith(licence)).toBe(true);
  });

  it('every drawing is the package\'s own path, unchanged — nothing redrawn by hand', () => {
    let n = 0;
    for (const [name, weights] of Object.entries(DRAWN)) {
      for (const [weight, d] of Object.entries(weights)) {
        const file = `${PKG}/assets/${weight}/${name}${weight === 'regular' ? '' : `-${weight}`}.svg`;
        expect(/<path d="([^"]+)"\/>/.exec(read(file))?.[1], file).toBe(d);
        n += 1;
      }
    }
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it('nothing of it is served as a font or a file: the drawings are inlined, the package is only read at build time', () => {
    expect(JSON.parse(read('package.json')).dependencies['@phosphor-icons/core']).toBeUndefined();
    expect(css).not.toMatch(/@font-face[^}]*phosphor/i);
    expect(page('home', '/app')).not.toMatch(/phosphor/i);
  });
});

describe('the rail, drawn in it', () => {
  it('each entry, in every language: the outline at rest, the FILLED drawing on the page you are on', () => {
    for (const l of LOCALES) {
      for (const [here, path] of ENTRIES) {
        const nav = navOf(page(here, path, l));
        for (const [id] of ENTRIES) {
          const a = new RegExp(`<a [^>]*data-nav="${id}"[^>]*>([\\s\\S]*?)</a>`).exec(nav)?.[1] ?? '';
          const svgs = a.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
          expect(svgs, `${l} ${here}: ${id}`).toHaveLength(1);
          expect(svgs[0]).toMatch(/^<svg class="ni"[^>]* viewBox="0 0 256 256"[^>]* fill="currentColor" aria-hidden="true" focusable="false">/);
          expect(pathOf(svgs[0]!), `${l} ${here}: ${id}`).toBe(DRAWN[RAIL_ICON[id]!]![id === here ? 'fill' : 'regular']);
        }
      }
    }
  });

  it('a filled shape means "you are here": nothing else in the rail is filled', () => {
    const nav = navOf(page('calendar', '/app/calendar'));
    const fills = Object.values(DRAWN).map((w) => w['fill']).filter(Boolean);
    expect(fills.filter((d) => nav.includes(d!))).toHaveLength(1);
    expect(navOf(page('settings', '/app/settings/people'))).toContain(DRAWN['gear-six']!['fill']);   // a page under an entry lights it
  });

  it('the heading "Customers" draws its shape in bold at 16 px — the rule names the rail, so the entries\' 24 no longer outranks it', () => {
    const nav = navOf(page('home', '/app'));
    const head = /<span class="navhead" id="nav-customers">(<svg[\s\S]*?<\/svg>)/.exec(nav)?.[1] ?? '';
    expect(pathOf(head)).toBe(DRAWN['users']!['bold']);
    const rule = bodyOf('nav.side .navhead .ni');
    expect(rule).toContain('inline-size:16px');
    expect(rule).toContain('block-size:16px');
    // centred in the entries' 24 px column (4 + 16 + 4), its word where theirs start
    expect(rule).toContain('margin-inline:var(--space-4)');
    expect(bodyOf('.navhead')).toContain('gap:var(--space-12)');
    expect(bodyOf('.navhead .ni')).toBe('');   // the rule that lost to `nav.side .ni` is gone
  });

  it('sized up so the shape balances its word: 24 px in the rail and on the phone\'s tiles', () => {
    expect(bodyOf('nav.side .ni')).toContain('inline-size:24px; block-size:24px;');
  });

  // The owner: "Match icon stroke weight to the adjacent text weight." Phosphor's lines are 16 units of 256
  // (regular) and 24 (bold). The words' stems were measured on the served Noto files (15 px and 13 px at 500,
  // en / ar / zh); a size or weight changed here must be measured again, not guessed.
  it('the line of each icon matches the stem of the words beside it, within a fifth of a pixel', () => {
    const line = (units: number, px: number) => (units / 256) * px;
    const STEM_500_15 = { en: 1.632, ar: 1.512, zh: 1.576 };
    const STEM_500_13 = { en: 1.632 * 13 / 15, ar: 1.512 * 13 / 15, zh: 1.576 * 13 / 15 };
    for (const s of Object.values(STEM_500_15)) expect(Math.abs(line(16, 24) - s)).toBeLessThan(0.2);   // the entries: regular at 24
    for (const s of Object.values(STEM_500_13)) expect(Math.abs(line(24, 16) - s)).toBeLessThan(0.2);   // the heading: bold at 16
    // and the alternatives measured beside them do not
    expect(Math.abs(line(24, 24) - STEM_500_15.en)).toBeGreaterThan(0.5);   // bold at 24 reads as 700
    expect(Math.abs(line(16, 16) - STEM_500_13.en)).toBeGreaterThan(0.35);  // regular at 16 is a hairline
    expect(bodyOf('nav.side a.navlink')).toContain('font-weight:500');
    expect(bodyOf('.navhead')).toContain('font-weight:500');
  });

  it('the icon sits level with its word\'s FIRST line, not centred on the word and its count', () => {
    const row = bodyOf('nav.side a.navlink');
    expect(row).toContain('align-items: flex-start');
    expect(row).toContain('padding-block: calc((44px - 1lh) / 2)');
    expect(row).toContain('min-height: 44px');
    expect(bodyOf('nav.side .ni')).toContain('margin-block:calc((1lh - 24px) / 2)');
    // on a phone the icon is over its word, and nothing is added above it
    expect(phoneBlock).toContain('nav.side .ni { margin-block:0; }');
  });
});

describe('the active entry: filled, in the deep magenta, kept apart from "needs you" by shape', () => {
  it('its colour is ONE variable, `--color-nav-active`, which is the palette\'s deep shade — a one-line change in tokens.ts', () => {
    expect(DESIGN_TOKENS.colorRole.navActive).toBe('needs');
    expect(cssVariables()).toContain('--color-nav-active: var(--color-needs);');
    expect(rules.filter((r) => r.sel === 'nav.side a.navlink.active .ni' && /color/.test(r.body)).map((r) => r.body)).toEqual([' color: var(--color-nav-active); ']);
    // the palette itself is unchanged: a role names a shade, it never carries a value
    expect(cssVariables()).not.toMatch(/--color-nav-active: #/);
  });

  it('at rest the shapes are calm outlines in the secondary ink, and no rail icon is stroked any more', () => {
    expect(bodyOf('nav.side a.navlink')).toContain('color: var(--color-ink-secondary)');
    expect(rules.filter((r) => /nav\.side[^,]*\.ni/.test(r.sel) && /stroke/.test(r.body))).toEqual([]);
  });

  it('the needs dot never sits on the filled icon: not the fresh dot on the entry you are on, never a disc on an icon', () => {
    expect(bodyOf('nav.side a.navlink.active[data-fresh]::after')).toContain('content:none');
    expect(rules.filter((r) => /\.ni/.test(r.sel) && r.body.includes(NEEDS_DOT))).toEqual([]);
    // on a phone the count rides the icon's corner: cut out by the tile's white, so it is a count, not part of the shape
    expect(phoneBlock).toMatch(/nav\.side \.navcount \{[^}]*box-shadow:0 0 0 2px var\(--color-surface\);/);
  });

  it('a hover lifts the icon, a press sets it down, and the icon of the page you arrive on settles into place — only for a reader who did not ask for less', () => {
    const calm = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}\n {2}@media \(prefers-reduced-motion: reduce\)/.exec(css)?.[1] ?? '';
    expect(calm).toContain('nav.side a.navlink:hover .ni { transform:translateY(calc(-1 * var(--travel-nudge))); }');
    expect(calm).toContain('nav.side a.navlink:active .ni { transform:none; }');
    expect(calm).toContain('nav.side a.navlink.active .ni { animation:nomi-settle var(--motion-normal) var(--motion-ease); }');
    expect(css).toContain('@keyframes nomi-settle { from { opacity:0.5; transform:translateY(calc(-1 * var(--travel-nudge))); } }');
    // nothing about it depends on the direction of the script
    expect(calm).not.toMatch(/\[dir="rtl"\] nav\.side[^{]*\.ni/);
  });
});

describe('the assistant\'s slot: no sparkle, a neutral placeholder, one function', () => {
  const STAR_LINE = '<path d="M11 3.5c.7 4.6 2.9 6.8 7.5 7.5';   // the old two-star sparkle (icons.ts)
  const STAR_FILLED = "M8 1.2C8.6 5.5 10.5 7.4 14.8 8";          // the four-point star (marks.ts)

  it('the rail draws the assistant through `agentMark`: Phosphor\'s user-circle, outline at rest, filled when you are there', () => {
    for (const l of LOCALES) {
      const away = new RegExp('<a [^>]*data-nav="employee"[^>]*>([\\s\\S]*?)</a>').exec(navOf(page('home', '/app', l)))?.[1] ?? '';
      const here = new RegExp('<a [^>]*data-nav="employee"[^>]*>([\\s\\S]*?)</a>').exec(navOf(page('employee', '/app/employee', l)))?.[1] ?? '';
      expect(away.startsWith(agentMark(24, 'rest')), l).toBe(true);
      expect(here.startsWith(agentMark(24, 'here')), l).toBe(true);
    }
  });

  it('no sparkle, star or ornament anywhere in the rail — drawn or typed', () => {
    for (const l of LOCALES) {
      for (const [here, path] of ENTRIES) {
        const nav = navOf(page(here, path, l));
        expect(nav).not.toContain(STAR_LINE);
        expect(nav).not.toContain(STAR_FILLED);
        expect(nav).not.toContain('s-assistant');
        const words = nav.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '');
        expect(words, `${l} ${here}`).not.toMatch(/[✦✧★☆✨○●•✓✕›‹⌄]|\p{Extended_Pictographic}/u);
      }
    }
  });

  it('the slot is a fixed box: the same size at rest and when filled, whatever is drawn inside', () => {
    for (const size of [16, 24, 40]) {
      for (const s of ['rest', 'here'] as const) {
        const m = agentMark(size, s);
        expect(m).toContain(`width="${size}" height="${size}"`);
        expect(m).toContain('data-mark="agent"');
        expect(m).toMatch(/aria-hidden="true"/);
      }
    }
    expect(pathOf(agentMark(24, 'rest'))).toBe(DRAWN['user-circle']!['regular']);
    expect(pathOf(agentMark(24, 'here'))).toBe(DRAWN['user-circle']!['fill']);
  });
});
