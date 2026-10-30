import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, purgeBusinesses } from './books-db.js';

/**
 * Audit batch 5 (2026-10-31, polish; 0221) — A YEAR IS LOCKED AND CLOSED ON THE WORKSPACE'S OWN DAY. Both functions
 * asked the database's day. A workspace behind UTC could close its year while its own last day was still running
 * (every later entry for that day then refused), and one ahead of UTC could not lock up to its own today.
 *   · Pago Pago (UTC−11): a year whose last day is the workspace's today is not closed yet — its day has not ended.
 *   · Kiritimati (UTC+14): locking up to the workspace's today is today, not a day to come.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BEHIND = `0ddda000-0000-4000-8000-${RUN}0001`;
const AHEAD = `0ddda000-0000-4000-8000-${RUN}0002`;

d('0221 · the books\' year is locked and closed on the workspace\'s own day (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  const refusal = async (business: string, text: string, values: unknown[] = []) => {
    try { await asTenant(tenant, business, (q) => q(text, values)); } catch (e) { return e instanceof Error ? e.message : String(e); }
    return 'accepted';
  };
  /** The workspace's today, as its books count it. */
  const today = async (business: string) => (await admin.query(`select books_today($1)::text as d`, [business])).rows[0].d as string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    for (const [id, zone] of [[BEHIND, 'Pacific/Pago_Pago'], [AHEAD, 'Pacific/Kiritimati']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, books_area, timezone) values ($1, $2, 'service', 'MA', 'MAD', true, $3)`,
        [id, `Own day ${RUN} ${zone}`, zone]);
    }
  });
  afterAll(async () => { await tenant?.end(); await purgeBusinesses(admin, [BEHIND, AHEAD], 'books-own-day-test'); await admin?.end(); });

  it('UTC−11: a year that ends on the workspace\'s today is not closed while that day runs', async () => {
    const last = await today(BEHIND);
    const k = await asTenant(tenant, BEHIND, async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      return {
        result: await one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '1191', 'Result', 'equity') returning id::text as id`),
        cl: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'CL', 'Closing', 'closing') returning id::text as id`),
        fy: await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), $1::date - 364, $1::date) returning id::text as id`, [last]),
      };
    });
    expect(await refusal(BEHIND, `select books_close_year($1, $2, $3, 'owner', 'Closing', 'CL-1')`, [k.fy, k.result, k.cl]))
      .toMatch(/a year is closed once it has ended/);
    expect((await admin.query(`select state from fiscal_years where id = $1`, [k.fy])).rows[0].state).toBe('open');
  });

  it('UTC+14: the books lock up to the workspace\'s today', async () => {
    const now = await today(AHEAD);
    await asTenant(tenant, AHEAD, (q) => q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), $1::date - 30, $1::date + 30)`, [now]));
    expect(await refusal(AHEAD, `select books_lock_to($1::date, 'owner')`, [now])).toBe('accepted');
    // a day after the workspace's today is still refused
    expect(await refusal(AHEAD, `select books_lock_to($1::date + 1, 'owner')`, [now])).toMatch(/today at the latest/);
  });
});
