/**
 * The refund terms (docs/PRE-LAUNCH.md item 5; the page is `renderRefunds` in api/web/legal.ts).
 *
 * The page describes MONTHLY subscriptions and nothing else, because Nomi sells nothing else. Every place that
 * offers a plan beside the page's link asks `coveredByRefundTerms` first, and a plan it does not describe is not
 * offered — the database refuses one too (0134 `plans_monthly_only`). Selling another period means writing its
 * terms first, then widening this list.
 */
export const REFUND_TERMS_COVER = ['month'] as const;

export type CoveredPeriod = (typeof REFUND_TERMS_COVER)[number];

export const coveredByRefundTerms = (period: string): period is CoveredPeriod =>
  (REFUND_TERMS_COVER as readonly string[]).includes(period);
