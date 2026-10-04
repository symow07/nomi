import { describe, it, expect } from 'vitest';
import { shell, loginPage, publicDocument, signalMark, todoMark, TODO_BEFORE, SIGNAL_BEFORE, NEEDS_DOT } from '../../src/api/web/layout.js';
import { SITE_CSS } from '../../src/api/web/site.js';
import { shapeUrl } from '../../src/api/web/marks.js';
import { linkedCss } from './linked-css.js';

/**
 * THE IDENTITY SYSTEM (the owner, 2026-10-04) — it supersedes the warmth run's
 * "magenta for meaning". Magenta is Nomi's signature, used generously as the
 * BRAND; MEANING moved to shade plus shape:
 *
 *   brand      identity — what you press, where you go, where you are
 *   deep       "needs you" — always with the NEEDS DOT (a solid disc)
 *   light      "the assistant did this" — always as its NAME TAG (its wash)
 *
 * The edge rule, as it now stands:
 *   - the deep and the light shades and their washes NEVER draw an edge (a
 *     border, an outline, a ring, a shadow or an underline) on any sheet;
 *   - the brand draws exactly three kinds of edge: a focus ring, an underline,
 *     and the edge of the one thing you are on (the chosen tab, the row open
 *     beside the list) — never a card's, a panel's, a band's or a field's frame.
 *
 * Before (the warmth run's re-audit, w4-whole-06, w4-whole-07): no magenta
 * edge at all, and a chore's ○ in the secondary ink so magenta's ○ meant a
 * customer waiting. The chore keeps its open ring; the customer's is solid now.
 */
