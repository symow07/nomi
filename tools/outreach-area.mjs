#!/usr/bin/env node
/**
 * D — show or hide the outreach area (sequences, prospects, writing first) for
 * ONE workspace. Off for every new workspace (migration 0068); on for the
 * pilot's. There is deliberately no owner-facing switch: an owner turns
 * nothing on that they cannot see, and a switch would itself be a link to a
 * hidden area. This is the operator's decision, made here.
 *
 *   MIGRATE_DATABASE_URL=… node tools/outreach-area.mjs --business <uuid>          # show the state
 *   MIGRATE_DATABASE_URL=… node tools/outreach-area.mjs --business <uuid> --on     # show the area
 *   MIGRATE_DATABASE_URL=… node tools/outreach-area.mjs --business <uuid> --off    # hide it
 *
 * Hiding pauses what was running: `outreachFacts` reads this flag, so no first
 * message, enrolment or due step leaves while it is off, and nothing is
 * deleted. The web layer's per-business cache forgets within a minute.
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);

const usage = (msg) => { console.error(`${msg}\n\n  node tools/outreach-area.mjs --business <uuid> [--on | --off]\n`); process.exit(2); };

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
if (has('on') && has('off')) usage('--on or --off, not both.');
const want = has('on') ? true : has('off') ? false : null;

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const biz = (await client.query('select id::text as id, name, outreach_area from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}.\n`); process.exit(1); }
  if (want === null) {
    console.log(`\n  ${biz.name}: outreach area ${biz.outreach_area ? 'SHOWN' : 'hidden'}\n`);
  } else if (biz.outreach_area === want) {
    console.log(`\n  ${biz.name}: outreach area already ${want ? 'shown' : 'hidden'}. Nothing changed.\n`);
  } else {
    await client.query('update businesses set outreach_area = $2 where id = $1', [business, want]);
    console.log(`\n✓  ${biz.name}: outreach area now ${want ? 'SHOWN' : 'hidden'}.`);
    console.log('   Pages pick it up within a minute; nothing was deleted.\n');
  }
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
