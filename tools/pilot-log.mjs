#!/usr/bin/env node
/**
 * GATE A — THE PILOT LOG (docs/GATE-A-KIT.md §3). Every confusion, hesitation, correction, surprise and moment of
 * trust from the first real owner, written down the evening it happened, and ordered for fixing at the weekend.
 * The table is `pilot_log` (0012); this is its one writer. It was written by hand once (a SQL editor); the module
 * that ordered it (`src/pilot/log.ts`) was removed when no entry had ever been logged (b24f052c) — the kinds and
 * the order are restored here, unchanged.
 *
 *   MIGRATE_DATABASE_URL=… node tools/pilot-log.mjs add --business <uuid> --owner <label> --surface <where>
 *       --kind <kind> --event "<what happened, exactly>" --severity 1|2|3 --trust -2..2
 *       [--expected "<what they expected>"] [--happened "<what happened instead>"] [--quote "<their words>"]
 *       [--fix "<suggested fix>"] [--blocker] [--at <ISO time, default now>]
 *   MIGRATE_DATABASE_URL=… node tools/pilot-log.mjs triage --business <uuid>      # open entries, worst first
 *   MIGRATE_DATABASE_URL=… node tools/pilot-log.mjs set --id <n> --status new|triaged|fixing|fixed|wont_fix [--task "#NNN"]
 *   MIGRATE_DATABASE_URL=… node tools/pilot-log.mjs decision --business <uuid> --what "<the decision>" --until <YYYY-MM-DD> --by "<you>"
 *       a decision made for the pilot, with the day it ends (0154) — the billing exemption first (the owner's
 *       decision 2, 2026-10-14). Triage lists those in force, and those whose day has passed: undo them.
 *   node tools/pilot-log.mjs kinds                                               # the nineteen kinds
 *
 * Severity 3 is the worst. Trust: −2 broke it … +2 built it. Records only: it explains nothing, defends nothing.
 * Exit 0 done · 1 refusal or failure · 2 bad usage.
 */
import { pathToFileURL } from 'node:url';
import { toolClient } from './lib/db.mjs';

export const KINDS = [
  'did_not_understand_message', 'asked_term_meaning', 'could_not_find_action', 'hesitated_before_approval',
  'rejected_draft', 'edited_draft', 'took_over_conversation', 'misunderstood_authority', 'expected_missing_behavior',
  'positive_surprise', 'expressed_trust', 'asked_for_more_autonomy', 'asked_about_price', 'wanted_to_show_someone',
  'felt_too_technical', 'unnatural_chinese', 'mobile_layout_issue', 'unnecessary_notification', 'missed_important_notification',
];
const STATUSES = ['new', 'triaged', 'fixing', 'fixed', 'wont_fix'];
/** 0154 — a decision made for the pilot, not an observation of its owner: kept apart from the nineteen. */
export const DECISION = 'pilot_decision';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const has = (name) => args.includes(`--${name}`);
const usage = (msg) => {
  console.error(`${msg}\n\n  node tools/pilot-log.mjs add|triage|set|kinds …   (the header of tools/pilot-log.mjs says how)\n`);
  process.exit(2);
};

/** Blockers first, then the worst, then the most trust lost, then the oldest (the order the pilot was planned with). */
export const triageOrder = (rows) => [...rows].sort((a, b) =>
  Number(b.blocks_launch) - Number(a.blocks_launch) || b.severity - a.severity
  || a.trust_impact - b.trust_impact || new Date(a.at).getTime() - new Date(b.at).getTime());

/** The decisions made for the pilot: those in force, then those whose day has passed (undo them). */
export const renderDecisions = (rows, today) => {
  // A date as the database keeps it (read as text: a JS Date would land at local midnight and shift a day in UTC).
  const day = (d) => String(d).slice(0, 10);
  const decisions = rows.filter((e) => e.kind === DECISION).sort((a, b) => day(a.ends_on).localeCompare(day(b.ends_on)));
  if (decisions.length === 0) return 'PILOT DECISIONS — none';
  return [`PILOT DECISIONS — ${decisions.length}`, ...decisions.map((e) => day(e.ends_on) < today
    ? `[ENDED ${day(e.ends_on)} — undo it] ${e.event}  [#${e.id} · ${e.owner_label}]`
    : `[until ${day(e.ends_on)}] ${e.event}  [#${e.id} · ${e.owner_label}]`)].join('\n');
};

