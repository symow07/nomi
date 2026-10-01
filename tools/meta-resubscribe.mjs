#!/usr/bin/env node
/**
 * CH3 — subscribe every connected Page to the webhook fields Nomi now needs
 * (`META_PAGE_FIELDS`: messages, postbacks, and `message_echoes`, so a reply
 * the owner types in Messenger's own app reaches Nomi).
 *
 * A Page connected from now on is subscribed with these fields when it is
 * connected. A Page connected before CH3 was subscribed with the old list and
 * keeps it until this is run once — with each Page's own token, as connecting
 * does. The app's own webhook must have `message_echoes` ticked in Meta's
 * dashboard as well (the operator's, by hand; see docs/FACTORY-PROVISIONING.md).
 *
 *   railway run --service nomi -- node tools/meta-resubscribe.mjs          # dry run: lists the Pages
 *   railway run --service nomi -- node tools/meta-resubscribe.mjs --yes    # subscribes each
 *
 * Reads `MIGRATE_DATABASE_URL` (the admin role: the Pages of every business),
 * `CREDENTIAL_KEY` (to open each Page token, in memory only) and
 * `META_GRAPH_API_VERSION` from the environment — never from the command line.
 * Prints Page names and ids, never a token. Needs `npm run build` first.
 *
 * NEVER RUN AGAINST LIVE META YET (docs/PROGRESS.md, "Never run against live Meta").
 */
import { toolClient } from './lib/db.mjs';

const yes = process.argv.includes('--yes');
const url = process.env['MIGRATE_DATABASE_URL'];
const keyValue = process.env['CREDENTIAL_KEY'];
const graphVersion = process.env['META_GRAPH_API_VERSION'] || 'v23.0';
if (!url || !keyValue) {
  console.error('✗  MIGRATE_DATABASE_URL and CREDENTIAL_KEY must be set (run inside `railway run --service nomi`). Nothing was changed.');
  process.exit(2);
}

const { deriveKey, decryptSecret } = await import('../dist/security/credentials.js');
const { subscribeMetaPage, META_PAGE_FIELDS } = await import('../dist/channels/meta/connect.js');

const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  // Every Page of every business: a role row security filters would see only some.
  const filtered = (await client.query(
    `select rolbypassrls or rolsuper as all_rows from pg_roles where rolname = current_user`)).rows[0];
  if (!filtered?.all_rows) {
    const owner = (await client.query(`select tableowner = current_user as owns from pg_tables where tablename = 'meta_accounts'`)).rows[0];
    if (!owner?.owns) {
      console.error('✗  This database role is subject to row-level security, so it cannot see every Page. Use the admin URL. Nothing was changed.');
      process.exit(2);
    }
  }
  const pages = (await client.query(
    `select m.page_id, m.page_name, m.token_ciphertext, b.name as business
       from meta_accounts m join businesses b on b.id = m.business_id
      where m.archived_at is null and b.practice_of is null
      order by b.name, m.page_name`)).rows;
  console.log(`${pages.length} connected Page(s). Fields: ${META_PAGE_FIELDS}.${yes ? '' : ' Dry run — nothing is sent; add --yes.'}`);
  const key = deriveKey(keyValue);
  let done = 0; let failed = 0;
  for (const p of pages) {
    const label = `${p.business} — ${p.page_name} (${p.page_id})`;
    let token;
    try { token = decryptSecret(p.token_ciphertext, key).plain; } catch { token = null; }
    if (!token) { console.log(`  ✗ ${label}: its token cannot be opened with this key`); failed++; continue; }
    if (!yes) { console.log(`  · ${label}: would be subscribed`); continue; }
    const ok = await subscribeMetaPage({ pageId: p.page_id, token }, graphVersion, fetch);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ': Meta refused (connect the Page again from Channels)'}`);
    if (ok) done++; else failed++;
  }
  if (yes) console.log(`\n${done} subscribed, ${failed} not.`);
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  await client.end().catch(() => undefined);
}
