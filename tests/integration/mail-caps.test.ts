import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

/**
 * MAIL (0112) — THE DAILY CAPS, OVER POSTGRES, on the app's own connection:
 * per address and for the installation, by kind; a refusal is counted and
 * nothing is sent; the address is kept only as its hash; the operator's daily
 * list reads the totals.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('MAIL · the daily caps (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  const A = `cap-a-${RUN}@mail.example`;
  const B = `cap-b-${RUN}@mail.example`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    db = (await import('../../src/db/client.js')).createDb(DATABASE_URL!);
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('PER ADDRESS: the cap\'s worth go, the next is refused — and another address is untouched', async () => {
    const { claimMailSend } = await import('../../src/db/mailCaps.js');
    const caps = { perAddress: 3, installation: 1_000_000 };
    const got = [];
    for (let i = 0; i < 4; i++) got.push(await claimMailSend(db, 'code', A, caps));
    expect(got).toEqual(['ok', 'ok', 'ok', 'address_cap']);
    expect(await claimMailSend(db, 'code', B, caps)).toBe('ok');
    // Another kind is counted apart.
    expect(await claimMailSend(db, 'alert', A, caps)).toBe('ok');
  });

  it('THE ADDRESS is kept only as its hash; the refusal is counted', async () => {
    const hash = createHash('sha256').update(A.toLowerCase()).digest('hex');
    const row = (await admin.query(`select sent, refused from mail_sends where kind = 'code' and recipient_hash = $1 and day = (now() at time zone 'UTC')::date`, [hash])).rows[0];
    expect(row).toEqual({ sent: 3, refused: 1 });
    expect((await admin.query(`select count(*)::int as n from mail_sends where recipient_hash like $1`, [`%${RUN}%`])).rows[0].n).toBe(0);
    // Upper case is the same address.
    const { claimMailSend } = await import('../../src/db/mailCaps.js');
    expect(await claimMailSend(db, 'code', A.toUpperCase(), { perAddress: 3, installation: 1_000_000 })).toBe('address_cap');
  });

  it('THE INSTALLATION: once the day\'s total is reached, every address is refused', async () => {
    const { claimMailSend } = await import('../../src/db/mailCaps.js');
    const today = Number((await admin.query(`select coalesce(sum(sent), 0)::int as n from mail_sends where kind = 'code' and day = (now() at time zone 'UTC')::date`)).rows[0].n);
    expect(await claimMailSend(db, 'code', `fresh-${RUN}@mail.example`, { perAddress: 100, installation: today })).toBe('installation_cap');
    expect(await claimMailSend(db, 'code', `fresh-${RUN}@mail.example`, { perAddress: 100, installation: today + 1 })).toBe('ok');
  });

  it('THE APP cannot read or write the table: only the two functions', async () => {
    const { sql } = await import('kysely');
    await expect(sql`select * from mail_sends`.execute(db)).rejects.toThrow(/permission denied/);
    await expect(sql`update mail_sends set sent = 0`.execute(db)).rejects.toThrow(/permission denied/);
  });

  it('THE OPERATOR\'S DAILY LIST reads the totals: counts only', async () => {
    const { mailSendsOn } = await import('../../src/db/mailCaps.js');
    const day = (await admin.query(`select (now() at time zone 'UTC')::date::text as d`)).rows[0].d;
    const totals = await mailSendsOn(db, day);
    const code = totals.find((x) => x.kind === 'code')!;
    expect(code.sent).toBeGreaterThanOrEqual(5);
    expect(code.refused).toBeGreaterThanOrEqual(3);
  });
});
