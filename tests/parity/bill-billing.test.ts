import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { statusFromStripe, trialEndFrom, priceText } from '../../src/core/billing/status.js';
import { renderBilling, type BillingView } from '../../src/api/web/billing.js';
import { goesByMail, renderOwnerAlert, BILLING_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { HOLD_REASON, HOLD_OUTCOME } from '../../src/db/assistantStop.js';
import { OWNER_ONLY } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { t as said } from '../../src/api/web/say.js';

/**
 * BILL (0117) — what billing decides, said once: Stripe's states in ours, the
 * trial's end, the page, the hold's names, the e-mails. Over Postgres and the
 * web app: tests/integration/bill-billing.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('BILL · Stripe\'s states, in ours', () => {
  it('only Stripe\'s "trialing" and "active" are good standing; an unknown status is a payment in doubt, never paid', () => {
    expect(statusFromStripe('trialing')).toBe('trial');
    expect(statusFromStripe('active')).toBe('active');
    for (const s of ['unpaid', 'canceled', 'incomplete_expired', 'paused']) expect(statusFromStripe(s), s).toBe('lapsed');
    for (const s of ['past_due', 'incomplete', 'something_new']) expect(statusFromStripe(s), s).toBe('past_due');
  });
  it('the trial runs from the first channel connected; none, or one already over, starts paid', () => {
    const connected = new Date('2026-10-01T10:00:00Z');
    expect(trialEndFrom(connected, 14, new Date('2026-10-02T00:00:00Z'))).toEqual(new Date('2026-10-15T10:00:00Z'));
    expect(trialEndFrom(connected, null, new Date('2026-10-02T00:00:00Z'))).toBeNull();
    expect(trialEndFrom(connected, 14, new Date('2026-10-20T00:00:00Z'))).toBeNull();
  });
  it('the price in the plan\'s own currency and the reader\'s digits', () => {
    expect(priceText('en', 4900, 'usd')).toBe('$49.00');
    expect(priceText('en', 4900, 'jpy')).toBe('¥4,900');
    expect(priceText('ar', 4900, 'usd')).toMatch(/49\.00/);
  });
});

describe('BILL · the hold, the unit, the gate', () => {
  it('a lapse is the allowance\'s hold under its own name; a plan\'s month only at the start of a turn', () => {
    expect(HOLD_REASON.billing).toBe('billing_lapsed');
    expect(HOLD_OUTCOME.billing).toBe('billing_lapsed');
    expect(HOLD_REASON.plan_limit).toBe('plan_limit');
    expect('plan_limit' in HOLD_OUTCOME).toBe(false);
    expect(src('src/worker/main.ts')).toContain('turnHold(tx, businessId.value, conversationId.value)');
  });
  it('the send gate pauses as for the allowance: queued replies wait, one already sending finishes', () => {
    expect(src('src/db/channels.ts')).toContain('paused: allowanceUsed(await allowanceOf(tx)) || await billingHeld(tx),');
  });
  it('the unit is counted where it happens: a draft, or a reply sent alone — never a practice copy\'s', () => {
    const m = src('migrations/0117_billing.sql');
    expect(m).toContain('create trigger drafts_count_customer after insert on drafts');
    expect(m).toContain("for each row when (new.type = 'auto_sent') execute function count_customer_answered();");
    expect(m).toContain('where c.id = new.conversation_id and b.practice_of is null');
  });
  it('card upfront is the one connection question\'s last answer', () => {
    expect(src('src/db/connectionApproval.ts')).toContain("return (await cardNeeded(tx)) ? 'card' : 'open';");
  });
  it('money is the owner\'s; the app never writes a billing table directly', () => {
    expect(OWNER_ONLY).toContain('billing');
    const m = src('migrations/0117_billing.sql');
    for (const table of ['plans', 'billing_settings', 'workspace_billing', 'stripe_events', 'customers_answered']) {
      expect(m, table).toContain(`revoke all on ${table} from public, nomi_app;`);
    }
    expect(m).toContain('grant select on workspace_billing to nomi_app;');
  });
  it('a subscription event older than the last one applied changes nothing', () => {
    expect(src('migrations/0117_billing.sql')).toContain('and (w.stripe_event_at is null or w.stripe_event_at <= p_event_at)');
  });
});

describe('BILL · the page', () => {
  const plan = { id: 'starter', name: 'Starter', amountMinor: 4900, currency: 'usd', period: 'month' as const, customersAMonth: 100, seats: 3, assistants: null, stripePriceId: 'price_x' };
  const state = { billed: true, exempt: false, planId: null, status: 'none' as const, cardSavedAt: null, trialDays: 14, trialStartedAt: null,
    trialEndsAt: null, currentPeriodEnd: null, hasCustomer: false, customersThisMonth: 0, firstChannelAt: null };
  const view = (over: Partial<BillingView> = {}): BillingView => ({ configured: true, state, plans: [plan], people: 1, assistants: 1, returned: null, ...over });
  for (const l of LOCALES) {
    it(`${l} · not set up; not billed; a plan and a card, nothing charged; the trial on offer`, () => {
      expect(renderBilling(view({ configured: false }), l, null, 'Back')).toContain(said(l, 'billing.notConfigured'));
      expect(renderBilling(view({ state: { ...state, billed: false } }), l, null, 'Back')).toContain(said(l, 'billing.notBilled'));
      const page = renderBilling(view(), l, null, 'Back');
      expect(page).toContain('action="/app/settings/billing/card"');
      expect(page).toContain(said(l, 'billing.saveCard'));
      expect(page).toContain(said(l, 'billing.noChargeYet'));
      expect(page).toContain(said(l, 'billing.trial', { days: 14 }));
      expect(page).not.toContain('/app/settings/billing/portal');
    });
    it(`${l} · lapsed and past due said as alerts; once subscribed, the plan is Stripe's to change`, () => {
      const lapsed = renderBilling(view({ state: { ...state, planId: 'starter', status: 'lapsed', hasCustomer: true } }), l, null, 'Back');
      expect(lapsed).toContain(`role="alert">${said(l, 'billing.status.lapsed')}`);
      expect(lapsed).not.toContain('action="/app/settings/billing/card"');
      expect(lapsed).toContain('/app/settings/billing/portal');
      expect(renderBilling(view({ state: { ...state, planId: 'starter', status: 'past_due', hasCustomer: true } }), l, null, 'Back'))
        .toContain(`role="alert">${said(l, 'billing.status.past_due')}`);
    });
  }
});

describe('BILL · the owner hears, by e-mail always', () => {
  it('every billing e-mail goes by mail and opens Billing', () => {
    for (const k of BILLING_ALERT_KINDS) expect(goesByMail(k), k).toBe(true);
    expect(src('src/pipeline/notify.ts')).toContain(': isBillingAlert(job.kind) ? BILLING_PAGE : null;');
  });
  for (const l of LOCALES) {
    it(`${l} · the words, the trial's date in the workspace's zone, and a subject each`, () => {
      const ending = renderOwnerAlert(l, 'billing_trial_ending', null, { billingAt: '2026-10-15T10:00:00Z', zone: 'Asia/Dubai' });
      expect(ending).not.toContain('{');
      expect(ending).toMatch(/15|١٥/);
      for (const k of BILLING_ALERT_KINDS) {
        expect(t(l, `notify.${k}.subject` as Parameters<typeof t>[1])).not.toBe(`notify.${k}.subject`);
        expect(renderOwnerAlert(l, k, null, { billingAt: '2026-10-15T10:00:00Z' })).not.toContain('{');
      }
    });
  }
});

describe('BILL · the operator\'s tool', () => {
  const tool = src('tools/billing.mjs');
  it('a plan\'s price is read from Stripe, never typed', () => {
    expect(tool).toContain('const price = await stripeClient(cfg).price(String(arg(\'--price\') ?? \'\'));');
    expect(tool).toContain('price: price.value');
    expect(src('tools/lib/operator.mjs')).toContain("!['month', 'year'].includes(p.interval) || !p.active) return 'invalid';");
  });
  it('dry run unless --yes; the switch is the installation\'s', () => {
    expect(tool).toContain("if (!yes) { console.log(`Dry run: would");
    expect(src('migrations/0117_billing.sql')).toContain("check (flag <> 'billing_required' or business_id is null);");
  });
});
