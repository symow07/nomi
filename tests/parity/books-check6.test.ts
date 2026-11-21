import { describe, it, expect } from 'vitest';
import { isolateOptions } from '../../src/api/web/values.js';
import { BOOKS_AREA_CSS } from '../../src/api/web/booksAreaStyle.js';

/**
 * UI correction, Block 5 (check 6, inherited from before the block) — the two guarantees the verify found unmet on
 * every Books page: a link drawn as a 44 px target was narrower than 44 ("All", "Draft", "草稿", the back link "发票"…),
 * and an option's words were not isolated on a right-to-left page.
 */
const F = '\u2068', P = '\u2069';

describe('Block 5 · check 6', () => {
  it('an option\'s words are isolated in Arabic; the value is what is sent, never the marks', () => {
    const html = '<select name="account"><option value="a1">1000 · Checking</option><option value="" selected></option></select>'
      + '<select name="currency"><option selected>MAD</option><option>\n  USD  </option></select>';
    const ar = isolateOptions('ar', html);
    expect(ar).toContain(`<option value="a1">${F}1000 · Checking${P}</option>`);
    expect(ar).toContain('<option value="" selected></option>');
    expect(ar).toContain(`<option selected value="MAD">${F}MAD${P}</option>`);
    expect(ar).toContain(`<option value="USD">${F}\n  USD  ${P}</option>`);
    // already isolated: as it is; every other language: untouched
    expect(isolateOptions('ar', ar)).toBe(ar);
    for (const l of ['en', 'zh', 'es', 'fr'] as const) expect(isolateOptions(l, html)).toBe(html);
  });
  it('every Books link drawn as a target is at least 44 px wide as well as tall (inline links in a sentence are not boxes)', () => {
    expect(BOOKS_AREA_CSS).toContain('.books-area a[href]{min-width:44px;}');
  });
});
