# Phase 5 — the full map

> **STATUS, 2026-10-23: BUILT. WAITING ON PEOPLE AND MONEY, NOT IN DEVELOPMENT.**
> Blocks A, B, C, D, S and E are built, tested and merged (#375–#382; schema 208). Block R (the research acted on,
> 0209–0210) is in review; its held items wait on the owner (Stage R below). What remains is not code:
> 1. **an accountant's answer** on what a « période » is in Avis 24 — D10 waits on it (the question is in D10, in French);
> 2. **native signatures on four sentence sets**, read in one pass: the survey question, the survey's thank-you, the
>    Telegram /start greeting (src/core/conversation/survey.ts, greeting.ts) and strict mode's starters (strict.ts);
> 3. **a deploy** — production is on #353 (zero-spend), and Telegram's bot, its settings and its webhook come with it.
> Nothing new starts until the accountant's answer or the signatures arrive (the owner, 2026-10-22).

The history below is the plan as it was approved, then each block as it was built.

Written for the owner. First version 2026-10-21 (#373). It recorded **the owner's answers of 2026-10-21**: the build
order approved with the four changes, the ten questions answered, and the Moroccan FEC checked against Morocco's own
sources. Since then it has been built, block by block; each block's record is below.

It rests on four readings:

- **the code as it is,** at main `0eb10ac9`;
- **the research report** `docs/RESEARCH-2026-10-21-ACCOUNTING-AND-SALES.md`;
- **vendor documentation,** checked 2026-10-21;
- **legal texts,** read in their primary sources where they could be reached. Each claim names its source. Anything only
  a third party confirmed is marked *secondary*, and anything not confirmed is marked *unverified*.

## Next: yours

1. **Read §2's new first item and §3's re-cut D4:** a pre-existing money defect, and the Moroccan FEC.
2. **Approve this version, or correct it.** Building starts with A1 on your word, and not before.

---

## 1 · The decisions (the owner, 2026-10-21)

1. **There is no "version one".** Nomi launches once, at 100%: everything below is built before launch, with no MVP slice
   and no early release. There is a **build order**, and each piece is fully tested before the next one that depends on
   it starts. In accounting a mistake in the foundation spreads into every report built on it.
2. **Westlake is a test workspace,** not a real shop. Its data is not evidence of what customers use.
3. **Connectors:**
   - **Excel by file first,** then Google Sheets, then Odoo, then Xero, then QuickBooks.
   - One at a time, all through **one** shared connector interface.
   - Sheets and Excel matter because every shop can use them. Odoo's API isn't available on its Free or Standard plans.
4. **Odoo: JSON-2 only, from day one.** XML-RPC and JSON-RPC "are scheduled for removal in Odoo 22 (fall 2028) / Odoo
   Online 21" (Odoo 19 docs). We write our own thin client; no `odoo-jsonrpc` dependency.
5. **The licence rule:**
   - MIT, Apache, BSD or ISC: the code may be reused.
   - LGPL: depend on it, never copy it.
   - GPL, AGPL, ELv2, fair-code or no licence: ideas only, written from the primary documentation.
6. **EXCLUDED: the concession ladder.** *Reason, so it isn't proposed again: Nomi never negotiates harder than the owner
   set. The owner sets the price.*
7. **Still zero spend.** Nothing may require a paid service before the owner says so. Every cost is marked **💰** (§7).
8. **"100%" must be reachable at zero spend,** or it isn't a launch bar, it's a wish. So:
   - **channels:** web chat and Telegram only;
   - **bank data:** statement files only;
   - **exchange rates:** the owner's own.
9. **The bar for anything that needs a paid service:** built, tested against the vendor's sandbox, proven live on deploy
   day. It's the same split as hardening, which worked.
10. **The books of record are always Nomi's own** (§1a).
11. **Tax reports: prepared, never filed.** Country rules only where verified against primary legal sources. Everyone
    else gets the accountant pack (§3, D3).
12. **Three levels of access to the books:**
    - the **owner** sees, posts and exports;
    - an **accountant** sees and exports, and posts nothing;
    - **staff** see nothing.
    - **An accountant sees nothing of the sales side: no buyer, no conversation, no message.** A shop's external
      accountant has no business reading its customers' messages. That is a privacy boundary, not a convenience
      (the owner, 2026-10-21), and it is held twice: by the app's route guard (A5) and by the database, which shows an
      accountant's request no row of a sales table (B0).
13. **Exchange rates:** the owner's own. The rate used is **stored on the transaction and never recomputed.** A report
    that re-rates history is wrong by construction.
14. **Data residency is a parameter,** not a hard-coded assumption. This is the cheap insurance against a later legal
    need for an EU region.
15. **Strict mode depends on a person:** a native reviewer per language. That's a dependency on someone, not a
    technical task, so nobody plans around it.
16. **Bank connections are out** (§9).
17. **A party is not a buyer — and must never be linked to one** (the owner, 2026-10-22). A party (`parties`) is
    the books' own record of a customer or supplier. A buyer is a contact in a conversation. They are kept apart on
    purpose. Why: a buyer can ask for their data to be erased (CC-02, `tools/erase-buyer.mjs`), while an issued
    invoice is a statutory document the shop must keep intact for ten years. A link from the books to the buyer
    record would let an erasure blank or break an issued invoice. **This is not an unfinished feature. Do not "fix"
    it by adding the link.** Nomi's orders reach the books through an invoice for a party the owner chooses (D0), and
    the buyer's name is never written into the books.
18. **An issued invoice carries its customer as they were at issue** (the owner, 2026-10-22; 0187). At issue, the
    database copies the party's code, name, address, country, ICE and tax number onto the invoice. The copy is frozen
    with the rest of the issued invoice and never read from the party again. Renaming the party later changes no
    issued invoice.

### 1a · What "Nomi's books are the record" means (decision 10)

**This decision turns Phase 5 from "an integration" into "an accounting system of record".**

- **The reason:** if an external system were the record, every connector bug would corrupt a real company's statutory
  accounts. With Nomi's ledger as the record and copies pushed outward, a connector bug is recoverable.
- **The price, plainly:** a system of record carries a **retention duty** (10 years, §6), a **correctness bar** (exact to
  the cent, immutable once posted, auditable), and the **liability** for books a business is legally required to keep.
  That is a real step up in what Nomi promises, and it should be visible, not implied.
- **What follows from it:**
  - the Moroccan software criteria (§3, D4) become requirements on Nomi itself;
  - a shop must always be able to take its books out (§6);
  - the foundation (Stage A) carries the most weight of anything in this phase.

---

## 2 · What the code says first

### 2.1 · A PRE-EXISTING DEFECT, found while planning Phase 5: money is computed in floating point

This is not new accounting work. **The live product's money path is wrong today,** and accounting only makes it
undeniable.

- **Where it is:**
  - Amounts are stored exactly in Postgres (`numeric`, 2 or 4 decimals).
  - But the code reads them into `Money { amount: number }` and multiplies, discounts and rounds in floating point
    (`src/core/types/money.ts`: `scaleMoney`, `roundMoney`).
  - The quote engine prices every discounted unit that way: `unitPrice = roundMoney(scaleMoney(listUnit, 1 - discountPct / 100))` in `src/core/commerce/quote.ts`.
- **Measured on 2026-10-21, with the code's own functions, from the build of main:**
  - Over 700,000 pairs of unit price ($0.01 to $1,000.00) and common discount (2.5–15%), **1.34% come out a cent wrong
    under BOTH rounding rules** (half-up, and half to even).
  - For example, **$5.30 less 5% is exactly $5.035, and Nomi quotes $5.03**, where either rule gives $5.04.
  - Likewise $5.10 less 15% (exactly 4.335) gives 4.33 instead of 4.34, and $5.48 less 12.5% (exactly 4.795) gives 4.79
    instead of 4.80.
  - On an order, that cent is multiplied by the quantity.
- **Which way the error goes:** always down. All 9,358 wrong cents in the measurement are below the exact figure, none
  above. **Nomi has been under-charging, on about one discounted quote in 75.**
- **Stored amounts are already exact:** Postgres `numeric`, read by the driver as exact text and then turned into a float
  by `Number(…)`. The defect is in the arithmetic between storage and the quote, not in what is stored.
  - So A1's migration rewrites no stored value: quotes and orders already sent are what the buyer saw, and they stay.
  - The migration notes record that from A1 on, the same inputs can quote a cent higher than before (the corrected
    figure). Production has had zero turns since 2026-09-20, so nothing real is affected this time. In any other week
    this would be a customer-facing change.
- **Consequence:** A1 covers **the existing money path too:** quotes, orders, proposals, proformas, invoices, payments
  and the advisor's sums. It also includes a **migration of stored amounts** to the exact representation, and its
  million-step property test runs on quotes and orders, not only on ledger entries.

### 2.2 · The other five facts

| Fact (where) | Why it matters |
|---|---|
| **Eight currencies, without MAD or EUR.** `CURRENCIES` = USD, CNY, AED, SAR, BRL, MXN, INR, IDR. Migration 0092 deferred EUR and GBP | Moroccan and French books can't be written today. |
| **One currency per workspace** (`businesses.currency`, 0092). Rates come only from the owner (`owner_rates`, 0031) | Multi-currency (item 8) changes the model. The owner's rates are already the source (decision 13). |
| **No file storage.** Buyer media isn't stored: a provider handle is swapped for the bytes when someone views it. Product photos are `bytea` in Postgres (5 MB cap) | Receipts and invoices are kept 10 years, so they need real, residency-aware storage. 💰 beyond the 5,000 MB volume. |
| **Two roles only:** owner and not-owner (`OWNER_ONLY` is "a LIST, not a matrix", `src/core/conversation/people.ts`) | The accountant role (decision 12) is real work, scheduled in A5. |
| **Every business table must be classified for erasure.** `customer_erasure_contract()` is re-created per new table; `customer_erasure_problems()` refuses to run while any is undecided | Every books table is classified the day it's made, under the new legal-retention action (§6). |

**The best piece of design in this codebase, and never to be softened (the owner, 2026-10-22).** The buyer erasure
follows only the links written into it (`customer_erasure_edges`), and it REFUSES to run, by name, while any table or
link is unclassified (`customer_erasure_problems`). A new table therefore cannot silently escape erasure: someone has
to decide what it means for a customer before anything is erased again. It has caught a missed table three or four
times — most recently S2's `buyer_labels`, which only 0197 registered. A refusal from it is the system working; the
fix is always to classify the table, never to loosen the check.

**Also:**
- An order holds one product, so an invoice with lines is a new document.
- `nextOrderReference` (0162: gap-free per workspace per year) is the base for invoice numbering and for the FEC's
  "numérotation sans rupture".

---

## 3 · The build order (approved, with the owner's four changes)

**The changes, as approved:**
- a foundation before the connector shape (the model before the mapper);
- multi-currency as foundation;
- Excel by file before Odoo;
- reading split from writing back.

Each item is built and fully tested (§4) before the next one that depends on it starts.

### Stage A — the foundation

- **A1 · Exact money, in the EXISTING product and for the books (the §2.1 defect):**
  - an exact representation (integer minor units, or exact decimals end to end; chosen in A1's design);
  - ISO 4217 currencies including MAD, EUR and GBP;
  - every money path moved to it;
  - stored amounts migrated.
  - *Depends on nothing; everything depends on it.*
- **A2 · The books' model:**
  - a chart of accounts, with templates (the CGNC chart for every shop, D4);
  - journal entries whose lines balance per currency;
  - tax codes; parties;
  - periods and lock dates;
  - documents attached to entries;
  - custom fields (item 9's schema).
  - **The Moroccan software criteria (CNC Avis n° 24, annex §2) are built in here** (D4 lists them), because they're
    properties of the ledger, not of an export.
  - *Depends on A1.*
- **A3 · Multi-currency (item 8):**
  - every foreign-currency line stores the rate and the date, taken from the owner's rates (decision 13);
  - **never recomputed;** a missing rate refuses the posting.
  - *Depends on A1 and A2.*
- **A4 · Document storage, residency-aware:** *(built 2026-10-21, 0174: sealed with AES-256-GCM under the installation's document key —
  derived from CREDENTIAL_KEY, which lives in the environment and never in the database, so a dump or a backup alone
  opens nothing — with a fresh IV per document, bound to workspace and id; B0 makes a CREDENTIAL_KEY rotation re-seal
  them; DOCUMENT_STORES maps residency → `database` or `directory:<path>`, and a residency
  with no store refuses; each document's `keep_until` set by the database; held at closure with the books, its
  directory files removed by tools/books-retention.mjs after the legal date. Open: the closing copy includes the
  documents (with A6's pages, which list them) — until then a workspace holding papers refuses to close, a LAUNCH
  BLOCKER for the books (docs/LAUNCH-CHECKLIST.md, enforced by tools/books-area.mjs); a sweep of sealed files a rolled-back upload left with no row.)*
   encrypted, per workspace, with the retention date of its country. Where the
  data lives — the database, the documents and the backups — is **a parameter** (decision 14), not an assumption.
  *Depends on A2.* 💰 beyond the database volume.
- **A5 · The books' tenancy and the three roles (decision 12):** *(built 2026-10-21, 0175: `people.kind`
  'accountant', made by the owner on the team page and never changed; the guard confines an accountant to the books'
  routes, every registered route walked in tests/integration/books-roles.test.ts; an accountant's posting refused by
  the database too; closure waits for the OWNER's copy. The roles are the books' only: staff keep their sales work and
  get nothing of the books; an accountant reaches nothing of the sales side. D18: the six new processors stop the boot
  until named. The per-buyer legal-retention action comes with C2's party link, as A2.4 says.)*
  - row-level security on every new table;
  - owner, accountant (see and export only) and staff (nothing), as real roles with a permission test per route;
  - erasure-contract entries with the legal-retention action;
  - D18 privacy lines for each new processor.
  - *Depends on A2.*
- **A6 · The salesperson ↔ accountant toggle:** *(built 2026-10-21, 0176: `businesses.books_area`, OFF by default,
  switched by tools/books-area.mjs; off, every /app/books address is not found and nobody is offered the switch or
  an accountant. A page under /app/books is the books' mode and its rail shows only the books; the switch at the
  rail's foot is the owner's alone; an accountant has the books and a way out; staff the sales side. Its books
  side is one page today, the home and the copy — C1 onward fill it.)* Same login, same company. **Early because it's the demonstrable piece,
  not because anything depends on it.** It's the cheapest visible proof that the two-mode idea works, which the thesis
  and any investor conversation need. It builds on `shell()` in `src/api/web/layout.ts` and on the outreach area's
  per-workspace gate. *Needs A5's roles.*

### Stage B — the connector layer

- **B1 · Item 12 — one plug-in shape:** *(built 2026-10-21: `src/core/books/connector.ts` (config, connect / refresh /
  revoke with a closed list of refusal reasons, the mapping both ways, "changed since") over one interchange shape,
  `src/core/books/interchange.ts` (keyed by codes and the source's own entry keys, never Nomi's ids; exact decimals);
  one registry, `src/books/connectors/registry.ts`; the suite `tests/books-connectors/conformance.ts`, passed by the
  workbook and by a test fake that keeps its own history.)*
  - each system provides a config, a mapper to and from A2, its sign-in (exchange, refresh, revoke), and "changed since";
  - all behind one registry;
  - a conformance suite every connector must pass.
  - *Depends on A2 and A5.*
- **B2 · Excel by file (option A):** *(built 2026-10-21, 0178: the versioned Nomi workbook (a "Nomi" sheet, then
  Accounts, Journals, Parties, Tax codes, Journal — one row per line), written and read by `src/net/xlsx.ts` with no
  library; opened and saved by Microsoft Excel 16 in the test (`tests/books-connectors/fixtures/excel-saved.xlsx`,
  its author and path removed). Found doing so: Excel writes 33.34 back as 33.340000000000003, so a number cell is
  read at Excel's 15 significant digits, as text; and an amount with more decimals than its currency is refused,
  never rounded by the column. The read-in (`src/db/booksInterchange.ts`) is one change or none; entries arrive as
  DRAFTS; a posted entry or a chart record that differs from Nomi stops it, named by sheet, row and column; what each
  source last said is kept in `connector_records`, so the same workbook twice changes nothing. Invoices and Payments
  tabs come with C2. The workbook is not yet a receipt for closure — the books' CSV is.)*
  - the fixed Nomi workbook, imported and exported;
  - **it validates the interface on the easy case first:** no external dependency, so B1 is proven against something we
    fully control before it meets Odoo's sign-in, plans and expiring keys.
  - *Depends on B1.*
- **B3 · Google Sheets (option B, `drive.file`).** *Depends on B2* (the same workbook). *(built 2026-10-21, 0179:
  `src/books/connectors/sheets.ts` — OAuth with PKCE asking `drive.file` alone; on connecting, a NEW spreadsheet with
  the books in it; read in through the workbook's own reader and the same read-in; values read UNFORMATTED with
  JSON's own digits, never a float. A revoked grant is `connect_again` and nothing is read; a deleted spreadsheet is
  `source_missing`; Google down is "try later". The grant sealed in `connector_credentials` (rekey covers it),
  `books_connections` keeps the state. Writing an existing spreadsheet again is C4's (conflicts shown; built). Against a
  recorded fake of Google's documented answers; live on deploy day with SHEETS_CLIENT_ID / _SECRET, which D18 holds
  until the privacy page names Google Sheets.)*
- **B4 · Odoo, JSON-2, our own client:** *(built 2026-10-21: `src/books/connectors/odoo.ts`, a POST of a JSON object to
  `/json/2/<model>/<method>` with "bearer" and the key and `X-Odoo-Database` (Odoo 19 docs), sent only to a public https
  address (`publicPost`: our own DNS lookup refuses private, loopback and link-local answers at connect time). Item 15:
  a wrong key (401 "Invalid apikey", documented), a wrong name, a Free or Standard plan, an address that is not public
  https — each its own sentence, nothing saved. **C0 (2026-10-21):** the wrong name is now a FACT, read from Odoo
  19's source (odoo/http.py: a database the dbfilter rejects or the server lacks leaves the request with none; the
  no-database routes are only `auth='none'`, and JSON-2's is `bearer`; so the answer is a 404 with Odoo's HTML page
  "No database is selected…", not JSON — B4 had read a JSON 404 as the sign and would have called a wrong name
  "unreadable"). The Free or Standard plan's answer is in Odoo Online's closed code: still read as 403 until the owner's
  own trial answers it — `tools/odoo-probe.mjs`, run in the owner's shell, prints the statuses and no key. Item 14: the owner gives the key's end date; from 80 days of
  a key's life, or 10 days before its end, the page asks for a new one; on its end the read stops (`stopped`,
  `key_expired`) and Odoo is not called. Read: the chart, journals, customers and suppliers, percent taxes with their
  tax account, entries by Odoo's own write date; amounts from Odoo's own digits. What Odoo cannot say is not invented:
  no parent account; a foreign line in its own currency; and, since C0 (the owner: "a guess wearing a fact's
  clothes"), a TAX has no invented start date — it is read with none, counts from the day it was first read, an
  earlier entry naming it is refused (`tax_before_known`), and the owner confirms the real day on the problems page
  (`tax_start_dates`, 0181); its CODE, which Odoo does not have, is Nomi's name `ODOO-<id>` — Odoo's own id in it, so
  an accountant sees whose it is. Against a recorded fake of the documented answers.)*
  - **item 15, the plan check at sign-up;**
  - **item 14, the key-expiry reminder** (keys last at most three months).
  - *Depends on B1.*
- **B5 · Item 13, part 1 — reading changes:** idempotent, with a cursor per system. *Depends on B2–B4.* *(built
  2026-10-21, 0180: one read, `src/books/readIn.ts`, for the owner's button and the morning's job (`books.read`, 05:20
  UTC, every connected system of a workspace whose books are shown — `books_connections_due()`). The same change is
  recorded once (`connector_records`); the cursor is the database's (`books_connections.cursor`), read again by a
  fresh process; a read refused for its problems moves no cursor. A connected system no read has reached for two
  days is said on the books' page, with the day it last answered. What the morning reads in is drafts, as Nomi.)*

### Stage C — the core books

- **C1 · Item 3 — journal entries:**
  - by hand, from Nomi's orders and invoices, and from what's read in;
  - **Where the exchange difference goes (the owner's question, 2026-10-21; answered before C1).** Since A3 (0173) an
    entry with a foreign line posts only if it balances in each foreign currency on its own AND in the books' currency
    after conversion. A remainder is refused (NB009, "add the exchange difference as a line"), never absorbed, rounded
    away or left as an imbalance. It posts only as its own line in the books' currency, visible in the books and the
    export (`tests/integration/books-currencies.test.ts`). What A3 does not say is WHICH account. C1 adds it:
    - the workspace's exchange-loss and exchange-gain accounts in `books_settings` (the CGNC's 6331 Pertes de change
      and 7331 Gains de change propres à l'exercice);
    - every entry Nomi drafts puts its difference there: a loss as a debit on the loss account, a gain as a credit on
      the gain account;
    - the line that carries the difference is marked as such on `journal_lines`, and the database refuses a marked
      line on any account but those two;
    - C2's realised differences (an invoice at one rate, paid at another) land on the same two accounts, as their own
      line of the payment's entry.
  - numbered in sequence per journal, with no gaps (the Avis 24 criterion).
  - **Strictly gap-free, as a legal requirement (Avis 24), not a preference:**
    - The journal and invoice sequences are their own counters, never the order sequence (`nextOrderReference`), and
      they inherit none of its paths.
    - A number is taken only at posting, inside the posting transaction. A draft has no number.
    - A rolled-back posting never existed, so it leaves no gap.
    - Once posted, a number is permanent under any failure. The database refuses DELETE on posted entries and any
      UPDATE of their number. Cancelling is a reversing entry with its own new number. No tool can release a number.
    - **Checked against the order counter (2026-10-21, 0162 and `src/db/orderNumbers.ts`):**
      - its one reclaim path is the rollback of the order's own transaction, which takes the count back with it;
      - the app role holds UPDATE on `order_numbers` and nothing stops the count going DOWN; a repeated number is
        stopped only by the unique index on orders.
      - So the books' counters share nothing with it: not the table, the function or its grants. They get their own
        table, a trigger that refuses any decrease, and no DELETE grant. Posted entries refuse DELETE and any change of
        number (trigger and revoked grant both). The number is taken inside the posting transaction.
      - C1's tests: a decrease refused; a delete refused; a rollback leaves neither a gap nor a repeat; two postings at
        once get consecutive numbers.
  - *Depends on A2–A5 and B5.*
  - *(built 2026-10-21, 0182–0183: the exchange accounts and the marked line (refused anywhere else); twenty
    postings at once in two journals, each 1…n; entries by hand — `/app/books/entries`, drafted, posted by the
    database's rules, discarded (never deleted), reversed (a new entry, lines swapped, linked, its own number; a
    posted entry offers nothing else); entries from Nomi's confirmed orders, once each (`source_order_id`, unique
    while not discarded — two at once make one), onto the owner's chosen sales journal, receivable and sales accounts
    (since D0, an order goes through an invoice instead, with its customer: see D0).
    What is read in (B2–B5) arrives as drafts and posts the same way. Not yet: editing a draft (discard and draft
    again); tax and the buyer as a party on an order's entry — C2's invoices.)*
- **C2 · Item 5 — payment tracking:** invoices with lines, and payments, partial or full, in any currency. *Depends on C1.*
  *(built 2026-10-21, 0184: invoices numbered at issue from their own counter, F-<year>-<n>, inside the issuing
  transaction — no gap, ten at once consecutive; issued, never changed (a correction is a credit note, not built yet);
  net and tax checked to the cent by the database; issuing posts receivable / sales / tax, a foreign invoice's
  conversion rounding its own marked exchange line. Payments in the invoice's currency, never more than owed (app and
  database); the receivable relieved at its own book value, the last payment taking exactly what is left; the realised
  gain or loss a marked line — a USD invoice paid in two parts at two rates clears to 0.00 in MAD and in USD.
  Standing: draft, open, partly paid, paid, overdue. Pages /app/books/invoices; customers added as parties of the
  books. Calls: a payment in a third currency is not taken; a party is not linked to a buyer — so the per-buyer legal
  hold A2.4 tied to that link is not needed yet, and comes with the link when there is one.)*
- **C3 · Item 4 — reconciliation:**
  - from **statement files only** (CSV, OFX, CAMT.053; decision 8);
  - suggested by rule, **always confirmed by a person.**
  - *Depends on C2.*
  - *(built 2026-10-21, 0185: `src/core/books/statements.ts` reads CSV (the Nomi layout, "1.250" refused), OFX 1.x/2.x
    and CAMT.053 (booked entries only), machine numbers exactly; each line kept once per bank account by its
    fingerprint — the bank's reference, else day, amount, wording and its place among equal lines — so a statement
    read twice adds nothing. The rule suggests a posted line of the same account, currency and amount within a week;
    a match is made only when a person presses it, and the database checks it (posted, same account, amount and
    side, one match a line at a time). Undone, a match is set aside (kept), and both lines are open again. Page
    /app/books/bank; the accountant sees it and matches nothing.)*
- **C4 · Item 13, part 2 — writing back** to Sheets, Excel and Odoo: conflicts shown, never overwritten silently.
  *Depends on C1–C3.*
  *(built 2026-10-21, 0186: EXCEL is the download (B2), which holds every posted entry. SHEETS: "Write the books"
  reads the spreadsheet first. If anything there differs from what Nomi last read or wrote — a row the owner added or
  changed, or one Nomi put there that the owner deleted — it is a conflict, listed by kind and code, and nothing is
  written. Read it in, or undo it there, then write again. With nothing unread, the sheets are cleared and written,
  and what was written is remembered, so the next read sees nothing new. A draft written there and since posted (its
  row now goes by its number) is Nomi's own row, never "removed". ODOO: "Send posted entries" creates and posts
  each posted entry of Nomi's that did not come from Odoo and was not sent before, its reference Nomi's number, its
  lines in book currency (a foreign line also gives its own amount). One Odoo already holds under that reference, or
  one naming an account, journal, partner or currency Odoo lacks, is a conflict: named, and nothing is created for
  it. Odoo's own rules then apply. Each sent move is remembered by its Nomi entry (never sent twice) and by the name
  Odoo gave it, so the next Odoo read does not bring it back as a new entry. 0186: the database refuses an
  accountant any write to invoices, payments, statements and matches, as 0175 refuses their posting.)*

### Stage D — everything on top

- **D0 · The owner's answers on block C** (2026-10-22).
  - *(built 2026-10-22, 0187.)*
  - **The invoice's customer is a SNAPSHOT,** no longer a link (decision 18). Parties gained an address.
  - **What an order's entry debited, and why that changed.** C1's entry from an order debited the receivable account
    with **no party** and credited sales. So an unpaid order could only be traced to who owed it through the order
    itself, which lives on the sales side the accountant cannot see. The receivable could not be aged by customer,
    and reconciliation had nothing to meet. Worse, the entry's label carried the buyer's name into a document that
    never changes.
  - **Now an order goes into the books THROUGH AN INVOICE:** a draft invoice for the customer the owner chooses among
    the books' parties. It has one line (the order's reference and total, on the sales account) and the tax code the
    owner chooses, dated the day the order was confirmed. It is made once per order. Issued, it posts what every
    invoice posts: the receivable debited **with the customer on it**, and the sale and its tax credited. So D1's
    trial balance and the receivables by customer see every sale with its debtor. An order entered the old way stays
    in the books and is not offered again.
  - **The add-customer form's labels were shuffled** in all five languages (C2). Fixed, and
    `tests/parity/books-party-labels.test.ts` reads each label against its field.
  - **A connection's day was read in the database session's time zone** while the app counts in UTC. A key's age came
    out a day short before 08:00 in a +08:00 zone (found 2026-10-22, 00:40 local). It is read in UTC now, and the
    test reads it in two other zones.
  - "What the books do not do yet" is said on the books' page (§10).
- **D1 · Item 1 — trial balance.** *Depends on C1.*
  *(built 2026-10-22: `/app/books/trial-balance`, the owner's and the accountant's. For a period, each account's
  opening, movement and closing, from the posted lines in the books' currency (never re-rated). A balance-sheet account
  opens with everything before the period; an income or expense account with its fiscal year. The result of earlier
  years not yet closed (D2) is one line of its own, so the opening columns balance. Proven against a two-year fixture
  worked by hand, to the cent, and balanced for every month of both years.)*
- **D1b · Credit notes** (the owner, 2026-10-22: a schedule item, not a note; before tax reports).
  - Numbering is gap-free and an issued invoice never changes, which is correct. So an invoice issued in error, or a
    sale refunded, needs its own route: **a credit note.**
  - **What it is:**
    - drafted against ONE issued invoice, for all of it or some of its lines;
    - numbered at issue from its OWN gap-free counter (`A-<year>-<n>`);
    - its customer copied at issue, like an invoice's (decision 18);
    - issuing posts the mirror of the invoice's entry: sales and tax debited, the receivable credited with the
      customer on it. For a foreign invoice this is at the credit note's OWN day's rate (decision 13: a rate is
      stored, never recomputed). The receivable is relieved at the invoice's book value by the one rule C2's
      payments use, and any difference is a marked exchange line. *(Changed from "at the invoice's rate" while
      building: posting picks the owner's rate for the entry's own day, and forcing another would mean re-making
      the posting rule.)*
    - it lowers what is owed on the invoice. Already paid, the excess is a credit owed to the customer, refunded by a
      payment out.
  - **Never more** than the invoice less the credit notes already issued against it (the app and the database).
  - *Depends on C2 and D0.*
  - *(built 2026-10-22, 0188.)*
    - A credit note credits quantities of an invoice's lines, at each line's own price, account and tax code.
    - The last of a line takes exactly what is left of its net and tax: a line credited in thirds comes to the cent.
    - It is numbered at issue from its own counter, its customer copied from the invoice's copy.
    - Refunds are payments of kind `refund`, never more than the customer is owed back.
    - What is owed counts the credit notes. The invoice reads as credited, or as refund due.
    - **Every payment and every credit note is now checked with the invoice LOCKED.** C2 did not lock: two
      payments at once on two journals could have paid an invoice twice. Both races are proven by tests that hold
      one transaction open.
    - Not yet: a price reduction on its own (no quantity given back) is not a credit note. Said in §10.
- **D2 · Item 6 — period close:**
  - a pre-close checklist, then a lock;
  - closing entries in their own journal;
  - **at most two periods open at once** (Avis 24).
  - *Depends on C1–C3 and D1.*
  - *(built 2026-10-22, 0189: `/app/books/closing`.)*
    - **Two dead ends found and closed.** Nothing in the app could open a fiscal year: every entry needs one, so a
      shop could post nothing. And the lock date was a plain column the app could move either way, unrecorded.
    - **The lock** moves only through the database's functions: forward, up to today, by the owner, with the
      checklist clear (draft entries, draft invoices, draft credit notes, unmatched statement lines on or before
      the day — counted by the database).
    - **Reopening** moves it back: the owner's, with a reason, recorded in `period_locks` with every lock and
      closing.
    - **Closing a year** locks it to its last day and posts ONE entry in the closing journal: each income and expense
      account to nothing, against the owner's result account. Then the year is closed for good. The closing journal
      takes nothing else. The app's role can neither close a year by setting its state nor move the lock by a write.
    - **Each wall** refuses a viewer who is not the owner, and is proven load-bearing by switching it off.
    - Opening a fiscal year is the owner's; a third open one is refused (0169).
    - `tests/parity/migrations-remade.test.ts`: 0189 first re-used the name of 0173's `books_settings_rules` and
      silently replaced the books' currency rule. From 0189 on, a migration that re-creates a function must say it is
      re-made, and name the latest migration it comes from.
- **D3 · Item 2 — tax reports and the accountant pack:**
  - **The accountant pack, for every shop:** trial balance, journal and general ledger, in a standard export any local
    accountant can work from.
  - **Country tax reports only where verified against primary legal sources.** Nomi never claims a country's compliance
    it hasn't verified.
  - **Prepared, never filed** (§9).
  - Which countries get a verified report is decided as each one is verified. Morocco is first (D4); France only with a
    French customer.
  - *Depends on C1 and A2's tax codes.*
  - *(built 2026-10-22: the ACCOUNTANT PACK, `/app/books/pack.xlsx`, from the trial balance page; owner and accountant.)*
    - One workbook for a period: About (the business, the period, when made, `Nomi · build · schema`, the books'
      currency), the trial balance, the journal (each journal's lines and total), the general ledger (each account's
      opening, lines with a running balance, closing), and the tax by code.
    - Each sheet prints the business, its title and the period at the top of every page, and the software, the time
      made and `page / pages` at the foot (Avis 24's report criteria).
    - The tax sheet is a SUMMARY: each code's base, the tax at its rate, and each tax account's movement beside it,
      so a difference shows. It is no country's form. A country report comes only where verified: Morocco's is D4.
    - Proven against D1's fixture worked by hand: the same figures, read back from the file.
    - Not yet: the business's own legal identifiers (ICE, IF, RC) are not held anywhere; D4 adds them for Morocco.
- **D4 · Item 10 — Morocco: the chart and the Moroccan FEC (re-cut after Q3):**
  - **The chart:** the CGNC chart for **every** shop, whatever its connector. It's built from the CGNC itself, the
    legal source, not copied from Odoo's LGPL `l10n_ma`.
  - **The Moroccan FEC is required, and Moroccan, not French.** My earlier "the FEC is a French obligation" was wrong.
    The owner's memory of AVA producing FEC exports for the DGI was right.
    - **CGI art. 210 (LF 2018):** taxpayers keeping electronic accounts "doivent remettre une copie du fichier des
      écritures comptables établi selon un format électronique" in an audit.
    - **CGI art. 145-I (LF 2026):** makes electronic bookkeeping the general rule ("sous format électronique conformément
      à la législation et à la réglementation en vigueur"). Its date of application is *unverified*.
    - **The format, CNC Avis n° 24 of 14 June 2023,** written at the DGI's request (its correspondance n° 2384/20). Art. 2:
      the systems "doivent produire un fichier appelé « Fichier des Ecritures Comptables (FEC) »". *Read in the
      ministry's own PDF:*
      https://www.finances.gov.ma/Publication/depp/2023/Avis%20n°%2024%20comptabilité%20sous%20format%20éléctronique.pdf
    - **Its 18 fields, under Moroccan names:** Code_Journal, Libelle_Journal, Num_Ecriture, Date_Ecriture, Num_Compte,
      Libelle_Compte, Num_Compte_Aux, Libelle_Compte_Aux, Ref_Piece, Date_Piece, Libelle_Ecriture, Montant_Debit,
      Montant_Credit, Lettrage_Ecriture, Date_Lettrage, Date_Validation, Montant_Devise, Id_devise. That's the French
      structure, renamed. It never cites the French LPF.
    - **The DGI's 2025 activity report** says its system to *receive* FECs electronically is complete.
  - **The software criteria in Avis 24's annex §2 bind the ledger (A2, C1, D2):**
    - entries numbered in sequence, with no gaps or duplicates;
    - closed periods can't be changed;
    - at most two periods open;
    - closing entries in their own journal;
    - a document reference and date on every entry;
    - balance checked before and after posting;
    - authenticated users, with who did what and when;
    - archiving with a certain date;
    - reports carrying the entity, the period, the date made, the software version and page numbers.
  - **Does any of it bind the SOFTWARE? No: there is no software certification, registration or attestation in
    Morocco, in force or announced (checked 2026-10-21, primary sources). So it is not a launch gate.**
    - Avis 24's criteria bind the **taxpayer, through the software they keep their books in.** The text addresses the
      "systèmes informatisés" an entity uses. The vendor appears once, in 2.1 b, as the author of the technical note
      the entity keeps.
    - Neither the CGI (art. 145, 210) nor the DGI's Note circulaire n° 737 on the LF 2026, which cites Avis 24,
      creates a certificate, a list of approved software or an attestation from the publisher.
    - Contrast France, where a certificate exists only for **cash-register** software (CGI art. 286-I-3° bis), not
      for accounting software, and e-invoicing goes through **approved platforms** (plateformes agréées) from
      1 September 2026. Neither applies to Morocco.
    - **To watch:** the art. 145-IX e-invoicing decree, still unpublished. If it creates an approval for software or
      platforms, that becomes a gate for e-invoicing, which is outside Phase 5's 100%.
  - **Who must comply:** **CGI art. 145-XI exempts** the CPU and auto-entrepreneur regimes. Companies, and shops taxed
    on real or simplified net income, need it.
  - **Not published yet (open):**
    - the FEC's **file name, separator and encoding** (Avis 24 sets none);
    - **the DGI's upload specification.**

    D4 builds the fields and the criteria now, and leaves the file envelope as one configurable detail until the DGI
    publishes it.
  - **Later, outside Phase 5's 100%:**
    - e-invoicing (CGI art. 145-IX, waiting for its decree; *secondary* sources say UBL, with SMEs in 2027–2028);
    - the liasse fiscale in SIMPL's EDI XML (usually the accountant's job).
  - *Depends on A2, C1 and D2.*
  - *(built 2026-10-22, 0190.)*
    - **The CGNC chart, from the CNC's own text:** the plan de comptes, modèle normal, 871 accounts.
      - The ministry's PDF is a scan. It was read twice by local OCR, then every page (257–315) was checked
        against its image by hand. 116 corrections: the OCR dropped 13 headings and three accounts — one of
        them 6331, the exchange-loss account — and misread three codes.
      - The method, the source's SHA-256, the corrections and the list are in `docs/cgnc/`. The scripts are in
        `tools/cgnc/`, and re-running them reproduces the list.
      - A template of 0171: the owner adds it from the books' page. It changes nothing the owner already has, and
        chooses the accounts Nomi drafts with only where none were chosen (VE, 3421, 7111, 6331, 7331).
      - The six journals are Nomi's, not the CGNC's.
    - **The Moroccan FEC** (`/app/books/fec`, owner and accountant): per fiscal year, the eighteen fields of Avis 24
      annex 3, named and ordered as the Avis lists them, read from the ministry's PDF.
      - The auxiliary account is the party. The validation date is the posting day. The currency amount is given
        for foreign lines.
      - Lettrage is left blank ("à blanc si non utilisé").
      - The envelope is `FEC_ENVELOPE`, because the Avis sets none: UTF-8, a header line, `|`, AAAAMMJJ, a full
        stop.
    - **The check program of annex 2.2 b** runs on the same page: each journal's numbers, no gap and no repeat.
    - **Accounts whose first three characters are not the CGNC's are named**, as annex 3 asks of Num_Compte.
    - **FOUND IN AVIS 24'S OWN TEXT, for the owner (2.3 d):** « Le logiciel n'autorise pas d'avoir plus de deux
      périodes courantes ouvertes au sein de l'exercice en cours, à savoir la période en cours et la période
      précédente », besides the closing and opening periods.
      - That is PERIODS within the year, not fiscal years. Nomi holds "two fiscal years open" (0169) and a lock
        date moved by hand (D2).
      - Enforcing the Avis literally refuses a posting dated before last month. That includes history read in from
        a workbook, Sheets or Odoo.
      - **Does the Avis set an opening entry apart from ordinary postings? (the owner's question, 2026-10-22).** Yes, but
        narrowly. 2.3 d goes on: « La période dédicacée dans laquelle s'enregistrent les écritures de clôture de
        l'exercice précédent et l'écriture d'ouverture sont les seules périodes qui puissent en sus être ouvertes. »
        - So the OPENING ENTRY ("l'écriture d'ouverture", singular) is named, and its period may be open beyond the
          two current ones.
        - The text names nothing for bringing a company's past entries in one by one: no "migration" and no
          "reprise".
        - It says only, in its preliminary definitions (point 1), that « chaque donnée entrée dans le système de
          traitement par transmission d'un autre système de traitement, doit être appuyée d'une pièce justificative
          probante ».
      - **What follows:** the lock stays MANUAL — the owner's tool, as now (D2) — and nothing becomes automatic for
        Moroccan workspaces until the owner chooses.
        - The distinction the text makes supports an explicit, one-time OPENING mode per workspace, recorded with its
          date and who ran it, and the two-period rule automatic after it.
        - But what the text allows in that mode is an opening entry (the balances at the start), not the shop's
          detailed history.
        - Detailed history from earlier months of the current year falls under the two-period rule as written.
        - The owner's to choose: an opening mode that takes the opening entry only, with history kept as balances, or
          one that also takes the year's detailed entries.
      - **DECIDED (the owner, 2026-10-22): THE OPENING ENTRY ONLY — balances at the start date, nothing more.**
        - The text names « l'écriture d'ouverture », singular; taking the year's detailed entries goes beyond it.
        - The reason is the asymmetry. Too strict costs a shop some convenience at onboarding. Too loose puts entries
          in the ledger that the rules say should not be there, found by an inspector rather than by us. A system of
          record survives an audit on the text, not on our reading of it.
        - Built as **D10** (below). Until then the lock stays manual.
      - **The advice an accountant would give**, now on the books' home of a Moroccan workspace (`books.morocco.*`),
        not only in the code's constraints:
        - start at a fiscal year's first day: the opening balances are then last year's close, and the whole year is
          entered inside the two-period window;
        - mid-year, what came before comes in as one opening entry of balances — ask the accountant for them.
        - It says "period", as the Avis does, never "month": the Avis sets no length (see D10).
      - **Not yet, and BLOCKING for a Moroccan workspace (docs/LAUNCH-CHECKLIST.md):** the DGI has published no name
        for the FEC file (checked 2026-10-22: the Avis, CGI article 210, the DGI's 2025 report). `tools/books-area.mjs`
        refuses a Moroccan workspace until it is known. (The business's own ICE, IF and RC are held since E2, 0206.)
- **D10 · The opening mode, and the two periods after it** (the owner, 2026-10-22). *(built 2026-10-24, 0211, option A: see
  Stage R, R1.)*
  - **A one-time opening mode per workspace** takes the opening balances, as ONE opening entry at the start date, in
    its own period. It is recorded with its date and who ran it.
  - **After it, for a Moroccan workspace, the two-period rule applies automatically:** only the current and the
    previous period are open for entries, besides the opening entry's period and the previous year's closing period
    (2.3 d). The lock stops being a manual tool there.
  - **To settle before building — what a « période » is.** The Avis does not define its length. The CGNC or the
    DGI's practice may (monthly VAT returns suggest a month; quarterly filers suggest otherwise). It will be checked
    against the text and asked, never assumed.
    - **Checked 2026-10-22: NOT PINNED DOWN — to be asked of an accountant.** No text defines it.
      - Avis 24 uses « période » six times and defines it nowhere; its §1 defines other terms.
      - Loi 9-88 art. 7 defines only the exercice (twelve months).
      - What only SUGGESTS a month:
        - Loi 9-88 art. 3: the journals are centralised « une fois par mois » — but a natural person under 2 MDH may
          centralise once a year.
        - The CGNC: centralisation « au moins une fois par mois »; « récapitulations au moins mensuelles ».
      - What argues against one fixed length:
        - The CGNC allows interim statements « semestrielle, trimestrielle ou mensuelle ».
        - VAT is filed monthly or quarterly by turnover (CGI art. 108). Nothing ties it to Avis 24.
      - The DGI's note circulaire n° 737 cites Avis 24 and says nothing on periods. Professional commentary repeats
        « deux périodes ouvertes » without a length.
      - The official sites (finances.gov.ma, tax.gov.ma) did not answer, so the CGI and note 737 were read in
        third-party copies.
      - **The question for the accountant:** « Pour le principe d'irréversibilité de l'avis CNC n° 24 (annexe §2.3 d),
        quelle durée de « période » un logiciel doit-il appliquer : le mois (centralisation mensuelle, loi 9-88 art. 3),
        le trimestre pour un assujetti TVA trimestriel (CGI art. 108-II), ou une durée fixée par l'entreprise dans son
        manuel comptable ? Un commerçant autorisé à centraliser une fois par exercice peut-il n'avoir qu'une période ?
        Existe-t-il une position écrite du CNC, de la DGI ou de l'Ordre ? »
      - D10 waits for the answer. The most natural reading is the month, and it is not to be picked without the
        accountant.
  - **Done when:**
    - the opening entry is taken once and refused a second time;
    - the date and the person are recorded;
    - for a Moroccan workspace, an entry dated outside the open periods is refused BY THE DATABASE, with its reason,
      and an entry inside them goes through;
    - a non-Moroccan workspace keeps the manual lock;
    - each rule, switched off, fails its own test.
- **D11 · History, not in the books — DEFERRED (the owner, 2026-10-22).**
  - **Not built, and not to be built until there is evidence for it.** A parallel, ledger-shaped store for history is
    a lot of surface for a system of record: a new table, five connectors changed, a page, an export, its own erasure,
    retention and role rules — all to hold data already decided not to be in the books.
  - **The need is "I want to look at what happened before", and the FILE answers it.** D10 keeps the source document
    instead (below).
  - **Trigger:** real owners turning out to need searchable pre-Nomi detail INSIDE Nomi, with evidence that somebody
    wanted it.
- **D10's small version of it — the source file, kept as history** (the owner, 2026-10-22). *(Built as E3, 0207, on
  today's window — the open years and the lock date; D10's periods narrow that window in one place.)*
  - When an import brings entries outside the open window, its SOURCE DOCUMENT is kept as a document in A4's store,
    with its retention date, marked "history, not in the books": the workbook, the statement file, the export.
  - It inherits A4's erasure, retention, sealing and role rules. It goes with the books at closure like everything else
    in that store, so there is no new decision about it.
  - The owner opens and downloads it like any paper.
  - What D10 needs for it:
    - a mark on the document, set when it is kept (documents are never updated, G20);
    - the workbook's and the statement's media types admitted where the store is written (the papers' page takes images
      and PDFs; the database's check takes any media type);
    - the read-in keeping the entries inside the window, the file kept for what fell outside.
  - **Odoo, Xero and QuickBooks give no file, and need none:** the owner still has them, and their history has not
    gone anywhere. The Moroccan start advice says so (`books.morocco.systems`).
- **D5 · REMOVED from 100%: the French FEC and DGFiP's checker.** They come back only with a French customer. The Moroccan
  FEC has **no official checker**; D4 is tested against Avis 24 itself (§4).
- **D6 · Item 7 — reading receipts, invoices and bills, in any language:** a draft entry the owner confirms, never posted
  alone. *Depends on A4 and C1.* 💰 (a model reads each document).
  *(built 2026-10-22, 0191: `/app/books/papers`. 💰 — tested with a recorded reader; never run live without
  asking (zero-spend mode).)*
  - **A paper** (a photo, or a PDF where the provider reads documents) is kept sealed in the workspace's residency
    (A4). Its bytes must say what its label says.
  - **"Read it"** asks the model provider through its own port (`DocumentReader`, src/llm/ports.ts). It asks for what
    is printed, as printed text, never computed. Each read is one of the day's photo reads, and refused when the
    allowance is used.
  - **The reading is kept as it came** (0191), with what Nomi's check found wrong (src/core/books/reading.ts):
    - a figure that reads two ways (A1's rule);
    - lines that do not add up to the total;
    - no day, no number, or a currency the books do not keep.
  - **From a reading with no problem, the owner drafts ONE entry**, choosing the journal, the supplier, the payable
    account and every line's account and tax code. A purchase: lines debited, tax to its code's account, the
    supplier credited the total. A DRAFT, posted by the owner like any other. The database refuses a draft from a
    reading with problems, a second draft, and any change to what was read.
  - The accountant sees and takes the papers, and reads or drafts nothing.
  - The books' launch blocker for /privacy now also names the model provider reading the papers.
- **D7 · Item 9 — custom categories and fields.** *Depends on C1.*
  *(built 2026-10-22, 0192: `/app/books/fields`.)*
  - **The owner defines a field** on entries, lines, or customers and suppliers: text, an exact number, a date, or
    one of a list (a category). 0170's table and checks hold the values; the page only adds the definitions.
  - **Only a party's field can be required** (0192, a check in the database). Nomi writes entries of its own (an
    invoice issued, a payment, a bank match, an exchange difference, a year's closing), and none of them could give
    a value. A party is always made by a person.
  - **A field is never deleted, and keeps its key and kind** (0170). One no longer wanted is RETIRED: no form offers
    it, and no new row takes a value under it. The values it has stay, travel with it, and read back. It can be used
    again.
  - **The forms:** the entry form (the entry's fields, and a column per line field) and the customer form. Each value
    is checked as the database checks it, and a wrong one is named by its field. The entry page shows the values.
  - **Every road the books take carries them** (the done-criterion):
    - **the workbook and Google Sheets:** the definitions below their own header on the "Nomi" sheet (not a new tab:
      Sheets refuses to read a tab that is missing), and a column per field named by it — `party.segment`,
      `entry.project`, `line.weight_kg`. An entry's value is the same on each of its lines;
    - **Odoo:** no place every Odoo has, so the values travel in Nomi's mark, `[nomi:…]` (the values as JSON in
      URL-safe base64, which an HTML field's cleaning leaves alone): the move's notes, the partner's notes, the end
      of a line's label. The FIELDS do not go to Odoo; a read from Odoo is checked against Nomi's;
    - **the owner's copy (A2.4):** a last column, `Champs_Personnalises`, one exact JSON object per line;
    - **the read-in:** a definition is a record like the rest (connector_records' kind `field`). A new field is added
      before the values that need it; a field Nomi holds otherwise is a difference to settle in Nomi. A field that
      arrives retired comes with its values and is retired after them.
  - The accountant sees the fields and changes none (0186's trigger on the definitions, proven past the route).
- **D8 · Xero,** then **D9 · QuickBooks**, through B1. *Depends on C4.* 💰 above the free tiers.
  - **D8 Xero** *(built 2026-10-22, 0193: `src/books/connectors/xero.ts`; against a recorded fake of Xero's documented
    answers — no Xero account was made. Live on deploy day, within the Starter tier: 5 connections, no card.)*
    - **Sign-in:** Xero's own consent page (the web flow: the client's secret, no PKCE), the granular scopes an app
      made after 2 March 2026 must use. The ONE organisation the owner chose is found by the token's own consent;
      none or several is refused with its reason, and the grant Xero just gave is given back.
    - **The refresh token rotates** (each use returns the next; the one before stops after 30 minutes): every call
      refreshes it and keeps the new one first (`rotateGrant`), the old one archived, never deleted.
    - **What Xero holds** (the conformance suite's `xeroHolds`, said in the open):
      - accounts without a parent, only ACTIVE ones; tax rates by their TaxType, with the organisation's tax account
        ("GST / VAT", SystemAccount GST) and no start day — the owner confirms it, as for Odoo (C0);
      - contacts without custom values (a contact has no notes a connector can write);
      - manual journals, in ONE journal ("XERO"), in the organisation's currency only: an entry with a foreign line is
        not held by the mapping, and C4 sends the converted amounts;
      - a line's party and tax code, and the custom values, in Nomi's mark (`[nomi:…]`) in the narration and the line
        descriptions — Xero's lines name no contact.
    - **C4:** each posted entry not from Xero and not sent before becomes a POSTED manual journal, with an
      Idempotency-Key. A conflict waits, nothing sent for it: already there, an account Xero lacks or archived, books
      in another currency than the organisation's, Xero's own refusal (a bank or system account). What was sent is
      never read back in as new.
    - **Found building it:** a tax collected or deducted with no account now stops a read-in with its reason (it was
      a database error); the tax-day form and its notice named Odoo, they now name the system.
    - Not yet: the Journals endpoint (all of Xero's own postings, invoices included) is Xero's premium tier and is not
      read: what Nomi reads from Xero is its manual journals.
  - **D9 QuickBooks Online** *(built 2026-10-22, 0194: `src/books/connectors/quickbooks.ts`; against a recorded fake of
    Intuit's documented answers — no Intuit account was made. Live on deploy day, on the Builder tier: free, reads
    capped at 500,000 a month and blocked above, writes uncapped. Production keys wait on Intuit's App Assessment
    Questionnaire.)*
    - **Sign-in:** Intuit's own page, one scope (`com.intuit.quickbooks.accounting`); the company by the `realmId`
      that comes back with the code, checked before anything is kept (the grant given back when it does not answer).
      Minor version 75, the lowest Intuit still serves.
    - **The refresh token changes every 24 hours** (the old one then expires): the one each refresh returns is kept,
      as Xero's.
    - **What QuickBooks holds** (`qboHolds`, said in the open):
      - accounts by their number (`AcctNum`), WITH their parents;
      - customers and vendors: a vendor's code is its `AcctNum`; a customer's code, ICE and custom values are in Nomi's
        mark in its `Notes`. A tax identifier comes back masked, so none is read; a vendor carries no custom values;
      - NO taxes: QuickBooks' tax rates name no account the books could post them to, and a United States company's
        sales tax is QuickBooks' own automation. Nomi's tax codes stay Nomi's; a line's tax code travels in the mark;
      - journal entries, numbered by `DocNumber` (21 at most), in one journal ("QBO"), all posted (QuickBooks keeps no
        draft), one currency each — an entry in two currencies is not held, and C4 sends the converted amounts.
    - **C4:** each posted entry not from QuickBooks and not sent before becomes a journal entry numbered by Nomi, with
      a `requestid`; the party is the line's `Entity`; `GlobalTaxCalculation` is sent outside the United States only
      (required there, refused in the US). A conflict waits: already there (or 6140), an account or a party QuickBooks
      lacks, books in another currency than the company's, a number longer than 21, QuickBooks' own refusal. A
      subscription that ended (6190) is said for what it is.
- **DZ · The role check, in EVERY block — and a final confirmation** (the owner, 2026-10-22; at first a closing sweep).
  - Each block's done-criteria (§4) now include it: a new table means the accountant and staff are checked AT THE
    DATABASE, with a test that goes past the route guard.
  - DZ stays as the final confirmation that nothing was missed, not the first time anyone looks.
  - The gaps already found (below: block C's and D's own tables) are closed within block S, each with its test past the
    route guard, before block S's PR merges.
  - Twice in block C, a role restriction held in the routes and not underneath (B0's sales side, 0186's invoices and
    statements).
  - Before Phase 5 closes, **every role restriction is checked at the database, not the page:**
    - for each table, what the accountant and staff may read and write;
    - each one proven by a test that goes past the route guard, as `books-viewer.test.ts` does.
  - **Found in D7, for the sweep:** the accountant's write is refused at the database on invoices, payments,
    statements, matches, credit notes, papers' readings, fiscal years and custom fields — but NOT on parties, accounts,
    journals, tax codes, or a draft entry and its lines. The routes refuse them all, and posting is refused (0175).
  - **Closed in block S (0200, 2026-10-22):** 0186's `books_owner_acts` now stands on parties, accounts, journals, tax
    codes, journal entries and journal lines too. `tests/integration/books-dz.test.ts` goes past every route guard: as
    the accountant, each table is still in sight, and each insert, change and deletion is refused with the books'
    reason; the owner's same write goes. Each table's guard is proven by dropping it alone.
  - **Found and closed in block S (0201, 2026-10-22): staff had the books underneath** — the finding the per-block
    database role check was made for, in the first block after the rule (the owner, 2026-10-22). Decision 12 gives staff nothing
    of the books; the routes held it, but a request made as a member of the team read the chart of accounts and added
    an account to it. 0201 adds a restrictive `not_for_staff` policy (`viewer_is_staff()`, from the person's own row) to
    every one of the books' own tables: a team member's request sees no row of them and writes none. Left open, because
    the sales side reads them too: the workspace row, the books' settings (the documents' residency), the documents
    store and its blobs, and the owner's exchange rates. `books-dz.test.ts` walks the schema, so a new table of the
    books must carry the policy or be named there with its reason; each part is proven by switching it off.

### Stage S — the salesperson, alongside A–D wherever it doesn't depend on them

- **S1 · Item 18 — canned replies.** *(built 2026-10-22, 0195: `/app/replies`, under Buyers.)*
  - **A saved reply** is a title and its words in one or more of the five languages. Owner and staff keep them. The
    accountant is refused by the route, and by the database, which shows them no row (0177's policy on the new
    table, proven past the route guard).
  - **It never sends.** In a conversation a person holds, the reply form has a second button that puts the chosen
    saved reply in the box. The words come in the buyer's language where the reply has it, else the person's. They
    go after what was typed, which travels with the same form, so nothing typed is lost.
  - **The box then goes by the owner's reply, and only so:** sent where the window is open; refused and KEPT where
    it is shut (CC-24); refused while the workspace is frozen, the box untouched.
  - Archived, never deleted; one archived is never offered, and comes back only while no other one in use has its
    title.
  - **No placeholders, by decision (the owner, 2026-10-22).** A placeholder that silently fails sends a buyer
    "Hi {name}". The words are put in as written, for the person to read and change. This is not a gap to fill
    later.
- **S2 · Item 19 — labels.** *(built 2026-10-22, 0196–0197: `/app/labels`, under Buyers.)*
  - **A label** is the workspace's own word, one line of at most 40 characters, the same whatever its capitals. It is
    put on a buyer from their panel, by name: the label in use of that name, or a new one.
  - **On Buyers:** each label in use narrows the list (with the tab and the search kept), and the search finds a buyer
    by a label they carry.
  - **Decision 5 holds:** a label is NOT drawn on the Buyers row (name, last message, time). It shows above the list as
    a narrowing, and on the buyer's panel.
  - **Erased with the buyer:** `buyer_labels` is in the erasure contract and its links (0197 wraps 0151's erasure). The
    real tool run (erase-buyer.test.ts) finds the erased buyer's label gone, and the next buyer's label and the label
    itself kept.
  - Taken off, the row stays marked; put on again is a new row. Archived, a label narrows nothing and no search finds
    it. Nothing is deleted.
  - Owner and staff. The accountant is refused by the route, and by the database, which shows them neither table
    (checked past the route guard: DZ, in this block).
- **S3 · Item 21 — round-robin assignment.** *(built 2026-10-22, 0198: the team page's "In turn" section.)*
  - **The owner switches it on** and says who is in turn and who is away until a date, on the
    team page, which is the owner's alone. An accountant is never in turn: the page offers no box, and the database
    refuses it.
  - **Who is next:** among those in turn and not away, the one who has waited longest since they were last given
    one; never given one comes first; ties go to whoever joined first. Waiting longest, not fewest given, keeps it
    fair across an absence: back from away, a person is next once, not given everything they missed. A seeded
    property test (`tests/rotation.property.test.ts`, 2,000 runs a property) holds fairness to within one, the
    skipping of anyone away, the return without a burst, and that the answer never depends on the rows' order.
  - **When:** after a hand-off commits, before its alert is queued. The next in turn holds the conversation as if
    they had taken it, and their turn moves only when they are given one. The alert still goes as before.
  - **The owner's override wins:** the turn gives only a conversation that still waits for anyone. One a person
    holds, or the owner has handed on, is never taken, then or later.
  - **Nobody in turn, or the turn off:** the hand-off waits for anyone, exactly as before S3.
  - **Claude's calls, reported:** a hand-off a deletion request made is never given in turn — it stays the owner's,
    since recording the request is the owner's alone (checked twice: the worker skips it, and the database step
    refuses any conversation whose buyer has a deletion request waiting; each check proven by switching it off).
    A hand-off made while the assistant is stopped or silenced is given in turn like any other: those buyers wait
    for a person, and the turn only says which one. A failure of the turn never stops the hand-off's alert.
- **S4 · Item 16 — strict mode per language.** *(the code built 2026-10-22; in force in no language.)*
  **BUILT, NOT USABLE until the prompt knows which sentences are signed** (the owner, 2026-10-22). Switched on today, a
  strict language would hold nearly every reply as a draft: the writer does not yet know the signed sentences, so it
  rarely writes one exactly. That is the safe direction, so it stays as it is — but nobody should switch it on
  expecting the behaviour designed here. Teaching the writer the set changes the prompts and needs the live model
  check, which costs balance: not run. The owner approves a bounded run, with a stated number of calls, when there is
  budget. **Gated on a
  person:** a native reviewer per language, exactly as the Arabic disclosure is (decision 15). It switches on per
  language only when that language's sentence set is signed.
  - **What it does:** in a strict language — the customer's, or (G8) the reply's own — a reply goes alone only when it
    is made, end to end, of signed sentences. Their blanks are filled only by this turn's facts: the product's name as
    the catalogue has it, the business's and the assistant's names, a whole number, an amount, one to three digits.
    Anything else waits for the owner as a draft, with its own reason (`autonomy_withheld: strict_unapproved`, and the
    line on the draft card). It only ever takes the right to send alone away.
  - **Where:** `src/core/conversation/strict.ts` and the one send decision (`commitTurn`). `PROPOSED` is the starter set
    in five languages, for a reader to read. `SIGNED` is empty: until a reader signs a set — the exact sentences, the
    reader named, in the same commit — nothing changes anywhere.
  - **The done-criterion's 500 turns** (`tests/pipeline/strict-mode.test.ts`): through the real send decision, with
    English signed for the test. A seeded generator writes signed sentences, the same with one thing changed, free
    text, and mixtures. An oracle written separately from the check finds that nothing but signed sentences ever left
    alone, and the approved replies went word for word. The control is the same 500 without strict mode, which send
    the unapproved replies alone. Each part of the check is proven by switching it off.
  - **Claude's calls, reported:**
    - The line that answers a stop is not held by strict mode: it must reach the buyer, and it is Nomi's fixed sentence.
    - The disclosure in front of a first reply is checked by its own signature, not here.
    - The figures in a blank are the numeral guard's, as in every reply.
    - **Not built:** telling the writer the signed sentences, so it composes from them. That changes the analysis and
      writing prompts, which needs the live model check, and live checks wait for the owner's word (zero-spend). Until
      then a strict language would draft nearly every reply.
- **S5 · Item 17 — FAQ learning.** *(built 2026-10-22, 0199: "Answers people gave" on the knowledge page.)*
  - **Only people's words.** Two kinds of reply are read: one a person typed in a conversation they held (or in the
    channel's own app), paired with the buyer's last message before it; and a draft a person rewrote before it went,
    paired with that turn's words. The assistant's words — sent alone, or approved as written — are never read. Neither
    is the reopening template that goes in a person's place, nor a test conversation.
  - **Word matching, free.** One suggestion per question: the same words, whatever their order, capitals, accents,
    punctuation or a plural "s"; Chinese by pairs of characters; Arabic without its marks or article. It shows how many
    asked, the newest wording, and the newest answer. Fewer than two words that matter is no question. A request for
    a person or for a buyer's data to go, and an answer promising deletion, are never offered.
  - **Nothing becomes an answer without the owner.** Teach and Set aside are the owner's alone (`answers_given`,
    added to OWNER_ONLY). Teach writes a business-wide taught answer in the words the owner leaves in the form, and
    decides the question in the same transaction. Staff see what is offered, and that the owner decides.
  - **A dismissed one never returns.** The test sets a question aside, has another buyer ask it again in other
    capitals and order, has a person answer it again — and it is not offered. A question the assistant would already
    answer from what it was taught (the turn's own test) is not offered either.
  - **Claude's calls, reported:**
    - The suggestions are READ from replies already kept, never stored. They go with a buyer's messages when the buyer
      is erased.
    - Only the owner's decision is stored (`answer_decisions`): a SHA-256 digest of the question's folded words, never
      the words. The decision therefore outlives the buyers who asked, and the erasure classes it as unrelated.
    - A decision is final: no change, no deletion. Setting aside has no Undo; it asks first.
    - Deciding is owner-only, even though staff may teach a fact by hand (the owner, 2026-10-22: the call stands, for a
      reason). Approving a suggested answer is accepting something the MODEL put in front of you — wording drawn from
      one conversation, to be said to every buyer. Typing a fact is a person asserting something they know. Those are
      not the same act, so it is no inconsistency that staff may do one and not the other.
    - Read from the last 90 days; at most 12 shown, the most asked first.
  - The accountant is refused by the route, and by the database, which shows them no decision and takes none (DZ,
    in this block).
- **S6 · Item 20 — satisfaction surveys.** *(built 2026-10-22, 0202: `/app/surveys`, under Buyers.)*
  - **One question, after an order the owner confirmed:** how it went, from 1 to 5. Off until the owner switches it
    on (`messaging_activation`: it lets the assistant write to buyers alone). Ten minutes after the order, so the
    confirmation goes first; the minute's sweep asks it.
  - **Only where free:** a chat channel (WhatsApp, Instagram, Messenger) inside the buyer's 24 hours, with an hour to
    spare. The row is the assistant's automated message, so the send gate holds it as it holds a follow-up: never as a
    template; never while stopped or silenced; never after a stop request, or in a language without a signed
    disclosure. Otherwise it is set aside, with why (off, held by a person, not a chat channel, not free, unsigned, no
    name for the disclosure it would need), and nothing is queued.
  - **Signed sentences only, like the disclosure:** `src/core/conversation/survey.ts` holds the sentence in five
    languages and a `SIGNED` table, empty today. A language is asked only when its reader signed that exact text,
    named, in the same commit. **Until the owner signs the English one and native readers sign the rest, no buyer is
    asked anything, whatever the switch says.**
  - **Answers are stored and erasable:** a message that is ONLY a score (any of the digits buyers type, "/5", 分, the
    word for stars, or 1 to 5 stars), within 24 hours of the question, is the answer: kept once, on the timeline, and
    answered by nobody. It is checked after the hold, so a stopped assistant's buyer still reaches a person. Anything
    more ("5 more bags please") is an ordinary message. `survey_asks` is erased with the buyer (contract, links,
    `erase_customer_rows`; the real tool run finds it gone and the next buyer's kept).
  - **Claude's calls, reported:**
    - The moment is the owner's order confirmation, the only place a conversation closes today.
    - E-mail is free, but it is left out: a letter needs a subject, which would also need signing.
    - **A score is thanked in one line — once that line is signed (the owner, 2026-10-22: silence is the wrong answer
      to someone who has just done you a favour).** The thank-you is written in five languages (survey.ts, `THANKS`) and
      sent where it is signed, in the language the question was asked in, with the disclosure in front where that
      conversation has not had it (the answer often opens a new one after the order). **Until signed, the answer is
      met by silence: a KNOWN GAP, with its fix built and waiting on the signature — not a decision.**
    - The page shows the last 90 days and the latest answers. The buyer's own page does not show their score yet.
- **S7 · Item 22 — channels:** **web chat, then Telegram. Nothing else in 100%** (decision 8). LINE, SMS, WeChat and
  TikTok wait for revenue. *(built 2026-10-22, 0203–0204; the owner's choices that day: both a hosted page and a
  widget, the page first; one Nomi bot for every business; S7 stays in block S.)*
  - **The chat page** (`/chat/<key>`, `src/api/web/webChat.ts`):
    - The owner turns it on (owner only: going live) on Where customers reach you › Chat page, and shares the address.
    - A visitor's message is stored once (a form sent twice is one message) and queued like a webhook's. It is answered
      through the one turn and send gate, and shown on that page to that browser only (`yf_chat`, the page's path).
    - Off, it answers nobody and takes nothing. A frozen workspace takes nothing either.
    - It arrives complete, works without its script, and its script asks only the page's own mark.
  - **The widget** (`/chat/<key>/widget.js`): one line on the business's own site draws a button that opens the page
    in a frame. The visitor's handle is made in their browser and kept in that site's storage. It travels with the
    request — never a Nomi cookie on another site, which browsers refuse anyway.
  - **Telegram, one Nomi bot for every business:**
    - Each business turns it on and shares `t.me/<bot>?start=<code>`. `/start <code>` ties the chat to that business
      and is not itself a message.
    - A chat writes to the business it started last, while that business has it on (`telegram_route`, 0204). A chat
      that started none, a bad code, or a business switched off: nobody.
    - An update without the webhook's secret is refused before it is read.
    - Photos, voice notes and files are named and handed to a person, never opened (Telegram's media download is not
      built).
  - **D18:** Telegram is named on the privacy page (`legal.privacy.who.telegram`, five languages; `recipients.ts`
    named). The chat page's keeping, its cookie and the widget's handle are said there (`legal.privacy.kept.chat`).
  - **Simulator and pre-pilot:** scenarios 13 (the chat page) and 14 (Telegram) on the scripted pre-pilot, now 14/14.
    Telegram's API is a recorder; the chat page needs none, since it is Nomi's own.
  - **The send-path guards** are the ones every channel shares, proven on these two: the owner's Stop (the buyer
    handed to a person, the owner's own reply still goes), the disclosure on the first message nobody approved, a
    person holding the conversation, the numeral guard.
  - **Not yet, the owner's:** creating the bot with @BotFather, pasting its three settings into Railway, and running
    `tools/telegram-webhook.mjs` — then "Telegram live on deploy day" (zero-spend: no deploy until the owner says).
  - **Claude's calls, reported:**
    - The chat page and Telegram exist only on the messaging path (an installation with no channel at all has neither).
    - **A /start is greeted — once the greeting is signed (the owner, 2026-10-22: a buyer who hears nothing thinks it is
      broken).** The greeting is written in five languages (greeting.ts) and sent in the buyer's Telegram language
      where it is signed and that language's disclosure is signed too, with the AI disclosure in front: it is the
      conversation's first automated message. **Until signed, a /start is met by silence: a KNOWN GAP, with its fix built
      and waiting on the signature — not a decision.**
    - The bot is not the team-alerts bot. `TELEGRAM_BOT_TOKEN` is the one bot; no alert goes by Telegram yet.
- **S8 · Item 23 — simulated-buyer testing** — parked with the money.

### Stage E — the unblocked remainder (the owner, 2026-10-22)

- **E1 · The owner's copy of their papers — the launch blocker.** *(built 2026-10-22, 0205.)*
  - The owner downloads every paper in one archive (`/app/settings/data/papers.zip`, owner only), with `index.csv`
    listing each file: its name, type, size, SHA-256, when and by whom it was added, the entry it backs, and until
    when it is kept. Each paper is opened from its sealed store and its fingerprint checked, then written into the
    archive under a numbered, safe name (two papers of one name are two files; a name with a slash makes no folder).
  - **Closure waits for the OWNER's own copy of every paper** (`papers_export_covers`, NE012): a receipt of the owner's
    holding at least as many papers as there are and reaching the newest one. An accountant's download does not count;
    a paper added after the copy makes it old again.
  - **Made whole or not at all:** a paper that cannot be opened stops the archive in its transaction, so no receipt is
    written and closure still waits. The page then says nothing was recorded.
  - The data page shows the papers (how many, the last copy, whether it holds them all) beside the books.
  - The receipt is a `books_exports` row of kind 'papers_zip' (no new table). `books_export_covers` now reads only the
    books' own kind.
  - The zip writer the workbook used is now `src/net/zip.ts`, shared; the classic format only (65,535 files, 4 GiB),
    refused rather than written wrong past either.
  - `tools/books-area.mjs --on` no longer refuses for the papers. The public pages are still its blocker.
- **E2 · The ICE, IF and RC on the business profile.** *(built 2026-10-22, 0206.)*
  - Stored on the business (`legal_ice`, `legal_if`, `legal_rc`, `legal_rc_court`). The profile asks for them when the
    business is in Morocco, and shows them wherever one is held. Only the owner gives them (`business_identifiers`);
    staff see the values. Every line of the FEC carries them after the Avis's eighteen fields.
  - **Each rule was checked against an official source first (read 2026-10-22). One is checked; two are not:**
    - **ICE — CHECKED: fifteen positions.**
      - OMPIC's page on the ICE (ompic.ma, read directly): « L'Identifiant Commun de l'Entreprise est composé de 15
        positions : L'Entreprise (9 positions) Ses établissements (4 positions) Caractères de contrôle (2 positions) ».
      - The ICE portal's guide (ice.gov.ma, Guide_ICE.pdf, p. 3) says the same, as read by the research pass. The
        portal answered this session with a security check page, so I did not read it myself.
      - Spaces as typed are taken out; the database holds the same rule.
      - **Not checked, because no official text states it:**
        - that the positions are digits. Every official example is, but they say "positions", never "chiffres";
        - the check key. No official source publishes its computation. python-stdnum's mod 97 is not official, and
          OMPIC's own example (123456789000057) fails it.
    - **IF — NO FORMAT RULE, because no official source publishes one.** This is "no rule because no source", not
      "no rule yet": nothing waits to be added. A rule is added only if an official text is found that states one.
      - The DGI's site (tax.gov.ma) answered 503 on every page, including form AAC139, so it was not read.
      - The Simpl-IS EDI specification (finances.gov.ma) defines no length; its own examples are « 123 » and « 789456123 ».
      - Kept as typed, trimmed. 40 characters is a storage bound, not a format.
    - **RC — NO FORMAT RULE for the number, because no official source publishes one (again: no source, not "not
      yet"); kept WITH ITS COURT.**
      - The Code de commerce (the Ministry of Justice's consolidated text) asks for « le numéro et le lieu de son
        immatriculation » (art. 49) and « le siège du tribunal où il est immatriculé » (art. 154). A number is a number
        only at its court, so both are given or neither.
      - Décret 2-96-906 art. 9 numbers the register continuously, even for natural persons and odd for legal ones.
        That text was read in WIPO Lex's copy, not the BO. Décret 2-20-956 (2021, the electronic register) was not read.
        So no rule on the number is assumed.
  - **Found while building it, then changed (0208, the owner, 2026-10-23):** the books' PARTIES checked a party's
    ICE as `^[0-9]{15}$` (0170), stricter than the sources, since "digits" is not stated. The connectors (Excel,
    Odoo, Xero, QuickBooks) and the parties form applied the same digits rule. Two rules for one identifier was its
    own defect. A party's ICE is now checked exactly as the business's: spaces as typed taken out, then fifteen
    positions, none a space. It is one rule in one place (`iceAsTyped`, `isIce`, `iceOrNull` in
    src/core/books/identifiers.ts), and the database holds it (`parties_ice_shape`, the same check as
    `businesses_legal_ice_shape`). In a connector, a registry field (Odoo's `company_registry`, Xero's
    `CompanyNumber`) is an ICE only for a party in Morocco (review item 1 below).
  - **The FEC's four added columns are Nomi's naming** (`ICE`, `Identifiant_Fiscal`, `Num_RC`, `Tribunal_RC`, after the
    eighteen, on every line). The Avis lists the fields « au minimum » (annex, point 3) and names none for the business
    itself. They are in one place (`FEC_IDENTITY_FIELDS`) until the DGI publishes its own. The FEC page names any of
    the three still missing, with a door to the profile.
  - The FEC's FILE NAME stays blocking on the DGI (`MOROCCO_BLOCKERS` now holds only that).
- **E3 · Imported history as a document — the small replacement for D11.** *(built 2026-10-22, 0207.)*
  - **The window is today's, in one place** (`firstOpenDay`, src/core/books/history.ts): the earliest open fiscal
    year's first day, or the day after the lock date where the lock reaches into it. D10's open periods, when built,
    narrow it there, and nothing else changes.
  - **An entry is history when it is NEW to Nomi and dated before the window.** An entry Nomi already holds, or read
    in before, is never history: a change to it is checked as always, and refused where its period is closed. An entry
    after the window with no year to hold it is still refused. History entries are set apart before anything is
    checked or written, and are not remembered as read (`connector_records`).
  - **The workbook:** the entries inside the window go in as drafts, as always. The FILE is kept in A4's store as a
    document marked "history, not in the books" (`documents.history_entries`, `history_through`; no new table). It is
    kept until the end of the year of its newest entry plus the law's years, and it is sealed, in the workspace's
    residency, read by the same roles, held and erased with the papers (closure, then `tools/books-retention.mjs`) and
    listed in the papers copy (`history_through` in its index). The owner lands on it after the read.
    - The database keeps it out of the books: never an entry's paper (`documents_history_shape`), never read into a
      draft (`document_readings_not_history`, NB030). The same file kept twice is one document.
    - A read refused for another problem keeps nothing. Without a store for papers, the workbook refuses as before.
  - **Odoo, Xero, QuickBooks:** no file, and none needed. What they hold from before these books stays there and is
    not copied; the read goes on, and says how many it left (`books.flash.readLeftThere`). Each one's block on the
    books' page says so (`books.systems.history`). **Found while building it:** before E3, a first read of a shop
    with ANY entry before Nomi's open years was refused whole (Odoo reads every move on its first read), so these
    connections could not start for a shop with history.
  - **Claude's calls, for the owner:**
    - Google Sheets keeps refusing such entries. It is Nomi's own spreadsheet, written back to, and an entry left
      unread there would block every write-back as "your edits".
    - A bank statement is not history: it brings lines, not entries. Every line is read in for matching, whatever its
      date, since it can match a posted entry of a closed year.
    - Retention runs from the newest entry's year, the law's date for those entries' papers.
- **The owner's review of block E (2026-10-23): approved, with these changes and records.** *(built 2026-10-23, 0208.)*
  1. **A party's ICE is fifteen positions, like the business's** (E2 above). OMPIC says « 15 positions », not 15
     digits, and one identifier keeps one rule. **And only a party in Morocco has one** (the owner's question on #382:
     was it gated on the party's country? It was not, under 0170's digits rule either). A connected system's
     registry field (Odoo `company_registry`, Xero `CompanyNumber`, QuickBooks' mark) is read as an ICE only when the
     party's country is MA (`partyIce`). Anyone else's registry number stays in that system and is not copied:
     the books have no field for another country's registry number. The workbook, Sheets and the parties form refuse
     an ICE on a party not in Morocco (`ice_not_morocco`). The database holds it (`parties_ice_morocco`, NOT VALID: it
     binds every row written from now on, and a row an earlier rule let in cannot stop a deploy).
  2. **Google Sheets: the refusal stays, and now says how many and why.** Odoo, Xero and QuickBooks say how many
     entries they left. Sheets said nothing of the kind, so an owner's old rows would seem not to arrive. In Sheets,
     the entries the others would leave where they are now get their own reason, `before_books` ("Dated before these
     books begin: not copied into them"), instead of "no fiscal year" or "closed period". The refused page leads with
     the count, the day the books begin, the same reason the others give, why Sheets cannot leave them unread (Nomi
     writes the spreadsheet back), and what to do: take those rows out and read again. A workbook read without a
     papers store refuses the same way, and says so.
  3. **A bank statement is not history.** Agreed, for the reason given: a statement line can still match a posted
     entry of a closed year.
  4. **Retention from the newest entry: approved, and said on Your data.** A file running from 2019 to 2024 keeps its
     2019 rows until the 2024 rows' date: longer than their own duty requires. A file cannot be split, and keeping it
     longer is the safe direction. Nomi promises not to keep things longer than it must, so the papers section of
     Your data (`/app/settings/data`, beside "Close this workspace") says it in plain words wherever a file is kept as
     history (`data.papers.history`). The public pages' description of the books, still a launch blocker
     (LAUNCH-CHECKLIST.md), must say the same when it is written.
  5. **The E3 finding was the one that mattered.** Before it, the first read from Odoo, Xero or QuickBooks was
     refused whole for any shop with a single entry dated before Nomi's years, which is every real business. Found
     while building E3, not from a customer.
  6. **IF and RC kept as typed: no rule because no source.** Nothing official publishes either format, and the DGI's
     site returned 503 on every page. This is a decision, not a gap (E2 above).
  - **After this: nothing is left to build** (the owner's order). The queue: the accountant's answer and the
    signatures, the spend and a deploy, and the owner's own reading of the Intuit file (INTUIT-QUESTIONNAIRE.md).

### Stage R — acting on the research (the owner, 2026-10-23)

The research behind these four items is the owner's, given in the block's brief. Where this session did not re-read a
source, the claim is marked *reported* (the owner's research), as §0's convention asks.

- **R1 · What a « période » is (D10's open question).** *Recorded, NOT built: the enforcement waits on the owner.*
  - **No Moroccan source defines it** (*reported*, consistent with D10's own reading of 2026-10-22). Avis 24 §2.3 d)
    uses the word and never defines it; "mois", "mensuel" and "trimestr*" appear nowhere in the Avis. Loi 9-88 art. 3
    fixes CENTRALISATION once a month (once a year for art. 1 al. 5's small traders). That is a different thing.
  - **The only text that defines the word is French** (*reported*): BOFiP BOI-BIC-DECLA-30-10-20-40 §140, « On définit
    la période comme un intervalle de temps durant lequel des écritures sont enregistrées de manière chronologique, en
    vue de leur centralisation (mois ou trimestre par exemple), afin d'établir des situations intermédiaires en cours
    d'exercice comptable. » Its "par exemple" leaves the length open on purpose.
  - **The owner's choice:** a per-workspace length, monthly or quarterly, MONTHLY by default. It is the one length that
    lines up with Loi 9-88's monthly centralisation for a Moroccan workspace. It is a default, not a rule the law sets.
  - **The four-period reading (2.3 d, literally):** the Avis limits « périodes COURANTES » to two, « la période en
    cours et la période précédente », and then says the period of the previous year's closing entries and the period
    of the opening entry « sont les seules périodes qui puissent en sus être ouvertes ». So at most FOUR periods are
    open: two current ones in the exercice, the previous year's closing period, and the opening entry's period.
    Counting all four as two would block a legitimate year-end.
  - **What the code does today, checked:** it has NO periods. It holds "at most two open fiscal YEARS" (0169) and a
    lock date the owner moves by hand (D2). That is not a two-period rule, and at a year-end it blocks nothing: the
    year being closed and the new year are two years. So there is nothing over-strict to fix. Building the period rule
    IS building D10: the opening mode, and an entry outside the open periods refused by the database for a Moroccan
    workspace. That rule would refuse entries the integration suite posts today (Moroccan workspaces with entries
    from January to May 2026), and history read in from a workbook, Sheets or Odoo. The brief says to stop on a rule
    that breaks existing tests, so it is held for the owner (PROGRESS.md, "Block R").
  - **The owner's answer (2026-10-23): build D10 — forward-only, ON the lock date.** Three rules: periods are built on
    the lock date and never beside it (closing a period sets the lock; the lock stays the single source of truth);
    each workspace gets a books-start date, before which everything is history and no period rule applies; imports
    are exempt, and visibly so. If building on the one lock date turns out impossible, stop before building two.
  - **Why one lock date is not enough — STOPPED here, as the owner asked (2026-10-24).** The lock is one date for
    the whole workspace: everything on or before it is closed (`books_settings.lock_date`, checked in one place,
    `books_day_writable`, 0189). §2.3 d) lets the previous exercice's closing period stay open beside the current
    exercice's two. One date cannot express that once the current exercice passes its second period. Monthly
    periods, 2026 not yet closed, 2027 begun:
    - in February 2027 the Avis allows January and February 2027 (the two current periods) and December 2026 (the
      closing period) open together;
    - to open March 2027, January 2027 must close: the lock moves to 31 January 2027, and that closes all of 2026,
      December included;
    - so with one date, either December 2026 stays open and 2027 is stuck at January–February until 2026 is closed,
      or December closes before its year is closed. The first is exactly the over-strict year-end the four-period
      reading exists to avoid.
    The three ways out, for the owner:
    - **A (recommended): a lock date for each fiscal year.** Still the only thing that decides what can be written,
      just kept per exercice. Closing a period moves its own year's lock; closing a year sets that year's lock to its
      last day. Two years' locks cover different days, so they cannot disagree. D2's functions are re-made per year.
    - **B: one lock date, plus the previous year's last period as an exception** for closing entries. This is a second
      rule beside the lock, which the owner ruled out.
    - **C: one lock date, strict.** The previous year must be closed before the current year's third period opens.
      It meets the Avis's "two current periods", but blocks the year-end above.
  - **BUILT: option A (the owner, 2026-10-24; 0211).**
    - **A lock per fiscal year** (`fiscal_years.lock_date`); the workspace-wide one is gone. **ONE predicate decides a
      write:** an entry's date after its own year's lock (`books_day_writable`: the year open, the day inside it, after
      its lock). It reads no period, no calendar day and no start, and nothing else grants or denies a write. Its one
      exception is unchanged from D2: inside `books_close_year`, the year's own closing entry.
    - **§2.3 d) is a rule on the SET of locks** (`books_period_floors`). On the workspace's local day, for a Moroccan
      workspace whose books have started, it gives the lowest each open year's lock may be: the exercice in
      progress keeps its current period and the one before; an earlier open year keeps only its last period (the
      closing period); the opening entry's day sits inside the first of those. Three things use it:
      - the worker raises a lock below its floor every hour (`books_roll_periods`, recorded as the periods' doing,
        `period_locks` action `period`);
      - a reopening that would go below one is refused (`books_reopen_year`);
      - a page can ask what is out of line (`books_period_problems`).
      None of them refuses a write.
    - **The two invariants agree.** 0169 keeps at most two years open, and the floors name at most those two years;
      a test walks two years of days to hold it.
    - **The books' start, once** (`books_start`, by the owner, with the period length, month or quarter, MONTHLY by
      default). Its year's lock goes to the day before; a reopening never goes below it. Everything earlier is
      history: E3's window opens at the day after each year's own lock (`firstOpenDay`), so an import's entries
      before it are set apart, kept as the file, never in the books.
    - **Imports are exempt, and visibly so:** history never reaches the books (so never the FEC); an import inside the
      window arrives as drafts the owner posts.
    - **A workspace outside Morocco** keeps the manual lock: no floors, whatever the day.
    - **The named test** (`tests/integration/books-periods.test.ts`, "FEBRUARY 2027"): on 15 February 2027, January and
      February 2027 and December 2026 are open together; on 1 March 2027, January 2027 closes and December 2026 stays
      open. Every day in those tests is named, so they do not depend on the day they run.
    - **Not built:** a journal of its own for the opening entry. The opening entry is any entry dated the start day,
      written before that period closes.
  - **Imports and the FEC (rule c), checked:** the FEC's eighteen fields have none that says "imported" (annex 3:
    the journal, the entry's number and date, the account, the auxiliary account, the document, the label, the
    amounts, the lettrage, the validation date, the currency). None is invented. Nothing needs one: history set apart
    by E3 is not in the books at all, so it never reaches the FEC; an imported entry inside the window is a draft the
    owner posts, an ordinary entry from then on. The document store keeps the source file, so the distinction stays
    in the data (`documents.history_entries`, 0207).
- **R2 · The FEC's file name.** *(built 2026-10-23, 0209.)*
  - **No official Moroccan FEC file name exists.** Checked 2026-10-22 (D4) against the Avis, CGI art. 210 and the DGI's
    2025 report. And *reported*: the Avis 24 annex ends at "Id devise"; its full text has no "nom du fichier",
    "extension", ".txt", ".csv", "séparateur", "encodage" or "ICE"; the DGI's Rapport d'activité 2025 (p. 97) calls
    the e-reception system « achevés » and publishes no specification.
  - **No existing open-source Moroccan FEC export was available to reuse** (verified against its source, 2026-10-24),
    so Nomi builds its own from the Avis. The vendor notes behind this are kept outside the repository (CLAUDE.md §2).
  - **What Nomi does:** a DEFAULT, `{ICE}FEC{YYYYMMDD}.txt` (the business's ICE, "FEC", the fiscal year's last day),
    configurable per workspace by its owner on the FEC page (`books_settings.fec_filename`; letters, digits, dots,
    dashes, underscores, and only the two placeholders, checked by the app and the database).
  - **The words on the page, exactly, so they cannot drift** (`tests/parity/fec-filename.test.ts` holds both; never
    "required", "official" or "DGI-compliant"):

    > Nomi's default filename convention. Your accountant may ask for a different one — you can change it here.

  - **Do not "fix" it to a name read on a blog.** If the DGI publishes a name, it becomes the default here, and stays
    changeable.
  - **ICE: fifteen positions, ALREADY** (0208, Block E's review): not fifteen digits, and only for a party in Morocco.
  - The LAUNCH-CHECKLIST line is struck. The Moroccan section now blocks nothing (`MOROCCO_BLOCKERS` is empty).
- **R3 · A party's company registry number.** *(built 2026-10-23, 0210.)*
  - **What was missing:** the books carried a party's VAT number (`tax_number`, from Odoo's `vat` and Xero's
    `TaxNumber`, printed on invoices), never its company registry number.
  - **Now:** `parties.registry_number`, country-scoped, with `siret` (France, optional) and `registro_mercantil`
    (Spain: Registro / Tomo / Folio / Hoja, free text by nature, RRM art. 3; Spanish invoices carry it beside the NIF,
    Código de Comercio art. 24.1). All three are copied onto an invoice at issue and onto its credit notes, frozen
    with the rest (0187's rule). A party is not a buyer, so a buyer's erasure never reaches them.
  - **HARD, refused (app and database; `src/core/books/registry.ts`):** France, the SIREN, nine digits; SIRET fourteen,
    its first nine the SIREN. UK, the Companies House number: eight digits, or ANY two capitals and six digits (no
    prefix list: Companies House's own forum records FE, OE, PC and SG missing from its URI guide). A shorter numeric
    entry is zero-padded (1234567 → 01234567). Input is normalised first (spaces out, capitals). Any other country:
    kept as typed — no rule because no source.
  - **Spain: all three forms, and never a hard block beyond nine characters** (the owner, 2026-10-23). An entity's NIF
    (a letter, 7 digits, a control), a person's (8 digits and a letter: an autónomo is a paying business customer and
    invoices under it) and a foreign resident's NIE (X/Y/Z, 7 digits, a letter) pass silently. Any other nine
    capitals and digits are KEPT with a warning (`nif_shape`), never refused: a reform against number exhaustion that
    turned the digits alphanumeric would then degrade to a warning, not refuse real customers. Fewer or more than nine
    is refused (app and database).
  - **SOFT, a warning the owner overrides, never a refusal:** the SIREN's Luhn sum (INSEE publishes only "9
    chiffres"; La Poste is a known exception) and an entity NIF's control character (Orden EHA/451/2008 art. 2(c),
    Decreto 2423/1975 art. tercero and RD 1065/2007 art. 22.1(c) say only « un carácter de control »). The form asks
    again with "this looks like a typo"; a tick keeps it. The UK number has no check digit, and none is invented.
  - **ACROSS FIELDS, refused:** a French VAT number present ends with the SIREN; a Spanish one is ES + the NIF. NOTHING
    ties a UK VAT number to the company number. A missing VAT number is never wrong: a French company under the
    threshold, or a Spanish one outside the Registro de Operadores Intracomunitarios, has none.
  - **NOTHING DERIVED:** no VAT key computed from a SIREN, no control character "fixed", no VAT number from a CRN. No
    lookup gates anything; none is called.
  - **The Spanish field is labelled NIF.** CIF was repealed by RD 1065/2007 (in force 2008-01-01); "CIF" appears only
    as a hint.
  - **France: two official pages disagree** (*reported*): service-public F32135 says the SIRET goes on invoices, F31808
    says the SIREN. Nomi stores the SIREN as THE registry identifier (the legal « numéro unique d'identification »),
    takes the SIRET as optional, and prints what the customer gave.
  - **Not yet:** no connector carries the number (the workbook, Sheets, Odoo's `company_registry`, Xero's
    `CompanyNumber`, QuickBooks). Parties have no edit page, so a customer read in from one has none. Said on the
    books' page (`books.notYet.registry`).
- **R4 · Intuit's App Assessment — the code made TRUE before the owner answers.** *(built 2026-10-23; nothing
  submitted.)* Item by item, with files, in docs/INTUIT-QUESTIONNAIRE.md §0.

### Dependencies at a glance

```
A1 exact money (existing path + books) → A2 model (+ Avis 24 criteria) → A3 multi-currency (stored rates)
                                       ├→ A4 documents (residency parameter)
                                       └→ A5 tenancy + three roles → A6 toggle (early: the demonstrable piece)
A2+A5 → B1 plug-in shape → B2 Excel file → B3 Sheets ;  B1 → B4 Odoo (+14, +15)
B2–B4 → B5 read → C1 entries (no-gap numbering) → C2 payments → C3 reconciliation (files) → C4 write back
C1 → D1 trial balance → D2 period close (two open, closing journal) ;  C2+D0 → D1b credit notes → D3
C1 → D3 accountant pack + verified country reports ;  A2+C1+D2 → D4 CGNC chart + Moroccan FEC
A4+C1 → D6 reading documents ;  C1 → D7 custom fields ;  C4 → D8 Xero → D9 QuickBooks
S1–S3, S5–S7 alongside ;  S4 waits on reviewers ;  S8 parked ;  D5 removed until a French customer
```

---

## 4 · What "done and tested" means, item by item

**For every item, before the next one that depends on it starts:**
- the four checks (CLAUDE.md §3) pass, with integration on its own Postgres;
- every new table is in the erasure contract, and the data-protection tests pass;
- every owner-facing line exists in en / zh / ar / es / fr, Arabic follows the no-gender rule, and the zh / ar lines are
  listed for native review;
- a negative control: the item's key rule, switched off, fails its own tests;
- **every new table: what the accountant and staff may read and write, checked AT THE DATABASE**, with a test that
  goes past the route guard (`tests/integration/books-viewer.test.ts` is the model); a route guard alone is never the
  check (the owner, 2026-10-22: DZ in every block);
- merged through `tools/gated-merge.sh`.

**Anything that needs a paid service:** built, tested against the vendor's sandbox, proven live on deploy day (decision 9).

**Stage A — the foundation**

| Item | Done and tested when |
|---|---|
| A1 exact money | No floating point touches a money value anywhere in `src`; a static test forbids it. **The property test (a million random sequences of discount, multiply, split and round) runs on quotes and orders as well as ledger lines, and always ends at the exact cent.** §2.1's three examples are regression tests. Stored amounts are migrated, with a before-and-after sum per table per workspace that matches exactly. Every currency's minor units come from ISO 4217. Golden scenarios: any figure that changes, changes by the corrected cent, each one listed. |
| A2 model | The database refuses an unbalanced entry, a line in a locked period, an edit to a posted entry, and a gap or duplicate in a journal's numbering (tests try each). Corrections are reversing entries, linked to the original. |
| A3 multi-currency | Each foreign line stores the owner's rate and its date. **A report run years later gives the same figures** (a test changes the owner's rates after posting, and history must not move). A missing rate refuses the posting. |
| A4 documents | Encrypted and readable only by its own workspace (an RLS test from another workspace returns nothing). Each document carries its retention date. **The residency parameter routes storage, and a test with two settings proves nothing is hard-coded.** |
| A5 three roles | Per route and action: the owner may see, post and export; the accountant may see and export, and any posting is refused with the reason; staff get nothing. A snapshot test covers every books route, and the D18 privacy lines exist before the boot allows a processor. |
| A6 toggle | One login switches modes. Each mode lights only its own pages. A books address is refused where books are off. Each role sees only what A5 allows. |

**Stage B — the connector layer**

| Item | Done and tested when |
|---|---|
| B1 plug-in shape | B2 and a test fake pass the same conformance suite: config, a mapping round trip, a refused sign-in, "changed since". |
| B2 Excel file | The workbook imports and exports. A broken template is refused, naming the sheet, row and column, and nothing half-imports. Export then re-import changes nothing. |
| B3 Sheets | The same workbook through the API with `drive.file` (non-sensitive, per Google). A revoked grant reads as "connect again", never as empty books. Recorded fake now; live on deploy day. |
| B4 Odoo | JSON-2 against a recorded Odoo 19 fake. **Item 15:** a Free or Standard plan, a wrong key and a wrong database each give their own sentence before anything is saved. **Item 14:** a key 80 days old raises the reminder, and an expired key stops the sync with that reason. |
| B5 reading | The same change read twice is recorded once. The cursor survives a restart. A silent system is said on the page. |

**Stage C — the core books**

| Item | Done and tested when |
|---|---|
| C1 entries | Entries from orders, invoices and payments, and by hand, balance. Each journal's numbers have no gaps and no duplicates, even under concurrent posting. A posted entry can only be reversed. |
| C2 payments | Invoices are open, partly paid or paid by their payments, in any currency (gains and losses on exchange posted). Invoice numbers have no gaps. |
| C3 reconciliation | CSV, OFX and CAMT.053 import, with duplicate lines refused. A match is never applied without a person, and an un-match restores exactly. |
| C4 write back | Posted entries appear in Sheets, Excel and Odoo. A conflict is shown and waits; nothing is overwritten. |

**Stage D — everything on top**

| Item | Done and tested when |
|---|---|
| D0 the answers on C | An issued invoice shows its customer as at issue, whatever the party becomes; the database refuses to change the copy, and a draft holds none. An order becomes one invoice draft for a chosen customer; issued, the receivable carries that customer; the buyer's name is in no books table. |
| D1 trial balance | Debits equal credits for any period. It matches a hand-computed fixture to the cent. |
| D1b credit notes | Numbered without a gap from their own counter. Issuing posts the invoice's mirror at the invoice's rate. What is owed falls by it, and never below what was credited. More than the invoice's remainder is refused by the app and the database. A fully credited invoice reads as credited, not paid. |
| D2 period close | The checklist must be clear before a lock. A locked period refuses postings, with the reason. A third open period is refused. Closing entries go to their own journal. Reopening is the owner's, and recorded. |
| D3 accountant pack and country reports | The pack (trial balance, journal, general ledger) exports in a standard format and re-imports into a fresh workspace with identical balances. A country report exists only with its verification note (the primary sources, line by line), and matches a worked example from that country's official form. |
| D4 Morocco | **The chart:** every account of the CGNC chart, checked against the CGNC text. **The FEC:** for a fixture year, all 18 Avis 24 fields in order, debit and credit separate; every Avis 24 §2 criterion has its own test (gaps, a closed-period edit, a third open period, a missing document reference, an unbalanced entry, an unauthenticated poster, report headers). The file envelope (name, separator, encoding) is configurable and marked "to the DGI's spec when published". |
| D6 reading documents | Receipts in en, fr, ar, zh and es (photo and PDF) become drafts, and nothing posts without the owner. 💰 live. |
| D7 custom fields | They survive export, import and every connector's round trip. |
| D8–D9 Xero, QuickBooks | The conformance suite and C4's round trip pass against each vendor's sandbox. Live within the free tiers on deploy day. |

**Stage S — the salesperson**

| Item | Done and tested when |
|---|---|
| S1 canned replies | Insert, edit and send go through every owner-reply guard. Five languages. |
| S2 labels | They filter and search on Buyers, and are erased with the buyer. |
| S3 round-robin | Assignment rotates fairly among available people (property test). Absent people are skipped. The owner's override wins. |
| S4 strict mode | The code: 500 varied turns in a strict language, and nothing but approved sentences is ever sent alone. **Switched on per language only with a signed sentence set and a named reviewer.** |
| S5 FAQ learning | Suggestions come only from human replies. A dismissed one never returns (a test re-asks it). Nothing becomes an answer without the owner. |
| S6 surveys | Sent only where free. Answers are stored and erasable. |
| S7 web chat, Telegram | The adapter contract, the full send-path guards, pre-pilot scenarios on a simulator, and a D18 line each. Telegram live on deploy day. |

---

## 5 · Excel and Google Sheets as a books source: **A, then B** (the owner's choice)

A spreadsheet can't enforce double entry, locks or immutability. So for every shop, **Nomi's ledger is the record**, and
the spreadsheet is the way in and out. Both options use one fixed Nomi workbook, with named tabs (Accounts, Journal,
Parties, Invoices, Payments) and fixed columns.

- **A · File upload and download (first).**
  - Free, with no account.
  - **It has no external dependency at all, so the plug-in shape is validated on the easy case first,** before it meets
    Odoo's sign-in, plans and expiring keys.
- **B · Google Sheets through the API, with `drive.file` (second).**
  - Google calls this scope "non-sensitive": verification "not mandatory".
  - Free within quota (300 requests a minute per project). Google says exceeding the quota "is planned to incur charges…
    later in 2026" 💰.
- **C · Excel through Microsoft Graph: OUT.**
  - Most small shops have personal Microsoft accounts, and Graph "Support for workbooks stored in OneDrive Consumer
    platform is still not available".
  - Excel users are served by A.
- **D · Export only:** covered by A's export.

---

## 6 · The privacy load (accepted as written, with the owner's note)

**1. The legal duty to keep, and how it meets the erasure rule we already have.**
- **The duty:**
  - France: "documents comptables" and "pièces justificatives… doivent être conservés pendant dix ans" (Code de commerce
    L123-22, via BOFiP).
  - Morocco: CGI art. 211, "pendant dix (10) ans", electronic records "sur support électronique".
  - GDPR art. 17(3)(b): erasure doesn't apply where processing is needed "for compliance with a legal obligation".
- **How it meets erasure (the owner's rule):** **a buyer's deletion request still erases their personal data. Entries
  required for the statutory record are kept to the legal date, then erased.**
  - The erasure contract gains a "keep until the legal date, then erase" action, with the date stored per row.
  - `erase-buyer` and workspace closure refuse to erase inside the legal period, and say which records and why.
  - **Closing a workspace ends with its books in the owner's hands, every time (the owner, 2026-10-21).** A2.1 keeps
    posted books when a workspace is deleted, as the duty requires. So an owner who closes would leave their statutory
    accounts with us for ten years, unable to sign in to reach them, holding a company's legal records hostage by
    accident. Therefore:
    - the export (the accountant pack, the Moroccan FEC where it applies, the workbook) is **MANDATORY and happens
      BEFORE closure completes**. It isn't an option to miss;
    - **if the export fails, closure doesn't finish**;
    - the deletion page says, in plain words, what we keep, for how long, why, and that they already have their copy.
    - **Built in A2.4 (0172, 2026-10-21).** Closing refuses until a downloaded copy covers the last posting (a receipt
      with its SHA-256 is written in the same transaction as the file). Then everything else is erased, and the books
      with their business row are HELD, switched off, until the legal date: 10 years from the end of the last fiscal
      year with a posting, for Morocco (CGI art. 211) and France (L123-22), the later of the readings. After that,
      `tools/books-retention.mjs` erases them. The owner's data page says what is kept, until when, under which law,
      and when they took their copy. Tested: `tests/integration/books-closure.test.ts`.
    - **Not yet, on purpose:**
      - the PUBLIC pages (`/data-deletion`, `/privacy`) say nothing about books until books are switched on (A6),
        because the site states nothing unbuilt. A6 adds those lines;
      - a buyer's deletion request meets no books yet: no party is linked to a buyer until C2 (invoices). The
        per-buyer "kept until the legal date" rule lands with that link; the workspace-level hold is built.
- **The deletion page must say which is which, in plain words, before any of this ships:**
  - what is erased at once;
  - what is kept, until when, and under which law;
  - that copies in the shop's own Sheets, Excel or Odoo are the shop's to delete.

**2. New personal data:** suppliers, people on receipts, people named on bank lines. **Payroll stays out** (§9).

**3. New processors,** each with privacy lines in five languages before it can be switched on (D18):
- Google (Sheets);
- Odoo, Xero and Intuit (the shop's own systems, which Nomi acts in);
- the model that reads documents;
- Telegram.

**4. Moroccan shops' data in the USA:**
- **The law:** loi 09-08, art. 43, allows transfers abroad only to countries with "un niveau de protection suffisant".
  The CNDP's list (délibération 236-2015) doesn't include the USA. Art. 44 then needs consent, a listed necessity, or the
  CNDP's authorisation, and art. 15(e) requires the transfer to be declared.
- **Parked as a lawyer's question.** The seam is open now: residency is a parameter (A4, decision 14).

**5. Backups** are kept 180 days. That's fine for recovery, but they are **not the legal archive.** The books plus the
closing export carry the 10 years, and the pages won't suggest otherwise.

**6. Access:** the three roles (A5). Every view and export of books data goes on the audit trail. That's also an Avis 24
§2 criterion: who did what, when.

**7. Secrets:** connector tokens and Odoo keys use the mailbox tokens' encryption (AES-256-GCM, `key_version`,
`tools/rekey.mjs`). The Odoo key is stored with its expiry.

---

## 7 · What costs money (💰), and what is free

| Item | Free | Costs money |
|---|---|---|
| Excel by file (A) | yes | — |
| Google Sheets (`drive.file`) | yes, within quota | above quota, "later in 2026" (Google) |
| Odoo | Nomi pays nothing | **the shop** needs Odoo's Custom plan (about US$61 a user a month, odoo.com/pricing) |
| Xero | Starter: 5 connections | from AUD 35 a month for 50 (since 2 March 2026, developer.xero.com/pricing) |
| QuickBooks | Builder tier: writes unlimited, 500,000 reads a month | above that, blocked unless on a paid tier (prices *unverified*) |
| Exchange rates | the owner's own (decision 13) | a commercial feed, later, as an option |
| Bank data | statement files | — (bank connections are out, §9) |
| Reading documents (D6) | — | **💰 a model call per document** |
| FAQ learning (S5) | word matching | 💰 with embeddings |
| Document storage (A4) | within the Postgres volume | 💰 beyond it |
| Web chat, Telegram | yes | — |
| Surveys (S6) | inside free windows | 💰 WhatsApp templates outside the window (Meta) |
| Simulated-buyer testing (S8) | — | 💰 model balance — parked |
| Hosting (Railway) | — | 💰 unpaid today; nothing launches without it |

---

## 8 · The owner's answers (2026-10-21)

| # | Question | Answer |
|---|---|---|
| Q1 | Whose books are the record? | **Always Nomi's own.** It makes Nomi a system of record (§1a). |
| Q2 | Which countries' tax reports? | **Prepare only, never file.** Only countries verified against primary sources; the accountant pack for everyone else (D3). |
| Q3 | The Moroccan chart and the FEC | **Verified:** Morocco requires its own FEC (CGI 210; CNC Avis n° 24). The CGNC chart for every shop. The French FEC and DGFiP's checker are removed until a French customer (D4, D5). |
| Q4 | Who may see and post the books | Owner: see, post, export. Accountant: see, export. Staff: nothing (A5). |
| Q5 | Exchange rates | The owner's own, **stored on the transaction, never recomputed** (A3). |
| Q6 | Moroccan data in the USA | A lawyer's question, parked; **residency made a parameter now** (A4). |
| Q7 | Strict mode's reviewers | Unresolved; strict mode is **gated on a person** (S4). |
| Q8 | Paid channels in 100% | **None.** Web chat and Telegram only (S7). |
| Q9 | The bar for paid items | **Yes:** sandbox-tested, live on deploy day. |
| Q10 | Bank statements | **Files only.** Bank connections are out (§9). |

**Still open, and not the owner's to answer:**
- **The DGI's FEC upload specification:** file name, separator, encoding.
- **The date CGI art. 145-I (LF 2026) applies from.**

D4 leaves both as configurable details until they're published.

---

## 9 · Not in Phase 5

- **The concession ladder.** Nomi never negotiates harder than the owner set; the owner sets the price.
- **Payroll.** A different law.
- **Filing anything with a tax authority** on a shop's behalf. That's a regulated act and a liability Nomi isn't taking;
  reports are prepared, never filed.
- **Bank connections.** They cost money, they're regulated, and they'd raise the privacy load from "a shop's books" to "a
  shop's live banking".
- **Paid channels** (LINE, SMS, WeChat, TikTok), until there's revenue.
- **The French FEC and DGFiP's checker,** until a French customer.
- **Moroccan e-invoicing and the liasse fiscale EDI.** They wait for the decree (CGI art. 145-IX) and are usually the
  accountant's job.

---

## 10 · What the books do not do yet (said to owners on the books' page)

Disclosed, not discovered (the owner, 2026-10-22). Each line is also on `/app/books` (`renderBooksNotYet`, the
`books.notYet.*` keys). A line goes from both the day its limit is lifted.

- **A payment is taken only in the invoice's own currency.** A payment in any other currency is refused.
- **A bank statement in CSV is read in one layout only:** a header row naming Date and Amount (or Debit and Credit),
  with Description and Currency where the bank gives them. OFX and CAMT.053 files are read as banks send them.
- **A draft entry, invoice or credit note cannot be edited:** discard it and draft it again.
- **A credit note gives back quantities of an invoice's lines, at their own price.** A price reduction on its own,
  with nothing given back, is not a credit note yet.
- **A company registry number travels in no connector** (since R3, 0210, the field exists: SIREN, NIF, company
  number). It is given when a customer is added in Nomi. The workbook, Sheets, Odoo, Xero and QuickBooks do not carry
  it, and a party read in from one has none.
