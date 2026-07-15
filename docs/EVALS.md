# Evaluation Framework

Principle: **every metric is a SQL query over tables that already exist**
(`turns`, `quotes`, `orders`, `handoffs`, `conversation_events`,
`shadow.turn_decisions`, `usage_ledger`). No new instrumentation is needed —
that was the point of building the audit layer first. Where a metric needs
human judgment, the framework defines the *sample* and the *rubric*, never
"read some transcripts and vibe".

Three tiers, three cadences:

| Tier | What | Cadence | Gate |
|---|---|---|---|
| 1 | Deterministic SQL metrics | continuous (view) | alerts on thresholds |
| 2 | Golden-set regression | every prompt/model/engine change | CI-style: red = don't ship |
| 3 | Human-judged sample | weekly, 20 conversations | trend, not gate |

## Tier 1 — deterministic metrics (SQL)

**Handoff precision / false escalation rate.** A handoff a human dismissed in
under 2 minutes with no substantive reply was noise:
```sql
select count(*) filter (where claimed_at - requested_at < interval '48 hours'
         and released_at - claimed_at < interval '2 minutes')::float
     / nullif(count(*),0) as false_escalation_rate
from handoffs where requested_at > now() - interval '7 days';
```

**Missed escalation rate** (the worse failure — needs a proxy): conversations
where the client sent ≥3 consecutive inbound messages with no phase progress
and no handoff. Flag for the Tier-3 human sample:
```sql
-- candidates: 3+ inbound in a row, phase unchanged, never handed off
select conversation_id from conversation_events
group by conversation_id
having count(*) filter (where type='message_in') >= 6
   and count(*) filter (where type='handoff') = 0
   and count(distinct payload->>'phase') <= 1;
```

**Retrieval precision@5** (deterministic once judged once): every `turns` row
stores `retrieved`; when the conversation later confirms a product, check it
was in the top 5:
```sql
select avg((t.retrieved @> jsonb_build_array(jsonb_build_object('productId', cs.identified_product_id)))::int)
from turns t join conversation_state cs using (conversation_id)
where cs.product_confirmed_by_client;
```

**Claims-guard & numeral-guard pressure.** Violations per turn are now recorded
(`guardViolations`, usage/timings on every turn). Rejection rate >20% = the
prompt is fighting the guard; investigate before loosening ANYTHING.

**Quote quality (deterministic core).** Reproducibility check — recompute every
quote from its snapshot nightly; any mismatch is an engine bug:
`computeQuote(quotes.inputs) == quotes.{unit_price,discount,total}`. Plus:
quotes below floor (must be zero, forever), `requires_human` honored (no
outbound quote with requires_human=true and no handoff row).

**Funnel + follow-up effectiveness** (once follow-ups ship): reply rate within
48h of `follow_up_sent`; resurrection→reorder conversion; all from
`conversation_events`.

**Latency SLOs** from `turns.latency_ms` + `timings`: p50/p95 total, analyzer,
retrieval. Alert: p95 total > 10s.

## Tier 2 — the golden set (the regression gate)

A versioned corpus in `tests/golden/*.jsonl`: input (state + message) → expected
DECISION fields (never prose). Seeded from the 18 TCs + every shadow divergence
we triage + every Tier-3 finding — **failures become test cases, permanently.**

Runs like the parity suite: any prompt edit, model change, or scoring change
must keep the golden set green. Assertions are decision-level (phase, product,
scores, pendingQuestion, action, quote) so they are stable under model
nondeterminism. Target: 100 cases within a month of real traffic.

## Tier 3 — weekly human sample (20 conversations)

Stratified: 5 handoffs, 5 closes/near-closes, 5 flagged by the
missed-escalation query, 5 random. Rubric per conversation, 1–5 on:

1. **Salesmanship** — did every AI turn move toward qualification/close?
2. **Language quality** — native-sounding in the client's language?
3. **Truthfulness** — anything promised that policy/data doesn't back? (any
   instance = incident, not a score)
4. **Handoff judgment** — should a human have been pulled in earlier/later?

Findings feed: golden set (new cases), ASSUMPTIONS.md (new rows), claim/phrase
lists (new patterns). 20 conversations ≈ 30 minutes — solo-sustainable.

## What is deliberately NOT here

- LLM-judged conversation scores as a *gate* — an unvalidated judge gating a
  system is two unknowns stacked. May assist Tier-3 triage later, after its
  agreement with human scores is measured.
- Prose similarity metrics (BLEU-alikes) — wording is free to vary; decisions
  are not. Assert on decisions.
