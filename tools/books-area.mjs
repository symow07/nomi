#!/usr/bin/env node
/**
 * A6 (Phase 5, 0176) — the books, switched on or off for one workspace (`businesses.books_area`).
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/books-area.mjs --business <uuid>          # what it is now
 *   MIGRATE_DATABASE_URL=<admin url> node tools/books-area.mjs --business <uuid> --on     # or --off
 *
 * Off is the default: no /app/books address answers, nobody is offered the switch, no accountant can be added.
 * Switching off hides the books; it deletes nothing, and posted books stay the record (0169). There is no owner
 * switch yet: like the outreach area (tools/outreach-area.mjs), an owner turns on nothing they cannot see.
 *
 * BLOCKERS (docs/LAUNCH-CHECKLIST.md, "Before the books are switched on for ANY workspace"): while one is named here,
 * --on refuses, for every workspace. Remove an item in the commit that builds it.
 */
import { toolClient } from './lib/db.mjs';

const BLOCKERS = [
  'the owner\'s copy of their papers, and closure of a workspace holding papers (a workspace with documents cannot close yet)',
  'the public pages (/privacy, /data-deletion) describe the books: what is kept at closure, how long, why, and that the owner has their copy',
];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);

const usage = (msg) => { console.error(`${msg}\n\n  node tools/books-area.mjs --business <uuid> [--on | --off]\n`); process.exit(2); };

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
if (has('on') && has('off')) usage('--on or --off, not both.');
const want = has('on') ? true : has('off') ? false : null;
if (want === true && BLOCKERS.length > 0) {
  console.error(`\n✗  The books are not switched on for any workspace yet. Still to build (docs/LAUNCH-CHECKLIST.md):\n${
    BLOCKERS.map((b) => `     · ${b}`).join('\n')}\n\n   Nothing was changed.\n`);
  process.exit(3);
}

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const biz = (await client.query('select id::text as id, name, books_area from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}.\n`); process.exit(1); }
  if (want === null) {
    console.log(`\n  ${biz.name}: books ${biz.books_area ? 'SHOWN' : 'hidden'}\n`);
  } else if (biz.books_area === want) {
    console.log(`\n  ${biz.name}: books already ${want ? 'shown' : 'hidden'}. Nothing changed.\n`);
  } else {
    await client.query('update businesses set books_area = $2 where id = $1', [business, want]);
    console.log(`\n✓  ${biz.name}: books now ${want ? 'SHOWN' : 'hidden'}.`);
    console.log('   Pages pick it up within a minute; nothing was deleted (switched off, the books stay, unseen).\n');
  }
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
