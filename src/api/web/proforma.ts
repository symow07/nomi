import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { resolveProforma } from '../../db/proformaLinks.js';
import { zoneOf } from '../../db/zone.js';
import { roundMoney, subMoney, type Money } from '../../core/types/money.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { ownSku } from '../../core/owner/sku.js';
import { t } from './say.js';
import { publicDocument, esc } from './layout.js';
import { loadOrder, proformaText } from './orders.js';
import { buyerLocale } from './proof.js';
import { productName } from './inbox.js';
import { unitLabel } from './products.js';
import { withZone } from './zone.js';
import * as show from './values.js';

/**
 * Phase 2c (the owner's roadmap, 2026-10-13; 0151) — THE PROFORMA AS A PAGE THE CUSTOMER OPENS.
 *
 * The order's proforma was text for the owner to copy (M46, V1-188). This is the same document at a link the owner
 * sends in the conversation: no sign-in, in the customer's language (the price link's rule, `buyerLocale`), and laid
 * out as a document a customer can keep, forward to whoever pays, or print to a PDF from the browser.
 *
 * ── WHAT IT SAYS, AND WHAT IT NEVER DOES ─────────────────────────────────────────────────────────────────────────
 *
 * Every figure is the order's own, exactly what the owner's proforma states (`proformaText`): the same conditions —
 * a price, the owner's payment terms and a delivery term — or no page at all (404, as for a link turned off). The
 * one sum is the sample credit taken off the total, the same two lines the text shows.
 *
 * The view below is the WHOLE of what the renderer receives. Never on it: the customer's e-mail, the order's status
 * history, notes or tracking numbers, the conversation, any id, the pricing policy, the assistant. The seller is
 * named with the postal address the owner already prints on their marketing e-mail (0133), when there is one.
 *
 * NO BANK DETAILS, ON PURPOSE (the owner, 2026-10-13). No account, IBAN, SWIFT or payment link, ever: the payment
 * terms are words only. A page made to be forwarded that carries payment details is an invoice-fraud vector —
 * altered bank details on an intercepted quote are one of the most common B2B scams. The customer gets the account
 * from the seller, through a channel they already trust. docs/PROFORMA-LINK.md; the parity test holds it.
 *
 * The template was approved by the owner at Phase 2c's stop-gate (2026-10-13). The text proforma on the order page
 * stays English while this page follows the customer: two rules, known, to be aligned later (docs/PROFORMA-LINK.md).
 */

export type ProformaView = {
  /** The customer's language, from their own messages — the page they forward should read as they wrote. */
  readonly locale: Locale;
  /** The seller's zone: the date is the seller's day. */
  readonly zone: string;
  readonly seller: string;
  readonly sellerAddress: string | null;
  readonly buyer: string | null;
  readonly reference: string;
  readonly issuedAt: Date | null;
  readonly product: string;
  readonly sku: string | null;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly total: Money;
  readonly sampleCredit: Money | null;
  readonly incoterm: string;
  readonly paymentTerms: string;
};

/**
 * The token to its page, or null — for every failure alike (unknown, turned off, the customer erased, the order no
 * longer carrying what a proforma needs), so the route's 404 tells a stranger nothing.
 */
export async function loadProformaPage(db: Db, token: string): Promise<ProformaView | null> {
  const r = await resolveProforma(db, token);
  if (!r) return null;
  const bid = parseBusinessId(r.businessId);
  if (!bid.ok) return null;
  const v = await loadOrder(db, r.businessId, r.orderId);
  if (!v || proformaText(v) === null) return null;
  const { locale, zone, address } = await withTenantTx(db, bid.value, async (tx) => ({
    locale: await buyerLocale(tx, v.conversationId),
    zone: await zoneOf(tx, bid.value),
    address: (await sql<{ a: string | null }>`select postal_address as a from businesses where id = ${bid.value}::uuid`
      .execute(tx)).rows[0]?.a ?? null,
  }));
  // `proformaText` held: both are a price in a currency this build writes.
  const unitPrice = { amount: v.unitPriceAmount!, currency: v.currency } as Money;
  const total = { amount: v.totalAmount!, currency: v.currency } as Money;
  return {
    locale, zone,
    seller: v.sellerName,
    sellerAddress: address?.trim() || null,
    buyer: v.buyer,
    reference: v.reference,
    issuedAt: v.confirmedAt ?? v.history[v.history.length - 1]?.at ?? null,
    product: productName(locale, { name: v.productName, nameZh: v.productNameZh ?? null }) ?? v.productSku,
    sku: ownSku(v.productSku),
    quantity: v.quantity,
    unit: v.unit,
    unitPrice,
    total,
    // The credit the owner's proforma takes off: only in the order's own currency, never converted.
    sampleCredit: v.sampleCredit?.kind === 'credit' ? v.sampleCredit.amount : null,
    incoterm: v.incoterm!,
    paymentTerms: v.paymentTerms!,
  };
}

