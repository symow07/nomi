# Phase 5 — the full map (planning only, a stop-gate)

Written for the owner. First version 2026-10-21 (#373). This version records **the owner's answers of 2026-10-21**:
the build order approved with the four changes, the ten questions answered, and the Moroccan FEC checked against
Morocco's own sources. Nothing here is built. It is the plan; the owner's approval starts the build.

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
      (the owner, 2026-10-22), and it is held twice: by the app's route guard (A5) and by the database, which shows an
      accountant's request no row of a sales table (B0).
13. **Exchange rates:** the owner's own. The rate used is **stored on the transaction and never recomputed.** A report
    that re-rates history is wrong by construction.
14. **Data residency is a parameter,** not a hard-coded assumption. This is the cheap insurance against a later legal
    need for an EU region.
15. **Strict mode depends on a person:** a native reviewer per language. That's a dependency on someone, not a
    technical task, so nobody plans around it.
16. **Bank connections are out** (§9).

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
- **A4 · Document storage, residency-aware:** *(built 2026-10-22, 0174: sealed with AES-256-GCM under the installation's document key —
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
- **A5 · The books' tenancy and the three roles (decision 12):** *(built 2026-10-22, 0175: `people.kind`
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
- **A6 · The salesperson ↔ accountant toggle:** *(built 2026-10-22, 0176: `businesses.books_area`, OFF by default,
  switched by tools/books-area.mjs; off, every /app/books address is not found and nobody is offered the switch or
  an accountant. A page under /app/books is the books' mode and its rail shows only the books; the switch at the
  rail's foot is the owner's alone; an accountant has the books and a way out; staff the sales side. Its books
  side is one page today, the home and the copy — C1 onward fill it.)* Same login, same company. **Early because it's the demonstrable piece,
  not because anything depends on it.** It's the cheapest visible proof that the two-mode idea works, which the thesis
  and any investor conversation need. It builds on `shell()` in `src/api/web/layout.ts` and on the outreach area's
  per-workspace gate. *Needs A5's roles.*

### Stage B — the connector layer

- **B1 · Item 12 — one plug-in shape:** *(built 2026-10-22: `src/core/books/connector.ts` (config, connect / refresh /
  revoke with a closed list of refusal reasons, the mapping both ways, "changed since") over one interchange shape,
  `src/core/books/interchange.ts` (keyed by codes and the source's own entry keys, never Nomi's ids; exact decimals);
  one registry, `src/books/connectors/registry.ts`; the suite `tests/books-connectors/conformance.ts`, passed by the
  workbook and by a test fake that keeps its own history.)*
  - each system provides a config, a mapper to and from A2, its sign-in (exchange, refresh, revoke), and "changed since";
  - all behind one registry;
  - a conformance suite every connector must pass.
  - *Depends on A2 and A5.*
- **B2 · Excel by file (option A):** *(built 2026-10-22, 0178: the versioned Nomi workbook (a "Nomi" sheet, then
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
- **B3 · Google Sheets (option B, `drive.file`).** *Depends on B2* (the same workbook). *(built 2026-10-22, 0179:
  `src/books/connectors/sheets.ts` — OAuth with PKCE asking `drive.file` alone; on connecting, a NEW spreadsheet with
  the books in it; read in through the workbook's own reader and the same read-in; values read UNFORMATTED with
  JSON's own digits, never a float. A revoked grant is `connect_again` and nothing is read; a deleted spreadsheet is
  `source_missing`; Google down is "try later". The grant sealed in `connector_credentials` (rekey covers it),
  `books_connections` keeps the state. Writing an existing spreadsheet again is C4's (conflicts shown). Against a
  recorded fake of Google's documented answers; live on deploy day with SHEETS_CLIENT_ID / _SECRET, which D18 holds
  until the privacy page names Google Sheets.)*
- **B4 · Odoo, JSON-2, our own client:** *(built 2026-10-22: `src/books/connectors/odoo.ts`, a POST of a JSON object to
  `/json/2/<model>/<method>` with "bearer" and the key and `X-Odoo-Database` (Odoo 19 docs), sent only to a public https
  address (`publicPost`: our own DNS lookup refuses private, loopback and link-local answers at connect time). Item 15:
  a wrong key (401 "Invalid apikey", documented), a wrong name, a Free or Standard plan, an address that is not public
  https — each its own sentence, nothing saved. **C0 (2026-10-22):** the wrong name is now a FACT, read from Odoo
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
  2026-10-22, 0180: one read, `src/books/readIn.ts`, for the owner's button and the morning's job (`books.read`, 05:20
  UTC, every connected system of a workspace whose books are shown — `books_connections_due()`). The same change is
  recorded once (`connector_records`); the cursor is the database's (`books_connections.cursor`), read again by a
  fresh process; a read refused for its problems moves no cursor. A connected system no read has reached for two
  days is said on the books' page, with the day it last answered. What the morning reads in is drafts, as Nomi.)*

### Stage C — the core books

- **C1 · Item 3 — journal entries:**
  - by hand, from Nomi's orders and invoices, and from what's read in;
  - **Where the exchange difference goes (the owner's question, 2026-10-22; answered before C1).** Since A3 (0173) an
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
    - **Checked against the order counter (2026-10-22, 0162 and `src/db/orderNumbers.ts`):**
      - its one reclaim path is the rollback of the order's own transaction, which takes the count back with it;
      - the app role holds UPDATE on `order_numbers` and nothing stops the count going DOWN; a repeated number is
        stopped only by the unique index on orders.
      - So the books' counters share nothing with it: not the table, the function or its grants. They get their own
        table, a trigger that refuses any decrease, and no DELETE grant. Posted entries refuse DELETE and any change of
        number (trigger and revoked grant both). The number is taken inside the posting transaction.
      - C1's tests: a decrease refused; a delete refused; a rollback leaves neither a gap nor a repeat; two postings at
        once get consecutive numbers.
  - *Depends on A2–A5 and B5.*
  - *(built 2026-10-22, 0182–0183: the exchange accounts and the marked line (refused anywhere else); twenty
    postings at once in two journals, each 1…n; entries by hand — `/app/books/entries`, drafted, posted by the
    database's rules, discarded (never deleted), reversed (a new entry, lines swapped, linked, its own number; a
    posted entry offers nothing else); entries from Nomi's confirmed orders, once each (`source_order_id`, unique
    while not discarded — two at once make one), onto the owner's chosen sales journal, receivable and sales accounts.
    What is read in (B2–B5) arrives as drafts and posts the same way. Not yet: editing a draft (discard and draft
    again); tax and the buyer as a party on an order's entry — C2's invoices.)*
- **C2 · Item 5 — payment tracking:** invoices with lines, and payments, partial or full, in any currency. *Depends on C1.*
  *(built 2026-10-22, 0184: invoices numbered at issue from their own counter, F-<year>-<n>, inside the issuing
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
- **C4 · Item 13, part 2 — writing back** to Sheets, Excel and Odoo: conflicts shown, never overwritten silently.
  *Depends on C1–C3.*

### Stage D — everything on top

- **D1 · Item 1 — trial balance.** *Depends on C1.*
- **D2 · Item 6 — period close:**
  - a pre-close checklist, then a lock;
  - closing entries in their own journal;
  - **at most two periods open at once** (Avis 24).
  - *Depends on C1–C3 and D1.*
- **D3 · Item 2 — tax reports and the accountant pack:**
  - **The accountant pack, for every shop:** trial balance, journal and general ledger, in a standard export any local
    accountant can work from.
  - **Country tax reports only where verified against primary legal sources.** Nomi never claims a country's compliance
    it hasn't verified.
  - **Prepared, never filed** (§9).
  - Which countries get a verified report is decided as each one is verified. Morocco is first (D4); France only with a
    French customer.
  - *Depends on C1 and A2's tax codes.*
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
    Morocco, in force or announced (checked 2026-10-22, primary sources). So it is not a launch gate.**
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
- **D5 · REMOVED from 100%: the French FEC and DGFiP's checker.** They come back only with a French customer. The Moroccan
  FEC has **no official checker**; D4 is tested against Avis 24 itself (§4).
- **D6 · Item 7 — reading receipts, invoices and bills, in any language:** a draft entry the owner confirms, never posted
  alone. *Depends on A4 and C1.* 💰 (a model reads each document).
- **D7 · Item 9 — custom categories and fields.** *Depends on C1.*
- **D8 · Xero,** then **D9 · QuickBooks**, through B1. *Depends on C4.* 💰 above the free tiers.

### Stage S — the salesperson, alongside A–D wherever it doesn't depend on them

- **S1 · Item 18 — canned replies.**
- **S2 · Item 19 — labels.**
- **S3 · Item 21 — round-robin assignment.**
- **S4 · Item 16 — strict mode per language.** **Gated on a person:** a native reviewer per language, exactly as the
  Arabic disclosure is (decision 15). The code can be ready; it switches on per language only when that language's
  sentence set is signed.
- **S5 · Item 17 — FAQ learning** from the owner's own replies; a dismissed suggestion never returns. Free by word
  matching; 💰 with embeddings.
- **S6 · Item 20 — satisfaction surveys,** only where they're free: inside WhatsApp's 24-hour window, and on channels with
  no per-message cost.
- **S7 · Item 22 — channels:** **web chat, then Telegram. Nothing else in 100%** (decision 8). LINE, SMS, WeChat and
  TikTok wait for revenue.
- **S8 · Item 23 — simulated-buyer testing** — parked with the money.

### Dependencies at a glance

```
A1 exact money (existing path + books) → A2 model (+ Avis 24 criteria) → A3 multi-currency (stored rates)
                                       ├→ A4 documents (residency parameter)
                                       └→ A5 tenancy + three roles → A6 toggle (early: the demonstrable piece)
A2+A5 → B1 plug-in shape → B2 Excel file → B3 Sheets ;  B1 → B4 Odoo (+14, +15)
B2–B4 → B5 read → C1 entries (no-gap numbering) → C2 payments → C3 reconciliation (files) → C4 write back
C1 → D1 trial balance → D2 period close (two open, closing journal)
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
| D1 trial balance | Debits equal credits for any period. It matches a hand-computed fixture to the cent. |
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
  - **Closing a workspace ends with its books in the owner's hands, every time (the owner, 2026-10-22).** A2.1 keeps
    posted books when a workspace is deleted, as the duty requires. So an owner who closes would leave their statutory
    accounts with us for ten years, unable to sign in to reach them, holding a company's legal records hostage by
    accident. Therefore:
    - the export (the accountant pack, the Moroccan FEC where it applies, the workbook) is **MANDATORY and happens
      BEFORE closure completes**. It isn't an option to miss;
    - **if the export fails, closure doesn't finish**;
    - the deletion page says, in plain words, what we keep, for how long, why, and that they already have their copy.
    - **Built in A2.4 (0172, 2026-10-22).** Closing refuses until a downloaded copy covers the last posting (a receipt
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
