#!/usr/bin/env node
/**
 * G7 — KS2 and KS3: suspend a workspace completely, or every workspace that
 * signed itself up; --restore undoes exactly what the suspension did.
 *
 *   railway run --service nomi -- node tools/suspend-workspace.mjs --business <uuid> --reason "<why>" --by "<you>"          # dry run
 *   railway run --service nomi -- node tools/suspend-workspace.mjs --business <uuid> --reason "<why>" --by "<you>" --yes
 *   railway run --service nomi -- node tools/suspend-workspace.mjs --all-self-serve --reason "<why>" --by "<you>" --yes      # KS3
 *   railway run --service nomi -- node tools/suspend-workspace.mjs --business <uuid> --restore --by "<you>" --yes
 *
 * Suspending: the workspace's own global_silence (no model, no assistant send,
 * every customer to a person), its Page marked 'refused' (never archived: an
 * archived Page would fall back to the installation's own), is_active off
 * (nobody signs in), and the Page unsubscribed at Meta. The installation's
 * own workspace (PILOT_BUSINESS_ID) and practice copies are refused.
 *
 * Reads MIGRATE_DATABASE_URL (admin), PILOT_BUSINESS_ID, and — for the Page
 * calls — CREDENTIAL_KEY and META_GRAPH_API_VERSION, from the environment;
 * never from the command line. Prints names and ids, never a token. Needs
 * `npm run build` first. The Page calls have NEVER RUN AGAINST LIVE META.
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
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set (run inside `railway run --service nomi`). Nothing was changed.'); process.exit(2); }
const yes = has('--yes'); const restore = has('--restore'); const all = has('--all-self-serve');
const business = arg('--business'); const reason = arg('--reason'); const by = arg('--by');
if ((!business && !all) || (business && all) || !by || (!restore && !reason)) {
  console.error('Usage: --business <uuid> | --all-self-serve, --reason "<why>" (to suspend), --by "<you>", [--restore], [--yes]');
  process.exit(2);
}
const { suspendWorkspace, restoreWorkspace, listWorkspaces } = await import('./lib/operator.mjs');
let graph = null;
if (process.env['CREDENTIAL_KEY']) {
  const { deriveKey, decryptSecret } = await import('../dist/security/credentials.js');
  const { subscribeMetaPage, unsubscribeMetaPage } = await import('../dist/channels/meta/connect.js');
  const key = deriveKey(process.env['CREDENTIAL_KEY']);
  const version = process.env['META_GRAPH_API_VERSION'] || 'v23.0';
  graph = {
    openToken: (c) => { try { return decryptSecret(c, key).plain; } catch { return null; } },
    subscribe: (page) => subscribeMetaPage(page, version, fetch),
    unsubscribe: (page) => unsubscribeMetaPage(page, version, fetch),
  };
} else console.log('·  CREDENTIAL_KEY is not set: Pages are marked, but not unsubscribed at Meta.');

const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  await requireAdmin(client);
  const rows = await listWorkspaces(client, { selfServeOnly: all });
  const targets = all ? rows.filter((w) => restore ? w.suspended : !w.suspended) : rows.filter((w) => w.id === business);
  if (!all && targets.length === 0) { console.error(`✗  No workspace ${business}. Nothing was changed.`); process.exit(2); }
  console.log(`${restore ? 'Restore' : 'Suspend'} ${targets.length} workspace(s).${yes ? '' : ' Dry run — nothing is changed; add --yes.'}`);
  let failed = 0;
  for (const w of targets) {
    const label = `${w.name} (${w.id})${w.page ? ` — Page ${w.page}` : ''}`;
    if (!yes) { console.log(`  · ${label}: would be ${restore ? 'restored' : 'suspended'}`); continue; }
    const r = restore
      ? await restoreWorkspace(client, graph, { businessId: w.id, by })
      : await suspendWorkspace(client, graph, { businessId: w.id, reason, by, installationId: process.env['PILOT_BUSINESS_ID'] ?? null });
    if (!r.ok) { console.log(`  ✗ ${label}: ${r.why.replace(/_/g, ' ')}`); failed++; continue; }
    const page = restore ? r.resubscribed : r.unsubscribed;
    console.log(`  ✓ ${label}: ${restore ? 'restored' : 'suspended'}${page === null ? '' : page ? `; Page ${restore ? 're' : 'un'}subscribed` : '; the Page token could not be opened'}`);
  }
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await client.end().catch(() => undefined);
}
