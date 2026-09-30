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
 * page left open, or a script, can spend. Counted as the owner's practice
 * lines since midnight UTC — the ledger's own day (T7) — so a line waiting in
 * a batch counts before its turn runs.
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
  const copy = await practiceCopyOf(db, live);
  if (!copy) return null;
  const today = await withTenantTx(db, copy, async (tx) => (await sql<{ n: number }>`
    select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
     where c.business_id = ${copy} and m.direction = 'inbound'
       and m.sent_at >= ((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'`.execute(tx)).rows[0]?.n ?? 0);
  return today >= PRACTICE_DAILY_LIMIT ? 'daily_limit' : null;
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

/** The practice conversation still open, if any — for drawing the page. */
export async function activePracticeConversation(tx: Tx, copy: BusinessId): Promise<string | null> {
  return (await sql<{ id: string }>`
    select c.id::text as id from conversations c
      join client_channels cc on cc.client_id = c.client_id
       and cc.channel = ${PRACTICE_CHANNEL} and cc.channel_user_id = ${practiceCustomer(copy)}
     where c.business_id = ${copy} and c.channel = ${PRACTICE_CHANNEL} and c.is_active
     order by c.created_at desc limit 1`.execute(tx)).rows[0]?.id ?? null;
}
