import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { requestLogger, requestLogLine } from '../../src/api/requestLog.js';
import { loggableError, loggableLine, loggableMessage } from '../../src/security/loggable.js';

/**
 * D2 (the data-protection audit, 2026-10-12) — THE LOGS KEEP NO BUYER DATA.
 *
 * The hosting platform keeps the logs, and no deletion reaches them. They held
 * a failed job's data (an inbound job is the buyer's words), every request's
 * full address (`/app/inbox?q=<a buyer's name or number>`, `?identity=`,
 * `?ask=`, `?teach=`, `/u?t=<an unsubscribe token>`) and a database error's
 * `detail`, which is the row it refused. Each is held here, with a control
 * that shows the check can fail.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const sources = (dir: string): string[] => readdirSync(ROOT + dir).flatMap((f) => {
  const rel = join(dir, f);
  if (statSync(ROOT + rel).isDirectory()) return sources(rel);
  return /\.ts$/.test(f) && !/\.test\.ts$/.test(f) ? [rel] : [];
});

const BUYER = 'Ahmed Karim';
const ADDRESS = 'ahmed.karim@example.com';
const WORDS = 'please send 500 bags before Friday';

/** A Postgres refusal as `pg` throws it: the row is in `detail`, never the message. */
const pgRefusal = () => Object.assign(
  new Error('new row for relation "messages" violates check constraint "messages_text_check"'),
  { code: '23514', detail: `Failing row contains (${WORDS}, ${ADDRESS}).` },
);

/** The logger as an options object (not `true`/`false`), so a test stream can be added. */
type LoggerOptions = Exclude<NonNullable<FastifyServerOptions['logger']>, boolean>;

async function logsOf(logger: LoggerOptions): Promise<string> {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
  const app = Fastify({ logger: { ...logger, stream } });
  app.get('/app/inbox', async () => 'ok');
  app.get('/u', async () => 'ok');
  app.get('/boom', async () => { throw pgRefusal(); });
  await app.ready();
  await app.inject(`/app/inbox?q=${encodeURIComponent(BUYER)}&identity=${encodeURIComponent(ADDRESS)}`);
  await app.inject('/u?t=eyJlIjoiYWhtZWQua2FyaW1AZXhhbXBsZS5jb20ifQ');
  await app.inject(`/boom?ask=${encodeURIComponent(WORDS)}`);
  await app.close();
  return lines.join('');
}

describe('D2 · a request leaves its path in the log, never its query or its caller', () => {
  it('the request line is method, path and host', () => {
    expect(requestLogLine({ method: 'GET', url: `/app/inbox?q=${BUYER}`, host: 'app.nomidoes.com' }))
      .toEqual({ method: 'GET', url: '/app/inbox', hostname: 'app.nomidoes.com' });
  });

  it('a running server logs no search, address, question, token or caller address', async () => {
    const made = requestLogger(true);
    if (typeof made === 'boolean') throw new Error('requestLogger(true) is an options object');
    const out = await logsOf(made);
    expect(out).toContain('/app/inbox');
    expect(out).toContain('23514');
    for (const leaked of ['Ahmed', 'Karim', 'example.com', 'bags', 'eyJ', 'Failing row', 'remoteAddress', '127.0.0.1']) {
      expect(out, leaked).not.toContain(leaked);
    }
  });

  it('control: Fastify on its own logs all of it, so the check above can fail', async () => {
    const out = await logsOf({});
    expect(out).toContain('q=Ahmed');
    expect(out).toContain('remoteAddress');
  });

  it('every server in the app is built with that logger', () => {
    const built = sources('src').flatMap((f) => (read(f).match(/Fastify\(\{[^)]*\)/g) ?? []).map((m) => `${f}: ${m}`));
    expect(built.length).toBeGreaterThanOrEqual(2);
    for (const b of built) expect(b).toMatch(/logger: requestLogger\(/);
  });
});

describe('D2 · an error is logged by its kind and code, never by the values it carries', () => {
  it('a database refusal keeps its code and message, never its detail', () => {
    const e = loggableError(pgRefusal());
    expect(e.code).toBe('23514');
    expect(e.message).toContain('violates check constraint "messages_text_check"');
    expect(JSON.stringify(e)).not.toMatch(/bags|example\.com|Failing row/);
  });

  it('a parser that quotes what it could not read (the model\'s answer) is cut', () => {
    let thrown: unknown;
    try { JSON.parse(`Sure! ${WORDS}`); } catch (e) { thrown = e; }
    const line = loggableLine(thrown);
    expect(line).toMatch(/^SyntaxError/);
    expect(line).not.toMatch(/Sure|plea|bags/);
    expect(String((thrown as Error).message)).toContain('Sure! plea'); // control: Node quotes the start of it
    let short: unknown;
    try { JSON.parse('Hi there'); } catch (e) { short = e; }
    expect(String((short as Error).message)).toContain('"Hi there"');
    expect(loggableLine(short)).not.toContain('Hi');
  });

  it('a quoted value after a colon, and any long quoted run, is cut', () => {
    expect(loggableMessage(`invalid input syntax for type uuid: "${BUYER}"`)).not.toContain('Ahmed');
    expect(loggableMessage(`could not read "${WORDS}" from the reply`)).not.toContain('bags');
    expect(loggableMessage(`no conversation with "${BUYER}"`)).not.toContain('Ahmed');
    expect(loggableMessage(`relation "conversations" does not exist`)).toContain('"conversations"');
  });

  it('a provider\'s own short reason survives (it is how a bad key is found)', () => {
    const raw = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    expect(loggableMessage(raw)).toBe(raw);
  });

  it('the stack keeps its frames and drops its first line, which repeats the message', () => {
    const e = loggableError(Object.assign(new Error(`could not send to "${WORDS}"`), {}));
    expect(e.stack).toMatch(/^at /);
    expect(e.stack).not.toContain('bags');
  });
});

describe('D2 · no log line in the app prints a job\'s data or a raw error message', () => {
  const lines = sources('src').flatMap((f) => read(f).split('\n').map((l, i) => ({ at: `${f}:${i + 1}`, l })));
  const logs = lines.filter(({ l }) => /(console\.(error|warn|log|info)|\.log\.(error|warn|info|debug))\(/.test(l));

  it('there are log lines to check', () => expect(logs.length).toBeGreaterThan(20));

  it('a dead letter names the queue and the ids, never the job\'s data', () => {
    const dead = read('src/worker/main.ts');
    const at = dead.indexOf('[DEAD LETTER]');
    expect(at).toBeGreaterThan(0);
    const line = dead.slice(at, dead.indexOf(';', at));
    expect(line).not.toMatch(/job\.data\)/);
    expect(line).toMatch(/businessId/);
    for (const { at: where, l } of lines) expect(`${where} ${l}`).not.toMatch(/JSON\.stringify\(job\.data\)/);
  });

  it('an error\'s message is printed only through loggableMessage / loggableLine', () => {
    const raw = logs.filter(({ l }) => /\.message\b/.test(l) && !/loggable/.test(l));
    expect(raw.map((r) => r.at)).toEqual([]);
  });

  it('a whole error object is never handed to console.* (util.inspect prints `detail`)', () => {
    const whole = logs.filter(({ l }) => /console\.(error|warn|log)\([^)]*,\s*(e|err|error)\)/.test(l));
    expect(whole.map((r) => r.at)).toEqual([]);
  });
});
