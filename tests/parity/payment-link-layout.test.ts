import { describe, expect, it } from 'vitest';
import { renderStripePayments } from '../../src/api/web/stripePayments.js';
import { shell } from '../../src/api/web/layout.js';
import { minorAmount } from '../../src/core/payments/paymentLink.js';
import type { StripePage } from '../../src/db/stripePage.js';
import { linkedCss } from './linked-css.js';
import { unisolatedFigures } from './isolates.js';

const id = 'po_1QW8TaAbCdEfGhIjKlMnOpQrStUvWxYz';
const page: StripePage = { country: 'GB', practice: false, configured: true, live: false, connection: null, mapping: null,
  accounts: [], banks: [], journals: [], attempts: [], movements: [], statements: [], events: [], payouts: [] };
describe('payout labels stay readable on a phone', () => {
  for (const locale of ['en', 'ar'] as const) for (const state of ['unconfirmed', 'limited', 'refused'] as const) {
    it(`${locale}: ${state} names the payout by date and amount and isolates its wrapping reference`, () => {
      const amount = minorAmount(Number.MAX_SAFE_INTEGER)!;
      const html = renderStripePayments({ ...page, payouts: [{ id, amount, currency: 'GBP', date: '2026-11-09', status: 'paid',
        nomiAmount: state === 'limited' ? '97' : null, entryId: state === 'limited' ? 'entry' : null, receiptId: null,
        reason: state === 'refused' ? 'period' : null }] }, locale, null);
      const heading = html.match(/<h3>(.*?)<\/h3>/s)?.[1] ?? '';
      expect(heading).toContain('2026-11-09'); expect(heading).not.toContain(id);
      expect(heading).toContain('<bdi');
      expect(html).toContain(`<p class="caption"><bdi dir="ltr">${id}</bdi></p>`);
      expect(unisolatedFigures(html)).toEqual([]);
      expect(html).not.toContain('<script');
      const css = linkedCss(shell({ title: 'Payment links', active: 'books', locale, path: '/app/payments/stripe', bodyHtml: html }));
      expect(css).toMatch(/\.stripe-payments article h3,\s*\.stripe-payments article \.caption\s*\{\s*overflow-wrap:anywhere;\s*\}/);
    });
  }
});
