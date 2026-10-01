import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { loadKillSwitches } from './opsFlags.js';
import { allowanceOf, allowanceUsed } from './allowance.js';

/**
 * The owner's Stop, on every channel (0070, 2026-09-27).
 *
 * WhatsApp's activation switch stops WhatsApp alone, and Instagram, Messenger
 * and e-mail had no stop at all: a reply queued there went out whatever the
 * owner pressed. This is the one that binds the assistant everywhere:
 *
 *   - the SEND gate refuses the assistant's messages and scheduled follow-ups
 *     while it is set (`gateOutbound`, reason 'stopped'), so a reply queued
 *     before Stop was pressed is cancelled, never sent late;
 *   - the worker writes nothing while it is set — no model call, no draft.
 *     Each message is recorded as it arrived and its conversation handed to a
 *     person, which is what keeps a waiting buyer on "Needs you";
 *   - handing a conversation back, "answer this", and approving or editing a
 *     draft written before Stop are refused while it is set, because each of
 *     them would move a buyer off "Needs you" with nobody to answer.
 *
 * The owner's own replies are never bound by it.
 *
 * Its own columns, not the ops kill switch: the application may only READ
 * `ops_flags` (0014), so that a compromised app can neither silence a business
 * nor lift a silence ops set. The owner's Start therefore never touches an
 * operator's switch, and an operator's never touches the owner's.
 */

export type AssistantStop = {
  readonly stoppedAt: Date | null;
  /** A people.id — who pressed Stop, named on the page as activation's actor is. */
  readonly stoppedBy: string | null;
};

/**
 * Inside the caller's transaction, so the send gate and the worker decide on
 * the flag as it stands NOW — a Stop pressed after a reply was queued binds
 * that reply.
 */
export async function assistantStopped(tx: Tx, businessId: BusinessId | string): Promise<boolean> {
  const r = await sql<{ stopped: boolean }>`
    select assistant_stopped_at is not null as stopped
      from businesses where id = ${businessId}::uuid
  `.execute(tx);
  return r.rows[0]?.stopped === true;
}

/**
 * 0071 — is the assistant HELD, and by whom: the ops kill switch
 * (`global_silence`, for this business or the whole platform) or the owner's
 * Stop. Both mean the same thing to a buyer who writes — nothing the assistant
 * writes will reach him, so a person must — and the same things follow from
 * both: the worker records the message and hands the conversation over, and
 * nothing may move a waiting buyer off "Needs you". Ops is named first when
 * both are set, as at the send gate: it is the one the owner did not choose.
 *
 * The send gate does not ask this: it has its own two inputs, `silenced` and
 * `stopped`, each required, resolved by the store in the send's transaction.
 *
 * G3 (0101) — and a third reason, last: the day's allowance is used
 * (`allowance`, src/db/allowance.ts). No model may be asked, so the same
 * things follow — the message recorded, the conversation handed to a person in
 * silence, and nothing that would move a waiting customer off "Needs you" —
 * until the allowance renews at midnight UTC. Asked in a transaction bound to
 * the business, as every caller's is: the allowance answers for that one.
 */
export type AssistantHold = 'silenced' | 'stopped' | 'allowance' | null;

export async function assistantHold(tx: Tx, businessId: BusinessId | string): Promise<AssistantHold> {
  if ((await loadKillSwitches(tx, String(businessId))).globalSilence) return 'silenced';
  if (await assistantStopped(tx, businessId)) return 'stopped';
  return allowanceUsed(await allowanceOf(tx)) ? 'allowance' : null;
}

/** The hand-off reason each hold gives a waiting customer. */
export const HOLD_REASON = {
  silenced: 'ops_silenced', stopped: 'assistant_stopped', allowance: 'allowance_used',
} as const satisfies Record<Exclude<AssistantHold, null>, string>;

/** What a refused approve, hand-back or order says, per hold: the flash keys are named after these. */
export const HOLD_OUTCOME = {
  silenced: 'assistant_silenced', stopped: 'assistant_stopped', allowance: 'allowance_used',
} as const satisfies Record<Exclude<AssistantHold, null>, string>;

export async function loadAssistantStop(db: Db, businessId: BusinessId): Promise<AssistantStop> {
  return withTenantTx(db, businessId, async (tx) => {
    const row = (await sql<{ at: Date | null; by: string | null }>`
      select assistant_stopped_at as at, assistant_stopped_by as by
        from businesses where id = ${businessId}::uuid
    `.execute(tx)).rows[0];
    return { stoppedAt: row?.at ?? null, stoppedBy: row?.by ?? null };
  });
}

/** Stop the assistant on every channel. A second press changes nothing and records nothing. */
export async function stopAssistant(db: Db, businessId: BusinessId, actor: string): Promise<'stopped' | 'already'> {
  return withTenantTx(db, businessId, async (tx) => {
    const r = await sql`
      update businesses set assistant_stopped_at = now(), assistant_stopped_by = ${actor}
       where id = ${businessId}::uuid and assistant_stopped_at is null
    `.execute(tx);
    if (Number(r.numAffectedRows ?? 0) === 0) return 'already';
    await sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}, 'assistant_stop', ${actor}, '{}'::jsonb)
    `.execute(tx);
    return 'stopped';
  });
}

/**
 * Let the assistant answer again. Conversations handed to a person while it
 * was stopped STAY with that person: a buyer the owner may already be
 * answering is not taken back without the owner saying so.
 */
export async function startAssistant(db: Db, businessId: BusinessId, actor: string): Promise<'started' | 'already'> {
  return withTenantTx(db, businessId, async (tx) => {
    const was = (await sql<{ at: Date | null }>`
      select assistant_stopped_at as at from businesses where id = ${businessId}::uuid for update
    `.execute(tx)).rows[0]?.at ?? null;
    if (was === null) return 'already';
    await sql`
      update businesses set assistant_stopped_at = null, assistant_stopped_by = null
       where id = ${businessId}::uuid
    `.execute(tx);
    await sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}, 'assistant_start', ${actor}, ${JSON.stringify({ stoppedAt: was.toISOString() })}::jsonb)
    `.execute(tx);
    return 'started';
  });
}
