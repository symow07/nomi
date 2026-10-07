#!/usr/bin/env node
/**
 * 0126 — AN ERASURE SURVIVES A RESTORE.
 *
 * A backup cannot be edited: a customer erased today is still inside every
 * backup taken before today, until that backup ages out (dailies 60 days,
 * manual pairs 180 — docs/BACKUP-RESTORE.md). That is what /data-deletion
 * says, and it stays true. What must never happen is a restore that brings
 * them BACK: the service running again on a copy that still holds someone who
 * was told their data is gone.
 *
 * So every erasure writes an ids-only line in `erasure_ledger` (who was
 * erased, by id; the request; who acted; when; how many rows of each table —
 * never a name, a number or a word), and this tool carries out again, on a
 * restored copy, every erasure the copy itself does not already hold. It runs
 * BEFORE the app is pointed at the copy (docs/BACKUP-RESTORE.md, "Restore",
 * step 5).
 *
 * WHERE THE LEDGER COMES FROM. The restored copy's own ledger is as old as the
 * backup, so it cannot know what was erased after it. The newer lines come
 * from wherever they still are, and every source given is read:
 *   · the copy itself (always);
 *   · --ledger <file>   a JSON-lines export (`--export`, below), repeatable —
 *                       the newest backup's ledger, or the lines e-mailed to
 *                       the operator at each erasure;
 *   · --ledger-db-env <NAME>  the database whose URL is in the environment
 *                       variable NAME — the one being replaced, if it still
 *                       answers. A URL is never a command argument.
 *
 * WHAT IT DOES WITH EACH LINE, oldest first:
 *   · a line the copy's ledger already has, and that holds there: nothing;
 *   · a workspace: if it is in the copy, it is erased (the same steps as
 *     closing it, `erase_workspace_rows`);
 *   · a customer: if they are in the copy, they are erased by the same
 *     contract (`erase_customer_rows`), their request closed as done (written
 *     back as done if the copy predates it);
 *   · an advisor deletion (0130): the conversations it named, whole, if they are in
 *     the copy (`advisor_replay_erasure`) — withdrawn consent, a conversation
 *     deleted, a person removed, twelve months unopened, the workspace switched off;
 *   · the line is then written into the copy's ledger, so the copy's ledger is
 *     whole again.
 * A job a worker left 'active' when the backup was taken is not a worker busy
 * now: no worker runs on a copy the app is not pointed at.
 *
 * A DRY RUN unless --yes: each line is carried out inside a transaction that
 * is rolled back, so the counts are the real ones and nothing changes.
 *
 *   MIGRATE_DATABASE_URL=<the restored copy> node tools/replay-erasures.mjs [--ledger f.jsonl] [--ledger-db-env NAME]
 *   MIGRATE_DATABASE_URL=<the restored copy> node tools/replay-erasures.mjs … --yes --by "<your name>"
 *   MIGRATE_DATABASE_URL=<any database>      node tools/replay-erasures.mjs --export > ledger.jsonl
 *
 * Exit 0 done (or nothing to do) · 1 a refusal or a failure · 2 bad usage.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toolClient } from './lib/db.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && i + 1 < args.length ? [args[i + 1]] : []));
const one = (name) => all(name)[0] ?? null;
const has = (name) => args.includes(`--${name}`);

const usage = (msg) => {
  console.error(`${msg}\n
  MIGRATE_DATABASE_URL=… node tools/replay-erasures.mjs [--ledger <file.jsonl>]… [--ledger-db-env <NAME>] [--yes --by "<your name>"]
  MIGRATE_DATABASE_URL=… node tools/replay-erasures.mjs --export

  --ledger         a JSON-lines ledger (from --export), repeatable
  --ledger-db-env  the NAME of an environment variable holding another database's URL, read for its ledger
  --yes            carry it out. Without it this is a dry run and changes nothing.
  --by             who is carrying it out (required with --yes)
  --export         print this database's ledger as JSON lines, and change nothing
`);
  process.exit(2);
};

/** One ledger line, as exported and as read back: ids, who, when, counts. Nothing else. */
export function ledgerLine(row) {
  return {
    id: String(row.id), kind: String(row.kind), business_id: String(row.business_id),
    customer_id: row.customer_id ? String(row.customer_id) : null,
    request_id: row.request_id ? String(row.request_id) : null,
    person_id: row.person_id ? String(row.person_id) : null,
    thread_ids: Array.isArray(row.thread_ids) ? row.thread_ids.map(String) : null,
    via: String(row.via), by_who: String(row.by_who),
    at: new Date(row.at).toISOString(), counts: row.counts ?? {},
  };
}

