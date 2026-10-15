import type { Db } from '../db/client.js';
import type { CallObserver } from '../llm/provider.js';
import { classifyProviderFailure } from '../llm/providerFailure.js';
import { recordModelCheck } from '../db/modelChecks.js';
import {
  CALL_SLOW_MS, PROBE_SLOW_MS, reasonOf, stateOf,
  type CallOutcome, type ModelRole, type ModelState,
} from '../core/ops/modelHealth.js';

/**
 * 0165 — THE MODEL'S HEALTH, FROM REAL CALLS (the owner, 2026-10-15: "/health
 * reported 'answering' while every single call failed… FIX THE HEALTH CHECK
 * FIRST").
 *
 * Two sources, one record (`model_checks`):
 *
 *   · THE CHECK (`check`), every five minutes and once at boot: the smallest
 *     real call to each configured provider — eight tokens — timed. Answering,
 *     slow (past `PROBE_SLOW_MS`), or not answering, with why. Its tokens are
 *     counted on the row and on no workspace's ledger: 288 calls a day would
 *     eat the operator's workspace's daily allowance.
 *   · EVERY REAL CALL (`callsOf`), from the timing every model client carries
 *     (`timedClient`, src/llm/provider.ts): a turn that timed out says so the
 *     moment it does, not five minutes later. Written when the state changes,
 *     else at most once a minute — a busy hour is not a write per call.
 *
 * `/health` reads the record (src/core/ops/modelHealth.ts `healthOfModel`);
 * the heartbeat pings `/fail` when nothing can write a reply.
 */

/** One configured provider, as the check sees it. `ask` is the smallest call there is; null: never asked (a test). */
export type CheckedProvider = {
  readonly role: ModelRole;
  readonly provider: string;
  readonly model: string;
  readonly ask: (() => Promise<{ readonly tokens: number }>) | null;
};

export type ModelHealthDeps = {
  readonly db: Db;
  readonly providers: readonly CheckedProvider[];
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
};

export type ModelHealth = {
  /** The listener a client for this role is built with. */
  readonly callsOf: (role: ModelRole) => CallObserver;
  /** One real call to each provider, timed and written down. Never throws. */
  readonly check: () => Promise<void>;
  /** Wait for the writes `callsOf` started (tests). */
  readonly settled: () => Promise<void>;
};

/** A real call that changes nothing is written at most this often. */
const CALL_WRITE_EVERY_MS = 60_000;

export function modelHealth(deps: ModelHealthDeps): ModelHealth {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.warn(line));
  const byRole = new Map(deps.providers.map((p) => [p.role, p]));
  const last = new Map<ModelRole, { readonly state: ModelState; readonly at: number }>();
  let pending: Promise<void> = Promise.resolve();

  const said = (p: CheckedProvider, state: ModelState, reason: string | null): void => {
    const before = last.get(p.role)?.state;
    if (before !== undefined && before !== state) {
      log(`[model] ${p.provider} (${p.role}): ${before} → ${state}${reason ? ` (${reason})` : ''}`);
    } else if (before === undefined && state !== 'answering') {
      log(`[model] ${p.provider} (${p.role}): ${state}${reason ? ` (${reason})` : ''}`);
    }
    last.set(p.role, { state, at: now().getTime() });
  };

  const write = (p: CheckedProvider, state: ModelState, o: CallOutcome, source: 'probe' | 'call', tokens = 0): Promise<void> =>
    recordModelCheck(deps.db, {
      role: p.role, provider: p.provider, model: p.model, state,
      ms: o.ok || o.failure !== 'timeout' ? Math.round(o.ms) : null,
      reason: reasonOf(o), source, at: now(), probeTokens: tokens,
    }).catch((e: unknown) => log(`[model] could not record the check: ${(e as Error).message}`));

  const callsOf = (role: ModelRole): CallObserver => (o) => {
    const p = byRole.get(role);
    if (!p) return;
    const state = stateOf(o, CALL_SLOW_MS);
    if (state === null) return;                       // our request's fault, not the provider's
    const prev = last.get(role);
    const due = !prev || prev.state !== state || now().getTime() - prev.at >= CALL_WRITE_EVERY_MS;
    if (!due) return;
    said(p, state, reasonOf(o));
    pending = pending.then(() => write(p, state, o, 'call'));
  };

  const check = async (): Promise<void> => {
    for (const p of deps.providers) {
      if (!p.ask) continue;
      const started = now().getTime();
      let outcome: CallOutcome;
      let tokens = 0;
      try {
        tokens = (await p.ask()).tokens;
        outcome = { ok: true, ms: now().getTime() - started };
      } catch (e) {
        const f = classifyProviderFailure(e);
        outcome = { ok: false, ms: now().getTime() - started, failure: f.kind, status: 'status' in f ? f.status ?? null : null };
      }
      // A check that fails for our own request's reason still says the provider is not answering it.
      const state = stateOf(outcome, PROBE_SLOW_MS) ?? 'not_answering';
      said(p, state, reasonOf(outcome));
      await write(p, state, outcome, 'probe', tokens);
    }
  };

  return { callsOf, check, settled: () => pending };
}
