import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { writeOrderState } from '../../db/orders.js';
import { parseBusinessId } from '../../core/types/ids.js';
import {
  ORDER_STATES, isOrderState, type OrderState, type OrderUpdate,
} from '../../core/commerce/orderState.js';
import { buildInvoice, renderInvoiceEn } from '../../core/commerce/invoice.js';
import { moneyFromRow, type Money } from '../../core/types/money.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { labelled } from '../../core/owner/i18n/format.js';
import { isGeneratedSku } from '../../core/owner/sku.js';
import { unitLabel } from './products.js';
import { esc, back, deeper, conversationUrl } from './layout.js';
import { productName } from './inbox.js';
import { flashBanner, type Flash } from './flash.js';
import { faceLink } from './faces.js';
import { faceVersions } from '../../db/faces.js';
import * as show from './values.js';
import { icon } from './icons.js';

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
  /** Phase 9 (w4-customers-10) — the customer, for their face (it opens their card); the photo's version, or null. */
  readonly clientId?: string | null;
  readonly photo?: string | null;
  readonly productName: string | null;
  /** Phase 9 (V1-192) — the product's Chinese name, as the Customers list shows it to a Chinese page. */
  readonly productNameZh?: string | null;
  readonly productSku: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPriceAmount: number | null;
  readonly totalAmount: number | null;
  readonly currency: string;
  readonly email: string | null;
  readonly paymentTerms: string | null;
  /** G6 — the delivery term the order was confirmed under; null when she had stated none. */
  readonly incoterm?: string | null;
  readonly sellerName: string;
  readonly confirmedAt: Date | null;
  /**
   * M45/G15 — the sample he already paid for, coming off THIS order because
   * she said it would. Null when nothing is owed; `mismatch` when the sample
   * was priced in one currency and the order in another, which is hers to
   * settle rather than ours to convert.
   */
  readonly sampleCredit?: { readonly kind: 'credit'; readonly amount: Money }
    | { readonly kind: 'mismatch'; readonly amount: Money } | null;
  /** Newest first. Append-only: this is what she said, not what was computed. */
  readonly history: readonly OrderUpdate[];
};

