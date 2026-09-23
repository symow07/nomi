import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server, type Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a tool helper, plain JS on purpose.
import { toolClient } from '../../tools/lib/db.mjs';

/**
 * The operator tools fail LOUDLY on a database that does not answer.
 *
 * On 2026-09-22 Railway's public proxy accepted connections and then answered
 * nothing — not even `begin` — and a tool with no limits waits on that for
 * ever. These tests build that exact server on loopback and hold the tools to
 * a sentence and a deadline, rather than reading the source for a setting.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) s.close();
});

/** A server that takes the connection and never says a word. */
const mute = (): Promise<number> => listen(() => {});

/**
 * A server that logs the client in — AuthenticationOk, ReadyForQuery — and
 * then answers nothing at all. The "connected, then silent" proxy.
 */
const silentAfterLogin = (): Promise<number> => listen((sock) => {
  let greeted = false;
  sock.on('data', () => {
    if (greeted) return;             // every query after login: silence
    greeted = true;
    const auth = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);    // 'R' len=8 ok
    const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);          // 'Z' len=5 'I'
    sock.write(Buffer.concat([auth, ready]));
  });
});

function listen(onConn: (s: Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer((sock) => { sockets.push(sock); sock.on('error', () => {}); onConn(sock); });
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as { port: number }).port));
  });
}

const url = (port: number) => `postgresql://nobody@127.0.0.1:${port}/nomi`;

describe('toolClient — no silent hangs', () => {
  it('a server that never answers the login fails within the connect limit, and says so', async () => {
    const port = await mute();
    const c = toolClient(url(port), { replyTimeoutMs: 5_000, connectTimeoutMs: 300 });
    const t0 = Date.now();
    await expect(c.connect()).rejects.toThrow(/could not reach the database within .*Nothing was changed/);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it('CONNECTED, THEN SILENT — the query fails, the connection closes, and the rollback does not hang', async () => {
    const port = await silentAfterLogin();
    const c = toolClient(url(port), { replyTimeoutMs: 300 });
    await c.connect();
    const t0 = Date.now();
    await expect(c.query('begin')).rejects.toThrow(/stopped answering: no reply within/);
    // What every tool does next, in its catch block. Without the close this
    // queues behind the stuck query and hangs exactly as before.
    await expect(c.query('rollback')).rejects.toThrow(/stopped answering/);
    await c.end().catch(() => {});
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it('never repeats the connection string in what it prints', async () => {
    const port = await mute();
    const secret = `postgresql://owner:hunter2@127.0.0.1:${port}/nomi`;
    const c = toolClient(secret, { replyTimeoutMs: 1_000, connectTimeoutMs: 200 });
    const err = await c.connect().then(() => null, (e: Error) => e);
    expect(err?.message).not.toContain('hunter2');
  });
});

describe('every tool that can reach production uses it', () => {
  const TOOLS = [
    'tools/migrate.mjs', 'tools/erase-workspace.mjs', 'tools/prune-test-tenants.mjs',
    'tools/invite-factory.mjs', 'tools/provision-factory.mjs', 'tools/outreach-area.mjs',
  ];
  for (const f of TOOLS) {
    it(f, () => {
      const src = read(f);
      expect(src).toContain("from './lib/db.mjs'");
      expect(src).not.toMatch(/new pg\.Client|import pg from/);
    });
  }
});

describe('backup.sh — bounded at every step', () => {
  const src = read('tools/backup.sh');

  it('sets a connect limit for every libpq tool it runs', () => {
    expect(src).toMatch(/^export PGCONNECT_TIMEOUT=/m);
  });

  it('asks the server nothing outside a limit', () => {
    // Every psql against the database goes through pq(), which is within().
    // (The URL it is given has no password in it — no-secret-in-argv.test.ts.)
    const raw = src.split('\n').filter((l) => /"\$PSQL" -d "\$PG_URL_NOPASS"/.test(l));
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatch(/^pq\(\) \{ within "\$QUERY_LIMIT"/);
    expect(src).toMatch(/within "\$ATTEMPT_LIMIT" "\$@"/);
  });

  // The watchdog itself, run for real: lifted out of the script and exercised.
  const within = src.match(/^within\(\) \{[\s\S]*?^\}/m)?.[0] ?? '';
  const run = (cmd: string): string =>
    execFileSync('bash', ['-c', `${within}\n${cmd}; echo "rc=$?"`], { encoding: 'utf8' }).trim();

  it('stops a command that outlives its limit, with 124', () => {
    expect(within).not.toBe('');
    const t0 = Date.now();
    expect(run('within 1 sleep 20')).toBe('rc=124');
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("keeps the command's own exit code when it finishes in time", () => {
    expect(run('within 5 true')).toBe('rc=0');
    expect(run('within 5 false')).toBe('rc=1');
  });
});
