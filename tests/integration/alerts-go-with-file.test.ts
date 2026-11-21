import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { alertClock, dropAlertsLeftSince } from './alerts-go-with-file.js';

/**
 * The alerts a file leaves waiting go with it (alerts-go-with-file.ts says why: boot.test.ts › P3, 2026-11-21).
 *
 * Each kind of job the clean-up meets, made here on purpose: only an owner alert queued in the file's time and still
 * waiting goes; one being sent, one already done, one from before, and a job of another queue all stay.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

it('every file runs the clean-up: the setup is in the config', () => {
  const config = readFileSync(new URL('../../vitest.config.ts', import.meta.url), 'utf8');
  expect(config).toContain("'./tests/integration/alerts-go-with-file.setup.ts'");
});

d('the alerts a file leaves waiting go with it (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let boss: PgBoss;
  const made: string[] = [];
  const BIZ = randomUUID();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { startBoss } = await import('../../src/queue/boss.js');
    boss = await startBoss(DATABASE_URL!);   // no worker: nothing here runs a job
  }, 30_000);

  afterAll(async () => {
    if (made.length > 0) await admin?.query(`delete from pgboss.job where id = any($1::uuid[])`, [made]).catch(() => {});
    await boss?.stop({ graceful: false }).catch(() => {});
    await admin?.end();
  });

  const queue = async (name: string, set: string | null): Promise<string> => {
    const id = (await boss.send(name, { businessId: BIZ, kind: 'handoff', conversationId: null }))!;
    made.push(id);
    if (set) await admin.query(`update pgboss.job set ${set} where id = $1::uuid`, [id]);
    return id;
  };
  const left = async (): Promise<string[]> => (await admin.query<{ id: string }>(
    `select id::text as id from pgboss.job where id = any($1::uuid[])`, [made])).rows.map((r) => r.id);

  it('created and retrying alerts of the file go, by kind; the rest stay', async () => {
    const since = await alertClock(admin);
    const before = await queue('notify.team', `created_on = '${since}'::timestamptz - interval '1 hour'`);
    const waiting = await queue('notify.team', null);
    const retrying = await queue('notify.team', `state = 'retry'`);
    const retryingLater = await queue('notify.team', `state = 'retry', start_after = now() + interval '1 hour'`);
    const sending = await queue('notify.team', `state = 'active', started_on = now()`);
    const done = await queue('notify.team', `state = 'completed', started_on = now(), completed_on = now()`);
    const otherQueue = await queue('notify.team.dead', null);

    const gone = await dropAlertsLeftSince(admin, since);

    expect(gone['handoff']).toBe(3);
    const still = await left();
    for (const id of [waiting, retrying, retryingLater]) expect(still).not.toContain(id);
    for (const id of [before, sending, done, otherQueue]) expect(still).toContain(id);
  }, 30_000);
});
