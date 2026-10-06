# The advisor's grounding: design for approval

**Status: a proposal. Nothing here is built.** The advisor's page (`/app/advisor`) is a shell. It answers every question with "coming soon", reads no data and writes nothing (the advisor run, 2026-10-06). This document says what the advisor may answer, where each answer comes from, and what it says when the data is not there. **It waits for the owner's approval before any of it is built.**

Contents:
1. The hard rule
2. How a question becomes an answer
3. Three kinds of question, and "I don't have that data"
4. The questions, one by one
5. The count
6. What every answer respects
7. When it is built: the wall, and privacy
8. Decisions for the owner

---

## 1. The hard rule

1. **A fact comes from a query, run when the question is asked, in the asker's own workspace.**
   - No figure, name, date or status comes from anywhere else: not the model's memory, an earlier answer, or an estimate.
   - The query is code, written and tested in advance for that kind of question (section 4). It runs in the signed-in person's tenant transaction (`withTenantTx`, row security), so it can see only their business.
2. **The model only phrases.**
   - It is given the question and the query's result, and writes a sentence from them.
   - It never computes (no sums, averages, differences or percentages of its own), never estimates, never fills a gap and never rounds a figure into a different one.
   - Every figure in an answer is computed by the query.
3. **When the data is not there, the answer says so, and never invents a figure.**
   - "There are no sales yet." "No orders were confirmed this month." "Nomi doesn't record customers' countries."
   - These sentences are fixed, written in advance for each question (section 3), in all five languages. The model does not write them.
4. **Every answer is checked before it is shown.** Any number, date, amount or customer name in the model's sentence that is not in the query's result throws the sentence away. The answer is then the plain, templated rendering of the result. A wrong sentence is never shown.
5. **Opinion is labelled, and stands on stated facts.**
   - An advice question ("what should I post?") is answered as opinion and says so.
   - It may cite only facts that came from a query, and it names them.
   - It never contains a figure the query did not produce.
6. **Read-only.** No question, answer or button on the advisor's page can send a message, change a price or alter a setting. This is enforced in code, not just on the page (section 7).
7. **The advisor answers only what the asker could already see in the app.**
   - A staff member gets what a staff member's pages show; the owner gets what the owner's pages show.
   - Needs-you is per reader, as on the Inbox (`needsOwnerFor(viewerId)`).

## 2. How a question becomes an answer

1. **Recognise the question.** The question is matched to exactly one entry of the catalogue (section 4, ids `A1`…`I6`) with its parameters: a customer's name, a period, a product.
   - The model may do this matching, but its output must be one catalogue id, or `unknown`.
   - An unknown question is answered with what the advisor can answer (a fixed list), never improvised.
2. **Run that entry's query.** This is code. The result is data (rows, counts, amounts with their currency, dates in the workspace's zone).
3. **Decide whether there is data** (section 3). If there is none, the entry's fixed sentence is the answer, and step 4 is skipped.
4. **Phrase, then check.** The model writes the answer from the result alone. The check in rule 4 runs. A failure falls back to the template.
5. **Show the sources.** Under the answer, a door to the page that shows the same thing: the Inbox, the calendar, Results, the customer's card. The owner can always look for themselves.

## 3. Three kinds of question, and "I don't have that data"

| Kind | Meaning | Questions (section 5) |
|---|---|---|
| **Grounded now** | An existing loader already computes it, and the same function feeds a page today. | 37, and half of 3 more |
| **New query** | The data is stored, but no loader answers this exactly. The query is given here and will be written and tested before use. | 8, and half of 1 more |
| **Not stored** | Nomi does not record it. It cannot be answered as a fact. | 10, and half of 2 more |
| **Opinion only** | Advice. There is no grounded answer; it is phrased as opinion and may cite facts from other entries. | 7 |

**How "no data" is detected, by the shape of the result**

