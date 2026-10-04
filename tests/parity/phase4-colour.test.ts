import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, loginPage, signalMark, SIGNAL_BEFORE, TODO_BEFORE, type Signal } from '../../src/api/web/layout.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { setupFrom } from '../../src/db/setup.js';
import { linkedCss } from './linked-css.js';
import { shapeUrl } from '../../src/api/web/marks.js';

/**
 * PHASE 4 OF THE UI REBUILD (2026-10-02) — colour does four jobs, the same on
 * every page, and never alone (tokens.ts `signal`):
 *
 *   ok ✓ green · waiting ○ amber · failed ✕ red · the assistant ✦ magenta
 *
 * Every rule in the stylesheets that paints TEXT in one of those four colours
 * must say how the same thing is said without the colour: the stylesheet draws
 * the shape before the words (SIGNAL_BEFORE), or it is named below with the
 * way its shape is drawn. A new use of a signal colour that is neither fails
 * here, so colour cannot quietly come back as decoration.
 */

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/api/web');
const appCss = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
const doorCss = linkedCss(loginPage({ locale: 'en', path: '/login' }));

// The warmth pass (2026-10-04) — waiting is the deep magenta, `--color-needs`.
const JOB_OF_VAR: Readonly<Record<string, Signal>> = { ok: 'ok', needs: 'waiting', warn: 'failed', assistant: 'assistant' };

