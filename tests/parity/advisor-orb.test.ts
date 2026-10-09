import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { assetAt, ORB_JS, stylesheetAt, esc } from '../../src/api/web/layout.js';
import { renderAdvisor } from '../../src/api/web/advisor.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';

/**
 * THE ADVISOR'S ORB (2026-10-07; the owner's briefs and picks, docs/design/advisor-orb/):
 *   "Switch to the library's 'composing' state, using the library's own drawing unchanged: same geometry,
 *   count, placement and timing." — drawn exactly as it ships (the owner's option 1: its dotted columns).
 *   "Only ours: a magenta glow behind the sphere and a soft shadow under it. Glow colour: new deep magenta
 *   #A1127A, MEDIUM strength. Both states (192px resting, 64px thinking)." "Keep #6E0C44 out of the orb."
 *   "Advisor page ONLY … Pauses when the tab is hidden … Reduce motion: NEITHER state animates … Scripts off /
 *   the orb file fails: no orb moving, no gap, no layout shift."
 * The far dots in ink (the owner, 2026-10-09): drawn in the glow, a far dot vanished into the glow behind it.
 * Nothing solid (the owner's brief of 2026-10-09): "Remove the filled sphere surface entirely. Only the library's
 *   dots render. Every dot the library draws must be visible, including the ones across the middle — nothing
 *   occludes them. Keep the magenta glow behind, exactly as it is now." The body and the shadow are gone; the
 *   halo stays as it was.
 * The redesign (the owner's brief of 2026-10-08): a lit field, deepest at the orb and gone before the bar,
 *   dithered so it shows no bands; the orb goes down beside the bar after a question, small, and the light
 *   goes with it as a small pool that fades before the bar's edge; the empty bar types out three questions,
 *   never its own text; less motion: nothing glides and one line stands still.
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
/** A gradient, as the canvas hands one back: its stops recorded on the context that made it. */
class Grad {
  constructor(private ctx: Ctx, public kind: string) {}
  addColorStop(at: number, colour: string) { this.ctx.calls.push(['addColorStop', this.kind, at, colour]); }
  toJSON() { return `gradient:${this.kind}`; }
}
type Img = { width: number; height: number; data: Uint8ClampedArray };
class Ctx {
  calls: Call[] = [];
  /** The lit field and the pool: their pixels, as the script put them. */
  images: Img[] = [];
  set fillStyle(v: string | Grad) { this.calls.push(['fillStyle', v]); }
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
  save() { this.calls.push(['save']); }
  restore() { this.calls.push(['restore']); }
  translate(...a: number[]) { this.calls.push(['translate', ...a]); }
  scale(...a: number[]) { this.calls.push(['scale', ...a]); }
  createRadialGradient(...a: number[]) { this.calls.push(['createRadialGradient', ...a]); return new Grad(this, 'radial'); }
  createLinearGradient(...a: number[]) { this.calls.push(['createLinearGradient', ...a]); return new Grad(this, 'linear'); }
  createImageData(width: number, height: number): Img { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData(img: Img) { this.images.push(img); }
}
type Box = { left: number; top: number; width: number; height: number };
type Anim = { frames: Record<string, unknown>[]; opts: Record<string, unknown> };
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
  style: Record<string, string> = {};
  anims: Anim[] = [];
  animate?: (frames: Record<string, unknown>[], opts: Record<string, unknown>) => { onfinish: null | (() => void); cancel(): void };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(public tagName: string, attrs: Record<string, string> = {}, public box: Box = { left: 0, top: 0, width: 0, height: 0 }) { this.attrs = { ...attrs }; }
  get className() { return this.attrs['class'] ?? ''; }
  set className(v: string) { this.attrs['class'] = v; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k]! : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  fire(type: string) { for (const fn of this.listeners[type] ?? []) fn({ type, target: this }); }
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
  getBoundingClientRect() { const b = this.box; return { ...b, right: b.left + b.width, bottom: b.top + b.height }; }
  scrollIntoView() { /* nothing to scroll */ }
}
const matches = (sel: string) => (e: El): boolean => {
  const cls = /^\.([a-z-]+)$/.exec(sel);
  if (cls) return e.className.split(' ').includes(cls[1]!);
  const m = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(sel);
  return !!m && (!m[1] || e.tagName.toLowerCase() === m[1]) && (!m[2] || m[2] in e.attrs);
};

/** The questions the empty bar types out. */
const LINES = ['Who is waiting for me?', 'How much did we sell this month?', 'Who has gone quiet?'];

/**
 * The advisor's page (or any other), as the stand-in draws it — laid out as a desktop draws it: the lit field
 * 900 × 700, the resting orb's canvas (288) centred near its top, the bar at 600 with the orb's place at its
 * start (64) and the box 24 px on; the pool (128) round that place, the small orb's canvas (96) on it.
 */
