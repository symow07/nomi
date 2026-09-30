import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import { ensureConversation } from './channels.js';

/**
 * PRACTICE, PER WORKSPACE (docs/PRACTICE.md; 0086, 0087).
 *
 * Each workspace practises on its own copy: a business row whose `practice_of`
 * is the workspace, holding what the assistant answers from and nobody real.
 * A practice message is an ordinary inbound message ON THE COPY — the queue,
 * the worker, the turn and the send gate are the real ones; only the adapter
 * at the end (`src/channels/practice.ts`) has no network.
 */

/** Practice runs as Instagram (P1): its own window rules, no new channel value. */
export const PRACTICE_CHANNEL = 'instagram' as const;

/**
 * The practice customer, one per copy. `client_channels` is unique on
 * (channel, identity) across the whole installation, so a shared identity —
 * the old sandbox's one "sandbox-buyer" — would collide between copies.
 */
export const practiceCustomer = (copy: BusinessId): string => `practice:${copy}`;

const copyId = (raw: string | null | undefined): BusinessId | null => {
  if (!raw) return null;
  const p = parseBusinessId(raw);
  return p.ok ? p.value : null;
};

/**
 * The workspace's copy, created on first use and brought in line with the
 * workspace NOW — before a practice message, so a price fixed on Products a
 * moment ago is the price the next reply quotes. One definer, in the
 * workspace's own transaction: it refuses any other workspace, and a copy.
 */
export async function refreshPractice(db: Db, live: BusinessId): Promise<BusinessId> {
  const raw = await withTenantTx(db, live, async (tx) =>
    (await sql<{ id: string }>`select practice_refresh(${live}::uuid)::text as id`.execute(tx)).rows[0]?.id);
  const copy = copyId(raw);
  if (!copy) throw new Error('practice_refresh returned no copy');
  return copy;
}

/** The workspace's copy as it stands — no refresh; null before it first practised. */
export async function practiceCopyOf(db: Db, live: BusinessId): Promise<BusinessId | null> {
  return withTenantTx(db, live, async (tx) =>
    copyId((await sql<{ id: string | null }>`select practice_copy(${live}::uuid)::text as id`.execute(tx)).rows[0]?.id));
}

/** Is this business a practice copy? Read in its own transaction: row security shows a business its own row. */
export async function isPracticeCopy(tx: Tx, businessId: BusinessId): Promise<boolean> {
  return (await practiceOf(tx, businessId)) !== null;
}

/** The workspace a practice copy practises for — who pays for its turns (P5) — or null for a real workspace. */
export async function practiceOf(tx: Tx, businessId: BusinessId): Promise<BusinessId | null> {
  return copyId((await sql<{ live: string | null }>`
    select practice_of::text as live from businesses where id = ${businessId}`.execute(tx)).rows[0]?.live);
}

/**
 * P5 — PRACTICE A DAY. Every practice message is a live model turn, charged to
 * the workspace; fifty a day is plenty to rehearse with, and bounds what a
 * page left open, or a script, can spend. Counted per UTC day — the ledger's
 * own (T7) — on the workspace's own row (0089: `practice_day`,
 * `practice_lines`), as each line is taken, so a line waiting in a batch
 * counts before its turn runs, and Start over, which erases the transcript,
 * does not give the day back.
 */
export const PRACTICE_DAILY_LIMIT = 50;

export type PracticeRefusal = 'switched_off' | 'daily_limit';

/**
 * Why Practice will not take a message now, or null. The operator's switch
 * first (0088: `practice_off`, for everyone or for this workspace — read, never
 * written, by the app), then the day's fifty. Nothing is created to answer it.
 */
export async function practiceRefusal(db: Db, live: BusinessId): Promise<PracticeRefusal | null> {
  const off = await withTenantTx(db, live, async (tx) => (await sql<{ off: boolean }>`
    select exists (select 1 from ops_flags where flag = 'practice_off' and cleared_at is null
                     and (business_id is null or business_id = ${live}::uuid)) as off`.execute(tx)).rows[0]?.off === true);
  if (off) return 'switched_off';
  const today = await withTenantTx(db, live, async (tx) => (await sql<{ n: number }>`
    select case when practice_day = (now() at time zone 'UTC')::date then practice_lines else 0 end as n
      from businesses where id = ${live}::uuid`.execute(tx)).rows[0]?.n ?? 0);
  return today >= PRACTICE_DAILY_LIMIT ? 'daily_limit' : null;
}

