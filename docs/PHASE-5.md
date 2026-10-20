# Phase 5 — the full map (planning only, a stop-gate)

Written for the owner, 2026-10-21, answering "PHASE 5 — THE FULL MAP". Nothing here is built. It is the plan to
approve or correct before any code.

It rests on three readings:

- **The code as it is,** at main `dc42b3fd`.
- **The research report** `docs/RESEARCH-2026-10-21-ACCOUNTING-AND-SALES.md`.
- **Vendor documentation and legal texts,** checked on 2026-10-21. Each claim names its source. Anything only a
  third party confirmed is marked *unverified*.

## Next: yours

1. **The questions in §8** — the order can't be final without the first four, which change the foundation.
2. **Excel and Google Sheets (§5)** — choose an option.
3. **Then approve, or correct, the build order (§3).** I build nothing until you do.

---

## 1 · The decisions (the owner, 2026-10-21)

1. **There is no "version one".** Nomi launches once, at 100%: every item below is built before launch, with no MVP
   slice and no early release. What there is, is a **build order**, and each piece is fully tested before the next
   one starts. In accounting a mistake in the foundation spreads into every report built on it.
2. **Westlake is a test workspace,** not a real shop. Its data is not evidence of what customers use.
3. **Connectors:** Odoo, Google Sheets and Excel first, then Xero, then QuickBooks — one at a time, all through **one**
   shared connector interface. Sheets and Excel matter because every shop can use them, and Odoo's API isn't
   available on its Free or Standard plans.
4. **Odoo: JSON-2 only, from day one.** XML-RPC and JSON-RPC "are scheduled for removal in Odoo 22 (fall 2028) / Odoo
   Online 21" (Odoo 19 docs). We write our own thin client and do not add `odoo-jsonrpc` as a dependency.
5. **The licence rule:**
   - MIT, Apache, BSD or ISC: the code may be reused.
   - LGPL: depend on it, never copy it.
   - GPL, AGPL, ELv2, fair-code or no licence: ideas only, written from the primary documentation.
6. **EXCLUDED: the concession ladder.** *Reason, so it isn't proposed again: Nomi never negotiates harder than the
   owner set. The owner sets the price.* The quote engine stays as it is: the owner's rules for product, quantity
   and value, capped at the owner's maximum, never re-quoting higher (`src/core/commerce/quote.ts`). A buyer pushing
   back does not move it.
7. **Still zero spend.** Nothing in the plan may require a paid service before the owner says so. Everything that will
   cost money is marked **💰** (full list in §7).

---

## 2 · What the code says first: six facts that move the order

These come from reading main. They are why my build order (§3) starts lower than the one proposed.

| Fact (where) | Why it matters for accounting |
|---|---|
| **Money is a float.** `Money { amount: number, currency }`, with `roundMoney(m, 2)` (`src/core/types/money.ts`) | Books must be exact. A float adds 0.1 + 0.2 to 0.30000000000000004, and a ledger that drifts by a cent never balances. **Accounting needs exact amounts (integer minor units, or Postgres `numeric` end to end) before any entry is written.** |
| **Eight currencies, without MAD or EUR.** `CURRENCIES` = USD, CNY, AED, SAR, BRL, MXN, INR, IDR. Migration 0092 deferred EUR and GBP "with EU1" | Moroccan and French books can't be written at all today. |
| **One currency per workspace** (`businesses.currency`, 0092). Conversion uses only the owner's own stated rates (`owner_rates`, 0031) | Item 8 (multi-currency at the transaction-day rate) changes the model, not just the screens. |
| **No file storage.** Buyer media isn't stored: a provider handle is swapped for the bytes when someone views it. Product photos are kept as `bytea` in Postgres (5 MB cap) | Receipts and invoices (item 7) must be kept for 10 years (§6), so they need real storage. **💰** once it outgrows the database (the Postgres volume is 5,000 MB). |
| **Two roles only: owner and not-owner.** `OWNER_ONLY` is "a LIST, not a matrix" (`src/core/conversation/people.ts`) | Who may see or post the books is a new decision (§8). |
| **Every business table must be classified for erasure.** `customer_erasure_contract()` is re-created in a new migration for each new table, and `customer_erasure_problems()` refuses to run while any table is undecided (tests `every-table`, `erase-buyer`, `data-protection-pages`) | Every accounting table is classified on the day it's made, under a new rule: legal retention (§6). |

