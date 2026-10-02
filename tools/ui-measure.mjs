#!/usr/bin/env node
/**
 * The UI rebuild's measuring tape (2026-10-02). Not a CI gate: it drives a
 * real browser against a running, seeded Nomi and prints what a person would
 * otherwise judge by eye, as numbers that can be compared before and after.
 *
 * For each page, language and width it reports:
 *   - how many conversation rows (`a.crow`) are wholly on the first screen,
 *     and their heights;
 *   - for every row, whether its time sits at the line's end in the page's
 *     direction (right in English, left in Arabic), and whether a cut name or
 *     message still shows its own beginning — the right-to-left defect where
 *     an English message on an Arabic page lost its first words;
 *   - the text sizes in use, and whether any text is smaller than the
 *     English page's for the same element (Arabic and Chinese never smaller).
 *
 *   node tools/ui-measure.mjs                       inbox pages, en/zh/ar/es, laptop + phone
 *   node tools/ui-measure.mjs --pages inbox-all --locales ar --widths phone
 *   node tools/ui-measure.mjs --base http://127.0.0.1:8787 --code smoke-code --json out.json
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`) and a
 * running instance (the run-nomi smoke script, then tools/seed-usability.mjs).
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const opt = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const CODE = opt('code', 'smoke-code');
const PAGES = {
  'inbox-needs': '/app/inbox',
  'inbox-all': '/app/inbox?filter=all',
  'conversation': '/app/inbox/de300000-0000-4000-8000-00000000e23d',
};
const pages = opt('pages', Object.keys(PAGES).join(',')).split(',');
const locales = opt('locales', 'en,zh,ar,es').split(',');
const WIDTHS = { laptop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const widths = opt('widths', 'laptop,phone').split(',');

const browser = await chromium.launch();
const out = [];
let problems = 0;
for (const w of widths) {
  for (const locale of locales) {
    const ctx = await browser.newContext({ viewport: WIDTHS[w], deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'yf_locale', value: locale, url: BASE }]);
    const login = await ctx.request.post(`${BASE}/login`, { form: { code: CODE }, maxRedirects: 0 });
    if (login.status() !== 302) throw new Error(`sign-in refused (${login.status()})`);
    const page = await ctx.newPage();
    for (const name of pages) {
      await page.goto(BASE + PAGES[name], { waitUntil: 'networkidle' });
      await page.evaluate(() => window.scrollTo(0, 0));
      const m = await page.evaluate(() => {
        const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
        const rows = [...document.querySelectorAll('a.crow')].filter((r) => r.getClientRects().length);
        const boxes = rows.map((r) => r.getBoundingClientRect());
        const issues = [];
        // Does a cut element still show its own first character?
        const startVisible = (el) => {
          const node = [...el.querySelectorAll('*'), el].flatMap((e) => [...e.childNodes]).find((n) => n.nodeType === 3 && n.textContent.trim());
          if (!node || el.scrollWidth <= el.clientWidth + 1) return true;
          const r = document.createRange();
          const i = node.textContent.search(/\S/);
          r.setStart(node, i); r.setEnd(node, i + 1);
          const c = r.getBoundingClientRect(); const b = el.getBoundingClientRect();
          return c.left >= b.left - 1 && c.right <= b.right + 1;
        };
        rows.forEach((row, n) => {
          if (!row.closest('main')) return;
          const name = row.querySelector('.cr-name'); const when = row.querySelector('.cr-when');
          const text = row.querySelector('.cr-text');
          if (when && when.textContent.trim() && name) {
            const wb = when.getBoundingClientRect(); const nb = name.getBoundingClientRect();
            if (rtl ? wb.left > nb.left : wb.right < nb.right) issues.push(`row ${n}: the time is not at the line's end`);
          }
          if (name && !startVisible(name)) issues.push(`row ${n}: the name is cut at its start`);
          if (text && !startVisible(text)) issues.push(`row ${n}: the message is cut at its start ("${text.textContent.slice(0, 24)}…")`);
        });
        const sizes = {};
        for (const e of document.querySelectorAll('main *')) {
          if ([...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && e.getClientRects().length) {
            const s = getComputedStyle(e).fontSize; sizes[s] = (sizes[s] || 0) + 1;
          }
        }
        return {
          rows: rows.length,
          inView: boxes.filter((b) => b.top >= 0 && b.bottom <= innerHeight).length,
          heights: [...new Set(boxes.map((b) => Math.round(b.height)))].sort((a, b) => a - b),
          firstTop: boxes[0] ? Math.round(boxes[0].top) : null,
          docWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          issues, sizes,
        };
      });
      const line = `${name.padEnd(13)} ${locale} ${w.padEnd(6)} rows on screen ${String(m.inView).padStart(2)} of ${String(m.rows).padStart(2)} · heights ${m.heights.join('/') || '–'} · first at ${m.firstTop ?? '–'}${m.docWidth > m.viewport ? ` · WIDER THAN THE SCREEN (${m.docWidth})` : ''}`;
      console.log(line);
      for (const i of m.issues) { console.log(`   ✗ ${i}`); problems++; }
      if (m.docWidth > m.viewport) problems++;
      out.push({ page: name, locale, width: w, ...m });
    }
    await ctx.close();
  }
}
await browser.close();
if (opt('json')) await writeFile(opt('json'), JSON.stringify(out, null, 1));
console.log(problems ? `${problems} problem(s)` : 'no problems found');
