/**
 * R-1 (the UI correction's third fix round, 2026-11-13) — ON A PHONE NO CONTROL RESTS UNDER THE TAB BAR AND NO CONTROL
 * COVERS CONTENT (the owner's rule), held by construction and pinned here:
 *
 *   1. on a conversation the tab bar is a ROW of the screen (a column: the page's scroll region, then the bar), so the
 *      region ends where the bar begins — nothing can be under the bar, in any state, language or size, with script or
 *      without (the stylesheet alone does it);
 *   2. a reply waiting has its box and its three answers in a band of a FIXED height between the region and the bar:
 *      the region ends where the band begins (the same figure, twice), the box takes what the answers leave, and the
 *      answers' heights are set — so they are whole whatever the reply, the language or what is typed;
 *   3. nothing on a phone is sticky, and the page's script measures nothing for it.
 *
 * The two earlier rounds measured one conversation and failed on another; this reads the rules themselves.
 */
import { describe, expect, it } from 'vitest';
import { CONVERSATION_CSS } from '../../src/api/web/conversationStyle.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';

/** The top-level `@media` blocks of the sheet, by their condition. */
function mediaBlocks(css: string): { cond: string; body: string }[] {
  const out: { cond: string; body: string }[] = [];
  const re = /@media ([^{]+)\{/g; let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
    out.push({ cond: m[1]!.trim(), body: css.slice(re.lastIndex, i - 1) }); re.lastIndex = i;
  }
  return out;
}
const rule = (body: string, selector: string): string => {
  const at = body.indexOf(`${selector} {`);
  expect(at, `the rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return body.slice(at + selector.length + 2, body.indexOf('}', at));
};

const blocks = mediaBlocks(CONVERSATION_CSS);
const phone = blocks.find((b) => b.cond === '(max-width:720px)')!.body;
const band = blocks.find((b) => b.cond === '(max-width:720px) and (min-height:400px)')!.body;
const wide = blocks.find((b) => b.cond === '(min-width:481px) and (max-width:720px) and (min-height:400px)')!.body;
const BAR = 'calc(69px + env(safe-area-inset-bottom))';
const PAGE = '.owner-shell .layout:has(.conversation-workspace)';
const WAITING = '.owner-shell .layout:has(.conversation-workspace:not([data-tool-open]) form.approve):not(:has(#customer:target))';

describe('R-1 · a conversation on a phone: the bar is a row, the answers a band, nothing over anything', () => {
  it('the screen is a column — the scroll region, then the bar — so the region ends where the bar begins', () => {
    const page = rule(phone, PAGE);
    expect(page).toContain('display:flex'); expect(page).toContain('flex-direction:column'); expect(page).toContain('block-size:100dvh');
    const bar = rule(phone, `${PAGE} > nav.side`);
    // in the column, after the region, at a height that is SET (the band stands on it): never a layer over the page
    expect(bar).toContain('position:relative'); expect(bar).toContain('order:2'); expect(bar).toContain('flex:none');
    expect(bar).toContain(`block-size:${BAR}`); expect(bar).toContain('box-sizing:border-box');
    const region = rule(phone, `${PAGE} > .content`);
    expect(region).toContain('order:1'); expect(region).toContain('flex:1 1 0'); expect(region).toContain('min-block-size:0'); expect(region).toContain('overflow-y:auto');
    // the room the shell leaves under a page for its floating bar is not wanted where the bar floats over nothing
    expect(region).toContain('padding-block-end:0');
  });

  it('nothing on a phone is sticky, and no script measures the page for it', () => {
    for (const b of blocks) if (!/min-width:1100px/.test(b.cond)) expect(b.body, b.cond).not.toMatch(/position:\s*sticky/);
    // outside any media block: nothing sticky either
    let bare = CONVERSATION_CSS; for (const b of blocks) bare = bare.replace(b.body, '');
    expect(bare).not.toMatch(/position:\s*sticky/);
    expect(CONVERSATION_CSS).not.toContain('data-room');
    expect(LIVE_SCRIPT).not.toContain('data-room');
    expect(LIVE_SCRIPT).not.toContain('draft-dock');
  });

  for (const [name, body, clamp, under] of [['a narrow phone: two answers, then the third under them', band, 'clamp(232px, 44dvh, 340px)', 64], ['wider: the three answers in one row', wide, 'clamp(168px, 40dvh, 300px)', 8]] as const) {
    it(`${name} — the region ends where the band begins, and the band's height is set`, () => {
      // the same figure, twice: the room the region gives up, and the band's own height
      expect(rule(body, `${WAITING} > .content`)).toBe(` margin-block-end:${clamp}; `);
      expect(rule(body, '.conversation-workspace form.approve')).toContain(`block-size:${clamp};`);
      // the smallest band still holds the answers and a box of 96 px or more: 8 above the box, 8 under it, the answers' 48
      const least = Number(/clamp\((\d+)px/.exec(clamp)![1]);
      expect(least - (8 + 8 + 48 + under)).toBeGreaterThanOrEqual(96);
      // and the smallest screen that has a band (400 px tall) keeps a scroll region above it and the bar
      expect(400 - 69 - least).toBeGreaterThanOrEqual(96);
    });
  }

  it('the band stands on the bar; its box takes what the answers leave; the answers are 48 px, whole', () => {
    const form = band.slice(band.indexOf('.conversation-workspace form.approve { position:fixed'));
    expect(form).toContain(`inset-block-end:${BAR};`);
    expect(form).toContain('inset-inline:0');
    expect(rule(band, '.conversation-workspace form.approve textarea')).toContain('flex:1 1 0; block-size:auto; min-block-size:0; max-block-size:none; field-sizing:fixed;');
    expect(rule(band, '.conversation-workspace form.approve .acts')).toContain('flex:none');
    expect(rule(band, '.conversation-workspace form.approve .acts .btn, .conversation-workspace #approve .acts-more .btn')).toContain('block-size:48px; min-block-size:0;');
    // "No reply needed" is its own form after the block: it is set in the band's last row, 8 px above the bar (69 + 8)
    const quiet = band.slice(band.lastIndexOf('.conversation-workspace #approve .acts-more .btn {'));
    expect(quiet).toContain('position:fixed'); expect(quiet).toContain('inset-block-end:calc(77px + env(safe-area-inset-bottom));');
    // a transformed card would carry what is fixed inside it: the entrance is off where the band is
    expect(rule(band, '.conversation-workspace #approve')).toBe(' animation:none; ');
    // a short screen has no band: nothing in the plain phone block is fixed
    expect(phone).not.toMatch(/position:\s*fixed/);
  });
});
