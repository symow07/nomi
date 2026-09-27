import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  heartbeatTick, failUrl, loopbackHealth, startHeartbeat, HEARTBEAT_CRON, type PingFetch,
} from '../../src/worker/heartbeat.js';
import { validateEnv } from '../../src/main.js';
import { QUEUES } from '../../src/queue/boss.js';

/**
 * CC-10 — THE UPTIME HEARTBEAT, a dead-man's switch like the backup's.
 *
 * Every five minutes the app checks itself (the database answers; its own
 * /health answers on loopback) and pings HEALTH_PING_URL — or /fail. The alert
 * is Healthchecks.io's, from outside Railway, and it fires on silence as well.
 * These tests drive one tick with injected probes and a recording fetch, and
 * hold: the right address, one GET, never a throw, never the URL in a log.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const URL_ = 'https://hc-ping.com/1f2e3d4c-5b6a-4789-9abc-def012345678';

function recorder(answer: (url: string) => Promise<{ ok: boolean; status: number }> = async () => ({ ok: true, status: 200 })) {
  const gets: string[] = [];
  const logs: string[] = [];
  const fetch: PingFetch = async (url, init) => {
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    gets.push(url);
    return answer(url);
  };
  return { gets, logs, fetch, log: (l: string) => { logs.push(l); } };
}

const up = async () => true;
const down = async () => false;

describe('one tick', () => {
  it('healthy → one GET to the check’s own address, and nothing logged', async () => {
    const r = recorder();
    expect(await heartbeatTick({ url: URL_, probeDb: up, probeHttp: up, fetch: r.fetch, log: r.log })).toBe('healthy');
    expect(r.gets).toEqual([URL_]);
    expect(r.logs).toEqual([]);
  });

  it('the database not answering → one GET to /fail, and the log says why', async () => {
    const r = recorder();
    expect(await heartbeatTick({ url: URL_, probeDb: down, probeHttp: up, fetch: r.fetch, log: r.log })).toBe('unhealthy');
    expect(r.gets).toEqual([`${URL_}/fail`]);
    expect(r.logs.join('\n')).toContain('the database did not answer');
  });

  it('/health not answering on loopback → one GET to /fail', async () => {
    const r = recorder();
    expect(await heartbeatTick({ url: URL_, probeDb: up, probeHttp: down, fetch: r.fetch, log: r.log })).toBe('unhealthy');
    expect(r.gets).toEqual([`${URL_}/fail`]);
    expect(r.logs.join('\n')).toContain('/health did not answer');
  });

  it('a probe that THROWS or HANGS is a failed probe, within its limit', async () => {
    const r = recorder();
    const t0 = Date.now();
    expect(await heartbeatTick({
      url: URL_, probeDb: () => new Promise<boolean>(() => {}), probeHttp: async () => { throw new Error('ECONNREFUSED'); },
      fetch: r.fetch, log: r.log, probeTimeoutMs: 50,
    })).toBe('unhealthy');
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.gets).toEqual([`${URL_}/fail`]);
  });

  it('unset → no GET at all, and nothing to say', async () => {
    const r = recorder();
    expect(await heartbeatTick({ url: null, probeDb: up, probeHttp: up, fetch: r.fetch, log: r.log })).toBe('off');
    expect(r.gets).toEqual([]);
    expect(r.logs).toEqual([]);
  });

  it('a ping that FAILS does not throw, and the log never carries the URL — even when the error quotes it', async () => {
    const r = recorder(async (url) => { throw Object.assign(new TypeError(`fetch failed for ${url}`), { cause: new Error(`getaddrinfo ENOTFOUND ${url}`) }); });
    await expect(heartbeatTick({ url: URL_, probeDb: up, probeHttp: up, fetch: r.fetch, log: r.log })).resolves.toBe('healthy');
    expect(r.gets).toHaveLength(1);
    expect(r.logs).toHaveLength(1);
    expect(r.logs[0]).toContain('not delivered (TypeError)');
    for (const l of r.logs) {
      expect(l).not.toContain('hc-ping.com');
      expect(l).not.toContain('1f2e3d4c');
    }
  });

  it('a ping ANSWERED with an error status is said as a status, not a URL', async () => {
    const r = recorder(async () => ({ ok: false, status: 404 }));
    await heartbeatTick({ url: URL_, probeDb: up, probeHttp: down, fetch: r.fetch, log: r.log });
    expect(r.logs.join('\n')).toContain('answered 404');
    expect(r.logs.join('\n')).not.toContain('1f2e3d4c');
  });

  it('a ping that hangs is abandoned at its limit', async () => {
    const r = recorder();
    // Honours the signal, as the platform fetch does.
    const hanging: PingFetch = (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    });
    const t0 = Date.now();
    await heartbeatTick({ url: URL_, probeDb: up, probeHttp: up, fetch: hanging, log: r.log, pingTimeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r.logs.join('\n')).toContain('not delivered (TimeoutError)');
  });
});

describe('the /fail address', () => {
  it('is the same check with /fail on its path — before any query, whatever the trailing slash', () => {
    expect(failUrl('https://hc-ping.com/abc')).toBe('https://hc-ping.com/abc/fail');
    expect(failUrl('https://hc-ping.com/abc/')).toBe('https://hc-ping.com/abc/fail');
    expect(failUrl('https://hc-ping.com/key/nomi-app?create=1')).toBe('https://hc-ping.com/key/nomi-app/fail?create=1');
  });
});

describe('the loopback probe, against a real server', () => {
  const servers: Server[] = [];
  afterEach(() => { for (const s of servers.splice(0)) s.close(); });
  const serve = (status: number | 'hang'): Promise<number> => new Promise((resolve) => {
    const s = createServer((req, res) => {
      expect(req.url).toBe('/health');
      if (status === 'hang') return;
      res.statusCode = status; res.end('{}');
    });
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port));
  });
  const platformFetch = fetch as unknown as PingFetch;

  it('200 is healthy; 503 is not; a closed port is not; a server that never answers is not, within the limit', async () => {
    expect(await loopbackHealth(await serve(200), platformFetch)()).toBe(true);
    expect(await loopbackHealth(await serve(503), platformFetch)()).toBe(false);
    const closed = await serve(200); servers.pop()!.close();
    await expect(loopbackHealth(closed, platformFetch)()).rejects.toThrow();
    const t0 = Date.now();
    await expect(loopbackHealth(await serve('hang'), platformFetch, 100)()).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('startHeartbeat — scheduled only when there is somewhere to ping', () => {
  const fakeBoss = () => {
    const calls: string[] = [];
    let handler: ((jobs: unknown[]) => Promise<unknown>) | null = null;
    const boss = {
      schedule: async (name: string, cron: string) => { calls.push(`schedule ${name} ${cron}`); },
      unschedule: async (name: string) => { calls.push(`unschedule ${name}`); },
      work: async (name: string, h: (jobs: unknown[]) => Promise<unknown>) => { calls.push(`work ${name}`); handler = h; return 'w'; },
    };
    return { boss, calls, tick: () => handler!([{ id: 'j', data: {} }]) };
  };
  const db = {} as import('../../src/db/client.js').Db;

  it('UNSET: no schedule, no worker, the old schedule removed, and ONE line saying nothing watches', async () => {
    const f = fakeBoss();
    const logs: string[] = [];
    expect(await startHeartbeat(f.boss as never, { url: null, port: 8787, db, log: (l) => logs.push(l) })).toBe('off');
    expect(f.calls).toEqual([`unschedule ${QUEUES.heartbeat}`]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/Uptime pings are not configured/);
  });

  it('SET: every five minutes on the heartbeat queue; a tick pings; the boot line never names the URL', async () => {
    const f = fakeBoss();
    const r = recorder();
    const logs: string[] = [];
    // /health answers on loopback: the fetch sees that address first, then the ping.
    const fetchBoth: PingFetch = async (url, init) => (url.startsWith('http://127.0.0.1:8787/health') ? { ok: true, status: 200 } : r.fetch(url, init));
    expect(await startHeartbeat(f.boss as never, {
      url: URL_, port: 8787, db, probeDb: up, fetch: fetchBoth, log: (l) => logs.push(l),
    })).toBe('on');
    expect(HEARTBEAT_CRON).toBe('*/5 * * * *');
    expect(f.calls).toEqual([`schedule ${QUEUES.heartbeat} ${HEARTBEAT_CRON}`, `work ${QUEUES.heartbeat}`]);
    expect(logs.join('\n')).not.toContain('hc-ping.com');
    await f.tick();
    expect(r.gets.length).toBe(1);
  });

  it('a schedule that FAILS at boot does not take the app down with it — and says so without the URL', async () => {
    const logs: string[] = [];
    const broken = {
      schedule: async () => { throw new Error(`queue ops.heartbeat not found while scheduling ${URL_}`); },
      unschedule: async () => {}, work: async () => 'w',
    };
    await expect(startHeartbeat(broken as never, { url: URL_, port: 8787, db, log: (l) => logs.push(l) })).resolves.toBe('off');
    expect(logs.join('\n')).toMatch(/could not be scheduled \(Error\)/);
    expect(logs.join('\n')).not.toContain('1f2e3d4c');
  });
});

