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
 * ── THIS MILESTONE CHANGES NO BEHAVIOUR ───────────────────────────────────
 *
 * USD is still the only currency. `Currency` is a union of ONE, deliberately:
 * every currency-mixing bug is unrepresentable today, and the type is the place
 * that stays honest when a second member is added. What changes now is only
 * where the currency is written down — in the value, not in the name.
 *
 * The rate at which a second currency becomes a first-class citizen is M43b's
 * problem, and it is a PRODUCT decision, not a type one: she states the rate
 * she will honour, or Nomi refuses. A live rate she did not approve is a number
 * from outside her rules, and this whole engine exists to stop those.
 */

/**
 * The currencies this product can hold. One member, today.
 *
 * Adding a member is not a type change — it is a promise that every conversion
 * has an owner-stated rate behind it (M43b) and that every comparison in
 * `core/commerce` has been re-read. Do not add one to make a screen render.
 */
export type Currency = 'USD';

/** An amount and the currency it is denominated in. Never one without the other. */
export type Money = {
  readonly amount: number;
  readonly currency: Currency;
};

/** The common constructor, and the only one most callers need. */
export const usd = (amount: number): Money => ({ amount, currency: 'USD' });

/** A currency read from a row, checked. Unknown text is not silently accepted. */
export function parseCurrency(raw: string): Currency | null {
  return raw === 'USD' ? 'USD' : null;
}

/**
 * Money from a database row: an amount plus whatever the currency column said.
 *
 * Returns null for an unrecognised currency rather than defaulting to USD.
 * Defaulting is how a euro row becomes a dollar quote — the caller must decide
 * what to do with a row it cannot price, and every caller here drops it.
 */
export function moneyFromRow(amount: number, currency: string): Money | null {
  const c = parseCurrency(currency);
  return c === null ? null : { amount, currency: c };
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
  ({ amount: a.amount - b.amount, currency: sameCurrency(a, b) });

/** Money times a plain number — a quantity or a multiplier, never money. */
export const scaleMoney = (m: Money, factor: number): Money =>
  ({ amount: m.amount * factor, currency: m.currency });

/** Negative when a is cheaper. Throws rather than ordering two currencies. */
export const compareMoney = (a: Money, b: Money): number =>
  (sameCurrency(a, b), a.amount - b.amount);

export const isBelow = (a: Money, b: Money): boolean => compareMoney(a, b) < 0;
export const isAbove = (a: Money, b: Money): boolean => compareMoney(a, b) > 0;

/** Rounding, in the currency's own minor unit. Two places for every currency here. */
export const roundMoney = (m: Money, places = 2): Money =>
  ({ amount: Number(m.amount.toFixed(places)), currency: m.currency });

/** The symbol a buyer reads. Not a translation — USD is $ in all three locales. */
const SYMBOL: Record<Currency, string> = { USD: '$' };
export const currencySymbol = (c: Currency): string => SYMBOL[c];
