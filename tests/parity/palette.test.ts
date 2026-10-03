import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';

/**
 * THE PALETTE (the design pass, decided 2026-09-29; the plan's §6).
 *
 * Six named values — Graphite, Stone, Rule, Paper with white, Magenta — and
 * the three states. Magenta is the assistant's hand and nothing else: a TEXT
 * colour beside what it wrote, never a fill, a wash, a border, a link, a
 * button or the mark. Retired: jade, highlight, the warm papers, the dark
 * palette. Each of those is held here, so none can come back by accident.
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
  it('is six values and the three states — nothing else', () => {
    expect(Object.keys(C).sort()).toEqual([
      // The warmth run (2026-10-03): the wash under the assistant's own words.
      'assistant', 'assistantWash', 'border', 'ink', 'inkSecondary', 'paper', 'surface',
      'ok', 'okLine', 'okWash', 'waiting', 'waitingLine', 'waitingWash', 'warn', 'warnLine', 'warnWash',
    ].sort());
    expect(C['ink']).toBe('#1C1B1F');
    expect(C['inkSecondary']).toBe('#5E5A66');
    expect(C['border']).toBe('#E2E0E6');
    expect(C['paper']).toBe('#F5F4F6');
    expect(C['surface']).toBe('#FFFFFF');
    expect(C['assistant']).toBe('#A82860');
  });

  it('has one scheme: no dark palette, no media query for one', () => {
    expect(Object.keys(DESIGN_TOKENS)).not.toContain('colorDark');
    expect(cssVariables()).not.toContain('prefers-color-scheme');
    expect(cssVariables()).toContain('color-scheme: light;');
  });

  it('keeps the magenta on the raspberry side of true magenta — never violet, never red', () => {
    const h = hue(C['assistant']!);
    expect(h).toBeGreaterThan(325);
    expect(h).toBeLessThan(350);
    expect(Math.abs(hue(C['warn']!) - h)).toBeGreaterThan(20);  // Failed sits near 4°
  });

  it('the retired colours appear nowhere in the product', async () => {
    const RETIRED = /#(?:FBFAF7|F0EDE7|F6F5F2|7F6400|0A5A2C|EDF4EF|C6DCCE|8A6D00)\b|--color-(?:jade|highlight|paper-sunk|surface-alt)\b/i;
    const found = (await sources(SRC)).filter(({ src }) => RETIRED.test(src)).map(({ f, src }) => `${f}: ${RETIRED.exec(src)![0]}`);
    expect(found).toEqual([]);
  });

  it('magenta is only ever a TEXT colour, and never on a link, a button or a heading', async () => {
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

  it('the mark is graphite — never the assistant\'s colour', async () => {
    const brand = await readFile(new URL('core/owner/brand.ts', SRC), 'utf8');
    expect(brand).not.toContain('--color-assistant');
    expect(brand).toContain("'var(--color-ink)'");
  });
});
