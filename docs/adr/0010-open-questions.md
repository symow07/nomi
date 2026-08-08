# ADR-0010 — Answers to the open architecture questions

**Status:** Accepted as guidance · **Date:** 2026-07-14

Six questions were posed with Week 1. Answers, with the reasoning kept honest.

---

## 1. What would I change if building from scratch?

Most of the domain design survives contact with a blank page: the phase machine,
the two-score model, the deterministic commerce engine, thin channel adapters —
I would build all of those again. Three things I would do differently from day one:

**Make the conversation an event log with a state snapshot, not a mutable row.**
Not event sourcing — just: `conversation_events` is written *first* and
`conversation_state` is derived and rebuildable from it. We are 80% there already
(signals are stored, scores are derived). The remaining 20% — treating the events
table as the primary record — buys replayability: when a conversation went wrong,
you can re-run `decideTurn` over its history and see exactly which turn diverged.
For an AI system whose bugs are *behavioural*, replay is the debugger.

**Version every AI decision.** Each turn should record `prompt_version`,
`model_id`, and `analysis` alongside the decision. When quality shifts after a
prompt edit or a model upgrade, you need to know which version produced which
outcome. Cheap now, unrecoverable later. (Added to the worker's persist step —
it's a jsonb column, not a system.)

**Charge-ready usage metering from day one.** Tokens in/out, model calls, and
turns per tenant, per day, in a `usage_ledger` table. The day you price YiwuFlow
you will need history to price against, and you cannot backfill what you didn't
record. This is 30 lines in the worker.

What I would *not* change: Postgres-for-everything, the monolith, n8n at the
edges. Those decisions are load-bearing and correct for this team size.

---

## 2. What technical debt is forming in the next 6–12 months?

Named now so it is a choice, not a surprise:

| Debt | Where it bites | When |
|---|---|---|
| **Prompt sprawl.** Prompts live in `.txt` files with no versioning, no eval gate. Every edit is a silent global change. | Reply quality regresses and nobody can say which edit did it. | The first time you "quickly tune" a prompt for one tenant. |
| **The expected-divergence list.** `EXPECTED_DIVERGENCES` is a scalpel during shadow; it becomes a rug to sweep real bugs under if it survives cutover. | Parity numbers look green while real divergences hide. | **Delete it at cutover.** It has a scheduled death; enforce it. |
| **Dual-write drift.** During shadow we write `escalation_score` AND the split scores. Every week this lives, the semantics drift further apart. | The backfill assumption (`old ≈ problem`) stops being true. | Contract migration must actually run ~1 month post-cutover, not "someday". |
| **Untyped `jsonb` rules.** `negotiation_rules.condition/action` are jsonb validated only by Zod at the edge. Fine at 10 tenants; at 1,000, bad rules will be written by a dashboard. | A malformed rule silently never fires (or worse, always fires). | Add a `validate_rule()` CHECK via a SQL function when the dashboard ships. |
| **The n8n JSON generator.** `tools/build-workflows.mjs` regenerates workflows that will soon be edited live in n8n by you or customers. Two sources of truth. | A regeneration silently reverts a hand-fix. | At cutover, freeze the generator: n8n's UI becomes the source of truth for what remains there. |
| **`SAFE_SMALL_INTEGERS` in the numeral guard.** 0–12 are allowlisted; "I can do 12% off" would pass the guard. | A small invented discount slips through. | Tighten: percent-adjacent numerals must always be sourced. Do this in Week 2, it's a regex. |

That last row is a real hole I am flagging in my own Week 1 code — the guard as
shipped would allow a hallucinated single-digit discount percentage. Fix before
any live traffic.

---

## 3. What schema changes should happen now rather than later?

Done in `migrations/0002–0005` because retrofitting them onto live data is 10×
the cost:

1. **RLS + `yiwuflow_app` role + `current_business_id()`** — retrofitting RLS
   onto a live multi-tenant DB is a quarter-long project; today it is one file.
2. **`orders_one_open_per_conversation`** — the money invariant. Must exist
   before the first real customer can double-tap "yes".
3. **`channel_credentials` with `secret_ref`** — kills payload-derived tenancy
   and plaintext secrets in one table. Every channel milestone builds on it.
4. **The commercial schema** (tiers/policy/rules/bundles/substitutions) — the
   negotiation engine cannot exist without it, and seeding tiers from the scalar
   price is trivial now, painful after ingestion floods the catalog.
5. **`conversation_signals` + `conversation_events`** — anything not recorded
   from day one is unrecoverable history.

Deliberately deferred: pgvector column + HNSW index (Week 2, with the retriever —
no point indexing 15 seed rows); `call_sessions`/`call_transcripts` (with the
call service); partitioning of `messages`/`conversation_events` (see Q6).

---

## 4. What future requirements are missing from the roadmap?

- **Follow-ups / re-engagement.** An elite salesperson's superpower is not
  answering — it is *following up*. "Client went quiet in commercial_discussion
  for 48h → send a nudge in their language." This is a scheduled job over
  `conversation_state.last_message_at` plus one prompt. Probably the single
  highest-ROI unbuilt feature in the entire vision, and it is on nobody's list.
- **Working-hours & holiday awareness.** B2B buyers notice a "salesperson" who
  answers at 4am their time and on Chinese New Year. Tiny table, big realism.
- **Quote documents.** Serious B2B buyers expect a PDF proforma invoice, not a
  chat bubble. The deterministic `Quote` object renders to PDF trivially; plan it
  with order confirmation v2.
- **GDPR/PDPL deletion.** You store EU/GCC buyer PII (emails, phones, transcripts).
  A `forget client X` job — anonymise, don't delete FKs — is a legal requirement,
  not a feature. Cheap now.
- **Per-tenant model/cost budgets.** One tenant's viral RedNote post must not burn
  the platform's Anthropic quota. Rate limits per business_id in the worker.
- **The human agent's surface.** "Manual takeover" implies an inbox where a human
  reads the transcript and replies through YiwuFlow. A Telegram reply-bridge is the
  v1; without it, `assigned_to` pauses the AI and *nobody* answers the client.
  This is the sleeper dependency of Milestone 1 and it needs to be on the roadmap
  explicitly.

---

## 5. How should the call assistant share logic with the messaging engine?

**Share the decisions, not the pipeline.** The boundary drawn in Week 1 is
exactly the seam:

| Shared (already pure) | Call-specific (new, streaming) |
|---|---|
| `decideTurn` — gates, fast path, state folding | Twilio media-stream WebSocket handling |
| `computeQuote`, `toConfirmableOrder` | Streaming STT (partials, endpointing) |
| `computeScores`, handoff thresholds | Streaming TTS, barge-in |
| `guardNumerals` — applied to the *transcript* before TTS | Turn-taking / silence heuristics |
| `ConversationState`, RLS, repos | `call_sessions` / `call_transcripts` tables |

The realtime loop cannot wait for the full batch pipeline, so it runs a
**two-tier pattern**: a fast conversational layer streams acknowledgement tokens
immediately ("let me check that for you…") while `decideTurn` + retrieval + quote
run in parallel; the substantive answer streams as soon as the decision lands.
The numeral guard runs on the text *before* TTS — an invented price is exactly as
forbidden spoken as written.

Deployment: same codebase, second entrypoint (`src/call/`), possibly a separate
process for latency isolation — but the same `core/` import. That was the point
of the purity rule: **the call assistant is a second caller, not a second system.**

One honest caveat: sub-500ms turn-taking with quote computation in the loop will
require caching the tenant's catalog/policy in memory per call session. Plan for
a per-call context object hydrated once at call start and refreshed on demand.

---

## 6. What changes at 1,000 businesses instead of 10?

The architecture holds; the operations story is what changes. In priority order:

1. **Noisy-neighbour isolation.** Per-tenant concurrency caps and LLM budgets in
   the worker (pg-boss `teamSize` per queue + a `usage_ledger` check). One
   tenant's spike must degrade *their* latency, not everyone's. This is the first
   thing that breaks and the cheapest to build early.
2. **Connection math.** 1,000 tenants ≠ 1,000 pools. One PgBouncer in
   *transaction* mode — which `SET LOCAL app.business_id` survives, because it is
   transaction-scoped. (This is why ADR-0005 chose `set_config(..., true)`; the
   session-mode alternative would have blocked pooling.)
3. **Partition the two append-only giants.** `messages` and `conversation_events`
   by month (`created_at` range). Everything else stays unpartitioned — at 1,000
   tenants the *catalog* tables are still small.
4. **Embedding index locality.** One HNSW index over all tenants degrades recall
   for small tenants as big tenants dominate the graph. Fix is a `business_id`
   filter with pgvector's iterative scan (0.8+), or partial indexes for the top
   few whales. Decide when p95 retrieval > 50ms, not before.
5. **Config becomes data.** At 10 tenants, prompts/thresholds per tenant can live
   in code. At 1,000 they are rows (`business_settings`), edited in the dashboard,
   with the platform defaults as fallback. Design the lookup that way in Week 2 —
   it is a one-day change now.
6. **Onboarding is the product.** At 1,000 businesses, "upload your catalog, set
   floor prices, connect WhatsApp" must be fully self-serve. The ingestion
   pipeline's staging → diff → approve flow (ADR-0001 §5.6) is not an admin
   convenience; it *is* the growth constraint.

What deliberately does **not** change: one service, one Postgres (bigger box +
read replica before any sharding conversation), pg-boss until a measured queue
bottleneck, n8n still only at the edges.

---

## Reversed: the yiwuflow / Nomi name split (2026-08-08)

`PRODUCT.md` argued for a deliberate split — internal identifiers named
`yiwuflow`, the product the owner sees named **Nomi** — on the grounds that
renaming a repository, a database and a role is risk with no user-visible
benefit.

**That is reversed. There is one name, and it is Nomi.** The split cost more
than it saved: two vocabularies for one thing, in a codebase whose central
discipline is that a name means exactly what it says. Every surface an owner
reads already said Nomi, so nothing she sees changed.

What did NOT change, deliberately:

- **Migrations 0001–0022 still say `yiwuflow_app`.** They are applied history
  and forward-only (ADR-0007); the role name in them records what was true when
  they ran. The rename is migration 0026.
- **This directory and `docs/archive/` still say yiwuflow.** They are the record
  of decisions taken under that name, and rewriting them would falsify it.
- **The database is still named `yiwuflow`.** `ALTER DATABASE ... RENAME`
  requires zero open connections, which Railway does not generally allow.
  Documented as historical in `DEPLOYMENT.md` rather than bundled into the role
  rename — that would turn two recoverable problems into one unrecoverable one.

The role rename spends nothing: it ships across three releases so that an older
build still runs against the newer schema, which is the rollback property
ADR-0007 exists to provide.
