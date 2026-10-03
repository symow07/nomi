import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';

/**
 * THE PALETTE (the design pass, decided 2026-09-29; the plan's §6; the warmth
 * pass, 2026-10-04).
 *
 * Five warm neutrals — ink, stone, rule, paper, a warm white — two magentas
 * with two jobs, and the three states. The DEEP magenta (`needs`) says
 * something waits for the owner: a text colour, and the fill of the one act
 * that answers it (`.btn.send.needs`). The LIGHT magenta (`assistant`) says
 * Nomi did this: a TEXT colour beside what it wrote, never a fill, a border,
 * a link, a button or the mark; its wash is a ground. Retired: the single
 * magenta that did both jobs, the cool neutrals, jade, highlight, the old warm
 * papers, the dark palette. Each is held here, so none can come back by accident.
 */

const C = DESIGN_TOKENS.color as Readonly<Record<string, string>>;
const WEB = new URL('../../src/api/web/', import.meta.url);
const SRC = new URL('../../src/', import.meta.url);

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
  it('is five warm neutrals and one warm tone, two magentas and the three states — nothing else', () => {
    expect(Object.keys(C).sort()).toEqual([
      // The warmth run (2026-10-03): the wash under the assistant's own words.
      // The warmth pass (2026-10-04): waiting is the deep magenta, `needs`, with its own wash.
      'assistant', 'assistantWash', 'border', 'ink', 'inkSecondary', 'paper', 'surface',
      'needs', 'needsWash', 'ok', 'okLine', 'okWash', 'warn', 'warnLine', 'warnWash',
      // …and the ONE warm supporting tone the owner allowed, for quiet surfaces (warmth-pass.test.ts).
      'sand',
    ].sort());
    expect(C['ink']).toBe('#25201C');
    expect(C['inkSecondary']).toBe('#665D55');
    expect(C['border']).toBe('#E8E1D8');
    expect(C['paper']).toBe('#F7F3EE');
    expect(C['surface']).toBe('#FFFDFA');
    expect(C['sand']).toBe('#F1E8DC');
    expect(C['needs']).toBe('#6E0C44');
    expect(C['assistant']).toBe('#BE2D6E');
    // two shades with two jobs: never one value again
    expect(C['needs']).not.toBe(C['assistant']);
    expect(C['needsWash']).not.toBe(C['assistantWash']);
  });

  it('has one scheme: no dark palette, no media query for one', () => {
    expect(Object.keys(DESIGN_TOKENS)).not.toContain('colorDark');
    expect(cssVariables()).not.toContain('prefers-color-scheme');
    expect(cssVariables()).toContain('color-scheme: light;');
  });

  it('keeps both magentas on the raspberry side of true magenta — never violet, never red', () => {
    for (const k of ['needs', 'assistant']) {
      const h = hue(C[k]!);
      expect(h, k).toBeGreaterThan(325);
      expect(h, k).toBeLessThan(350);
      expect(Math.abs(hue(C['warn']!) - h), k).toBeGreaterThan(20);  // Failed sits near 4°
    }
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
      for (const m of src.matchAll(/([^{}<>`;]+)\{([^{}]*)\}/g)) {
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

  // The warmth pass — the deep magenta is a text colour, and a FILL in exactly two places: the act that
  // answers what waits (`.btn.send.needs`) and the rail's dot when a customer newly waits. Never a link,
  // a heading, a border or a shadow.
  it('the deep magenta is text, the fill of the act that answers what waits, and the rail\'s dot — nothing else', async () => {
    const FILLS = ['.btn.send.needs', 'nav.side a.navlink[data-fresh]::after'];
    const wrong: string[] = [];
    const filled = new Set<string>();
    for (const { f, src } of await sources(WEB)) {
      for (const m of src.matchAll(/([^{}<>`;]+)\{([^{}]*)\}/g)) {
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

  it('the mark is graphite — never the assistant\'s colour', async () => {
    const brand = await readFile(new URL('core/owner/brand.ts', SRC), 'utf8');
    expect(brand).not.toContain('--color-assistant');
    expect(brand).not.toContain('--color-needs');
    expect(brand).toContain("'var(--color-ink)'");
  });
});
