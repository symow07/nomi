import { describe, it, expect } from 'vitest';
import { shell, loginPage, signalMark, todoMark, TODO_BEFORE, SIGNAL_BEFORE } from '../../src/api/web/layout.js';
import { SITE_CSS } from '../../src/api/web/site.js';
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
const doorCss = linkedCss(loginPage({ locale: 'en', path: '/login' }));
const parse = (sheet: string) => [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const rules = parse(css);
/** The warmth pass (2026-10-04) — both magentas, the deep (`needs`) and the light (`assistant`), and their washes. */
const MAGENTA = /var\(--color-(needs|assistant)[a-z-]*\)/;

describe('magenta for meaning', () => {
  it('no border, outline, ring or edge is drawn in either magenta or their washes — on any sheet', () => {
    for (const [name, sheet] of [['app', css], ['door', doorCss], ['site', SITE_CSS]] as const) {
      const framed = parse(sheet).filter((r) => r.body.split(';').some((d) =>
        /^\s*(border|outline|box-shadow|text-decoration|column-rule)[a-z-]*\s*:/.test(d) && MAGENTA.test(d))).map((r) => r.sel);
      expect(framed, name).toEqual([]);
    }
  });

  it('the deep fill is a fill under white words, never a frame: its edge is transparent', () => {
    const fill = rules.find((r) => r.sel === '.btn.send.needs')!.body;
    expect(fill).toContain('background:var(--color-needs)');
    expect(fill).toContain('border-color:transparent');
  });

  it('a wash is only a ground under ink or its own magenta — never a band of colour on its own', () => {
    for (const r of rules) {
      if (!/background[a-z-]*\s*:\s*var\(--color-(needs|assistant)-wash\)/.test(r.body)) continue;
      const fg = /(?:^|[;\s])color\s*:\s*var\(--color-([a-z-]+)\)/.exec(r.body)?.[1];
      expect([undefined, 'ink', 'needs', 'assistant'], r.sel).toContain(fg);
    }
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

describe('rounded for warmth: one rule for corners (w4-whole-17; the warmth pass)', () => {
  /**
   * The warmth pass (2026-10-04) — control 12, card 16, panel 20, chip round, and nothing else.
   * Every corner on the app's and the door's sheets is one of the four tokens, except these,
   * each a shape on purpose and not a square corner left over.
   */
  const KEPT: Readonly<Record<string, string>> = {
    '.msg.inbound .bubble': 'the speech tail where the customer\'s words start',
    '.msg.outbound .bubble': 'the speech tail where a reply starts',
    '.calm-rule': 'a short rule, not a box',
    '.cal-sw': 'the legend draws an EDGE, square on purpose (V1-200)',
    '.scard .srow:focus-visible': 'a focus ring inside its card, one pixel inside the card\'s own corner',
    'dialog.sheet .pcard': 'a bottom sheet: square where it meets the foot of the phone',
    '.listpane .crows': 'a list flat in its pane, no card around it',
    '.listpane .irows': 'a list flat in its pane, no card around it',
    '.sbx-trust .verdict': 'a word, not a box',
  };

  it('every corner is one of the four, or named above with its reason', () => {
    const odd: string[] = [];
    for (const sheet of [css, doorCss]) {
      for (const r of parse(sheet)) {
        for (const m of r.body.matchAll(/border(?:-[a-z-]+)?-radius\s*:\s*([^;]+)/g)) {
          if (/^var\(--radius-(control|card|panel|chip)\)$/.test(m[1]!.trim())) continue;
          for (const sel of r.sel.split(',').map((x) => x.trim())) if (!KEPT[sel]) odd.push(`${sel}: ${m[1]!.trim()}`);
        }
      }
    }
    expect(odd).toEqual([]);
  });

  it('each kind of thing has its corner: a control 12, a card 16, a panel 20, a chip round', () => {
    const radius = (sel: string, sheet = rules) => sheet.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel))
      .map((r) => /border-radius:\s*var\(--radius-([a-z]+)\)/.exec(r.body)?.[1]).find(Boolean);
    const KIND: Readonly<Record<string, readonly string[]>> = {
      control: ['.btn', '.pform input:not([type="checkbox"]):not([type="radio"])', '.imgs img', '.imp-photo img', '.reasons', '.prob', '.ch-info'],
      card: ['.card', '.scard', '.irows', '.crows', '.attn', '.flash', '.toast', '.tw-list', '.dl', '.empty', '.bubble', '.kitem', '.gap', '.guide-step', '.guide-video', 'pre'],
      panel: ['.pcard', '.wk-scroll', 'dialog.ask'],
      chip: ['.pill', '.tag', '.chip', '.face', '.langsw', 'nav.side .navcount', '.tab', '.tl li .ic'],
    };
    for (const [kind, sels] of Object.entries(KIND)) for (const sel of sels) expect(radius(sel), sel).toBe(kind);
    // the door's fields and buttons are controls too
    expect(radius('input', parse(doorCss))).toBe('control');
    expect(radius('button', parse(doorCss))).toBe('control');
  });

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
