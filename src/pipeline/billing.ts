import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import type { NotifyJob } from '../queue/boss.js';
import type { StripeClient, StripeEvent } from '../billing/stripe.js';
import { statusFromStripe, trialEndFrom } from '../core/billing/status.js';
import {
  businessForCustomer, markCardSaved, recordSubscription, recordPaymentFailed, workspacesToSubscribe,
  recordSubscribed, claimBillingAlerts,
} from '../db/billing.js';

/**
 * BILL (0117) — STRIPE'S WORD, AND WHAT FOLLOWS FROM IT.
 *
 * A verified webhook event is applied here; its id is recorded only after it
 * was applied, so an event that failed half-way is applied again when Stripe
 * retries it, and a duplicate of one applied is skipped. Every write is
 * idempotent, and a subscription event older than the last one applied changes
 * nothing (Stripe does not promise order).
 */
export type EventOutcome = 'applied' | 'duplicate' | 'ignored' | 'retry';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const at = (v: unknown): Date | null => (typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000) : null);

export async function handleStripeEvent(db: Db, stripe: StripeClient, e: StripeEvent): Promise<EventOutcome> {
  const known = (await sql<{ n: boolean }>`select stripe_event_seen(${e.id}) as n`.execute(db)).rows[0]?.n === true;
  if (known) return 'duplicate';
  const o = e.object;
  const customer = str(o['customer']);
  const business = customer ? await businessForCustomer(db, customer) : null;
  let outcome: EventOutcome = 'ignored';

  if (e.type === 'checkout.session.completed' && o['mode'] === 'setup' && customer && business) {
    // The card the owner saved on Stripe's page: made the customer's default, then noted.
    const meta = (o['metadata'] as Record<string, unknown> | null | undefined) ?? {};
    if (meta['business_id'] !== business) return 'ignored';
    const intent = str(o['setup_intent']);
    if (!intent) return 'ignored';
    const pm = await stripe.setupIntentPaymentMethod(intent);
    if (!pm.ok) return pm.retryable ? 'retry' : 'ignored';
    const made = await stripe.setDefaultPaymentMethod(customer, pm.value.paymentMethod);
    if (!made.ok) return made.retryable ? 'retry' : 'ignored';
    await markCardSaved(db, business, customer);
    outcome = 'applied';
  } else if (e.type.startsWith('customer.subscription.') && customer && business) {
    const items = (o['items'] as { data?: { price?: { id?: unknown } }[] } | undefined)?.data ?? [];
    await recordSubscription(db, {
      customerId: customer, subscriptionId: str(o['id']) ?? '',
      status: e.type === 'customer.subscription.deleted' ? 'lapsed' : statusFromStripe(str(o['status']) ?? ''),
      periodEnd: at(o['current_period_end']), trialEnd: at(o['trial_end']), priceId: str(items[0]?.price?.id) ?? null,
      eventAt: new Date(e.created * 1000),
    });
    outcome = 'applied';
  } else if (e.type === 'invoice.payment_failed' && customer && business) {
    await recordPaymentFailed(db, customer);
    outcome = 'applied';
  }
  await sql`select claim_stripe_event(${e.id}, ${e.type}, ${business}::uuid)`.execute(db);
  return outcome;
}

/**
 * Every five minutes: a workspace with a card saved, a plan chosen and a
 * channel connected, and no subscription yet, gets one — its trial ending the
 * days granted after the FIRST channel connected (the owner's instruction:
 * the clock starts there). A trial already over by then: none, charged now.
 * A Stripe that does not answer is asked again next time.
 */
export async function subscribeSweep(db: Db, stripe: StripeClient, now: Date): Promise<number> {
  let made = 0;
  for (const w of await workspacesToSubscribe(db)) {
    const trialEnd = trialEndFrom(w.firstChannelAt, w.trialDays, now);
    const r = await stripe.createSubscription({
      customerId: w.customerId, priceId: w.priceId, businessId: w.businessId,
      trialEnd: trialEnd ? Math.floor(trialEnd.getTime() / 1000) : null,
    });
    if (!r.ok) { console.warn(`[billing] subscription for ${w.businessId} not made: ${r.error}`); continue; }
    await recordSubscribed(db, {
      businessId: w.businessId, subscriptionId: r.value.id, status: statusFromStripe(r.value.status),
      trialStartedAt: w.firstChannelAt, trialEnd: r.value.trialEnd ? new Date(r.value.trialEnd * 1000) : trialEnd,
      periodEnd: r.value.currentPeriodEnd ? new Date(r.value.currentPeriodEnd * 1000) : null,
    });
    made++;
  }
  return made;
}

/** The owner's billing e-mails, each once (`claim_billing_alerts()`). */
export async function billingAlerts(db: Db): Promise<NotifyJob[]> {
  return (await claimBillingAlerts(db)).map((a) => ({
    businessId: a.businessId, kind: a.kind, conversationId: null, ...(a.at ? { billingAt: a.at.toISOString() } : {}),
  }));
}
