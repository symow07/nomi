/** Run after npm run build: node tests/browser/payment-link-layout.mjs <evidence directory>.
 * Local rendered fixtures and real shell assets only; no database or provider calls.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { shell, assetAt } from '../../dist/api/web/layout.js';
import { renderStripePayments } from '../../dist/api/web/stripePayments.js';
import { minorAmount } from '../../dist/core/payments/paymentLink.js';

const out = process.argv[2];
assert(out, 'Supply an evidence directory');
await mkdir(out, { recursive: true });
const providerId = 'po_1QW8TaAbCdEfGhIjKlMnOpQrStUvWxYz';
// The payout reader accepts positive safe integer minor units (larger than one Checkout payment).
const amount = minorAmount(Number.MAX_SAFE_INTEGER);
assert.equal(amount, '90071992547409.91');
const payout = { id: providerId, amount, currency: 'GBP', date: '2026-11-09', status: 'paid', nomiAmount: null, entryId: null, receiptId: null, reason: null };
const states = {
  unconfirmed: payout,
  limited: { ...payout, nomiAmount: '97', entryId: 'entry' },
  refused: { ...payout, reason: 'period' },
  pending: { ...payout, status: 'pending' },
  in_transit: { ...payout, status: 'in_transit' },
  failed: { ...payout, status: 'failed' },
  canceled: { ...payout, status: 'canceled' },
  returned: { ...payout, status: 'failed', reversalId: 'reversal', failureDate: '2026-11-10' },
};
const model = { country: 'GB', practice: false, configured: true, live: false,
  connection: { id: 'connection', account: 'acct_example', country: 'GB', currency: 'GBP', ready: true, active: true, live: false },
  mapping: { clearingId: 'clearing', transitId: 'transit', feeId: 'fee', bankId: 'bank', journalId: 'journal' },
  accounts: [{ id: 'clearing', code: '1030', name: 'Stripe clearing', kind: 'asset' }, { id: 'transit', code: '1040', name: 'Payouts in transit', kind: 'asset' }, { id: 'fee', code: '5020', name: 'Processing fees', kind: 'expense' }],
  banks: [{ id: 'bank', code: '1000', name: 'Bank current account' }], journals: [{ id: 'journal', code: 'GJ', name: 'General' }],
  attempts: [], movements: [], payouts: [], statements: [], events: [],
};
const app = Fastify({ logger: false });
app.get('/assets/:file', (req, reply) => {
  const found = assetAt(req.params.file);
  return found ? reply.type(found.type).send(found.body) : reply.code(404).send();
});
app.get('/app/payments/stripe', (req, reply) => {
  const { locale, state } = req.query;
  assert(['en', 'ar'].includes(locale) && state in states);
  return reply.type('text/html').send(shell({ title: 'Payment links', active: 'books', path: '/app/payments/stripe', locale,
    bodyHtml: renderStripePayments({ ...model, payouts: [states[state]] }, locale, null) }));
});
const report = { chromium: '', providerId, amount, checks: [], errors: [], external: [] };
let browser;
try {
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true });
  report.chromium = browser.version();
  for (const state of Object.keys(states)) for (const locale of ['en', 'ar']) for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      report.external.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    const response = await page.goto(`${base}/app/payments/stripe?locale=${locale}&state=${state}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      locale: document.documentElement.lang, direction: document.documentElement.dir,
      heading: document.querySelector('.stripe-payments article h3')?.textContent,
      idLineDirection: document.querySelector('.stripe-payments article .caption bdi') ? getComputedStyle(document.querySelector('.stripe-payments article .caption bdi')).direction : null }));
    const name = `${state}-${locale}-${javaScriptEnabled ? 'js' : 'no-js'}-390`;
    await page.screenshot({ path: join(out, name + '.png'), fullPage: true });
    report.checks.push({ state, locale, javaScriptEnabled, status: response.status(), ...dimensions });
    await context.close();
  }
} finally {
  await browser?.close(); await app.close();
  await writeFile(join(out, 'checks.json'), JSON.stringify(report, null, 2));
}
assert.deepEqual(report.errors, []);
assert.deepEqual(report.external, []);
assert.equal(report.checks.length, 32);
for (const row of report.checks) {
  assert.equal(row.status, 200);
  assert(row.scrollWidth <= row.clientWidth, JSON.stringify(row));
  assert.equal(row.idLineDirection, 'ltr');
  assert(!row.heading.includes(providerId));
}
console.log(JSON.stringify({ chromium: report.chromium, passed: report.checks.length, total: 32 }));
