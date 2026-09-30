import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * EVERY WORKSPACE PRACTISES ON ITS OWN COPY (P5; docs/PRACTICE.md).
 *
 * Until P5 there was one shared practice tenant, and T1 (#129) kept it to the
 * pilot: any signed-in workspace could otherwise read, write and reset what
 * the pilot put there. Now each workspace's messages go to its own copy
 * (0086), so the gate is gone — and this test holds what replaced it: nothing
 * one workspace does in Practice is seen, answered, approved or reset from
 * another's session.
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

d('P5 · every workspace practises on its own copy, and no other reaches it (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let pilot = '';
  let other = '';
  const queued: { businessId: string; conversationId: string; text: string }[] = [];

  const as = async <R>(biz: string, fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  /** A workspace's copy — `practice_copy` answers only inside that workspace (0087). */
  const copyOf = (biz: string) => as(biz, (x) => sql<{ id: string | null }>`select practice_copy(${biz}::uuid)::text as id`
    .execute(x).then((r) => r.rows[0]!.id));
  const post = (cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(fields).toString() });
  const page = (cookie: string) => app.inject({ method: 'GET', url: '/app/sandbox', headers: { cookie } }).then((r) => r.body);

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
      // The worker is not started here: what reaches the queue is what matters.
      enqueueInbound: async (job: { businessId: string; conversationId: string; text: string }) => { queued.push(job); },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    pilot = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    // Another workspace's own signed session — as its owner would hold it after signing in.
    other = `yf_session=${makeSessionCodec(SECRET).sign({ businessId: OTHER, exp: Date.now() + 3_600_000 })}`;
    expect(pilot).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('each workspace\'s message goes to its own copy — two copies, two queues of work, no line on the other\'s page', async () => {
    expect((await post(pilot, '/app/sandbox/message', { text: 'hello from the pilot' })).statusCode).toBe(302);
    expect((await post(other, '/app/sandbox/message', { text: 'hello from another shop' })).statusCode).toBe(302);
    const [pc, oc] = [await copyOf(PILOT), await copyOf(OTHER)];
    expect(pc).not.toBeNull();
    expect(oc).not.toBeNull();
    expect(pc).not.toBe(oc);
    expect(queued.map((j) => [j.businessId, j.text])).toEqual([[pc, 'hello from the pilot'], [oc, 'hello from another shop']]);
    const [mine, theirs] = [await page(pilot), await page(other)];
    expect(mine).toContain('hello from the pilot');
    expect(mine).not.toContain('hello from another shop');
    expect(theirs).toContain('hello from another shop');
    expect(theirs).not.toContain('hello from the pilot');
    // and the practice customers are two, one per copy
    const who = await as(pc!, (x) => sql<{ id: string }>`select channel_user_id as id from client_channels cc
      join clients c on c.id = cc.client_id where c.business_id = ${pc}::uuid`.execute(x).then((r) => r.rows.map((y) => y.id)));
    expect(who).toEqual([`practice:${pc}`]);
  });

  it('a reply waiting in one workspace\'s Practice cannot be approved, taken over or reset from another\'s', async () => {
    const pc = (await copyOf(PILOT))!;
    const conv = queued.find((j) => j.businessId === pc)!.conversationId;
    const draft = await as(pc, (x) => sql<{ id: string }>`insert into drafts (business_id, conversation_id, capability, draft_text, status)
      values (${pc}::uuid, ${conv}::uuid, 'greet', 'A reply the pilot is waiting on.', 'pending') returning id::text as id`.execute(x).then((r) => r.rows[0]!.id));
    await post(other, '/app/sandbox/act', { draftId: draft, command: '发送' });
    await post(other, '/app/sandbox/takeover');
    await post(other, '/app/sandbox/reset');
    const after = await as(pc, (x) => sql<{ status: string; assigned: string | null; active: boolean }>`
      select d.status, c.assigned_to as assigned, c.is_active as active from drafts d join conversations c on c.id = d.conversation_id
       where d.id = ${draft}::uuid`.execute(x).then((r) => r.rows[0]!));
    expect(after).toEqual({ status: 'pending', assigned: null, active: true });
    expect(await page(pilot)).toContain('A reply the pilot is waiting on.');
    expect(await page(other)).not.toContain('the pilot is waiting on');
  });

  it('the live line answers each workspace about its own Practice only', async () => {
    const { conversationMark } = await import('../../src/api/web/live.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const pc = parseBusinessId((await copyOf(PILOT))!); if (!pc.ok) throw new Error('fixture');
    const conv = queued.find((j) => j.businessId === pc.value)!.conversationId;
    const mark = (await conversationMark(db, pc.value, conv, 'both'))!;
    const ask = () => app.inject({ method: 'GET', url: `/app/live/practice?since=${mark}`, headers: { cookie: pilot, accept: 'application/json' } });
    expect((await ask()).json()).toEqual({ news: false });
    // the other workspace writes again: that is not news in the pilot's Practice
    await post(other, '/app/sandbox/message', { text: 'and again from another shop' });
    expect((await ask()).json()).toEqual({ news: false });
    // the pilot's own copy moving is
    await as(pc.value, (x) => sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
      values (${conv}::uuid, ${`own-${RUN}`}, 'outbound', 'text', 'An answer in the pilot copy.', now())`.execute(x));
    expect((await ask()).json()).toEqual({ news: true, what: 'practice' });
  });

  it('every workspace is offered the door', async () => {
    for (const url of ['/app/employee', '/app/business']) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: other } });
      if (r.statusCode === 200) expect(r.body, url).toContain('href="/app/sandbox');
    }
  });
});
