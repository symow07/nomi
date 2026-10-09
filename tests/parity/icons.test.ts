import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { shell, NEEDS_DOT } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { SOLAR } from '../../src/api/web/solar.js';
import { icon, railIcon, advisorRailMark, GO, BACK, AWAY, type IconId } from '../../src/api/web/icons.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { renderSettingsHome } from '../../src/api/web/settings.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
// @ts-expect-error — the icon tool, plain JS on purpose (tools/ is not type-checked).
import { SOLAR_WANTED, LINEAR_SHAPE, solarDrawingOf, solarIcons, solarMeta, solarAttribution, SOLAR_LICENCE_URL } from '../../tools/icons.mjs';
import { linkedCss } from './linked-css.js';

/**
 * THE ICONS — ONE FAMILY.
 *
 * THE ICONS RUN (2026-10-04) made the product one icon family (Phosphor) and removed the sparkle. THE SOLAR
 * NAV (#228) moved the nav to Solar's Linear set. THE SOLAR RUN (2026-10-05), the owner: "Move EVERY
 * remaining icon in the app from Phosphor to Solar Linear … same family, same weight, same roundness as the
 * nav … the LINE WEIGHT must look visually equal to the nav's at whatever size it's drawn … where Solar has
 * no good equivalent … do NOT substitute something loosely related … hold the gaps for me … Update the
 * guards so they assert Solar everywhere and fail if a Phosphor icon reappears."
 *
 * The seven meanings Solar had no clean drawing for were held in Phosphor's until the owner chose (2026-10-05:
 * "kinds 1, sell 1, language 1, prices 1, closed 1, month 2, order 1"); with them Phosphor went.
 *
 * So: every icon is Solar's Linear drawing, copied unchanged and credited, its line drawn for its size; no
 * drawing comes from any other family, and nothing is an emoji, a typed character or an ornament.
 */

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const SOLAR_PKG = 'node_modules/@iconify-json/solar';
/**
 * EVERY MEANING AND ITS DRAWING, pinned here on purpose: a meaning that changes its drawing changes this
 * table in the same commit. The last seven are the owner's choices for the gaps (2026-10-05).
 */
