import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';

/**
 * UI Block 7 — what the signed-in guard probe found on the block's own pages (head 9722ee2c, 270 views), held here:
 * every control a 44 px target in both directions, and every value on a right-to-left page isolated (rule 38).
 *  - Notifications: the door to "Your number for notifications" was an 18 px line.
 *  - Meta's help: the three links to Meta's own help were 20 px (32 in Arabic).
 *  - The settings pages' own links (Account / Notifications / Language / …): "اللغة" was 27 px wide.
 *  - Samples: the tick's label, its 44 px target, was 24 px.
 *  - WhatsApp test numbers: a number beside its name was bare in Arabic.
 */
const LAYOUT = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
const FACTORY = readFileSync(new URL('../../src/api/web/factory.ts', import.meta.url), 'utf8');
const rule = (css: string, sel: string): string => {
  const at = css.indexOf(sel + ' {') >= 0 ? css.indexOf(sel + ' {') : css.indexOf(sel + '{');
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('Block 7 guard · 44 px targets and isolated values on the settings pages', () => {
  it('the door to the notification number is a 44 px target', () => {
    expect(rule(LAYOUT, '  .way-door')).toMatch(/min-height:44px/);
  });
  it("the links to Meta's help are 44 px targets", () => {
    expect(rule(LAYOUT, '  .help-links a')).toMatch(/min-height:44px/);
  });
  it('a settings page link is at least 44 px wide as well as high, however short its name', () => {
    const r = rule(SETTINGS_AREA_CSS, '.sa-pages a');
    expect(r).toMatch(/min-height:44px/);
    expect(r).toMatch(/min-width:44px/);
  });
  it("a tick's label in a settings row is its 44 px target", () => {
    expect(rule(SETTINGS_AREA_CSS, '.settings-area .setrow:has(input[type=checkbox]) label.fr-name')).toMatch(/min-height:44px/);
  });
  it('a test number shown beside its name is isolated', () => {
    expect(FACTORY).toContain('<span class="muted"><bdi>${esc(r.phone)}</bdi></span>');
    expect(FACTORY).not.toContain('<span class="muted">${esc(r.phone)}</span>');
  });
});