/**
 * The document. Standalone like the price page: no nav, no session, no way into the app, nothing of Nomi's — it is
 * the seller's paper. Its rules travel inside it (`publicDocument`), and it prints as a plain A4 sheet.
 */
export function renderProformaPage(v: ProformaView): string {
  return withZone(v.zone, () => {
    const l = v.locale;
    const iso = (s: string): string => `<bdi>${esc(s)}</bdi>`;
    const qty = show.quantityOf(l, v.quantity, unitLabel(l, v.unit));
    const due = v.sampleCredit ? roundMoney(subMoney(v.total, v.sampleCredit)) : null;
    const sumRow = (label: string, value: string, cls = ''): string =>
      `<div class="pi-sumrow${cls}"><dt>${esc(label)}</dt><dd>${iso(value)}</dd></div>`;
    // The credit taken off, its sign with its figure: one left-to-right run ("−US$ 25.00"), never split by an
    // Arabic page into "US$ 25.00−".
    const less = (m: Money): string =>
      `<div class="pi-sumrow"><dt>${esc(t(l, 'pi.lessSample'))}</dt><dd><bdi dir="ltr">\u2212${iso(show.money(l, m))}</bdi></dd></div>`;
    // The owner's own words, isolated: they keep their direction and the page keeps its alignment.
    const term = (label: string, value: string): string =>
      `<div class="pi-term"><dt>${esc(label)}</dt><dd>${iso(value)}</dd></div>`;

    const body = `
<article class="pi-sheet">
  <header class="pi-head">
    <div class="pi-from">
      <div class="pi-seller">${iso(v.seller)}</div>
      ${v.sellerAddress ? `<div class="pi-address">${iso(v.sellerAddress)}</div>` : ''}
    </div>
    <div class="pi-doc">
      <h1>${esc(t(l, 'pi.heading'))}</h1>
      <dl class="pi-meta">
        <div><dt>${esc(t(l, 'pi.number'))}</dt><dd>${iso(v.reference)}</dd></div>
        ${v.issuedAt ? `<div><dt>${esc(t(l, 'pi.date'))}</dt><dd>${iso(show.dateYear(l, v.issuedAt))}</dd></div>` : ''}
      </dl>
    </div>
  </header>

  ${v.buyer ? `<section class="pi-to">
    <div class="pi-label">${esc(t(l, 'pi.billTo'))}</div>
    <div class="pi-buyer">${iso(v.buyer)}</div>
  </section>` : ''}

  <table class="pi-lines">
    <thead><tr>
      <th scope="col">${esc(t(l, 'pi.col.item'))}</th>
      <th scope="col" class="num">${esc(t(l, 'pi.col.quantity'))}</th>
      <th scope="col" class="num">${esc(t(l, 'pi.col.unitPrice'))}</th>
      <th scope="col" class="num">${esc(t(l, 'pi.col.amount'))}</th>
    </tr></thead>
    <tbody><tr>
      <td class="item"><bdi>${esc(v.product)}</bdi>${v.sku ? `<span class="pi-sku">${iso(v.sku)}</span>` : ''}</td>
      <td class="num" data-label="${esc(t(l, 'pi.col.quantity'))}">${iso(qty)}</td>
      <td class="num" data-label="${esc(t(l, 'pi.col.unitPrice'))}">${iso(show.money(l, v.unitPrice))}</td>
      <td class="num" data-label="${esc(t(l, 'pi.col.amount'))}">${iso(show.money(l, v.total))}</td>
    </tr></tbody>
  </table>

  <dl class="pi-sum">
    ${sumRow(t(l, 'pi.total'), show.money(l, v.total), due ? '' : ' pi-due')}
    ${v.sampleCredit && due ? `${less(v.sampleCredit)}
    ${sumRow(t(l, 'pi.due'), show.money(l, due), ' pi-due')}` : ''}
  </dl>

  <dl class="pi-terms">
    ${term(t(l, 'pi.incoterm'), v.incoterm)}
    ${term(t(l, 'pi.payment'), v.paymentTerms)}
  </dl>

  <footer class="pi-foot">
    <p>${esc(t(l, 'pi.what'))}</p>
    ${/* A name that ends its own sentence ("Westlake Canvas Co.") takes no second full stop. */ ''}<p>${esc(t(l, 'pi.questions', { seller: show.isolate(l, v.seller) }).replace(/\.(\u2069?)\.$/, '.$1'))}</p>
  </footer>
</article>`;

    return publicDocument({
      locale: l, title: t(l, 'pi.title', { seller: v.seller, reference: v.reference }), noindex: true,
      mainClass: 'pi', extraCss: PROFORMA_CSS, body,
    });
  });
}

