import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * G2 — A WORKSPACE IS BORN WITH WHAT THE COHORT NEEDS (0100): the zone and
 * the currency sign-up chose, written by provision_workspace itself; the seven
 * capabilities in draft; a budget row with a hard cap. Over real Postgres,
 * through the app role, as sign-up calls it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const HASH = 'scrypt$16384$8$1$c2FsdA$aGFzaA';
const CAPABILITIES = ['confirm_order', 'follow_up', 'greet', 'negotiate', 'qualify', 'quote', 'recommend'];

d('G2 · provisioning (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let provisionAccount: typeof import('../../src/db/accounts.js')['provisionAccount'];
  let admin: pg.Client;
  const make = (tag: string, profile: { zone?: string; currency?: string }) => provisionAccount(db, {
    factory: `G2 ${tag} ${RUN}`, language: 'en', ownerName: 'Owner', email: `g2-${tag}-${RUN}@shop.example`,
    passwordHash: HASH, invite: null, inviteRequired: false,
    profile: { kind: 'retail', sells: 'lamps', country: 'AE', website: null, teamSize: '1', channels: [], ...profile },
  });
  const row = async (q: string, id: string) => (await admin.query(q, [id])).rows;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    db = (await import('../../src/db/client.js')).createDb(DATABASE_URL!);
    ({ provisionAccount } = await import('../../src/db/accounts.js'));
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('THE ZONE AND THE CURRENCY sign-up chose are the workspace\'s from its first row', async () => {
    const r = await make('dubai', { zone: 'Asia/Dubai', currency: 'AED' });
    expect(r.code).toBe('created');
    const [b] = await row(`select timezone, currency from businesses where id = $1`, (r as { businessId: string }).businessId);
    expect(b).toEqual({ timezone: 'Asia/Dubai', currency: 'AED' });
  });

  it('a zone Postgres does not know is UTC; no currency is USD', async () => {
    const r = await make('nowhere', { zone: 'Mars/Olympus_Mons' });
    expect(r.code).toBe('created');
    const [b] = await row(`select timezone, currency from businesses where id = $1`, (r as { businessId: string }).businessId);
    expect(b).toEqual({ timezone: 'UTC', currency: 'USD' });
  });

  it('a currency outside the list makes NOTHING — not the business, not its owner, not the login', async () => {
    const r = await make('bad', { zone: 'Asia/Dubai', currency: 'XYZ' });
    expect(r.code).toBe('failed');
    expect((await admin.query(`select 1 from businesses where name = $1`, [`G2 bad ${RUN}`])).rowCount).toBe(0);
    expect((await admin.query(`select 1 from logins where email = $1`, [`g2-bad-${RUN}@shop.example`])).rowCount).toBe(0);
  });

  it('THE SEVEN CAPABILITIES, each in draft, and A BUDGET WITH A HARD CAP', async () => {
    const r = await make('rows', { zone: 'Asia/Dubai', currency: 'AED' });
    const id = (r as { businessId: string }).businessId;
    const caps = await row(`select capability, mode from autonomy_policy where business_id = $1 order by capability`, id);
    expect(caps.map((c) => c.capability)).toEqual(CAPABILITIES);
    expect(new Set(caps.map((c) => c.mode))).toEqual(new Set(['draft']));
    const [budget] = await row(`select daily_llm_calls, daily_tokens::int as daily_tokens, soft_warn_pct, on_exceeded from tenant_budgets where business_id = $1`, id);
    expect(budget).toEqual({ daily_llm_calls: 1000, daily_tokens: 1_000_000, soft_warn_pct: 80, on_exceeded: 'pause' });
  });
});
