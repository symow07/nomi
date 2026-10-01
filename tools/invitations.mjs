#!/usr/bin/env node
/**
 * BOT (0114) — the invitations: list them, and take one back.
 *
 *   railway run --service nomi -- node tools/invitations.mjs                    # the open ones
 *   railway run --service nomi -- node tools/invitations.mjs --all              # every one, with its state
 *   railway run --service nomi -- node tools/invitations.mjs revoke <first 8 characters> --by "<you>" --yes
 *
 * An invitation stays open until a workspace is made with it (up to 90 days),
 * and while open it lets whoever holds it make Nomi e-mail a sign-up code. A
 * revoked one lapses at once. The list shows each by its first eight
 * characters only — the id is the ticket. Make them with tools/invite-factory.mjs.
 * Dry run unless --yes. Reads MIGRATE_DATABASE_URL.
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env['MIGRATE_DATABASE_URL'];
if (!url) { console.error('✗  MIGRATE_DATABASE_URL must be set. Nothing was changed.'); process.exit(2); }
const { listInvitations, revokeInvitation } = await import('./lib/operator.mjs');
const revoking = process.argv[2] === 'revoke';
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  if (!revoking) {
    const rows = await listInvitations(client, { all: process.argv.includes('--all') });
    if (rows.length === 0) console.log('No invitations to list.');
    for (const r of rows) {
      console.log(`${r.ref}  ${r.state.padEnd(7)}  made ${new Date(r.createdAt).toISOString().slice(0, 10)}  until ${new Date(r.expiresAt).toISOString().slice(0, 10)}  ${r.note ?? ''}${r.revokedBy ? `  (revoked by ${r.revokedBy})` : ''}`);
    }
    process.exit(0);
  }
  const ref = process.argv[3];
  if (!process.argv.includes('--yes')) { console.log(`Dry run: would revoke the open invitation starting ${ref ?? '<ref>'}. Add --by "<you>" --yes.`); process.exit(0); }
  const r = await revokeInvitation(client, { ref, by: arg('--by') });
  const said = {
    revoked: `✓ revoked: ${ref} no longer opens a workspace, nor sends a code.`,
    invalid: 'Usage: revoke <at least 8 characters of the id> --by "<you>" --yes. Nothing was changed.',
    none: `No invitation starts with ${ref}. Nothing was changed.`,
    ambiguous: `More than one invitation starts with ${ref}: give more characters. Nothing was changed.`,
    not_open: `${ref} is already used, lapsed or revoked. Nothing was changed.`,
  };
  console.log(said[r]);
  if (r !== 'revoked') process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
