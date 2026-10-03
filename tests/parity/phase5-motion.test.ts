import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { shell } from '../../src/api/web/layout.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { mintFlash, readFlash, flashBanner, liveRegion, UNDO_ACTION } from '../../src/api/web/flash.js';
import { conversationWatch, practiceWatch } from '../../src/api/web/live.js';
import { workingLine } from '../../src/api/web/inbox.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { linkedCss } from './linked-css.js';

/**
 * PHASE 5 OF THE UI REBUILD (2026-10-02) — MOTION.
 *
 * The three durations the tokens defined and nothing used, and one curve; all
 * of it only for a reader who has not asked for less motion. Undo where taking
 * something away only sets it aside. The assistant at work, shown where its
 * reply will be, and the reply drawn into the page without a reload.
 */

const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of every `@media (…)` block whose condition contains `cond`, braces matched. */
const mediaBlocks = (text: string, cond: string): string[] => {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const i = text.indexOf(`@media (${cond})`, at);
    if (i < 0) return out;
    const open = text.indexOf('{', i);
    let depth = 0; let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push(text.slice(open + 1, j));
    at = j + 1;
  }
};
const without = (text: string, blocks: readonly string[]): string => blocks.reduce((s, b) => s.replace(b, ''), text);

describe('phase 5 · three durations, one curve, and nothing moves for a reader who asked for less', () => {
  const calm = mediaBlocks(css, 'prefers-reduced-motion: no-preference');
  const still = mediaBlocks(css, 'prefers-reduced-motion: reduce');

  it('the tokens: 120, 200 and 300 ms, and one decelerating curve that never overshoots', () => {
    // The warmth run's re-audit (w4-whole-21): within the owner's 100–250 ms.
    expect(DESIGN_TOKENS.motionMs).toEqual({ fast: 120, normal: 200, max: 250 });
    const m = /^cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)$/.exec(DESIGN_TOKENS.motionEase);
    expect(m).not.toBeNull();
    const [x1, y1, x2, y2] = m!.slice(1).map(Number) as [number, number, number, number];
    expect(y1).toBeLessThanOrEqual(1); expect(y2).toBeLessThanOrEqual(1);   // no overshoot
    expect(x1).toBeLessThan(x2 === 0 ? 1 : x2 + 1);                          // a curve, not a jump
    expect(css).toContain(`--motion-ease: ${DESIGN_TOKENS.motionEase};`);
  });

  it('each of the three is used, by name', () => {
    const moving = calm.join('\n');
    for (const d of ['fast', 'normal', 'max']) expect(moving, d).toContain(`var(--motion-${d})`);
    expect(moving).toContain('var(--motion-ease)');
  });

  it('every rule that moves something sits inside prefers-reduced-motion: no-preference', () => {
    const rest = without(without(css, calm), still);
    // Outside those blocks: no transition and no animation (keyframes are only names).
    const loose = [...rest.matchAll(/(?:^|[;{\s])(transition|animation)(?:-[a-z-]+)?\s*:[^;}]*/g)]
      .map((m) => m[0].trim()).filter((d) => !/^@keyframes/.test(d));
    expect(loose).toEqual([]);
  });

  it('no duration is written as a number: the moving rules name a token, and only the reduce block may say 1ms', () => {
    const moving = calm.join('\n');
    expect(moving.match(/\b\d+(?:\.\d+)?m?s\b/g) ?? []).toEqual([]);
    expect(still).toHaveLength(1);
    expect(still[0]).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:1ms !important;[^}]*transition-duration:1ms !important;/);
  });

  it('a menu or a fold arrives fast; a notice, the draft and the at-work line rise at normal speed; the dots breathe at max', () => {
    const moving = calm.join('\n');
    expect(moving).toMatch(/details\[open\] > :not\(summary\) \{ animation:nomi-arrive var\(--motion-fast\)/);
    expect(moving).toMatch(/\.flash, #approve, \.working \{ animation:nomi-rise var\(--motion-normal\)/);
    expect(moving).toMatch(/\.working \.dots i \{ animation:nomi-breathe var\(--motion-max\)/);
  });
});

describe('phase 5 · undo over confirm', () => {
  const SECRET = 's'.repeat(32);
  const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
  const now = Date.UTC(2026, 9, 2, 12);

  it('a notice can carry the way back — only to a thing\'s own restore, by its id', () => {
    expect(UNDO_ACTION.test(`/app/settings/forbidden/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/settings/closures/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/knowledge/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/calendar/entries/${ID}/restore`)).toBe(true);
    for (const bad of [`/app/settings/people/${ID}/remove`, `/app/settings/forbidden/${ID}/restore?x=1`, 'https://evil.test/app/knowledge/x/restore',
      `/app/settings/forbidden/not-an-id/restore`, `/app/channels/whatsapp/disconnect`]) expect(UNDO_ACTION.test(bad), bad).toBe(false);
  });

  it('read back in the reader\'s language, the notice draws one Undo that posts there', () => {
    for (const l of LOCALES) {
      const f = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.removed' }], now, `/app/settings/forbidden/${ID}/restore`), l, now);
      expect(f?.undo, l).toEqual({ action: `/app/settings/forbidden/${ID}/restore`, label: t(l, 'common.undo') });
      const html = flashBanner(f);
      expect(html, l).toContain(`<form method="post" action="/app/settings/forbidden/${ID}/restore" class="undo"><button class="btn" type="submit">${t(l, 'common.undo')}</button></form>`);
      expect(html, l).toContain('class="flash has-undo" role="status"');
    }
  });

  it('an address of any other shape is dropped when the notice is made, and a refusal never offers one', () => {
    const odd = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.removed' }], now, '/app/settings/people/x/remove'), 'en', now);
    expect(odd?.undo).toBeUndefined();
    const refused = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.failed' }], now, `/app/settings/forbidden/${ID}/restore`), 'en', now);
    expect(refused?.bad).toBe(true);
    expect(refused?.undo).toBeUndefined();
    expect(flashBanner(refused)).not.toContain('class="undo"');
  });
});

describe('phase 5 · the assistant at work, in place', () => {
  it('the line: its ✦, what it is doing in each language, three dots, said once to a screen reader', () => {
    for (const l of LOCALES) {
      const line = workingLine(l);
      expect(line, l).toMatch(/^<div class="block working" role="status"><span class="as" aria-hidden="true">✦<\/span> /);
      expect(line, l).toContain('<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>');
    }
    expect(t('en', 'conv.working', { name: 'Lily' })).toBe('Lily is writing a reply');
  });

  it('a page drawn while the assistant is at work says so to its script; one drawn otherwise does not', () => {
    const CONV = '11111111-2222-4333-8444-555555555555';
    expect(liveRegion('en', conversationWatch(CONV, '1.0.aaaaaaaa', true))).toContain('data-live-working="1"');
    expect(liveRegion('en', conversationWatch(CONV, '1.0.aaaaaaaa'))).not.toContain('data-live-working');
    expect(liveRegion('en', practiceWatch('1.0.aaaaaaaa', true))).toContain('data-live-working="1"');
  });
});

/* ── The script's redraw, run against a small page ─────────────────────────── */

type Listener = (e: Record<string, unknown>) => void;
class Nd {
  readonly listeners = new Map<string, Listener[]>();
  children: Nd[] = [];
  parent: Nd | null = null;
  value = ''; selectionStart = 0; selectionEnd = 0; textContent = '';
  scrolled: unknown = undefined;
  open = false;
  showModal?: () => void;
  close(): void { this.open = false; }
  submitted: Nd[] = [];
  requestSubmit?: (b: Nd) => void;
  form: Nd | null = null;
  get className(): string { return this.attrs['class'] ?? ''; }
  set className(v: string) { this.attrs['class'] = v; }
  closest(sel: string): Nd | null { for (let x: Nd | null = this; x; x = x.parent) if (matches(sel)(x)) return x; return null; }
  fire(type: string, target: Nd) {
    const ev: Record<string, unknown> = { type, target, defaultPrevented: false, stopped: false };
    ev['preventDefault'] = () => { ev['defaultPrevented'] = true; };
    ev['stopPropagation'] = () => { ev['stopped'] = true; };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
  content: { cloneNode: () => Nd } | undefined;
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}) {}
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  getAttribute(n: string): string | null { return n in this.attrs ? this.attrs[n]! : null; }
  get id(): string { return this.attrs['id'] ?? ''; }
  get firstChild(): Nd | null { return this.children[0] ?? null; }
  appendChild(n: Nd): Nd {
    if (n.tagName === '#fragment') { for (const c of [...n.children]) this.appendChild(c); return n; }
    if (n.parent) n.parent.removeChild(n);
    n.parent = this; this.children.push(n); return n;
  }
  removeChild(n: Nd): Nd { this.children = this.children.filter((c) => c !== n); n.parent = null; return n; }
  contains(n: Nd | null): boolean { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  all(): Nd[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel: string): Nd | null { return this.all().find(matches(sel)) ?? null; }
  querySelectorAll(sel: string): Nd[] { return this.all().filter(matches(sel)); }
  getBoundingClientRect() { return { top: 300, bottom: 340 }; }
  scrollIntoView(o: unknown) { this.scrolled = o; }
}
const matches = (sel: string) => (e: Nd): boolean => {
  const m = /^([a-z]*)(?:\.([a-z-]+))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel);
  if (!m) return false;
  return (!m[1] || e.tagName.toLowerCase() === m[1])
    && (!m[2] || (e.attrs['class'] ?? '').split(' ').includes(m[2]))
    && (!m[3] || (e.getAttribute(m[3]) !== null && (m[4] === undefined || e.getAttribute(m[3]) === m[4])));
};

