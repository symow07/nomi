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
 *
 * NO STEP WAITS FOR EVER (2026-11-04). `Pool.end()` waits for every connection lent out, with no limit of its own, and
 * pg-boss's 30 s bounds its wait for running jobs but not the closing of its own pool. A step given a limit is left
 * behind when it passes it, and says so. Under CI the lines are warnings on the run's page, because a stop that gave up
 * no longer fails anything and a line in a green log is read by nobody.
 *
 * WHAT A STEP LEFT BEHIND REALLY TOOK (2026-11-04). The first such line on CI gave up on the pool at 2 s with one
 * connection lent, and could not say whether that connection was two seconds from coming back or never would. So the
 * line now says what each lent connection was doing and what was running when the stop began (by then pg-boss has
 * stopped, so "now" says little about jobs), and a second line says when the step really ended. `leftBehind()` is for
 * whoever can wait to hear it: a process that exits at once never does.
 */
export type Running = { readonly queue: string; readonly jobs: number };
export type Pools = Readonly<Record<string, PoolState | null>>;

export type StopClock = {
  /** `limitMs`: stop waiting after this long, say so, and go on. The answer is then undefined. */
  step<T>(name: string, run: () => Promise<T>, limitMs?: number): Promise<T | undefined>;
  /** Settles once every step left behind has ended, however it ended. Never rejects. */
  leftBehind(): Promise<void>;
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
  Object.entries(p).map(([name, s]) => {
    if (!s) return `${name} pool ?`;
    const doing = s.lent?.length ? ` (${s.lent.join(', ')})` : '';
    return `${name} pool ${s.borrowed} lent${doing}, ${s.idle} idle, ${s.waiting} waiting`;
  }).join('; ');

/** A line about a stop: under CI, a warning on the run's page. */
export const sayStop = (line: string): void => {
  console.error(process.env['GITHUB_ACTIONS'] ? `::warning title=Slow stop::${line}` : line);
};

export function stopClock(deps: StopClockDeps): StopClock {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? sayStop;
  const slowMs = deps.slowMs ?? 5_000;
  const every = deps.every ?? 10_000;
  const setTimer = deps.setTimer ?? ((f, ms) => setInterval(f, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const began = now();
  const atStart = `${describeRunning(safe(deps.running, []))}; ${describePools(safe(deps.pools, {}))}`;
  const steps: string[] = [];
  const left: Promise<void>[] = [];
  return {
    async step(name, run, limitMs) {
      const s = now();
      const t = setTimer(() => log(`[stop] still waiting on ${name} after ${now() - s} ms — ${describeRunning(safe(deps.running, []))}; ${describePools(safe(deps.pools, {}))}`), every);
      let limit: ReturnType<typeof setTimeout> | undefined;
      const passed = Symbol('limit');
      try {
        const work = run();
        if (limitMs === undefined) return await work;
        const first = await Promise.race([work, new Promise<typeof passed>((done) => { limit = setTimeout(() => done(passed), limitMs); })]);
        if (first !== passed) return first as Awaited<typeof work>;
        log(`[stop] gave up on ${name} after ${now() - s} ms — ${describeRunning(safe(deps.running, []))}; ${describePools(safe(deps.pools, {}))}. When it began: ${atStart}`);
        // Left behind: whatever it ends with, nobody is waiting for it now. Only when it ends is said.
        left.push(work.then(
          () => { log(`[stop] ${name}, left behind, ended after ${now() - s} ms`); },
          () => { log(`[stop] ${name}, left behind, failed after ${now() - s} ms`); },
        ));
        return undefined;
      } finally {
        clearTimeout(limit);
        clearTimer(t);
        steps.push(`${name} ${now() - s} ms`);
      }
    },
    leftBehind: async () => { await Promise.all(left); },
    done() {
      const total = now() - began;
      if (total >= slowMs) log(`[stop] slow: ${total} ms — ${steps.join(' · ')}. When it began: ${atStart}`);
    },
  };
}

/** The queues with a job still running in this process, from pg-boss's own count (internal queues left out). */
export const runningJobs = (boss: Pick<PgBoss, 'getWipData'>): Running[] =>
  boss.getWipData().filter((w) => w.count > 0).map((w) => ({ queue: w.name, jobs: w.count }));
