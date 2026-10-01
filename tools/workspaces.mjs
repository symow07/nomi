#!/usr/bin/env node
/**
 * G7 — the operator's list of workspaces, and the ramp gate lifted for a pilot.
 *
 *   railway run --service nomi -- node tools/workspaces.mjs                  # every workspace
 *   railway run --service nomi -- node tools/workspaces.mjs --self-serve     # those that signed themselves up
 *   railway run --service nomi -- node tools/workspaces.mjs --earn <uuid> --by "<you>" --yes     # sending alone opened (G4)
 *   railway run --service nomi -- node tools/workspaces.mjs --unearn <uuid> --by "<you>" --yes
 *   railway run --service nomi -- node tools/workspaces.mjs --funnel              # G9: each step, and the exit criteria
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
  // G9 — the funnel: each self-serve workspace's steps, then decision 33's measures.
  if (has('--funnel')) {
    const { createDb } = await import('../dist/db/client.js');
    const { loadFunnel, exitMeasures } = await import('../dist/pipeline/funnel.js');
    const { metaReviewFrom } = await import('../dist/core/channel/metaReview.js');
    const db = createDb(url);
    try {
      const rows = await loadFunnel(db);
      const review = metaReviewFrom(process.env);
      const openFrom = review.state === 'approved' ? review.on : null;
      const d = (x) => (x ? x.toISOString().slice(0, 16).replace('T', ' ') : '—');
      console.log(`${rows.length} workspace(s) that signed themselves up.`);
      for (const r of rows) {
        console.log(`  · ${r.name} (${r.businessId}) — signed up ${d(r.signedUpAt)} — list ${d(r.firstImportAt)} / confirmed ${d(r.firstImportConfirmedAt)}`
          + ` — Practice ${r.checksSeen}/${r.checksTotal}${r.checklistCompleteAt ? ` (complete ${d(r.checklistCompleteAt)})` : ''} — named ${d(r.namedAt)}`
          + ` — connected ${d(r.connectedAt)} — first customer ${d(r.firstCustomerAt)} — first reply ${d(r.firstReplyAt)}`
          + ` — drafts decided ${r.draftsDecided}, expired ${r.draftsExpired}${r.operatorBeforeFirstReply ? ' — operator acted before its first reply' : ''}`);
      }
      const m = exitMeasures(rows, new Date(), openFrom);
      const mins = (x) => (x === null ? '—' : `${Math.round(x)} min`);
      console.log('\nExit criteria (decision 33) that rows can answer:');
      console.log(`  · first real reply within 7 days of being able to connect: ${m.firstReplyIn7Days.pass} of ${m.firstReplyIn7Days.of} (pass: at least 12 of 20)`);
      console.log(`  · median sign-up to a complete Practice checklist: ${mins(m.signupToChecklistMinutes)} (pass: under 60 min)`);
      console.log(`  · median time to the owner's decision on a draft: ${mins(m.decisionMinutes)}, clock time (pass: under 2 hours of business hours)`);
      console.log(`  · drafts expired in the 24-hour window: ${m.expired.expired} of ${m.expired.of} (pass: under 20%)`);
      console.log(`  · first reply with no operator action before it: ${m.firstReplyWithoutOperator.pass} of ${m.firstReplyWithoutOperator.of} (pass: at least 15 of 20)`);
      console.log('  Counted by the operator, not here: sends without the owner in draft mode (T6 holds it at 0), cross-workspace incidents, Meta strikes (the CEIL alarm).');
    } finally {
      await db.destroy();
    }
    process.exit(0);
  }
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
