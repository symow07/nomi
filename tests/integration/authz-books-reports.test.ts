import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema, flashSaid } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7), fix round — L1, the owner reports, per role.
 *
 * L1 — the five owner reports and their spreadsheets (`/app/books/reports/{made,money,tax,customers,unpaid}[.xlsx]`)
 * were not on `BOOKS_ROUTES`: the list named `/app/books/reports/:kind`, and the guard matches the route's own url, which
 * is one literal address per kind. So the books' role rule never ran: staff got the page, empty (`not_for_staff` hides
 * every row), and the accountant, who reads the books, was sent away to `/app/books`. Now: the owner and the accountant
 * read each one, the posted figure on it; staff are refused with the books' own words.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS = `f${RUN}`;
const A = `${NS}-0000-4000-8000-0000000000b1`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OWNER_CODE = `authz-fix-${RUN}`;
const code = (tag: string) => `${tag}${RUN.slice(0, 2).toUpperCase()}-${RUN.slice(2, 7).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}`;
const KINDS = ['made', 'money', 'tax', 'customers', 'unpaid'] as const;
const FIGURE = '4,321.77';

d('Authorization audit · fix round: the owner reports by role (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  const cookies: Record<'owner' | 'team' | 'accountant', string> = { owner: '', team: '', accountant: '' };
  const sess = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const login = async (c: string) => sess(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  const get = (url: string, who: keyof typeof cookies) => app.inject({ method: 'GET', url, headers: { cookie: cookies[who] } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    await admin.query(demoSeedSql(NS));
    await admin.query(`update businesses set books_area = true, country = 'MA', currency = 'MAD' where id = $1`, [A]);
    // A posted sale of 4,321.77 today: on the bank, against sales — every report has something of it to show.
    const one = async (text: string, v: unknown[]) => (await admin.query(text, v)).rows[0].id as string;
    const bank = await one(`insert into accounts (business_id, code, name, kind) values ($1, '5141', 'Bank', 'asset') returning id::text as id`, [A]);
    const sales = await one(`insert into accounts (business_id, code, name, kind) values ($1, '7111', 'Sales', 'income') returning id::text as id`, [A]);
    const journal = await one(`insert into journals (business_id, code, name, kind) values ($1, 'BQ', 'Banque', 'bank') returning id::text as id`, [A]);
    const fy = await one(`insert into fiscal_years (business_id, starts_on, ends_on) values ($1, date_trunc('year', current_date)::date, (date_trunc('year', current_date) + interval '1 year - 1 day')::date) returning id::text as id`, [A]);
    const entry = await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($1, $2, $3, current_date, 'Sale', 'owner') returning id::text as id`, [A, journal, fy]);
    await admin.query(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($1, $2, 1, $3, 'MAD', 4321.77, 0), ($1, $2, 2, $4, 'MAD', 0, 4321.77)`, [A, entry, bank, sales]);
    await admin.query(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-1', document_date = entry_date where id = $1`, [entry]);
    const { hashCode } = await import('../../src/api/web/people.js');
    for (const [kind, tag] of [['team', 'TM'], ['accountant', 'AC']] as const) {
      await admin.query(`insert into people (business_id, name, is_owner, kind, code_hash) values ($1, $2, false, $3, $4)`, [A, `Fix ${kind}`, kind, hashCode(SECRET, code(tag))]);
    }
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: A, accessCode: OWNER_CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookies.owner = await login(OWNER_CODE);
    cookies.team = await login(code('TM'));
    cookies.accountant = await login(code('AC'));
    for (const c of Object.values(cookies)) expect(c).not.toBe('');
  }, 120_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await purgeBusinesses(admin, [A], 'authz-fix-round-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('L1 · the owner reads each report and its spreadsheet, the posted figure on it', async () => {
    for (const kind of ['made', 'money'] as const) expect((await get(`/app/books/reports/${kind}`, 'owner')).body, kind).toContain(FIGURE);
    for (const kind of KINDS) {
      expect((await get(`/app/books/reports/${kind}`, 'owner')).statusCode, kind).toBe(200);
      const x = await get(`/app/books/reports/${kind}.xlsx`, 'owner');
      expect([x.statusCode, String(x.headers['content-type'])], `${kind}.xlsx`).toEqual([200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    }
  });

  it('L1 · the accountant reads each report and its spreadsheet — the same page as the owner\'s', async () => {
    for (const kind of KINDS) {
      const page = await get(`/app/books/reports/${kind}`, 'accountant');
      expect([page.statusCode, page.headers['location']], kind).toEqual([200, undefined]);
      const x = await get(`/app/books/reports/${kind}.xlsx`, 'accountant');
      expect([x.statusCode, String(x.headers['content-type'])], `${kind}.xlsx`).toEqual([200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    }
    for (const kind of ['made', 'money'] as const) expect((await get(`/app/books/reports/${kind}`, 'accountant')).body, kind).toContain(FIGURE);
  });

  it('L1 · staff are refused every report and spreadsheet with the books\' own words — never an empty report', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const words = t('en', 'staff.booksNotYours');
    for (const kind of KINDS) {
      for (const url of [`/app/books/reports/${kind}`, `/app/books/reports/${kind}.xlsx`]) {
        const r = await get(url, 'team');
        expect([r.statusCode, r.headers['location'], flashSaid(r, SECRET)], url).toEqual([302, '/app', words]);
      }
    }
  });

  it('L1 · every books route the app registers is on BOOKS_ROUTES, so the role rule decides it', async () => {
    const { booksRouteOf } = await import('../../src/api/web/books.js');
    const registered: string[] = [];
    const probe = Fastify({ logger: false });
    probe.addHook('onRoute', (r) => { for (const m of ([] as string[]).concat(r.method as string | string[])) if (m === 'GET' || m === 'POST') registered.push(`${m} ${r.url}`); });
    const { registerWebApp } = await import('../../src/api/web/app.js');
    registerWebApp(probe, { db, businessId: A, accessCode: `probe-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0, employeeName: 'Lily', avatar: 'x',
      provider: 'disabled', secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {} } as unknown as Parameters<typeof registerWebApp>[1]);
    await probe.ready(); await probe.close();
    const reports = registered.filter((r) => /^GET \/app\/books\/reports\//.test(r));
    const off = reports.filter((r) => { const [m, u] = r.split(' ') as [string, string]; return booksRouteOf(m, u) === null; });
    expect(off, `report routes the role rule never sees:\n${off.join('\n')}`).toEqual([]);
    for (const kind of KINDS) for (const u of [`/app/books/reports/${kind}`, `/app/books/reports/${kind}.xlsx`]) expect(booksRouteOf('GET', u)?.action, u).toBe('see');
  });

});
