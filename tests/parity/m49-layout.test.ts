import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { loginPage } from '../../src/api/web/layout.js';

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

/** Every renderer's source: its stylesheets and its inline styles alike. */
const renderers = async (): Promise<readonly { readonly f: string; readonly src: string }[]> => {
  const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts'));
  return Promise.all(files.map(async (f) => ({ f, src: await readFile(new URL(f, WEB_DIR), 'utf8') })));
};

/** CSS rules in a source file, as selector list and body. */
const rules = (src: string) => [...src.matchAll(/([^{}<>`;]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selectors: m[1]!.split(',').map((x) => x.trim()).filter(Boolean), body: m[2]! }));

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
  it('every MARGIN and GAP, in every renderer and the login page, is a spacing token', async () => {
    /**
     * Margins and gaps, not every padding. Page rhythm is made of the space
     * BETWEEN things — and that is what had drifted to gaps of roughly 100px,
     * 40px and 180px on one page. The padding inside a chip or a button is
     * optical: a 10px inset on a pill is a decision about that pill, not about
     * the page, and forcing it onto an 8-point grid would move every control's
     * proportions to satisfy a rule that was never about them.
     *
     * G17 — this used to read the shell alone, and only `margin` and
     * `margin-top`-shaped names. Fifteen renderers had 93 off-scale values the
     * shell test could not see (a gap of 10 here, a margin of 14 there), and
     * `margin-inline-end` slipped past the pattern. Every one is now a token,
     * so the rule is simply: no raw pixels in the space between things.
     */
    const rogue: string[] = [];
    for (const { f, src } of await renderers()) {
      for (const [i, line] of src.split('\n').entries()) {
        const s = line.trim();
        if (s.startsWith('//') || s.startsWith('/*') || s.startsWith('*')) continue;
        for (const m of line.matchAll(/(?<![\w-])(margin(?:-[a-z]+)*|(?:row-|column-)?gap)\s*:\s*([^;"}]+)/g)) {
          for (const part of m[2]!.split(/\s+/)) {
            // var(--space-*), 0, auto, %, vh — fine. A pixel count is a new step.
            if (/^-?\d+(\.\d+)?px$/.test(part)) rogue.push(`${f}:${i + 1}  ${m[1]}: ${part}`);
          }
        }
      }
    }
    expect(rogue, `spacing that is not a token:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('and every token used is one the scale emits', async () => {
    // A `var(--space-10)` would read as a token and resolve to nothing.
    const emitted = new Set(DESIGN_TOKENS.spacingPx.map((v) => `--space-${v}`));
    const rogue: string[] = [];
    for (const { f, src } of await renderers()) {
      for (const m of src.matchAll(/var\((--space-[\w-]+)\)/g)) if (!emitted.has(m[1]!)) rogue.push(`${f}  ${m[1]}`);
    }
    expect(rogue).toEqual([]);
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

  it('NO LINK in any renderer is jade — a link is ink, and only its hover may deepen', async () => {
    // G17 — My factory's blocker links were jade: the one colour that means
    // "this sends" spent on "this opens a page". Structural, not a list of
    // selectors: any class a renderer puts on an <a> is checked where it is styled.
    const rogue: string[] = [];
    for (const { f, src } of await renderers()) {
      const onLinks = new Set([...src.matchAll(/<a\b[^>]*?class="([^"$]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)));
      for (const r of rules(src)) {
        if (!/(?<![\w-])color\s*:\s*var\(--color-jade/.test(r.body)) continue;
        for (const sel of r.selectors) {
          if (/:hover|:focus/.test(sel)) continue;          // feedback on the pointer, not a resting colour
          const last = sel.split(/\s+/).pop() ?? '';
          const isLink = /^a([.:[]|$)/.test(last) || [...last.matchAll(/\.([\w-]+)/g)].some((m) => onLinks.has(m[1]!));
          if (isLink) rogue.push(`${f}  ${sel}`);
        }
      }
    }
    expect(rogue, `a link spends the send colour:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });

  it('the SEND button keeps it — that is the one thing jade means', async () => {
    const css = await shellCss();
    expect(css).toMatch(/\.btn\.send \{[^}]*background:var\(--color-jade\)/);
  });
});

describe('M49 · shared components are declared ONCE, in the shell', () => {
  /**
   * The defect this catches, found by a screenshot after M45: three pages used
   * `.pform` and `.fld` while emitting no rule for them, so their fields
   * rendered as inline labels strung across the page. It is the same shape as
   * a renderer reaching for a token nobody emits — and equally invisible to
   * every test that reads strings rather than boxes.
   */
  const SHARED = ['.pform', '.fld', '.chkbox', '.stated-now', '.empty', '.card', '.block'];

  it('the shell defines every shared component', async () => {
    const css = await shellCss();
    for (const c of SHARED) {
      expect(css, `${c} is used across pages and must live in the shell`)
        .toMatch(new RegExp(`\\${c}[ ,{]`));
    }
  });

  it('and no page redefines one', async () => {
    const files = (await readdir(WEB_DIR)).filter((f) => f.endsWith('.ts') && f !== 'layout.ts');
    const dupes: string[] = [];
    for (const f of files) {
      const src = await readFile(new URL(f, WEB_DIR), 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // Only a rule whose selector IS the bare class. A descendant refinement
        // (`.alform .fld`) or a responsive tweak inside a media query
        // (`.conv, .card { border-radius }`) is a page adjusting a shared
        // component, not declaring a second one.
        if (line.includes('@media')) continue;
        const m = /^\s*([^{}]+?)\s*\{/.exec(line);
        if (!m) continue;
        const selectors = m[1]!.split(',').map((x) => x.trim());
        for (const c of SHARED) if (selectors.includes(c)) dupes.push(`${f}:${i + 1}  ${c}`);
      }
    }
    expect(dupes, `a second definition drifts from the first:\n  ${dupes.join('\n  ')}`).toEqual([]);
  });
});

describe('M49 · buttons and empty states', () => {
  it('a button is as wide as its word, not as wide as the input above it', async () => {
    const css = await shellCss();
    expect(css).toMatch(/form \.btn, form button:not\(\.full\) \{ align-self:start; \}/);
  });

  it('the login button too — it was the last one stretched to the field above it', () => {
    const html = loginPage({ locale: 'en', path: '/login' });
    expect(html).not.toMatch(/button \{[^}]*width:\s*100%/);
  });

  it('empty states align like the page around them', async () => {
    const css = await shellCss();
    expect(css).toMatch(/\.empty \{ text-align:start;/);
    expect(css).not.toMatch(/\.empty \{[^}]*text-align:center/);
  });

  it('and no page centres a card of its own in place of the shared one', async () => {
    /**
     * G17 — Buyers' "nothing waiting" was an `.ok-card` of its own, centred,
     * beside a left-aligned page: the exact accident the shared `.empty`
     * exists to prevent. It uses `.empty` now. What remains centred is
     * centred on purpose, and each is named here with its reason.
     */
    const CENTRED = new Map<string, string>([
      ['layout.ts  nav.side a.navlink', 'the phone tab bar: an icon over a word, in a cell'],
      ['layout.ts  .login .foot', 'the line under the centred sign-in card'],
      ['layout.ts  .login .other', 'A1 — the one link under that card: to sign-up from the door, and back'],
      // V1 step four: the rehearsal verdict's rule moved into the shell with the rest of pilot.ts.
      ['layout.ts  .verdict', 'the rehearsal verdict — a result banner, not an empty state'],
    ]);
    const rogue: string[] = [];
    for (const { f, src } of await renderers()) {
      for (const r of rules(src)) {
        if (!/text-align\s*:\s*center/.test(r.body)) continue;
        for (const sel of r.selectors) if (!CENTRED.has(`${f}  ${sel}`)) rogue.push(`${f}  ${sel}`);
      }
    }
    expect(rogue, `centred, and not on the list:\n  ${rogue.join('\n  ')}`).toEqual([]);
  });
});
