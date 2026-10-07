import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import Fastify from 'fastify';
import { usd } from '../../src/core/types/money.js';
import { renderProductDetail, type ProductDetail } from '../../src/api/web/products.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { registerWebApp, PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { shell, loginPage, signupPage, assetAt, ORB_JS } from '../../src/api/web/layout.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { SERVICE_WORKER, appManifest } from '../../src/api/web/phone.js';
import { TYPE_CSS, TYPE_ZH_CSS } from '../../src/api/web/type.js';
import { BOT_CHECK_WIDGET, BOT_CHECK_PROVIDERS, type BotCheck, type BotCheckProvider } from '../../src/api/web/botCheck.js';
import { THIRD_PARTY_HOSTS, COOKIES, mayLoad } from '../../src/api/web/thirdParty.js';
import { SESSION_TTL_MS } from '../../src/api/web/session.js';
import { FLASH_TTL_MS } from '../../src/api/web/flash.js';
import { ISSUED_TTL_MS } from '../../src/api/web/people.js';
import { PENDING_TTL_MS, DEVICE_TTL_MS } from '../../src/security/otp.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { pageRequests, cssRequests, scriptRequests, offList, thirdPartyIn } from './third-party.js';

/**
 * D7 (the owner's decision, 2026-10-07) — "NO banner while every cookie is
 * strictly necessary. WIDEN THE GATE to every THIRD-PARTY REQUEST the browser
 * makes. Keep one allow-list with a reason for each entry; a test fails on
 * anything off the list."
 *
 * This is that test. It holds three things:
 *   1. THE READER (./third-party.ts) sees every way a page, a stylesheet or a
 *      script makes the browser fetch something by itself — each one proved
 *      here on a page built to break the rule — and lets through what is not
 *      a request (a link, a form, a canonical, a data: address).
 *   2. NO PAGE OR SERVED FILE ASKS A HOST OFF THE LIST: every public page the
 *      app answers, drawn by the app itself, with and without each bot check;
 *      the pages the owner uses most; every stylesheet and script those pages
 *      link, the orb, the phone's worker and its manifest; and, as a backstop,
 *      the source of every module for a resource written with another host in
 *      it. Every owner page there is, on real rows, goes through the same
 *      reader in tests/integration/surface-walk.test.ts.
 *   3. EVERY COOKIE THE CODE SETS IS IN THE REGISTRY, strictly necessary, with
 *      the lifetime the code gives it — read from the code, not from a copy.
 * Links (`<a href>`) and form actions are navigations the person chooses, not
 * requests the page makes: they are left out on purpose (third-party.ts says
 * which tags count).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});
const SOURCES = walk(join(ROOT, 'src')).map((p) => ({ file: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

/* ── 1 · the reader ─────────────────────────────────────────────────────── */

