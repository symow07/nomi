# Block 4.4 · Setup in minutes: design spec (D2)

This spec covers three pieces:

1. **CSV contacts** into the customer list.
2. **A Shopify access token** for a password-protected store.
3. **Four timed milestones** on Getting started.

It follows `docs/DESIGN-SYSTEM.md`, which is in force.

Copy rules are the same as D1:
- The person is a "customer", never a buyer.
- The assistant is `{name}`, with no pronouns.
- Owner copy never says "AI".
- No promise the code does not keep.
- New text is English only, in an English-only dictionary registered in the redesign fallback.

Key prefixes:
- `contactImport.` for the contacts import;
- `storeToken.` for the token path;
- `setupClock.` for the milestones.

`/app/guide` already redirects to `/app/get-started`, where `renderGuide` is embedded. The milestones go on
that page (§3).

---

## 1 · Customers from a CSV file

### 1.1 What it is, and what it is not

- It brings the business's existing customers into **the customer list**: `clients` rows, with the four
  fields in this table.

  | CSV field | Saved to |
  |---|---|
  | name | `display_name` |
  | phone | `phone` |
  | language | `preferred_language` |
  | notes | `notes` |

- **It sends nothing and starts no conversation.** Nomi still never writes first. A contact gets an answer
  only when they write to the business. The page says so twice: before upload and in the confirmation
  flash.
- It is **not** the outreach area's contacts (`/app/customers/outreach`, off by default, rule 8). Nothing
  here lists anyone for outreach.
- **Owner only.** This is a bulk import of people's details, and the business is answerable for having
  them. Staff see no door to it, and its routes refuse staff with the ordinary not-found page. (A
  designer's call; see §5.1.)

### 1.2 Where it lives

- **The flow's address:** `/app/customers/import`, then `/app/customers/import/:importId` for the kept
  file. This is in the Customers area.
- **Doors to it:**
  - on All customers, beside the search: "Add customers from a file" (`contactImport.door`);
  - on Getting started's "Contacts in" milestone (§3).
- **Layout:** Layout 10 · Step flow. Steps: 1 File → 2 Columns → 3 Check → Add. Progress reads
  "Step 2 of 3". Back and Continue work as on the product import. There is a final review before anything
  is written.

### 1.3 Step 1 · The file

- **Heading** `contactImport.title`, then the intro `contactImport.intro`, which says that adding them
  messages nobody.
- **The four columns the file can have**, shown as a small example, in code type and left to right on every
  page:

  ```
  name,phone,language,notes
  Sara Ali,+212612345678,ar,Prefers WhatsApp
  ```

  Only phone is required.
- **Two ways in:**
  - a file: `.csv`, `.tsv`, `.txt`, or `.xlsx` (the first sheet);
  - a pasted table, with tabs or commas.
  - These reuse `parseTable` and the in-process `.xlsx` reader (EXT).
  - Each way is its own form with its own button `contactImport.read`.
- **What is refused before step 2**, under the field concerned (`role="alert"`, `aria-describedby`):

  | Refused | Key |
  |---|---|
  | Not a table | `contactImport.refused.not_a_table` |
  | Empty | `contactImport.refused.empty` |
  | Over 5 MB | `contactImport.refused.too_large` |
  | Over 5,000 rows | `contactImport.refused.too_many` |
  | Unreadable text | `contactImport.refused.encoding` (save it as "CSV UTF-8") |

- On success the rows are kept as an import (§1.7) and the owner lands on step 2.

### 1.4 Step 2 · Columns

- Four selects, one per field. Each offers the file's columns by their header, or "Column 3" when there is
  no header, plus "— none —".
  - Phone is required. Name, language and notes may be "— none —".
- **Guessing.** Each select is pre-chosen when a header matches. Case, spaces and accents are ignored.

  | Field | Headers that match |
  |---|---|
  | name | name, full name, customer, contact, nom, nombre, 姓名, 名字, الاسم |
  | phone | phone, mobile, whatsapp, tel, telephone, number, téléphone, teléfono, 电话, 手机, الهاتف, رقم |
  | language | language, lang, langue, idioma, 语言, اللغة |
  | notes | notes, note, comment, comments, remarks, 备注, ملاحظات |

  A guess is only a pre-choice; the owner can change any of them.
- **A checkbox** `contactImport.columns.header`, "The first row holds the column names". It is ticked when
  the first row matches any header word above.
- **A preview of the first three rows** as the mapping reads them. It updates only on Continue: no script.
- **Continue** (primary, black) and **Back** (a door to step 1).
- Continue with no phone column → `contactImport.refused.no_phone_column`, and the owner stays on step 2.

### 1.5 Step 3 · Check

Read every row, then say what will happen in one counted sentence (`contactImport.check.summary`): "We read
214 rows: 198 to add, 9 already your customers, 7 that can't be added." The wording has no verb that
must agree with a count, so it reads right for 1.

Below the sentence, three groups, each with an h2 and its count.

**1. To add.** A table: name, phone as it will be saved, language, notes (the first 80 characters, the rest
behind "…").
- Every row is ticked by default. The owner unticks rows to leave out. One "Untick all / Tick all" pair
  heads the group: two buttons, with `formaction` on the same form.
- A row may carry a **note, without being refused**:
  - `contactImport.note.country`: the number had no country code, so the business's own calling code was
    added (shows the code);
  - `contactImport.note.language`: a language that wasn't recognised was left empty (shows what the file
    said).

