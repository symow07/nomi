import { sql } from 'kysely';
import type { Tx } from './client.js';
import { parseDecimal } from '../core/types/decimal.js';
import { draftEntry, type EntryRefusal } from './booksEntries.js';

/**
 * C1 (Phase 5, item 3; 0183) — AN ENTRY FROM A NOMI ORDER. A confirmed order (confirmed, in production or shipped —
 * never one waiting, never one cancelled) is a sale: a draft in the owner's sales journal, debit the receivable
 * account, credit the sales account, in the order's currency, on the day it was confirmed, its document the order's
 * reference. Once: the database keeps one entry per order that is not discarded. The accounts are the owner's choice
 * (`saveBooksAccounts`); tax and the buyer as a party come with C2's invoices.
 */
export type OrderToEnter = {
  readonly id: string; readonly reference: string; readonly confirmedOn: string; readonly total: string; readonly currency: string;
  readonly buyer: string | null;
};

export async function ordersToEnter(tx: Tx, businessId: string): Promise<OrderToEnter[]> {
  return (await sql<OrderToEnter>`
    select o.id::text as id, o.order_reference as reference, coalesce(o.confirmed_at, o.created_at)::date::text as "confirmedOn",
           o.total_value_usd::text as total, o.currency, c.display_name as buyer
      from orders o left join clients c on c.id = o.client_id
     where o.business_id = ${businessId}::uuid and o.status in ('confirmed', 'in_production', 'shipped')
       and o.total_value_usd > 0
       and not exists (select 1 from journal_entries e where e.business_id = o.business_id and e.source_order_id = o.id and e.state <> 'discarded')
     order by coalesce(o.confirmed_at, o.created_at), o.order_reference limit 100`.execute(tx)).rows;
}

export type BooksAccounts = {
  readonly salesJournalId: string | null; readonly receivableAccountId: string | null; readonly salesAccountId: string | null;
  readonly fxLossAccountId: string | null; readonly fxGainAccountId: string | null;
};

export async function booksAccountsOf(tx: Tx, businessId: string): Promise<BooksAccounts> {
  const r = (await sql<{ sj: string | null; ra: string | null; sa: string | null; fl: string | null; fg: string | null }>`
    select sales_journal_id::text as sj, receivable_account_id::text as ra, sales_account_id::text as sa,
           fx_loss_account_id::text as fl, fx_gain_account_id::text as fg
      from books_settings where business_id = ${businessId}::uuid`.execute(tx)).rows[0];
  return { salesJournalId: r?.sj ?? null, receivableAccountId: r?.ra ?? null, salesAccountId: r?.sa ?? null,
    fxLossAccountId: r?.fl ?? null, fxGainAccountId: r?.fg ?? null };
}

/** The owner's choice; ids the workspace does not hold are refused by the database's own keys. */
export async function saveBooksAccounts(tx: Tx, businessId: string, a: BooksAccounts): Promise<void> {
  await sql`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id)
    values (${businessId}::uuid, ${a.salesJournalId}::uuid, ${a.receivableAccountId}::uuid, ${a.salesAccountId}::uuid, ${a.fxLossAccountId}::uuid, ${a.fxGainAccountId}::uuid)
    on conflict (business_id) do update set sales_journal_id = excluded.sales_journal_id, receivable_account_id = excluded.receivable_account_id,
      sales_account_id = excluded.sales_account_id, fx_loss_account_id = excluded.fx_loss_account_id, fx_gain_account_id = excluded.fx_gain_account_id`.execute(tx);
}

export async function draftFromOrder(tx: Tx, businessId: string, orderId: string, by: string):
  Promise<{ readonly kind: 'drafted'; readonly id: string } | EntryRefusal | { readonly kind: 'refused'; readonly reason: 'accounts_not_set' | 'not_an_order'; readonly detail: null }> {
  const a = await booksAccountsOf(tx, businessId);
  if (!a.salesJournalId || !a.receivableAccountId || !a.salesAccountId) return { kind: 'refused', reason: 'accounts_not_set', detail: null };
  const order = (await ordersToEnter(tx, businessId)).find((o) => o.id === orderId);
  const total = order ? parseDecimal(order.total) : null;
  if (!order || total === null) return { kind: 'refused', reason: 'not_an_order', detail: null };
  // Two drafts of one order at once: the database's index keeps one; the other is told it is already entered.
  try {
    return await draftEntry(tx, businessId, by, {
    journalId: a.salesJournalId, date: order.confirmedOn, label: order.buyer ? `${order.reference} · ${order.buyer}`.slice(0, 200) : order.reference,
    documentRef: order.reference, documentDate: order.confirmedOn, sourceOrderId: order.id,
    lines: [
      { accountId: a.receivableAccountId, partyId: null, taxCodeId: null, currency: order.currency, debit: total, credit: null, label: null, isFx: false },
      { accountId: a.salesAccountId, partyId: null, taxCodeId: null, currency: order.currency, debit: null, credit: total, label: null, isFx: false },
    ],
    });
  } catch (e) {
    if (String((e as { code?: unknown } | null)?.code ?? '') === '23505') return { kind: 'refused', reason: 'not_an_order', detail: null };
    throw e;
  }
}
