#!/usr/bin/env node
/**
 * Portable migration runner — ordinary PostgreSQL, no Supabase anything.
 *
 *   node tools/migrate.mjs                # apply bootstrap + pending migrations
 *   node tools/migrate.mjs --status       # show applied vs pending
 *
 * Connection: MIGRATE_DATABASE_URL (admin/DDL role) falling back to
 * DATABASE_URL. Runtime and migration credentials should differ in
 * production — the runtime role (nomi_app) cannot run DDL.
 *
 * Order on a clean database:
 *   1. supabase/schema.sql        — baseline tables (plain SQL; extensions
 *                                   pgcrypto + pg_trgm; the filename is
 *                                   historical, the content is portable)
 *   2. migrations/0001..NNNN      — each records itself in _migrations
 *
 * supabase/rls_policies.sql is deliberately NOT applied on plain PostgreSQL:
 * it hardens Supabase's `anon`/`authenticated` roles, which do not exist
 * elsewhere — the threat it guards is Supabase-specific. Tenant isolation for
 * the app comes from migration 0005 (nomi_app role + RLS policies), which
 * IS applied. If those roles exist (i.e. we're pointed at Supabase), it is
 * applied for defence in depth.
 *
 * Each unit applies inside one transaction: failure rolls back that unit and
 * stops the chain. pgvector is optional by design (0007 degrades to
 * trigram-only with a NOTICE).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const one = async (q, params = []) => (await client.query(q, params)).rows[0];

async function inTx(label, sqlText) {
  await client.query('begin');
  try {
    await client.query(sqlText);
    await client.query('commit');
    console.log(`  applied ${label}`);
  } catch (e) {
    await client.query('rollback');
    console.error(`  FAILED ${label}: ${e.message}`);
    throw e;
  }
}

try {
  const hasBaseline = (await one(
    `select 1 as ok from information_schema.tables where table_schema='public' and table_name='businesses'`,
  ))?.ok === 1;
  const hasMigrations = (await one(
    `select 1 as ok from information_schema.tables where table_schema='public' and table_name='_migrations'`,
  ))?.ok === 1;
  const applied = hasMigrations
    ? (await client.query('select version from _migrations order by version')).rows.map((r) => Number(r.version))
    : [];

  const files = readdirSync(join(root, 'migrations'))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const pending = files.filter((f) => !applied.includes(Number(f.slice(0, 4))));

  if (process.argv.includes('--status')) {
    console.log(`baseline: ${hasBaseline ? 'present' : 'MISSING'}`);
    console.log(`applied:  ${applied.join(', ') || 'none'}`);
    console.log(`pending:  ${pending.join(', ') || 'none'}`);
    process.exit(0);
  }

  if (!hasBaseline) {
    console.log('clean database — applying baseline schema');
    await inTx('supabase/schema.sql (baseline)', readFileSync(join(root, 'supabase/schema.sql'), 'utf8'));
    const supabaseRoles = (await one(`select 1 as ok from pg_roles where rolname = 'anon'`))?.ok === 1;
    if (supabaseRoles) {
      await inTx('supabase/rls_policies.sql (Supabase-role hardening)',
        readFileSync(join(root, 'supabase/rls_policies.sql'), 'utf8'));
    } else {
      console.log('  skipped rls_policies.sql — no Supabase roles here (plain PostgreSQL); 0005 provides tenant RLS');
    }
  }

  for (const f of pending) {
    await inTx(f, readFileSync(join(root, 'migrations', f), 'utf8'));
  }

  const count = await one('select count(*)::int as n from _migrations');
  console.log(`done — ${count.n} migrations recorded`);
} finally {
  await client.end();
}
