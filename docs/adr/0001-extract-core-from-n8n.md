# ADR-001 — Core Runtime: extract the engine from n8n

**Status:** Proposed
**Date:** 2026-07-14
**Decision:** Move the conversation engine into a TypeScript service. Keep n8n, but
demote it from *the product* to *an integration surface*.

---

## 1. The evidence

Measured from the repo, not asserted:

| | |
|---|---|
| Total nodes | 119 |
| Code nodes (hand-written JS) | **57 (48%)** — 725 lines |
| HTTP Request nodes | 31 — almost all raw Supabase REST |
| **Actual n8n integration nodes** | **1** (Google Sheets) |
| Of the 57 Code nodes: real business rules | 20 nodes, **431 lines** |
| Of the 57 Code nodes: pure plumbing | **37 nodes (65%)**, 294 lines |
| Tooling I had to write to test 431 lines of logic | **2,075 lines** |

Read those last three rows again.

**Your entire business logic is 431 lines of JavaScript.** Escalation scoring, the
phase machine, the injection filter, the fast path, order validation — all of it.
431 lines.

You are running 431 lines of JavaScript inside a **119-node distributed system with
a mouse-driven deploy step**, and **65% of the code you wrote exists only to move
data between nodes** — building request bodies, re-merging `$json` after an HTTP
node clobbers it, restoring context. That is not business value. That is rent.

And the thing n8n is *for* — connectors — you use **exactly once**. One Google
Sheets node out of 119. Everything else is `httpRequest` + JavaScript, i.e. things
a service does natively in one line.

You are paying the full price of n8n and collecting ~1% of its value.

### The decisive detail

To test the business logic, I wrote a script that **extracts JavaScript out of JSON
and executes it in a simulated n8n context** (`tools/test-logic.mjs`). It works —
55 assertions pass — but stop and consider what it proves:

**Every Code node is already a pure function of `$json`.** That is the only reason
the tests are possible. You have *already written* a stateless TypeScript service.
It is simply trapped inside a workflow engine, wearing a costume, with 294 lines of
plumbing wrapped around it and no type checker watching.

---

## 2. Cost of staying vs. leaving

### What staying actually costs

**Correctness.** The Milestone 0 bugs were three state columns that nothing ever
wrote (`pending_question`, `product_confirmed_by_client`, `client_email_collected`),
which made order confirmation *structurally impossible*. That is a textbook
"unwritten field on an untyped record" bug. A `ConversationState` type with a
discriminated union on `phase` makes it **unrepresentable**. n8n cannot ever catch
it, because to n8n `$json` is `any`, forever. You will keep finding these — they
live in the seams, and the GUI renders nodes, not seams.

**The 65% tax compounds.** Every future milestone pays it. Retrieval, negotiation
rules, ingestion, multi-tenancy — each arrives as ~2 plumbing nodes per 1 logic
node, forever.

**No safe change.** No types, no CI, no code review on a diff, no staged rollout, no
rollback. Editing the escalation scorer for a paying customer means editing
production in a browser tab.

**It cannot host the call assistant at all.** Sub-500ms turn-taking is impossible in
a request/response node graph doing 2 LLM calls and 6 REST round-trips (see §6).

### What leaving costs

431 lines to port. They are already pure functions. They already have 55 passing
tests that will transfer nearly verbatim as the acceptance suite.

**That's it.** That is the whole cost, *today*.

---

## 3. Migration effort: now vs. later

| Migrate | Scope | Effort | Risk |
|---|---|---|---|
| **Now** | 431 lines of pure functions + 6 SQL-backed flows. No live customers. No production data. 55 tests already written as the spec. | **2–3 weeks** | Low. Nothing is in production. Tests define done. |
| After M2 (retrieval + ingestion) | + embeddings pipeline, ingestion jobs, catalog services | 6–8 weeks | Medium |
| After M3 (real WhatsApp) | + a live channel you **cannot take offline**. Real customers mid-conversation. Stateful migrations under load. | 3–4 months | **High** — cutover with live conversations in flight |
| After M4 (Sheets/multi-tenant) | + per-tenant data, per-tenant config, per-tenant bespoke integrations | 5–6 months | Severe. You'd be re-platforming a SaaS with customers on it. |

