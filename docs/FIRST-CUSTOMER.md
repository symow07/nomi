# The First-Customer Experiment

## The pick (Priority 4)

**Vertical: custom-printed packaging** (non-woven/kraft/canvas bags, zip-locks).
**Geography: GCC importers** (UAE/Saudi first). **One factory, one WhatsApp
number, launched in draft mode.**

Why this beats the alternatives:

- **Repeat consumable.** Bags run out. The reorder-reminder and follow-up
  engine — our claimed differentiator — is *testable* in one purchase cycle.
  Electronics or furniture would take a year to show a second order.
- **Standardized enough to quote deterministically** (size/color/print/qty →
  tiers), custom enough that buyers *converse* instead of clicking a catalog.
  That conversation is precisely what we sell.
- **GCC:** dense Yiwu trade lane; the Arabic capability is a real moat (few
  competitors handle Arabic negotiation well); high WhatsApp penetration;
  UTC+3–4 vs Yiwu's UTC+8 means buyers write while the factory sleeps — the
  *strongest* possible demo of "the AI answered while you slept".
- The seed catalog already IS this vertical — every alias list and test case
  transfers.

## PMF metric

North star for the experiment (not revenue — one factory can't prove revenue):

> **Does the owner keep widening the AI's autonomy?**
> Concretely: within 30 days, ≥3 of 7 capabilities switched from draft to auto
> BY THE OWNER, unprompted, while draft-approval rate stays ≥80% unedited.

That is trust, measured behaviourally. Supporting metrics: qualified-lead rate
per 100 conversations vs the owner's WhatsApp baseline; median first-response
time (should collapse from hours to seconds); ≥1 reorder triggered by a
follow-up. Kill signal: owner edits >50% of drafts in week 3+ — the drafts
aren't good enough to sell, iterate before scaling.

## The learning loop (Priority 5)

Every production surprise gets exactly one of four destinations, logged in
`docs/learnings/` (one file per week, PR'd like code):

```
surprise → triage (weekly, 30 min) →
  ├─ EVAL      → golden-set case (tests/golden/) — decision was wrong
  ├─ TEST      → unit/parity test — code was wrong
  ├─ POLICY    → claims/pricing/autonomy row — the AI lacked authority data
  └─ SCHEMA    → migration — reality had a shape we couldn't store
```

Mechanical sources feeding triage: `drafts` where status='edited' (the owner
disagreed — why?), guard violations (what did the model try to say?), the
missed-escalation SQL (EVALS.md), `shadow.turn_decisions` divergences, and
`message_fragments` merge stats. The rule that keeps it honest: **a surprise
triaged nowhere is a decision to be surprised again.**

## Founder-lens architecture review (Priority 6)

Question per component: does it increase owner trust per hour of owner effort?

| Component | Founder verdict |
|---|---|
| Draft mode + autonomy ladder | **The product.** The owner watches the AI be right, then promotes it. Every design decision should feed this loop. |
| Turn replay (`turns`) | Trust asset — "here's exactly why it said that". Surface it in the approval UI ("draft based on: qty 5000, tier $0.45"). |
| Claims/numeral guards | Trust asset, invisible until the day they save a deal. Tell the owner when a guard fires: "I refused to promise CE certification because you haven't confirmed it" is a *selling point*. |
| S2 onboarding interview | Main friction. 4h is acceptable ONLY if we do the catalog cleanup. The 6-question commercial interview must be a WhatsApp conversation with the bot itself, not a form — dogfood from minute one. |
| Floor-price requirement | Keep, but reframe: in draft mode floor price is not needed on day 1 (the owner approves everything). It becomes required only to promote `quote` to auto. **Friction deferred to the moment it buys autonomy = friction the owner accepts.** |
| RLS / migrations / queues | Invisible to the owner. Zero friction, zero trust. Correctly sunk. |
| Sheets sync, image pipeline, multi-channel | Zero trust contribution for customer #1. Deferred (see the 50% cut). |
| Operational burden hotspots | Supabase free-tier pausing (Pro at launch); the DLQ alerts needing Telegram (10-min fix); prompt edits needing golden-set runs (already CI). Support burden = draft-mode edits, which is the learning loop working as designed. |
