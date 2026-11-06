import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { invoiceKey, loadInvoice, owedOn } from './booksInvoices.js';
import { addDecimal, type Decimal } from '../core/types/decimal.js';
import type { InvoicePdfView } from '../core/books/invoicePdf.js';

/**
 * 0226 — INVOICES THAT GO OUT: the switch, what an invoice needs to be sent, and the record of each send.
 *
 * The switch is `books_settings.invoice_sending`, the owner's, off until turned on. Off: nothing is sent, no reminder
 * is due, and the order-confirmed reply promises no invoice (templates.ts). On: the owner can send an issued invoice
 * from its page or from the conversation, reminders go at +3 and +10 days (invoiceReminders.ts), and the reply says
 * the invoice comes next.
 *
 * An invoice reaches a customer only through the ORDER it was made from (`invoices.source_order_id`): the order names
 * the conversation, and the conversation its channel. An invoice typed by hand, with no order, has no conversation to
 * go in — the page says so.
 */

export async function invoiceSendingOn(tx: Tx, businessId: BusinessId | string): Promise<boolean> {
  return (await sql<{ on: boolean }>`select invoice_sending as "on" from books_settings where business_id = ${businessId}::uuid`
    .execute(tx)).rows[0]?.on === true;
}

export async function setInvoiceSending(tx: Tx, businessId: BusinessId, on: boolean): Promise<void> {
  await sql`insert into books_settings (business_id, invoice_sending) values (${businessId}::uuid, ${on})
    on conflict (business_id) do update set invoice_sending = excluded.invoice_sending, updated_at = now()`.execute(tx);
}

/** Channels that carry a file: the invoice goes as a PDF. Every other channel gets the order's proforma link. */
export const DOCUMENT_CHANNELS: readonly string[] = ['whatsapp', 'messenger', 'telegram', 'email'];

export type SendableInvoice = {
  readonly id: string;
  readonly key: string | null;
  readonly state: string;
  readonly currency: string;
  readonly owed: string;
  readonly party: string;
  readonly orderId: string | null;
  readonly conversationId: string | null;
  readonly channel: string | null;
  /** Phase 2c — whether the order has what a proforma needs, so its link can be made. */
  readonly proformaReady: boolean;
  readonly business: string;
};

export async function sendableInvoice(tx: Tx, businessId: BusinessId, invoiceId: string): Promise<SendableInvoice | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  const r = (await sql<{ id: string; year: number | null; number: number | null; state: string; currency: string; owed: string; party: string;
    order_id: string | null; conversation_id: string | null; channel: string | null; proforma_ready: boolean | null; business: string }>`
    select i.id::text as id, i.year, i.number, i.state, i.currency,
           (invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id))::text as owed,
           coalesce(i.party_name, p.name) as party,
           o.id::text as order_id, o.conversation_id::text as conversation_id, c.channel,
           (o.agreed_unit_price_usd is not null and o.total_value_usd is not null
            and o.payment_terms is not null and o.incoterm is not null) as proforma_ready,
           b.name as business
      from invoices i
      join parties p on p.id = i.party_id
      join businesses b on b.id = i.business_id
      left join orders o on o.id = i.source_order_id
      left join conversations c on c.id = o.conversation_id
     where i.business_id = ${businessId}::uuid and i.id = ${invoiceId}::uuid`.execute(tx)).rows[0];
  if (!r) return null;
  return {
    id: r.id, key: r.number === null ? null : invoiceKey(r.year!, r.number), state: r.state, currency: r.currency, owed: r.owed,
    party: r.party, orderId: r.order_id, conversationId: r.conversation_id, channel: r.channel,
    proformaReady: r.proforma_ready === true, business: r.business,
  };
}

/** The issued invoices made from one order (one, by 0187's index — read as a list all the same), newest first. */
export async function invoicesOfOrder(tx: Tx, businessId: BusinessId, orderId: string): Promise<readonly { id: string; key: string; owed: string; currency: string }[]> {
  return (await sql<{ id: string; year: number; number: number; owed: string; currency: string }>`
    select i.id::text as id, i.year, i.number, i.currency, (invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id))::text as owed
      from invoices i where i.business_id = ${businessId}::uuid and i.source_order_id = ${orderId}::uuid and i.state = 'issued'
     order by i.issued_at desc`.execute(tx)).rows
    .map((r) => ({ id: r.id, key: invoiceKey(r.year, r.number), owed: r.owed, currency: r.currency }));
}

