import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AdsFetch } from '../../src/channels/meta/adSpend.js';

/**
 * 0238 — TWO READS AT ONCE ASK META ONCE. `readAdSpendFor` started twice at the same moment for one connection
 * used to ask Meta twice (both saw no read for the day, both wrote one): every extra call spends the account's rate
 * limit. Now the claim of the day's read is made under a lock per connection, so the second caller is told a read
 * is under way and asks nothing. The lock is never held while Meta is asked, and it is per connection: two
 * workspaces read at the same moment are each asked once and neither waits for the other.
 *
 * Through the real composition (the read, its tenant transactions, the database's own lock) against a Meta that
 * exists only in this file. Each round is a new UTC day of an injected clock.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const ONE = `dd562000-0000-4000-8000-${RUN}0001`;
const TWO = `dd562000-0000-4000-8000-${RUN}0002`;
const FAIL = `dd562000-0000-4000-8000-${RUN}0003`;
const KEY = Buffer.alloc(32, 7);
const ACCOUNT: Record<string, string> = { [ONE]: '700000001', [TWO]: '700000002', [FAIL]: '700000003' };
const DAY1 = new Date('2026-11-10T10:00:00Z');
const plusDays = (n: number) => new Date(DAY1.getTime() + n * 86_400_000);
/** How many rounds of "two at once" each race test makes: the race was lost on most single rounds, on one of five almost surely. */
const ROUNDS = 5;

const calls: string[] = [];
/** What Meta answers, per account; `hold` lets a test keep a call open until it says so. */
let answer: (account: string) => Promise<{ status: number; body: unknown }> = async () => ({ status: 500, body: {} });
const fakeMeta: AdsFetch = async (url) => {
  calls.push(url);
  const account = /act_(\d+)\//.exec(url)?.[1] ?? '';
  const a = await answer(account);
  return { status: a.status, headers: { get: () => null }, text: async () => JSON.stringify(a.body) };
};
const okPage = (account: string, day: string) => ({ status: 200, body: { data: [
  { account_id: account, account_currency: 'EUR', date_start: day, date_stop: day, publisher_platform: 'instagram', spend: '4.20' },
  { account_id: account, account_currency: 'EUR', date_start: day, date_stop: day, publisher_platform: 'facebook', spend: '1.05' },
] } });
const callsFor = (raw: string) => calls.filter((c) => c.includes(`act_${ACCOUNT[raw]}/`)).length;

const bidOf = async (raw: string) => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};

