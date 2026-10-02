#!/usr/bin/env node
/**
 * PHASE 4 OF THE UI REBUILD (2026-10-02) — where colour is, and whether it
 * survives greyscale.
 *
 * For every owner page it reports each piece of text drawn in one of the
 * palette's four signal colours (the assistant's magenta, sent green, waiting
 * amber, failed red), which job that colour is doing, and whether the same
 * thing is said WITHOUT the colour: a shape (✓ ○ ✕ ✦ …) in the text itself,
 * drawn before it by the stylesheet, or standing just before it. It also
 * counts the filled buttons on screen, so a page with two primary actions shows.
 *
 *   node tools/ui-colour.mjs                      every page, English, 1440×900
 *   node tools/ui-colour.mjs --pages today,setup --locale ar
 *   node tools/ui-colour.mjs --json out.json
 *
 * Local instance (bash .claude/skills/run-nomi/smoke.sh, then the usability
 * seed), signed in with the access code (default smoke-code). Read-only: it
 * opens pages and submits nothing.
 */
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = opt('code', 'smoke-code');
const LOCALE = opt('locale', 'en');
const [W, H] = opt('size', '1440x900').split('x').map(Number);

/** A page by its path, or FOUND as the first link of a shape on another page. */
const PAGES = [
  ['today', '/app'], ['inbox', '/app/inbox'], ['inbox-all', '/app/inbox?filter=all'],
  ['conversation', { from: '/app/inbox', href: /^\/app\/inbox\/[0-9a-f-]{36}/ }],
  ['buyer', { from: '@conversation', href: /^\/app\/conversations\/[0-9a-f-]{36}$/ }],
  ['calendar', '/app/calendar'], ['analytics', '/app/analytics'],
  ['business', '/app/business'], ['prices', '/app/business/prices'], ['selling', '/app/settings/business'],
  ['products', '/app/products'], ['product', { from: '/app/products', href: /^\/app\/products\/[0-9a-f-]{36}$/ }],
  ['products-add', '/app/products/add'], ['knowledge', '/app/knowledge'],
  ['employee', '/app/employee'], ['practice', '/app/sandbox'], ['forbidden', '/app/settings/forbidden'],
  ['setup', '/app/settings'], ['guide', '/app/guide'], ['profile', '/app/settings/profile'],
  ['onboarding', '/app/onboarding'], ['technical', '/app/onboarding/technical'], ['ready', '/app/ready'],
  ['channels', '/app/channels'], ['alerts', '/app/settings/alerts'], ['people', '/app/settings/people'],
  ['account', '/app/settings/account'], ['billing', '/app/settings/billing'], ['data', '/app/settings/data'],
  ['terms', '/app/settings/terms'], ['samples', '/app/settings/samples'], ['closures', '/app/settings/closures'],
  ['rate', '/app/settings/rate'], ['contacts', '/app/contacts'],
];
const want = opt('pages', '').split(',').filter(Boolean);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addCookies([{ name: 'yf_locale', value: LOCALE, url: BASE }]);
const signIn = await ctx.request.post(`${BASE}/login`, { form: { code: CODE }, maxRedirects: 0 });
if (signIn.status() >= 400) { console.error(`sign-in refused (${signIn.status()})`); process.exit(1); }
const page = await ctx.newPage();
const found = {};
const out = [];

