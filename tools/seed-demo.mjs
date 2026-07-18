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

const sqlText = execFileSync('npx', ['-y', 'tsx', '-e', `
  import { demoSeedSql } from '${root}/src/demo/factory.ts';
  import { demoTrustSeedSql } from '${root}/src/demo/trust.ts';
  console.log(demoSeedSql()); console.log(demoTrustSeedSql());
`], { encoding: 'utf8', cwd: root });

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  await client.query(sqlText);
  await client.query('commit');
  const counts = (await client.query(`
    select (select count(*) from products where business_id = 'de300000-0000-4000-8000-0000000000b1') as products,
           (select count(*) from clients  where business_id = 'de300000-0000-4000-8000-0000000000b1') as buyers,
           (select count(*) from conversations where business_id = 'de300000-0000-4000-8000-0000000000b1') as conversations,
           (select count(*) from capability_events where business_id = 'de300000-0000-4000-8000-0000000000b1') as trust_events
  `)).rows[0];
  console.log('demo factory seeded:', JSON.stringify(counts));
} catch (e) {
  await client.query('rollback');
  console.error('seed failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
