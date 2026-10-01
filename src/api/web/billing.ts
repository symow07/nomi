import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { back, esc } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { priceText } from '../../core/billing/status.js';
import type { BillingState, Plan } from '../../db/billing.js';

/**
 * BILL (0117) — the Billing page: where the workspace stands, the plans on
 * offer, the month's customers against the plan, and the doors to Stripe —
 * saving a card (nothing charged) and Stripe's own page for the card and the
 * invoices. Owner-only: money is the owner's (rule 11).
 */
export type BillingView = {
  /** The installation has a payment provider (STRIPE_*). */
  readonly configured: boolean;
  readonly state: BillingState;
  readonly plans: readonly Plan[];
  readonly people: number;
  readonly assistants: number;
  readonly zone: string;
  /** Back from Stripe's page: 'saved' or 'cancelled'. */
  readonly returned: 'saved' | 'cancelled' | null;
};

export function renderBilling(v: BillingView, locale: Locale, flash: Flash | null, backLabel: string): string {
  const head = `${back('/app/settings', backLabel)}
    <h1 class="page">${esc(t(locale, 'billing.title'))}</h1>
    ${flashBanner(flash)}`;
  if (!v.configured) return `${head}<section class="block"><p class="muted">${esc(t(locale, 'billing.notConfigured'))}</p></section>`;
  if (!v.state.billed) return `${head}<section class="block"><p class="muted">${esc(t(locale, 'billing.notBilled'))}</p></section>`;
  const s = v.state;
  const date = (d: Date | null) => (d ? formatDate(locale, d, v.zone) : '—');
  const plan = v.plans.find((p) => p.id === s.planId) ?? null;
  const price = (p: Plan) => t(locale, `billing.price.${p.period}` as MessageKey, { price: priceText(locale, p.amountMinor, p.currency) });
  const returned = v.returned ? `<p class="muted" role="status">${esc(t(locale, `billing.returned.${v.returned}` as MessageKey))}</p>` : '';

  const status = s.status === 'lapsed' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.lapsed'))}</p>`
    : s.status === 'past_due' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.past_due'))}</p>`
    : s.status === 'trial' ? `<p>${esc(t(locale, 'billing.status.trial', { date: date(s.trialEndsAt), plan: plan?.name ?? '—' }))}</p>`
    : s.status === 'active' ? `<p>${esc(t(locale, 'billing.status.active', { date: date(s.currentPeriodEnd), plan: plan?.name ?? '—' }))}</p>`
    : s.cardSavedAt ? `<p>${esc(t(locale, 'billing.status.cardSaved', { plan: plan?.name ?? '—' }))}</p>`
    : `<p>${esc(t(locale, 'billing.status.none'))}</p>`;
  const trial = s.trialDays && !s.trialStartedAt && s.status === 'none'
    ? `<p class="muted">${esc(t(locale, 'billing.trial', { days: s.trialDays }))}</p>` : '';

  // Plans are chosen before a subscription exists; after, Stripe's page changes them.
  const plans = v.plans.length === 0 ? `<p class="muted">${esc(t(locale, 'billing.noPlans'))}</p>`
    : s.status !== 'none' ? ''
    : `<form method="post" action="/app/settings/billing/card" class="pform">
        <fieldset class="choices"><legend>${esc(t(locale, 'billing.choose'))}</legend>
        ${v.plans.map((p) => `<label class="check"><input type="radio" name="plan" value="${esc(p.id)}"${p.id === (s.planId ?? v.plans[0]!.id) ? ' checked' : ''} />
          <span><b>${esc(p.name)}</b> · ${esc(price(p))}<br><span class="muted">${esc(t(locale, 'billing.plan.customers', { n: p.customersAMonth }))}${
            p.seats ? ` · ${esc(t(locale, 'billing.plan.seats', { n: p.seats }))}` : ''}${p.assistants ? ` · ${esc(t(locale, 'billing.plan.assistants', { n: p.assistants }))}` : ''}</span></span></label>`).join('')}
        </fieldset>
        <button class="btn send" type="submit">${esc(t(locale, s.cardSavedAt ? 'billing.usePlan' : 'billing.saveCard'))}</button>
        <p class="muted">${esc(t(locale, 'billing.noChargeYet'))}</p>
      </form>`;

  const usage = plan ? `<section class="block"><h2>${esc(t(locale, 'billing.usage.title'))}</h2><ul class="rows">
      <li class="row">${esc(t(locale, 'billing.usage.customers', { n: s.customersThisMonth, limit: plan.customersAMonth }))}</li>
      <li class="row">${esc(plan.seats ? t(locale, 'billing.usage.seats', { n: v.people, limit: plan.seats }) : t(locale, 'billing.usage.seatsAny', { n: v.people }))}</li>
      <li class="row">${esc(plan.assistants ? t(locale, 'billing.usage.assistants', { n: v.assistants, limit: plan.assistants }) : t(locale, 'billing.usage.assistantsAny', { n: v.assistants }))}</li>
    </ul></section>` : '';

  const portal = s.hasCustomer ? `<form method="post" action="/app/settings/billing/portal">
      <button class="btn" type="submit">${esc(t(locale, 'billing.portal'))}</button></form>` : '';

  return `${head}
    <section class="block">${returned}${status}${trial}${plans}${portal}</section>
    ${usage}`;
}
