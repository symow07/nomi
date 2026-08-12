import { describe, it, expect } from 'vitest';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { renderProof, notFoundPage, type ProofView } from '../../src/api/web/proof.js';

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
  quantity: 20000, unit: 'pcs', unitPriceUsd: 0.38, totalUsd: 7600,
  tier: { minQty: 10000, maxQty: 50000 }, moq: 1000, leadTimeDays: 25,
  certifications: ['BSCI'], taught: [{ label: 'Stitching', content: 'Double-stitched.' }],
  issuedAt: new Date('2026-08-12T02:00:00Z'), locale: 'en',
};

/** Every <style> block in a document, in order. */
const stylesheets = (html: string): string[] =>
  [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');

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
