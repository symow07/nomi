import { describe, it, expect } from 'vitest';
import { shell, signalMark, todoMark, TODO_BEFORE, SIGNAL_BEFORE } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';

/**
 * THE WARMTH RUN'S RE-AUDIT (w4-whole-06, w4-whole-07) — "magenta for meaning".
 * The owner: magenta "marks what the assistant did, plus the 'waiting for you'
 * signal and today's marker. It never becomes a decorative frame."
 *
 * The audit found the waiting ○ in magenta on setup chores and warnings
 * ("Setup ○ 3 of 5 steps done", "○ Name not confirmed yet", "○ No source for
 * 300 and 25"), so a ○ no longer told the owner a customer waits; and magenta
 * tints left on borders. Now: a chore carries the same ○ in the secondary ink,
 * and no border anywhere is drawn in the waiting or the assistant's colours.
 */
const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

describe('magenta for meaning', () => {
  it('no border, outline or edge is drawn in magenta or its tints', () => {
    const framed = rules.filter((r) => /(border|outline)[a-z-]*\s*:[^;]*var\(--color-(waiting|assistant)[a-z-]*\)/.test(r.body)).map((r) => r.sel);
    expect(framed).toEqual([]);
  });

  it('a chore is the to-do ○ in the secondary ink; magenta\'s ○ is a customer waiting', () => {
    expect(todoMark()).toBe('<span class="dot todo" aria-hidden="true">○</span>');
    expect(signalMark('waiting')).toBe('<span class="dot warn" aria-hidden="true">○</span>');
    expect(css).toContain('.dot.todo { color:var(--color-ink-secondary); }');
    for (const sel of TODO_BEFORE) {
      const own = rules.filter((r) => r.sel === sel.replace(':not(.bad)', '') && /(^|;)\s*color:/.test(r.body));
      for (const r of own) expect(r.body, sel).not.toMatch(/color:\s*var\(--color-waiting\)/);
    }
    // the chores are not in the waiting signal's list
    for (const chore of ['.fwarn', '.imp-warn', '.sr-value.warn', '.prob']) expect(SIGNAL_BEFORE.waiting, chore).not.toContain(chore);
    // and the customer-waiting marks still are
    for (const waits of ['.pc-wait', 'nav.side .navcount', '.pill.reason']) expect(SIGNAL_BEFORE.waiting).toContain(waits);
  });
});

describe('rounded for warmth: one rule for corners (w4-whole-17)', () => {
  it('a button shares a field\'s corner; a band shares its list\'s; the sheet and the calendar\'s grid are the panels', () => {
    const radius = (sel: string) => rules.filter((r) => r.sel === sel)
      .map((r) => /border-radius:\s*var\(--radius-([a-z]+)\)/.exec(r.body)?.[1]).find(Boolean);
    expect(radius('.btn')).toBe('control');
    expect(radius('.attn')).toBe('card');
    expect(radius('.scard')).toBe('card');
    expect(radius('.pcard')).toBe('panel');
    expect(radius('.wk-scroll')).toBe('panel');
  });
});
