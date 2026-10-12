import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D16 (the data-protection audit, 2026-10-12; 0145) — AN ADVISOR CONVERSATION
 * THAT OUTLIVES A CUSTOMER'S ERASURE LOSES ITS TITLE.
 *
 * Two conversations of one person at the business: one asked only about the
 * customer (it goes whole, as since 0130), one asked about them and about
 * something else (it stays, with the other question). The title of the one
 * that stays was made from its first question — the one about them. The
 * operator's tool carries out the request for real; the surviving
 * conversation's sealed title is cleared, and the tool and the database agree.
 */

const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const DATABASE_URL = process.env['DATABASE_URL'];
const d = ADMIN && DATABASE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BIZ = `d1600000-0000-4000-8000-${RUN}0001`;
const SEAL = 'abcdef012345';

d('D16 · an advisor conversation that outlives an erasure loses its title (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  let req = '';
  const thread = { only: '', mixed: '' };
  const one = async (q: string, p: unknown[]) => (await db.query(q, p)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query(`insert into businesses (id, name, owner_locale, advisor_history_at, advisor_history_by) values ($1, $2, 'en', now(), 'owner')`, [BIZ, `Advisor Titles ${RUN}`]);
    const person = (await one(`insert into people (business_id, name, is_owner) values ($1, 'Lena', true) returning id::text as id`, [BIZ])).id;
    await db.query(`insert into advisor_consents (business_id, person_id, event, wording_version, locale) values ($1, $2, 'granted', '000000000000', 'en')`, [BIZ, person]);
    const client = (await one(`insert into clients (business_id, display_name) values ($1, $2) returning id::text as id`, [BIZ, `Salma ${RUN}`])).id;
    const conv = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [BIZ, client])).id;
    await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'hi', now())`, [conv]);
    const newThread = async () => (await one(`insert into advisor_threads (business_id, person_id, title_ciphertext, sealed_with) values ($1, $2, 'sealed-title', $3) returning id::text as id`, [BIZ, person, SEAL])).id as string;
    const turn = async (th: string) => (await one(`insert into advisor_turns (thread_id, business_id, person_id, question_ciphertext, entry_id, params_ciphertext, answer_kind, answer_ciphertext, facts_ciphertext, sealed_with)
      values ($1, $2, $3, 'q', 'unknown', 'p', 'fact', 'a', 'f', $4) returning id::text as id`, [th, BIZ, person, SEAL])).id as string;
    thread.only = await newThread();
    thread.mixed = await newThread();
    const aboutHer = [await turn(thread.only), await turn(thread.mixed)];
    await turn(thread.mixed);   // about something else: it keeps the conversation
    for (const tu of aboutHer) await db.query(`insert into advisor_turn_subjects (turn_id, client_id, business_id) values ($1, $2, $3)`, [tu, client, BIZ]);
    req = (await one(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`, [BIZ, client])).id;
  }, 60_000);

  afterAll(async () => { await db?.end(); });

  it('the conversation only about them goes; the one that stays keeps its other question and loses its title', async () => {
    const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, '--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test'],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect((await db.query('select 1 from advisor_threads where id = $1', [thread.only])).rowCount).toBe(0);
    expect(await one('select title_ciphertext from advisor_threads where id = $1', [thread.mixed])).toEqual({ title_ciphertext: '' });
    expect((await one('select count(*)::int as n from advisor_turns where thread_id = $1', [thread.mixed])).n).toBe(1);
    expect((await one('select counts from erasure_ledger where request_id = $1', [req])).counts.advisor_titles).toBe(1);
  });
});
