# Practice, per workspace

The owner's decision (2026-09-30): Practice is per workspace, and it blocks
anyone outside signing up. One shared sandbox that every signed-in owner can see
and reset is a data leak as soon as there are two customers. T1 (#129) already
limits the shared sandbox to the pilot workspace. This replaces it.

The plan is items P1–P6 in the self-serve plan, "Practice before anything real".
This note is P1: the decisions the plan left to it, and the table-by-table
classification the later items build on.

## The design in one paragraph

Each workspace gets a **practice copy**: a second `businesses` row whose
`practice_of` is the owner's, created on first use. The copy holds what the
assistant needs to answer *as this business*: profile, catalogue, prices, rules,
the assistant and the owner's settings. It holds nothing about anyone real: no
customer, conversation, channel or person. Before **every** practice turn, one
definer function refreshes the copy from the live workspace, so a price fixed on
Products shows in the next practice message. The owner writes as a customer.
The message goes through the real worker and turn to a practice channel adapter
that has no network code, and the reply comes back on the page.

## What is copied, and what is not

`tests/integration/practice-tables.ts` names every business-scoped table exactly once.
A test holds the list against the schema: a table added later that nobody
classified fails it.

**Copied (16 tables, plus 3 child tables with their products):**
- **Products:** `products` (with `price_tiers`, `product_aliases`, `product_images`) and `product_knowledge`.
- **Prices:** `pricing_policy`, `negotiation_rules`, `bundle_rules`, `substitution_rules`.
- **Rules:** `claims_policy`, `forbidden_terms`, `factory_closures`.
- **Terms:** `sample_policy`, `trade_terms`, `owner_rates` — the current row only, since these are history tables.
- **The assistant and the owner's settings:** `assistants`, `onboarding_state` (the name confirmation), `autonomy_policy`.
- **The operator's switches:** `ops_flags`. A silenced assistant is silenced in Practice too.
- **Columns on the `businesses` row:** the profile (name, kind, what it sells, country, time zone, language) and the owner's Stop (`assistant_stopped_at`).

**How the refresh treats them:**
- **Updated in place, matched by `source_id`:** `products` and `assistants`.
  Practice's own quotes, orders, conversation state and conversation point at
  them with no cascade, so a delete-and-reinsert refresh would fail as soon as
  Practice had quoted.
- **Deactivated, never deleted:** a product removed from the live workspace
  (`is_active = false`).
- **Replaced whole:** everything else.
- **Never touched:** rows that Practice writes itself: its conversation,
  drafts, turns, quotes, orders and the practice customer.

**Not copied (55 tables):**
- **What happened:** conversations and everything that hangs off them, drafts, turns, quotes, orders, signals, spot checks, capability evidence, deletion rows, calendar entries.
- **Who:** customers, contacts, consent, suppressions, enrichment.
- **Where:** every channel, credential and sending identity.
- **People and logins.**
- **The outreach area.**
- **The ledger, budgets, subscriptions and errors.**

## Nobody real is at risk, by construction

- **No channel.** A database trigger refuses a channel credential, a Meta
  account or a mail account on a practice business. Until now this rested on
  seed data and an environment comparison.
- **No network.** The practice channel adapter has none, and a test holds that
  it imports no HTTP client.
- **No alerts.** The notify consumer refuses a practice business, so no owner
  alert is ever sent from Practice.
- **Its own customer identity.** `client_channels` is unique across the
  installation, so each copy's customer is `practice:<copy id>`. The shared
  sandbox's one "sandbox-buyer" would collide between copies.
- **Not counted as a workspace.** Anything that scans the whole installation
  skips copies: fleet counts, operator tools, the daily checks. Otherwise every
  owner who practises is counted twice.
- **Erased with its owner.** `erase-workspace` erases the copy too.
- **Never evidence.** Practice approvals never count toward sending alone: the
  copy's drafts belong to another business, so the real evidence never sees
  them. A self-demotion on the copy lasts one message, because the next
  refresh restores the owner's real levels.

## The three decisions P1 had to make

1. **The channel: Practice runs as Instagram.** The adapter is picked by
   `practice_of`, so Practice shows Instagram's own rules (the 24-hour window).
   It needs no new channel value, which would change four check constraints. The
   shared sandbox practised as WhatsApp. Instagram and Messenger are the channels
   a new workspace connects first (WhatsApp self-serve is phase 8), so they are
   what an owner should practise against.
2. **Practice transcripts expire after 30 days.** "Try it" pastes a real
   customer's question into Practice. Once there, it is no longer tied to that
   customer, so `erase-buyer` cannot find it. A daily job erases practice
   conversations older than 30 days, and "Start over" erases them at once.
   Thirty days is long enough to come back to a practice session, and short
   enough that a customer's words do not outlive a deletion request by long.
3. **The reply writer does not get the conversation's history yet (Q1W: no, for now).**
   - The analyser has the last six messages since #132 (Q1). What the writer
     answers is driven by that analysis and the conversation's state (product,
     quantity, phase, the pending question).
   - Giving the writer the transcript too is a prompt and send-path change that
     needs its own live check. It also widens what a model can repeat back.
   - Practice is exactly where a missing piece of context would show ("the black
     one, size M", then "is it in stock?"). The call is to let cohort practice
     show whether it is missed, and build Q1W (1 d) only if it is.

## What the items build

| Item | What |
|---|---|
| P2 | The `practice_of` migration (0086): the copy, `source_id` on products and assistants, `practice_refresh(live)`, the channel trigger, erase coverage, the per-copy customer identity, whole-installation readers skipping copies |
| P3 | Practice through the real ingress and worker, with a practice adapter that has no network, and a fourth live line |
| P4 | The page: why a reply waited, where each figure came from, "as if sending alone", the checklist (with its retail and no-catalogue variants), "your total first" |
| P5 | Practice charged to the owner's ledger (`practice_of`), 50 practice turns a day, and a platform flag that stops live practice |
| P6 | The shared sandbox retired. "Try it", Getting ready's ticks and the checklist move to the owner's own Practice |

Out of this pass: RT (a shop's price before quantity) is the plan's phase 3.
Until it lands, checklist item 8 shows the gap rather than passing.

## P3, as built (#146)

- **The message.** `POST /app/sandbox/message` refreshes the copy, writes
  the line on the practice transcript at once, and queues an ordinary inbound
  job on the copy (`sayInPractice`, `src/api/web/sandbox.ts`). The worker runs
  it like any customer's message: batching, the Stop, the hand-offs, the turn.
- **The checks.** The golden set's checks run on every practice turn in the
  worker (`src/trust/practiceChecks.ts`). The page shows what held.
- **The send.** The approval path and the owner's own reply go through the
  real outbound worker and its gate. For a copy, the worker hands over the
  practice adapter and nothing else (`driveOutbound`, `src/main.ts`), in both
  modes, including an installation with no channel.
- **The receipt.** A practice reply is recorded as delivered as soon as it is
  accepted, through the same receipt path a status webhook takes. The page
  is the customer's phone. Without this, the sequencer held every second
  reply 90 seconds for an Instagram receipt that never comes.
- **No alerts.** `deliverOwnerAlert` refuses a copy (`skipped_practice`).
- **The live line.** `/app/live/practice` counts both sides: the owner wrote
  the customer's side, so the news is the answer.
- **One lane.** The scripted/live choice is gone: every practice message is
  a live model turn (the plan: "the live model always"). The in-memory
  golden run stays on the page.
- **Still the pilot's alone** (T1) until P5 charges practice turns to the
  owner's ledger and caps them.
- **Not yet: a photo or a voice note in Practice.** The worker fetches media
  from the provider that received it, and a practice message has no provider.
  It needs an upload on the page (P4) and a practice media port.