describe('D7 · the reader sees every request a page makes, and only those', () => {
  const OFF = 'https://elsewhere.example/x';
  it('catches each way a page asks another host (a control for every kind)', () => {
    const cases: readonly [string, string][] = [
      ['<script src>', `<script src="${OFF}.js"></script>`],
      ['<link rel="stylesheet">', `<link rel="stylesheet" href="${OFF}.css">`],
      ['<link rel="preload">', `<link rel="preload" href="${OFF}.woff2" as="font">`],
      ['<link rel="icon">', `<link rel="icon" href="//elsewhere.example/i.png">`],
      ['<link rel="manifest">', `<link rel="manifest" href="${OFF}.json">`],
      ['<link rel="preconnect">', '<link rel="preconnect" href="https://fonts.example">'],
      ['<img src>', `<img src="${OFF}.png" alt="">`],
      ['<img srcset>', `<img src="/a.png" srcset="/a.png 1x, ${OFF}@2x.png 2x" alt="">`],
      ['<source srcset>', `<picture><source srcset="${OFF}.webp"></picture>`],
      ['<video poster>', `<video poster="${OFF}.jpg"></video>`],
      ['<audio src>', `<audio src="${OFF}.mp3"></audio>`],
      ['<track src>', `<video><track src="${OFF}.vtt"></video>`],
      ['<iframe src>', `<iframe src="${OFF}"></iframe>`],
      ['<embed src>', `<embed src="${OFF}.swf">`],
      ['<object data>', `<object data="${OFF}.pdf"></object>`],
      ['<input type=image src>', `<form><input type="image" src="${OFF}.png"></form>`],
      ['<image href>', `<svg><image href="${OFF}.png"/></svg>`],
      ['<use href>', `<svg><use xlink:href="${OFF}.svg#i"/></svg>`],
      ['<base href>', `<base href="${OFF}/">`],
      ['<a ping>', `<a href="/x" ping="${OFF}/beacon">x</a>`],
      ['<a data-card href>', `<a data-card href="${OFF}/card">x</a>`],
      ['[data-live]', `<div data-live="${OFF}/live"></div>`],
      ['[data-orb]', `<form data-orb="${OFF}/orb.js"></form>`],
      ['style attribute url()', `<div style="background:url('${OFF}.png')"></div>`],
      ['<style> url()', `<style>.a { background:url(${OFF}.png) }</style>`],
      ['<style> @import', `<style>@import "${OFF}.css";</style>`],
      ['<style> image-set()', `<style>.a { background-image:image-set("${OFF}.png" 1x) }</style>`],
      ['inline script fetch', `<script>fetch('${OFF}/beacon')</script>`],
      ['inline script WebSocket', '<script>new WebSocket("wss://elsewhere.example/s")</script>'],
      ['inline script //host', '<script>navigator.sendBeacon("//elsewhere.example/b")</script>'],
    ];
    for (const [kind, html] of cases) {
      expect(thirdPartyIn(`<!doctype html><html><body>${html}</body></html>`, '/x'), kind).toHaveLength(1);
    }
  });

  it('lets through what is not a request: a link, a form, a description, a name, a data: address, the page\'s own paths', () => {
    const html = `<!doctype html><html><head><link rel="canonical" href="${OFF}"><link rel="alternate" hreflang="zh" href="${OFF}/zh">
      <meta property="og:image" content="${OFF}.png"><link rel="stylesheet" href="/assets/app.0123456789abcdef.css">
      <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></head><body>
      <a href="${OFF}">a link the person chooses</a><a href="mailto:a@b.test">mail</a>
      <form method="post" action="${OFF}/form"><button>Send</button></form>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0"/></svg>
      <img src="/app/faces/1?v=2" alt=""><img src="data:image/png;base64,AAAA" alt=""><audio src="/app/inbox/c/voice/m"></audio>
      <div data-live="/app/live/today?since=1"></div><a data-card href="/app/customers/1/card">card</a>
      <div style="background:url(/assets/x.png)"></div><a href="#main">skip</a></body></html>`;
    expect(thirdPartyIn(html, '/x')).toEqual([]);
  });

  it('the allow-list: the bot check on the sign-up page only, over https, its own hosts only', () => {
    const turnstile = `<script src="${BOT_CHECK_WIDGET.turnstile.script}" async defer></script>`;
    expect(thirdPartyIn(turnstile, '/signup')).toEqual([]);
    expect(thirdPartyIn(turnstile, '/login'), 'the same script on another page').toHaveLength(1);
    expect(thirdPartyIn(turnstile.replace('https:', 'http:'), '/signup'), 'not over https').toHaveLength(1);
    expect(mayLoad('https://newassets.hcaptcha.com/c/frame', '/signup')).toBe(true);
    expect(mayLoad('https://evilhcaptcha.com/x', '/signup')).toBe(false);
    expect(mayLoad('https://challenges.cloudflare.com.elsewhere.example/x', '/signup')).toBe(false);
    expect(mayLoad('//challenges.cloudflare.com/x', '/signup'), 'a protocol-relative address is not a path').toBe(false);
    expect(mayLoad('/\\elsewhere.example/x', '/x'), 'nor is /\\host, which a browser reads as //host').toBe(false);
    expect(mayLoad('/assets/app.css', '/x')).toBe(true);
  });
});