describe('the wiring', () => {
  const main = read('src/main.ts');

  it('the CLI starts the heartbeat AFTER the server listens, with the validated address and port', () => {
    const listen = main.indexOf('await prod.app.listen(');
    const start = main.indexOf('await startHeartbeat(prod.boss, { url: v.cfg.HEALTH_PING_URL ?? null, port: v.cfg.PORT, db: prod.db })');
    expect(listen).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(listen);
  });

  it('and shutdown stops it BEFORE the server closes, so a deploy is never reported as an outage', () => {
    const close = main.slice(main.indexOf('async close() {'));
    const off = close.indexOf('await boss.offWork(QUEUES.heartbeat)');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(close.indexOf('await a.close();'));
  });

  it('HEALTH_PING_URL is checked at boot when set — https, a host and a path — and never printed', () => {
    const base = {
      DATABASE_URL: 'postgresql://nomi_app:x@h/nomi', ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(30),
      WEBHOOK_VERIFY_TOKEN: 'v'.repeat(20), CREDENTIAL_KEY: 'a'.repeat(64), LEGAL_CONTACT_EMAIL: 'privacy@example.com',
    };
    const ok = validateEnv({ ...base, HEALTH_PING_URL: URL_ });
    expect(ok.ok && ok.cfg.HEALTH_PING_URL).toBe(URL_);
    const unset = validateEnv(base);
    expect(unset.ok && unset.cfg.HEALTH_PING_URL).toBeUndefined();
    for (const bad of ['http://hc-ping.com/abc', 'https://hc-ping.com', 'https://hc-ping.com/', 'hc-ping.com/abc', 'https://hc ping.com/x']) {
      const r = validateEnv({ ...base, HEALTH_PING_URL: bad });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) {
        expect(r.problems).toContain('HEALTH_PING_URL: invalid shape');
        expect(r.problems.join('\n')).not.toContain(bad);
      }
    }
  });

  it('it is documented where an operator looks', () => {
    expect(read('docs/env-checklist.md')).toContain('`HEALTH_PING_URL`');
    expect(read('.env.example')).toContain('#HEALTH_PING_URL=');
    const doc = read('docs/MONITORING.md');
    for (const step of ['Nomi app', 'Period **5 minutes**', 'Grace Time **10 minutes**', 'HEALTH_PING_URL', 'Variables']) {
      expect(doc, step).toContain(step);
    }
  });

  it('Railway only replaces a running deploy once /health answers — and still migrates first', () => {
    const cfg = JSON.parse(read('railway.json')) as { deploy: { healthcheckPath?: string; preDeployCommand?: string[] } };
    expect(cfg.deploy.healthcheckPath).toBe('/health');
    expect(cfg.deploy.preDeployCommand).toEqual(['node tools/migrate.mjs']);
  });
});