**2. Already your customers.** Rows whose phone matches a customer already in the list. The match uses the
phone's digits after normalising, against `clients.phone` and the phone identities of existing
conversations.
- Each row shows the file's name and the name on record.
- **Nothing in an existing record is changed:** no name, language or notes overwritten. The group's line
  `contactImport.check.existingWhy` says so.
- They have no ticks.

**3. Can't be added.** Row number, what the row said (as typed, isolated), and why.

| Why | Key |
|---|---|
| No phone | `contactImport.refused.row.no_phone` |
| Not a phone number (letters, too few or too many digits after normalising; 8–15 digits with the country code) | `contactImport.refused.row.bad_phone` |
| Same phone as row {n} earlier in the file (the first one is kept) | `contactImport.refused.row.duplicate_in_file` |
| Name over 120 characters | `contactImport.refused.row.long_name` |
| Notes over 1,000 characters | `contactImport.refused.row.long_notes` |

A row is never cut short to make it fit.

**Phone normalising** (shown, never hidden):
- Spaces, dots, dashes and brackets are dropped. `00` at the start becomes `+`.
- A number without `+` gets the business's country calling code (`callingCodes.ts`). That adds the note
  above.
- A business with no country refuses such a number as `bad_phone`, with the extra line
  `contactImport.refused.row.no_country`.

**Language:**
- Accepted: an ISO code (`en`, `zh`, `ar`, `es`, `fr`, `pt`, …), or a language's English or own name
  ("Arabic", "العربية", "Français").
- Saved as the two-letter code.
- Anything else is left empty, with the note.

**Before the button:** one line, `contactImport.check.deleted`: "Leave out anyone who asked you to delete
their data." An erased customer leaves no trace Nomi could match, so the file would bring them back.

**The final action:** `contactImport.add`, "Add {n} customers". Primary, black; {n} is the ticked count. A
door `contactImport.discard` sits beside it. It goes to a confirm-protected POST that erases the kept file
(`data-confirm`, rule CC-29).

**On Add:**
- One transaction writes the ticked rows only.
- Each row is re-checked against the list at that moment, so a customer who wrote in meanwhile is not added
  twice.
- One audit row `customers_imported` records the counts (no numbers or names in the audit).
- Then the import's kept rows are erased.
- The owner lands on All customers, newest first, with the flash `contactImport.flash.added`: "Added 198
  customers. Nobody was sent a message."

### 1.6 Phone (390)

- The table in groups 1–3 becomes two-line rows:
  - name and phone on the first line;
  - language and notes on the second;
  - the tick at the line's start, as a 44 px target.
- No horizontal scroll.
- "Add {n} customers" stays at the foot of the flow, not fixed over the rows.

### 1.7 The kept file (the backend's shape, stated for the tester)

- The parsed rows are kept, so a visit shows the import as the owner left it.
- They are kept only until Add or Discard, and **at most 7 days**. A daily job erases older ones.
- They hold people's numbers, so:
  - the table is in the erasure contract;
  - `erase-workspace` takes it;
  - the practice copy takes none of it.