/** Every rule as (selector, declarations), comments out, @media wrappers looked through. */
const rules = (css: string): { sel: string; body: string }[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

/** Each selector whose TEXT is painted a signal colour, with the job. */
const textInSignalColour = (css: string): { sel: string; job: Signal }[] =>
  rules(css).flatMap((r) => {
    const m = /(?:^|[;{\s])color:\s*var\(--color-(ok|needs|warn|assistant)\)/.exec(r.body);
    return m ? r.sel.split(',').map((s) => ({ sel: s.trim(), job: JOB_OF_VAR[m[1]!]! })) : [];
  });

/**
 * The colours whose shape is not drawn by `::before` — and how it IS drawn.
 *   mark  the element IS the shape (a renderer writes ✓ ○ ✕ ✦ into it)
 *   text  the words open with the shape, written by the renderer
 *   row   the row it sits in opens with the shape
 *   verb  a button: its word says what it does; red says it takes something away
 */
const DRAWN: Readonly<Record<string, readonly ['mark' | 'text' | 'row' | 'verb', string]>> = {
  '.dot.ok': ['mark', 'signalMark'], '.dot.warn': ['mark', 'signalMark'], '.dot.bad': ['mark', 'signalMark'], '.dot.as': ['mark', 'signalMark'],
  '.as': ['mark', 'the ✦ beside what the assistant wrote, and its name beside the ✦'],
  '.is-needs .cr-mark': ['mark', 'ROW_MARK ○'], '.is-hers .cr-mark': ['mark', 'ROW_MARK ✦'],
  '.is-needs .cr-why': ['row', 'the row opens with ○'],
  // The warmth run, phase 4 — the Inbox row's waiting words open with signalMark's ○.
  '.ir-wait': ['text', 'signalMark ○ before the words'],
  '#approve summary .c.warn': ['text', '○ Not every figure has a source'],
  '.reasons .mk.warn': ['mark', '○ beside the figure with no source'],
  '.ok-line': ['text', '✓ before the calm sentence'],
  '.tw-need': ['text', 'Today\'s waiting count: signalMark ○ before the words (today.ts waitingHead)'],
  '.pr.done .mk': ['mark', '✓'], '.chk.ok .mk': ['mark', '✓'], '.chk.bad .mk': ['mark', '✕'],
  '.pcase.ok .pmark': ['mark', '✓'], '.pcase.bad .pmark': ['mark', '✕'],
  '.ditem.ok': ['text', '✓ before each thing the assistant does alone'], '.ditem.warn': ['text', '○ before each it does not yet'],
  '.cond.met': ['text', '✓ / ○ before each condition'],
  '.badge.sys': ['row', 'the row opens with ✓'],
  '.verdict.ok': ['text', '✓ All ready'],
  '.cert.on': ['text', '✓ before a certification that is on'],
  '.btn.danger': ['verb', 'Remove, Disconnect, Revoke…'],
  // The warmth run (2026-10-03): today's marker is magenta's third job (the owner's words), said by its word.
  '.cal-now': ['text', 'the word "Today" itself'],
  '.mo td.today .mo-d': ['text', "today's date, the cell's own number, in weight as well as colour"],
};

describe('phase 4 · the four signals', () => {
  it('are four, each with its own shape', () => {
    const s = DESIGN_TOKENS.signal;
    expect(Object.keys(s).sort()).toEqual(['assistant', 'failed', 'ok', 'waiting']);
    expect(new Set(Object.values(s)).size).toBe(4);
    expect(s).toEqual({ ok: '✓', waiting: '○', failed: '✕', assistant: '✦' });
    // the colour that paints each shape's words: two magentas, two jobs
    expect(Object.keys(JOB_OF_VAR).sort()).toEqual(['assistant', 'needs', 'ok', 'warn']);
    // The type pass (2026-10-04): each shape is DRAWN (marks.ts) — no face the product serves has ✓ ○ ✕ ✦, so as
    // characters they came from the device's fonts (SF Pro, Zapf Dingbats). The characters stay the shapes' names.
    for (const [k, v] of Object.entries(s)) {
      expect(signalMark(k as Signal)).toBe(`<span class="dot ${({ ok: 'ok', waiting: 'warn', failed: 'bad', assistant: 'as' } as Record<string, string>)[k]} shape s-${k}" aria-hidden="true"></span>`);
      expect(signalMark(k as Signal)).not.toContain(v);
      expect(new Set(Object.keys(s).map((x) => shapeUrl(x as Signal))).size).toBe(4);
    }
  });

  it('every text painted in a signal colour carries its shape — drawn before it, or named here with how', () => {
    const before = new Map<string, Signal>();
    for (const [job, sels] of Object.entries(SIGNAL_BEFORE) as [Signal, readonly string[]][]) for (const x of sels) before.set(x, job);
    const unexplained: string[] = [];
    // The reading finds what it looks for: the app's sheet paints dozens of things in the four colours.
    expect(textInSignalColour(appCss).length).toBeGreaterThan(30);
    expect(textInSignalColour(doorCss).map((x) => x.sel)).toContain('.err');
    for (const css of [appCss, doorCss]) {
      for (const { sel, job } of textInSignalColour(css)) {
        if (before.has(sel) || DRAWN[sel] || ['.err', '.fld-err'].includes(sel)) {
          // A shape drawn before must be the shape of the colour the words are in.
          if (before.has(sel)) expect(before.get(sel), `${sel} is ${job} but draws the ${before.get(sel)} shape`).toBe(job);
          continue;
        }
        unexplained.push(`${sel} (${job})`);
      }
    }
    expect(unexplained, 'colour with no shape: add the selector to SIGNAL_BEFORE (layout.ts) or say here how its shape is drawn').toEqual([]);
  });

  it('the stylesheet really draws each shape before the words, and gives a screen reader nothing to say for it', () => {
    const body = (sel: string, css = appCss) => rules(css).find((r) => r.sel.split(',').map((s) => s.trim()).includes(`${sel}::before`))?.body ?? '';
    for (const [job, sels] of Object.entries(SIGNAL_BEFORE) as [Signal, readonly string[]][]) {
      for (const sel of sels) {
        expect(body(sel), sel).toContain('content:""');
        expect(body(sel), sel).toContain(`mask-image:${shapeUrl(job)}`);
        expect(body(sel), sel).toContain('background-color:currentColor');
      }
    }
    expect(body('.err', doorCss)).toContain(`mask-image:${shapeUrl('failed')}`);
    // no signal's character is ever drawn as text by a stylesheet
    for (const css of [appCss, doorCss]) for (const ch of Object.values(DESIGN_TOKENS.signal)) expect(css).not.toContain(`content:"${ch}"`);
  });

  it('a shape means one job: no stylesheet draws a signal\'s shape for another', () => {
    let seen = 0;
    for (const css of [appCss, doorCss]) {
      for (const r of rules(css)) {
        const job = (Object.keys(DESIGN_TOKENS.signal) as Signal[]).find((x) => r.body.includes(`mask-image:${shapeUrl(x)}`));
        if (!job) continue;
        seen += 1;
        for (const sel of r.sel.split(',').map((s) => s.trim())) {
          if (sel === `.s-${job}`) continue;            // the drawn element's own class (signalMark, shape())
          const host = sel.replace(/::before$/, '');
          // The warmth run's re-audit (w4-whole-06): a chore's ○ is the to-do mark, in the secondary ink — never magenta.
          const todo = job === 'waiting' && TODO_BEFORE.includes(host);
          expect(SIGNAL_BEFORE[job].includes(host) || todo || ['.err', '.fld-err'].includes(host), `${sel} draws ${job}`).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  // THE WARMTH RUN (2026-10-03) — the assistant's words sit on its own WASH
  // (`--color-assistant-wash`, a pale ground under ink), so a newcomer tells
  // them from a person's at a glance. The magenta itself is still never a fill,
  // a border or a button, and the wash is only ever a ground: never a frame.
  it('magenta is the assistant\'s hand only: never a fill, a border or a button; its wash is a ground, never a frame', () => {
    for (const r of rules(appCss)) {
      if (!r.body.includes('--color-assistant')) continue;
      expect(r.body, r.sel).not.toMatch(/(background|border[a-z-]*|outline|fill|box-shadow)\s*:[^;]*--color-assistant(?!-wash)/);
      expect(r.body, r.sel).not.toMatch(/(border[a-z-]*|outline|fill|box-shadow)\s*:[^;]*--color-assistant-wash/);
      expect(r.sel, r.sel).not.toMatch(/\.btn/);
    }
  });

  it('no renderer draws a state with a bare dot, a cross of its own, or a picture in its own colours', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(WEB).filter((x) => x.endsWith('.ts') && x !== 'layout.ts')) {
      const src = readFileSync(join(WEB, f), 'utf8');
      if (/class="dot\b/.test(src)) offenders.push(`${f}: a dot not drawn by signalMark`);
      for (const ch of ['✗', '🎉', '⚠', '⭐']) if (src.includes(ch)) offenders.push(`${f}: ${ch}`);
      if (/class="pill [a-z ]*">[^<$]*●/.test(src) || /'● '/.test(src)) offenders.push(`${f}: ● inside a pill (the stylesheet draws the pill's shape)`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('phase 4 · Setup says which values are states', () => {
  const scope = (over: Partial<RequestScope> = {}): RequestScope => ({
    name: null, several: false, outreach: false,
    setup: setupFrom({ profile: false, products: true, name: false, channels: true, first_success: false }), ...over,
  });
  const html = withWorkspace(scope(), () => renderSetup({
    people: 2, alerts: { available: true, phones: 1 }, signIn: { email: 'owner@example.test' },
    billing: { configured: true, exempt: false, status: 'past_due' }, dataWaiting: 2,
  }, 'en', null));
  const valueOf = (href: string) => new RegExp(`href="${href}">[\\s\\S]*?<span class="sr-value([^"]*)"`).exec(html)?.[1];

  it('done or on ✓, waiting ○, did not happen ✕ — and a value that only names something carries none', () => {
    expect(valueOf('/app/guide')).toBe(' warn');               // 2 of 5 done
    expect(valueOf('/app/onboarding')).toBe(' warn');          // name not confirmed
    expect(valueOf('/app/settings/alerts')).toBe(' ok');       // a phone gets them
    expect(valueOf('/app/settings/billing')).toBe(' bad');     // a payment failed
    expect(valueOf('/app/settings/data')).toBe(' warn');       // two requests wait
    expect(valueOf('/app/settings/language')).toBe('');        // a language is a name, not a state
    expect(valueOf('/app/settings/people')).toBe('');
    expect(valueOf('/app/settings/account')).toBe('');
    // phase 7 — the profile, the kind and the channels are My business's rows
    // now; their states are held in warmth-settings-business.test.ts.
  });
});
