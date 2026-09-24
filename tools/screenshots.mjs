#!/usr/bin/env node
/**
 * G17b · M49 — the screenshot set, for review BY EYE. Not a CI gate.
 *
 * The layout tests read strings. They caught the rules that can be written
 * down — widths, the spacing scale, which voice a heading speaks in — and they
 * missed every defect a person saw in a second: fields strung across a page
 * because no rule styled them, a centred card beside a left-aligned page. This
 * captures every owner page at a phone, a tablet and a desktop width, in all
 * three languages, and lays them out on one contact sheet so the whole product
 * can be looked at together.
 *
 * It judges nothing, except two things a screenshot cannot show by itself: a
 * page that did not render (a status other than 200, or the wrong language),
 * and a page wider than the screen it is on. Both are listed, and neither
 * fails the run — it is for looking at, not for gating.
 *
 *   node tools/screenshots.mjs                  every page, 3 widths × 3 languages
 *   node tools/screenshots.mjs --pages today,inbox --locales ar --widths phone
 *   node tools/screenshots.mjs --base http://127.0.0.1:8787 --code smoke-code
 *
 * If nothing answers /health at --base (and it is this machine), it runs the
 * run-nomi smoke script first — the same seeded app that walkthrough drives,
 * left running afterwards. --no-boot skips that.
 *
 * Output: screenshots/<page>/<locale>-<width>.png and screenshots/index.html.
 * The folder is ignored by git. The browser is Playwright's Chromium, a dev
 * dependency: `npx playwright install chromium` once per machine.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const list = (name, all) => {
  const v = opt(name);
  if (!v) return all;
  const want = v.split(',').map((s) => s.trim());
  const unknown = want.filter((w) => !all.some((a) => (a.name ?? a) === w));
  if (unknown.length) { console.error(`unknown --${name}: ${unknown.join(', ')}`); process.exit(2); }
  return all.filter((a) => want.includes(a.name ?? a));
};

const BASE = (opt('base') ?? process.env.NOMI_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = opt('code') ?? process.env.OWNER_ACCESS_CODE ?? 'smoke-code';
const OUT = path.resolve(ROOT, opt('out') ?? 'screenshots');
const MARKER = '.nomi-screenshots';

/** The cookie the language switcher sets (src/api/web/app.ts LOCALE_COOKIE). */
const LOCALE_COOKIE = 'yf_locale';
const LOCALES = list('locales', ['en', 'zh', 'ar']);
const WIDTHS = list('widths', [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1280, height: 900 },
]);

/**
 * The pages an owner lives in. A page reached by id is FOUND — the first link
 * of that shape on the page named in `from` (a path, or '@page' for another
 * found page) — so the set follows whatever the seeded tenant holds.
 */
const PAGES = list('pages', [
  { name: 'login', path: '/login', signedOut: true },
  { name: 'today', path: '/app' },
  { name: 'inbox', path: '/app/inbox' },
  { name: 'inbox-all', path: '/app/inbox?filter=all' },
  { name: 'conversation', find: { from: ['/app/inbox?filter=all'], href: /^\/app\/inbox\/[0-9a-f-]{36}$/ } },
  { name: 'buyers', path: '/app/conversations' },
  { name: 'buyer', find: { from: ['/app/conversations'], href: /^\/app\/conversations\/[0-9a-f-]{36}$/ } },
  { name: 'order', find: { from: ['@buyer', '@conversation'], href: /^\/app\/orders\/[0-9a-f-]{36}$/ } },
  { name: 'factory', path: '/app/factory' },
  { name: 'prices', path: '/app/factory/prices' },
  { name: 'products', path: '/app/products' },
  { name: 'product', find: { from: ['/app/products'], href: /^\/app\/products\/[0-9a-f-]{36}$/ } },
  { name: 'teach-products', path: '/app/products/add' },
  { name: 'knowledge', path: '/app/knowledge' },
  { name: 'settings', path: '/app/settings' },
  { name: 'people', path: '/app/settings/people' },
  { name: 'terms', path: '/app/settings/terms' },
  { name: 'samples', path: '/app/settings/samples' },
  { name: 'closures', path: '/app/settings/closures' },
  { name: 'forbidden', path: '/app/settings/forbidden' },
  { name: 'rate', path: '/app/settings/rate' },
  { name: 'channels', path: '/app/channels' },
  { name: 'contacts', path: '/app/contacts' },
  { name: 'employee', path: '/app/employee' },
  { name: 'onboarding', path: '/app/onboarding' },
  { name: 'sandbox', path: '/app/sandbox' },
  { name: 'analytics', path: '/app/analytics' },
]);

