import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * KS5 (0113) — THE SPEND BREAKER, OVER POSTGRES. Past the installation's
 * ceiling a workspace that signed itself up is held (G3's one reader says so)
 * and a workspace the operator made is not; a practice copy answers as its
 * workspace; the operator's alert is claimed once a day. The ceiling is the
 * installation's own row: this file sets it low and puts it back.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('KS5 · the spend breaker (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let SELF = '';
  const OP = randomUUID();
  let before: { daily_tokens: string; daily_calls: number } | null = null;
  const q = (text: string, args: unknown[] = []) => admin.query(text, args);
  const allowanceAs = async (business: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { allowanceOf } = await import('../../src/db/allowance.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, (tx) => allowanceOf(tx));
  };
  const today = async () => (await q(`select tokens::bigint as t, calls::bigint as c from installation_usage_today()`)).rows[0] as { t: string; c: string };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    db = (await import('../../src/db/client.js')).createDb(DATABASE_URL!);
    before = (await q(`select daily_tokens::text, daily_calls from installation_limits where id`)).rows[0] ?? null;
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `KS5 Beta ${RUN}`, language: 'en', ownerName: 'Ola', email: `ks5-${RUN}@beta.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'brand', sells: 'soap', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    SELF = made.businessId;
    await q(`insert into businesses (id, name) values ($1, $2)`, [OP, `KS5 pilot ${RUN}`]);
    // Something used today, so a ceiling at today's total is passed.
    await q(`insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens)
             values ($1, (now() at time zone 'UTC')::date, 1, 10, 10)
             on conflict (business_id, day) do update set llm_calls = usage_ledger.llm_calls + 1`, [OP]);
  }, 60_000);
  afterAll(async () => {
    if (before) await q(`update installation_limits set daily_tokens = $1::bigint, daily_calls = $2 where id`, [before.daily_tokens, before.daily_calls]);
    await admin?.end(); await db?.destroy();
  });

  it('BELOW THE CEILING nobody is held', async () => {
    await q(`update installation_limits set daily_tokens = 9000000000000, daily_calls = 2000000000 where id`);
    const { allowanceUsed } = await import('../../src/db/allowance.js');
    expect(allowanceUsed(await allowanceAs(SELF))).toBe(false);
  });

  it('PAST IT: the beta is held, the pilot is not, a practice copy as its workspace', async () => {
    const t = await today();
    await q(`update installation_limits set daily_tokens = $1::bigint where id`, [String(Math.max(1, Number(t.t)))]);
    const { allowanceUsed } = await import('../../src/db/allowance.js');
    const self = await allowanceAs(SELF);
    expect(self.breaker).toBe(true);
    expect(allowanceUsed(self)).toBe(true);
    expect(allowanceUsed(await allowanceAs(OP))).toBe(false);
    const COPY = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `KS5 practice ${RUN}`, SELF]);
    expect((await allowanceAs(COPY)).breaker).toBe(true);
    // A pilot the operator opened by hand is not the beta.
    await q(`update businesses set auto_earned_by = 'operator', auto_earned_at = now() where id = $1`, [SELF]);
    expect((await allowanceAs(SELF)).breaker ?? false).toBe(false);
    // A stamp with no writer (before 0103) is the operator's, as in 0106.
    await q(`update businesses set auto_earned_by = null where id = $1`, [SELF]);
    expect((await allowanceAs(SELF)).breaker ?? false).toBe(false);
    // A rung the ramp gave is still the beta.
    await q(`update businesses set auto_earned_by = 'ramp' where id = $1`, [SELF]);
    expect((await allowanceAs(SELF)).breaker).toBe(true);
    await q(`update businesses set auto_earned_by = null, auto_earned_at = null where id = $1`, [SELF]);
  });

  it('THE OPERATOR IS TOLD once a day: the claim answers once, then nothing', async () => {
    await q(`delete from spend_breaker_alerts where day = (now() at time zone 'UTC')::date`);
    const { spendBreakerAlert } = await import('../../src/pipeline/allowanceWatch.js');
    const first = await spendBreakerAlert(db, OP);
    expect(first).toMatchObject({ kind: 'spend_breaker', businessId: OP });
    expect(first!.spend!.tokens).toBeGreaterThanOrEqual(first!.spend!.maxTokens);
    expect(await spendBreakerAlert(db, OP)).toBeNull();
  });

  it('THE OPERATOR\'S TOOL reads and sets the ceiling', async () => {
    // @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
    const { readSpendCeiling, setSpendCeiling } = await import('../../tools/lib/operator.mjs');
    expect(await setSpendCeiling(admin, { tokens: 123456789, calls: 4321, by: `ks5 ${RUN}` })).toBe('set');
    const r = await readSpendCeiling(admin);
    expect([r.maxTokens, r.maxCalls]).toEqual([123456789, 4321]);
    expect((await q(`select set_by from installation_limits where id`)).rows[0].set_by).toBe(`ks5 ${RUN}`);
  });
});