function page(o: { advisor?: boolean; resting?: boolean; reduce?: boolean; light?: string; glow?: string; dark?: string; width?: number; orbUrl?: string;
  restOnOtherPage?: boolean; glowSaid?: string; motion?: boolean; barTop?: number } = {}) {
  const body = new El('BODY');
  const main = body.appendChild(new El('MAIN'));
  const resting = o.resting !== false;
  const shell = main.appendChild(new El('DIV', { class: 'adv-page', 'data-adv': o.advisor !== false && resting ? 'rest' : 'chat' }));
  const field = shell.appendChild(new El('CANVAS', { class: 'adv-field', 'data-adv-field': '' }, { left: 0, top: 0, width: 900, height: 700 }));
  let rest: El | null = null;
  if ((o.advisor !== false && resting) || o.restOnOtherPage) {
    const hero = shell.appendChild(new El('DIV', { class: 'adv-hero' }));
    const row = hero.appendChild(new El('DIV', { class: 'orb-rest-row' }));
    const w = o.width ?? 288;
    rest = row.appendChild(new El('CANVAS', { class: 'orb-rest', 'data-orb-rest': '', 'data-orb-pace': '0.5',
      // a page that smuggled the orb's whole description onto a canvas — still nothing without the advisor's form
      ...(o.restOnOtherPage ? { 'data-orb': o.orbUrl ?? ORB_URL, 'data-orb-state': 'composing', 'data-orb-glow': 'orb-glow' } : {}) },
      { left: 450 - w / 2, top: 264 - w / 2, width: w, height: w }));
  }
  const timeline = shell.appendChild(new El('DIV', { class: 'timeline adv-line' }));
  let form: El | null = null; let box: El | null = null; let tpl: El | null = null; let here: El | null = null; let pool: El | null = null;
  if (o.advisor !== false) {
    tpl = shell.appendChild(new El('TEMPLATE', { 'data-orb-pending': '' }));
    (tpl as El & { content: unknown }).content = { cloneNode: () => {
      const frag = new El('#fragment');
      const asked = new El('DIV', { class: 'msg outbound' }); asked.appendChild(new El('BDI', { 'data-orb-asked': '' }));
      const wait = new El('DIV', { class: 'msg inbound orb-wait', 'data-orb-wait': '' });
      frag.appendChild(asked); frag.appendChild(wait);
      return frag;
    } };
    form = shell.appendChild(new El('FORM', { 'data-orb': o.orbUrl ?? ORB_URL, 'data-orb-state': 'composing', 'data-orb-glow': o.glowSaid ?? 'orb-glow',
      ...(resting ? { 'data-adv-suggest': LINES.join('\n') } : {}) }, { left: 0, top: o.barTop ?? 600, width: 900, height: 100 }));
    const slot = form.appendChild(new El('SPAN', { class: 'adv-slot' }, { left: 0, top: 618, width: 64, height: 64 }));
    pool = slot.appendChild(new El('CANVAS', { class: 'adv-pool', 'data-adv-pool': '' }, { left: -32, top: 586, width: 128, height: 128 }));
    here = slot.appendChild(new El('CANVAS', { class: 'orb', 'data-orb-here': '' }, { left: -16, top: 602, width: 96, height: 96 }));
    const inner = form.appendChild(new El('SPAN', { class: 'adv-box' }, { left: 88, top: 610, width: 812, height: 80 }));
    box = inner.appendChild(new El('TEXTAREA', { placeholder: LINES[0]! }));
    inner.appendChild(new El('BUTTON'));
  }
  if (o.motion) {
    for (const e of [rest, field, pool, here].filter(Boolean) as El[]) {
      e.animate = (frames, opts) => { e.anims.push({ frames, opts }); return { onfinish: null, cancel() {} }; };
    }
  }
  const docListeners: Record<string, ((e: unknown) => void)[]> = {};
  const winListeners: Record<string, ((e: unknown) => void)[]> = {};
  const frames: ((now: number) => void)[] = [];
  const vars: Record<string, string> = { '--color-orb-glow': o.glow ?? TOKENS.orbGlow, '--color-surface': o.light ?? TOKENS.surface,
    '--color-ink': o.dark ?? TOKENS.ink, '--color-paper': TOKENS.paper, '--color-needs': TOKENS.needs, '--color-brand': TOKENS.brand };
  const doc = {
    readyState: 'loading', visibilityState: 'visible', documentElement: {}, scrollingElement: { scrollHeight: 2400 }, body, activeElement: null as El | null,
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: () => [],
    createElement: (tag: string) => { const e = new El(tag.toUpperCase()); if (o.motion) e.animate = (frames, opts) => { e.anims.push({ frames, opts }); return { onfinish: null, cancel() {} }; }; return e; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (docListeners[type] ??= []).push(fn); },
  };
  const win = {
    devicePixelRatio: 2, innerWidth: 1280, scrollY: 0, scrolls: [] as number[],
    scrollTo(_x: number, y: number) { win.scrolls.push(y); win.scrollY = y; },
    matchMedia: (q: string) => ({ matches: q.includes('reduced-motion') ? !!o.reduce : false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: (n: string) => vars[n] ?? '' }),
    requestAnimationFrame: (fn: (now: number) => void) => { frames.push(fn); return frames.length; },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (winListeners[type] ??= []).push(fn); },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 },
  };
  /** A clock of its own, for the typed placeholder: nothing runs until the test moves it. */
  let clock = 0; let ids = 0;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const context = vm.createContext({
    window: win, document: doc, location: { href: 'https://nomi.test/app/advisor', pathname: '/app/advisor', search: '', hash: '' },
    history: { scrollRestoration: 'auto', replaceState() {} },
    setTimeout: (fn: () => void, ms: number) => { ids += 1; timers.push({ id: ids, at: clock + (ms || 0), fn }); return ids; },
    clearTimeout: (id: number) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    URL, Promise, Error, Math, Number, String, JSON,
  });
  const settle = () => new Promise<void>((r) => setTimeout(r, 30));
  return {
    body, main, shell, rest, form, box, tpl, timeline, frames, doc, win, field, pool, here, now: () => clock,
    run: () => new vm.Script(LIVE_SCRIPT, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(context),
    /** The page finishes loading, and the orb's file arrives. */
    async load() { doc.readyState = 'complete'; for (const fn of winListeners['load'] ?? []) fn({}); for (let i = 0; i < 6; i++) await settle(); },
    /** The browser draws the frames asked for, once each, at `now`. */
    tick(now: number) { const due = frames.splice(0); for (const fn of due) fn(now); return due.length; },
    /** The page's clock moves on by ms, running what came due (the typed placeholder's steps). */
    advance(ms: number) {
      const until = clock + ms;
      for (;;) {
        const next = timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        timers.splice(timers.indexOf(next), 1);
        clock = next.at;
        try { next.fn(); } catch { /* a timer of another part of the script, with nothing to reach here */ }
      }
      clock = until;
    },
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
/** The calls a canvas received, past its sizing and clearing — what was drawn (the ground and the orb). */
const drawn = (c: El) => c.ctx.calls.filter(([k]) => k !== 'setTransform' && k !== 'clearRect');
/** The orb alone: what was painted after the last transform, the library's frame (the ground comes before it). */
const orbOf = (c: El) => { const i = c.ctx.calls.map(([k]) => k).lastIndexOf('setTransform'); return c.ctx.calls.slice(i + 1); };
/** The ground of the last paint: between its two transforms (under the orb, before the frame's own). */
const groundOf = (c: El) => {
  const at = c.ctx.calls.map(([k], i) => (k === 'setTransform' ? i : -1)).filter((i) => i >= 0);
  return c.ctx.calls.slice(at[at.length - 2]! + 1, at[at.length - 1]);
};
/** Transforms asked for, in order. */
const transforms = (c: El) => c.ctx.calls.filter(([k]) => k === 'setTransform').map(([, ...a]) => a);
const isColour = (k: string) => k === 'fillStyle' || k === 'strokeStyle';
const rgba = (v: unknown) => /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(String(v))!.slice(1).map(Number) as [number, number, number, number];
/** One pixel of an image the script put: [r, g, b, a]. */
const px = (img: Img, x: number, y: number) => { const i = (y * img.width + x) * 4; return [...img.data.slice(i, i + 4)] as [number, number, number, number]; };

/** The library's own painter, in its dark-paper mode (white near, black far), on the same frame. */
async function libraryDraws(t: number) {
  const core = await import(pathToFileURL(join(VENDOR, 'index-B8WsUNf5.js')).href) as Record<string, any>;
  const pre = core['r']('composing', 64);
  const ctx = new Ctx();
  core['p'](ctx, core['M'][pre.mode](64, t, pre.opts), true);
  return ctx.calls;
}

describe('the orb is the library\'s own composing state, drawn as it ships; the glow behind it is ours, and nothing solid', () => {
  it('with white and black for its two ends, the script draws exactly the calls the library\'s own painter draws — resting and thinking', async () => {
    const p = page({ reduce: true, light: '#FFFFFF', dark: '#000000' });
    p.run(); await p.load();
    const lib = await libraryDraws(0.6);
    expect(lib.length).toBeGreaterThan(2000);                          // 566 dots: its count, unchanged
    expect(lib.filter(([k]) => k === 'arc')).toHaveLength(566);
    expect(lib.some(([k]) => k === 'stroke')).toBe(false);             // composing draws no line: dotted columns, as it ships
    expect(orbOf(p.rest!)).toEqual(lib);
    await p.ask();
    expect(orbOf(p.here!)).toEqual(lib);
  });

  it('with the palette\'s ends: the same dots, sizes and order; each colour on the line from the light end to the ink (never the glow: a far dot would vanish into it)', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const ours = orbOf(p.rest!);
    const lib = await libraryDraws(0.6);
    expect(ours.filter(([k]) => !isColour(k))).toEqual(lib.filter(([k]) => !isColour(k)));
    const light = hex(TOKENS.surface); const ink = hex(TOKENS.ink);
    let farthest = 1;
    for (const [k, v] of ours.filter(([k]) => isColour(k))) {
      const [r, g, b, a] = rgba(v);
      // the depth, read off the widest channel (green: 0x20 to 0xFD), and the others on the same line, to rounding
      const w = (g - ink.g) / (light.g - ink.g);
      expect(w, `${k} ${v}`).toBeGreaterThanOrEqual(-0.003);
      expect(w, `${k} ${v}`).toBeLessThanOrEqual(1.003);
      expect(Math.abs(r - (ink.r + (light.r - ink.r) * w)), `${k} ${v}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b - (ink.b + (light.b - ink.b) * w)), `${k} ${v}`).toBeLessThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(1);
      farthest = Math.min(farthest, w);
    }
    expect(farthest).toBeLessThan(0.25);   // the far dots come close to the ink: the composing state's farthest sit a fifth of the way
    // and no dot is the glow's own colour
    const glow = hex(TOKENS.orbGlow);
    expect(ours.filter(([k]) => isColour(k)).some(([, v]) => { const [r, g, b] = rgba(v); return r === glow.r && g === glow.g && b === glow.b; })).toBe(false);
  });

  it('the ground is ours and under the orb: the glow\'s halo and nothing else — no body, no shadow — drawn first, every frame', async () => {
    for (const p of [page({ reduce: true }), page({ reduce: true, width: 216 })]) {
      p.run(); await p.load();
      for (const c of [p.rest!, ...(await p.ask(), [p.here!])]) {
        const ground = groundOf(c);
        // one fill: the halo, a radial gradient of the glow round the orb's centre
        expect(ground.filter(([k]) => k === 'fill')).toHaveLength(1);
        expect(ground.filter(([k]) => k === 'createRadialGradient')).toHaveLength(1);
        expect(ground.filter(([k]) => k === 'createLinearGradient')).toHaveLength(0);
        expect(ground.filter(([k]) => k === 'arc')).toHaveLength(1);
        expect(ground.some(([k]) => k === 'scale' || k === 'translate' || k === 'save')).toBe(false);   // the shadow's squash
        const all = c.ctx.calls;
        expect(all.indexOf(ground[0]!)).toBeLessThan(all.indexOf(orbOf(c)[0]!));   // never over a dot
        expect(orbOf(c).some(([k]) => k === 'createRadialGradient' || k === 'createLinearGradient')).toBe(false);   // nothing after it either
      }
    }
  });

  it('the halo is a ring: nothing behind the middle, the glow at three quarters just outside the dots, nothing at its reach — a smooth curve, 25 stops along it', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const ground = groundOf(p.rest!);
    const [, x0, y0, r0, x1, y1, r1] = ground.find(([k]) => k === 'createRadialGradient')! as [string, number, number, number, number, number, number];
    const R = 192 / 2 * 0.78;
    expect([x0, y0, r0, x1, y1]).toEqual([96, 96, 0, 96, 96]);
    expect(r1).toBeCloseTo(R * 1.6, 6);
    const glow = hex(TOKENS.orbGlow);
    const stops = ground.filter(([k]) => k === 'addColorStop').map(([, , at, c]) => [at, ...rgba(c)] as number[]);
    expect(stops).toHaveLength(25);
    for (const [, r, g, b] of stops) expect([r, g, b]).toEqual([glow.r, glow.g, glow.b]);
    const alpha = stops.map(([, , , , a]) => a!);
    // the curve itself: the smootherstep up from 0.3 of the sphere to 1.25, and down to 1.6 — flat at every join
    const sm = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
    const want = (rho: number) => 0.75 * (rho <= 0.3 ? 0 : rho <= 1.25 ? sm((rho - 0.3) / 0.95) : 1 - sm((rho - 1.25) / 0.35));
    stops.forEach(([at], i) => expect(alpha[i], `stop ${i}`).toBeCloseTo(want(1.6 * at!), 9));
    expect(alpha[0]).toBe(0);                                             // nothing behind the middle
    expect(Math.max(...alpha)).toBeGreaterThan(0.74);                    // three quarters on the ring
    expect(alpha.at(-1)).toBe(0);
    const peak = alpha.indexOf(Math.max(...alpha));
    for (let i = 1; i < alpha.length; i++) expect(i <= peak ? alpha[i]! >= alpha[i - 1]! : alpha[i]! <= alpha[i - 1]!, `stop ${i}`).toBe(true);
  });

  it('the ground\'s colour is the glow alone — never the ink, never the "needs you" magenta, at any stop', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const glow = hex(TOKENS.orbGlow);
    const allowed = [glow].map((c) => `${c.r},${c.g},${c.b}`);
    const stops = groundOf(p.rest!).filter(([k]) => k === 'addColorStop').map(([, , , c]) => rgba(c));
    expect(stops).toHaveLength(25);
    for (const [r, g, b] of stops) expect(allowed, `${r},${g},${b}`).toContain(`${r},${g},${b}`);
    const needs = hex(TOKENS.needs);
    const every = [...stops, ...orbOf(p.rest!).filter(([k]) => isColour(k)).map(([, v]) => rgba(v))];
    expect(every.some(([r, g, b]) => r === needs.r && g === needs.g && b === needs.b)).toBe(false);
    expect(LIVE_SCRIPT.slice(LIVE_SCRIPT.indexOf('The advisor\'s orb (item 9)'))).not.toMatch(/--color-needs|6E0C44/i);
  });

  it('the glow is a palette colour, named: a page that hands the orb a colour of its own gets no orb, and no field, at all', async () => {
    for (const said of ['#6E0C44', 'rgb(110,12,68)', 'needs; x', '']) {
      const p = page({ reduce: true, glowSaid: said });
      p.run(); await p.load();
      expect(p.rest!.ctx.calls, said).toEqual([]);
      expect(p.field.ctx.images, said).toEqual([]);
      expect(p.rest!.isConnected).toBe(true);
    }
  });

  it('the resting orb is the same 64 px orb shown larger: only the canvas\'s scale differs; its margin holds the glow', async () => {
    const p = page({ reduce: true, width: 288 });
    p.run(); await p.load();
    expect(p.rest!.width).toBe(576);                                     // 288 css px at a device ratio of 2
    expect(transforms(p.rest!).slice(-1)).toEqual([[6, 0, 0, 6, 96, 96]]);  // 64 → 192, inset by the 48 px margin
    const phone = page({ reduce: true, width: 216 });
    phone.run(); await phone.load();
    expect(transforms(phone.rest!).slice(-1)).toEqual([[4.5, 0, 0, 4.5, 72, 72]]);
    expect(orbOf(phone.rest!)).toEqual(orbOf(p.rest!));
    await p.ask();
    expect(transforms(p.here!).slice(-1)).toEqual([[2, 0, 0, 2, 32, 32]]);  // beside the bar: its own 64 px, inset by 16
  });

  it('the page names the owner\'s picks: composing, the orb\'s glow; the stylesheet, 192 px and 144 on a phone, 64 beside the bar, no room taken by the margin', () => {
    expect(renderAdvisor('en')).toContain('data-orb-state="composing" data-orb-glow="orb-glow"');
    expect(APP_CSS).toContain('canvas.orb-rest { inline-size:288px; block-size:288px; margin:calc(-1 * var(--space-48)); display:block; }');
    expect(APP_CSS).toContain('canvas.orb-rest { inline-size:216px; block-size:216px; margin:calc(-1 * (var(--space-24) + var(--space-12))); }');
    expect(APP_CSS).toContain('.adv-slot canvas.orb { position:absolute; inset-inline-start:calc(-1 * var(--space-16)); inset-block-start:calc(-1 * var(--space-16)); inline-size:96px; block-size:96px; }');
    expect(APP_CSS).toContain('.adv-slot { position:relative; flex:none; inline-size:64px; block-size:64px; }');
  });
});

describe('the lit field and the pool (the redesign; the ring, 2026-10-09): deepest round the orb, no bands, gone before the bar', () => {
  it('the field is a ring: lighter directly behind the orb, the glow itself just outside its dots, the paper\'s own colour at its reach, nothing past it', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const img = p.field.ctx.images.at(-1)!;
    expect(img.width).toBe(1800);                                        // 900 css px at a device ratio of 2
    const glow = hex(TOKENS.orbGlow); const paper = hex(TOKENS.paper);
    const mixed = (t: number) => [paper.r + (glow.r - paper.r) * t, paper.g + (glow.g - paper.g) * t, paper.b + (glow.b - paper.b) * t];
    const off = (c: number[], w: number[]) => Math.abs(c[0]! - w[0]!) + Math.abs(c[1]! - w[1]!) + Math.abs(c[2]! - w[2]!);
    // behind the middle: 22 in 100 of the way to the glow (the orb's centre is (450, 264) css; its dots' sphere 75 px)
    const [r, g, b, a] = px(img, 900, 528);
    expect(a).toBe(255);
    expect(off([r, g, b], mixed(0.22))).toBeLessThanOrEqual(6);
    // the ring: the glow itself, at 1.25 of the dots' sphere (94 css px out), every way round
    for (const [dx, dy] of [[94, 0], [-94, 0], [0, -94], [0, 94], [66, -66]]) {
      const [rr, gg, bb] = px(img, 900 + 2 * dx!, 528 + 2 * dy!);
      expect(off([rr, gg, bb], [glow.r, glow.g, glow.b]), `${dx},${dy}`).toBeLessThanOrEqual(6);
    }
    expect(g).toBeGreaterThan(px(img, 900 + 2 * 94, 528)[1] + 100);      // the middle far lighter than the ring
    // its reach is clear: the paper shows, and no pixel has an edge
    expect(px(img, 0, 528)[3]).toBe(0);
    expect(px(img, 900, 0)[3]).toBe(0);
    // the deepest it ever is, is the glow, never the "needs you" magenta, and never darker than the glow
    const needs = hex(TOKENS.needs);
    for (let x = 0; x < img.width; x += 37) {
      const [rr, gg, bb, aa] = px(img, x, 528);
      if (!aa) continue;
      expect(rr === needs.r && gg === needs.g && bb === needs.b).toBe(false);
      expect(gg).toBeGreaterThanOrEqual(glow.g - 2);
    }
    // where it fades out it is the paper itself, to a step: no seam where it ends
    const near = px(img, 900 - 2 * 246, 528);
    expect(near[3]).toBe(255);
    expect(Math.abs(near[0] - paper.r) + Math.abs(near[1] - paper.g) + Math.abs(near[2] - paper.b)).toBeLessThanOrEqual(6);
  });

  it('the field\'s ring is smooth: no step, no edge — along a line out of the orb its lightness changes gently everywhere', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const img = p.field.ctx.images.at(-1)!;
    const line: number[] = [];
    for (let x = 900; x < 1800; x++) { const q = px(img, x, 528); if (!q[3]) break; line.push(q[1]); }
    // a 17-pixel average takes the dither out; then no change faster than 2.6 levels of green per device pixel, and
    // no corner: the change itself changes slowly — over ±8 px of that average, and, finer, over ±4 px of a 9-pixel
    // one, which is what finds a corner where a straight rise meets the flat (a ring edge the eye picks out).
    // Measured 2026-10-09: the ring 2.29, 0.054, 0.083; the light deepest at the centre, before it, 1.32, 0.017,
    // 0.042; a straight rise cornered at both ends 0.153 on the finer bend; a hard-edged middle (a disc) fails all.
    const avg = line.map((_, i) => { const w = line.slice(Math.max(0, i - 8), i + 9); return w.reduce((s, v) => s + v, 0) / w.length; });
    let steep = 0; let bend = 0;
    for (let i = 12; i < avg.length - 12; i++) {
      steep = Math.max(steep, Math.abs(avg[i + 1]! - avg[i - 1]!) / 2);
      bend = Math.max(bend, Math.abs(avg[i + 8]! - 2 * avg[i]! + avg[i - 8]!) / 64);
    }
    const avg9 = line.map((_, i) => { const w = line.slice(Math.max(0, i - 4), i + 5); return w.reduce((s, v) => s + v, 0) / w.length; });
    let corner = 0;
    for (let i = 10; i < avg9.length - 10; i++) corner = Math.max(corner, Math.abs(avg9[i + 4]! - 2 * avg9[i]! + avg9[i - 4]!) / 16);
    expect(steep).toBeLessThan(2.6);
    expect(bend).toBeLessThan(0.12);
    expect(corner).toBeLessThan(0.11);
  });

  it('the field keeps close and soft: the paper holds the page, the glow a presence round the orb, never a cloud', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const img = p.field.ctx.images.at(-1)!;
    const glow = hex(TOKENS.orbGlow); const paper = hex(TOKENS.paper);
    // the orb is 192 px (its canvas 288): across, nothing past 2.6 of its radii (250 px); up and down, past 2.1 (202 px)
    for (const x of [900 - 2 * 254, 900 + 2 * 254]) expect(px(img, x, 528)[3], `x ${x}`).toBe(0);
    expect(px(img, 900, 528 - 2 * 206)[3]).toBe(0);
    expect(px(img, 900, 528 + 2 * 206)[3]).toBe(0);
    // the ring is round the orb, and half an orb further out it is already more paper than glow
    const lit = (x: number) => (paper.g - px(img, x, 528)[1]) / (paper.g - glow.g);
    expect(lit(900 + 2 * 100)).toBeGreaterThan(0.9);
    expect(lit(900 + 2 * 150)).toBeLessThan(0.45);
    // what is lit more than a tenth of the way to the glow: under a tenth of the page with the light deepest at the
    // centre (2026-10-08); the ring round the orb lights 13 in 100 — THE OWNER TO CONFIRM (2026-10-09), held here at 0.135
    let litPx = 0;
    for (let y = 0; y < img.height; y += 4) for (let x = 0; x < img.width; x += 4) {
      const [, g, , a] = px(img, x, y);
      if (a && (paper.g - g) / (paper.g - glow.g) > 0.1) litPx += 1;
    }
    expect(litPx / ((img.height / 4) * (img.width / 4))).toBeLessThan(0.135);
  });

  it('the field is gone before the bar: every pixel on the bar\'s line and below it is clear — on a short screen too', async () => {
    // a tall screen, and a short one (a 13-inch laptop, a phone) where the bar is nearer the orb than the light reaches
    for (const bar of [600, 420]) {
      const p = page({ reduce: true, barTop: bar });
      p.run(); await p.load();
      const img = p.field.ctx.images.at(-1)!;
      for (let y = 2 * bar - 48; y < img.height; y += 7) for (let x = 0; x < img.width; x += 11) expect(px(img, x, y)[3], `${bar}: ${x},${y}`).toBe(0);
      // on the short screen it is lit down to near the bar: cut short by it, not missing (on the tall one the light
      // ends of itself, well above)
      if (bar === 420) expect(px(img, 900, 2 * (bar - 24 - 30))[3]).toBe(255);
    }
  });

  it('no bands: the fall from the orb is dithered — along any line out of it, no colour holds for more than a few pixels', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    const img = p.field.ctx.images.at(-1)!;
    const paper = hex(TOKENS.paper);
    // out from the orb's edge, as far as the light still shows: a sixteen-pixel average a step and a half or more
    // from the paper (past that, a pixel held is the paper itself, not a band)
    const line: [number, number, number][] = [];
    for (let x = 900 + 2 * 96; x < 1800; x++) { const [r, g, b, a] = px(img, x, 528); if (!a) break; line.push([r, g, b]); }
    let end = line.length;
    for (let i = 0; i + 16 <= line.length; i++) {
      const avg = line.slice(i, i + 16).reduce((s, c) => s + c[1], 0) / 16;
      if (paper.g - avg < 1.5) { end = i; break; }
    }
    expect(end).toBeGreaterThan(100);                                     // a fall long enough to band, undithered
    let longest = 0; let run = 0; let was = '';
    for (const [r, g, b] of line.slice(0, end)) {
      const now = `${r},${g},${b}`;
      run = now === was ? run + 1 : 1; was = now; longest = Math.max(longest, run);
    }
    // undithered, the slow end of that fall holds each colour for a dozen pixels and more
    expect(longest).toBeLessThanOrEqual(6);
    expect(LIVE_SCRIPT).toMatch(/noise\(\) \+ noise\(\) - 1/);
  });

  it('after a question, the light is a small pool round the orb beside the bar, and it fades before the box\'s edge', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    await p.ask();
    const img = p.pool!.ctx.images.at(-1)!;
    expect(img.width).toBe(256);                                         // 128 css px
    const glow = hex(TOKENS.orbGlow); const paper = hex(TOKENS.paper);
    // on the paper, the centre is lit, and softer than the field's deepest
    const [, , , ca] = px(img, 128, 128);
    const onPaper = paper.g + (glow.g - paper.g) * (ca / 255);
    expect(onPaper).toBeLessThan(paper.g - 20);
    expect(onPaper).toBeGreaterThan(glow.g + 20);
    // every pixel it draws is the glow made thin, never paper: what passes under the bar is tinted, never covered
    for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) {
      const [r, g, b, a] = px(img, x, y);
      if (a) expect([r, g, b], `${x},${y}`).toEqual([glow.r, glow.g, glow.b]);
    }
    // the box begins 56 px from the orb's centre: by then (and 4 px before it) nothing is drawn
    for (let y = 0; y < img.height; y += 3) expect(px(img, 128 + 2 * 52, y)[3], `y ${y}`).toBe(0);
    expect(p.shell.getAttribute('data-adv')).toBe('chat');
  });
});

describe('the glide (the redesign): the orb goes down beside the bar, small, and the light goes with it', () => {
  it('it moves the resting orb to the place beside the bar, scaled to the small one; the field goes with it and fades; the pool comes', async () => {
    const p = page({ motion: true });
    p.run(); await p.load();
    await p.ask();
    const lift = p.body.querySelector('.orb-lift')!;
    expect(lift).not.toBeNull();
    expect(lift.children).toContain(p.rest!);
    expect(lift.style['position']).toBe('fixed');
    // the box it flies in carries the animation (the stand-in records it on the canvas's own lift)
    const flew = p.field.anims.at(-1)!;
    expect(flew.frames.at(-1)!['opacity']).toBe(0);
    // from the resting orb's centre (450, 264) to the small orb's (32, 650)
    expect(String(flew.frames.at(-1)!['transform'])).toBe('translate(-418px, 386px) scale(0.3333333333333333)');
    expect(p.pool!.anims.at(-1)!.frames.map((f) => f['opacity'])).toEqual([0, 1]);
    expect(p.shell.getAttribute('data-adv')).toBe('chat');
  });

  it('less motion: nothing glides — the orb is simply beside the bar, the field gone at once, nothing animated', async () => {
    const p = page({ motion: true, reduce: true });
    p.run(); await p.load();
    await p.ask();
    expect(p.body.querySelector('.orb-lift')).toBeNull();
    expect([p.rest!, p.field, p.pool!, p.here!].flatMap((e) => e.anims)).toEqual([]);
    expect(p.field.style['opacity']).toBe('0');
    expect(p.rest!.isConnected).toBe(false);
    expect(p.frames).toEqual([]);
  });

  it('the orb\'s file cannot be had: nothing glides either — nothing moves', async () => {
    const p = page({ motion: true, orbUrl: 'data:text/javascript;base64,dGhyb3cgbmV3IEVycm9yKCdubycpOw==' });
    p.run(); await p.load();
    await p.ask();
    expect(p.body.querySelector('.orb-lift')).toBeNull();
    expect([p.rest!, p.pool!, p.here!].flatMap((e) => e.anims)).toEqual([]);
    expect(p.frames).toEqual([]);
  });
});

describe('the typed placeholder (the redesign): three questions, one at a time, calmly — never the box\'s text', () => {
  it('it types the first question letter by letter, holds it, clears it, and goes on to the next; then from the top', async () => {
    const p = page();
    p.run(); await p.load();
    const box = p.box!;
    const at = (ms: number) => p.advance(ms - p.now());
    expect(box.getAttribute('placeholder')).toBe('');
    // 400 ms after the page, a letter every 55 ms
    at(400 + 55 * 3);
    expect(box.getAttribute('placeholder')).toBe('Who ');
    const typed = (line: string, from: number) => from + 55 * (line.length - 1);   // when its last letter comes
    const one = typed(LINES[0]!, 400);
    at(one);
    expect(box.getAttribute('placeholder')).toBe(LINES[0]);
    at(one + 2500);
    expect(box.getAttribute('placeholder')).toBe(LINES[0]);              // held: long enough to read
    at(one + 2600);
    expect(box.getAttribute('placeholder')).toBe('');                    // then cleared
    const two = typed(LINES[1]!, one + 2600 + 700);
    at(two);
    expect(box.getAttribute('placeholder')).toBe(LINES[1]);
    const three = typed(LINES[2]!, two + 2600 + 700);
    at(three);
    expect(box.getAttribute('placeholder')).toBe(LINES[2]);
    at(three + 2600 + 700 + 55 * 7);
    const again = box.getAttribute('placeholder')!;
    expect(again).toBe(LINES[0]!.slice(0, 8));                           // and again from the top
    expect(box.value).toBe('');                                          // never the box's own text
  });

  it('the box keeps the height of the longest question, so the bar never moves while one is typed', async () => {
    const p = page();
    const box = p.box!;
    // the stand-in box is a line tall for every 24 letters it shows; the second question takes two
    Object.defineProperty(box, 'offsetHeight', { get: () => 24 * Math.max(1, Math.ceil(String(box.getAttribute('placeholder') ?? '').length / 24)) });
    p.run(); await p.load();
    expect(box.style['minBlockSize']).toBe('48px');
    expect(box.getAttribute('placeholder')).toBe('');                    // measured, then cleared to type
    p.advance(400 + 55 * 7);                                             // the first letter at 400 ms, then one every 55
    expect(box.getAttribute('placeholder')).toBe(LINES[0]!.slice(0, 8));
    expect(box.value).toBe('');
  });

  it('touched or typed in, it stops and clears at once; left empty, it starts again; left with words, it never does', async () => {
    const p = page();
    p.run(); await p.load();
    const box = p.box!;
    p.advance(400 + 55 * 8);
    expect(box.getAttribute('placeholder')).not.toBe('');
    p.doc.activeElement = box; box.fire('focus');
    expect(box.getAttribute('placeholder')).toBe('');
    p.advance(20000);
    expect(box.getAttribute('placeholder')).toBe('');                    // nothing types while the box is held
    p.doc.activeElement = null; box.fire('blur');
    p.advance(1200 + 55 * 4);
    expect(box.getAttribute('placeholder')).not.toBe('');                // empty and left: it goes on
    box.value = 'how many'; box.fire('input');
    expect(box.getAttribute('placeholder')).toBe('');
    p.advance(20000);
    expect(box.getAttribute('placeholder')).toBe('');                    // the owner's words: it never types over them
    expect(box.value).toBe('how many');
  });

  it('hidden, it rests; shown again, it goes on', async () => {
    const p = page();
    p.run(); await p.load();
    p.advance(400 + 55 * 2);
    const was = p.box!.getAttribute('placeholder');
    p.hide(true);
    p.advance(20000);
    expect(p.box!.getAttribute('placeholder')).toBe(was);
    p.hide(false);
    p.advance(700 + 55 * 30);
    expect(p.box!.getAttribute('placeholder')).not.toBe(was);
  });

  it('less motion: no typing at all — the first question stands still, as the page drew it', async () => {
    const p = page({ reduce: true });
    p.run(); await p.load();
    // looked at through a whole round of the three, never once at a moment a typer would show the first one whole
    for (const ms of [450, 1000, 3000, 2000, 1500, 1500, 2000, 1000, 2000]) {
      p.advance(ms);
      expect(p.box!.getAttribute('placeholder')).toBe(LINES[0]);
    }
    expect(p.box!.style['minBlockSize'] ?? '').toBe('');                 // the line the page drew sets the box's height
  });

  it('talking (not the empty page), the box types nothing', async () => {
    const p = page({ resting: false });
    p.run(); await p.load();
    p.advance(30000);
    expect(p.box!.getAttribute('placeholder')).toBe(LINES[0]);           // the stand-in's line, never changed
  });
});

describe('the guard: on the advisor\'s page only, resting or thinking, and only while seen', () => {
  it('another page draws nothing and fetches nothing — even one that carried a resting canvas naming the orb', async () => {
    const p = page({ advisor: false, restOnOtherPage: true });
    p.run(); await p.load();
    expect(p.rest!.ctx.calls).toEqual([]);
    expect(p.field.ctx.images).toEqual([]);
    expect(p.frames).toEqual([]);
  });

  it('resting: the ground and the field at once; the orb once the page has loaded, never before; moving frame after frame while seen', async () => {
    const p = page();
    p.run();
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 30));   // time enough for the file, were it asked for
    expect(transforms(p.rest!)).toHaveLength(2);                                // the ground's two, and no frame's
    expect(drawn(p.rest!).some(([k]) => k === 'createRadialGradient')).toBe(true);
    expect(p.field.ctx.images).toHaveLength(1);
    expect(p.frames).toEqual([]);
    await p.load();
    expect(transforms(p.rest!).length).toBeGreaterThan(2);
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
    rest.tick(1000);
    expect(drawn(rest.here!).slice(-50)).toEqual(restFrame);
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

  it('thinking: once asked, the resting orb gives way, the question goes up, and the small orb beside the bar moves', async () => {
    const p = page(); p.run(); await p.load();
    p.tick(500);
    const restingDrew = p.rest!.ctx.calls.length;
    await p.ask('Who has gone quiet?');
    expect(p.rest!.isConnected).toBe(false);
    expect(p.shell.getAttribute('data-adv')).toBe('chat');
    const kids = p.timeline.children;
    expect(kids.map((k) => k.attrs['class'])).toEqual(['msg outbound', 'msg inbound orb-wait']);
    expect(kids[0]!.querySelector('[data-orb-asked]')!.textContent).toBe('Who has gone quiet?');
    p.tick(1000);                         // the resting orb's last asked-for frame finds it gone, and stops
    expect(p.tick(1100)).toBe(1);         // from here on, the small orb alone
    expect(p.tick(1200)).toBe(1);
    expect(p.rest!.ctx.calls.length).toBe(restingDrew);
    expect(p.here!.ctx.calls.length).toBeGreaterThan(0);
  });

  it('a page that opens talking: the small orb beside the bar, calm (half pace), its pool lit; asked again, it thinks (full pace)', async () => {
    const p = page({ resting: false }); p.run(); await p.load();
    expect(p.here!.ctx.calls.length).toBeGreaterThan(0);
    expect(p.pool!.ctx.images).toHaveLength(1);
    p.tick(2000);
    const calm = drawn(p.here!).slice(-50);
    const q = page({ resting: false }); q.run(); await q.load();
    await q.ask();
    q.tick(1000);
    expect(drawn(q.here!).slice(-50)).toEqual(calm);
  });

  it('a page that opens talking opens at its end, the newest answer above the bar; again once loaded, unless the owner scrolled', async () => {
    const p = page({ resting: false }); p.run();
    expect(p.win.scrolls).toEqual([2400]);
    await p.load();
    expect(p.win.scrolls).toEqual([2400, 2400]);
    const q = page({ resting: false }); q.run();
    q.win.scrollY = 900;                                                 // the owner scrolled back up before it loaded
    await q.load();
    expect(q.win.scrolls).toEqual([2400]);
    const r = page(); r.run(); await r.load();                           // the empty page stays where it is
    expect(r.win.scrolls).toEqual([]);
  });

  it('no third state: a blank question, a second press, or another form draws nothing new', async () => {
    const blank = page(); blank.run(); await blank.load();
    await blank.ask('   ');
    expect(blank.rest!.isConnected).toBe(true);
    expect(blank.timeline.children).toEqual([]);
    expect(blank.shell.getAttribute('data-adv')).toBe('rest');
    const p = page(); p.run(); await p.load();
    await p.ask('Once');
    await p.ask('Twice');
    expect(p.timeline.children).toHaveLength(2);
  });

  it('back from history: the question never went — the thinking state goes and the resting orb, and its field, return', async () => {
    const p = page(); p.run(); await p.load();
    await p.ask();
    p.back(); await p.load();
    expect(p.timeline.children).toEqual([]);
    expect(p.rest!.isConnected).toBe(true);
    expect(p.shell.getAttribute('data-adv')).toBe('rest');
    expect(p.field.style['opacity']).toBe('');
  });

  it('reduced motion: neither state moves — one still frame each, and no frame ever asked for; the field stays, still', async () => {
    const p = page({ reduce: true }); p.run(); await p.load();
    expect(p.rest!.ctx.calls.length).toBeGreaterThan(0);
    expect(p.field.ctx.images).toHaveLength(1);
    expect(p.frames).toEqual([]);
    await p.ask();
    expect(p.here!.ctx.calls.length).toBeGreaterThan(0);
    expect(p.frames).toEqual([]);
  });

  it('the orb\'s file cannot be had: the still glow stays, no dot is drawn, nothing moves, nothing is removed (no shift)', async () => {
    const p = page({ orbUrl: 'data:text/javascript;base64,dGhyb3cgbmV3IEVycm9yKCdubycpOw==' });
    p.run(); await p.load();
    expect(transforms(p.rest!)).toHaveLength(2);                         // the ground, once; never the frame's
    expect(drawn(p.rest!).filter(([k]) => k === 'arc')).toHaveLength(1);  // the ground's one shape, the halo; no dot
    expect(p.rest!.isConnected).toBe(true);
    await p.ask();
    expect(p.here!.isConnected).toBe(true);
    expect(transforms(p.here!)).toHaveLength(2);
    expect(p.frames).toEqual([]);
  });
});

describe('the guard, server side: the page draws the orb only on the advisor, and resting only while nothing is asked', () => {
  it('at rest: the field, the resting orb, and the small orb\'s place beside the bar with its pool; talking: no resting orb; no canvas in the template', () => {
    for (const l of LOCALES) {
      const atRest = renderAdvisor(l);
      expect(atRest.match(/<canvas\b/g), l).toHaveLength(4);
      expect(atRest, l).toContain('<canvas class="adv-field" data-adv-field aria-hidden="true"></canvas>');
      expect(atRest, l).toContain('<canvas class="orb-rest" data-orb-rest data-orb-pace="0.5"');
      expect(atRest, l).toContain('<canvas class="orb" data-orb-here width="192" height="192"></canvas>');
      const tpl = atRest.slice(atRest.indexOf('<template data-orb-pending>'), atRest.indexOf('</template>'));
      expect(tpl, l).not.toContain('<canvas');
      expect(tpl, l).toContain(esc(t(l, 'advisor.thinking')));
      expect(atRest, l).toContain('data-adv="rest"');
      const answered = renderAdvisor(l, { asked: 'q', answer: { kind: 'notStored', text: 'x' } });
      expect(answered, l).not.toContain('data-orb-rest');
      expect(answered, l).toContain('data-adv="chat"');
      expect(answered.match(/<canvas\b/g), l).toHaveLength(3);
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

  it('every answer is the same block, short or long: the reading measure wide, never sized to its words', () => {
    expect(APP_CSS).toContain('.adv-line .msg.inbound { max-width:var(--measure-prose); inline-size:100%; }');
  });

  it('scripting off: no orb, no field and no place beside the bar from the first paint — plain paper, the greeting and the bar; nothing shifts', () => {
    expect(APP_CSS).toContain('@media (scripting: none) { .orb-rest-row, .adv-field, .adv-slot { display:none; } }');
    // and the script never hides or removes the canvas it could not draw (the failure test above): no shift either way
    expect(LIVE_SCRIPT).not.toMatch(/rest\.hidden|removeChild\(canvas\)/);
  });
});

