import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';

/**
 * THE WARMTH RUN (2026-10-03), PHASE 8 — in-app notifications, run as the
 * browser runs the one script, against a small stand-in for the page.
 *
 * The owner: "In-app, always: when something lands while the owner is in
 * Nomi, it surfaces wherever they are — a quiet marker on the rail, Today
 * updating, a toast. No sound, no badge inflation."
 *
 *   - a rise marks Inbox and redraws its number in place; the next question
 *     carries the new count;
 *   - the card appears once, says who and why, is a door to the conversation,
 *     and goes after six seconds or when tapped; one at a time;
 *   - a count that stays or falls marks nothing and shows no card;
 *   - Today draws its `main` again in place instead of showing its line;
 *   - a reader who asked for less motion gets the same card, and the script
 *     moves nothing itself (the stylesheet's rise is inside no-preference).
 */

type Listener = (e: Record<string, unknown>) => void;
class Nd {
  readonly listeners = new Map<string, Listener[]>();
  children: Nd[] = [];
  parent: Nd | null = null;
  textContent = '';
  href = '';
  value = ''; selectionStart = 0; selectionEnd = 0;
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}) {}
  get className(): string { return this.attrs['class'] ?? ''; }
  set className(v: string) { this.attrs['class'] = v; }
  get id(): string { return this.attrs['id'] ?? ''; }
  get parentNode(): Nd | null { return this.parent; }
  get firstChild(): Nd | null { return this.children[0] ?? null; }
  getAttribute(n: string): string | null { return n in this.attrs ? this.attrs[n]! : null; }
  setAttribute(n: string, v: string): void { this.attrs[n] = String(v); }
  removeAttribute(n: string): void { delete this.attrs[n]; }
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  fire(type: string, e: Record<string, unknown> = {}): Record<string, unknown> {
    const ev: Record<string, unknown> = { type, target: this, defaultPrevented: false, ...e };
    ev['preventDefault'] = () => { ev['defaultPrevented'] = true; };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
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
}
const matches = (sel: string) => (e: Nd): boolean => {
  const m = /^([a-z]*)(?:\.([a-z-]+))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel);
  if (!m) return false;
  return (!m[1] || e.tagName.toLowerCase() === m[1])
    && (!m[2] || (e.attrs['class'] ?? '').split(' ').includes(m[2]))
    && (!m[3] || (e.getAttribute(m[3]) !== null && (m[4] === undefined || e.getAttribute(m[3]) === m[4])));
};

const CONV = '6c1e0000-0000-4000-8000-00000000c026';
const DOOR = `/app/inbox/${CONV}#latest`;
const json = (body: unknown, status = 200, type = 'basic') =>
  ({ type, status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });
const htmlOf = (ok = true) => ({ type: 'basic', status: ok ? 200 : 500, ok, text: () => Promise.resolve('<html>') });
/** What the rail's address answers, as `railSaid` shapes it. */
// The warmth run's re-audit (w4-whole-03, -05): the mark carries the moment the latest customer began
// to wait, and the answer the rail's words, so a live update reads as a reload would.
const rail = (n: number, toast?: { say: string; door: string }) =>
  json({ n, mark: `${n}.${n * 100}`, shown: String(n), words: `${n} waiting`, label: `Inbox, ${n} customers need you`, ...(toast ? { toast } : {}) });
/** The rail's number as drawn: its words where there is room, its figure on a phone's tile. */
const shownOf = (b: Nd): string[] => b.children.map((c) => `${c.attrs['class']}:${c.textContent}`);
const drawn = (n: number): string[] => [`nl-long:${n} waiting`, `nl-short:${n}`];
const ROSE = { say: 'Amina Yusuf is waiting for you', door: DOOR };

