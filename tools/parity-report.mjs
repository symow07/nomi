#!/usr/bin/env node
/**
 * Weekly shadow parity report. (ADR-0009)
 *
 * Reads shadow.turn_decisions, fills n8n_decision for rows that lack it by
 * snapshotting what n8n wrote to the canonical tables, computes divergence,
 * and categorizes every diff into exactly one bucket:
 *
 *   expected_improvement — matches a written expected-divergence rule
 *                          (the fixes the migration exists to ship)
 *   service_bug          — service disagrees, no rule covers it
 *   n8n_bug              — n8n wrote state that violates its own spec
 *                          (e.g. phase regressed, score > 100)
 *   nondeterminism       — decision fields agree; only excluded fields differ
 *
 * Usage:  DATABASE_URL=postgres://... node tools/parity-report.mjs
 * Output: parity report (markdown) on stdout + exit 1 if any service_bug.
 *
 * CAVEAT (known, accepted for the shadow phase): n8n does not record a
 * per-turn fingerprint, so n8n_decision is reconstructed from the CURRENT
 * conversation_state. Run the report at least daily so the reconstruction is
 * near-in-time; multi-message bursts on one conversation can blur attribution.
 * The service records true per-turn data (turns table) — n8n never will,
 * which is itself one of the reasons for the migration.
 */
import pg from 'pg';

const EXPECTED = [
  {
    field: 'problemScore',
    justification: 'scores split (ADR-0003): lead signals no longer inflate problem',
    applies: (n8n, svc) => typeof n8n === 'number' && typeof svc === 'number' && svc <= n8n,
  },
  {
    field: 'phaseAction',
    justification: 'service pauses the AI on handoff where n8n kept replying',
    applies: (_n8n, svc) => svc === 'silent' || svc === 'handoff',
  },
  {
    field: 'phaseAction',
    justification: 'service closes hot leads that n8n blocked via the monotonic score',
    applies: (n8n, svc, ctx) => svc === 'confirm_order' && n8n !== 'confirm_order' && (ctx.problemScore ?? 0) < 70,
  },
  {
    field: 'pendingQuestion',
    justification: 'n8n never wrote pending_question before M0; service always does',
    applies: (n8n, svc) => n8n === null && svc !== null,
  },
];

const COMPARED = ['phase', 'productId', 'productConfirmed', 'quantity',
  'problemScore', 'leadScore', 'pendingQuestion', 'phaseAction'];
const MONEY = ['unitPriceUsd', 'discountPct', 'totalUsd'];

function categorize(n8n, svc) {
  const diffs = [];
  for (const f of COMPARED) {
    if ((n8n?.[f] ?? null) !== (svc?.[f] ?? null)) diffs.push({ field: f, n8n: n8n?.[f] ?? null, svc: svc?.[f] ?? null });
  }
  const qa = n8n?.quote ?? null, qb = svc?.quote ?? null;
  if ((qa === null) !== (qb === null)) diffs.push({ field: 'quote', n8n: qa, svc: qb });
  else if (qa && qb) for (const f of MONEY) {
    if (Math.round(qa[f] * 100) !== Math.round(qb[f] * 100)) diffs.push({ field: `quote.${f}`, n8n: qa[f], svc: qb[f] });
  }

  if (diffs.length === 0) return { category: 'match', diffs };

  // n8n violating its own spec = n8n_bug regardless of rules
  if (typeof n8n?.problemScore === 'number' && n8n.problemScore > 100) return { category: 'n8n_bug', diffs };

  const allExpected = diffs.every((d) =>
    EXPECTED.some((r) => r.field === d.field && r.applies(d.n8n, d.svc, svc)));
  if (allExpected) return { category: 'expected_improvement', diffs };

  // ANY money diff is a service_bug until a human proves otherwise. No tolerance.
  if (diffs.some((d) => d.field.startsWith('quote'))) return { category: 'service_bug', diffs };

  return { category: 'service_bug', diffs };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL required'); process.exit(2); }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  // Fill n8n_decision snapshots for undiffed rows (see caveat above).
  await client.query(`
    update shadow.turn_decisions sd
       set n8n_decision = jsonb_build_object(
             'phase', cs.phase,
             'productId', cs.identified_product_id,
             'productConfirmed', cs.product_confirmed_by_client,
             'quantity', cs.inquiry_quantity,
             'problemScore', cs.escalation_score,
             'leadScore', 0,
             'pendingQuestion', cs.pending_question,
             'phaseAction', case when o.id is not null then 'confirm_order'
                                 when cs.phase = 'escalated' then 'handoff'
                                 else 'maintain' end,
             'quote', case when o.id is null then null else jsonb_build_object(
               'unitPriceUsd', o.agreed_unit_price_usd, 'discountPct', 0,
               'totalUsd', o.total_value_usd) end)
      from conversation_state cs
      left join orders o on o.conversation_id = sd.conversation_id and o.status != 'cancelled'
     where cs.conversation_id = sd.conversation_id
       and sd.n8n_decision is null`);

  const { rows } = await client.query(`
    select message_id, n8n_decision, svc_decision, created_at
      from shadow.turn_decisions
     where created_at > now() - interval '7 days'
       and n8n_decision is not null
     order by created_at`);

  const buckets = { match: [], expected_improvement: [], service_bug: [], n8n_bug: [], nondeterminism: [] };
  for (const r of rows) {
    const { category, diffs } = categorize(r.n8n_decision, r.svc_decision);
    buckets[category].push({ id: r.message_id, diffs });
  }

  const total = rows.length || 1;
  const pct = (n) => ((100 * n) / total).toFixed(1);
  const confirmDiffs = [...buckets.service_bug, ...buckets.expected_improvement]
    .filter((b) => b.diffs.some((d) => d.field === 'phaseAction' &&
      (d.n8n === 'confirm_order' || d.svc === 'confirm_order')));
  const moneyBugs = buckets.service_bug.filter((b) => b.diffs.some((d) => d.field.startsWith('quote')));

  console.log(`# Shadow parity report — ${new Date().toISOString().slice(0, 10)}

| | count | % |
|---|---|---|
| Turns compared (7d) | ${rows.length} | |
| Full decision match | ${buckets.match.length} | ${pct(buckets.match.length)}% |
| Expected improvements | ${buckets.expected_improvement.length} | ${pct(buckets.expected_improvement.length)}% |
| **Service bugs (blockers)** | **${buckets.service_bug.length}** | ${pct(buckets.service_bug.length)}% |
| n8n bugs surfaced | ${buckets.n8n_bug.length} | ${pct(buckets.n8n_bug.length)}% |

## Cutover gates (ADR-0009 — pre-committed)
- confirm_order parity: ${confirmDiffs.length === 0 ? '✅ 100%' : `❌ ${confirmDiffs.length} divergence(s) — BLOCKS CUTOVER`}
- quote parity (cent-exact): ${moneyBugs.length === 0 ? '✅ 100%' : `❌ ${moneyBugs.length} money divergence(s) — BLOCKS CUTOVER`}
- unexplained divergences: ${buckets.service_bug.length === 0 ? '✅ 0' : `❌ ${buckets.service_bug.length} to triage`}
`);
  for (const b of buckets.service_bug.slice(0, 20)) {
    console.log(`- SERVICE_BUG ${b.id}: ${b.diffs.map((d) => `${d.field} n8n=${JSON.stringify(d.n8n)} svc=${JSON.stringify(d.svc)}`).join('; ')}`);
  }
  await client.end();
  process.exit(buckets.service_bug.length ? 1 : 0);
}
main();
