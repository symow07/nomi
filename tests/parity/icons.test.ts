import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { shell, NEEDS_DOT } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { PHOSPHOR } from '../../src/api/web/phosphor.js';
import { SOLAR } from '../../src/api/web/solar.js';
import { railIcon } from '../../src/api/web/icons.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
// @ts-expect-error — the icon tool, plain JS on purpose (tools/ is not type-checked).
import { SOLAR_WANTED, solarDrawingOf, solarIcons, solarMeta, solarAttribution, SOLAR_LICENCE_URL } from '../../tools/icons.mjs';
import { linkedCss } from './linked-css.js';

/**
 * THE ICONS — two families, each in its place.
 *
 * THE ICONS RUN (2026-10-04): "Move the whole app to one crafted, consistent icon family … Match icon
 * stroke weight to the adjacent text weight … Remove the generic four-point 'sparkle' on the agent
 * entirely." Phosphor became that family.
 *
 * THE SOLAR NAV (2026-10-05), after two trials: "Adopt Solar Linear as the app's nav icon set, app-wide …
 * at the trial's sizing: 28px, 1.75px line, ink #25201C, airy spacing. Keep the active state as the white
 * pill with a deep-magenta icon — never a filled icon … Update the guards that currently require Phosphor
 * so they allow Solar; don't just delete them — make them assert the real icon set … Add the CC BY 4.0
 * attribution Solar requires."
 *
 * So: the rail (every nav, desktop and phone) is Solar's Linear set, copied unchanged and credited; every
 * other icon is Phosphor's, copied unchanged; nothing is an emoji, a typed character or an ornament.
 */

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const PKG = 'node_modules/@phosphor-icons/core';
const SOLAR_PKG = 'node_modules/@iconify-json/solar';
type Drawn = Readonly<Record<string, Readonly<Record<string, string>>>>;
const DRAWN = PHOSPHOR as unknown as Drawn;

const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Hana Skincare', needsYou: 3, zone: 'Asia/Shanghai' };
const LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
const ENTRIES = [['home', '/app'], ['inbox', '/app/inbox'], ['calendar', '/app/calendar'], ['employee', '/app/employee'], ['settings', '/app/settings']] as const;
const RAIL_ICON = { home: 'home-2', inbox: 'inbox', calendar: 'calendar', settings: 'settings' } as const;
/** What the rail draws for each entry: Solar's drawing, or — for the assistant — its slot in the rail's line. */
const railMarkOf = (id: string) => id === 'employee' ? agentMark(28, 'rest', 'ni', 'line') : railIcon(RAIL_ICON[id as keyof typeof RAIL_ICON]);
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
/** Solar's line on screen: 1.5 of 24 units, at the size it is drawn. */
const solarLine = (units: number, px: number) => (units / 24) * px;

