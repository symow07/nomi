/**
 * 0165 — WHAT THE MODEL'S HEALTH IS, from what real calls said (the owner,
 * 2026-10-15: "it must make a real call and report what actually happened —
 * answering, slow, or not answering — not just billing refusals").
 *
 * Pure: the rules only. The calls are made in src/pipeline/modelHealth.ts and
 * written to `model_checks`; `/health` and the heartbeat read them through
 * `healthOfModel`.
 */

export type ModelState = 'answering' | 'slow' | 'not_answering';
/** What `/health` says of one provider. `unknown`: no real call said anything recently. */
export type ModelView = ModelState | 'refusing' | 'unknown';
export type ModelRole = 'primary' | 'fallback';

/** The check's own call is eight tokens: past this, the provider is answering, but slowly. */
export const PROBE_SLOW_MS = 5_000;
/** A real call (a turn's analysis, a reply) takes longer: slow past this. The analysis gives up at 30 s. */
export const CALL_SLOW_MS = 20_000;
/** The check runs every five minutes; a result older than this means nobody checked. */
export const CHECK_FRESH_MS = 12 * 60_000;

/** How one call ended. `failure` is `classifyProviderFailure`'s kind (src/llm/providerFailure.ts). */
export type CallOutcome =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false; readonly ms: number; readonly failure: string; readonly status: number | null };

/**
 * Does this failure say anything about the PROVIDER? A timeout, a refusal, an
 * overload, a rate limit, a dead key, a server error or no connection at all
 * do. A 400 does not: that was our request, and the provider answered it.
 */
export function failureCounts(o: CallOutcome): boolean {
  if (o.ok) return true;
  if (o.failure === 'other') return o.status === null || o.status >= 500;
  return true;
}

/** One call's outcome as a state. A failure that `failureCounts` rejects has none. */
export function stateOf(o: CallOutcome, slowMs: number): ModelState | null {
  if (o.ok) return o.ms >= slowMs ? 'slow' : 'answering';
  return failureCounts(o) ? 'not_answering' : null;
}

/** A short name for why it is not answering, as a row keeps it. */
export function reasonOf(o: CallOutcome): string | null {
  if (o.ok) return null;
  if (o.failure === 'other') return o.status === null ? 'no_connection' : `http_${o.status}`;
  return o.failure.slice(0, 40);
}

export type ModelCheckRow = {
  readonly role: ModelRole;
  readonly provider: string;
  readonly model: string;
  readonly state: ModelState;
  readonly ms: number | null;
  readonly reason: string | null;
  readonly checkedAt: Date;
  readonly lastAnswerAt: Date | null;
};

/**
 * What `/health` says of one provider. A billing refusal on record wins (it
 * names the cause the operator must fix). Otherwise the newest real call or
 * check — unless it is older than `CHECK_FRESH_MS`: then `unknown`. Never
 * `answering` without a call that answered.
 */
export function healthOfModel(row: ModelCheckRow | null, refusing: boolean, now: Date): ModelView {
  if (refusing) return 'refusing';
  if (!row) return 'unknown';
  if (now.getTime() - row.checkedAt.getTime() > CHECK_FRESH_MS) return 'unknown';
  return row.state;
}

/** Can a reply be written? Answering or slow; anything else is a failed heartbeat. */
export const modelServes = (v: ModelView): boolean => v === 'answering' || v === 'slow';
