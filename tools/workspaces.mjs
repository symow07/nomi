#!/usr/bin/env node
/**
 * G7 — the operator's list of workspaces, and the ramp gate lifted for a pilot.
 *
 *   railway run --service nomi -- node tools/workspaces.mjs                  # every workspace
 *   railway run --service nomi -- node tools/workspaces.mjs --self-serve     # those that signed themselves up
 *   railway run --service nomi -- node tools/workspaces.mjs --earn <uuid> --by "<you>" --yes     # sending alone opened (G4)
 *   railway run --service nomi -- node tools/workspaces.mjs --unearn <uuid> --by "<you>" --yes
 *
 * Lists name, kind, country, when it signed up, whether sending alone is
 * earned (and by whom), active or suspended, its Page and WhatsApp, today's
 * allowance used, and the last customer message. Never a customer, never a
 * message. Reads MIGRATE_DATABASE_URL. Dry run unless --yes.
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
const { listWorkspaces, setEarned } = await import('./lib/operator.mjs');
const earn = arg('--earn'); const unearn = arg('--unearn'); const by = arg('--by'); const yes = has('--yes');
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  await requireAdmin(client);
  const id = earn ?? unearn;
  if (id) {
    if (!by) { console.error('Usage: --earn|--unearn <uuid> --by "<you>" [--yes]'); process.exit(2); }
    if (!yes) { console.log(`Dry run: would ${earn ? 'open' : 'close'} sending alone for ${id}. Add --yes.`); process.exit(0); }
    const r = await setEarned(client, { businessId: id, by, earned: Boolean(earn) });
    console.log(r === 'earned' || r === 'unearned' ? `✓ ${id}: ${r}` : `✗ ${id}: ${r.replace(/_/g, ' ')}`);
    process.exit(r === 'earned' || r === 'unearned' ? 0 : 1);
  }
  const rows = await listWorkspaces(client, { selfServeOnly: has('--self-serve') });
  const d = (x) => (x ? x.toISOString().slice(0, 10) : '—');
  console.log(`${rows.length} workspace(s).`);
  for (const w of rows) {
    console.log(`  · ${w.name} (${w.id}) — ${w.kind ?? '—'}, ${w.country ?? '—'} — signed up ${d(w.signedUpAt)}`
      + ` — alone: ${w.signedUpAt ? (w.earnedAt ? `earned ${d(w.earnedAt)}${w.earnedBy ? ` by ${w.earnedBy}` : ''}` : 'not earned') : 'not gated'}`
      + ` — ${w.suspended ? 'SUSPENDED' : w.active ? 'active' : 'switched off'}`
      + ` — Page: ${w.page ? `${w.page} (${w.pageState})` : '—'} — WhatsApp: ${w.whatsapp ? 'yes' : '—'}`
      + ` — today: ${w.usedToday === null ? 'no cap' : `${w.usedToday}%`} — last customer: ${d(w.lastCustomerAt)}`);
  }
} finally {
  await client.end().catch(() => undefined);
}