export async function loadOrder(db: Db, businessIdRaw: string, orderId: string): Promise<OrderView | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const o = (await sql<{
      id: string; reference: string; conversation_id: string; buyer: string | null; client_id: string | null; seller: string;
      name: string | null; name_zh: string | null; sku: string; quantity: number; unit: string;
      unit_price: string | null; total: string | null; currency: string;
      client_email: string | null; payment_terms: string | null; incoterm: string | null; confirmed_at: Date | null;
    }>`
      select o.id, o.order_reference as reference, o.conversation_id::text as conversation_id,
             cl.display_name as buyer, cl.id::text as client_id, p.name, p.name_zh, p.sku, o.quantity, o.unit,
             o.agreed_unit_price_usd as unit_price, o.total_value_usd as total, o.currency,
             o.client_email, o.payment_terms, o.incoterm, o.confirmed_at, b.name as seller
        from orders o
        join businesses b on b.id = o.business_id
        left join clients cl on cl.id = o.client_id
        left join products p on p.id = o.product_id
       where o.business_id = ${bid.value} and o.id = ${orderId}
       limit 1`.execute(tx)).rows[0];
    if (!o) return null;

    /**
     * M45/G15 — is a sample credit owed on this order?
     *
     * Derived, with no new storage, from three rows that already exist:
     *   · his FIRST order — counted by `orders.client_id`, the same key M46
     *     looks orders up by, so a second order gets no second credit;
     *   · that he ASKED for a sample — `sample_requests` reaches the client
     *     through its conversation;
     *   · the policy IN FORCE WHEN HE ASKED — `sample_policy` is insert-only
     *     with the newest row in force, so the promise he was given is the one
     *     that was current that day, not whatever she has said since.
     */
    const credit = (await sql<{ amount: string; currency: string; credited: boolean }>`
      -- The order's own timestamp stays IN the database. Sending it back as a
      -- parameter loses it: pg stores microseconds and a JavaScript Date holds
      -- milliseconds, so a sample asked for in the same transaction as the
      -- order came back 688µs in the future and the credit silently vanished.
      with this_order as (
        select client_id, created_at from orders
         where id = ${orderId} and business_id = ${bid.value}
      )
      select sp.price_amount as amount, sp.currency, sp.credited_on_first_order as credited
        from sample_requests sr
        join conversations c on c.id = sr.conversation_id
        join this_order o on c.client_id = o.client_id
        join lateral (
          select price_amount, currency, credited_on_first_order
            from sample_policy p
           where p.business_id = ${bid.value} and p.stated_at <= sr.requested_at
           order by p.stated_at desc limit 1
        ) sp on true
       where sr.business_id = ${bid.value}
         and sr.requested_at <= o.created_at
         and not exists (
           select 1 from orders earlier
            where earlier.client_id = o.client_id and earlier.business_id = ${bid.value}
              and earlier.created_at < o.created_at)
       order by sr.requested_at asc limit 1
    `.execute(tx)).rows[0];
    const creditMoney = credit && credit.credited && Number(credit.amount) > 0
      ? moneyFromRow(Number(credit.amount), credit.currency) : null;

    const h = await sql<{
      state: string; at: Date; note: string | null; tracking_reference: string | null; by_actor: string;
    }>`
      select state, at, note, tracking_reference, by_actor from order_updates
       where order_id = ${orderId} order by at desc, id desc limit 50`.execute(tx);

    const photos = o.client_id ? await faceVersions(tx, [o.client_id]) : new Map<string, string>();
    return {
      orderId: o.id, reference: o.reference, conversationId: o.conversation_id,
      buyer: o.buyer, clientId: o.client_id, photo: o.client_id ? photos.get(o.client_id) ?? null : null, productName: o.name, productNameZh: o.name_zh, productSku: o.sku,
      quantity: Number(o.quantity), unit: o.unit,
      unitPriceAmount: o.unit_price === null ? null : Number(o.unit_price),
      totalAmount: o.total === null ? null : Number(o.total),
      currency: o.currency,
      email: o.client_email, paymentTerms: o.payment_terms, incoterm: o.incoterm,
      sellerName: o.seller, confirmedAt: o.confirmed_at,
      // Currencies that do not match are NOT converted here: her rate (M43b)
      // is a decision she states, and applying one silently to a document a
      // buyer pays against is the arithmetic this product refuses to invent.
      sampleCredit: creditMoney === null ? null
        : creditMoney.currency === o.currency
          ? { kind: 'credit' as const, amount: creditMoney }
          : { kind: 'mismatch' as const, amount: creditMoney },
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

/**
 * M46 — the proforma, from the row. Its numbers are the order's own; this does
 * no arithmetic, which is why it can be shown verbatim — and, since phase 9
 * (V1-188), downloaded as the same text (`/app/orders/:id/proforma.txt`).
 *
 * G6 — and its TERMS are hers, or there is no proforma. Every order used to
 * carry "30% deposit, 70% before shipment" and every proforma said FOB;
 * neither came from her. Null without her terms, or without a price.
 *
 * CC-31 — the proforma goes to the buyer: it names her own article number,
 * and leaves off one the import made up ("Canvas bag (NEW-mfp2k3x4-0)").
 */
export function proformaText(v: OrderView): string | null {
  const total = v.totalAmount === null ? null : moneyFromRow(v.totalAmount, v.currency);
  const unitPrice = v.unitPriceAmount === null ? null : moneyFromRow(v.unitPriceAmount, v.currency);
  if (!unitPrice || !total || !v.paymentTerms || !v.incoterm) return null;
  const text = renderInvoiceEn({ ...buildInvoice({
    quote: {
      productId: '' as never,
      quantity: { value: v.quantity, unit: v.unit },
      unitPrice, discountPct: 0, total,
      moq: v.quantity, leadTimeDays: null, leadTimeBlocked: null,
      requiresHuman: false, contradicts: null, appliedRules: [],
    },
    sellerName: v.sellerName,
    sellerPrefix: 'PI',
    buyerName: v.buyer ?? '',
    productName: v.productName ?? v.productSku,
    productSku: v.productSku,
    incoterm: v.incoterm,
    paymentTermsZh: v.paymentTerms,
    paymentTermsEn: v.paymentTerms,
    conversationRef: v.conversationId,
    // M45/G15 — the deduction she promised, on the document she promised
    // it on. Only when the two currencies agree; see the note on the page.
    sampleCredit: v.sampleCredit?.kind === 'credit' ? v.sampleCredit.amount : null,
    now: v.confirmedAt ?? v.history[v.history.length - 1]?.at ?? new Date(0),
  }), piNumber: v.reference });
  return isGeneratedSku(v.productSku) ? text.replace(` (${v.productSku})`, '') : text;
}

/** The proforma as the page draws it: escaped, the article number held whole on one line (what is copied is the same text). */
function docText(text: string, sku: string): string {
  const body = esc(text);
  const code = esc(`(${sku})`);
  return sku && body.includes(code) ? body.split(code).join(`<span class="doc-code">${code}</span>`) : body;
}

/** The proforma's file name: its reference, in the characters any file system takes. */
export const proformaFileName = (v: OrderView): string => `proforma-${v.reference.replace(/[^A-Za-z0-9._-]+/g, '-')}.txt`;

export function renderOrder(v: OrderView, locale: Locale, flash: Flash | null): string {
  const name = assistantName(locale);
  // G18 — the order's own money, in the order's own currency. Both of these
  // used to be rebuilt as dollars and then hidden unless the order WAS in
  // dollars, so an order taken in ￥ showed her no total and no proforma at
  // all. An amount in a currency this build does not know is still shown to
  // nobody — `moneyFromRow` returns null rather than guessing.
  const total = v.totalAmount === null ? null : moneyFromRow(v.totalAmount, v.currency);
  const unitPrice = v.unitPriceAmount === null ? null : moneyFromRow(v.unitPriceAmount, v.currency);
  const stateName = (s: OrderState) => t(locale, `order.state.${s}` as MessageKey);
  // Phase 9 (V1-189) — the confirmation is where an order's story starts. With
  // nothing recorded since, the page said "Nothing recorded yet" under a menu
  // reading "Confirmed" and a summary saying when it was confirmed.
  const confirmedInHistory = v.history.some((u) => u.state === 'confirmed');
  const confirmation = v.confirmedAt && !confirmedInHistory ? { state: 'confirmed' as const, at: v.confirmedAt } : null;
  const latest: { readonly state: OrderState; readonly at: Date } | null = v.history[0] ?? confirmation;

  // Phase 9 of the warmth run (w4-customers-11) — the confirmation is said
  // once by the line at the top (with its year) and kept in the history; a
  // third "Confirmed on" row is drawn only once something has happened since.
  const confirmedNow = latest !== null && latest.state === 'confirmed';
  const facts = [
    // Phase 9 of the warmth run (V1-184) — the reference is a fact of the order, not its name: the heading names the customer.
    [t(locale, 'order.field.reference'), v.reference],
    // Phase 9 (V1-192) — the product's name in the page's language, as the Customers list gives it.
    [t(locale, 'order.field.product'), productName(locale, { name: v.productName, nameZh: v.productNameZh ?? null }) ?? v.productSku],
    // CC-13 — the unit in the page's language, spaced the locale's way ("5,000 pcs", "5000个").
    [t(locale, 'order.field.quantity'), show.quantityOf(locale, v.quantity, unitLabel(locale, v.unit))],
    ...(total ? [[t(locale, 'order.field.total'), show.money(locale, total)]] : []),
    // Phase 9 (V1-193) — with its year: an order outlives the year it was confirmed in.
    ...(v.confirmedAt && !confirmedNow ? [[t(locale, 'order.field.confirmed'), show.dateYear(locale, v.confirmedAt)]] : []),
  ].map(([l, val]) => `<div class="frow"><span class="flabel">${esc(l!)}</span><span class="fval"><bdi>${esc(val!)}</bdi></span></div>`).join('');

  const rows = [
    ...v.history.map((u) => `<li class="row lines">
        <div><b>${esc(stateName(u.state))}</b> <span class="muted">${esc(show.date(locale, u.at))}</span></div>
        ${u.trackingReference ? `<div class="muted"><bdi>${esc(labelled(locale, t(locale, 'order.field.tracking'), u.trackingReference))}</bdi></div>` : ''}
        ${u.note ? `<div class="muted measure-prose"><bdi>${esc(u.note)}</bdi></div>` : ''}
      </li>`),
    ...(confirmation ? [`<li class="row lines">
        <div><b>${esc(stateName('confirmed'))}</b> <span class="muted">${esc(show.date(locale, confirmation.at))}</span></div>
        <div class="muted">${esc(t(locale, v.history.length ? 'order.history.confirmedFirst' : 'order.history.confirmed'))}</div>
      </li>`] : []),
  ];
  const history = rows.length === 0
    ? `<div class="empty">${esc(t(locale, 'order.history.empty'))}</div>`
    : `<ul class="rows">${rows.join('')}</ul>`;

  const text = proformaText(v);
  const proforma = text
    ? `<section class="block"><h2>${esc(t(locale, 'order.invoice.title'))}</h2>
        <p class="muted">${esc(t(locale, 'order.invoice.intro'))}${locale === 'en' ? '' : ` ${esc(t(locale, 'order.invoice.english'))}`}</p>
        ${/* Phase 9 (V1-188) — a way to take it: the same text, as a file. The warmth run's phase 9 (w4-customers-12) — it
             says it saves a file, and carries a file's mark (Phosphor's download, the icons run), not a door's chevron. */ ''}<a class="deeper" href="/app/orders/${esc(encodeURIComponent(v.orderId))}/proforma.txt" download>${esc(t(locale, 'order.invoice.download'))}<span class="go" aria-hidden="true">${icon('download', 'gi', 'bold')}</span></a>
        ${/* Phase 9 (V1-185–187) — an English document reads left to right and wraps on a phone, never cut at either edge.
             The warmth run's phase 9 (w4-customers-09) — and an article number is never broken at its hyphen ("ZX-" / "200"). */ ''}<pre class="doc" dir="ltr">${docText(text, v.productSku)}</pre>
        ${v.sampleCredit?.kind === 'mismatch'
          ? `<p class="muted">${esc(t(locale, 'order.invoice.sampleMismatch', {
              amount: show.money(locale, v.sampleCredit.amount) }))}</p>`
          : ''}</section>`
    : unitPrice && total
      ? `<section class="block"><h2>${esc(t(locale, 'order.invoice.title'))}</h2>
          ${/* V1-537 — confirmed under payment terms with no delivery term: a proforma needs one, so the page says which is missing. */ ''}<p class="muted">${esc(t(locale, v.paymentTerms && !v.incoterm ? 'order.invoice.noIncoterm' : 'order.invoice.noTerms'))}</p>
          ${deeper('/app/settings/terms', t(locale, 'terms.title'))}</section>`
      : '';

  return `<div class="dhead">${back(conversationUrl(v.conversationId), t(locale, 'order.back'))}</div>
    ${/* Phase 9 (V1-184) — the page says what it is; the reference alone read as a code. The warmth run's phase 9 —
         whose order it is, with their face (the one customer page that had none, w4-customers-10); the reference is a row below. */ ''}<div class="ord-head">${v.clientId
      ? faceLink({ clientId: v.clientId, name: v.buyer, photo: v.photo ?? null }, { size: 'l', label: t(locale, 'buyers.row.card', { who: v.buyer ?? t(locale, 'common.buyer') }) })
      : ''}<h1 class="page">${orderHeading(locale, v)}</h1></div>
    ${flashBanner(flash)}
    <section class="block">
      ${latest ? `<p class="stated-now">${esc(stateName(latest.state))} <span class="muted">${
        esc(t(locale, 'order.since', { date: confirmedNow ? show.dateYear(locale, latest.at) : show.date(locale, latest.at) }))}</span></p>` : ''}
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
    ${proforma}`;
}

/** The order's heading and its tab: whose order it is, the customer's name isolated ("Order from Khalid Mansoor"). */
export function orderHeading(locale: Locale, v: Pick<OrderView, 'buyer'>): string {
  const who = v.buyer ?? t(locale, 'common.buyer');
  return esc(t(locale, 'order.heading', { who: '\u0000' })).replace('\u0000', `<bdi>${esc(who)}</bdi>`);
}
export const orderTitle = (locale: Locale, v: Pick<OrderView, 'buyer'>): string =>
  t(locale, 'order.heading', { who: v.buyer ?? t(locale, 'common.buyer') });
