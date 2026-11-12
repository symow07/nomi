import { describe, it, expect } from 'vitest';
import { SPLIT_CSS } from '../../src/api/web/splitStyle.js';
import { SPLIT_TOKENS, DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { inkWashDataUri } from '../../src/core/owner/brand.js';

/**
 * THE SPLIT TODAY PREVIEW'S RULES, in its stylesheet (docs/DESIGN-SYSTEM.md "Do and don't"). The page itself is drawn over
 * real rows in tests/integration/split-today.test.ts.
 */
const rulesUsing = (needle: string): string[] =>
  SPLIT_CSS.split('}').filter((r) => r.includes(needle)).map((r) => r.split('{')[0]!.trim());

describe('the Split Today sheet', () => {
  it('is flat: no drop shadow anywhere, and the shell\'s own are switched off', () => {
    expect(SPLIT_CSS).not.toMatch(/box-shadow:(?!none)/);
    expect(SPLIT_CSS).toContain('--shadow-lift1:none');
  });

  // THE UI CORRECTION (the owner, 2026-11-13; audit F01/F02) supersedes this pin's look: a selection is ink on a quiet tile, not magenta.
  it('Send uses black, and where you are is ink on a quiet tile', () => {
    expect(SPLIT_CSS).toContain('.sp-btn.sp-send { color:var(--color-surface); background:var(--color-ink); border-color:var(--color-ink); }');
    expect(SPLIT_CSS).toContain('.owner-shell nav.side a.navlink.active { color:var(--color-ink); background:var(--color-sand);');
    expect(DESIGN_TOKENS.colorRole.accent).toBe('ink');
  });

  it('wine is the mark and the dot on a row that needs you, and nothing else', () => {
    // The seal keeps its own magenta ink: the accent role is ink since the UI correction, so the mark names `cue` (the brand, declared at the root).
    expect(SPLIT_CSS).toContain('.owner-shell .mark { --color-brand:var(--color-cue); }');
    expect(SPLIT_CSS).not.toContain('--color-coin');
  });

  it('has no red: overdue is ochre', () => {
    expect(rulesUsing('.sp-over')[0]).toBeDefined();
    expect(SPLIT_CSS.split('.sp-over {')[1]!.split('}')[0]).toContain('var(--color-accent)');
    expect(SPLIT_CSS).not.toMatch(/#(?:f00|ff0000|c00|d32f2f)\b|\bred\b/i);
  });

  it('a time chart never flips right to left', () => {
    expect(SPLIT_CSS).not.toMatch(/sp-trend[^{}]*\{[^}]*(?:transform|scale)/);
    expect(SPLIT_CSS).not.toMatch(/\bsp-t(?:line|area|dot)[^{}]*\{[^}]*(?:transform|scale)/);
  });

  // THE UI CORRECTION (the owner, 2026-11-13; audit F01/F02) supersedes this pin's look: no rose header wash. The wash's two tokens are neutral greys; the picture is still
  // drawn from them and never from magenta.
  it('keeps the wash neutral, and the tokens it is drawn from', () => {
    expect(SPLIT_TOKENS.color).toMatchObject({ washInk: '#5E5E5A', washHalo: '#8A8A86' });
    const doc = atob(inkWashDataUri().split('base64,')[1]!);
    expect(doc).toContain(SPLIT_TOKENS.color.washInk);
    expect(doc).toContain(SPLIT_TOKENS.color.washHalo);
    expect(doc).not.toContain(SPLIT_TOKENS.color.magenta);
  });

  it('holds the brief\'s colours exactly', () => {
    // `ochre` (a legacy name: overdue, emphasis) is the ink since the UI correction; green, wine and the one magenta are unchanged.
    expect(SPLIT_TOKENS.color).toMatchObject({ jade: '#3F6B5C', ochre: '#171717', wine: '#5A0A2E', magenta: '#9A0F5E' });
  });

  it('draws no watermark and no repeating pattern: the one picture is the wash, once', () => {
    expect(SPLIT_CSS).not.toContain('data:image');
    expect(SPLIT_CSS).not.toContain('gradient');
    expect(SPLIT_CSS).not.toMatch(/(?<!no-)repeat(?:-x|-y)?\s*;/);
  });

  it('turns into a tab bar on a phone, with Sales first', () => {
    const phone = SPLIT_CSS.split('@media (max-width: 720px)')[1]!;
    expect(phone).toContain('.split nav.side { position:fixed');
    expect(phone).toContain('.sp-panels');
    expect(SPLIT_CSS).toContain('.sp-panels { grid-template-columns:minmax(0, 1fr); }');
  });

});