describe('Phosphor (every icon but the rail\'s): copied as the package ships it, under its own licence', () => {
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

describe('Solar (the rail): copied as the package ships it, credited as CC BY 4.0 asks', () => {
  const pinned = JSON.parse(read('package.json')).devDependencies['@iconify-json/solar'] as string;

  it('the package is pinned to one version, and the drawings, the attribution and NOTICE name that version', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(read(`${SOLAR_PKG}/package.json`)).version).toBe(pinned);
    expect(read('src/api/web/solar.ts')).toContain(`@iconify-json/solar ${pinned}: Solar by 480 Design`);
    expect(read('assets/icons/SOLAR-LICENSE.txt')).toContain(`@iconify-json/solar ${pinned}`);
    expect(read('NOTICE')).toContain(`@iconify-json/solar ${pinned}`);
  });

  it('its licence is CC BY 4.0 and its author 480 Design, by the package\'s own metadata', () => {
    const meta = solarMeta();
    expect(meta.license).toEqual({ title: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: SOLAR_LICENCE_URL });
    expect(meta.author.name).toBe('480 Design');
    expect(JSON.parse(read(`${SOLAR_PKG}/package.json`)).license).toBe('CC-BY-4.0');
  });

  it('every drawing is the Linear set\'s own, unchanged — the rail\'s six and no others', () => {
    const icons = solarIcons();
    expect(Object.keys(SOLAR).sort()).toEqual([...SOLAR_WANTED].sort());
    for (const name of SOLAR_WANTED) {
      expect(SOLAR[name as keyof typeof SOLAR], name).toBe(icons.icons[`${name}-linear`].body);
      expect(solarDrawingOf(icons, name)).toBe(SOLAR[name as keyof typeof SOLAR]);
      // the Linear shape: one group, a 1.5-unit line with round ends, never filled
      expect(SOLAR[name as keyof typeof SOLAR]).toMatch(/^<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1\.5">/);
    }
  });

  it('the attribution is where a reader of the licence looks: who made it, the licence and its address, the source, the changes', () => {
    const file = read('assets/icons/SOLAR-LICENSE.txt');
    expect(file).toBe(solarAttribution(pinned));
    for (const doc of [file, read('NOTICE')]) {
      expect(doc).toContain('Solar by 480 Design');
      expect(doc).toContain(SOLAR_LICENCE_URL);
      expect(doc).toMatch(/Changes: none to the drawings/);
    }
    const readme = read('README.md');
    expect(readme).toContain('[NOTICE](NOTICE)');
    expect(readme).toMatch(/Solar by 480 Design \(CC BY 4\.0, https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  });

  it('nothing of it is served as a font or a file, and only the rail draws it', () => {
    expect(JSON.parse(read('package.json')).dependencies['@iconify-json/solar']).toBeUndefined();
    expect(css).not.toMatch(/@font-face[^}]*solar/i);
    expect(page('home', '/app')).not.toMatch(/iconify|solar/i);
    const users = sources(SRC_DIR).filter(({ src }) => /from '\.\/solar\.js'/.test(src)).map(({ f }) => f).sort();
    expect(users).toEqual(['api/web/agentMark.ts', 'api/web/icons.ts']);
  });
});

describe('the rail, drawn in Solar\'s Linear set', () => {
  it('each entry, in every language, on every page: its one Solar drawing, the SAME at rest and where you are', () => {
    for (const l of LOCALES) {
      for (const [here, path] of ENTRIES) {
        const nav = navOf(page(here, path, l));
        for (const [id] of ENTRIES) {
          const a = new RegExp(`<a [^>]*data-nav="${id}"[^>]*>([\\s\\S]*?)</a>`).exec(nav)?.[1] ?? '';
          const svgs = a.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
          expect(svgs, `${l} ${here}: ${id}`).toHaveLength(1);
          expect(svgs[0], `${l} ${here}: ${id}`).toBe(railMarkOf(id));
          expect(svgs[0]).toMatch(/^<svg class="ni"[^>]* viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true" focusable="false">/);
        }
      }
    }
  });

  it('never a filled icon: no Phosphor drawing in the rail, and nothing in it filled but with "none"', () => {
    const phosphor = Object.values(DRAWN).flatMap((w) => Object.values(w));
    for (const [here, path] of ENTRIES) {
      const nav = navOf(page(here, path));
      const icons = (nav.match(/<svg class="ni"[\s\S]*?<\/svg>/g) ?? []).join('');
      expect(phosphor.filter((d) => icons.includes(d)), here).toEqual([]);
      expect(icons.match(/fill="(?!none")[^"]*"/g), here).toBeNull();
    }
    // a page under an entry lights the entry: the pill, not a different drawing
    expect(navOf(page('settings', '/app/settings/people'))).toMatch(/class="navlink active" data-nav="settings"/);
  });

  it('the heading "Customers" draws Solar\'s group at 20 px, centred in the 28 px column, in the same 1.75 px line', () => {
    const nav = navOf(page('home', '/app'));
    const head = /<span class="navhead" id="nav-customers">(<svg[\s\S]*?<\/svg>)/.exec(nav)?.[1] ?? '';
    expect(head).toBe(railIcon('users-group-rounded'));
    const rule = bodyOf('nav.side .navhead .ni');
    expect(rule).toContain('inline-size:20px');
    expect(rule).toContain('block-size:20px');
    expect(rule).toContain('margin-inline:var(--space-4)');   // 4 + 20 + 4 = the entries' 28
    expect(bodyOf('.navhead')).toContain('gap:var(--space-16)');   // the entries' gap: its word starts where theirs do
    expect(bodyOf('nav.side .navhead .ni > g')).toContain('stroke-width:2.1px');
    expect(solarLine(2.1, 20)).toBeCloseTo(solarLine(1.5, 28), 5);   // 1.75 px, both
    expect(bodyOf('.navhead .ni')).toBe('');
  });

  it('28 px, in the ink (the wordmark\'s near-black, #25201C), on the rail and on the phone\'s tiles', () => {
    expect(bodyOf('nav.side .ni')).toContain('inline-size:28px; block-size:28px;');
    expect(bodyOf('nav.side .ni')).toContain('color: var(--color-ink)');
    expect(DESIGN_TOKENS.color.ink).toBe('#25201C');
    expect(phoneBlock).not.toMatch(/nav\.side \.ni \{[^}]*(inline-size|block-size)/);   // the phone keeps the size
  });

  // The owner set the line: 1.75 px. The words' stems were measured on the served Noto files (15 px: 1.632 en,
  // 1.512 ar, 1.576 zh at 500; 1.905 at 600) — the line sits between the word at rest and the word you are on.
  it('the line is 1.75 px, between the stems of the words beside it at 500 and at 600', () => {
    const line = solarLine(1.5, 28);
    expect(line).toBeCloseTo(1.75, 5);
    for (const s of [1.632, 1.512, 1.576]) expect(line).toBeGreaterThan(s);
    expect(line).toBeLessThan(1.905);
    expect(bodyOf('nav.side a.navlink')).toContain('font-weight:500');
    expect(bodyOf('nav.side a.navlink.active')).toContain('font-weight:600');
  });

  it('airy: each entry 52 px tall, 16 px from its icon to its word and 8 px to the next; a phone\'s tile 64 px', () => {
    const row = bodyOf('nav.side a.navlink');
    expect(row).toContain('min-height: 52px');
    expect(row).toContain('padding-block: calc((52px - 1lh) / 2)');
    expect(row).toContain('gap: var(--space-16)');
    expect(row).toContain('margin-bottom: var(--space-8)');
    expect(phoneBlock).toMatch(/nav\.side a\.navlink, nav\.side a\.navlink\.sub \{[^}]*gap:var\(--space-8\);[^}]*min-height:64px/);
  });

  it('the icon sits level with its word\'s FIRST line, not centred on the word and its count', () => {
    expect(bodyOf('nav.side a.navlink')).toContain('align-items: flex-start');
    expect(bodyOf('nav.side .ni')).toContain('margin-block:calc((1lh - 28px) / 2)');
    // on a phone the icon is over its word, and nothing is added above it
    expect(phoneBlock).toContain('nav.side .ni { margin-block:0; }');
  });
});

describe('the active entry: the white pill and a deep-magenta icon — never filled, kept apart from "needs you"', () => {
  it('its colour is ONE variable, `--color-nav-active`, which is the palette\'s deep shade — a one-line change in tokens.ts', () => {
    expect(DESIGN_TOKENS.colorRole.navActive).toBe('needs');
    expect(cssVariables()).toContain('--color-nav-active: var(--color-needs);');
    expect(rules.filter((r) => r.sel === 'nav.side a.navlink.active .ni' && /color/.test(r.body)).map((r) => r.body)).toEqual([' color: var(--color-nav-active); ']);
    expect(cssVariables()).not.toMatch(/--color-nav-active: #/);
  });

  it('the pill: the raised white tile, its word in weight — on the rail and on the phone', () => {
    const pill = bodyOf('nav.side a.navlink.active');
    expect(pill).toContain('background: var(--color-surface)');
    expect(pill).toContain('box-shadow: var(--shadow-lift1)');
    expect(phoneBlock).toMatch(/nav\.side a\.navlink\.active \{ background: var\(--color-surface\); box-shadow: var\(--shadow-lift1\); \}/);
  });

  it('at rest the icons are ink and the words stone; the one line rule in the rail is the heading\'s', () => {
    expect(bodyOf('nav.side a.navlink')).toContain('color: var(--color-ink-secondary)');
    expect(rules.filter((r) => /nav\.side[^,]*\.ni/.test(r.sel) && /stroke/.test(r.body)).map((r) => r.sel)).toEqual(['nav.side .navhead .ni > g']);
  });

  it('the needs dot never sits on the icon of the entry you are on, and sits on the corner of the 28 px icon elsewhere', () => {
    expect(bodyOf('nav.side a.navlink.active[data-fresh]::after')).toContain('content:none');
    expect(rules.filter((r) => /\.ni/.test(r.sel) && r.body.includes(NEEDS_DOT))).toEqual([]);
    const fresh = bodyOf('nav.side a.navlink[data-fresh]::after');
    expect(fresh).toContain('inset-inline-start:calc(var(--space-24) + 20px)');   // the Inbox's icon: 24 to 52, the dot on 44 to 52
    expect(fresh).toContain('inset-inline-start:calc(50% - 18px)');               // a phone's tile: the icon from 50% − 14
    // on a phone the count rides the icon's corner: cut out by the tile's white, so it is a count, not part of the shape
    expect(phoneBlock).toMatch(/nav\.side \.navcount \{[^}]*box-shadow:0 0 0 2px var\(--color-surface\);/);
  });

  it('a hover lifts the icon, a press sets it down, and the icon of the page you arrive on settles into place — only for a reader who did not ask for less', () => {
    const calm = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}\n {2}@media \(prefers-reduced-motion: reduce\)/.exec(css)?.[1] ?? '';
    expect(calm).toContain('nav.side a.navlink:hover .ni { transform:translateY(calc(-1 * var(--travel-nudge))); }');
    expect(calm).toContain('nav.side a.navlink:active .ni { transform:none; }');
    expect(calm).toContain('nav.side a.navlink.active .ni { animation:nomi-settle var(--motion-normal) var(--motion-ease); }');
    expect(css).toContain('@keyframes nomi-settle { from { opacity:0.5; transform:translateY(calc(-1 * var(--travel-nudge))); } }');
    expect(calm).not.toMatch(/\[dir="rtl"\] nav\.side[^{]*\.ni/);
  });
});

describe('the assistant\'s slot: no sparkle, a neutral placeholder, one function', () => {
  const STAR_LINE = '<path d="M11 3.5c.7 4.6 2.9 6.8 7.5 7.5';   // the old two-star sparkle (icons.ts)
  const STAR_FILLED = "M8 1.2C8.6 5.5 10.5 7.4 14.8 8";          // the four-point star (marks.ts)

  it('the rail draws the assistant through `agentMark`, in the rail\'s line: Solar\'s user-circle, the same at rest and when you are there', () => {
    for (const l of LOCALES) {
      const away = new RegExp('<a [^>]*data-nav="employee"[^>]*>([\\s\\S]*?)</a>').exec(navOf(page('home', '/app', l)))?.[1] ?? '';
      const here = new RegExp('<a [^>]*data-nav="employee"[^>]*>([\\s\\S]*?)</a>').exec(navOf(page('employee', '/app/employee', l)))?.[1] ?? '';
      expect(away.startsWith(agentMark(28, 'rest', 'ni', 'line')), l).toBe(true);
      expect(here.startsWith(agentMark(28, 'rest', 'ni', 'line')), l).toBe(true);
    }
    expect(agentMark(28, 'rest', 'ni', 'line')).toContain(SOLAR['user-circle']);
    expect(agentMark(28, 'here', 'ni', 'line')).toBe(agentMark(28, 'rest', 'ni', 'line'));   // never filled
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

  it('the slot is a fixed box: the same size at rest and when filled, in either family, whatever is drawn inside', () => {
    for (const size of [16, 24, 28, 40]) {
      for (const s of ['rest', 'here'] as const) {
        for (const m of [agentMark(size, s), agentMark(size, s, 'ni', 'line')]) {
          expect(m).toContain(`width="${size}" height="${size}"`);
          expect(m).toContain('data-mark="agent"');
          expect(m).toMatch(/aria-hidden="true"/);
        }
      }
    }
    expect(pathOf(agentMark(24, 'rest'))).toBe(DRAWN['user-circle']!['regular']);
    expect(pathOf(agentMark(24, 'here'))).toBe(DRAWN['user-circle']!['fill']);
  });
});

/**
 * THE ICONS RUN, PART 2 — every screen. Each place's shape is drawn inline: Solar's Linear in the rail,
 * Phosphor everywhere else. The assistant is its one slot or its name tag, and nothing on a page is an
 * emoji or a character standing in for an icon.
 */
const WEB_DIR = new URL('../../src/api/web/', import.meta.url);
const SRC_DIR = new URL('../../src/', import.meta.url);
function sources(dir: URL): { f: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(new URL(`${e.name}/`, dir)).map((x) => ({ ...x, f: `${e.name}/${x.f}` }))
      : e.name.endsWith('.ts') ? [{ f: e.name, src: readFileSync(new URL(e.name, dir), 'utf8') }] : []);
}
/** The code without its comments: a comment may tell the history (a ✦, an emoji); the code may not draw it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const STAR_PATHS = ['M8 1.2C8.6 5.5', 'M11 3.5c.7 4.6'];   // the four-point star (marks.ts) and the two-star sparkle (icons.ts)
const ORNAMENT = /[✦✧✨★☆⭐]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u;

describe('two families, each in its place: Solar in the rail, Phosphor everywhere else, no emoji', () => {
  it('no renderer draws the four-point star, a sparkle, an emoji or a flag — only comments may name them', () => {
    const found: string[] = [];
    for (const { f, src } of sources(WEB_DIR)) {
      const c = code(src);
      for (const p of STAR_PATHS) if (c.includes(p)) found.push(`${f}: a star's drawing`);
      if (/shape\(\s*'assistant'/.test(c) || c.includes('s-assistant')) found.push(`${f}: the assistant's star shape`);
      const m = ORNAMENT.exec(c);
      if (m) found.push(`${f}: ${m[0]}`);
      if (/0x1F1E6|fromCodePoint/.test(c)) found.push(`${f}: an emoji built from code points`);
      // a character standing in for an icon: a mark hidden from a screen reader that is one symbol (an arrow, a
      // chevron, a cross, a tick). The timeline's • for the customer is typography, kept on purpose.
      for (const m2 of c.matchAll(/aria-hidden="true">([^<]{1,2})<\/span>/g)) {
        if (/[\p{S}\p{P}]/u.test(m2[1]!) && m2[1] !== '•') found.push(`${f}: "${m2[1]}" drawn as an icon`);
      }
    }
    expect(found).toEqual([]);
    expect(JSON.stringify(DESIGN_TOKENS.signal)).not.toContain('✦');
    expect(read('src/api/web/marks.ts')).not.toMatch(/\bassistant:\s*`/);
  });

  it('agentMark is the ONLY mark of the assistant: no other source draws it, and every place that marks the assistant calls it', async () => {
    const userCircle = [...Object.values(DRAWN['user-circle']!), SOLAR['user-circle']];
    for (const { f, src } of sources(SRC_DIR)) {
      if (f.endsWith('agentMark.ts') || f.endsWith('phosphor.ts') || f.endsWith('solar.ts')) continue;
      expect(src.includes('data-mark="agent"'), `${f} draws the agent's slot by hand`).toBe(false);
      for (const d of userCircle) expect(src.includes(d), `${f} copies the slot's drawing`).toBe(false);
    }
    const { atWork, byAssistant } = await import('../../src/api/web/layout.js');
    const { ROW_MARK } = await import('../../src/api/web/inbox.js');
    expect(atWork('Writing a reply', true)).toContain(`${agentMark(16, 'rest', 'am as')} <span>Writing a reply</span>`);
    expect(atWork('Stripe is confirming the card')).not.toContain('data-mark');
    expect(ROW_MARK.hers).toBe(agentMark(16, 'rest', 'am'));
    // where it labels words it is its name tag: the name, no mark
    expect(byAssistant('Lily')).toBe('<span class="as">Lily</span>');
    // every renderer that marks the assistant does it through the slot
    const callers = sources(WEB_DIR).filter(({ src }) => /agentMark\(/.test(code(src))).map(({ f }) => f).sort();
    expect(callers).toEqual(['calendar.ts', 'conversations.ts', 'inbox.ts', 'layout.ts', 'operations.ts', 'panes.ts', 'today.ts']);
  });

  it('the slot\'s weight follows the words beside it: bold at 18 px and under, regular above, filled where you are; the rail\'s line in the rail', () => {
    expect(pathOf(agentMark(16))).toBe(DRAWN['user-circle']!['bold']);
    expect(pathOf(agentMark(18))).toBe(DRAWN['user-circle']!['bold']);
    expect(pathOf(agentMark(24))).toBe(DRAWN['user-circle']!['regular']);
    expect(pathOf(agentMark(28, 'rest', 'am as', 'bold'))).toBe(DRAWN['user-circle']!['bold']);
    expect(pathOf(agentMark(16, 'here'))).toBe(DRAWN['user-circle']!['fill']);
    expect(agentMark(28, 'rest', 'ni', 'line')).toMatch(/viewBox="0 0 24 24" width="28" height="28" fill="none"/);
    // drawn inline, a little larger than the line's capitals, in the colour its place gives it
    expect(rules.find((r) => r.sel === '.am')?.body).toContain('inline-size:1.15em; block-size:1.15em;');
  });

  it('every icon a renderer draws is Phosphor\'s — except the rail\'s, which are Solar\'s, drawn in two places only', () => {
    const icons = read('src/api/web/icons.ts');
    expect(icons).not.toMatch(/stroke-width="1\.8"/);   // the old hand-drawn lines
    const grid24: string[] = [];
    for (const { f, src: s } of sources(WEB_DIR)) {
      if (['brand.ts'].includes(f)) continue;
      for (const m of code(s).matchAll(/<svg\b[^>]*>/g)) {
        if (/viewBox="0 0 24 24"/.test(m[0])) { grid24.push(f); continue; }
        expect(m[0], `${f}: an svg that is neither Phosphor's nor the rail's`).toMatch(/viewBox="0 0 256 256"|viewBox='0 0 256 256'|viewBox='0 0 16 16'/);
      }
    }
    // the 24-unit square is Solar's, and only the rail's icon and the slot's rail line draw on it
    expect(grid24.sort()).toEqual(['agentMark.ts', 'icons.ts']);
    // on a page: every icon in the rail is on Solar's square, and none outside it
    const html = page('home', '/app');
    const nav = navOf(html);
    expect((nav.match(/<svg class="ni"[^>]*>/g) ?? []).every((t) => t.includes('viewBox="0 0 24 24"'))).toBe(true);
    expect(html.replace(nav, '')).not.toContain('viewBox="0 0 24 24"');
    // the nameless face: Phosphor's person, bold
    expect(read('src/api/web/faces.ts')).toContain("icon('person', 'fi', 'bold')");
  });

  it('a door\'s caret, the way back, the fold and closing are Phosphor\'s, mirrored on a right-to-left page — never a character', async () => {
    const { GO, BACK, icon } = await import('../../src/api/web/icons.js');
    const { deeper, back } = await import('../../src/api/web/layout.js');
    expect(GO).toBe(`<span class="go" aria-hidden="true">${icon('go', 'gi', 'bold')}</span>`);
    expect(BACK).toBe(`<span class="go" aria-hidden="true">${icon('back', 'gi', 'bold')}</span>`);
    expect(deeper('/app', 'Today')).toBe(`<a class="deeper" href="/app">Today${GO}</a>`);
    expect(back('/app', 'Today')).toBe(`<a class="back" href="/app">${BACK}Today</a>`);
    expect(pathOf(GO)).toBe(DRAWN['caret-right']!['bold']);
    expect(pathOf(BACK)).toBe(DRAWN['caret-left']!['bold']);
    expect(rules.find((r) => r.sel === '[dir="rtl"] .go')?.body).toContain('transform:scaleX(-1)');
    // the fold's caret: the stylesheet cuts a box in the brand to the same drawing; no character
    const fold = rules.filter((r) => r.sel === 'details > summary::before').map((r) => r.body).join(';');
    expect(fold).toContain('content:""');
    expect(fold).toContain(DRAWN['caret-right']!['bold']);
    expect(css).not.toMatch(/content:\s*'[›‹⌄×✦]'/);
    // the card's close
    const shellHtml = page('home', '/app');
    expect(shellHtml).toContain(`class="sheet-x" aria-label="Close">${icon('close', 'xi', 'bold')}</button>`);
  });

  it('what a customer sent that is not words is Phosphor\'s paperclip, microphone or image — the same drawing on every device', async () => {
    const { icon } = await import('../../src/api/web/icons.js');
    const inbox = code(read('src/api/web/inbox.ts'));
    expect(inbox).toContain(`\${icon('file', 'mi', 'bold')}`);
    expect(inbox).toContain(`\${icon('voice', 'mi', 'bold')}`);
    expect(code(read('src/api/web/sandbox.ts'))).toContain(`icon('photo', 'mi', 'bold')`);
    expect(pathOf(icon('file', 'mi', 'bold'))).toBe(DRAWN['paperclip']!['bold']);
    expect(pathOf(icon('voice', 'mi', 'bold'))).toBe(DRAWN['microphone']!['bold']);
    expect(pathOf(icon('photo', 'mi', 'bold'))).toBe(DRAWN['image']!['bold']);
  });

  it('no page in any language draws an ornament, an emoji or a star — the shell, the door and the site', async () => {
    const { loginPage } = await import('../../src/api/web/layout.js');
    const { renderSite } = await import('../../src/api/web/site.js');
    for (const l of LOCALES) {
      const pages = {
        shell: page('employee', '/app/employee', l),
        door: loginPage({ locale: l, path: '/login' }),
        site: renderSite({ locale: l, path: '/', contact: 'hello@example.test', signIn: 'https://app.example.test/login', noindex: false }),
      };
      for (const [what, html] of Object.entries(pages)) {
        const visible = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
        expect(ORNAMENT.exec(visible)?.[0], `${l} ${what}`).toBeUndefined();
        for (const p of STAR_PATHS) expect(visible, `${l} ${what}`).not.toContain(p);
        expect(visible, `${l} ${what}`).not.toMatch(/aria-hidden="true">[›‹×✓○●✕]<\/span>/);
      }
    }
  });
});
