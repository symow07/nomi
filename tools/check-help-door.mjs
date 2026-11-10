#!/usr/bin/env node
/**
 * Block 6.1 — THE "?" COVERS NOTHING. A browser check, not a CI gate (CI has no browser): it drives Chromium against
 * a running, seeded Nomi and, on every shell page, measures the help door (`a.help-door`) against every control on
 * the page — links, buttons, a menu's summary, form fields — at a phone's width, in English and Arabic. Any control
 * whose box the "?" touches is a failure: a tap there opens help, not the control (6.1's verification, F-E: on Today,
 * Calendar and Results the "?" sat on the area menu's arrow).
 *
 * The pages: every GET route the app registers with no parameter in it (read from the built app, as the parity
 * test does), drawn as the owner; those that come back 200 with the "?" are the shell pages.
 *
 *   node tools/check-help-door.mjs --base http://127.0.0.1:8961 --code <owner access code>
 *   node tools/check-help-door.mjs --widths 390,1440 --locales en,ar --json out.json
 *
 * Exit 0: nothing touched. Exit 1: the list of what was. Needs `npm run build` and Playwright's Chromium.
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import Fastify from 'fastify';

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = opt('code', 'smoke-code');
const widths = opt('widths', '390').split(',').map(Number);
const locales = opt('locales', 'en,ar').split(',');
const only = opt('pages', '');

/** Every GET route with no parameter, from the built app (no database is reached: nothing is served). */
async function staticRoutes() {
  const { registerWebApp } = await import('../dist/api/web/app.js');
  const app = Fastify({ logger: false });
  const routes = [];
  app.addHook('onRoute', (r) => { const ms = Array.isArray(r.method) ? r.method : [r.method]; if (ms.includes('GET')) routes.push(r.url); });
  registerWebApp(app, {
    db: {}, sessionSecret: 'x'.repeat(64), accessCode: 'not-used', businessId: 'de300000-0000-4000-8000-0000000000b1',
    employeeName: 'Lily', avatar: '·', provider: 'disabled', secureCookie: false, kickOutbound: async () => {},
  });
  await app.ready(); await app.close();
  return [...new Set(routes)].filter((r) => (r === '/app' || r.startsWith('/app/')) && !r.includes(':') && !r.includes('*')
    && !r.startsWith('/app/live/') && !/\.(csv|xlsx|zip|pdf|json|js|png|jpg|webm|vtt|ics)$/.test(r)).sort();
}

const browser = await chromium.launch();
const problems = [];
const measured = [];
try {
  const probe = await browser.newContext();
  await probe.route('**/*', (r) => new URL(r.request().url()).origin === BASE ? r.continue() : r.abort());
  const login = await probe.request.post(`${BASE}/login`, { form: { code: CODE }, maxRedirects: 0 });
  if (login.status() !== 302) throw new Error(`sign-in refused (${login.status()})`);
  const cookies = await probe.cookies();
  const pages = [];
  for (const r of only ? only.split(',') : await staticRoutes()) {
    const res = await probe.request.get(`${BASE}${r}`, { maxRedirects: 0 });
    if (res.status() === 200 && (await res.text()).includes('class="help-door"')) pages.push(r);
  }
  await probe.close();
  console.log(`${pages.length} shell pages`);

  for (const locale of locales) for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.route('**/*', (r) => new URL(r.request().url()).origin === BASE ? r.continue() : r.abort());
    await ctx.addCookies([...cookies, { name: 'yf_locale', value: locale, url: BASE }]);
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      const hit = await page.evaluate(() => {
        const door = document.querySelector('a.help-door');
        if (!door) return { door: null, touched: [] };
        const d = door.getBoundingClientRect();
        const CONTROLS = 'a[href], button, summary, input:not([type=hidden]), select, textarea, label, [role=button], [tabindex]:not([tabindex="-1"])';
        const touched = [];
        for (const el of document.querySelectorAll(CONTROLS)) {
          if (el === door || door.contains(el) || el.contains(door)) continue;
          if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          for (const r of el.getClientRects()) {
            if (r.width === 0 || r.height === 0) continue;
            if (r.right <= d.left || d.right <= r.left || r.bottom <= d.top || d.bottom <= r.top) continue;
            const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            touched.push({ tag: el.tagName.toLowerCase(), cls: el.className && typeof el.className === 'string' ? el.className : '', name,
              box: [r.left, r.top, r.width, r.height].map(Math.round) });
            break;
          }
        }
        return { door: [d.left, d.top, d.width, d.height].map(Math.round), touched };
      });
      measured.push({ locale, width, path, ...hit });
      if (!hit.door) problems.push({ locale, width, path, why: 'no "?" drawn' });
      for (const t of hit.touched) problems.push({ locale, width, path, why: `"?" ${JSON.stringify(hit.door)} touches ${t.tag}.${t.cls} "${t.name}" ${JSON.stringify(t.box)}` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
const json = opt('json', '');
if (json) await writeFile(json, JSON.stringify({ measured, problems }, null, 1));
console.log(`${measured.length} page views measured (${locales.join('/')} × ${widths.join('/')} px)`);
if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p.locale} ${p.width} ${p.path}: ${p.why}`);
  console.log(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log('OK: the "?" touches no control on any page');
