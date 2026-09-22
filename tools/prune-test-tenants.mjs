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
 * ── WHERE IT WILL RUN, AND THERE IS NO WAY ROUND IT ──────────────────────────
 *
 * Loopback only, and never with NODE_ENV=production. THERE IS NO OVERRIDE FLAG
 * — this once had one, and that was the wrong shape for this file. A tool whose
 * whole job is to delete every tenant but two, without asking twice, must not
 * carry its own way past the one check standing between it and somebody's
 * customers. An escape hatch on a guard like this is not a convenience; it is
 * the thing that gets typed at 2 a.m. while copying a command out of a
 * terminal history.
 *
 * If a remote database ever genuinely needs cleaning, that is a different job
 * with a different tool and a person deciding it — the way
 * `erase-workspace.mjs` requires an open `deletion_requests` row before it
 * touches anything.
 *
 * Usage:
 *   MIGRATE_DATABASE_URL=… node tools/prune-test-tenants.mjs [--dry-run] [--quiet]
 */

import { toolClient } from './lib/db.mjs';
import { pathToFileURL } from 'node:url';

const DEMO_PREFIX = 'de300000';
const SANDBOX = '5a4d0000-0000-4000-8000-0000000000b1';

/**
 * Why this must not run, or null when it may. Pure, and exported so a test can
 * hold the guard itself rather than the shape of the source around it.
 *
 * `::1` is loopback exactly as `127.0.0.1` is — the same machine, by
 * definition — so it is admitted and named here rather than left to look like
 * an oversight. Every other host, including anything resolving off this
 * machine, is somebody's data until proven otherwise.
 */
export function refusalFor(url, env = {}) {
  if (!url) {
    return 'MIGRATE_DATABASE_URL is not set. The app role cannot delete; this needs the migration role.';
  }
  if (env['NODE_ENV'] === 'production') {
    return 'NODE_ENV is production. This tool deletes every tenant but two and never runs there.';
  }
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'MIGRATE_DATABASE_URL is not a URL this tool can read a host out of.';
  }
  // `new URL` KEEPS the brackets on an IPv6 literal — hostname is "[::1]", not
  // "::1" — so they come off here. (Written the other way round first, and the
  // test that admits loopback is what said so.)
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const loopback = bare === '127.0.0.1' || bare === 'localhost' || bare === '::1';
  if (!loopback) {
    return `MIGRATE_DATABASE_URL points at "${host}", which is not this machine.\n`
      + '   This deletes every tenant but the demo and the sandbox, without asking\n'
      + '   twice. There is no override: if a remote database needs cleaning, that\n'
      + '   is a decision a person makes with a different tool.';
  }
  return null;
}

/** Which tables hold a tenant's rows, deepest first. Derived, not listed — see erase-workspace.mjs. */
async function plan(client) {
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

  /*
   * AND THE WORK QUEUED AGAINST THEM. Found by ten consecutive full-suite runs:
   * four went red, always on day-one, always with
   *   insert or update on "message_fragments" violates foreign key
   *   "message_fragments_business_id_fkey"
   * for a message nobody in that run had sent.
   *
   * They were inbound jobs from EARLIER runs, still `created` or `retry` in
   * pgboss.job, whose tenant this tool had deleted. A new run's worker picks
   * them up, they fail against the missing business, they are retried with
   * backoff, and the run's own message waits behind them — past the
   * thirty-second deadline, on a machine that has run the suite before and
   * nowhere else. Twelve such jobs were queued here.
   *
   * Deleting a tenant and leaving work addressed to it is half a cleanup, and
   * the half that was missing is the one that made the suite look flaky. The
   * second clause also takes the jobs orphaned by every run before this fix.
   * Only unfinished states: a completed or failed row is a record, not work.
   */
  steps.push({
    table: 'pgboss.job (queued against a tenant that is gone)',
    run: `delete from pgboss.job
           where state in ('created', 'retry', 'active')
             and data ? 'businessId'
             and (data->>'businessId' = any($1)
                  or not exists (select 1 from businesses b where b.id::text = data->>'businessId'))`,
    onlyIf: "select to_regclass('pgboss.job') is not null as ok",
  });
  return steps;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const quiet = args.includes('--quiet');
  const say = (...a) => { if (!quiet) console.log(...a); };

  const url = process.env['MIGRATE_DATABASE_URL'];
  const refused = refusalFor(url, process.env);
  if (refused) {
    console.error(`\n✗  ${refused}\n`);
    process.exit(url ? 1 : 2);
  }

  const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });
  try {
    await client.connect();
    const doomed = (await client.query(
      `select id::text as id from businesses
        where id::text not like $1 || '%' and id <> $2`, [DEMO_PREFIX, SANDBOX])).rows.map((r) => r.id);

    if (doomed.length === 0) { say('  nothing to prune'); return; }
    if (dry) {
      say(`  would prune ${doomed.length} tenant(s) left by earlier runs — keeping the demo and the sandbox`);
      return;
    }

    const steps = await plan(client);
    await client.query('begin');
    try {
      let rows = 0;
      for (const s of steps) {
        // A step may name a table this database has not created yet — pgboss's,
        // before anything has ever queued a job here.
        if (s.onlyIf && !(await client.query(s.onlyIf)).rows[0]?.ok) continue;
        rows += (await client.query(s.run, [doomed])).rowCount ?? 0;
      }
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
}

// Only when RUN. Importing this file — which a test does, to exercise the
// guard above — must never open a connection or delete anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
