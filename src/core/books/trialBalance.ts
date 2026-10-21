import { addDecimal, signOf, subDecimal, type Decimal } from '../types/decimal.js';

/**
 * D1 (Phase 5, item 1) — THE TRIAL BALANCE, from what is posted, in the books' currency (each line's amount as it
 * was turned at posting, A3: never re-rated).
 *
 * For a period [from, to], each account: what it opened with, what moved in the period, what it closed with.
 *   · an account of the balance sheet (asset, liability, equity, off-balance) opens with everything posted before
 *     `from`;
 *   · an account of the result (income, expense) opens with what was posted since the start of the fiscal year
 *     holding `from` — a result belongs to its year;
 *   · what earlier years' results came to, while no closing entry has carried it to equity (D2), is ONE line of its
 *     own: the result of earlier years, not closed yet. Without it, the opening columns could not balance; with it
 *     they always do, and once D2 closes a year it is zero.
 * A balance is shown on the side it falls (a debit balance as a debit), never as a negative figure.
 */
export type AccountKind = 'asset' | 'liability' | 'equity' | 'income' | 'expense' | 'off_balance';
export type AccountSums = {
  readonly code: string; readonly name: string; readonly kind: AccountKind;
  /** Debits less credits posted before the period's opening point for this kind of account (see above). */
  readonly opening: Decimal;
  readonly periodDebit: Decimal; readonly periodCredit: Decimal;
};
export type Sides = { readonly debit: Decimal; readonly credit: Decimal };
export type TrialRow = {
  readonly code: string | null; readonly name: string | null; readonly kind: AccountKind | 'earlier_result';
  readonly opening: Sides; readonly period: Sides; readonly closing: Sides;
};
export type TrialBalance = {
  readonly rows: readonly TrialRow[];
  readonly totals: { readonly opening: Sides; readonly period: Sides; readonly closing: Sides };
  /** Each column pair equal: the books balance. Should never be false — and is said, by how much, if it ever is. */
  readonly balanced: boolean;
  readonly difference: { readonly opening: Decimal; readonly period: Decimal; readonly closing: Decimal };
};

const ZERO = '0' as Decimal;
const neg = (a: Decimal): Decimal => subDecimal(ZERO, a);
/** A net figure (debits less credits) on the side it falls. */
export const sidesOf = (net: Decimal): Sides => (signOf(net) >= 0 ? { debit: net, credit: ZERO } : { debit: ZERO, credit: neg(net) });
const plus = (a: Sides, b: Sides): Sides => ({ debit: addDecimal(a.debit, b.debit), credit: addDecimal(a.credit, b.credit) });
const isZero = (s: Sides) => signOf(s.debit) === 0 && signOf(s.credit) === 0;

export function trialBalance(accounts: readonly AccountSums[], earlierResult: Decimal): TrialBalance {
  const rows: TrialRow[] = [];
  for (const a of [...accounts].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    const net = subDecimal(a.periodDebit, a.periodCredit);
    const row: TrialRow = { code: a.code, name: a.name, kind: a.kind, opening: sidesOf(a.opening),
      period: { debit: a.periodDebit, credit: a.periodCredit }, closing: sidesOf(addDecimal(a.opening, net)) };
    if (!(isZero(row.opening) && isZero(row.period))) rows.push(row);
  }
  if (signOf(earlierResult) !== 0) {
    rows.push({ code: null, name: null, kind: 'earlier_result', opening: sidesOf(earlierResult), period: { debit: ZERO, credit: ZERO }, closing: sidesOf(earlierResult) });
  }
  const zero: Sides = { debit: ZERO, credit: ZERO };
  const totals = rows.reduce((t, r) => ({ opening: plus(t.opening, r.opening), period: plus(t.period, r.period), closing: plus(t.closing, r.closing) }),
    { opening: zero, period: zero, closing: zero });
  const difference = { opening: subDecimal(totals.opening.debit, totals.opening.credit), period: subDecimal(totals.period.debit, totals.period.credit),
    closing: subDecimal(totals.closing.debit, totals.closing.credit) };
  return { rows, totals, difference,
    balanced: signOf(difference.opening) === 0 && signOf(difference.period) === 0 && signOf(difference.closing) === 0 };
}