export async function recordInvoiceSend(tx: Tx, businessId: BusinessId, s: {
  readonly invoiceId: string; readonly conversationId: string; readonly outboundId: string;
  readonly channel: string; readonly carried: 'pdf' | 'link'; readonly by: string; readonly now: Date;
}): Promise<void> {
  await sql`insert into invoice_sends (business_id, invoice_id, conversation_id, outbound_id, channel, carried, sent_by, sent_at)
    values (${businessId}::uuid, ${s.invoiceId}::uuid, ${s.conversationId}::uuid, ${s.outboundId}::uuid, ${s.channel}, ${s.carried}, ${s.by}, ${s.now})`
    .execute(tx);
}

export type InvoiceSendHistory = {
  readonly sends: readonly { readonly at: Date; readonly channel: string; readonly carried: 'pdf' | 'link' }[];
  readonly reminders: readonly { readonly nth: 1 | 2; readonly at: Date; readonly sent: boolean }[];
};

/** For the invoice's page: when it went, how, and which reminders followed. */
export async function invoiceSendHistory(tx: Tx, businessId: BusinessId, invoiceId: string): Promise<InvoiceSendHistory> {
  const sends = (await sql<{ at: Date; channel: string; carried: 'pdf' | 'link' }>`
    select sent_at as at, channel, carried from invoice_sends where business_id = ${businessId}::uuid and invoice_id = ${invoiceId}::uuid
     order by sent_at`.execute(tx)).rows;
  const reminders = (await sql<{ nth: 1 | 2; at: Date; sent: boolean }>`
    select nth, coalesce(sent_at, drafted_at) as at, sent_at is not null as sent from invoice_reminders
     where business_id = ${businessId}::uuid and invoice_id = ${invoiceId}::uuid order by nth`.execute(tx)).rows;
  return { sends, reminders };
}

/**
 * The invoice as the PDF draws it (core/books/invoicePdf.ts): the business as the books print it on the invoice's
 * page (its name, postal address, ICE / IF / RC where held), the party as copied at issue, the lines and the totals.
 */
export async function invoicePdfViewOf(tx: Tx, businessId: BusinessId, invoiceId: string, today: string): Promise<InvoicePdfView | null> {
  const v = await loadInvoice(tx, businessId, invoiceId, today);
  if (!v || v.key === null || v.status === 'draft' || v.status === 'discarded') return null;
  const b = (await sql<{ name: string; address: string | null; ice: string | null; tax_id: string | null; rc: string | null; court: string | null }>`
    select name, postal_address as address, legal_ice as ice, legal_if as tax_id, legal_rc as rc, legal_rc_court as court
      from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!b) return null;
  const sellerLines = [
    ...(b.ice ? [`ICE ${b.ice}`] : []), ...(b.tax_id ? [`IF ${b.tax_id}`] : []),
    ...(b.rc ? [`RC ${b.rc}${b.court ? ` (${b.court})` : ''}`] : []),
  ];
  const bt = v.billedTo;
  const partyLines = [
    ...(bt.country ? [bt.country] : []), ...(bt.ice ? [`ICE ${bt.ice}`] : []), ...(bt.taxNumber ? [`Tax number ${bt.taxNumber}`] : []),
    ...(bt.registry ? [`Registry ${bt.registry}`] : []), ...(bt.siret ? [`SIRET ${bt.siret}`] : []), ...(bt.registro ? [`Registro Mercantil ${bt.registro}`] : []),
  ];
  // Exact, as the books add (core/types/decimal.ts): never floating point over money.
  const net = v.lines.reduce((s, l) => addDecimal(s, l.net), '0' as Decimal);
  const tax = v.lines.reduce((s, l) => addDecimal(s, l.tax), '0' as Decimal);
  return {
    key: v.key,
    seller: { name: b.name, address: b.address, lines: sellerLines },
    billedTo: { name: bt.name, address: bt.address, lines: partyLines },
    issueDate: v.issueDate, dueDate: v.dueDate, currency: v.currency, label: v.label,
    lines: v.lines.map((l) => ({ label: l.label, quantity: l.quantity, unitPrice: l.unitPrice, net: l.net, tax: l.tax, taxCode: l.taxCode })),
    totals: { net, tax, total: v.total, credited: v.credited, paid: v.paid, owed: owedOn(v.total, v.credited, v.paid) },
  };
}
