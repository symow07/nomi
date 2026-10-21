import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D4 (the owner's decision, 2026-10-12; 0147) — A DELETION REQUEST NOBODY
 * ANSWERS IS CHASED, AND NEVER CARRIED OUT BY NOMI. Against real Postgres:
 * `claim_deletion_chases()` returns each waiting request at the furthest step
 * due, once, and records it; a request recorded from a noted message carries
 * the message's chases; an answered request is never chased; the app role may
 * read its own workspace's record and nothing else, and write none of it; and
 * nothing the customer gave is touched. Today's count (`readAttention`) flags
 * both kinds from day 60. The words and the wiring: tests/parity/deletion-chase.test.ts.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `d4c00000-0000-4000-8000-${RUN}0001`;
const OTHER = `d4c00000-0000-4000-8000-${RUN}0002`;

type Chase = { subject: string; subject_id: string; step: string; conversation_id: string | null };

d('D4 · a deletion request nobody answers is chased (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  const id: Record<string, string> = {};
  const conv: Record<string, string> = {};

  /** One customer with a conversation and one message, `key` naming both. */
  const customer = async (biz: string, key: string) => {
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, $2) returning id::text as id`,
      [biz, `${key} ${RUN}`])).rows[0].id as string;
    const c = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`,
      [biz, client])).rows[0].id as string;
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now())`,
      [c, `${key} ${RUN}: please delete my data`]);
    conv[key] = c;
    return { client, conv: c };
  };
  const noted = async (biz: string, key: string, days: number) => {
    const c = await customer(biz, key);
    id[key] = (await admin.query(`insert into deletion_asks (business_id, client_id, conversation_id, asked_at)
      values ($1, $2, $3, now() - make_interval(days => $4)) returning id::text as id`, [biz, c.client, c.conv, days])).rows[0].id;
    return c;
  };
  const recorded = async (biz: string, key: string, days: number, state = 'open') => {
    const c = await customer(biz, key);
    id[key] = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by, asked_at, state, closed_at, closed_by)
      values ($1, 'buyer', $2, 'owner', now() - make_interval(days => $3), $4, case when $4 = 'open' then null else now() end,
              case when $4 = 'open' then null else 'owner' end) returning id::text as id`, [biz, c.client, days, state])).rows[0].id;
    return c;
  };
  /** Claimed by the app role, as the daily job does; only this run's workspaces. */
  const claim = async (): Promise<Chase[]> => (await app.query<Chase>(
    `select subject, subject_id::text as subject_id, step, conversation_id::text as conversation_id
       from claim_deletion_chases() where business_id in ($1, $2) order by subject, step`, [BIZ, OTHER])).rows;
  const stepOf = (rows: Chase[], key: string) => rows.filter((r) => r.subject_id === id[key]).map((r) => r.step);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    app = new pg.Client({ connectionString: DATABASE_URL });
    await app.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2), ($3, $4) on conflict (id) do nothing`,
      [BIZ, `Chased ${RUN}`, OTHER, `Other ${RUN}`]);
    await noted(BIZ, 'fresh', 2);        // not yet a week: nothing
    await noted(BIZ, 'week', 8);         // the first reminder
    await noted(BIZ, 'late', 45);        // first seen at 45 days: the 30-day reminder only, not two
    await noted(BIZ, 'long', 61);        // the flag
    await recorded(BIZ, 'open', 31);     // recorded, not carried out: chased like a noted one
    await recorded(BIZ, 'done', 90, 'done');          // answered: never chased
    await recorded(BIZ, 'withdrawn', 90, 'withdrawn'); // answered: never chased
    // A noted request reminded at 7 days, then recorded by the owner: the record is
    // the same request — the message's chase counts, so it is not reminded again.
    const c = await customer(BIZ, 'carried');
    id['carried'] = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by, asked_at)
      values ($1, 'buyer', $2, 'owner', now() - interval '10 days') returning id::text as id`, [BIZ, c.client])).rows[0].id;
    id['carried.ask'] = (await admin.query(`insert into deletion_asks (business_id, client_id, conversation_id, asked_at, state, request_id, decided_at)
      values ($1, $2, $3, now() - interval '10 days', 'recorded', $4, now() - interval '2 days') returning id::text as id`, [BIZ, c.client, c.conv, id['carried']])).rows[0].id;
    await admin.query(`insert into deletion_chases (business_id, subject, subject_id, step, asked_at)
      values ($1, 'ask', $2, '7d', now() - interval '10 days')`, [BIZ, id['carried.ask']]);
    await noted(OTHER, 'theirs', 9);
  });

  afterAll(async () => {
    await app?.end();
    // Its open requests are due by design: left behind, they would be due for every later file that asks the whole
    // database what is due (buyer-deletion-request.test.ts did, 2026-10-22).
    // A deletion request is never deleted (it is the record that one was made): closed, as the owner withdraws one.
    await admin?.query(`update deletion_requests set state = 'withdrawn', closed_at = now(), closed_by = 'test'
      where business_id = any($1::uuid[]) and closed_at is null`, [[BIZ, OTHER]]);
    await admin?.end();
  });

  it('each waiting request at the furthest step due, with its conversation; nothing fresh, nothing answered', async () => {
    const rows = await claim();
    expect(stepOf(rows, 'fresh')).toEqual([]);
    expect(stepOf(rows, 'week')).toEqual(['7d']);
    expect(stepOf(rows, 'late')).toEqual(['30d']);
    expect(stepOf(rows, 'long')).toEqual(['60d']);
    expect(stepOf(rows, 'open')).toEqual(['30d']);
    expect(stepOf(rows, 'done')).toEqual([]);
    expect(stepOf(rows, 'withdrawn')).toEqual([]);
    expect(stepOf(rows, 'carried')).toEqual([]);
    expect(stepOf(rows, 'theirs')).toEqual(['7d']);
    // The reminder's door: the customer's conversation, for a noted request and a recorded one alike.
    expect(rows.find((r) => r.subject_id === id['week'])?.conversation_id).toBe(conv['week']);
    expect(rows.find((r) => r.subject_id === id['open'])?.conversation_id).toBe(conv['open']);
  });

  it('once: the next run claims nothing, and every chase is on record', async () => {
    expect(await claim()).toEqual([]);
    const recordedChases = (await admin.query(`select subject_id::text as s, step from deletion_chases where business_id = $1 order by step`, [BIZ])).rows;
    expect(recordedChases.filter((r) => r.s === id['week']).map((r) => r.step)).toEqual(['7d']);
    expect(recordedChases.filter((r) => r.s === id['late']).map((r) => r.step)).toEqual(['30d']);
    expect(recordedChases.length).toBe(5);   // week, late, long, open — and the carried one's own 7d
  });

  it('the next step comes when it is due: a week-old request reminded again at 30 days, then flagged at 60', async () => {
    await admin.query(`update deletion_asks set asked_at = now() - interval '31 days' where id = $1`, [id['week']]);
    expect(stepOf(await claim(), 'week')).toEqual(['30d']);
    await admin.query(`update deletion_asks set asked_at = now() - interval '60 days' where id = $1`, [id['week']]);
    expect(stepOf(await claim(), 'week')).toEqual(['60d']);
    expect(stepOf(await claim(), 'week')).toEqual([]);
    // The carried request, once a month old, is reminded at 30 — its message's 7 counted, not repeated.
    await admin.query(`update deletion_requests set asked_at = now() - interval '31 days' where id = $1`, [id['carried']]);
    expect(stepOf(await claim(), 'carried')).toEqual(['30d']);
  });

  it('Nomi erases nothing: every customer, conversation and message is still there', async () => {
    for (const key of Object.keys(conv)) {
      expect(Number((await admin.query(`select count(*) as n from messages where conversation_id = $1`, [conv[key]])).rows[0].n), key).toBe(1);
    }
    expect(Number((await admin.query(`select count(*) as n from deletion_asks where business_id = $1 and state = 'waiting'`, [BIZ])).rows[0].n)).toBe(4);
  });

  it('the app role reads its own workspace\'s record only, and cannot write it', async () => {
    await app.query('begin');
    await app.query(`select set_config('app.business_id', $1, true)`, [OTHER]);
    const seen = (await app.query(`select distinct business_id::text as b from deletion_chases`)).rows.map((r) => r.b);
    expect(seen).toEqual([OTHER]);
    await expect(app.query(`insert into deletion_chases (business_id, subject, subject_id, step, asked_at)
      values ($1, 'ask', gen_random_uuid(), '7d', now())`, [OTHER])).rejects.toThrow(/permission denied/);
    await app.query('rollback');
    await app.query('begin');
    await app.query(`select set_config('app.business_id', $1, true)`, [OTHER]);
    await expect(app.query(`delete from deletion_chases`)).rejects.toThrow(/permission denied/);
    await app.query('rollback');
  });

  it('Today flags both kinds from day 60 — the noted and the recorded', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { readAttention } = await import('../../src/api/web/operations.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const db = createDb(DATABASE_URL!);
    try {
      const b = parseBusinessId(BIZ);
      if (!b.ok) throw new Error(b.error);
      // 'long' (61 days) and 'week' (now 60) are noted; 'open' is recorded at 31 days — not yet.
      expect((await readAttention(db, b.value)).deletionAsksLong).toBe(2);
      await admin.query(`update deletion_requests set asked_at = now() - interval '61 days' where id = $1`, [id['open']]);
      expect((await readAttention(db, b.value)).deletionAsksLong).toBe(3);
    } finally {
      await db.destroy();
    }
  });
});
