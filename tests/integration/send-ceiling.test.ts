import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDigits } from './tenant.js';

/**
 * CEIL (0085) — a send ceiling per workspace, and Meta's error rate per
 * workspace for the operator, against Postgres through the real queries.
 *
 *   · a workspace made now may send 50 of the assistant's messages a day; the
 *     gate stops the fifty-first; the operator's tool raises it, and the gate
 *     reads the new number at once;
 *   · Meta's error rate counts what Meta refused or lost on its channels —
 *     never our own gate's refusals, never e-mail — and the hourly check names
 *     a workspace over the line and not one under it.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const NEW = `dd7c1000-0000-4000-8000-${RUN}0001`;
const NOISY = `dd7c1000-0000-4000-8000-${RUN}0002`;
const CALM = `dd7c1000-0000-4000-8000-${RUN}0003`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

const tool = (args: string[], url = MIGRATE_URL) => {
  const r = spawnSync(process.execPath, ['tools/send-ceiling.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, MIGRATE_DATABASE_URL: url ?? '' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('CEIL · a send ceiling per workspace, and Meta\'s error rate (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  const conv: Record<string, string> = {};

  const as = async <R>(biz: string, fn: (t: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const reached = async (): Promise<boolean> => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(NEW); if (!b.ok) throw new Error('fixture');
    return as(NEW, async (t) => (await channelStore(t, b.value).load(conv[NEW]!)).ctx.dailyCeilingReached === true);
  };
  /** Rows as the send path leaves them: [status, last_error, channel], each created now. */
  const outbound = (biz: string, rows: [string, string | null, string][]) => as(biz, async (t) => {
    for (const [status, error, channel] of rows) {
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, kind, status, last_error, origin, channel, sent_at)
        values (${biz}, ${conv[biz]}::uuid,
                (select coalesce(max(seq), 0) + 1 from outbound_messages where conversation_id = ${conv[biz]}::uuid),
                'hello', 'text', ${status}, ${error}, 'employee', ${channel},
                ${['sent', 'delivered', 'read'].includes(status) ? sql`now()` : sql`null`})`.execute(t);
    }
  });

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[NEW, 'New Shop'], [NOISY, 'Noisy Shop'], [CALM, 'Calm Shop']] as const) {
      conv[id] = await as(id, async (t) => {
        await sql`insert into businesses (id, name) values (${id}, ${name}) on conflict (id) do nothing`.execute(t);
        const client = (await sql<{ id: string }>`insert into clients (business_id, phone, display_name)
          values (${id}, ${`+97155${runDigits(RUN, 6)}${id.slice(-1)}`}, 'Maya') returning id::text as id`.execute(t)).rows[0]!.id;
        return (await sql<{ id: string }>`insert into conversations (business_id, client_id, channel, phase)
          values (${id}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`.execute(t)).rows[0]!.id;
      });
    }
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('a workspace made now starts at 50 a day (the column\'s default)', async () => {
    const got = await as(NEW, (t) => sql<{ c: number }>`select daily_send_ceiling as c from businesses where id = ${NEW}`.execute(t).then((r) => r.rows[0]!.c));
    expect(got).toBe(50);
  });

  it('the gate lets the fiftieth go and stops the fifty-first; the operator raises it and the gate reads it at once', async () => {
    await outbound(NEW, Array.from({ length: 49 }, () => ['sent', null, 'whatsapp'] as [string, string | null, string]));
    expect(await reached()).toBe(false);
    await outbound(NEW, [['sent', null, 'whatsapp']]);
    expect(await reached()).toBe(true);

    const shown = tool(['--business', NEW]);
    expect(shown.code, shown.err).toBe(0);
    expect(shown.out).toContain('New Shop: at most 50');
    const set = tool(['--business', NEW, '--set', '200']);
    expect(set.code, set.err).toBe(0);
    expect(set.out).toContain('50 → 200');
    expect(await reached()).toBe(false);
  });

  it('the tool refuses what it cannot do, and changes nothing', () => {
    expect(tool(['--business', NEW, '--set', '0']).code).toBe(2);
    expect(tool(['--business', NEW, '--set', 'lots']).code).toBe(2);
    expect(tool(['--business', randomUUID(), '--set', '10']).code).toBe(1);
    expect(tool(['--business', NEW]).out).toContain('at most 200');
  });

  it('Meta\'s error rate: what Meta refused or lost on its channels — never our gate\'s refusals, never e-mail', async () => {
    await outbound(NOISY, [
      ['sent', null, 'whatsapp'], ['delivered', null, 'instagram'], ['read', null, 'messenger'], ['sent', null, 'instagram'],
      ['failed', 'meta 401', 'instagram'], ['failed', 'meta 401', 'messenger'], ['failed', '131026 undeliverable', 'whatsapp'],
      ['failed', '131026 undeliverable', 'whatsapp'], ['uncertain', 'interrupted: unknown whether it left', 'instagram'], ['failed', 'meta 401', 'instagram'],
      // not Meta's: our own gate, and e-mail
      ['canceled', 'canceled: not_allowlisted', 'whatsapp'], ['canceled', 'canceled: stopped', 'instagram'],
      ['failed', '550 no such mailbox', 'email'], ['failed', '550 no such mailbox', 'email'],
    ]);
    await outbound(CALM, [
      ...Array.from({ length: 30 }, () => ['sent', null, 'whatsapp'] as [string, string | null, string]),
      ['failed', 'meta 401', 'whatsapp'], ['failed', 'meta 401', 'whatsapp'],
    ]);
    const { metaErrorRates, metaErrorAlert } = await import('../../src/pipeline/metaErrorWatch.js');
    const rates = await metaErrorRates(db, new Date(Date.now() - 3_600_000));
    const noisy = rates.find((r) => r.business === 'Noisy Shop')!;
    expect(noisy).toMatchObject({ attempted: 10, failed: 6 });
    expect([...noisy.errors].sort()).toEqual(['131026 undeliverable', 'interrupted: unknown whether it left', 'meta 401']);
    expect(rates.find((r) => r.business === 'Calm Shop')).toMatchObject({ attempted: 32, failed: 2 });

    const alert = await metaErrorAlert(db, NEW, new Date());
    expect(alert?.kind).toBe('meta_errors');
    const named = (alert?.metaErrors ?? []).map((m) => m.business);
    expect(named).toContain('Noisy Shop');
    expect(named).not.toContain('Calm Shop');
    expect(named).not.toContain('New Shop');
  });
});
