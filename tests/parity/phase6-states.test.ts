import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, missingPage, atWork } from '../../src/api/web/layout.js';
import { renderInboxList, type InboxList } from '../../src/api/web/inbox.js';
import { renderAddForm, renderPhotoRefusal } from '../../src/api/web/products.js';
import { renderPageFactsForm } from '../../src/api/web/pageFacts.js';
import { renderClosures, renderForbidden, type ClosureView, type ForbiddenView } from '../../src/api/web/settings.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { t, messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { linkedCss } from './linked-css.js';

/**
 * PHASE 6 OF THE UI REBUILD (2026-10-02) — STATES. Every page has a real empty
 * state, a loading state and an inline error state; form errors are said under
 * the field on the same page, never on a page of their own; no message waits
 * for something that never comes.
 */

const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/api/web');
const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })).replace(/\/\*[\s\S]*?\*\//g, '');
const NOW = new Date('2026-10-02T09:00:00Z');

describe('phase 6 · empty', () => {
  it('an empty state is a panel of its own, never a grey line that reads as the caption of the button above it', () => {
    const rule = /\.empty \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/border:1px dashed var\(--color-border\)/);
    expect(rule).toMatch(/padding:var\(--space-16\)/);
    expect(rule).toMatch(/margin:var\(--space-12\) 0 0/);
    for (const f of readdirSync(WEB).filter((x) => x.endsWith('.ts'))) {
      expect(readFileSync(join(WEB, f), 'utf8'), f).not.toContain('empty-p');
    }
  });

  // The warmth run, phase 4 — "Mine" was team machinery the owner ruled out: the route leads its
  // old address to the whole list (app.ts), so its own empty panel is never drawn any more.
  it('"Mine" is not a view any more: no tab, and no empty panel of its own', () => {
    const list: InboxList = { filter: 'mine', waitingCount: 3, blockedCount: 0, mineCount: 0, deletionCount: 0, channels: 1, conversations: [], query: '' };
    for (const l of LOCALES) {
      const html = withAssistantName('Lily', () => renderInboxList(list, l, NOW));
      expect(html, l).not.toContain(t(l, 'inbox.empty.mine'));
      expect(html, l).not.toContain('filter=mine');
    }
  });

  it('a page that is not there: what is missing, the likely reason, the way back', () => {
    for (const l of LOCALES) {
      const html = missingPage(l, t(l, 'product.notFound'), { href: '/app/products', label: t(l, 'product.detail.back') });
      expect(html, l).toMatch(/^<h1 class="page">/);
      expect(html, l).toContain(`<div class="empty">${t(l, 'common.notFoundBody')}`);
      expect(html, l).toContain('href="/app/products"');
    }
  });
});