/* ── 2 · the allow-list, and every page and file against it ─────────────── */

describe('D7 · the allow-list: one entry per host, each with what, where and why', () => {
  it('every entry names what it loads, the pages it may load on, and a reason', () => {
    expect(THIRD_PARTY_HOSTS.length).toBeGreaterThan(0);
    for (const e of THIRD_PARTY_HOSTS) {
      expect(e.host, JSON.stringify(e)).toMatch(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(e.loads.length, e.host).toBeGreaterThan(10);
      expect(e.reason.length, e.host).toBeGreaterThan(30);
      expect(e.where.length, e.host).toBeGreaterThan(0);
      // Today only the sign-up page loads anything from another host.
      expect(e.where, e.host).toEqual(['/signup']);
    }
    expect(new Set(THIRD_PARTY_HOSTS.map((e) => e.host)).size, 'a host listed twice').toBe(THIRD_PARTY_HOSTS.length);
  });

  it('each bot check\'s script is on it for the sign-up page, and for no other page', () => {
    for (const p of BOT_CHECK_PROVIDERS) {
      expect(mayLoad(BOT_CHECK_WIDGET[p].script, '/signup'), p).toBe(true);
      for (const other of ['/login', '/privacy', '/site', '/app']) expect(mayLoad(BOT_CHECK_WIDGET[p].script, other), `${p} on ${other}`).toBe(false);
    }
  });
});

const fakeBotCheck = (provider: BotCheckProvider): BotCheck => ({ provider, siteKey: 'site-key-for-tests', verify: async () => false });

async function publicApp(botCheck: BotCheck | null) {
  const app = Fastify({ logger: false });
  registerWebApp(app, {
    db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
    businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
    secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    // Open sign-up, as an installation with a bot check runs it: open needs a sender for its codes
    // (never called by a GET) and a bot check, else it reads as invite (signupModeInForce).
    signupMode: 'open', codeMail: { from: 'nomi@example.test', send: async () => ({ ok: true as const }) },
    legalContact: 'privacy@example.test', ...(botCheck ? { botCheck } : {}),
  } as Parameters<typeof registerWebApp>[1]);
  await app.ready();
  return app;
}

/** What a served file asks of other hosts, read as the browser reads its type. */
const fileProblems = (where: string, type: string, body: string): string[] => {
  const found = /css/.test(type) ? cssRequests(body) : /javascript/.test(type) ? scriptRequests(body) : /json/.test(type) ? scriptRequests(body) : [];
  return offList(found, where).map((r) => `${where}: ${r.kind} ${r.url}`);
};

/** The addresses under Nomi's own /assets/ a page links (stylesheets, the script, the type). */
const linkedAssets = (html: string): string[] =>
  [...new Set(pageRequests(html).map((r) => r.url).filter((u) => /^\/assets\/[a-z]+\.[0-9a-f]{16}\.(css|js)$/.test(u)))];

describe('D7 · every public page the app answers asks no host off the list', () => {
  const variants: readonly (BotCheckProvider | null)[] = [null, ...BOT_CHECK_PROVIDERS];
  for (const variant of variants) {
    it(`with ${variant ? `the ${variant} bot check` : 'no bot check'}: every page, and every stylesheet and script it links`, async () => {
      const app = await publicApp(variant ? fakeBotCheck(variant) : null);
      const problems: string[] = [];
      const drawn: string[] = [];
      const assets = new Set<string>();
      for (const r of PUBLIC_ROUTES) {
        if (r.method !== 'GET' || r.url.includes(':')) continue;
        for (const locale of ['en', 'ar'] as const) {
          const res = await app.inject({ method: 'GET', url: r.url, headers: { cookie: `yf_locale=${locale}` } });
          const type = String(res.headers['content-type'] ?? '');
          if (res.statusCode !== 200) continue;
          if (/text\/html/.test(type)) {
            drawn.push(r.url);
            for (const p of thirdPartyIn(res.body, r.url)) problems.push(`${locale} ${r.url}: ${p}`);
            for (const a of linkedAssets(res.body)) assets.add(a);
          } else {
            problems.push(...fileProblems(r.url, type, res.body));
          }
        }
      }
      for (const a of assets) {
        const res = await app.inject({ method: 'GET', url: a });
        expect(res.statusCode, a).toBe(200);
        problems.push(...fileProblems(a, String(res.headers['content-type'] ?? ''), res.body));
      }
      expect(problems).toEqual([]);
      // The walk is worth something only if it drew the pages a stranger reads.
      for (const must of ['/privacy', '/terms', '/data-deletion', '/site', '/login', '/closed', '/signup']) expect(drawn, must).toContain(must);
      const signup = (await app.inject({ method: 'GET', url: '/signup' })).body;
      if (variant) expect(signup, 'the walk drew the sign-up page with its bot check').toContain(BOT_CHECK_WIDGET[variant].script);
      else expect(signup).not.toContain('<script');
      expect([...assets].some((a) => a.endsWith('.css')), 'no stylesheet was followed').toBe(true);
      await app.close();
    });
  }

  it('the sign-up page draws the bot check\'s script when one is configured — the allow-list lets it — and no other page does', () => {
    for (const p of BOT_CHECK_PROVIDERS) {
      const botCheck = { ...BOT_CHECK_WIDGET[p], siteKey: 'site-key-for-tests' };
      const signup = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: 10, botCheck });
      expect(signup, p).toContain(`<script src="${BOT_CHECK_WIDGET[p].script}" async defer></script>`);
      expect(thirdPartyIn(signup, '/signup'), p).toEqual([]);
      // …and the gate is real: the same page judged as any other page is off the list.
      expect(thirdPartyIn(signup, '/login'), p).toHaveLength(1);
    }
    // A script the list does not name is not drawn at all (layout.ts asks `mayLoad`).
    const offList = { ...BOT_CHECK_WIDGET.turnstile, script: 'https://elsewhere.example/api.js', siteKey: 'site-key-for-tests' };
    expect(signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: 10, botCheck: offList })).not.toContain('elsewhere.example');
    expect(thirdPartyIn(loginPage({ locale: 'en', path: '/login' }), '/login')).toEqual([]);
  });
});

