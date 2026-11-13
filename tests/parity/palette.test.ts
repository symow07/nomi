import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';

/**
 * THE PALETTE (the design pass, decided 2026-09-29; the plan's §6; the warmth
 * pass and the identity system, 2026-10-04).
 *
 * Five warm neutrals — ink, stone, rule, paper, a warm white — one warm tone,
 * ONE magenta family in three shades, and the three states. The BRAND magenta
 * is Nomi's signature: the primary fill, doors, underlines, focus, selection,
 * the chosen tab, today, the mark. The DEEP magenta (`needs`) says something
 * waits for the owner: a text colour with the needs dot, and the fill of the
 * one act that answers it (`.btn.send.needs`) and of the rail's count. The
 * LIGHT magenta (`assistant`) says Nomi did this: words on its wash beside
 * what it wrote, never a fill, a border, a link, a button or the mark.
 * Retired: the single magenta that did both jobs, the cool neutrals, jade,
 * highlight, the old warm papers, the dark palette. Each is held here, so none
 * can come back by accident.
 */

const C = DESIGN_TOKENS.color as Readonly<Record<string, string>>;
const WEB = new URL('../../src/api/web/', import.meta.url);
const SRC = new URL('../../src/', import.meta.url);
const SRC_PATH = SRC.pathname;

const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

async function sources(dir: URL): Promise<{ f: string; src: string }[]> {
  const out: { f: string; src: string }[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await sources(new URL(`${e.name}/`, dir)));
    else if (e.name.endsWith('.ts')) out.push({ f: e.name, src: await readFile(new URL(e.name, dir), 'utf8') });
  }
  return out;
}

