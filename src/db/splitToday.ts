import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { moneyFromRow, type Money } from '../core/types/money.js';
import { SPEND_STATUSES } from './customerValue.js';
import { PRICE_GIVEN } from './quotesGiven.js';
import { notOwnerTesting } from './handled.js';
import { faceVersions } from './faces.js';
import { productPhotoPath } from './productPhotos.js';
import { stageFacts, type Stage } from './customerStage.js';
import { defaultPeriod } from './booksReports.js';
import { statusOf, type InvoiceStatus } from './booksInvoices.js';
import { parseDecimal } from '../core/types/decimal.js';

/**
 * TODAY'S FIGURES. A read model: it writes nothing and every
 * number is read from rows the product already keeps, by the definitions the other pages read — a price given is
 * `PRICE_GIVEN`, an order that stands is `SPEND_STATUSES`, the owner's own test conversations count for nothing
 * (`notOwnerTesting`). "This month" is the workspace's own month, in its own zone.
 *
 * Money is summed in one currency: the workspace's for sales, the books' for the books. A row in another currency is
 * counted and left out of the sum, and the page says so; nothing is converted.
 */

export type RecentCustomer = {
  readonly conversationId: string;
  readonly clientId: string;
  readonly name: string | null;
  readonly photo: string | null;
  readonly product: string | null;
  readonly thumb: string | null;
  readonly stage: Stage;
  readonly value: Money | null;
  readonly lastAt: Date | null;
};

export type SplitSales = {
  /** The business's kind: whether a sample is a stage here at all is the page's to ask. */
  readonly kind: string | null;
  readonly asked: number;
  /** Counts include every currency; values include only the workspace currency, or null when none match. */
  readonly price: { readonly count: number; readonly value: Money | null; readonly otherCurrency: number };
  readonly sample: { readonly count: number; readonly open: number };
  readonly order: { readonly count: number; readonly value: Money | null; readonly otherCurrency: number };
  readonly recent: readonly RecentCustomer[];
};

/** How many customers the Sales panel lists. */
export const RECENT_CUSTOMERS = 4;

/** Midnight on the first of this month, in the workspace's zone. */
const monthStart = (zone: string, now: Date) =>
  sql<Date>`(date_trunc('month', ${now}::timestamptz at time zone ${zone}) at time zone ${zone})`;

export async function loadSplitSales(tx: Tx, B: BusinessId, zone: string, now: Date): Promise<SplitSales> {
  const start = monthStart(zone, now);
  const r = (await sql<{
    kind: string | null; currency: string; asked: number; price_n: number; price_v: string; price_other: number;
    samples: number; samples_open: number; orders: number; order_v: string; order_other: number;
  }>`
    with b as (select kind, currency from businesses where id = ${B}::uuid),
    given as (
      select distinct on (q.conversation_id) q.total_usd as total, q.currency
        from quotes q
       where q.business_id = ${B}::uuid and q.created_at >= ${start} and ${PRICE_GIVEN} and ${notOwnerTesting('q.conversation_id')}
       order by q.conversation_id, q.created_at desc
    ),
    standing as (
      select o.total_value_usd as total, o.currency from orders o
       where o.business_id = ${B}::uuid and o.status = any(${[...SPEND_STATUSES]}::text[])
         and coalesce(o.confirmed_at, o.created_at) >= ${start} and ${notOwnerTesting('o.conversation_id')}
    )
    select b.kind, b.currency,
      (select count(distinct c.client_id)::int from messages m join conversations c on c.id = m.conversation_id
        where c.business_id = ${B}::uuid and m.direction = 'inbound' and m.sent_at >= ${start} and not c.owner_testing) as asked,
      (select count(*)::int from given) as price_n,
      (select count(*) filter (where currency is distinct from b.currency)::int from given) as price_other,
      (select coalesce(sum(total) filter (where currency = b.currency), 0)::text from given) as price_v,
      (select count(*)::int from sample_requests s where s.business_id = ${B}::uuid and s.requested_at >= ${start} and ${notOwnerTesting('s.conversation_id')}) as samples,
      (select count(*)::int from sample_requests s where s.business_id = ${B}::uuid and s.requested_at >= ${start} and s.handled_at is null and ${notOwnerTesting('s.conversation_id')}) as samples_open,
      (select count(*)::int from standing) as orders,
      (select count(*) filter (where currency is distinct from b.currency)::int from standing) as order_other,
      (select coalesce(sum(total) filter (where currency = b.currency), 0)::text from standing) as order_v
    from b`.execute(tx)).rows[0];
  if (!r) return { kind: null, asked: 0, price: { count: 0, value: null, otherCurrency: 0 }, sample: { count: 0, open: 0 }, order: { count: 0, value: null, otherCurrency: 0 }, recent: [] };
  return {
    kind: r.kind,
    asked: r.asked,
    price: { count: r.price_n, value: r.price_n > r.price_other ? moneyFromRow(r.price_v, r.currency) : null, otherCurrency: r.price_other },
    sample: { count: r.samples, open: r.samples_open },
    order: { count: r.orders, value: r.orders > r.order_other ? moneyFromRow(r.order_v, r.currency) : null, otherCurrency: r.order_other },
    recent: await loadRecent(tx, B),
  };
}

