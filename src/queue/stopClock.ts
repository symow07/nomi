import type { PgBoss } from 'pg-boss';
import type { PoolState } from '../db/client.js';

/**
 * PROGRESS "A flake to watch" (2026-10-22, urgent since 2026-10-30) — A GRACEFUL STOP, MEASURED.
 *
 * `close()` stops the server, pg-boss (which waits up to 30 s for running jobs, then marks them failed) and the two
 * pools (`Pool.end()` waits for every borrowed connection to come back). Twice in CI a stop outlasted 45 s and nobody
 * could say which step waited. This says it: each step's time, and — when the stop began — which queues still had a
 * job running and how many connections each pool had lent out.
 *
 * Quiet when the stop is quick. When it is slow: a line every `every` ms while a step is still waiting (so a hook that
 * gives up first still leaves the evidence), and one line at the end with every step. Never throws: a stop that
 * cannot be measured still stops.
 */
export type Running = { readonly queue: string; readonly jobs: number };
export type Pools = Readonly<Record<string, PoolState | null>>;

export type StopClock = {
  step<T>(name: string, run: () => Promise<T>): Promise<T>;
  done(): void;
};

export type StopClockDeps = {
  readonly running: () => readonly Running[];
  readonly pools: () => Pools;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /** A stop slower than this in all is reported at its end. */
  readonly slowMs?: number;
  /** While one step waits, how often to say so. */
  readonly every?: number;
  readonly setTimer?: (f: () => void, ms: number) => unknown;
  readonly clearTimer?: (t: unknown) => void;
};

const safe = <T>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };

export const describeRunning = (r: readonly Running[]): string =>
  r.length === 0 ? 'no job running' : r.map((x) => `${x.queue} ×${x.jobs}`).join(', ');

export const describePools = (p: Pools): string =>
  Object.entries(p).map(([name, s]) => (s ? `${name} pool ${s.borrowed} lent, ${s.idle} idle, ${s.waiting} waiting` : `${name} pool ?`)).join('; ');

export function stopClock(deps: StopClockDeps): StopClock {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const slowMs = deps.slowMs ?? 5_000;
  const every = deps.every ?? 10_000;
  const setTimer = deps.setTimer ?? ((f, ms) => setInterval(f, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const began = now();
  const atStart = `${describeRunning(safe(deps.running, []))}; ${describePools(safe(deps.pools, {}))}`;
  const steps: string[] = [];
  return {
    async step(name, run) {
      const s = now();
      const t = setTimer(() => log(`[stop] still waiting on ${name} after ${now() - s} ms — ${describeRunning(safe(deps.running, []))}; ${describePools(safe(deps.pools, {}))}`), every);
      try {
        return await run();
      } finally {
        clearTimer(t);
        steps.push(`${name} ${now() - s} ms`);
      }
    },
    done() {
      const total = now() - began;
      if (total >= slowMs) log(`[stop] slow: ${total} ms — ${steps.join(' · ')}. When it began: ${atStart}`);
    },
  };
}

/** The queues with a job still running in this process, from pg-boss's own count (internal queues left out). */
export const runningJobs = (boss: Pick<PgBoss, 'getWipData'>): Running[] =>
  boss.getWipData().filter((w) => w.count > 0).map((w) => ({ queue: w.name, jobs: w.count }));
