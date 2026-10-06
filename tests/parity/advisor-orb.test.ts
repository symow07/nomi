import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { assetAt, ORB_JS, stylesheetAt } from '../../src/api/web/layout.js';
import { renderAdvisor } from '../../src/api/web/advisor.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';

/**
 * THE ADVISOR'S ORB (2026-10-07; the owner's brief and picks, docs/design/advisor-orb/):
 *   "Use the LIBRARY'S OWN drawing — its real dot geometry, placement, count, sizes and motion, UNCHANGED.
 *   Change ONE thing only: the colour. Map its existing light-to-dark ink ramp onto a magenta-to-paper ramp
 *   (#BE2D6E toward paper #F7F3EE), same depth logic … The resting orb is the SAME component shown larger."
 *   "Advisor page ONLY … RESTING … THINKING … Pauses when the tab is hidden; resumes on return. Reduce motion:
 *   NEITHER state animates … Scripts off / fetch fails: page works, no orb, no layout shift."
 * The one script runs here against a small stand-in for the page, importing the very file the app serves.
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const VENDOR = join(ROOT, 'assets/vendor/thinking-orbs/0.3.2');
const vendored = (f: string) => readFileSync(join(VENDOR, f));
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const SERVED = assetAt(ORB_JS.slice('/assets/'.length))!;
/** The served file, as the browser imports it. */
const ORB_URL = `data:text/javascript;base64,${Buffer.from(String(SERVED.body)).toString('base64')}`;
const hex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const TOKENS = DESIGN_TOKENS.color;
/** The shell's one stylesheet (any address of it names its rules). */
const APP_CSS = stylesheetAt('app.0000000000000000.css')!.css;

describe('the library, vendored: exactly what was published, MIT, and nothing that reaches out', () => {
  it('each file is the published one, byte for byte (the README\'s digests)', () => {
    const readme = vendored('README.md').toString();
    for (const [f, d] of [['index-B8WsUNf5.js', '4b43963f6409d310b9d80e592d4fb0f1435884a59d0c252f6f1b75926c09b949'],
      ['engine.es.js', 'e7dc939abf68eb2890f1a3ed49f129185e04ca690dee905b05820ed27adbf209'],
      ['LICENSE', '915a283980628a0ca9e7b423ebafc6f3a0fa1e630ff17d34e59034808d92011c']] as const) {
      expect(sha(vendored(f)), f).toBe(d);
      expect(readme, f).toContain(d);
    }
    expect(vendored('LICENSE').toString()).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Jakub Antalik\n/);
  });

  it('the core imports nothing — no React, no page, no network, nothing run from text', () => {
    const core = vendored('index-B8WsUNf5.js').toString();
    expect(core).not.toMatch(/\bimport\b|\brequire\(|react|fetch\(|XMLHttpRequest|\bdocument\.|\bwindow\.|eval\(|new Function|localStorage/i);
  });

  it('the two names the script uses are the library\'s own: M is MODE_FRAMES, r is resolvePreset', () => {
    const entry = vendored('engine.es.js').toString();
    expect(entry).toContain('M as MODE_FRAMES');
    expect(entry).toContain('r as resolvePreset');
    const core = vendored('index-B8WsUNf5.js').toString();
    expect(core).toMatch(/MODE_FRAMES as M,/);
    expect(core).toMatch(/resolvePreset as r,/);
    expect(LIVE_SCRIPT).toContain('orb.r(state, 64)');
    expect(LIVE_SCRIPT).toContain('orb.M[pre.mode]');
  });

  it('it is served at an address named by its content, carrying the licence, then the core unchanged', () => {
    expect(ORB_JS).toMatch(/^\/assets\/orb\.[0-9a-f]{16}\.js$/);
    expect(SERVED.type).toBe('text/javascript; charset=utf-8');
    expect(String(SERVED.body)).toBe(`/*! thinking-orbs 0.3.2 — its drawing core, unchanged below this note.\n${vendored('LICENSE')}*/\n${vendored('index-B8WsUNf5.js')}`);
  });
});

// ── A small stand-in for the page ────────────────────────────────────────────

type Call = [string, ...unknown[]];
class Ctx {
  calls: Call[] = [];
  set fillStyle(v: string) { this.calls.push(['fillStyle', v]); }
  set strokeStyle(v: string) { this.calls.push(['strokeStyle', v]); }
  set lineWidth(v: number) { this.calls.push(['lineWidth', v]); }
  setTransform(...a: number[]) { this.calls.push(['setTransform', ...a]); }
  clearRect(...a: number[]) { this.calls.push(['clearRect', ...a]); }
  beginPath() { this.calls.push(['beginPath']); }
  arc(...a: number[]) { this.calls.push(['arc', ...a]); }
  fill() { this.calls.push(['fill']); }
  moveTo(...a: number[]) { this.calls.push(['moveTo', ...a]); }
  lineTo(...a: number[]) { this.calls.push(['lineTo', ...a]); }
  stroke() { this.calls.push(['stroke']); }
}
class El {
  attrs: Record<string, string>;
  children: El[] = [];
  parentNode: El | null = null;
  hidden = false;
  textContent = '';
  value = '';
  width = 0;
  height = 0;
  ctx = new Ctx();
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public tagName: string, attrs: Record<string, string> = {}, public cssWidth = 0) { this.attrs = { ...attrs }; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k]! : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  get isConnected(): boolean { let n: El | null = this; while (n) { if (n.tagName === 'BODY') return true; n = n.parentNode; } return false; }
  get nextSibling(): El | null { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; }
  get childNodes() { return this.children; }
  appendChild(c: El) {
    if (c.tagName === '#fragment') { for (const k of [...c.children]) this.appendChild(k); c.children = []; return c; }
    c.parentNode?.removeChild(c); c.parentNode = this; this.children.push(c); return c;
  }
  insertBefore(c: El, before: El | null) {
    c.parentNode?.removeChild(c); c.parentNode = this;
    const i = before ? this.children.indexOf(before) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c: El) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel: string): El | null { return this.all().find(matches(sel)) ?? null; }
  getContext(kind: string) { return kind === '2d' ? this.ctx : null; }
  getBoundingClientRect() { return { width: this.cssWidth, height: this.cssWidth }; }
  scrollIntoView() { /* nothing to scroll */ }
}
const matches = (sel: string) => (e: El): boolean => {
  if (sel === '.timeline') return (e.attrs['class'] ?? '').split(' ').includes('timeline');
  const m = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(sel);
  return !!m && (!m[1] || e.tagName.toLowerCase() === m[1]) && (!m[2] || m[2] in e.attrs);
};

