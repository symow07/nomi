import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ } from './tenant.js';

/**
 * A5 (Phase 5; decision 12) — the done-criterion (PHASE-5.md §4): per route and action, the owner may see, post and
 * export; the accountant may see and export, and any posting is refused with the reason; staff get nothing. A
 * snapshot over EVERY route the app registers: an accountant, signed in through the real door, reaches the books
 * and nothing else.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const CODE = 'books-roles-owner-code';
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('A5 · the books\' three roles, at every route (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  const routes: { method: string; url: string }[] = [];
  const cookies: Record<'owner' | 'staff' | 'accountant', string> = { owner: '', staff: '', accountant: '' };
  let accountantId = '';
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const get = (url: string, who: keyof typeof cookies) => app.inject({ method: 'GET', url, headers: { cookie: cookies[who] } });

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => {
      for (const m of Array.isArray(r.method) ? r.method : [r.method]) if (m === 'GET' || m === 'POST') routes.push({ method: m, url: r.url });
    });
    registerWebApp(app, {
      db, businessId: RUN_BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    // three doors, all real: the owner's code, a team member's code, an accountant's code
    cookies.owner = cookieOf(await login(CODE));
    const staff = await addPerson(db, RUN_BIZ, SECRET, `Staff ${Date.now()}`);
    const acct = await addPerson(db, RUN_BIZ, SECRET, `Accountant ${Date.now()}`, 'accountant');
    if (staff.code !== 'added' || acct.code !== 'added') throw new Error('fixture');
    cookies.staff = cookieOf(await login(staff.accessCode));
    const a = await login(acct.accessCode);
    expect(a.headers['location']).toBe('/app/books');   // an accountant lands in the books
    cookies.accountant = cookieOf(a);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    accountantId = await withTenantTx(db, bid.value, async (tx) => (await sql<{ id: string }>`
      select id::text as id from people where business_id = ${RUN_BIZ}::uuid and kind = 'accountant' order by created_at desc limit 1`.execute(tx)).rows[0]!.id);
    for (const c of Object.values(cookies)) expect(c).not.toBe('');
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('the books: the owner and the accountant see and export; staff are sent away', async () => {
    for (const url of ['/app/books', '/app/books/books.csv']) {
      expect((await get(url, 'owner')).statusCode, `owner ${url}`).toBe(200);
      expect((await get(url, 'accountant')).statusCode, `accountant ${url}`).toBe(200);
      const staff = await get(url, 'staff');
      expect([staff.statusCode, staff.headers['location']], `staff ${url}`).toEqual([302, '/app']);
    }
    expect((await get('/app/books', 'accountant')).body).toMatch(/Posting entries is the owner(&#39;|&#x27;|')s/);
  });

  it('EVERY OTHER ROUTE: an accountant is sent to the books (a page) or refused (a write) — the snapshot', async () => {
    const outside = routes.filter((r) => r.url.startsWith('/app') && !r.url.startsWith('/app/books'));
    expect(outside.length).toBeGreaterThan(100);
    const leaked: string[] = [];
    for (const r of outside) {
      const url = r.url.replace(/:([A-Za-z]+)/g, '00000000-0000-4000-8000-000000000000');
      const res = await app.inject({ method: r.method as 'GET' | 'POST', url, headers: { cookie: cookies.accountant,
        ...(r.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(r.method === 'POST' ? { payload: '' } : {}) });
      if (r.method === 'POST' && r.url === '/logout') continue;
      if (res.statusCode !== 302 || res.headers['location'] !== '/app/books') leaked.push(`${r.method} ${r.url} → ${res.statusCode} ${res.headers['location'] ?? ''}`);
    }
    expect(leaked, leaked.join('\n')).toEqual([]);
  });

  it('a POSTING by the accountant is refused by the database too, with the reason', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    await expect(withTenantTx(db, bid.value, async (tx) => {
      const a1 = (await sql<{ id: string }>`insert into accounts (business_id, code, name, kind) values (${RUN_BIZ}::uuid, ${`R${Date.now() % 100000}`}, 'Bank', 'asset') returning id::text as id`.execute(tx)).rows[0]!.id;
      const a2 = (await sql<{ id: string }>`insert into accounts (business_id, code, name, kind) values (${RUN_BIZ}::uuid, ${`S${Date.now() % 100000}`}, 'Sales', 'income') returning id::text as id`.execute(tx)).rows[0]!.id;
      const j = (await sql<{ id: string }>`insert into journals (business_id, code, name, kind) values (${RUN_BIZ}::uuid, ${`R${Date.now() % 1000}`}, 'Roles', 'general') returning id::text as id`.execute(tx)).rows[0]!.id;
      const f = (await sql<{ id: string }>`insert into fiscal_years (business_id, starts_on, ends_on) values (${RUN_BIZ}::uuid, '2031-01-01', '2031-12-31') returning id::text as id`.execute(tx)).rows[0]!.id;
      const e = (await sql<{ id: string }>`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (${RUN_BIZ}::uuid, ${j}::uuid, ${f}::uuid, '2031-02-01', 'x', ${accountantId}) returning id::text as id`.execute(tx)).rows[0]!.id;
      const cur = (await sql<{ c: string }>`select currency as c from businesses where id = ${RUN_BIZ}::uuid`.execute(tx)).rows[0]!.c;
      await sql`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit) values (${RUN_BIZ}::uuid, ${e}::uuid, 1, ${a1}::uuid, ${cur}, 1)`.execute(tx);
      await sql`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit) values (${RUN_BIZ}::uuid, ${e}::uuid, 2, ${a2}::uuid, ${cur}, 1)`.execute(tx);
      await sql`update journal_entries set state = 'posted', posted_by = ${accountantId}, document_ref = 'X', document_date = entry_date where id = ${e}::uuid`.execute(tx);
      throw new Error('it posted');
    })).rejects.toThrow(/an accountant sees and exports the books; posting is the owner's/);
  });

  it('an accountant\'s copy is theirs: closing still waits for the owner\'s', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const by = await withTenantTx(db, bid.value, async (tx) => (await sql<{ made_by: string }>`
      select made_by from books_exports where business_id = ${RUN_BIZ}::uuid order by made_at desc limit 2`.execute(tx)).rows.map((r) => r.made_by));
    expect(by).toContain(accountantId);   // the accountant's download above was recorded as theirs
  });

  it('a person keeps the kind they were made with', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    await expect(withTenantTx(db, bid.value, (tx) => sql`update people set kind = 'team' where id = ${accountantId}::uuid`.execute(tx)))
      .rejects.toThrow(/keeps the kind they were made with/);
  });
});
