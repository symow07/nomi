import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D13 (the data-protection audit, 2026-10-12; 0142) — A CUSTOMER'S ERASURE
 * REACHES THEIR WORDS IN PRACTICE.
 *
 * A customer asked "Do you ship candles to Oman by sea?" and said "hello there".
 * The owner tried the question, word for word, in Practice; another practice
 * conversation is about something else; a third only shares "hello there"
 * (shorter than twelve characters: anyone's). The operator's tool carries out
 * their request for real — its plan and the database still agree — and the
 * practice conversation holding their question goes; the others stay, and
 * Start over still empties Practice as before.
 */

const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const DATABASE_URL = process.env['DATABASE_URL'];
const d = ADMIN && DATABASE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const LIVE = `d1300000-0000-4000-8000-${RUN}0001`;
const COPY = `d1300000-0000-4000-8000-${RUN}0002`;
const ASKED = `Do you ship candles to Oman by sea? (${RUN})`;
const SHORT = 'hello there';

d('D13 · the erasure reaches Practice (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  const conv = { tried: '', other: '', short: '' };
  let req = '';
  const one = async (q: string, p: unknown[]) => (await db.query(q, p)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [LIVE, `Practice Live ${RUN}`]);
    await db.query(`insert into businesses (id, name, owner_locale, practice_of) values ($1, $2, 'en', $3)`, [COPY, `Practice Copy ${RUN}`, LIVE]);
    const client = (await one(`insert into clients (business_id, display_name, phone) values ($1, $2, $3) returning id::text as id`,
      [LIVE, `Huda ${RUN}`, `9715${RUN.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`])).id;
    const live = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [LIVE, client])).id;
    for (const text of [ASKED, SHORT]) {
      await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now())`, [live, text]);
    }
    const practiceBuyer = (await one(`insert into clients (business_id, display_name) values ($1, 'Practice customer') returning id::text as id`, [COPY])).id;
    const practice = async (text: string) => {
      const id = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [COPY, practiceBuyer])).id as string;
      await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', $2, now())`, [id, text]);
      return id;
    };
    conv.tried = await practice(`  ${ASKED} `);
    conv.other = await practice(`What colours do you have this week? (${RUN})`);
    conv.short = await practice(SHORT);
    req = (await one(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`, [LIVE, client])).id;
  }, 60_000);

  afterAll(async () => { await db?.end(); });

  const exists = async (id: string) => (await db.query('select 1 from conversations where id = $1', [id])).rowCount === 1;

  it('the tool and the database agree; the practice conversation holding their question goes, the others stay', async () => {
    const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, '--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test'],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(await exists(conv.tried)).toBe(false);
    expect(await exists(conv.other)).toBe(true);
    expect(await exists(conv.short)).toBe(true);
    expect((await one(`select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
                        where c.business_id = $1 and m.text_content like $2`, [COPY, `%${RUN})%`])).n).toBe(1);
    const ledger = await one('select counts from erasure_ledger where request_id = $1', [req]);
    expect(ledger.counts.practice).toBe(1);
  });

  it('Start over still empties Practice, through the same deletion', async () => {
    expect((await one(`select practice_erase($1::uuid, interval '0') as n`, [COPY])).n).toBe(2);
    expect(await exists(conv.other)).toBe(false);
    expect(await exists(conv.short)).toBe(false);
  });
});
