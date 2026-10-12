import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D14 (the data-protection audit, 2026-10-12; 0143) — A CUSTOMER'S ERASURE
 * REACHES EVERY QUEUED JOB THAT NAMES THEM.
 *
 * An owner answered a customer from the business's own Instagram app: the job
 * that records it (EchoJob) names the customer's account and the reply's text,
 * and no conversation, so the erasure, which took jobs by conversation, left it
 * for the queue's week. Through the production queue and the operator's tool:
 * their finished echo job goes, another customer's stays, and the tool's plan
 * and the database agree on the count.
 */

const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const DATABASE_URL = process.env['DATABASE_URL'];
const d = ADMIN && DATABASE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BIZ = `d1400000-0000-4000-8000-${RUN}0001`;
const IG = `ig-${RUN}`;
const OTHER_IG = `ig-other-${RUN}`;

d('D14 · the erasure takes the jobs that name them (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  let req = '';
  const job = { theirs: '', others: '' };
  const one = async (q: string, p: unknown[]) => (await db.query(q, p)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `Queue Jobs ${RUN}`]);
    const client = (await one(`insert into clients (business_id, display_name) values ($1, $2) returning id::text as id`, [BIZ, `Mona ${RUN}`])).id;
    await db.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'instagram', $2)`, [client, IG]);
    const conv = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, client])).id;
    await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'hi', now())`, [conv]);
    req = (await one(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`, [BIZ, client])).id;

    const { startBoss, QUEUES } = await import('../../src/queue/boss.js');
    const boss = await startBoss(DATABASE_URL!);
    try {
      const echo = (customer: string, text: string) => ({
        businessId: BIZ, channel: 'instagram', mid: `mid-${randomUUID()}`, customer, account: `page-${RUN}`,
        text, received: new Date().toISOString(), appId: null, occurredAt: new Date().toISOString(),
      });
      const later = { startAfter: 3600 };
      job.theirs = (await boss.send(QUEUES.echo, echo(IG, `owner-reply-${RUN}`), later))!;
      job.others = (await boss.send(QUEUES.echo, echo(OTHER_IG, `other-reply-${RUN}`), later))!;
    } finally {
      await boss.stop();
    }
    // Finished, as pg-boss keeps it for a week.
    await db.query(`update pgboss.job set state = 'completed', completed_on = now() where id = any($1::uuid[])`, [[job.theirs, job.others]]);
  }, 120_000);

  afterAll(async () => {
    await db?.query(`delete from pgboss.job where data->>'businessId' = $1`, [BIZ]).catch(() => {});
    await db?.end();
  });

  const there = async (id: string) => (await db.query('select 1 from pgboss.job where id = $1', [id])).rowCount === 1;

  it('their echo job goes with them, another customer\'s stays, and the tool and the database agree', async () => {
    const dry = spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/\b1 {2}pgboss\.job\b/);

    const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, '--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test'],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(await there(job.theirs)).toBe(false);
    expect(await there(job.others)).toBe(true);
    const ledger = await one('select counts from erasure_ledger where request_id = $1', [req]);
    expect(ledger.counts.erased['pgboss.job']).toBe(1);
  });
});