/** The advisor's page (or any other), as the stand-in draws it. */
function page(o: { advisor?: boolean; resting?: boolean; reduce?: boolean; paper?: string; ink?: string; width?: number; orbUrl?: string; restOnOtherPage?: boolean } = {}) {
  const body = new El('BODY');
  const main = body.appendChild(new El('MAIN'));
  let rest: El | null = null;
  if ((o.advisor !== false && o.resting !== false) || o.restOnOtherPage) {
    const row = main.appendChild(new El('DIV', { class: 'orb-rest-row' }));
    rest = row.appendChild(new El('CANVAS', { class: 'orb-rest', 'data-orb-rest': '', 'data-orb-pace': '0.5',
      // a page that smuggled the orb's whole description onto a canvas — still nothing without the advisor's form
      ...(o.restOnOtherPage ? { 'data-orb': o.orbUrl ?? ORB_URL, 'data-orb-state': 'listening', 'data-orb-ink': 'assistant' } : {}) }, o.width ?? 192));
  }
  const timeline = main.appendChild(new El('DIV', { class: 'timeline' }));
  let form: El | null = null; let box: El | null = null; let tpl: El | null = null;
  if (o.advisor !== false) {
    tpl = main.appendChild(new El('TEMPLATE', { 'data-orb-pending': '' }));
    (tpl as El & { content: unknown }).content = { cloneNode: () => {
      const frag = new El('#fragment');
      const asked = new El('DIV', { class: 'msg outbound' }); asked.appendChild(new El('BDI', { 'data-orb-asked': '' }));
      const wait = new El('DIV', { class: 'msg inbound orb-wait', 'data-orb-wait': '' });
      wait.appendChild(new El('CANVAS', { class: 'orb' }, 64));
      frag.appendChild(asked); frag.appendChild(wait);
      return frag;
    } };
    form = main.appendChild(new El('FORM', { 'data-orb': o.orbUrl ?? ORB_URL, 'data-orb-state': 'listening', 'data-orb-ink': 'assistant' }));
    box = form.appendChild(new El('TEXTAREA'));
    form.appendChild(new El('BUTTON'));
  }
  const docListeners: Record<string, ((e: unknown) => void)[]> = {};
  const winListeners: Record<string, ((e: unknown) => void)[]> = {};
  const frames: ((now: number) => void)[] = [];
  const vars: Record<string, string> = { '--color-assistant': o.ink ?? TOKENS.assistant, '--color-paper': o.paper ?? TOKENS.paper, '--color-ink': TOKENS.ink };
  const doc = {
    readyState: 'loading', visibilityState: 'visible', documentElement: {},
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: () => [],
    addEventListener: (type: string, fn: (e: unknown) => void) => { (docListeners[type] ??= []).push(fn); },
  };
  const win = {
    devicePixelRatio: 2,
    matchMedia: (q: string) => ({ matches: q.includes('reduced-motion') ? !!o.reduce : false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: (n: string) => vars[n] ?? '' }),
    requestAnimationFrame: (fn: (now: number) => void) => { frames.push(fn); return frames.length; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (winListeners[type] ??= []).push(fn); },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  };
  const context = vm.createContext({
    window: win, document: doc, location: { href: 'https://nomi.test/app/advisor', pathname: '/app/advisor', search: '', hash: '' },
    history: { scrollRestoration: 'auto', replaceState() {} }, setTimeout: () => 0, clearTimeout() {}, URL, Promise, Error, Math, Number, String,
  });
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  return {
    body, main, rest, form, box, tpl, timeline, frames, doc,
    run: () => new vm.Script(LIVE_SCRIPT, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(context),
    /** The page finishes loading, and the orb's file arrives. */
    async load() { doc.readyState = 'complete'; for (const fn of winListeners['load'] ?? []) fn({}); for (let i = 0; i < 6; i++) await settle(); },
    /** The browser draws the frames asked for, once each, at `now`. */
    tick(now: number) { const due = frames.splice(0); for (const fn of due) fn(now); return due.length; },
    async ask(q = 'How many customers do I have?') {
      box!.value = q;
      const e = { type: 'submit', target: form, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, submitter: null };
      for (const fn of docListeners['submit'] ?? []) fn(e);
      for (let i = 0; i < 6; i++) await settle();
    },
    hide(hidden: boolean) { doc.visibilityState = hidden ? 'hidden' : 'visible'; for (const fn of docListeners['visibilitychange'] ?? []) fn({}); },
    back() { for (const fn of winListeners['pageshow'] ?? []) fn({ persisted: true }); },
    canvases: () => body.all().filter((e) => e.tagName === 'CANVAS'),
  };
}
/** The calls a canvas received, past its sizing and clearing — what was drawn. */
const drawn = (c: El) => c.ctx.calls.filter(([k]) => k !== 'setTransform' && k !== 'clearRect');
const isColour = (k: string) => k === 'fillStyle' || k === 'strokeStyle';

/** The library's own painter, as its React component calls it, on the same frame. */
async function libraryDraws(t: number, tint: { r: number; g: number; b: number }) {
  const core = await import(pathToFileURL(join(VENDOR, 'index-B8WsUNf5.js')).href) as Record<string, any>;
  const pre = core['r']('listening', 64);
  const ctx = new Ctx();
  core['p'](ctx, core['M'][pre.mode](64, t, pre.opts), false, tint);
  return ctx.calls;
}

describe('the orb is the library\'s own: only the colour is ours', () => {
  it('with the paper at white, the script draws exactly the calls the library\'s own painter draws — resting and thinking', async () => {
    const p = page({ reduce: true, paper: '#FFFFFF' });
    p.run(); await p.load();
    const lib = await libraryDraws(0.6, hex(TOKENS.assistant));
    expect(lib.length).toBeGreaterThan(200);
    expect(drawn(p.rest!)).toEqual(lib);
    await p.ask();
    const thinking = p.canvases().find((c) => c.attrs['class'] === 'orb')!;
    expect(drawn(thinking)).toEqual(lib);
  });

  it('on the page\'s paper: the same dots, sizes, order and strokes; each colour on the line from the assistant\'s magenta to the paper', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const ours = drawn(p.rest!);
    const lib = await libraryDraws(0.6, hex(TOKENS.assistant));
    expect(ours.filter(([k]) => !isColour(k))).toEqual(lib.filter(([k]) => !isColour(k)));
    const tint = hex(TOKENS.assistant); const paper = hex(TOKENS.paper);
    for (const [k, v] of ours.filter(([k]) => isColour(k))) {
      const [r, g, b, a] = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(String(v))!.slice(1).map(Number) as [number, number, number, number];
      // the depth, read off the widest channel (green: 0x2D to 0xF3), and the others on the same line, to rounding
      const w = (g - tint.g) / (paper.g - tint.g);
      expect(w, `${k} ${v}`).toBeGreaterThanOrEqual(-0.003);
      expect(w, `${k} ${v}`).toBeLessThanOrEqual(1.003);
      expect(Math.abs(r - (tint.r + (paper.r - tint.r) * w)), `${k} ${v}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b - (tint.b + (paper.b - tint.b) * w)), `${k} ${v}`).toBeLessThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(1);
    }
    // never the ink, never black, never the deep "needs you"
    const colours = ours.filter(([k]) => isColour(k)).map(([, v]) => String(v));
    for (const never of [hex(TOKENS.ink), { r: 0, g: 0, b: 0 }, hex(TOKENS.needs)]) {
      expect(colours.some((c) => c.startsWith(`rgba(${never.r},${never.g},${never.b},`))).toBe(false);
    }
  });

  it('the resting orb is the same 64 px orb shown larger: only the canvas\'s scale differs', async () => {
    const p = page({ reduce: true, width: 192 });
    p.run(); await p.load();
    expect(p.rest!.width).toBe(384);                                // 192 css px at a device ratio of 2
    expect(p.rest!.ctx.calls[0]).toEqual(['setTransform', 6, 0, 0, 6, 0, 0]);
    expect(p.rest!.ctx.calls[1]).toEqual(['clearRect', 0, 0, 64, 64]);
    const phone = page({ reduce: true, width: 144 });
    phone.run(); await phone.load();
    expect(phone.rest!.ctx.calls[0]).toEqual(['setTransform', 4.5, 0, 0, 4.5, 0, 0]);
    expect(drawn(phone.rest!)).toEqual(drawn(p.rest!));
  });

  it('the page names the owner\'s picks: the listening wave, the assistant\'s magenta; the stylesheet, 192 px and 144 on a phone', () => {
    expect(renderAdvisor('en')).toContain('data-orb-state="listening" data-orb-ink="assistant"');
    expect(APP_CSS).toContain('canvas.orb-rest { inline-size:192px; block-size:192px; display:block; }');
    expect(APP_CSS).toContain('@media (max-width: 720px) { canvas.orb-rest { inline-size:144px; block-size:144px; } }');
    expect(APP_CSS).toContain('canvas.orb { inline-size:64px; block-size:64px;');
  });
});

describe('the guard: on the advisor\'s page only, resting or thinking, and only while seen', () => {
  it('another page draws nothing and fetches nothing — even one that carried a resting canvas naming the orb', async () => {
    const p = page({ advisor: false, restOnOtherPage: true });
    p.run(); await p.load();
    expect(p.rest!.ctx.calls).toEqual([]);
    expect(p.frames).toEqual([]);
  });

  it('resting: drawn once the page has loaded, never before; moving frame after frame while seen', async () => {
    const p = page();
    p.run();
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 30));   // time enough for the file, were it asked for
    expect(p.rest!.ctx.calls).toEqual([]);
    await p.load();
    expect(p.rest!.ctx.calls.length).toBeGreaterThan(0);
    expect(p.tick(1000)).toBe(1);
    const a = JSON.stringify(drawn(p.rest!).slice(-400));
    expect(p.tick(1500)).toBe(1);
    expect(JSON.stringify(drawn(p.rest!).slice(-400))).not.toBe(a);
  });

  it('resting moves at half the thinking pace: the same frame comes at twice the time', async () => {
    const rest = page({ reduce: false }); rest.run(); await rest.load();
    rest.tick(2000);
    const restFrame = drawn(rest.rest!).slice(-50);
    await rest.ask();
    const thinking = rest.canvases().find((c) => c.attrs['class'] === 'orb')!;
    rest.tick(1000);
    expect(drawn(thinking).slice(-50)).toEqual(restFrame);
  });

  it('hidden, it stops asking for frames; shown again, it resumes', async () => {
    const p = page(); p.run(); await p.load();
    expect(p.tick(1000)).toBe(1);
    p.hide(true);
    expect(p.tick(1100)).toBe(1);        // the frame already asked for sees the page hidden and asks no more
    expect(p.tick(1200)).toBe(0);
    expect(p.tick(1300)).toBe(0);
    p.hide(false);
    expect(p.tick(1400)).toBe(1);
    expect(p.tick(1500)).toBe(1);
  });

  it('thinking: once asked, the resting orb gives way, the question goes up and the small orb moves under it', async () => {
    const p = page(); p.run(); await p.load();
    p.tick(500);
    const restingDrew = p.rest!.ctx.calls.length;
    await p.ask('Who has gone quiet?');
    expect(p.rest!.isConnected).toBe(false);
    const kids = p.timeline.children;
    expect(kids.map((k) => k.attrs['class'])).toEqual(['msg outbound', 'msg inbound orb-wait']);
    expect(kids[0]!.querySelector('[data-orb-asked]')!.textContent).toBe('Who has gone quiet?');
    expect(p.canvases().map((c) => c.attrs['class'])).toEqual(['orb']);
    p.tick(1000);                         // the resting orb's last asked-for frame finds it gone, and stops
    expect(p.tick(1100)).toBe(1);         // from here on, the thinking orb alone
    expect(p.tick(1200)).toBe(1);
    expect(p.rest!.ctx.calls.length).toBe(restingDrew);
  });

  it('no third state: a blank question, a second press, or another form draws nothing new', async () => {
    const blank = page(); blank.run(); await blank.load();
    await blank.ask('   ');
    expect(blank.rest!.isConnected).toBe(true);
    expect(blank.timeline.children).toEqual([]);
    const p = page(); p.run(); await p.load();
    await p.ask('Once');
    await p.ask('Twice');
    expect(p.timeline.children).toHaveLength(2);
    expect(p.canvases()).toHaveLength(1);
  });

  it('back from history: the question never went — the thinking state goes and the resting orb returns', async () => {
    const p = page(); p.run(); await p.load();
    await p.ask();
    p.back(); await p.load();
    expect(p.timeline.children).toEqual([]);
    expect(p.rest!.isConnected).toBe(true);
  });

  it('reduced motion: neither state moves — one still frame each, and no frame ever asked for', async () => {
    const p = page({ reduce: true }); p.run(); await p.load();
    expect(p.rest!.ctx.calls.length).toBeGreaterThan(0);
    expect(p.frames).toEqual([]);
    await p.ask();
    const thinking = p.canvases().find((c) => c.attrs['class'] === 'orb')!;
    expect(thinking.ctx.calls.length).toBeGreaterThan(0);
    expect(p.frames).toEqual([]);
  });

  it('the orb\'s file cannot be had: nothing is drawn, nothing is removed (no shift), and the page goes on', async () => {
    const p = page({ orbUrl: 'data:text/javascript;base64,dGhyb3cgbmV3IEVycm9yKCdubycpOw==' });
    p.run(); await p.load();
    expect(p.rest!.ctx.calls).toEqual([]);
    expect(p.rest!.isConnected).toBe(true);
    await p.ask();
    const thinking = p.canvases().find((c) => c.attrs['class'] === 'orb')!;
    expect(thinking.isConnected).toBe(true);
    expect(thinking.ctx.calls).toEqual([]);
    expect(p.frames).toEqual([]);
  });
});

describe('the guard, server side: the page draws the orb only on the advisor, and resting only while nothing is asked', () => {
  it('resting is drawn at rest, never beside an answer; the thinking orb waits in a template', () => {
    for (const l of LOCALES) {
      const atRest = renderAdvisor(l);
      expect(atRest.match(/<canvas\b/g), l).toHaveLength(2);         // the resting orb, and the one inside the template
      expect(atRest, l).toContain('<canvas class="orb-rest" data-orb-rest data-orb-pace="0.5"');
      expect(atRest.indexOf('<template data-orb-pending>'), l).toBeLessThan(atRest.indexOf('<canvas class="orb" '));
      expect(atRest, l).toContain(t(l, 'advisor.thinking'));
      const answered = renderAdvisor(l, { asked: 'q', answer: { kind: 'notStored', text: 'x' } });
      expect(answered, l).not.toContain('data-orb-rest');
      expect(answered.match(/<canvas\b/g), l).toHaveLength(1);
    }
  });

  it('nothing else in the app draws an orb, names its file, or links it', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk(join(ROOT, 'src'));
    const naming = files.filter((f) => /data-orb|orb-rest|<canvas/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1)).sort();
    expect(naming).toEqual(['src/api/web/advisor.ts', 'src/api/web/layout.ts', 'src/api/web/liveScript.ts']);
    const layout = readFileSync(join(ROOT, 'src/api/web/layout.ts'), 'utf8');
    expect(layout.match(/ORB_JS/g)).toHaveLength(1);                 // defined, and linked nowhere in the shell
    const advisor = readFileSync(join(ROOT, 'src/api/web/advisor.ts'), 'utf8');
    expect(advisor.match(/\$\{ORB_JS\}/g)).toHaveLength(1);           // named once, on the advisor's form
  });

  it('scripting off: the resting space is given up from the first paint, so nothing waits empty and nothing shifts', () => {
    expect(APP_CSS).toContain('@media (scripting: none) { .orb-rest-row { display:none; } }');
    // and the script never hides or removes the canvas it could not draw (the failure test above): no shift either way
    expect(LIVE_SCRIPT).not.toMatch(/rest\.hidden|removeChild\(canvas\)/);
  });
});
