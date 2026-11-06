import { describe, it, expect } from 'vitest';
import { renderBank, renderInvoice, type PaymentChoices } from '../../src/api/web/booksInvoices.js';
import { orderConfirmedReply } from '../../src/core/conversation/templates.js';
import { FIXED_LANGUAGES } from '../../src/core/conversation/gateLanguage.js';
import { holdsMoney } from '../../src/core/books/moneyAccounts.js';
import type { InvoiceView } from '../../src/db/booksInvoices.js';

/**
 * The Books audit's first two findings (2026-11-05). Recording a payment with the form as drawn posted the money to
 * the chart's first asset account, a fixed asset, and marked the invoice Paid. And every confirmed order told the
 * customer an invoice was coming, when nothing in the product can send one. Over Postgres, with the real Moroccan
 * chart: tests/integration/books-payment-accounts.test.ts.
 */
const owner = { isOwner: true } as Parameters<typeof renderInvoice>[1];
const invoice = (o: Readonly<Record<string, string>>): InvoiceView => ({
  id: '00000000-0000-4000-8000-000000000001', key: 'F-2026-0001', party: 'Atlas', status: 'open', issueDate: '2026-10-10', dueDate: null,
  label: null, currency: 'MAD', total: '100', credited: '0', paid: '0', lines: [], payments: [], creditNotes: [], entryId: null,
  billedTo: { code: 'C001', name: 'Atlas', address: null, country: null, ice: null, taxNumber: null, asIssued: true, registry: null, siret: null, registro: null }, ...o,
} as unknown as InvoiceView);
const choices: PaymentChoices = {
  journals: [{ id: 'j1', code: 'BQ', name: 'Banque' }],
  accounts: [{ id: 'a1', code: '5141', name: 'Banques' }, { id: 'a2', code: '51611', name: 'Caisse centrale' }],
};
const accountSelect = (html: string) => /<select name="account" required>(.*?)<\/select>/s.exec(html)?.[1] ?? '';

describe('the account a payment lands in', () => {
  it('a bank or cash account is recognised by its CGNC code or by its name, and nothing else is', () => {
    for (const [code, name] of [
      ['5141', 'Banques (soldes débiteurs)'], ['5146', 'Chèques postaux'], ['5148', 'Autres établissements financiers'],
      ['51611', 'Caisse centrale'], ['5165', 'Régies d\'avances et accréditifs'],
      ['1000', 'Barclays Bank'], ['1010', 'Petty cash'], ['512', 'Banque Populaire'], ['530', 'Caisse'],
      ['572', 'Banco Santander'], ['570', 'Caja'], ['1.1', 'Caixa'], ['1200', 'Kasse'],
      ['1002', '银行存款'], ['1001', '库存现金'], ['1100', 'البنك الأهلي'], ['1110', 'صندوق المحل'],
    ] as const) expect(holdsMoney(code, name), `${code} ${name}`).toBe(true);
    for (const [code, name] of [
      ['21', 'IMMOBILISATION EN NON-VALEURS'], ['2111', 'Frais de constitution'], ['3421', 'Clients'], ['3111', 'Marchandises'],
      ['5111', 'Chèques à encaisser ou à l\'encaissement'], ['5115', 'Virements de fonds'], ['1500', 'Stock'], ['1600', 'Equipment'],
      ['1700', 'Riverbank premises'], ['1800', 'Cashmere stock'], ['1900', 'Bankruptcy claims'], ['1950', 'Encaissements à recevoir'], ['35061', 'Bons de caisse'],
    ] as const) expect(holdsMoney(code, name), `${code} ${name}`).toBe(false);
  });

  it('the payment form preselects no account, and lists only what it was given', () => {
    const html = renderInvoice('en', owner, invoice({}), choices, '2026-11-05');
    const options = [...accountSelect(html).matchAll(/<option value="([^"]*)"( selected)?>/g)];
    expect(options.map((m) => m[1])).toEqual(['', 'a1', 'a2']);
    expect(options[0]![2]).toBe(' selected');
    expect(options.slice(1).every((m) => !m[2])).toBe(true);
  });

  it('so does the refund form', () => {
    const html = renderInvoice('en', owner, invoice({ total: '100', credited: '100', paid: '100' }), choices, '2026-11-05');
    expect(html).toContain('/refunds"');
    expect([...accountSelect(html).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', 'a1', 'a2']);
  });

  it('Block 1 #2 · the Bank page: the same accounts, none opened for her, a choice asked; with none in the chart it says so', () => {
    const bank = (accounts: PaymentChoices['accounts'], accountId: string | null = null) =>
      renderBank('en', owner, { accounts, accountId, open: [], matched: [] });
    const html = bank(choices.accounts);
    const options = [...html.matchAll(/<option value="([^"]*)"( selected)?>/g)];
    expect(options.map((m) => m[1])).toEqual(['', 'a1', 'a2']);
    expect(options[0]![2]).toBe(' selected');
    expect(html).not.toContain('id="bank-open"');
    expect(bank(choices.accounts, 'a1')).toContain('id="bank-open"');
    const none = bank([]);
    expect(none).toContain('no bank or cash account');
    expect(none).toContain('href="/app/books#workbook"');
    expect(none).not.toContain('name="account"');
  });

  it('with no bank or cash account in the chart, it says so and draws no form', () => {
    for (const v of [invoice({}), invoice({ total: '100', credited: '100', paid: '100' })]) {
      const html = renderInvoice('en', owner, v, { ...choices, accounts: [] }, '2026-11-05');
      expect(html).toContain('no bank or cash account');
      expect(html).toContain('href="/app/books#workbook"');
      expect(html).not.toContain('name="account"');
    }
  });
});

describe('a confirmed order promises only what happened', () => {
  const said = (language: (typeof FIXED_LANGUAGES)[number]) =>
    orderConfirmedReply({ orderReference: 'NM-1042', productName: 'Serum', quantity: 2, unit: 'pcs', language });

  it.each([...FIXED_LANGUAGES])('%s: no invoice is promised, and the order is still named', (language) => {
    expect(said(language)).not.toMatch(/invoice|发票|الفاتورة|factura|facture|fatura/iu);
    expect(said(language)).toContain('NM-1042');
    expect(said(language)).toContain('Serum');
  });
});
