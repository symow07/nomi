# ADR-0009 — Shadow-run, cutover & rollback

**Status:** Proposed · **Depends on:** [0007](0007-database-migrations.md), [0008](0008-testing-strategy.md)

## Context

We are replacing the engine of a system that will, by then, be answering real
customers. A flag-day rewrite is how projects die: you find out it was wrong *after*
it is the only thing running.

The migration must therefore satisfy three properties:

1. The new engine can be proven correct **on real traffic** before it touches a customer.
2. Cutover is **incremental**, not all-at-once.
3. Rollback is a **config change**, not a data migration.

## The key insight: diff decisions, not prose

The obvious shadow design — run both engines, compare the replies — **does not work.**
The LLM is nondeterministic; two runs of the *same* engine produce different wording.
A prose diff would be noise, would be ignored, and would prove nothing.

But every decision *around* the language is deterministic:

| Compared (deterministic) | Not compared (nondeterministic) |
|---|---|
| `phase` / `recommended_phase` | reply wording |
| `product_candidates[0].product_id` | tone, phrasing, length |
| `problem_score` / `lead_score` | |
| `pending_question` | |
| `attach_product_image` | |
| `phase_action` (maintain / advance / **confirm_order**) | |
| `safe_to_confirm` + blocking reasons | |
| the **quote** (unit price, discount, total) | |

**These are the things that make or lose money.** If both engines agree on all of them
across thousands of real messages, the new engine is correct in every way that matters.
The wording is a separate concern, covered by evals (ADR-0008 §4).

## Phase 1 — Shadow (2–3 weeks, zero customer risk)

n8n stays fully authoritative. It answers every customer, exactly as today.

```
 customer → n8n intake ──┬─→ [n8n engine] → reply to customer   (LIVE, unchanged)
                         │
                         └─→ POST /shadow/turn  (fire-and-forget, failures ignored)
                                     │
                                     ▼
                             TypeScript service
                                     │
                              decideTurn() etc.
                                     │
                                     ▼
                          shadow.turn_decisions       ← writes NOTHING customer-visible
```

**One node added to n8n**: an HTTP Request posting the enriched turn payload to
`/shadow/turn`. `neverError: true`, no wait — **the shadow can never affect the live
path.** If the service is down, n8n neither knows nor cares.

The service:
- runs the full pipeline: retrieve → analyse → `decideTurn` → quote → generate;
- **sends no outbound message, creates no order, writes nothing to canonical tables;**
- records its decisions in a `shadow` schema alongside n8n's, keyed by message id.

```sql
create schema shadow;
create table shadow.turn_decisions (
  message_id     text primary key,
  conversation_id uuid,
  n8n_decision   jsonb not null,   -- what n8n did
  svc_decision   jsonb not null,   -- what the service would have done
  diverged       boolean not null,
  divergences    text[],           -- ['phase', 'lead_score']
  created_at     timestamptz default now()
);
```

A nightly job reports divergence rate by field. Every divergence is triaged into: *n8n
is right* (fix the service), *the service is right* (an n8n bug — several are already
known), or *both acceptable* (tighten the comparator).

### Exit criteria — pre-committed, so we cannot rationalise later

| Metric | Threshold |
|---|---|
| Real messages shadowed | ≥ 1,000 (or 2 weeks, whichever is later) |
| Overall decision parity | ≥ 99% |
| **`phase_action = confirm_order` parity** | **100%.** No exceptions. This is money. |
| **Quote parity (unit price, discount, total)** | **100%.** |
| Unexplained divergences | 0 — every one triaged and closed |
| Parity test suite | green |

Note we expect *intentional* divergences: the service will correctly close deals that
n8n blocks (the monotonic-score bug), and will pause the AI on handoff where n8n keeps
talking. **Those are the fixes.** They are recorded as expected-divergence rules in the
comparator, with a written justification each — not silently ignored.

## Phase 2 — Cutover (incremental, per channel)

A column, not a deploy:

```sql
alter table businesses add column engine text not null default 'n8n'
  check (engine in ('n8n', 'service'));
alter table channel_credentials add column engine_override text;  -- per-channel
```

Intake reads the flag and routes. Order:

1. `webhook_test` channel → `service`. Push the 18 sample payloads. Verify.
2. One low-volume real channel (Telegram) → `service`. Watch for 48h.
3. Remaining channels, one at a time.
4. n8n engine workflows **deactivated but not deleted.**

At every step, n8n is one flag flip away from resuming. And because both engines write
the **same canonical tables** (ADR-0007's expand phase keeps `escalation_score` alive
alongside `problem_score`/`lead_score`), there is no data fork — a conversation
half-served by one engine can be finished by the other.

## Phase 3 — Rollback

**Rollback is `update businesses set engine = 'n8n'`. Under five minutes, no deploy,
no data migration.**

This is the entire reason for the expand/contract discipline in ADR-0007. It holds as
long as:

- no `contract` migration has run (old columns still exist);
- the service writes the canonical tables, not a fork;
- n8n workflows remain importable in `n8n/` and are regenerable via
  `tools/build-workflows.mjs`.

**Rollback stays available until the contract migration runs — which should be at least
one month after full cutover, and is the point of no return.** Treat that migration as
a deliberate, separate decision, not a tidy-up.

| Failure | Response |
|---|---|
| Wrong replies / bad decisions | Flip flag → n8n. Triage from `shadow` diffs. |
| Service down | Health check fails → flip flag. (Later: automate.) |
| Bad migration | Roll forward with a new migration (ADR-0007). |
| Data corruption | Flag flip does not fix this. Hence: **no destructive migration until after the rollback window closes.** |

## Timeline

| Week | Work |
|---|---|
| 1 | Scaffold, migrations 0001–0005, port `core/` (the 20 domain functions), parity suite green |
| 2 | Retrieval, quoting, RLS, queues. `/shadow/turn` endpoint. One node added to n8n. |
| 3–4 | **Shadow.** Triage divergences daily. Fix the service (and the n8n bugs it uncovers). |
| 5 | Cutover: `webhook_test`, then Telegram. |
| 6 | Remaining channels. n8n engine workflows deactivated. |
| +1 month | Contract migration. Rollback window closes. |

## Consequences

**Good.** The new engine is proven on real traffic before it can harm a customer.
Cutover is per-channel and reversible in minutes. The shadow diff will find bugs in
*both* engines — it already has, on paper.

**Bad.** For 2–3 weeks we maintain two engines and pay double LLM cost on shadowed
traffic (the shadow runs a full analysis + generation). At current volumes this is
tens of dollars; cap it by shadow-sampling if it isn't.

**The discipline that makes this work:** exit criteria are written down *before* the
shadow starts. Under schedule pressure, "99% is basically 100%" becomes very persuasive
— and `confirm_order` parity at 99% means **one in a hundred orders is wrong.** That is
why that row says 100%, and why it is written here rather than decided later.