| Result shape | No data when | What it says |
|---|---|---|
| A count or a total over a period | The count is 0, or no row in any currency. A second, small query (`exists` over all time, the same definition) then tells "never" from "not in this period". | Never: "There are no sales yet." In the period: "No orders were confirmed this week." |
| A list | Empty. | "Nobody has gone quiet." / "Nothing is on the calendar for the next 14 days." |
| One customer, product or order by name or reference | No match. Several matches: the advisor asks which, listing them (names only). | "There's no customer called Maria." |
| A field Nomi does not keep (**Not stored**) | Always. There is no query to run. | The entry's fixed sentence, e.g. "Nomi doesn't keep stock levels." |
| Stored but not filled in reliably | Treated as **Not stored**. | `clients.country`: the service never writes it, so country questions say so. |
| The query fails or times out | Any error. | "I couldn't look that up just now." **Never a fallback to the model.** |

The fixed sentences are catalogue keys (`advisor.none.*`), in the five languages, under the same tests as every other line. None says "AI" or gives the advisor a pronoun or a gender.

---

## 4. The questions, one by one

Each entry gives the exact source, its kind, and what the advisor says when there is nothing. Paths are under `src/`. "Definition" means the product's existing meaning, reused, never redefined.

### A · Customers

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| A1 | How many customers do we have? | `readBuyersPage(tx, { filter: 'all' }).total` (`db/buyersList.ts`): one per customer, the Inbox's own count. | Grounded now | "No customer has written yet." |
| A2 | Who are my customers? Show me the list. | `readBuyersPage(tx, { filter: 'all' })`, 50 a page, the waiting order first, as the Inbox shows them. | Grounded now | as A1 |
| A3 | Tell me about Maria. | Name lookup with the Inbox's search (`buyersList.ts`, name, phone, e-mail or handle; never message text), then `loadCustomerCard(tx, clientId, viewerId)` (`db/customerCard.ts`): channels, last wrote, what they bought, asked about, spent, regular, waiting. | Grounded now | No match / several (section 3) |
| A4 | When did I last talk to Maria? When did she last write? | They last wrote: `customerCard.lastWrote` (newest inbound `messages.sent_at`). We last wrote: newest outbound `messages.sent_at` over the customer's conversations: `select max(m.sent_at) from messages m join conversations c on c.id = m.conversation_id where c.client_id = $1 and m.direction = 'outbound'`. | Grounded now (they) / New query (we) | "There's no message from Maria." |
| A5 | Who contacted us most recently? | `select c.client_id, cl.display_name, max(m.sent_at) as at from messages m join conversations c on c.id = m.conversation_id left join clients cl on cl.id = c.client_id where m.direction = 'inbound' group by 1, 2 order by at desc limit 10` | New query | "No customer has written yet." |
| A6 | How many new customers this week / month? | `loadAnalytics(db, bid, range).newClients` (`api/web/analytics.ts`): customers who talked in the period and were first seen in it. | Grounded now | "No new customers this week." |
| A7 | Who are my best customers? Who spent the most? | `readBuyersPage(tx, { filter: 'all', lens: 'value' })`, ordered by SPENT. Definition: orders in `SPEND_STATUSES` (`db/customerValue.ts`), each customer's total in the currency of their newest standing order. | Grounded now | "No customer has an order yet." |
| A8 | Who are my regulars? | `customerValues(tx, ids).regular`. Definition: 3 or more standing orders (`REGULAR_ORDERS`). | Grounded now | "No customer has ordered three times yet." |
| A9 | Where are my customers from? Customers by country. | `clients.country` is never written by the service. | **Not stored** | "Nomi doesn't record customers' countries." |
| A10 | Which channel do most customers use? | `select c.channel, count(distinct c.client_id) from conversations c group by 1 order by 2 desc` | New query | "No customer has written yet." |

