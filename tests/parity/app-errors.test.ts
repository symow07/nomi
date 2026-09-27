import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
  alertOwed, errorWhere, describeThrown, firstRepoFrame, messageShape, scrubSecrets,
  ALERT_AGAIN_AFTER_HOURS, ALERTS_PER_HOUR, MESSAGE_MAX, type ReportError,
} from '../../src/core/ops/appErrors.js';
import {
  appErrorEntry, deadLetter, installCrashReporting, isAppErrorAlertJob, makeErrorReporter,
  reportJobFailures, secretValuesIn, appErrorNotifyJob,
} from '../../src/worker/appErrors.js';
import { renderOwnerAlert, OPERATOR_ALERT_KINDS, isOperatorAlert } from '../../src/pipeline/notify.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { QUEUES } from '../../src/queue/boss.js';

/**
 * CC-10 — errors are written down, and whoever runs the installation hears of
 * each kind once. The database half is in tests/integration/app-errors.test.ts;
 * this file holds what needs no database: how errors are told apart, what is
 * kept of them, that every job handler reports and the process too, that the
 * recorder can neither throw nor loop, and the alert's words.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const ROOT = '/srv/app';
const H = 3_600_000;

describe('the rule: first sight, then six hours, and six an hour', () => {
  const now = new Date('2026-09-27T03:00:00Z');
  it('owed when never alerted; not while held; again only six hours after the last', () => {
    expect(ALERT_AGAIN_AFTER_HOURS).toBe(6);
    expect(ALERTS_PER_HOUR).toBe(6);
    expect(alertOwed({ lastAlertedAt: null, heldAt: null }, now)).toBe(true);
    expect(alertOwed({ lastAlertedAt: null, heldAt: now }, now)).toBe(false);
    expect(alertOwed({ lastAlertedAt: new Date(now.getTime() - 5.9 * H), heldAt: null }, now)).toBe(false);
    expect(alertOwed({ lastAlertedAt: new Date(now.getTime() - 6 * H), heldAt: null }, now)).toBe(true);
  });
});

describe('telling errors apart', () => {
  const stack = (...frames: string[]) => ['Error: boom', ...frames.map((f) => `    at ${f}`)].join('\n');

  it('the first frame inside the repository — past node_modules and Node’s own code — as file:line', () => {
    expect(firstRepoFrame(stack(
      'Parser.parse (/srv/app/node_modules/pg-protocol/dist/parser.js:287:98)',
      'process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
      'async handler (/srv/app/dist/api/web/app.js:1234:7)',
      'async Object.x (/srv/app/dist/main.js:10:1)',
    ), ROOT)).toBe('dist/api/web/app.js:1234');
    expect(firstRepoFrame(stack('file:///srv/app/dist/main.js:1000:5'), ROOT)).toBe('dist/main.js:1000');
    expect(firstRepoFrame(stack('Object.<anonymous> (/elsewhere/x.js:1:1)'), ROOT)).toBeNull();
    expect(firstRepoFrame(null, ROOT)).toBeNull();
  });

  it('reads a percent-encoded file URL — this checkout’s own path has a space and a curly apostrophe', () => {
    const root = '/Users/x/Desktop - symow’s Mac/nomi';
    const url = `file://${encodeURI(root)}/src/api/web/app.ts:619:25`.replace(/’/g, '%E2%80%99');
    expect(firstRepoFrame(stack(`handler (${url})`), root)).toBe('src/api/web/app.ts:619');
  });

  it('two throws from the same line are ONE fingerprint; a different line, name or place is another', () => {
    const at = (line: number, name = 'TypeError', where: 'web' | `worker:${string}` = 'web') =>
      appErrorEntry(Object.assign(new Error('x'), { name, stack: stack(`h (/srv/app/src/a.ts:${line}:1)`) }), where, {}, { root: ROOT, knownSecrets: [] });
    expect(at(10).fingerprint).toBe(at(10).fingerprint);
    expect(at(10).fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(at(11).fingerprint).not.toBe(at(10).fingerprint);
    expect(at(10, 'RangeError').fingerprint).not.toBe(at(10).fingerprint);
    expect(at(10, 'TypeError', 'worker:message.inbound').fingerprint).not.toBe(at(10).fingerprint);
    expect(at(10).frame).toBe('src/a.ts:10');
  });

  it('WITHOUT a frame of ours (the database raised it): the shape of the message and the code tell them apart', () => {
    const pg = (message: string, code: string) => appErrorEntry(
      Object.assign(new Error(message), { name: 'error', code, stack: stack('Parser.parse (/srv/app/node_modules/pg-protocol/dist/parser.js:1:1)') }),
      'worker:message.inbound', {}, { root: ROOT, knownSecrets: [] });
    const a1 = pg('duplicate key value violates unique constraint "x" for id 4f1c2e9a-0000-4000-8000-000000000001', '23505');
    const a2 = pg('duplicate key value violates unique constraint "x" for id 4f1c2e9a-0000-4000-8000-000000000002', '23505');
    const b = pg('relation "app_errors" does not exist', '42P01');
    expect(a1.frame).toBeNull();
    expect(a1.fingerprint).toBe(a2.fingerprint);
    expect(b.fingerprint).not.toBe(a1.fingerprint);
    expect(messageShape("job 12 took 'abc' at 0xdeadbeef")).toBe("job # took '…' at <hex>");
  });

  it('a dead letter is one kind per queue, whatever the job', () => {
    const d = (id: string) => appErrorEntry(deadLetter(QUEUES.inbound, id), `worker:${QUEUES.inbound}`, {}, { root: ROOT, knownSecrets: [] });
    expect(d('4f1c2e9a-0000-4000-8000-000000000001').fingerprint).toBe(d('4f1c2e9a-0000-4000-8000-0000000000ff').fingerprint);
    expect(d('j').name).toBe('DeadLetter');
    expect(d('j').message).toContain('gave up after its retries');
  });

  it('anything thrown has a name and a message; a cause is kept (that is where `fetch failed` says why)', () => {
    expect(describeThrown('plain string')).toMatchObject({ name: 'NonError', message: 'plain string' });
    expect(describeThrown({ weird: true })).toMatchObject({ name: 'Error' });
    const f = describeThrown(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) }));
    expect(f.message).toBe('fetch failed (cause: Error: connect ECONNREFUSED 127.0.0.1:443)');
  });

  it('`where` always fits the table: web, process, or worker:<queue>', () => {
    expect(errorWhere('web')).toBe('web');
    expect(errorWhere('process')).toBe('process');
    expect(errorWhere('worker:message.inbound')).toBe('worker:message.inbound');
    expect(errorWhere('worker:Weird Queue/Name')).toBe('worker:weird-queue-name');
    expect(errorWhere('worker:')).toBe('worker:unknown');
  });
});

describe('what is kept of an error — nothing secret, nothing long', () => {
  const entry = (message: string, knownSecrets: string[] = [], route: string | null = null) =>
    appErrorEntry(new Error(message), 'web', { route }, { root: ROOT, knownSecrets });

  it('keys, tokens and passwords by their shape', () => {
    const m = entry([
      'upstream said Bearer sk-live-abcdef0123456789abcdef',
      'password=hunter2 api_key=AKIA1234567890',
      'postgresql://nomi_app:s3cretPassw0rd@db.internal:5432/nomi',
      'token: EAAGm0PX4ZCpsBAKZCZBabcdefghijklmnopqrst',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
      'key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX',
    ].join(' | ')).message;
    for (const secret of ['sk-live-abcdef', 'hunter2', 'AKIA1234567890', 's3cretPassw0rd', 'EAAGm0PX4', 'dozjgNryP4J3', 'sk-ant-api03']) {
      expect(m, secret).not.toContain(secret);
    }
    expect(m).toContain('[redacted]');
    expect(m).toContain('postgresql://nomi_app:[redacted]@db.internal:5432/nomi');
  });

  it('an address keeps its host and path, never its query or an opaque key in its path', () => {
    const m = entry('GET https://app.nomidoes.com/u?t=abc.def.ghi failed; ping https://hc-ping.com/1f2e3d4c-5b6a-4789-9abc-def012345678 failed').message;
    expect(m).toContain('https://app.nomidoes.com/u?[redacted]');
    expect(m).toContain('https://hc-ping.com/[redacted]');
    expect(m).not.toContain('abc.def.ghi');
    expect(m).not.toContain('1f2e3d4c');
  });

  it('every value the environment holds as a secret — and the password inside a database URL', () => {
    const env = {
      DATABASE_URL: 'postgresql://nomi_app:Very-Secret-Pw@db:5432/nomi', ANTHROPIC_API_KEY: 'plainlookingvalue123',
      OWNER_ACCESS_CODE: 'letmein-please', HEALTH_PING_URL: 'https://hc-ping.com/abc', PUBLIC_BASE_URL: 'https://app.nomidoes.com',
      META_LOGIN_CONFIG_ID: '1234567890', SHORT_KEY: 'abc',
    };
    const known = secretValuesIn(env);
    expect(known).toContain('Very-Secret-Pw');
    expect(known).toContain('plainlookingvalue123');
    expect(known).toContain('letmein-please');
    expect(known).toContain('https://hc-ping.com/abc');
    expect(known).not.toContain('https://app.nomidoes.com');   // public on purpose
    expect(known).not.toContain('1234567890');
    expect(known).not.toContain('abc');                        // too short to be one
    const m = entry('auth failed with Very-Secret-Pw, key plainlookingvalue123, code letmein-please', known).message;
    expect(m).not.toMatch(/Very-Secret-Pw|plainlookingvalue123|letmein-please/);
  });

  it(`cut to ${MESSAGE_MAX} characters, and says so`, () => {
    const m = entry('x'.repeat(5_000)).message;
    expect(m.length).toBe(MESSAGE_MAX);
    expect(m.endsWith('…')).toBe(true);
  });

  it('a route is kept as its pattern, scrubbed like everything else', () => {
    expect(entry('x', [], 'GET /app/inbox/:id').route).toBe('GET /app/inbox/:id');
  });

  it('a business id is context only, and only when it IS one', () => {
    const e = (businessId: string) => appErrorEntry(new Error('x'), 'web', { businessId }, { root: ROOT, knownSecrets: [] });
    expect(e('4f1c2e9a-0000-4000-8000-000000000001').businessId).toBe('4f1c2e9a-0000-4000-8000-000000000001');
    expect(e('unknown').businessId).toBeNull();
  });

  it('scrubSecrets leaves ordinary words alone', () => {
    const s = 'relation "app_errors" does not exist at src/db/appErrors.ts:12 (port 5432)';
    expect(scrubSecrets(s)).toBe(s);
  });
});

describe('the recorder can neither throw nor loop, and a flood cannot drain the pool', () => {
  const brokenDb = () => ({ transaction: () => ({ execute: async () => { throw new Error('connect ECONNREFUSED — password=hunter2'); } }) });
  const hangingDb = () => ({ transaction: () => ({ execute: () => new Promise<never>(() => {}) }) });

  it('a database that refuses: report RESOLVES, one log line, nothing recorded about the recording', async () => {
    const logs: string[] = [];
    let enqueued = 0;
    const r = makeErrorReporter({ db: brokenDb() as never, enqueue: async () => { enqueued++; }, log: (l) => logs.push(l) });
    await expect(r.report(new Error('first'), 'web')).resolves.toBeUndefined();
    await r.idle();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/\[errors\] an error from web was not recorded/);
    expect(logs[0]).not.toContain('hunter2');
    expect(enqueued).toBe(0);
  });

  it('a database that hangs: the caller waits at most its limit; past the in-flight cap, errors are logged, once', async () => {
    const logs: string[] = [];
    const r = makeErrorReporter({ db: hangingDb() as never, enqueue: null, log: (l) => logs.push(l), timeoutMs: 30, maxInFlight: 2 });
    const t0 = Date.now();
    await r.report(new Error('a'), 'web');
    expect(Date.now() - t0).toBeLessThan(1_000);
    await r.report(new Error('b'), 'web');
    await r.report(new Error('c'), 'web');
    await r.report(new Error('d'), 'web');
    expect(logs.filter((l) => l.includes('recordings already in flight'))).toHaveLength(1);
  });
});

describe('EVERY job handler reports its failure — wrapped once, in startWorker', () => {
  const fakeBoss = () => {
    const handlers = new Map<string, (jobs: { data?: unknown }[]) => Promise<unknown>>();
    const boss = {
      work: async (name: string, ...rest: unknown[]) => {
        handlers.set(name, rest[rest.length - 1] as never);
        return `worker-${name}`;
      },
    };
    return { boss, handlers };
  };

  it('a failure is recorded as worker:<queue> with the job’s business, then REthrown so pg-boss retries', async () => {
    const { boss, handlers } = fakeBoss();
    const seen: Parameters<ReportError>[] = [];
    reportJobFailures(boss as never, async (...a) => { seen.push(a); });
    const boom = new Error('no');
    await boss.work('message.outbound', async () => { throw boom; });
    await boss.work('ops.backups', { batchSize: 1 }, async () => 'fine');     // the options overload too
    await expect(handlers.get('message.outbound')!([{ data: { businessId: 'b1' } }])).rejects.toBe(boom);
    expect(seen).toEqual([[boom, 'worker:message.outbound', { businessId: 'b1' }]]);
    await expect(handlers.get('ops.backups')!([{ data: {} }])).resolves.toBe('fine');
    expect(seen).toHaveLength(1);
  });

  it('an error ALERT that failed to deliver is not reported — that is the loop', async () => {
    const { boss, handlers } = fakeBoss();
    const seen: unknown[] = [];
    reportJobFailures(boss as never, async (...a) => { seen.push(a); }, isAppErrorAlertJob);
    await boss.work(QUEUES.notify, async () => { throw new Error('mail down'); });
    await expect(handlers.get(QUEUES.notify)!([{ data: { kind: 'app_error' } }])).rejects.toThrow();
    expect(seen).toHaveLength(0);
    await expect(handlers.get(QUEUES.notify)!([{ data: { kind: 'handoff' } }])).rejects.toThrow();
    expect(seen).toHaveLength(1);                                   // any other alert failing is an error
    expect(isAppErrorAlertJob(`${QUEUES.notify}.dead`, [{ data: { kind: 'app_error' } }])).toBe(true);
    expect(isAppErrorAlertJob(QUEUES.inbound, [{ data: { kind: 'app_error' } }])).toBe(false);
  });

  it('the wiring: startWorker wraps boss.work BEFORE the first handler, and records every dead letter', () => {
    const worker = read('src/worker/main.ts');
    const wrap = worker.indexOf('reportJobFailures(boss, errors.report, isAppErrorAlertJob)');
    expect(wrap).toBeGreaterThan(-1);
    expect(wrap).toBeLessThan(worker.indexOf('await boss.work<InboundJob>'));
    const dead = worker.slice(worker.indexOf('await boss.work(`${name}.dead`'));
    expect(dead).toMatch(/if \(!isAppErrorAlertJob\(name, \[job\]\)\) \{[\s\S]*?errors\.report\(deadLetter\(name, /);
    // The dead letter's DATA is never what is written down: a buyer's words ride in an inbound job.
    expect(dead.slice(0, dead.indexOf('// Never re-notify'))).not.toMatch(/errors\.report\([^)]*job\.data[^.]/);
  });

  it('main.ts: the minute sweep’s own caught failures are reported, the page handler gets the recorder, and so does the process', () => {
    const main = read('src/main.ts');
    const sweep = /boss\.work<SequenceSweepJob>[\s\S]*?\n {2}\}\);/.exec(main)?.[0] ?? '';
    expect(sweep.match(/void errors\.report\(e, `worker:\$\{QUEUES\.sequences\}`, \{ businessId: tenant \}\)/g)?.length).toBe(3);
    expect(main).toMatch(/registerWebApp\(a, \{[\s\S]*?reportError: errors\.report,/);
    expect(main).toMatch(/installCrashReporting\(process, \{\s*report: prod\.reportError,/);
    expect(main).toMatch(/boss\.schedule\(QUEUES\.errors, '\*\/5 \* \* \* \*'/);
    expect(main).toMatch(/await errors\.releaseHeld\(\);/);
    expect(main).toMatch(/PILOT_BUSINESS_ID: process\.env\['PILOT_BUSINESS_ID'\] \?\? DEMO_PILOT_BUSINESS_ID/);
  });

  it('the web handler reports 500s only — after the 4xx return — with the route PATTERN and never the URL', () => {
    const app = read('src/api/web/app.ts');
    const handler = app.slice(app.indexOf('app.setErrorHandler('), app.indexOf('const ownerPage = ('));
    const fourXX = handler.indexOf('if (status < 500) return reply.code(status).send(err);');
    const report = handler.indexOf('recordCrash(err, req);');
    expect(fourXX).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(fourXX);
    const helper = app.slice(app.indexOf('const recordCrash = ('), app.indexOf('app.setNotFoundHandler('));
    expect(helper).toContain("void deps.reportError(err, 'web', {");
    expect(helper).toContain('route: `${req.method} ${req.routeOptions?.url');
    expect(helper).not.toMatch(/req\.(url|body|query|params)\b/);
  });
});

describe('the process itself: written down, then it ends with 1 as it always did', () => {
  const proc = () => new EventEmitter() as EventEmitter & { on(e: string, l: (err: unknown) => void): unknown };

  it('uncaughtException → recorded as process, THEN exit(1); a second one while crashing is only logged', async () => {
    const p = proc();
    const reports: unknown[] = [];
    const exits: number[] = [];
    let release!: () => void;
    const recorded = new Promise<void>((r) => { release = r; });
    installCrashReporting(p, {
      report: async (err, where) => { reports.push([err, where]); await recorded; },
      exit: (code) => exits.push(code), log: () => {}, waitMs: 1_000,
    });
    const boom = new Error('boom');
    p.emit('uncaughtException', boom);
    p.emit('uncaughtException', new Error('second'));
    expect(reports).toEqual([[boom, 'process']]);
    expect(exits).toEqual([]);                     // waits for the recording…
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([1]);                    // …then ends, once
  });

  it('unhandledRejection too; and a recording that never finishes cannot keep the process alive past its limit', async () => {
    const p = proc();
    const exits: number[] = [];
    installCrashReporting(p, { report: () => new Promise<void>(() => {}), exit: (c) => exits.push(c), log: () => {}, waitMs: 20 });
    p.emit('unhandledRejection', new Error('nobody caught me'));
    await new Promise((r) => setTimeout(r, 80));
    expect(exits).toEqual([1]);
  });
});

describe('the alert, in the owner’s words around the program’s own', () => {
  const alert = (more = 0) => appErrorNotifyJob('4f1c2e9a-0000-4000-8000-000000000001', {
    fingerprint: '7f3a9c2e1b4d5e6f', where: 'web', name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')",
    frame: 'dist/api/web/inbox.js:212', route: 'GET /app/inbox/:id', count: 3,
    firstSeen: new Date('2026-09-27T03:12:00Z'), lastSeen: new Date('2026-09-27T03:40:00Z'), more,
  });

  it('is an OPERATOR alert: e-mail always, WhatsApp only where live', () => {
    expect(OPERATOR_ALERT_KINDS).toContain('app_error');
    expect(isOperatorAlert('app_error')).toBe(true);
    expect(isOperatorAlert('handoff')).toBe(false);
  });

  it('in every language: the sentence, the error word for word, the count, the reference, where the list is', () => {
    for (const l of LOCALES) {
      const job = alert();
      const s = renderOwnerAlert(l, 'app_error', null, { appError: job.appError! });
      expect(s.startsWith(t(l, 'notify.app_error')), l).toBe(true);
      expect(s, l).toContain('web · GET /app/inbox/:id');
      expect(s, l).toContain("TypeError: Cannot read properties of undefined (reading 'id')");
      expect(s, l).toContain('dist/api/web/inbox.js:212 · #7f3a9c2e1b4d');
      expect(s, l).toContain(t(l, 'notify.app_error.list'));
      expect(s, l).not.toContain('{');
      expect(messages[l]['notify.app_error.subject'].length, l).toBeGreaterThan(0);
      // "And N more" only when something was held back.
      const fragment = messages[l]['notify.app_error.more'].split('{count}').sort((a, b) => b.length - a.length)[0]!;
      expect(s, l).not.toContain(fragment);
      const more = renderOwnerAlert(l, 'app_error', null, { appError: alert(4).appError! });
      expect(more, l).toContain(t(l, 'notify.app_error.more', { count: 4 }));
    }
  });

  it('without its detail it is still a sentence, never a blank', () => {
    for (const l of LOCALES) expect(renderOwnerAlert(l, 'app_error', null, {})).toBe(t(l, 'notify.app_error'));
  });

  it('the owner’s words carry no technical vocabulary and no pronoun for anyone', () => {
    const keys = (Object.keys(messages.en) as MessageKey[]).filter((k) => k.startsWith('notify.app_error'));
    expect(keys.length).toBe(5);
    for (const l of LOCALES) for (const k of keys) {
      const s = messages[l][k].toLowerCase();
      for (const w of ['server', 'database', 'api', 'timeout', 'ai', 'model', 'queue', 'job', 'webhook', 'stack', 'exception']) {
        expect(new RegExp(`\\b${w}\\b`).test(s), `${l}/${k}: ${w}`).toBe(false);
      }
      expect(s).not.toMatch(/\b(she|her|he|his)\b/);
    }
  });
});
