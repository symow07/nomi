import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * D19 (the data-protection audit, 2026-10-12; 0144) — EVERY BUSINESS TABLE IS
 * CLASSIFIED, SO NONE ESCAPES THE ERASURE BY ITS COLUMN NAMES.
 *
 * On the real schema: nothing is undecided; a new table holding a business's
 * rows under a name no list foresaw stops the erasure, by name, until it is
 * decided; and the scrub 0144 ran over the errors already kept takes out the
 * values they quoted, as the app does now.
 */

const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = ADMIN ? describe : describe.skip;
const MIGRATION = readFileSync(fileURLToPath(new URL('../../migrations/0144_every_table.sql', import.meta.url)), 'utf8');

d('D19 · every business table is decided (requires MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  beforeAll(async () => { db = new pg.Client({ connectionString: ADMIN }); await db.connect(); });
  afterAll(async () => { await db?.end(); });

  it('nothing is undecided on the schema as it is', async () => {
    expect((await db.query('select customer_erasure_problems() as p')).rows[0].p).toEqual([]);
  });

  it('a table that holds a business\'s rows under any name stops the erasure until it is decided', async () => {
    await db.query('begin');
    try {
      await db.query('create table d19_probe (id serial primary key, business_id uuid, remarks text)');
      const p = (await db.query('select customer_erasure_problems() as p')).rows[0].p as string[];
      expect(p.some((x) => x.startsWith('d19_probe holds a business\'s rows and is not in the contract'))).toBe(true);
    } finally {
      await db.query('rollback');
    }
  });

  it('the scrub over the errors already kept takes out what they quoted, and keeps a provider\'s own reason', async () => {
    const expr = /set message = ([\s\S]*?)\n where message like/.exec(MIGRATION)![1]!;
    const run = async (message: string) => (await db.query(`select ${expr} as m from (select $1::text as message) x`, [message])).rows[0].m as string;
    expect(await run(`Unexpected token 'S', "Sure! Your 500 bags"... is not valid JSON`)).toBe(`Unexpected token 'S', "…" is not valid JSON`);
    expect(await run('invalid input syntax for type uuid: "Ahmed Karim"')).toBe('invalid input syntax for type uuid: "…"');
    expect(await run('could not read "please send 500 bags before Friday" from the reply')).toBe('could not read "…" from the reply');
    const provider = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    expect(await run(provider)).toBe(provider);
    expect(await run('relation "conversations" does not exist')).toBe('relation "conversations" does not exist');
  });
});
