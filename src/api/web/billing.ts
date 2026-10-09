import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { back, esc, atWork } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow, rowsCard } from './rows.js';
import * as show from './values.js';
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
  /** Back from Stripe's page: 'saved' or 'cancelled'. */
  readonly returned: 'saved' | 'cancelled' | null;
};

export function renderBilling(v: BillingView, locale: Locale, flash: Flash | null, backLabel: string): string {
  const head = `${back('/app/settings/setup', backLabel)}
    <h1 class="page">${esc(t(locale, 'billing.title'))}</h1>
    ${flashBanner(flash)}`;
  // Phase 9 (settings-a-new-05, -06) — what Setup's row promises, the plan and
  // what is charged, as the settings pages' rows: one grey line said neither.
  const nothing = (lede: MessageKey): string => `${head}
    <p class="lede">${esc(t(locale, lede))}</p>
    ${rowsCard(null, [
      fieldRow({ label: t(locale, 'billing.row.plan'), control: `<span class="fr-value">${esc(t(locale, 'billing.value.noPlan'))}</span>` }),
      fieldRow({ label: t(locale, 'billing.row.charged'), control: `<span class="fr-value">${esc(t(locale, 'billing.value.nothing'))}</span>` }),
    ])}`;
  if (!v.configured) return nothing('billing.notConfigured');
  if (!v.state.billed) return nothing('billing.notBilled');
  const s = v.state;
  const date = (d: Date | null) => (d ? show.date(locale, d) : '—');
  const plan = v.plans.find((p) => p.id === s.planId) ?? null;
  const price = (p: Plan) => t(locale, `billing.price.${p.period}` as MessageKey, { price: priceText(locale, p.amountMinor, p.currency) });
  // Phase 6 — back from Stripe with a card: while Stripe has not confirmed it,
  // the page says so as work in progress, and its script draws the answer in
  // (live.ts `billingWatch`); once it has, the status line says it and this goes.
  const returned = v.returned === 'saved' ? (s.cardSavedAt ? '' : atWork(t(locale, 'billing.returned.saved')))
    : v.returned ? `<p class="muted" role="status">${esc(t(locale, `billing.returned.${v.returned}` as MessageKey))}</p>` : '';

  const status = s.status === 'lapsed' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.lapsed'))}</p>`
    : s.status === 'past_due' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.past_due'))}</p>`
    : s.status === 'trial' ? `<p>${esc(t(locale, 'billing.status.trial', { date: date(s.trialEndsAt), plan: plan?.name ?? '—' }))}</p>`
    : s.status === 'active' ? `<p>${esc(t(locale, 'billing.status.active', { date: date(s.currentPeriodEnd), plan: plan?.name ?? '—' }))}</p>`
    : s.cardSavedAt ? `<p>${esc(t(locale, 'billing.status.cardSaved', { plan: plan?.name ?? '—' }))}</p>`
    : `<p>${esc(t(locale, 'billing.status.none'))}</p>`;
  const trial = s.trialDays && !s.trialStartedAt && s.status === 'none'
    ? `<p class="muted">${esc(t(locale, 'billing.trial', { days: s.trialDays }))}</p>` : '';

  // Plans are chosen before a subscription exists; after, Stripe's page is for the card, the invoices and cancelling.
  // Beside the button, in plain text and not greyed: the plan renews every month, at its price, until cancelled,
  // where to cancel, and that a cancelled plan runs to the end of the month paid for (docs/PRE-LAUNCH.md item 4) —
  // true because Stripe's page opens only with Nomi's configuration (billing/stripe.ts `PORTAL_FEATURES`). Then
  // the refund terms (item 5), which cover every plan offered here: monthly ones only (`plansOnOffer`).
  const plans = v.plans.length === 0 ? `<p class="muted">${esc(t(locale, 'billing.noPlans'))}</p>`
    : s.status !== 'none' ? ''
    : `<form method="post" action="/app/settings/billing/card" class="pform">
        <fieldset class="choices"><legend>${esc(t(locale, 'billing.choose'))}</legend>
        ${v.plans.map((p) => `<label class="check"><input type="radio" name="plan" value="${esc(p.id)}"${p.id === (s.planId ?? v.plans[0]!.id) ? ' checked' : ''} />
          <span><b>${esc(p.name)}</b> · ${esc(price(p))}<br><span class="muted">${esc(t(locale, 'billing.plan.customers', { n: p.customersAMonth }))}${
            p.seats ? ` · ${esc(t(locale, 'billing.plan.seats', { n: p.seats }))}` : ''}${p.assistants ? ` · ${esc(t(locale, 'billing.plan.assistants', { n: p.assistants }))}` : ''}</span></span></label>`).join('')}
        </fieldset>
        <button class="btn send" type="submit">${esc(t(locale, s.cardSavedAt ? 'billing.usePlan' : 'billing.saveCard'))}</button>
        <p>${esc(t(locale, 'billing.renews', { portal: t(locale, 'billing.portal') }))}</p>
        <p><a href="/refunds">${esc(t(locale, 'legal.refunds.title'))}</a></p>
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
