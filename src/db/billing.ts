import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BillingStatus } from '../core/billing/status.js';

/**
 * BILL (0117) — the app's side of billing. The tables are not the app's: it
 * reads its own row through definer functions, and every change goes through
 * one — the owner's choice of plan, the Stripe customer, and otherwise only
 * Stripe's own word (a verified webhook, the sweep's answer).
 *
 * Who is billed: a workspace that signed itself up and is not exempt. A
 * practice copy answers as its workspace; the pilots are never billed.
 */

export type BillingState = {
  readonly billed: boolean;
  readonly exempt: boolean;
  readonly planId: string | null;
  readonly status: BillingStatus;
  readonly cardSavedAt: Date | null;
  /** Granted by the operator, or the installation's own once trials are self-serve. */
  readonly trialDays: number | null;
  readonly trialStartedAt: Date | null;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly hasCustomer: boolean;
  readonly customersThisMonth: number;
  readonly firstChannelAt: Date | null;
};

export type Plan = {
  readonly id: string; readonly name: string; readonly amountMinor: number; readonly currency: string;
  readonly period: 'month' | 'year'; readonly customersAMonth: number;
  readonly seats: number | null; readonly assistants: number | null; readonly stripePriceId: string;
};

export async function billingState(tx: Tx): Promise<BillingState> {
  const r = (await sql<{
    billed: boolean; exempt: boolean; plan_id: string | null; status: BillingStatus; card_saved_at: Date | null;
    trial_days: number | null; trial_started_at: Date | null; trial_ends_at: Date | null; current_period_end: Date | null;
    has_customer: boolean; customers_this_month: number; first_channel_at: Date | null;
  }>`select * from billing_state()`.execute(tx)).rows[0];
  return {
    billed: r?.billed === true, exempt: r?.exempt === true, planId: r?.plan_id ?? null, status: r?.status ?? 'none',
    cardSavedAt: r?.card_saved_at ?? null, trialDays: r?.trial_days ?? null, trialStartedAt: r?.trial_started_at ?? null,
    trialEndsAt: r?.trial_ends_at ?? null, currentPeriodEnd: r?.current_period_end ?? null, hasCustomer: r?.has_customer === true,
    customersThisMonth: Number(r?.customers_this_month ?? 0), firstChannelAt: r?.first_channel_at ?? null,
  };
}

export async function plansOnOffer(tx: Tx): Promise<Plan[]> {
  return (await sql<{ id: string; name: string; amount_minor: number; currency: string; period: 'month' | 'year';
    customers_a_month: number; seats: number | null; assistants: number | null; stripe_price_id: string }>`
    select * from plans_on_offer()`.execute(tx)).rows.map((p) => ({
    id: p.id, name: p.name, amountMinor: p.amount_minor, currency: p.currency, period: p.period,
    customersAMonth: p.customers_a_month, seats: p.seats, assistants: p.assistants, stripePriceId: p.stripe_price_id,
  }));
}

/** The hold: the payment lapsed (never a pilot). */
export async function billingHeld(tx: Tx): Promise<boolean> {
  return (await sql<{ h: boolean }>`select billing_held() as h`.execute(tx)).rows[0]?.h === true;
}

/** A new customer this month, past what the plan allows. */
export async function planLimitReached(tx: Tx, conversationId: string): Promise<boolean> {
  return (await sql<{ r: boolean }>`select plan_limit_reached(${conversationId}::uuid) as r`.execute(tx)).rows[0]?.r === true;
}

/** Card upfront: the installation requires one, and this billed workspace has none saved. */
export async function cardNeeded(tx: Tx): Promise<boolean> {
  return (await sql<{ n: boolean }>`select billing_card_needed() as n`.execute(tx)).rows[0]?.n === true;
}

/** The seats and assistants the plan allows (null: no limit, or no plan). */
export async function planLimits(tx: Tx): Promise<{ readonly seats: number | null; readonly assistants: number | null }> {
  const r = (await sql<{ seats: number | null; assistants: number | null }>`select * from plan_limits()`.execute(tx)).rows[0];
  return { seats: r?.seats ?? null, assistants: r?.assistants ?? null };
}

