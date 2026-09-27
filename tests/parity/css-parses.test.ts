import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { renderProof, notFoundPage, type ProofView } from '../../src/api/web/proof.js';
import { renderSite } from '../../src/api/web/site.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { sheetLinks, linkedCss } from './linked-css.js';

/**
 * M35.2 — DOES THE STYLESHEET PARSE?
 *
 * M35 shipped a buyer-facing page with NO STYLING AT ALL. `cssVariables()`
 * emits its own `:root { … }`, and it had been nested inside another `:root`.
 * That is invalid CSS: the browser discards the rule and everything after it,
 * so the page rendered as unstyled serif text on white.
 *
 * Every test was green. They asserted that the renderers REFERENCED design
 * tokens — a proxy standing in for the property that actually mattered, which
 * is whether the stylesheet the browser receives is valid. That is the tenth
 * instance of this pattern in this repo and the first in CSS.
 *
 * A screenshot caught it. This is the check that would have.
 *
 * Deliberately structural rather than a full CSS parser: no dependency, and the
 * two failures worth catching are the ones a template literal makes easy —
 * unbalanced braces, and a rule nested where nesting is not allowed.
 */

const PROOF: ProofView = {
  seller: 'Yiwu Honghua', productName: 'Canvas tote', sku: 'ZX-100',
  quantity: 20000, unit: 'pcs', unitPrice: usd(0.38), total: usd(7600),
  tier: { minQty: 10000, maxQty: 50000 }, moq: 1000, leadTimeDays: 25,
  certifications: ['BSCI'], taught: [{ label: 'Stitching', content: 'Double-stitched.' }],
  issuedAt: new Date('2026-08-12T02:00:00Z'), locale: 'en',
};

/**
 * Every stylesheet a document is drawn with, in order: its inline blocks, if
 * any, and — since the V1 close-out, where they all are — the sheets it links,
 * read through the function the route serves them with.
 */
const stylesheets = (html: string): string[] => [
  ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? ''),
  ...sheetLinks(html).map((href) => linkedCss(`<link rel="stylesheet" href="${href}">`)),
];

/**
 * Strip comments and quoted strings so a brace or a colon inside them cannot be
 * mistaken for syntax. `content: "}"` is legal CSS and must not fail this.
 */
const stripNoise = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, ' ')
     .replace(/"(?:[^"\\]|\\.)*"/g, '""')
     .replace(/'(?:[^'\\]|\\.)*'/g, "''");

/** Depth-tracking scan: balance, and what is open when a `:root` starts. */
function analyse(css: string): { balance: number; nestedRoot: boolean; negative: boolean } {
  const s = stripNoise(css);
  let depth = 0;
  let negative = false;
  let nestedRoot = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) negative = true;
    } else if (ch === ':' && s.startsWith(':root', i)) {
      // A `:root` selector is only valid at the top level, or inside an
      // at-rule such as @media. Anything else means it was nested in a rule.
      if (depth > 1) nestedRoot = true;
      if (depth === 1) {
        // Inside ONE block: legal only if that block is an at-rule.
        const before = s.slice(0, i);
        const open = before.lastIndexOf('{');
        const selector = before.slice(before.lastIndexOf('}', open) + 1, open).trim();
        if (!selector.startsWith('@')) nestedRoot = true;
      }
    }
  }
  return { balance: depth, nestedRoot, negative };
}

/** Every surface that composes cssVariables(), not just the one that broke. */
const DOCUMENTS: readonly (readonly [string, string])[] = [
  ['the owner shell', shell({ title: 'x', active: 'home', bodyHtml: '<p>x</p>', locale: 'en', path: '/app', avatar: '👩‍💼' })],
  ['the shell, RTL', shell({ title: 'x', active: 'home', bodyHtml: '<p>x</p>', locale: 'ar', path: '/app', avatar: '👩‍💼' })],
  ['the login page', loginPage({ locale: 'en', path: '/login' })],
  ['the login page, error', loginPage({ locale: 'zh', path: '/login', error: true })],
  ['the proof page', renderProof(PROOF)],
  ['the proof page, RTL', renderProof({ ...PROOF, locale: 'ar' })],
  ['the proof 404', notFoundPage()],
  ['the site', renderSite({ locale: 'en', path: '/site', contact: null, signIn: '/login', noindex: true })],
  ['the site, RTL', renderSite({ locale: 'ar', path: '/site', contact: null, signIn: '/login', noindex: true })],
  ['a legal page', renderPrivacy('en', null, { processor: DEFAULT_PROCESSOR, hosting: HOSTING })],
];

