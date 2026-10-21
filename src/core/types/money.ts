/**
 * M43a — money is a pair.
 *
 * Every price in this product was a bare `number` named `somethingUsd`, and the
 * currency lived in the identifier. That works exactly as long as there is one
 * currency, and it fails silently on the day there are two: a number is a
 * number, so a euro price added to a dollar floor type-checks, computes, and
 * reaches a buyer as a quote. The name is a comment, and comments do not
 * participate in arithmetic.
 *
 * So the currency travels WITH the amount, and arithmetic that mixes two of
 * them cannot compile — or, where the compiler cannot see it, throws rather
 * than producing a plausible wrong number.
 *
 * ── THERE ARE TWO OF THEM NOW ──────────────────────────────────────────────
 *
 * M43a introduced this type while USD was the only member, and said so. M43b
 * added CNY, and the sentence stayed — which is how a comment becomes a lie
 * about the very thing it guards. `Currency` has two members: a conversion
 * between them exists only through `convertMoney`, and only against a rate the
 * OWNER stated, with the date she stated it. A live rate she did not approve is
 * a number from outside her rules, and this whole engine exists to stop those.
 *
 * Mixing remains unrepresentable rather than merely discouraged: `sameCurrency`
 * throws, and every read of a stored amount pairs it with its own stored
 * currency column (G18) instead of assuming the dollar it used to be.
 */

import {
  type Decimal, decimal, parseDecimal, storedDecimal, fromInteger, numeralOfDecimal, subDecimal, mulDecimal, divDecimal, compareDecimal, roundDecimal, signOf,
} from './decimal.js';

/**
 * The currencies this product can hold.
 *
 * Adding a member is not a type change — it is a promise that every conversion
 * has an owner-stated rate behind it and that every comparison in
 * `core/commerce` has been re-read. Do not add one to make a screen render.
 *
 * CNY joined in M43b, and the promise is kept there: `convertMoney` refuses
 * unless the owner has stated the rate herself, with the date she stated it.
 * A buyer pays dollars; a Yiwu factory owner thinks in ￥; nothing crosses
 * between them except through a number she wrote down.
 *
 * CUR (the owner's decision, 2026-09-30) — ONE CURRENCY PER WORKSPACE, with
 * no conversion: a shop in Dubai prices in dirhams, one in São Paulo in reais,
 * and every figure a customer reads is in that one currency. The first list
 * is the plan's (decision 19): USD, AED, SAR, BRL, MXN, INR, IDR, and CNY that
 * was already here. A1 (Phase 5, 0168) adds the Moroccan dirham, the euro and
 * the pound, for the books. A workspace that sells in two currencies waits for
 * CONV. The promise above is re-read for each: no
 * comparison in `core/commerce` ever crosses two of them (`sameCurrency`
 * throws), and the numeral guard refuses a figure written in another one.
 */
export type Currency = 'USD' | 'CNY' | 'AED' | 'SAR' | 'BRL' | 'MXN' | 'INR' | 'IDR' | 'MAD' | 'EUR' | 'GBP';

/**
 * An amount and the currency it is denominated in. Never one without the other.
 *
 * A1 (Phase 5, 2026-10-22) — the amount is an exact DECIMAL (text, see `decimal.ts`), never a floating-point number.
 * It was a `number`, and the quote engine discounted and rounded in floating point: $5.30 less 5% (exactly 5.035) was
 * quoted $5.03 — one discounted quote in 75 a cent too low (docs/PHASE-5.md §2.1). Every operation on an amount is
 * one of the functions below; a static test forbids arithmetic on `.amount` anywhere else.
 */
export type Money = {
  readonly amount: Decimal;
  readonly currency: Currency;
};

/** The common constructor, from decimal text ("2.40"). */
export const usd = (amount: string): Money => ({ amount: decimal(amount), currency: 'USD' });

