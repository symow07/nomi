import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, flashSaid} from './tenant.js';

/**
 * M47 — more than one human, end to end.
 *
 * The parity suite proves the predicate and the page. Only Postgres and a real
 * request can prove that a staff code actually logs someone in, that the code
 * is not recoverable from the row, that a sales assistant is refused the four
 * owner-only things AND allowed everything else, and that `assigned_to` now
 * names WHICH human — while the AI-silent gate behaves exactly as before.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd470000-0000-4000-8000-${RUN}0001`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('M47 · more than one human (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let ownerCookie = '';
  let staffCookie = '';
  let staffCode = '';
  let staffId = '';
  let convId = '';
  const CODE = 'people-test-owner-code';

  const login = async (code: string) => {
    const res = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return { status: res.statusCode, cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '' };
  };

  const post = (cookie: string, url: string, payload?: string) =>
    app.inject({
      method: 'POST', url,
      headers: { cookie, ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(payload ? { payload } : {}),
    });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    convId = await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'People Test Factory')
                on conflict (id) do nothing`.execute(t);
      // NO owner row is inserted here, on purpose: this business is created
      // AFTER 0035 ran, exactly like a new tenant or a freshly seeded demo.
      // Her first login is what creates it.
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8613${RUN}`}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
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
    ownerCookie = (await login(CODE)).cookie;
    expect(ownerCookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE PRODUCTION CALLER: the owner adds someone, and sees their code ONCE — never in a URL', async () => {
    const res = await post(ownerCookie, '/app/settings/people', 'name=Xiao%20Chen');
    expect(res.statusCode).toBe(302);
    const location = String(res.headers['location']);

    // G9a — the code rides a short-lived HttpOnly cookie scoped to this page.
    // A redirect URL is written to the request log, the history and any proxy.
    const set = String(res.headers['set-cookie'] ?? '');
    expect(set).toMatch(/^yf_issued=/);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('Path=/app/settings/people');
    expect(Number(set.match(/Max-Age=(\d+)/)?.[1])).toBeLessThanOrEqual(300);
    const issued = set.split(';')[0]!;

    const page = await app.inject({ method: 'GET', url: location, headers: { cookie: `${ownerCookie}; ${issued}` } });
    staffCode = page.body.match(/<p class="code"><bdi>([A-Z2-9]{5}-[A-Z2-9]{5})<\/bdi><\/p>/)?.[1] ?? '';
    expect(staffCode).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(location).not.toContain(staffCode);
    expect(location).not.toMatch(/[?&]code=/);
    expect(page.body).toContain('Xiao Chen');
    // Read once, cleared in the same response.
    expect(String(page.headers['set-cookie'] ?? '')).toMatch(/^yf_issued=; .*Max-Age=0/);

    // And it is gone from the page the moment she navigates away from it.
    const again = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: ownerCookie } });
    expect(again.body).not.toContain(staffCode);

    staffId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and not is_owner and archived_at is null
    `.execute(t).then((r) => r.rows[0]!.id));
  });

  it('THE CODE IS NOT IN THE ROW — the column holds an HMAC', async () => {
    const row = await tx((t) => sql<{ code_hash: string | null }>`
      select code_hash from people where id = ${staffId}::uuid
    `.execute(t).then((r) => r.rows[0]!));
    expect(row.code_hash).not.toBeNull();
    expect(row.code_hash).not.toContain(staffCode);
    // and it is the HMAC this installation would compute
    const { hashCode } = await import('../../src/api/web/people.js');
    expect(row.code_hash).toBe(hashCode(SECRET, staffCode));
  });

  it('THEY GET THEIR OWN WAY IN', async () => {
    const r = await login(staffCode);
    expect(r.status).toBe(302);
    expect(r.cookie).not.toBe('');
    staffCookie = r.cookie;
    expect(staffCookie).not.toBe(ownerCookie);

    const home = await app.inject({ method: 'GET', url: '/app', headers: { cookie: staffCookie } });
    expect(home.statusCode).toBe(200);
  });

  it('a wrong code is still refused, and sets no cookie', async () => {
    const r = await login('AAAAA-BBBBB');
    expect(r.status).toBe(401);
    expect(r.cookie).toBe('');
  });

  it('A SALES ASSISTANT MAY NOT do ANY owner-only thing — every route, walked, signed in as staff', async () => {
    // G9a — this walk replaces the source tests that read 900 characters after
    // each route name: they could not tell a gate from a comment mentioning one.
    for (const [url, payload] of [
      ['/app/employee/capability/quote/promote', undefined],
      ['/app/employee/capability/quote/revoke', undefined],
      ['/app/factory/activate', 'confirm=yes'],
      ['/app/factory/deactivate', 'confirm=yes'],
      ['/app/factory/prices', 'floor=0.30&maxDiscountPct=10&askAbovePct=7'],
      ['/app/settings/people', 'name=Someone%20Else'],
      [`/app/settings/people/${randomUUID()}/remove`, undefined],
      ['/app/channels/outreach', 'channel=whatsapp&enabled=true'],
      ['/app/channels/domain', 'domain=example.com&selector=s1'],
      ['/app/channels/domain/check', undefined],
      ['/app/channels/whatsapp/connect', undefined],
      ['/app/settings/terms', 'payment=T%2FT&incoterm=FOB'],
    ] as const) {
      const res = await post(staffCookie, url, payload);
      expect(res.statusCode, url).toBe(302);
      expect(flashSaid(res, SECRET), url).toContain('Only the owner');
    }
    // G9a — and the PAGES behind the two most sensitive forms: her floor, and
    // the form that hands someone a way in.
    for (const url of ['/app/settings/people', '/app/factory/prices']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie: staffCookie } });
      expect(res.statusCode, url).toBe(302);
      expect(flashSaid(res, SECRET), url).toContain('Only the owner');
    }
    // and nothing happened: no second person, no price rule
    expect(await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from people where business_id = ${BIZ} and archived_at is null
    `.execute(t).then((r) => r.rows[0]!.n))).toBe(2);
  });

  it('staff are not SHOWN the controls that would only refuse them', async () => {
    const get = async (cookie: string, url: string) =>
      (await app.inject({ method: 'GET', url, headers: { cookie } })).body;
    const owner = { factory: await get(ownerCookie, '/app/factory'), channels: await get(ownerCookie, '/app/channels') };
    const staff = {
      factory: await get(staffCookie, '/app/factory'),
      employee: await get(staffCookie, '/app/employee'),
      channels: await get(staffCookie, '/app/channels'),
    };
    // The owner's pages carry them, so their absence below is the viewer, not the data.
    expect(owner.factory).toContain('href="/app/factory/prices"');
    expect(owner.channels).toContain('action="/app/channels/outreach"');
    expect(owner.channels).toContain('action="/app/channels/domain"');

    expect(staff.factory).not.toContain('href="/app/factory/prices"');
    expect(staff.factory).not.toMatch(/action="\/app\/factory\/(activate|deactivate)"/);
    expect(staff.employee).not.toContain('/app/employee/capability/');
    expect(staff.channels).not.toContain('action="/app/channels/outreach"');
    expect(staff.channels).not.toContain('action="/app/channels/domain"');
    expect(staff.channels).not.toContain('action="/app/channels/whatsapp/connect"');
    // Where a control was, the reason is said instead. (A factory not yet
    // ready to go live has no switch to replace, so My factory is not listed.)
    for (const html of [staff.employee, staff.channels]) expect(html).toContain('The owner decides this.');
  });

  it('and MAY DO THE JOB — reply, hand back, teach, record an order: none of it is refused', async () => {
    for (const [url, payload] of [
      [`/app/inbox/${convId}/reply`, 'text=Thanks%2C%20checking%20now'],
      [`/app/inbox/${convId}/resume`, undefined],
      ['/app/knowledge/teach', 'kind=faq&label=Colours&content=Red%20and%20blue'],
      [`/app/orders/${randomUUID()}/update`, 'state=shipped'],
    ] as const) {
      const res = await post(staffCookie, url, payload);
      expect(res.statusCode, url).toBeLessThan(500);
      expect(flashSaid(res, SECRET), url).not.toContain('Only the owner');
    }
  });

  it('AND MAY DO THE JOB — takeover names WHICH human', async () => {
    const res = await post(staffCookie, `/app/inbox/${convId}/takeover`);
    expect(res.statusCode).toBe(302);

    const held = await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${convId}
    `.execute(t).then((r) => r.rows[0]!.assigned_to));
    expect(held).toBe(staffId);

    // The ownership model is unchanged: a person id still means a human holds
    // it, and the AI is still silent.
    const { ownershipOf, aiMaySpeak } = await import('../../src/core/conversation/ownership.js');
    expect(ownershipOf(held)).toBe('OWNER_CONTROLLED');
    expect(aiMaySpeak(ownershipOf(held))).toBe(false);
  });

  it('and Buyers says who is holding it', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/inbox?filter=all', headers: { cookie: ownerCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Xiao Chen');
  });

  it('G9b · the last action is NAMED — a colleague by name, the reader as "you", never an id', async () => {
    const owner = (await app.inject({ method: 'GET', url: `/app/inbox/${convId}`, headers: { cookie: ownerCookie } })).body;
    const staff = (await app.inject({ method: 'GET', url: `/app/inbox/${convId}`, headers: { cookie: staffCookie } })).body;
    expect(owner).toContain('Taken over by Xiao Chen');
    expect(staff).toContain('Taken over by you');
    expect(owner).not.toContain(staffId);
  });

  it('G9b · APPROVALS WORK FOR PEOPLE — the owner’s and a sales assistant’s, each named in the record', async () => {
    // `drafts.decided_by` is a foreign key to the legacy `agents` table. The
    // old guard passed any UUID through, so the first approval by someone
    // with a `people` row — the owner included — would have failed it.
    const ownerId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and is_owner limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    for (const [cookie, who] of [[ownerCookie, ownerId], [staffCookie, staffId]] as const) {
      const { conv, draft } = await tx(async (t) => {
        const client = (await sql<{ id: string }>`
          insert into clients (business_id, phone, display_name)
          values (${BIZ}, ${`+8614${randomUUID().slice(0, 8)}`}, 'Omar') returning id::text as id`.execute(t)).rows[0]!.id;
        const c = (await sql<{ id: string }>`
          insert into conversations (business_id, client_id, channel, phase)
          values (${BIZ}, ${client}::uuid, 'whatsapp', 'clarification') returning id::text as id`.execute(t)).rows[0]!.id;
        const d = (await sql<{ id: string }>`
          insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
          values (${BIZ}, ${c}::uuid, 'qualify', 'Which size do you need?', null, 'pending')
          returning id::text as id`.execute(t)).rows[0]!.id;
        return { conv: c, draft: d };
      });
      const res = await post(cookie, `/app/inbox/${conv}/act`, `draftId=${draft}&command=${encodeURIComponent('发送')}`);
      expect(res.statusCode).toBe(302);
      const row = await tx((t) => sql<{ status: string; decided_by: string | null; actor: string | null }>`
        select d.status, d.decided_by::text as decided_by,
               (select e.payload->>'actor' from conversation_events e
                 where e.conversation_id = d.conversation_id and e.type = 'draft_resolved') as actor
          from drafts d where d.id = ${draft}::uuid`.execute(t).then((r) => r.rows[0]!));
      expect(row).toEqual({ status: 'approved', decided_by: null, actor: who });
    }
  });

  it('G9b · every older write site names the person — not the word "owner"', async () => {
    const res = await post(staffCookie, `/app/orders/${randomUUID()}/update`, 'state=shipped');
    expect(res.statusCode).toBe(302);
    // An allowlist entry and a channel action, by the sales assistant:
    await post(staffCookie, '/app/factory/allowlist/add', 'phone=%2B971500009999&label=test');
    const added = await tx((t) => sql<{ added_by: string | null }>`
      select added_by from pilot_allowlist where business_id = ${BIZ} order by added_at desc limit 1
    `.execute(t).then((r) => r.rows[0]?.added_by ?? null));
    expect(added).toBe(staffId);
  });

  let g12Conv = '';

  it('G12 · THE OWNER HANDS IT TO A COLLEAGUE — it lands on their list, with the hand-off in its history', async () => {
    g12Conv = await tx(async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${`+8615${RUN}`}, 'Farid') returning id::text as id`.execute(t)).rows[0]!.id;
      return (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id
      `.execute(t)).rows[0]!.id;
    });
    // She takes a conversation she cannot answer, then passes it to Xiao Chen.
    expect((await post(ownerCookie, `/app/inbox/${g12Conv}/takeover`)).statusCode).toBe(302);
    const res = await post(ownerCookie, `/app/inbox/${g12Conv}/handto`, `personId=${staffId}`);
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, SECRET)).toContain('Handed to Xiao Chen');

    // The column names WHICH human, and the ownership model is unchanged.
    const held = await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${g12Conv}`.execute(t).then((r) => r.rows[0]!.assigned_to));
    expect(held).toBe(staffId);
    const { ownershipOf, aiMaySpeak } = await import('../../src/core/conversation/ownership.js');
    expect(aiMaySpeak(ownershipOf(held))).toBe(false);

    // It is on HIS list — the only way a staff member learns of it: no phone.
    const mine = await app.inject({ method: 'GET', url: '/app/inbox?filter=mine', headers: { cookie: staffCookie } });
    expect(mine.statusCode).toBe(200);
    expect(mine.body).toContain('Farid');
    // And not on hers.
    const hers = await app.inject({ method: 'GET', url: '/app/inbox?filter=mine', headers: { cookie: ownerCookie } });
    expect(hers.body).not.toContain('Farid');

    // The conversation says who has it, and what happened last.
    const page = await app.inject({ method: 'GET', url: `/app/inbox/${g12Conv}`, headers: { cookie: ownerCookie } });
    expect(page.body).toContain('Held by Xiao Chen');
    expect(page.body).toContain('Handed to Xiao Chen');
    const his = await app.inject({ method: 'GET', url: `/app/inbox/${g12Conv}`, headers: { cookie: staffCookie } });
    expect(his.body).toContain('handling this');          // to him, it is his
  });

  it('G12 · nobody who does not work here can be handed one', async () => {
    const res = await post(ownerCookie, `/app/inbox/${g12Conv}/handto`, `personId=${randomUUID()}`);
    expect(flashSaid(res, SECRET)).toContain('Nobody by that name');
    const held = await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${g12Conv}`.execute(t).then((r) => r.rows[0]!.assigned_to));
    expect(held).toBe(staffId);                            // unchanged
  });

  it('G12 · a sales assistant may hand it back — passing work is the job', async () => {
    const ownerId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and is_owner limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    const res = await post(staffCookie, `/app/inbox/${g12Conv}/handto`, `personId=${ownerId}`);
    expect(res.statusCode).toBe(302);
    expect(decodeURIComponent(String(res.headers['location']))).not.toContain('Only the owner');
    expect(await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${g12Conv}`.execute(t).then((r) => r.rows[0]!.assigned_to))).toBe(ownerId);
  });

  it('REMOVING archives — the conversation they held still names them', async () => {
    expect((await post(ownerCookie, `/app/settings/people/${staffId}/remove`)).statusCode).toBe(302);

    const row = await tx((t) => sql<{ archived_at: Date | null }>`
      select archived_at from people where id = ${staffId}::uuid
    `.execute(t).then((r) => r.rows[0]!));
    expect(row.archived_at).not.toBeNull();

    // assigned_to is untouched: the record of who held it is not rewritten.
    expect(await tx((t) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${convId}
    `.execute(t).then((r) => r.rows[0]!.assigned_to))).toBe(staffId);

    // and their code no longer works
    expect((await login(staffCode)).status).toBe(401);
  });

  it('THE OWNER CANNOT BE REMOVED — a business with nobody who can grant is broken', async () => {
    const ownerId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and is_owner limit 1
    `.execute(t).then((r) => r.rows[0]!.id));
    await post(ownerCookie, `/app/settings/people/${ownerId}/remove`);
    expect(await tx((t) => sql<{ archived_at: Date | null }>`
      select archived_at from people where id = ${ownerId}::uuid
    `.execute(t).then((r) => r.rows[0]!.archived_at))).toBeNull();
  });

  it('HER ROW IS CREATED ON FIRST LOGIN — a business made after the migration has one', async () => {
    // The backfill covers businesses that existed when it ran. This one did
    // not, and the owner would otherwise have shown as a generic word on the
    // page that names who holds what.
    const owner = await tx((t) => sql<{ name: string }>`
      select name from people where business_id = ${BIZ} and is_owner and archived_at is null
    `.execute(t).then((r) => r.rows));
    expect(owner).toHaveLength(1);
    expect(owner[0]!.name).toBe('People Test Factory');
  });

  it('A4 · THE TEAM PAGE SAYS WHO IS HERE NOW — read off what people do, since no session store exists to ask', async () => {
    // The owner has been clicking through this whole file; the check wrote it down.
    const seen = await tx((t) => sql<{ name: string; last_seen_at: Date | null; is_owner: boolean }>`
      select name, last_seen_at, is_owner from people where business_id = ${BIZ} and archived_at is null order by is_owner desc
    `.execute(t).then((r) => r.rows));
    const owner = seen.find((p) => p.is_owner)!;
    expect(owner.last_seen_at).not.toBeNull();
    expect(Date.now() - owner.last_seen_at!.getTime()).toBeLessThan(5 * 60_000);

    const page = await app.inject({ method: 'GET', url: '/app/settings/people', headers: { cookie: ownerCookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Online now');
    expect(page.body).toContain('Signs in with an access code');
    expect(page.body).toMatch(/\d+ people work here\. \d+ online now\./);
  });

  it('S1 · REMOVING SOMEONE SIGNS THEM OUT NOW — the cookie they hold stops opening anything', async () => {
    // A colleague of her own, so the people the earlier tests rely on stay.
    const added = await post(ownerCookie, '/app/settings/people', 'name=Temp%20Hire');
    const issued = String(added.headers['set-cookie'] ?? '').split(';')[0]!;
    const page = await app.inject({ method: 'GET', url: String(added.headers['location']), headers: { cookie: `${ownerCookie}; ${issued}` } });
    const code = page.body.match(/<p class="code"><bdi>([A-Z2-9]{5}-[A-Z2-9]{5})<\/bdi><\/p>/)?.[1] ?? '';
    const temp = await login(code);
    expect(temp.status).toBe(302);
    expect((await app.inject({ method: 'GET', url: '/app', headers: { cookie: temp.cookie } })).statusCode).toBe(200);

    const tempId = await tx((t) => sql<{ id: string }>`
      select id::text as id from people where business_id = ${BIZ} and name = 'Temp Hire' and archived_at is null
    `.execute(t).then((r) => r.rows[0]!.id));
    expect((await post(ownerCookie, `/app/settings/people/${tempId}/remove`, '')).statusCode).toBe(302);

    // The very next request, with the SAME cookie — not "within a minute".
    for (const url of ['/app', '/app/inbox', `/app/inbox/${convId}`]) {
      const r = await app.inject({ method: 'GET', url, headers: { cookie: temp.cookie } });
      expect([r.statusCode, r.headers['location']], url).toEqual([302, '/login']);
    }
    const out = await app.inject({ method: 'GET', url: '/app', headers: { cookie: temp.cookie } });
    expect(String(out.headers['set-cookie'] ?? ''), 'and the cookie is taken back').toMatch(/Max-Age=0/);
    const tried = await post(temp.cookie, `/app/inbox/${convId}/reply`, 'text=still%20here');
    expect([tried.statusCode, tried.headers['location']], 'nor can it write').toEqual([302, '/login']);
    expect((await login(code)).status, 'and the code no longer opens the door').toBe(401);

    // Everyone else is untouched.
    expect((await app.inject({ method: 'GET', url: '/app', headers: { cookie: ownerCookie } })).statusCode).toBe(200);
    // …and the colleague an earlier test in this file removed is out as well.
    // Before S1 that cookie went on opening the workspace for a week.
    const earlier = await app.inject({ method: 'GET', url: '/app', headers: { cookie: staffCookie } });
    expect([earlier.statusCode, earlier.headers['location']]).toEqual([302, '/login']);
  });

  it('and HER login never depended on any of it', async () => {
    // Her code is the environment's. This is the guarantee that a people table
    // cannot lock the owner out of her own business.
    expect((await login(CODE)).status).toBe(302);
  });
});
