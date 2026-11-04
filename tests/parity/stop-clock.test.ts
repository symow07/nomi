import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stopClock, runningJobs, describeRunning, describePools } from '../../src/queue/stopClock.js';

/**
 * PROGRESS "A flake to watch" — a graceful stop, measured. Quiet when quick; when slow, every step's time and what was
 * running when the stop began; while a step still waits, a line every interval (a hook that gives up first still leaves
 * the evidence). Driven here with a hand-turned clock and timer.
 */
const harness = () => {
  let t = 0;
  const lines: string[] = [];
  const timers = new Map<number, () => void>();
  let next = 1;
  return {
    lines, timers,
    advance: (ms: number) => { t += ms; },
    tick: () => { for (const f of timers.values()) f(); },
    deps: {
      now: () => t,
      log: (l: string) => { lines.push(l); },
      setTimer: (f: () => void) => { const id = next++; timers.set(id, f); return id; },
      clearTimer: (id: unknown) => { timers.delete(id as number); },
      running: () => [{ queue: 'message.inbound', jobs: 1 }],
      pools: () => ({ app: { borrowed: 1, idle: 2, waiting: 0 }, advisor: null }),
    },
  };
};

describe('a graceful stop, measured', () => {
  it('a quick stop says nothing', async () => {
    const h = harness();
    const c = stopClock(h.deps);
    await c.step('server', async () => { h.advance(5); });
    c.done();
    expect(h.lines).toEqual([]);
  });

  it('a slow stop names each step, its time, and what was running when it began', async () => {
    const h = harness();
    const c = stopClock(h.deps);
    await c.step('server', async () => { h.advance(3); });
    await c.step('workers', async () => { h.advance(30_000); });
    await c.step('pool', async () => { h.advance(16_000); });
    c.done();
    expect(h.lines).toEqual(['[stop] slow: 46003 ms — server 3 ms · workers 30000 ms · pool 16000 ms. '
      + 'When it began: message.inbound ×1; app pool 1 lent, 2 idle, 0 waiting; advisor pool ?']);
  });

  it('a step past its limit is left behind, says so, and the next step runs', async () => {
    const h = harness();
    const c = stopClock(h.deps);
    const left = await c.step('pool', () => new Promise<string>(() => {}), 5);
    expect(left).toBeUndefined();
    expect(h.lines).toEqual(['[stop] gave up on pool after 0 ms — message.inbound ×1; app pool 1 lent, 2 idle, 0 waiting; advisor pool ?']);
    expect(h.timers.size).toBe(0);
    expect(await c.step('advisor pool', async () => 'closed', 5)).toBe('closed');
    expect(h.lines).toHaveLength(1);                 // within its limit: nothing said
  });

  it('a step left behind that fails later is nobody\'s unhandled rejection', async () => {
    const h = harness();
    let fail!: (e: Error) => void;
    await stopClock(h.deps).step('pool', () => new Promise<void>((_ok, no) => { fail = no; }), 1);
    fail(new Error('too late'));
    await new Promise((r) => setTimeout(r, 5));      // vitest fails the run on an unhandled rejection
  });

  it('every step of close() has a limit, and together they end before the suite\'s hook gives up', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const steps = [...main.matchAll(/await stop\.step\('([^']+)', .*?, ([\d_]+)\);/g)].map((m) => ({ name: m[1], ms: Number(m[2]!.replaceAll('_', '')) }));
    expect(steps.map((x) => x.name)).toEqual(['heartbeat', 'server', 'workers', 'pool', 'advisor pool']);
    expect(main.match(/await stop\.step\(/g)).toHaveLength(steps.length);
    const hook = Number(/HOOK_TIMEOUT_MS = ([\d_]+)/.exec(readFileSync('tools/run-integration.mjs', 'utf8'))![1]!.replaceAll('_', ''));
    expect(steps.reduce((sum, x) => sum + x.ms, 0)).toBeLessThan(hook);
  });

  it('a step still waiting says so, with what is running now, and its timer ends with it', async () => {
    const h = harness();
    const c = stopClock(h.deps);
    await c.step('pool', async () => {
      h.advance(10_000);
      h.tick();
      expect(h.lines[0]).toBe('[stop] still waiting on pool after 10000 ms — message.inbound ×1; app pool 1 lent, 2 idle, 0 waiting; advisor pool ?');
    });
    expect(h.timers.size).toBe(0);
  });

  it('a step that throws still ends its timer and is still timed; a reading that throws does not stop the stop', async () => {
    const h = harness();
    const c = stopClock({ ...h.deps, running: () => { throw new Error('gone'); }, slowMs: 0 });
    await expect(c.step('server', async () => { h.advance(2); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(h.timers.size).toBe(0);
    c.done();
    expect(h.lines[0]).toContain('server 2 ms');
    expect(h.lines[0]).toContain('no job running');
  });

  it('reads pg-boss\'s own count, and only queues with a job running', () => {
    const wip = (name: string, count: number) => ({ name, count }) as ReturnType<Parameters<typeof runningJobs>[0]['getWipData']>[number];
    expect(runningJobs({ getWipData: () => [wip('a', 0), wip('b', 2)] })).toEqual([{ queue: 'b', jobs: 2 }]);
    expect(describeRunning([])).toBe('no job running');
    expect(describePools({ app: { borrowed: 0, idle: 1, waiting: 0 } })).toBe('app pool 0 lent, 1 idle, 0 waiting');
  });

  it('production\'s close() goes through it, step by step', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    for (const step of ['heartbeat', 'server', 'workers', 'pool', 'advisor pool']) expect(src).toContain(`stop.step('${step}'`);
    expect(src).toContain('stop.done()');
  });
});
