import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ } from './tenant.js';

/**
 * B0 (Phase 5; the owner, 2026-10-21) — AN ACCOUNTANT SEES NOTHING OF THE SALES SIDE, AND THE DATABASE HOLDS IT.
 * A5's route guard is the first wall (tests/integration/books-roles.test.ts walks every route). This is the second
 * (0177): a signed-in request's transactions say who is asking, and every table under row security outside the
 * books shows an accountant no row and takes none. Proven through the real app with the first wall stepped past:
 * a session that names the accountant but not their kind is let through by the route guard, and still sees no buyer.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const CODE = 'books-viewer-owner-code';
const SECRET = 'a-test-session-secret-of-sufficient-length';

/** What an accountant may see, and why: the books' own tables, and the workspace's row (its name heads the rail). */
const ACCOUNTANT_SEES = [
  'accounts', 'books_exports', 'books_settings', 'businesses', 'custom_field_defs', 'document_blobs', 'documents',
  'fiscal_years', 'invoice_counters', 'invoice_lines', 'invoice_payments', 'invoices', 'journal_counters', 'journal_entries', 'journal_lines',
  'journals', 'owner_rates', 'parties', 'statement_imports', 'statement_lines', 'statement_matches', 'tax_codes',
];   // C2's invoices and C3's statements are books: the accountant reads them, and changes none (0175 and 0186)

