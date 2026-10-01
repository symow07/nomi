#!/usr/bin/env node
/**
 * G7 — KS4 and KS6's stop flag: the operator's switches, without raw SQL.
 *
 *   railway run --service nomi -- node tools/ops-flags.mjs                                   # what is on
 *   railway run --service nomi -- node tools/ops-flags.mjs --set global_silence --all --reason "<why>" --by "<you>" --yes
 *   railway run --service nomi -- node tools/ops-flags.mjs --set force_draft --business <uuid> --reason "<why>" --by "<you>" --yes
 *   railway run --service nomi -- node tools/ops-flags.mjs --set connections_off --all --reason "<why>" --by "<you>" --yes
 *   railway run --service nomi -- node tools/ops-flags.mjs --clear connections_off --all --yes
 *
 * Flags: global_silence (the assistant says nothing; customers go to a person),
 * force_draft (six rows, one per capability: every reply waits), connections_off
 * (no Page or WhatsApp can be connected), practice_off. --all is everyone;
 * --business one workspace. Dry run unless --yes. Reads MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

/** Every row of every workspace: a role row security filters would see only some, and act on them. */
async function requireAdmin(client) {
  const r = (await client.query(`select rolbypassrls or rolsuper as all_rows from pg_roles where rolname = current_user`)).rows[0];
  if (r?.all_rows) return;
  const owner = (await client.query(`select tableowner = current_user as owns from pg_tables where tablename = 'businesses'`)).rows[0];
  if (owner?.owns) return;
  console.error('✗  This database role is subject to row-level security. Use the admin URL (MIGRATE_DATABASE_URL). Nothing was changed.');
  process.exit(2);
}
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const has = (name) => process.argv.includes(name);

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { OPERATOR_FLAGS, setOperatorFlag, clearOperatorFlag } = await import('../dist/db/operator.js');
const set = arg('--set'); const clear = arg('--clear'); const yes = has('--yes');
const business = arg('--business'); const all = has('--all'); const reason = arg('--reason'); const by = arg('--by');
const flag = set ?? clear;
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  await requireAdmin(client);
  if (!flag) {
    const on = (await client.query(`select f.flag, f.capability, coalesce(b.name, 'everyone') as who, f.set_by, f.set_at, f.reason
                                      from ops_flags f left join businesses b on b.id = f.business_id
                                     where f.cleared_at is null order by f.set_at`)).rows;
    console.log(on.length ? `${on.length} flag row(s) on:` : 'No flag is on.');
    for (const r of on) console.log(`  · ${r.flag}${r.capability ? ` (${r.capability})` : ''} — ${r.who} — since ${r.set_at.toISOString()} by ${r.set_by}: ${r.reason}`);
    process.exit(0);
  }
  if (!OPERATOR_FLAGS.includes(flag) || (set && clear) || (!business && !all) || (business && all) || (set && (!reason || !by))) {
    console.error(`Usage: --set|--clear <${OPERATOR_FLAGS.join('|')}> --business <uuid> | --all [--reason "<why>" --by "<you>"] [--yes]`);
    process.exit(2);
  }
  const who = all ? 'everyone' : business;
  if (!yes) { console.log(`Dry run: would ${set ? 'set' : 'clear'} ${flag} for ${who}${flag === 'force_draft' && set ? ' (six rows, one per capability)' : ''}. Add --yes.`); process.exit(0); }
  const n = set
    ? await setOperatorFlag(client, { flag, businessId: all ? null : business, reason, by })
    : await clearOperatorFlag(client, { flag, businessId: all ? null : business });
  console.log(`✓ ${flag} ${set ? 'set' : 'cleared'} for ${who}: ${n} row(s).`);
} finally {
  await client.end().catch(() => undefined);
}
