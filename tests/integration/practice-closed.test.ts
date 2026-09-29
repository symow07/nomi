import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * T1 — THE SHARED PRACTICE SANDBOX IS THE PILOT'S ALONE (the one-month build
 * order, 2026-09-29). There is one practice tenant for the installation; any
 * signed-in workspace could read, write and reset it — what the pilot typed
 * there, and real customer text if any was ever pasted in. Now every sandbox
 * route answers another workspace with the same not-found as a wrong address,
 * and changes nothing. Per-workspace Practice (P1–P6) waits on decisions 4, 5.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const PILOT = `dd7c0000-0000-4000-8000-${RUN}0007`;
const OTHER = `dd7c0000-0000-4000-8000-${RUN}0008`;
const SANDBOX = `dd7c0000-0000-4000-8000-${RUN}0009`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('T1 · the practice sandbox is the pilot workspace\'s alone (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let pilot = '';
  let other = '';

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const sandboxRows = () => as(SANDBOX, (x) => sql<{ n: number }>`
    select (select count(*) from conversations)::int + (select count(*) from messages m join conversations c on c.id = m.conversation_id)::int as n`
    .execute(x).then((r) => r.rows[0]!.n));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[PILOT, 'The Pilot'], [OTHER, 'Another Shop'], [SANDBOX, 'Practice']] as const) {
      await as(id, (x) => sql`insert into businesses (id, name, owner_locale) values (${id}, ${name}, 'en') on conflict (id) do nothing`.execute(x));
    }
    app = Fastify({ logger: false });
    const code = `pr-${RUN}`;
    registerWebApp(app, {
      db, businessId: PILOT, sandboxBusinessId: SANDBOX, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    pilot = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    // Another workspace's own signed session — as its owner would hold it after signing in.
    other = `yf_session=${makeSessionCodec(SECRET).sign({ businessId: OTHER, exp: Date.now() + 3_600_000 })}`;
    expect(pilot).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the pilot practises there', async () => {
    const r = await app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie: pilot } });
    expect(r.statusCode).toBe(200);
  });

  it('another workspace can neither read, write nor reset it — every route is not found, and nothing changes', async () => {
    const before = await sandboxRows();
    expect((await app.inject({ method: 'GET', url: '/app/today', headers: { cookie: other } })).statusCode).not.toBe(302); // signed in
    const tries: [string, string, Record<string, string>][] = [
      ['GET', '/app/sandbox', {}],
      ['POST', '/app/sandbox/message', { text: 'hello from another shop', mode: 'scripted' }],
      ['POST', '/app/sandbox/scenario', { scenario: 'price', mode: 'scripted' }],
      ['POST', '/app/sandbox/act', { draftId: randomUUID(), command: '发送', mode: 'scripted' }],
      ['POST', '/app/sandbox/reset', {}],
    ];
    for (const [method, url, fields] of tries) {
      const r = method === 'GET'
        ? await app.inject({ method: 'GET', url, headers: { cookie: other } })
        : await app.inject({ method: 'POST', url, headers: { cookie: other, ...FORM }, payload: new URLSearchParams(fields).toString() });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await sandboxRows()).toBe(before);
  });

  it('and no page of theirs offers the door', async () => {
    for (const url of ['/app/employee', '/app/factory', '/app/knowledge']) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: other } });
      if (r.statusCode === 200) expect(r.body, url).not.toContain('href="/app/sandbox');
    }
  });
});