/**
 * The customers written to or heard from most recently, one row each, each at the furthest stage their conversation
 * has reached: an order that stands, a sample asked for, a price given, else asked. The value is that order's total or
 * that price's; a stage with no figure has none.
 */
async function loadRecent(tx: Tx, B: BusinessId): Promise<RecentCustomer[]> {
  const rows = (await sql<{ conversation_id: string; client_id: string; name: string | null; last_at: Date | null }>`
    with latest as (
      select distinct on (c.client_id) c.id, c.client_id, cl.display_name as name, cs.identified_product_id as product_id,
             (select max(m.sent_at) from messages m where m.conversation_id = c.id) as last_at
        from conversations c join clients cl on cl.id = c.client_id left join conversation_state cs on cs.conversation_id = c.id
       where c.business_id = ${B}::uuid and not c.owner_testing and c.client_id is not null
         and exists (select 1 from messages m where m.conversation_id = c.id)
       order by c.client_id, last_at desc nulls last
    )
    select l.id::text as conversation_id, l.client_id::text as client_id, l.name, l.last_at
      from latest l
     order by l.last_at desc nulls last limit ${RECENT_CUSTOMERS + 1}`.execute(tx)).rows;
  const photos = await faceVersions(tx, rows.map((x) => x.client_id));
  const facts = await stageFacts(tx, rows.map((x) => x.conversation_id));
  return rows.map((x) => {
    const f = facts.get(x.conversation_id);
    return {
      conversationId: x.conversation_id, clientId: x.client_id, name: x.name, photo: photos.get(x.client_id) ?? null,
      product: f?.product ?? null, thumb: f?.thumb ?? null, stage: f?.stage ?? 'asked', value: f?.value ?? null, lastAt: x.last_at,
    };
  });
}

export type DecisionExtras = { readonly clientId: string | null; readonly photo: string | null; readonly thumb: string | null };

/** For the decision card: the customer and their photo, and the photo of the product the conversation is about. */
export async function decisionExtras(tx: Tx, conversationId: string): Promise<DecisionExtras> {
  const r = (await sql<{ client_id: string | null; token: string | null }>`
    select c.client_id::text as client_id,
           (select i.token from product_images i where i.product_id = cs.identified_product_id and i.token is not null limit 1) as token
      from conversations c left join conversation_state cs on cs.conversation_id = c.id where c.id = ${conversationId}::uuid`.execute(tx)).rows[0];
  const photo = r?.client_id ? (await faceVersions(tx, [r.client_id])).get(r.client_id) ?? null : null;
  return { clientId: r?.client_id ?? null, photo, thumb: r?.token ? productPhotoPath(r.token) : null };
}

// ── The books ────────────────────────────────────────────────────────────────

export type OverdueCustomer = {
  readonly invoiceId: string;
  readonly party: string;
  readonly owed: string;
  readonly currency: string;
  readonly daysLate: number;
  /** Set only where the invoice was made from a Nomi order: a party is the books' record, not a customer. */
  readonly conversationId: string | null;
  readonly clientId: string | null;
  readonly photo: string | null;
};

/**
 * The latest entries, newest first: one row per invoice, with where it stands now, and money the bank received that belongs
 * to no invoice yet. A payment recorded against an invoice is that invoice's "Paid", never a row of its own.
 */
export type BooksEntry = {
  readonly kind: 'invoice' | 'payment';
  /** The invoice, or the bank line. */
  readonly id: string;
  /** From the invoice; a bank line's own wording, which it may not have. */
  readonly party: string | null;
  readonly amount: string;
  readonly currency: string;
  /** The latest event on the record: a paid invoice's last payment, any other's issue date, a bank line's booked date. */
  readonly on: string;
  /** Where an invoice stands; a payment is simply a payment. */
  readonly status: InvoiceStatus | null;
  readonly clientId: string | null;
  readonly photo: string | null;
};

export const RECENT_ENTRIES = 5;

