import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { writeOrderState } from '../../db/orders.js';
import { parseBusinessId } from '../../core/types/ids.js';
import {
  ORDER_STATES, isOrderState, type OrderState, type OrderUpdate,
} from '../../core/commerce/orderState.js';
import { buildInvoice, renderInvoiceEn } from '../../core/commerce/invoice.js';
import { usd } from '../../core/types/money.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate, formatQty, formatMoney } from '../../core/owner/i18n/format.js';
import { esc, back } from './layout.js';

/**
 * M46 — one order, everything she knows about it, and the one thing she can do.
 *
 * The trail stopped at confirmation: `confirmable.ts` produced an order and
 * `invoice.ts` could render a proforma for it, and neither was reachable from
 * any screen. Three weeks later "where is my order?" had no answer, and for a
 * Yiwu supplier that is the half that produces repeat business.
 *
 * This page is the answer, and it is deliberately small: what she recorded,
 * when, the reference she pasted, the proforma she can copy — and a form that
 * records the next thing. No courier, no carrier lookup, no estimated arrival.
 */

export type OrderView = {
  readonly orderId: string;
  readonly reference: string;
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly productName: string | null;
  readonly productSku: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPriceAmount: number | null;
  readonly totalAmount: number | null;
  readonly currency: string;
  readonly email: string | null;
  readonly paymentTerms: string | null;
  readonly sellerName: string;
  readonly confirmedAt: Date | null;
  /** Newest first. Append-only: this is what she said, not what was computed. */
  readonly history: readonly OrderUpdate[];
};

export async function loadOrder(db: Db, businessIdRaw: string, orderId: string): Promise<OrderView | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const o = (await sql<{
      id: string; reference: string; conversation_id: string; buyer: string | null; seller: string;
      name: string | null; sku: string; quantity: number; unit: string;
      unit_price: string | null; total: string | null; currency: string;
      client_email: string | null; payment_terms: string | null; confirmed_at: Date | null;
    }>`
      select o.id, o.order_reference as reference, o.conversation_id::text as conversation_id,
             cl.display_name as buyer, p.name, p.sku, o.quantity, o.unit,
             o.agreed_unit_price_usd as unit_price, o.total_value_usd as total, o.currency,
             o.client_email, o.payment_terms, o.confirmed_at, b.name as seller
        from orders o
        join businesses b on b.id = o.business_id
        left join clients cl on cl.id = o.client_id
        left join products p on p.id = o.product_id
       where o.business_id = ${bid.value} and o.id = ${orderId}
       limit 1`.execute(tx)).rows[0];
    if (!o) return null;

    const h = await sql<{
      state: string; at: Date; note: string | null; tracking_reference: string | null; by_actor: string;
    }>`
      select state, at, note, tracking_reference, by_actor from order_updates
       where order_id = ${orderId} order by at desc, id desc limit 50`.execute(tx);

    return {
      orderId: o.id, reference: o.reference, conversationId: o.conversation_id,
      buyer: o.buyer, productName: o.name, productSku: o.sku,
      quantity: Number(o.quantity), unit: o.unit,
      unitPriceAmount: o.unit_price === null ? null : Number(o.unit_price),
      totalAmount: o.total === null ? null : Number(o.total),
      currency: o.currency,
      email: o.client_email, paymentTerms: o.payment_terms,
      sellerName: o.seller, confirmedAt: o.confirmed_at,
      history: h.rows.flatMap((r): OrderUpdate[] => isOrderState(r.state) ? [{
        state: r.state, at: r.at, note: r.note,
        trackingReference: r.tracking_reference, by: r.by_actor,
      }] : []),
    };
  });
}

/**
 * The owner's route into the one writer.
 *
 * This function validates and owns the transaction; `writeOrderState` (db/
 * orders.ts) does the writing, and it is the only thing in the product that
 * writes either representation. The split matters: a future caller — a worker,
 * the pipeline, a bulk import — reaches for the primitive rather than writing
 * its own two statements and getting one of them wrong.
 */
export async function recordOrderUpdate(
  db: Db, businessIdRaw: string, orderId: string,
  input: { state: string; note?: string | null; trackingReference?: string | null; actor: string; now: Date },
): Promise<{ code: 'recorded' | 'unknown_state' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const state = input.state;
  // The narrowing survives into the closure: `writeOrderState` takes an
  // OrderState, never a string, so a state that is not one of the four cannot
  // reach the insert even if this check were moved.
  if (!isOrderState(state)) return { code: 'unknown_state' };
  const note = (input.note ?? '').trim() || null;
  const tracking = (input.trackingReference ?? '').trim() || null;

  return withTenantTx(db, bid.value, async (tx) => {
    const owned = (await sql<{ id: string }>`
      select id from orders where id = ${orderId} and business_id = ${bid.value} limit 1
    `.execute(tx)).rows[0];
    if (!owned) return { code: 'failed' as const };

    await writeOrderState(tx, bid.value, orderId, {
      state, note, trackingReference: tracking,
      actor: input.actor, at: input.now,
    });
    return { code: 'recorded' as const };
  });
}

