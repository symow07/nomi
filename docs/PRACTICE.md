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

## P5, as built (#147)

- **Charged to the workspace.** A practice copy's turn is recorded on the
  workspace's own ledger and allowance (`practice_of`), never the copy's. The
  payer is known before any model is paid, so a turn that fails after paying
  is charged there too.
- **Fifty a day.** The fifty-first practice line of the UTC day (the ledger's
  day) is refused on the page, before anything is recorded or queued. Start
  over does not give the day back.
- **The platform's switch.** `practice_off` in `ops_flags` (0088), for
  everyone or for one workspace, refuses practice messages
  (`docs/INCIDENT-PLAYBOOK.md`).
- **Open to every workspace.** T1's pilot-only gate and the door's `practice`
  fact are gone. What keeps one workspace's practice from another's is the
  copy, and `practice-own.test.ts` holds that nothing crosses.

## P6, as built (#148): Practice is not kept

- **Start over erases.** The workspace's practice conversations go at once,
  with everything that hangs off them: messages, turns, drafts, quotes,
  orders, events and promised dates (`practice_start_over`, 0089). It asks
  first (CC-29's idiom). The copy, its catalogue and the practice customer
  stay.
- **Thirty days.** Once a day (03:40 UTC) `practice_expire` erases every
  copy's practice conversations quiet for thirty days. It takes no argument,
  so nobody can ask it for less.
- **The day's fifty survive Start over.** They are counted on the
  workspace's own row (`practice_day`, `practice_lines`), because the
  transcript P5 counted is now erased.
- **A job whose conversation is gone is dropped** by both workers: no turn,
  no send, no error.
- **The shared sandbox is retired from the product.** No page reads it, and
  the local smoke walkthrough no longer seeds it. Its production row still
  holds the pilot's practice from before P3. Erasing it is the owner's call
  (PROGRESS, "Waiting on the owner").
- **Deferred: the rehearsal findings' wider inputs** (forbidden words,
  closures, sample policy, terms, business-level knowledge in
  `factoryRehearsal.ts`). Practice now runs the real turn on the copy, which
  holds all of those, so what the in-memory rehearsal leaves out, Practice
  shows.

## P4, part one, as built (#149): the card, the reasons, the two switches

- **The conversation page's own card.** A reply waiting in Practice is drawn
  with the same card as a real conversation, posting to Practice's routes. It
  shows the reply once, why it waited (the owner's level, a language whose
  disclosure is unread, the name not yet chosen, a hold rule), and where each
  figure came from. It has one Send (the box's words, as the draft or as an
  edit), Hand to me, and No reply needed.
- **Handed to a person:** the reason, and "No reply was sent after this line"
  when the customer's line is the last.
- **The checks strip** names the product's own unit.
- **"As if sending alone"** (0090, `practice_alone` on the copy): the refresh
  gives the copy every capability alone instead of the owner's levels. It lifts
  the owner's level and nothing else. The name gate, the disclosure gate per
  language, hold rules, the operator's switches and the order tap still apply,
  and the waiting reply names which one. The workspace's own levels are never
  touched.
- **Practice's own Stop** (`practice_stopped_at` on the copy): messages are
  held and come to the owner, as with the real Stop. The real Stop, when on,
  stops Practice too.
## P4, part two, as built (#150): the checklist and "your total first"

- **The checklist** (`src/db/practiceChecklist.ts`). What the owner has seen,
  from the list for their kind of business:
  - **With a catalogue:** a product quoted with the total they expected; a
    product found by the name customers use; a question the assistant could
    not answer, handed over; "are you a real person?" answered honestly; a
    request for a person, handed over; a discount beyond their limit, held;
    Practice stopped, then a message handed over; an order they confirmed, and
    what the customer received.
  - **A shop or a brand** also has "How much is this?" answered with a price.
    It shows the gap ("not possible yet") until RT gives a price before a
    quantity.
  - **With no catalogue:** a price question answered without a figure and
    handed over, and a question about what they offer answered from the
    profile, in place of the product items. Discount, retail price and order
    do not apply.
- **Read from the real turn's rows** on the copy: the product the turn
  matched, the signals (`human_requested`, and the unanswerable kinds), the
  quote's `requires_human`, the held turn, the confirmed order proposal, and
  for "a real person?" the turn's own words and the reply it produced.
- **Seen once is seen.** Each item is written on the WORKSPACE (0091
  `practice_checks`) when the page is drawn and before Start over, so erasing
  Practice does not take a tick back.
- **"Your total first."** An optional box beside the practice message: the
  total the owner expects, typed before the answer comes (0091
  `practice_totals`). When the copy's next quote comes, the page sets the two
  side by side, and agreeing ticks the first item. The rows are also the
  measure the plan asked for: how often an owner's expectation and the quote
  disagree. They hold numbers only, never the customer's words.
- **An order in Practice** is the conversation page's own order card, and
  the owner's tap goes through the one order service on the copy. The
  confirmation leaves through the practice adapter.
- **Not built here:** feeding the checklist into a "Ready for customers" page
  (G6), and recording each item as a funnel event (G9). Neither exists yet.

