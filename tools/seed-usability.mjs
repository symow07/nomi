#!/usr/bin/env node
/**
 * Lay the usability workspace over the demo factory, then check the script's
 * own list (docs/USABILITY-SCRIPT.md "开始前的准备") line by line.
 *
 *   bash .claude/skills/run-nomi/smoke.sh                              # local instance
 *   MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi \
 *     node tools/seed-usability.mjs
 *
 * Idempotent: every write is guarded, so running it twice changes nothing.
 * Exit 0 only when every line of the list holds — "seeded" is not "ready".
 *
 * SQL and checks come from src/demo/usability.ts (rendered via tsx so the
 * fixture and the database can never drift apart). Needs the MIGRATE role:
 * RLS refuses the app role a row in another tenant's people table.
 *
 * LOCAL ONLY BY INTENT. It writes sixty conversations into the demo business;
 * production has no demo business to write into, and the tool refuses a host
 * that is not this machine rather than trusting that.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toolClient } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`refusing: this seeds a test workspace and runs against local Postgres only (host is '${host || '?'}')`);
  process.exit(2);
}

const ns = process.env.DEMO_NAMESPACE || undefined;
const rendered = JSON.parse(execFileSync('npx', ['-y', 'tsx', '-e', `
  import { usabilitySeedSql, usabilityChecks, usabilityBusinessId } from '${root}/src/demo/usability.ts';
  const ns = process.env.DEMO_NAMESPACE || undefined;
  console.log(JSON.stringify({ sql: usabilitySeedSql(ns), checks: usabilityChecks(ns), business: usabilityBusinessId(ns) }));
`], { encoding: 'utf8', cwd: root, env: { ...process.env, DEMO_NAMESPACE: ns ?? '' } }));

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect();
let failed = 0;
try {
  await client.query('begin');
  await client.query(rendered.sql);
  await client.query('commit');
  const n = (await client.query(
    `select (select count(*)::int from conversations where business_id = $1) as conversations,
            (select count(*)::int from clients where business_id = $1) as buyers,
            (select count(*)::int from drafts where business_id = $1 and status = 'pending') as drafts_waiting`,
    [rendered.business])).rows[0];
  console.log(`usability workspace seeded on ${rendered.business}: ${JSON.stringify(n)}\n`);
  console.log('开始前的准备 · Before you start');
  for (const c of rendered.checks) {
    const ok = (await client.query(c.sql)).rows[0]?.ok === true;
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${c.zh} · ${c.en}`);
  }
  console.log(failed ? `\n${failed} line(s) do not hold — not ready.` : '\nReady.');
} catch (e) {
  try { await client.query('rollback'); } catch { /* the connection may already be gone */ }
  console.error('seed failed:', e.message);
  failed = 1;
} finally {
  await client.end();
}
process.exit(failed ? 1 : 0);
