#!/usr/bin/env node
/**
 * A2.4 (0172) — THE BOOKS A CLOSED WORKSPACE LEFT, ERASED WHEN THE LAW NO LONGER NEEDS THEM.
 *
 * A workspace that closed with posted books keeps them, switched off, until `books_held_until` (the end of its last
 * fiscal year with a posting, plus the years its country's law sets: `books_retention`). Its owner downloaded a copy
 * before closing could finish. This tool erases what is held once that date has passed: the books, and the
 * business row they hang on. It is the "then erased" of PHASE-5.md §6.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/books-retention.mjs                  # what is due (changes nothing)
 *   MIGRATE_DATABASE_URL=<admin url> node tools/books-retention.mjs --yes --by "<your name>"
 *
 * Each workspace in its own transaction, as an operator's purge (0169 `books_purge_allowed`), with a line in the
 * erasure ledger (ids and counts only). A workspace whose date has not passed is never touched, whatever is asked.
 * The URL comes from the environment only (tests/parity/no-secret-in-argv.test.ts).
 *
 * A4 (0174) — documents kept in a DIRECTORY store are files: they are removed with their workspace, after the
 * transaction that erased their rows commits. Give the tool the installation's DOCUMENT_STORES; a workspace with
 * files in a store it cannot find is left as it is, by name.
 */
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const yes = args.includes('--yes');
const by = flag('by');
const usage = (msg) => {
  console.error(`${msg}\n\n  node tools/books-retention.mjs [--yes --by "<your name>"]\n`);
  process.exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set (the admin role).');
if (yes && (!by || by.trim().length === 0 || by.length > 120)) usage('--yes needs --by "<your name>": the ledger says who erased.');

let stores = { default: 'database' };
try { if (process.env['DOCUMENT_STORES']) stores = JSON.parse(process.env['DOCUMENT_STORES']); } catch { usage('DOCUMENT_STORES is not JSON.'); }
const dirOf = (residency) => {
  const v = stores[residency];
  const m = typeof v === 'string' ? /^directory:(.+)$/.exec(v) : null;
  return m && isAbsolute(m[1]) ? m[1] : null;
};

const client = toolClient(url, { replyTimeoutMs: 5 * 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
let failed = 0;
try {
  const due = (await client.query('select business_id::text as id, name, held_until::text as until from books_retention_due()')).rows;
  if (due.length === 0) { console.log('\n  nothing is due: no closed workspace\'s books are past their legal date\n'); process.exit(0); }
  for (const d of due) {
    const counts = (await client.query(`select
        (select count(*)::int from journal_entries where business_id = $1) as entries,
        (select count(*)::int from journal_lines where business_id = $1) as lines,
        (select count(*)::int from parties where business_id = $1) as parties`, [d.id])).rows[0];
    console.log(`  ${d.name} (${d.id}): held until ${d.until} · ${counts.entries} entries, ${counts.lines} lines, ${counts.parties} parties`);
    const files = (await client.query(`select id::text as id, residency from documents where business_id = $1 and store = 'directory'`, [d.id])).rows;
    const lost = files.filter((f) => dirOf(f.residency) === null);
    if (files.length) console.log(`    ${files.length} document file(s) in directory stores`);
    if (lost.length) {
      failed++;
      console.error(`    ✗  ${lost.length} document file(s) are in a store this run has no DOCUMENT_STORES entry for (${[...new Set(lost.map((f) => f.residency))].join(', ')}) — left as it is`);
      continue;
    }
    if (!yes) continue;
    await client.query('begin');
    try {
      await client.query(`select set_config('nomi.books_purge', 'books-retention', true)`);
      // Re-read under the lock: the date must still have passed, and the workspace still be one that closed.
      const held = (await client.query(`select 1 from businesses where id = $1 and books_held_until < current_date and not is_active for update`, [d.id])).rowCount;
      if (!held) throw new Error('no longer due — left as it is');
      await client.query('delete from businesses where id = $1', [d.id]);
      await client.query(`insert into erasure_ledger (kind, business_id, via, by_who, counts) values ('workspace', $1, 'operator', $2, $3)`,
        [d.id, by.trim(), JSON.stringify({ books_after_legal_date: counts })]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      failed++;
      console.error(`    ✗  not erased: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // After the commit: the rows are gone, so the files are only sealed bytes nothing names. Removed now; a file
    // that will not go is said, by path, for the operator.
    try {
      for (const f of files) await rm(join(dirOf(f.residency), d.id, `${f.id}.sealed`), { force: true });
      for (const r of new Set(files.map((f) => f.residency))) await rm(join(dirOf(r), d.id), { recursive: true, force: true });
      console.log('    erased');
    } catch (e) {
      failed++;
      console.error(`    ✗  erased from the database; a document file would not go: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!yes) console.log('\n  a dry run: nothing was changed. Add --yes --by "<your name>" to erase these.\n');
} finally {
  await client.end().catch(() => {});
}
process.exit(failed ? 1 : 0);