/** A line read from a file or another database, checked before it is trusted with an erasure. */
export function parseLedgerLine(text) {
  let x;
  try { x = JSON.parse(text); } catch { return { ok: false, why: 'not JSON' }; }
  if (!x || typeof x !== 'object') return { ok: false, why: 'not an object' };
  if (!UUID.test(String(x.id ?? ''))) return { ok: false, why: 'no id' };
  if (x.kind !== 'customer' && x.kind !== 'workspace' && x.kind !== 'advisor') return { ok: false, why: `kind '${x.kind}'` };
  if (!UUID.test(String(x.business_id ?? ''))) return { ok: false, why: 'no business_id' };
  if (x.kind === 'customer' && !UUID.test(String(x.customer_id ?? ''))) return { ok: false, why: 'a customer line with no customer_id' };
  if (x.kind === 'workspace' && x.customer_id) return { ok: false, why: 'a workspace line naming a customer' };
  if (x.kind === 'advisor' && (x.customer_id || !Array.isArray(x.thread_ids) || !x.thread_ids.length || !x.thread_ids.every((t) => UUID.test(String(t))))) {
    return { ok: false, why: 'an advisor line without its conversations' };
  }
  if (x.person_id && !UUID.test(String(x.person_id))) return { ok: false, why: 'a person_id that is not an id' };
  if (x.request_id && !UUID.test(String(x.request_id))) return { ok: false, why: 'a request_id that is not an id' };
  if (Number.isNaN(new Date(x.at).getTime())) return { ok: false, why: 'no time' };
  if (!['owner', 'operator', 'restore', 'person', 'retention'].includes(x.via)) return { ok: false, why: `via '${x.via}'` };
  return { ok: true, line: ledgerLine(x) };
}

const SELECT_LEDGER = `select id::text as id, kind, business_id::text as business_id, customer_id::text as customer_id,
                              request_id::text as request_id, person_id::text as person_id, thread_ids::text[] as thread_ids,
                              via, by_who, at, counts
                         from erasure_ledger order by at, id`;

async function readLedger(c) {
  const ok = (await c.query("select to_regclass('erasure_ledger') is not null as ok")).rows[0]?.ok;
  if (!ok) return null;
  return (await c.query(SELECT_LEDGER)).rows.map(ledgerLine);
}

