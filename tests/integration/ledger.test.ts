import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * A2.1 (Phase 5, 0169) — THE DATABASE REFUSES, whoever asks (docs/PHASE-5.md §4, A2's done-criterion):
 * an unbalanced entry, a line in a locked period, an edit to a posted entry, and a gap or a repeat in a journal's
 * numbering. Corrections are reversing entries, linked to the original. And the Avis 24 criteria that are the
 * ledger's: a document reference and date on every posted entry, who posted it and when, at most two fiscal years
 * open, a closing journal of its own.
 *
 * Everything here runs as the APP's role (`nomi_app`, row security on), the way the product will write — except
 * the operator's purge, which must be refused to it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `1ed90000-0000-4000-8000-${RUN}0001`;
const OTHER = `1ed90000-0000-4000-8000-${RUN}0002`;

type Q = (text: string, values?: unknown[]) => Promise<pg.QueryResult>;

d('A2.1 · the ledger\'s rules are the database\'s (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  let ids: { bank: string; sales: string; vat: string; vt: string; cl: string; fy: string };

  /** One tenant transaction as the app: committed, or rolled back on any error (which is re-thrown). */
  async function as<T>(business: string, fn: (q: Q) => Promise<T>, client = app): Promise<T> {
    await client.query('begin');
    try {
      await client.query(`select set_config('app.business_id', $1, true)`, [business]);
      const out = await fn((t, v) => client.query(t, v));
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }
  const refused = async (business: string, fn: (q: Q) => Promise<unknown>): Promise<string> => {
    try { await as(business, fn); } catch (e) { return e instanceof Error ? e.message : String(e); }
    throw new Error('expected the database to refuse, and it accepted');
  };

  type Line = { account: string; currency?: string; debit?: string; credit?: string };
  const draft = async (q: Q, o: { date: string; label: string; lines: Line[]; journal?: string; reverses?: string }) => {
    const id = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by, reverses_id)
                         values (current_business_id(), $1, $2, $3, $4, 'owner:mei', $5) returning id::text as id`,
      [o.journal ?? ids.vt, ids.fy, o.date, o.label, o.reverses ?? null])).rows[0].id as string;
    let n = 1;
    for (const l of o.lines) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit)
               values (current_business_id(), $1, $2, $3, $4, $5, $6)`,
        [id, n++, l.account, l.currency ?? 'MAD', l.debit ?? '0', l.credit ?? '0']);
    }
    return id;
  };
  const post = async (q: Q, id: string, ref = 'F-' + id.slice(0, 4)) =>
    (await q(`update journal_entries set state = 'posted', posted_by = 'owner:mei', document_ref = $2, document_date = entry_date
               where id = $1 returning number`, [id, ref])).rows[0]?.number as number;
  const sale = (amount: string): Line[] => [
    { account: ids.bank, debit: amount },
    { account: ids.sales, credit: amount },
  ];
  const numbers = (business = BIZ) => as(business, async (q) =>
    (await q(`select number from journal_entries where journal_id = $1 and state = 'posted' order by number`, [ids.vt])).rows.map((r) => r.number as number));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    for (const [id, name] of [[BIZ, `Ledger ${RUN}`], [OTHER, `Ledger other ${RUN}`]]) {
      await admin.query(`insert into businesses (id, name, engine, currency) values ($1, $2, 'service', 'MAD')`, [id, name]);
    }
    ids = await as(BIZ, async (q) => {
      const acc = async (code: string, name: string, kind: string) =>
        (await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id::text as id`, [code, name, kind])).rows[0].id as string;
      const jr = async (code: string, name: string, kind: string) =>
        (await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), $1, $2, $3) returning id::text as id`, [code, name, kind])).rows[0].id as string;
      return {
        bank: await acc('5141', 'Banques', 'asset'), sales: await acc('7111', 'Ventes de marchandises', 'income'),
        vat: await acc('4455', 'Etat, TVA facturée', 'liability'),
        vt: await jr('VT', 'Ventes', 'sales'), cl: await jr('CL', 'Clôture', 'closing'),
        fy: (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id as string,
      };
    });
  });

  afterAll(async () => {
    // The operator's purge (books_purge_allowed): what the test-tenant pruner does.
    await admin.query('begin');
    await admin.query(`set local nomi.books_purge = 'ledger-test'`);
    await admin.query('delete from businesses where id = any($1)', [[BIZ, OTHER]]);
    await admin.query('commit');
    await app.end();
    await admin.end();
  });

  it('a balanced entry posts, numbered by the database, with who and when', async () => {
    const r = await as(BIZ, async (q) => {
      const id = await draft(q, { date: '2026-02-01', label: 'Facture 2026-0001', lines: [
        { account: ids.bank, debit: '1200.00' }, { account: ids.sales, credit: '1000.00' }, { account: ids.vat, credit: '200.00' }] });
      const number = await post(q, id, 'F-2026-0001');
      return (await q(`select number, posted_by, posted_at is not null as at, document_ref, document_date::text from journal_entries where id = $1`, [id])).rows[0];
    });
    expect(r).toEqual({ number: 1, posted_by: 'owner:mei', at: true, document_ref: 'F-2026-0001', document_date: '2026-02-01' });
  });

  it('UNBALANCED is refused, in each currency on its own — and two currencies never balance each other', async () => {
    expect(await refused(BIZ, async (q) => post(q, await draft(q, { date: '2026-02-02', label: 'Short', lines: [
      { account: ids.bank, debit: '100.00' }, { account: ids.sales, credit: '99.99' }] }))))
      .toMatch(/does not balance — MAD: debits 100\.00, credits 99\.99/);
    expect(await refused(BIZ, async (q) => post(q, await draft(q, { date: '2026-02-02', label: 'Mixed', lines: [
      { account: ids.bank, currency: 'MAD', debit: '100.00' }, { account: ids.sales, currency: 'EUR', credit: '100.00' }] }))))
      .toMatch(/does not balance — EUR: debits 0(\.00)?, credits 100\.00/);   // A3: MAD, the books' own, is checked converted
    expect(await refused(BIZ, async (q) => post(q, await draft(q, { date: '2026-02-02', label: 'One line', lines: [
      { account: ids.bank, debit: '100.00' }] })))).toMatch(/two lines at least/);
    // a line is one side, never both, never neither
    expect(await refused(BIZ, async (q) => draft(q, { date: '2026-02-02', label: 'Both', lines: [
      { account: ids.bank, debit: '1', credit: '1' }, { account: ids.sales, credit: '0' }] }))).toMatch(/check constraint/);
    expect(await numbers()).toEqual([1]);   // and none of them took a number
  });

  it('a POSTED entry is never edited and never deleted, nor are its lines — not even with the purge setting, by the app', async () => {
    const id = await as(BIZ, async (q) => { const i = await draft(q, { date: '2026-02-03', label: 'Kept', lines: sale('50.00') }); await post(q, i); return i; });
    expect(await refused(BIZ, (q) => q(`update journal_entries set label = 'Changed' where id = $1`, [id]))).toMatch(/never changed — reverse it/);
    expect(await refused(BIZ, (q) => q(`update journal_entries set entry_date = '2026-02-04' where id = $1`, [id]))).toMatch(/never changed/);
    expect(await refused(BIZ, (q) => q(`update journal_lines set debit = 49 where entry_id = $1 and line_no = 1`, [id]))).toMatch(/lines are never changed/);
    expect(await refused(BIZ, (q) => q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit)
      values (current_business_id(), $1, 9, $2, 'MAD', 1)`, [id, ids.bank]))).toMatch(/lines are never changed/);
    // the app deletes nothing (G20), purge setting or not
    expect(await refused(BIZ, (q) => q(`delete from journal_lines where entry_id = $1`, [id]))).toMatch(/permission denied/);
    expect(await refused(BIZ, (q) => q(`delete from journal_entries where id = $1`, [id]))).toMatch(/permission denied/);
    expect(await refused(BIZ, async (q) => { await q(`set local nomi.books_purge = 'please'`); await q(`delete from journal_entries where id = $1`, [id]); }))
      .toMatch(/permission denied/);
    // and the admin, without an operator's purge, meets the trigger
    await expect(admin.query(`delete from journal_entries where id = $1`, [id])).rejects.toThrow(/never deleted — reverse it/);
    await expect(admin.query(`delete from journal_lines where entry_id = $1`, [id])).rejects.toThrow(/lines are never changed/);
    // a draft the owner no longer wants is discarded — kept, never numbered, and final
    const gone = await as(BIZ, async (q) => { const i = await draft(q, { date: '2026-02-03', label: 'Discarded', lines: sale('5.00') });
      await q(`update journal_entries set state = 'discarded' where id = $1`, [i]); return i; });
    expect(await refused(BIZ, (q) => post(q, gone))).toMatch(/stays discarded/);
    expect(await refused(BIZ, (q) => q(`update journal_lines set debit = 6 where entry_id = $1 and line_no = 1`, [gone]))).toMatch(/discarded/);
  });

  it('a CORRECTION is a reversing entry, linked to the original, with the original\'s lines swapped — once', async () => {
    const original = await as(BIZ, async (q) => { const i = await draft(q, { date: '2026-02-05', label: 'Wrong amount', lines: sale('300.00') }); await post(q, i); return i; });
    // a "reversal" whose lines are not the original's is refused
    expect(await refused(BIZ, async (q) => post(q, await draft(q, { date: '2026-02-06', label: 'Half a reversal', reverses: original,
      lines: [{ account: ids.sales, debit: '150.00' }, { account: ids.bank, credit: '150.00' }] })))).toMatch(/debit and credit swapped/);
    const reversal = await as(BIZ, async (q) => {
      const i = await draft(q, { date: '2026-02-06', label: 'Reverses: wrong amount', reverses: original,
        lines: [{ account: ids.sales, debit: '300.00' }, { account: ids.bank, credit: '300.00' }] });
      await post(q, i, 'A-0001');
      return i;
    });
    const link = await as(BIZ, async (q) => (await q(`select reverses_id::text as r from journal_entries where id = $1`, [reversal])).rows[0].r);
    expect(link).toBe(original);
    expect(await refused(BIZ, async (q) => draft(q, { date: '2026-02-07', label: 'Twice', reverses: original,
      lines: [{ account: ids.sales, debit: '300.00' }, { account: ids.bank, credit: '300.00' }] }))).toMatch(/journal_entries_reverses_id_key/);
    // a draft cannot be "reversed"
    const pending = await as(BIZ, (q) => draft(q, { date: '2026-02-07', label: 'Not posted', lines: sale('1.00') }));
    expect(await refused(BIZ, async (q) => post(q, await draft(q, { date: '2026-02-07', label: 'Reverses a draft', reverses: pending,
      lines: [{ account: ids.sales, debit: '1.00' }, { account: ids.bank, credit: '1.00' }] })))).toMatch(/only a posted entry can be reversed/);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where id = $1`, [pending]));
  });

  it('NUMBERING has no gap and no repeat: a refused or rolled-back posting takes no number; the app cannot move the counter', async () => {
    const before = await numbers();
    // a posting that fails after its number was taken rolls back with it
    expect(await refused(BIZ, async (q) => { await post(q, await draft(q, { date: '2026-02-10', label: 'Rolled back', lines: sale('10.00') })); throw new Error('the caller gave up'); }))
      .toBe('the caller gave up');
    // the app can read the counter, and not write it — raising it by one without posting would be a gap
    expect(await refused(BIZ, (q) => q(`update journal_counters set last_number = last_number + 1`))).toMatch(/permission denied/);
    expect(await refused(BIZ, (q) => q(`delete from journal_counters`))).toMatch(/permission denied/);
    expect(await refused(BIZ, (q) => q(`insert into journal_counters (business_id, journal_id, fiscal_year_id, last_number) values (current_business_id(), $1, $2, 1)`, [ids.cl, ids.fy])))
      .toMatch(/permission denied/);
    // nor give an entry its own number, nor post straight from an insert
    expect(await refused(BIZ, async (q) => q(`update journal_entries set state = 'posted', posted_by = 'x', document_ref = 'X', document_date = entry_date, number = 99 where id = $1`,
      [await draft(q, { date: '2026-02-10', label: 'Own number', lines: sale('1.00') })]))).toMatch(/database's to give/);
    expect(await refused(BIZ, (q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by, state, posted_by, posted_at, number, document_ref, document_date)
      values (current_business_id(), $1, $2, '2026-02-10', 'Direct', 'x', 'posted', 'x', now(), $3, 'X', '2026-02-10')`, [ids.vt, ids.fy, before.length + 1]))).toMatch(/drafted with its lines, then posted/);
    // even the admin, outside the posting path, meets the counter's rule
    const fyCounter = await admin.query(`select last_number from journal_counters where journal_id = $1`, [ids.vt]);
    await expect(admin.query(`update journal_counters set last_number = last_number + 5 where journal_id = $1`, [ids.vt])).rejects.toThrow(/only ever rises by one/);
    await expect(admin.query(`update journal_counters set last_number = last_number - 1 where journal_id = $1`, [ids.vt])).rejects.toThrow(/only ever rises by one/);
    await expect(admin.query(`delete from journal_counters where journal_id = $1`, [ids.vt])).rejects.toThrow(/never released/);
    expect((await admin.query(`select last_number from journal_counters where journal_id = $1`, [ids.vt])).rows).toEqual(fyCounter.rows);
    // what was posted is 1 … n, every one
    const after = await numbers();
    expect(after).toEqual(Array.from({ length: after.length }, (_, i) => i + 1));
    expect(after).toEqual(before);
  });

  it('two postings at once in one journal get consecutive numbers — they wait for each other, never share one', async () => {
    const other = new pg.Client({ connectionString: DATABASE_URL });
    await other.connect();
    try {
      const [a, b] = await Promise.all([
        as(BIZ, async (q) => post(q, await draft(q, { date: '2026-03-01', label: 'At once A', lines: sale('7.00') }))),
        as(BIZ, async (q) => post(q, await draft(q, { date: '2026-03-01', label: 'At once B', lines: sale('8.00') })), other),
      ]);
      expect(Math.abs(a - b)).toBe(1);
    } finally {
      await other.end();
    }
    const all = await numbers();
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
  });

  it('a LOCKED day, a day outside the year, a CLOSED year: nothing is drafted or posted there', async () => {
    // the first posting made the settings row (A3: it fixes the books' currency); the lock date is set on it
    // (an operator's write: the app moves the lock only through D2's functions, 0189 — tests/integration/books-close.test.ts)
    const lockTo = (day: string | null) => admin.query(`update books_settings set lock_date = $2 where business_id = $1`, [BIZ, day]);
    await lockTo('2026-01-31');
    expect(await refused(BIZ, (q) => draft(q, { date: '2026-01-15', label: 'In January', lines: sale('1.00') }))).toMatch(/on or before the lock date 2026-01-31/);
    expect(await refused(BIZ, (q) => draft(q, { date: '2027-01-02', label: 'Next year', lines: sale('1.00') }))).toMatch(/outside fiscal year 2026-01-01 to 2026-12-31/);
    // a draft left from before the lock cannot be posted after it
    await lockTo(null);
    const early = await as(BIZ, (q) => draft(q, { date: '2026-01-20', label: 'Drafted before the lock', lines: sale('2.00') }));
    await lockTo('2026-01-31');
    expect(await refused(BIZ, (q) => post(q, early))).toMatch(/lock date/);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where id = $1`, [early]));
    // a closed year: closing waits for its drafts, then nothing more is written in it, and it never reopens
    const fy2025 = await as(BIZ, async (q) => (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2025-01-01', '2025-12-31') returning id::text as id`)).rows[0].id as string);
    await lockTo(null);
    const last = await as(BIZ, async (q) => {
      const id = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2025-12-31', 'À clôturer', 'x') returning id::text as id`, [ids.vt, fy2025])).rows[0].id as string;
      return id;
    });
    // the app closes a year only by closing it (0189); an operator's direct close still waits for its drafts
    expect(await refused(BIZ, (q) => q(`update fiscal_years set state = 'closed', closed_at = now(), closed_by = 'owner:mei' where id = $1`, [fy2025]))).toMatch(/closed by closing it/);
    const closeYear = () => admin.query(`update fiscal_years set state = 'closed', closed_at = now(), closed_by = 'owner:mei' where id = $1`, [fy2025]);
    await expect(closeYear()).rejects.toThrow(/still has drafts/);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where id = $1`, [last]));
    await closeYear();
    expect(await refused(BIZ, (q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2025-12-31', 'Late', 'x')`, [ids.vt, fy2025])))
      .toMatch(/fiscal year 2025-01-01 to 2025-12-31 is closed/);
    expect(await refused(BIZ, (q) => q(`update fiscal_years set state = 'open', closed_at = null, closed_by = null where id = $1`, [fy2025]))).toMatch(/stays closed/);
    await lockTo('2026-01-31');
  });

  it('at most TWO fiscal years open (Avis 24), and never two that overlap', async () => {
    await as(BIZ, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2027-01-01', '2027-12-31')`));
    expect(await refused(BIZ, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2028-01-01', '2028-12-31')`)))
      .toMatch(/two fiscal years are open already/);
    expect(await refused(BIZ, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on, state, closed_at, closed_by) values (current_business_id(), '2026-07-01', '2027-06-30', 'closed', now(), 'x')`)))
      .toMatch(/overlaps another/);
  });

  it('a posted entry carries its document\'s reference and date, and who posted it', async () => {
    const id = await as(BIZ, (q) => draft(q, { date: '2026-04-01', label: 'No document yet', lines: sale('3.00') }));
    expect(await refused(BIZ, (q) => q(`update journal_entries set state = 'posted', posted_by = 'owner:mei' where id = $1`, [id]))).toMatch(/document's reference and date/);
    expect(await refused(BIZ, (q) => q(`update journal_entries set state = 'posted', posted_by = '  ', document_ref = 'F-9', document_date = entry_date where id = $1`, [id])))
      .toMatch(/posted by someone|check constraint/);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where id = $1`, [id]));
  });

  it('another workspace sees none of it, and cannot write into it', async () => {
    const seen = await as(OTHER, async (q) => ({
      entries: (await q('select count(*)::int as n from journal_entries')).rows[0].n,
      lines: (await q('select count(*)::int as n from journal_lines')).rows[0].n,
      accounts: (await q('select count(*)::int as n from accounts')).rows[0].n,
      counters: (await q('select count(*)::int as n from journal_counters')).rows[0].n,
    }));
    expect(seen).toEqual({ entries: 0, lines: 0, accounts: 0, counters: 0 });
    expect(await refused(OTHER, (q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($1, $2, $3, '2026-05-01', 'Intruder', 'x')`, [BIZ, ids.vt, ids.fy])))
      .toMatch(/row-level security/);
  });

  it('deleting the workspace does not take its posted books with it — only an operator\'s purge does', async () => {
    await expect(admin.query('delete from businesses where id = $1', [BIZ])).rejects.toThrow(/never deleted/);
    expect((await admin.query('select count(*)::int as n from journal_entries where business_id = $1 and state = $2', [BIZ, 'posted'])).rows[0].n).toBeGreaterThan(0);
  });
});
