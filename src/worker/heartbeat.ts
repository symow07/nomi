import { sql } from 'kysely';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../db/client.js';
import { QUEUES, type HeartbeatJob } from '../queue/boss.js';

/**
 * CC-10 — THE UPTIME HEARTBEAT: a dead-man's switch, like the backup's.
 *
 * Every five minutes a pg-boss job checks this process from the inside — the
 * database answers, AND the HTTP server answers its own `/health` on loopback
 * — then GETs `HEALTH_PING_URL` (a Healthchecks.io check) when both did, or
 * `HEALTH_PING_URL/fail` when either did not.
 *
 * The alert is Healthchecks.io's, from OUTSIDE Railway, and it fires on
 * SILENCE as well as on `/fail`: if the process dies, the database goes, or
 * pg-boss stops running jobs, the pings stop and the owner is e-mailed when
 * the check's grace period runs out. That is the point of a heartbeat — the
 * thing that is broken cannot be trusted to report that it is broken.
 *
 * The URL is a secret-ish token: whoever has it can mark the check up. It is
 * never logged, and neither is an error message from pinging it, which can
 * quote it. Unset, nothing is pinged and the boot says so, once.
 */

export const HEARTBEAT_CRON = '*/5 * * * *';

export type PingFetch = (
  url: string, init: { readonly method: 'GET'; readonly signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

export type HeartbeatDeps = {
  /** HEALTH_PING_URL, or null: no ping at all. */
  readonly url: string | null;
  readonly probeDb: () => Promise<boolean>;
  readonly probeHttp: () => Promise<boolean>;
  readonly fetch: PingFetch;
  readonly log: (line: string) => void;
  /** Each probe's own limit; a probe that has not answered by then has failed. Default 5 s. */
  readonly probeTimeoutMs?: number;
  /** The ping's limit. Default 10 s. */
  readonly pingTimeoutMs?: number;
};

export type HeartbeatOutcome = 'off' | 'healthy' | 'unhealthy';

/** Healthchecks.io's failure signal: the same check, `/fail` appended to its path (before any query). */
export function failUrl(url: string): string {
  const u = new URL(url);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/fail`;
  return u.toString();
}

/** True only if `probe` answers true within `ms`; a throw, a false or silence are all a failure. */
async function within(probe: () => Promise<boolean>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe().then((v) => v === true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A name for why a ping failed that cannot quote the address: `TimeoutError`, `TypeError`… */
const reasonOf = (e: unknown): string =>
  (typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string'
    ? (e as { name: string }).name : 'error').replace(/[^A-Za-z]/g, '').slice(0, 40) || 'error';

/**
 * One tick. NEVER THROWS: a heartbeat that fails loudly inside pg-boss is a
 * retried job, not a ping. Logs only what went wrong — a healthy tick every
 * five minutes is not news — and never the URL.
 */
export async function heartbeatTick(deps: HeartbeatDeps): Promise<HeartbeatOutcome> {
  if (!deps.url) return 'off';
  const limit = deps.probeTimeoutMs ?? 5_000;
  const [db, http] = await Promise.all([within(deps.probeDb, limit), within(deps.probeHttp, limit)]);
  const healthy = db && http;
  const state = healthy ? 'healthy' : `unhealthy (${[
    db ? null : 'the database did not answer',
    http ? null : '/health did not answer on loopback',
  ].filter(Boolean).join('; ')})`;
  let target: string;
  try {
    target = healthy ? deps.url : failUrl(deps.url);
  } catch {
    deps.log(`[heartbeat] ${state}; HEALTH_PING_URL is not an address, so no ping was sent`);
    return healthy ? 'healthy' : 'unhealthy';
  }
  try {
    const res = await deps.fetch(target, { method: 'GET', signal: AbortSignal.timeout(deps.pingTimeoutMs ?? 10_000) });
    if (!healthy || !res.ok) deps.log(`[heartbeat] ${state}; the ping was ${res.ok ? 'delivered' : `answered ${res.status}`}`);
  } catch (e) {
    deps.log(`[heartbeat] ${state}; the ping was not delivered (${reasonOf(e)})`);
  }
  return healthy ? 'healthy' : 'unhealthy';
}

/** Does this process's own HTTP server answer `/health` with a 200, on loopback? */
export function loopbackHealth(port: number, fetchImpl: PingFetch, timeoutMs = 5_000): () => Promise<boolean> {
  return async () => {
    const res = await fetchImpl(`http://127.0.0.1:${port}/health`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return res.status === 200;
  };
}

/**
 * Called once the server listens (src/main.ts), so a tick never asks a server
 * that has not started yet. Without a URL it UNSCHEDULES — a schedule outlives
 * the process in pg-boss's own table — and says, once, that nothing outside
 * this host is watching.
 */
export async function startHeartbeat(
  boss: Pick<PgBoss, 'schedule' | 'unschedule' | 'work'>,
  o: {
    readonly url: string | null;
    readonly port: number;
    readonly db: Db;
    /** Tests only; production asks `select 1` of `db`. */
    readonly probeDb?: () => Promise<boolean>;
    readonly fetch?: PingFetch;
    readonly log?: (line: string) => void;
  },
): Promise<'on' | 'off'> {
  const log = o.log ?? ((line: string) => console.log(line));
  if (!o.url) {
    await boss.unschedule(QUEUES.heartbeat).catch(() => undefined);
    log('Uptime pings are not configured (HEALTH_PING_URL is unset): nothing outside this host will notice if the app stops. See docs/MONITORING.md.');
    return 'off';
  }
  // The app serves whether or not its heartbeat could be scheduled: a boot that
  // died here would trade a missing ping for a missing app. The missing pings
  // are themselves the alarm.
  try {
    return await scheduleHeartbeat(boss, o, o.url, log);
  } catch (e) {
    log(`[heartbeat] could not be scheduled (${reasonOf(e)}); no pings will be sent, and the check will say so`);
    return 'off';
  }
}

async function scheduleHeartbeat(
  boss: Pick<PgBoss, 'schedule' | 'work'>,
  o: { readonly port: number; readonly db: Db; readonly probeDb?: () => Promise<boolean>; readonly fetch?: PingFetch },
  url: string, log: (line: string) => void,
): Promise<'on'> {
  const fetchImpl = o.fetch ?? (fetch as unknown as PingFetch);
  const deps: HeartbeatDeps = {
    url,
    probeDb: o.probeDb ?? (async () => { await sql`select 1`.execute(o.db); return true; }),
    probeHttp: loopbackHealth(o.port, fetchImpl),
    fetch: fetchImpl,
    log,
  };
  await boss.schedule(QUEUES.heartbeat, HEARTBEAT_CRON, {} satisfies HeartbeatJob);
  let last: HeartbeatOutcome = 'healthy';
  await boss.work<HeartbeatJob>(QUEUES.heartbeat, async () => {
    const outcome = await heartbeatTick(deps);
    if (outcome === 'healthy' && last === 'unhealthy') log('[heartbeat] healthy again');
    last = outcome;
  });
  log('Uptime pings: every five minutes, to the address in HEALTH_PING_URL (see docs/MONITORING.md).');
  return 'on';
}
