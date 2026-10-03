import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import Fastify from 'fastify';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { shell, loginPage, signupPage, verifyPage, errorPage, publicDocument, conversationUrl, assetAt, LIVE_SLOT } from '../../src/api/web/layout.js';
import { liveRegion, flashBanner } from '../../src/api/web/flash.js';
import { liveNews, isMark, todayMark, conversationWatch, buyersWatch, todayWatch } from '../../src/api/web/live.js';
import { renderConversationDetail, buyersHref, type ConversationDetail } from '../../src/api/web/inbox.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { esc } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { usd } from '../../src/core/types/money.js';

/**
 * CC-26 — "Nothing on the page updates by itself. A new buyer message appears
 * only if she reloads, and there is no script anywhere in the app to tell her."
 *
 * Held here without a database or a browser:
 *   - the shell links ONE script, from the assets route, deferred, on every
 *     owner page and nowhere else; the route serves it like the stylesheets;
 *   - the script is small, parses, and says nothing the owner surface bans;
 *   - each watching page draws an empty polite live region with its address
 *     and mark, and the line waits in a template, in three languages;
 *   - the comparison that decides "is there news?";
 *   - and what the script DOES, run as the browser runs it against a small
 *     stand-in for the page: it asks, says the line once, stops; it asks
 *     nothing while the tab is hidden; it backs off, and stops when signed out;
 *     its door reloads and lands on `#latest`; a half-typed reply survives a
 *     reload, in its own box, and is forgotten once sent.
 * Over Postgres: `tests/integration/live-refresh.test.ts`. In a real browser:
 * `docs/design/live-refresh/`.
 */

const CONV = '6c1e0000-0000-4000-8000-00000000c026';
const OTHER = '6c1e0000-0000-4000-8000-00000000c027';
const DRAFT = '7d2f0000-0000-4000-8000-00000000d026';

const page = (locale: Locale, live?: string, path = '/app') =>
  shell({ title: 'T', active: 'home', locale, path, bodyHtml: '<p>body</p>', ...(live ? { live } : {}) });

const scriptsOf = (html: string) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];

describe('CC-26 · the shell links the one script, and nothing else does', () => {
  it('every owner page links it once, deferred, from the assets route, never inline — in every language', () => {
    const hrefs = new Set<string>();
    for (const l of LOCALES) {
      const s = scriptsOf(page(l));
      expect(s, l).toHaveLength(1);
      const m = /^<script src="(\/assets\/live\.[0-9a-f]{16}\.js)" defer><\/script>$/.exec(s[0]![0]);
      expect(m, l).not.toBeNull();
      hrefs.add(m![1]!);
      expect(s[0]![1], l).toBe('');
      // in the head, after the stylesheet: fetched early, run once the page is read
      const html = page(l);
      expect(html.indexOf(m![1]!), l).toBeLessThan(html.indexOf('</head>'));
    }
    expect(hrefs.size, 'one address for every page and every language').toBe(1);
  });

  it('the door, the sign-up, the code, the error page and every public document run nothing', () => {
    for (const html of [
      loginPage({ locale: 'en', path: '/login' }),
      signupPage({ locale: 'ar', path: '/signup', mode: 'open', passwordMin: 10 }),
      verifyPage({ locale: 'zh', path: '/verify', maskedEmail: 'o***@example.com', purpose: 'device' }),
      errorPage({ locale: 'en', path: '/nope', kind: 'notfound' }),
      publicDocument({ locale: 'en', title: 'T', body: '<p>x</p>' }),
    ]) expect(html).not.toContain('<script');
  });

  it('the assets route serves it: kept for good at its own address, not at an old one, nothing else', async () => {
    const a = Fastify({ logger: false });
    registerWebApp(a, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
      businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
      secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    });
    const href = scriptsOf(page('en'))[0]![0].match(/src="([^"]+)"/)![1]!;
    const exact = await a.inject({ method: 'GET', url: href });
    expect(exact.statusCode).toBe(200);
    expect(exact.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(exact.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(exact.headers['x-content-type-options']).toBe('nosniff');
    expect(exact.body).toBe(LIVE_SCRIPT);
    const old = await a.inject({ method: 'GET', url: '/assets/live.0123456789abcdef.js' });
    expect(old.statusCode).toBe(200);
    expect(old.headers['cache-control']).toBe('no-cache');
    expect(old.body).toBe(LIVE_SCRIPT);
    for (const bad of ['/assets/live.js', '/assets/live.0123456789abcdef.css', '/assets/app.0123456789abcdef.js', '/assets/nope.0123456789abcdef.js']) {
      expect((await a.inject({ method: 'GET', url: bad })).statusCode, bad).toBe(404);
    }
    expect(assetAt(href.slice('/assets/'.length))?.type).toBe('text/javascript; charset=utf-8');
    await a.close();
  });

  it('the script is small, parses, and says nothing the owner surface bans', () => {
    // G5b — turning on alerts on this phone lives here too (the page's one
    // script; the phone's worker is the second, `/sw.js`): 9,000 became 10,500.
    // Phase 5 — drawing the assistant's answer into the page in place, without
    // a reload (the redraw and one watcher at a time), and asking first in the
    // product's own dialog instead of the browser's box: 10,500 became 16,000.
    // Phase 6 — a busy button on a form on its way, and a limit to asking: 17,500.
    // The warmth run, phase 8 — the rail's question from every page, its marker, its number and
    // the one card, and Today drawn again in place; the browser's own order notice retired, and
    // one asker shared by every question. Measured at 18,433; the cap is that plus 4,000, raised
    // deliberately, for the driver's profile card (about 3 KB) and failed-photo handling (0.3 KB).
    expect(LIVE_SCRIPT.length, 'small: one file an owner fetches once per build').toBeLessThan(23_500);
    // The warmth run's re-audit (w4-whole-03/05/22/23, w4-settings-a-15): the rail's words kept on update, the card held while
    // read, a pressed face's busy state, the same-page door, the form checked before asking — 22,451 measured, raised deliberately.
    expect(() => new vm.Script(LIVE_SCRIPT)).not.toThrow();
    // It ships to the owner's browser like the stylesheet, and is held to the same list.
    // The exceptions are the browser's own two names for the answer's format — the
    // `.json()` method and the `application/json` type it asks for — and (G5b) the
    // browser's own way to hand over a push subscription, `JSON.stringify(sub)`:
    // never words she reads.
    expect(LIVE_SCRIPT.match(/\.json\(\)|application\/json|JSON\.stringify\(sub\)/g)).toHaveLength(3);
    const text = LIVE_SCRIPT.replace(/\.json\(\)|application\/json|JSON\.stringify\(sub\)/g, '').toLowerCase();
    for (const banned of [...BANNED_OWNER_TERMS, 'stack']) {
      const b = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(b) ? new RegExp(`(?<![a-z-])${b}(?![a-z-])`).test(text) : text.includes(b);
      expect(hit, `"${banned}" in the script`).toBe(false);
    }
    expect(LIVE_SCRIPT).not.toContain('%');
    // It writes no markup of its own and runs nothing it is handed.
    for (const never of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'http:', 'https:']) {
      expect(LIVE_SCRIPT, never).not.toContain(never);
    }
  });
});

