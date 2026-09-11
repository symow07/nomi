#!/usr/bin/env node
/**
 * Seed the demo factory (义乌宏发日用品厂) — separate from schema migration,
 * idempotent by construction (all inserts guarded). Ordinary PostgreSQL.
 *
 *   node tools/seed-demo.mjs
 *
 * SQL comes from the single sources of truth: src/demo/factory.ts and
 * src/demo/trust.ts (rendered via tsx so the fixtures and the database can
 * never drift apart).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

// M22 — DEMO_NAMESPACE seeds the same factory under a different id block, so a
// test run can have a tenant of its own instead of mutating the shared demo.
const sqlText = execFileSync('npx', ['-y', 'tsx', '-e', `
  import { demoSeedSql, DEMO_NAMESPACE } from '${root}/src/demo/factory.ts';
  import { demoTrustSeedSql } from '${root}/src/demo/trust.ts';
  const ns = process.env.DEMO_NAMESPACE || DEMO_NAMESPACE;
  console.log(demoSeedSql(ns)); console.log(demoTrustSeedSql(ns));
`], { encoding: 'utf8', cwd: root });

const NS = process.env.DEMO_NAMESPACE || 'de300000';
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  await client.query(sqlText);
  await client.query('commit');
  const counts = (await client.query(`
    select (select count(*) from products where business_id = '${NS}-0000-4000-8000-0000000000b1') as products,
           (select count(*) from clients  where business_id = '${NS}-0000-4000-8000-0000000000b1') as buyers,
           (select count(*) from conversations where business_id = '${NS}-0000-4000-8000-0000000000b1') as conversations,
           (select count(*) from capability_events where business_id = '${NS}-0000-4000-8000-0000000000b1') as trust_events
  `)).rows[0];
  // G21 — A BUYER WITH NO NUMBER IS A SEED THAT LOOKS COMPLETE AND IS NOT.
  // `client_channels` is unique on (channel, channel_user_id) across every
  // tenant, so a namespace whose phone block collides with one already seeded
  // loses its rows to `on conflict do nothing` — and every consequence is
  // silent: replies queue nothing, windows read as expired, and once messaging
  // is on, each buyer reads as a number that is not on her list. Loud here
  // instead.
  const unreachable = (await client.query(`
    select cl.display_name as name
      from clients cl
      left join client_channels cc on cc.client_id = cl.id and cc.channel = 'whatsapp'
     where cl.business_id = '${NS}-0000-4000-8000-0000000000b1' and cc.client_id is null
  `)).rows;
  if (unreachable.length) {
    console.error(`\n  seeded ${unreachable.length} buyer(s) with no WhatsApp number: ${
      unreachable.map((r) => r.name).join(', ')}`);
    console.error('  their numbers are already held by another tenant — seed under a different DEMO_NAMESPACE.\n');
    process.exit(1);
  }
  console.log('demo factory seeded:', JSON.stringify(counts));
} catch (e) {
  await client.query('rollback');
  console.error('seed failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