const SOLAR_OF: Readonly<Record<string, keyof typeof SOLAR>> = {
  talk: 'chat-square-line', knowledge: 'notebook-minimalistic', question: 'question-circle', nope: 'forbidden-circle',
  name: 'user-id', sliders: 'tuning-2', check: 'check-circle', practice: 'play-circle', next: 'flag', history: 'history',
  business: 'shop', products: 'box', promise: 'shield-check', kind: 'case', reach: 'dialog', whatsapp: 'chat-round-line',
  meta: 'chat-square', email: 'letter', live: 'power', alerts: 'bell', terms: 'file-text', samples: 'gift',
  rate: 'transfer-horizontal', guide: 'video-frame-play-horizontal', setup: 'checklist', people: 'users-group-two-rounded',
  account: 'key', billing: 'card', data: 'folder', logout: 'logout', download: 'download-minimalistic', regular: 'repeat',
  calendar: 'calendar-minimalistic', person: 'user', file: 'paperclip', voice: 'microphone', photo: 'gallery',
  go: 'alt-arrow-right', back: 'alt-arrow-left', close: 'close', external: 'arrow-right-up', 'date-sample': 'gift',
  'date-price': 'tag', 'date-reply': 'reply', 'date-followup': 'restart', 'date-closed': 'archive', 'date-own': 'pin',
  'date-promise': 'quote',
  kinds: 'list', sell: 'hand-money', language: 'global', prices: 'banknote', closures: 'calendar-mark',
  month: 'chart-2', 'date-order': 'delivery', 'date-closure': 'calendar-mark',
};
/** The keys of icons.ts's map, read from its source. */
const keysOf = (map: 'ICON') => {
  const src = read('src/api/web/icons.ts');
  const body = src.slice(src.indexOf(`const ${map} = {`), src.indexOf('} as const', src.indexOf(`const ${map} = {`)));
  return [...code(body).matchAll(/(?:^|[\s,{])('?[a-z-]+'?):\s*'/g)].map((m) => m[1]!.replace(/'/g, '')).sort();
};

const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Hana Skincare', needsYou: 3, zone: 'Asia/Shanghai' };
const LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
// THE ADVISOR RUN (2026-10-06) — the assistant's slot left the rail for Settings' first row; the advisor holds it,
// drawn in Solar's round chat bubble (the owner's choice); since 2026-10-09 the bubble without its dots, lit from
// within by the orb's glow — the one rail icon with a light behind it (`advisorRailMark`).
const ENTRIES = [['home', '/app'], ['inbox', '/app/inbox'], ['calendar', '/app/calendar'], ['advisor', '/app/advisor'], ['settings', '/app/settings']] as const;
const RAIL_ICON = { home: 'home-2', inbox: 'inbox', calendar: 'calendar', advisor: 'chat-round', settings: 'settings' } as const;
/** What the rail draws for each entry: Solar's drawing. */
const railMarkOf = (id: string) => railIcon(RAIL_ICON[id as keyof typeof RAIL_ICON]);
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
/** A Solar icon as the product draws it: the place's class and `sl`, a 24-unit square, a line, the drawing. */
const isSolar = (svg: string) => /^<svg class="[^"]*\bsl\b[^"]*"(?: data-mark="agent")? viewBox="0 0 24 24" width="\d+" height="\d+" fill="none" aria-hidden="true" focusable="false">/.test(svg)
  && Object.values(SOLAR).some((d) => svg.includes(d));

/**
 * THE LINE FOR A SIZE — the Solar run's rule, measured side by side with the nav's 28 px icons: 1.75 px from
 * 23 px up (the nav's), 1.65 at 20 to 22, 1.6 at 18 to 19.5, 1.5 at 17 and under. The walk of every page in
 * five languages at both widths found the sizes below and no other.
 */
const lineFor = (px: number) => px >= 23 ? 1.75 : px >= 20 ? 1.65 : px >= 18 ? 1.6 : 1.5;
/** Each place an icon is drawn: its size on screen (padding taken off; 1.15em at the 13 to 15 px it sits in), and the selector that draws its line. */
const PLACES: readonly { place: string; px: number; line: string | null }[] = [
  { place: 'the nav', px: 28, line: null },
  { place: 'a menu row', px: 24, line: null },
  { place: 'the empty calendar', px: 28, line: null },
  { place: 'the nav\'s heading', px: 20, line: 'nav.side .navhead .ni.sl > *' },
  { place: 'the card\'s close', px: 20, line: '.sheet-x > .xi.sl > *' },
  { place: 'a download', px: 22, line: '.dl-get > .ni.sl > *' },
  { place: 'a date with no face', px: 22, line: '.dl-who.dl-only .kind-icon.sl > *' },
  { place: 'a small face', px: 21, line: '.face-s .face-i svg.sl > *' },
  { place: 'Today\'s heading: the assistant beside its 20 to 26 px words', px: 23, line: '.td-head .am.sl > *' },
  { place: 'a month\'s date', px: 18, line: '.mo-e .kind-icon.sl > *' },
  { place: 'a date\'s line: the assistant beside its 17 px words', px: 19.5, line: '.dl-say .am.sl > *' },
  { place: 'the smallest face', px: 18, line: '.face-xs .face-i svg.sl > *' },
  { place: 'the assistant beside words', px: 16, line: '.am.sl > *' },
  { place: 'what a customer sent', px: 16, line: '.mi.sl > *' },
  { place: 'a door\'s caret', px: 16, line: '.go > .gi.sl > *' },
  { place: 'a regular customer', px: 15, line: '.ir-reg .ni.sl > *' },
  { place: 'a date\'s badge on a face', px: 14, line: '.dl-who .kind-icon.sl > *' },
];

const WEB_DIR = new URL('../../src/api/web/', import.meta.url);
const SRC_DIR = new URL('../../src/', import.meta.url);
function sources(dir: URL): { f: string; src: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(new URL(`${e.name}/`, dir)).map((x) => ({ ...x, f: `${e.name}/${x.f}` }))
      : e.name.endsWith('.ts') ? [{ f: e.name, src: readFileSync(new URL(e.name, dir), 'utf8') }] : []);
}
/** The code without its comments: a comment may tell the history (a ✦, an emoji); the code may not draw it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

describe('Solar, the one family: copied as the package ships it, credited as CC BY 4.0 asks', () => {
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

  it('every drawing is the Linear set\'s own, unchanged — a round line, nothing filled', () => {
    const icons = solarIcons();
    expect(Object.keys(SOLAR).sort()).toEqual([...SOLAR_WANTED].sort());
    for (const name of SOLAR_WANTED as string[]) {
      const d = SOLAR[name as keyof typeof SOLAR];
      expect(d, name).toBe(icons.icons[`${name}-linear`].body);
      expect(solarDrawingOf(icons, name)).toBe(d);
      expect(d, name).toMatch(LINEAR_SHAPE);
      expect(d.match(/fill="(?!none")[^"]*"/g), name).toBeNull();
    }
  });

  it('the attribution is where a reader of the licence looks, and names every drawing the product draws', () => {
    const file = read('assets/icons/SOLAR-LICENSE.txt');
    expect(file).toBe(solarAttribution(pinned));
    for (const name of SOLAR_WANTED as string[]) expect(file, name).toContain(`${name}-linear`);
    for (const doc of [file, read('NOTICE')]) {
      expect(doc).toContain('Solar by 480 Design');
      expect(doc).toContain(SOLAR_LICENCE_URL);
      expect(doc).toMatch(/Changes: none to the drawings/);
    }
    const readme = read('README.md');
    expect(readme).toContain('[NOTICE](NOTICE)');
    expect(readme).toMatch(/Solar by 480 Design \(CC BY 4\.0, https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  });

  it('nothing of it is served as a font or a file, and one module turns a meaning into a drawing', () => {
    expect(JSON.parse(read('package.json')).dependencies['@iconify-json/solar']).toBeUndefined();
    expect(css).not.toMatch(/@font-face[^}]*solar/i);
    expect(page('home', '/app')).not.toMatch(/iconify|solar/i);
    const users = sources(SRC_DIR).filter(({ src }) => /from '\.\/solar\.js'/.test(src)).map(({ f }) => f).sort();
    expect(users).toEqual(['api/web/icons.ts']);
  });
});

describe('Phosphor is gone, and cannot come back', () => {
  it('no Phosphor drawing, module, licence file or dependency is left, and nothing names it but history', () => {
    const pkg = JSON.parse(read('package.json'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }['@phosphor-icons/core']).toBeUndefined();
    expect(read('package-lock.json')).not.toContain('@phosphor-icons');
    expect(() => read('src/api/web/phosphor.ts')).toThrow();
    expect(() => read('assets/icons/PHOSPHOR-LICENSE.txt')).toThrow();
    expect(read('NOTICE')).not.toMatch(/phosphor/i);
    expect(read('README.md')).not.toMatch(/phosphor/i);
    expect(code(read('tools/icons.mjs'))).not.toMatch(/phosphor|HELD/i);
    for (const { f, src } of sources(SRC_DIR)) {
      expect(src, f).not.toMatch(/from '\.\/phosphor\.js'|@phosphor-icons/);
      expect(code(src), f).not.toContain('viewBox="0 0 256 256"');   // Phosphor's square: no drawing is on it
    }
    expect(code(read('src/api/web/icons.ts'))).not.toMatch(/\bHELD\b|\bheld\b/);
  });

  it('every meaning draws its Solar drawing, as the table says — the gaps the owner chose included', () => {
    expect(keysOf('ICON')).toEqual(Object.keys(SOLAR_OF).sort());
    const ids = Object.keys(SOLAR_OF) as IconId[];
    expect(ids.length).toBeGreaterThanOrEqual(55);
    for (const id of ids) {
      const svg = icon(id);
      expect(isSolar(svg), id).toBe(true);
      expect(svg, id).toContain(SOLAR[SOLAR_OF[id]!]!);
    }
    // the owner's choices for the seven gaps
    for (const [id, name] of [['kinds', 'list'], ['sell', 'hand-money'], ['language', 'global'], ['prices', 'banknote'],
      ['closures', 'calendar-mark'], ['date-closure', 'calendar-mark'], ['month', 'chart-2'], ['date-order', 'delivery']] as const) {
      expect(icon(id), id).toContain(SOLAR[name]);
    }
  });

  it('one meaning, one shape: two meanings share a drawing only when they mean the same thing', () => {
    const byDrawing = new Map<string, string[]>();
    for (const [id, name] of Object.entries(SOLAR_OF)) byDrawing.set(name, [...(byDrawing.get(name) ?? []), id]);
    const shared = [...byDrawing.entries()].filter(([, ids]) => ids.length > 1).map(([n, ids]) => `${n}: ${ids.sort().join(', ')}`).sort();
    expect(shared).toEqual(['calendar-mark: closures, date-closure', 'gift: date-sample, samples']);
    // and none is the nav's: the rail's drawings mean the rail's places
    // (the advisor's empty bubble too: WhatsApp moved to the bubble with its lines for it, 2026-10-09 — no shared pair)
    for (const n of ['home-2', 'inbox', 'calendar', 'settings', 'users-group-rounded', 'chat-round']) expect(byDrawing.has(n), n).toBe(false);
  });
});

describe('the line: the nav\'s weight at every size', () => {
  it('every Solar icon\'s line is drawn at a fixed width on screen, whatever its size', () => {
    expect(bodyOf('svg.sl *')).toContain('vector-effect:non-scaling-stroke');
    expect(bodyOf('svg.sl > *')).toContain('stroke-width:1.75px');
  });

  it('each place draws the line for its size — lighter as the icon gets smaller, never a size without its line', () => {
    for (const { place, px, line } of PLACES) {
      const want = lineFor(px);
      if (line === null) { expect(want, place).toBe(1.75); continue; }
      expect(bodyOf(line), place).toContain(`stroke-width:${want}px`);
    }
    // no line rule names a place the table does not
    const named = new Set(PLACES.map((p) => p.line).filter(Boolean));
    const lineRules = rules.filter((r) => /\.sl > \*/.test(r.sel) && /stroke-width/.test(r.body)).flatMap((r) => r.sel.split(',').map((x) => x.trim()));
    expect(lineRules.filter((s) => s !== 'svg.sl > *' && !named.has(s))).toEqual([]);
  });

  it('the sizes the table says are the sizes the stylesheet draws', () => {
    expect(bodyOf('nav.side .ni')).toContain('inline-size:28px; block-size:28px;');
    expect(bodyOf('.sr-menu > .ni')).toContain('inline-size:24px; block-size:24px;');
    expect(bodyOf('.cal-empty-ic')).toContain('inline-size:28px; block-size:28px;');
    expect(bodyOf('nav.side .navhead .ni')).toContain('inline-size:20px; block-size:20px;');
    expect(bodyOf('.sheet-x > .xi')).toContain('inline-size:20px; block-size:20px;');
    expect(bodyOf('.dl-get > .ni')).toContain('inline-size:22px; block-size:22px;');
    expect(bodyOf('.dl-who.dl-only .kind-icon')).toContain('inline-size:22px; block-size:22px; padding:0;');
    expect(bodyOf('.mo-e .kind-icon')).toContain('inline-size:24px; block-size:24px; padding:3px;');   // 18 drawn
    expect(bodyOf('.dl-who .kind-icon')).toContain('inline-size:18px; block-size:18px; padding:2px;');   // 14 drawn
    expect(bodyOf('.go > .gi')).toContain('inline-size:16px; block-size:16px;');
    for (const s of ['.am', '.mi', '.ir-reg .ni']) expect(bodyOf(s), s).toContain('inline-size:1.15em; block-size:1.15em;');
    expect(bodyOf('.face-i svg')).toContain('inline-size:1.4em; block-size:1.4em;');
  });

  it('the fold\'s caret, a stylesheet mask, is the doors\' chevron with the 16 px line in its own units', () => {
    const fold = rules.filter((r) => r.sel === 'details > summary::before').map((r) => r.body).join(';');
    expect(fold).toContain('inline-size:16px; block-size:16px;');
    expect(fold).toContain(`stroke-width='${1.5 * 24 / 16}'`);
    expect(fold).toContain(SOLAR['alt-arrow-right'].replace(/"/g, "'").replace(/stroke='currentColor'/g, "stroke='black'").replace("stroke-width='1.5'", "stroke-width='2.25'"));
    expect(fold).toContain('content:""');
  });
});

