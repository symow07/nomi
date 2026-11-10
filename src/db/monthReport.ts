import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { zoneOf } from './zone.js';
import { notOwnerTesting } from './handled.js';
import { SPEND_STATUSES } from './customerValue.js';
import { PROBLEM_SIGNAL_KINDS } from '../core/scoring/signals.js';
import { type MonthReport, MINUTES_PER_REPLY_MAX, MINUTES_PER_REPLY_MIN, estimateOf, isMonth } from '../core/report/month.js';
import { type Money, isPositive, moneyFromRow } from '../core/types/money.js';

/**
 * Block 4.3 — "WHAT NOMI DID FOR YOU": one month of a workspace, read from the rows it already keeps
 * (the contract is src/core/report/month.ts; the page src/api/web/monthReport.ts; the e-mail src/pipeline/monthMail.ts).
 *
 * Every figure is a COUNT or a SUM, by the Results page's rules (src/api/web/analytics.ts, src/db/handled.ts):
 *   · nothing in a conversation the owner marked as their own test counts (`notOwnerTesting`);
 *   · a practice copy is another business row, kept out by row security — this reads one workspace's rows only;
 *   · money is one total per currency, never two added together, and a currency this build does not know is dropped.
 * The month is the workspace's own: from midnight on the 1st in its zone to the next 1st, half open.
 *
 * Read inside the caller's tenant transaction (`withTenantTx`), so the page and the e-mail read the same rows the
 * same way.
 */

/** Where a month starts and ends, as instants, in a zone; and the current month there. */
async function bounds(tx: Tx, month: string, zone: string, now: Date): Promise<{ from: Date; to: Date; current: string }> {
  const first = `${month}-01`;
  const r = (await sql<{ from_at: Date; to_at: Date; current: string }>`
    select (${first}::timestamp at time zone ${zone}) as from_at,
           ((${first}::timestamp + interval '1 month') at time zone ${zone}) as to_at,
           to_char(${now}::timestamptz at time zone ${zone}, 'YYYY-MM') as current`.execute(tx)).rows[0]!;
  return { from: r.from_at, to: r.to_at, current: r.current };
}

/** The month after `month`, "YYYY-MM". */
export function nextMonth(month: string): string {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Every month from `first` to `last`, newest first ("YYYY-MM"); empty when `first` is after `last`. */
export function monthsBetween(first: string, last: string): readonly string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) out.unshift(m);
  return out;
}

/**
 * What the month page needs besides the report: the workspace's zone, when it began (`signed_up_at`, else
 * `created_at` — the design spec §1.2), its first month and the current one in that zone, and the picker's months.
 */
export type MonthFrame = {
  readonly zone: string;
  readonly startedAt: Date;
  readonly first: string;
  readonly current: string;
  readonly months: readonly string[];
};

