#!/usr/bin/env node
/**
 * KS6 (0115) — the operator approves each workspace's first connection.
 *
 *   railway run --service nomi -- node tools/connections.mjs                    # the asks waiting
 *   railway run --service nomi -- node tools/connections.mjs --all              # the whole log
 *   railway run --service nomi -- node tools/connections.mjs approve <business-id> --by "<you>" --yes
 *   railway run --service nomi -- node tools/connections.mjs refuse <business-id> --note "<why>" --by "<you>" --yes
 *
 * Only while the installation's switch is on (tools/ops-flags.mjs --set
 * approve_connections --all — opening step 4) does a workspace that signed
 * itself up wait for this before its first Page or WhatsApp number connects.
 * Look at the business, what it sells and where it can be seen, then decide.
 * The owner hears by e-mail within five minutes; the note is never shown to
 * them. Dry run unless --yes. Reads MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { listConnectionAsks, decideConnection } = await import('./lib/operator.mjs');
const verb = process.argv[2];
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  const on = (await client.query(`select exists (select 1 from ops_flags where flag = 'approve_connections' and cleared_at is null) as on`)).rows[0].on;
  if (verb !== 'approve' && verb !== 'refuse') {
    console.log(`Approval before a first connection: ${on ? 'ON' : 'off'} for this installation.`);
    const rows = await listConnectionAsks(client, { all: process.argv.includes('--all') });
    if (rows.length === 0) console.log('No asks to list.');
    for (const r of rows) {
      console.log(`\n${r.id}  ${r.name} (${r.kind ?? '—'}, ${r.country ?? '—'})  asked ${new Date(r.askedAt).toISOString().slice(0, 16)} by ${r.askedBy}`);
      console.log(`    sells: ${r.sells ?? '—'}\n    website: ${r.website ?? '—'}\n    seen at: ${r.page}`);
      if (r.decision) console.log(`    ${r.decision} by ${r.decidedBy}, ${new Date(r.decidedAt).toISOString().slice(0, 16)}${r.note ? ` — ${r.note}` : ''}${r.told ? '' : ' (owner not told yet)'}`);
    }
    process.exit(0);
  }
  const id = process.argv[3];
  if (!process.argv.includes('--yes')) { console.log(`Dry run: would ${verb} ${id ?? '<business-id>'}. Add --by "<you>" --yes.`); process.exit(0); }
  const r = await decideConnection(client, { businessId: id, decision: verb === 'approve' ? 'approved' : 'refused', by: arg('--by'), note: arg('--note') });
  const said = {
    approved: `✓ approved: ${id} can connect its first channel. The owner hears by e-mail within five minutes.`,
    refused: `✓ refused: ${id} cannot connect. The owner hears by e-mail within five minutes; your note stays here.`,
    unchanged: `${id} already has that decision. Nothing was changed.`,
    no_ask: `${id} has not asked. Nothing was changed (approve needs no ask; refuse answers one).`,
    none: `No workspace ${id}. Nothing was changed.`,
    practice: `${id} is a practice copy: it never connects. Nothing was changed.`,
    invalid: 'Usage: approve|refuse <business-id> --by "<you>" [--note "<why>"] --yes. Nothing was changed.',
  };
  console.log(said[r]);
  if (r !== 'approved' && r !== 'refused') process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
