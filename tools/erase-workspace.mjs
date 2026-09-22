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
 *     --confirm "Their Business Name" --yes
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
  MIGRATE_DATABASE_URL=… node tools/erase-workspace.mjs --business <uuid> [--confirm "<name>"] [--yes]

  --business  the workspace to erase
  --confirm   its own name, exactly as the product shows it (required with --yes)
  --yes       actually delete. Without it this is a dry run and changes nothing.
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

// Five minutes for any one statement: the deletes are one transaction, and a
// connection that stops answering must end it rather than hold it open.
const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });

/**
 * Every table that holds this workspace's rows, and the statement that removes
 * them — deepest first, so nothing blocks on a foreign key.
 *
 * Three shapes, because three shapes is what the schema has:
 *   · a `business_id` column — most tables;
 *   · a join through one parent — `messages`, `price_tiers`, `client_channels`…;
 *   · `businesses` itself, last.
 */
async function plan() {
  // Tables carrying the tenant directly. `ops_flags` is excluded here and
  // handled below: its `business_id` is NULLABLE and a null row is a GLOBAL
  // operator flag that belongs to no business and must survive.
  const direct = (await client.query(`
    select c.relname as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join information_schema.columns k
        on k.table_name = c.relname and k.table_schema = 'public' and k.column_name = 'business_id'
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`)).rows.map((r) => r.t);

  // How deep each table sits below `businesses`, so the deepest goes first.
  const depth = new Map((await client.query(`
    with recursive fk as (
      select con.conrelid::regclass::text as child, con.confrelid::regclass::text as parent
        from pg_constraint con join pg_namespace n on n.oid = con.connamespace
       where con.contype = 'f' and n.nspname = 'public'
    ), d(t, depth) as (
      select 'businesses'::text, 0
      union all
      select fk.child, d.depth + 1 from fk join d on fk.parent = d.t
       where fk.child <> d.t and d.depth < 12
    )
    select t, max(depth) as depth from d group by t`)).rows.map((r) => [r.t, Number(r.depth)]));

  const steps = [];
  // The indirect ones, by the parent they hang off. Written out rather than
  // derived: each is a product decision about what belongs to a workspace, and
  // a wrong guess here deletes somebody else's row.
  const indirect = [
    ['messages', `conversation_id in (select id from conversations where business_id = $1)`],
    ['conversation_state', `conversation_id in (select id from conversations where business_id = $1)`],
    ['client_channels', `client_id in (select id from clients where business_id = $1)`],
    ['price_tiers', `product_id in (select id from products where business_id = $1)`],
    ['product_aliases', `product_id in (select id from products where business_id = $1)`],
    ['product_images', `product_id in (select id from products where business_id = $1)`],
    ['email_confirmations', `order_id in (select id from orders where business_id = $1)`],
    ['login_codes', `login_id in (select id from logins where business_id = $1)`],
  ];
  const indirectNames = new Set(indirect.map(([t]) => t));

  // Deepest first. Ties broken by name so two runs print the same order.
  const ordered = [...direct, ...indirectNames]
    .filter((t) => t !== 'businesses' && t !== 'ops_flags')
    .sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0) || a.localeCompare(b));

  // Each step carries BOTH statements, rather than deriving the count from the
  // delete by string surgery: one typo in that regex is a count that reassures
  // an operator about rows a different statement is about to remove.
  const rows = (table, where) => ({
    table, run: `delete from ${table} where ${where}`, count: `select count(*)::int as n from ${table} where ${where}`,
  });
  for (const t of ordered) {
    const one = indirect.find(([n]) => n === t);
    steps.push(rows(t, one ? one[1] : 'business_id = $1'));
  }
  // A flag this business owns goes; a global one (business_id is null) stays.
  steps.push(rows('ops_flags', 'business_id = $1'));
  // An invitation this workspace was created from is the OPERATOR's record of
  // who was let in. It is unlinked, never deleted — otherwise erasing a
  // workspace also erases the evidence that it was ever invited.
  steps.push({
    table: 'signup_invites (unlinked, not deleted)',
    run: 'update signup_invites set used_by = null where used_by = $1',
    count: 'select count(*)::int as n from signup_invites where used_by = $1',
  });
  steps.push(rows('businesses', 'id = $1'));
  return steps;
}

try {
  await client.connect();

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
   The request is the authorisation, and the owner makes it in the product at
   /app/settings/data. Erasing without one means somebody decided on their
   behalf. If the request arrived another way — an e-mail, a letter — record
   it first, from their own account.\n`);
    process.exit(1);
  }

  console.log(`\n  ${biz.name}`);
  console.log(`  asked by ${open.asked_by} on ${new Date(open.asked_at).toISOString().slice(0, 10)}`);
  if (open.subject_note) console.log(`  they said: ${open.subject_note}`);
  console.log('');

  const steps = await plan();
  let total = 0;
  for (const step of steps) {
    const n = (await client.query(step.count, [business])).rows[0]?.n ?? 0;
    if (n === 0) continue;
    console.log(`  ${String(n).padStart(8)}  ${step.table}`);
    total += n;
  }
  console.log(`  ${String(total).padStart(8)}  rows in all\n`);

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
  try {
    for (const step of steps) await client.query(step.run, [business]);
    // The request row lives in `deletion_requests`, which the loop above has
    // just emptied for this business — so the record of what was done goes
    // where an operator will find it: the process log, and the line below.
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  console.log(`\n✓  ${biz.name} erased — ${total} rows, request ${open.id}.`);
  console.log('   Record it where your team keeps such records, and reply to whoever asked.\n');
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
