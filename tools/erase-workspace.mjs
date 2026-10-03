#!/usr/bin/env node
/**
 * Phase 2 — carry out a deletion request, by hand, on purpose.
 *
 * WHY THIS IS A TOOL AND NOT A ROUTE. The app role holds no DELETE grant on any
 * product table (`tests/integration/grants.test.ts` holds that), so nothing the
 * web app can reach could erase a row even if a bug, a stolen session or a
 * mistaken tap asked it to. That is the point, and this tool does not change
 * it: it connects as the MIGRATION role, which owns the schema, and it is run
 * by a person who has decided to run it.
 *
 * WHY IT IS NOT A LIST OF STATEMENTS IN A DOCUMENT. A runbook that names
 * seventy tables in dependency order is wrong the week somebody adds the
 * seventy-first, and nobody notices until a delete blocks on a foreign key
 * halfway through — with half a workspace gone. This reads the live schema and
 * computes the order, so it is correct for the database in front of it.
 *
 * ONE CONTRACT, THE DATABASE'S (0126). Since an owner can close a workspace
 * in the product (Your data → Close this workspace, `close_workspace`), the
 * steps live in the database: `workspace_erasure_steps()` reads the live
 * schema and orders them, `erase_workspace_rows()` counts (the dry run here)
 * or carries them out, and this tool's real run is
 * `carry_out_workspace_erasure()` — the same steps the owner's button runs,
 * so the two cannot erase differently. It also writes the ids-only record of
 * the erasure (`erasure_ledger`), which outlives the workspace and is replayed
 * after any restore (tools/replay-erasures.mjs).
 *
 * WHAT IT REFUSES TO DO:
 *   · run without an OPEN `deletion_requests` row for that business — the
 *     request is the authorisation, and it is made in the product by the owner;
 *   · run without the business's own name typed on the command line;
 *   · run at all unless `--yes` is passed. The default is a dry run that
 *     prints what it would delete and changes nothing.
 *
 * It is deliberately not reachable from `npm` scripts and not imported by any
 * source file. Usage:
 *
 *   MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs --business <uuid>
 *   MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs --business <uuid> \
 *     --confirm "Their Business Name" --yes [--by "<your name>"]
 *
 * Exit 0 all done · 1 a real refusal or failure · 2 bad usage.
 */

import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const has = (name) => args.includes(`--${name}`);

const usage = (msg) => {
  console.error(`${msg}\n
  MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs --business <uuid> [--confirm "<name>"] [--yes] [--by "<your name>"]

  --business  the workspace to erase
  --confirm   its own name, exactly as the product shows it (required with --yes)
  --yes       actually delete. Without it this is a dry run and changes nothing.
  --by        who is carrying it out, for the erasure ledger (default: operator)
`);
  process.exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set. The app role cannot delete, and must not be used here.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) {
  usage('--business must be a uuid.');
}
const go = has('yes');
const confirm = flag('confirm');
if (go && !confirm) usage('--yes needs --confirm "<the business name>".');
const by = (flag('by') ?? 'operator').trim();
if (!by || by.length > 120) usage('--by is a name, 1 to 120 characters.');

// Five minutes for any one statement: the deletes are one transaction, and a
// connection that stops answering must end it rather than hold it open.
const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });

/** Jobs a worker is running for this business (or its practice copies) right now. */
async function activeJobs(ids) {
  if (!(await client.query("select to_regclass('pgboss.job') is not null as ok")).rows[0]?.ok) return 0;
  return (await client.query(
    "select count(*)::int as n from pgboss.job where data->>'businessId' = any($1::text[]) and state = 'active'", [ids])).rows[0]?.n ?? 0;
}

