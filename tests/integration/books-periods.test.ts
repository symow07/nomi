import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * D10 (Phase 5; 0211; the owner, 2026-10-24, option A) — A LOCK FOR EACH FISCAL YEAR, AND AVIS 24's PERIODS ON TOP.
 *
 *   · ONE predicate decides a write: the entry's date after ITS OWN year's lock (books_day_writable). Nothing else.
 *   · §2.3 d) is a rule on the SET of locks: two current periods in the exercice in progress, plus the previous
 *     year's closing period (its last), plus the opening entry's period. Kept by raising locks (books_roll_periods),
 *     checked when a lock moves back (books_reopen_year) — never by refusing a write.
 *   · The books start once; nothing before the start is entered by hand.
 *
 * Every day here is NAMED (the periods' day is passed in, or set as `nomi.books_day`, which only a role other than
 * the app's may do): the tests do not depend on the day they run.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d10d0000-0000-4000-8000-${RUN}0001`;     // Moroccan: the periods are kept
const FAR = `d10d0000-0000-4000-8000-${RUN}0002`;     // Moroccan: the start itself
const ELSE = `d10d0000-0000-4000-8000-${RUN}0003`;    // French: a manual lock only

d('D10 · a lock per fiscal year, and Avis 24\'s periods on the set of locks (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let k: Record<'bank' | 'sales' | 've' | 'fy2026' | 'fy2027', string>;
  const as = <T>(biz: string, fn: (q: Q) => Promise<T>) => asTenant(tenant, biz, fn);
  /** As an operator (not the app's role), on a NAMED day for the periods. */
  const onDay = <T>(biz: string, day: string, fn: (q: Q) => Promise<T>) => asTenant(admin, biz, async (q) => {
    await q(`select set_config('nomi.books_day', $1, true)`, [day]);
    return fn(q);
  });
  const lockOf = async (year: string) => (await admin.query(`select lock_date::text as l from fiscal_years where id = $1`, [year])).rows[0].l as string | null;
  const roll = (biz: string, day: string) => admin.query(`select books_roll_periods($1::uuid, $2::date) as n`, [biz, day]).then((r) => r.rows[0].n as number);
  const problems = (biz: string, day: string) => admin.query(`select fiscal_year::text, lock_date::text, floor::text from books_period_problems($1::uuid, $2::date)`, [biz, day]).then((r) => r.rows);
  /** A draft entry dated `day` in its year, by the app's role: the one predicate decides. */
  const write = (biz: string, year: string, day: string) => as(biz, (q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
    values (current_business_id(), $1, $2, $3, $4, 'owner') returning id::text as id`, [k.ve, year, day, `E ${day}`]));
  /** True when the entry went in; else the database's reason. */
  const tryWrite = async (biz: string, year: string, day: string): Promise<true | string> => {
    try { await write(biz, year, day); return true; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  const writable = (year: string, day: string) => tryWrite(BIZ, year, day);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    for (const [id, country] of [[BIZ, 'MA'], [FAR, 'MA'], [ELSE, 'FR']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', $3, 'MAD', true)`, [id, `Periods ${RUN} ${country}`, country]);
    }
    k = await as(BIZ, async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      return {
        bank: await one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '5141', 'Banque', 'asset') returning id::text as id`),
        sales: await one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '7111', 'Ventes', 'income') returning id::text as id`),
        ve: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales') returning id::text as id`),
        fy2026: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`),
        fy2027: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2027-01-01', '2027-12-31') returning id::text as id`),
      };
    });
    // the books begin on 1 January 2026, monthly — started as of a NAMED day, before any period has passed
    await onDay(BIZ, '2026-01-15', (q) => q(`select books_start('2026-01-01', 'month', 'owner')`));
  }, 60_000);
  afterAll(async () => { await tenant?.end(); await purgeBusinesses(admin, [BIZ, FAR, ELSE], 'books-periods-test'); await admin?.end(); });

  it('THE ONE PREDICATE: a write is decided by its own year\'s lock and nothing else — a set of locks that breaks the ceiling refuses no write', async () => {
    // books_day_writable reads the year's lock, its state and its days — no period, no day of the calendar, no start
    const def = (await admin.query(`select pg_get_functiondef('books_day_writable(uuid,uuid,date)'::regprocedure) as d`)).rows[0].d as string;
    expect(def).toContain('f.lock_date');
    expect(def).not.toMatch(/period|books_today|books_reference_day|books_start|floor|now\(\)|current_date/i);
    // on 15 February 2027 the set of locks is too open (2026's lock is still at its start) — and a write in June 2026 still goes in
    expect(await problems(BIZ, '2027-02-15')).toEqual([{ fiscal_year: k.fy2026, lock_date: null, floor: '2026-11-30' }]);
    expect(await writable(k.fy2026, '2026-06-10')).toBe(true);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where business_id = current_business_id()`));
  });

  it('FEBRUARY 2027 — January and February 2027 and December 2026 open together; opening March closes January 2027 and leaves December 2026 open', async () => {
    // mid-February 2027: the periods are kept — 2026 locked up to the end of November (December is its closing period)
    expect(await roll(BIZ, '2027-02-15')).toBe(1);
    expect([await lockOf(k.fy2026), await lockOf(k.fy2027)]).toEqual(['2026-11-30', null]);
    expect(await problems(BIZ, '2027-02-15')).toEqual([]);
    expect(await writable(k.fy2026, '2026-12-15')).toBe(true);     // the closing period of 2026
    expect(await writable(k.fy2027, '2027-01-20')).toBe(true);     // the period before the current one
    expect(await writable(k.fy2027, '2027-02-10')).toBe(true);     // the current period
    expect(await writable(k.fy2026, '2026-11-20')).toMatch(/2026-11-20 is on or before the lock date 2026-11-30/);
    // 1 March 2027: March opens, January 2027 closes — and December 2026 stays open, its year not closed yet
    expect(await roll(BIZ, '2027-03-01')).toBe(1);
    expect([await lockOf(k.fy2026), await lockOf(k.fy2027)]).toEqual(['2026-11-30', '2027-01-31']);
    expect(await writable(k.fy2026, '2026-12-20')).toBe(true);
    expect(await writable(k.fy2027, '2027-01-25')).toMatch(/2027-01-25 is on or before the lock date 2027-01-31/);
    expect(await writable(k.fy2027, '2027-02-26')).toBe(true);
    expect(await writable(k.fy2027, '2027-03-02')).toBe(true);
    // kept again the same day: nothing more moves; recorded as the periods' doing
    expect(await roll(BIZ, '2027-03-01')).toBe(0);
    const moved = (await admin.query(`select action, fiscal_year_id::text as y, to_date::text as t, by_person from period_locks
      where business_id = $1 and action = 'period' order by at`, [BIZ])).rows;
    expect(moved).toEqual([{ action: 'period', y: k.fy2026, t: '2026-11-30', by_person: 'nomi' },
      { action: 'period', y: k.fy2027, t: '2027-01-31', by_person: 'nomi' }]);
    await as(BIZ, (q) => q(`update journal_entries set state = 'discarded' where business_id = current_business_id() and state = 'draft'`));
  });

  it('A REOPENING THAT WOULD BREAK THE CEILING IS REFUSED; one that keeps it goes through, with its reason', async () => {
    const reopen = (year: string, day: string | null) => onDay(BIZ, '2027-03-10', (q) => q(`select books_reopen_year($1::uuid, $2::date, 'owner', 'A late supplier bill')`, [year, day]));
    // January 2027 back open beside February and March: three current periods — refused, nothing moved
    await expect(reopen(k.fy2027, '2026-12-31')).rejects.toThrow(/Avis 24 keeps two current periods open at most: that year stays locked to 2027-01-31 at least/);
    await expect(reopen(k.fy2026, '2026-10-31')).rejects.toThrow(/that year stays locked to 2026-11-30 at least/);
    expect([await lockOf(k.fy2026), await lockOf(k.fy2027)]).toEqual(['2026-11-30', '2027-01-31']);
  });

  it('THE TWO INVARIANTS AGREE: 0169\'s two open years bound the live locks at two, and the floors never name more', async () => {
    // a third open year is refused, as always
    expect(await refusal(tenant, BIZ, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2028-01-01', '2028-12-31')`)))
      .toMatch(/two fiscal years are open already/);
    // on every first-and-middle of a month across both years, the floors name at most two years, both open
    for (let m = 0; m < 24; m++) {
      for (const dd of ['01', '15']) {
        const day = `${2026 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-${dd}`;
        const floors = (await admin.query(`select x.fiscal_year::text as y, f.state from books_period_floors($1::uuid, $2::date) x
          join fiscal_years f on f.id = x.fiscal_year`, [BIZ, day])).rows;
        expect(floors.length, day).toBeLessThanOrEqual(2);
        expect(floors.every((f) => f.state === 'open'), day).toBe(true);
        expect(floors.length, day).toBeLessThanOrEqual((await admin.query(`select count(*)::int as n from fiscal_years where business_id = $1 and state = 'open'`, [BIZ])).rows[0].n);
      }
    }
  });

  it('THE BOOKS START ONCE: nothing before the start by hand; a second start refused; the opening day writable until its period closes', async () => {
    const y = await as(FAR, async (q) => {
      await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VE', 'Ventes', 'sales')`);
      return (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2040-01-01', '2040-12-31') returning id::text as id`)).rows[0].id as string;
    });
    const ve = (await as(FAR, (q) => q(`select id::text as id from journals where code = 'VE'`))).rows[0].id as string;
    const entryOn = async (day: string): Promise<true | string> => {
      try {
        await as(FAR, (q) => q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by)
          values (current_business_id(), $1, $2, $3, 'x', 'owner')`, [ve, y, day]));
        return true;
      } catch (e) { return e instanceof Error ? e.message : String(e); }
    };
    // the app's role may not start the books by a plain write, nor set their length
    expect(await refusal(tenant, FAR, (q) => q(`insert into books_settings (business_id, books_start) values (current_business_id(), '2040-03-01')`)))
      .toMatch(/the books start once/);
    await onDay(FAR, '2040-03-10', (q) => q(`select books_start('2040-03-01', 'quarter', 'owner')`));
    expect(await lockOf(y)).toBe('2040-02-29');                      // the day before the start (a leap year)
    expect(await entryOn('2040-02-15')).toMatch(/on or before the lock date 2040-02-29/);
    expect(await entryOn('2040-03-01')).toBe(true);                   // the opening entry's day
    await expect(onDay(FAR, '2040-03-10', (q) => q(`select books_start('2040-04-01', 'month', 'owner')`))).rejects.toThrow(/started on 2040-03-01 already/);
    // quarters: on 10 August 2040 the current quarter is Jul–Sep and the one before Apr–Jun: January–March closes
    expect(await roll(FAR, '2040-08-10')).toBe(1);
    expect(await lockOf(y)).toBe('2040-03-31');
    // and a reopening never goes below the start
    await expect(onDay(FAR, '2040-04-02', (q) => q(`select books_reopen_year($1::uuid, '2040-01-31', 'owner', 'Too far back')`, [y])))
      .rejects.toThrow(/the books start on 2040-03-01; nothing before it reopens/);
  });

  it('A WORKSPACE OUTSIDE MOROCCO keeps the manual lock: its periods are not kept, whatever the day', async () => {
    const y = await as(ELSE, async (q) => (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id as string);
    await onDay(ELSE, '2026-01-10', (q) => q(`select books_start('2026-01-01', 'month', 'owner')`));
    expect(await roll(ELSE, '2026-11-20')).toBe(0);
    expect(await lockOf(y)).toBeNull();                               // a start on the year's first day locks nothing
    expect((await admin.query(`select count(*)::int as n from books_period_floors($1::uuid, '2026-11-20')`, [ELSE])).rows[0].n).toBe(0);
  });

  it('IMPORTS BEFORE THE START ARE HISTORY: E3\'s window opens at the day after each year\'s own lock', async () => {
    const { firstOpenDay } = await import('../../src/core/books/history.js');
    const years = (await admin.query(`select starts_on::text as s, ends_on::text as e, state, lock_date::text as l from fiscal_years where business_id = $1`, [BIZ])).rows
      .map((r) => ({ startsOn: r.s, endsOn: r.e, state: r.state, lockDate: r.l }));
    // 2026 locked to the end of November, 2027 to the end of January: the window opens on 1 December 2026
    expect(firstOpenDay(years)).toBe('2026-12-01');
  });
});
