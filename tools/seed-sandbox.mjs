#!/usr/bin/env node
/**
 * Seed the M12.2 pilot sandbox tenant — separate from the demo factory and
 * idempotent by construction. Ordinary PostgreSQL; run with an admin URL so it
 * bypasses RLS (the app role cannot insert a business/product).
 *
 *   node tools/seed-sandbox.mjs
 *
 * SQL comes from the single source of truth: src/demo/sandbox.ts (rendered via
 * tsx so the fixture and the database can never drift apart).
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
  import { sandboxSeedSql } from '${root}/src/demo/sandbox.ts';
  console.log(sandboxSeedSql());
`], { encoding: 'utf8', cwd: root });

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('begin');
  await client.query(sqlText);
  await client.query('commit');
  const counts = (await client.query(`
    select (select count(*) from products where business_id = '5a4d0000-0000-4000-8000-0000000000b1') as products,
           (select count(*) from price_tiers pt join products p on p.id = pt.product_id
             where p.business_id = '5a4d0000-0000-4000-8000-0000000000b1') as tiers,
           (select count(*) from channel_credentials where business_id = '5a4d0000-0000-4000-8000-0000000000b1') as credentials
  `)).rows[0];
  console.log('sandbox tenant seeded:', JSON.stringify(counts), '(credentials MUST be 0 — unroutable by design)');
} catch (e) {
  await client.query('rollback');
  console.error('seed failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
