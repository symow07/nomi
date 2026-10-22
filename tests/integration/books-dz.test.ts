import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';

/**
 * DZ within block S (PHASE-5.md, "Found in D7, for the sweep") — the accountant's write refused AT THE DATABASE on
 * the rest of the books: parties, the chart of accounts, journals, tax codes, and a draft entry and its lines (0200).
 * Past every route guard: a session that IS the accountant writes straight through the app's own role and its row
 * security, and each insert, change and deletion is refused with the books' reason — while the same rows stay in
 * sight (they are the books), and the owner's same writes go. Each table is tried on its own, so a table that loses
 * its guard is named. And STAFF get nothing of the books (decision 12; 0201): a team member's request sees no row of
 * them and writes none — and every table of the books must carry that policy, or say here why the sales side reads it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `56560000-0000-4000-8000-${RUN}0001`;
const REFUSED = /an accountant sees and exports the books; this is the owner's/;

type Tx = import('../../src/db/client.js').Tx;

d('DZ · the rest of the books, refused to the accountant by the database (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let ownerId = '';
  let accountantId = '';
  let staffId = '';
  const row: Record<string, string> = {};

  const as = async <T>(person: string, fn: (t: Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { asViewer } = await import('../../src/db/viewer.js');
    return asViewer(person, () => withTenantTx(db, BIZ as never, fn));
  };
  /** A fresh row of each table, written by whoever `as` names. */
  const write: Record<string, (t: Tx) => Promise<unknown>> = {
    parties: (t) => sql`insert into parties (business_id, code, name, kind) values (${BIZ}::uuid, ${`P${Math.random().toString(36).slice(2, 8)}`}, 'Atlas', 'customer')`.execute(t),
    accounts: (t) => sql`insert into accounts (business_id, code, name, kind) values (${BIZ}::uuid, ${`9${Math.floor(Math.random() * 1e6)}`}, 'Cash', 'asset')`.execute(t),
    journals: (t) => sql`insert into journals (business_id, code, name, kind) values (${BIZ}::uuid, ${`J${Math.floor(Math.random() * 1e6)}`}, 'Misc', 'general')`.execute(t),
    tax_codes: (t) => sql`insert into tax_codes (business_id, code, label, rate, kind, valid_from) values (${BIZ}::uuid, ${`X${Math.floor(Math.random() * 1e6)}`}, 'Exempt', 0, 'exempt', '2030-01-01')`.execute(t),
    journal_entries: (t) => sql`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values (${BIZ}::uuid, ${row['journals']}::uuid, ${row['fiscal_years']}::uuid, '2030-03-01', 'Draft', 'test')`.execute(t),
    journal_lines: (t) => sql`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit)
      values (${BIZ}::uuid, ${row['journal_entries']}::uuid, ${Math.floor(Math.random() * 1e6) + 10}, ${row['accounts']}::uuid, 'MAD', 1)`.execute(t),
  };
  const label: Record<string, string> = { parties: 'name', accounts: 'name', journals: 'name', tax_codes: 'label', journal_entries: 'label', journal_lines: 'label' };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale, currency) values ($1, 'Books DZ', 'en', 'MAD')`, [BIZ]);
    ownerId = (await admin.query(`select id::text as id from people where business_id = $1 and is_owner`, [BIZ])).rows[0]?.id
      ?? (await admin.query(`insert into people (business_id, name, code_hash, is_owner) values ($1, 'Owner', $2, true) returning id::text as id`, [BIZ, `h-o-${RUN}`])).rows[0].id;
    accountantId = (await admin.query(`insert into people (business_id, name, code_hash, kind) values ($1, 'Books', $2, 'accountant') returning id::text as id`,
      [BIZ, `h-a-${RUN}`])).rows[0].id;
    staffId = (await admin.query(`insert into people (business_id, name, code_hash, kind) values ($1, 'Sales', $2, 'team') returning id::text as id`,
      [BIZ, `h-s-${RUN}`])).rows[0].id;
    const one = async (q: string, v: unknown[]) => (await admin.query(q, v)).rows[0].id as string;
    row['parties'] = await one(`insert into parties (business_id, code, name, kind) values ($1, 'C001', 'Atlas', 'customer') returning id::text as id`, [BIZ]);
    row['accounts'] = await one(`insert into accounts (business_id, code, name, kind) values ($1, '5141', 'Bank', 'asset') returning id::text as id`, [BIZ]);
    row['journals'] = await one(`insert into journals (business_id, code, name, kind) values ($1, 'OD', 'General', 'general') returning id::text as id`, [BIZ]);
    row['tax_codes'] = await one(`insert into tax_codes (business_id, code, label, rate, kind, valid_from) values ($1, 'EX', 'Exempt', 0, 'exempt', '2030-01-01') returning id::text as id`, [BIZ]);
    row['fiscal_years'] = await one(`insert into fiscal_years (business_id, starts_on, ends_on) values ($1, '2030-01-01', '2030-12-31') returning id::text as id`, [BIZ]);
    row['journal_entries'] = await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
      values ($1, $2, $3, '2030-02-01', 'Draft', 'owner') returning id::text as id`, [BIZ, row['journals'], row['fiscal_years']]);
    row['journal_lines'] = await one(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, label)
      values ($1, $2, 1, $3, 'MAD', 1, 'line') returning id::text as id`, [BIZ, row['journal_entries'], row['accounts']]);
  }, 60_000);
  afterAll(async () => {
    await db?.destroy();
    await admin?.query(`delete from businesses where id = $1`, [BIZ]).catch(() => {});
    await admin?.end();
  });

  for (const table of ['parties', 'accounts', 'journals', 'tax_codes', 'journal_entries', 'journal_lines']) {
    it(`${table}: the accountant sees it, and inserts, changes and deletes nothing`, async () => {
      const seen = await as(accountantId, (t) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where id = ${row[table]}::uuid`.execute(t));
      expect(seen.rows[0]!.n).toBe(1);
      await expect(as(accountantId, write[table]!)).rejects.toThrow(REFUSED);
      await expect(as(accountantId, (t) => sql`update ${sql.table(table)} set ${sql.ref(label[table]!)} = 'Theirs' where id = ${row[table]}::uuid`.execute(t)))
        .rejects.toThrow(REFUSED);
      await expect(as(accountantId, (t) => sql`delete from ${sql.table(table)} where id = ${row[table]}::uuid`.execute(t)))
        .rejects.toThrow(/an accountant sees and exports the books|permission denied/);
      // unchanged, and the owner's own write of the same kind goes
      expect((await admin.query(`select ${label[table]} as l from ${table} where id = $1`, [row[table]])).rows[0].l).not.toBe('Theirs');
      await expect(as(ownerId, write[table]!)).resolves.toBeDefined();
    });

    it(`${table}: a member of the team sees no row of it and writes none`, async () => {
      const seen = await as(staffId, (t) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)}`.execute(t));
      expect(seen.rows[0]!.n).toBe(0);
      await expect(as(staffId, write[table]!)).rejects.toThrow(/row-level security/);
      const changed = await as(staffId, (t) => sql`update ${sql.table(table)} set ${sql.ref(label[table]!)} = 'Theirs' where id = ${row[table]}::uuid`.execute(t));
      expect(changed.numAffectedRows).toBe(0n);
      expect((await as(ownerId, (t) => sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where id = ${row[table]}::uuid`.execute(t))).rows[0]!.n).toBe(1);
    });
  }

  it('every table of the books carries the staff policy; the ones the sales side reads too are named here', async () => {
    // The books are the tables the accountant may see (0177's policy does not hold them: books-viewer.test.ts).
    const books = (await admin.query<{ t: string }>(`
      select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'not_for_accountants')
       order by 1`)).rows.map((r) => r.t);
    const held = new Set((await admin.query<{ t: string }>(`select tablename as t from pg_policies where policyname = 'not_for_staff' and permissive = 'RESTRICTIVE'`)).rows.map((r) => r.t));
    // Read by the sales side as well: the workspace row, the documents' residency, the documents store, a quote's rate.
    const SHARED = ['books_settings', 'businesses', 'document_blobs', 'documents', 'owner_rates'];
    expect(books.filter((t) => !held.has(t) && !SHARED.includes(t))).toEqual([]);
    // the books' connections and connector records are hidden from the accountant too, and still none of staff's
    for (const t of ['books_connections', 'connector_records', 'tax_start_dates']) expect(held.has(t), t).toBe(true);
  });
});
