import { type Money, type Currency } from '../types/money.js';

/**
 * The currency the owner's boxes are denominated in.
 *
 * ONE, today, and named rather than assumed: when a tenant can choose, this is
 * the line that becomes a lookup — and every caller already passes through it.
 */
const TENANT_CURRENCY: Currency = 'USD';

/**
 * M29 — the owner's own price rules. PURE: validation and nothing else.
 *
 * These are the three answers `quote.ts` has always clamped against, and which
 * until now nobody ever supplied. The importer wrote `floor = list price,
 * maxDiscount = 0, askAbove = 0` for every product it touched, which is not a
 * conservative default — it is a fabricated one. It says the owner will never
 * go a cent below list and has granted no authority at all, and she said
 * neither. A quote clamped against an invented floor is not "within the owner's
 * own price rules"; it is within ours.
 *
 * THE THREE QUESTIONS, in the order an owner can actually answer them
 * (docs/GTM-READINESS.md §2, stage S2 — six questions, not a form):
 *
 *   floor          "What is the least you would ever accept for one of these?"
 *   maxDiscountPct "How much can she take off without asking you?"
 *   askAbovePct    "Above how much off do you want to be asked first?"
 *
 * NOT ANSWERED IS A STATE. There is no default for any of them. `pricing_policy`
 * has all three columns NOT NULL, so the absence of a row is the only honest
 * representation of "she has not told us yet" — and absence is what the quote
 * engine already treats as "no floor to clamp against", which is why an
 * unanswered product must not be sellable.
 *
 * `src/core/commerce/quote.ts` is untouched. Its clamping is correct and tested;
 * the defect was only ever that nothing real fed it.
 */

export type PriceRules = {
  /**
   * The least the owner would ever accept, per unit.
   *
   * M43a — a Money, not a number: the floor is the one figure in this product
   * that a wrong currency would turn into a loss rather than an error, because
   * it is the guard the quote engine clamps against.
   */
  readonly floor: Money;
  /** How much she may take off on her own, as a percentage. */
  readonly maxDiscountPct: number;
  /** Above this percentage off, the owner is asked first. */
  readonly askAbovePct: number;
};

export type PriceRuleField = 'floor' | 'maxDiscountPct' | 'askAbovePct';

export type PriceRuleError =
  | 'missing'
  | 'not_a_number'
  | 'floor_not_positive'
  | 'pct_out_of_range'
  | 'ask_above_max'
  | 'floor_above_list';

export type PriceRulesInput = {
  /** Raw, as she typed it into the box. */
  readonly floor: string | number | null | undefined;
  readonly maxDiscountPct: string | number | null | undefined;
  readonly askAbovePct: string | number | null | undefined;
  /** The product's current list price, when there is one. Enables the
   *  floor-above-list check, which is the mistake that silently stops her
   *  quoting at all. */
  readonly listPrice?: Money | null;
};

export type PriceRulesResult =
  | { readonly ok: true; readonly value: PriceRules }
  | { readonly ok: false; readonly errors: Partial<Record<PriceRuleField, PriceRuleError>> };

/** Money to 4dp and percentages to 2dp — the precision the columns actually hold. */
const round = (n: number, dp: number): number => Number(n.toFixed(dp));

function num(raw: string | number | null | undefined): number | 'missing' | 'not_a_number' {
  if (raw === null || raw === undefined) return 'missing';
  const s = typeof raw === 'number' ? String(raw) : raw.trim();
  if (s === '') return 'missing';
  const n = Number(s);
  return Number.isFinite(n) ? n : 'not_a_number';
}

/**
 * Validate all three together, because two of them only make sense against each
 * other. Errors are returned per field so the form can re-render exactly what
 * she typed with the problem beside the box (the M20.4 F-07 rule: a rejected
 * submission never loses her work).
 */
export function validatePriceRules(input: PriceRulesInput): PriceRulesResult {
  const errors: Partial<Record<PriceRuleField, PriceRuleError>> = {};

  const floor = num(input.floor);
  const max = num(input.maxDiscountPct);
  const ask = num(input.askAbovePct);

  if (typeof floor === 'string') errors.floor = floor;
  else if (!(floor > 0)) errors.floor = 'floor_not_positive';

  for (const [field, v] of [['maxDiscountPct', max], ['askAbovePct', ask]] as const) {
    if (typeof v === 'string') errors[field] = v;
    else if (!(v >= 0 && v <= 100)) errors[field] = 'pct_out_of_range';
  }

  if (errors.maxDiscountPct === undefined && errors.askAbovePct === undefined
      && typeof max === 'number' && typeof ask === 'number' && ask > max) {
    // "Ask me above 10% off" while she may only ever give 7% describes a
    // question that can never be asked. This ordering is not pedantry: a test
    // fixture in M20.5 carried maxDiscount 5 / askAbove 10, the inverted
    // sentence it produced read perfectly plausibly, and it shipped green.
    errors.askAbovePct = 'ask_above_max';
  }

  if (errors.floor === undefined && typeof floor === 'number'
      && input.listPrice != null && floor > input.listPrice.amount) {
    // The quote engine refuses `below_floor` rather than quoting at a loss, so a
    // floor above the list price means she silently cannot quote this product at
    // all. M20.5's factory rehearsal surfaces it after the fact; catching it here
    // means the owner never creates it.
    errors.floor = 'floor_above_list';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      // She typed a number into a box that is denominated in the tenant's
      // currency; the pair is assembled HERE, once, rather than by whichever
      // caller happens to write the row.
      floor: { amount: round(floor as number, 4), currency: TENANT_CURRENCY },
      maxDiscountPct: round(max as number, 2),
      askAbovePct: round(ask as number, 2),
    },
  };
}

/**
 * What changed, old → new, for the audit trail. Empty means the owner submitted
 * the same answers again, which is not an edit and should not read as one.
 */
export function priceRuleChanges(
  before: PriceRules | null, after: PriceRules,
): Partial<Record<PriceRuleField, { readonly from: number | null; readonly to: number }>> {
  const out: Partial<Record<PriceRuleField, { from: number | null; to: number }>> = {};
  // The audit records amounts, because that is what changed: the currency of a
  // tenant does not move, and a row that did change currency would be a
  // different fact needing its own entry rather than a from/to on this one.
  if ((before ? before.floor.amount : null) !== after.floor.amount) {
    out.floor = { from: before ? before.floor.amount : null, to: after.floor.amount };
  }
  for (const f of ['maxDiscountPct', 'askAbovePct'] as const) {
    const from = before ? before[f] : null;
    if (from !== after[f]) out[f] = { from, to: after[f] };
  }
  return out;
}