export const renderTriage = (allRows) => {
  const rows = allRows.filter((e) => e.kind !== DECISION);
  const open = triageOrder(rows.filter((e) => e.status !== 'fixed' && e.status !== 'wont_fix'));
  return [`PILOT TRIAGE — ${open.length} open / ${rows.length} total`, ...open.map((e) =>
    `${e.blocks_launch ? '[BLOCKER] ' : ''}S${e.severity} trust:${e.trust_impact >= 0 ? '+' : ''}${e.trust_impact} `
    + `${e.kind} @ ${e.surface} — ${e.event}${e.suggested_fix ? ` → ${e.suggested_fix}` : ''}`
    + `${e.linked_task ? ` (${e.linked_task})` : ''}  [#${e.id} · ${e.status}]`)].join('\n');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

async function main() {
  if (command === 'kinds') { console.log(KINDS.join('\n')); return; }
  if (!['add', 'triage', 'set', 'decision'].includes(command ?? '')) usage('Say what to do: add, triage, set, decision or kinds.');
  const url = process.env['MIGRATE_DATABASE_URL'];
  if (!url) usage('MIGRATE_DATABASE_URL is not set.');

  // Everything is checked before the database is asked anything.
  let entry = null;
  if (command === 'add' || command === 'triage' || command === 'decision') {
    if (!UUID.test(flag('business') ?? '')) usage('--business must be a uuid.');
  }
  if (command === 'decision') {
    if (!flag('what') || flag('what').trim().length < 3) usage('--what says the decision, in words.');
    if (!flag('by') || flag('by').trim() === '') usage('--by says who decided.');
    const until = flag('until') ?? '';
    if (!DAY.test(until) || Number.isNaN(new Date(`${until}T00:00:00Z`).getTime())) usage('--until is the day it ends, as YYYY-MM-DD.');
    if (until < new Date().toISOString().slice(0, 10)) usage('--until is in the past: a decision ends on a day still to come.');
  }
  if (command === 'add') {
    const severity = Number(flag('severity'));
    const trust = Number(flag('trust'));
    const at = flag('at') ? new Date(flag('at')) : new Date();
    entry = {
      business: flag('business'), owner: flag('owner'), surface: flag('surface'), kind: flag('kind'), event: flag('event'),
      expected: flag('expected') ?? '', happened: flag('happened') ?? '', quote: flag('quote') ?? '', fix: flag('fix') ?? '',
      severity, trust, blocker: has('blocker'), at,
    };
    if (!entry.owner || !entry.surface) usage('--owner and --surface are needed: who, and on which page or screen.');
    if (!KINDS.includes(entry.kind ?? '')) usage(`--kind must be one of the nineteen (node tools/pilot-log.mjs kinds); "${entry.kind}" is not.`);
    if (!entry.event || entry.event.trim().length < 3) usage('--event says exactly what happened.');
    if (![1, 2, 3].includes(severity)) usage('--severity is 1, 2 or 3 (3 the worst).');
    if (!Number.isInteger(trust) || trust < -2 || trust > 2) usage('--trust is a whole number from -2 (broke it) to 2 (built it).');
    if (Number.isNaN(at.getTime())) usage('--at must be a time, e.g. 2026-10-20T09:15+08:00.');
  }
  if (command === 'set') {
    if (!/^[1-9][0-9]{0,17}$/.test(flag('id') ?? '')) usage('--id is the entry\'s number (triage prints it as #n).');
    if (!STATUSES.includes(flag('status') ?? '')) usage(`--status is one of ${STATUSES.join(', ')}.`);
  }

  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => { console.error(`\n✗  ${e.message}\n`); process.exit(1); });
  try {
    if (command === 'add') {
      const biz = (await client.query('select name from businesses where id = $1', [entry.business])).rows[0];
      if (!biz) { console.error(`\n✗  No business ${entry.business}. Nothing written.\n`); process.exitCode = 1; return; }
      const row = (await client.query(`insert into pilot_log (business_id, at, owner_label, surface, kind, event, owner_expected,
          what_happened, owner_quote, severity, trust_impact, suggested_fix, blocks_launch)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [entry.business, entry.at, entry.owner, entry.surface, entry.kind, entry.event, entry.expected, entry.happened,
        entry.quote, entry.severity, entry.trust, entry.fix, entry.blocker])).rows[0];
      console.log(`\n✓  ${biz.name}: written as #${row.id}.${entry.blocker ? ' Marked as blocking the launch.' : ''}\n`);
    } else if (command === 'decision') {
      const biz = (await client.query('select name from businesses where id = $1', [flag('business')])).rows[0];
      if (!biz) { console.error(`\n✗  No business ${flag('business')}. Nothing written.\n`); process.exitCode = 1; return; }
      const row = (await client.query(`insert into pilot_log (business_id, at, owner_label, surface, kind, event, severity, trust_impact, ends_on)
        values ($1, now(), $2, 'operator', $3, $4, 1, 0, $5::date) returning id`,
      [flag('business'), flag('by').trim(), DECISION, flag('what').trim(), flag('until')])).rows[0];
      console.log(`\n✓  ${biz.name}: decision written as #${row.id}, until ${flag('until')}.\n`);
    } else if (command === 'triage') {
      const rows = (await client.query(`select id, at, owner_label, surface, kind, event, severity, trust_impact, suggested_fix, blocks_launch,
          status, linked_task, ends_on::text as ends_on from pilot_log where business_id = $1`, [flag('business')])).rows;
      console.log(`\n${renderTriage(rows)}\n\n${renderDecisions(rows, new Date().toISOString().slice(0, 10))}\n`);
    } else {
      const r = await client.query('update pilot_log set status = $2, linked_task = coalesce($3, linked_task) where id = $1 returning status',
        [flag('id'), flag('status'), flag('task')]);
      if (r.rowCount === 0) { console.error(`\n✗  No entry #${flag('id')}. Nothing changed.\n`); process.exitCode = 1; return; }
      console.log(`\n✓  #${flag('id')}: ${flag('status')}${flag('task') ? `, linked to ${flag('task')}` : ''}.\n`);
    }
  } catch (e) {
    console.error(`\n✗  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