describe('the palette', () => {
  // THE UI CORRECTION (the owner, 2026-11-13; audit F02) supersedes the warm paper: the neutrals are neutral, the surface is
  // white, and one key joined them (`controlLine`, a field's edge). The magentas, the seal's colours and the ink are unchanged.
  it('is the neutrals and one quiet recess, a control line, the magentas and the three states — nothing else', () => {
    expect(Object.keys(C).sort()).toEqual([
      // The warmth run (2026-10-03): the wash under the assistant's own words.
      // The warmth pass (2026-10-04): waiting is the deep magenta, `needs`, with its own wash.
      'assistant', 'assistantWash', 'border', 'ink', 'inkSecondary', 'paper', 'surface',
      'needs', 'needsWash', 'ok', 'okLine', 'okWash', 'warn', 'warnLine', 'warnWash',
      // …and the ONE warm supporting tone the owner allowed, for quiet surfaces (warmth-pass.test.ts).
      'sand',
      // The identity system (2026-10-04): the signature, between the two meaning shades.
      'brand',
      // The advisor's orb (2026-10-07): its glow, decorative and the orb's alone — the fourth magenta.
      'orbGlow',
      // The seal (2026-10-31): the coin in the mark, decorative and the mark's alone — the fifth, and the last.
      'coin',
      // The favicon (2026-11-04): the cream disc behind that coin, so it reads on a dark tab bar. Not a magenta.
      'coinGround',
      // The UI correction (2026-11-13): a field's or a quiet button's edge, 3:1 or better on white (a separator need not be).
      'controlLine',
    ].sort());
    expect(C['ink']).toBe('#171717');
    expect(C['inkSecondary']).toBe('#5E5E5A');
    expect(C['border']).toBe('#E4E4E1');
    expect(C['paper']).toBe('#FAFAF9');
    expect(C['surface']).toBe('#FFFFFF');
    expect(C['sand']).toBe('#F1F1EF');
    expect(C['controlLine']).toBe('#8A8A86');
    expect(C['needs']).toBe('#9A0F5E');
    expect(C['assistant']).toBe('#171717');
    expect(C['brand']).toBe('#9A0F5E');
    expect(C['orbGlow']).toBe('#9A0F5E');
    expect(C['coin']).toBe('#5A0A2E');
    expect(C['coinGround']).toBe('#F5F1EA');
    // three shades with three jobs: never one value again
    expect(new Set([C['needs'], C['brand'], C['assistant']]).size).toBe(2);
    expect(C['needsWash']).toBe(C['assistantWash']);
  });

  it('has one scheme: no dark palette, no media query for one', () => {
    expect(Object.keys(DESIGN_TOKENS)).not.toContain('colorDark');
    expect(cssVariables()).not.toContain('prefers-color-scheme');
    expect(cssVariables()).toContain('color-scheme: light;');
  });

  it('keeps all three magentas on the raspberry side of true magenta — never violet, never red', () => {
    for (const k of ['needs']) {
      const h = hue(C[k]!);
      expect(h, k).toBeGreaterThan(325);
      expect(h, k).toBeLessThan(350);
      expect(Math.abs(hue(C['warn']!) - h), k).toBeGreaterThan(20);  // Failed sits near 4°
    }
  });

  it('five magentas is the ceiling: brand, needs, assistant, the orb\'s glow and the mark\'s coin — a sixth fails here', () => {
    // A magenta: a hue from violet-magenta to raspberry, dark enough to be a colour rather than a wash.
    const light = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return (Math.max(...v) + Math.min(...v)) / 2; };
    const magentas = Object.keys(C).filter((k) => { const h = hue(C[k]!); return h >= 290 && h <= 355 && light(C[k]!) <= 0.6; }).sort();
    expect(magentas).toEqual(['brand', 'coin', 'needs', 'orbGlow']);
  });

  it('the coin is the mark, and the count and dot that say someone waits: no other rule of the stylesheet, and no role', async () => {
    // The seal (2026-10-31): the wine of the coin in the seal's "o". The mark draws it through its variable (the favicon, a
    // document of its own, reads the token). The owner, 2026-11-04: the rail's count and a waiting row's dot wear it too.
    const naming = (await sources(SRC)).filter(({ src }) => /\bcoin(?:Ground)?:|--color-coin|color\.coin|5A0A2E|F5F1EA/i.test(src)).map(({ f }) => f);
    expect(naming.sort()).toEqual(['brand.ts', 'layout.ts', 'tokens.ts']);
    expect(Object.values(DESIGN_TOKENS.colorRole)).not.toContain('coin');
    expect(Object.values(DESIGN_TOKENS.colorRole)).not.toContain('coinGround');
    expect(cssVariables().match(/--color-coin:/g)).toHaveLength(1);
    const layout = readFileSync(join(SRC_PATH, 'api/web/layout.ts'), 'utf8');
    const wearing = [...layout.matchAll(/^\s*([^{}\n]+?) \{[^}]*--color-coin[^}]*\}/gm)].map((m) => m[1]!.trim());
    expect(wearing.sort()).toEqual(['.row-dot', 'nav.side .navcount']);
  });

  it('the orb\'s glow is decorative and the advisor\'s alone: named by the orb, drawn by one rule (the nav mark\'s light), never a role', async () => {
    // Its value, its token and its variable, anywhere in the product: where it is defined, the one form that names it,
    // and nothing else: the nav mark's light (2026-10-09) was removed by the owner on 2026-10-11.
    const naming = (await sources(SRC)).filter(({ src }) => /orbGlow|--color-orb-glow|'orb-glow'|A1127A/i.test(src)).map(({ f }) => f).sort();
    expect(naming).toEqual(['tokens.ts']);
    const advisor = readFileSync(join(SRC_PATH, 'api/web/advisor.ts'), 'utf8');
    expect(advisor).not.toContain('orb-glow');                         // the orb's glow, and nothing else on the page
    expect(advisor).not.toContain('<canvas');
    expect(Object.values(DESIGN_TOKENS.colorRole)).not.toContain('orbGlow');
    // declared once, and no stylesheet rule paints with it: the orb's script reads it, nothing else
    expect(cssVariables().match(/--color-orb-glow/g)).toHaveLength(1);
    const layout = readFileSync(join(SRC_PATH, 'api/web/layout.ts'), 'utf8');
    expect(layout).not.toMatch(/--color-orb-glow/);
  });

  it('the historical orb uses the one accent; the supplied seal keeps its separate artwork colour', () => {
    expect(C['orbGlow']).toBe(C['needs']);
    expect(C['coin']).toBe('#5A0A2E');
    expect(C['warn']).toBe(C['ink']);
  });

  it('the retired colours appear nowhere in the product', async () => {
    // The warmth pass retired the single magenta (#A82860, its washes and line) and the cool neutrals.
    const RETIRED = /#(?:FBFAF7|F0EDE7|F6F5F2|7F6400|0A5A2C|EDF4EF|C6DCCE|8A6D00|A82860|FBEEF3|EBC3D3|1C1B1F|5E5A66|E2E0E6|F5F4F6)\b|--color-(?:jade|highlight|paper-sunk|surface-alt|waiting)\b|--shadow-(?:card|raised)\b/i;
    const found = (await sources(SRC)).filter(({ src }) => RETIRED.test(src)).map(({ f, src }) => `${f}: ${RETIRED.exec(src)![0]}`);
    expect(found).toEqual([]);
  });

  it('the light magenta is only ever a TEXT colour, and never on a link, a button or a heading', async () => {
    const wrong: string[] = [];
    let uses = 0;
    for (const { f, src } of await sources(WEB)) {
      // A comment is not a selector: the scan reads the rules with the comments taken out.
      for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}<>`;]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = m as unknown as [string, string, string];
        for (const d of body.matchAll(/([a-z-]+)\s*:\s*[^;]*var\(--color-assistant\)/g)) {
          uses++;
          if (d[1] !== 'color') wrong.push(`${f}: ${selector.trim()} { ${d[1]} }`);
          for (const sel of selector.split(',').map((s) => s.trim())) {
            const last = sel.split(/\s+/).pop() ?? '';
            if (/^(a|button|h[1-6])\b|\.btn\b/.test(last)) wrong.push(`${f}: ${sel} is a link, a button or a heading`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(uses, 'the assistant\'s mark is drawn somewhere').toBeGreaterThan(0);
  });

  // The warmth pass — the deep magenta is a text colour, and a FILL in exactly three places: the act that
  // answers what waits (`.btn.send.needs`) and the rail's dot when a customer newly waits. Never a link, a
  // heading, a border or a shadow.
  it('the deep magenta is text, the fill of the act that answers what waits, and the rail\'s dot — nothing else', async () => {
    const FILLS = ['.btn.send.needs', 'nav.side a.navlink[data-fresh]::after'];
    const wrong: string[] = [];
    const filled = new Set<string>();
    for (const { f, src } of await sources(WEB)) {
      // A comment is not a selector: the scan reads the rules with the comments taken out.
      for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}<>`;]+)\{([^{}]*)\}/g)) {
        const [, selector, body] = m as unknown as [string, string, string];
        for (const d of body.matchAll(/([a-z-]+)\s*:\s*[^;]*var\(--color-needs\)/g)) {
          const sels = selector.split(',').map((s) => s.trim());
          if (d[1] === 'background') { for (const x of sels) { if (FILLS.includes(x)) filled.add(x); else wrong.push(`${f}: ${x} is filled in the deep magenta`); } continue; }
          if (d[1] !== 'color') { wrong.push(`${f}: ${selector.trim()} { ${d[1]} }`); continue; }
          for (const sel of sels) {
            const last = sel.split(/\s+/).pop() ?? '';
            if (/^(a|h[1-6])\b/.test(last)) wrong.push(`${f}: ${sel} is a link or a heading`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect([...filled].sort()).toEqual([...FILLS].sort());
  });

  // The identity system (2026-10-04) — the mark is the signature: the brand, never a meaning's shade.
  it('the mark is the brand magenta — never the deep or the light shade', async () => {
    const brand = await readFile(new URL('core/owner/brand.ts', SRC), 'utf8');
    expect(brand).not.toContain('--color-assistant');
    expect(brand).not.toContain('--color-needs');
    expect(brand).not.toContain("'var(--color-ink)'");
    expect(brand).toContain('fill="var(--color-brand)"');   // the seal: its frame and letters
  });
});
