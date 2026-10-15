import { sql } from 'kysely';
import type { Db } from './client.js';
import { healthOfModel, type ModelCheckRow, type ModelRole, type ModelState, type ModelView } from '../core/ops/modelHealth.js';
import { providerRefusing } from './providerState.js';

/**
 * 0165 — `model_checks`: what the last real call to each provider said. No
 * workspace's data and no row security: the installation's own record.
 */

export type ModelCheckWrite = {
  readonly role: ModelRole;
  readonly provider: string;
  readonly model: string;
  readonly state: ModelState;
  readonly ms: number | null;
  readonly reason: string | null;
  readonly source: 'probe' | 'call';
  readonly at: Date;
  /** The check's own spend, added to the row's counters (a real call's is on its workspace's ledger). */
  readonly probeTokens?: number;
};

export async function recordModelCheck(db: Db, w: ModelCheckWrite): Promise<void> {
  const answered = w.state === 'not_answering' ? null : w.at;
  const probe = w.source === 'probe' ? 1 : 0;
  await sql`
    insert into model_checks as m (role, provider, model, state, ms, reason, source, checked_at, last_answer_at, probes, probe_tokens)
    values (${w.role}, ${w.provider}, ${w.model}, ${w.state}, ${w.ms}, ${w.reason}, ${w.source}, ${w.at}, ${answered},
            ${probe}, ${Math.max(0, w.probeTokens ?? 0)})
    on conflict (role) do update set
      provider = excluded.provider, model = excluded.model, state = excluded.state, ms = excluded.ms,
      reason = excluded.reason, source = excluded.source, checked_at = excluded.checked_at,
      last_answer_at = coalesce(excluded.last_answer_at, m.last_answer_at),
      probes = m.probes + excluded.probes, probe_tokens = m.probe_tokens + excluded.probe_tokens
    -- An older outcome never overwrites a newer one (a slow call finishing after the next check).
    where m.checked_at <= excluded.checked_at`.execute(db);
}

export async function readModelChecks(db: Db): Promise<ReadonlyMap<ModelRole, ModelCheckRow>> {
  const rows = (await sql<{
    role: ModelRole; provider: string; model: string; state: ModelState; ms: number | null; reason: string | null;
    checked_at: Date; last_answer_at: Date | null;
  }>`select role, provider, model, state, ms, reason, checked_at, last_answer_at from model_checks`.execute(db)).rows;
  return new Map(rows.map((r) => [r.role, {
    role: r.role, provider: r.provider, model: r.model, state: r.state, ms: r.ms, reason: r.reason,
    checkedAt: r.checked_at, lastAnswerAt: r.last_answer_at,
  }]));
}

/**
 * What `/health` and the heartbeat say of the model — one reading, so the two cannot disagree. The billing refusal
 * on record (0128) wins; otherwise the newest real call or check, `unknown` when it is stale (`healthOfModel`).
 */
export type ModelHealthView = {
  readonly model: ModelView;
  readonly ms: number | null;
  readonly checkedAt: Date | null;
  readonly reason: string | null;
};

export async function readModelView(
  db: Db, configured: { readonly provider: string; readonly model: string }, now: Date = new Date(),
): Promise<ModelHealthView> {
  const [refusing, rows] = await Promise.all([providerRefusing(db), readModelChecks(db)]);
  // A row about another provider or model (written before LLM_MODEL changed, or by another installation on the same
  // database) says nothing about this one.
  const found = rows.get('primary') ?? null;
  const row = found && found.provider === configured.provider && found.model === configured.model ? found : null;
  return {
    model: healthOfModel(row, refusing, now),
    ms: row?.ms ?? null,
    checkedAt: row?.checkedAt ?? null,
    reason: row && row.state === 'not_answering' ? row.reason : null,
  };
}