Also known: an order holds **one product** (`orders.product_id`). An invoice has lines, so accounting invoices are a new
document, not a renamed order. `nextOrderReference` (0162: one gap-free count per workspace per year) is the right base
for invoice numbering.

---

## 3 · The build order

**Your proposed order:** connector shape → Odoo / Sheets / Excel → core books (3, 4, 5) → everything on top, with the
sales upgrades in parallel where they don't depend on anything.

**I'd change four things:**

1. **A foundation comes before the connector shape.** The connector's mapper translates each system *into Nomi's model*,
   so Nomi's model must exist first: exact money, currencies, the chart, balanced entries, periods. Otherwise the
   first connector defines the model by accident, and every connector after it inherits that system's quirks.
2. **Multi-currency (item 8) is foundation, not "on top".** Every journal line carries a currency and a rate from its
   first day. Adding currency to a single-currency ledger later is exactly the mistake that spreads into every report.
3. **Excel by file comes before Odoo.** It's the one connector every shop can use, it needs no sign-in, and it proves
   the shape with nothing else in the way. Odoo is plan-gated (only Odoo's paid Custom plan has the API), so it's the
   one many shops can't use at all.
4. **"Two-way sync" splits in two.** Reading comes with each connector. Writing back waits until journal entries exist
   in Nomi — you can't write to Odoo what Nomi can't yet represent.

### The order, stage by stage

Each item is built and fully tested (§4) before the next one that depends on it starts.

**Stage A — the foundation (nothing else starts before A1–A5)**
- **A1 · Exact money and every currency:**
  - amounts held exactly (integer minor units or `numeric`), with ISO 4217 currencies including MAD, EUR and GBP;
  - the sales side moves to the same type, so an order and its invoice can't disagree by a rounding.
  - *Depends on nothing; everything depends on it.*
- **A2 · The books' model:**
  - a chart of accounts (with templates);
  - journal entries whose lines balance per currency;
  - tax codes; parties (customers and suppliers);
  - periods and lock dates; documents attached to entries;
  - custom fields (item 9's schema).
  - Corrections are reversing entries: a posted entry is never edited.
  - *Depends on A1.*
- **A3 · Item 8 — multi-currency at the transaction-day rate:** a rate stored on every foreign-currency line, taken
  from a named source on the document's date (the source is a question in §8). *Depends on A1 and A2.*
- **A4 · Document storage:** encrypted, per workspace, with retention dates (§6). *Depends on A2.* 💰 beyond the database
  volume.
- **A5 · The books' tenancy and permissions:**
  - row-level security on every new table;
  - a new owner-only action (`books`);
  - an erasure-contract entry for every table, with a new "keep for the legal period" action;
  - privacy-page lines for each new processor, as D18 requires.
  - *Depends on A2.*
- **A6 · The shell toggle** (salesperson ↔ accountant, same login, same company). It's needed before the first accounting
  page exists. `shell()` in `src/api/web/layout.ts` builds the rail by hand, and the outreach area's per-workspace gate
  (`isOutreachRoute`) is the model for a mode-gated area. *Depends on A5.*

**Stage B — the connector layer**
- **B1 · Item 12 — one plug-in shape:**
  - each system provides a config, a mapper (to and from A2's model), its sign-in (exchange, refresh, revoke), and
    "changed since" reading, all behind one registry;
  - the design is from `erp-mafia/unified-accounting-api` (MIT).
  - *Depends on A2 and A5.*
- **B2 · Excel, by file** (§5, option A): import and export of a fixed Nomi workbook. *Depends on B1.*
- **B3 · Google Sheets** (§5, option B, `drive.file`). *Depends on B1 and B2* (the same template).
- **B4 · Odoo, JSON-2.** Our own thin client, plus:
  - **item 15, the plan check at sign-up:** before anything else, it tells the owner whether their Odoo can connect;
  - **item 14, the key-expiry reminder:** "it is not possible to create keys that last for more than three months"
    (Odoo docs).
  - *Depends on B1.*
- **B5 · Item 13, part 1 — reading changes** from each connected system, on a schedule, idempotent, with a cursor per
  system. *Depends on B2–B4.*

**Stage C — the core books**
- **C1 · Item 3 — journal entries:** made by hand, from Nomi's own orders and invoices, and from what's read in (B5).
  *Depends on A2–A5 and B5.*
- **C2 · Item 5 — payment tracking:** invoices (with lines, numbered like orders) and payments against them, partial or
  full, in any currency. *Depends on C1.*
- **C3 · Item 4 — reconciliation:**
  - bank lines are matched to payments and entries, by rule first, then by suggestion, and **always confirmed by a
    person**;
  - bank lines come from statement files (CSV, OFX, CAMT.053). PDF statements wait for item 7.
  - *Depends on C2.*
- **C4 · Item 13, part 2 — writing back** to Odoo, Sheets and Excel what Nomi posted, with conflicts shown, never
  overwritten silently. *Depends on C1–C3.*

**Stage D — everything on top**
- **D1 · Item 1 — trial balance.** *Depends on C1.*
- **D2 · Item 6 — period close:** a pre-close checklist, then a lock date; a locked period refuses a posting, with the
  reason. *Depends on C1–C3 and D1.*
- **D3 · Item 2 — tax reports,** per country (which ones: §8). *Depends on C1 and A2's tax codes.*
- **D4 · Item 10 — the Moroccan chart and the FEC:**
  - Odoo shops: from Odoo's `l10n_ma` and its FEC export, never rebuilt;
  - shops without Odoo: a decision for you (§8, question 3). *Depends on A2 and D2.*
- **D5 · Item 11 — FEC validated by DGFiP's checker,** run outside Nomi in CI, never copied (CeCILL). *Depends on D4.*
- **D6 · Item 7 — reading receipts, invoices and bills, in any language:** a draft entry the owner confirms, never posted
  alone. *Depends on A4 and C1.* 💰 (a model reads each document).
- **D7 · Item 9 — custom categories and fields:** the screens over A2's schema. *Depends on C1.*
- **D8 · Xero,** then **D9 · QuickBooks**, one at a time through B1. *Depends on C4.* 💰 above the free tiers (§7).

**Stage S — the salesperson, alongside A–D wherever it doesn't depend on them**
- **S1 · Item 18 — canned replies,** in the owner's reply box.
- **S2 · Item 19 — labels.**
- **S3 · Item 21 — round-robin assignment** (nothing like it exists today; `conversations.assigned_to` is the field).
- **S4 · Item 16 — strict mode per language:** in a language with no native reviewer, sending alone uses only approved
  sentences, with fields filled by code. It builds on the taught-answer path (`src/pipeline/turn.ts`, `answerPath =
  'taught_answer'`) and on the disclosure's review flags. *Needs a reviewer per language (§8).*
- **S5 · Item 17 — FAQ learning** from the owner's own replies; a dismissed suggestion never returns. Free if it matches
  words; 💰 if it uses a model's embeddings.
- **S6 · Item 20 — satisfaction surveys.** 💰 on WhatsApp outside the 24-hour window (a paid template).
- **S7 · Item 22 — channels, one at a time:**
  1. web chat — ours, free;
  2. Telegram — free;
  3. LINE — free up to 200 messages a month (Japan), then 💰;
  4. SMS, WeChat and TikTok — 💰 or limited availability (§7).

  `src/channels/contract.ts` already lists telegram, line and web_chat as types.
- **S8 · Item 23 — simulated-buyer testing** — **parked with the money** (it spends model balance).

### Dependencies at a glance

```
A1 money → A2 model → A3 multi-currency
                   ├→ A4 documents
                   └→ A5 tenancy/permissions → A6 shell toggle
A2+A5 → B1 plug-in shape → B2 Excel file → B3 Sheets
                         └→ B4 Odoo (+14, +15)
B2–B4 → B5 read changes → C1 journal entries → C2 payments → C3 reconciliation → C4 write back
C1 → D1 trial balance → D2 period close
C1 → D3 tax reports;  D2 → D4 PCM/FEC → D5 FEC check
A4+C1 → D6 reading documents;  C1 → D7 custom fields;  C4 → D8 Xero → D9 QuickBooks
S1–S7 run alongside; S4 needs reviewers; S6/S7 parts need money; S8 parked.
```

---

## 4 · What "done and tested" means, item by item

**For every item, before the next one that depends on it starts:**
- the four checks (CLAUDE.md §3) pass, with integration on its own Postgres;
- every new table is in the erasure contract, and the data-protection tests pass;
- every owner-facing line exists in en / zh / ar / es / fr, Arabic follows the no-gender rule, and the zh / ar lines
  are listed for native review;
- a negative control: the item's key rule, switched off, fails its own tests;
- merged through `tools/gated-merge.sh`.

**Live verification is deploy-day work, as in hardening.** Anything that needs a paid service can be built and tested
against the vendor's sandbox or a recorded fake, but it is only proven live when money is spent. Each such item says
so.

**Stage A — the foundation**

| Item | Done and tested when |
|---|---|
| A1 exact money | No float reaches a stored amount: a property test of a million random add/split/round sequences ends at the exact cent. Every currency's minor units come from ISO 4217 (JPY 0, MAD 2, KWD 3). The sales side's quotes and orders show the same figures as before (golden scenarios unchanged). |
| A2 the books' model | The database itself refuses a journal entry that doesn't balance per currency, a line on a locked period, and an edit to a posted entry (constraints and triggers, proven by tests that try each). A correction is a reversing entry that links to the original. |
| A3 multi-currency | Each foreign line stores its rate, the source and the date. A report in the base currency recomputes from the stored rates and matches to the cent. A missing rate refuses the posting and says why, never using a guess or 1.0. |
| A4 documents | A stored document is encrypted, readable only by its own workspace (an RLS test from a second workspace returns nothing), and carries the retention date of its country. |
| A5 tenancy | Staff get "the owner decides" on every books action, and the permission snapshot test stays unchanged for every gated route. Each new processor has its privacy line in five languages before the boot allows it (D18). |
| A6 shell toggle | One login switches between salesperson and accountant. Each mode lights only its own pages. An accounting address is refused for a workspace whose accounting is off, as outreach is today. |

**Stage B — the connector layer**

| Item | Done and tested when |
|---|---|
| 12 plug-in shape | Two connectors (B2 and a fake one in the tests) satisfy the same interface. A conformance suite every connector must pass covers config, mapping both ways round-trip, a refused sign-in, and "changed since". |
| B2 Excel file | The fixed workbook imports and exports. A file that breaks the template is refused, naming the sheet, row and column, and nothing half-imports. Exporting then re-importing changes nothing. |
| B3 Sheets | The same template through the API with `drive.file` (a non-sensitive scope, so no Google verification, per Google's scope table). A revoked grant reads as "connect again", never as empty books. Tested against a recorded fake; live is deploy-day. |
| B4 Odoo | JSON-2 against a recorded Odoo 19 fake, and against Odoo's own demo database if one is reachable for free. **Item 15:** a Free or Standard plan, a wrong key and a wrong database each give their own sentence before anything is saved. **Item 14:** a key 80 days old raises the owner's reminder, and an expired key stops the sync with that reason. |
| 13 reading | The same change read twice is recorded once. A cursor survives a restart. A system that stops answering is said on the page, never silently stale. |

**Stage C — the core books**

| Item | Done and tested when |
|---|---|
| 3 journal entries | Entries made from orders, invoices and payments, and by hand, balance. Every one has a source link. A posted entry can only be reversed. |
| 5 payment tracking | An invoice is open, partly paid or paid by its payments, in any currency (gains and losses on exchange posted). Invoice numbers have no gaps, per workspace per year. |
| 4 reconciliation | Statement files (CSV, OFX, CAMT.053) import with duplicate lines refused. A match is suggested, never applied without a person, and an un-match restores exactly. |
| 13 writing back | What Nomi posted appears in Odoo, Sheets and Excel. A conflict (both sides changed) is shown and waits; nothing is overwritten. |

**Stage D — everything on top**

| Item | Done and tested when |
|---|---|
| 1 trial balance | Debits equal credits for any period. It matches a hand-computed fixture to the cent, and matches Odoo's own trial balance for the same Odoo fixture. |
| 6 period close | The checklist (unreconciled lines, draft entries, missing rates) must be clear before a lock. A locked period refuses postings, with the reason. Reopening is the owner's, and recorded. |
| 2 tax reports | Each country's report (§8) matches a worked example from that country's official form, line by line. |
| 10 PCM / FEC | Odoo shops: Odoo's chart and Odoo's FEC, fetched, never rebuilt. Without Odoo: per your answer in §8. |
| 11 FEC check | DGFiP's checker passes on every FEC fixture in CI, and fails on a deliberately broken one. |
| 7 reading documents | Receipts in en, fr, ar, zh and es (photo and PDF) become draft entries. Amounts, dates and currency are read, but **nothing posts without the owner**. A wrong read is fixed in the draft. 💰 live. |
| 9 custom fields | A shop's own categories and fields survive export, import and every connector's round trip. |
| Xero / QuickBooks | The conformance suite and C4's round trip pass against each vendor's sandbox (free for development). Live within the free tiers is deploy-day. |

**Stage S — the salesperson**

| Item | Done and tested when |
|---|---|
| 18 canned replies | Insert, edit and send go through the same guards as any owner reply. Five languages. |
| 19 labels | They filter and search on Buyers, and are erased with the buyer. |
| 21 round-robin | Assignment rotates fairly among available people (a property test). Absent people are skipped. The owner's override wins. |
| 16 strict mode | In a strict language, only approved sentences are ever sent alone; any other reply waits as a draft. A test sends 500 varied turns and finds no free text sent. Each sentence set is signed off by a named reviewer. |
| 17 FAQ learning | Suggestions come only from replies a person wrote. A dismissed one never comes back (a test re-asks it). Nothing becomes an answer without the owner. |
| 20 surveys | Sent only inside the free window, or as an approved template when the owner allows the cost. The answers are stored and erasable. |
| 22 channels | Each channel passes the adapter contract tests and the full send-path guards, its pre-pilot scenarios pass on a simulator, and it has a D18 line. Live is deploy-day. |

---

## 5 · Excel and Google Sheets as a books source: the options (you decide)

**A spreadsheet can't enforce double entry, locks or immutability.** So for a Sheets or Excel shop, **the books of
record have to be Nomi's own** (A2), and the spreadsheet is the way in and out. All the options below share a **fixed
Nomi workbook**: named tabs (Accounts, Journal, Parties, Invoices, Payments) with fixed columns. A free-form sheet would
need column mapping by hand, which breaks silently.

| Option | How it works | Cost | Fits |
|---|---|---|---|
| **A. File upload and download** | The owner downloads the Nomi workbook (.xlsx or .csv), fills it in, and uploads it. Nomi exports the books back to the same shape. | Free. No sign-in, no Google or Microsoft account. | Every shop. No live sync: whenever the owner re-uploads. |
| **B. Google Sheets through the API** | Nomi creates the workbook in the owner's Drive and reads and writes only that file, with the `drive.file` scope (Google: "non-sensitive", verification "not mandatory"). Changes are read on a schedule. | Free within quota (300 requests a minute per project). Google says exceeding quota "is planned to incur charges… later in 2026". The wider `spreadsheets` scope is "sensitive" (review needed); `drive` is "restricted" (an annual security assessment, 💰). | Shops on Google. |
| **C. Excel through Microsoft Graph** | The same, with workbooks in OneDrive for Business or SharePoint. | Free within standard thresholds (Microsoft docs). | **Business Microsoft 365 only:** "Support for workbooks stored in OneDrive Consumer platform is still not available," and only .xlsx works. A home user's Excel can't connect. |
| **D. Export only** | Nomi keeps the books and only writes a read-only copy into a sheet. | Free | Shops that want their accountant to see a spreadsheet. |

**My recommendation:** A first, for every shop and with no account; then B with `drive.file`. C waits until a real
shop needs it — it reaches only business Microsoft 365, and A already covers Excel users.

---

## 6 · The privacy load: heavier than buyer chats

Financial data adds categories, laws and obligations the current pages don't cover.

**1. A legal duty to keep, which overrides erasure:**
- **France:** "documents comptables" and "pièces justificatives… doivent être conservés pendant dix ans" (Code de
  commerce L123-22, via BOFiP).
- **Morocco:** the CGI's article 211 requires keeping the books and supporting documents "pendant dix (10) ans". *That
  loi 9-88 says the same in its article 22 is unverified.*
- **GDPR article 17(3)(b):** erasure doesn't apply where processing is needed "for compliance with a legal obligation".
- **What this means:**
  - the erasure contract needs a new action, *"keep until the legal date, then erase"*, with that date stored per row;
  - `erase-buyer` and closing a workspace must refuse to erase books inside their legal period, and say so;
  - when a workspace closes, the owner must be able to take their books out first (FEC, CSV, the workbook).

**2. New personal data:**
- suppliers;
- the people on receipts (employees' expenses, for example);
- bank lines, which name the people who paid;
- possibly salaries. **Payroll is not on the list and should stay off it** — it's a different law.

**3. New processors, each needing a privacy line in five languages before it can be switched on (D18):**
- Google (Sheets);
- Microsoft (Graph);
- Odoo, Xero and Intuit (the owner's own systems, which Nomi acts in);
- the model that reads documents (item 7);
- the exchange-rate source;
- new channels (Telegram, LINE…).

**4. Moroccan shops' data in the USA:**
- loi 09-08, article 43, allows a transfer abroad only to a country with "un niveau de protection suffisant". The
  CNDP's list (délibération 236-2015) has the EU and EEA, the UK, Switzerland and Canada — **not the USA**.
- Article 44 then needs the person's express consent, a listed necessity such as "l'exécution d'un contrat", or the
  CNDP's "autorisation expresse et motivée".
- Every transfer must also be declared (article 15(e)).
- **This binds the Moroccan shop as data controller,** and it is a launch question for Moroccan customers (§8).

**5. The data-deletion page must say:**
- which accounting records are kept, for how long, and why (the law);
- that erasure of a buyer leaves their invoices, payments and journal lines, without contact details where the law
  allows;
- that copies in the owner's Odoo, Xero, QuickBooks, Sheets or Excel are the owner's to delete, not Nomi's;
- that receipts sent for reading went to the model provider.

**6. Backups:** today they are kept 180 days. That is fine for recovery, but **backups are not the legal archive.** The
10-year duty is met by the books themselves, plus the export at closure. The pages must not suggest otherwise.

**7. Access:** the books are owner-only until you decide otherwise (§8). Every view and export of financial data goes on
the audit trail.

**8. Secrets:** connector tokens and Odoo keys use the same encryption as mailbox tokens (AES-256-GCM, `key_version`,
`tools/rekey.mjs`). An Odoo key is stored with its expiry, so it can be reminded.

---

## 7 · What costs money (💰), and what is free

| Item | Free | Costs money |
|---|---|---|
| Google Sheets (`drive.file`) | yes, within quota | above quota, "later in 2026" (Google). Wider scopes need review; `drive` needs a paid assessment |
| Excel (Graph) | yes, within thresholds | — (the shop needs business Microsoft 365) |
| Excel by file (option A) | yes | — |
| Odoo | Nomi pays nothing | **the shop** needs Odoo's Custom plan (about US$61 a user a month, odoo.com/pricing) |
| Xero | Starter: 5 connections | from AUD 35 a month for 50 connections (since 2 March 2026, developer.xero.com/pricing) |
| QuickBooks | Builder tier: writes unlimited, 500,000 reads a month | above that, blocked unless on a paid tier (paid tier prices unverified) |
| Exchange rates | ECB's (no MAD), Bank Al-Maghrib's site (no official API) | a commercial feed, if neither fits |
| Reading documents (item 7) | — | **💰 a model call per document** |
| FAQ learning (item 17) | word matching | 💰 if embeddings |
| Document storage (A4) | within the Postgres volume (5,000 MB) | 💰 storage beyond it |
| Web chat, Telegram | yes | Telegram's paid broadcasts only at very large scale |
| LINE | 200 messages a month (Japan; "pricing plans vary by country") | from JPY 5,000 a month |
| SMS | — | 💰 per message (Twilio: France $0.0798, Morocco $0.2244) |
| WeChat | — | 💰 verification (US$99 for an overseas business, *unverified*); a verified Service account needed |
| TikTok | — | an API exists, needs TikTok's approval; *unverified* reports say it's not in the EEA, Switzerland or the UK |
| Satisfaction surveys on WhatsApp | inside the 24-hour window | 💰 a template outside it; utility replies inside the window are paid from 1 October 2026 (Meta) |
| Simulated-buyer testing (item 23) | — | 💰 model balance — parked |
| Hosting (Railway) | — | 💰 already unpaid; nothing launches without it |

---

## 8 · Open questions only you can answer

1. **Whose books are the record?** For a shop on Odoo, Xero or QuickBooks: are the books *there*, with Nomi reading and
   writing them? Or does Nomi always keep its own copy, with the systems synced? For Sheets and Excel it has to be
   Nomi's own (§5). *My recommendation: Nomi always keeps its own, which makes one model and one set of reports.*
2. **Which countries' tax reports (item 2)?** Morocco's VAT return? France's TVA (CA3/CA12)? The UAE? Others? And does
   Nomi only **prepare** them, never file?
3. **The Moroccan chart and the FEC for shops without Odoo.** Item 10 says "from Odoo's `l10n_ma`, never rebuilt", which
   only works for Odoo shops (and that code is LGPL, so it can't be copied). For the rest:
   - the chart would come from the CGNC itself, the legal source;
   - the FEC would be built from the legal format (LPF article A47 A-1).

   Do you want that? Note also that **the FEC is a French obligation.** Moroccan shops need Moroccan reports, not an FEC.
4. **Who may see and post the books:** the owner only, an outside accountant (a new role), or staff?
5. **The exchange-rate source for item 8:**
   - the ECB has no MAD;
   - Bank Al-Maghrib publishes daily rates but no official API;
   - the owner's own stated rates (as today);
   - or a paid feed later.
6. **Moroccan data in the USA (§6.4).** Do Moroccan shops declare the transfer to the CNDP themselves? Does Nomi supply
   the contract clauses? Is EU hosting a requirement before launch? This needs a lawyer's reading; it is not mine to
   decide.
7. **Strict mode's reviewers (item 16):** who approves the sentence sets in zh and ar (and es/fr if they join)?
8. **Channels at launch (item 22):** SMS, WeChat and TikTok all cost money or need approval. Which are in "100%"?
9. **"100% at launch" versus zero spend.** Several items can be built and tested but only proven live with money (§4).
   Is "built, tested against sandboxes, live on deploy day" the bar, as in hardening?
10. **Bank statements:** files only (CSV, OFX, CAMT), or bank connections too (aggregators are 💰)?

---

## 9 · Not in Phase 5

- **The concession ladder** — excluded (decision 6).
- **Payroll** — a different law, not on the list (§6.2).
- **Filing tax returns on the owner's behalf** — prepare only, unless you decide otherwise (§8, question 2).
