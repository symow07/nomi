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
  it('is five warm neutrals and one warm tone, three magentas and the three states — nothing else', () => {
    expect(Object.keys(C).sort()).toEqual([
      // The warmth run (2026-10-03): the wash under the assistant's own words.
      // The warmth pass (2026-10-04): waiting is the deep magenta, `needs`, with its own wash.
      'assistant', 'assistantWash', 'border', 'ink', 'inkSecondary', 'paper', 'surface',
      'needs', 'needsWash', 'ok', 'okLine', 'okWash', 'warn', 'warnLine', 'warnWash',
      // …and the ONE warm supporting tone the owner allowed, for quiet surfaces (warmth-pass.test.ts).
      'sand',
      // The identity system (2026-10-04): the signature, between the two meaning shades.
      'brand',
      // The advisor's orb (2026-10-07): its glow, decorative and the orb's alone — the fourth magenta, and the last.
      'orbGlow',
    ].sort());
    expect(C['ink']).toBe('#25201C');
    expect(C['inkSecondary']).toBe('#665D55');
    expect(C['border']).toBe('#E8E1D8');
    expect(C['paper']).toBe('#F7F3EE');
    expect(C['surface']).toBe('#FFFDFA');
    expect(C['sand']).toBe('#F1E8DC');
    expect(C['needs']).toBe('#6E0C44');
    expect(C['assistant']).toBe('#BE2D6E');
    expect(C['brand']).toBe('#9A0F5E');
    expect(C['orbGlow']).toBe('#A1127A');
    // three shades with three jobs: never one value again
    expect(new Set([C['needs'], C['brand'], C['assistant']]).size).toBe(3);
    expect(C['needsWash']).not.toBe(C['assistantWash']);
  });

  it('has one scheme: no dark palette, no media query for one', () => {
    expect(Object.keys(DESIGN_TOKENS)).not.toContain('colorDark');
    expect(cssVariables()).not.toContain('prefers-color-scheme');
    expect(cssVariables()).toContain('color-scheme: light;');
  });

  it('keeps all three magentas on the raspberry side of true magenta — never violet, never red', () => {
    for (const k of ['needs', 'brand', 'assistant']) {
      const h = hue(C[k]!);
      expect(h, k).toBeGreaterThan(325);
      expect(h, k).toBeLessThan(350);
      expect(Math.abs(hue(C['warn']!) - h), k).toBeGreaterThan(20);  // Failed sits near 4°
    }
  });

  it('four magentas is the ceiling: brand, needs, assistant and the orb\'s glow — a fifth fails here', () => {
    // A magenta: a hue from violet-magenta to raspberry, dark enough to be a colour rather than a wash.
    const light = (h: string) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return (Math.max(...v) + Math.min(...v)) / 2; };
    const magentas = Object.keys(C).filter((k) => { const h = hue(C[k]!); return h >= 290 && h <= 355 && light(C[k]!) <= 0.6; }).sort();
    expect(magentas).toEqual(['assistant', 'brand', 'needs', 'orbGlow']);
  });

  it('the orb\'s glow is decorative and the advisor orb\'s alone: named by the orb, drawn by no rule, never a role', async () => {
    // Its value, its token and its variable, anywhere in the product: only where it is defined, and the one form that names it.
    const naming = (await sources(SRC)).filter(({ src }) => /orbGlow|--color-orb-glow|'orb-glow'|A1127A/i.test(src)).map(({ f }) => f).sort();
    expect(naming).toEqual(['advisor.ts', 'tokens.ts']);
    const advisor = readFileSync(join(SRC_PATH, 'api/web/advisor.ts'), 'utf8');
    expect(advisor.match(/'orb-glow'/g)).toHaveLength(1);                         // the orb's glow, and nothing else on the page
    expect(advisor).toContain("const ORB_GLOW = 'orb-glow';");
    expect(Object.values(DESIGN_TOKENS.colorRole)).not.toContain('orbGlow');
    // no stylesheet rule paints with it: the variable is declared, and used by nothing
    expect(cssVariables().match(/--color-orb-glow/g)).toHaveLength(1);
  });

  it('the orb\'s glow is its own value, held clear of the "needs you" magenta — and needs is never the orb\'s', () => {
    const lab = (h: string): [number, number, number] => {
      const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
      const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
      const [x, y, z] = [(r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + b * 0.0722, (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883];
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    };
    const dE = (a: string, b: string) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]!));
    expect(dE(C['orbGlow']!, C['needs']!)).toBeGreaterThan(dE(C['brand']!, C['needs']!));  // further from needs than the brand is (26 vs 16.7)
    expect(dE(C['orbGlow']!, C['needs']!)).toBeGreaterThan(20);
    const advisor = readFileSync(join(SRC_PATH, 'api/web/advisor.ts'), 'utf8');
    expect(advisor).not.toMatch(/ORB_GLOW = '(?:needs|brand|assistant)'/);
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
  // answers what waits (`.btn.send.needs`), the rail's count (the identity system: the needs fill, so it
  // reads with the colour removed) and the rail's dot when a customer newly waits. Never a link, a
  // heading, a border or a shadow.
  it('the deep magenta is text, the fill of the act that answers what waits, the rail\'s count and dot — nothing else', async () => {
    const FILLS = ['.btn.send.needs', 'nav.side .navcount', 'nav.side a.navlink[data-fresh]::after'];
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
    expect(brand).toContain("'var(--color-brand)'");
  });
});
