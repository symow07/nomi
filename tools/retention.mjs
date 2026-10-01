#!/usr/bin/env node
/**
 * RET (0116) — workspaces that never connected a channel, 90 days on.
 *
 *   railway run --service nomi -- node tools/retention.mjs                         # who, when, warned how often
 *   railway run --service nomi -- node tools/retention.mjs --erase --by "<you>" --yes
 *
 * OFF until the owner turns it on (tools/ops-flags.mjs --set retention --all):
 * until then the list is empty, no warning goes and nothing can be erased.
 * While on, the app warns each owner by e-mail at least 14 days before, then
 * three days before; connecting any channel takes the workspace off the list.
 * A workspace is due once its date has passed and both warnings went. --erase
 * records a workspace deletion request for each one due (the authorisation
 * tools/erase-workspace.mjs asks for), then runs that tool on it — the same
 * erasure, the same refusals. Dry run unless --yes. Reads MIGRATE_DATABASE_URL.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { listRetention, recordRetentionRequest } = await import('./lib/operator.mjs');
const erase = process.argv.includes('--erase'); const yes = process.argv.includes('--yes'); const by = arg('--by');
const client = toolClient(url, { replyTimeoutMs: 60_000 });
await client.connect();
let failed = 0;
try {
  const on = (await client.query(`select exists (select 1 from ops_flags where flag = 'retention' and cleared_at is null) as on`)).rows[0].on;
  console.log(`Retention: ${on ? 'ON' : 'off — nothing is warned or erased'} for this installation.`);
  const rows = await listRetention(client);
  for (const r of rows) {
    console.log(`  ${r.id}  ${r.name}  signed up ${new Date(r.signedUpAt).toISOString().slice(0, 10)}  erase on ${r.eraseOn}  warned: ${[r.warned14d && '14d', r.warned3d && '3d'].filter(Boolean).join(', ') || 'not yet'}${r.due ? '  DUE' : ''}`);
  }
  const due = rows.filter((r) => r.due);
  console.log(`${rows.length} never connected · ${due.length} due.`);
  if (!erase) process.exit(0);
  if (!by || !String(by).trim()) { console.error('Say who you are: --by "<you>". Nothing was changed.'); process.exit(2); }
  if (!yes) { console.log(`Dry run: would erase ${due.length} workspace(s). Add --yes.`); process.exit(0); }
  const tool = fileURLToPath(new URL('./erase-workspace.mjs', import.meta.url));
  for (const r of due) {
    const request = await recordRetentionRequest(client, { businessId: r.id, by });
    if (!request) { console.log(`  ${r.name}: no longer due. Left as it is.`); continue; }
    const run = spawnSync(process.execPath, [tool, '--business', r.id, '--confirm', r.name, '--yes'], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) { failed++; console.error(`  ✗ ${r.name}: erase-workspace refused or failed; request ${request} stays open.`); }
  }
  console.log(failed ? `✗ ${failed} not erased.` : `✓ ${due.length} erased.`);
} finally {
  await client.end().catch(() => undefined);
}
if (failed) process.exit(1);