- Another workspace's import is "not there" (404). The app role deletes nothing directly; erasure goes
  through a definer function, as elsewhere.

---

## 2 · A password-protected Shopify store: the access token

### 2.1 When it shows

On Add products' "From your store" form (`renderStoreForms`), in two places:

1. **After a refusal.** Reading the address finds Shopify's password page: `/products.json` answers 401 or
   redirects to `/password`. That is a new refusal, `import.store.refused.password_protected`: "This
   Shopify store is password-protected, so its product list is not public. Nomi can read it with an access
   token from your Shopify admin." Under it, the token form (§2.2) opens with the store's address carried
   over.
2. **Upfront.** A closed disclosure under the address field: `storeToken.open`, "Store password-protected?
   Use an access token". It holds the same form, for an owner who knows already.

Owner only, like the rest of the import (`price_rules`).

### 2.2 The form

- **Address field:** `storeToken.shop`, "Your store's address ending in .myshopify.com".
  - `inputmode="url"`, `dir="ltr"`, placeholder `myshop.myshopify.com`.
  - Shopify's Admin API answers only there, not on a custom domain. When the refusal came from a custom
    domain whose page named its `.myshopify.com` host, that host is filled in. Otherwise the field is empty
    with the hint `storeToken.shop.hint`.
- **Token field:** `storeToken.token`, "Admin API access token".
  - `type="password"`, `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`, `dir="ltr"`.
- **How to get one:** `storeToken.how`. "In your Shopify admin, create an app for your store that may read
  products, install it, and copy its Admin API access token." Then a door `storeToken.help` to Shopify's
  own help page on custom apps.
  - **The exact page and the admin's wording must be checked against Shopify's current help before this
    ships.** The designer could not verify them from here.
