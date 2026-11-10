#!/usr/bin/env node
/**
 * Block 6.1 — THE HELP PAGE FITS. A browser check, not a CI gate (CI has no browser): it drives Chromium against a
 * running, seeded Nomi and, for each sign-in given, draws the help page (`/app/help/page`, from several pages) at each
 * width and language, and fails any view that scrolls sideways (`scrollWidth` past the viewport). Where the shell's "?"
 * lifts the same card into its sheet, the sheet is measured too (its own `scrollWidth` past its own width).
 *
 * Why: the notice's list ("We get exactly this…", `ul.help-sends`) is English in every language, each line left to
 * right by its own `dir="auto"`. Inside an Arabic page its bullet hung outside the list's left edge, past the page:
 * 7 px of sideways scroll at 390 px, owner and staff (6.1's final verification, F1).
 *
 *   node tools/check-help-fits.mjs --base http://127.0.0.1:8977 --codes owner:<code>,staff:<code>
 *   node tools/check-help-fits.mjs --widths 360,390,768,1440 --locales en,ar,zh,es --json out.json
 *
 * Exit 0: every view fits. Exit 1: the list of what did not. Needs Playwright's Chromium.
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const codes = opt('codes', 'owner:smoke-code').split(',').map((s) => { const i = s.indexOf(':'); return { who: s.slice(0, i), code: s.slice(i + 1) }; });
const widths = opt('widths', '360,390,768,1440').split(',').map(Number);
const locales = opt('locales', 'en,ar,zh,es').split(',');
const froms = opt('from', '/app,/app/inbox,/app/books,/app/results').split(',');

const browser = await chromium.launch();
const problems = [];
const measured = [];
try {
  for (const { who, code } of codes) {
    const probe = await browser.newContext();
    await probe.route('**/*', (r) => new URL(r.request().url()).origin === BASE ? r.continue() : r.abort());
    const login = await probe.request.post(`${BASE}/login`, { form: { code }, maxRedirects: 0 });
    if (login.status() !== 302) throw new Error(`${who}: sign-in refused (${login.status()})`);
    const cookies = await probe.cookies();
    await probe.close();
    for (const locale of locales) for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await ctx.route('**/*', (r) => new URL(r.request().url()).origin === BASE ? r.continue() : r.abort());
      await ctx.addCookies([...cookies, { name: 'yf_locale', value: locale, url: BASE }]);
      const page = await ctx.newPage();
      for (const from of froms) {
        const path = `/app/help/page?from=${encodeURIComponent(from)}`;
        const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
        if (res?.status() !== 200) { problems.push({ who, locale, width, path, why: `status ${res?.status()}` }); continue; }
        const m = await page.evaluate(() => {
          const d = document.documentElement;
          return { lang: d.lang, dir: d.dir, scroll: d.scrollWidth, client: d.clientWidth, sends: !!document.querySelector('ul.help-sends') };
        });
        measured.push({ who, locale, width, path, view: 'page', ...m });
        if (m.lang !== locale) problems.push({ who, locale, width, path, why: `drawn in "${m.lang}"` });
        if (m.scroll > m.client) problems.push({ who, locale, width, path, why: `scrolls sideways: scrollWidth ${m.scroll} > ${m.client}` });
        if (who !== 'accountant' && !m.sends) problems.push({ who, locale, width, path, why: 'no notice list drawn (nothing measured)' });
      }
      // The same card in the shell's sheet, lifted by the "?" from the first page.
      await page.goto(`${BASE}${froms[0]}`, { waitUntil: 'load' });
      const door = page.locator('a.help-door').first();
      if (await door.count()) {
        await door.click();
        const sheet = page.locator('dialog.sheet[open] .help');
        if (await sheet.first().waitFor({ timeout: 3000 }).then(() => true, () => false)) {
          const m = await sheet.first().evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, doc: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
          measured.push({ who, locale, width, path: `${froms[0]} (sheet)`, view: 'sheet', ...m });
          if (m.scroll > m.client) problems.push({ who, locale, width, path: `${froms[0]} (sheet)`, why: `the sheet scrolls sideways: ${m.scroll} > ${m.client}` });
          if (m.doc > m.vw) problems.push({ who, locale, width, path: `${froms[0]} (sheet)`, why: `the page behind scrolls sideways: ${m.doc} > ${m.vw}` });
        }
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
const json = opt('json', '');
if (json) await writeFile(json, JSON.stringify({ measured, problems }, null, 1));
const sheets = measured.filter((m) => m.view === 'sheet').length;
console.log(`${measured.length - sheets} help pages and ${sheets} sheets measured (${codes.map((c) => c.who).join('/')} × ${locales.join('/')} × ${widths.join('/')} px)`);
if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p.who} ${p.locale} ${p.width} ${p.path}: ${p.why}`);
  console.log(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log('OK: the help page fits every width, in every language, for every sign-in');
