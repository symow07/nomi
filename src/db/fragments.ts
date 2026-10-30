import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { type BatchConfig, type Fragment, DEFAULT_BATCH_CONFIG } from '../core/conversation/batching.js';

/**
 * M51.1 — the fragments a buyer is still in the middle of sending.
 *
 * ASSUMPTIONS P1, which has been open since the register was written: real
 * buyers do not send one message containing one intent. They send
 *
 *     "hello" / "price?" / "the bags" / "5000pcs"
 *
 * in about ten seconds, and each one analysed alone is meaningless. Verified
 * against pg-boss 12 rather than assumed: `singletonKey` neither merges those
 * four jobs nor (on these standard-policy queues, with no window) serialises
 * them — the per-conversation lock does the serialising — so without this they
 * become four turns: four analyses, four replies, four times the tokens, for
 * worse answers.
 *
 * `message_fragments` has existed since migration 0009 with no writer. This is
 * the writer. `core/conversation/batching.ts` — pure, and tested since it was
 * written — is the decision. Neither was reachable from production until now.
 *
 * THE TABLE IS THE POINT, not an optimisation of it: a fragment is persisted
 * before anything decides what to do with it, so a crash mid-batch loses
 * nothing and a replay is free. Dedup is a primary-key property, because the
 * id IS the external message id.
 */

/** Record one inbound fragment. Idempotent: the buyer's message id is the key. */
export async function recordFragment(
  tx: Tx, businessId: BusinessId, conversationId: string,
  fragment: { readonly id: string; readonly text: string; readonly receivedAt: Date },
): Promise<void> {
  await sql`
    insert into message_fragments (id, business_id, conversation_id, text, received_at)
    values (${fragment.id}, ${businessId}::uuid, ${conversationId}::uuid,
            ${fragment.text}, ${fragment.receivedAt})
    on conflict (id) do nothing
  `.execute(tx);
}

/** Everything this conversation has said that no turn has answered yet. */
export async function pendingFragments(tx: Tx, conversationId: string): Promise<Fragment[]> {
  const r = await sql<{ id: string; text: string; received_at: Date }>`
    select id, text, received_at from message_fragments
     where conversation_id = ${conversationId}::uuid and processed_in is null
     order by received_at, id
  `.execute(tx);
  return r.rows.map((x) => ({ id: x.id, text: x.text, receivedAt: x.received_at }));
}

/**
 * Mark fragments answered, in the same transaction as the turn that answered
 * them. If the turn rolls back the fragments stay pending and the next wake
 * tries again — which is the whole reason they are rows rather than a variable.
 */
export async function markFragmentsProcessed(
  tx: Tx, fragmentIds: readonly string[], turnMessageId: string,
): Promise<void> {
  if (fragmentIds.length === 0) return;
  // B24 (audit batch 5) — only fragments no turn has answered, the ids bound as one array (no hand-escaping). Fewer
  // than asked means another turn answered some of them first: this one must not stand, so its transaction rolls back.
  const r = await sql`
    update message_fragments set processed_in = ${turnMessageId}
     where id = any(${[...fragmentIds]}::text[]) and processed_in is null
  `.execute(tx);
  if (Number(r.numAffectedRows ?? 0) !== new Set(fragmentIds).size) {
    throw new Error(`a turn's fragments were already answered (${Number(r.numAffectedRows ?? 0)} of ${new Set(fragmentIds).size} still waiting)`);
  }
}

/**
 * B24 — asked under the conversation's lock, before a turn runs: are all of these fragments still unanswered? Two
 * processes can both read the same batch before either takes the lock (a deploy's overlap; FAIR's limit is per
 * process). The one that takes the lock second finds them answered, and runs nothing.
 */
export async function stillWaiting(tx: Tx, fragmentIds: readonly string[]): Promise<boolean> {
  if (fragmentIds.length === 0) return true;
  const r = await sql<{ n: number }>`
    select count(*)::int as n from message_fragments where id = any(${[...fragmentIds]}::text[]) and processed_in is null
  `.execute(tx);
  return (r.rows[0]?.n ?? 0) === new Set(fragmentIds).size;
}

/**
 * B24 — a turn already answers this message (`turns.message_id` is unique). A voice note's or a photo's job carries
 * no fragments, so a retry after its turn committed would otherwise run a whole second turn.
 */
export async function turnRecorded(tx: Tx, messageId: string): Promise<boolean> {
  const r = await sql<{ e: boolean }>`select exists (select 1 from turns where message_id = ${messageId}) as e`.execute(tx);
  return r.rows[0]?.e === true;
}

/**
 * Her tenant's own batching knobs, from the columns 0009 added.
 *
 * Buyers type differently per market and per channel, which is why these are
 * per-tenant rather than constants — and why a Gulf factory can widen the
 * window without a deploy. An unreadable row falls back to the defaults rather
 * than to no batching: the failure mode of a missing config must not be the
 * behaviour this milestone exists to remove.
 */
export async function batchConfigFor(tx: Tx, businessId: BusinessId): Promise<BatchConfig> {
  const r = await sql<{ d: number; w: number; f: number }>`
    select batch_debounce_ms as d, batch_max_window_ms as w, batch_max_fragments as f
      from businesses where id = ${businessId}::uuid limit 1
  `.execute(tx);
  const row = r.rows[0];
  if (!row) return DEFAULT_BATCH_CONFIG;
  return {
    debounceMs: Number(row.d) > 0 ? Number(row.d) : DEFAULT_BATCH_CONFIG.debounceMs,
    maxWindowMs: Number(row.w) > 0 ? Number(row.w) : DEFAULT_BATCH_CONFIG.maxWindowMs,
    maxFragments: Number(row.f) > 0 ? Number(row.f) : DEFAULT_BATCH_CONFIG.maxFragments,
  };
}
