import { type Decimal, addDecimal, divDecimal, roundDecimal, subDecimal, decimal, signOf } from '../types/decimal.js';

/**
 * SPENDING, THE PURE PARTS (Block 2 PR 3; 0227). A bill is one amount the owner typed, gross; its tax is split off by
 * the code's rate so the expense line carries the net and the deductible-tax line the rest, and the two add back to the
 * gross exactly (the tax is the difference, never a second rounding). A recurring cost runs on a calendar: every month,
 * quarter or year from a first day, the day of the month kept where the month has it and clamped where it does not
 * (the 31st in April is the 30th; the 29th of February in a year that has none is the 28th).
 */
export type Every = 'month' | 'quarter' | 'year';
export const EVERY: readonly Every[] = ['month', 'quarter', 'year'];
export const isEvery = (s: string | null | undefined): s is Every => s === 'month' || s === 'quarter' || s === 'year';

const MONTHS: Readonly<Record<Every, number>> = { month: 1, quarter: 3, year: 12 };
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;

/** A calendar day, `YYYY-MM-DD`, or null. */
export const dayOf = (s: string | null | undefined): string | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? s : null;
};

/** The day after `from` on which the cost falls due again: the same day of the month, `every` later, clamped. */
export function nextOn(from: string, every: Every): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const total = (y * 12 + (m - 1)) + MONTHS[every];
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const nd = Math.min(d, daysIn(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** The gross split into the expense's net and its tax, by a percentage; both two decimals, adding back to the gross. */
export function splitGross(gross: Decimal, ratePct: Decimal | null): { readonly net: Decimal; readonly tax: Decimal } {
  if (ratePct === null || signOf(ratePct) === 0) return { net: roundDecimal(gross, 2), tax: '0' as Decimal };
  const divisor = addDecimal(decimal('1'), divDecimal(ratePct, decimal('100'), 10));
  const net = roundDecimal(divDecimal(gross, divisor, 10), 2);
  return { net, tax: subDecimal(roundDecimal(gross, 2), net) };
}

