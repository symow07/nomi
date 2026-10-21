import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * A2.2 (Phase 5, 0170) — tax codes, parties and custom fields: the rest of the books' model, with the database's
 * rules. A tax rate a posted line used never moves; a line's tax code is in force on its day; a party is the FEC's
 * auxiliary account; a custom value is checked against its definition. All as the app's role.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `b0a20000-0000-4000-8000-${RUN}0001`;
const OTHER = `b0a20000-0000-4000-8000-${RUN}0002`;

d('A2.2 · tax codes, parties and custom fields (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  const as = <T>(b: string, fn: (q: Q) => Promise<T>) => asTenant(app, b, fn);
  const refused = (b: string, fn: (q: Q) => Promise<unknown>) => refusal(app, b, fn);
  let k: { bank: string; sales: string; vat: string; vt: string; fy: string; tva20: string; party: string };

  const entry = async (q: Q, o: { date: string; tax?: string; party?: string; custom?: object; lineCustom?: object }) => {
    const id = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by, custom)
                         values (current_business_id(), $1, $2, $3, 'Facture', 'owner:mei', $4) returning id::text as id`,
      [k.vt, k.fy, o.date, JSON.stringify(o.custom ?? {})])).rows[0].id as string;
    await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, party_id, custom)
             values (current_business_id(), $1, 1, $2, 'MAD', 120, $3, $4)`, [id, k.bank, o.party ?? null, JSON.stringify(o.lineCustom ?? {})]);
    await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit) values (current_business_id(), $1, 2, $2, 'MAD', 100)`, [id, k.sales]);
    await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit, tax_code_id) values (current_business_id(), $1, 3, $2, 'MAD', 20, $3)`,
      [id, k.vat, o.tax ?? k.tva20]);
    return id;
  };
  const post = (q: Q, id: string) => q(`update journal_entries set state = 'posted', posted_by = 'owner:mei', document_ref = 'F-1', document_date = entry_date where id = $1 returning number`, [id]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    for (const [id, name] of [[BIZ, `Books model ${RUN}`], [OTHER, `Books model other ${RUN}`]]) {
      await admin.query(`insert into businesses (id, name, engine, currency) values ($1, $2, 'service', 'MAD')`, [id, name]);
    }
    k = await as(BIZ, async (q) => {
      const one = async (sql: string, v: unknown[]) => (await q(sql, v)).rows[0].id as string;
      const acc = (code: string, name: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id::text as id`, [code, name, kind]);
      const bank = await acc('5141', 'Banques', 'asset');
      const sales = await acc('7111', 'Ventes de marchandises', 'income');
      const vat = await acc('4455', 'Etat, TVA facturée', 'liability');
      return {
        bank, sales, vat,
        vt: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VT', 'Ventes', 'sales') returning id::text as id`, []),
        fy: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`, []),
        tva20: await one(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-01-01') returning id::text as id`, [vat]),
        party: await one(`insert into parties (business_id, kind, code, name, country, ice) values (current_business_id(), 'customer', 'C0001', 'Atlas Textiles SARL', 'MA', '001234567000089') returning id::text as id`, []),
      };
    });
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [BIZ, OTHER], 'books-model-test');
    await app.end();
    await admin.end();
  });

  it('a tax rate a POSTED line used never moves: a new rate is a new version from a new date', async () => {
    await as(BIZ, async (q) => { await post(q, await entry(q, { date: '2026-02-01', party: k.party })); });
    expect(await refused(BIZ, (q) => q(`update tax_codes set rate = 10 where id = $1`, [k.tva20]))).toMatch(/keeps its rate — add a new version/);
    expect(await refused(BIZ, (q) => q(`update tax_codes set account_id = $2 where id = $1`, [k.tva20, k.sales]))).toMatch(/keeps its rate/);
    // closing the version after the days it was used on is fine; before them is not
    expect(await refused(BIZ, (q) => q(`update tax_codes set valid_to = '2026-02-01' where id = $1`, [k.tva20]))).toMatch(/posted entries dated on or after 2026-02-01/);
    const v2 = await as(BIZ, async (q) => {
      await q(`update tax_codes set valid_to = '2026-07-01' where id = $1`, [k.tva20]);
      return (await q(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20', 'TVA 20 %', 20, 'collected', $1, '2026-07-01') returning id::text as id`, [k.vat])).rows[0].id as string;
    });
    // a line uses the version in force on its day, and no other
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-08-01' }))).toMatch(/TVA20 is not in force on 2026-08-01/);
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-03-01', tax: v2 }))).toMatch(/TVA20 is not in force on 2026-03-01/);
    await as(BIZ, async (q) => { await post(q, await entry(q, { date: '2026-08-01', tax: v2 })); });
    // and the posted history still reads its own rate
    const rates = await as(BIZ, async (q) => (await q(`select e.entry_date::text as d, t.rate::text as r from journal_lines l
      join journal_entries e on e.id = l.entry_id join tax_codes t on t.id = l.tax_code_id where e.state = 'posted' order by 1`)).rows);
    expect(rates).toEqual([{ d: '2026-02-01', r: '20.0000' }, { d: '2026-08-01', r: '20.0000' }]);
  });

  it('a party is an auxiliary account: one code each, Morocco\'s ICE fifteen digits, and never another workspace\'s', async () => {
    expect(await refused(BIZ, (q) => q(`insert into parties (business_id, kind, code, name) values (current_business_id(), 'customer', 'C0001', 'Twice')`))).toMatch(/parties_business_id_code_key/);
    expect(await refused(BIZ, (q) => q(`insert into parties (business_id, kind, code, name, ice) values (current_business_id(), 'supplier', 'F0001', 'Short ICE', '12345')`))).toMatch(/check constraint/);
    const foreign = await as(OTHER, async (q) => (await q(`insert into parties (business_id, kind, code, name) values (current_business_id(), 'customer', 'C0001', 'Theirs') returning id::text as id`)).rows[0].id as string);
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-03-01', party: foreign }))).toMatch(/journal_lines_party_fkey/);
    expect(await as(OTHER, async (q) => (await q(`select count(*)::int as n from parties`)).rows[0].n)).toBe(1);
  });

  it('custom values are checked against their definitions, by the database', async () => {
    await as(BIZ, async (q) => {
      await q(`insert into custom_field_defs (business_id, applies_to, key, label, kind) values (current_business_id(), 'entry', 'project', 'Project', 'text')`);
      await q(`insert into custom_field_defs (business_id, applies_to, key, label, kind) values (current_business_id(), 'line', 'weight_kg', 'Weight (kg)', 'number')`);
      await q(`insert into custom_field_defs (business_id, applies_to, key, label, kind, choices) values (current_business_id(), 'party', 'segment', 'Segment', 'choice', array['retail','wholesale'])`);
      await q(`insert into custom_field_defs (business_id, applies_to, key, label, kind) values (current_business_id(), 'party', 'since', 'Customer since', 'date')`);
    });
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-03-02', custom: { nope: 'x' } }))).toMatch(/no custom field "nope" on a entry/);
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-03-02', lineCustom: { weight_kg: 12.5 } }))).toMatch(/"weight_kg" is written as text/);
    expect(await refused(BIZ, (q) => entry(q, { date: '2026-03-02', lineCustom: { weight_kg: '1e3' } }))).toMatch(/a number, written exactly/);
    expect(await refused(BIZ, (q) => q(`update parties set custom = '{"segment":"vip"}' where id = $1`, [k.party]))).toMatch(/"segment" is one of its choices/);
    expect(await refused(BIZ, (q) => q(`update parties set custom = '{"since":"2026-02-30"}' where id = $1`, [k.party]))).toMatch(/"since" is not a real date/);
    await as(BIZ, async (q) => {
      await q(`update parties set custom = '{"segment":"wholesale","since":"2026-02-03"}' where id = $1`, [k.party]);
      await post(q, await entry(q, { date: '2026-03-02', custom: { project: 'Expo Casablanca' }, lineCustom: { weight_kg: '12.50' } }));
    });
    // a required field: every new row needs it — a party's only (0192: Nomi's own entries could never give one)
    expect(await refused(BIZ, (q) => q(`insert into custom_field_defs (business_id, applies_to, key, label, kind, required) values (current_business_id(), 'entry', 'cost_centre', 'Cost centre', 'text', true)`)))
      .toMatch(/custom_field_defs_required_party/);
    await as(BIZ, (q) => q(`insert into custom_field_defs (business_id, applies_to, key, label, kind, required) values (current_business_id(), 'party', 'region', 'Region', 'text', true)`));
    expect(await refused(BIZ, (q) => q(`insert into parties (business_id, kind, code, name) values (current_business_id(), 'customer', 'C0009', 'No region')`))).toMatch(/"region" is required/);
    // a definition keeps its key and its kind
    expect(await refused(BIZ, (q) => q(`update custom_field_defs set kind = 'number' where key = 'project'`))).toMatch(/keeps its key and its kind/);
    // a posted entry's custom values are as much the record as its amounts
    expect(await refused(BIZ, (q) => q(`update journal_entries set custom = '{"project":"Other"}' where state = 'posted' and custom ? 'project'`)))
      .toMatch(/never changed/);
  });

  it('the app deletes none of it (G20)', async () => {
    for (const t of ['tax_codes', 'parties', 'custom_field_defs']) {
      expect(await refused(BIZ, (q) => q(`delete from ${t}`)), t).toMatch(/permission denied/);
    }
  });
});