### B · Conversations, and what waits

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| B1 | Who is waiting for me? What needs me? | `loadInboxList(db, bid, 'pending', viewerId)`, with each one's reason from `needsWhy` (`api/web/inbox.ts`). Definition: `needsOwnerFor(viewerId)` (`db/buyersList.ts`). | Grounded now | "Nobody is waiting for you." |
| B2 | Any replies to review? | `readAttention(db, B).pendingApprovals` (`api/web/operations.ts`): pending drafts. | Grounded now | "No reply is waiting for your review." |
| B3 | Who was handed over to a person? | `readAttention(db, B).handoffs`: WAITING_HUMAN, `assigned_to = 'unclaimed'` (`core/conversation/ownership.ts`). | Grounded now | "Nobody is waiting for a person." |
| B4 | Did any reply fail to reach a customer? | `readBuyerCounts(tx, viewerId).blocked`. Definition: `IS_BLOCKED`, a cancelled send with a reason, in the last 7 days. | Grounded now | "Every reply in the last 7 days reached its customer." |
| B5 | How many conversations this week / month? | `loadAnalytics(…).activeConvos`: customers with any message in the period. | Grounded now | "No conversations this week." |
| B6 | Any unread messages? | Nothing records what the owner has read. | **Not stored** | "Nomi doesn't track what you've read." It then offers B7's question instead. |
| B7 | Who wrote last and got no answer? | `loadInboxList(…, 'all')` rows where the customer's message is the newest (`unanswered`, `inbox.ts`). | Grounded now | "Every customer who wrote has had an answer." |
| B8 | How fast do we reply? | Not stored. It could be computed (each inbound message to the next outbound `sent_at`), but that is a new metric: see decision 1. | **Not stored** until decided | "Nomi doesn't measure reply times." |
| B9 | Any deletion requests? | `readBuyerCounts(…).deletion`. Definition: `deletion_asks.state = 'waiting'`. | Grounded now | "No deletion request is waiting." |

### C · Gone quiet, and follow-ups

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| C1 | Who has gone quiet? | `readAttention(tx, now, viewerId)` (`db/inboxAttention.ts`), the Inbox's "slipping" band. Definition: a given price, a question we asked, or a question they asked, 3 to 30 days ago (`QUIET_AFTER_DAYS`, `QUIET_UNTIL_DAYS`) with nothing since; or a regular past their usual gap. The answer says which kind each one is. | Grounded now | "Nobody has gone quiet." |
| C2 | Who hasn't answered since we gave them a price? | C1's `quote` entries (`quietAfterPrice`). Definition: `PRICE_GIVEN` (`db/quotesGiven.ts`). | Grounded now | "Everyone answered after their price." |
| C3 | Which regulars stopped ordering? | `customerValues(…).quietSince`: last order older than `max(30, 2 × median gap)` days. | Grounded now | "No regular has gone quiet." |
| C4 | What follow-ups are due? | `loadCalendar(db, bid, { category: 'promised' … })` (`db/calendar.ts`): the follow-ups a sent reply promised (`promised_dates`). With the outreach area on, also `followups` (`sequence_enrollments.next_due_at`). | Grounded now | "No follow-up is due." |
| C5 | Why did we lose that deal? Which deals did we lose? | Nothing records a lost deal or its reason. | **Not stored** | "Nomi doesn't record why a deal was lost." |

