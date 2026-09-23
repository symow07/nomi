import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid} from './tenant.js';

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
  const flashOf = (res: { headers: Record<string, unknown> }): string => flashSaid(res, SECRET);

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

  // 2026-09-23 — the row's name at birth is a default nobody chose. Until the
  // owner confirms it (Getting ready) or saves it (team page), no surface shows
  // it: the owner reads "your assistant", and the model is given no name.
  it('a default name nobody chose is not shown — not to the owner, not to the model', async () => {
    const { mainAssistant } = await import('../../src/db/assistants.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    expect((await tx((t) => mainAssistant(t, bid.value))).name).toBeNull();
    const home = await app.inject({ method: 'GET', url: '/app', headers: { cookie: ownerCookie } });
    expect(home.body).toContain('Your assistant');
    expect(home.body).not.toContain('Lily');
    const c = await startConversation('whatsapp', `+8613${RUN}09`);
    const speaker = await tx((t) => tenantRepos(t, bid.value).conversations.speaker(c.conversationId as never));
    expect(speaker?.name).toBeNull();
    expect(speaker?.business.name).toBe('Assistants Test Co');
  });

  it('confirming it in Getting ready is what makes it the name everywhere, at once', async () => {
    const res = await post(ownerCookie, '/app/onboarding/assistant-name', 'name=Lily');
    expect(res.statusCode).toBe(302);
    const { mainAssistant } = await import('../../src/db/assistants.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    expect((await tx((t) => mainAssistant(t, bid.value))).name).toBe('Lily');
    const home = await app.inject({ method: 'GET', url: '/app', headers: { cookie: ownerCookie } });
    expect(home.body).toContain('Lily');
    // Put it back, so the tests below start from a name nobody confirmed —
    // the rename path they exercise must count on its own.
    await tx((t) => sql`update onboarding_state set assistant_named_at = null where business_id = ${BIZ}::uuid`.execute(t));
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

  it('A5.3 — the writer is told who answers THIS conversation, and whose business it is', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const ig = await startConversation('instagram', `ig-${RUN}`);
    const wa = await startConversation('whatsapp', `+8613${RUN}01`);
    const [noors, mains, nobody] = await tx(async (t) => {
      await sql`update businesses set kind = 'agency', country = 'MA', description = 'Campaigns for hotels' where id = ${BIZ}::uuid`.execute(t);
      const repos = tenantRepos(t, bid.value);
      return [
        await repos.conversations.speaker(ig.conversationId as never),
        await repos.conversations.speaker(wa.conversationId as never),
        await repos.conversations.speaker('00000000-0000-4000-8000-000000000000' as never),
      ];
    });
    expect(noors).toMatchObject({ name: 'Noor', role: 'support',
      business: { name: 'Assistants Test Co', kind: 'agency', country: 'MA', description: 'Campaigns for hotels' } });
    // Started before there was a second one: it has no assistant of its own, so
    // the main one speaks — nameless, because nobody has confirmed "Lily" yet
    // (the prompt then writes as the business, without a name).
    expect(mains).toMatchObject({ name: null, role: 'sales' });
    expect(nobody).toBeNull();
  });

  it('A5.4 — she hands ONE buyer to another assistant: the page, the writer and the history all follow', async () => {
    const wa = await startConversation('whatsapp', `+8613${RUN}01`);
    const noor = (await rows()).find((x) => x.name === 'Noor')!;
    const before = await app.inject({ method: 'GET', url: `/app/inbox/${wa.conversationId}`, headers: { cookie: ownerCookie } });
    expect(before.body).toContain(`action="/app/inbox/${wa.conversationId}/assistant"`);
    expect(before.body).toContain('Answered by Lily');

    const res = await post(ownerCookie, `/app/inbox/${wa.conversationId}/assistant`, `assistant=${noor.id}`);
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).toContain('Noor answers this buyer from now on.');
    const after = await app.inject({ method: 'GET', url: `/app/inbox/${wa.conversationId}`, headers: { cookie: ownerCookie } });
    expect(after.body).toContain('Answered by Noor');

    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const [speaker, events] = await tx(async (t) => [
      await tenantRepos(t, bid.value).conversations.speaker(wa.conversationId as never),
      (await sql<{ payload: { actor?: string; to?: string } }>`
        select payload from conversation_events where conversation_id = ${wa.conversationId}::uuid and type = 'assistant_changed'`.execute(t)).rows,
    ] as const);
    expect(speaker?.name).toBe('Noor');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.to).toBe(noor.id);
    expect(events[0]!.payload.actor).toBeTruthy();

    // Saying it twice changes nothing and writes no second line of history.
    expect(flashOf(await post(ownerCookie, `/app/inbox/${wa.conversationId}/assistant`, `assistant=${noor.id}`))).toContain('already answers');
    // Someone who is not on the team cannot be handed a buyer.
    expect(flashOf(await post(ownerCookie, `/app/inbox/${wa.conversationId}/assistant`, 'assistant=00000000-0000-4000-8000-000000000000'))).toMatch(/did not save/);
    const again = await tx(async (t) => (await sql<{ n: string }>`
      select count(*)::text as n from conversation_events where conversation_id = ${wa.conversationId}::uuid and type = 'assistant_changed'`.execute(t)).rows[0]!.n);
    expect(again).toBe('1');

    // And back, so the rest of this walk reads as it did.
    await post(ownerCookie, `/app/inbox/${wa.conversationId}/assistant`, `assistant=${(await rows()).find((x) => x.is_default)!.id}`);
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

  it('A5.2 — she renames the main one, and every page says the new name at once', async () => {
    const before = await app.inject({ method: 'GET', url: '/app', headers: { cookie: ownerCookie } });
    expect(before.body).toContain('Lily');
    const lily = (await rows()).find((x) => x.is_default)!;
    await post(ownerCookie, `/app/settings/people/assistants/${lily.id}`, 'name=Sara&role=sales');
    const after = await app.inject({ method: 'GET', url: '/app', headers: { cookie: ownerCookie } });
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain('Sara');
    expect(after.body).not.toContain('Lily');
  });

  it('A5.2 — and a form she posts answers in that name too (the scope outlives reading the body)', async () => {
    const res = await post(ownerCookie, '/app/settings/closures', 'label=Spring%20Festival&from=2030-02-01&to=2030-02-10');
    expect(res.statusCode).toBe(302);
    // A1 — the notice travels as a KEY now, so `{name}` is filled where the
    // sentence is WRITTEN OUT: on the page she lands on, inside her own
    // request. Following the redirect with the cookie is what a browser does,
    // and it is the only place this assertion means anything.
    const flashCookie = ([] as string[]).concat(res.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_flash='))!;
    const landed = await app.inject({
      method: 'GET', url: String(res.headers['location']), headers: { cookie: `${ownerCookie}; ${flashCookie}` },
    });
    expect(landed.body).toContain('Sara');
    expect(landed.body).not.toContain('Lily');
  });

  it('A5.2 — a conversation page says ITS assistant, even one since removed; the rest of the app says the main one', async () => {
    const c = await tx(async (t) => (await sql<{ id: string }>`
      select c.id::text as id from conversations c join assistants a on a.id = c.assistant_id
       where c.business_id = ${BIZ}::uuid and a.name = 'Nora' order by c.created_at limit 1`.execute(t)).rows[0]);
    // Removing Nora handed her OPEN conversations back, so none still names her…
    expect(c).toBeUndefined();
    // …and the one that was hers now reads as the main assistant's.
    const conv = await startConversation('instagram', `ig-${RUN}`);
    const page = await app.inject({ method: 'GET', url: `/app/inbox/${conv.conversationId}`, headers: { cookie: ownerCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Sara');
    expect(page.body).not.toContain('Lily');
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
    // A5.4 — nor may they hand a buyer to another assistant, and they are not shown the control.
    const wa = await startConversation('whatsapp', `+8613${RUN}01`);
    const held = async () => tx(async (t) => (await sql<{ a: string | null }>`
      select assistant_id::text as a from conversations where id = ${wa.conversationId}::uuid`.execute(t)).rows[0]!.a);
    const was = await held();
    await post(staff, `/app/inbox/${wa.conversationId}/assistant`, `assistant=${lily.id}`);
    expect(await held()).toBe(was);
  });
});
