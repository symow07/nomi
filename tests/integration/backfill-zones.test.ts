import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = new URL('../../', import.meta.url);
const RUN = randomUUID().slice(0, 8);
const MA = `b1290000-0000-4000-8000-${RUN}0001`;     // Morocco, no prices: zone and currency
const US = `b1290000-0000-4000-8000-${RUN}0002`;     // several zones: flagged, currency kept
const PRICED = `b1290000-0000-4000-8000-${RUN}0003`; // Emirates with a price: zone only
const SELF = `b1290000-0000-4000-8000-${RUN}0004`;   // signed itself up: never touched
const PRODUCT = `b1290000-0000-4000-8001-${RUN}0003`;

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], url = MIGRATE_URL): Run => {
  const r = spawnSync(process.execPath, ['tools/backfill-zones.mjs', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: url ?? '' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('Block 1 #9 · the zone and currency backfill for the workspaces made before sign-up asked (requires MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  const rowOf = async (id: string) => (await admin.query(`select timezone, currency from businesses where id = $1`, [id])).rows[0] as { timezone: string; currency: string };
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    for (const [id, name, country, extra] of [
      [MA, `Zones MA ${RUN}`, 'MA', ''], [US, `Zones US ${RUN}`, 'US', ''], [PRICED, `Zones AE ${RUN}`, 'AE', ''], [SELF, `Zones self ${RUN}`, 'MA', ", signed_up_at = now()"],
    ] as const) {
      await admin.query(`insert into businesses (id, name, country, timezone, currency) values ($1, $2, $3, 'Asia/Shanghai', 'USD')`, [id, name, country]);
      if (extra) await admin.query(`update businesses set signed_up_at = now() where id = $1`, [id]);
    }
    await admin.query(`insert into products (id, business_id, sku, name, price_usd_per_unit) values ($1, $2, $3, 'Oud', 40)`, [PRODUCT, PRICED, `Z-${RUN}`]);
  });
  afterAll(async () => {
    await admin.query(`delete from products where business_id = any($1::uuid[])`, [[MA, US, PRICED, SELF]]);
    await admin.query(`delete from businesses where id = any($1::uuid[])`, [[MA, US, PRICED, SELF]]);
    await admin.end();
  });

  it('the dry run names each workspace with what it would do, and changes nothing', async () => {
    const r = tool([]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('DRY RUN');
    expect(r.out).toMatch(new RegExp(`${MA}.*zone → Africa/Casablanca; currency USD → MAD`));
    expect(r.out).toMatch(new RegExp(`${US}.*zone FLAGGED on its profile page \\(several zones\\); currency kept`));
    expect(r.out).toMatch(new RegExp(`${PRICED}.*zone → Asia/Dubai; currency kept \\(has prices\\)`));
    expect(r.out).not.toContain(SELF);
    expect(r.out).not.toContain('7dc89f42-852e-465a-920f-8af170dc83cd');
    expect(await rowOf(MA)).toEqual({ timezone: 'Asia/Shanghai', currency: 'USD' });
  });

  it('--yes writes exactly that, once; a second run finds nothing left to change', async () => {
    const r = tool(['--yes']);
    expect(r.code, r.err).toBe(0);
    expect(await rowOf(MA)).toEqual({ timezone: 'Africa/Casablanca', currency: 'MAD' });
    expect(await rowOf(US)).toEqual({ timezone: 'Asia/Shanghai', currency: 'USD' });
    expect(await rowOf(PRICED)).toEqual({ timezone: 'Asia/Dubai', currency: 'USD' });
    expect(await rowOf(SELF)).toEqual({ timezone: 'Asia/Shanghai', currency: 'USD' });
    const again = tool([]);
    expect(again.out).not.toContain(MA);           // its zone is no longer Shanghai: out of the list
    expect(again.out).toMatch(new RegExp(`${US}.*FLAGGED`));
  });

  it('refuses a role that row security filters, and changes nothing', async () => {
    const r = tool([], DATABASE_URL);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Refusing');
  });
});