/** The document's own rules; the tokens and base rules are publicDocument's. Ink on the sheet, nothing of the brand. */
const PROFORMA_CSS = `
  main.pi { max-width:var(--measure-column); padding:var(--space-32) var(--space-16) var(--space-48); }
  .pi-sheet { max-width:var(--measure-column); margin:0 auto; background:var(--color-surface); border:1px solid var(--color-border);
              padding:var(--space-48); display:grid; gap:var(--space-32); }
  .pi-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-start; gap:var(--space-24);
             padding-bottom:var(--space-24); border-bottom:2px solid var(--color-ink); }
  .pi-from { min-width:0; flex:1 1 16rem; }
  .pi-seller { font-size:var(--font-size-display); line-height:var(--line-height-tight); font-weight:700;
               letter-spacing:var(--tracking-tight); color:var(--color-ink); }
  .pi-address { margin-top:var(--space-8); color:var(--color-ink-secondary); font-size:var(--font-size-small); white-space:pre-line; }
  .pi-doc { flex:0 1 auto; text-align:end; }
  .pi h1 { font-size:var(--font-size-small); font-weight:700; letter-spacing:.12em; text-transform:uppercase;
           margin:0 0 var(--space-12); color:var(--color-ink); }
  .pi-meta { margin:0; display:grid; gap:var(--space-4); font-size:var(--font-size-small); }
  .pi-meta div { display:flex; justify-content:flex-end; gap:var(--space-12); }
  .pi-meta dt { color:var(--color-ink-secondary); }
  .pi-meta dd { margin:0; font-weight:600; font-variant-numeric:tabular-nums; }
  .pi-label, .pi-lines th, .pi-term dt { font-size:var(--font-size-caption); font-weight:600; letter-spacing:.08em;
              text-transform:uppercase; color:var(--color-ink-secondary); }
  .pi-buyer { margin-top:var(--space-4); font-size:var(--font-size-title); font-weight:600; }
  .pi-lines { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  .pi-lines th { text-align:start; padding:0 0 var(--space-8); border-bottom:1px solid var(--color-ink); }
  .pi-lines td { padding:var(--space-16) 0; border-bottom:1px solid var(--color-border); vertical-align:top; }
  .pi-lines .num { text-align:end; padding-inline-start:var(--space-24); white-space:nowrap; }
  .pi-lines td.item { font-weight:600; }
  .pi-sku { display:block; margin-top:var(--space-4); font-weight:400; font-size:var(--font-size-small);
            color:var(--color-ink-secondary); white-space:nowrap; }
  .pi-sum { margin:calc(-1 * var(--space-16)) 0 0 auto; width:min(24rem, 100vw); display:grid; font-variant-numeric:tabular-nums; }
  .pi-sumrow { display:flex; justify-content:space-between; align-items:baseline; gap:var(--space-24); padding:var(--space-8) 0; }
  .pi-sumrow dt { color:var(--color-ink-secondary); }
  .pi-sumrow dd { margin:0; font-weight:600; }
  .pi-sumrow.pi-due { border-top:2px solid var(--color-ink); margin-top:var(--space-4); padding-top:var(--space-12); }
  .pi-sumrow.pi-due dt { color:var(--color-ink); font-weight:700; }
  .pi-sumrow.pi-due dd { font-size:var(--font-size-title); font-weight:700; }
  .pi-terms { margin:0; display:grid; gap:var(--space-12); padding:var(--space-16) 0 0; border-top:1px solid var(--color-border); }
  .pi-term { display:grid; grid-template-columns:12rem 1fr; gap:var(--space-16); align-items:baseline; }
  .pi-term dd { margin:0; min-width:0; overflow-wrap:anywhere; }
  .pi-foot { border-top:1px solid var(--color-border); padding-top:var(--space-16); }
  .pi-foot p { margin:0 0 var(--space-4); font-size:var(--font-size-small); }
  @media (max-width: 560px) {
    main.pi { padding:0; }
    .pi-sheet { border:0; padding:var(--space-24) var(--space-16) var(--space-32); gap:var(--space-24); }
    .pi-doc { text-align:start; flex-basis:100%; }
    .pi-meta div { justify-content:flex-start; }
    .pi-lines thead { display:none; }
    .pi-lines tr { display:grid; gap:var(--space-8); padding:var(--space-16) 0; border-bottom:1px solid var(--color-border);
                   border-top:1px solid var(--color-ink); }
    .pi-lines td { display:flex; justify-content:space-between; gap:var(--space-16); padding:0; border:0; }
    .pi-lines td.item { display:block; }
    .pi-lines td[data-label]::before { content:attr(data-label); color:var(--color-ink-secondary); font-weight:400; }
    .pi-lines .num { padding-inline-start:0; }
    .pi-sum { margin-top:0; width:auto; }
    .pi-term { grid-template-columns:1fr; gap:var(--space-4); }
  }
  @media print {
    @page { size:A4; margin:16mm; }
    body { background:var(--color-surface); }
    main.pi { padding:0; max-width:100%; }
    .pi-sheet { border:0; padding:0; max-width:100%; }
  }
`;