describe('D7 · the owner\'s pages and every file Nomi serves ask no host off the list', () => {
  const product: ProductDetail = {
    currency: 'USD',
    id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', category: 'bags',
    unit: 'pcs', moq: 1000, leadTimeDays: 15, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: true,
    tiers: [{ minQty: 500, maxQty: null, unitPrice: usd(1.05) }],
    aliases: ['canvas bag'],
    images: ['https://elsewhere.example/x.jpg', '//elsewhere.example/y.jpg', '/\\elsewhere.example/z.jpg', '/app/products/p1/photo/1'],
    recentQuotes: [],
  };

  /**
   * THE HOLE THIS GATE FOUND (written first, seen red: `[ "<img src> https://elsewhere.example/x.jpg" ]`).
   * The product page drew `product_images.url` exactly as stored, so an address on another
   * host made the owner's browser fetch from that host. Only a photo Nomi serves is drawn now.
   */
  it('the product page draws only the photos Nomi serves: one on another host is not drawn', () => {
    for (const l of LOCALES) {
      const html = renderProductDetail(product, l);
      expect(thirdPartyIn(html, '/app/products/:id'), l).toEqual([]);
      expect(html, l).toContain('<img src="/app/products/p1/photo/1"');
      expect(html, l).not.toContain('elsewhere.example');
    }
    // With nothing Nomi serves, the block goes, rather than a heading over nothing.
    const none = renderProductDetail({ ...product, images: ['https://elsewhere.example/x.jpg'] }, 'en');
    expect(none).not.toContain('class="imgs"');
  });

  it('the pages the owner uses most, in the shell, and every stylesheet and script the shell links', () => {
    const conv: ConversationDetail = {
      conversationId: 'conv-1', buyer: 'Maya', country: 'GB', status: 'awaiting',
      product: { name: 'Gift box', nameZh: null }, quantity: 40, quote: null, order: null,
      messages: [{ direction: 'inbound', text: 'See https://elsewhere.example/pic.jpg', at: new Date('2026-09-29T09:00:00Z') }],
      pendingDraft: { draftId: 'd1', draftText: 'Anything else I can help with?', capability: 'qualify', heldBecause: null },
      ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [],
      unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
      rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    };
    const problems: string[] = [];
    const assets = new Set<string>();
    for (const l of ['en', 'zh', 'ar'] as const) {
      for (const [path, body] of [
        ['/app/products/:id', renderProductDetail(product, l)],
        ['/app/conversations/:id', renderConversationDetail(conv, l, new Date('2026-09-29T10:00:00Z'), null, OWNER_VIEW)],
      ] as const) {
        const page = shell({ title: 'T', active: 'products', locale: l, path, bodyHtml: body });
        for (const p of thirdPartyIn(page, path)) problems.push(`${l} ${path}: ${p}`);
        for (const a of linkedAssets(page)) assets.add(a);
      }
    }
    expect([...assets].some((a) => /\/assets\/live\.[0-9a-f]{16}\.js$/.test(a)), 'the shell links its script').toBe(true);
    expect([...assets].some((a) => /\/assets\/app\.[0-9a-f]{16}\.css$/.test(a)), 'the shell links its sheet').toBe(true);
    for (const a of assets) {
      const served = assetAt(a.slice('/assets/'.length));
      expect(served, a).not.toBeNull();
      problems.push(...fileProblems(a, served!.type, String(served!.body)));
    }
    expect(problems).toEqual([]);
  });

  it('the files no page links directly: the orb, the phone\'s worker and manifest, both type sheets, the script itself', () => {
    const orb = assetAt(ORB_JS.slice('/assets/'.length));
    expect(orb).not.toBeNull();
    const files: readonly [string, string, string][] = [
      [ORB_JS, 'text/javascript', String(orb!.body)],
      ['/sw.js', 'text/javascript', SERVICE_WORKER],
      ['/manifest.webmanifest', 'application/json', appManifest()],
      ['type.css', 'text/css', TYPE_CSS],
      ['typezh.css', 'text/css', TYPE_ZH_CSS],
      ['live.js', 'text/javascript', LIVE_SCRIPT],
    ];
    const problems = files.flatMap(([where, type, body]) => fileProblems(where, type, body));
    expect(problems).toEqual([]);
    // The faces are Nomi's own files (assets/fonts, type.ts): every url() in the type sheets is a path.
    expect(cssRequests(TYPE_CSS).length).toBeGreaterThan(0);
    for (const r of [...cssRequests(TYPE_CSS), ...cssRequests(TYPE_ZH_CSS)]) expect(r.url, r.url).toMatch(/^\/assets\/[a-z0-9.-]+\.woff2$/);
  });

  /**
   * The page's own script fetches only addresses the page gives it (the attributes the reader
   * checks) or its own: a new kind of fetch in it must be taught to the reader before it ships.
   */
  it('the script fetches only what the reader knows it fetches', () => {
    const KNOWN = new Set([
      'on.getAttribute(\'data-push-save\')',   // [data-push-save]
      'location.pathname + location.search',   // this page again
      'address()',                              // [data-live] / [data-rail] (the asker's address)
      'a.href',                                 // <a data-card>
      'src',                                    // form[data-orb]
      '\'/sw.js\'',                             // the phone's worker, Nomi's own
    ]);
    const sinks = /\b(fetch|import|register|sendBeacon|importScripts|WebSocket|EventSource|Worker|SharedWorker|XMLHttpRequest)\s*\(/g;
    const args: string[] = [];
    for (const js of [LIVE_SCRIPT, SERVICE_WORKER]) {
      for (const m of js.matchAll(sinks)) {
        let depth = 0; let i = m.index! + m[0].length; const start = i;
        for (; i < js.length; i++) {
          const c = js[i]!;
          if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) { if (depth === 0) break; depth--; } else if (c === ',' && depth === 0) break;
        }
        args.push(js.slice(start, i).trim());
      }
    }
    expect(args.length).toBeGreaterThan(4);
    expect(args.filter((a) => !KNOWN.has(a))).toEqual([]);
  });

  /**
   * The backstop: a resource written into a template with another host in it, anywhere in the
   * source — a tag that loads, a CSS url() or @import. Rendering cannot reach every branch;
   * this reads every line.
   */
  it('no module writes a resource from another host into a template', () => {
    const TAG = /<(script|link|img|iframe|frame|video|audio|source|track|embed|object|image|use|feImage|input|base)\b[^>]*?\s(src|href|srcset|data|poster|xlink:href|imagesrcset)\s*=\s*\\?["']?\s*(?:https?:|wss?:)?\/\//gi;
    const CSS_URL = /url\(\s*\\?["']?\s*(?:https?:|wss?:)?\/\//gi;
    const IMPORT = /@import\b/g;
    const hits: string[] = [];
    for (const { file, text } of SOURCES) {
      for (const re of [TAG, CSS_URL, IMPORT]) {
        for (const m of text.matchAll(re)) hits.push(`${file}: ${text.slice(m.index!, m.index! + 90).replace(/\s+/g, ' ')}`);
      }
    }
    expect(hits).toEqual([]);
    // …and the backstop fires on what it exists for.
    expect('<img src="https://elsewhere.example/x.png">'.match(TAG)).not.toBeNull();
    expect('<link rel="stylesheet" href="//elsewhere.example/a.css">'.match(TAG)).not.toBeNull();
    expect('background:url(\'https://elsewhere.example/a.png\')'.match(CSS_URL)).not.toBeNull();
  });
});

/* ── 3 · the cookies ────────────────────────────────────────────────────── */

type Source = { readonly file: string; readonly text: string };

/** A call's arguments, split at its own top-level commas (strings, brackets and templates respected). */
function argsAt(text: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0; let quote: string | null = null; let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) { out.push(text.slice(start, i).trim()); return out; }
      depth--;
    } else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return out;
}

/** The lifetimes the code may write, by the constants it writes them with. */
const TTL: Readonly<Record<string, number>> = { SESSION_TTL_MS, FLASH_TTL_MS, PENDING_TTL_MS, DEVICE_TTL_MS, ISSUED_TTL_MS };

/** A Max-Age expression as written, in seconds; 0 clears; null when this reader cannot tell. */
function secondsOf(expr: string): number | null {
  const e = expr.trim();
  if (/^\d+$/.test(e)) return Number(e);
  const tern = /^[\w.]+\s*\?\s*(\d+)\s*:\s*0$/.exec(e);
  if (tern) return Number(tern[1]);
  const ttl = /^Math\.(floor|ceil)\(\s*([A-Z_]+)\s*\/\s*1000\s*\)$/.exec(e);
  if (ttl && TTL[ttl[2]!] !== undefined) return Math[ttl[1] as 'floor' | 'ceil'](TTL[ttl[2]!]! / 1000);
  return null;
}

/**
 * Every cookie the code sets, read from the code: the one header writer
 * (`reply.header('set-cookie', …)`), the generic writer by name (`writeCookie`),
 * and the session's wrapper around it (`setCookie`). Anything else that could set
 * a cookie — a second header, a cookie plugin, `document.cookie` — is reported as
 * unreadable, so a new way in fails here until this reader is taught it.
 */
function cookieProblems(sources: readonly Source[], whole = true): string[] {
  const problems: string[] = [];
  // A name written as a constant: the file's own first, then one exported from elsewhere.
  const CONST = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*'([^'\n]*)'/g;
  const exported = new Map<string, string>();
  for (const { text } of sources) for (const m of text.matchAll(CONST)) if (/export\s+$/.test(text.slice(Math.max(0, m.index! - 7), m.index!))) exported.set(m[1]!, m[2]!);
  let consts = new Map<string, string>();
  const nameOf = (raw: string): string | null => {
    const lit = /^'([^']*)'$/.exec(raw);
    return lit ? lit[1]! : consts.get(raw) ?? exported.get(raw) ?? null;
  };
  const lifetimes = new Map<string, Set<number>>();
  const saw = (name: string, seconds: number | null, at: string) => {
    if (seconds === null) { problems.push(`${at}: a lifetime this reader cannot read`); return; }
    if (!lifetimes.has(name)) lifetimes.set(name, new Set());
    if (seconds > 0) lifetimes.get(name)!.add(seconds);
  };

  for (const { file, text } of sources) {
    consts = new Map([...text.matchAll(CONST)].map((m) => [m[1]!, m[2]!]));
    // Ways in this reader does not read: each is a failure until it is taught.
    for (const m of text.matchAll(/document\.cookie|cookieStore\.|\.(?:setCookie|clearCookie|cookie)\(/g)) {
      problems.push(`${file}: "${m[0]}" sets a cookie this reader cannot read`);
    }
    // The header itself: every mention of it is one of the writers below.
    const headers = [...text.matchAll(/set-cookie/gi)];
    const written = [...text.matchAll(/\.header\(\s*'set-cookie'\s*,\s*`\$\{([A-Za-z_$][\w$]*)\}=/g)];
    if (headers.length !== written.length) problems.push(`${file}: ${headers.length - written.length} Set-Cookie header(s) written another way`);
    for (const m of written) {
      const ident = m[1]!;
      const name = consts.get(ident) ?? exported.get(ident);
      if (name) {
        // A header written whole: its lifetime is in the flags beside it.
        const flags = /Max-Age=(\d+)/.exec(text.slice(Math.max(0, m.index! - 300), m.index!));
        saw(name, flags ? Number(flags[1]) : null, `${file}: ${ident}`);
        continue;
      }
      // Otherwise it must be the generic writer's own body, writing the name it was given.
      const before = text.slice(0, m.index!);
      const decl = [...before.matchAll(/const\s+(\w+)\s*=\s*\(\s*\w+\s*:\s*\w+\s*,\s*(\w+)\s*:/g)].at(-1);
      if (!(decl && decl[1] === 'writeCookie' && decl[2] === ident)) problems.push(`${file}: a Set-Cookie header named by "${ident}", which this reader cannot resolve`);
    }
    // The generic writer, called by name.
    for (const m of text.matchAll(/\bwriteCookie\(/g)) {
      const args = argsAt(text, m.index! + m[0].length - 1);
      const name = nameOf(args[1] ?? '');
      if (!name) { problems.push(`${file}: writeCookie(${args[1]}) — a name this reader cannot resolve`); continue; }
      const age = /maxAgeSec\s*:\s*([^}]+?)\s*\}$/.exec(args[3] ?? '');
      if (age) saw(name, secondsOf(age[1]!), `${file}: writeCookie(${args[1]})`);
      else if (!/\bmaxAgeSec\s*\}$/.test(args[3] ?? '')) problems.push(`${file}: writeCookie(${args[1]}) with no lifetime this reader can find`);
    }
    // The session's wrapper: `setCookie(reply, value, maxAgeSec)` writes the session cookie.
    const wrapper = /const setCookie = \(reply: FastifyReply, token: string, maxAgeSec: number\) =>\s*writeCookie\(reply, (\w+), token, \{ path: '\/', maxAgeSec \}\);/.exec(text);
    const calls = [...text.matchAll(/(?<![.\w])setCookie\(/g)];
    if (calls.length > 0 && !wrapper) problems.push(`${file}: setCookie(…) is not the session's wrapper this reader knows`);
    if (wrapper) {
      const name = nameOf(wrapper[1]!);
      if (!name) problems.push(`${file}: the session wrapper writes "${wrapper[1]}", which this reader cannot resolve`);
      for (const c of calls) {
        const args = argsAt(text, c.index! + c[0].length - 1);
        if (name) saw(name, secondsOf(args[2] ?? ''), `${file}: setCookie(…, ${args[2]})`);
      }
    }
  }

  const listed = new Map(COOKIES.map((c) => [c.name, c]));
  for (const [name, set] of lifetimes) {
    const entry = listed.get(name);
    if (!entry) { problems.push(`${name} is set but not in the cookie registry (thirdParty.ts COOKIES)`); continue; }
    for (const s of set) if (s !== entry.lifetimeSec) problems.push(`${name} is set for ${s} s; the registry (and the privacy page) say ${entry.lifetimeSec} s`);
    if (set.size === 0) problems.push(`${name} is only ever cleared, never set`);
  }
  // Read over the whole source, every listed cookie must have been found being set: a registry
  // entry the reader cannot find is either stale or set a way the reader does not know.
  if (whole) for (const c of COOKIES) if (!lifetimes.has(c.name)) problems.push(`${c.name} is in the registry, but this reader found nothing that sets it`);
  return problems;
}

describe('D7 · every cookie the code sets is in the registry, strictly necessary, for as long as the code keeps it', () => {
  it('the code: every name it sets is listed, with the lifetime it is set for; nothing is set another way', () => {
    expect(cookieProblems(SOURCES)).toEqual([]);
  });

  it('the registry: every entry is set by the code, strictly necessary, with a reason and a purpose said in every language', () => {
    const named = new Set<string>();
    for (const { text } of SOURCES) for (const m of text.matchAll(/'(yf_[a-z_]+)'/g)) named.add(m[1]!);
    // Every cookie-shaped name in the source is a listed cookie (a name set some way the reader missed is still caught)…
    const listed = new Set(COOKIES.map((c) => c.name));
    expect([...named].filter((n) => !listed.has(n))).toEqual([]);
    // …and every listed cookie is one the code names: no stale entry on the page.
    expect(COOKIES.map((c) => c.name).filter((n) => !named.has(n))).toEqual([]);
    expect(new Set(COOKIES.map((c) => c.name)).size).toBe(COOKIES.length);
    for (const c of COOKIES) {
      expect(c.class, c.name).toBe('necessary');
      expect(c.reason.length, c.name).toBeGreaterThan(30);
      expect(c.lifetimeSec, c.name).toBeGreaterThan(0);
      for (const l of LOCALES) expect(messages[l][c.purpose], `${l} ${c.purpose}`).toBeTruthy();
    }
  });

  it('…and the reader fails on what it exists for (controls)', () => {
    const writer = 'const writeCookie = (\n    reply: FastifyReply, name: string, value: string, o: { readonly path: string; readonly maxAgeSec: number },\n  ) => {\n    reply.header(\'set-cookie\', `${name}=${value}; x`);\n  };\n';
    // An unlisted cookie.
    expect(cookieProblems([{ file: 'x.ts', text: `${writer}writeCookie(reply, 'yf_track', id, { path: '/', maxAgeSec: 31536000 });` }], false))
      .toEqual(['yf_track is set but not in the cookie registry (thirdParty.ts COOKIES)']);
    // A listed cookie set for longer than the page says.
    expect(cookieProblems([{ file: 'x.ts', text: `${writer}writeCookie(reply, 'yf_flash', v, { path: '/', maxAgeSec: 999 });` }], false))
      .toEqual(['yf_flash is set for 999 s; the registry (and the privacy page) say 60 s']);
    // A cookie set from the page's script, by a plugin, or by a header the reader cannot resolve.
    expect(cookieProblems([{ file: 'x.ts', text: 'document.cookie = "a=b";' }], false)).toHaveLength(1);
    expect(cookieProblems([{ file: 'x.ts', text: 'reply.setCookie("yf_x", "1");' }], false)).toHaveLength(1);
    expect(cookieProblems([{ file: 'x.ts', text: 'reply.header(\'set-cookie\', `${mystery}=1`);' }], false)).toHaveLength(1);
    expect(cookieProblems([{ file: 'x.ts', text: 'reply.header("Set-Cookie", "a=b");' }], false)).toHaveLength(1);
    // A registry entry nothing sets (here: the whole registry, read against one file that sets none).
    expect(cookieProblems([{ file: 'x.ts', text: '' }])).toHaveLength(COOKIES.length);
  });
});