/** Any currency, from decimal text. */
export const moneyOf = (amount: string, currency: Currency): Money => ({ amount: decimal(amount), currency });

export const CURRENCIES: readonly Currency[] = ['USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR', 'MAD', 'EUR', 'GBP'];

/**
 * A1 — each currency's minor unit, from ISO 4217 (the List One table, "Minor unit"): the number of decimals an
 * amount in it is rounded to. Two for every currency here — the rupiah included: ISO lists IDR with 2, though its
 * coins are long gone, and a price list may still write "Rp 15.000,00". A currency with 0 (JPY) or 3 (KWD) gets its
 * own figure the day it joins, and every rounding follows.
 */
export const MINOR_UNITS: Readonly<Record<Currency, number>> = {
  USD: 2, CNY: 2, AED: 2, SAR: 2, BRL: 2, MXN: 2, INR: 2, IDR: 2, MAD: 2, EUR: 2, GBP: 2,
};

/** A currency read from a row, checked. Unknown text is not silently accepted. */
export function parseCurrency(raw: string): Currency | null {
  return (CURRENCIES as readonly string[]).includes(raw) ? (raw as Currency) : null;
}

/**
 * Money from a database row: an amount plus whatever the currency column said.
 *
 * Returns null for an unrecognised currency rather than defaulting to USD.
 * Defaulting is how a euro row becomes a dollar quote — the caller must decide
 * what to do with a row it cannot price, and every caller here drops it.
 *
 * A1 — the amount is the row's own text: Postgres returns a `numeric` as exact text, and it stays exact. A number is
 * never accepted: a number here is one some code computed in floating point, which is the defect. An older JSON
 * payload's number goes through `storedDecimal` first, by name. Text that is not a decimal is a row that cannot be
 * priced, and is null like an unknown currency.
 */
export function moneyFromRow(amount: string, currency: string): Money | null {
  const c = parseCurrency(currency);
  const a = parseDecimal(amount);
  return c === null || a === null ? null : moneyOf(a, c);
}

/**
 * Money from a JSON payload written by this product (an event, a draft's note): the amount is text since A1 and a
 * number in a payload written before it — read from its shortest text, which is the figure that was written
 * (`storedDecimal`). Reading what was stored, never a number some code just computed.
 */
export function moneyFromStored(amount: string | number, currency: string): Money | null {
  const a = storedDecimal(amount);
  return a === null ? null : moneyFromRow(a, currency);
}

/**
 * Two amounts in the same currency, or a thrown invariant.
 *
 * NOT a Result. A currency mismatch is not a business refusal the owner could
 * resolve — it means two rows that were never comparable were compared, which
 * is a defect in this repository. It is unreachable while `Currency` has one
 * member; it exists so that the day it has two, the failure is loud at the
 * point of the mistake instead of quiet at the point of the quote.
 */
function sameCurrency(a: Money, b: Money): Currency {
  if (a.currency !== b.currency) {
    throw new Error(`money: ${a.currency} and ${b.currency} are not comparable`);
  }
  return a.currency;
}

/**
 * Subtraction only, deliberately.
 *
 * `addMoney` was written here and then deleted: nothing in this product adds
 * two prices together — a total is a price SCALED by a quantity — and an unused
 * money helper is an invitation to reach for the wrong one. The symbol ratchet
 * caught it, which is what it is for.
 */
export const subMoney = (a: Money, b: Money): Money =>
  ({ amount: subDecimal(a.amount, b.amount), currency: sameCurrency(a, b) });

/** Money times an exact factor — a quantity (`fromInteger`) or a multiplier — never money. Exact; not rounded. */
export const scaleMoney = (m: Money, factor: Decimal): Money =>
  ({ amount: mulDecimal(m.amount, factor), currency: m.currency });

/** Money times a whole quantity. Exact; not rounded. */
export const timesQuantity = (m: Money, quantity: number): Money => scaleMoney(m, fromInteger(quantity));