for (const [name, where] of PAGES) {
  let url = where;
  if (typeof where !== 'string') {
    const from = where.from.startsWith('@') ? found[where.from.slice(1)] : where.from;
    if (!from) continue;
    await page.goto(BASE + from, { waitUntil: 'networkidle' });
    const hrefs = await page.$$eval('main a[href]', (as) => as.map((a) => a.getAttribute('href')));
    url = hrefs.find((h) => where.href.test(h ?? ''));
    if (!url) { if (!want.length || want.includes(name)) console.log(`${name.padEnd(13)} (no link of that shape on ${from})`); continue; }
  }
  found[name] = url;
  if (want.length && !want.includes(name)) continue;
  const res = await page.goto(BASE + url, { waitUntil: 'networkidle' });
  if (!res || res.status() >= 400) { console.log(`${name.padEnd(13)} ${res?.status()} ${url}`); continue; }

  const r = await page.evaluate(() => {
    const MARKS = /^[✓✔○●◐◑✦✕✗×!⚠⏸◆▲■□↺↻•]/u;
    const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g); return m ? m.slice(0, 3).map(Number) : null; };
    const root = getComputedStyle(document.documentElement);
    const tok = (n) => { const v = root.getPropertyValue(`--color-${n}`).trim(); const d = document.createElement('i'); d.style.color = v; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const JOBS = { assistant: tok('assistant'), ok: tok('ok'), waiting: tok('waiting'), warn: tok('warn') };
    const jobOf = (c) => Object.entries(JOBS).find(([, v]) => v === c)?.[0] ?? null;
    const sat = (c) => { const x = hex(c); if (!x) return 0; const mx = Math.max(...x), mn = Math.min(...x); return mx ? (mx - mn) / mx : 0; };
    // The first string of `content` ("○" / "" is the shape with an empty alternative).
    const before = (e) => { const c = getComputedStyle(e, '::before').content; return c && c !== 'none' && c !== 'normal' ? (/^"([^"]*)"/.exec(c)?.[1] ?? c) : ''; };
    const opensWithMark = (e) => MARKS.test((e.textContent ?? '').trim()) || MARKS.test(before(e))
      || (e.firstElementChild !== null && MARKS.test((e.firstElementChild.textContent ?? '').trim()));
    const marked = (e) => {
      if (e.matches('button, .btn')) return true;   // a button's own word says what it does
      if (opensWithMark(e)) return true;
      // a mark standing just before it, or opening its line or its row (three levels up)
      const prev = e.previousElementSibling;
      if (prev && MARKS.test((prev.textContent ?? '').trim() || before(prev))) return true;
      for (let a = e.parentElement, i = 0; a && i < 3; a = a.parentElement, i++) if (opensWithMark(a)) return true;
      return false;
    };
    let texts = 0; const hits = []; const stray = [];
    for (const e of document.querySelectorAll('main *')) {
      if (!e.getClientRects().length) continue;
      const own = [...e.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim();
      if (!own && !before(e)) continue;
      if (own) texts++;
      const cs = getComputedStyle(e);
      const job = jobOf(cs.color);
      if (job) hits.push({ job, cls: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`, text: (own || before(e)).slice(0, 40), marked: marked(e) });
      else if (sat(cs.color) > 0.25) stray.push({ color: cs.color, cls: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`, text: own.slice(0, 40) });
    }
    const ink = tok('ink');
    const fills = [...document.querySelectorAll('main button, main a.btn, main input[type=submit]')]
      .filter((b) => b.getClientRects().length && getComputedStyle(b).backgroundColor === ink)
      .map((b) => (b.textContent ?? b.value ?? '').trim().slice(0, 24));
    return { texts, hits, stray, fills };
  });
  out.push({ page: name, url, ...r });
  const unmarked = r.hits.filter((h) => !h.marked);
  console.log(`${name.padEnd(13)} ${String(r.hits.length).padStart(3)} of ${String(r.texts).padStart(3)} in a signal colour · ${unmarked.length} without a shape · fills ${r.fills.length}${r.fills.length ? ` (${r.fills.join(' | ')})` : ''}`);
  const seen = new Set();
  for (const h of r.hits) {
    const k = `${h.job} ${h.cls} ${h.marked}`; if (seen.has(k)) continue; seen.add(k);
    console.log(`    ${h.marked ? ' ' : '!'} ${h.job.padEnd(9)} ${h.cls.padEnd(30)} ${h.text}`);
  }
  for (const s of r.stray) console.log(`    ? ${s.color.padEnd(20)} ${s.cls.padEnd(30)} ${s.text}`);
}
await browser.close();
const json = opt('json');
if (json) await writeFile(json, JSON.stringify(out, null, 2));
