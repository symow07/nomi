import { describe, it, expect } from 'vitest';
import { renderInvoice } from '../../src/api/web/booksInvoices.js';
import type { InvoiceView } from '../../src/db/booksInvoices.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * F19 (UI correction, Block 5) — the issued invoice: a summary above the paper says what is owed, when it is due and the
 * invoice's state, with the next act; the paper holds only what the customer reads; unit prices are money at the places
 * they were stored; where quantity × unit price is not the line's amount to the last place, the line says so. No stored
 * figure is changed.
 */
const d = decimal;
const owner = { isOwner: true };
const accountant = { isOwner: false, kind: 'accountant' as const };
const billedTo = { code: 'C2', name: 'Northwind Atelier', address: null, country: 'US', ice: null, taxNumber: null, registry: null, siret: null, registro: null, asIssued: true };
const inv: InvoiceView = {
  id: 'inv', key: 'F-2026-0002', party: 'Northwind Atelier', issueDate: '2026-11-03', dueDate: '2026-12-03', currency: 'USD',
  total: d('1874988.70'), credited: d('0'), paid: d('0'), status: 'open', label: 'Season stock', entryId: 'e', billedTo,
  lines: [
    { lineNo: 1, label: 'Pouch', quantity: '3', unitPrice: '1.2345', account: 'SALES', taxCode: null, net: d('3.70'), tax: d('0') },
    { lineNo: 2, label: 'Tote', quantity: '1500', unitPrice: '1249.99', account: 'SALES', taxCode: null, net: d('1874985.00'), tax: d('0') },
  ],
  payments: [], creditNotes: [],
};
const pay = { journals: [{ id: 'j', code: 'BK', name: 'Bank' }], accounts: [{ id: 'b', code: '1000', name: 'Checking' }] };
const page = (v: InvoiceView = inv, who: typeof owner | typeof accountant = owner, locale: 'en' | 'ar' = 'en') => renderInvoice(locale, who, v, pay, '2026-11-19');
const summary = (html: string) => html.slice(html.indexOf('<header class="bd-summary"'), html.indexOf('<article'));
const paper = (html: string) => html.match(/<article class="book-document"[\s\S]*?<\/article>/)?.[0] ?? '';

describe('F19 · the issued invoice', () => {
  it('the summary, above the paper, says what is owed, when it is due and the state, and leads to the next act', () => {
    const s = summary(page());
    expect(s).toContain('<h1 class="page">'); expect(s).toContain('Still owed'); expect(s).toContain('$1,874,988.70');
    expect(s).toContain('Thu, Dec 3, 2026'); expect(s).toContain('State'); expect(s).toContain('Open');
    expect(s).toContain('<a class="deeper" href="#pay">Record a payment</a>');
    expect(page().match(/<h1 /g)).toHaveLength(1);
  });
  it('the next act follows the state: a refund, nothing when settled, nothing for a draft or the accountant', () => {
    const refund = summary(page({ ...inv, credited: d('1874988.70'), paid: d('30'), status: 'refund_due' }));
    expect(refund).toContain('Refund due'); expect(refund).toContain('$30.00'); expect(refund).toContain('href="#refund"');
    const paid = summary(page({ ...inv, paid: inv.total, status: 'paid' }));
    expect(paid).toContain('Total'); expect(paid).not.toContain('href="#'); expect(paid).not.toContain('Still owed');
    const draft = summary(page({ ...inv, key: null, status: 'draft' }));
    expect(draft).toContain('Total'); expect(draft).not.toContain('href="#');
    expect(summary(page({ ...inv, status: 'discarded' }))).not.toContain('Still owed');
    expect(summary(page(inv, accountant))).not.toContain('href="#');
    expect(summary(page({ ...inv, dueDate: null }))).toContain('No due date');
  });
  it('the paper holds what the customer reads: no state pill, no owner notes, no form', () => {
    const p = paper(page());
    expect(p).not.toContain('class="pill'); expect(p).not.toContain('As written on the invoice'); expect(p).not.toContain('<form');
    expect(p).toContain('F-2026-0002'); expect(p).toContain('Northwind Atelier'); expect(p).toContain('Season stock');
  });
  it('unit prices are money at their stored places, quantities exact, and a rounded line says so', () => {
    const p = paper(page());
    expect(p).toContain('$1.2345'); expect(p).toContain('$1,249.99'); expect(p).toContain('>1,500<');
    expect(p).toContain('3 × $1.2345 = $3.7035, rounded to two decimals: $3.70');
    expect(p.match(/class="bd-round"/g)).toHaveLength(1);
    expect(p).toContain('$3.70'); expect(p).toContain('$1,874,985.00'); expect(p).toContain('$1,874,988.70');
  });
  it('a whole-cent price is drawn at two places and needs no rounding line', () => {
    const p = paper(page({ ...inv, lines: [{ ...inv.lines[0]!, quantity: '25', unitPrice: '18.4', net: d('460.00') }] }));
    expect(p).toContain('$18.40'); expect(p).not.toContain('bd-round');
  });
  it('in Arabic every figure and date in the summary and the lines is isolated', () => {
    const html = page(inv, owner, 'ar');
    const bare = (s: string) => s.replace(/<bdi>[^<]*<\/bdi>/g, '').replace(/<[^>]+>/g, ' ').replace(/\u2068[^\u2069]*\u2069/g, '').replace(/\u2066[^\u2069]*\u2069/g, '');
    expect(bare(summary(html))).not.toMatch(/[0-9]/);
    const lines = paper(html).slice(paper(html).indexOf('<tbody>'), paper(html).indexOf('</tbody>'));
    expect(bare(lines.replace(/<bdi>[^<]*<\/bdi>/g, ''))).not.toMatch(/[0-9]/);
  });
  it('the new words are in all five languages', () => {
    for (const k of ['booksInvoice.state', 'booksInvoice.summary', 'booksInvoice.rounded', 'booksInvoice.notes'] as const)
      for (const l of LOCALES) { expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]); }
  });
});
