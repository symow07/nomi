/**
 * The UI correction, Block 2 — audit F04 (navigation and headers consume the workspace) and F05 (boxes for hierarchy)
 * on Today and the shell's other pages, the Inbox and Ask Nomi.
 *
 *   1. the section tabs start where the page's own title starts: the page's column, or Today's gutter where it is wide;
 *   2. on a phone, where the page IS the section, the chooser is its title — drawn once; the page's one h1 is kept for a
 *      reader (never removed) and is hidden only where the chooser is shown; a page whose h1 says something else keeps
 *      both;
 *   3. the Inbox's phone head: the title and the business on one row, the view's label kept for a reader;
 *   4. Today's panels are ruled apart, not boxed; Today's column has one measure.
 */
import { describe, expect, it } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { SPLIT_CSS } from '../../src/api/web/splitStyle.js';
import { ASSISTANT_AREA_CSS } from '../../src/api/web/assistantAreaStyle.js';
import { assistantArea } from '../../src/api/web/assistantArea.js';
import { INBOX_LIST_CSS } from '../../src/api/web/inboxListStyle.js';

const page = (bodyHtml: string, path = '/app', locale: 'en' | 'ar' = 'en') =>
  shell({ title: 'T', active: 'home', locale, path, bodyHtml });
/** The body of the top-level `@media` block with this condition. */
const media = (css: string, cond: string): string => {
  const at = css.indexOf(`@media ${cond} {`) >= 0 ? css.indexOf(`@media ${cond} {`) : css.indexOf(`@media${cond}{`);
  expect(at, cond).toBeGreaterThanOrEqual(0);
  let depth = 0, i = css.indexOf('{', at);
  for (let j = i; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) return css.slice(i + 1, j); }
  return '';
};
const SR = 'position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap;';

describe('F04 · the shell\'s heads', () => {
  it('the chooser is the title only where the page is the section: the same words as its one h1', () => {
    expect(page('<h1 class="page">Today</h1>')).toContain('<details class="area-chooser" data-titled>');
    expect(page('<h1 class="page">Calendar</h1>', '/app/calendar')).toContain('<details class="area-chooser" data-titled>');
    expect(page('<h1 class="page">Two weeks</h1>', '/app/calendar')).toContain('<details class="area-chooser"><summary>');
    expect(page('<p>no heading</p>')).toContain('<details class="area-chooser"><summary>');
    expect(page('<h1 class="page">اليوم</h1>', '/app', 'ar')).toContain('data-titled');
    // the h1 is never taken out of the page: it is hidden only by the phone's sheet, where the chooser is drawn
    expect(page('<h1 class="page">Today</h1>')).toContain('<h1 class="page">Today</h1>');
  });

  it('on a phone the titled chooser carries the title and the h1 is kept for a reader; nowhere else', () => {
    const phone = media(SPLIT_CSS, '(max-width:720px)');
    expect(phone).toContain('.area-chooser { display:block; margin:0; }');
    expect(phone).toContain(`.content:has(> .area-nav > .area-chooser[data-titled]) > main h1 { ${SR} }`);
    expect(phone).toMatch(/\.area-chooser\[data-titled\] > summary \{[^}]*font-size:var\(--font-size-overview-phone\);[^}]*font-weight:600;/);
    // outside the phone block nothing hides an h1
    expect(SPLIT_CSS.replace(phone, '')).not.toContain('data-titled');
  });

  it('the section tabs start on the page\'s column: main\'s measure and padding, or Today\'s gutter', () => {
    expect(SPLIT_CSS).toContain('.area-nav { padding:var(--space-12) 0 0;');
    expect(SPLIT_CSS).toMatch(/\.area-links \{[^}]*box-sizing:border-box; max-inline-size:var\(--measure-column\); margin-inline:auto; padding-inline:var\(--space-32\);/);
    expect(SPLIT_CSS).toMatch(/\.content:has\(> main\.wide\) > \.area-nav \.area-links \{ max-inline-size:none; margin-inline:0; padding-inline:max\(var\(--space-24\), calc\(\(100% - 1240px\) \/ 2\)\); \}/);
  });

  it('Ask Nomi and the assistant\'s other pages: the same rule in the assistant area, at its own phone width', () => {
    expect(assistantArea('<h1>Ask Nomi</h1>', 'en', '/app/assistant/ask')).toContain('<details class="area-chooser aa-chooser" data-titled>');
    expect(assistantArea('<h1>Something else</h1>', 'en', '/app/assistant/ask')).toContain('<details class="area-chooser aa-chooser"><summary>');
    const phone = media(ASSISTANT_AREA_CSS, '(max-width:600px)');
    expect(phone).toContain('.assistant-area:has(> .aa-chooser[data-titled]) > .aa-content h1{position:absolute;');
    expect(ASSISTANT_AREA_CSS.replace(phone, '')).not.toContain('data-titled');
  });

  it('the Inbox on a phone: the title and the business on one row; the view\'s label kept for a reader', () => {
    const phone = media(INBOX_LIST_CSS, '(max-width: 720px)');
    expect(phone).toMatch(/\.il-header \{ align-items:baseline;/);
    expect(phone).toMatch(/\.il-business \{ display:block; flex:1 1 auto;/);
    expect(phone).toContain(`.il-page .il-view-form label > span { ${SR} }`);
  });
});

describe('F05 · Today: ruled apart, not boxed; one measure', () => {
  it('a panel\'s parts are ruled apart under its heading; the Inbox list keeps its one surface', () => {
    expect(SPLIT_CSS).toContain('.sp-panel > .sp-sheet { background:transparent; border:0; border-radius:0; border-block-start:1px solid var(--color-border); }');
    expect(SPLIT_CSS).toContain('.sp-panel > .sp-sheet > .sp-card { padding-inline:0; }');
    // the decision waiting is still a card: an independent unit of work
    expect(SPLIT_CSS).toMatch(/\.sp-card \{ padding:var\(--space-20\); background:var\(--color-surface\); border:1px solid var\(--color-border\);/);
  });

  it('Today\'s column: the decision, who else waits, the notices and a lone panel share 840 px; the head ends with it', () => {
    expect(SPLIT_CSS).toContain('.sp-priority .sp-decide, .sp-priority .sp-attention, .sp-priority .sp-notices { max-inline-size:840px; }');
    expect(SPLIT_CSS).toContain('.sp-panels.is-one { grid-template-columns:minmax(0, 840px); }');
    expect(SPLIT_CSS).toContain('.sp:has(> .sp-panels.is-one) > .sp-head { box-sizing:content-box; max-inline-size:840px; }');
  });
});
