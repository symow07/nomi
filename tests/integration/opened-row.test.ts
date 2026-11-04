import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * BOLD UNTIL OPENED (0223, the owner, 2026-11-04): a row that needs the owner leads the list with its dot, its name bold
 * until the conversation is opened, and bold again when something new arrives.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7d0000-0000-4000-8000-${RUN}0004`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

d('a row that needs the owner: bold until opened (requires DATABASE_URL)', () => {
  let db: Db;
  let app: import('fastify').FastifyInstance;
  let cookie = '';
  let omar = '';
  let sara = '';

  const tx = async <R>(fn: (x: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const say = (x: Tx, id: string, ext: string, ago: string) => sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
    values (${id}::uuid, ${ext}, 'inbound', 'text', 'hello', now() - ${ago}::interval)`.execute(x);

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Hana Skincare', 'en') on conflict (id) do nothing`.execute(x));
    await tx(async (x) => {
      const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'whatsapp', ${`wa-opened-${RUN}`}, 'opened-secret', 'service', true)`.execute(x);
      omar = (await ensureConversation(x, b.value, `44770092${RUN.slice(0, 4).replace(/\D/g, '1')}`, 'Omar Haddad', 'whatsapp')).conversationId;
      sara = (await ensureConversation(x, b.value, `44770093${RUN.slice(0, 4).replace(/\D/g, '2')}`, 'Sara Idrissi', 'whatsapp')).conversationId;
      // Omar waits for a person; Sara wrote more recently and is the assistant's.
      await sql`update conversations set assigned_to = 'unclaimed' where id = ${omar}::uuid`.execute(x);
      await sql`update conversations set assigned_to = null where id = ${sara}::uuid`.execute(x);
      await say(x, omar, `o1-${RUN}`, '2 hours');
      await say(x, sara, `s1-${RUN}`, '1 minute');
    });
    app = Fastify({ logger: false });
    const code = `opened-${RUN}`;
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: code, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', secureCookie: false, factsTtlMs: 0,
      provider: 'disabled', messagingEnabled: true, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${code}`, headers: FORM }))
      .headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const list = async () => (await get('/app/inbox?filter=all')).body;
  const rowOf = (h: string, id: string): string => {
    const at = h.indexOf(`href="/app/inbox/${id}#latest"`);
    return at < 0 ? '' : h.slice(h.lastIndexOf('<div class="irow', at), h.indexOf('</a></div>', at));
  };
  const stamps = () => tx(async (x) => (await sql<{ owner_opened_at: Date | null; updated_at: Date }>`
    select owner_opened_at, updated_at from conversations where id = ${omar}::uuid`.execute(x)).rows[0]!);

  it('a row that needs the owner leads, with its dot and its name bold; the other has neither', async () => {
    const h = await list();
    expect(h.indexOf(`/app/inbox/${omar}#latest`)).toBeGreaterThan(-1);
    expect(h.indexOf(`/app/inbox/${omar}#latest`)).toBeLessThan(h.indexOf(`/app/inbox/${sara}#latest`));
    expect(rowOf(h, omar)).toContain('row-dot');
    expect(rowOf(h, omar)).toContain('is-new');
    expect(rowOf(h, sara)).not.toContain('row-dot');
    expect(rowOf(h, sara)).not.toContain('is-new');
    expect(h).toContain('<span class="navcount" aria-hidden="true">1</span>');
  });

  it('a page that holds the row back (a turn at work) is still drawn, and marks nothing', async () => {
    await tx(async (x) => {
      await sql`select 1 from conversations where id = ${omar}::uuid for update`.execute(x);
      expect((await get(`/app/inbox/${omar}`)).statusCode).toBe(200);
    });
    expect((await stamps()).owner_opened_at).toBeNull();
  });

  it('opening it: the name is plain, the dot stays, and opening is not activity', async () => {
    const before = await stamps();
    const beside = (await get(`/app/inbox/${omar}`)).body;
    const after = await stamps();
    expect(after.owner_opened_at).not.toBeNull();
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());   // src/pipeline/echo.ts picks the latest by it
    expect(beside).not.toMatch(new RegExp(`class="crow[^"]*is-new[^"]*"[^>]*href="/app/inbox/${omar}`));
    const h = await list();
    expect(rowOf(h, omar)).toContain('row-dot');
    expect(rowOf(h, omar)).not.toContain('is-new');
    expect(h.indexOf(`/app/inbox/${omar}#latest`)).toBeLessThan(h.indexOf(`/app/inbox/${sara}#latest`));
  });

  it('a new message makes it bold again', async () => {
    await tx((x) => say(x, omar, `o2-${RUN}`, '0 seconds'));
    expect(rowOf(await list(), omar)).toContain('is-new');
  });
});