/** A page in a workspace: the rail with its Inbox entry, a main, the slot that asks. Optionally Today's region. */
function page(o: {
  count?: number; today?: boolean; reduce?: boolean;
  respond: (url: string, init: Record<string, unknown>) => Promise<unknown> | undefined;
}) {
  const root = new Nd('HTML');
  const nav = root.appendChild(new Nd('NAV', { class: 'side' }));
  const entry = nav.appendChild(new Nd('A', { class: 'navlink sub', 'data-nav': 'inbox', href: '/app/inbox' }));
  if (o.count) {
    const badge = entry.appendChild(new Nd('SPAN', { class: 'navcount', 'aria-hidden': 'true' }));
    badge.textContent = String(o.count);
    entry.setAttribute('aria-label', `Inbox, ${o.count} customers need you`);
  }
  const main = root.appendChild(new Nd('MAIN'));
  main.appendChild(new Nd('SECTION', { class: 'zone', said: 'before' }));
  let region: Nd | null = null;
  if (o.today) {
    region = main.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/today?since=1.0.0.0.0.0', 'data-live-redraw': '1' }));
    const tpl = root.appendChild(new Nd('TEMPLATE', { 'data-live-news': 'today' }));
    (tpl as unknown as { content: unknown }).content = { cloneNode: () => {
      const f = new Nd('#fragment'); f.appendChild(new Nd('DIV', { class: 'flash live-line', said: 'today' })); return f; } };
  }
  const slot = root.appendChild(new Nd('DIV', { class: 'toasts', role: 'status', 'aria-live': 'polite', 'data-rail': `/app/live/rail?since=${o.count ?? 0}` }));
  // What Today's own address draws now: its zones as they are, and a region with the new mark.
  const fresh = new Nd('MAIN');
  fresh.appendChild(new Nd('SECTION', { class: 'zone', said: 'after' }));
  fresh.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/today?since=2.0.0.0.0.0', 'data-live-redraw': '1' }));
  const doc = Object.assign(new Nd('#document'), {
    visibilityState: 'visible', title: 'Before', activeElement: null as Nd | null,
    querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
    getElementById: (id: string) => root.all().find((e) => e.id === id) ?? null,
    createElement: (tag: string) => new Nd(tag.toUpperCase()),
    adoptNode: (n: Nd) => n,
  });
  let now = 0; let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const asked: string[] = [];
  const location = { pathname: '/app', search: '', href: 'https://nomi.test/app', reloads: 0, reload() { this.reloads += 1; } };
  const win = Object.assign(new Nd('#window'), {
    innerHeight: 800,
    matchMedia: (q: string) => ({ matches: !!o.reduce && q.includes('reduce') }),
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
    fetch: (u: string, init: Record<string, unknown>) => {
      asked.push(u);
      return o.respond(u, init) ?? Promise.resolve(u.startsWith('/app/live/rail') ? rail(o.count ?? 0) : json({ news: false }));
    },
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
    doc, entry, main, slot, region, asked, location,
    badge: () => entry.querySelector('span.navcount'),
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

describe('phase 8 · the rail: a customer newly waiting marks Inbox, and its number is redrawn in place', () => {
  it('every page asks the rail\'s address every twenty seconds, from the count it was drawn with', async () => {
    const p = page({ count: 2, respond: () => undefined });
    p.run();
    expect(p.asked).toEqual([]);
    expect(p.waits()).toEqual([20_000]);
    await p.advance(20_000);
    expect(p.asked).toEqual(['/app/live/rail?since=2']);
  });

  it('a rise: the dot on Inbox, the number redrawn, its spoken name with it — and the next question asks from the new count', async () => {
    const p = page({ count: 2, respond: (u) => (u.endsWith('since=2') ? Promise.resolve(rail(3, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    expect(p.entry.getAttribute('data-fresh')).toBe('1');
    expect(shownOf(p.badge()!)).toEqual(drawn(3));
    expect(p.entry.getAttribute('aria-label')).toBe('Inbox, 3 customers need you');
    expect(p.entry.querySelectorAll('span.navcount')).toHaveLength(1);
    await p.advance(20_000);
    expect(p.asked).toEqual(['/app/live/rail?since=2', '/app/live/rail?since=3.300']);
  });

  it('from none waiting: the number appears, drawn as the shell draws it', async () => {
    const p = page({ respond: () => Promise.resolve(rail(1, ROSE)) });
    p.run();
    expect(p.badge()).toBeNull();
    await p.advance(20_000);
    const badge = p.badge()!;
    expect(shownOf(badge)).toEqual(drawn(1));
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.parentNode).toBe(p.entry);
  });

  it('nothing happens when the count does not rise: no dot, no card — and a count that falls is redrawn quietly', async () => {
    let n = 2;
    const p = page({ count: 2, respond: () => Promise.resolve(rail(n)) });
    p.run();
    await p.advance(20_000);
    expect(p.entry.getAttribute('data-fresh')).toBeNull();
    expect(p.slot.children).toEqual([]);
    expect(shownOf(p.badge()!)).toEqual(drawn(2));
    n = 1;
    await p.advance(20_000);
    expect(shownOf(p.badge()!)).toEqual(drawn(1));
    expect(p.entry.getAttribute('data-fresh')).toBeNull();
    expect(p.slot.children).toEqual([]);
    // none waiting: no number, no spoken count
    n = 0;
    await p.advance(20_000);
    expect(p.badge()).toBeNull();
    expect(p.entry.getAttribute('aria-label')).toBeNull();
  });

  it('asks nothing while the tab is hidden, and stops for good when signed out', async () => {
    const p = page({ count: 1, respond: () => undefined });
    p.run();
    p.doc.visibilityState = 'hidden';
    p.doc.fire('visibilitychange');
    await p.advance(600_000);
    expect(p.asked).toEqual([]);
    p.doc.visibilityState = 'visible';
    p.doc.fire('visibilitychange');
    await p.advance(0);
    expect(p.asked).toHaveLength(1);

    const out = page({ count: 1, respond: () => Promise.resolve(json({ n: 0 }, 401)) });
    out.run();
    await out.advance(20_000);
    expect(out.waits()).toEqual([]);
    await out.advance(3_600_000);
    expect(out.asked).toHaveLength(1);
  });
});

describe('phase 8 · the card: who and why, a door to the conversation, gone after six seconds or a tap', () => {
  it('appears once, as a link with the line as its text — the script writes no markup', async () => {
    const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    expect(p.slot.children).toHaveLength(1);
    const card = p.slot.children[0]!;
    expect(card.tagName).toBe('A');
    expect(card.className).toBe('toast');
    expect(card.href).toBe(DOOR);
    expect(card.textContent).toBe('Amina Yusuf is waiting for you');
    expect(card.children).toEqual([]);
    // the next answer (no rise) adds nothing
    await p.advance(5_000);
    expect(p.slot.children).toHaveLength(1);
  });

  // The motion pass (2026-10-04): after its six seconds it slides out (the stylesheet's "out"), and is gone a beat later.
  it('goes after six seconds: it slides out, and is gone once it has', async () => {
    const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    const card = p.slot.children[0]!;
    await p.advance(5_999);
    expect(p.slot.children).toHaveLength(1);
    expect(card.className).toBe('toast');
    await p.advance(1);
    expect(p.slot.children).toEqual([card]);
    expect(card.className).toBe('toast out');
    await p.advance(250);
    expect(p.slot.children).toEqual([]);
  });

  it('goes when tapped', async () => {
    const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    p.slot.children[0]!.fire('click', { button: 0 });
    expect(p.slot.children).toEqual([]);
  });

  it('one at a time: a second arrival takes the first one\'s place, and keeps its own six seconds', async () => {
    const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE))
      : u.endsWith('since=1.100') ? Promise.resolve(rail(2, { say: 'Omar said yes to an order', door: DOOR })) : undefined) });
    p.run();
    await p.advance(20_000);
    await p.advance(4_000);
    expect(p.slot.children.map((c) => c.textContent)).toEqual(['Amina Yusuf is waiting for you']);
    await p.advance(16_000);
    expect(p.slot.children.map((c) => c.textContent)).toEqual(['Omar said yes to an order']);
    await p.advance(5_999);
    expect(p.slot.children).toHaveLength(1);
    await p.advance(251);
    expect(p.slot.children).toEqual([]);
  });

  it('a door that is not an address of this app is never drawn', async () => {
    for (const door of ['https://elsewhere.example/app/inbox/x', '//elsewhere.example/app', 'javascript:void(0)', '/login', '']) {
      const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, { say: 'x', door })) : undefined) });
      p.run();
      await p.advance(20_000);
      expect(p.slot.children, door).toEqual([]);
      expect(shownOf(p.badge()!), door).toEqual(drawn(1));
    }
  });

  it('for a reader who asked for less motion, the same card comes and goes; the script moves nothing itself', async () => {
    const p = page({ count: 0, reduce: true, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    const card = p.slot.children[0]!;
    expect(card.getAttribute('style')).toBeNull();
    expect(card.className).toBe('toast');
    await p.advance(6_250);
    expect(p.slot.children).toEqual([]);
    // the card's rise is the stylesheet's, inside prefers-reduced-motion: no-preference (notifications.test.ts)
    // The one thing the script moves itself is the advisor's orb, on its own canvas, on its own page, and never
    // for a reader who asked for less motion (2026-10-07; tests/parity/advisor-orb.test.ts). Everything else, nothing.
    const orbAt = LIVE_SCRIPT.indexOf("  /* The advisor's orb (item 9)");
    const orbEnd = LIVE_SCRIPT.indexOf("  /* A customer's photo that does not arrive");
    expect(orbAt).toBeGreaterThan(0);
    expect(orbEnd).toBeGreaterThan(orbAt);
    const outsideOrb = LIVE_SCRIPT.slice(0, orbAt) + LIVE_SCRIPT.slice(orbEnd);
    for (const moving of ['.style', 'animate(', 'transition', 'requestAnimationFrame']) expect(outsideOrb, moving).not.toContain(moving);
    expect(LIVE_SCRIPT.slice(orbAt, orbEnd).match(/requestAnimationFrame/g)).toHaveLength(3);
  });

  it('no sound, no counter in the tab\'s title, no browser notice', () => {
    for (const never of ['Audio', '.play(', 'vibrate', 'Notification', 'favicon', 'setAppBadge']) expect(LIVE_SCRIPT, never).not.toContain(never);
    expect(LIVE_SCRIPT).not.toMatch(/doc\.title = [^n]/);   // the title is only ever the redrawn page's own
  });
});

