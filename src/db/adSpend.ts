import { sql } from 'kysely';
import type { Tx } from './client.js';
import { SPEND_STATUSES } from './customerValue.js';
import { notOwnerTesting } from './handled.js';
import { monthDays, type NamedPlatform } from '../core/ads/spend.js';
import type { SpendRow } from '../channels/meta/adSpend.js';

/**
 * 0238 — ad spend's rows. Every read and write is in the tenant's transaction; row security keeps another
 * workspace's rows out, and keeps all of them from staff and the accountant (the amounts are the owner's).
 */

export type AdConnection = {
  readonly id: string; readonly adAccountId: string; readonly name: string;
  readonly currency: string; readonly timezone: string;
  readonly ciphertext: string;
  readonly state: 'active' | 'refused' | 'permission';
  readonly stateNote: string | null;
  readonly retryAfter: Date | null;
  readonly connectedAt: Date;
};

export async function liveAdConnection(tx: Tx, businessId: string): Promise<AdConnection | null> {
  const r = (await sql<{
    id: string; ad_account_id: string; ad_account_name: string; account_currency: string; timezone_name: string;
    token_ciphertext: string; state: AdConnection['state']; state_note: string | null; retry_after: Date | null; connected_at: Date;
  }>`select id::text as id, ad_account_id, ad_account_name, account_currency, timezone_name, token_ciphertext, state, state_note,
         retry_after, connected_at
    from ad_spend_connections where business_id = ${businessId}::uuid and archived_at is null`.execute(tx)).rows[0];
  return r ? {
    id: r.id, adAccountId: r.ad_account_id, name: r.ad_account_name, currency: r.account_currency, timezone: r.timezone_name,
    ciphertext: r.token_ciphertext, state: r.state, stateNote: r.state_note, retryAfter: r.retry_after, connectedAt: r.connected_at,
  } : null;
}