### D · Sales and orders

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| D1 | How much did we sell this week / month / today? | `loadAnalytics(db, bid, range).totals`. Definition: orders in `SPEND_STATUSES` (`confirmed`, `in_production`, `shipped`), dated `coalesce(confirmed_at, created_at)` in the workspace's zone; **one total per currency, never added across currencies**. The amount columns are named `*_usd` but are in the row's own `currency`. | Grounded now | Never: "There are no sales yet." In the period: "No orders were confirmed this month." |
| D2 | How many orders? What state are they in? | `loadAnalytics(…).orders` (standing) and `.deals` (count per status). | Grounded now | as D1 |
| D3 | Which orders wait for my OK? | `order_proposals.state = 'pending'` (`ORDER_WAITING`, `buyersList.ts`), the Inbox's "order waiting". | Grounded now | "No order is waiting for you." |
| D4 | How many prices did we send? | `readTally(tx, B, zone, start).quotes` / `loadAnalytics(…).quotes`. Definition: `PRICE_GIVEN`, so a price that never left is not "sent". | Grounded now | "No price was sent this week." |
| D5 | What's our average order? | `select currency, count(*), sum(total_value_usd) from orders where status = any(SPEND_STATUSES) and coalesce(confirmed_at, created_at) >= $from group by currency`. The division is done in code, per currency; the model receives the result. | New query | as D1 |
| D6 | What's our conversion / win rate? | Not computed, on purpose (`analytics.ts`: "No conversion rates"). | **Not stored** until decided (decision 1) | "Nomi doesn't calculate conversion rates." |
| D7 | Are we doing better than last month? | New: D1's query for the same days of the previous month (the insights' month change counts every order, cancelled included, so it is **not** reused). The answer gives the two figures per currency, never a percentage. | New query | as D1, for each month |
| D8 | How much is that in my own currency? | Only if decision 1 allows it: `owner_rates`, the rate the owner stated, with its date (`loadCurrentRate`, `api/web/settings.ts`). No live exchange rate exists. | **Not stored** until decided (decision 1) | "Nomi doesn't convert between currencies." |
| D9 | Has Maria paid? Any unpaid invoices or refunds? | No payment or invoice data. | **Not stored** | "Nomi doesn't record payments." |
| D10 | What's our profit / margin? | No costs are stored. | **Not stored** | "Nomi doesn't know your costs." |
| D11 | Where is order YW-2026-10-0419? | Look up `orders.order_reference` (unique per business), then `loadOrder(db, bid, orderId)` (`api/web/orders.ts`): the order, its state history (`order_updates`), tracking if recorded. | New query (the lookup) | "There's no order YW-…" |

### E · Schedule

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| E1 | What's on today / this week? | `loadCalendar(db, bid, { from, to })` (`db/calendar.ts`), minus what is done (`isDone`, `api/web/calendar.ts`). Each entry carries its source row. | Grounded now | "Nothing is on the calendar today." |
| E2 | What's coming up? | Home's next dates: `loadToday(…).schedule`, the next 4 within 15 days, else within 90. | Grounded now | "Nothing is dated in the next three months." |
| E3 | Which samples are waiting to go out? | `sample_requests where handled_at is null` (`loadSamples`, `api/web/settings.ts`; calendar `sample_asked`). | Grounded now | "No sample is waiting." |
| E4 | Which replies are overdue? | Calendar `reply_due` with its overdue flag: open `handoffs.sla_deadline_at`. | Grounded now | "No reply is overdue." |
| E5 | When are we closed? | `loadClosures` (`factory_closures`, not archived). | Grounded now | "No closure is set." |
| E6 | When will Maria's order arrive? | Only a delivery date a sent reply promised (`promised_dates`, kind `delivery`). Nomi never turns lead times into dates. | Grounded now (a promise) / **Not stored** (otherwise) | "No delivery date was promised for that order." |