const healthy = async () => {
  try { return (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};

async function ensureServer() {
  if (await healthy()) return;
  const url = new URL(BASE);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (flag('no-boot') || !local) {
    console.error(`nothing answers ${BASE}/health — start the app (bash .claude/skills/run-nomi/smoke.sh) or pass --base`);
    process.exit(1);
  }
  console.log(`nothing answers ${BASE}/health — booting it with the run-nomi smoke script…`);
  const r = spawnSync('bash', [path.join(ROOT, '.claude/skills/run-nomi/smoke.sh')], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, PORT: url.port || '80', OWNER_ACCESS_CODE: CODE },
  });
  if (r.status !== 0 || !(await healthy())) { console.error('the smoke script did not leave a running app'); process.exit(1); }
}

/** A fresh output folder — but only ever one this tool made. */
async function prepareOut() {
  const exists = await access(OUT).then(() => true, () => false);
  if (exists) {
    const ours = await access(path.join(OUT, MARKER)).then(() => true, () => false);
    if (!ours) { console.error(`${OUT} exists and was not made by this tool — pass --out elsewhere`); process.exit(2); }
    await rm(OUT, { recursive: true, force: true });
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, MARKER), 'made by tools/screenshots.mjs — safe to delete\n');
}

async function signIn(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  // A1 — the door is e-mail + password now; the access-code form sits inside a
  // collapsed <details>, so open it first and submit ITS button, not the first
  // submit on the page (which is the e-mail form's).
  await page.click('details summary');
  await page.fill('details input[name="code"]', CODE);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('details form button[type="submit"]')]);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Resolve every found page to one path, so each language and width shows the same record. */
async function resolvePaths(browser, state) {
  const ctx = await browser.newContext({ storageState: state });
  const page = await ctx.newPage();
  const resolved = new Map();
  for (const p of PAGES) if (p.path) resolved.set(p.name, p.path);
  // Found pages may depend on each other ('@buyer'), so resolve in list order,
  // including the ones filtered out of this run.
  const all = [
    { name: 'conversation', from: ['/app/inbox?filter=all'], href: /^\/app\/inbox\/[0-9a-f-]{36}$/ },
    { name: 'buyer', from: ['/app/conversations'], href: /^\/app\/conversations\/[0-9a-f-]{36}$/ },
    ...PAGES.filter((p) => p.find).map((p) => ({ name: p.name, ...p.find })),
  ];
  for (const f of all) {
    if (resolved.has(f.name)) continue;
    for (const from of f.from) {
      const at = from.startsWith('@') ? resolved.get(from.slice(1)) : from;
      if (!at) continue;
      await page.goto(`${BASE}${at}`);
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      const hit = hrefs.find((h) => h && f.href.test(h));
      if (hit) { resolved.set(f.name, hit); break; }
    }
  }
  await ctx.close();
  return resolved;
}