- **Currency tick:** the same box the address form has (K8's currency rule applies unchanged).
- **Button** `storeToken.read`, "Read the store". Primary, black.
- **One line under the button, always visible:** `storeToken.kept`. "Used once, to read this store's
  products now. Nomi does not keep it. You can delete the app in Shopify when the import is done."

### 2.3 What happens to the token (the promise in `storeToken.kept`, made true)

- It travels only in the POST body. It never appears in an address, a redirect, a log line, an error report
  (`app_errors`), the audit trail, or the kept import row.
- It is sent only to `https://<shop>.myshopify.com`, as Shopify's access-token header. Never to another host,
  and **never re-sent on a redirect**: a redirect is the `unreachable` refusal.
- The public fetcher's rules hold: no private addresses, 10 s, 5 MB.
- After the request it is dropped. **After any refusal the token field comes back empty**; only the shop
  address is kept. The owner pastes it again.
- Products read this way go into the same kept review as a public store (kind `store`), so every K1 rule
  applies: ticks, currency, floors.

### 2.4 Its refusals (shown under the token field)

| What Shopify did | Key | English |
|---|---|---|
| The address is not `*.myshopify.com` | `storeToken.refused.not_myshopify` | That is not a .myshopify.com address. Find it in your Shopify admin, under your store's domains. |
| The field is empty or has spaces inside | `storeToken.refused.empty` | Paste the whole access token, with no spaces. |
| 401 | `storeToken.refused.rejected` | Shopify did not accept this token. Check you copied the whole Admin API access token, then paste it again. |
| 403 | `storeToken.refused.no_scope` | The token works, but it may not read products. Give the app permission to read products, then copy its token again. |
| 404, or no store at that host | `storeToken.refused.no_store` | No Shopify store answers at {host}. Check the .myshopify.com address. |
| 429 | `storeToken.refused.slow_down` | Shopify asked us to slow down. Wait a minute, then read it again. |
| Timeout, a 5xx, or a redirect | `storeToken.refused.unreachable` | Shopify did not answer. Nothing was added. Try again in a minute, or export the products as a file. |
| A list with no named product | the existing `import.store.refused.no_products` | — |

No refusal ever echoes the token, any part of it, or Shopify's raw response.

---

## 3 · Getting started: four milestones and a stopwatch

### 3.1 Place

- **On `/app/get-started`:** after the h1 and intro, before the embedded guide's five steps. It is its own
  section, h2 `setupClock.title`, "Set up in minutes".
- **The five setup steps do not change.** The Setup nav count and `workspaceFacts` keep their five (rule 9).
  These four are a timed view beside them.
- **Layout:** Layout 9 · Status rows. Each milestone states its real condition and its next step.

### 3.2 The stopwatch

- **Shown only for a workspace that signed itself up** (`signed_up_at` is not null). It starts at that
  instant.
- Workspaces the operator made have no sign-up moment. They get the rows with dates (§3.3) and no
  stopwatch.
- It is computed when the page is drawn. **There is no script and no ticking.** The line says what it is.

| State | Line |
|---|---|
| Running (fewer than four done) | `setupClock.running`: "{elapsed} since you signed up". |
| All four done | `setupClock.done`: "All four done in {elapsed}". It stops at the instant the last milestone was reached. |

- **Elapsed format:**
  - under an hour: "{m} min";
  - then "{h} h {m} min";
  - from 48 h: "{d} days {h} h".
  - It goes through `Intl.NumberFormat` units joined by `Intl.ListFormat`, isolated. Never
    `Intl.DurationFormat` (Node 22 lacks it).
- A workspace that did it in days is told the truth in days. Nothing is reset and nothing is hidden.

### 3.3 The four rows, in this order

Each row's time is when it first became true, from the rows that hold it.

| Milestone | Done when (first time) | Next step while not done |
|---|---|---|
| **Products in** (`setupClock.products`) | The first product row was created, **or** "Prices go to me" was set (`prices_to_owner_set` on the audit trail): the same facts as Setup's products step. | Door `setupClock.products.go` → `/app/products/add`. |
| **Contacts in** (`setupClock.contacts`) | The first customer is in the list, whether imported (§1) or someone who wrote in. | Door `setupClock.contacts.go` → `/app/customers/import`. |
| **Channel connected** (`setupClock.channel`) | `first_channel_at()`: the first WhatsApp, Page or mailbox connection, archived or not. | Door `setupClock.channel.go` → Channels in Settings. |
| **First reply** (`setupClock.reply`) | The first message {name} wrote that went out to a customer: Setup's `first_success` rule, a sent row with `origin = 'employee'`. | No door. A line: `setupClock.reply.how`. |

How each row is drawn:
- **Done:** a check icon and the words `setupClock.doneAt`, "Done, {elapsed} after you signed up". With no
  stopwatch, `setupClock.doneOn`, "Done on {date}".
- **Not done:** the words `setupClock.notYet`, "Not yet", then the door.
  - The door is words with its arrow (`deeper`), never a button.
  - The icon is never the only signal: the words always say done or not yet.
- **Order:** rows keep this order whatever order they were done in. A row done before an earlier one shows
  its own time honestly.

### 3.4 Who sees what

- **Owner:** everything, with doors.
- **Staff:** the same rows and stopwatch. Doors to owner-only pages are replaced by `setupClock.ownerDoes`,
  "The owner does this". That covers products, the import and channels. Staff are never shown a form or
  door that refuses them.

---

## 4 · Copy: key → English

### 4.1 `contactImport.`

| Key | English |
|---|---|
| `contactImport.door` | Add customers from a file |
| `contactImport.title` | Add customers from a file |
| `contactImport.intro` | Bring in the customers you already have, from a spreadsheet. Adding them sends nobody a message: {name} answers them when they write to you. |
| `contactImport.example` | Your file can have these columns. Only phone is needed. |
| `contactImport.file` | Choose a file (CSV or Excel) |
| `contactImport.paste` | Or paste the rows |
| `contactImport.read` | Read it |
| `contactImport.step` | Step {n} of 3 |
| `contactImport.columns.title` | Which column is which? |
| `contactImport.columns.name` | Name |
| `contactImport.columns.phone` | Phone (needed) |
| `contactImport.columns.language` | Language |
| `contactImport.columns.notes` | Notes |
| `contactImport.columns.none` | — none — |
| `contactImport.columns.numbered` | Column {n} |
| `contactImport.columns.header` | The first row holds the column names |
| `contactImport.columns.preview` | The first rows, as they will be read |
| `contactImport.continue` | Continue |
| `contactImport.back` | Back |
| `contactImport.check.title` | Check before adding |
| `contactImport.check.summary` | We read {rows} rows: {add} to add, {existing} already your customers, {refused} that can't be added. |
| `contactImport.check.toAdd` | To add |
| `contactImport.check.existing` | Already your customers |
| `contactImport.check.existingWhy` | Matched by phone number. Their records stay as they are; nothing in them is changed. |
| `contactImport.check.refused` | Can't be added |
| `contactImport.check.row` | Row {n} |
| `contactImport.check.onRecord` | On record as {name} |
| `contactImport.check.tickAll` | Tick all |
| `contactImport.check.untickAll` | Untick all |
| `contactImport.check.deleted` | Leave out anyone who asked you to delete their data. |
| `contactImport.note.country` | No country code: {code} was added from your business's country. |
| `contactImport.note.language` | Language "{value}" not recognised, so it was left empty. |
| `contactImport.add.one` | Add {n} customer |
| `contactImport.add.other` | Add {n} customers |
| `contactImport.discard` | Discard this file |
| `contactImport.discard.confirm` | Discard this file? Its rows are deleted and nobody is added. |
| `contactImport.flash.added.one` | Added {n} customer. Nobody was sent a message. |
| `contactImport.flash.added.other` | Added {n} customers. Nobody was sent a message. |
| `contactImport.flash.none` | No row was ticked, so nobody was added. |
| `contactImport.flash.discarded` | File discarded. Nobody was added. |
| `contactImport.refused.not_a_table` | That is not a table. Save the spreadsheet as CSV, or paste the rows. |
| `contactImport.refused.empty` | The file has no rows. |
| `contactImport.refused.too_large` | The file is over 5 MB. Split it into smaller files. |
| `contactImport.refused.too_many` | The file has more than 5,000 rows. Split it into smaller files. |
| `contactImport.refused.encoding` | The text in this file can't be read. Save it as "CSV UTF-8" and try again. |
| `contactImport.refused.no_phone_column` | Choose the column that holds phone numbers. |
| `contactImport.refused.row.no_phone` | No phone number. |
| `contactImport.refused.row.bad_phone` | Not a phone number we can read. |
| `contactImport.refused.row.no_country` | Add the country code, or set your business's country in Settings. |
| `contactImport.refused.row.duplicate_in_file` | Same phone number as row {n}, which is kept. |
| `contactImport.refused.row.long_name` | The name is longer than 120 characters. |
| `contactImport.refused.row.long_notes` | The notes are longer than 1,000 characters. |

### 4.2 `storeToken.` (plus one key in the existing `import.store.refused.` set)

| Key | English |
|---|---|
| `import.store.refused.password_protected` | This Shopify store is password-protected, so its product list is not public. Nomi can read it with an access token from your Shopify admin. |
| `storeToken.open` | Store password-protected? Use an access token |
| `storeToken.shop` | Your store's address ending in .myshopify.com |
| `storeToken.shop.hint` | Your Shopify admin shows it under your store's domains. |
| `storeToken.token` | Admin API access token |
| `storeToken.how` | In your Shopify admin, create an app for your store that may read products, install it, and copy its Admin API access token. |
| `storeToken.help` | Shopify's help on making the app |
| `storeToken.read` | Read the store |
| `storeToken.kept` | Used once, to read this store's products now. Nomi does not keep it. You can delete the app in Shopify when the import is done. |
| `storeToken.refused.*` | As in the table in §2.4. |

### 4.3 `setupClock.`

| Key | English |
|---|---|
| `setupClock.title` | Set up in minutes |
| `setupClock.running` | {elapsed} since you signed up |
| `setupClock.done` | All four done in {elapsed} |
| `setupClock.products` | Products in |
| `setupClock.products.go` | Add products |
| `setupClock.contacts` | Contacts in |
| `setupClock.contacts.go` | Add customers from a file |
| `setupClock.channel` | Channel connected |
| `setupClock.channel.go` | Connect a channel |
| `setupClock.reply` | First reply |
| `setupClock.reply.how` | Done when {name}'s first reply reaches a customer. |
| `setupClock.doneAt` | Done, {elapsed} after you signed up |
| `setupClock.doneOn` | Done on {date} |
| `setupClock.notYet` | Not yet |
| `setupClock.ownerDoes` | The owner does this |

---

## 5 · Decisions taken here, and open questions

1. **Owner-only contacts import.** This is the designer's call: a bulk import of people's details is the
   business's responsibility. If staff should import too, the routes and the door open to them. Nothing
   else in this spec changes.
2. **Existing customers are never overwritten**, and there is no "fill in what's missing" option. Adding one
   later is a separate, small design.
3. **The Shopify help door and wording** (§2.2) must be checked against Shopify's current help page before
   shipping.
4. **The stopwatch is static.** It shows the elapsed time when the page is drawn. A ticking clock would need
   the app's one script and adds nothing to the proof (the owner times the acceptance run).

---

## 6 · Acceptance criteria (a tester, in a real browser)

Check at **1440 × 900** and **390 × 844**, in **en** and **ar**, as owner and staff.

### 6.1 Contacts import

**The fixture CSV** (header row, 12 data rows):
- 4 good rows, one of them with a local number with no `+`;
- 1 row whose phone matches an existing customer;
- 1 repeating an earlier row's phone;
- 1 with letters in the phone;
- 1 with no phone;
- 1 with "Klingon" as its language;
- 1 with 1,200 characters of notes;
- 1 with a 130-character name;
- 1 good row in Arabic script.

**The checks:**
1. All customers shows the door to the owner. Staff see no door, and `/app/customers/import` is not found
   for staff.
2. Step 1 refuses a `.png`, an empty file and a 6 MB file, each with its words under the field. Focus goes to
   the field, which carries `aria-invalid`.
3. Step 2 pre-chooses all four columns from the headers. Continue with phone set to "— none —" is refused on
   step 2.
4. Step 3's summary reads "We read 12 rows: 6 to add, 1 already your customers, 5 that can't be added".
   Each refused row shows its own reason and the row number.
5. The local number shows the added country code with its note. "Klingon" is added with language empty and
   its note. Nothing is cut short: the long notes and the long name are refused.
6. The existing customer's record is unchanged after Add: name, language and notes compared before and
   after.
7. Untick one row, then Add → exactly 5 new customers, and the flash "Added 5 customers. Nobody was sent a
   message.". No row is added to `outbound_messages`, `drafts` or conversations.
8. Discard asks first, then erases the kept rows. The import's address is then not found.
9. **ar:** the page is right to left; phone numbers, row numbers and counts are isolated; the example block
   and the phones read left to right; the Arabic-script name displays in its own direction.
10. **390:** two-line rows; ticks are at least 44 px; no horizontal scroll.
11. **Buttons do things, doors go places:**
    - Read it, Continue, Tick all / Untick all and Add are `<button>`s in forms.
    - Back and the door from All customers are `<a>`.
    - Discard is a confirm-protected form button.
12. **Keyboard:** file → Read it; each select in field order; the header checkbox → Continue → Back; on step
    3: Tick/Untick all → each row's tick, in table order → Add → Discard. Focus is always visible.

### 6.2 Shopify token

Use a fake Shopify that answers by token.

13. A password-protected store's address gives the new refusal, and the token form opens below it with the
    address carried over.
14. The token field is `type="password"`. After any refusal it comes back empty, and the page source holds
    no part of the token.
15. A good token → the same kept review as a public store. In the database, the log output and
    `app_errors`, the token string appears nowhere. Search the fixture token's last 8 characters.
16. Each refusal in §2.4 shows its own words: 401, 403, 404, 429, a timeout, a redirect, and a non-myshopify
    address. A redirect never repeats the token header: the fake records the headers it received.
17. Staff never see the form (owner-only, as the import already is).

### 6.3 Milestones and stopwatch

18. On a workspace that signed itself up 20 min ago, with products and a channel at known fixture times, the
    page shows:
    - "20 min since you signed up";
    - Products in: "Done, 4 min after you signed up";
    - Channel connected: "Done, 12 min after…";
    - Contacts in and First reply: "Not yet", with their door and line.
19. When all four are done, the line reads "All four done in {elapsed}", equal to the last milestone's
    time.
20. An operator-made workspace shows no stopwatch, and done rows read "Done on {date}".
21. The five setup steps and the Setup nav count are unchanged by the four milestones.
22. Staff see "The owner does this" instead of the three owner-only doors.
23. **ar:** the elapsed times and dates are isolated, and each row's icon is not its only signal.
24. **Keyboard:** the milestone doors come in row order, before the guide's own steps.
