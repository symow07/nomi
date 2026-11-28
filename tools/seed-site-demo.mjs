#!/usr/bin/env node
/**
 * Seed the public site's demo workspace (an invented clothing brand) into a
 * LOCAL database, for the site's screenshots.
 *
 *   MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi \
 *     node tools/seed-site-demo.mjs
 *
 * Then start the server with PILOT_BUSINESS_ID set to the id it prints, and
 * the access code signs into it. Idempotent. Refuses any host that is not
 * this machine: nothing here may reach production.
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
  console.error(`refusing: the site demo seeds local Postgres only (host is '${host || '?'}')`);
  process.exit(2);
}

const rendered = JSON.parse(execFileSync('npx', ['-y', 'tsx', '-e', `
  import { siteDemoSql, SITE_DEMO_BUSINESS_ID } from '${root}/src/demo/siteDemo.ts';
  console.log(JSON.stringify({ sql: siteDemoSql(), business: SITE_DEMO_BUSINESS_ID }));
`], { encoding: 'utf8', cwd: root }));

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect();
try {
  await client.query('begin');
  await client.query(rendered.sql);
  await client.query('commit');
  const n = (await client.query(
    `select (select count(*)::int from conversations where business_id = $1) as conversations,
            (select count(*)::int from drafts where business_id = $1 and status = 'pending') as drafts_waiting`,
    [rendered.business])).rows[0];
  console.log(`site demo seeded: PILOT_BUSINESS_ID=${rendered.business} ${JSON.stringify(n)}`);
} catch (e) {
  try { await client.query('rollback'); } catch { /* gone */ }
  console.error('seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
