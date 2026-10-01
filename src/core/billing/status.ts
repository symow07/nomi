/**
 * BILL — where a workspace stands with its payment, in our words, decided
 * once. Pure.
 *
 *   none      nothing started: no subscription (a card may be saved)
 *   trial     the trial runs; nothing charged yet
 *   active    paid, renewing
 *   past_due  a payment failed; Stripe is still retrying — nothing is held,
 *             the owner is told
 *   lapsed    Stripe gave up, or the subscription ended: the assistant holds,
 *             as when the day's allowance is used, until a payment goes through
 */
export type BillingStatus = 'none' | 'trial' | 'active' | 'past_due' | 'lapsed';
export const BILLING_STATUSES: readonly BillingStatus[] = ['none', 'trial', 'active', 'past_due', 'lapsed'];

/** Stripe's subscription status, said in ours. An unknown one is treated as a payment in doubt, never as paid. */
export function statusFromStripe(stripeStatus: string): BillingStatus {
  switch (stripeStatus) {
    case 'trialing': return 'trial';
    case 'active': return 'active';
    case 'unpaid': case 'canceled': case 'incomplete_expired': case 'paused': return 'lapsed';
    default: return 'past_due';
  }
}

/**
 * The trial's last moment: the first channel connected plus the days granted.
 * Null without a trial, or when it would already be over — then the
 * subscription starts paid, at once.
 */
export function trialEndFrom(firstConnectedAt: Date, trialDays: number | null, now: Date): Date | null {
  if (!trialDays || trialDays < 1) return null;
  const end = new Date(firstConnectedAt.getTime() + trialDays * 86_400_000);
  return end.getTime() > now.getTime() + 60_000 ? end : null;
}

/** The price as the page says it, in the plan's own currency. */
export function priceText(locale: string, amountMinor: number, currency: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale, { style: 'currency', currency: currency.toUpperCase() })
    .format(amountMinor / 10 ** digits);
}