function page(answers: ((u: string, init: Record<string, unknown>) => Promise<unknown>)[], calmReader = false) {
  const root = new Nd('HTML');
  const main = root.appendChild(new Nd('MAIN'));
  const region = main.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/conversation/c?since=1.0.aaaaaaaa', 'data-live-working': '1' }));
  main.appendChild(new Nd('DIV', { class: 'block working', role: 'status' }));
  const tpl = root.appendChild(new Nd('TEMPLATE', { 'data-live-news': 'reply' }));
  tpl.content = { cloneNode: () => { const f = new Nd('#fragment'); f.appendChild(new Nd('DIV', { class: 'flash live-line', said: 'reply' })); return f; } };
  // What the same address answers now: the reply waiting, and a page that no longer watches for work.
  const fresh = new Nd('MAIN');
  fresh.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/conversation/c?since=1.d.aaaaaaaa' }));
  const approve = fresh.appendChild(new Nd('SECTION', { id: 'approve' }));
  const doc = Object.assign(new Nd('#document'), {
    visibilityState: 'visible', title: 'Before', activeElement: null as Nd | null,
    querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
    getElementById: (id: string) => root.all().find((e) => e.id === id) ?? null,
    adoptNode: (n: Nd) => n,
  });
  let now = 0; let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const asked: { url: string; init: Record<string, unknown> }[] = [];
  const queue = [...answers];
  const location = { pathname: '/app/inbox/c', search: '', href: 'https://nomi.test/app/inbox/c', reloads: 0, reload() { this.reloads += 1; } };
  const win = Object.assign(new Nd('#window'), {
    innerHeight: 800,
    matchMedia: (q: string) => ({ matches: calmReader && q.includes('reduce') }),
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
    fetch: (u: string, init: Record<string, unknown>) => { asked.push({ url: u, init }); const n = queue.shift(); return n ? n(u, init) : Promise.resolve(json({ news: false, working: true })); },
  });
  const context = vm.createContext({
    window: win, document: doc, location, history: { scrollRestoration: 'auto', state: null, replaceState: () => undefined }, URL,
    fetch: win.fetch,
    DOMParser: class { parseFromString() { return { title: 'After', querySelector: (s: string) => (s === 'main' ? fresh : null) }; } },
    setTimeout: (fn: () => void, ms: number) => { seq += 1; due.set(seq, { at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id: number) => { due.delete(id); },
  });
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    doc, main, region, approve, asked, location,
    run: () => new vm.Script(LIVE_SCRIPT).runInContext(context),
    waits: () => [...due.values()].map((d) => d.at - now).sort((a, b) => a - b),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
        for (let i = 0; i < 5; i++) await flush();
      }
      now = until; for (let i = 0; i < 5; i++) await flush();
    },
  };
}
const json = (body: unknown) => ({ type: 'basic', status: 200, ok: true, json: () => Promise.resolve(body) });
const htmlOf = (ok = true) => ({ type: 'basic', status: ok ? 200 : 500, ok, text: () => Promise.resolve('<html>') });

