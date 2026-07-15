# YiwuFlow — Roadmap & Architecture Status

Companion to the master vision document. This file records **verified** status and
the architectural findings that should reshape the milestone order.

Everything below was checked against the code, not assumed.
Re-verify any time with:

```bash
node tools/validate-workflows.mjs   # structure, reachability, JS syntax
node tools/test-logic.mjs           # 55 assertions incl. the full close loop
```

---

## Corrected implementation status

The master doc's status section predates the workflow build. Actual state:

| Phase | Master doc says | Actually |
|---|---|---|
| 1 Intake | BUILT | ✅ Built — `n8n/intake.json` |
| 2 Conversation memory | BUILT | ✅ Built — `n8n/intake.json`, `conversation-decision.json` |
| 3 AI analysis | BUILT | ✅ Built — `n8n/multimodal-analysis.json` |
| 4 AI response | BUILT | ✅ Built — `n8n/conversation-decision.json` |
| 5 Escalation | PARTIAL: *"missing notifications, handoff, hot lead"* | ⚠️ **Notifications BUILT** (Telegram, `escalation.json`). Handoff reply built. **Hot-lead detection genuinely missing.** |
| 6 Confirmation | PARTIAL: *"missing order workflows, email, sheets"* | ⚠️ **All three BUILT** (`confirmation.json`: order insert, SendGrid, Google Sheets). **But the close was structurally impossible until Milestone 0 — see below.** |
| 7 Catalog intelligence | PARTIAL: *"missing upload portal, ingestion, recommendation, image"* | ⚠️ **Image understanding BUILT** (Claude Vision + trigram catalog match). Upload portal, ingestion, recommendation engine genuinely missing. |

**Consequence: Milestones 4, 5 and 6 of the master roadmap are largely already
done.** The roadmap should be resequenced accordingly.

Not started, correctly: hot-lead detection, human handoff, knowledge ingestion,
recommendation engine, real WhatsApp, voice, calls, dashboard, multi-tenant.

---

## Milestone 0 — COMPLETE

The master doc framed M0 as validation. It was **repair**. The close loop could
never complete.

`prompts/order_validation.txt` gates every order on 9 rules. Two could never pass:

- **Rule 2** (`product_confirmed_by_client`) — only ever set by the fast-path
  handler. The fast path fires only when `pending_question === 'product_confirmation'`.
  **Nothing wrote `pending_question`.** Fast path = unreachable dead code; flag
  permanently `false`.
- **Rule 7** (`client_email`) — **no node extracted or persisted an email.**
  Permanently null.

The phase engine wrote 8 columns and none of the 3 the close depends on.
`safe_to_confirm` was therefore **always false**. YiwuFlow could converse but
could never close an order.

### Fixed

| Fix | Where |
|---|---|
| `pending_question` written after each reply, cleared when answered | `Parse Response JSON`, `Handle Fast Path Response` |
| `product_confirmed_by_client` set on explicit yes, model confirmation, or ≥0.90 auto-accept | `Phase Advance Decision` |
| `client_email` extracted by regex (deterministic — cannot hallucinate an address), persisted to `clients` | `Extract Contact Details`, `Supabase - Update Client` |
| Returning customer with a **closed** conversation gets a fresh one instead of a hard `throw` | `Active Conv Result` → `Has Active Conversation?` → `Resolve Returning Client` |

That last one was latent-fatal: Confirmation sets `is_active = false`, and Intake
threw if a known client had no active conversation. The first customer to ever
complete an order could never message again — masked only by the fact that nobody
could complete one.

Proven by `tools/test-logic.mjs`: a 4-turn conversation now satisfies all 9 rules.

---

## Two findings that should reshape M1 and M2

### 1. The escalation score blocks the best deals from closing

`escalation_score` seeds from the stored value and only ever **adds** — monotonic,
never decays, never resets. `order_validation` rule 9 blocks confirmation at
`score >= 70`. But `high_value` (>$10k) alone adds **+60**.

A large order that also discusses logistics (+25) or customization (+30) reaches
85–90 and **can never be confirmed.** The system actively prevents its most
valuable orders from closing.

The root cause is that one number conflates two opposite meanings. The master doc
already names the distinction — it just isn't implemented:

- **Problem escalation** (angry, confused, complaint, asks for a human) — *should*
  pause automation and block the close.
- **Sales escalation / hot lead** (big order, MOQ accepted, pricing and shipping
  discussed) — is a **buying signal**. It should notify the team and *accelerate*
  the close, never block it.

