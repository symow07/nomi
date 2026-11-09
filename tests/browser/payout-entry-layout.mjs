/** Run after npm run build: node tests/browser/payout-entry-layout.mjs <evidence directory>.
 * A Stripe payout's and a Stripe fee's Books entries at 390 px, en and ar: the entry page's heading is its key and label, so the label must
 * wrap. The label comes from the posting code itself (`payoutLabel`); the payout's id stays the document reference.
 * Local rendered fixtures and real shell assets only; no database or provider calls.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { shell, assetAt } from '../../dist/api/web/layout.js';
import { renderEntry } from '../../dist/api/web/booksEntries.js';
import * as posting from '../../dist/db/stripePosting.js';

const out = process.argv[2];
assert(out, 'Supply an evidence directory');
await mkdir(out, { recursive: true });
const providerId = 'po_1QW8TaAbCdEfGhIjKlMnOpQrStUvWxYz';
const feeId = 'txn_1QW8TaAbCdEfGhIjKlMnOpQr';
const date = '2026-11-09';
// Before the readable label existed, the posting wrote the payout's id as the label: measured the same way.
const labelOf = (kind) => kind === 'fee' ? (typeof posting.feeLabel === 'function' ? posting.feeLabel(date) : feeId)
  : typeof posting.payoutLabel === 'function' ? posting.payoutLabel(kind, date) : kind === 'received' ? `${providerId} receipt` : providerId;
const idOf = (kind) => kind === 'fee' ? feeId : providerId;
const line = (lineNo, account, accountName, debit, credit) => ({ lineNo, account, accountName, party: null, taxCode: null, currency: 'GBP', debit, credit,
  bookDebit: debit, bookCredit: credit, rate: null, label: null, isFx: false, custom: {} });
const entries = {
  sent: { label: labelOf('sent'), documentRef: providerId, lines: [line(1, '1040', 'Payouts in transit', '97.00', null), line(2, '1030', 'Stripe clearing', null, '97.00')] },
  received: { label: labelOf('received'), documentRef: `${providerId} receipt`, lines: [line(1, '1000', 'Bank current account', '97.00', null), line(2, '1040', 'Payouts in transit', null, '97.00')] },
  fee: { label: labelOf('fee'), documentRef: feeId, lines: [line(1, '5020', 'Processing fees', '3.00', null), line(2, '1030', 'Stripe clearing', null, '3.00')] },
};
const entry = (kind) => ({ id: '00000000-0000-4000-8000-000000000001', key: 'GJ-2026-12', journal: 'GJ', date, state: 'posted', total: '97.00', currency: 'GBP',
  reverses: null, reversedBy: null, documentDate: date, postedBy: 'owner', custom: {}, ...entries[kind] });
const owner = { isOwner: true, id: 'owner' };

const app = Fastify({ logger: false });
app.get('/assets/:file', (req, reply) => {
  const found = assetAt(req.params.file);
  return found ? reply.type(found.type).send(found.body) : reply.code(404).send();
});
app.get('/app/books/advanced/entries/entry', (req, reply) => {
  const { locale, kind } = req.query;
  assert(['en', 'ar'].includes(locale) && kind in entries);
  return reply.type('text/html').send(shell({ title: 'GJ-2026-12', active: 'settings', path: '/app/books/advanced/entries/entry', locale,
    bodyHtml: renderEntry(locale, owner, entry(kind), date, 'GBP') }));
});
const report = { chromium: '', providerId, labels: Object.fromEntries(Object.keys(entries).map((k) => [k, entries[k].label])), checks: [], errors: [], external: [] };
let browser;
try {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true });
  report.chromium = browser.version();
  for (const kind of Object.keys(entries)) for (const locale of ['en', 'ar']) for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled });
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      report.external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.message));
    const response = await page.goto(`${base}/app/books/advanced/entries/entry?locale=${locale}&kind=${kind}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      locale: document.documentElement.lang, direction: document.documentElement.dir,
      heading: document.querySelector('h1.page')?.textContent ?? null, body: document.body.textContent }));
    const name = `${kind}-${locale}-${javaScriptEnabled ? 'js' : 'no-js'}-390`;
    await page.screenshot({ path: join(out, name + '.png'), fullPage: true });
    report.checks.push({ kind, locale, javaScriptEnabled, status: response.status(), clientWidth: dimensions.clientWidth, scrollWidth: dimensions.scrollWidth,
      direction: dimensions.direction, heading: dimensions.heading, id: idOf(kind), referenceShown: dimensions.body.includes(idOf(kind)) });
    await context.close();
  }
} finally {
  await browser?.close(); await app.close();
  await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
}
assert.deepEqual(report.errors, []);
assert.deepEqual(report.external, []);
assert.equal(report.checks.length, 12);
for (const row of report.checks) {
  assert.equal(row.status, 200);
  assert.equal(row.clientWidth, 390, JSON.stringify(row));
  assert.equal(row.scrollWidth, 390, JSON.stringify(row));
  assert(row.heading && !row.heading.includes(row.id), JSON.stringify(row));
  assert(row.referenceShown, JSON.stringify(row));
}
console.log(JSON.stringify({ chromium: report.chromium, passed: report.checks.length, total: 12 }));