describe('phase 5 · the script draws the reply into the page, without a reload', () => {
  it('while the assistant is at work it asks every four seconds, not twenty', async () => {
    const p = page([]);
    p.run();
    expect(p.waits()).toEqual([4_000]);
    await p.advance(4_000);
    expect(p.asked).toHaveLength(1);
    expect(p.waits()).toEqual([4_000]);
  });

  it('when the work is done it fetches its own address as a page and draws that page\'s main in place', async () => {
    const p = page([
      () => Promise.resolve(json({ news: true, what: 'reply' })),
      () => Promise.resolve(htmlOf()),
    ]);
    p.run();
    await p.advance(4_000);
    expect(p.asked[1]).toMatchObject({ url: '/app/inbox/c', init: { credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html' } } });
    expect(p.main.children.map((c) => c.attrs['id'] ?? c.attrs['class'])).toEqual(['live', 'approve']);
    expect(p.doc.title).toBe('After');
    expect(p.location.reloads).toBe(0);
    // the reply's card brought into view, smoothly — the at-work line had been in view
    expect(p.approve.scrolled).toEqual({ block: 'nearest', behavior: 'smooth' });
    // and the new page watches as a page does when nothing is at work
    expect(p.waits()).toEqual([20_000]);
  });

  it('for a reader who asked for less motion the card is brought into view at once', async () => {
    const p = page([() => Promise.resolve(json({ news: false })), () => Promise.resolve(htmlOf())], true);
    p.run();
    await p.advance(4_000);
    expect(p.approve.scrolled).toEqual({ block: 'nearest', behavior: 'auto' });
  });

  it('if the page cannot be had, the line is shown instead, and nothing reloads', async () => {
    const p = page([() => Promise.resolve(json({ news: true, what: 'reply' })), () => Promise.resolve(htmlOf(false))]);
    p.run();
    await p.advance(4_000);
    expect(p.region.children.map((c) => c.attrs['said'])).toEqual(['reply']);
    expect(p.main.querySelector('.working')).not.toBeNull();
    expect(p.location.reloads).toBe(0);
  });
});

/* ── Asking first, in the product's own dialog ─────────────────────────────── */

function asks(o: { dialogs: boolean }) {
  const root = new Nd('HTML');
  const form = root.appendChild(new Nd('FORM', { action: '/app/channels/whatsapp/disconnect' }));
  form.requestSubmit = (b: Nd) => { form.submitted.push(b); };
  const button = form.appendChild(new Nd('BUTTON', { class: 'btn danger', 'data-confirm': 'Disconnect WhatsApp? Customers stop reaching you there.' }));
  button.textContent = '  Disconnect ';
  button.form = form;
  const box = root.appendChild(new Nd('DIALOG', { class: 'ask', 'data-ask': '' }));
  if (o.dialogs) box.showModal = () => { box.open = true; };
  const q = box.appendChild(new Nd('P', { 'data-ask-q': '' }));
  const yes = box.appendChild(new Nd('BUTTON', { class: 'btn send', 'data-ask-yes': '' }));
  const no = box.appendChild(new Nd('BUTTON', { class: 'btn', 'data-ask-no': '' }));
  const doc = Object.assign(new Nd('#document'), {
    visibilityState: 'visible', querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
  });
  const win = Object.assign(new Nd('#window'), {
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
  });
  vm.runInContext(LIVE_SCRIPT, vm.createContext({
    window: win, document: doc, location: { pathname: '/app/channels', search: '' }, history: {}, URL,
    setTimeout: () => 0, clearTimeout: () => undefined,
  }));
  return { doc, form, button, box, q, yes, no };
}

describe('phase 5 · asking first in the product\'s own dialog, not the browser\'s grey box', () => {
  it('a click on a button that asks opens the dialog with its question, and that button\'s own word to go ahead', () => {
    const p = asks({ dialogs: true });
    const ev = p.doc.fire('click', p.button);
    expect(ev['defaultPrevented']).toBe(true);
    expect(ev['stopped']).toBe(true);             // the button's own handler — the browser's box — never runs
    expect(p.box.open).toBe(true);
    expect(p.q.textContent).toBe('Disconnect WhatsApp? Customers stop reaching you there.');
    expect(p.yes.textContent).toBe('Disconnect');
    expect(p.yes.className).toBe('btn danger');   // red takes something away, as on the button itself
  });

  it('going ahead submits the form as that button would; Cancel, or a click beside it, does nothing', () => {
    const p = asks({ dialogs: true });
    p.doc.fire('click', p.button);
    for (const fn of p.no.listeners.get('click') ?? []) fn({});
    expect(p.box.open).toBe(false);
    expect(p.form.submitted).toEqual([]);
    p.doc.fire('click', p.button);
    for (const fn of p.box.listeners.get('click') ?? []) fn({ target: p.box });
    expect(p.form.submitted).toEqual([]);
    p.doc.fire('click', p.button);
    for (const fn of p.yes.listeners.get('click') ?? []) fn({});
    expect(p.box.open).toBe(false);
    expect(p.form.submitted).toEqual([p.button]);
  });

  it('in a browser without dialogs the click goes through, and the button asks the old way', () => {
    const p = asks({ dialogs: false });
    const ev = p.doc.fire('click', p.button);
    expect(ev['defaultPrevented']).toBe(false);
    expect(ev['stopped']).toBe(false);
  });

  it('every owner page carries the dialog, closed, its going-ahead and Cancel in the page\'s language', () => {
    for (const l of LOCALES) {
      const html = shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '' });
      expect(html, l).toContain(`<dialog class="ask" aria-labelledby="ask-q" data-ask><p class="ask-q" id="ask-q" data-ask-q></p>`);
      expect(html, l).toContain(`data-ask-no autofocus>${t(l, 'common.cancel')}</button>`);
      expect(html, l).not.toMatch(/<dialog[^>]* open/);
    }
  });
});
