import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';

/**
 * M49 — the layout test, which catches what the typography tests cannot.
 *
 * The diagnosis was structural, not a matter of taste: RESTRAINT WITHOUT
 * ALIGNMENT READS AS UNFINISHED, NOT CONFIDENT. One page carried four unrelated
 * widths — rules running to one edge, prose wrapping at a second, inputs at a
 * third, `main` capped at a fourth — and section gaps of roughly 100px, 40px
 * and 180px. Every individual choice was quiet. Together they looked like a
 * page that had not been finished.
 *
 * The typography tests could not see any of it. They check sizes, colours and
 * banned words in a rendered string; none of those is wrong here. So this file
 * checks the things a stylesheet can only get right on purpose: how many
 * distinct widths exist, where the column sits, whether spacing comes from the
 * scale, and which voice each thing speaks in.
 */

const SHELL = new URL('../../src/api/web/layout.ts', import.meta.url);
const WEB_DIR = new URL('../../src/api/web/', import.meta.url);

const shellCss = async (): Promise<string> => {
  const src = await readFile(SHELL, 'utf8');
  // The stylesheet only — not the TypeScript around it.
  const start = src.indexOf('${cssVariables()}');
  const end = src.indexOf('export function shell(');
  return src.slice(start, end);
};

describe('M49 · one measure', () => {
  it('there are exactly THREE widths in the whole product, and they are tokens', () => {
    expect(Object.keys(DESIGN_TOKENS.measure).sort()).toEqual(['column', 'form', 'prose']);
    const css = cssVariables();
    expect(css).toContain('--measure-column');
    expect(css).toContain('--measure-prose');
    expect(css).toContain('--measure-form');
  });

  it('NO renderer declares a width of its own', async () => {
    // This is the rule the page was breaking. A `max-width: 44ch` here and a
    // `38ch` there is how four measures appear without anyone choosing four.
    const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts'));
    const rogue: string[] = [];
    for (const f of files) {
      const src = await readFile(new URL(f, WEB_DIR), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // A media query's breakpoint is not a content width.
        if (line.includes('@media')) continue;
        const m = /max-width\s*:\s*([^;]+);/.exec(line);
        if (!m) continue;
        const value = m[1]!.trim();
        const allowed = value.startsWith('var(--measure-')
          // A message bubble is sized against its own row, not the page.
          || /^\d+%$/.test(value)
          || value === '100%';
        if (!allowed) rogue.push(`${f}:${i + 1}  ${value}`);
      }
    }
    expect(rogue, `these declare their own width:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('the column is CENTRED beside the nav — a decision, not the accidental middle', async () => {
    const css = await shellCss();
    expect(css).toMatch(/main \{[^}]*max-width: var\(--measure-column\)/);
    expect(css).toMatch(/main \{[^}]*margin-inline: auto/);
  });
});

describe('M49 · one vertical rhythm', () => {
  it('every MARGIN in the shell comes from the scale', async () => {
    /**
     * Margins, not every padding. Page rhythm is made of the space BETWEEN
     * things — and that is what had drifted to gaps of roughly 100px, 40px and
     * 180px on one page. The padding inside a chip or a button is optical: a
     * 10px inset on a pill is a decision about that pill, not about the page,
     * and forcing it onto an 8-point grid would move every control's
     * proportions to satisfy a rule that was never about them.
     */
    const css = await shellCss();
    const scale = new Set(DESIGN_TOKENS.spacingPx.map(String));
    const rogue: string[] = [];
    for (const [i, line] of css.split('\n').entries()) {
      if (line.trim().startsWith('/*') || line.trim().startsWith('*')) continue;
      for (const m of line.matchAll(/\bmargin(-[a-z]+)?\s*:\s*([^;]+);/g)) {
        for (const part of m[2]!.split(/\s+/)) {
          const px = /^(\d+)px$/.exec(part);
          if (!px) continue;                       // var(), 0, auto, %, vh — fine
          if (!scale.has(px[1]!)) rogue.push(`line ${i + 1}: margin ${part}`);
        }
      }
    }
    expect(rogue, `off-scale margins in the shell:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('and the page-level containers are spaced from it too', async () => {
    // main, the section, the card, the notice, the page heading: the five
    // things that actually make the vertical rhythm of a surface.
    const css = await shellCss();
    for (const re of [
      /main \{ padding: var\(--space-\d+\)/,
      /\.block \{ padding:var\(--space-\d+\) 0/,
      /\.card \{[^}]*padding:var\(--space-\d+\)/,
      /\.flash \{[^}]*padding:var\(--space-\d+\)/,
      /h1\.page \{[^}]*margin: 0 0 var\(--space-\d+\)/,
    ]) expect(css, String(re)).toMatch(re);
  });

  it('the section gap is ONE value, not a per-page decision', async () => {
    const css = await shellCss();
    expect(css).toMatch(/\.block \{ padding:var\(--space-\d+\) 0;/);
  });
});

describe('M49 · the two voices are on the right axis', () => {
  /**
   * Serif is what a PERSON says: her drafts, a buyer's words, an answer she
   * wrote herself. Everything the PRODUCT says is sans — including headings
   * about her, which is where it had drifted: "No buyer can reach Lily yet",
   * "Lily is learning from your corrections", "Before she talks to real
   * buyers". Inconsistent serif and sans was the loudest unpolished signal on
   * these pages, and the rule drifted immediately last time because it was
   * applied by hand. So it is pinned here.
   */
  const ALLOWED = new Map<string, string>([
    ['layout.ts', 'declares .voice, .bubble and .proposed — the components speech is made of'],
    ['inbox.ts', 'the buyer\'s own latest message, and the bubble classes'],
    ['proof.ts', 'a fact the OWNER wrote, quoted to the buyer'],
  ]);

  it('only speech components use the serif', async () => {
    const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts'));
    const rogue: string[] = [];
    for (const f of files) {
      const src = await readFile(new URL(f, WEB_DIR), 'utf8');
      const uses = src.includes('font-voice') || /class="[^"]*\bvoice\b/.test(src);
      if (uses && !ALLOWED.has(f)) rogue.push(f);
    }
    expect(rogue, `serif reached a product surface:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('and no PRODUCT heading is set in it', async () => {
    const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts'));
    const rogue: string[] = [];
    for (const f of files) {
      const src = await readFile(new URL(f, WEB_DIR), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (/<h[123][^>]*class="[^"]*\bvoice\b/.test(line)) rogue.push(`${f}:${i + 1}`);
      }
    }
    expect(rogue, `a heading in the speech serif:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });
});

describe('M49 · colour once or twice per screen', () => {
  it('jade is spent on SENDING and on STATE — not on chrome', async () => {
    const css = await shellCss();
    // The nav's active item reads by weight and a recess.
    expect(css).toMatch(/nav\.side a\.navlink\.active \{[^}]*background: var\(--color-paper-sunk\)/);
    expect(css).not.toMatch(/nav\.side a\.navlink\.active \{[^}]*var\(--color-jade[-)]/);
    // The language switcher is chrome, not a state worth a saturated fill.
    expect(css).not.toMatch(/\.langsw a\.on \{[^}]*background:var\(--color-jade\)/);
    // Ordinary links are ink; the chevron carries the affordance.
    expect(css).toMatch(/\.deeper \{[^}]*color:var\(--color-ink\)/);
    expect(css).toMatch(/\.back \{[^}]*color:var\(--color-ink\)/);
  });

  it('the SEND button keeps it — that is the one thing jade means', async () => {
    const css = await shellCss();
    expect(css).toMatch(/\.btn\.send \{[^}]*background:var\(--color-jade\)/);
  });
});

describe('M49 · buttons and empty states', () => {
  it('a button is as wide as its word, not as wide as the input above it', async () => {
    const css = await shellCss();
    expect(css).toMatch(/form \.btn, form button:not\(\.full\) \{ align-self:start; \}/);
  });

  it('empty states align like the page around them', async () => {
    const css = await shellCss();
    expect(css).toMatch(/\.empty \{ text-align:start;/);
    expect(css).not.toMatch(/\.empty \{[^}]*text-align:center/);
  });
});