export function renderOrder(v: OrderView, locale: Locale, flash: string | null): string {
  const name = EMPLOYEE_NAME[locale];
  const latest = v.history[0] ?? null;
  const stateName = (s: OrderState) => t(locale, `order.state.${s}` as MessageKey);

  const facts = [
    [t(locale, 'order.field.buyer'), v.buyer ?? t(locale, 'common.buyer')],
    [t(locale, 'order.field.product'), v.productName ?? v.productSku],
    [t(locale, 'order.field.quantity'), `${formatQty(locale, v.quantity)} ${v.unit}`],
    ...(v.totalAmount !== null && v.currency === 'USD'
      ? [[t(locale, 'order.field.total'), formatMoney(usd(v.totalAmount))]] : []),
    ...(v.confirmedAt ? [[t(locale, 'order.field.confirmed'), formatDate(locale, v.confirmedAt)]] : []),
  ].map(([l, val]) => `<div class="frow"><span class="flabel">${esc(l!)}</span><span class="fval"><bdi>${esc(val!)}</bdi></span></div>`).join('');

  const history = v.history.length === 0
    ? `<p class="muted empty-p">${esc(t(locale, 'order.history.empty'))}</p>`
    : `<ul class="ohist">${v.history.map((u) => `<li>
        <div><b>${esc(stateName(u.state))}</b> <span class="muted">${esc(formatDate(locale, u.at))}</span></div>
        ${u.trackingReference ? `<div class="muted"><bdi>${esc(t(locale, 'order.field.tracking'))}: ${esc(u.trackingReference)}</bdi></div>` : ''}
        ${u.note ? `<div class="muted onote"><bdi>${esc(u.note)}</bdi></div>` : ''}
      </li>`).join('')}</ul>`;

  // M46 — the proforma, from the row. Its numbers are the order's own; this
  // renderer does no arithmetic, which is why it can be shown verbatim.
  const proforma = v.unitPriceAmount !== null && v.totalAmount !== null && v.currency === 'USD'
    ? `<section class="block"><h2>${esc(t(locale, 'order.invoice.title'))}</h2>
        <p class="muted">${esc(t(locale, 'order.invoice.intro'))}</p>
        <pre>${esc(renderInvoiceEn({ ...buildInvoice({
          quote: {
            productId: '' as never,
            quantity: { value: v.quantity, unit: v.unit },
            unitPrice: usd(v.unitPriceAmount), discountPct: 0, total: usd(v.totalAmount),
            moq: v.quantity, leadTimeDays: null, leadTimeBlocked: null,
            requiresHuman: false, appliedRules: [],
          },
          sellerName: v.sellerName,
          sellerPrefix: 'PI',
          buyerName: v.buyer ?? '',
          productName: v.productName ?? v.productSku,
          productSku: v.productSku,
          incoterm: t(locale, 'order.invoice.incoterm'),
          paymentTermsZh: v.paymentTerms ?? '',
          paymentTermsEn: v.paymentTerms ?? '',
          conversationRef: v.conversationId,
          now: v.confirmedAt ?? v.history[v.history.length - 1]?.at ?? new Date(0),
        }), piNumber: v.reference }))}</pre></section>`
    : '';

  return `<div class="dhead">${back(`/app/inbox/${esc(v.conversationId)}`, t(locale, 'order.back'))}</div>
    <h1 class="page"><bdi>${esc(v.reference)}</bdi></h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      ${latest ? `<p class="stated-now">${esc(stateName(latest.state))} <span class="muted">${
        esc(t(locale, 'order.since', { date: formatDate(locale, latest.at) }))}</span></p>` : ''}
      <div class="facts">${facts}</div>
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'order.update.title'))}</h2>
      <p class="muted">${esc(t(locale, 'order.update.intro', { name }))}</p>
      <form method="post" action="/app/orders/${esc(v.orderId)}/update" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'order.update.state'))}</span>
          <select name="state">${ORDER_STATES.map((s) =>
            `<option value="${esc(s)}"${latest?.state === s ? ' selected' : ''}>${esc(stateName(s))}</option>`).join('')}</select></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'order.update.tracking'))}</span>
          <input name="tracking" placeholder="${esc(t(locale, 'order.update.tracking.placeholder'))}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'order.update.note'))}</span>
          <input name="note" maxlength="200" placeholder="${esc(t(locale, 'order.update.note.placeholder'))}" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'order.update.save'))}</button>
      </form>
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'order.history.title'))}</h2>
      ${history}
    </section>
    ${proforma}
    <style>
      .ohist { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .ohist li { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
      .ohist li:last-child { border-bottom:0; }
      .onote { font-size:var(--font-size-caption); margin-top:var(--space-4); max-width:var(--measure-prose); }
      .facts { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
      .frow { display:flex; gap:var(--space-16); font-size:var(--font-size-note); }
      .flabel { color:var(--color-ink-secondary); min-width:8.5em; }
    </style>`;
}
