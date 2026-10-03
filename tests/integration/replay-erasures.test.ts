import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import { parseLedgerLine } from '../../tools/replay-erasures.mjs';

/**
 * 0126 — AN ERASURE SURVIVES A RESTORE (tools/replay-erasures.mjs, run for
 * real, as the operator runs it after restoring a backup).
 *
 * A restored copy can hold someone erased after its backup was taken. Here
 * this database plays that copy: customers and a workspace whose erasure is
 * in a ledger file (as exported from the live database, or mailed to the
 * operator at each erasure) but not yet in this copy. The dry run counts and
 * changes nothing; --yes erases them by the same contract, closes the request
 * (writing it back as done where the copy predates it), and makes this copy's
 * ledger whole; a second run finds everything holds. A line of the copy's own
 * ledger that does not hold is carried out too. The drill's report
 * (`erasure_ledger_unkept`, tools/verify-restore.sh) sees exactly those.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd9e0000-0000-4000-8000-${RUN}0001`;
const GONE = `dd9e0000-0000-4000-8000-${RUN}0002`;
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], env: NodeJS.ProcessEnv = { ...process.env, MIGRATE_DATABASE_URL: ADMIN }): Run => {
  const r = spawnSync(process.execPath, ['tools/replay-erasures.mjs', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('0126 · tools/replay-erasures.mjs carries the ledger out again on a restored copy (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  let dir = '';
  let file = '';
  const F = { client: '', conv: '', req: randomUUID(), line: randomUUID() };
  const H = { client: '', conv: '', line: randomUUID() };
  const W = { line: randomUUID() };
  const n = async (q: string, p: unknown[]) => Number((await db.query(q, p)).rows[0].n);
  const messagesOf = (conv: string) => n('select count(*) as n from messages where conversation_id = $1', [conv]);

  const customer = async (biz: string, key: string, i: number) => {
    const client = (await db.query(`insert into clients (business_id, display_name, phone) values ($1, $2, $3) returning id::text as id`,
      [biz, `Replay ${key} ${RUN}`, `96${i}${DIGITS}`])).rows[0].id as string;
    await db.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'whatsapp', $2)`, [client, `96${i}${DIGITS}`]);
    const conv = (await db.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [biz, client])).rows[0].id as string;
    await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'hello', now())`, [conv]);
    return { client, conv };
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query(`insert into businesses (id, name) values ($1, $2), ($3, $4)`, [BIZ, `Replay Shop ${RUN}`, GONE, `Replay Closed ${RUN}`]);
    Object.assign(F, await customer(BIZ, 'F', 1));
    Object.assign(H, await customer(BIZ, 'H', 2));
    await customer(GONE, 'G', 3);
    dir = mkdtempSync(join(tmpdir(), 'replay-'));
    file = join(dir, 'ledger.jsonl');
    // The lines as the live database's ledger holds them — erased there after this copy's backup.
    const at = new Date().toISOString();
    writeFileSync(file, [
      { id: F.line, kind: 'customer', business_id: BIZ, customer_id: F.client, request_id: F.req, via: 'owner', by_who: 'p-owner', at, counts: { erased: { messages: 1 } } },
      { id: W.line, kind: 'workspace', business_id: GONE, customer_id: null, request_id: null, via: 'owner', by_who: 'p-owner', at, counts: { rows: 9 } },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  }, 60_000);

  afterAll(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    await db?.end();
  });

  it('refuses the app\'s role, a URL where a NAME belongs, and a file that is not a ledger — changing nothing', () => {
    const app = tool(['--ledger', file], { ...process.env, MIGRATE_DATABASE_URL: DATABASE_URL });
    expect(app.code).toBe(1);
    expect(app.err).toMatch(/row-level security/);
    expect(tool(['--ledger-db-env', 'postgresql://x@y/z']).code).toBe(2);
    const bad = join(dir, 'bad.jsonl');
    writeFileSync(bad, '{"id":"nope"}\n');
    const r = tool(['--ledger', bad]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not a ledger line \(no id\)/);
    expect(parseLedgerLine('{"id":"nope"}')).toMatchObject({ ok: false });
  });

  it('THE DRY RUN counts what it would erase, from the real erasure rolled back — and changes nothing', async () => {
    const r = tool(['--ledger', file]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`would erase +\\d+ rows · customer ${F.client} of ${BIZ} · ledger ${F.line}`));
    expect(r.out).toMatch(new RegExp(`would erase +\\d+ rows · workspace ${GONE} · ledger ${W.line}`));
    expect(r.out).toContain('Dry run. Nothing was changed.');
    expect(await messagesOf(F.conv)).toBe(1);
    expect(await n('select count(*) as n from businesses where id = $1', [GONE])).toBe(1);
    expect(await n('select count(*) as n from erasure_ledger where id = any($1::uuid[])', [[F.line, W.line]])).toBe(0);
  });

  it('--yes: they are erased by the same contract, the request written back as done, the copy\'s ledger made whole — the neighbour untouched', async () => {
    const r = tool(['--ledger', file, '--yes', '--by', 'Restore Test']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Point the app at this copy only now.');
    expect(await messagesOf(F.conv)).toBe(0);
    expect(await n('select count(*) as n from client_channels where client_id = $1', [F.client])).toBe(0);
    expect((await db.query('select display_name, phone from clients where id = $1', [F.client])).rows[0]).toEqual({ display_name: null, phone: null });
    expect((await db.query('select state, scope, client_id::text as c, closed_by from deletion_requests where id = $1', [F.req])).rows[0])
      .toEqual({ state: 'done', scope: 'buyer', c: F.client, closed_by: 'Restore Test' });
    expect(await n('select count(*) as n from businesses where id = $1', [GONE])).toBe(0);
    expect(await n('select count(*) as n from clients where business_id = $1', [GONE])).toBe(0);
    const ledger = (await db.query('select id::text as id, via, by_who from erasure_ledger where id = any($1::uuid[]) order by id', [[F.line, W.line]])).rows;
    expect(ledger.map((x: { id: string }) => x.id).sort()).toEqual([F.line, W.line].sort());
    expect(ledger.every((x: { via: string; by_who: string }) => x.via === 'owner' && x.by_who === 'p-owner'), 'each line kept as it was written').toBe(true);
    // The neighbour in the same workspace: exactly as it was.
    expect(await messagesOf(H.conv)).toBe(1);
  });

  it('a second run finds every line already holds, and changes nothing', async () => {
    const r = tool(['--ledger', file, '--yes', '--by', 'Restore Test']);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/erased +\d+ rows/);
    expect(await messagesOf(H.conv)).toBe(1);
  });

  it('a line of the copy\'s own ledger that does not hold is what the drill reports — and what the replay carries out', async () => {
    expect((await db.query('select count(*)::int as n from erasure_ledger_unkept() where customer_id = $1', [H.client])).rows[0].n).toBe(0);
    await db.query(`insert into erasure_ledger (id, kind, business_id, customer_id, via, by_who) values ($1, 'customer', $2, $3, 'operator', 'test')`,
      [H.line, BIZ, H.client]);
    const unkept = (await db.query('select reason from erasure_ledger_unkept() where ledger_id = $1 order by reason', [H.line])).rows.map((x: { reason: string }) => x.reason);
    expect(unkept).toEqual(['a message of theirs is still there', 'an identity of theirs is still there', 'their name or contact details are still there']);
    const r = tool(['--yes', '--by', 'Restore Test']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`erased +\\d+ rows · customer ${H.client}`));
    expect(await messagesOf(H.conv)).toBe(0);
    expect((await db.query('select count(*)::int as n from erasure_ledger_unkept() where ledger_id = $1', [H.line])).rows[0].n).toBe(0);
  });

  it('--export prints the ledger as lines the replay reads back: ids, who, when, counts — nothing else', async () => {
    const r = tool(['--export']);
    expect(r.code).toBe(0);
    const lines = r.out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const mine = lines.filter((l) => [F.line, W.line, H.line].includes(String(l['id'])));
    expect(mine).toHaveLength(3);
    for (const l of mine) {
      expect(parseLedgerLine(JSON.stringify(l)).ok).toBe(true);
      expect(Object.keys(l).sort()).toEqual(['at', 'business_id', 'by_who', 'counts', 'customer_id', 'id', 'kind', 'request_id', 'via']);
    }
  });
});