### F · Products

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| F1 | What do we sell? What's the price of the tote? | `loadProductList` / `loadProductDetail` (`api/web/products.ts`): the products and their **stored** price tiers. Never a new quote: the pricing engine is not called from here. | Grounded now | "There are no products yet." / "The tote has no price yet." |
| F2 | What sells best? | `select o.product_id, p.name, count(*), sum(o.quantity), o.currency, sum(o.total_value_usd) from orders o join products p on p.id = o.product_id where o.status = any(SPEND_STATUSES) and coalesce(o.confirmed_at, o.created_at) >= $from group by 1, 2, 5 order by 3 desc` (one product per order: no line items). | New query | "No order yet." |
| F3 | What do customers ask about most? | The per-customer `askedAbout` sources (`db/askedAbout.ts`: the analysis's product, quotes, the identified product), counted across the workspace for the period. | New query | "No product was asked about this month." |
| F4 | Which products have no price? | Insight `productsNoPrice` (`api/web/insights.ts`): active products with no price tier. | Grounded now | "Every product has a price." |
| F5 | How much stock do we have? | No stock is stored (and "promise stock" is never allowed). | **Not stored** | "Nomi doesn't keep stock levels." |
| F6 | What does the tote cost us? | No costs stored. | **Not stored** | as D10 |

### G · The assistant

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| G1 | How much does the assistant do alone? | The level chosen and the level in force: `loadEmployee` + `aloneInForce` (`api/web/employee.ts`), Settings' first row. | Grounded now | Always has an answer. |
| G2 | How many conversations did it handle this week? | Home's definition: `readHandled(tx, B, start)` (`api/web/today.ts`), conversations where a reply it wrote went out. Results counts something else (drafts approved or edited): see decision 3. | Grounded now | "It hasn't handled a conversation this week." |
| G3 | How many did it send alone, and how many did I approve? | `conversation_events.type = 'auto_sent'` in the period (alone), and `drafts.status in ('approved', 'edited')` decided in the period (approved, edited). | New query | "Nothing was sent this week." |
| G4 | How often did I correct it? | `loadAnalytics(…)`: edits, drafts edited in the period. | Grounded now | "You didn't edit a reply this week." |
| G5 | What couldn't it answer? | `loadKnowledgeOps(db, bid, range).gaps` (`api/web/knowledge-insights.ts`): the questions without taught knowledge, grouped. | Grounded now | "It found an answer to every question." |
| G6 | Why did customers need a person? | `loadPilotFeedback(db, bid, range).handoffReasons` (`api/web/pilot.ts`): the reasons, counted. | Grounded now | "No customer needed a person." |
| G7 | Is there work of its to check? | `loadPendingSpotChecks` (`pipeline/spotChecks.ts`). | Grounded now | "Nothing is waiting to be checked." |
| G8 | Is it stopped or paused? | `assistantHold` (`db/assistantStop.ts`): the owner's Stop, or the operator's pause. | Grounded now | Always has an answer. |
| G9 | Is it doing a good job? | No score exists, on purpose. | **Opinion only**, on G2 to G7's figures, which it names | — |

### H · The business

| Id | Questions | Source (exact) | Kind | No data |
|---|---|---|---|---|
| H1 | What are our payment terms / sample policy / how we sell? | `loadTerms`, `loadSamples` (`api/web/settings.ts`), `loadProgress` / `loadSellingState` (`db/howYouSell.ts`), `loadBusinessProfile`. | Grounded now | "Your payment terms aren't set." |
| H2 | Are we open now? What are our hours? | `businesses.working_hours` is free text: the advisor can quote it as written, but cannot tell "open now". | Grounded now (the text) / **Not stored** (open now) | "Your opening hours aren't set." |
| H3 | What does the assistant know about the tote? | `loadKnowledgeIndex` (`api/web/knowledge.ts`), the taught facts. | Grounded now | "Nothing was taught about the tote yet." |

### I · Advice (opinion only)

These are answered as opinion, under a line that says so ("My suggestion, not a fact from your records:"). Each may cite only facts from the entries named, and names them.

| Id | Questions | May stand on | Never |
|---|---|---|---|
| I1 | What should I post? | F3 (what customers ask about), F2 (what sells), G5 (what it couldn't answer) | A figure the queries did not produce; claims about what other businesses do |
| I2 | What are we doing wrong? | G6, G5, C2, B4, G4 | Blame, a score, a percentage |
| I3 | Which customers should I follow up first? | C1, C2, C3, A7 | A promise to the customer; an action (nothing is sent from here) |
| I4 | Should I raise my prices? | F1 (the stored tiers), D1, D2 | A price as fact; changing a price (read-only) |
| I5 | What's our strategy? How do I grow? | Any grounded entry, named | Market or competitor claims (Nomi stores none) |
| I6 | What are my competitors doing? | Nothing: no data | Any claim about a named competitor; it says Nomi has no information about them |

---

## 5. The count

65 questions in all.

| Kind | How many | Which |
|---|---|---|
| Grounded now | 37 | A1, A2, A3, A6, A7, A8; B1, B2, B3, B4, B5, B7, B9; C1, C2, C3, C4; D1, D2, D3, D4; E1, E2, E3, E4, E5; F1, F4; G1, G2, G4, G5, G6, G7, G8; H1, H3 |
| Split in two | 3 | A4 (they wrote: grounded; we wrote: new query); E6 (a promised date: grounded; otherwise not stored); H2 (the hours as written: grounded; "open now": not stored) |
| New query | 8 | A5, A10, D5, D7, D11, F2, F3, G3 |
| Not stored | 10 | A9, B6, B8\*, C5, D6\*, D8\*, D9, D10, F5, F6 (\* until decision 1) |
| Opinion only | 7 | G9, I1, I2, I3, I4, I5, I6 |

Every **new query**, and the small "ever" checks behind "no data" (section 3), is written as a read-only function. Each has its own test against a real database (a workspace with rows, and an empty one) before the advisor may use it.

## 6. What every answer respects

- **Definitions are reused, never redefined.**
  - Needs you: `NEEDS_OWNER` / `needsOwnerFor`.
  - Handled: Home's `readHandled`.
  - Revenue: `SPEND_STATUSES`.
  - A price sent: `PRICE_GIVEN`.
  - Quiet: the Inbox's 3 to 30 days.
  - Regular: 3 standing orders.
  - The answer names the definition when it matters ("confirmed orders, not cancelled ones").
- **Money is per currency.** Never added across currencies. Never converted, except at the owner's own stated rate (decision 1), dated.
- **Time is the workspace's.** Periods begin at midnight in `businesses.timezone`.
  - "This week" means since Monday, as Results counts it.
  - Home's "this week" is the last seven days. The answer says which window it used: "since Monday, 6 October".
- **Practice is not business.** Conversations of the practice copy and `owner_testing` ones are left out of every fact (decision 4).
- **The reader's view.** Staff are answered from what staff pages show; Needs-you is the reader's own.
- **Erased customers stay erased.** A customer erased under a deletion request is absent from every answer, as from every page.
- **Names, not message text.** Answers quote names, figures, dates and states. They quote a customer's message only when asked about that customer, and only from the newest messages the conversation page itself shows.

## 7. When it is built: the wall, and privacy

**The wall stays.**
- The advisor's code may reach exactly one new module of read functions (`src/advisor/reads.ts`), one per catalogue query.
- Each runs in its own tenant transaction, opened `read only`, so even a mistaken write is refused by Postgres.
- The import-graph test (`tests/parity/advisor-run.test.ts`) changes from "reaches no database" to "reaches the database only through `advisor/reads.ts`, and no pipeline, sender, queue or setting".
- The integration test that proves a question begins no write transaction stays as it is.

**Privacy.**
- To phrase an answer, the model provider receives the question and the query's result: customer names, amounts and dates.
- The privacy page must say so before this is built, and name the provider (the same one the assistant uses).
- Questions and answers are not stored, and the route logs nothing at `info`.

## 8. Decisions for the owner

1. **New metrics.** Should the advisor compute what the app deliberately does not show?
   - Conversion or win rate (D6).
   - Reply times (B8).
   - Revenue converted at your stated rate (D8).
   - Until you decide, each answers "Nomi doesn't calculate that".
2. **Who may ask.** Any signed-in person, staff included, as proposed: the advisor answers only what that person's pages already show (Results is open to staff today). Or the owner only?
3. **"Handled" means one thing.** Home counts conversations where its reply went out; Results counts drafts approved or edited. The proposal is that the advisor uses Home's, and Results moves to it in a later change.
4. **Practice left out.** The proposal: conversations of the practice copy and `owner_testing` ones count for nothing in the advisor's answers. Home and Results include them today.
5. **The model phrases facts, or templates do.** Proposed: the model phrases, under the check in rule 4. The alternative is that facts are templated only and the model is used just for opinion questions. That is safer, but answers read stiffer.

**To approve:** say "approved" (with any changes to the decisions). Nothing is built until then.
