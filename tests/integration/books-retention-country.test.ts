import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, purgeBusinesses } from './books-db.js';
import { BOOKS_RETENTION } from '../../src/core/legal/booksRetention.js';

/**
 * 0218 (the owner, 2026-10-28) — the books are kept as long as their country's law says: six years in the United
 * Kingdom, ten in France, Morocco, Spain and everywhere not on record, counted from the end of the last financial
 * year with a posted entry. Read as the app's role, through `books_keep_until` (what closure holds the books to and
 * the data page shows) and the data page's reader; and the privacy page's list held equal to the table.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const SHOPS = [
  { id: `b2180000-0000-4000-8000-${RUN}0001`, country: 'GB', currency: 'GBP', until: '2032-12-31' },
  { id: `b2180000-0000-4000-8000-${RUN}0002`, country: 'ES', currency: 'EUR', until: '2036-12-31' },
  { id: `b2180000-0000-4000-8000-${RUN}0003`, country: 'FR', currency: 'EUR', until: '2036-12-31' },
  { id: `b2180000-0000-4000-8000-${RUN}0004`, country: 'DE', currency: 'EUR', until: '2036-12-31' },   // not on record
] as const;

d('0218 · the books kept by their country\'s law (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    for (const s of SHOPS) {
      await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', $3, $4)`,
        [s.id, `Retention ${s.country} ${RUN}`, s.country, s.currency]);
      await asTenant(app, s.id, async (q) => {
        const acc = async (code: string, kind: string) => (await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind])).rows[0].id as string;
        const bank = await acc('512', 'asset'); const sales = await acc('706', 'income');
        const vt = (await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VT', 'Sales', 'sales') returning id::text as id`)).rows[0].id;
        const fy = (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id;
        const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2026-03-01', 'Invoice 1', 'mei') returning id::text as id`, [vt, fy])).rows[0].id;
        await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit) values (current_business_id(), $1, 1, $2, $3, 100)`, [e, bank, s.currency]);
        await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit) values (current_business_id(), $1, 2, $2, $3, 100)`, [e, sales, s.currency]);
        await q(`update journal_entries set state = 'posted', posted_by = 'mei', document_ref = 'F-1', document_date = entry_date where id = $1`, [e]);
      });
    }
  });
  afterAll(async () => {
    await purgeBusinesses(admin, SHOPS.map((s) => s.id), 'books-retention-country-test').catch(() => {});
    await app.end();
    await admin.end();
  });

  it('the privacy page lists exactly the table\'s countries, with the table\'s years', async () => {
    const rows = (await app.query(`select country, years from books_retention order by country`)).rows;
    const page = BOOKS_RETENTION.map((r) => ({ country: r.country, years: r.years })).sort((a, b) => (a.country < b.country ? -1 : 1));
    expect(rows).toEqual(page);
  });

  it('a 2026 posting is kept six years in the United Kingdom and ten in Spain, France and a country not on record', async () => {
    for (const s of SHOPS) {
      const until = await asTenant(app, s.id, async (q) => (await q(`select books_keep_until(current_business_id())::text as d`)).rows[0].d);
      expect(until, s.country).toBe(s.until);
    }
  });

  it('the data page names the country\'s own law', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const books = await import('../../src/db/booksExport.js');
    const db = createDb(DATABASE_URL!);
    try {
      const law = async (id: string) => {
        const bid = parseBusinessId(id); if (!bid.ok) throw new Error('fixture');
        return (await withTenantTx(db, bid.value, (tx) => books.booksHoldingTx(tx, id))).law;
      };
      expect(await law(SHOPS[0].id)).toBe('Finance Act 1998, Sch. 18, para. 21; Value Added Tax Act 1994, Sch. 11, para. 6(3): six years');
      expect(await law(SHOPS[1].id)).toBe('Ley General Tributaria, art. 66 bis: diez años para pérdidas y deducciones pendientes');
      expect(await law(SHOPS[2].id)).toBe('Code de commerce, art. L123-22: dix ans');
    } finally {
      await db.destroy();
    }
  });

  it('the app role still only reads the table', async () => {
    await expect(app.query(`update books_retention set years = 1 where country = 'GB'`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`insert into books_retention (country, years, law) values ('IT', 10, 'x')`)).rejects.toThrow(/permission denied/);
  });
});