/** One live account per workspace: the one before is archived in the same transaction. */
export async function connectAdAccount(tx: Tx, businessId: string, a: {
  readonly adAccountId: string; readonly name: string; readonly currency: string; readonly timezone: string;
  readonly ciphertext: string; readonly fingerprint: string; readonly by: string;
}): Promise<string> {
  await archiveAdConnection(tx, businessId, a.by);
  return (await sql<{ id: string }>`insert into ad_spend_connections
      (business_id, ad_account_id, ad_account_name, account_currency, timezone_name, token_ciphertext, token_fingerprint, connected_by)
    values (${businessId}::uuid, ${a.adAccountId}, ${a.name}, ${a.currency}, ${a.timezone}, ${a.ciphertext}, ${a.fingerprint}, ${a.by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

export async function archiveAdConnection(tx: Tx, businessId: string, by: string): Promise<boolean> {
  const r = await sql`update ad_spend_connections set archived_at = now(), archived_by = ${by}
    where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

// ── The read ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Has this connection been read on this UTC day, or ever read whole? (One read a day; never a loop.) */
export async function readHistory(tx: Tx, businessId: string, connectionId: string, now: Date): Promise<{ readonly today: boolean; readonly everOk: boolean }> {
  const r = (await sql<{ today: boolean; ever_ok: boolean }>`select
      exists (select 1 from ad_spend_reads where business_id = ${businessId}::uuid and connection_id = ${connectionId}::uuid
               and (started_at at time zone 'UTC')::date = (${now}::timestamptz at time zone 'UTC')::date) as today,
      exists (select 1 from ad_spend_reads where business_id = ${businessId}::uuid and connection_id = ${connectionId}::uuid and outcome = 'ok') as ever_ok`
    .execute(tx)).rows[0]!;
  return { today: r.today, everOk: r.ever_ok };
}

export async function startRead(tx: Tx, businessId: string, c: { readonly id: string; readonly adAccountId: string }, span: { since: string; until: string }, now: Date): Promise<string> {
  return (await sql<{ id: string }>`insert into ad_spend_reads (business_id, connection_id, ad_account_id, since, until, started_at)
    values (${businessId}::uuid, ${c.id}::uuid, ${c.adAccountId}, ${span.since}::date, ${span.until}::date, ${now})
    returning id::text as id`.execute(tx)).rows[0]!.id;
}

export async function finishRead(tx: Tx, businessId: string, readId: string, f: {
  readonly outcome: 'ok' | 'incomplete' | 'refused' | 'permission' | 'throttled' | 'failed';
  readonly pages: number; readonly rows: number; readonly code: number | null; readonly subcode: number | null;
  readonly message: string | null; readonly usage: unknown; readonly now: Date;
}): Promise<void> {
  await sql`update ad_spend_reads set finished_at = ${f.now}, outcome = ${f.outcome}, pages = ${f.pages}, rows_read = ${f.rows},
      error_code = ${f.code}, error_subcode = ${f.subcode}, error_message = ${f.message ? f.message.slice(0, 500) : null},
      usage = ${JSON.stringify(f.usage)}::jsonb
    where business_id = ${businessId}::uuid and id = ${readId}::uuid`.execute(tx);
}

/** What Meta last said of the token, and how long to wait. A refusal stops every read until she connects again. */
export async function markAdConnection(tx: Tx, businessId: string, connectionId: string, m: {
  readonly state?: 'refused' | 'permission'; readonly note?: string | null; readonly retryAfter?: Date | null;
}): Promise<void> {
  await sql`update ad_spend_connections set
      state = coalesce(${m.state ?? null}, state),
      state_note = case when ${m.state ?? null}::text is null then state_note else ${m.note ?? null} end,
      retry_after = ${m.retryAfter ?? null}
    where business_id = ${businessId}::uuid and id = ${connectionId}::uuid`.execute(tx);
}

export type StoreCounts = { readonly added: number; readonly revised: number; readonly same: number };

/**
 * Each row in place: a new (account, day, placement) is inserted; one whose amount or currency changed keeps
 * its old value in history and takes the new one with the next revision; one unchanged only notes the read.
 * Never a second row for the same day and placement, so a re-read never counts twice.
 */
export async function storeSpend(tx: Tx, businessId: string, c: { readonly adAccountId: string; readonly timezone: string }, rows: readonly SpendRow[], now: Date): Promise<StoreCounts> {
  let added = 0; let revised = 0; let same = 0;
  for (const r of rows) {
    const had = (await sql<{ id: string; amount: string; currency: string; read_at: Date; revision: number }>`
      select id::text as id, amount, currency, read_at, revision from ad_spend_days
       where business_id = ${businessId}::uuid and ad_account_id = ${c.adAccountId} and day = ${r.day}::date and platform = ${r.platform}
       for update`.execute(tx)).rows[0];
    if (!had) {
      await sql`insert into ad_spend_days (business_id, ad_account_id, day, platform, amount, currency, timezone_name, first_read_at, read_at)
        values (${businessId}::uuid, ${c.adAccountId}, ${r.day}::date, ${r.platform}, ${r.amount}, ${r.currency}, ${c.timezone}, ${now}, ${now})`.execute(tx);
      added++;
    } else if (had.amount !== r.amount || had.currency !== r.currency) {
      await sql`insert into ad_spend_day_history (business_id, day_id, revision, amount, currency, read_at, replaced_at)
        values (${businessId}::uuid, ${had.id}::uuid, ${had.revision}, ${had.amount}, ${had.currency}, ${had.read_at}, ${now})`.execute(tx);
      await sql`update ad_spend_days set amount = ${r.amount}, currency = ${r.currency}, read_at = ${now}, revision = revision + 1
        where business_id = ${businessId}::uuid and id = ${had.id}::uuid`.execute(tx);
      revised++;
    } else {
      await sql`update ad_spend_days set read_at = ${now} where business_id = ${businessId}::uuid and id = ${had.id}::uuid`.execute(tx);
      same++;
    }
  }
  return { added, revised, same };
}

export type LastRead = { readonly at: Date; readonly outcome: string | null; readonly message: string | null };
export async function lastRead(tx: Tx, businessId: string, connectionId: string): Promise<LastRead | null> {
  const r = (await sql<{ at: Date; outcome: string | null; error_message: string | null }>`select coalesce(finished_at, started_at) as at, outcome, error_message
    from ad_spend_reads where business_id = ${businessId}::uuid and connection_id = ${connectionId}::uuid order by started_at desc limit 1`.execute(tx)).rows[0];
  return r ? { at: r.at, outcome: r.outcome, message: r.error_message } : null;
}

// ── The comparison ────────────────────────────────────────────────────────────────────────────────────────────

export type PlatformSpend = { readonly platform: string; readonly amount: string; readonly currency: string; readonly days: number };
export type ChannelOrders = { readonly channel: 'instagram' | 'messenger'; readonly count: number; readonly totals: readonly { readonly currency: string; readonly value: string }[] };
export type MonthComparison = {
  readonly month: string;
  readonly spend: readonly PlatformSpend[];
  readonly orders: readonly ChannelOrders[];
  readonly recorded: ReadonlySet<string>;
};

/**
 * One month, the account's days: spend by placement (each placement its own line, summed only with itself),
 * and the orders from Instagram and Messenger conversations confirmed in the same instants — Results' own rule
 * (`SPEND_STATUSES`, confirmed or else created, the owner's tests left out), counted and totalled per currency.
 */
export async function monthComparison(tx: Tx, businessId: string, c: { readonly adAccountId: string; readonly timezone: string }, month: string): Promise<MonthComparison | null> {
  const days = monthDays(month);
  if (!days) return null;
  const spend = (await sql<{ platform: string; amount: string; currency: string; days: number }>`
    select platform, sum(amount_num)::text as amount, currency, count(*)::int as days
      from ad_spend_days
     where business_id = ${businessId}::uuid and ad_account_id = ${c.adAccountId}
       and day between ${days.first}::date and ${days.last}::date
     group by platform, currency order by platform, currency`.execute(tx)).rows;
  const spendStatuses = [...SPEND_STATUSES];
  const orders = (await sql<{ channel: 'instagram' | 'messenger'; currency: string; n: number; val: string }>`
    select cv.channel, o.currency, count(*)::int as n, coalesce(sum(o.total_value_usd), 0)::text as val
      from orders o join conversations cv on cv.id = o.conversation_id
     where o.status = any(${spendStatuses}::text[])
       and coalesce(o.confirmed_at, o.created_at) >= (${days.first}::date::timestamp at time zone ${c.timezone})
       and coalesce(o.confirmed_at, o.created_at) <  (${days.next}::date::timestamp at time zone ${c.timezone})
       and cv.channel in ('instagram', 'messenger')
       and ${notOwnerTesting('o.conversation_id')}
     group by cv.channel, o.currency order by cv.channel, o.currency`.execute(tx)).rows;
  const byChannel = new Map<'instagram' | 'messenger', { count: number; totals: { currency: string; value: string }[] }>();
  for (const o of orders) {
    const e = byChannel.get(o.channel) ?? { count: 0, totals: [] };
    e.count += o.n; e.totals.push({ currency: o.currency, value: o.val });
    byChannel.set(o.channel, e);
  }
  const recorded = (await sql<{ platform: string }>`select platform from ad_spend_recorded
    where business_id = ${businessId}::uuid and ad_account_id = ${c.adAccountId} and month = ${days.first}::date`.execute(tx)).rows;
  return {
    month,
    spend: spend.map((s) => ({ platform: s.platform, amount: trimZeros(s.amount), currency: s.currency, days: s.days })),
    orders: (['instagram', 'messenger'] as const).map((channel) => ({ channel, count: byChannel.get(channel)?.count ?? 0, totals: byChannel.get(channel)?.totals ?? [] })),
    recorded: new Set(recorded.map((r) => r.platform)),
  };
}

/** The months that hold any spend for this account, newest first (the chooser's list). */
export async function spendMonths(tx: Tx, businessId: string, adAccountId: string): Promise<string[]> {
  return (await sql<{ m: string }>`select distinct to_char(day, 'YYYY-MM') as m from ad_spend_days
    where business_id = ${businessId}::uuid and ad_account_id = ${adAccountId} order by 1 desc limit 36`.execute(tx)).rows.map((r) => r.m);
}

const trimZeros = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

// ── Recorded as a cost ────────────────────────────────────────────────────────────────────────────────────────

export type RecordOffer = { readonly adAccountId: string; readonly month: string; readonly platform: string; readonly amount: string; readonly currency: string };

/** What the spending form is prefilled from: this month's spend on one placement, if any and not yet recorded. */
export async function recordOffer(tx: Tx, businessId: string, month: string, platform: string): Promise<RecordOffer | 'recorded' | null> {
  const c = await liveAdConnection(tx, businessId);
  const days = monthDays(month);
  if (!c || !days) return null;
  const done = (await sql<{ n: number }>`select count(*)::int as n from ad_spend_recorded where business_id = ${businessId}::uuid
    and ad_account_id = ${c.adAccountId} and month = ${days.first}::date and platform = ${platform}`.execute(tx)).rows[0]!.n;
  if (done > 0) return 'recorded';
  const r = (await sql<{ amount: string | null; currency: string | null; currencies: number }>`select sum(amount_num)::text as amount, min(currency) as currency,
      count(distinct currency)::int as currencies
    from ad_spend_days where business_id = ${businessId}::uuid and ad_account_id = ${c.adAccountId} and platform = ${platform}
      and day between ${days.first}::date and ${days.last}::date`.execute(tx)).rows[0]!;
  if (!r.amount || !r.currency || r.currencies !== 1) return null;
  return { adAccountId: c.adAccountId, month, platform, amount: trimZeros(r.amount), currency: r.currency };
}

/** Written in the bill's own transaction, after `recordBill` posted it: the offer is not made again. */
export async function linkRecorded(tx: Tx, businessId: string, o: RecordOffer, billId: string, by: string): Promise<void> {
  await sql`insert into ad_spend_recorded (business_id, ad_account_id, month, platform, bill_id, spend_seen, currency, recorded_by)
    values (${businessId}::uuid, ${o.adAccountId}, ${`${o.month}-01`}::date, ${o.platform}, ${billId}::uuid, ${o.amount}, ${o.currency}, ${by})`.execute(tx);
}

export type { NamedPlatform };