d('B0 · the database keeps an accountant to the books (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let accountantId = '';
  let staffId = '';
  let buyer = '';
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query('update businesses set books_area = true where id = $1', [RUN_BIZ]);
    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: RUN_BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const staff = await addPerson(db, RUN_BIZ, SECRET, `Staff ${Date.now()}`);
    const acct = await addPerson(db, RUN_BIZ, SECRET, `Accountant ${Date.now()}`, 'accountant');
    if (staff.code !== 'added' || acct.code !== 'added') throw new Error('fixture');
    const ids = (await admin.query<{ id: string; kind: string }>(
      `select id::text as id, kind from people where business_id = $1 order by created_at desc limit 2`, [RUN_BIZ])).rows;
    accountantId = ids.find((r) => r.kind === 'accountant')!.id;
    staffId = ids.find((r) => r.kind === 'team')!.id;
    // a buyer the owner's list shows (the positive control for "the accountant's shows none")
    buyer = (await admin.query<{ name: string }>(
      `select cl.display_name as name from clients cl join conversations c on c.client_id = cl.id
        where cl.business_id = $1 and length(coalesce(cl.display_name, '')) > 3 order by c.updated_at desc limit 1`, [RUN_BIZ])).rows[0]!.name;
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('every table under row security carries the policy, except the books and the workspace row — a new table must choose', async () => {
    const without = (await admin.query<{ t: string }>(`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                                                     and p.policyname = 'not_for_accountants' and p.permissive = 'RESTRICTIVE')
       order by 1`)).rows.map((r) => r.t);
    expect(without).toEqual(ACCOUNTANT_SEES);
    const held = Number((await admin.query(`select count(*) from pg_policies where policyname = 'not_for_accountants'`)).rows[0].count);
    expect(held).toBeGreaterThan(100);
  });

  it('as the accountant a sales table shows no row and takes none; as staff the same rows are there', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    const counts = (who: string) => asViewer(who, () => withTenantTx(db, bid.value, async (tx) => {
      const n = async (t: string) => Number((await sql<{ n: string }>`select count(*)::text as n from ${sql.table(t)}`.execute(tx)).rows[0]!.n);
      return { conversations: await n('conversations'), messages: await n('messages'), clients: await n('clients'),
               people: await n('people'), businesses: await n('businesses') };
    }));
    const staff = await counts(staffId);
    expect(staff.conversations).toBeGreaterThan(0);
    expect(staff.messages).toBeGreaterThan(0);
    expect(staff.clients).toBeGreaterThan(0);
    expect(await counts(accountantId)).toEqual({ conversations: 0, messages: 0, clients: 0, people: 0, businesses: 1 });
    // and nothing written, either
    await expect(asViewer(accountantId, () => withTenantTx(db, bid.value, (tx) =>
      sql`insert into forbidden_terms (business_id, term) values (${RUN_BIZ}::uuid, 'probe')`.execute(tx))))
      .rejects.toThrow(/row-level security/);
    // the books are theirs to see
    await asViewer(accountantId, () => withTenantTx(db, bid.value, (tx) => sql`select count(*) from journal_entries`.execute(tx)));
    // and C2's and C3's tables are theirs to see, never to change (0186): each write refused before anything else is checked
    for (const t of ['invoices', 'invoice_lines', 'invoice_payments', 'statement_imports', 'statement_lines', 'statement_matches']) {
      await asViewer(accountantId, () => withTenantTx(db, bid.value, (tx) => sql`select count(*) from ${sql.table(t)}`.execute(tx)));
      await expect(asViewer(accountantId, () => withTenantTx(db, bid.value, (tx) =>
        sql`insert into ${sql.table(t)} (business_id) values (${RUN_BIZ}::uuid)`.execute(tx)))).rejects.toThrow(/an accountant sees and exports the books; this is the owner's/);
      // the control: staff are refused by the table's own rules, not by this one
      await expect(asViewer(staffId, () => withTenantTx(db, bid.value, (tx) =>
        sql`insert into ${sql.table(t)} (business_id) values (${RUN_BIZ}::uuid)`.execute(tx)))).rejects.not.toThrow(/an accountant sees/);
    }
  });

  it('PAST THE ROUTE GUARD: a session naming the accountant without their kind reaches the Buyers list — and it holds no buyer', async () => {
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    const owner = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
    const theirs = await app.inject({ method: 'GET', url: '/app/inbox?filter=all', headers: { cookie: owner } });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.body).toContain(buyer);                       // the control: the buyer is on the owner's list
    // the first wall reads the kind from the session; this one has none, so it is let through, as a team member
    const token = makeSessionCodec(SECRET).sign({ businessId: RUN_BIZ, exp: Date.now() + 3_600_000,
      person: { id: accountantId, name: 'Accountant', isOwner: false } });
    const past = await app.inject({ method: 'GET', url: '/app/inbox?filter=all', headers: { cookie: `yf_session=${token}` } });
    expect(past.headers['location']).not.toBe('/app/books');   // the route guard did not stop it
    expect(past.body).not.toContain(buyer);                     // the database did
  });

  it('an accountant\'s request never fills the workspace\'s cache: the owner\'s next page reads afresh', async () => {
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { makeSessionCodec } = await import('../../src/api/web/session.js');
    const count = (body: string) => /setup-strip[\s\S]*?(\d) of 5 steps done/.exec(body)?.[1] ?? 'no strip';
    // an app WITH the minute's cache
    const cached = Fastify({ logger: false });
    registerWebApp(cached, {
      db, businessId: RUN_BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 60_000,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await cached.ready();
    const COLS = 'description, location, contact_email, contact_phone';
    const was = (await admin.query(`select ${COLS} from businesses where id = $1`, [RUN_BIZ])).rows[0];
    const profile = (v: Record<string, unknown>) => admin.query(
      'update businesses set description = $2, location = $3, contact_email = $4, contact_phone = $5 where id = $1',
      [RUN_BIZ, v['description'], v['location'], v['contact_email'], v['contact_phone']]);
    try {
      await profile({ description: null, location: null, contact_email: null, contact_phone: null });
      const owner = cookieOf(await cached.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
      const token = makeSessionCodec(SECRET).sign({ businessId: RUN_BIZ, exp: Date.now() + 3_600_000,
        person: { id: accountantId, name: 'Accountant', isOwner: false, kind: 'accountant' } });
      // the accountant is the first to read the workspace; then a step is done (the profile)
      expect((await cached.inject({ method: 'GET', url: '/app/books', headers: { cookie: `yf_session=${token}` } })).statusCode).toBe(200);
      const before = Number(count((await app.inject({ method: 'GET', url: '/app/inbox', headers: { cookie: owner } })).body));
      await profile({ description: 'Canvas bags', location: 'Rabat', contact_email: 'shop@example.com', contact_phone: null });
      // had the accountant's reading been kept, the owner would see the count from before the step
      expect(count((await cached.inject({ method: 'GET', url: '/app/inbox', headers: { cookie: owner } })).body)).toBe(String(before + 1));
    } finally {
      await profile(was);
      await cached.close();
    }
  });
});
