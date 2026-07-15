# ADR-0011 — Sales operations: follow-ups, handoff, metrics, dashboard

**Status:** Proposed · **Date:** 2026-07-14
**Answers the eight Week-2 design questions.**

The thread running through all eight answers: **the difference between a chatbot
and a salesperson is what happens when the customer goes quiet.** Everything
built so far reacts to inbound messages. A salesperson *initiates*. That is the
next capability frontier, and it must be built with the same discipline as the
close: deterministic triggers, LLM phrasing only, hard caps enforced in code.

---

## 1. Follow-up automation

**Deterministic triggers, generated phrasing, code-enforced caps.**

```sql
create table follow_up_policies (        -- per business, editable in dashboard
  business_id uuid not null,
  phase       text not null,             -- which funnel stage this applies to
  quiet_hours integer not null,          -- silence threshold
  max_attempts integer not null default 2,
  is_active   boolean not null default true
);

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  conversation_id uuid not null,
  attempt integer not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  outcome text check (outcome in ('replied','ignored','opted_out','cancelled')),
  unique (conversation_id, attempt)      -- the money-invariant pattern again
);
```

A pg-boss cron job (hourly) scans for conversations where
`now() - last_message_at > policy.quiet_hours`, phase is active (not closed /
escalated / handed off), attempts < max, and the client has not opted out. It
schedules a follow-up **inside the tenant's working hours** (a B2B buyer who
gets pinged at 4 a.m. their time knows it's a bot).

The message itself: the LLM phrases it, the numeral guard applies, and the
*content strategy* is deterministic per phase — see Q2. **The kill conditions
are code, not judgment:** any inbound reply cancels pending follow-ups; two
ignored attempts stops the sequence; "stop messaging me" sets an opt-out flag
and raises a `problem` signal.

Why this is the highest-ROI unbuilt feature: every other milestone improves
conversations that are already happening. This one recovers revenue that is
currently evaporating silently.

## 2. Cadence adapts to lead score

Cadence is a **function of (lead score, phase)** — computed, not configured per
conversation:

| Lead score | First nudge | Second | Content strategy |
|---|---|---|---|
| ≥ 60 (hot) | 4h of silence | +24h | Concrete: restate the quote, offer the next step ("shall I hold this price while you decide?") |
| 30–59 (warm) | 24h | +3 days | Value-add: answer the open question, attach the product image, mention MOQ flexibility if policy allows |
| < 30 (early) | 3 days | +7 days | Light: "still looking for X? happy to send options" |

Two rules that matter more than the numbers (which are `follow_up_policies`
rows and will be tuned): **hot leads are followed up in hours, not days** — the
research on B2B lead decay is unambiguous — and **cadence never exceeds two
unanswered attempts** per conversation. Persistence reads as desperation;
a third touch only happens via resurrection (Q3), which requires a *reason*.

## 3. Resurrecting quiet leads

Resurrection ≠ follow-up. A follow-up continues a conversation; resurrection
**starts a new one, and needs a legitimate pretext.** Dormant = closed or
ignored > 30 days.

Deterministic pretext sources, checked monthly per dormant client:

- **New product in a category they inquired about** (`conversation_events`
  gives us their category history)
- **Price-tier improvement** on a product they were quoted (the `quotes` table
  knows exactly what they saw; if today's computed quote beats it, that is a
  true, verifiable "prices have improved since we spoke")
- **Seasonality** (their last order was ~11 months ago; B2B reorders cycle)

Each pretext creates a **new conversation** (the returning-client path already
handles this), tagged `resurrection` in events, capped at **one attempt per
client per quarter**. No pretext → no message. A resurrection without a reason
is spam, and spam burns the channel identity (WhatsApp bans, Instagram blocks)
— the cost is not one annoyed client, it is the whole channel.

## 4. Human ↔ AI collaboration

**The AI is the first contact layer; humans are the escalation tier and the
authority tier.** Three collaboration modes, all already grounded in Week 1/2
primitives:

1. **AI-only** (default): full pipeline, human sees analytics.
2. **AI-drafts / human-approves**: when `quote.requiresHuman` is true (discount
   beyond authority), the quote + drafted message go to the notify queue as an
   approval request. Human taps approve → message sends; edits → their version
   sends and the edit is logged (training data for tuning `pricing_policy` —
   if humans keep approving 8%, raise the authority to 8%).
3. **Human-owned** (`assignedTo` set): AI is silent. It keeps *listening* —
   signals and analytics still record — it just does not speak.

The interface, in build order: **v1 is Telegram** — the alert message carries
a transcript summary, the state (product, qty, quote, scores), and suggested
next actions; the agent replies in-thread and a small bridge posts it through
the outbound queue as the business. The dashboard inbox (Q8) replaces this
later; the Telegram bridge ships in days and unblocks Milestone 1.

## 5. Takeover and return-to-AI

The state machine (already enforced in `decideTurn` Gate 0 + `UNCLAIMED_AGENT`):

```
AI active ──problem/handoff──▶ unclaimed ──/claim──▶ human-owned ──/return──▶ AI active
                                   │                                   │
                                   └── SLA timer ──▶ AI holding reply  └── handover summary
```