/** One practice line taken today, on the workspace's own row (0089). */
export async function countPracticeLine(db: Db, live: BusinessId): Promise<void> {
  await withTenantTx(db, live, (tx) => sql`
    update businesses
       set practice_lines = case when practice_day = (now() at time zone 'UTC')::date then practice_lines + 1 else 1 end,
           practice_day = (now() at time zone 'UTC')::date
     where id = ${live}::uuid`.execute(tx));
}

/**
 * The copy's practice conversation, as a customer's first message would make
 * it — and the customer's window opened, as their message would open it: the
 * send gate reads `client_channels.last_inbound_at` for Instagram's 24 hours.
 */
export async function practiceConversation(tx: Tx, copy: BusinessId): Promise<string> {
  const identity = practiceCustomer(copy);
  const { conversationId } = await ensureConversation(tx, copy, identity, null, PRACTICE_CHANNEL);
  await sql`
    update client_channels set last_inbound_at = now()
     where channel = ${PRACTICE_CHANNEL} and channel_user_id = ${identity}`.execute(tx);
  return conversationId;
}

/**
 * P6 — is this conversation still there? Practice's Start over and the daily
 * erasure (0089) take conversations away while a job for one may still be
 * queued; a job whose conversation is gone asks nothing of anyone. Row
 * security answers for the job's own business only.
 */
export async function conversationExists(tx: Tx, conversationId: string): Promise<boolean> {
  return (await sql<{ one: number }>`select 1 as one from conversations where id = ${conversationId}::uuid`.execute(tx)).rows.length > 0;
}

/** The practice conversation still open, if any — for drawing the page. */
export async function activePracticeConversation(tx: Tx, copy: BusinessId): Promise<string | null> {
  return (await sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id
       and cc.channel = ${PRACTICE_CHANNEL} and cc.channel_user_id = ${practiceCustomer(copy)}
     where c.business_id = ${copy} and c.channel = ${PRACTICE_CHANNEL} and c.is_active
     order by c.created_at desc limit 1`.execute(tx)).rows[0]?.id ?? null;
}

/**
 * P6 — "Start over": the workspace's practice conversations are ERASED, now,
 * with everything that hangs off them (0089). Not archived: a customer's words
 * pasted in through "Try it" must not outlive a deletion request. Only for the
 * workspace the caller is in; the number erased.
 */
export async function startPracticeOver(db: Db, live: BusinessId): Promise<number> {
  return withTenantTx(db, live, async (tx) =>
    (await sql<{ n: number }>`select practice_start_over(${live}::uuid) as n`.execute(tx)).rows[0]?.n ?? 0);
}

/** P6 — the daily erasure: every copy's practice conversations quiet for thirty days (0089). The number erased. */
export async function expirePractice(db: Db): Promise<number> {
  return (await sql<{ n: number }>`select practice_expire() as n`.execute(db)).rows[0]?.n ?? 0;
}

/** How Practice answers, for its page: "as if sending alone", its own Stop, and the owner's real one. */
export type PracticeSettings = { readonly alone: boolean; readonly stopped: boolean; readonly ownerStopped: boolean };

export async function practiceSettings(db: Db, live: BusinessId, copy: BusinessId | null): Promise<PracticeSettings> {
  const ownerStopped = await withTenantTx(db, live, async (tx) => (await sql<{ s: boolean }>`
    select assistant_stopped_at is not null as s from businesses where id = ${live}::uuid`.execute(tx)).rows[0]?.s === true);
  if (!copy) return { alone: false, stopped: false, ownerStopped };
  const row = await withTenantTx(db, copy, async (tx) => (await sql<{ alone: boolean; stopped: boolean }>`
    select practice_alone as alone, practice_stopped_at is not null as stopped from businesses where id = ${copy}::uuid`.execute(tx)).rows[0]);
  return { alone: row?.alone === true, stopped: row?.stopped === true, ownerStopped };
}

/**
 * P4 — a practice-only switch, on the COPY: "as if sending alone" (0090) or
 * Practice's own Stop (0086). The workspace's own levels and Stop are never
 * touched; the copy is refreshed at once, so the next message meets it.
 */
export async function setPractice(db: Db, live: BusinessId, what: 'alone' | 'stopped', on: boolean): Promise<void> {
  const copy = await refreshPractice(db, live);
  await withTenantTx(db, copy, (tx) => (what === 'alone'
    ? sql`update businesses set practice_alone = ${on} where id = ${copy}::uuid`
    : sql`update businesses set practice_stopped_at = case when ${on} then coalesce(practice_stopped_at, now()) end where id = ${copy}::uuid`
  ).execute(tx));
  await refreshPractice(db, live);
}

