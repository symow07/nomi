import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * 0093 (the positioning rewrite, 2026-09-30) — what the database takes: the ten
 * kinds of business the form offers (an online shop and a startup joined), and
 * the nine languages a business may say it serves. Anything else is refused
 * by the column's own check, whatever wrote it.
 */

const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `0093b000-0000-4000-8000-${RUN}0001`;

d('0093 · the kinds and the languages the database takes (requires MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [BIZ, `Kinds ${RUN}`]);
  });
  afterAll(async () => { await admin?.end(); });

  it('every kind the form offers is stored; one it does not offer is refused', async () => {
    const { BUSINESS_KINDS } = await import('../../src/core/owner/business.js');
    expect(BUSINESS_KINDS).toContain('online_shop');
    expect(BUSINESS_KINDS).toContain('startup');
    for (const k of BUSINESS_KINDS) {
      await admin.query(`update businesses set kind = $1 where id = $2`, [k, BIZ]);
      expect((await admin.query(`select kind from businesses where id = $1`, [BIZ])).rows[0].kind, k).toBe(k);
    }
    await expect(admin.query(`update businesses set kind = 'pyramid' where id = $1`, [BIZ])).rejects.toThrow(/businesses_kind_check/);
  });

  it('the nine languages served are stored; another is refused', async () => {
    const { SERVED_LANGUAGES } = await import('../../src/core/owner/i18n/locale.js');
    await admin.query(`update businesses set languages_served = $1 where id = $2`, [[...SERVED_LANGUAGES], BIZ]);
    expect((await admin.query(`select languages_served from businesses where id = $1`, [BIZ])).rows[0].languages_served).toEqual([...SERVED_LANGUAGES]);
    await expect(admin.query(`update businesses set languages_served = '{xx}' where id = $1`, [BIZ])).rejects.toThrow(/businesses_languages_served_check/);
  });
});
