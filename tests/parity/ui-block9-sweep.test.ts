import { describe, expect, it } from 'vitest';
import { CUSTOMERS_CSS } from '../../src/api/web/customersStyle.js';
import { SECTIONS_CSS } from '../../src/api/web/sectionsStyle.js';
import { messages } from '../../src/core/owner/i18n/messages.js';

// UI correction, Block 9 — the sweep. A regression the sweep found: once the Customers section tabs said "Labels" in
// Chinese (标签, two characters, a Block 9 word), that tab was 34 px wide at 1440×900, under the 44 px every control
// keeps. The tabs now hold 44 px both ways, as Settings' page tabs already did (`.sa-pages a`). Measured in a browser by
// the harness's guard (zh, 1440×900: three views flagged at the head, none after); this file holds the rule.

const rule = (css: string, sel: string): string => {
  const at = css.indexOf(`${sel}{`);
  expect(at, `${sel} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('Block 9 sweep — the Customers sections keep 44 px with short words', () => {
  it('a section link is at least 44 px tall and as wide as the sidebar, its word on one line with room', () => {
    // The navigation block (2026-11-25): the tabs gave way to the section sidebar, whose links span its 240 px column,
    // so a two-character word can no longer make one narrow. On a phone the chooser's links span the page.
    expect(CUSTOMERS_CSS).not.toContain('.ca-nav');
    const r = rule(SECTIONS_CSS, '.sect a ');
    expect(r).toContain('display:flex');
    expect(r).toContain('min-block-size:44px');
    expect(rule(SECTIONS_CSS, '  .area-chooser > div > a ')).toContain('min-block-size:44px');
  });
  it('the word that made the tab narrow is a real Chinese word (not the English fallback)', () => {
    expect((messages.zh as Record<string, string>)['customers.labels']).toBe('标签');
  });
});
