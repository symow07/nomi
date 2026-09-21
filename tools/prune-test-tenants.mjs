#!/usr/bin/env node
/**
 * Take back what the integration suite left behind.
 *
 * WHY THIS EXISTS. Every integration run seeds its OWN tenant — a private copy
 * of the demo factory under a random namespace (`seedRunTenant`, and
 * `DEMO_NAMESPACE` in src/demo/factory.ts) — plus a business or two per test
 * file. That is deliberate and it is what makes the suite re-runnable. Nothing
 * ever took them away again, so a development database grows by roughly thirty
 * tenants a run, forever. It reached 1,432 businesses and 42 MB here, and the
 * cost is not disk: the minute sweep walks live businesses, so a fat database
 * makes the suite slower and eventually makes whole FILES fail on a budget that
 * has nothing to do with what they are testing.
 *
 * WHEN IT RUNS. At the START of a run, from tools/run-integration.mjs — not at
 * the end. A run that crashed or was interrupted still gets cleaned up next
 * time, and the tenant a failing test left behind survives until you choose to
 * run again, which is exactly when you want to look at it.
 *
 * WHAT IT KEEPS. Two tenants, by id: the canonical demo factory every developer
 * shares, and the sandbox. Everything else in a LOCAL database is residue.
 *
 * WHAT IT REFUSES. Anything that smells like production: it will not run
 * against a host that is not local unless `--force` is passed, because the
 * whole point of this file is that it deletes without being asked twice.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL=… node tools/prune-test-tenants.mjs [--dry-run] [--quiet]
 */

import pg from 'pg';

const DEMO_PREFIX = 'de300000';
const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const quiet = args.includes('--quiet');
const say = (...a) => { if (!quiet) console.log(...a); };

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) {
  console.error('MIGRATE_DATABASE_URL is not set. The app role cannot delete; this needs the migration role.');
  process.exit(2);
}
// A development database lives on this machine. Anything else is somebody's
// real data until proven otherwise.
const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
if (!local && !args.includes('--force')) {
  console.error('\n✗  MIGRATE_DATABASE_URL does not point at localhost.\n\n'
    + '   This deletes every tenant but the two seeds, without asking. If you\n'
    + '   really mean it on a remote database, pass --force.\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

/** Which tables hold a tenant's rows, deepest first. Derived, not listed — see erase-workspace.mjs. */
async function plan() {
  const direct = (await client.query(`
    select c.relname as t from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join information_schema.columns k
        on k.table_name = c.relname and k.table_schema = 'public' and k.column_name = 'business_id'
     where n.nspname = 'public' and c.relkind = 'r'`)).rows.map((r) => r.t);

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

  // `$1` is the array of doomed business ids.
  const indirect = {
    messages: 'conversation_id in (select id from conversations where business_id = any($1))',
    conversation_state: 'conversation_id in (select id from conversations where business_id = any($1))',
    client_channels: 'client_id in (select id from clients where business_id = any($1))',
    price_tiers: 'product_id in (select id from products where business_id = any($1))',
    product_aliases: 'product_id in (select id from products where business_id = any($1))',
    product_images: 'product_id in (select id from products where business_id = any($1))',
    email_confirmations: 'order_id in (select id from orders where business_id = any($1))',
    login_codes: 'login_id in (select id from logins where business_id = any($1))',
  };

  const ordered = [...new Set([...direct, ...Object.keys(indirect)])]
    .filter((t) => t !== 'businesses')
    .sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0) || a.localeCompare(b));

  const steps = ordered.map((t) => ({ table: t, run: `delete from ${t} where ${indirect[t] ?? 'business_id = any($1)'}` }));
  steps.push({ table: 'signup_invites (unlink)', run: 'update signup_invites set used_by = null where used_by = any($1)' });
  steps.push({ table: 'businesses', run: 'delete from businesses where id = any($1)' });
  return steps;
}

try {
  await client.connect();
  const doomed = (await client.query(
    `select id::text as id from businesses
      where id::text not like $1 || '%' and id <> $2`, [DEMO_PREFIX, SANDBOX])).rows.map((r) => r.id);

  if (doomed.length === 0) { say('  nothing to prune'); process.exit(0); }
  if (dry) {
    say(`  would prune ${doomed.length} tenant(s) left by earlier runs — keeping the demo and the sandbox`);
    process.exit(0);
  }

  const steps = await plan();
  await client.query('begin');
  try {
    let rows = 0;
    for (const s of steps) rows += (await client.query(s.run, [doomed])).rowCount ?? 0;
    await client.query('commit');
    say(`  pruned ${doomed.length} tenant(s) from earlier runs · ${rows} rows`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
} catch (e) {
  console.error(`\n✗  prune failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