describe('phase 6 · errors under their field, on the same page, with what was typed', () => {
  it('a store address that came to nothing: the add page, the reason under the address, the address still in it', () => {
    const html = renderAddForm('en', undefined, 'USD', null, null, false, false,
      { store: { form: 'store', reason: 'not_public', address: 'https://localhost' } });
    expect(html).toMatch(/<input type="text" name="address"[^>]* aria-invalid="true" aria-describedby="store-err" autofocus value="https:\/\/localhost" \/>/);
    expect(html).toContain(`<p class="perr" role="alert" id="store-err">${t('en', 'import.store.refused.not_public', { stated: '' })}</p>`);
    expect(html).toContain('<h1 class="page">');                 // the add page itself
    expect(html).not.toMatch(/<textarea name="text"[^>]*autofocus/);   // the cursor goes to the field that was wrong
  });

  it('a photo that could not be read: under the photo field, with the way on inside the page', () => {
    const html = renderAddForm('en', undefined, 'USD', null, null, false, false, { photo: renderPhotoRefusal('unreadable', 'en') });
    expect(html).toContain('aria-invalid="true" aria-describedby="photo-err" autofocus');
    expect(html).toContain(`<p class="perr" role="alert">${t('en', 'product.photo.refused.unreadable')}</p>`);
    expect(html).toContain('href="/app/products/add#photo"');
  });

  it('a page of the site that came to nothing: on Knowledge, the reason under the address, what was typed kept', () => {
    const html = renderPageFactsForm('en', { address: 'not a shop', text: '', reason: 'not_an_address' });
    expect(html).toContain('value="not a shop" aria-invalid="true" aria-describedby="pf-err" autofocus');
    expect(html).toContain(`<p class="perr" role="alert" id="pf-err">${t('en', 'pageFacts.refused.not_an_address')}</p>`);
    const pasted = renderPageFactsForm('en', { address: '', text: 'We ship in 3 days.', reason: 'not_a_page' });
    expect(pasted).toContain('<details open>');
    expect(pasted).toContain('>We ship in 3 days.</textarea>');
  });

  it('the settings forms: the field that was wrong is marked and says why; everything typed is still there', () => {
    const noClosures: ClosureView = { closures: [] };
    const closures = renderClosures(noClosures, 'en', null,
      { values: { label: 'Eid', from: '2026-12-04', to: '2026-12-01' }, field: 'to', text: t('en', 'closures.flash.ends_before_starts') });
    expect(closures).toContain('value="Eid"');
    expect(closures).toContain('value="2026-12-04"');
    expect(closures).toMatch(/<div class="setrow bad">[\s\S]*?id="cl-to" name="to" type="date" required value="2026-12-01" aria-invalid="true" aria-describedby="cl-to-err" autofocus/);
    expect(closures).toContain(`<span class="fielderr" role="alert" id="cl-to-err">${t('en', 'closures.flash.ends_before_starts')}</span>`);
    const noWords: ForbiddenView = { own: [], floor: [] };
    const words = renderForbidden(noWords, 'en', null, { values: { term: 'cheap', note: 'n' }, field: 'term', text: t('en', 'forbidden.flash.duplicate') });
    expect(words).toContain('value="cheap" aria-invalid="true"');
    expect(words).toContain('value="n"');
  });

  it('no refusal is a page of its own any more: the three "Nothing was …" pages are gone from the catalogue', () => {
    for (const k of ['pageFacts.refusedTitle', 'import.store.refusedTitle', 'product.photo.refusedTitle']) {
      expect(messages.en[k as keyof typeof messages.en], k).toBeUndefined();
    }
  });
});

describe('phase 6 · nothing waits for something that never comes', () => {
  it('Practice no longer promises a reply "when it is ready": the line under it shows the work, and ends', () => {
    for (const l of LOCALES) expect(t(l, 'practice.sent'), l).not.toMatch(/\{name\}/);
    expect(t('en', 'practice.sent')).toBe('Sent.');
  });

  it('something at work says so in place; only the assistant\'s work carries its ✦', () => {
    expect(atWork('Stripe is confirming the card')).toBe('<div class="block working" role="status"><span>Stripe is confirming the card</span>'
      + '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>');
    expect(atWork('x', true)).toContain('<span class="as" aria-hidden="true">✦</span> ');
  });

  it('the guide: a still of each step and how long it takes, before anything is fetched', () => {
    const html = renderGuide({ steps: [], next: 'profile' }, 'en', 'Lily');
    expect(html).toMatch(/<video class="guide-video wide" controls preload="none" playsinline poster="\/assets\/guide\/profile\.en\.jpg">/);
    // Phase 9 (today-onboarding-new-09) — and the phone's own recording, with its own still.
    expect(html).toMatch(/<video class="guide-video narrow" controls preload="none" playsinline poster="\/assets\/guide\/profile\.en\.phone\.jpg">/);
    expect(html).toMatch(/<p class="caption muted">Video · \S+ seconds<\/p>/);
  });
});

/* ── The script: a form on its way, and a limit to asking ─────────────────── */

