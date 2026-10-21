import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * C1 (Phase 5, 0182; the owner's question before C1) — WHERE THE EXCHANGE DIFFERENCE GOES. The remainder of a foreign
 * entry in the books' currency is its own line (A3); marked as the exchange difference, the database takes it only on
 * the workspace's exchange-loss account as a debit or its exchange-gain account as a credit, in the books' currency.
 * And C1's numbering, widened: twenty postings at once in two journals, each journal 1…n with no gap, no repeat.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `c1c10000-0000-4000-8000-${RUN}0001`;

d('C1 · the exchange difference, and numbering under load (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(app, BIZ, fn);
  const refused = (fn: (q: Q) => Promise<unknown>) => refusal(app, BIZ, fn);
  let k: Record<'bank' | 'sales' | 'loss' | 'gain' | 'other' | 'vt' | 'bq' | 'fy', string>;
  type L = { account: string; currency: string; debit?: string; credit?: string; fx?: boolean };
  const entry = async (q: Q, journal: string, lines: L[]) => {
    const id = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2026-04-09', 'USD receipt', 'owner') returning id::text as id`, [journal, k.fy])).rows[0].id as string;
    let n = 1;
    for (const l of lines) {
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit, is_fx) values (current_business_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [id, n++, l.account, l.currency, l.debit ?? '0', l.credit ?? '0', l.fx ?? false]);
    }
    return id;
  };
  const post = (q: Q, id: string) => q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'SWIFT-1', document_date = entry_date where id = $1`, [id]);
  // 33.33 + 33.33 + 33.34 USD at 9.9765: 997.66 against 100.00 × 9.9765 = 997.65 — a gain of 0.01 MAD.
  const usd = (diff: L): L[] => [
    { account: k.bank, currency: 'USD', debit: '33.33' }, { account: k.bank, currency: 'USD', debit: '33.33' },
    { account: k.bank, currency: 'USD', debit: '33.34' }, { account: k.sales, currency: 'USD', credit: '100.00' }, diff];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect(); await app.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [BIZ, `FX ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      return {
        bank: await acc('5141', 'asset'), sales: await acc('7121', 'income'), loss: await acc('6331', 'expense'), gain: await acc('7331', 'income'), other: await acc('6147', 'expense'),
        vt: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VT', 'Ventes', 'sales') returning id::text as id`),
        bq: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`),
        fy: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`),
      };
    });
    await as((q) => q(`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (current_business_id(), 'USD', 'MAD', 9.9765, '2026-04-01T09:00:00Z')`));
  });
  afterAll(async () => { await purgeBusinesses(admin, [BIZ], 'books-fx-test'); await app.end(); await admin.end(); });

  it('a marked difference with no exchange accounts chosen is refused, with what to do', async () => {
    expect(await refused((q) => entry(q, k.bq, usd({ account: k.gain, currency: 'MAD', credit: '0.01', fx: true }))))
      .toMatch(/the exchange accounts are not set — choose them, then mark the difference/);
  });

  it('chosen: a gain is a credit on the gain account, in the books\' currency — and it posts', async () => {
    await as((q) => q(`insert into books_settings (business_id, fx_loss_account_id, fx_gain_account_id) values (current_business_id(), $1, $2)
      on conflict (business_id) do update set fx_loss_account_id = excluded.fx_loss_account_id, fx_gain_account_id = excluded.fx_gain_account_id`, [k.loss, k.gain]));
    const id = await as(async (q) => { const e = await entry(q, k.bq, usd({ account: k.gain, currency: 'MAD', credit: '0.01', fx: true })); await post(q, e); return e; });
    const marked = await as((q) => q(`select a.code, l.book_credit::text as credit from journal_lines l join accounts a on a.id = l.account_id where l.entry_id = $1 and l.is_fx`, [id]));
    expect(marked.rows).toEqual([{ code: '7331', credit: '0.01' }]);
  });

  it('a marked difference anywhere else is refused: another account, the wrong side, a foreign currency', async () => {
    const why = /an exchange difference goes to the exchange accounts|in the books' own currency/;
    expect(await refused((q) => entry(q, k.bq, usd({ account: k.other, currency: 'MAD', credit: '0.01', fx: true })))).toMatch(why);
    expect(await refused((q) => entry(q, k.bq, usd({ account: k.loss, currency: 'MAD', credit: '0.01', fx: true })))).toMatch(why);   // a gain on the LOSS account
    expect(await refused((q) => entry(q, k.bq, usd({ account: k.gain, currency: 'MAD', debit: '0.01', fx: true })))).toMatch(why);    // a loss on the GAIN account
    expect(await refused((q) => entry(q, k.bq, usd({ account: k.gain, currency: 'USD', credit: '0.01', fx: true })))).toMatch(why);
  });

  it('NUMBERING UNDER LOAD: twenty postings at once in two journals — each journal 1…n, no gap, no repeat', async () => {
    const drafts = await as(async (q) => {
      const ids: { id: string; journal: 'VT' | 'BQ' }[] = [];
      for (let i = 0; i < 20; i++) {
        const journal = i % 2 === 0 ? 'VT' : 'BQ';
        ids.push({ id: await entry(q, journal === 'VT' ? k.vt : k.bq, [{ account: k.bank, currency: 'MAD', debit: '10' }, { account: k.sales, currency: 'MAD', credit: '10' }]), journal });
      }
      return ids;
    });
    // twenty connections, each posting one, all at once
    const clients = await Promise.all(drafts.map(async () => { const c = new pg.Client({ connectionString: DATABASE_URL }); await c.connect(); return c; }));
    try {
      await Promise.all(drafts.map((dr, i) => asTenant(clients[i]!, BIZ, (q) => post(q, dr.id))));
    } finally { await Promise.all(clients.map((c) => c.end())); }
    const numbers = await as((q) => q(`select j.code, array_agg(e.number order by e.number) as n from journal_entries e join journals j on j.id = e.journal_id
      where e.state = 'posted' group by j.code order by j.code`));
    const byJournal = Object.fromEntries(numbers.rows.map((r) => [r.code, (r.n as number[])]));
    const run = (n: number[]) => n.every((x, i) => x === i + 1);
    expect(run(byJournal['VT']!), `VT ${byJournal['VT']}`).toBe(true);
    expect(run(byJournal['BQ']!), `BQ ${byJournal['BQ']}`).toBe(true);
    expect(byJournal['VT']!.length).toBe(10);
    expect(byJournal['BQ']!.length).toBe(11);   // the ten, after the one posted above
  });
});