const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
const doorCss = linkedCss(loginPage({ locale: 'en', path: '/login' }));
const publicCss = /<style>([\s\S]*)<\/style>/.exec(publicDocument({ locale: 'en', title: 'T', body: '' }))![1]!;
const SHEETS = [['app', css], ['door', doorCss], ['site', SITE_CSS], ['public', publicCss]] as const;
const parse = (sheet: string) => [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const rules = parse(css);
const bodyOf = (sel: string, sheet = rules) => sheet.filter((r) => r.sel.split(',').map((x) => x.trim()).includes(sel)).map((r) => r.body).join(';');
/** The two MEANING shades, the deep (`needs`) and the light (`assistant`), and their washes. */
const MEANING = /var\(--color-(needs|assistant)[a-z-]*\)/;
const BRAND = /var\(--color-brand\)/;
const EDGE = /^\s*(border|outline|box-shadow|text-decoration|column-rule)[a-z-]*\s*:/;

/** The edge of the ONE thing you are on — the third edge the brand may draw. */
const ON_EDGES: Readonly<Record<string, string>> = {
  '.tab.on': 'the chosen tab',
  '.listpane .irow.on': 'the customer open beside the list',
  'a.crow.on': 'the conversation open beside the list (the older row)',
};

describe('the identity system: the brand draws, the meanings do not', () => {
  it('no border, outline, ring, shadow or underline is drawn in the deep or the light shade or their washes — on any sheet', () => {
    for (const [name, sheet] of SHEETS) {
      const framed = parse(sheet).filter((r) => r.body.split(';').some((d) => EDGE.test(d) && MEANING.test(d))).map((r) => r.sel);
      expect(framed, name).toEqual([]);
    }
  });

  it('the brand draws three kinds of edge only: a focus ring, an underline, the edge of what you are on', () => {
    const wrong: string[] = [];
    let rings = 0, underlines = 0, on = 0;
    for (const [name, sheet] of SHEETS) {
      for (const r of parse(sheet)) {
        for (const d of r.body.split(';').filter((x) => EDGE.test(x) && BRAND.test(x))) {
          const prop = d.trim().split(':')[0]!.trim();
          for (const sel of r.sel.split(',').map((x) => x.trim())) {
            if (prop.startsWith('outline')) { if (/focus|is-focus/.test(sel)) rings++; else wrong.push(`${name}: ${sel} { ${prop} } is a ring that is not focus`); }
            else if (prop.startsWith('text-decoration')) underlines++;
            else if (ON_EDGES[sel]) on++;
            else wrong.push(`${name}: ${sel} { ${prop} } — a frame in the brand`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // …and each kind is really drawn: the reading finds what it looks for.
    expect(rings).toBeGreaterThanOrEqual(5);
    expect(underlines).toBeGreaterThanOrEqual(8);
    expect(on).toBeGreaterThanOrEqual(3);
  });

  it('the focus ring is the brand on every sheet a person types or presses on', () => {
    expect(bodyOf('a:focus-visible')).toContain('outline:2px solid var(--color-brand)');
    expect(bodyOf('a:focus-visible', parse(doorCss))).toContain('outline:2px solid var(--color-brand)');
    expect(bodyOf('a:focus-visible', parse(publicCss))).toContain('outline:2px solid var(--color-brand)');
  });

  it('a wash is only a ground under ink or its own shade — never a band of colour on its own', () => {
    for (const r of rules) {
      if (!/background[a-z-]*\s*:\s*var\(--color-(needs|assistant)-wash\)/.test(r.body)) continue;
      const fg = /(?:^|[;\s])color\s*:\s*var\(--color-([a-z-]+)\)/.exec(r.body)?.[1];
      expect([undefined, 'ink', 'needs', 'assistant'], r.sel).toContain(fg);
    }
  });
});

describe('"needs you" reads without the hue: the needs dot', () => {
  it('the dot is a solid disc the stylesheet draws, in the words\' own colour — never a font\'s glyph', () => {
    expect(NEEDS_DOT).toContain('content:""');
    expect(NEEDS_DOT).toContain('background:currentColor');
    expect(NEEDS_DOT).toContain('border-radius:var(--radius-chip)');
    expect(NEEDS_DOT).toMatch(/inline-size:([\d.]+)em; block-size:\1em/);   // a disc: as wide as it is tall
    // the element form (signalMark): the same disc, its glyph pushed out of the box
    const dot = bodyOf('.dot.warn');
    for (const d of ['color:var(--color-needs)', 'background:currentColor', 'border-radius:var(--radius-chip)', 'overflow:hidden', 'text-indent:1em']) expect(dot, d).toContain(d);
  });

  it('every needs-you element carries it: the waiting signal, the pills, the card\'s flag, the rail\'s count, the three acts', () => {
    for (const sel of ['.pill.warn', '.pill.reason', '.chip.draft', '.draft .held-why', '.pc-wait', 'nav.side .navcount']) {
      expect(SIGNAL_BEFORE.waiting, sel).toContain(sel);
      expect(bodyOf(`${sel}::before`), sel).toContain(NEEDS_DOT);
    }
    expect(bodyOf('.btn.send.needs::before')).toContain(NEEDS_DOT);
    // Today's band and the Inbox's reason are drawn with the element form
    expect(signalMark('waiting')).toBe('<span class="dot warn shape s-waiting" aria-hidden="true"></span>');
    // the site's example says it the product's way
    expect(SITE_CSS).toContain(`.site-draft-tag::before { ${NEEDS_DOT}`);
  });

  it('the deep FILL is the act that answers what waits and the rail\'s count — white words, the white dot, no frame', () => {
    const act = bodyOf('.btn.send.needs');
    expect(act).toContain('background:var(--color-needs)');
    expect(act).toContain('color:var(--color-surface)');
    expect(act).toContain('border-color:transparent');           // its edge is its fill
    const count = rules.find((r) => r.sel === 'nav.side .navcount')!.body;
    expect(count).toContain('background:var(--color-needs)');
    expect(count).toContain('color:var(--color-surface)');
  });

  it('a needs act that cannot be pressed goes quiet like every other button — its fill no longer outranks the quiet rule', () => {
    const quiet = bodyOf('.btn.send.needs:disabled');
    expect(quiet).toContain('background:var(--color-paper)');
    expect(quiet).toContain('color:var(--color-ink-secondary)');
  });

  it('in greyscale the needs act is told from the brand act by its SHAPE: only the needs act carries the dot', () => {
    expect(bodyOf('.btn.send')).toContain('background:var(--color-brand)');
    const discs = rules.filter((r) => r.body.includes(NEEDS_DOT)).flatMap((r) => r.sel.split(',').map((x) => x.trim()));
    expect(discs).toContain('.btn.send.needs::before');
    expect(discs.filter((x) => /\.btn/.test(x))).toEqual(['.btn.send.needs::before']);
  });

  it('a chore is the OPEN ring in the secondary ink; the solid disc is a customer waiting — two shapes, not two colours', () => {
    expect(todoMark()).toBe('<span class="dot todo shape s-chore" aria-hidden="true"></span>');
    expect(css).toContain('.dot.todo { color:var(--color-ink-secondary); }');
    for (const sel of TODO_BEFORE) {
      // The open ring, drawn (marks.ts), never a font's ○ — and never the needs dot.
      expect(bodyOf(`${sel}::before`), sel).toContain(`mask-image:${shapeUrl('chore')}`);
      expect(bodyOf(`${sel}::before`), sel).not.toContain(NEEDS_DOT);
      const own = rules.filter((r) => r.sel === sel.replace(':not(.bad)', '') && /(^|;)\s*color:/.test(r.body));
      for (const r of own) expect(r.body, sel).not.toMatch(/color:\s*var\(--color-needs\)/);
    }
    // the chores are not in the waiting signal's list
    for (const chore of ['.fwarn', '.imp-warn', '.sr-value.warn', '.prob']) expect(SIGNAL_BEFORE.waiting, chore).not.toContain(chore);
  });

  it('keeps its shape in a forced-colours mode: the glyph comes back, the drawn discs keep the system\'s colour', () => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
    expect(forced).toMatch(/\.dot\.warn \{[^}]*text-indent:0/);
    expect(forced).toContain('.btn.send.needs::before');
    expect(forced).toContain('forced-color-adjust:none');
  });
});

describe('"the assistant did this" reads without the hue: the name tag', () => {
  it('its wash as the ground, its light words, a chip — the class `.as-tag`, and the label wherever it is drawn today', () => {
    for (const sel of ['.as-tag', '.msg-by .as', '#approve .top > .as']) {
      const b = bodyOf(sel);
      expect(b, sel).toContain('background:var(--color-assistant-wash)');
      expect(b, sel).toContain('color:var(--color-assistant)');
      expect(b, sel).toContain('border-radius:var(--radius-chip)');
    }
    expect(bodyOf('.pill.as')).toContain('background:var(--color-assistant-wash)');
    // its replies sit on the same wash, with no hairline (a person's keep theirs)
    expect(bodyOf('.msg.outbound .bubble.by-as')).toContain('background:var(--color-assistant-wash)');
    expect(bodyOf('.msg.outbound .bubble.by-as')).toContain('border-color:transparent');
  });

  it('the brand never wears a meaning\'s shape, and the meanings never wear the brand', () => {
    for (const r of rules) {
      const sels = r.sel.split(',').map((x) => x.trim());
      if (sels.some((x) => SIGNAL_BEFORE.waiting.includes(x) || ['.as-tag', '.pill.as', '.dot.warn', '.btn.send.needs'].includes(x))) {
        expect(r.body, r.sel).not.toMatch(BRAND);
      }
    }
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
