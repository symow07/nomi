import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * C1 (Phase 5, item 3) — entries by hand, through the routes (PHASE-5.md §4): an entry balances or is not posted; a
 * journal's numbers have no gap; a posted entry can only be reversed. The owner drafts, posts, discards and reverses;
 * the accountant sees all of it and does none of it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c1e10000-0000-4000-8000-${RUN}0001`;
const CODE = `entries-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';

d('C1 · entries by hand, through the routes (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let k: Record<'bank' | 'sales' | 've', string>;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }, who = owner) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: `${who}; ${set}` } })).body;
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const get = (url: string, who = owner) => app.inject({ method: 'GET', url, headers: { cookie: who } });
  const draft = (lines: [string, string, string][], more: Record<string, string> = {}) => post('/app/books/entries', {
    journal: k.ve, date: '2026-05-03', label: 'Facture F-2026-0051', documentRef: 'F-2026-0051', documentDate: '2026-05-03', ...more,
    ...Object.fromEntries(lines.flatMap(([account, debit, credit], i) => [[`account${i}`, account], [`debit${i}`, debit], [`credit${i}`, credit], [`currency${i}`, 'MAD']])),
  });
  const idOf = (r: { headers: Record<string, unknown> }) => String(r.headers['location']).split('/').pop()!;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Entries ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, name: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id::text as id`, [code, name, kind]);
      const out = { bank: await acc('5141', 'Banque', 'asset'), sales: await acc('7111', 'Ventes', 'income'),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`) };
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      return out;
    });
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-entries-test'); await admin?.end(); });

  it('the form refuses what it cannot read: "1.250", a line with both sides, one line alone', async () => {
    const ambiguous = await draft([[k.bank, '1.250', ''], [k.sales, '', '1250']]);
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.body).toContain('Line 1: this figure can be read two ways.');
    expect((await draft([[k.bank, '10', '10'], [k.sales, '', '10']])).body).toContain('Line 1: a debit or a credit, and only one.');
    expect((await draft([[k.bank, '10', '']])).body).toContain('An entry has two lines at least.');
    expect((await as((q) => q(`select count(*)::int as n from journal_entries`))).rows[0].n).toBe(0);
  });

  it('a draft that does not balance is kept as a draft; posting it is refused with the figures', async () => {
    const r = await draft([[k.bank, '100', ''], [k.sales, '', '90']]);
    expect(r.statusCode).toBe(303);
    const page = await get(String(r.headers['location']));
    expect(page.body).toContain('It does not balance yet: MAD 100 / 90.');
    const refused = await post(`/app/books/entries/${idOf(r)}/post`);
    expect(await notice(refused)).toMatch(/Not posted\. It does not balance: MAD: debits 100\.00, credits 90\.00\./);
    expect(await notice(await post(`/app/books/entries/${idOf(r)}/discard`))).toContain('The draft is discarded.');
  });

  it('a balanced draft posts, numbered by the database: VE-2026-1; a second, VE-2026-2', async () => {
    const one = await draft([[k.bank, '1440.60', ''], [k.sales, '', '1440.60']]);
    expect(await notice(await post(`/app/books/entries/${idOf(one)}/post`))).toContain('Posted as VE-2026-1.');
    const two = await draft([[k.bank, '380', ''], [k.sales, '', '380']], { label: 'Facture F-2026-0052', documentRef: 'F-2026-0052' });
    expect(await notice(await post(`/app/books/entries/${idOf(two)}/post`))).toContain('Posted as VE-2026-2.');
    const list = (await get('/app/books/entries')).body;
    expect(list).toContain('VE-2026-1');
    expect(list).toContain('VE-2026-2');
  });

  it('A POSTED ENTRY CAN ONLY BE REVERSED: no post or discard on it; reversing makes VE-2026-3, swapped, once', async () => {
    const id = (await as((q) => q(`select id::text as id from journal_entries where number = 1`))).rows[0].id as string;
    const page = (await get(`/app/books/entries/${id}`)).body;
    expect(page).not.toContain(`/app/books/entries/${id}/post`);
    expect(page).toMatch(/onclick="return confirm\(this\.dataset\.confirm\)" data-confirm="Reverse this entry\?/);
    expect(await notice(await post(`/app/books/entries/${id}/discard`))).toContain('It is not a draft any more.');
    const reversed = await post(`/app/books/entries/${id}/reverse`, { date: '2026-05-10' });
    expect(await notice(reversed)).toContain('Reversed as VE-2026-3.');
    const lines = await as((q) => q(`select l.debit::text, l.credit::text from journal_lines l join journal_entries e on e.id = l.entry_id where e.number = 3 order by l.line_no`));
    expect(lines.rows).toEqual([{ debit: '0.00', credit: '1440.60' }, { debit: '1440.60', credit: '0.00' }]);
    expect(await notice(await post(`/app/books/entries/${id}/reverse`, { date: '2026-05-11' }))).toContain('Only a posted entry that was not reversed yet can be reversed.');
    expect((await get(`/app/books/entries/${id}`)).body).toContain('See its reversal');
  });

  it('posting needs the document; a locked day refuses the draft', async () => {
    const bare = await draft([[k.bank, '5', ''], [k.sales, '', '5']], { documentRef: '', documentDate: '' });
    expect((await get(String(bare.headers['location']))).body).toContain('Posting needs the document');
    expect(await notice(await post(`/app/books/entries/${idOf(bare)}/post`))).toMatch(/Not posted\. Posting needs the document(&#39;|&#x27;|')s reference and date\./);
    await admin.query(`update fiscal_years set lock_date = '2026-05-31' where business_id = $1 and '2026-05-31' between starts_on and ends_on`, [BIZ]);   // an operator's write; the year's own lock (0211)
    const locked = await draft([[k.bank, '5', ''], [k.sales, '', '5']]);
    expect(locked.statusCode).toBe(422);
    expect(locked.body).toContain('That day is in a locked or closed period');
    await admin.query(`update fiscal_years set lock_date = null where business_id = $1`, [BIZ]);
  });

  it('THE ACCOUNTANT sees the entries and each one, with no way to post, discard or reverse — and the routes refuse', async () => {
    const id = (await as((q) => q(`select id::text as id from journal_entries where number = 2`))).rows[0].id as string;
    const list = (await get('/app/books/entries', accountant)).body;
    expect(list).toContain('VE-2026-2');
    expect(list).not.toContain('/app/books/entries/new');
    const page = (await get(`/app/books/entries/${id}`, accountant)).body;
    expect(page).not.toContain('/reverse"');
    const tried = await post(`/app/books/entries/${id}/reverse`, { date: '2026-05-12' }, accountant);
    expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    expect((await as((q) => q(`select max(number) as n from journal_entries`))).rows[0].n).toBe(3);
  });
});
