#!/usr/bin/env node
/**
 * Phase 9 — the installation's own checks before a workspace goes live: a
 * backup that restores, and the keys changed since the build. Going live
 * still requires both (`loadPilotReadiness`, `activationPreconditions`); what
 * changed is who answers. They are the operator's chores, so they are stamped
 * here — the owner's Getting ready shows one row, "Checked by Nomi", with no
 * button, and the owner's attest route no longer takes them.
 *
 *   MIGRATE_DATABASE_URL=… node tools/installation-checks.mjs --business <uuid>                     # show
 *   MIGRATE_DATABASE_URL=… node tools/installation-checks.mjs --business <uuid> --backup-tested     # stamp now
 *   MIGRATE_DATABASE_URL=… node tools/installation-checks.mjs --business <uuid> --secrets-rotated   # stamp now
 *
 * A scheduled backup whose drill passed (`backup_runs`) already counts as
 * tested; `--backup-tested` is for an installation without the job.
 *
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);

const usage = (msg) => {
  console.error(`${msg}\n\n  node tools/installation-checks.mjs --business <uuid> [--backup-tested] [--secrets-rotated]\n`);
  process.exit(2);
};

const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) usage('MIGRATE_DATABASE_URL is not set.');
const business = flag('business');
if (!business || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(business)) usage('--business must be a uuid.');
const cols = [has('backup-tested') ? 'backup_tested_at' : null, has('secrets-rotated') ? 'secrets_rotated_at' : null]
  .filter((c) => c !== null);

const when = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'not yet');

const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
try {
  const biz = (await client.query('select id::text as id, name from businesses where id = $1', [business])).rows[0];
  if (!biz) { console.error(`\n✗  No business ${business}.\n`); process.exit(1); }
  for (const col of cols) {
    // The column names come from the fixed list above, never from the command line.
    await client.query(
      `insert into onboarding_state (business_id, ${col}) values ($1, now())
       on conflict (business_id) do update set ${col} = now(), updated_at = now()`, [business]);
  }
  const r = (await client.query(
    `select (select backup_tested_at from onboarding_state where business_id = $1) as backup,
            (select secrets_rotated_at from onboarding_state where business_id = $1) as keys,
            (select uploaded_at from backup_runs where drill_passed order by uploaded_at desc limit 1) as drill`,
    [business])).rows[0];
  console.log(`\n${cols.length ? '✓' : ' '}  ${biz.name}`);
  console.log(`   backup tested:   ${r.drill ? `scheduled drill passed ${when(r.drill)}` : when(r.backup)}`);
  console.log(`   keys changed:    ${when(r.keys)}\n`);
} catch (e) {
  console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
