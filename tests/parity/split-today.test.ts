import { describe, it, expect } from 'vitest';
import { SPLIT_CSS } from '../../src/api/web/splitStyle.js';
import { SPLIT_TOKENS } from '../../src/core/owner/tokens.js';
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

  it('magenta is Send and nothing else', () => {
    const uses = rulesUsing(SPLIT_TOKENS.color.magenta);
    expect(uses.length).toBeGreaterThan(0);
    for (const selector of uses) expect(selector).toMatch(/\.sp-send/);
  });

  it('wine is the mark and the dot on a row that needs you, and nothing else', () => {
    expect(rulesUsing(SPLIT_TOKENS.color.wine)).toEqual(['.split .mark', '.split .si-dot .row-dot']);
    expect(SPLIT_CSS).not.toContain('--color-coin');
  });

  it('has no red: overdue is ochre', () => {
    expect(rulesUsing('.sp-over')[0]).toBeDefined();
    expect(SPLIT_CSS.split('.sp-over {')[1]!.split('}')[0]).toContain(SPLIT_TOKENS.color.ochre);
    expect(SPLIT_CSS).not.toMatch(/#(?:f00|ff0000|c00|d32f2f)\b|\bred\b/i);
  });

  it('a time chart never flips right to left', () => {
    expect(SPLIT_CSS).not.toMatch(/sp-trend[^{}]*\{[^}]*(?:transform|scale)/);
    expect(SPLIT_CSS).not.toMatch(/\bsp-t(?:line|area|dot)[^{}]*\{[^}]*(?:transform|scale)/);
  });

  it('keeps the wash rose, and the tokens it is drawn from', () => {
    expect(SPLIT_TOKENS.color).toMatchObject({ washInk: '#9C4F52', washHalo: '#B8767A' });
    const doc = atob(inkWashDataUri().split('base64,')[1]!);
    expect(doc).toContain(SPLIT_TOKENS.color.washInk);
    expect(doc).toContain(SPLIT_TOKENS.color.washHalo);
    expect(doc).not.toContain(SPLIT_TOKENS.color.magenta);
  });

  it('holds the brief\'s colours exactly', () => {
    expect(SPLIT_TOKENS.color).toMatchObject({ jade: '#3F6B5C', ochre: '#B8862F', wine: '#5A0A2E', magenta: '#9A0F5E' });
  });

  it('draws no watermark and no repeating pattern: the one picture is the wash, once', () => {
    expect(SPLIT_CSS.match(/url\("data:image/g)).toHaveLength(1);
    expect(SPLIT_CSS).toContain('no-repeat');
    expect(SPLIT_CSS).not.toMatch(/(?<!no-)repeat(?:-x|-y)?\s*;/);
  });

  it('turns into a tab bar on a phone, with Sales first', () => {
    const phone = SPLIT_CSS.split('@media (max-width: 720px)')[1]!;
    expect(phone).toContain('.split nav.side { position:fixed');
    expect(phone).toContain('.sp-panels');
    expect(SPLIT_CSS).toContain('.sp-panels { grid-template-columns:minmax(0, 1fr); }');
  });

});
