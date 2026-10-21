import { describe, it, expect } from 'vitest';
import { trialBalance, sidesOf } from '../../src/core/books/trialBalance.js';
import type { Decimal } from '../../src/core/types/decimal.js';

/** D1 (Phase 5, item 1) — the trial balance's arithmetic, from sums worked by hand. */
const d = (s: string) => s as Decimal;

describe('D1 · the trial balance, from its sums', () => {
  it('a balance is shown on the side it falls, never negative', () => {
    expect(sidesOf(d('12.5'))).toEqual({ debit: '12.5', credit: '0' });
    expect(sidesOf(d('-12.5'))).toEqual({ debit: '0', credit: '12.5' });
  });

  it('opening, period and closing per account; the earlier years\' result its own line; every column pair equal', () => {
    const tb = trialBalance([
      { code: '7111', name: 'Ventes', kind: 'income', opening: d('-800.5'), periodDebit: d('300'), periodCredit: d('300') },
      { code: '5141', name: 'Banque', kind: 'asset', opening: d('10000'), periodDebit: d('1200'), periodCredit: d('997.65') },
      { code: '1111', name: 'Capital', kind: 'equity', opening: d('-10000'), periodDebit: d('0'), periodCredit: d('0') },
      { code: '4411', name: 'Fournisseurs', kind: 'liability', opening: d('-450.25'), periodDebit: d('0'), periodCredit: d('0') },
      { code: '3421', name: 'Clients', kind: 'asset', opening: d('2000.5'), periodDebit: d('300'), periodCredit: d('1500') },
      { code: '6111', name: 'Achats', kind: 'expense', opening: d('0'), periodDebit: d('997.65'), periodCredit: d('0') },
      { code: '6331', name: 'Pertes de change', kind: 'expense', opening: d('0'), periodDebit: d('0'), periodCredit: d('0') },   // nothing: no row
    ], d('-749.75'));
    expect(tb.rows.map((r) => [r.code, r.closing.debit, r.closing.credit])).toEqual([
      ['1111', '0', '10000'], ['3421', '800.5', '0'], ['4411', '0', '450.25'], ['5141', '10202.35', '0'],
      ['6111', '997.65', '0'], ['7111', '0', '800.5'], [null, '0', '749.75']]);
    expect(tb.totals).toEqual({ opening: { debit: '12000.5', credit: '12000.5' }, period: { debit: '2797.65', credit: '2797.65' },
      closing: { debit: '12000.5', credit: '12000.5' } });
    expect(tb.balanced).toBe(true);
  });

  it('if the sums ever disagree, it says so, and by how much in each column', () => {
    const tb = trialBalance([{ code: '5141', name: 'Banque', kind: 'asset', opening: d('0'), periodDebit: d('10'), periodCredit: d('9.99') }], d('0'));
    expect([tb.balanced, tb.difference.period, tb.difference.closing]).toEqual([false, '0.01', '0.01']);
  });
});
