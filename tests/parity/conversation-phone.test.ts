/**
 * R-1 (the UI correction's third fix round, 2026-11-13) — ON A PHONE NO CONTROL RESTS UNDER THE TAB BAR AND NO CONTROL
 * COVERS CONTENT (the owner's rule), held by construction and pinned here:
 *
 *   1. on a conversation the tab bar is a ROW of the screen (a column: the page's scroll region, then the bar), so the
 *      region ends where the bar begins — nothing can be under the bar, in any state, language or size, with script or
 *      without (the stylesheet alone does it);
 *   2. the answers the page's state asks for stand in a band of a SET height between the region and the bar, in every
 *      state (Block 2): a waiting reply's box and three answers, an order's two, the owner's own reply and its Send, or
 *      "Hand to me" alone. The page names which (`data-band`, from what it drew); the height is set once on the screen's
 *      column (`--band`) and read twice — by the region (the room it gives up) and by the band — so the region ends
 *      where the band begins, a box in the band takes what the answers leave, and the answers' heights are set: they
 *      are whole whatever the reply, the language or what is typed;
 *   3. nothing on a phone is sticky, and the page's script measures nothing for it.
 *
 * The two earlier rounds measured one conversation and failed on another; this reads the rules themselves.
 */
import { describe, expect, it } from 'vitest';
import { CONVERSATION_CSS } from '../../src/api/web/conversationStyle.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { bandOf } from '../../src/api/web/inbox.js';

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
/** The screen's column while the named band is on it (the conversation shown, that band drawn). */
const shown = (name: string, more = ''): string =>
  `.owner-shell .layout:has(.conversation-workspace:not([data-tool-open]) .conv-acts[data-band="${name}"]${more}):not(:has(#customer:target))`;
const ACTS = '.conversation-workspace .conv-acts';
const APPROVE = `${ACTS}[data-band="approve"] form.approve`;
const QUIET = `${ACTS}[data-band="approve"] #approve .acts-more .btn`;
const REPLY = `${ACTS}[data-band="reply"] .replyform .answer`;
const ORDER = `${ACTS}[data-band="order"] #order .answer`;
const TAKE = `${ACTS}[data-band="take"] .takeover > form.answer`;

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

  it('one height, set on the column and read twice: the region ends where the band begins', () => {
    // no band unless the page names one
    expect(rule(band, PAGE)).toBe(' --band:0px; ');
    // the region gives up exactly the band's height, and every band is exactly that tall, standing on the bar
    expect(rule(band, `${PAGE} > .content`)).toBe(' margin-block-end:var(--band); ');
    const all = rule(band, [APPROVE, REPLY, ORDER, TAKE].join(', '));
    expect(all).toContain('position:fixed'); expect(all).toContain('block-size:var(--band)'); expect(all).toContain('box-sizing:border-box');
    expect(all).toContain(`inset-block-end:${BAR};`); expect(all).toContain('inset-inline:0');
    // the tool pane and the customer's facts take the conversation's place on a phone: no band while either is open
    for (const name of ['approve', 'reply', 'order', 'take']) expect(band, name).toContain(`${shown(name)} { --band:`);
  });

  for (const [name, body, clamp, noted, under] of [
    ['a narrow phone: two answers, then the third under them', band, 'clamp(232px, 40dvh, 340px)', 'clamp(288px, 46dvh, 380px)', 64],
    ['wider: the three answers in one row', wide, 'clamp(168px, 40dvh, 300px)', 'clamp(224px, 46dvh, 340px)', 8]] as const) {
    it(`a reply waiting, ${name} — the band's height is set, and holds the answers and a box`, () => {
      expect(rule(body, shown('approve'))).toBe(` --band:${clamp}; `);
      // the smallest band still holds the answers and a box of 96 px or more: 8 above the box, 8 under it, the answers' 48
      const least = Number(/clamp\((\d+)px/.exec(clamp)![1]);
      expect(least - (8 + 8 + 48 + under)).toBeGreaterThanOrEqual(96);
      // and the smallest screen that has a band (400 px tall) keeps a scroll region above it and the bar
      expect(400 - 69 - least).toBeGreaterThanOrEqual(96);
      // a note in the band (kept words, why it waits) is given its own room: the band is 56 px taller with one
      expect(rule(body, shown('approve', ' form.approve > p'))).toBe(` --band:${noted}; `);
      expect(Number(/clamp\((\d+)px/.exec(noted)![1]) - least).toBe(56);
    });
  }

  it('a reply waiting: the box takes what the answers leave; the answers are 48 px, whole', () => {
    expect(rule(band, `${APPROVE} textarea, ${REPLY} textarea`)).toContain('flex:1 1 0; block-size:auto; min-block-size:0; max-block-size:none; field-sizing:fixed;');
    expect(rule(band, `${APPROVE} .acts`)).toContain('flex:none');
    const answers = rule(band, [`${APPROVE} .acts .btn`, QUIET, `${REPLY} .btn`, `${ORDER} .btn`, `${TAKE} .btn`].join(', '));
    expect(answers).toContain('block-size:48px; min-block-size:0;'); expect(answers).toContain('white-space:normal');
    // "No reply needed" is its own form after the block: it is set in the band's last row, 8 px above the bar (69 + 8)
    const quiet = rule(band, QUIET);
    expect(quiet).toContain('position:fixed'); expect(quiet).toContain('inset-block-end:calc(77px + env(safe-area-inset-bottom));');
    expect(rule(band, APPROVE)).toBe(' padding-block-end:64px; ');
    // a transformed card would carry what is fixed inside it: the entrance is off where a band is
    expect(rule(band, '.conversation-workspace #approve, .conversation-workspace #order, .conversation-workspace .conv-acts[data-band] > .card')).toBe(' animation:none; ');
    // a short screen has no band: nothing in the plain phone block is fixed
    expect(phone).not.toMatch(/position:\s*fixed/);
  });

  it('the other states: the owner\'s own reply (a box and Send), an order\'s two answers, "Hand to me" alone', () => {
    // the reply's band holds a box of 96 px or more above its 48 px Send: 8 + box + 8 + 48 + 8
    const reply = rule(band, shown('reply'));
    expect(Number(/clamp\((\d+)px/.exec(reply)![1]) - (8 + 8 + 48 + 8)).toBeGreaterThanOrEqual(96);
    // one row of 48 px answers and 8 px each side: 64
    expect(rule(band, shown('order'))).toBe(' --band:64px; ');
    expect(rule(band, shown('take'))).toBe(' --band:64px; ');
    // (the last rule of that name: the first is the tail of the four bands' shared rule)
    expect(band.slice(band.lastIndexOf(`${ORDER}, ${TAKE} {`))).toContain('grid-auto-columns:minmax(0,1fr)');
  });

  it('the page names the band from what it drew: one at most, the order first', () => {
    const order = '<div class="acts answer">', approve = '<form method="post" action="/x" class="approve">', reply = '<div class="answer">', take = '<form method="post" action="/x" class="inline answer">';
    expect(bandOf('')).toBe('');
    expect(bandOf('<div class="card">nothing to answer</div>')).toBe('');
    expect(bandOf(take)).toBe(' data-band="take"');
    expect(bandOf(reply + take)).toBe(' data-band="reply"');
    expect(bandOf(approve + take)).toBe(' data-band="approve"');
    expect(bandOf(order + approve + reply + take)).toBe(' data-band="order"');
  });
});
