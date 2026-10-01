import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from './client.js';
import { parseBusinessId } from '../core/types/ids.js';

/**
 * T7 — COMPLETE METERING (the one-month build order, 2026-09-29).
 *
 * `usage_ledger` is the pricing dataset nobody can backfill, and it had three
 * holes:
 *
 *   · it was written inside the turn's own transaction, so a turn that failed
 *     after its model calls — and every one that was retried — paid for calls
 *     the ledger never saw;
 *   · only the text turn wrote it: a customer's photo (the vision call), a
 *     voice note (the transcription), a catalogue photo (the page reader) and
 *     live Practice were paid for and never counted;
 *   · it was written with the database's date (UTC) and read with Shanghai's,
 *     so for eight hours a day every reader saw an empty day.
 *
 * Now every paid call is recorded here, the day is UTC for the writer and every
 * reader (`LEDGER_DAY`), and a turn's calls are written in a transaction of
 * their own. `turns` counts turns; a photo, a note or a page read adds calls
 * and tokens, never a turn.
 */

export type Spent = { readonly llmCalls: number; readonly inputTokens: number; readonly outputTokens: number };

/** The ledger's day, for the writer and every reader alike: UTC. */
export const LEDGER_DAY = sql`(now() at time zone 'UTC')::date`;

/**
 * `photoReads` (G3, 0101) — catalogue photos read by this spend, for the
 * limit of 20 a day; a refused read counts, it was paid for.
 */
export type SpendOpts = { readonly turn: boolean; readonly photoReads?: number };

export async function recordSpend(tx: Tx, businessId: string, spent: Spent, opts: SpendOpts): Promise<void> {
  if (spent.llmCalls <= 0 && !opts.turn) return;
  await sql`
    insert into usage_ledger as u (business_id, day, llm_calls, input_tokens, output_tokens, turns, photo_reads)
    values (${businessId}::uuid, ${LEDGER_DAY}, ${Math.max(0, spent.llmCalls)}, ${Math.max(0, spent.inputTokens)},
            ${Math.max(0, spent.outputTokens)}, ${opts.turn ? 1 : 0}, ${Math.max(0, opts.photoReads ?? 0)})
    on conflict (business_id, day) do update set
      llm_calls = u.llm_calls + excluded.llm_calls, input_tokens = u.input_tokens + excluded.input_tokens,
      output_tokens = u.output_tokens + excluded.output_tokens, turns = u.turns + excluded.turns,
      photo_reads = u.photo_reads + excluded.photo_reads`.execute(tx);
}

/**
 * In a transaction of its own: a call that was paid for is on the ledger
 * whether or not the work it served was kept. Writing it can never fail the
 * work — a failure is logged, not thrown.
 */
export async function recordSpendAlone(db: Db, businessId: string, spent: Spent, opts: SpendOpts): Promise<void> {
  const bid = parseBusinessId(businessId);
  if (!bid.ok) return;
  try {
    await withTenantTx(db, bid.value, (tx) => recordSpend(tx, businessId, spent, opts));
  } catch (e) {
    console.error(`[usage] not recorded for ${businessId}: ${(e as Error).message}`);
  }
}
