#!/usr/bin/env node
/**
 * CC-10 — what went wrong inside the app, for the operator reading an alert.
 *
 * Every failure path writes `app_errors` (0074): a page that crashed, a queue
 * job that failed, the process itself. One row per kind of error, with how
 * often and when; the alert e-mail carries a reference (`#7f3a9c2e1b4d`) that
 * finds its row here.
 *
 *   MIGRATE_DATABASE_URL=… node tools/errors.mjs                    # the latest 20, newest first
 *   MIGRATE_DATABASE_URL=… node tools/errors.mjs --limit 50
 *   MIGRATE_DATABASE_URL=… node tools/errors.mjs --since 24h        # seen in the last 24 hours (h or d)
 *   MIGRATE_DATABASE_URL=… node tools/errors.mjs --ref 7f3a9c2e1b4d # one, in full
 *
 * On Railway (the value never passes through a shell history):
 *
 *   railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/errors.mjs'
 *
 * Read-only. The messages were redacted before they were written down; this
 * prints them as they are. Exit 0 done · 1 failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';

/**
 * Exit only after what was printed has left the process — a pipe's writes are
 * asynchronous on POSIX, and `process.exit()` drops what is still queued (the
 * reason tools/check-reachable.mjs does the same).
 */
const exit = (code) => new Promise(() => {
  let open = 2;
  const done = () => { if (--open === 0) process.exit(code); };
  process.stdout.write('', done);
  process.stderr.write('', done);
});

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const usage = async (msg) => {
  console.error(`${msg}\n\n  node tools/errors.mjs [--limit <n>] [--since <n>h|<n>d] [--ref <reference>]\n`);
  await exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) await usage('MIGRATE_DATABASE_URL is not set.');

const limitRaw = flag('limit');
const limit = limitRaw === null ? 20 : Number(limitRaw);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) await usage('--limit must be a whole number from 1 to 500.');

const sinceRaw = flag('since');
const since = sinceRaw === null ? null : /^(\d{1,4})([hd])$/.exec(sinceRaw);
if (sinceRaw !== null && !since) await usage('--since takes hours or days: 24h, 7d.');
const sinceHours = since ? Number(since[1]) * (since[2] === 'd' ? 24 : 1) : null;

const refRaw = flag('ref');
const ref = refRaw === null ? null : refRaw.replace(/^#/, '').toLowerCase();
if (ref !== null && !/^[0-9a-f]{4,16}$/.test(ref)) await usage('--ref is the reference in the alert: 4 to 16 hex characters, with or without #.');

const at = (d) => (d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—');

const client = toolClient(url, { replyTimeoutMs: 30_000 });
const connected = await client.connect().then(() => true, (e) => { console.error(`\n✗  ${e.message}\n`); return false; });
if (!connected) await exit(1);
try {
  const where = [];
  const params = [];
  if (ref !== null) { params.push(`${ref}%`); where.push(`fingerprint like $${params.length}`); }
  if (sinceHours !== null) { params.push(sinceHours); where.push(`last_seen > now() - make_interval(hours => $${params.length})`); }
  params.push(limit);
  const { rows } = await client.query(`
    select fingerprint, "where", name, message, frame, route, business_id::text as business_id,
           count::text as count, first_seen, last_seen, last_alerted_at, alert_held_at
      from app_errors
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by last_seen desc
     limit $${params.length}`, params);

  if (rows.length === 0) {
    console.log(`\n  No errors recorded${sinceHours !== null ? ` in the last ${sinceRaw}` : ''}${ref !== null ? ` with reference ${ref}` : ''}.\n`);
  } else {
    console.log(`\n  ${rows.length} kind(s) of error, most recent first${sinceHours !== null ? `, seen in the last ${sinceRaw}` : ''}:\n`);
    for (const r of rows) {
      const told = r.alert_held_at ? `alert held since ${at(r.alert_held_at)} (hourly limit)`
        : r.last_alerted_at ? `alerted ${at(r.last_alerted_at)}` : 'not alerted';
      console.log(`  ${at(r.last_seen)}  ×${r.count}  ${r.where}${r.route ? `  ${r.route}` : ''}`);
      console.log(`     ${r.name}: ${r.message.replace(/\n/g, '\n     ')}`);
      console.log(`     ${[r.frame, `first ${at(r.first_seen)}`, told, r.business_id ? `workspace ${r.business_id}` : null, `#${r.fingerprint.slice(0, 12)}`]
        .filter(Boolean).join(' · ')}`);
      console.log('');
    }
  }
} catch (e) {
  const why = e instanceof Error ? e.message : String(e);
  console.error(`\n✗  ${/relation "app_errors" does not exist/.test(why) ? 'app_errors does not exist here: this database is before migration 0074.' : why}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
