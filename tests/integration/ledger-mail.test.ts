import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { parseLedgerLine } from '../../tools/replay-erasures.mjs';

/**
 * D12 (the data-protection audit, 2026-10-12; 0141) — EVERY ERASURE'S LEDGER
 * LINE REACHES THE OPERATOR'S MAILBOX.
 *
 * Lines the app did not mail at once (an operator's erasures, the advisor's)
 * are mailed by the fifteen-minute job — ids only, one JSON line each, which
 * tools/replay-erasures.mjs reads back — and noted only once the mail went: a
 * mail that fails is tried again; a line already mailed is not mailed twice; a
 * line younger than five minutes waits for the app's own mail.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

d('D12 · the ledger reaches the operator (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  const ids = { a: '', b: '', fresh: '' };
  const sent: { to: string; subject: string; text: string }[] = [];
  let failing = true;
  const mail = {
    from: 'nomi@nomi.test',
    send: async (m: { to: string; subject: string; text: string }) => {
      if (failing) return { ok: false as const, error: 'the mailbox did not answer' };
      sent.push(m); return { ok: true as const };
    },
  };
  const mailed = async (id: string) => (await admin.query('select 1 from erasure_ledger_mailed where ledger_id = $1', [id])).rowCount === 1;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    // Two lines from long ago (so they come first), an operator's and a workspace's; one written just now.
    const line = async (kind: string, customer: string | null, at: string) => (await admin.query(
      `insert into erasure_ledger (kind, business_id, customer_id, request_id, via, by_who, at, counts)
       values ($1, $2, $3, null, 'operator', 'Operator Test', $4::timestamptz, '{"erased":{"messages":1}}') returning id::text as id`,
      [kind, randomUUID(), customer, at])).rows[0].id as string;
    ids.a = await line('customer', randomUUID(), '2000-01-01T00:00:00Z');
    ids.b = await line('workspace', null, '2000-01-01T00:00:01Z');
    ids.fresh = await line('customer', randomUUID(), new Date().toISOString());
  });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  it('a mail that fails notes nothing, so the next run sends the lines again', async () => {
    const { mailUnmailedLedger } = await import('../../src/db/erasureMail.js');
    expect(await mailUnmailedLedger(db, mail, 'privacy@nomi.test')).toBe(0);
    expect(await mailed(ids.a)).toBe(false);
    expect(await mailed(ids.b)).toBe(false);
  });

  it('the lines go, one JSON line each that the replay tool reads, and are noted', async () => {
    const { mailUnmailedLedger } = await import('../../src/db/erasureMail.js');
    failing = false;
    expect(await mailUnmailedLedger(db, mail, 'privacy@nomi.test')).toBeGreaterThanOrEqual(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('privacy@nomi.test');
    const lines = sent[0]!.text.split('\n').filter((l) => l.startsWith('{'));
    for (const l of lines) expect(parseLedgerLine(l).ok).toBe(true);
    const got = lines.map((l) => JSON.parse(l).id);
    expect(got).toContain(ids.a);
    expect(got).toContain(ids.b);
    // Just written: it waits — the app's own mail for it may still be on its way.
    expect(got).not.toContain(ids.fresh);
    expect(await mailed(ids.a)).toBe(true);
    expect(await mailed(ids.b)).toBe(true);
    expect(await mailed(ids.fresh)).toBe(false);
  });

  it('a line already mailed is never mailed again', async () => {
    const { mailUnmailedLedger } = await import('../../src/db/erasureMail.js');
    sent.length = 0;
    await mailUnmailedLedger(db, mail, 'privacy@nomi.test');
    const again = sent.flatMap((m) => m.text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l).id));
    expect(again).not.toContain(ids.a);
    expect(again).not.toContain(ids.b);
  });

  it('the app role reaches the ledger only through the two functions', async () => {
    const { sql } = await import('kysely');
    await expect(sql`select count(*) from erasure_ledger_mailed`.execute(db)).rejects.toThrow(/permission denied/);
  });
});