describe('M35.2 · every stylesheet we emit is valid CSS', () => {
  it('the token block itself is balanced and top-level', () => {
    const a = analyse(cssVariables());
    expect(a.balance, 'cssVariables() leaves a brace open').toBe(0);
    expect(a.negative, 'cssVariables() closes a brace it never opened').toBe(false);
    expect(a.nestedRoot, 'cssVariables() nests :root inside a rule').toBe(false);
  });

  it.each(DOCUMENTS)('%s: braces balance and no :root is nested', (_name, html) => {
    const sheets = stylesheets(html);
    expect(sheets.length, 'this document emits no stylesheet at all').toBeGreaterThan(0);
    // a link the route does not know would be a page drawn with nothing
    for (const css of sheets) expect(css.length, 'a linked sheet the route does not serve').toBeGreaterThan(0);
    for (const css of sheets) {
      const a = analyse(css);
      expect(a.balance, 'a rule is left open — the browser discards the rest').toBe(0);
      expect(a.negative, 'a stray } closes the stylesheet early').toBe(false);
      expect(a.nestedRoot,
        ':root nested inside a rule is invalid and voids the stylesheet').toBe(false);
    }
  });

  it.each(DOCUMENTS)('%s: emits the tokens it depends on', (_name, html) => {
    // The page must actually CONTAIN the custom properties it references — the
    // other half of the same failure, where the tokens were simply absent.
    const css = stylesheets(html).join('\n');
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
    const declared = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]!));
    const missing = [...used].filter((v) => !declared.has(v));
    expect(missing, `referenced but never declared: ${missing.join(', ')}`).toEqual([]);
  });
});

/* ── the backtick ────────────────────────────────────────────────────────── */

describe('M36.0 · no template literal is terminated by a stray backtick', () => {
  /**
   * An unescaped backtick inside a CSS comment has terminated a template
   * literal TWICE in two days — once in proof.ts, once in layout.ts. Both times
   * the habit was the same: writing prose the way it is written everywhere else
   * in this repo, where `identifiers` are quoted with backticks, inside a
   * string delimited by backticks.
   *
   * It fails loudly (the file stops parsing), so it is never shipped — but it
   * costs a confusing debugging detour every time, and the second one was only
   * noticed because a screenshot looked stale. It is mechanically detectable,
   * so it is a check now rather than vigilance.
   *
   * The rule: inside a `<style>` block emitted from a template literal, a CSS
   * comment may not contain a backtick. Nothing legitimate needs one there.
   */
  const RENDERERS = [
    'src/api/web/layout.ts', 'src/api/web/proof.ts', 'src/api/web/operations.ts',
    'src/api/web/inbox.ts', 'src/api/web/employee.ts', 'src/api/web/factory.ts',
    'src/api/web/insights.ts', 'src/api/web/analytics.ts', 'src/api/web/products.ts',
    'src/api/web/knowledge.ts', 'src/api/web/knowledge-insights.ts',
    'src/api/web/channels.ts', 'src/api/web/conversations.ts', 'src/api/web/pilot.ts',
    'src/api/web/settings.ts', 'src/api/web/sandbox.ts', 'src/api/web/refusals.ts',
    'src/api/web/onboarding.ts', 'src/api/web/priceRules.ts', 'src/api/web/factory.ts',
  ];

  /**
   * Where CSS is written in a source: a `<style>` block, or — since the V1
   * close-out, where the rules all are — a stylesheet constant (`const STYLE =
   * \`…`, `PROOF_CSS`, `SITE_CSS`…), which runs from its opening backtick to a
   * line that is only the closing one. That end is found by the line, not by
   * the next backtick, so a stray backtick in a comment cannot hide itself.
   */
  const cssRegions = (src: string): string[] => [
    ...[...src.matchAll(/<style[\s\S]*?<\/style>/g)].map((m) => m[0]),
    ...[...src.matchAll(/^(?:export )?const [A-Z_]*(?:STYLE|CSS)[A-Z_]* = `([\s\S]*?)^`;/gm)].map((m) => m[1]!),
  ];

  it('finds the stylesheet constants it is meant to search', async () => {
    const { readFile } = await import('node:fs/promises');
    const layout = await readFile(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
    expect(cssRegions(layout).length, 'STYLE, STYLE_PAGES, the door, the public document, the switch').toBeGreaterThanOrEqual(5);
    const proof = await readFile(new URL('../../src/api/web/proof.ts', import.meta.url), 'utf8');
    expect(cssRegions(proof).length).toBeGreaterThanOrEqual(1);
  });

  it.each([...new Set([...RENDERERS, 'src/api/web/site.ts'])])('%s: no backtick inside a CSS comment', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    const offenders: string[] = [];
    for (const region of cssRegions(src)) {
      for (const c of region.matchAll(/\/\*[\s\S]*?\*\//g)) {
        if (c[0].includes('`')) offenders.push(c[0].slice(0, 90).replace(/\s+/g, ' '));
      }
    }
    expect(offenders,
      `a backtick here ends the template literal:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('the check itself would catch the two that actually happened', () => {
    // Both real cases, reproduced as strings rather than trusted to memory.
    const bad = '<style>/* see `tests/parity/shell.test.ts` */ body{}</style>';
    const good = '<style>/* see tests/parity/shell.test.ts */ body{}</style>';
    const hasBacktickComment = (s: string) =>
      [...s.matchAll(/<style[\s\S]*?<\/style>/g)]
        .some((m) => [...m[0].matchAll(/\/\*[\s\S]*?\*\//g)].some((c) => c[0].includes('`')));
    expect(hasBacktickComment(bad)).toBe(true);
    expect(hasBacktickComment(good)).toBe(false);
  });
});
