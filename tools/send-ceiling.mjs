#!/usr/bin/env node
/**
 * CEIL — show or set how many of the assistant's messages ONE workspace may
 * send in a day (`businesses.daily_send_ceiling`, 0085). A workspace made from
 * 0085 on starts at 50; the ones that existed kept 200. The owner's own
 * replies are never counted. There is no owner switch: raising it is the
 * operator's decision, made here, once a workspace has shown it sends to people
 * who wrote to it — and lowering it is what the Meta-errors alert suggests.
 *
 *   MIGRATE_DATABASE_URL=… node tools/send-ceiling.mjs --business <uuid>            # show it
 *   MIGRATE_DATABASE_URL=… node tools/send-ceiling.mjs --business <uuid> --set 200  # set it (1–10000)
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const usage = (msg) => { console.error(`${msg}\n\n  node tools/send-ceiling.mjs --business <uuid> [--set <1–10000>]\n`); process.exit(2); };

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
const raw = flag('set');
const want = raw === null ? null : Number(raw);
if (raw !== null && (!Number.isInteger(want) || want < 1 || want > 10000)) usage('--set must be a whole number from 1 to 10000.');

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const biz = (await client.query('select name, daily_send_ceiling as ceiling from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}. Nothing changed.\n`); process.exit(1); }
  if (want === null) {
    console.log(`\n  ${biz.name}: at most ${biz.ceiling} of the assistant's messages a day.\n`);
  } else if (biz.ceiling === want) {
    console.log(`\n  ${biz.name}: already ${want} a day. Nothing changed.\n`);
  } else {
    await client.query('update businesses set daily_send_ceiling = $2 where id = $1', [business, want]);
    console.log(`\n✓  ${biz.name}: ${biz.ceiling} → ${want} of the assistant's messages a day. The next send reads it.\n`);
  }
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
