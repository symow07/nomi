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
 *
 * G20 — AN APPLIED MIGRATION THAT CHANGED ON DISK IS AN ERROR, NOT A NO-OP.
 * Pending work is chosen by version number, so editing an already-applied file
 * used to be silent: it ran on every clean database and on none of the old
 * ones. Each applied migration now carries the sha256 of what was applied
 * (0044); a file that no longer matches stops the run before anything else is
 * applied, and says which file and what to do about it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toolClient } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

// This runs as Railway's pre-deploy step, so a hang here is a deploy that
// never finishes. Ten minutes for one reply is far above any migration so far;
// each unit is its own transaction, so a closed connection leaves that unit
// unapplied and the chain stopped, never half-done.
const client = toolClient(url, { replyTimeoutMs: 10 * 60_000 });
await client.connect().catch((e) => { console.error(`migrate: ${e.message}`); process.exit(1); });

const one = async (q, params = []) => (await client.query(q, params)).rows[0];

async function inTx(label, sqlText) {
  await client.query('begin');
  try {
    await client.query(sqlText);
    await client.query('commit');
    console.log(`  applied ${label}`);
  } catch (e) {
    // A rollback on a connection that is already gone fails too; the error
    // worth reporting is the one that stopped the unit, not that one.
    await client.query('rollback').catch(() => {});
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
  // The column arrives in 0044, so on a database that predates it this runner
  // must still be able to read the table it is about to migrate.
  const checksumColumn = async () => (await one(
    `select 1 as ok from information_schema.columns
      where table_schema='public' and table_name='_migrations' and column_name='checksum'`,
  ))?.ok === 1;
  const appliedRows = hasMigrations
    ? (await client.query(await checksumColumn()
        ? 'select version, checksum from _migrations order by version'
        : 'select version, null::text as checksum from _migrations order by version')).rows
    : [];
  const applied = appliedRows.map((r) => Number(r.version));
  const recorded = new Map(appliedRows.map((r) => [Number(r.version), r.checksum ?? null]));

  const files = readdirSync(join(root, 'migrations'))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const pending = files.filter((f) => !applied.includes(Number(f.slice(0, 4))));

  const sha = (f) => createHash('sha256')
    .update(readFileSync(join(root, 'migrations', f))).digest('hex');

  // G20 — every applied migration whose checksum we know must still match. A
  // row with no checksum predates 0044 and is backfilled below, not judged.
  const changed = files.filter((f) => {
    const known = recorded.get(Number(f.slice(0, 4)));
    return known && known !== sha(f);
  });
  if (changed.length && !process.argv.includes('--status')) {
    console.error('\nThese migrations were already applied and have since changed on disk:\n');
    for (const f of changed) console.error(`  ${f}`);
    console.error(`
A database that ran the old text will never run the new one, and a clean
database will only ever run the new one — the two drift apart silently, which
is exactly what a migration is supposed to prevent.

Put the file back as it was applied and write a NEW migration for the change
(forward-only, ADR-0007). If the edit is genuinely cosmetic and you are sure
every database has the old text, re-record it deliberately:

  update _migrations set checksum = null where version = <version>;
`);
    process.exit(1);
  }

  if (process.argv.includes('--status')) {
    console.log(`baseline: ${hasBaseline ? 'present' : 'MISSING'}`);
    console.log(`applied:  ${applied.join(', ') || 'none'}`);
    console.log(`pending:  ${pending.join(', ') || 'none'}`);
    console.log(`changed:  ${changed.join(', ') || 'none'}   (applied, then edited on disk)`);
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

  // Record what was applied, and backfill the rows that predate 0044. Both are
  // the same statement: the file on disk is what this database ran.
  if (await checksumColumn()) {
    for (const f of files) {
      await client.query(
        'update _migrations set checksum = $2 where version = $1 and checksum is null',
        [Number(f.slice(0, 4)), sha(f)],
      );
    }
  }

  const count = await one('select count(*)::int as n from _migrations');
  console.log(`done — ${count.n} migrations recorded`);
} finally {
  await client.end();
}
