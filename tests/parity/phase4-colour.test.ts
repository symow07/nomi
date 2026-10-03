import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, loginPage, signalMark, SIGNAL_BEFORE, type Signal } from '../../src/api/web/layout.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { setupFrom } from '../../src/db/setup.js';
import { linkedCss } from './linked-css.js';

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

const JOB_OF_VAR: Readonly<Record<string, Signal>> = { ok: 'ok', waiting: 'waiting', warn: 'failed', assistant: 'assistant' };

/** Every rule as (selector, declarations), comments out, @media wrappers looked through. */
const rules = (css: string): { sel: string; body: string }[] =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

/** Each selector whose TEXT is painted a signal colour, with the job. */
const textInSignalColour = (css: string): { sel: string; job: Signal }[] =>
  rules(css).flatMap((r) => {
    const m = /(?:^|[;{\s])color:\s*var\(--color-(ok|waiting|warn|assistant)\)/.exec(r.body);
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
  '#approve summary .c.warn': ['text', '○ Not every figure has a source'],
  '.reasons .mk.warn': ['mark', '○ beside the figure with no source'],
  '.ok-line': ['text', '✓ before the calm sentence'],
  '.pr.done .mk': ['mark', '✓'], '.chk.ok .mk': ['mark', '✓'], '.chk.bad .mk': ['mark', '✕'],
  '.pcase.ok .pmark': ['mark', '✓'], '.pcase.bad .pmark': ['mark', '✕'],
  '.ditem.ok': ['text', '✓ before each thing the assistant does alone'], '.ditem.warn': ['text', '○ before each it does not yet'],
  '.cond.met': ['text', '✓ / ○ before each condition'],
  '.badge.sys': ['row', 'the row opens with ✓'],
  '.verdict.ok': ['text', '✓ All ready'],
  '.cert.on': ['text', '✓ before a certification that is on'],
  '.btn.danger': ['verb', 'Remove, Disconnect, Revoke…'],
  // The warmth run (2026-10-03): today's marker is magenta's third job (the owner's words), said by its word.
  '.cal-now': ['word', 'the word "Today" itself'],
  '.mo td.today .mo-d': ['word', "today's date, the cell's own number, in weight as well as colour"],
};

describe('phase 4 · the four signals', () => {
  it('are four, each with its own shape', () => {
    const s = DESIGN_TOKENS.signal;
    expect(Object.keys(s).sort()).toEqual(['assistant', 'failed', 'ok', 'waiting']);
    expect(new Set(Object.values(s)).size).toBe(4);
    expect(s).toEqual({ ok: '✓', waiting: '○', failed: '✕', assistant: '✦' });
    for (const [k, v] of Object.entries(s)) expect(signalMark(k as Signal)).toContain(`aria-hidden="true">${v}</span>`);
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

  it('the stylesheet really draws each shape before the words, with an empty alternative for a screen reader', () => {
    const body = (sel: string, css = appCss) => rules(css).find((r) => r.sel.split(',').map((s) => s.trim()).includes(`${sel}::before`))?.body ?? '';
    for (const [job, sels] of Object.entries(SIGNAL_BEFORE) as [Signal, readonly string[]][]) {
      const shape = DESIGN_TOKENS.signal[job];
      for (const sel of sels) {
        expect(body(sel), sel).toContain(`content:"${shape}"`);
        expect(body(sel), sel).toContain(`content:"${shape}" / ""`);
      }
    }
    expect(body('.err', doorCss)).toContain(`content:"${DESIGN_TOKENS.signal.failed}"`);
  });

  it('a shape means one job: no stylesheet draws a signal\'s shape for another', () => {
    for (const css of [appCss, doorCss]) {
      for (const r of rules(css)) {
        const drawn = /content:"([^"]+)"/.exec(r.body)?.[1];
        if (!drawn) continue;
        const job = (Object.entries(DESIGN_TOKENS.signal).find(([, v]) => v === drawn) ?? [])[0];
        if (!job) continue;
        for (const sel of r.sel.split(',').map((s) => s.trim().replace(/::before$/, ''))) {
          expect(SIGNAL_BEFORE[job as Signal].includes(sel) || ['.err', '.fld-err'].includes(sel), `${sel} draws ${drawn}`).toBe(true);
        }
      }
    }
  });

  it('magenta is the assistant\'s hand only: never a fill, a wash, a border or a button', () => {
    for (const r of rules(appCss)) {
      if (!r.body.includes('--color-assistant')) continue;
      expect(r.body, r.sel).not.toMatch(/(background|border[a-z-]*|outline|fill|box-shadow)\s*:[^;]*--color-assistant/);
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
    kind: 'Retailer', people: 2, alerts: { available: true, phones: 1 }, signIn: { email: 'owner@example.test' },
    billing: { configured: true, exempt: false, status: 'past_due' }, dataWaiting: 2,
  }, 'en', null));
  const valueOf = (href: string) => new RegExp(`href="${href}">[\\s\\S]*?<span class="sr-value([^"]*)"`).exec(html)?.[1];

  it('done or on ✓, waiting ○, did not happen ✕ — and a value that only names something carries none', () => {
    expect(valueOf('/app/guide')).toBe(' warn');               // 2 of 5 done
    expect(valueOf('/app/onboarding')).toBe(' warn');          // name not confirmed
    expect(valueOf('/app/settings/profile')).toBe(' warn');    // to do
    expect(valueOf('/app/channels')).toBe(' ok');              // connected
    expect(valueOf('/app/settings/alerts')).toBe(' ok');       // a phone gets them
    expect(valueOf('/app/settings/billing')).toBe(' bad');     // a payment failed
    expect(valueOf('/app/settings/data')).toBe(' warn');       // two requests wait
    expect(valueOf('/app/settings/business')).toBe('');        // a kind is a name, not a state
    expect(valueOf('/app/settings/people')).toBe('');
    expect(valueOf('/app/settings/account')).toBe('');
  });
});
