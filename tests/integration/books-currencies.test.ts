import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * A3 (Phase 5, 0173; decision 13) — the books in ONE currency, a line in another turned at the OWNER's rate, and the
 * figures never move. The done-criterion (PHASE-5.md §4): each foreign line stores the owner's rate and its date; a
 * report run years later gives the same figures (the owner's rates change after posting, and history must not
 * move); a missing rate refuses the posting.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `a3a30000-0000-4000-8000-${RUN}0001`;

d('A3 · the books in one currency, at the owner\'s rates (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(app, BIZ, fn);
  const refused = (fn: (q: Q) => Promise<unknown>) => refusal(app, BIZ, fn);
  let k: { bank: string; sales: string; fx: string; vt: string; fy: string };

  type L = { account: string; currency: string; debit?: string; credit?: string };
  const entry = async (q: Q, date: string, lines: L[]) => {
    const id = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, $3, 'Export sale', 'owner') returning id::text as id`, [k.vt, k.fy, date])).rows[0].id as string;
    let n = 1;
    for (const l of lines) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, $2, $3, $4, $5, $6)`,
        [id, n++, l.account, l.currency, l.debit ?? '0', l.credit ?? '0']);
    }
    return id;
  };
  const post = (q: Q, id: string) => q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-X', document_date = entry_date where id = $1`, [id]);
  const rate = (q: Q, from: string, to: string, value: string, at: string) =>
    q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), $1, $2, $3, $4)`, [from, to, value, at]);
  const linesOf = (id: string) => as(async (q) => (await q(`select line_no, currency, debit::text, credit::text, book_debit::text, book_credit::text,
      rate::text, rate_stated_at::date::text as rate_day from journal_lines where entry_id = $1 order by line_no`, [id])).rows);
  // "The report": each account's balance in the books' currency.
  const report = () => as(async (q) => (await q(`select a.code, sum(l.book_debit - l.book_credit)::text as balance from journal_lines l
      join accounts a on a.id = l.account_id join journal_entries e on e.id = l.entry_id where e.state = 'posted' group by a.code order by a.code`)).rows);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [BIZ, `Currencies ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      return {
        bank: await acc('5141', 'asset'), sales: await acc('7121', 'income'), fx: await acc('6331', 'expense'),
        vt: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VT', 'Ventes', 'sales') returning id::text as id`),
        fy: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`),
      };
    });
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [BIZ], 'books-currencies-test');
    await app.end();
    await admin.end();
  });

  it('a line in the books\' currency is as it is; the first posting fixes the books\' currency', async () => {
    const id = await as(async (q) => { const i = await entry(q, '2026-02-01', [{ account: k.bank, currency: 'MAD', debit: '500.00' }, { account: k.sales, currency: 'MAD', credit: '500.00' }]); await post(q, i); return i; });
    expect((await linesOf(id)).map((l) => [l.book_debit, l.book_credit, l.rate])).toEqual([['500.00', '0.00', null], ['0.00', '500.00', null]]);
    expect(await as(async (q) => (await q(`select book_currency from books_settings`)).rows[0].book_currency)).toBe('MAD');
    expect(await refused((q) => q(`update books_settings set book_currency = 'EUR'`))).toMatch(/kept in MAD, fixed by the first posting/);
  });

  it('a MISSING rate refuses the posting, naming the pair and the day — and the inverse pair is not a rate', async () => {
    expect(await refused(async (q) => post(q, await entry(q, '2026-03-10', [
      { account: k.bank, currency: 'EUR', debit: '100.00' }, { account: k.sales, currency: 'EUR', credit: '100.00' }]))))
      .toMatch(/no rate of yours for EUR to MAD on or before 2026-03-10/);
    await as((q) => rate(q, 'MAD', 'EUR', '0.092', '2026-03-01T09:00:00Z'));   // the other way round: not the one asked
    expect(await refused(async (q) => post(q, await entry(q, '2026-03-10', [
      { account: k.bank, currency: 'EUR', debit: '100.00' }, { account: k.sales, currency: 'EUR', credit: '100.00' }]))))
      .toMatch(/no rate of yours for EUR to MAD/);
    // a rate stated AFTER the entry's day does not reach back
    await as((q) => rate(q, 'EUR', 'MAD', '10.875', '2026-03-11T09:00:00Z'));
    expect(await refused(async (q) => post(q, await entry(q, '2026-03-10', [
      { account: k.bank, currency: 'EUR', debit: '100.00' }, { account: k.sales, currency: 'EUR', credit: '100.00' }]))))
      .toMatch(/on or before 2026-03-10/);
  });

  let foreign = '';
  it('a foreign line stores the owner\'s rate and the day she stated it, with the books\' amounts', async () => {
    await as((q) => rate(q, 'EUR', 'MAD', '10.8', '2026-03-05T09:00:00Z'));
    foreign = await as(async (q) => { const i = await entry(q, '2026-03-10', [
      { account: k.bank, currency: 'EUR', debit: '100.00' }, { account: k.sales, currency: 'EUR', credit: '100.00' }]); await post(q, i); return i; });
    expect(await linesOf(foreign)).toEqual([
      { line_no: 1, currency: 'EUR', debit: '100.00', credit: '0.00', book_debit: '1080.00', book_credit: '0.00', rate: '10.800000', rate_day: '2026-03-05' },
      { line_no: 2, currency: 'EUR', debit: '0.00', credit: '100.00', book_debit: '0.00', book_credit: '1080.00', rate: '10.800000', rate_day: '2026-03-05' },
    ]);
    // the latest she stated on or before the day: the 11 March rate is for entries from that day on
    const later = await as(async (q) => { const i = await entry(q, '2026-03-12', [
      { account: k.bank, currency: 'EUR', debit: '10.00' }, { account: k.sales, currency: 'EUR', credit: '10.00' }]); await post(q, i); return i; });
    expect((await linesOf(later)).map((l) => [l.rate, l.book_debit || l.book_credit])).toEqual([['10.875000', '108.75'], ['10.875000', '0.00']]);
  });

  it('HISTORY DOES NOT MOVE: the owner states new rates, and the report run again gives the same figures', async () => {
    const before = await report();
    const linesBefore = await linesOf(foreign);
    await as(async (q) => {
      await rate(q, 'EUR', 'MAD', '11.2', '2026-03-01T08:00:00Z');   // even one dated earlier than the one used
      await rate(q, 'EUR', 'MAD', '9.9', '2026-03-10T08:00:00Z');
    });
    expect(await report()).toEqual(before);
    expect(await linesOf(foreign)).toEqual(linesBefore);
    // and nobody can rewrite a rate or a posted line's figures
    expect(await refused((q) => q(`update owner_rates set rate = 1`))).toMatch(/permission denied/);
    expect(await refused((q) => q(`update journal_lines set book_debit = 1 where entry_id = $1 and line_no = 1`, [foreign]))).toMatch(/never changed/);
  });

  it('it balances in the books\' currency too: a cent lost to rounding is a line of its own, never invented', async () => {
    await as((q) => rate(q, 'USD', 'MAD', '9.9765', '2026-04-01T09:00:00Z'));
    // 33.33 + 33.33 + 33.34 USD = 100.00; at 9.9765: 332.52 + 332.52 + 332.62 = 997.66, and 100.00 × 9.9765 = 997.65
    const lines: L[] = [
      { account: k.bank, currency: 'USD', debit: '33.33' }, { account: k.bank, currency: 'USD', debit: '33.33' },
      { account: k.bank, currency: 'USD', debit: '33.34' }, { account: k.sales, currency: 'USD', credit: '100.00' }];
    expect(await refused(async (q) => post(q, await entry(q, '2026-04-02', lines)))).toMatch(/does not balance in the books' currency — MAD: debits 997\.66, credits 997\.65/);
    // drafted with the exchange difference as its own line, in the books' currency, it posts
    await as(async (q) => post(q, await entry(q, '2026-04-02', [...lines, { account: k.fx, currency: 'MAD', credit: '0.01' }])));
  });

  it('a draft\'s books figures are the posting\'s to write, not the drafter\'s', async () => {
    const id = await as((q) => entry(q, '2026-05-01', [{ account: k.bank, currency: 'MAD', debit: '1.00' }, { account: k.sales, currency: 'MAD', credit: '1.00' }]));
    const r = await as(async (q) => {
      await q(`update journal_lines set book_debit = 999, book_credit = 0 where entry_id = $1 and line_no = 1`, [id]);
      return (await q(`select book_debit, rate from journal_lines where entry_id = $1 and line_no = 1`, [id])).rows[0];
    });
    expect(r).toEqual({ book_debit: null, rate: null });
  });
});