**M1 must split the score in two:** `problem_score` (gates confirmation, drives
handoff) and `lead_score` (drives hot-lead notification, never gates anything).
`high_value`, `customization` and `logistics_payment` move to `lead_score`;
`client_request`, `complaint`, `repeated_ambiguity` stay on `problem_score`.
This is a schema change (`conversation_state`) plus a rewrite of
`Escalation Score Calculator` and rule 9.

### 2. The catalog design has a hard ceiling around ~100 SKUs

The **entire product catalog** is pipe-delimited and inlined into **every**
analysis prompt (`Build Analysis Prompt`). 15 seed products fit comfortably. A
real factory with 5,000 SKUs will not fit in the context window at any price, and
cost scales with catalog size on every single message.

This directly undermines **M2 (knowledge ingestion)** — the milestone whose entire
purpose is to flood that table.

**M2 must replace catalog-dumping with retrieval** before ingestion ships:
1. Trigram/alias prefilter in Postgres (`search_product_by_text` already exists and
   does exactly this) to shortlist ~20 candidates.
2. Send only the shortlist to the model.
3. Add `pgvector` embeddings for semantic discovery — required anyway for the
   "customer is exploring / vague request" scenarios in the vision, which alias
   matching cannot serve.

Do this *before* ingestion, not after, or the first real customer catalog breaks
the analysis engine.

### 3. Smaller, but real

- **Single scalar price.** `products.price_usd_per_unit` is one number. Negotiation,
  volume discounts, MOQ breaks and discount rules — all core to the vision — cannot
  be expressed. Needs `product_price_tiers(product_id, qty_min, qty_max, unit_price)`.
  Blocks the Sales Intelligence capabilities.
- **No guardrail against invented numbers.** Core Principle 2 says the AI must never
  invent business information, but nothing validates that prices/MOQs in `reply_text`
  actually exist in the catalog. Quoting a wrong price to a B2B buyer is a commercial
  risk. Add a post-generation check that every figure in the reply traces to state.
- **Multi-tenant isolation is nominal.** `business_id` exists on every table, but
  the service key bypasses RLS entirely and `BUSINESS_ID` comes from an env var —
  i.e. one tenant per n8n instance. M12 needs `business_id` derived from the inbound
  channel, plus per-tenant RLS. Worth designing for now; the column is already there.
- **Catalog is re-fetched every message.** No caching (spec Node 2.6 asked for a
  30-min static-data cache; not implemented). Subsumed by the retrieval fix above.

---

## Resequenced roadmap

| # | Milestone | Status | Notes |
|---|---|---|---|
| **0** | **State repair + close loop** | ✅ **DONE** | Was mis-scoped as "validation". Was repair. |
| **0.5** | **First live run** | ⬜ **NEXT — blocking** | Nothing has ever run against real n8n/Supabase/Anthropic. All testing is unit-level. This gates everything. |
| 1 | Escalation split + hot lead + handoff | ⬜ | **Must split problem_score / lead_score first** (finding 1) or big deals stay unclosable. |
| 2 | Catalog retrieval, *then* ingestion | ⬜ | **Retrieval before ingestion** (finding 2). Add price tiers here too. |
| 3 | Real WhatsApp | ⬜ | Needs 360dialog account + WABA approval (**human blocker**). |
| ~~4~~ | ~~Google Sheets~~ | ✅ Built | `confirmation.json`. Needs live verification only. |
| ~~5~~ | ~~Order confirmation + emails~~ | ✅ Built | Unblocked by M0. Needs live verification. |
| ~~6~~ | ~~Image support~~ | ✅ Built | Vision + catalog match. Needs real image URLs in the seed. |
| 7 | Voice notes | ⬜ | Placeholder node exists. |
| 8 | Instagram | ⬜ | Meta API review (**human blocker**). |
| 9 | Excel | ⬜ | |
| 10 | AI call assistant | ⬜ | Needs `call_sessions`, `call_transcripts`, `call_summaries`. |
| 11 | Admin dashboard | ⬜ | |
| 12 | Multi-tenant SaaS | ⬜ | Design `business_id` resolution + per-tenant RLS early. |

**The real next step is 0.5, not 1.** 119 nodes across 6 workflows have never
executed against a live service. Building M1 on top of an unverified base means
debugging two layers at once.

---

## Human blockers

Everything else is automatable. These need you:

| Needed | For |
|---|---|
| Supabase project + service key | Everything |
| Anthropic API key | Everything |
| Real product images uploaded to a public `yiwuflow` bucket | Image pipeline (TC-006/007) |
| Google Sheets credential + sheet ID | Confirmation |
| SendGrid key + verified sender | Confirmation emails |
| Telegram bot token + chat ID | Escalation |
| 360dialog account + WABA approval | M3 real WhatsApp |
| Meta API review | M8 Instagram |