describe('phase 8 · Today updates in place', () => {
  it('news draws the page\'s main again from its own address — no line, no reload — and asks again from the new page', async () => {
    const p = page({ today: true, respond: (u) => (u.startsWith('/app/live/today?since=1.') ? Promise.resolve(json({ news: true, what: 'today' }))
      : u === '/app' ? Promise.resolve(htmlOf()) : undefined) });
    p.run();
    await p.advance(20_000);
    expect(p.asked).toContain('/app');
    expect(p.main.children.map((c) => c.attrs['said'] ?? c.attrs['data-live'])).toEqual(['after', '/app/live/today?since=2.0.0.0.0.0']);
    expect(p.region!.children).toEqual([]);
    expect(p.location.reloads).toBe(0);
    expect(p.doc.title).toBe('After');
    await p.advance(20_000);
    expect(p.asked).toContain('/app/live/today?since=2.0.0.0.0.0');
  });

  it('if the page cannot be had, the line is shown instead', async () => {
    const p = page({ today: true, respond: (u) => (u.startsWith('/app/live/today') ? Promise.resolve(json({ news: true, what: 'today' }))
      : u === '/app' ? Promise.resolve(htmlOf(false)) : undefined) });
    p.run();
    await p.advance(20_000);
    expect(p.region!.children.map((c) => c.attrs['said'])).toEqual(['today']);
    expect(p.main.children[0]!.attrs['said']).toBe('before');
  });

  it('nothing new: nothing is fetched and nothing moves', async () => {
    const p = page({ today: true, respond: () => undefined });
    p.run();
    await p.advance(60_000);
    expect(p.asked).not.toContain('/app');
    expect(p.main.children[0]!.attrs['said']).toBe('before');
  });
});

describe('the warmth run\'s re-audit (w4-whole-23) · the card is read at the reader\'s pace', () => {
  it('pointed at or focused, it stays; let go, it has its six seconds again', async () => {
    const p = page({ count: 0, respond: (u) => (u.endsWith('since=0') ? Promise.resolve(rail(1, ROSE)) : undefined) });
    p.run();
    await p.advance(20_000);
    const card = p.slot.children[0]!;
    await p.advance(5_000);
    card.fire('mouseenter');
    await p.advance(30_000);
    expect(p.slot.children).toEqual([card]);
    card.fire('mouseleave');
    await p.advance(5_999);
    expect(p.slot.children).toEqual([card]);
    expect(card.className).toBe('toast');
    await p.advance(251);
    expect(p.slot.children).toEqual([]);
  });
});
