import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * A5 — more than one assistant, end to end.
 *
 * Only Postgres and a real request can prove that the main one appears on her
 * own, that a channel has one answerer, that a NEW conversation is given to the
 * right one while an old one keeps whoever it had, that removing one erases
 * nothing, and that a sales assistant is refused all of it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd590000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('A5 · more than one assistant (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  const CODE = 'assistants-test-owner-code';

  const login = async (code: string) => {
    const res = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const post = (cookie: string, url: string, payload = '') =>
    app.inject({ method: 'POST', url, payload, headers: { cookie, ...FORM } });
  const flashOf = (res: { headers: Record<string, unknown> }) => decodeURIComponent(String(res.headers['location']));

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const rows = () => tx(async (t) => (await sql<{ id: string; name: string; role: string; channels: string[]; is_default: boolean; archived: boolean }>`
    select id::text as id, name, role, channels, is_default, archived_at is not null as archived
      from assistants where business_id = ${BIZ}::uuid order by created_at`.execute(t)).rows);
  const startConversation = async (channel: string, identity: string) => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return tx(async (t) => {
      const c = await ensureConversation(t, bid.value, identity, 'Buyer', channel as never);
      const r = (await sql<{ name: string | null }>`
        select (select a.name from assistants a where a.id = c.assistant_id) as name
          from conversations c where c.id = ${c.conversationId}::uuid`.execute(t)).rows[0]!;
      return { conversationId: c.conversationId, answeredBy: r.name };
    });
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Assistants Test Co', 'en')
                on conflict (id) do nothing`.execute(t);
    });
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    expect(ownerCookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('a conversation that starts before she has opened the page is nobody\'s row — read as the main one', async () => {
    expect(await rows()).toEqual([]);
    const c = await startConversation('whatsapp', `+8613${RUN}01`);
    expect(c.answeredBy).toBeNull();
    expect(await rows()).toEqual([]); // a buyer's message never creates an assistant
  });

  it('opening the team page makes the main one, once, with the name she always had', async () => {
    const a = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: ownerCookie } });
    expect(a.statusCode).toBe(200);
    expect(a.body).toContain('id="assistants"');
    await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: ownerCookie } });
    const r = await rows();
    expect(r.map((x) => [x.name, x.role, x.is_default])).toEqual([['Lily', 'sales', true]]);
  });

  it('THE PRODUCTION CALLER: she adds a second one for Instagram and Messenger', async () => {
    const res = await post(ownerCookie, '/app/settings/people/assistants',
      'name=Noor&role=support&channel_instagram=on&channel_messenger=on');
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).toContain('Noor');
    const noor = (await rows()).find((x) => x.name === 'Noor')!;
    expect(noor.channels.sort()).toEqual(['instagram', 'messenger']);
    expect(noor.is_default).toBe(false);
    const audit = await tx(async (t) => (await sql<{ action: string; actor: string }>`
      select action, actor from channel_audit where business_id = ${BIZ}::uuid and action like 'assistant_%'`.execute(t)).rows);
    expect(audit.map((x) => x.action)).toEqual(['assistant_added']);
    expect(audit[0]!.actor).not.toBe('');
  });

  it('a channel has one answerer: a third one cannot also take Instagram', async () => {
    const res = await post(ownerCookie, '/app/settings/people/assistants', 'name=Omar&role=sales&channel_instagram=on');
    expect(flashOf(res)).toMatch(/already belongs/);
    expect((await rows()).some((x) => x.name === 'Omar')).toBe(false);
  });

  it('a NEW conversation goes to whoever answers its channel; the old one keeps what it had', async () => {
    expect((await startConversation('instagram', `ig-${RUN}`)).answeredBy).toBe('Noor');
    expect((await startConversation('email', `buyer-${RUN}@example.com`)).answeredBy).toBe('Lily');
    expect((await startConversation('whatsapp', `+8613${RUN}01`)).answeredBy).toBeNull(); // the same, still-open conversation
  });

  it('the conversation page names who answers, now that there is more than one', async () => {
    const c = await startConversation('instagram', `ig-${RUN}`);
    const page = await app.inject({ method: 'GET', url: `/app/inbox/${c.conversationId}`, headers: { cookie: ownerCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Answered by Noor');
  });

  it('she changes the name and the job; the main one is never given channels', async () => {
    const all = await rows();
    const noor = all.find((x) => x.name === 'Noor')!; const lily = all.find((x) => x.is_default)!;
    await post(ownerCookie, `/app/settings/people/assistants/${noor.id}`, 'name=Nora&role=after_sales&channel_instagram=on');
    await post(ownerCookie, `/app/settings/people/assistants/${lily.id}`, 'name=Lily&role=sales&channel_whatsapp=on');
    const after = await rows();
    expect(after.find((x) => x.id === noor.id)).toMatchObject({ name: 'Nora', role: 'after_sales', channels: ['instagram'] });
    expect(after.find((x) => x.id === lily.id)!.channels).toEqual([]);
  });

  it('the main one cannot be removed; the other can, and nothing is erased', async () => {
    const all = await rows();
    const nora = all.find((x) => x.name === 'Nora')!; const lily = all.find((x) => x.is_default)!;
    expect(flashOf(await post(ownerCookie, `/app/settings/people/assistants/${lily.id}/archive`))).toMatch(/always has to answer/);
    const res = await post(ownerCookie, `/app/settings/people/assistants/${nora.id}/archive`);
    expect(flashOf(res)).toMatch(/Removed/);
    const after = await rows();
    expect(after.find((x) => x.id === nora.id)!.archived).toBe(true);
    expect(after.find((x) => x.id === lily.id)!.archived).toBe(false);
    // Her open conversation falls to whoever answers the channel now; the next one is Lily's.
    const open = await tx(async (t) => (await sql<{ n: string }>`
      select count(*)::text as n from conversations where business_id = ${BIZ}::uuid and assistant_id = ${nora.id}::uuid and is_active`.execute(t)).rows[0]!.n);
    expect(open).toBe('0');
  });

  it('the app cannot erase one even if it tried', async () => {
    await expect(tx((t) => sql`delete from assistants where business_id = ${BIZ}::uuid`.execute(t))).rejects.toThrow(/permission denied/);
  });

  it('a sales assistant is refused all three', async () => {
    const add = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    const issued = String(add.headers['set-cookie'] ?? '').split(';')[0]!;
    const page = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: `${ownerCookie}; ${issued}` } });
    const code = /class="code"><bdi>([^<]+)</.exec(page.body)?.[1] ?? '';
    const staff = await login(code);
    expect(staff).not.toBe('');
    const before = await rows();
    const lily = before.find((x) => x.is_default)!;
    for (const [url, body] of [
      ['/app/settings/people/assistants', 'name=Sneak&role=sales'],
      [`/app/settings/people/assistants/${lily.id}`, 'name=Renamed&role=sales'],
      [`/app/settings/people/assistants/${lily.id}/archive`, ''],
    ] as const) {
      const r = await post(staff, url, body);
      expect(r.statusCode).toBe(302);
    }
    expect(await rows()).toEqual(before);
  });
});