async function main() {
  const url = process.env['MIGRATE_DATABASE_URL'];
  if (!url) usage('MIGRATE_DATABASE_URL is not set: the restored copy, as its admin role.');
  const exporting = has('export');
  const go = has('yes');
  const by = (one('by') ?? '').trim();
  if (go && !by) usage('--yes needs --by "<your name>".');
  if (by.length > 120) usage('--by is a name, 120 characters at most.');
  const files = all('ledger');
  const envName = one('ledger-db-env');
  if (envName && !/^[A-Z_][A-Z0-9_]*$/.test(envName)) usage('--ledger-db-env takes the NAME of an environment variable, not a URL.');

  const refuse = (msg) => { console.error(`\n✗  ${msg}\n`); process.exitCode = 1; };
  const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });
  try {
    await client.connect();
    const role = (await client.query('select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
    if (!role?.sees_all) return refuse('This role is subject to row-level security: it cannot see every row an erasure must reach. Use the admin role. Nothing was changed.');
    await client.query('set row_security = off');

    const own = await readLedger(client);
    if (own === null) return refuse('This database has no erasure_ledger — it predates migration 0126. Migrate it to the current schema first (node tools/migrate.mjs), then run this. Nothing was changed.');

    if (exporting) {
      for (const l of own) process.stdout.write(`${JSON.stringify(l)}\n`);
      console.error(`${own.length} ledger line(s) exported. Ids, who, when and counts only.`);
      return;
    }

    // Every source, read whole before anything is decided.
    const lines = new Map(own.map((l) => [l.id, l]));
    const ownIds = new Set(own.map((l) => l.id));
    let bad = 0;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').map((x) => x.trim()).filter(Boolean).forEach((t, i) => {
        const p = parseLedgerLine(t);
        if (!p.ok) { bad++; console.error(`  ${f}:${i + 1}: not a ledger line (${p.why})`); return; }
        if (!lines.has(p.line.id)) lines.set(p.line.id, p.line);
      });
    }
    if (envName) {
      const other = process.env[envName];
      if (!other) return refuse(`The environment variable ${envName} is not set. Nothing was changed.`);
      const oc = toolClient(other, { replyTimeoutMs: 60_000 });
      try {
        await oc.connect();
        const theirs = await readLedger(oc);
        if (theirs === null) return refuse(`The database in ${envName} has no erasure_ledger. Nothing was changed.`);
        for (const l of theirs) if (!lines.has(l.id)) lines.set(l.id, l);
      } finally {
        await oc.end().catch(() => {});
      }
    }
    if (bad) return refuse(`${bad} line(s) in the files given are not ledger lines. Fix or remove them; nothing was changed.`);

    // A line of the copy's own ledger that does not hold in the copy is
    // carried out again too: the ledger says it is gone.
    const unkept = new Set((await client.query('select distinct ledger_id::text as id from erasure_ledger_unkept()')).rows.map((r) => r.id));
    const todo = [...lines.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    let applied = 0; let nothing = 0; let held = 0;
    for (const l of todo) {
      if (ownIds.has(l.id) && !unkept.has(l.id)) { held++; continue; }
      await client.query('begin');
      try {
        const r = await replayOne(client, l, by || 'dry run');
        if (go) await client.query('commit'); else await client.query('rollback');
        const what = l.kind === 'workspace' ? `workspace ${l.business_id}`
          : l.kind === 'advisor' ? `${l.thread_ids.length} advisor conversation(s) of ${l.business_id}`
          : `customer ${l.customer_id} of ${l.business_id}`;
        if (r.rows > 0) {
          applied++;
          console.log(`  ${go ? 'erased' : 'would erase'} ${String(r.rows).padStart(6)} rows · ${what} · ledger ${l.id} (${l.at.slice(0, 10)})`);
        } else {
          nothing++;
          console.log(`  nothing of them here     · ${what} · ledger ${l.id}${go && !ownIds.has(l.id) ? ' — line recorded' : ''}`);
        }
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw new Error(`ledger ${l.id}: ${e instanceof Error ? e.message : String(e)} — stopped here; this line and those after it were not carried out.`);
      }
    }
    console.log(`\n  ${todo.length} ledger line(s): ${held} already hold here, ${applied} ${go ? 'carried out again' : 'to carry out again'}, ${nothing} with nothing of them here.`);
    if (!go) console.log('  Dry run. Nothing was changed. To carry it out: --yes --by "<your name>"\n');
    else console.log('  Done. Point the app at this copy only now.\n');
  } catch (e) {
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

/** One line, inside the caller's transaction. Returns how many rows went. */
async function replayOne(c, l, by) {
  let rows = 0;
  const biz = (await c.query('select 1 from businesses where id = $1::uuid', [l.business_id])).rowCount > 0;
  if (l.kind === 'advisor') {
    if (biz) {
      rows = Number((await c.query('select advisor_replay_erasure($1::uuid, $2::uuid[])::text as n', [l.business_id, l.thread_ids])).rows[0]?.n ?? 0);
    }
  } else if (l.kind === 'workspace') {
    if (biz) {
      const r = (await c.query('select erase_workspace_rows($1::uuid, false, true) as r', [l.business_id])).rows[0]?.r;
      rows = Number(r?.rows ?? 0);
    }
  } else if (biz && (await c.query('select 1 from clients where id = $1::uuid and business_id = $2::uuid', [l.customer_id, l.business_id])).rowCount > 0) {
    // The request it carried out: closed as done here too, or written back as
    // done if this copy predates it — the record that they asked stays.
    if (l.request_id) {
      const req = (await c.query('select state from deletion_requests where id = $1::uuid', [l.request_id])).rows[0];
      if (!req) {
        await c.query(`insert into deletion_requests (id, business_id, scope, client_id, asked_by, asked_at, state, closed_at, closed_by)
                       values ($1::uuid, $2::uuid, 'buyer', $3::uuid, 'restore', $4::timestamptz, 'done', now(), $5)`,
          [l.request_id, l.business_id, l.customer_id, l.at, by]);
      }
    }
    const r = (await c.query('select erase_customer_rows($1::uuid, $2::uuid, $3::uuid, true) as r',
      [l.business_id, l.customer_id, l.request_id])).rows[0]?.r ?? {};
    const sum = (m) => Object.values(m ?? {}).reduce((a, n) => a + Number(n), 0);
    rows = sum(r.erased) + sum(r.changed);
    if (l.request_id) {
      await c.query(`update deletion_requests set state = 'done', closed_at = now(), closed_by = $2,
                            closed_note = erasure_note($3::jsonb, 'restore')
                      where id = $1::uuid and state = 'open'`, [l.request_id, by, JSON.stringify(r)]);
    }
  }
  // The copy's ledger made whole: the line as it was written, by its own id.
  await c.query(`insert into erasure_ledger (id, kind, business_id, customer_id, request_id, person_id, thread_ids, via, by_who, at, counts)
                 values ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid[], $8, $9, $10::timestamptz, $11::jsonb)
                 on conflict (id) do nothing`,
    [l.id, l.kind, l.business_id, l.customer_id, l.request_id, l.person_id ?? null, l.thread_ids ?? null, l.via, l.by_who, l.at,
     JSON.stringify(l.counts ?? {})]);
  return { rows };
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) await main();