/**
 * Money less a percentage (12.5 means 12.5%), exact. The percentage is a stored `numeric(5,2)`: at most two decimals,
 * read back exactly from its shortest text; anything finer is refused rather than guessed.
 */
export function lessPercent(m: Money, percent: number): Money {
  const pct = percentDecimal(percent);
  return scaleMoney(m, subDecimal(decimal('1'), divDecimal(pct, decimal('100'), 4)));
}

/** A percentage with at most two decimals, as an exact decimal. */
export function percentDecimal(percent: number): Decimal {
  const t = String(percent);
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) throw new Error(`money: ${t} is not a percentage with at most two decimals`);
  return decimal(t);
}

/** Negative when a is cheaper. Throws rather than ordering two currencies. */
export const compareMoney = (a: Money, b: Money): number =>
  (sameCurrency(a, b), compareDecimal(a.amount, b.amount));

export const isBelow = (a: Money, b: Money): boolean => compareMoney(a, b) < 0;
export const isAbove = (a: Money, b: Money): boolean => compareMoney(a, b) > 0;

/** Is the amount above zero? */
export const isPositive = (m: Money): boolean => signOf(m.amount) > 0;

/** Is the amount exactly zero (a sample given at no charge, say)? */
export const isZero = (m: Money): boolean => signOf(m.amount) === 0;

/**
 * The amount as a plain number, ONLY to match a figure written in text — the numeral guard compares the numbers a
 * reply contains with the ones it may contain. Never for arithmetic: that is what every other function here is for.
 */
export const numeralOf = (m: Money): number => numeralOfDecimal(m.amount);

/** Do two amounts differ by more than `tolerance` (same currency)? */
export const differsByMoreThan = (a: Money, b: Money, tolerance: Decimal): boolean => {
  const d = subDecimal(a.amount, b.amount);
  return compareDecimal(d, tolerance) > 0 || compareDecimal(d, subDecimal(decimal('0'), tolerance)) < 0;
};

/** Rounding, half away from zero, in the currency's own minor unit (ISO 4217, `MINOR_UNITS`). */
export const roundMoney = (m: Money, places = MINOR_UNITS[m.currency]): Money =>
  ({ amount: roundDecimal(m.amount, places), currency: m.currency });

/**
 * The symbol a reader sees. NOT a translation — $ is $ and ￥ is ￥ in all
 * three locales, because a currency sign is part of the number, not of the
 * language around it.
 *
 * CUR — a currency with no sign of its own is written with its code and a
 * space ("AED 120.00"); the peso is MX$ so that no page shows a bare $ that
 * could be read as dollars.
 */
const SYMBOL: Record<Currency, string> = {
  USD: '$', CNY: '￥', AED: 'AED ', SAR: 'SAR ', BRL: 'R$', MXN: 'MX$', INR: '₹', IDR: 'Rp ',
  // A1 — the dirham by its code ("DH" is also the UAE's, and "د.م." reads right to left inside a figure).
  MAD: 'MAD ', EUR: '€', GBP: '£',
};
export const currencySymbol = (c: Currency): string => SYMBOL[c];

/** Is the symbol the code itself ("AED ")? Then a sentence need not repeat the code after the figure. */
export const symbolIsCode = (c: Currency): boolean => SYMBOL[c].trim() === c;

/**
 * CUR — how the currency's own people write a figure: Brazil and Indonesia
 * group thousands with a dot and mark decimals with a comma ("R$ 1.250,50",
 * "Rp 150.000"); the others as in English. A1 (2026-10-22) — this is now read
 * ONLY by the reply guard, to accept a right figure written their way in a reply.
 * Nothing the owner types or imports takes its meaning from a separator
 * (commerce/amount.ts). Nothing is converted — this only
 * says how the SAME figure may be written.
 */
export const DOT_THOUSANDS: ReadonlySet<Currency> = new Set<Currency>(['BRL', 'IDR']);
