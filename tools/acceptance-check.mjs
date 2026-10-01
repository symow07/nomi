#!/usr/bin/env node
/**
 * G8 — THE LAUNCH ACCEPTANCE TEST, CHECKED (docs/LAUNCH-ACCEPTANCE.md). A
 * person with no role on Nomi's Meta app does the steps by hand on
 * production; this reads what they left and says, step by step, whether each
 * happened — from the rows the product itself wrote, never from a claim.
 *
 *   railway run --service nomi -- node tools/acceptance-check.mjs --business <uuid>
 *
 * Exit 0 when every step is there, 1 when one is missing. Read-only. Reads
 * MIGRATE_DATABASE_URL from the environment. Prints no customer's words, no
 * address, no token. Needs `npm run build` first.
 *
 * NEVER RUN AGAINST LIVE META YET: it needs App Review's approval (M4).
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env['MIGRATE_DATABASE_URL'];
const business = arg('--business');
if (!url || !business || !/^[0-9a-f-]{36}$/i.test(business)) {
  console.error('Usage: MIGRATE_DATABASE_URL in the environment; --business <uuid>. Nothing was read.');
  process.exit(2);
}
const { createDb } = await import('../dist/db/client.js');
const { loadFunnel } = await import('../dist/pipeline/funnel.js');
const db = createDb(url);
const client = toolClient(url, { replyTimeoutMs: 30_000 });
await client.connect();
try {
  const f = (await loadFunnel(db)).find((r) => r.businessId === business);
  if (!f) { console.error(`✗  ${business} is not a workspace that signed itself up. Nothing to check.`); process.exit(2); }
  const one = async (q) => (await client.query(q, [business])).rows[0] ?? {};
  const page = await one(`select page_name, ig_account_id is not null as ig, connected_at from meta_accounts
                           where business_id = $1 and archived_at is null and last_error is null limit 1`);
  const customer = await one(`select min(m.sent_at) as at from messages m join conversations c on c.id = m.conversation_id
                               where c.business_id = $1 and c.channel = 'instagram' and m.direction = 'inbound'`);
  const sent = await one(`select min(om.sent_at) as at,
                                 bool_or(om.status in ('delivered', 'read')) as delivered
                            from outbound_messages om
                           where om.business_id = $1 and om.channel = 'instagram' and om.origin = 'employee'
                             and om.status in ('sent', 'delivered', 'read')`);
  const approved = await one(`select count(*)::int as n from drafts d join conversations c on c.id = d.conversation_id
                               where d.business_id = $1 and c.channel = 'instagram' and d.status in ('approved', 'edited')`);
  const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '');
  const steps = [
    ['Signed up', !!f.signedUpAt, d(f.signedUpAt)],
    ['Imported a catalogue and confirmed it', !!f.firstImportConfirmedAt, d(f.firstImportConfirmedAt)],
    ['Named the assistant', !!f.namedAt, d(f.namedAt)],
    [`Practised: the checklist complete (${f.checksSeen}/${f.checksTotal})`, !!f.checklistCompleteAt, d(f.checklistCompleteAt)],
    ['Connected their own Page, with Instagram', !!page.page_name && page.ig === true, page.page_name ? `${page.page_name} — ${d(page.connected_at)}` : ''],
    ['A customer wrote on Instagram', !!customer.at, d(customer.at)],
    ['A draft was approved', Number(approved.n ?? 0) > 0, `${approved.n ?? 0}`],
    ['It went out on Instagram', !!sent.at, d(sent.at)],
    ['…and Instagram says it arrived', sent.delivered === true, sent.delivered ? 'delivered' : ''],
  ];
  console.log(`Acceptance — ${f.name} (${business})`);
  for (const [label, ok, detail] of steps) console.log(`  ${ok ? '✓' : '○'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (f.signedUpAt && sent.at) {
    const minutes = Math.round((new Date(sent.at).getTime() - new Date(f.signedUpAt).getTime()) / 60_000);
    console.log(`\nSign-up to the reply sent: ${minutes} min. This includes Meta's screens and the wait for the customer's message;`);
    console.log('the target (under 30 minutes of the owner\'s own time) is read from the operator\'s notes, not from here.');
  }
  const passed = steps.every(([, ok]) => ok);
  console.log(passed ? '\n✓ Every step is on record.' : '\n○ Not every step is on record yet.');
  process.exitCode = passed ? 0 : 1;
} finally {
  await client.end().catch(() => undefined);
  await db.destroy();
}
