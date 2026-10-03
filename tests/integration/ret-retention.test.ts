import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * RET (0116) IS RETIRED (0126), over Postgres: nothing in the database can
 * list, warn or erase a workspace for having connected nothing in 90 days.
 *
 *   · the functions the warning job and the operator's tool read are gone;
 *   · the `retention` switch cannot be set — not by the tool, not by SQL;
 *   · a schedule an older instance wrote back is taken out at boot
 *     (`unscheduleRetired`, the call src/main.ts makes);
 *   · a workspace that never connected anything, 100 days old, is still there
 *     and nothing about it is due.
 * Switched off: re-create the old function, or drop the constraint, and the
 * matching test fails.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('RET · retired (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let old = '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    old = (await admin.query(`insert into businesses (name, signed_up_at) values ($1, now() - interval '100 days') returning id::text as id`,
      [`RET retired ${RUN}`])).rows[0].id;
  }, 60_000);
  afterAll(async () => { await admin?.end(); });

  it('the functions that listed and claimed the 90-day warnings do not exist', async () => {
    const r = (await admin.query(`select to_regprocedure('retention_workspaces()') as a, to_regprocedure('claim_retention_warnings()') as b`)).rows[0];
    expect(r).toEqual({ a: null, b: null });
  });

  it('the switch cannot be set: the tool\'s library refuses, and so does the database itself', async () => {
    await expect(op.setOperatorFlag(admin, { flag: 'retention', businessId: null, reason: 'x', by: 'test' })).rejects.toThrow(/retired/);
    await expect(admin.query(`insert into ops_flags (flag, reason, set_by) values ('retention', 'x', 'test')`))
      .rejects.toThrow(/ops_flags_retention_retired/);
    expect((await admin.query(`select count(*)::int as n from ops_flags where flag = 'retention' and cleared_at is null`)).rows[0].n).toBe(0);
  });

  it('a schedule an older instance wrote back is taken out at boot', async () => {
    const { startBoss, unscheduleRetired, RETIRED_QUEUES } = await import('../../src/queue/boss.js');
    const boss = await startBoss(DATABASE_URL!);
    try {
      await boss.createQueue(RETIRED_QUEUES.retention, {});
      await boss.schedule(RETIRED_QUEUES.retention, '50 6 * * *', {});
      const before = (await boss.getSchedules()).filter((s: { name: string }) => s.name === RETIRED_QUEUES.retention);
      expect(before.length).toBe(1);
      await unscheduleRetired(boss);
      const after = (await boss.getSchedules()).filter((s: { name: string }) => s.name === RETIRED_QUEUES.retention);
      expect(after).toEqual([]);
    } finally {
      await boss.stop();
    }
  }, 60_000);

  it('a workspace that never connected anything, 100 days on, is simply still there', async () => {
    expect((await admin.query(`select 1 from businesses where id = $1`, [old])).rowCount).toBe(1);
    expect((await admin.query(`select count(*)::int as n from erasure_ledger where business_id = $1`, [old])).rows[0].n).toBe(0);
  });
});
