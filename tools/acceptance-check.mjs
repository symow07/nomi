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
 *
 * BLOCK 4.4 — SETUP IN MINUTES (`--setup`): the four milestones of one
 * workspace, each when it was first reached and how many whole minutes after
 * sign-up, or Pending — read by `loadSetupMilestones` (src/db/setupMilestones.ts),
 * the reader the get-started page uses. A workspace the operator made has no
 * sign-up: its times are printed with no minutes. Any workspace but a practice
 * copy; nothing of Meta is asked. Exit 0 when all four are on record, 1 when one
 * is pending, 2 for a wrong call.
 *
 *   node tools/acceptance-check.mjs --setup --business <uuid>
 */
import { toolClient } from './lib/db.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const url = process.env['MIGRATE_DATABASE_URL'];
const business = arg('--business');
if (!url || !business || !/^[0-9a-f-]{36}$/i.test(business)) {
  console.error('Usage: MIGRATE_DATABASE_URL in the environment; --business <uuid>. Nothing was read.');
  process.exit(2);
}

if (process.argv.includes('--setup')) {
  // Awaited at top level and never resolved, so the launch check below never runs; both streams are drained first,
  // since process.exit() drops what a pipe has not taken yet (tools/check-reachable.mjs, #85).
  const code = await setupMinutes(url, business);
  await new Promise(() => {
    let open = 2;
    const done = () => { if (--open === 0) process.exit(code); };
    process.stdout.write('', done);
    process.stderr.write('', done);
  });
}

/** `--setup`: the four milestones, each with its time and the minutes after sign-up, or Pending. */
async function setupMinutes(url, business) {
  const { createDb, withTenantTx } = await import('../dist/db/client.js');
  const { loadSetupMilestones } = await import('../dist/db/setupMilestones.js');
  const { SETUP_MILESTONE_KEYS } = await import('../dist/core/onboard/setupMinutes.js');
  const LABELS = {
    productsIn: 'Products in',
    contactsIn: 'Customers in',
    channelConnected: 'A channel connected',
    firstReply: 'The first reply sent',
  };
  const db = createDb(url);
  const client = toolClient(url, { replyTimeoutMs: 30_000 });
  await client.connect();
  try {
    const row = (await client.query('select name, practice_of from businesses where id = $1', [business])).rows[0];
    if (!row || row.practice_of) { console.error(`✗  ${business} is not a workspace. Nothing to check.`); return 2; }
    const m = await withTenantTx(db, business, (tx) => loadSetupMilestones(tx, business));
    const iso = (x) => new Date(x).toISOString();
    // Whole minutes, never below zero: the get-started page's own arithmetic (src/api/web/guide.ts).
    const after = (x) => Math.max(0, Math.floor((new Date(x).getTime() - new Date(m.signedUpAt).getTime()) / 60_000));
    console.log(`Setup in minutes — ${row.name} (${business})`);
    console.log(m.signedUpAt ? `  Signed up — ${iso(m.signedUpAt)}` : '  Signed up — not by sign-up (the operator made it): times only, no minutes');
    for (const key of SETUP_MILESTONE_KEYS) {
      const at = m[key];
      const minutes = at && m.signedUpAt ? ` · ${after(at)} min from sign-up` : '';
      console.log(`  ${at ? '✓' : '○'} ${LABELS[key]} — ${at ? `${iso(at)}${minutes}` : 'Pending'}`);
    }
    const done = SETUP_MILESTONE_KEYS.every((key) => m[key] !== null);
    console.log(done ? '\n✓ All four are on record.' : '\n○ Not all four are on record yet.');
    return done ? 0 : 1;
  } finally {
    await client.end().catch(() => undefined);
    await db.destroy();
  }
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