- **Handoff** sets `assigned_to = 'unclaimed'` *immediately* — the AI is silent
  from the moment of escalation, not from when a human notices. (Week 2 tests
  cover this.)
- **Claim** (`/claim` in Telegram, button in dashboard): `assigned_to = agent`.
- **SLA timer**: if nobody claims within N minutes (per-business setting,
  default 15 during working hours), the AI sends ONE deterministic holding
  message ("a colleague will be with you shortly — meanwhile, is there anything
  I can prepare?") and re-alerts with escalating urgency. It does not resume
  selling.
- **Return** (`/return`): the agent hands back. Two things happen atomically:
  `assigned_to = null`, and a **handover summary is written into
  `context_summary`** — what the human agreed, promised, or learned. Without
  this, the AI's next reply contradicts the human and torches the client's
  trust in both. The summary is drafted by the LLM from the human's messages
  and **confirmed by the agent** before the return completes.
- Anything the human agreed that touches money must exist as a quote row
  (the human uses `/quote qty=5000 discount=8`) — the numeral guard applies to
  the AI's subsequent messages, so an off-book verbal promise is structurally
  unrepeatable by the AI. This forces commercial agreements into SQL, which is
  exactly where they belong.

## 6. What defines a successful salesperson AI

One north star, four drivers, three guardrails. Resist dashboard-itis: if a
metric doesn't change a decision, it's decoration.

**North star: closed order value per 100 conversations.** (Not conversion rate
alone — it is gameable by only engaging easy leads; value per conversation
captures both win rate and deal quality.)

| Driver | Definition | Why it moves the north star |
|---|---|---|
| Conversion rate | conversations → confirmed orders | the close |
| Speed to qualification | median turns from intake → qualified | fewer stalls, lower cost |
| Quote-to-order rate | quotes issued → orders | pricing + negotiation quality |
| Recovery rate | follow-ups/resurrections → re-engaged | the salesperson delta |

**Guardrails (may never degrade to improve the above):**

- Problem-handoff precision: humans requested that weren't detected (missed),
  handoffs a human judged unnecessary (noise)
- Numeral-guard violation rate (model attempting to invent figures — a rising
  rate means prompt or model drift)
- Order defect rate: cancelled/disputed orders ÷ orders (a "salesperson" that
  closes wrong orders is worse than none)

## 7. Analytics from day one

Already shipping (Week 2): `conversation_events` (append-only), `turns`
(replay), `quotes` (money audit). The remaining gap is the **taxonomy** — the
discipline of emitting a standard event set, plus a usage ledger:

```
message_in / message_out          quote_computed / quote_refused
product_matched / product_confirmed   order_created / order_blocked
email_captured                    lead_hot / handoff / claim / return
follow_up_sent / follow_up_replied    resurrection_sent
injection_blocked / guard_violation
```

Plus `usage_ledger` (tokens in/out, model, per business per day) — the day you
price YiwuFlow you need history, and it cannot be backfilled. Every metric in
Q6 is a materialized view over these two tables, refreshed hourly. No warehouse
until a query is measurably slow.

## 8. The dashboard is designed around the funnel, not around tables

The organizing principle: **a business owner opens the dashboard to answer
"where is my money and what needs me right now?"** — not to browse rows.

```
┌──────────────────────────────────────────────────────────┐
│ NEEDS YOU (inbox)          │ TODAY                       │
│ • 2 unclaimed handoffs ⏱   │ 14 conversations · 3 hot    │
│ • 1 discount approval      │ 2 orders · $7,300           │
├────────────────────────────┴─────────────────────────────┤
│ FUNNEL (live)                                            │
│ intake 12 → clarif 8 → qualif 5 → commercial 4 → conf 2  │
│          ▲ drop-off click-through to the conversations   │
├──────────────────────────────────────────────────────────┤
│ CONVERSATION VIEW (drill-in)                             │
│ transcript · state panel (product/qty/quote/scores)      │
│ TURN REPLAY: what the engine saw → decided, per turn     │
│ [Claim] [Approve quote] [Return to AI]                   │
└──────────────────────────────────────────────────────────┘
```

- **Inbox first** — it is the human half of Q4/Q5 and the only screen that is
  operationally *required*. Build order: inbox → funnel → catalog/pricing
  editors → analytics. (The Telegram bridge is the inbox's v0.)
- **The turn replay view is the differentiator.** The `turns` table lets the
  owner click any reply and see what the engine saw, what it decided, and which
  quote priced it. That is the trust story that sells an AI salesperson to a
  factory owner — "here is exactly why it said that" — and no chatbot vendor
  can show it.
- Catalog/pricing editors write through the same staging → diff → approve
  pipeline as ingestion (ADR-0001 §5.6). The dashboard is a client of the
  API, never a second write path to the database.

---

## Build order consequence

Milestone 1 (post-cutover) now has a concrete shape, in order:

1. Telegram bridge: claim / reply / return / quote commands (Q4/Q5 v1)
2. SLA timer + holding message
3. Follow-up engine (Q1/Q2) — policies table + cron + kill conditions
4. Metrics views (Q6/Q7) — SQL over tables that already exist
5. Resurrection (Q3) — after follow-ups prove the outbound discipline

Everything above runs on primitives that shipped in Weeks 1–2: `assignedTo`,
signals, quotes, events, the numeral guard, and the outbound queue.