/** "  12  messages" lines, sorted by table, from the database's counts. */
function printCounts(counts) {
  let total = 0;
  const lines = (m, suffix) => Object.entries(m ?? {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([t, n]) => {
    total += Number(n);
    console.log(`  ${String(n).padStart(8)}  ${t}${suffix}`);
  });
  lines(counts?.tables, '');
  lines(counts?.copies, ' (its practice copy)');
  console.log(`  ${String(total).padStart(8)}  rows in all\n`);
  return total;
}

try {
  await client.connect();

  // EVERY ROW OR NOTHING, as tools/erase-buyer.mjs: `shadow.turn_decisions`
  // forces row security even on its owner, so a role that row security filters
  // would "erase" the rows it can see and leave the rest behind, reporting
  // success. Only a role that sees every row may run this.
  const who = (await client.query(
    'select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user')).rows[0];
  if (!who?.sees_all) {
    console.error('\n✗  This database role is subject to row-level security, so it cannot see every row it must erase.\n'
      + '   Use the migration (owner) role in MIGRATE_DATABASE_URL. Nothing was changed.\n');
    process.exit(1);
  }
  if (!(await client.query("select to_regprocedure('erase_workspace_rows(uuid, boolean, boolean)') is not null as ok")).rows[0]?.ok) {
    console.error('\n✗  This database has no erase_workspace_rows() — it predates migration 0126. Migrate it first. Nothing was changed.\n');
    process.exit(1);
  }

  const biz = (await client.query('select id::text as id, name from businesses where id = $1', [business])).rows[0];
  if (!biz) {
    console.error(`No business ${business}. Nothing to do.`);
    process.exit(1);
  }

  const open = (await client.query(
    `select id::text as id, asked_by, asked_at, subject_note from deletion_requests
      where business_id = $1 and scope = 'workspace' and state = 'open'
      order by asked_at limit 1`, [business])).rows[0];
  if (!open) {
    console.error(`\n✗  ${biz.name} has no OPEN workspace deletion request.\n
   The request is the authorisation, and the owner makes it in the product —
   since 0126 by closing the workspace on Your data, which erases it at once.
   Erasing without one means somebody decided on their behalf. If the request
   arrived another way — an e-mail, a letter — the owner closes it from their
   own account.\n`);
    process.exit(1);
  }

  console.log(`\n  ${biz.name}`);
  console.log(`  asked by ${open.asked_by} on ${new Date(open.asked_at).toISOString().slice(0, 10)}`);
  if (open.subject_note) console.log(`  they said: ${open.subject_note}`);
  console.log('');

  // The dry run is the database's own count of the same steps, in a
  // transaction that cannot write.
  await client.query('begin isolation level repeatable read read only');
  let planned;
  try {
    planned = (await client.query('select erase_workspace_rows($1::uuid, true) as c', [business])).rows[0]?.c;
  } finally {
    await client.query('rollback').catch(() => {});
  }
  const total = printCounts(planned);

  const copies = (await client.query('select id::text as id from businesses where practice_of = $1', [business])).rows.map((r) => r.id);
  const busy = await activeJobs([...copies, business]);
  if (busy > 0) {
    console.error(`✗  A worker is running ${busy} job(s) for ${biz.name} right now. It must finish before its rows can go —`
      + ' try again in a minute. Nothing was deleted.\n');
    process.exit(1);
  }

  if (!go) {
    console.log('  Dry run. Nothing was deleted.');
    console.log(`  To carry it out:  --confirm ${JSON.stringify(biz.name)} --yes\n`);
    process.exit(0);
  }
  if (confirm.trim().toLocaleLowerCase() !== String(biz.name).trim().toLocaleLowerCase()) {
    console.error(`\n✗  --confirm does not match this workspace's name. Nothing was deleted.\n`);
    process.exit(1);
  }

  // One transaction: a half-erased workspace is worse than either end of it.
  await client.query('begin');
  let done;
  try {
    done = (await client.query('select carry_out_workspace_erasure($1::uuid, $2::uuid, $3) as c', [business, open.id, by])).rows[0]?.c;
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    if (e && e.code === 'NE002') {
      console.error(`✗  A worker is running a job for ${biz.name} right now. Nothing was deleted; try again in a minute.\n`);
      process.exit(1);
    }
    throw e;
  }
  console.log(`\n✓  ${biz.name} erased — ${done?.rows ?? total} rows, request ${open.id}.`);
  console.log(`   Recorded in the erasure ledger (${done?.ledger}), ids only: tools/replay-erasures.mjs carries it out again after any restore.`);
  console.log('   Record it where your team keeps such records, and reply to whoever asked.\n');
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
