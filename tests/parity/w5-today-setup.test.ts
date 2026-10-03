import { describe, it, expect } from 'vitest';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { setupFrom } from '../../src/db/setup.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { menuRow, renderSetup, renderSettingsHome } from '../../src/api/web/settings.js';

/**
 * THE WARMTH RUN, PHASE 9 — the fix wave for Today, setting up, Settings and
 * Setup (docs/UI-AUDIT.md §3), and the whole-product items handed to this area.
 * Each block names the findings it holds; each would fail without its fix.
 */

const scopeOf = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
  business: '义乌宏发日用品厂 (demo)', needsYou: 1, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const inScope = <T>(fn: () => T, over: Partial<RequestScope> = {}): T => withWorkspace(scopeOf(over), fn);
const SETUP_VIEW = { people: 2, alerts: { available: true, phones: 0, way: 'email' as const }, signIn: { email: null }, billing: { configured: false, exempt: false, status: 'none' }, dataWaiting: 0 };
const css = (): string => linkedCss(inScope(() => shell({ title: 'x', active: 'settings', locale: 'en', path: '/app/settings', bodyHtml: '' })));
/** The declarations of every rule whose selector list contains `sel` exactly. */
const rulesFor = (sheet: string, sel: string): string[] =>
  [...sheet.replace(/\/\*[^]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]!);

describe('w4-today-setup-24 · w4-whole-08 · a menu value takes the page\'s direction; its words are isolated', () => {
  it('the value\'s cell carries no direction of its own: in Arabic it is right to left, its mark where reading starts', () => {
    const row = menuRow({ href: '/x', label: 'البدء', value: 'اكتملت 3 من 5 خطوات', tone: 'warn' });
    expect(row).toContain('<span class="sr-value warn"><bdi>اكتملت 3 من 5 خطوات</bdi></span>');
    expect(row).not.toMatch(/class="sr-value[^"]*"[^>]*dir=/);
  });
  for (const l of LOCALES) {
    it(`${l} · Settings and Setup draw every value that way`, () => {
      const html = inScope(() => renderSettingsHome(l, null) + renderSetup(SETUP_VIEW, l, null));
      expect(html).toContain('class="sr-value');
      expect(html).not.toMatch(/class="sr-value[^"]*" dir=/);
    });
  }
});

describe('w4-today-setup-23 · w4-whole-08 · a menu value is never cut; the name and the value share the row', () => {
  it('no menu rule cuts a value short or keeps it to one line', () => {
    const sheet = css();
    for (const sel of ['.sr-menu .sr-value', '.srow.sr-menu > .sr-value']) {
      for (const body of rulesFor(sheet, sel)) {
        expect(body, sel).not.toMatch(/text-overflow|white-space:\s*nowrap|overflow:\s*hidden/);
        expect(body, sel).not.toMatch(/max-width:\s*\d/);
      }
    }
  });
  it('the row is a grid of four, so the shorter of name and value stays whole and the longer wraps', () => {
    const grid = rulesFor(css(), '.srow.sr-menu').join(';');
    expect(grid).toMatch(/display:grid/);
    expect(grid).toMatch(/grid-template-columns:min-content minmax\(0, auto\) minmax\(0, max-content\) min-content/);
    expect(rulesFor(css(), '.srow.sr-menu > .sr-value').join(';')).toMatch(/overflow-wrap:break-word/);
  });
});

describe('w4-whole-16 · keyboard focus on a menu row is drawn inside the row, where the card cannot clip it', () => {
  it('the card still clips its rows to its corners, and a focused row\'s ring sits inside, rounded like the card', () => {
    const sheet = css();
    expect(rulesFor(sheet, '.scard').join(';')).toMatch(/overflow:hidden/);
    const focus = rulesFor(sheet, '.scard .srow:focus-visible').join(';');
    expect(focus).toMatch(/outline-offset:-2px/);
    expect(focus).toMatch(/border-radius:calc\(var\(--radius-card\) - 1px\)/);
  });
});