**The cost of this decision roughly 8–10×'s over the next three milestones, and the
risk profile goes from "low" to "re-platform a live product."** Waiting is not a
neutral choice; it is the most expensive available option.

---

## 4. Target architecture

Guiding principle, and the one that fixes the hallucinated-price problem:

> **The LLM writes prose. Postgres owns the numbers.**
> The model may never emit a figure. It emits placeholders; a deterministic renderer
> substitutes values from SQL and rejects any reply containing an unsourced numeral.

Everything else follows from that.

```
                    ┌──────────────────────────────────────────┐
  WhatsApp ─┐       │              CHANNEL LAYER               │
  Instagram ─┤      │  thin adapters → UnifiedInboundMessage   │
  WeChat ────┼─────▶│  (verify signature, resolve tenant,      │
  RedNote ───┤      │   normalize, enqueue)                    │
  Telegram ──┤      └────────────────┬─────────────────────────┘
  Web widget ┘                       │  queue (pg-boss)
  Email ─────┘                       ▼
                    ┌──────────────────────────────────────────┐
  Phone ───────────▶│           CONVERSATION CORE              │
  (realtime svc,    │  ┌────────────────────────────────────┐  │
   streaming)       │  │ analyse → decide → retrieve → quote │  │
                    │  │        → generate → persist         │  │
                    │  └────────────────────────────────────┘  │
                    │  pure, typed, unit-tested                │
                    └───┬──────────────┬───────────────┬───────┘
                        │              │               │
                  ┌─────▼─────┐  ┌─────▼─────┐  ┌──────▼──────┐
                  │ Postgres  │  │ Retrieval │  │  Outbound   │
                  │ + pgvector│  │  hybrid   │  │  dispatch   │
                  │ RLS/tenant│  │ bm25+vec  │  │  + retries  │
                  └───────────┘  └───────────┘  └──────┬──────┘
                                                       │
                    ┌──────────────────────────────────▼───────┐
                    │        n8n — INTEGRATION SURFACE         │
                    │  Sheets/Excel sync, Telegram/Slack,      │
                    │  customer's own ERP/CRM automations      │
                    └──────────────────────────────────────────┘
```

### Stack

