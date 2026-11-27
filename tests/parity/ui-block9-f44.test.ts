import { describe, it, expect } from 'vitest';
import { shell } from '../../src/api/web/layout.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { linkedCss } from './linked-css.js';

// UI correction, Block 9 — F44 "Motion repeats on routine work". A page the owner opens many times a day is simply
// there: no card, row, group or open fold rises in because the page arrived, and a link between two pages moves only
// what was chosen (the rail's tile, the Inbox's lens, the calendar's day), never the page or the whole window. What
// still moves is what a person did: a fold slides open when it is opened (and only then — a fold drawn open at rest
// does not play), a notice or a draft drawn in place rises in when a save or a send completes, a dialog or a toast
// arrives. Reduced motion: nothing runs at all, not even the 1 ms remainders. Escape closes the Knowledge page's
// "Add" fold as it closes every edit fold, focus back on its summary, the words kept.
// Measured in a browser by the harness (f44open: 24 cases, base fails 24, head 0; f44arrive + f44verdict: 18 routine
// pages and two links, base fails 7, head 0; f44done: a save's notice, base fails, head passes); this file holds the
// stylesheet and the script.

const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));

/** The body of the first `@media …` block whose condition is `cond`, braces matched. */
const mediaBlock = (cond: string): string => {
  const at = css.indexOf(`@media (prefers-reduced-motion: ${cond})`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
};
const MOVING = mediaBlock('no-preference');
const REDUCED = mediaBlock('reduce');
/** Top-level rules of a block, as selector list and body (an at-rule inside is kept whole, unsplit). */
const rules = (block: string) => [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sels: m[1]!.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean), body: m[2]!.trim(),
}));
const ruleFor = (sel: string) => rules(MOVING).find((r) => r.sels.includes(sel))?.body ?? '';

describe('F44 · routine work arrives still; what a person did still moves', () => {
  it('nothing on a routine page rises or arrives because the page loaded', () => {
    expect(MOVING.length).toBeGreaterThan(0);
    const animated = rules(MOVING).filter((r) => /animation(-name)?\s*:\s*nomi-(rise|arrive)/.test(r.body)).flatMap((r) => r.sels);
    // only what completes: a notice after a save, the draft when the script draws the conversation again
    expect(animated.sort()).toEqual(['.flash', 'main[data-drawn-again] #approve'].sort());
    for (const routine of ['#approve', '.td', '.home-card', '.home-schedule', '.sgroup', '.sgroup + .sgroup', '.td-row > li', 'details[open] > :not(summary)']) {
      expect(ruleFor(routine), routine).not.toMatch(/animation|nomi-/);
    }
    for (const gone of ['nomi-arrive', 'nomi-page-in', 'nomi-fade-out']) expect(css, gone).not.toContain(`@keyframes ${gone}`);
  });

  it('a fold moves when it is opened, never because the page came with it open', () => {
    expect(ruleFor('details[open]::details-content')).toMatch(/^transition:opacity var\(--motion-normal\)[^;]*, transform var\(--motion-normal\)[^;]*;$/);
    const closed = ruleFor('details:not([open])::details-content');
    expect(closed).toContain('opacity:0;');
    expect(closed).toContain('transform:translateY(calc(-1 * var(--travel-fold)));');
    // hiding waits only on the way closed: opening exposes the fields to the very next Tab
    expect(closed).toContain('content-visibility var(--motion-fast) allow-discrete');
    expect(ruleFor('details[open]::details-content')).not.toContain('content-visibility');
  });

  // 2026-11-27 (the owner: page changes lag): nothing crosses from one page to the next, the rail's tile included.
  it('a link moves nothing between pages: no page opts into a cross-document transition', () => {
    expect(css).not.toContain('view-transition');
  });

  it('completion still moves: a notice, the draft drawn again, a toast, a dialog', () => {
    expect(ruleFor('.flash')).toContain('animation:nomi-rise var(--motion-normal)');
    expect(ruleFor('main[data-drawn-again] #approve')).toContain('animation:nomi-rise var(--motion-normal)');
    expect(ruleFor('.toast')).toContain('animation:nomi-toast-in');
    expect(ruleFor('dialog.ask[open]')).toContain('transition-duration:var(--motion-normal)');
    // the script marks the page it draws in place, which is what lets the draft rise there and only there
    expect(LIVE_SCRIPT).toContain('data-drawn-again');
  });

  it('reduced motion: nothing runs, not even a 1 ms remainder', () => {
    const all = rules(REDUCED).find((r) => r.sels.includes('*'))?.body ?? '';
    expect(all).toContain('animation-name:none !important;');
    expect(all).toContain('transition-property:none !important;');
    expect(all).toContain('scroll-behavior:auto !important;');
  });

  it('Escape closes the Knowledge "Add" fold as it closes an edit fold, focus back on its summary', () => {
    expect(LIVE_SCRIPT).toContain("closest('details[data-edit][open],details.ak-add[open]')");
  });
});