d('0238 · two reads at once ask Meta once (requires DATABASE_URL)', { timeout: 120_000 }, () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let read: typeof import('../../src/pipeline/adSpendRead.js');
  const deps = (now: Date) => ({ db, fetchImpl: fakeMeta, credentialKey: KEY, now: () => now });
  const q = async <T>(raw: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(raw), fn);
  };
  const readsOn = (raw: string, day: Date) => q(raw, (x) => sql<{ outcome: string | null }>`
    select outcome from ad_spend_reads where (started_at at time zone 'UTC')::date = (${day}::timestamptz at time zone 'UTC')::date order by started_at`
    .execute(x).then((r) => r.rows.map((w) => w.outcome)));
  const days = (raw: string) => q(raw, (x) => sql<{ day: string; platform: string; amount: string; revision: number }>`
    select to_char(day, 'YYYY-MM-DD') as day, platform, amount, revision from ad_spend_days order by day, platform`.execute(x).then((r) => r.rows));
  const at = async (raw: string, now: Date) => read.readAdSpendFor(deps(now), await bidOf(raw));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    read = await import('../../src/pipeline/adSpendRead.js');
    const { encryptSecret } = await import('../../src/security/credentials.js');
    for (const id of [ONE, TWO, FAIL]) {
      await q(id, (x) => sql`insert into businesses (id, name, owner_locale, kind, country, currency, timezone) values (${id}, ${`Ads Race ${id.slice(-4)}`}, 'en', 'brand', 'FR', 'EUR', 'Europe/Paris')`.execute(x));
      await q(id, (x) => sql`insert into ad_spend_connections (business_id, ad_account_id, ad_account_name, account_currency, timezone_name, token_ciphertext, token_fingerprint, connected_by)
        values (${id}, ${ACCOUNT[id]!}, 'Shop ads', 'EUR', 'UTC', ${encryptSecret(`tok-${RUN}`, KEY)}, 'fp', 'Owner')`.execute(x));
    }
  }, 60_000);
  afterAll(async () => {
    await admin?.query(`update ad_spend_connections set archived_at = now(), archived_by = 'test' where business_id = any($1::uuid[]) and archived_at is null`, [[ONE, TWO, FAIL]]);
    await db?.destroy(); await admin?.end();
  });
  beforeEach(() => { calls.length = 0; });

  it('TWO READS STARTED TOGETHER: Meta is asked once, one read is recorded, the other caller is told it is under way', async () => {
    const seen: { asked: number; outcomes: string[]; reads: (string | null)[] }[] = [];
    for (let n = 0; n < ROUNDS; n++) {
      const day = plusDays(n);
      const ymd = day.toISOString().slice(0, 10);
      calls.length = 0;
      answer = async (account) => okPage(account, ymd);
      const outcomes = await Promise.all([at(ONE, day), at(ONE, day)]);
      seen.push({ asked: callsFor(ONE), outcomes: [...outcomes].sort(), reads: await readsOn(ONE, day) });
      // Both callers are done: the rows are the one read's, each kept once.
      const today = (await days(ONE)).filter((r) => r.day === ymd);
      expect(today).toEqual([
        { day: ymd, platform: 'facebook', amount: '1.05', revision: 1 },
        { day: ymd, platform: 'instagram', amount: '4.20', revision: 1 },
      ]);
    }
    expect(seen).toEqual(Array.from({ length: ROUNDS }, () => ({ asked: 1, outcomes: ['ok', 'under_way'], reads: ['ok'] })));
  });

  it('A READ AFTER THE FIRST FINISHED behaves as before: the same day asks nothing, the next day asks again', async () => {
    const day = plusDays(ROUNDS);
    const ymd = day.toISOString().slice(0, 10);
    answer = async (account) => okPage(account, ymd);
    expect(await at(ONE, day)).toBe('ok');
    expect(await at(ONE, new Date(day.getTime() + 3_600_000))).toBe('skipped');
    expect(callsFor(ONE)).toBe(1);
    const next = plusDays(ROUNDS + 1);
    answer = async (account) => okPage(account, next.toISOString().slice(0, 10));
    expect(await at(ONE, next)).toBe('ok');
    expect(callsFor(ONE)).toBe(2);
    // A connection already read before asks the last 28 days, as the refresh rule says.
    const range = JSON.parse(new URL(calls[1]!).searchParams.get('time_range')!);
    expect(range.until).toBe(next.toISOString().slice(0, 10));
    expect(range.since).toBe(new Date(next.getTime() - 27 * 86_400_000).toISOString().slice(0, 10));
  });

  it('TWO WORKSPACES AT ONCE: each is asked once, and neither waits for the other (both calls are open together)', async () => {
    const day = plusDays(20);
    const ymd = day.toISOString().slice(0, 10);
    // Meta answers neither until it has been asked by both: a lock that held one workspace behind the other would
    // never let the second call arrive, and the read would fail on the timer below instead.
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => { release = r; });
    answer = async (account) => {
      arrived += 1;
      if (arrived === 2) release();
      const timer = new Promise<'late'>((r) => setTimeout(() => r('late'), 10_000));
      if ((await Promise.race([both.then(() => 'both' as const), timer])) === 'late') return { status: 500, body: { error: { message: 'one waited for the other' } } };
      return okPage(account, ymd);
    };
    const outcomes = await Promise.all([at(ONE, day), at(TWO, day)]);
    expect(outcomes).toEqual(['ok', 'ok']);
    expect(callsFor(ONE)).toBe(1);
    expect(callsFor(TWO)).toBe(1);
    expect(await readsOn(ONE, day)).toEqual(['ok']);
    expect(await readsOn(TWO, day)).toEqual(['ok']);
  });

  it('A READ WHOSE META CALL FAILS lets go of the lock: the twin is told, the next read asks again, nothing waits', async () => {
    const seen: { asked: number; outcomes: string[]; reads: (string | null)[] }[] = [];
    for (let n = 0; n < ROUNDS; n++) {
      const day = plusDays(30 + 2 * n);
      calls.length = 0;
      // Meta's call throws (the connection lost): the read fails and keeps nothing.
      answer = async () => { throw new Error('socket hang up'); };
      const outcomes = await Promise.all([at(FAIL, day), at(FAIL, day)]);
      seen.push({ asked: callsFor(FAIL), outcomes: [...outcomes].sort(), reads: await readsOn(FAIL, day) });
      const askedTogether = callsFor(FAIL);
      // The same day: no retry loop (the refresh rule), and no wait either — the lock is not held.
      expect(await at(FAIL, new Date(day.getTime() + 60_000))).toBe('skipped');
      expect(callsFor(FAIL)).toBe(askedTogether);
      // The next read, the next day, asks again and keeps what Meta says.
      const next = plusDays(30 + 2 * n + 1);
      answer = async (account) => okPage(account, next.toISOString().slice(0, 10));
      expect(await at(FAIL, next)).toBe('ok');
      expect(callsFor(FAIL)).toBe(askedTogether + 1);
    }
    expect(seen).toEqual(Array.from({ length: ROUNDS }, () => ({ asked: 1, outcomes: ['failed', 'under_way'], reads: ['failed'] })));
  });
});
