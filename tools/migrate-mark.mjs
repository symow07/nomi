#!/usr/bin/env node
/**
 * Did the pre-deploy step run for this deploy? Reads the migrator's mark (tools/lib/migrate-mark.mjs) — read-only.
 *
 *   MIGRATE_DATABASE_URL=<url> node tools/migrate-mark.mjs                    # print the last mark
 *   MIGRATE_DATABASE_URL=<url> node tools/migrate-mark.mjs --expect <sha>     # exit 0 only if it names that commit
 *
 * Against production (docs/DEPLOYMENT.md, "After a deploy"), with the URL from the Postgres service, never on a
 * command line:
 *
 *   railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/migrate-mark.mjs --expect <merge sha>'
 *
 * Exit: 0 the mark names the commit (or no --expect and a mark exists) · 4 no mark, or one for another commit ·
 * 1 the database could not be read · 2 usage.
 */
import { toolClient } from './lib/db.mjs';
import { readMark, markProves } from './lib/migrate-mark.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--expect');
const expected = at >= 0 ? args[at + 1] : null;
if (at >= 0 && !/^[0-9a-f]{7,40}$/i.test(expected ?? '')) {
  console.error('usage: node tools/migrate-mark.mjs [--expect <commit sha, 7–40 hex>]');
  process.exit(2);
}
const url = process.env['MIGRATE_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!url) { console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required'); process.exit(2); }

const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect().catch((e) => { console.error(`migrate-mark: ${e.message}`); process.exit(1); });
let comment;
try {
  await client.query('begin read only');
  comment = (await client.query(`select obj_description('public._migrations'::regclass, 'pg_class') as c`)).rows[0]?.c ?? null;
  await client.query('commit');
} catch (e) {
  console.error(`migrate-mark: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

const mark = readMark(comment);
if (!mark) {
  console.log('No migrator mark: the migrator has not run here since marks began (or something else wrote the comment).');
  process.exit(4);
}
console.log(`Last migrator run: ${mark.at.toISOString()} · commit ${mark.commit} · deployment ${mark.deployment} · applied ${mark.applied} · recorded ${mark.recorded}`);
if (expected === null) process.exit(0);
if (markProves(mark, expected)) {
  console.log(`✓ The pre-deploy step ran for ${expected}.`);
  process.exit(0);
}
console.log(`✗ The last migrator run was for ${mark.commit}, not ${expected}: no proof the pre-deploy step ran for this deploy.`);
process.exit(4);