- **TypeScript + Fastify.** Same language as the 431 lines you already have.
- **Postgres** (Supabase managed now; portable later — it's just Postgres).
- **Kysely or Drizzle** — typed SQL. No ORM magic; the schema is already good.
- **pg-boss** for queues. Postgres-backed: **no Redis, no new infrastructure.**
  Retries, DLQ, scheduling, idempotency keys — the four things you have none of.
- **OpenTelemetry + Sentry.** Today a failed SendGrid call is invisible forever.

Deliberately *not* chosen: Kafka, Temporal, microservices, Kubernetes. A single
typed service plus Postgres will carry you to thousands of tenants. Add complexity
when a metric demands it, not before.

---

## 5. Subsystem designs

### 5.1 Messaging channels

One adapter per platform. **Thin** — verify signature, resolve tenant, normalize,
enqueue. Zero business logic.

```ts
interface ChannelAdapter {
  verify(req): boolean;                        // HMAC / platform signature
  resolveTenant(req): Promise<BusinessId>;     // ← from CREDENTIAL, never payload
  normalize(req): UnifiedInboundMessage[];     // batch-safe
  send(msg: OutboundMessage): Promise<Receipt>;
}
```

**Security fix, load-bearing:** `business_id` is derived from the *credential the
message arrived on*, never from the request body. Today `Normalize Payload` does
`b.business_id ?? $env.BUSINESS_ID` — accepting the tenant ID **from the caller**.
That is a cross-tenant read the day you have two tenants.

Outbound gets what it has none of today: retries with backoff, delivery receipts,
dead-letter queue, and a `message_deliveries` table. A silent send failure in a
sales system is unbilled revenue.

### 5.2 Call assistant — a separate service, not a milestone

Your pipeline is 2 sequential LLM calls + ~6 REST round-trips. That is seconds.
Phone conversation needs **sub-500ms** turn-taking. **This is not tunable; it is
architectural.** Batch request/response cannot become streaming.

```
PSTN → Twilio Media Streams (WebSocket, 20ms frames)
     → Deepgram streaming STT (partials + endpointing)
     → Conversation Core (streaming, tools, barge-in aware)
     → ElevenLabs streaming TTS
     → back over the same socket
```

It shares the **database and the business rules**, not the workflow. This is the
strongest argument for extracting the core: if the engine is a library, the call
assistant is a *second caller*. If the engine is 119 n8n nodes, it is a **rewrite**.

Tables: `call_sessions`, `call_transcripts` (with timings), `call_summaries`.
Latency budget: STT 150ms, LLM first-token 300ms, TTS first-byte 100ms.
Cheap trick that buys most of the perceived speed: stream a filler ("let me check
that…") while retrieval runs.

### 5.3 Retrieval — hybrid, and it must land before ingestion

Today the **entire catalog** is pipe-delimited into **every** analysis prompt.
15 SKUs fit. 5,000 do not — at any price. Ingestion (M2's whole purpose) is the
milestone that floods that table, so **retrieval must ship first or ingestion breaks
the engine on day one.**

```sql
-- 1. cheap recall: trigram on aliases (search_product_by_text already exists)
-- 2. semantic recall: pgvector on name+description+aliases embedding
-- 3. fuse with Reciprocal Rank Fusion, take top ~20
-- 4. ONLY those 20 go into the prompt
```

`pgvector` with an HNSW index handles millions of rows on one Postgres box. You do
not need a vector database. Semantic recall is also what makes the "customer is
just exploring / vague request" scenarios in the vision work at all — trigram
matching fundamentally cannot serve them.

### 5.4 Negotiation engine — schema first, prompt last

"Negotiate according to business rules" is currently unimplementable: `products`
has **one scalar price**. You cannot negotiate with one number, and there are no
discount, floor, or authority rules anywhere.

```sql
create table price_tiers (          -- volume breaks
  product_id uuid, min_qty int, max_qty int, unit_price_usd numeric);

create table pricing_policy (       -- the guardrail the AI may never cross
  business_id uuid, product_id uuid,
  floor_price_usd numeric not null,           -- hard floor
  max_discount_pct numeric not null,          -- AI's authority
  requires_human_above_discount_pct numeric); -- escalate past this

create table negotiation_rules (    -- "3% off above 10k units", "free samples >5k"
  business_id uuid, condition jsonb, action jsonb, priority int);
```

At runtime: a **deterministic** function computes the quote from tiers + policy.
The LLM is handed the *computed* quote and asked only to phrase it persuasively —
with a validator rejecting any reply containing a numeral not in the quote.

This kills three problems at once: hallucinated prices, prompt-injected discounts,
and "the AI gave away margin." **Sales intelligence is a schema problem before it
is a prompt problem.**

### 5.5 Multi-tenancy

Isolation must be enforced by the **database**, not by remembering to type a filter
into a URL in a GUI. One forgotten `business_id=eq.` is a breach.

```ts
// every request runs inside a tenant-scoped transaction
await db.transaction(async tx => {
  await tx.raw(`set local app.business_id = ?`, [businessId]);
  // RLS policies: using (business_id = current_setting('app.business_id')::uuid)
});
```

Application code then **cannot** read across tenants even if a query forgets the
filter — the database refuses. Per-tenant config (prompts, rules, channels, keys)
lives in `business_settings`; secrets in a vault, referenced by ID, never in
`channel_sources` as plaintext (which is what the schema does today).

### 5.6 Business knowledge ingestion

```
upload (CSV/XLSX/Sheets/PDF/API)
  → parse            (per-format, isolated)
  → staging table    (nothing touches live catalog yet)
  → validate + diff  (show the owner exactly what changes)
  → human approve    ← non-negotiable; bad pricing data = bad quotes = lost money
  → upsert + re-embed (async job)
```

The **staging + diff + approve** step is the part people skip and regret. An
ingestion bug that silently halves a price is indistinguishable from a working
system until the invoices arrive.

Products, price tiers, policies, FAQs, objection-handling material and negotiation
rules all flow through the same pipeline. Non-catalog knowledge (FAQs, policies,
scripts) goes into a `knowledge_chunks` table with embeddings — retrieved by the
same hybrid search.

### 5.7 Human handoff — it doesn't currently hand off

Today escalation fires Telegram, sets `phase = 'escalated'` — and **the AI keeps
replying.** Nothing checks the escalated phase. The customer who explicitly asked
for a human gets more bot.

```
lead_score high   → notify team, AI KEEPS SELLING (it's a buying signal)
problem_score high→ AI STOPS. assigned_to set. Human owns the conversation.
```

Requires: a hard `if (conversation.assigned_to) return;` gate before generation, an
agent inbox (even a Telegram thread reply-bridge to start), a takeover/release
transition, and an SLA timer that re-engages the AI if no human responds.

**This is the split your own doc asked for** and the reason it matters: today
`high_value` adds +60 to a single score, and order validation blocks the close at
`>= 70`. **Your biggest deals actively block their own confirmation.**

### 5.8 Analytics

Event-source it from day one — you cannot reconstruct funnels you didn't record:

```sql
create table conversation_events (
  business_id uuid, conversation_id uuid,
  type text,        -- message_in, product_matched, quote_sent, objection,
                    -- price_discussed, lead_hot, handoff, order_created, lost
  payload jsonb, created_at timestamptz);
```

Everything else (conversion rate, time-to-close, drop-off by phase, product
performance, AI-vs-human close rate, cost per conversation) is a materialized view
over that. Ship a warehouse only when a query gets slow — probably never.

---

## 6. What stays in n8n

Not zero. But not the engine.

| Keep in n8n | Why |
|---|---|
| Google Sheets / Excel sync | Genuinely fiddly; visual config is a real win |
| Telegram / Slack / email notifications | Trivial to wire, easy for staff to tweak |
| **Customer-facing integrations** | **The real long-term play** — let *your customers* wire YiwuFlow into *their* ERP/CRM/logistics without you writing bespoke code. This is a sellable SaaS feature, and it justifies the n8n investment properly. |

| Move to the service | Why |
|---|---|
| Intake, dedup, injection filter | Correctness-critical, needs types + tests |
| Conversation state machine | The bug factory. Types make M0's bugs unrepresentable. |
| Escalation / lead scoring | Business rules, must be versioned and tested |
| Retrieval + quoting | Latency-critical, needs real SQL |
| Order validation + creation | **Money.** Needs transactions and idempotency. |
| Response generation | Needs the numeral-validator guardrail |

n8n stops being the product and becomes what it is genuinely excellent at: the
**integration surface at the edges**.

---

## 7. Migration plan (2–3 weeks, no big bang)

1. **Scaffold** (2d) — Fastify + Kysely + pg-boss, pointed at the *existing* Supabase.
   Schema unchanged. Backward compatible.
2. **Port the 20 domain functions** (4d) — they're already pure. `tools/test-logic.mjs`
   becomes the acceptance suite; it must stay green. Add types; the 294 lines of
   plumbing simply evaporate.
3. **Shadow-run** (3d) — n8n keeps serving. The service consumes the same webhook and
   writes to a `shadow_` schema. Diff the outputs. **This is the de-risking step:**
   you can prove parity before cutting over.
4. **Cut over intake → engine** (2d) — n8n keeps Sheets/Telegram/SendGrid, called
   from the service via HTTP.
5. **Delete the plumbing** (1d) — 37 nodes, 294 lines, gone.

At no point is there a flag day. The tests are the contract.

---

## 8. What would change my mind

I should be honest about where this argument is weak:

- **If nobody on the team writes TypeScript**, the maintainability gain is a fiction
  and n8n's visual model may genuinely be the right call. This is the *only*
  argument I find persuasive, and it's a real one. If that's the case, say so — the
  answer changes completely.
- **If YiwuFlow is a one-factory internal tool** rather than a SaaS, 119 nodes are
  survivable. But every word of your vision doc says SaaS.
- **If the call assistant is abandoned**, the hardest constraint disappears — though
  retrieval, negotiation and multi-tenancy still each argue for extraction on their
  own.

None of these are true as far as I can tell. So: **extract now.**

---

## 9. If I were starting from scratch today

Exactly the above, minus the migration section:

**A single typed TypeScript service, Postgres with pgvector and RLS, pg-boss for
queues, thin channel adapters at the edge, a deterministic quoting engine that owns
every number, and an LLM confined to writing prose it is not allowed to invent facts
into. n8n bolted on the side as the customer-facing integration surface — which is
also a feature you can sell.**

The domain modelling you have is genuinely good — the phase machine is the right
abstraction, the schema is better than most I see, and the prompts are thoughtful.
**The problem was never the design. It's that 431 lines of good design are being
run by the wrong machine.**