describe('CC-26 · the live region: empty, polite, and the line waiting in a template', () => {
  const W = conversationWatch(CONV, `4.${DRAFT}.0123abcd`);

  it('each watching page says where it asks, from which mark, and where the door lands', () => {
    expect(W.ask).toBe(`/app/live/conversation/${CONV}?since=4.${DRAFT}.0123abcd`);
    expect(W.door).toBe(conversationUrl(CONV));
    expect(W.door.endsWith('#latest')).toBe(true);
    expect(W.says.map((s) => s.what)).toEqual(['message', 'reply', 'changed']);
    // The warmth run, phase 4 — the whole list writes no `filter=all`, and the door keeps the lens.
    const b = buyersWatch('12.0123456789abcdef', buyersHref({ filter: 'all', lens: 'value', q: 'Haddad' }));
    expect(b.ask).toBe('/app/live/buyers?since=12.0123456789abcdef');
    expect(b.door).toBe('/app/inbox?lens=value&q=Haddad');
    expect(b.says.map((s) => s.what)).toEqual(['list']);
    const d = todayWatch('1.2.0.0.1');
    expect(d.ask).toBe('/app/live/today?since=1.2.0.0.1');
    expect(d.door).toBe('/app');
    expect(d.says.map((s) => s.what)).toEqual(['today']);
    for (const w of [W, b, d]) expect(w.ask).not.toContain('%');
  });

  it('the region is empty and present from the start; the line is a notice in the good-news tone, and all of it one door', () => {
    for (const l of LOCALES) {
      const html = liveRegion(l, W);
      const region = /^<div class="live" role="status" aria-live="polite" data-live="([^"]+)"><\/div>/.exec(html);
      expect(region, l).not.toBeNull();
      expect(region![1], l).toBe(esc(W.ask));
      const tpls = [...html.matchAll(/<template data-live-news="([a-z]+)">([\s\S]*?)<\/template>/g)];
      expect(tpls.map((m) => m[1]), l).toEqual(['message', 'reply', 'changed']);
      for (const [, what, inner] of tpls) {
        // the sentence is the door's label; the chevron says where it leads (and mirrors in Arabic)
        expect(inner, `${l} ${what}`).toBe(`<div class="flash live-line"><a class="deeper live-door" href="${esc(W.door)}">${
          esc(t(l, `live.${what}` as 'live.message'))}<span class="go" aria-hidden="true">›</span></a></div>`);
        expect(inner, `${l} ${what}`).not.toContain('role=');   // the region announces; the line does not interrupt
      }
      // Nothing of it is drawn until the script puts it in: outside the templates, the region is all there is.
      expect(html.replace(/<template[\s\S]*?<\/template>/g, ''), l).toBe(region![0]);
    }
  });

  it('says it in three languages, right to left in Arabic, with nothing the owner surface bans', () => {
    const keys = ['live.message', 'live.reply', 'live.changed', 'live.list', 'live.today'] as const;
    for (const l of LOCALES) {
      const said = keys.map((k) => t(l, k));
      for (const s of said) {
        expect(s.trim(), `${l}: a sentence`).not.toBe('');
        expect(s, l).not.toContain('%');
        // a door's label, like every door in the product: no closing stop before the chevron
        expect(s, `${l}: "${s}"`).not.toMatch(/[.。؟?!]\s*$/);
        for (const banned of [...BANNED_OWNER_TERMS, 'automatically', '自动', 'تلقائي']) {
          const hit = /^[A-Za-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`, 'i').test(s) : s.includes(banned);
          expect(hit, `${l}: "${banned}" in "${s}"`).toBe(false);
        }
      }
      if (l !== 'en') for (const k of keys) expect(t(l, k), `${l}: ${k} is translated`).not.toBe(t('en', k));
      const html = page(l, liveRegion(l, W), `/app/inbox/${CONV}`);
      expect(html).toContain(`<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}">`);
    }
    // the reply's sentence names the assistant the page names, and no pronoun
    expect(t('en', 'live.reply', { name: 'Noor' })).toBe('A new reply from Noor is waiting for you');
    expect(t('en', 'live.reply')).toBe('A new reply from your assistant is waiting for you');
  });

  it('the shell puts the region where the page\'s header marks it — else under the title — never at the foot (UI-PASS 6)', () => {
    const inHeader = shell({ title: 'T', active: 'inbox', locale: 'en', path: `/app/inbox/${CONV}`, live: liveRegion('en', W),
      bodyHtml: `<div class="dhead"><h1 class="who">Maya</h1>${LIVE_SLOT}</div><p>body</p><form><button>Send</button></form>` });
    const main = inHeader.slice(inHeader.indexOf('<main'), inHeader.indexOf('</main>'));
    expect(main.indexOf('<div class="live"')).toBeGreaterThan(main.indexOf('<h1 class="who">'));
    expect(main.indexOf('<div class="live"')).toBeLessThan(main.indexOf('<p>body</p>'));
    expect(main).not.toContain(LIVE_SLOT);
    expect(main.endsWith('</form>')).toBe(true);   // nothing after the controls
    // a page that marks no place: under its title, before what it draws
    const html = page('en', liveRegion('en', W), `/app/inbox/${CONV}`);
    const plain = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(plain.indexOf('<div class="live"')).toBeLessThan(plain.indexOf('<p>body</p>'));

    // a page that watches nothing draws no region, and the notice banner is still the one banner
    expect(page('en')).not.toContain('class="live"');
    expect(flashBanner({ text: 'Sent.', bad: false })).toBe('<div class="flash" role="status">Sent.</div>');
  });

  it('the line is styled once, in the shell: in the header\'s flow — never sticky, never fixed over a control', () => {
    const css = linkedCss(page('en'));
    const live = /\n\s*\.live \{([^}]*)\}/.exec(css)![1]!;
    expect(live).not.toMatch(/position/);
    expect(css).not.toMatch(/\.live \{[^}]*position:(sticky|fixed)/);
    expect(css).not.toContain('main.wide > .live');
    expect(css).toContain('.dhead .live { margin-inline-start:auto; }');
    // spacing from the scale, a shadow from the tokens, and no colour of its own: the notice's
    for (const sel of ['.live', '.live-line', '.live-line .deeper']) {
      const rule = new RegExp(`\\n\\s*${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)![1]!;
      expect(rule, sel).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|[0-9]px/);
      expect(rule, sel).not.toMatch(/(^|[^-])color:\s*var\(--color-(?!ink)/);
    }
  });
});

describe('CC-26 · the half-typed reply is marked for keeping — the two boxes, and nothing else', () => {
  const base: ConversationDetail = {
    conversationId: CONV, buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    product: { name: 'Vacuum cup', nameZh: null }, quantity: 500, quote: null, order: null,
    messages: [{ direction: 'inbound', text: 'Price for 500?', at: new Date('2026-09-28T08:00:00Z') }],
    pendingDraft: { draftId: DRAFT, draftText: 'For 500 pcs: $0.92/pc.', capability: 'quote' },
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
    lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
    proof: { quoteId: null, token: null },
  };
  const NOW = new Date('2026-09-28T09:00:00Z');

  it('UI-PASS 6 · the conversation marks the live line\'s place in its header row, above the card', () => {
    const html = renderConversationDetail(base, 'en', NOW, null);
    const head = /<div class="dhead">[\s\S]*?<\/div>/.exec(html)![0];
    expect(head).toContain(LIVE_SLOT);
    expect(html.indexOf(LIVE_SLOT)).toBeLessThan(html.indexOf('id="approve"') === -1 ? Infinity : html.indexOf('id="approve"'));
  });

  it('the draft\'s edit box, keyed by its conversation', () => {
    const html = renderConversationDetail({ ...base, quote: { unitPrice: usd(0.92), total: usd(460), quantity: 500 } }, 'en', NOW, null);
    expect(html).toMatch(new RegExp(`<textarea id="reply" name="edit"[^>]*data-keep="${CONV}:edit">For 500 pcs: \\$0\\.92/pc\\.</textarea>`));
    expect(html.match(/data-keep=/g)).toHaveLength(1);
  });

  it('the owner\'s own reply box, keyed by its conversation — and its kept words (CC-24) are its default', () => {
    const html = renderConversationDetail({ ...base, ownership: 'OWNER_CONTROLLED', pendingDraft: null, ownerUnsentReply: 'Hello again' }, 'ar', NOW, null);
    expect(html).toMatch(new RegExp(`<textarea name="text"[^>]*required data-keep="${CONV}:reply">Hello again</textarea>`));
    expect(html.match(/data-keep=/g)).toHaveLength(1);
  });

  it('a window further back has nothing to keep; nor does the voice correction', () => {
    const older = renderConversationDetail({ ...base, transcript: { earlier: null, older: true } }, 'en', NOW, null);
    expect(older).not.toContain('data-keep');
    const voiced = renderConversationDetail({ ...base, pendingDraft: null, messages: [
      { direction: 'inbound', text: 'hello', at: NOW, heard: 'voice', id: '11111111-1111-4111-8111-111111111111' }] }, 'en', NOW, null);
    expect(voiced).toContain('name="heard"');
    expect(voiced).not.toContain('data-keep');
  });
});

describe('CC-26 · is there news? — the one comparison', () => {
  it('a conversation: the buyer wrote; else a reply waits that is not the one on the page; else it changed', () => {
    const S = '0123abcd';                          // who holds it, what did not go — as the page was drawn
    const T = 'fedc4321';                          // …and as it is now
    expect(liveNews('conversation', `3.0.${S}`, `3.0.${S}`)).toEqual({ news: false });
    expect(liveNews('conversation', `3.0.${S}`, `4.0.${S}`)).toEqual({ news: true, what: 'message' });
    // all at once: the message first, then the reply, then the rest
    expect(liveNews('conversation', `3.${DRAFT}.${S}`, `4.${OTHER}.${T}`)).toEqual({ news: true, what: 'message' });
    expect(liveNews('conversation', `3.${DRAFT}.${S}`, `3.${OTHER}.${T}`)).toEqual({ news: true, what: 'reply' });
    expect(liveNews('conversation', `3.0.${S}`, `3.${DRAFT}.${S}`)).toEqual({ news: true, what: 'reply' });
    expect(liveNews('conversation', `3.${DRAFT}.${S}`, `3.${DRAFT}.${S}`)).toEqual({ news: false });
    // handed to a person, taken by a colleague, a message that did not go
    expect(liveNews('conversation', `3.0.${S}`, `3.0.${T}`)).toEqual({ news: true, what: 'changed' });
    // decided elsewhere, nothing waiting now: stale, but not news — the button there answers with a sentence
    expect(liveNews('conversation', `3.${DRAFT}.${S}`, `3.0.${S}`)).toEqual({ news: false });
    // fewer of the buyer's messages is an erasure, not a message
    expect(liveNews('conversation', `3.0.${S}`, `2.0.${S}`)).toEqual({ news: false });
    // counts compare as numbers, not as text
    expect(liveNews('conversation', `9.0.${S}`, `10.0.${S}`)).toEqual({ news: true, what: 'message' });
  });

  it('Buyers and Today: any difference, said as "changed", never "new"', () => {
    expect(liveNews('buyers', '5.0123456789abcdef', '5.0123456789abcdef')).toEqual({ news: false });
    expect(liveNews('buyers', '5.0123456789abcdef', '5.fedcba9876543210')).toEqual({ news: true, what: 'list' });
    expect(liveNews('buyers', '5.0123456789abcdef', '4.0123456789abcdef')).toEqual({ news: true, what: 'list' });
    expect(liveNews('today', '1.0.0.0.0', '1.0.0.0.0')).toEqual({ news: false });
    expect(liveNews('today', '1.0.0.0.0', '0.0.0.0.0')).toEqual({ news: true, what: 'today' });
    expect(todayMark({ pendingApprovals: 2, handoffs: 1, ownerHandling: 0, blockedMessages: 3, deletionAsks: 1, ordersWaiting: 2 })).toBe('2.1.0.3.1.2');
    expect(todayMark({ pendingApprovals: 2, handoffs: 1, ownerHandling: 0, blockedMessages: 3 })).toBe('2.1.0.3.0.0');
  });

  it('a mark is only what a page could carry — anything else is refused, never guessed at', () => {
    for (const ok of ['0.0.d41d8cd9', '12.0.0123abcd', `3.${DRAFT}.0123abcd`]) expect(isMark('conversation', ok), ok).toBe(true);
    for (const bad of ['', '3', '3.0', '03.0.0123abcd', '3.x.0123abcd', `3.${DRAFT}`, `3.${DRAFT}.1`, '-1.0.0123abcd',
      '3.0.0123ABCD', '3.0.0123abcde', `3.${DRAFT.toUpperCase()}.0123abcd`, 3, null, undefined, ['3.0.0123abcd']]) {
      expect(isMark('conversation', bad), String(bad)).toBe(false);
    }
    expect(isMark('buyers', '0.d41d8cd98f00b204')).toBe(true);
    for (const bad of ['0.d41d8cd98f00b20', '0.d41d8cd98f00b2045', '0.D41D8CD98F00B204', 'x.d41d8cd98f00b204']) expect(isMark('buyers', bad), bad).toBe(false);
    // 0080 — six counts: the orders waiting for the owner's tap are the sixth.
    expect(isMark('today', '0.0.0.0.0.0')).toBe(true);
    for (const bad of ['0.0.0.0.0', '0.0.0.0.0.0.0', '0.0.0.0.0.a', '1e3.0.0.0.0.0']) expect(isMark('today', bad), bad).toBe(false);
  });
});

// ── The script, run as the browser runs it ─────────────────────────────────

type Listener = (e: Record<string, unknown>) => void;

class Node0 {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e: Record<string, unknown> = {}): Record<string, unknown> {
    const ev: Record<string, unknown> = { type, target: this, defaultPrevented: false, ...e };
    ev['preventDefault'] = () => { ev['defaultPrevented'] = true; };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
}

class El extends Node0 {
  children: El[] = [];
  value = '';
  defaultValue = '';
  selectionStart = 0;
  selectionEnd = 0;
  focusedWith: unknown = undefined;
  form: El | undefined;
  action = '';
  href = '';
  content: { cloneNode: (deep: boolean) => { fragment: El[] } } | undefined;
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}) { super(); }
  getAttribute(n: string): string | null { return n in this.attrs ? this.attrs[n]! : null; }
  get firstChild(): El | null { return this.children[0] ?? null; }
  appendChild(node: El | { fragment: El[] }): void {
    if ('fragment' in node) this.children.push(...node.fragment); else this.children.push(node);
  }
  querySelector(sel: string): El | null {
    const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
    return all(this).find((c) => c.tagName.toLowerCase() === sel) ?? null;
  }
  focus(opts?: unknown): void { this.focusedWith = opts ?? true; }
  setSelectionRange(a: number, b: number): void { this.selectionStart = a; this.selectionEnd = b; }
}

/** The small part of a page the script touches, with a clock we turn by hand. */
function standIn(o: {
  live?: string; boxes?: { keep: string; text: string; action: string }[];
  templates?: string[]; href?: string; door?: string; memory?: Map<string, string> | 'refusing';
  answers?: ((init: Record<string, unknown>) => Promise<unknown>)[];
  /** The browser can let a request go (every current one can). */
  abortable?: boolean;
} = {}) {
  const els: El[] = [];
  const region = o.live === undefined ? null : new El('DIV', { 'data-live': o.live, class: 'live' });
  if (region) els.push(region);
  // The door is conversationUrl(): the conversation's own address, landing on its newest message.
  const doorHref = o.door ?? `https://nomi.test/app/inbox/${CONV}#latest`;
  for (const what of o.templates ?? ['message', 'reply']) {
    const tpl = new El('TEMPLATE', { 'data-live-news': what });
    tpl.content = { cloneNode: () => {
      const line = new El('DIV', { class: 'flash live-line', said: what });
      const a = new El('A', { class: 'deeper live-door' });
      a.href = doorHref;
      line.children.push(a);
      return { fragment: [line] };
    } };
    els.push(tpl);
  }
  const forms = new Map<string, El>();
  for (const b of o.boxes ?? []) {
    const form = forms.get(b.action) ?? new El('FORM');
    form.action = b.action;
    forms.set(b.action, form);
    const box = new El('TEXTAREA', { 'data-keep': b.keep });
    box.value = b.text; box.defaultValue = b.text; box.form = form;
    els.push(box);
  }
  const match = (sel: string) => {
    const m = /^([a-z]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel)!;
    return (e: El) => (!m[1] || e.tagName.toLowerCase() === m[1])
      && (!m[2] || (e.getAttribute(m[2]) !== null && (m[3] === undefined || e.getAttribute(m[2]) === m[3])));
  };
  const doc = Object.assign(new Node0(), {
    visibilityState: 'visible',
    querySelector: (sel: string) => els.find(match(sel)) ?? null,
    querySelectorAll: (sel: string) => els.filter(match(sel)),
  });
  const store = o.memory === 'refusing' ? undefined : (o.memory ?? new Map<string, string>());
  const sessionStorage = store
    ? {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
      }
    : { getItem: () => { throw new Error('refused'); }, setItem: () => { throw new Error('refused'); },
        removeItem: () => { throw new Error('refused'); }, key: () => null, length: 0 };

  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const asked: { url: string; init: Record<string, unknown> }[] = [];
  const answers = [...(o.answers ?? [])];
  const url = new URL(o.href ?? `https://nomi.test/app/inbox/${CONV}`);
  const location = {
    get href() { return url.href; }, get pathname() { return url.pathname; },
    get search() { return url.search; }, get hash() { return url.hash; },
    reloads: 0, reload() { this.reloads += 1; },
  };
  const history = {
    scrollRestoration: 'auto', state: { at: 'here' } as unknown, replaced: [] as string[],
    replaceState(_s: unknown, _t: string, to: string) { this.replaced.push(to); url.href = new URL(to, url.href).href; },
  };
  const win = Object.assign(new Node0(), {
    sessionStorage,
    ...(o.abortable ? { AbortController } : {}),
    fetch: (u: string, init: Record<string, unknown>) => {
      asked.push({ url: u, init });
      const next = answers.shift();
      return next ? next(init) : Promise.resolve(said({ news: false }));
    },
  });
  const context = vm.createContext({
    window: win, document: doc, location, history, URL,
    fetch: win.fetch,
    setTimeout: (fn: () => void, ms: number) => { seq += 1; due.set(seq, { at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id: number) => { due.delete(id); },
  });
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    doc, win, region, store, asked, location, history,
    boxes: els.filter((e) => e.tagName === 'TEXTAREA'),
    forms: [...forms.values()],
    run: () => new vm.Script(LIVE_SCRIPT).runInContext(context),
    /** The waits the script has asked for, from now. */
    waits: () => [...due.values()].map((d) => d.at - now).sort((a, b) => a - b),
    /** Turn the clock, running what falls due and letting each answer land. */
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        due.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await flush();
      }
      now = until;
      await flush();
    },
    answer: (a: (init: Record<string, unknown>) => Promise<unknown>) => { answers.push(a); },
    flush,
  };
}

/** A reply as fetch hands it over. */
const said = (body: unknown, status = 200, type = 'basic') =>
  ({ type, status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

describe('CC-26 · the script asks, says the line once, and stops', () => {
  it('a page that watches nothing asks nothing', async () => {
    const p = standIn();
    p.run();
    await p.advance(120_000);
    expect(p.asked).toEqual([]);
    expect(p.waits()).toEqual([]);
  });

  it('asks the page\'s own address every twenty seconds, as JSON, never followed to a sign-in page', async () => {
    const p = standIn({ live: `/app/live/conversation/${CONV}?since=3.0` });
    p.run();
    expect(p.asked).toEqual([]);                 // nothing on load: the page was drawn a moment ago
    expect(p.waits()).toEqual([20_000]);
    await p.advance(20_000);
    expect(p.asked).toHaveLength(1);
    expect(p.asked[0]!.url).toBe(`/app/live/conversation/${CONV}?since=3.0`);
    expect(p.asked[0]!.init).toMatchObject({
      credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/json' },
    });
    expect(p.region!.children).toEqual([]);
    expect(p.waits()).toEqual([20_000]);
    await p.advance(60_000);
    expect(p.asked).toHaveLength(4);
    expect(p.region!.children).toEqual([]);
  });

  it('says the line the answer names, once, and stops asking — it never reloads by itself', async () => {
    const p = standIn({ live: '/app/live/conversation/x?since=3.0', answers: [
      () => Promise.resolve(said({ news: false })),
      () => Promise.resolve(said({ news: true, what: 'reply' })),
    ] });
    p.run();
    await p.advance(40_000);
    expect(p.region!.children).toHaveLength(1);
    expect(p.region!.children[0]!.attrs['said']).toBe('reply');
    expect(p.waits()).toEqual([]);
    await p.advance(600_000);
    expect(p.asked).toHaveLength(2);
    expect(p.location.reloads).toBe(0);
    expect(p.history.replaced).toEqual([]);
  });

  it('an answer it does not know says the page\'s first line, and nothing is put in twice', async () => {
    const p = standIn({ live: '/app/live/buyers?since=1.0123456789abcdef', templates: ['list'], answers: [
      () => Promise.resolve(said({ news: true, what: 'x"]<b>' })),
    ] });
    p.run();
    await p.advance(20_000);
    expect(p.region!.children.map((c) => c.attrs['said'])).toEqual(['list']);
  });

  it('asks nothing while the tab is hidden, and asks at once when it is shown again', async () => {
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0' });
    p.run();
    p.doc.visibilityState = 'hidden';
    p.doc.fire('visibilitychange');
    expect(p.waits()).toEqual([]);
    await p.advance(600_000);
    expect(p.asked).toEqual([]);
    p.doc.visibilityState = 'visible';
    p.doc.fire('visibilitychange');
    await p.advance(0);
    expect(p.asked).toHaveLength(1);
    expect(p.waits()).toEqual([20_000]);
  });

  it('a timer that falls due while the tab is hidden asks nothing, and nothing is lost when it is shown', async () => {
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0' });
    p.run();
    p.doc.visibilityState = 'hidden';            // hidden without the event: the timer finds it so
    await p.advance(20_000);
    expect(p.asked).toEqual([]);
    p.doc.visibilityState = 'visible';
    p.doc.fire('visibilitychange');
    await p.advance(0);
    expect(p.asked).toHaveLength(1);
  });

  it('a page brought back from the browser\'s cache asks at once', async () => {
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0' });
    p.run();
    p.win.fire('pageshow', { persisted: true });
    await p.advance(0);
    expect(p.asked).toHaveLength(1);
  });

  it('when asking fails it waits longer each time, up to five minutes, and an answer brings it back to twenty seconds', async () => {
    const offline = () => Promise.reject(new Error('offline'));
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0', answers: [
      offline, () => Promise.resolve(said({}, 502)), offline, offline, offline, offline,
    ] });
    p.run();
    const gaps: number[] = [];
    await p.advance(20_000);
    for (let i = 0; i < 6; i++) { gaps.push(p.waits()[0]!); await p.advance(p.waits()[0]!); }
    expect(gaps).toEqual([40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
    expect(p.asked).toHaveLength(7);
    expect(p.waits()).toEqual([20_000]);         // the seventh was answered
  });

  it('stops for good — no loop — when signed out, refused, or the page is gone', async () => {
    for (const [answer, why] of [
      [said({ news: false }, 401), 'signed out'],
      [said({ news: false }, 403), 'refused'],
      [said({ news: false }, 404), 'gone'],
      [said({ news: false }, 400), 'a mark nobody drew'],
      [said(undefined, 0, 'opaqueredirect'), 'sent to sign in'],
    ] as const) {
      const p = standIn({ live: '/app/live/today?since=0.0.0.0.0', answers: [() => Promise.resolve(answer)] });
      p.run();
      await p.advance(20_000);
      expect(p.waits(), why).toEqual([]);
      p.doc.fire('visibilitychange');            // even coming back to the tab
      await p.advance(3_600_000);
      expect(p.asked, why).toHaveLength(1);
      expect(p.region!.children, why).toEqual([]);
    }
  });

  it('an answer that never comes is let go after fifteen seconds, and asking goes on', async () => {
    const hangs = (init: Record<string, unknown>) => new Promise((_resolve, reject) => {
      (init['signal'] as AbortSignal).addEventListener('abort', () => reject(new Error('let go')));
    });
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0', abortable: true, answers: [hangs] });
    p.run();
    await p.advance(20_000);
    expect(p.asked).toHaveLength(1);
    expect(p.waits()).toEqual([15_000]);        // nothing else is scheduled while it waits
    await p.advance(15_000);
    expect(p.waits()).toEqual([40_000]);        // let go: a failure, so a longer wait
    await p.advance(40_000);
    expect(p.asked).toHaveLength(2);
    expect(p.waits()).toEqual([20_000]);        // answered, and its own let-go was cleared
  });

  it('asking too often, or a slow answer, is a wait — not a stop', async () => {
    const p = standIn({ live: '/app/live/today?since=0.0.0.0.0', answers: [
      () => Promise.resolve(said({}, 429)), () => Promise.resolve(said({}, 408)),
    ] });
    p.run();
    await p.advance(20_000);
    expect(p.waits()).toEqual([40_000]);
    await p.advance(40_000);
    expect(p.waits()).toEqual([80_000]);
  });
});

describe('CC-26 · the door reloads the same address and lands on the newest', () => {
  const shown = async (href: string, answerWhat = 'message') => {
    const p = standIn({ live: '/app/live/conversation/x?since=3.0', href,
      answers: [() => Promise.resolve(said({ news: true, what: answerWhat }))] });
    p.run();
    await p.advance(20_000);
    const door = p.region!.querySelector('a')!;
    return { p, door };
  };

  it('on the same address it reloads, landing on #latest rather than where the page was scrolled', async () => {
    const { p, door } = await shown(`https://nomi.test/app/inbox/${CONV}`);
    const ev = door.fire('click', { button: 0 });
    expect(ev['defaultPrevented']).toBe(true);
    expect(p.history.scrollRestoration).toBe('manual');
    expect(p.history.replaced).toEqual([`https://nomi.test/app/inbox/${CONV}#latest`]);
    expect(p.location.reloads).toBe(1);
    // …and the fresh page lets the browser keep its own scrolling again
    p.win.fire('load');
    expect(p.history.scrollRestoration).toBe('auto');
  });

  it('already at #latest: reloads without touching the address', async () => {
    const { p, door } = await shown(`https://nomi.test/app/inbox/${CONV}#latest`);
    door.fire('click', { button: 0 });
    expect(p.history.replaced).toEqual([]);
    expect(p.location.reloads).toBe(1);
  });

  it('from a window further back it is an ordinary link to the newest — the browser goes there', async () => {
    const { p, door } = await shown(`https://nomi.test/app/inbox/${CONV}?before=1790000000000_${DRAFT}`);
    const ev = door.fire('click', { button: 0 });
    expect(ev['defaultPrevented']).toBe(false);
    expect(p.location.reloads).toBe(0);
  });

  it('a new tab or window is the browser\'s own business', async () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const { p, door } = await shown(`https://nomi.test/app/inbox/${CONV}`);
      const ev = door.fire('click', { button: 0, ...mod });
      expect(ev['defaultPrevented'], JSON.stringify(mod)).toBe(false);
      expect(p.location.reloads).toBe(0);
    }
  });
});

describe('CC-26 · a half-typed reply survives the refresh — the words, and which box', () => {
  const EDIT = { keep: `${CONV}:edit`, text: 'For 500 pcs: $0.92/pc.', action: `https://nomi.test/app/inbox/${CONV}/act` };
  const REPLY = { keep: `${CONV}:reply`, text: '', action: `https://nomi.test/app/inbox/${CONV}/reply` };
  const typeInto = (box: El, words: string) => {
    box.value = words; box.selectionStart = words.length - 3; box.selectionEnd = words.length - 3;
    box.fire('input');
  };

  it('what she typed is back in the same box after the door, with the caret where it was', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ live: '/app/live/conversation/x?since=3.0', boxes: [EDIT], memory,
      answers: [() => Promise.resolve(said({ news: true, what: 'message' }))] });
    first.run();
    const box = first.boxes[0]!;
    first.doc.fire('focusin', { target: box });
    typeInto(box, 'For 500 pcs: $0.90/pc, ships Friday.');
    await first.advance(20_000);
    first.region!.querySelector('a')!.fire('click', { button: 0 });
    expect(first.location.reloads).toBe(1);

    // The page drawn again: the server's box holds the draft, as it did.
    const again = standIn({ live: '/app/live/conversation/x?since=4.0', boxes: [EDIT], memory });
    again.run();
    const back = again.boxes[0]!;
    expect(back.value).toBe('For 500 pcs: $0.90/pc, ships Friday.');
    expect(back.focusedWith).toEqual({ preventScroll: true });
    expect([back.selectionStart, back.selectionEnd]).toEqual([33, 33]);
  });

  it('any reload keeps the words; only the door asks for the caret back', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [REPLY], memory });
    first.run();
    first.doc.fire('focusin', { target: first.boxes[0]! });
    typeInto(first.boxes[0]!, 'Yes — we can ship on Friday.');
    first.win.fire('pagehide');
    const again = standIn({ boxes: [REPLY], memory });
    again.run();
    expect(again.boxes[0]!.value).toBe('Yes — we can ship on Friday.');
    expect(again.boxes[0]!.focusedWith).toBeUndefined();
  });

  it('the words go back into THEIR box: not the other box, not another conversation', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [REPLY], memory });
    first.run();
    typeInto(first.boxes[0]!, 'Words for the reply box.');
    // after the refresh she no longer holds it: the draft card is back, with its edit box
    const again = standIn({ boxes: [EDIT, { keep: `${OTHER}:reply`, text: '', action: `https://nomi.test/app/inbox/${OTHER}/reply` }], memory });
    again.run();
    expect(again.boxes[0]!.value).toBe(EDIT.text);
    expect(again.boxes[1]!.value).toBe('');
    // and when the reply box is back, so are the words
    const third = standIn({ boxes: [REPLY], memory });
    third.run();
    expect(third.boxes[0]!.value).toBe('Words for the reply box.');
  });

  it('a new reply replaced the draft: her words are still hers, in the edit box', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [EDIT], memory });
    first.run();
    typeInto(first.boxes[0]!, 'My own answer, not the draft.');
    const again = standIn({ boxes: [{ ...EDIT, text: 'A newer draft for the newer question.' }], memory });
    again.run();
    expect(again.boxes[0]!.value).toBe('My own answer, not the draft.');
    expect(again.boxes[0]!.defaultValue).toBe('A newer draft for the newer question.');
  });

  it('forgotten once sent — by its own form, or by approving or skipping the draft (the same address)', async () => {
    for (const box of [EDIT, REPLY]) {
      const memory = new Map<string, string>();
      const first = standIn({ boxes: [box], memory });
      first.run();
      typeInto(first.boxes[0]!, 'Sending these words.');
      expect([...memory.keys()].some((k) => k.startsWith('nomi.words.'))).toBe(true);
      first.doc.fire('submit', { target: first.forms[0]! });
      expect([...memory.keys()].filter((k) => k.startsWith('nomi.words.'))).toEqual([]);
      const again = standIn({ boxes: [box], memory });
      again.run();
      expect(again.boxes[0]!.value).toBe(box.text);
    }
  });

  it('sent means sent: leaving the page on the way to the server does not write them back — typing again does', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [REPLY], memory });
    first.run();
    const box = first.boxes[0]!;
    typeInto(box, 'Sending these words.');
    box.fire('blur');                            // the send button takes the focus first
    first.doc.fire('submit', { target: first.forms[0]! });
    box.fire('blur');
    first.win.fire('pagehide');                  // …and the page is left for the server's answer
    expect([...memory.keys()]).toEqual([]);
    typeInto(box, 'Sending these words, and more.');   // back on the same page, still typing
    expect(memory.get(`nomi.words.${CONV}:reply`)).toBe('=Sending these words, and more.');
  });

  it('another form on the page leaves her words alone; signing out forgets every one', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [REPLY], memory });
    first.run();
    typeInto(first.boxes[0]!, 'Still mine.');
    const handTo = new El('FORM'); handTo.action = `https://nomi.test/app/inbox/${CONV}/handto`;
    first.doc.fire('submit', { target: handTo });
    expect(memory.get(`nomi.words.${CONV}:reply`)).toBe('=Still mine.');
    memory.set('someone.else', 'kept');
    const out = new El('FORM'); out.action = 'https://nomi.test/logout';
    first.doc.fire('submit', { target: out });
    expect([...memory.keys()]).toEqual(['someone.else']);
  });

  it('back to exactly what the page gave is nothing to keep — and an emptied box is kept as empty', async () => {
    const memory = new Map<string, string>();
    const first = standIn({ boxes: [EDIT], memory });
    first.run();
    typeInto(first.boxes[0]!, 'changed');
    typeInto(first.boxes[0]!, EDIT.text);
    expect([...memory.keys()]).toEqual([]);
    typeInto(first.boxes[0]!, '');
    const again = standIn({ boxes: [EDIT], memory });
    again.run();
    expect(again.boxes[0]!.value).toBe('');
  });

  it('a browser that refuses the tab\'s memory still shows the line, and the page still works', async () => {
    const p = standIn({ live: '/app/live/conversation/x?since=3.0', boxes: [EDIT], memory: 'refusing',
      answers: [() => Promise.resolve(said({ news: true, what: 'message' }))] });
    expect(() => p.run()).not.toThrow();
    typeInto(p.boxes[0]!, 'typed');
    await p.advance(20_000);
    expect(p.region!.children).toHaveLength(1);
    expect(() => p.region!.querySelector('a')!.fire('click', { button: 0 })).not.toThrow();
    expect(p.location.reloads).toBe(1);
  });
});