export async function chooseBilling(tx: Tx, planId: string): Promise<'chosen' | 'no_plan' | 'not_billed'> {
  const r = (await sql<{ r: string }>`select billing_choose(${planId}) as r`.execute(tx)).rows[0]?.r;
  return r === 'chosen' || r === 'no_plan' ? r : 'not_billed';
}

export async function setStripeCustomer(tx: Tx, customerId: string): Promise<void> {
  await sql`select billing_set_customer(${customerId})`.execute(tx);
}

// ── Stripe's word: no tenant to bind, each a definer function ───────────────

export async function businessForCustomer(db: Db, customerId: string): Promise<string | null> {
  return (await sql<{ b: string | null }>`select billing_business_for_customer(${customerId})::text as b`.execute(db)).rows[0]?.b ?? null;
}

/** True the first time an event id is seen: Stripe's retries are handled once. */
export async function claimStripeEvent(db: Db, id: string, type: string, businessId: string | null): Promise<boolean> {
  return (await sql<{ c: boolean }>`select claim_stripe_event(${id}, ${type}, ${businessId}::uuid) as c`.execute(db)).rows[0]?.c === true;
}

export async function markCardSaved(db: Db, businessId: string, customerId: string): Promise<boolean> {
  return (await sql<{ ok: boolean }>`select billing_card_saved(${businessId}::uuid, ${customerId}) as ok`.execute(db)).rows[0]?.ok === true;
}

export async function recordSubscription(db: Db, s: {
  readonly customerId: string; readonly subscriptionId: string; readonly status: BillingStatus;
  readonly periodEnd: Date | null; readonly trialEnd: Date | null; readonly priceId: string | null;
}): Promise<string | null> {
  return (await sql<{ b: string | null }>`
    select billing_subscription(${s.customerId}, ${s.subscriptionId}, ${s.status}, ${s.periodEnd}, ${s.trialEnd}, ${s.priceId})::text as b`
    .execute(db)).rows[0]?.b ?? null;
}

export async function recordPaymentFailed(db: Db, customerId: string): Promise<string | null> {
  return (await sql<{ b: string | null }>`select billing_payment_failed(${customerId})::text as b`.execute(db)).rows[0]?.b ?? null;
}

export type ToSubscribe = { readonly businessId: string; readonly customerId: string; readonly priceId: string; readonly trialDays: number | null; readonly firstChannelAt: Date };

export async function workspacesToSubscribe(db: Db): Promise<ToSubscribe[]> {
  return (await sql<{ business_id: string; customer: string; price: string; trial_days: number | null; first_channel_at: Date }>`
    select business_id::text as business_id, customer, price, trial_days, first_channel_at from billing_to_subscribe()`.execute(db)).rows
    .map((r) => ({ businessId: r.business_id, customerId: r.customer, priceId: r.price, trialDays: r.trial_days, firstChannelAt: r.first_channel_at }));
}

export async function recordSubscribed(db: Db, s: {
  readonly businessId: string; readonly subscriptionId: string; readonly status: BillingStatus;
  readonly trialStartedAt: Date; readonly trialEnd: Date | null; readonly periodEnd: Date | null;
}): Promise<void> {
  await sql`select billing_subscribed(${s.businessId}::uuid, ${s.subscriptionId}, ${s.status}, ${s.trialStartedAt}, ${s.trialEnd}, ${s.periodEnd})`.execute(db);
}

export type BillingAlertKind = 'billing_trial_ending' | 'billing_payment_failed' | 'billing_lapsed' | 'plan_limit';

export async function claimBillingAlerts(db: Db): Promise<{ businessId: string; kind: BillingAlertKind; at: Date | null }[]> {
  return (await sql<{ business_id: string; kind: BillingAlertKind; at: Date | null }>`
    select business_id::text as business_id, kind, at from claim_billing_alerts()`.execute(db)).rows
    .map((r) => ({ businessId: r.business_id, kind: r.kind, at: r.at }));
}
