# Block 4.4 · Setup in minutes: design spec (D2)

This spec covers three pieces:

1. **CSV contacts** into the customer list.
2. **A Shopify access token, or a Dev Dashboard app's Client ID and secret**, for a password-protected store.
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
- `storeToken.` for the password-protected store path;
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
  | language | `stated_language` (never `preferred_language`: the send path reads that one; t1r's ruling, 2026-11-08) |
  | notes | `notes` |

- **It sends nothing and starts no conversation.** Nomi still never writes first. A contact gets an answer
  only when they write to the business. The page says so twice: before upload and in the confirmation
  flash.
- It is **not** the outreach area's contacts (`/app/customers/outreach`, off by default, rule 8). Nothing
  here lists anyone for outreach.
- **Owner only.** This is a bulk import of people's details, and the business is answerable for having
  them. Staff see no door to it. Its routes answer staff as every owner-only route does (the app's
  `ownerOnly`): back to All customers with the flash `staff.notAllowed` (§5.1).

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

  Only phone is required. Under the example, `contactImport.phoneHint`: numbers must be international,
  starting with `+` or `00`; the country is never guessed (§1.5).
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
- A row with no name shows `contactImport.check.unnamed`. Each tick's accessible name is
  `contactImport.check.select` ("Add row {n}"). An empty group shows `contactImport.check.empty`.
- Rows carry no notes: anything the import would have had to guess refuses the row instead (below).

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
| Not international: it does not start with `+` or `00` | `contactImport.refused.row.not_international` |
| Not a phone number (letters, too few or too many digits after normalising; 8–15 digits with the country code) | `contactImport.refused.row.bad_phone` |
| A language that is not recognised | `contactImport.refused.row.language_not_recognised` |
| The number matches more than one customer already in the list | `contactImport.refused.row.ambiguous_existing` |
| Same phone as row {n} earlier in the file (the first one is kept) | `contactImport.refused.row.duplicate_in_file` |
| Name over 120 characters | `contactImport.refused.row.long_name` |
| Notes over 1,000 characters | `contactImport.refused.row.long_notes` |

A row is never cut short to make it fit.

**Phone normalising** (the import's frozen contract, C0):
- The number must start with `+` or `00` (after any leading spaces or an opening bracket). Anything else
  is refused `not_international`. **No country code is ever added**, whatever the business's country.
- Spaces, dots, dashes and brackets are dropped. `00` at the start becomes `+`. The digits are saved as a
  WhatsApp message arrives from them (`normalizePhone`).

**Language:**
- Accepted: an ISO code (`en`, `zh`, `ar`, `es`, `fr`, `pt`, …), or a language's English or own name
  ("Arabic", "العربية", "Français").
- Saved as the two-letter code, in `stated_language` (§1.1).
- An empty language is fine. Anything else refuses the row `language_not_recognised`; nothing is left
  empty in its place.

**Before the button:** one line, `contactImport.check.deleted`: "Leave out anyone who asked you to delete
their data." An erased customer leaves no trace Nomi could match, so the file would bring them back.

**The final action:** `contactImport.add`, "Add the ticked customers". Primary, black. It carries no
figure: with no script, a figure could not follow a box unticked by hand. `contactImport.discard` sits
beside it, a form button with `data-confirm` (rule CC-29) that erases the kept file; the owner lands on
step 1 with `contactImport.flash.discarded`.

**On Add:**
- One transaction writes the ticked rows only.
- Each row is re-checked against the list at that moment, so a customer who wrote in meanwhile is not added
  twice.
- One audit row `customers_imported` records the counts (no numbers or names in the audit).
- Then the import's kept rows are erased.
- The answer is the **Import complete** page (`contactImport.done.title`), not a redirect: its counts are
  the only record of what the file did. It says:
  - `contactImport.flash.added`: "Added 198 customers. Nobody was sent a message.";
  - `contactImport.done.counts`: "{existing} already your customers; {skipped} left out; {refused} could
    not be added.";
  - `contactImport.done.matched`, only when some rows matched a customer who wrote in while the owner was
    checking;
  - a door `contactImport.customers` to All customers.
- Nothing ticked: the owner stays on step 3 with `contactImport.flash.none`.

### 1.6 Phone (390)

- The table in groups 1–3 becomes two-line rows:
  - name and phone on the first line;
  - language and notes on the second;
  - the tick at the line's start, as a 44 px target.
- No horizontal scroll.
- "Add the ticked customers" stays at the foot of the flow, not fixed over the rows.

### 1.7 The kept file (the backend's shape, stated for the tester)

- The parsed rows are kept, so a visit shows the import as the owner left it.
- They are kept only until Add or Discard, and **at most 7 days**. A daily job erases older ones.
- They hold people's numbers, so:
  - the table is in the erasure contract;
  - `erase-workspace` takes it;
  - the practice copy takes none of it.
- An import that is no longer kept (added, discarded, past seven days) and another workspace's import get
  the same answer on every route: step 1 with `contactImport.flash.gone`, "This file is no longer kept".
  It tells nothing about another workspace. The app role deletes nothing directly; erasure goes through a
  definer function, as elsewhere.

---

## 2 · A password-protected Shopify store: a token, or a Client ID and secret

Sources, read 2026-11-07. These are the only two Shopify pages this flow links to:

- [Client secrets](https://shopify.dev/docs/apps/build/authentication-authorization/client-secrets)
  (the "client-secrets" page): where an app's Client ID and Client secret are found.
- [Client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
  (the "client-credentials" page): the exchange for an access token.

Background, from the supervisor's reading of shopify.dev (2026-11-07):
- Since 2026-01-01 a store can no longer create new legacy custom apps in its admin. Apps made before keep
  working.
- New apps are made in the Dev Dashboard. They give a Client ID and Client secret.

**The owner-facing copy states no date and names no Shopify screen** beyond what the two pages say.

### 2.1 When it shows

On Add products' "From your store" form (`renderStoreForms`), in two places:

1. **After a refusal.** Reading the address finds Shopify's password page: `/products.json` answers 401 or
   redirects to `/password`. That is a new refusal, `import.store.refused.password_protected`, shown **once**,
   under the store address. Below it, the form in §2.2 opens with the store's address carried over, and
   does not repeat the sentence.
2. **Upfront.** A closed disclosure under the address field, `storeToken.open`. It holds the same form, for
   an owner who already knows the store is protected.

Owner only, like the rest of the import (`price_rules`).

### 2.2 The form: one store address, then EITHER way in

This is one form with one button. The two ways in are two `<fieldset>`s, each with a `<legend>`, and a plain
"or" between them (`storeToken.or`, not a control).

**The store address**, shared by both ways:
- Label `storeToken.shop`; `inputmode="url"`, `dir="ltr"`, placeholder `myshop.myshopify.com`.
- Both ways talk only to `https://{shop}.myshopify.com`, never a custom domain (the client-credentials page's
  URL).
- When the refusal came from a custom domain whose page named its `.myshopify.com` host, that host is filled
  in. Otherwise the field is empty with the hint `storeToken.shop.hint`.

**Fieldset A · An app you already have** (legend `storeToken.legacy.legend`):
- `storeToken.token`: the label Admin API access token, with no quotation marks in it.
- No explanatory line yet. `storeToken.legacy.how` waits for the owner's confirmation (§2.5) and is not
  shown until then.

**Fieldset B · An app from the Dev Dashboard** (legend `storeToken.dev.legend`):
- `storeToken.clientId`: "Client ID".
- `storeToken.clientSecret`: "Client secret".
- The steps, as an ordered list: **three**, `storeToken.dev.step1`, `step2` and `step4`, worded from the two
  pages. `step3` waits for the owner's confirmation (§2.5) and is not shown until then.
- A door `storeToken.dev.helpSecrets` to the client-secrets page, and a door `storeToken.dev.helpGrant` to
  the client-credentials page. Each opens in a new tab with `rel="noopener noreferrer"`.

**Every secret field** (token, Client ID, Client secret):
- `type="password"`, `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`, `dir="ltr"`.
- The client-secrets page says: "Treat it like a password". The Client ID gets the same treatment, so no
  credential is ever drawn in clear.

**The rest of the form:**
- **Currency tick:** the same box the address form has. K8's currency rule applies unchanged.
- **Button** `storeToken.read`, "Read the store". **Secondary** (outline), like the page's other alternative
  forms ("Read my store", "Read the photos"). One main button per page is the app's rule, and the surface
  walk tests it; on Add products the main button is the paste form's.
- **Every refusal except the address's** ("choose one", "spaces" and every Shopify answer) goes directly
  under the button, before the kept line.
- **One line under the button, always visible:** `storeToken.kept`.

**Which way is used:**
- The token alone filled → way A.
- Client ID and Client secret both filled, and no token → way B.
- Anything else is refused before Shopify is asked:
  - nothing filled;
  - both ways filled;
  - only one of ID / secret.
  - The key is `storeToken.refused.choose_one`.

### 2.3 What happens to what the owner pastes (the promise in `storeToken.kept`, made true)

**Way A:**
- The token is sent once, as the `X-Shopify-Access-Token` header, to the shop's Admin API to read its
  products.

**Way B:**
- One exchange, exactly as the client-credentials page gives it:
  - `POST https://{shop}.myshopify.com/admin/oauth/access_token`;
  - form-encoded `grant_type=client_credentials`, `client_id`, `client_secret`;
  - **no `scope` parameter** (the page: Shopify ignores it).
- The answer's `access_token` is then sent as `X-Shopify-Access-Token` to read the products.
- The answer's `scope` is checked first. Without `read_products` (or `write_products`, which grants it),
  the flow stops with `no_scope` and reads nothing.
- The token lasts 24 hours (`expires_in` 86399). Nomi uses it for this one import and drops it. It is never
  cached for later.

**Both ways:**
- What was pasted travels only in the POST body. Neither the pasted values nor the exchanged token ever
  appear in an address, a redirect, a log line, an error report (`app_errors`), the audit trail, or the
  kept import row.
- Requests go only to `https://{shop}.myshopify.com`. **A redirect is never followed with a credential**: it
  is the `unreachable` refusal.
- The public fetcher's rules hold: no private addresses, 10 s, 5 MB.
- **After any refusal, every credential field comes back empty.** Only the shop address is kept, except an
  address that was refused (`not_myshopify`): that comes back empty too, since a pasted address can carry
  a credential. The owner pastes again.
- Products read either way go into the same kept review as a public store (kind `store`), so every K1 rule
  applies: ticks, currency, floors.

### 2.4 Its refusals

Each refusal is `role="alert"`. The address's goes under the address, which carries `aria-invalid` and
`aria-describedby`. **Every other refusal goes directly under Read the store**, above the kept line: "choose
one" and "spaces" (the three credential fields then carry `aria-invalid` and `aria-describedby` pointing to
it), and every Shopify answer (t1r's ruling D).

| What happened | Key | English |
|---|---|---|
| The address is not `*.myshopify.com` | `storeToken.refused.not_myshopify` | That is not a .myshopify.com address. Type your store's address ending in .myshopify.com. |
| Nothing filled, both ways filled, or only one of ID / secret | `storeToken.refused.choose_one` | Fill in one way: the “Admin API access token”, or both the Client ID and the Client secret. |
| A field has spaces inside | `storeToken.refused.spaces` | Paste it again without spaces. |
| Way B: `shop_not_permitted` (the client-credentials page: "Client credentials cannot be performed on this shop") | `storeToken.refused.shop_not_permitted` | Shopify won't let this app read this store. The app must belong to the same Shopify organization as the store, and be installed on it. |
| Way B: `application_cannot_be_found` (the app is not in the store's organization, or not installed; on t1r's list, not on the two pages) | `storeToken.refused.app_not_found` | Shopify can't find this app for this store. Check the Client ID, that the app belongs to the store's organization, and that it is installed on the store. |
| Way B: the exchange answers 401 | `storeToken.refused.client_rejected` | Shopify did not accept this Client ID and Client secret. Copy both again from the app's Settings in the Dev Dashboard. |
| Way A: 401 on reading | `storeToken.refused.rejected` | Shopify did not accept this “Admin API access token”. Check you copied all of it, then paste it again. |
| 403, or way B's `scope` lacks `read_products` | `storeToken.refused.no_scope` | The app works, but it may not read products. Give it permission to read products, then try again. |
| 404, or no store at that host | `storeToken.refused.no_store` | No Shopify store answers at {host}. Check the .myshopify.com address. |
| 429 | `storeToken.refused.slow_down` | Shopify asked us to slow down. Wait a minute, then read it again. |
| Timeout, a 5xx, or a redirect | `storeToken.refused.unreachable` | Shopify did not answer. Nothing was added. Try again in a minute, or export the products as a file. |
| The store's currency differs from the workspace's (K8's rule) | `storeToken.refused.currency_mismatch` | The store currency is different from your workspace currency. Nothing was added. |
| A list with no named product | the existing `import.store.refused.no_products` | — |

No refusal ever echoes a credential, any part of one, or Shopify's raw response.

### 2.5 Steps shown to the owner: for the owner to check against Shopify

Owner-facing steps worded from the two pages. **The owner checks each against Shopify's current pages before
this ships.** A step either page does not support is marked; it stays out of the copy until the owner
confirms it.

| Key | Owner-facing sentence | Source |
|---|---|---|
| `storeToken.dev.step1` | In Shopify's Dev Dashboard, open Apps and choose your app. | client-secrets: "Click Apps and select your app" |
| `storeToken.dev.step2` | Make sure the app is installed on this store, and belongs to the same Shopify organization as the store. | client-credentials: the grant "only works when the app and the store belong to the same Shopify organization"; "You've installed your app on your store" |
| `storeToken.dev.step3` | Make sure the store lets the app read products. | client-credentials: the token "carries all scopes the store granted to the installation". **Where the owner grants `read_products` is on neither page: owner to confirm the wording.** |
| `storeToken.dev.step4` | Open Settings, and copy the Client ID and Client secret under “Credentials”. | client-secrets: "Click Settings. View or copy your client ID and secret under Credentials" |
| `storeToken.legacy.how` | If your store already has a custom app made in its Shopify admin, paste that app's Admin API access token. New apps are made in the Dev Dashboard instead. | **Neither page says where an existing custom app's token is shown.** This sentence names no screen; owner to confirm. |

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
| **Contacts in** (`setupClock.contacts`) | The earliest of: the first file of customers added or matched (§1), and the first customer who wrote in, leaving out conversations the owner marked as testing. | Door `setupClock.contacts.go` → `/app/customers/import`. |
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
| `contactImport.phoneHint` | Use international phone numbers starting with + or 00. We never guess a country code. |
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
| `contactImport.check.unnamed` | No name supplied |
| `contactImport.check.select` | Add row {n} |
| `contactImport.check.empty` | No rows in this group. |
| `contactImport.add` | Add the ticked customers |
| `contactImport.discard` | Discard this file |
| `contactImport.discard.confirm` | Discard this file? Its rows are deleted and nobody is added. |
| `contactImport.flash.added.one` | Added {n} customer. Nobody was sent a message. |
| `contactImport.flash.added.other` | Added {n} customers. Nobody was sent a message. |
| `contactImport.flash.none` | No row was ticked, so nobody was added. |
| `contactImport.flash.discarded` | File discarded. Nobody was added. |
| `contactImport.flash.gone` | This file is no longer kept. Choose it again to check its rows. |
| `contactImport.done.title` | Import complete |
| `contactImport.done.counts` | {existing} already your customers; {skipped} left out; {refused} could not be added. |
| `contactImport.done.matched` | {n} matched while you were checking. Their records were left unchanged. |
| `contactImport.customers` | All customers |
| `contactImport.refused.not_a_table` | That is not a table. Save the spreadsheet as CSV, or paste the rows. |
| `contactImport.refused.empty` | The file has no rows. |
| `contactImport.refused.too_large` | The file is over 5 MB. Split it into smaller files. |
| `contactImport.refused.too_many` | The file has more than 5,000 rows. Split it into smaller files. |
| `contactImport.refused.encoding` | The text in this file can't be read. Save it as "CSV UTF-8" and try again. |
| `contactImport.refused.no_phone_column` | Choose the column that holds phone numbers. |
| `contactImport.refused.row.no_phone` | No phone number. |
| `contactImport.refused.row.not_international` | Use an international number starting with + or 00, including its country code. The country is never guessed. |
| `contactImport.refused.row.bad_phone` | Not a phone number we can read. |
| `contactImport.refused.row.language_not_recognised` | This language is not recognised. Use a recognised language name or two-letter code, or leave it empty. |
| `contactImport.refused.row.ambiguous_existing` | This number matches more than one customer. Check their records before adding it. |
| `contactImport.refused.row.duplicate_in_file` | Same phone number as row {n}, which is kept. |
| `contactImport.refused.row.long_name` | The name is longer than 120 characters. |
| `contactImport.refused.row.long_notes` | The notes are longer than 1,000 characters. |

### 4.2 `storeToken.` (plus one key in the existing `import.store.refused.` set)

| Key | English |
|---|---|
| `import.store.refused.password_protected` | This Shopify store is password-protected, so its product list is not public. Nomi can read it with an app you allow on the store. |
| `storeToken.open` | Store password-protected? Read it through a Shopify app |
| `storeToken.shop` | Your store's address ending in .myshopify.com |
| `storeToken.shop.hint` | Shopify gives every store one, ending in .myshopify.com. |
| `storeToken.or` | or |
| `storeToken.legacy.legend` | An app you already have |
| `storeToken.token` | Admin API access token (the field's label: no quotation marks) |
| `storeToken.legacy.how` | As in §2.5. Not shown until the owner confirms it. |
| `storeToken.dev.legend` | An app from the Dev Dashboard |
| `storeToken.clientId` | Client ID |
| `storeToken.clientSecret` | Client secret |
| `storeToken.dev.step1`, `step2`, `step4` | As in §2.5. `step3` is not shown until the owner confirms it. |
| `storeToken.dev.helpSecrets` | Shopify: where to find the Client ID and secret |
| `storeToken.dev.helpGrant` | Shopify: how an app on your own store is let in |
| `storeToken.read` | Read the store |
| `storeToken.kept` | Used once, to read this store's products now. Nomi keeps none of it and writes none of it down. You can remove the app's access in Shopify when the import is done. |
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

## 5 · Decisions (the supervisor, t1r, 2026-11-07) and what remains open

1. **The contacts import is owner-only.** Decided. Staff see no door. The routes answer staff with the app's
   owner-only norm: All customers and `staff.notAllowed` (amended 2026-11-08; it said not-found).
2. **Existing customers are never overwritten**, and there is no "fill in what's missing" option. Adding one
   later is a separate, small design.
3. **Shopify:** two ways in (§2), and only the two pages read on 2026-11-07 are linked.
   - **Still open, and the owner's:** check the sentences in §2.5 against Shopify's current pages before
     shipping. Two of them say something neither page supports:
     - where `read_products` is granted;
     - where an existing custom app's token is shown.
4. **The stopwatch is static.** Decided. It shows the elapsed time when the page is drawn, with no script.

---

## 6 · Acceptance criteria (a tester, in a real browser)

Check at **1440 × 900** and **390 × 844**, in **en** and **ar**, as owner and staff.

### 6.1 Contacts import

**The fixture CSV** (header row, 12 data rows):
- 4 rows otherwise good, one of them with a local number with no `+` (refused: `not_international`);
- 1 row whose phone matches an existing customer;
- 1 repeating an earlier row's phone;
- 1 with letters in the phone;
- 1 with no phone;
- 1 with "Klingon" as its language;
- 1 with 1,200 characters of notes;
- 1 with a 130-character name;
- 1 good row in Arabic script.

**The checks:**
1. All customers shows the door to the owner. Staff see no door. Staff opening `/app/customers/import`
   (or any import address, or posting to one) land on All customers with the flash `staff.notAllowed`.
2. Step 1 refuses a `.png`, an empty file and a 6 MB file, each with its words under the field. Focus goes to
   the field, which carries `aria-invalid`. The same holds for the paste box, and for the phone select after
   step 2's `no_phone_column`.
3. Step 2 pre-chooses all four columns from the headers. Continue with phone set to "— none —" is refused on
   step 2.
4. Step 3's summary reads "We read 12 rows: 4 to add, 1 already your customers, 7 that can't be added".
   Each refused row shows its own reason and the row number. Each group's count is ink, not magenta.
5. The local number is refused with `not_international`'s words, and no country code is added. "Klingon" is
   refused with `language_not_recognised`'s words. No row carries a note. Nothing is cut short: the long
   notes and the long name are refused.
6. The existing customer's record is unchanged after Add: name, language and notes compared before and
   after.
7. The button reads "Add the ticked customers", with no figure. Untick one row, then press it → exactly
   3 new customers, and the **Import complete** page: "Added 3 customers. Nobody was sent a message.", then
   "1 already your customers; 1 left out; 7 could not be added.", and a door to All customers. No row is
   added to `outbound_messages`, `drafts` or conversations.
8. Discard asks first, then erases the kept rows and lands on step 1 with "File discarded. Nobody was
   added.". The import's address then goes to step 1 with "This file is no longer kept…", and so does
   another workspace's import address.
9. **ar:** the page is right to left; phone numbers, row numbers and counts are isolated; the example block
   and the phones read left to right; the Arabic-script name displays in its own direction.
10. **390:** two-line rows; ticks are at least 44 px; no horizontal scroll.
11. **Buttons do things, doors go places:**
    - Read it, Continue, Tick all / Untick all and Add are `<button>`s in forms.
    - Back and the door from All customers are `<a>`.
    - Discard is a confirm-protected form button.
12. **Keyboard:** file → Read it; each select in field order; the header checkbox → Continue → Back; on step
    3: Tick/Untick all → each row's tick, in table order (a long note's "…" is a stop in its row) → Add →
    Back → Discard. Focus is always visible.

### 6.2 Shopify: token, or Client ID and secret

Use a fake Shopify at `{shop}.myshopify.com` that records every request: path, headers and body. It answers:
- products by token;
- the exchange by Client ID and secret;
- `shop_not_permitted` and `application_cannot_be_found` on chosen IDs;
- a token whose `scope` lacks `read_products`;
- 401, 403, 404, 429, a timeout and a redirect.

13. A password-protected store's address gives the new refusal, **once**, under the store address (a single
    `role="alert"` on the page). The form opens below it with the address carried over and no second copy of
    the sentence. The upfront disclosure opens the same form.
14. The form shows the shared address, then fieldset A (the token, with no explanatory line) and fieldset B
    (Client ID, Client secret, **three** steps, the two doors), with "or" between. Step 3 and the legacy line
    are not on the page (§2.5). The token's label reads Admin API access token, with no quotation marks.
    Read the store is a secondary button; the page's one main button is the paste form's.
    - Each fieldset has a legend.
    - Every credential field is `type="password"`.
    - The two doors are the only external links. They go to exactly the client-secrets and client-credentials
      pages, in a new tab, with `rel="noopener noreferrer"`.
15. **Way A, a good token:** one products request with `X-Shopify-Access-Token`, then the same kept review as
    a public store.
16. **Way B, a good ID and secret:**
    - exactly one `POST /admin/oauth/access_token` with form-encoded `grant_type=client_credentials`,
      `client_id`, `client_secret` and **no `scope`**;
    - then products read with the exchanged token;
    - then the kept review.
    - A second import asks for the credentials again: nothing was kept.
17. **Nothing kept:** search the database, the log output and `app_errors` for the fixture token, the Client
    secret, the exchanged token and the Client ID (the last 8 characters of each). Each appears nowhere.
18. **Choose one:**
    - nothing filled, both ways filled, an ID without a secret, or a secret without an ID → `choose_one`;
    - the fake receives no request.
19. **Each refusal in §2.4 shows its own words:**
    - `shop_not_permitted`, `application_cannot_be_found`;
    - the exchange's 401; way A's 401;
    - 403; a scope without `read_products`, which reads no products;
    - 404, 429, a timeout, a redirect;
    - a non-myshopify address;
    - a store in another currency (`currency_mismatch`).
    - Every refusal except the address's ("choose one", "spaces" and every Shopify answer) sits directly
      under Read the store, above the kept line.
    - `choose_one` and `rejected` name the field as “Admin API access token”, in quotation marks.
20. **After every refusal:**
    - all three credential fields are empty;
    - the shop address is kept, except an address that was refused (`not_myshopify`), which is empty;
    - the page source holds no part of any credential.
21. **A redirect never repeats a credential:** the fake's record shows no `X-Shopify-Access-Token` and no
    `client_secret` sent to the redirect's target.
22. **Keyboard order:** shop address → token → Client ID → Client secret → the two doors (in the steps) →
    currency tick → Read the store. Focus is visible. At 390 the two fieldsets stack in one column.
23. Staff never see the form (owner-only, as the import already is).

### 6.3 Milestones and stopwatch

24. On a workspace that signed itself up 20 min ago, with products and a channel at known fixture times, the
    page shows:
    - "20 min since you signed up";
    - Products in: "Done, 4 min after you signed up";
    - Channel connected: "Done, 12 min after…";
    - Contacts in and First reply: "Not yet", with their door and line.
    - With no file but a customer who wrote in at 15 min, Contacts in reads "Done, 15 min after…". A
      conversation marked as testing does not count.
25. When all four are done, the line reads "All four done in {elapsed}", equal to the last milestone's
    time.
26. An operator-made workspace shows no stopwatch, and done rows read "Done on {date}".
27. The five setup steps and the Setup nav count are unchanged by the four milestones.
28. Staff see "The owner does this" instead of the three owner-only doors.
29. **ar:** the elapsed times and dates are isolated, and each row's icon is not its only signal.
30. **Keyboard:** the milestone doors come in row order, before the guide's own steps.

---

## 7 · Amendments after the static review of 4.4 (t1r's rulings, 2026-11-08)

The spec now follows the code at `946c25de` where t1r ruled for the code, and states the fixes the code
takes where t1r ruled for the spec.

1. **Staff** get the app's owner-only answer (All customers, `staff.notAllowed`), not not-found (§1.1, §5.1,
   check 1).
2. **Phones and languages follow C0 as frozen:** no country code is added. `not_international` and
   `language_not_recognised` refuse the row, and `ambiguous_existing` joins them. `note.country`,
   `note.language` and `refused.row.no_country` are gone (§1.5, checks 4–5). The fixture reads 4 to add,
   1 already, 7 can't.
3. **Add** answers with the Import complete page, its counts and a door to All customers (§1.5, check 7).
   The button reads **"Add the ticked customers"**, with no figure (B).
4. **A file no longer kept, or another workspace's,** goes to step 1 with "This file is no longer kept"
   (§1.7, check 8).
5. **Shopify:**
   - three steps and no legacy line until the owner confirms them (§2.2, check 14);
   - the password-protected sentence shown once (§2.1, check 13);
   - a Shopify answer directly under the button (D);
   - a refused address is not kept (§2.3, check 20);
   - `write_products` grants the read, and `currency_mismatch` is a refusal (§2.3, §2.4).
6. **The file's language goes to `stated_language`** (§1.1, F).
7. **Contacts in** is the earliest of the file stamp and the first customer who wrote in, testing
   conversations left out (§3.3, check 24).
8. **Group counts are ink** (C, check 4); refusals put focus on their field (2, check 2).

### Further rulings (t1r, 2026-11-08, the cleanup round)

9. **"Choose one" and "spaces" go under Read the store**, like every Shopify answer (ruling D); only the
   address's refusal stays under its field (§2.2, §2.4, check 19).
10. **Read the store is secondary.** One main button per page is the app's rule, and the surface walk tests it
    (§2.2, check 14).
11. **Copy:** the field's label is Admin API access token, with no quotation marks. `choose_one` and
    `rejected` name the field as “Admin API access token”, in quotation marks. Step 4 keeps under
    “Credentials” (§2.4, §2.5, §4.2, checks 14 and 19). The polisher writes the catalogue; the tester checks
    the label without quotes, the quoted field name in both refusals, and step 4's quotes.