describe('the colour: the ink, unless the place carries a meaning', () => {
  it('a neutral place draws its icon in the ink, the wordmark\'s near-black — not the grey of its words', () => {
    expect(DESIGN_TOKENS.color.ink).toBe('#25201C');
    for (const s of ['nav.side .ni', '.sr-menu > .ni', '.mi', '.ir-reg .ni', '.mo-e .kind-icon', '.dl-who .kind-icon', '.cal-empty-i']) {
      expect(bodyOf(s), s).toMatch(/color: ?var\(--color-ink\)/);
    }
  });

  it('a place that carries a meaning keeps it: a door in the brand, the assistant in its light shade, the current page deep', () => {
    expect(bodyOf('.go')).toContain('color:var(--color-brand)');
    expect(bodyOf('.as-tag')).toContain('color:var(--color-assistant)');
    expect(rules.filter((r) => r.sel === 'nav.side a.navlink.active .ni' && /color/.test(r.body)).map((r) => r.body)).toEqual([' color: var(--color-nav-active); ']);
  });
});

describe('the rail, in Solar\'s Linear set', () => {
  it('each entry, in every language, on every page: its one Solar drawing, the SAME at rest and where you are', () => {
    for (const l of LOCALES) {
      for (const [here, path] of ENTRIES) {
        const nav = navOf(page(here, path, l));
        for (const [id] of ENTRIES) {
          const a = new RegExp(`<a [^>]*data-nav="${id}"[^>]*>([\\s\\S]*?)</a>`).exec(nav)?.[1] ?? '';
          const svgs = a.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
          expect(svgs, `${l} ${here}: ${id}`).toHaveLength(1);
          expect(svgs[0], `${l} ${here}: ${id}`).toBe(railMarkOf(id));
          expect(isSolar(svgs[0]!), `${l} ${here}: ${id}`).toBe(true);
          expect(svgs[0]).toMatch(/ width="28" height="28" fill="none"/);
        }
      }
    }
  });

  it('never a filled icon: nothing in the rail is filled but with "none"', () => {
    for (const [here, path] of ENTRIES) {
      const nav = navOf(page(here, path));
      const icons = (nav.match(/<svg class="ni[\s\S]*?<\/svg>/g) ?? []).join('');
      expect(icons).not.toContain('viewBox="0 0 256 256"');
      expect(icons.match(/fill="(?!none")[^"]*"/g), here).toBeNull();
    }
    expect(navOf(page('settings', '/app/settings/people'))).toMatch(/class="navlink active" data-nav="settings"/);
  });

  it('the advisor\'s mark: Solar\'s empty bubble, lit from within — the ONE rail entry with a light behind it, in every language, at rest and where you are', () => {
    const lit = `<span class="ni-lit">${railIcon('chat-round')}</span>`;
    expect(advisorRailMark()).toBe(lit);
    expect(SOLAR['chat-round']).not.toMatch(/H8\.009|H12M|H16"/);                                   // no dots in it
    for (const l of LOCALES) {
      for (const [here, path] of ENTRIES) {
        const nav = navOf(page(here, path, l));
        const advisor = /<a [^>]*data-nav="advisor"[^>]*>([\s\S]*?)<\/a>/.exec(nav)?.[1] ?? '';
        expect(advisor.startsWith(lit), `${l} ${here}`).toBe(true);
        expect(nav.match(/ni-lit/g), `${l} ${here}: one light in the rail`).toHaveLength(1);
      }
    }
  });

  it('its light: the orb\'s glow, soft, still, held to the icon — never animated, gone under forced colours, the bubble staying', () => {
    const glow = bodyOf('nav.side .ni-lit::before');
    expect(glow).toContain('radial-gradient(closest-side, var(--color-orb-glow), transparent)');
    expect(glow).toContain('opacity:0.34');
    expect(glow).toContain('border-radius:var(--radius-chip)');
    expect(glow).toContain('pointer-events:none');
    // contained: a ring no wider than the 4 px step round the 28 px icon — 36 px across, where the entries above and
    // below sit 52 px and more apart; nothing that moves
    expect(glow).toContain('inset:calc(-1 * var(--space-4))');
    expect(glow).not.toMatch(/animation|transition|filter|box-shadow/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.ni-lit[^{}]*\{[^}]*(animation|transition)/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{ nav\.side \.ni-lit::before \{ display:none; \} \}/);
    // the bubble keeps the rail's place and line: the wrapper takes the icon's margins, the phone's tile resets them
    expect(bodyOf('nav.side .ni-lit')).toContain('margin-block:calc((1lh - 28px) / 2)');
    expect(bodyOf('nav.side .ni-lit > .ni')).toContain('margin-block:0');
    expect(phoneBlock).toContain('nav.side .ni-lit { margin-block:0; }');
    // and it is the only light in the rail's rules: no other entry is lit
    expect(rules.filter((r) => /nav\.side/.test(r.sel) && /orb-glow/.test(r.body)).map((r) => r.sel)).toEqual(['nav.side .ni-lit::before']);
  });

  it('the heading "Customers" draws Solar\'s group at 20 px, centred in the 28 px column', () => {
    const nav = navOf(page('home', '/app'));
    const head = /<span class="navhead" id="nav-customers">(<svg[\s\S]*?<\/svg>)/.exec(nav)?.[1] ?? '';
    expect(head).toBe(railIcon('users-group-rounded'));
    expect(bodyOf('nav.side .navhead .ni')).toContain('margin-inline:var(--space-4)');   // 4 + 20 + 4 = the entries' 28
    expect(bodyOf('.navhead')).toContain('gap:var(--space-16)');
    expect(bodyOf('.navhead .ni')).toBe('');
  });

  it('airy: each entry 52 px tall, 16 px from its icon to its word and 8 px to the next; a phone\'s tile 64 px', () => {
    const row = bodyOf('nav.side a.navlink');
    expect(row).toContain('min-height: 52px');
    expect(row).toContain('padding-block: calc((52px - 1lh) / 2)');
    expect(row).toContain('gap: var(--space-16)');
    expect(row).toContain('margin-bottom: var(--space-8)');
    expect(phoneBlock).toMatch(/nav\.side a\.navlink, nav\.side a\.navlink\.sub \{[^}]*gap:var\(--space-8\);[^}]*min-height:64px/);
  });

  it('the icon sits level with its word\'s FIRST line; on a phone, over its word', () => {
    expect(bodyOf('nav.side a.navlink')).toContain('align-items: flex-start');
    expect(bodyOf('nav.side .ni')).toContain('margin-block:calc((1lh - 28px) / 2)');
    expect(phoneBlock).toContain('nav.side .ni { margin-block:0; }');
  });

  it('the active entry: the white pill, its word in weight, its icon in the ONE variable for it — a deep line', () => {
    expect(DESIGN_TOKENS.colorRole.navActive).toBe('needs');
    expect(cssVariables()).toContain('--color-nav-active: var(--color-needs);');
    const pill = bodyOf('nav.side a.navlink.active');
    expect(pill).toContain('background: var(--color-surface)');
    expect(pill).toContain('box-shadow: var(--shadow-lift1)');
    expect(pill).toContain('font-weight:600');
    expect(phoneBlock).toMatch(/nav\.side a\.navlink\.active \{ background: var\(--color-surface\); box-shadow: var\(--shadow-lift1\); \}/);
  });

  it('the needs dot never sits on the icon of the entry you are on, and sits on the corner of the 28 px icon elsewhere', () => {
    expect(bodyOf('nav.side a.navlink.active[data-fresh]::after')).toContain('content:none');
    expect(rules.filter((r) => /\.ni/.test(r.sel) && r.body.includes(NEEDS_DOT))).toEqual([]);
    const fresh = bodyOf('nav.side a.navlink[data-fresh]::after');
    expect(fresh).toContain('inset-inline-start:calc(var(--space-24) + 20px)');
    expect(fresh).toContain('inset-inline-start:calc(50% - 18px)');
    expect(phoneBlock).toMatch(/nav\.side \.navcount \{[^}]*box-shadow:0 0 0 2px var\(--color-surface\);/);
  });

  it('a hover lifts the icon, a press sets it down, and the icon of the page you arrive on settles into place — only for a reader who did not ask for less', () => {
    const calm = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}\n {2}@media \(prefers-reduced-motion: reduce\)/.exec(css)?.[1] ?? '';
    expect(calm).toContain('nav.side a.navlink:hover .ni { transform:translateY(calc(-1 * var(--travel-nudge))); }');
    expect(calm).toContain('nav.side a.navlink:active .ni { transform:none; }');
    expect(calm).toContain('nav.side a.navlink.active .ni { animation:nomi-settle var(--motion-normal) var(--motion-ease); }');
    expect(calm).not.toMatch(/\[dir="rtl"\] nav\.side[^{]*\.ni/);
  });
});

describe('the assistant\'s slot: no sparkle, a neutral placeholder, one function', () => {
  const STAR_LINE = '<path d="M11 3.5c.7 4.6 2.9 6.8 7.5 7.5';   // the old two-star sparkle (icons.ts)
  const STAR_FILLED = "M8 1.2C8.6 5.5 10.5 7.4 14.8 8";          // the four-point star (marks.ts)

  it('drawn by `agentMark`: Solar\'s user-circle, a line, at every size — Settings\' first row and every mark beside words; never the rail (the advisor run)', () => {
    for (const l of LOCALES) {
      const row = withWorkspace(SCOPE, () => renderSettingsHome(l, null, { alone: 'x' }));
      expect(row, l).toContain(`<a class="srow sr-menu sr-two" href="/app/settings/assistant">${agentMark(24, 'ni')}<span class="sr-main"><span class="sr-label">Lily</span>`);
      for (const [here, path] of ENTRIES) expect(navOf(page(here, path, l)), `${l} ${here}`).not.toContain('data-mark="agent"');
    }
    for (const size of [16, 24, 28, 40]) {
      const m = agentMark(size, 'am as');
      expect(m).toContain(`width="${size}" height="${size}"`);
      expect(m).toContain('data-mark="agent"');
      expect(m).toContain(SOLAR['user-circle']);
      expect(isSolar(m)).toBe(true);
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

  it('agentMark is the ONLY mark of the assistant: no other source draws it, and every place that marks the assistant calls it', async () => {
    for (const { f, src } of sources(SRC_DIR)) {
      if (f.endsWith('agentMark.ts') || f.endsWith('solar.ts')) continue;
      expect(src.includes('data-mark="agent"'), `${f} draws the agent's slot by hand`).toBe(false);
      expect(code(src).includes("'user-circle'") && !f.endsWith('icons.ts'), `${f} names the slot's drawing`).toBe(false);
    }
    const { atWork, byAssistant } = await import('../../src/api/web/layout.js');
    const { ROW_MARK } = await import('../../src/api/web/inbox.js');
    expect(atWork('Writing a reply', true)).toContain(`${agentMark(16, 'am as')} <span>Writing a reply</span>`);
    expect(atWork('Stripe is confirming the card')).not.toContain('data-mark');
    expect(ROW_MARK.hers).toBe(agentMark(16, 'am'));
    expect(byAssistant('Lily')).toBe('<span class="as">Lily</span>');
    const callers = sources(WEB_DIR).filter(({ src }) => /agentMark\(/.test(code(src))).map(({ f }) => f).sort();
    expect(callers).toEqual(['calendar.ts', 'conversations.ts', 'inbox.ts', 'layout.ts', 'operations.ts', 'panes.ts', 'settings.ts', 'today.ts']);
  });
});

/**
 * Every screen. Each place's shape is a Solar drawing inlined,
 * the assistant is its one slot or its name tag, and nothing on a page is an emoji or a character
 * standing in for an icon.
 */
const STAR_PATHS = ['M8 1.2C8.6 5.5', 'M11 3.5c.7 4.6'];
const ORNAMENT = /[✦✧✨★☆⭐]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u;

describe('one family on every screen: Solar, no emoji', () => {
  it('no renderer draws the four-point star, a sparkle, an emoji or a flag — only comments may name them', () => {
    const found: string[] = [];
    for (const { f, src } of sources(WEB_DIR)) {
      const c = code(src);
      for (const p of STAR_PATHS) if (c.includes(p)) found.push(`${f}: a star's drawing`);
      if (/shape\(\s*'assistant'/.test(c) || c.includes('s-assistant')) found.push(`${f}: the assistant's star shape`);
      const m = ORNAMENT.exec(c);
      if (m) found.push(`${f}: ${m[0]}`);
      if (/0x1F1E6|fromCodePoint/.test(c)) found.push(`${f}: an emoji built from code points`);
      for (const m2 of c.matchAll(/aria-hidden="true">([^<]{1,2})<\/span>/g)) {
        if (/[\p{S}\p{P}]/u.test(m2[1]!) && m2[1] !== '•') found.push(`${f}: "${m2[1]}" drawn as an icon`);
      }
    }
    expect(found).toEqual([]);
    expect(JSON.stringify(DESIGN_TOKENS.signal)).not.toContain('✦');
    expect(read('src/api/web/marks.ts')).not.toMatch(/\bassistant:\s*`/);
  });

  it('every svg a renderer writes is Solar\'s (icons.ts) — or a mark\'s shape or the brand\'s', () => {
    const found: string[] = [];
    for (const { f, src } of sources(WEB_DIR)) {
      if (['brand.ts'].includes(f)) continue;
      for (const m of code(src).matchAll(/<svg\b[^>]*>/g)) {
        const t = m[0];
        if (f === 'icons.ts' && /viewBox="0 0 24 24"/.test(t)) continue;   // solarSvg
        if (/viewBox='0 0 16 16'|viewBox='0 0 24 24'/.test(t)) continue;   // a mark's shape (marks.ts) and the fold's mask, drawn as images
        found.push(`${f}: ${t.slice(0, 70)}`);
      }
    }
    expect(found).toEqual([]);
    expect(read('src/api/web/icons.ts')).not.toMatch(/stroke-width="1\.8"/);   // the old hand-drawn lines
  });

  it('on a page, every icon is Solar\'s', () => {
    for (const l of LOCALES) {
      const html = page('advisor', '/app/advisor', l);
      const svgs = (html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/g) ?? []).filter((s) => !/class="mark/.test(s));
      expect(svgs.length, l).toBeGreaterThan(5);
      for (const s of svgs) expect(isSolar(s), `${l}: ${s.slice(0, 80)}`).toBe(true);
    }
  });

  it('a door\'s caret, the way back, a door away and closing are Solar\'s; the pointing ones are mirrored on a right-to-left page', async () => {
    const { deeper, back } = await import('../../src/api/web/layout.js');
    expect(GO).toBe(`<span class="go" aria-hidden="true">${icon('go', 'gi')}</span>`);
    expect(BACK).toBe(`<span class="go" aria-hidden="true">${icon('back', 'gi')}</span>`);
    expect(AWAY).toBe(`<span class="go ext" aria-hidden="true">${icon('external', 'gi')}</span>`);
    expect(GO).toContain(SOLAR['alt-arrow-right']);
    expect(BACK).toContain(SOLAR['alt-arrow-left']);
    expect(AWAY).toContain(SOLAR['arrow-right-up']);
    expect(deeper('/app', 'Today')).toBe(`<a class="deeper" href="/app">Today${GO}</a>`);
    expect(back('/app', 'Today')).toBe(`<a class="back" href="/app">${BACK}Today</a>`);
    expect(rules.find((r) => r.sel === '[dir="rtl"] .go')?.body).toContain('transform:scaleX(-1)');
    expect(rules.find((r) => r.sel === '[dir="rtl"] svg.flips')?.body).toContain('transform:scaleX(-1)');
    expect(icon('logout')).toMatch(/class="ni flips sl"/);
    expect(icon('date-reply', 'kind-icon')).toMatch(/class="kind-icon flips sl"/);
    expect(css).not.toMatch(/content:\s*'[›‹⌄×✦]'/);
    expect(page('home', '/app')).toContain(`aria-label="Close">${icon('close', 'xi')}</button>`);
    expect(icon('close', 'xi')).toContain(SOLAR['close']);
  });

  it('what a customer sent that is not words, the nameless face and the regular customer are Solar\'s — the same on every device', () => {
    const inbox = code(read('src/api/web/inbox.ts'));
    expect(inbox).toContain(`\${icon('file', 'mi')}`);
    expect(inbox).toContain(`\${icon('voice', 'mi')}`);
    expect(inbox).toContain(`\${icon('regular', 'ni')}`);
    expect(code(read('src/api/web/sandbox.ts'))).toContain(`icon('photo', 'mi')`);
    expect(read('src/api/web/faces.ts')).toContain("icon('person', 'fi')");
    for (const [id, name] of [['file', 'paperclip'], ['voice', 'microphone'], ['photo', 'gallery'], ['person', 'user'], ['regular', 'repeat']] as const) {
      expect(icon(id, 'mi'), id).toContain(SOLAR[name]);
    }
  });

  it('no page in any language draws an ornament, an emoji or a star — the shell, the door and the site', async () => {
    const { loginPage } = await import('../../src/api/web/layout.js');
    const { renderSite } = await import('../../src/api/web/site.js');
    for (const l of LOCALES) {
      const pages = {
        shell: page('advisor', '/app/advisor', l),
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
