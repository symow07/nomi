import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * tools/erase-workspace.mjs, run for real (2026-09-27).
 *
 * Until now nothing executed it: a parity test read its source. Building the
 * buyer-level eraser found two places a workspace's rows live that this tool
 * never looked at — `shadow.turn_decisions` (outside `public`, no foreign key)
 * and pg-boss's queued jobs (an inbound job carries a buyer's own words). This
 * erases a seeded workspace and proves NOTHING of it is left anywhere, while a
 * second workspace is untouched; and that the tool refuses a role that row
 * security filters and a job a worker is holding.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const W1 = `dd7e0000-0000-4000-8000-${RUN}0001`;   // the workspace that asked to go
const W2 = `dd7e0000-0000-4000-8000-${RUN}0002`;   // a neighbour that did not
const NAME = `Erase Me ${RUN}`;

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], url = ADMIN): Run => {
  const r = spawnSync(process.execPath, ['tools/erase-workspace.mjs', ...args], {
    cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('erase-workspace: nothing of a workspace is left anywhere (requires DATABASE_URL and MIGRATE_DATABASE_URL)', () => {
  let db: import('pg').Client;
  const jobs: Record<string, string> = {};

  /** Every row carrying this business, in every schema we write to. */
  const footprint = async (biz: string): Promise<Record<string, number>> => {
    const tables = (await db.query(`
      select n.nspname as s, c.relname as t
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join information_schema.columns k on k.table_schema = n.nspname and k.table_name = c.relname and k.column_name = 'business_id'
       where c.relkind = 'r' and n.nspname in ('public', 'shadow')`)).rows as { s: string; t: string }[];
    const out: Record<string, number> = {};
    for (const { s, t } of tables) {
      const n = (await db.query(`select count(*)::int as n from ${s}.${t} where business_id = $1`, [biz])).rows[0].n as number;
      if (n) out[`${s}.${t}`] = n;
    }
    const b = (await db.query('select count(*)::int as n from businesses where id = $1', [biz])).rows[0].n as number;
    if (b) out['businesses'] = b;
    const j = (await db.query(`select count(*)::int as n from pgboss.job where data->>'businessId' = $1`, [biz])).rows[0].n as number;
    if (j) out['pgboss.job'] = j;
    return out;
  };

  beforeAll(async () => {
    const pg = (await import('pg')).default;
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    for (const [biz, name] of [[W1, NAME], [W2, `Keep Me ${RUN}`]] as const) {
      await db.query(`insert into businesses (id, name) values ($1, $2)`, [biz, name]);
      const client = (await db.query(`insert into clients (business_id, display_name) values ($1, 'A Buyer') returning id`, [biz])).rows[0].id;
      await db.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'whatsapp', $2)`, [client, `9715${RUN.replace(/\D/g, '7').padEnd(7, '7').slice(0, 7)}${biz.slice(-1)}`]);
      const conv = (await db.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id`, [biz, client])).rows[0].id;
      await db.query(`insert into messages (conversation_id, direction, input_type, text_content, sent_at) values ($1, 'inbound', 'text', 'hello', now())`, [conv]);
      await db.query(`insert into drafts (business_id, conversation_id, capability, draft_text, status) values ($1, $2, 'quote', 'a draft', 'pending')`, [biz, conv]);
      await db.query(`insert into shadow.turn_decisions (message_id, conversation_id, business_id, svc_decision) values ($1, $2, $3, '{"reply":"hello"}'::jsonb)`, [`shadow-${biz}`, conv, biz]);
    }
    await db.query(`insert into deletion_requests (business_id, scope, asked_by) values ($1, 'workspace', 'owner')`, [W1]);

    // Queued work through the production queue, as tools/erase-buyer's test does.
    const { startBoss, QUEUES } = await import('../../src/queue/boss.js');
    const boss = await startBoss(DATABASE_URL!);
    try {
      jobs['w1'] = (await boss.send(QUEUES.inbound, { businessId: W1, conversationId: randomUUID(), messageId: 'm', text: 'a buyer said this' }, { startAfter: 3600 }))!;
      jobs['w2'] = (await boss.send(QUEUES.inbound, { businessId: W2, conversationId: randomUUID(), messageId: 'm', text: 'keep this' }, { startAfter: 3600 }))!;
    } finally {
      await boss.stop();
    }
  }, 120_000);

  afterAll(async () => {
    await db?.query(`delete from pgboss.job where data->>'businessId' = any($1::text[])`, [[W1, W2]]).catch(() => {});
    await db?.end();
  });

  it('refuses a role that row security filters, and changes nothing', async () => {
    const before = await footprint(W1);
    const r = tool(['--business', W1, '--confirm', NAME, '--yes'], DATABASE_URL);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/row-level security/);
    expect(await footprint(W1)).toEqual(before);
  });

  it('the dry run names the rows outside public — the shadow decisions and the queued jobs — and changes nothing', async () => {
    const before = await footprint(W1);
    expect(before['shadow.turn_decisions']).toBe(1);
    expect(before['pgboss.job']).toBe(1);
    const r = tool(['--business', W1]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/shadow\.turn_decisions/);
    expect(r.out).toMatch(/pgboss\.job/);
    expect(r.out).toMatch(/Dry run\. Nothing was deleted\./);
    expect(await footprint(W1)).toEqual(before);
  });

  it('refuses while a worker holds one of its jobs', async () => {
    await db.query(`update pgboss.job set state = 'active', started_on = now() where id = $1`, [jobs['w1']]);
    try {
      const before = await footprint(W1);
      const r = tool(['--business', W1, '--confirm', NAME, '--yes']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/running 1 job/);
      expect(await footprint(W1)).toEqual(before);
    } finally {
      await db.query(`update pgboss.job set state = 'created', started_on = null where id = $1`, [jobs['w1']]);
    }
  });

  it('erases the workspace: nothing of it is left in any table, shadow decision or queued job — the neighbour untouched', async () => {
    const neighbour = await footprint(W2);
    expect(Object.keys(neighbour).length).toBeGreaterThan(4);
    const r = tool(['--business', W1, '--confirm', NAME, '--yes']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/erased/);
    expect(await footprint(W1)).toEqual({});
    expect(await footprint(W2)).toEqual(neighbour);
  });
});