type Listener = (e: Record<string, unknown>) => void;
class Nd {
  readonly listeners = new Map<string, Listener[]>();
  children: Nd[] = [];
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}) {}
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  getAttribute(n: string): string | null { return n in this.attrs ? this.attrs[n]! : null; }
  setAttribute(n: string, v: string): void { this.attrs[n] = v; }
  removeAttribute(n: string): void { delete this.attrs[n]; }
  appendChild(n: Nd): Nd { this.children.push(n); return n; }
  get firstChild(): Nd | null { return this.children[0] ?? null; }
  all(): Nd[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel: string): Nd | null { return this.all().find(match(sel)) ?? null; }
  querySelectorAll(sel: string): Nd[] { return this.all().filter(match(sel)); }
  content: { cloneNode: () => Nd } | undefined;
}
const match = (sel: string) => (e: Nd): boolean => {
  const m = /^([a-z]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel);
  return !!m && (!m[1] || e.tagName.toLowerCase() === m[1]) && (!m[2] || (e.getAttribute(m[2]) !== null && (m[3] === undefined || e.getAttribute(m[2]) === m[3])));
};

function stage(o: { live?: Record<string, string>; slow?: boolean } = {}) {
  const root = new Nd('HTML');
  const form = root.appendChild(new Nd('FORM', { method: 'post' }));
  const button = form.appendChild(new Nd('BUTTON', { class: 'btn send' }));
  const region = o.live ? root.appendChild(new Nd('DIV', o.live)) : null;
  if (o.slow) {
    const tpl = root.appendChild(new Nd('TEMPLATE', { 'data-live-news': 'slow' }));
    tpl.content = { cloneNode: () => new Nd('DIV', { class: 'flash live-line', said: 'slow' }) };
  }
  const doc = Object.assign(new Nd('#document'), { visibilityState: 'visible', querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s) });
  let now = 0; let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const asked: string[] = [];
  const win = Object.assign(new Nd('#window'), {
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
    fetch: (u: string) => { asked.push(u); return Promise.resolve({ type: 'basic', status: 200, ok: true, json: () => Promise.resolve({ news: false, working: true }) }); },
  });
  vm.runInContext(LIVE_SCRIPT, vm.createContext({
    window: win, document: doc, location: { pathname: '/app/settings/billing', search: '' }, history: {}, URL, fetch: win.fetch,
    setTimeout: (fn: () => void, ms: number) => { seq += 1; due.set(seq, { at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id: number) => { due.delete(id); },
  }));
  const submit = (submitter: Nd | null = button) => {
    const ev: Record<string, unknown> = { type: 'submit', target: form, submitter, defaultPrevented: false };
    ev['preventDefault'] = () => { ev['defaultPrevented'] = true; };
    for (const fn of doc.listeners.get('submit') ?? []) fn(ev);
    return ev;
  };
  return {
    form, button, region, asked, submit,
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
        await new Promise<void>((r) => setImmediate(r));
      }
      now = until;
    },
  };
}

describe('phase 6 · the script: a form on its way, and a limit to asking', () => {
  it('the button that sent it says it is busy; a second press does not send it again; after a while it is itself again', async () => {
    const p = stage();
    expect(p.submit()['defaultPrevented']).toBe(false);
    expect(p.button.getAttribute('aria-busy')).toBe('true');
    expect(p.submit()['defaultPrevented']).toBe(true);           // the second press goes nowhere
    await p.advance(12_000);
    expect(p.button.getAttribute('aria-busy')).toBeNull();
    expect(p.submit()['defaultPrevented']).toBe(false);          // and can be pressed again
  });

  it('a page at work asks for fifteen minutes at most, then says its last word', async () => {
    const p = stage({ live: { 'data-live': '/app/live/billing?since=0.none', 'data-live-working': '1' }, slow: true });
    await p.advance(15 * 60_000 + 10_000);
    const n = p.asked.length;
    expect(n).toBeGreaterThan(200);
    expect(n).toBeLessThanOrEqual(226);
    expect(p.region!.children.map((c) => c.attrs['said'])).toEqual(['slow']);
    await p.advance(10 * 60_000);
    expect(p.asked.length).toBe(n);                             // and asks no more
  });
});