export async function monthFrame(tx: Tx, businessId: BusinessId, now: Date = new Date()): Promise<MonthFrame> {
  const zone = await zoneOf(tx, businessId);
  const r = (await sql<{ started: Date; first: string; current: string }>`
    select coalesce(b.signed_up_at, b.created_at) as started,
           to_char(coalesce(b.signed_up_at, b.created_at) at time zone ${zone}, 'YYYY-MM') as first,
           to_char(${now}::timestamptz at time zone ${zone}, 'YYYY-MM') as current
      from businesses b where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!r) throw new Error('monthFrame: no such business');
  // A workspace whose start reads as after now (a clock, a backfill) still has its current month.
  const first = r.first <= r.current ? r.first : r.current;
  return { zone, startedAt: r.started, first, current: r.current, months: monthsBetween(first, r.current) };
}

const moneyRows = (rows: readonly { currency: string; total: string | null }[]): readonly Money[] =>
  rows.flatMap((r) => {
    const m = r.total === null ? null : moneyFromRow(r.total, r.currency);
    return m !== null && isPositive(m) ? [m] : [];
  });

/**
 * One month of the workspace. `month` is "YYYY-MM" in the workspace's zone; anything else throws (the route answers
 * a bad month before it gets here).
 */
export async function loadMonthReport(tx: Tx, businessId: BusinessId, month: string, now: Date = new Date()): Promise<MonthReport> {
  if (!isMonth(month)) throw new Error(`loadMonthReport: not a month: ${month}`);
  const B = businessId;
  const zone = await zoneOf(tx, B);
  const { from, to } = await bounds(tx, month, zone, now);
  const fromDay = `${month}-01`;
  const toDay = `${nextMonth(month)}-01`;

  // Customers answered — Home's "handled" (src/db/handled.ts), by customer: a reply the assistant wrote went out to
  // them in the month, sent alone or approved or edited by a person (`origin = 'employee'`, a sent status). The
  // owner's own typed replies are not the assistant's. A conversation with no customer row counts as its own customer.
  const answered = (await sql<{ n: number }>`
    select count(distinct coalesce(c.client_id::text, c.id::text))::int as n
      from outbound_messages o join conversations c on c.id = o.conversation_id
     where o.business_id = ${B} and o.origin = 'employee' and o.status in ('sent', 'delivered', 'read')
       and o.sent_at >= ${from} and o.sent_at < ${to} and ${notOwnerTesting('o.conversation_id')}`.execute(tx)).rows[0]!.n;

  // Sent alone — an `auto_sent` event of the month whose words are on the conversation's timeline as sent after it
  // (R5's reading, src/pipeline/spotChecks.ts): a reply queued alone that never left is not counted.
  const alone = (await sql<{ n: number }>`
    select count(*)::int as n from conversation_events e
     where e.business_id = ${B} and e.type = 'auto_sent' and e.created_at >= ${from} and e.created_at < ${to}
       and ${notOwnerTesting('e.conversation_id')}
       and exists (select 1 from messages m
                    where m.conversation_id = e.conversation_id and m.direction = 'outbound'
                      and m.text_content = e.payload->>'body' and m.sent_at >= e.created_at)`.execute(tx)).rows[0]!.n;

  // Drafts decided in the month. Approved (the words unchanged: R1 records "Edit & send" with the same words as
  // approved) or edited count once the words that were sent are on the timeline as sent; rejected, superseded (the
  // owner answered in the channel's own app) and expired (the time to reply ran out) are drafts not sent.
  const drafts = (await sql<{ as_written: number; edited: number; not_sent: number }>`
    select count(*) filter (where d.status = 'approved' and d.left_us)::int as as_written,
           count(*) filter (where d.status = 'edited' and d.left_us)::int as edited,
           count(*) filter (where d.status in ('rejected', 'superseded', 'expired'))::int as not_sent
      from (select d.status,
                   exists (select 1 from messages m
                            where m.conversation_id = d.conversation_id and m.direction = 'outbound'
                              and m.text_content = coalesce(d.sent_text, d.draft_text)
                              and m.sent_at >= d.created_at) as left_us
              from drafts d
             where d.business_id = ${B} and d.decided_at >= ${from} and d.decided_at < ${to}
               and ${notOwnerTesting('d.conversation_id')}) d`.execute(tx)).rows[0]!;
  const replies = {
    alone, drafted: drafts.as_written + drafts.edited, asWritten: drafts.as_written, edited: drafts.edited, notSent: drafts.not_sent,
  };
  // One clock: the existing decided-at month. Acceptance may come after its boundary.
  // Keep the timeline predicate too: this is always a subset of the existing draft totals.
  const followUpsSent = (await sql<{ n: number }>`select count(*)::int as n
    from follow_up_approvals a join drafts d on d.id = a.draft_id
    join outbound_messages o on o.id = a.outbound_id
    join businesses b on b.id = a.business_id
    where a.business_id = ${B}::uuid and b.practice_of is null
      and d.status in ('approved', 'edited') and d.decided_at >= ${from} and d.decided_at < ${to}
      and o.status in ('sent', 'delivered', 'read') and o.body = coalesce(d.sent_text, d.draft_text)
      and ${notOwnerTesting('d.conversation_id')}
      and exists (select 1 from messages m where m.conversation_id = d.conversation_id
        and m.direction = 'outbound' and m.text_content = coalesce(d.sent_text, d.draft_text)
        and m.sent_at >= d.created_at)`.execute(tx)).rows[0]!.n;

  // Time to the first reply — per customer who wrote in the month: from their first message of the month to the
  // first message that reached them after it, whoever wrote it (`messages` holds a reply only once it was sent).
  // Clock time: business hours are free text. Those with no reply since are waiting, and are not in the median.
  // Every read here names the workspace, as every other: the operator's tool reads with a role row security does not filter.
  const first = (await sql<{ measured: number; waiting: number; median: number | null }>`
    with wrote as (
      select c.client_id, case when c.client_id is null then c.id end as lone, min(m.sent_at) as first_at
        from messages m join conversations c on c.id = m.conversation_id
       where c.business_id = ${B} and m.direction = 'inbound' and m.sent_at >= ${from} and m.sent_at < ${to}
         and not c.owner_testing
       group by 1, 2
    ), timed as (
      select w.first_at,
             (select min(o.sent_at) from messages o
               where o.direction = 'outbound' and o.sent_at > w.first_at
                 and o.conversation_id in (select oc.id from conversations oc
                                            where oc.business_id = ${B} and not oc.owner_testing
                                              and ((w.client_id is not null and oc.client_id = w.client_id) or oc.id = w.lone))) as reply_at
        from wrote w
    )
    select count(*) filter (where reply_at is not null)::int as measured,
           count(*) filter (where reply_at is null)::int as waiting,
           (percentile_cont(0.5) within group (order by extract(epoch from reply_at - first_at))
              filter (where reply_at is not null))::float8 as median
      from timed`.execute(tx)).rows[0]!;

  // Orders that stand (`SPEND_STATUSES`), confirmed in the month — the Sales tab's and Today's rule — and their value,
  // one total per currency.
  const spend = [...SPEND_STATUSES];
  const orderRows = (await sql<{ currency: string; n: number; total: string | null }>`
    select o.currency, count(*)::int as n, sum(o.total_value_usd)::text as total
      from orders o
     where o.business_id = ${B} and o.status = any(${spend}::text[])
       and coalesce(o.confirmed_at, o.created_at) >= ${from} and coalesce(o.confirmed_at, o.created_at) < ${to}
       and ${notOwnerTesting('o.conversation_id')}
     group by o.currency order by o.currency`.execute(tx)).rows;

  // Invoices paid in full — issued invoices whose last payment in (refunds aside) is dated in the month and, as of
  // that day, left nothing owed: the total, less credit notes issued by then, less the payments by then net of refunds
  // (the unpaid report's own arithmetic, src/db/booksOwnerReports.ts). An invoice no payment touched is never "paid".
  // The value is what the invoices were for, one total per currency — not the cash received in the month.
  const invoiceRows = (await sql<{ currency: string; n: number; total: string | null }>`
    with last_in as (
      select i.id, i.currency, max(p.paid_on) as paid_on
        from invoices i join invoice_payments p on p.invoice_id = i.id and p.kind = 'in'
       where i.business_id = ${B} and i.state = 'issued'
       group by i.id, i.currency
    )
    select l.currency, count(*)::int as n, sum(invoice_total(l.id))::text as total
      from last_in l
     where l.paid_on >= ${fromDay}::date and l.paid_on < ${toDay}::date
       and invoice_total(l.id)
           - coalesce((select sum(credit_note_total(c.id)) from credit_notes c
                        where c.invoice_id = l.id and c.state = 'issued' and c.issue_date <= l.paid_on), 0)
           - coalesce((select sum(case when x.kind = 'refund' then -x.amount else x.amount end) from invoice_payments x
                        where x.invoice_id = l.id and x.paid_on <= l.paid_on), 0) <= 0
     group by l.currency order by l.currency`.execute(tx)).rows;
  const booksStarted = (await sql<{ any: boolean }>`
    select exists (select 1 from invoices i where i.business_id = ${B} and i.state = 'issued') as any`.execute(tx)).rows[0]!.any;

  // Handed to you — every `handoff` event of the month, by the reason recorded with it: the event's own reason (a
  // hand-off made before any turn, src/pipeline/received.ts), else the problem signal the same turn wrote (one
  // transaction, so the same `created_at`; the first in `PROBLEM_SIGNAL_KINDS` when there were several), else
  // "other". A customer handed over twice counts twice; the owner taking a conversation over is not a hand-off.
  const kinds = [...PROBLEM_SIGNAL_KINDS];
  const handed = (await sql<{ reason: string; n: number }>`
    select r.reason, count(*)::int as n from (
      select coalesce(nullif(e.payload->>'reason', ''),
                      (select s.kind from conversation_signals s
                        where s.conversation_id = e.conversation_id and s.created_at = e.created_at
                          and s.kind = any(${kinds}::text[])
                        order by array_position(${kinds}::text[], s.kind) limit 1),
                      'other') as reason
        from conversation_events e
       where e.business_id = ${B} and e.type = 'handoff' and e.created_at >= ${from} and e.created_at < ${to}
         and ${notOwnerTesting('e.conversation_id')}
    ) r group by r.reason order by n desc, r.reason`.execute(tx)).rows;

  const settings = (await sql<{ minutes: number | null; mail_off: boolean }>`
    select b.report_minutes_per_reply as minutes, (b.month_report_mail_off_at is not null) as mail_off
      from businesses b where b.id = ${B}::uuid`.execute(tx)).rows[0];

  return {
    month, zone, from, to,
    running: now.getTime() < to.getTime(),
    customersAnswered: answered,
    followUpsSent,
    replies,
    firstReply: {
      medianSeconds: first.median === null ? null : Math.round(first.median),
      measured: first.measured,
      waiting: first.waiting,
    },
    orders: { confirmed: orderRows.reduce((n, r) => n + r.n, 0), totals: moneyRows(orderRows) },
    invoicesPaid: { count: invoiceRows.reduce((n, r) => n + r.n, 0), totals: moneyRows(invoiceRows), booksStarted },
    handedToYou: handed.map((r) => ({ reason: r.reason, n: r.n })),
    estimate: estimateOf(settings?.minutes ?? null, replies),
    mailOff: settings?.mail_off ?? false,
  };
}

/**
 * The minutes per reply as the owner typed them (the design spec §2.1): empty clears the setting; otherwise one or two
 * digits, a whole number from 1 to 60. Spaces around it are a browser's; a space inside, a sign, a decimal mark, a
 * word, 0, 61 or three digits are refused, and a refusal changes nothing.
 */
export function readMinutesPerReply(raw: unknown): { readonly ok: true; readonly minutes: number | null } | { readonly ok: false } {
  if (raw === undefined || raw === null) return { ok: true, minutes: null };
  if (typeof raw !== 'string') return { ok: false };
  const typed = raw.trim();
  if (typed === '') return { ok: true, minutes: null };
  if (!/^[0-9]{1,2}$/.test(typed)) return { ok: false };
  const n = Number(typed);
  return n >= MINUTES_PER_REPLY_MIN && n <= MINUTES_PER_REPLY_MAX ? { ok: true, minutes: n } : { ok: false };
}

const auditProfile = (tx: Tx, businessId: BusinessId, actor: string, field: string) =>
  sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${businessId}::uuid, null, 'update_profile', ${actor}, ${JSON.stringify({ fields: [field] })}::jsonb)`.execute(tx);

/** The owner's minutes per reply, or null to show no estimate. Audited by field name when it changed. */
export async function saveMinutesPerReply(tx: Tx, businessId: BusinessId, minutes: number | null, actor: string): Promise<void> {
  const changed = (await sql<{ id: string }>`
    update businesses set report_minutes_per_reply = ${minutes}
     where id = ${businessId}::uuid and report_minutes_per_reply is distinct from ${minutes}::smallint
     returning id::text`.execute(tx)).rows.length > 0;
  if (changed) await auditProfile(tx, businessId, actor, 'report_minutes_per_reply');
}

/**
 * The monthly e-mail on or off (the design spec §3.3). Off is when the owner stopped it, kept until they start it again
 * (the job skips the workspace: `claim_month_reports`, 0231). Audited by field name when it changed.
 */
export async function saveMonthMail(tx: Tx, businessId: BusinessId, on: boolean, actor: string): Promise<void> {
  const changed = (await sql<{ id: string }>`
    update businesses set month_report_mail_off_at = case when ${on}::boolean then null else now() end
     where id = ${businessId}::uuid and (month_report_mail_off_at is null) is distinct from ${on}::boolean
     returning id::text`.execute(tx)).rows.length > 0;
  if (changed) await auditProfile(tx, businessId, actor, 'month_report_mail_off_at');
}

/** A workspace whose monthly e-mail is due, claimed once for the month just ended (`claim_month_reports`, 0231). */
export type MonthReportClaim = { readonly businessId: string; readonly month: string; readonly zone: string };
export type MonthReportOutcome = 'sent' | 'empty' | 'no_address' | 'not_sent' | 'failed';

/**
 * Every workspace whose 1st has reached 08:00 in its zone (and is within its first week), outside the owner's quiet
 * hours, with the e-mail on, not a practice copy, not suspended, begun before the month — each claimed ONCE for the
 * month just ended, so a second run, a retry or a second worker never sends it twice.
 */
export async function claimMonthReports(db: Db, now: Date): Promise<MonthReportClaim[]> {
  return (await sql<{ business_id: string; month: string; zone: string }>`
    select business_id::text as business_id, month, zone from claim_month_reports(${now}::timestamptz)`.execute(db)).rows
    .map((r) => ({ businessId: r.business_id, month: r.month, zone: r.zone }));
}

/** What became of a claimed month's e-mail, on its claim row. */
export async function monthReportDone(db: Db, businessId: string, month: string, outcome: MonthReportOutcome): Promise<void> {
  await sql`select month_report_done(${businessId}::uuid, ${month}, ${outcome})`.execute(db);
}
