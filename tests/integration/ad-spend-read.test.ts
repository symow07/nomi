import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AdsFetch } from '../../src/channels/meta/adSpend.js';

/**
 * 0238 — the daily read, against a Meta that exists only in this file (pages built from the shapes on Meta's saved
 * Insights pages) and an injected clock. What it proves: switched off, nothing is asked; a read keeps Meta's strings
 * exactly, one row per day and placement; a re-read revises in place with its history and never counts twice; the
 * same day is never read twice (no retry loop); a cap reached, an unknown error, a refused token, a throttle — each
 * keeps nothing and is recorded; a refused token stops every read; a switched-off or suspended workspace is skipped.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd561000-0000-4000-8000-${RUN}0001`;
const OFF = `dd561000-0000-4000-8000-${RUN}0002`;
const HELD = `dd561000-0000-4000-8000-${RUN}0003`;
const KEY = Buffer.alloc(32, 9);
const ACCOUNT = '111222333';
const DAY1 = new Date('2026-11-10T10:00:00Z');
const plusDays = (n: number) => new Date(DAY1.getTime() + n * 86_400_000);

type Answer = { status: number; body: unknown; headers?: Record<string, string> };
let script: (url: URL, n: number) => Answer = () => ({ status: 500, body: {} });
const calls: string[] = [];
const fakeMeta: AdsFetch = async (url) => {
  calls.push(url);
  const a = script(new URL(url), calls.length);
  const h = new Map(Object.entries(a.headers ?? {}));
  return { status: a.status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, text: async () => JSON.stringify(a.body) };
};
const row = (day: string, platform: string, spend: string) => ({ account_id: ACCOUNT, account_currency: 'EUR', date_start: day, date_stop: day, publisher_platform: platform, spend });
const USAGE = {
  'x-business-use-case-usage': JSON.stringify({ '42': [{ type: 'ads_insights', call_count: 3, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: 0 }] }),
  'x-ad-account-usage': JSON.stringify({ acc_id_util_pct: 2.5, reset_time_duration: 0 }),
  'x-fb-ads-insights-throttle': JSON.stringify({ app_id_util_pct: 1, acc_id_util_pct: 2 }),
};

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};

d('0238 · the daily ad spend read (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let read: typeof import('../../src/pipeline/adSpendRead.js');
  const deps = (now: Date, on = true) => ({ db, fetchImpl: on ? fakeMeta : null, credentialKey: KEY, now: () => now });
  const parse = (raw: string) => (/^[0-9a-f-]{36}$/.test(raw) ? raw as never : null);
  const q = async <T>(raw: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(raw), fn);
  };
  const days = () => q(BIZ, (x) => sql<{ day: string; platform: string; amount: string; amount_num: string; revision: number }>`
    select to_char(day, 'YYYY-MM-DD') as day, platform, amount, amount_num::text as amount_num, revision from ad_spend_days order by day, platform`.execute(x).then((r) => r.rows));
  const reads = () => q(BIZ, (x) => sql<{ outcome: string; since: string; until: string; pages: number; rows_read: number; error_code: number | null; usage: unknown }>`
    select outcome, to_char(since, 'YYYY-MM-DD') as since, to_char(until, 'YYYY-MM-DD') as until, pages, rows_read, error_code, usage from ad_spend_reads order by started_at`.execute(x).then((r) => r.rows));
  const conn = (raw = BIZ) => q(raw, (x) => sql<{ state: string; retry_after: Date | null }>`select state, retry_after from ad_spend_connections where archived_at is null`.execute(x).then((r) => r.rows[0]!));
  /** One read of this file's workspace, as the daily job would make it. */
  const once = async (now: Date) => read.readAdSpendFor(deps(now), await bidOf(BIZ));
  const listed = async () => (await sql<{ business_id: string }>`select business_id::text as business_id from ad_spend_workspaces()`.execute(db)).rows.map((r) => r.business_id);
  const connectFixture = async (raw: string) => {
    const { encryptSecret } = await import('../../src/security/credentials.js');
    await q(raw, (x) => sql`insert into ad_spend_connections (business_id, ad_account_id, ad_account_name, account_currency, timezone_name, token_ciphertext, token_fingerprint, connected_by)
      values (${raw}, ${ACCOUNT}, 'Shop ads', 'EUR', 'Europe/Paris', ${encryptSecret(`tok-${RUN}`, KEY)}, 'fp', 'Owner')`.execute(x));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    read = await import('../../src/pipeline/adSpendRead.js');
    for (const id of [BIZ, OFF, HELD]) {
      await q(id, (x) => sql`insert into businesses (id, name, owner_locale, kind, country, currency, timezone) values (${id}, ${`Ads Read ${id.slice(-4)}`}, 'en', 'brand', 'FR', 'EUR', 'Europe/Paris')`.execute(x));
      await connectFixture(id);
    }
    // One switched off, one suspended: the daily list never names them.
    await admin.query(`update businesses set is_active = false where id = $1`, [OFF]);
    await admin.query(`insert into workspace_suspensions (business_id, reason, suspended_by, was_active) values ($1, 'test', 'operator', true)`, [HELD]);
  }, 60_000);
  afterAll(async () => {
    await admin?.query(`update ad_spend_connections set archived_at = now(), archived_by = 'test' where business_id = any($1::uuid[]) and archived_at is null`, [[BIZ, OFF, HELD]]);
    await admin?.query(`update workspace_suspensions set restored_at = now(), restored_by = 'test' where business_id = $1 and restored_at is null`, [HELD]);
    await db?.destroy(); await admin?.end();
  });
  beforeEach(() => { calls.length = 0; });

  it('SWITCHED OFF (no ads login): no read, no call, nothing written', async () => {
    expect(await read.readAdSpendFor(deps(DAY1, false), await bidOf(BIZ))).toBe('off');
    expect(await read.readAllAdSpend(deps(DAY1, false), parse)).toEqual({});
    expect(calls).toHaveLength(0);
    expect(await reads()).toEqual([]);
  });

  it('a switched-off or suspended workspace is never listed, and a direct call is refused too', async () => {
    const names = await listed();
    expect(names).toContain(BIZ);
    expect(names).not.toContain(OFF);
    expect(names).not.toContain(HELD);
    expect(await read.readAdSpendFor(deps(DAY1), await bidOf(OFF))).toBe('skipped');
    expect(await read.readAdSpendFor(deps(DAY1), await bidOf(HELD))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('THE FIRST READ: from the first of last month, every page, Meta\'s strings kept exactly, the headers logged', async () => {
    script = (u, n) => {
      expect(u.pathname).toBe(`/v27.0/act_${ACCOUNT}/insights`);
      return n === 1
        ? { status: 200, headers: USAGE, body: { data: [row('2026-10-30', 'instagram', '12.34'), row('2026-10-30', 'facebook', '0.10')], paging: { next: `https://graph.facebook.com/v27.0/act_${ACCOUNT}/insights?after=p2&access_token=x` } } }
        : { status: 200, headers: USAGE, body: { data: [row('2026-10-31', 'instagram', '1000000.01'), row('2026-11-01', 'zz_invented_place', '7.77')] } };
    };
    // Through the daily job itself: this workspace is among those it reads.
    const tally = await read.readAllAdSpend(deps(DAY1), parse);
    expect(tally['ok']).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.includes(`act_${ACCOUNT}`))).toHaveLength(2);
    const first = new URL(calls[0]!);
    expect(JSON.parse(first.searchParams.get('time_range')!)).toEqual({ since: '2026-10-01', until: '2026-11-10' });
    expect(await days()).toEqual([
      { day: '2026-10-30', platform: 'facebook', amount: '0.10', amount_num: '0.10', revision: 1 },
      { day: '2026-10-30', platform: 'instagram', amount: '12.34', amount_num: '12.34', revision: 1 },
      { day: '2026-10-31', platform: 'instagram', amount: '1000000.01', amount_num: '1000000.01', revision: 1 },
      { day: '2026-11-01', platform: 'zz_invented_place', amount: '7.77', amount_num: '7.77', revision: 1 },
    ]);
    const r = (await reads())[0]!;
    expect(r).toMatchObject({ outcome: 'ok', pages: 2, rows_read: 4, error_code: null });
    expect(Object.keys((r.usage as Record<string, unknown>[])[0]!).sort()).toEqual(['x-ad-account-usage', 'x-business-use-case-usage', 'x-fb-ads-insights-throttle']);
    expect(JSON.stringify(r.usage)).not.toContain(`tok-${RUN}`);
  });

  it('THE SAME DAY AGAIN (a queue retry, a second run): skipped, Meta not asked', async () => {
    expect(await once(new Date(DAY1.getTime() + 3_600_000))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('A RE-READ revises in place: one row per day and placement, the old value kept, never counted twice', async () => {
    script = () => ({ status: 200, headers: USAGE, body: { data: [
      row('2026-10-30', 'instagram', '12.40'), row('2026-10-30', 'facebook', '0.10'), row('2026-10-31', 'instagram', '1000000.01'),
      row('2026-11-01', 'zz_invented_place', '7.77'), row('2026-11-10', 'messenger', '5'),
    ] } });
    expect(await once(plusDays(1))).toBe('ok');
    expect(JSON.parse(new URL(calls[0]!).searchParams.get('time_range')!)).toEqual({ since: '2026-10-15', until: '2026-11-11' });
    const rows = await days();
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.platform === 'instagram' && r.day === '2026-10-30')).toMatchObject({ amount: '12.40', revision: 2 });
    expect(rows.find((r) => r.platform === 'facebook')).toMatchObject({ amount: '0.10', revision: 1 });
    const hist = await q(BIZ, (x) => sql<{ amount: string; revision: number }>`select amount, revision from ad_spend_day_history`.execute(x).then((r) => r.rows));
    expect(hist).toEqual([{ amount: '12.34', revision: 1 }]);
    const october = await q(BIZ, (x) => sql<{ s: string }>`select sum(amount_num)::text as s from ad_spend_days where platform = 'instagram' and day between '2026-10-01' and '2026-10-31'`.execute(x).then((r) => r.rows[0]!.s));
    expect(october).toBe('1000012.41');
  });

  it('THE PAGE CAP: the read stops, keeps nothing, is recorded incomplete, and is tried again the next day', async () => {
    const before = await days();
    script = (_u, n) => ({ status: 200, body: { data: [row('2026-11-11', `place_${n}`, String(n))], ...(n < 30 ? { paging: { next: `https://graph.facebook.com/v27.0/act_${ACCOUNT}/insights?after=p${n + 1}` } } : {}) } });
    expect(await once(plusDays(2))).toBe('incomplete');                       // 31 pages that end: only the cap stops it at 20
    expect(calls).toHaveLength(20);
    expect(await days()).toEqual(before);
    expect((await reads()).at(-1)).toMatchObject({ outcome: 'incomplete', pages: 20, rows_read: 0 });
    expect((await conn()).state).toBe('active');
  });

  it('AN ERROR CODE NOBODY KNOWS: failed, nothing kept, no retry loop', async () => {
    const before = await days();
    script = () => ({ status: 400, body: { error: { code: 80000, error_subcode: 2446079, message: 'something new' } } });
    expect(await once(plusDays(3))).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(await once(plusDays(3))).toBe('skipped');
    expect(calls).toHaveLength(1);
    expect(await days()).toEqual(before);
    expect((await reads()).at(-1)).toMatchObject({ outcome: 'failed', error_code: 80000 });
  });

  it('A THROTTLE: nothing kept, the connection waits as long as Meta says (an hour at least)', async () => {
    script = () => ({ status: 400, body: { error: { code: 4, error_subcode: 1504022, message: 'Too many API requests' } } });
    expect(await once(plusDays(4))).toBe('throttled');
    const c = await conn();
    expect(c.state).toBe('active');
    expect(c.retry_after!.getTime()).toBeGreaterThanOrEqual(plusDays(4).getTime() + 3_600_000 - 1000);
    await admin.query(`update ad_spend_connections set retry_after = now() + interval '1 hour' where business_id = $1 and archived_at is null`, [BIZ]);
    expect(await listed()).not.toContain(BIZ);
    await admin.query(`update ad_spend_connections set retry_after = null where business_id = $1 and archived_at is null`, [BIZ]);
  });

  it('190, WHATEVER THE SUBCODE: refused, kept on the connection, and no read is made after it', async () => {
    script = () => ({ status: 400, body: { error: { code: 190, error_subcode: 123456, message: 'Error validating access token' } } });
    expect(await once(plusDays(5))).toBe('refused');
    expect((await conn()).state).toBe('refused');
    expect(await listed()).not.toContain(BIZ);
    await read.readAllAdSpend(deps(plusDays(6)), parse);
    expect(await once(plusDays(7))).toBe('skipped');
    expect(calls).toHaveLength(1);
  });
});
