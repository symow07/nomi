import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * T1 — PRACTICE IS THE PILOT'S ALONE, FOR NOW (the one-month build order,
 * 2026-09-29). It was one shared tenant that any signed-in workspace could
 * read, write and reset. Since P3 each workspace practises on its own copy
 * (0086), so nothing of one reaches another — but every practice message is a
 * live model turn, and until P5 charges those to the workspace and caps them,
 * only the pilot may practise. Every practice route answers another workspace
 * with the same not-found as a wrong address, and changes nothing: no copy is
 * even made.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const PILOT = `dd7c0000-0000-4000-8000-${RUN}0007`;
const OTHER = `dd7c0000-0000-4000-8000-${RUN}0008`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('T1 · the practice sandbox is the pilot workspace\'s alone (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let pilot = '';
  let other = '';
  let queued = 0;

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  /** Another workspace's practice copy, if anything made one (0087 answers only inside that workspace). */
  const copyOf = (biz: string) => as(biz, (x) => sql<{ id: string | null }>`select practice_copy(${biz}::uuid)::text as id`
    .execute(x).then((r) => r.rows[0]!.id));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[PILOT, 'The Pilot'], [OTHER, 'Another Shop']] as const) {
      await as(id, (x) => sql`insert into businesses (id, name, owner_locale) values (${id}, ${name}, 'en') on conflict (id) do nothing`.execute(x));
    }
    app = Fastify({ logger: false });
    const code = `pr-${RUN}`;
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      enqueueInbound: async () => { queued++; },
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
    expect((await app.inject({ method: 'GET', url: '/app/today', headers: { cookie: other } })).statusCode).not.toBe(302); // signed in
    const tries: [string, string, Record<string, string>][] = [
      ['GET', '/app/sandbox', {}],
      ['POST', '/app/sandbox/message', { text: 'hello from another shop' }],
      ['POST', '/app/sandbox/scenario', { scenarioId: 'price-floor-clamp-under-aggressive-discount' }],
      ['POST', '/app/sandbox/act', { draftId: randomUUID(), command: '发送' }],
      ['POST', '/app/sandbox/reset', {}],
      ['POST', '/app/sandbox/takeover', {}],
      ['GET', '/app/live/practice?since=0.0.00000000', {}],
    ];
    for (const [method, url, fields] of tries) {
      const r = method === 'GET'
        ? await app.inject({ method: 'GET', url, headers: { cookie: other } })
        : await app.inject({ method: 'POST', url, headers: { cookie: other, ...FORM }, payload: new URLSearchParams(fields).toString() });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    expect(await copyOf(OTHER)).toBeNull();   // no copy was made for them
    expect(queued).toBe(0);                    // and nothing reached the queue
  });

  it('and no page of theirs offers the door', async () => {
    for (const url of ['/app/employee', '/app/factory', '/app/knowledge']) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: other } });
      if (r.statusCode === 200) expect(r.body, url).not.toContain('href="/app/sandbox');
    }
  });
});