export type SplitBooks = {
  readonly currency: string;
  readonly moneyIn: string;
  readonly moneyOut: string;
  readonly profit: string;
  /** Profit so far this fiscal year, at the end of each month that has begun: at most one a month, oldest first. */
  readonly trend: readonly { readonly month: string; readonly value: number }[];
  readonly owed: {
    readonly count: number; readonly total: string; readonly overdue: number;
    /** Open invoices in another currency: counted, left out of the total. */
    readonly otherCurrency: number;
    readonly worst: OverdueCustomer | null;
  };
  /** Bank lines not yet matched for which the rule found a posted payment: what the bank page offers to approve. */
  readonly matched: number;
  readonly year: { readonly startsOn: string; readonly endsOn: string; readonly state: 'open' | 'closed' } | null;
  readonly entries: readonly BooksEntry[];
};

export async function loadSplitBooks(tx: Tx, businessId: string, today: string): Promise<SplitBooks> {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const period = await defaultPeriod(tx, businessId, today);
  // A closing entry moves the year's result to equity: it is not money in or out.
  const counted = sql`e.state = 'posted' and j.kind <> 'closing'`;
  const m = (await sql<{ currency: string; money_in: string; money_out: string }>`
    select books_currency(${businessId}::uuid) as currency,
      coalesce((select sum(l.book_credit - l.book_debit) from journal_lines l join journal_entries e on e.id = l.entry_id
         join journals j on j.id = e.journal_id join accounts a on a.id = l.account_id
        where l.business_id = ${businessId}::uuid and ${counted} and a.kind = 'income' and e.entry_date between ${firstOfMonth}::date and ${today}::date), 0)::text as money_in,
      coalesce((select sum(l.book_debit - l.book_credit) from journal_lines l join journal_entries e on e.id = l.entry_id
         join journals j on j.id = e.journal_id join accounts a on a.id = l.account_id
        where l.business_id = ${businessId}::uuid and ${counted} and a.kind = 'expense' and e.entry_date between ${firstOfMonth}::date and ${today}::date), 0)::text as money_out`
    .execute(tx)).rows[0]!;
  const profit = (await sql<{ p: string }>`select (${m.money_in}::numeric - ${m.money_out}::numeric)::text as p`.execute(tx)).rows[0]!.p;

  const trend = (await sql<{ month: string; value: string }>`
    with months as (
      select generate_series(date_trunc('month', ${period.from}::date), date_trunc('month', ${today}::date), interval '1 month')::date as month
    ), moved as (
      select date_trunc('month', e.entry_date)::date as month, sum(l.book_credit - l.book_debit) as n
        from journal_lines l join journal_entries e on e.id = l.entry_id join journals j on j.id = e.journal_id join accounts a on a.id = l.account_id
       where l.business_id = ${businessId}::uuid and ${counted} and a.kind in ('income', 'expense')
         and e.entry_date between ${period.from}::date and ${today}::date
       group by 1
    )
    select to_char(mo.month, 'YYYY-MM-DD') as month, (sum(coalesce(v.n, 0)) over (order by mo.month))::text as value
      from months mo left join moved v on v.month = mo.month order by mo.month`.execute(tx)).rows
    .map((r) => ({ month: r.month, value: Number(r.value) }));

  const owedRows = sql`
    select i.id, coalesce(i.party_name, p.name) as party, i.due_date, i.currency, i.source_order_id,
           invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id) as owed
      from invoices i join parties p on p.id = i.party_id
     where i.business_id = ${businessId}::uuid and i.state = 'issued'`;
  const o = (await sql<{ n: number; total: string; overdue: number; other: number }>`
    select count(*) filter (where v.currency = bc.c)::int as n,
           coalesce(sum(v.owed) filter (where v.currency = bc.c), 0)::text as total,
           count(*) filter (where v.due_date < ${today}::date)::int as overdue,
           count(*) filter (where v.currency <> bc.c)::int as other
      from (${owedRows}) v, (select books_currency(${businessId}::uuid) as c) bc where v.owed > 0`.execute(tx)).rows[0]!;
  const w = (await sql<{ id: string; party: string; owed: string; currency: string; days: number; conversation_id: string | null; client_id: string | null }>`
    select v.id::text as id, v.party, v.owed::text as owed, v.currency, (${today}::date - v.due_date)::int as days,
           r.conversation_id::text as conversation_id, r.client_id::text as client_id
      from (${owedRows}) v left join orders r on r.id = v.source_order_id
     where v.owed > 0 and v.due_date < ${today}::date
     order by v.due_date, v.owed desc limit 1`.execute(tx)).rows[0];
  const photo = w?.client_id ? (await faceVersions(tx, [w.client_id])).get(w.client_id) ?? null : null;

  // The rule `openLines` offers (bankStatements.ts), counted: the same account and currency, the same amount, within a week.
  const matched = (await sql<{ n: number }>`
    select count(*)::int as n
      from (select id, business_id, account_id, currency, booked_on, amount as figure from statement_lines where business_id = ${businessId}::uuid) s
     where not exists (select 1 from statement_matches m where m.statement_line_id = s.id and m.unmatched_at is null)
       and exists (select 1 from journal_lines jl join journal_entries e on e.id = jl.entry_id
        where jl.business_id = s.business_id and jl.account_id = s.account_id and e.state = 'posted' and jl.currency = s.currency
          and (case when s.figure > 0 then jl.debit = s.figure else jl.credit = -s.figure end)
          and abs(e.entry_date - s.booked_on) <= 7
          and not exists (select 1 from statement_matches m where m.journal_line_id = jl.id and m.unmatched_at is null))`.execute(tx)).rows[0]!.n;

  // A bank line belongs to an invoice once it is matched to that invoice's payment, or when the bank page's rule (the same one
  // as `matched` above) would offer one to approve.
  const entryRows = (await sql<{ kind: 'invoice' | 'payment'; id: string; party: string | null; amount: string; currency: string; on_day: string; state: string | null;
    total: string | null; credited: string | null; paid: string | null; due_date: string | null; client_id: string | null }>`
    select e.* from (
      select 'invoice' as kind, i.id::text as id, coalesce(i.party_name, pa.name) as party, invoice_total(i.id)::text as amount, i.currency,
             -- The latest event, as the owner set it: a paid invoice's last payment, any other's issue date.
             (case when invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id) <= 0
                   then coalesce((select max(ip.paid_on) from invoice_payments ip where ip.invoice_id = i.id and ip.kind <> 'refund'), i.issue_date)
                   else i.issue_date end)::text as on_day,
             i.state, invoice_total(i.id)::text as total, invoice_credited(i.id)::text as credited, invoice_paid(i.id)::text as paid,
             i.due_date::text as due_date, o.client_id::text as client_id, i.created_at as at
        from invoices i join parties pa on pa.id = i.party_id left join orders o on o.id = i.source_order_id
       where i.business_id = ${businessId}::uuid and i.state = 'issued'
      union all
      select 'payment', s.id::text, s.wording, s.figure::text, s.currency, s.booked_on::text,
             null, null, null, null, null, null, s.booked_on::timestamptz
        from (select id, business_id, account_id, currency, booked_on, wording, amount as figure from statement_lines where business_id = ${businessId}::uuid) s
       where s.figure > 0
         and not exists (select 1 from statement_matches m join journal_lines jl on jl.id = m.journal_line_id join invoice_payments ip on ip.entry_id = jl.entry_id
                          where m.statement_line_id = s.id and m.unmatched_at is null)
         and not exists (select 1 from journal_lines jl join journal_entries je on je.id = jl.entry_id join invoice_payments ip on ip.entry_id = jl.entry_id
                          where jl.business_id = s.business_id and jl.account_id = s.account_id and je.state = 'posted' and jl.currency = s.currency
                            and jl.debit = s.figure and abs(je.entry_date - s.booked_on) <= 7
                            and not exists (select 1 from statement_matches m where m.journal_line_id = jl.id and m.unmatched_at is null))
    ) e
    order by e.on_day desc, e.at desc limit ${RECENT_ENTRIES}`.execute(tx)).rows;
  const entryFaces = await faceVersions(tx, entryRows.flatMap((r) => (r.client_id ? [r.client_id] : [])));
  const entries: BooksEntry[] = entryRows.map((r) => ({
    kind: r.kind, id: r.id, party: r.party, amount: r.amount, currency: r.currency, on: r.on_day,
    status: r.kind === 'payment' ? null : statusOf(r.state!, parseDecimal(r.total!)!, parseDecimal(r.credited!)!, parseDecimal(r.paid!)!, r.due_date, today),
    clientId: r.client_id, photo: r.client_id ? entryFaces.get(r.client_id) ?? null : null,
  }));

  const y = (await sql<{ starts_on: string; ends_on: string; state: 'open' | 'closed' }>`
    select starts_on::text as starts_on, ends_on::text as ends_on, state from fiscal_years
     where business_id = ${businessId}::uuid and starts_on <= ${today}::date and ends_on >= ${today}::date`.execute(tx)).rows[0];

  return {
    currency: m.currency, moneyIn: m.money_in, moneyOut: m.money_out, profit, trend,
    owed: {
      count: o.n, total: o.total, overdue: o.overdue, otherCurrency: o.other,
      worst: w ? { invoiceId: w.id, party: w.party, owed: w.owed, currency: w.currency, daysLate: w.days, conversationId: w.conversation_id, clientId: w.client_id, photo } : null,
    },
    matched,
    entries,
    year: y ? { startsOn: y.starts_on, endsOn: y.ends_on, state: y.state } : null,
  };
}
