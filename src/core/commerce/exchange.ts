import { type Result, ok, err } from '../types/result.js';
import { type Currency, type Money, roundMoney } from '../types/money.js';

/**
 * M43b — the rate SHE stated, or nothing.
 *
 * A buyer pays dollars. A Yiwu factory owner thinks, costs and worries in ￥.
 * The moment those two meet, something has to convert — and the obvious way to
 * do it is to fetch today's rate, which is precisely the thing this product
 * exists not to do.
 *
 * A LIVE RATE IS A NUMBER FROM OUTSIDE HER RULES. It is not wrong in the way a
 * hallucinated price is wrong; it is worse, because it is accurate. It moves
 * while she sleeps, it is right to four decimal places, and it turns a figure
 * she once agreed to into one she never saw. Every other number this product
 * says can be traced to a row she wrote. A rate must be no different.
 *
 * So: she states the rate she will honour, with the date she set it. Nomi
 * converts at that rate, or REFUSES and says which pair is missing. There is no
 * fallback, no default, no "approximately", no cached last-known value.
 *
 * ── STALENESS IS NOT A REFUSAL ────────────────────────────────────────────
 *
 * A rate she set eight months ago is a real risk, and it is still HER rate. To
 * refuse it, this module would have to invent a number — thirty days? ninety? —
 * and an invented threshold is the same defect as an invented price wearing a
 * responsible-looking hat. So the DATE travels with every converted figure and
 * is shown wherever the figure is, and she decides it is old. That is the same
 * division of labour as everywhere else here: the product states facts, the
 * owner makes judgements.
 *
 * Pure per ADR-0002. Loading her rates is the caller's job.
 */

/** A rate the owner stated, with the day she stated it. */
export type OwnerRate = {
  readonly from: Currency;
  readonly to: Currency;
  /** How many units of `to` she will honour for one unit of `from`. */
  readonly rate: number;
  readonly statedAt: Date;
};

export type RateRefusal = {
  readonly kind: 'no_rate_stated';
  readonly from: Currency;
  readonly to: Currency;
};

/** The converted amount, and the rate it went through — never one without the other. */
export type Converted = {
  readonly money: Money;
  readonly rate: OwnerRate;
};

/**
 * The rate she stated for this pair, or null.
 *
 * The most recently stated wins: rates are kept as history (archive never
 * erase), and "what she will honour" is the last thing she said, not the first.
 * A pair she never stated is null — deliberately not the inverse of the other
 * direction, because 1/6.9 is arithmetic SHE did not do and a rate she did not
 * agree to. If she wants CNY→USD she states CNY→USD.
 */
export function rateFor(
  rates: readonly OwnerRate[], from: Currency, to: Currency,
): OwnerRate | null {
  const matches = rates.filter((r) => r.from === from && r.to === to);
  if (matches.length === 0) return null;
  return matches.reduce((newest, r) => (r.statedAt.getTime() > newest.statedAt.getTime() ? r : newest));
}

/**
 * Convert, or refuse.
 *
 * Converting money to its own currency is the identity and needs no rate — that
 * is not a conversion, it is the same figure. Everything else needs a row.
 */
export function convertMoney(
  money: Money, to: Currency, rates: readonly OwnerRate[],
): Result<Converted, RateRefusal> {
  if (money.currency === to) {
    return ok({
      money,
      rate: { from: to, to, rate: 1, statedAt: new Date(0) },
    });
  }
  const rate = rateFor(rates, money.currency, to);
  if (!rate) return err({ kind: 'no_rate_stated', from: money.currency, to });
  return ok({ money: roundMoney({ amount: money.amount * rate.rate, currency: to }), rate });
}

export type RateError = 'missing' | 'not_a_number' | 'not_positive' | 'same_currency';

/**
 * Validate what she typed into the box.
 *
 * No plausibility band. A rate of 0.0001 or 900 looks absurd, and refusing it
 * would mean this module holding an opinion about what the yuan is worth —
 * which is exactly the outside knowledge it exists to keep out. Positive and
 * finite is the whole rule; the number is hers.
 */
export function validateRate(input: {
  readonly from: Currency;
  readonly to: Currency;
  readonly rate: string | number | null | undefined;
  readonly now: Date;
}): Result<OwnerRate, RateError> {
  if (input.from === input.to) return err('same_currency');
  if (input.rate === null || input.rate === undefined) return err('missing');
  const raw = typeof input.rate === 'number' ? String(input.rate) : input.rate.trim();
  if (raw === '') return err('missing');
  const n = Number(raw);
  if (!Number.isFinite(n)) return err('not_a_number');
  if (!(n > 0)) return err('not_positive');
  return ok({ from: input.from, to: input.to, rate: Number(n.toFixed(6)), statedAt: input.now });
}