async function main() {
  await ensureServer();
  await prepareOut();
  const browser = await chromium.launch();
  const results = [];
  try {
    const state = await signIn(browser);
    const paths = await resolvePaths(browser, state);
    for (const w of WIDTHS) {
      for (const locale of LOCALES) {
        const cookie = { name: LOCALE_COOKIE, value: locale, url: BASE };
        const signedIn = await browser.newContext({ storageState: state, viewport: { width: w.width, height: w.height } });
        const signedOut = await browser.newContext({ viewport: { width: w.width, height: w.height } });
        await signedIn.addCookies([cookie]);
        await signedOut.addCookies([cookie]);
        const tabs = { in: await signedIn.newPage(), out: await signedOut.newPage() };
        for (const p of PAGES) {
          const at = paths.get(p.name);
          const row = { page: p.name, locale, width: w.name, path: at ?? null, file: null, problems: [] };
          results.push(row);
          if (!at) { row.problems.push('nothing to show — no such record in this tenant'); continue; }
          const tab = p.signedOut ? tabs.out : tabs.in;
          const res = await tab.goto(`${BASE}${at}`, { waitUntil: 'load' });
          const status = res?.status() ?? 0;
          if (status !== 200) row.problems.push(`status ${status}`);
          if (!p.signedOut && new URL(tab.url()).pathname.startsWith('/login')) row.problems.push('sent to the sign-in page');
          const lang = await tab.getAttribute('html', 'lang').catch(() => null);
          if (lang !== locale) row.problems.push(`rendered in ${lang ?? 'no language'}, not ${locale}`);
          const overflow = await tab.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          if (overflow > 1) row.problems.push(`${overflow}px wider than the screen`);
          const rel = path.join(p.name, `${locale}-${w.name}.png`);
          await mkdir(path.join(OUT, p.name), { recursive: true });
          await tab.screenshot({ path: path.join(OUT, rel), fullPage: true });
          row.file = rel;
        }
        await signedIn.close();
        await signedOut.close();
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(path.join(OUT, 'index.html'), contactSheet(results));
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));

  const shot = results.filter((r) => r.file).length;
  const flagged = results.filter((r) => r.problems.length);
  console.log(`\n${shot} screenshots of ${PAGES.length} pages · ${LOCALES.join(' ')} · ${WIDTHS.map((w) => w.name).join(' ')}`);
  for (const r of flagged) console.log(`  ! ${r.page} ${r.locale} ${r.width}: ${r.problems.join('; ')}`);
  console.log(`\n  open ${path.join(OUT, 'index.html')}`);
  if (shot === 0) process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One section per page: the three languages side by side, one row per width. */
function contactSheet(results) {
  const sections = PAGES.map((p) => {
    const rows = WIDTHS.map((w) => `<tr><th scope="row">${esc(w.name)}<br><small>${w.width}px</small></th>${LOCALES.map((l) => {
      const r = results.find((x) => x.page === p.name && x.locale === l && x.width === w.name);
      const img = r?.file ? `<a href="${esc(r.file)}"><img loading="lazy" src="${esc(r.file)}" alt="${esc(`${p.name} · ${l} · ${w.name}`)}"></a>` : '';
      const notes = r?.problems.length ? `<ul class="flag">${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
      return `<td>${img}${notes}</td>`;
    }).join('')}</tr>`).join('');
    const where = results.find((x) => x.page === p.name)?.path;
    return `<section id="${esc(p.name)}"><h2>${esc(p.name)} <code>${esc(where ?? '—')}</code></h2>
      <div class="scroll"><table><thead><tr><th></th>${LOCALES.map((l) => `<th scope="col">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join('\n');
  const flagged = results.filter((r) => r.problems.length).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi screenshots</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; background: #f6f5f2; color: #1d1d1b; }
  h1 { margin: 0 0 4px; } p.sub { margin: 0 0 24px; color: #6b6a65; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px; }
  nav a { padding: 4px 10px; border: 1px solid #dcdad3; border-radius: 999px; color: inherit; text-decoration: none; }
  section { margin-bottom: 48px; } h2 { font-size: 16px; } code { color: #6b6a65; font-weight: 400; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; } th, td { vertical-align: top; padding: 8px; text-align: start; }
  td img { display: block; width: 320px; border: 1px solid #dcdad3; background: #fff; }
  .flag { color: #a4361f; margin: 6px 0 0; padding-inline-start: 18px; max-width: 320px; }
</style></head><body>
<h1>Nomi screenshots</h1>
<p class="sub">${results.filter((r) => r.file).length} captures · ${esc(new Date().toISOString())} · ${esc(BASE)} · ${flagged ? `${flagged} flagged` : 'nothing flagged'}</p>
<nav>${PAGES.map((p) => `<a href="#${esc(p.name)}">${esc(p.name)}</a>`).join('')}</nav>
${sections}
</body></html>`;
}

main().catch((err) => { console.error(err); process.exit(1); });
