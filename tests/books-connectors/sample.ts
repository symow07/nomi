import type { Decimal } from '../../src/core/types/decimal.js';
import type { BooksData } from '../../src/core/books/interchange.js';

const d = (s: string) => s as Decimal;

/**
 * Books with a record of every kind, kept in MAD: a sale with VAT, a supplier bill, and a USD receipt whose MAD
 * remainder is its own exchange-difference line (A3) — the case a per-currency check gets wrong.
 */
export const SAMPLE_BOOKS: BooksData = {
  accounts: [
    { code: '3421', name: 'Clients', kind: 'asset', parent: null },
    { code: '4411', name: 'Fournisseurs', kind: 'liability', parent: null },
    { code: '4455', name: 'État, TVA facturée', kind: 'liability', parent: null },
    { code: '5141', name: 'Banque', kind: 'asset', parent: null },
    { code: '6111', name: 'Achats de marchandises', kind: 'expense', parent: null },
    { code: '6331', name: 'Pertes de change', kind: 'expense', parent: null },
    { code: '7111', name: 'Ventes de marchandises', kind: 'income', parent: null },
    { code: '71111', name: 'Ventes — export', kind: 'income', parent: '7111' },
  ],
  journals: [
    { code: 'VE', name: 'Ventes', kind: 'sales' },
    { code: 'AC', name: 'Achats', kind: 'purchases' },
    { code: 'BQ', name: 'Banque', kind: 'bank' },
  ],
  parties: [
    { code: 'C001', name: 'Atlas Textiles SARL', kind: 'customer', country: 'MA', ice: '001234567000089', taxNumber: null },
    { code: 'F001', name: 'Rif Coton', kind: 'supplier', country: 'MA', ice: null, taxNumber: '40123456' },
    { code: 'C002', name: 'Hamburg Taschen GmbH', kind: 'customer', country: 'DE', ice: null, taxNumber: 'DE811234567' },
  ],
  taxCodes: [
    { code: 'TVA20', label: 'TVA 20 %', rate: d('20'), kind: 'collected', account: '4455', validFrom: '2026-01-01', validTo: null },
  ],
  entries: [
    { key: 'VE-2026-1', journal: 'VE', date: '2026-04-02', label: 'Facture F-2026-0042', documentRef: 'F-2026-0042', documentDate: '2026-04-02', state: 'posted',
      lines: [
        { account: '3421', party: 'C001', taxCode: null, currency: 'MAD', debit: d('1440.6'), credit: null, label: null },
        { account: '7111', party: null, taxCode: 'TVA20', currency: 'MAD', debit: null, credit: d('1200.5'), label: 'Sacs en toile' },
        { account: '4455', party: null, taxCode: null, currency: 'MAD', debit: null, credit: d('240.1'), label: null },
      ] },
    { key: 'row-17', journal: 'AC', date: '2026-04-05', label: 'Bon de livraison 311', documentRef: 'BL-311', documentDate: null, state: 'draft',
      lines: [
        { account: '6111', party: null, taxCode: null, currency: 'MAD', debit: d('380'), credit: null, label: null },
        { account: '4411', party: 'F001', taxCode: null, currency: 'MAD', debit: null, credit: d('380'), label: null },
      ] },
    { key: 'BQ-2026-3', journal: 'BQ', date: '2026-04-09', label: 'Virement Hamburg Taschen', documentRef: 'SWIFT-0409', documentDate: '2026-04-09', state: 'posted',
      lines: [
        { account: '5141', party: null, taxCode: null, currency: 'USD', debit: d('33.33'), credit: null, label: null },
        { account: '5141', party: null, taxCode: null, currency: 'USD', debit: d('33.33'), credit: null, label: null },
        { account: '5141', party: null, taxCode: null, currency: 'USD', debit: d('33.34'), credit: null, label: null },
        { account: '71111', party: 'C002', taxCode: null, currency: 'USD', debit: null, credit: d('100'), label: null },
        { account: '6331', party: null, taxCode: null, currency: 'MAD', debit: null, credit: d('0.01'), label: 'Différence de change' },
      ] },
  ],
};
