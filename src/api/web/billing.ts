import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { esc, atWork } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow } from './rows.js';
import { pageHead, setSection, setNotice } from './settingsPage.js';
import * as show from './values.js';
import { priceText } from '../../core/billing/status.js';
import type { BillingHold, BillingState, Plan } from '../../db/billing.js';

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
  /** 4.1 (0240) — the workspace is frozen, and why: the lapse, or the trial over with no card. Absent: not frozen. */
  readonly hold?: BillingHold | null;
  /** 4.1 — a card is needed before the first channel (`billing_card_needed()`: the switch or the sign-up's risk), none saved. */
  readonly cardFirst?: boolean;
  /** 4.1 fix D2 — `billing_required` is on: only then does a trial that ends with no card freeze the workspace. */
  readonly trialEndHolds?: boolean;
};

export function renderBilling(v: BillingView, locale: Locale, flash: Flash | null, _backLabel = ''): string {
  // The settings overhaul (rule 104) — the one template: the title is the menu's, one line under it, then sections.
  const head = `${pageHead(t(locale, 'settingsArea.billing'), t(locale, 'ws.billing.lede'))}
    ${flashBanner(flash)}`;
  // Phase 9 (settings-a-new-05, -06) — the plan and what is charged, as the settings pages' rows.
  const none = setSection({ id: 'plan', title: t(locale, 'billing.row.plan'), rows: [
    fieldRow({ label: t(locale, 'billing.row.plan'), control: `<span class="fr-value">${esc(t(locale, 'billing.value.noPlan'))}</span>` }),
    fieldRow({ label: t(locale, 'billing.row.charged'), control: `<span class="fr-value">${esc(t(locale, 'billing.value.nothing'))}</span>` }),
  ] });
  // F47 — not offered on this installation: said ON the page as its own line (billing is not open, payments are not
  // switched on, plans cannot be chosen), with the door to what is left of setting up; the plan and the charge as none.
  if (!v.configured) return `${head}
    ${setNotice({ id: 'billing-closed', html: `<strong>${esc(t(locale, 'state.billing.h'))}</strong> · ${esc(t(locale, 'billing.notConfigured'))} ${esc(t(locale, 'state.billing.p'))}`,
      door: { href: '/app/get-started', label: t(locale, 'state.billing.next') } })}
    ${none}`;
  if (!v.state.billed) return `${head}
    ${setNotice({ text: t(locale, 'billing.notBilled') })}
    ${none}`;

  const s = v.state;
  const date = (d: Date | null) => (d ? show.date(locale, d) : '—');
  const plan = v.plans.find((p) => p.id === s.planId) ?? null;
  const price = (p: Plan) => t(locale, `billing.price.${p.period}` as MessageKey, { price: priceText(locale, p.amountMinor, p.currency) });
  // Phase 6 — back from Stripe with a card: while Stripe has not confirmed it,
  // the page says so as work in progress, and its script draws the answer in
  // (live.ts `billingWatch`); once it has, the status line says it and this goes.
  const returned = v.returned === 'saved' ? (s.cardSavedAt ? '' : atWork(t(locale, 'billing.returned.saved')))
    : v.returned ? `<p class="muted" role="status">${esc(t(locale, `billing.returned.${v.returned}` as MessageKey))}</p>` : '';

  const trialOver = v.hold === 'trial_over';
  const status = trialOver ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.trialOver'))}</p>`
    : s.status === 'lapsed' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.lapsed'))}</p>`
    : s.status === 'past_due' ? `<p class="perr" role="alert">${esc(t(locale, 'billing.status.past_due'))}</p>`
    : s.status === 'trial' ? `<p>${esc(t(locale, 'billing.status.trial', { date: date(s.trialEndsAt), plan: plan?.name ?? '—' }))}</p>`
    : s.status === 'active' ? `<p>${esc(t(locale, 'billing.status.active', { date: date(s.currentPeriodEnd), plan: plan?.name ?? '—' }))}</p>`
    : s.cardSavedAt ? `<p>${esc(t(locale, 'billing.status.cardSaved', { plan: plan?.name ?? '—' }))}</p>`
    : `<p>${esc(t(locale, 'billing.status.none'))}</p>`;
  // 4.1 — the trial as it stands (N days, or on request), the card asked first, and what the trial's end does: said
  // from the rows (`trial_days_for`, `billing_card_needed()`), never a figure typed here. Not once it is over.
  const trial = s.status !== 'none' || trialOver || s.trialStartedAt ? ''
    : s.trialDays ? `<p class="muted">${esc(t(locale, 'billing.trial', { days: s.trialDays }))}</p>`
    : `<p class="muted">${esc(t(locale, 'billing.trial.onRequest'))}</p>`;
  const cardFirst = v.cardFirst && !trialOver && s.status === 'none' ? `<p>${esc(t(locale, 'billing.cardFirst'))}</p>` : '';
  const trialEnd = trialOver || (s.status !== 'none' && s.status !== 'trial') || v.plans.length === 0 ? ''
    : `<p class="muted">${esc(t(locale, 'billing.trialEnd.charged'))}${v.cardFirst && v.trialEndHolds ? ` ${esc(t(locale, 'billing.trialEnd.noCard'))}` : ''}</p>`;

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
        ${trialOver ? '' : `<p class="muted">${esc(t(locale, 'billing.noChargeYet'))}</p>`}
      </form>`;

  const usage = plan ? setSection({ id: 'usage', title: t(locale, 'billing.usage.title'), rows: `<ul class="rows">
      <li class="row">${esc(t(locale, 'billing.usage.customers', { n: s.customersThisMonth, limit: plan.customersAMonth }))}</li>
      <li class="row">${esc(plan.seats ? t(locale, 'billing.usage.seats', { n: v.people, limit: plan.seats }) : t(locale, 'billing.usage.seatsAny', { n: v.people }))}</li>
      <li class="row">${esc(plan.assistants ? t(locale, 'billing.usage.assistants', { n: v.assistants, limit: plan.assistants }) : t(locale, 'billing.usage.assistantsAny', { n: v.assistants }))}</li>
    </ul>` }) : '';

  const portal = s.hasCustomer ? `<form method="post" action="/app/settings/billing/portal">
      <button class="btn" type="submit">${esc(t(locale, 'billing.portal'))}</button></form>` : '';

  // Choosing a plan and opening the card's page are acts named by their verb (they lead to the payment provider's own
  // page): neither is a field of this page, so the page has no Save.
  return `${head}
    ${setSection({ id: 'plan', title: t(locale, 'billing.row.plan'), rows: `${returned}${status}${trial}${cardFirst}${trialEnd}${plans}${portal}` })}
    ${usage}`;
}
