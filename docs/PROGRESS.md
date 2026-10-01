# Progress — the roadmap run (started 2026-09-29)

**Read this first in every new session.** It is how the work resumes without
asking the owner anything. Update it after every merged PR: what shipped, the
PR number, the schema version, what is next, and anything deferred and why.

The instruction this run follows (the owner, 2026-09-29): work the whole
roadmap end to end; merge own PRs on green CI; do not come back at milestones;
come back once, when it is done, or on a decision the plan, the repo and the
instruction cannot answer. The two plan documents are the one-month build order
(artifact `CvtJ8w4TsXWT8HnzrdXTGn`, section "The one-month build order") and
the design direction (artifact `G24Rxqbhb8yWDzhKNAHNfh`). Where the
instruction differs from them, the instruction wins; its settled points are
under "Decided" below.

## Where things stand

| When | PR | What | Schema |
|---|---|---|---|
| 2026-10-01 | #184 | **MAIL · KS5 — a dedicated sender under daily caps; the installation's spend ceiling** (0112, 0113), the plan's phase 7b. **MAIL** sign-in codes, reset links and owner alerts leave by a dedicated HTTPS sender (`MAIL_PROVIDER` resend or postmark, `MAIL_API_KEY`, `MAIL_FROM`; all or none) — the operator's mailbox keeps operator mail only; unset, everything stays on the installation's own sender, capped all the same. Daily caps: codes 10 per address and 1,000 for the installation, alerts 60 and 3,000; addresses kept only hashed, for a week. **KS5** past 20M tokens or 20k model calls a UTC day, workspaces that signed themselves up wait for their owners until midnight UTC; the pilots never wait; the operator hears once a day and moves the ceiling with `tools/spend-ceiling.mjs`. Found on the way: 0005's default privileges gave the app role every new table — 0112 and 0113 take it back (and `_migrations` is still the app's to write, recorded); G1's digest test depended on the database's other sign-ups (test-only). Pre-pilot 12/12 before and after; CI integration green on both passes. Merged 17:18 UTC as `4a09793`, deployed, `/health` ok, schema 113 (backup `nomi-backup-20261001T030418Z`). Inert until the owner pastes a mail sender's key (the never-run list) | 113 |
| 2026-10-01 | #183 | **CK · VAR — what a product may be said to be, and its options** (0110, 0111). **CK** the claims a product category allows (`product_attribute` in `claims_policy`, `businesses.product_category`): ten attribute claims (organic, vegan, handmade, waterproof…) are refused unless the owner ticked them on How you sell, in six languages with a Unicode word boundary; workspaces the operator made and never categorised keep answering as before. **VAR** `products.options` (sizes, colours, shades — no price or stock of their own), typed on the product page or filled by the store import, given to the writer whole; the prompt answers an option only from the list; a question about stock is a hand-off before any model (`stock_asked`, six languages). Live: `check-options.mjs` 12/12, `check-price-first.mjs` unchanged. Found by CI: the deletion-request test hard-coded Shanghai's zone and failed every day from 16:00 UTC (Found on the way). Pre-pilot 12/12 before and after; CI integration 1110 of 1110, twice, none skipped. Merged 16:30 UTC as `4a842dd`, deployed, `/health` ok, schema 111 (backup `nomi-backup-20261001T030418Z`) | 111 |
| 2026-10-01 | #182 | **The language packs: es and fr completed, pt added — every gate still false.** Portuguese: the disclosure (unread), "wants a person" frames, an opener, identity (with Brazil's dropped subject), deletion requests and promises, claims, injection, floor words, numerals — corpora both ways. The fixed sentences in es/fr/pt (no adjective agrees with the customer; pt thanks as the team). Live check (deepseek-flash): es/fr/pt as intended but «Appelez-moi Marie», an over-hand-off kept (Found on the way). Found by CI's second pass: G1's sign-up test counted an operator error alert delivered while it ran — test-only fix. Pre-pilot 12/12 before and after; integration 1101/1101. Merged 15:52 UTC, deployed, `/health` ok, schema 109 (no migration) | 109 |
| 2026-10-01 | #181 | **Earning auto — R1 · R2 · R3 · LG · R5** (0106–0109), the onboarding plan's phase 6. **R1** the evidence counted right (an unchanged edit is as written; only a final guard trip counts; only the system's own demotion resets the window; one verdict once; every query names the business). **R2** the ramp: rung 1 (talks) and rung 2 (sells) stamped in the transaction of the decision that earns them, "14 of the last 20" on the level page, a "this is me testing" marker; the gate and both grant routes rung-aware. **R3** the first quote of each product waits for the owner; any price change unvets it by trigger. **LG** the gate reads the customer's language by fixed rules — a script decides, Latin needs the analysis and the word list to agree, Arabizi/Hinglish/Taglish/Malay/pinyin are undetermined and always draft, never an English fallback; before any model a hand-off is in the language of the pattern that caught it; the first five replies per language wait (self-serve); the fixed sentences in en/zh/ar. **R5** spot checks reach work sent alone (an `auto_sent` record, a daily sweep); a wrong price found by one takes the price rung; every self-demotion is told once (e-mail, Today); the level chosen beside what is in force. All bind only workspaces that signed themselves up, except LG's language reading (every workspace, Westlake included). Found on the way: `earned_rung()` read an earned stamp with no writer (before 0103) as not earned — fixed before it shipped (none in production). Pre-pilot 12/12 before and after; integration 1101/1101. Merged 15:08 UTC, deployed, `/health` ok, schema 109 (backup `nomi-backup-20261001T030418Z`) | 109 |
| 2026-10-01 | #180 | **G9 · G10 · G8 — the funnel, a draft the owner may not read, opening the first cohort** (0104, 0105). G9: each workspace's steps read from what is on record — signed up, a list imported and confirmed, Practice, a channel connected, the first real reply — (`funnel_workspaces()`, `signup_forms_since()`), shown by `tools/workspaces.mjs --funnel` and in the daily digest's cohort line; nothing is tracked that is not already a row. G10 (decision 38): a draft in a language the owner may not read says so, lists its figures in Western digits, and offers a translation into the owner's own language — for checking, never sent (`drafts.translation`). G8: the site's first-group section (invitation only, replies wait for the owner — "free" left out, rule 12, see Deferred), `docs/LAUNCH-ACCEPTANCE.md`, `docs/GO-LIVE.md`, `tools/acceptance-check.mjs` (the acceptance test is on the never-run list). **Found by CI:** the integration job never built `dist/`, which the operator tools the G8/G9 tests run import ("Cannot find module dist/db/client.js"); `tools/run-integration.mjs` now builds before the suite — locally a stale `dist/` would have let them pass against old code. Merged 14:15 UTC, deployed, `/health` ok, schema 105 (backup `nomi-backup-20261001T030418Z`) | 105 |
| 2026-10-01 | #179 | **G7 — the operator's controls** (0103): `tools/suspend-workspace.mjs` (KS2/KS3: the workspace's own silence, its Page marked refused — never archived, which would fall back to the installation's Page — switched off, unsubscribed; `--restore` undoes exactly that), `tools/ops-flags.mjs` (KS4: silence, force drafts as six rows, practice off, and the new `connections_off` that every step of connecting refuses), `tools/workspaces.mjs` (the list; the ramp lifted for a pilot, by name); the daily list names every switch still on. Archiving instead of marking makes a send leave through the installation's Page, and the test fails. Merged 13:37 UTC, deployed, `/health` ok, schema 103 | 103 |
| 2026-10-01 | #178 | **G6 — Ready for customers; the installation's facts are the operator's**: `/app/ready` (the Practice checklist for the business's kind, counted, and three facts: the name confirmed, a channel connected, sending alone earned or not); Getting ready, for a self-serve workspace, shows "Ready for customers" where "Backup tested", "Secrets rotated" and the old fixed-scenario check stood, and readiness asks the checklist instead; the machine room is the installation's own workspace's only (404 and no door for anyone else). Merged 13:20 UTC, deployed, `/health` ok (no migration) | 102 |
| 2026-10-01 | #177 | **G4 — sending alone is earned in a workspace that signed itself up** (0102; decision 8 as recommended — it reverses T1 only for self-serve workspaces): `sending_alone_earned()` (yes for every workspace the operator made; for one made by sign-up, once `auto_earned_at` is written by the ramp or the operator; a practice copy mirrors its workspace); `commitTurn` drafts and records `autonomy_withheld: not_earned`, the card says so; both grant routes refuse above "waits"; the level page says replies wait for now. Pre-pilot 12/12 before and after. Merged 13:02 UTC, deployed, `/health` ok, schema 102 | 102 |
| 2026-10-01 | #176 | **G3 — the day's allowance, held to before the model** (0101): a third reason in `assistantHold`, asked last — the budget says pause and today's use (UTC) has reached it — then Stop's path: recorded, held (`allowance_used`), the customer handed to a person in silence, no model asked; hand-back, approve/edit and an order refused. One reader (`allowanceOf` over `allowance_today()`, from the workspace that pays) for the hold, the send gate, Today and My business. Usage always visible on My business; e-mails at the soft-warn line and at 100%, once each a day; 20 photos of a list a day. Pre-pilot 12/12 before and after. Merged 12:44 UTC, deployed, `/health` ok, schema 101 | 101 |
| 2026-10-01 | #175 | **G2 — a workspace is born with what the cohort needs** (0100): `provision_workspace` redefined (0056 untouched) writes the zone and currency sign-up chose in the insert that makes the business (an unknown zone is UTC; a currency outside the list makes nothing), the seven capabilities in draft, and a budget row with a hard cap — 1,000,000 tokens and 1,000 model calls a day, `pause` (production's ledger: ~1,000 tokens and 1.2 calls a turn, p95 2,100); workspaces made before have none. Found on the way: the boot test borrowed the newest migration by subtracting 100, which at schema 100 left it at version 0 — now negated and checked. Merged 12:26 UTC, deployed, `/health` ok, schema 100 | 100 |
| 2026-10-01 | #174 | **G1 — a stranger signs up** (0099): the terms agreed in so many words (a box and a link; refused by name without it) and recorded with their version (`terms_version`, a digest of the English terms lines; `terms_accepted_at`, `signed_up_at`; `auto_earned_at` added for G4); an acceptable-use section in the terms (a draft until LEGAL); open sign-up needs the installation's sender, so every open sign-up goes through the e-mail code; `/verify` asks the mode again; `SIGNUP_CAP` counted in the database under a lock, before a code is sent and again at `/verify` (the race tested); the operator e-mailed for each sign-up (name, kind, country, what it sells, website) and a daily list at 07:15 UTC; TikTok and WeChat shown as "not yet". Each guard switched off fails its test. Merged 11:54 UTC, deployed, `/health` ok, schema 99 | 99 |
| 2026-10-01 | #173 | **CH4 — "Nomi and Meta" on Channels**: one operator variable, `META_APP_REVIEW` (`approved:YYYY-MM-DD`, a real date; anything else reads "reviewing"), said the same to every workspace — before approval only people added on Meta's side reach a connected account, after it anyone; beside it the two channels' rules in plain words (24 hours to reply through Nomi, then in the app, recorded as the owner's since CH3; Nomi never writes first; photos, shared posts, story mentions and voice clips go to the owner). Nothing is hidden or held back by it: the plan's "Connect hidden until approval" and its "it's open" e-mail are not built, by the owner's instruction to build every Meta path as if approved (the variable is on the never-run-against-Meta list). The alert-number card also opens "Alerts on your phone". Merged 11:28 UTC, deployed, `/health` ok (no migration) | 98 |
| 2026-10-01 | #172 | **G5b — alerts on the owner's phone, expired drafts, the channel named** (0098): web push on `node:crypto` (RFC 8291 encryption — the RFC's vector byte for byte; RFC 8292 VAPID), "Alerts on your phone" for anyone signed in, `/sw.js` (the second script), the app installable; every customer alert also reaches each live phone, a gone one archived. Waiting replies past the channel's 24 h are marked `expired` every ten minutes and shown for what they were; the window refusal names the conversation's own channel. **Phone alerts stay off until the operator pastes `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`** (`node tools/vapid-keys.mjs` on your own machine). Pre-pilot 12/12 before and after. Merged 11:09 UTC, deployed, `/health` ok, schema 98 | 98 |
| 2026-10-01 | #171 | **CH3 — a reply the owner types in Meta's own apps** (0097): Meta's echoes are their own event, read 30 s later on their own queue; ours (Nomi's Meta app id, or an id our send recorded) change nothing; the owner's go on the transcript as theirs, waiting drafts become `superseded`, a queued reply is cancelled, the conversation passes to the owner. Pages subscribe to `message_echoes`; `tools/meta-resubscribe.mjs` for Pages connected before (both on the never-run-against-Meta list). Pre-pilot 12/12 before and after. Merged 10:38 UTC, deployed, `/health` ok, schema 97 | 97 |
| 2026-10-01 | #170 | **G5 — alerts by e-mail**: a reply waiting for the owner (new `draft_waiting`, no alert existed), hand-offs and hot leads go by e-mail to the owner's sign-in address as well as WhatsApp where a number is set; each names the assistant and links to the conversation (`conversationUrl` moved to core so both share it); a waiting reply at most once an hour per conversation. CH4's "Connect hidden until approval" and its "it's open" e-mail not built: Meta paths are built as if approved, so Connect is never hidden. Pre-pilot 12/12 before and after. Merged 10:19 UTC, deployed, `/health` ok (no migration) | 96 |
| 2026-10-01 | #169 | **HS — How you sell** (0096 `selling_answers`): plain questions, one a page, in the owner's language — with a catalogue: price, minimum, returns/refunds/warranty, delivery, payment, certifications, hours and closures, words; with none (services, agency, prices to the owner): what is offered and for whom, the area, how long a job takes, payment, the next step, hours, words. Nothing is written that the owner did not tick: an answer is a draft until its confirm page lists every line it would write, each its own tick; each line goes to the table that already holds the fact. The answer a customer gets word for word is its own line with its figures and promises named. RT's page became the hub. Doors on My business, Setup, after an import. Merged 10:01 UTC, deployed, `/health` ok, schema 96 (backup `nomi-backup-20261001T030418Z`, schema 95, drill passed) | 96 |
| 2026-10-01 | #168 | **RT, part two — what a shop promises, the lead-time writer, a shop's pages**: six promises (refund, returns, warranty, free replacement, free shipping, an express courier), each refused by the claims guard until the owner allows it, in every language its patterns read (returns had no pattern at all); "Days until it is ready to send" on the product page (1–365, audited; only the demo wrote one before); a shop's pages state a single price as the price, a minimum only where set, no band for a single price on the customer's page (bulk keeps 0081's line). End to end in production's composition, a negative control on the returns pattern. Pre-pilot 12/12 before and after. Merged 00:56 UTC, deployed, `/health` ok (no migration) | 95 |
| 2026-10-01 | #167 | **RT, part one — a shop gives the price first** (0095, `businesses.quantity_first`; NULL follows the kind): three profiles (bulk = manufacturer, trading, wholesale and a workspace with no kind — Westlake's behaviour unchanged; services = agency, services; retail = everyone else). Price first (retail and services): the product known and no quantity, the turn quotes at the smallest quantity sold (`startingQuantity`) and tells the writer and the analyser; a quantity the customer never named is never refused to them. A brand on "sells" sends its price alone; at "talks" it waits (the test that holds "retail reaches sells"). A new product's unit is `item` for retail, `pcs` otherwise; no import has written a default minimum since 0081, so nothing else was needed there. The owner's own answer on How you sell (owner-only, audited). Samples and the proforma were in the first draft and taken out before 0095 ran anywhere but locally (the plan: "no incoterm item"). Live check before/after (deepseek-flash): all four shops (en/zh/ar/es) asked "how many?" before, all four priced after, the factory control none; `check-person-model` unchanged. Pre-pilot 12/12 before and after. Merged 00:39 UTC, deployed, `/health` ok, schema 95 | 95 |
| 2026-10-01 | #166 | **K8 — store import**: a shop's address (https, a public name; the fetcher's own lookup refuses private, loopback and link-local answers at connect time; 3 redirects re-checked; 10 s; 5 MB) read as Shopify's `/products.json` or WooCommerce's Store API; or a file or pasted table through a columns page (presets for Shopify, WooCommerce, Etsy; a compare-at column never offered as the price). Each price of a product is a row, variants sharing a price stay one, options become the product's knowledge; a stated other currency adds nothing, none stated needs the owner's tick; every row through K1's review. Merged 00:01 UTC (no migration) | 94 |
| 2026-09-30 | #165 | **K6 — ask about three of these**: after a list is added, the products list offers "Ask {name} about three of these"; Practice opens with up to three questions about that import's products (a price question for a priced one, "do you have …" otherwise), each a door that fills the box, the first already in it; only this business's confirmed import asks. Merged 23:41 UTC (no migration) | 94 |
| 2026-09-30 | #164 | **K5 — prices go to the owner**: the owner's choice on the add page (owner-only, audited; completes Setup's products step; copied to Practice); layer 1 — a price question (the analysis's `price_request`) is handed to her (`price_to_owner`) with the ordinary sentence, no writer, and no quote ever worked out; layer 2 — any reply that states a price (`statesAPrice`: a currency mark beside a figure, a price word) is thrown away and the turn is the same hand-off. Corpus both ways; each layer switched off fails its own tests. Pre-pilot 12/12 before and after. Merged 23:18 UTC, deployed (no migration) | 94 |
| 2026-09-30 | #163 | **K1 · K2 · K3 · K7 — the kept import review** (0094; the onboarding plan's Stage 2): a paste or up to 10 photos (after "printed or handwritten?" — handwritten refused before any photo is read) becomes an import kept between visits; every line a row, refused ones counted ("We read N lines. Count yours."); each row's currency, unit (shops and brands `item`, the rest `pcs`) and minimum shown and editable, names customers use, remove a row; flags (two prices, from/tax/old price, a bare dollar outside dollar countries, outliers, decimals, figures in a name); ticks per photo price and per flagged paste row; K7 three challenge rows on a photo with the read price, line and transcript hidden until typed — a mismatch reopens the neighbours and makes every row need its tick; K2 the discount question → each new product's floor (rounded up), a tick each, through `savePriceRulesTx`; K3 each product keeps its line, import and photo (audited). One reading path (`readPhotos`), one writer (`writeImportRows`); the old stateless review is gone. Not done: K1's timed owner runs (need the owner's real lists, T8/LISTS). Merged 22:56 UTC, deployed, `/health` ok, schema 94 (backup `nomi-backup-20260930T030201Z`) | 94 |
| 2026-09-30 | #162 | **The schema guard; the currency work re-verified**: `tools/run-integration.mjs` reads every constraint in `public` and `shadow` before and after the suite and fails the run naming each line a test changed and did not put back (the #153 defect, made loud; negative control: the pre-fix test fails the run and names the vanished check). #152 and #153 re-run on a cluster built from nothing — ordered runs, the pre-fix negative control, then the whole suite, 991 of 991, none skipped (below, "Found on the way"). #144's grouping test asserts about its own customer. CI: both jobs reported pass (integration 12 m 39 s). Merged 21:49 UTC as `7f31bed`, deployed, `/health` ok (no migration) | 93 |
| 2026-09-30 | #161 | **Positioning rewrite, 4 of 4, part e — the documents**: the Help drafts (`docs/kb/`, not linked from the app) describe the product as it is — the five setup steps, the approval card, a list pasted or photographed, the workspace's own time zone, the disclosure — with no pronoun for the assistant and no buyers; the unserved Chinese legal drafts `docs/legal/{PRIVACY,TERMS}-zh.md` are retired (they contradicted the served pages: a trial and payment methods that do not exist; git history keeps them, a copy is in the session scratchpad); PRODUCT.md and README.md say who Nomi is for and give the assistant no pronoun; every zh/ar line of TZ, CUR and the rewrite (370 zh, 337 ar) appended to `docs/NATIVE-REVIEW-UI.md` for the native readers (not a gate) (no migration) | 93 |
| 2026-09-30 | #160 | **Positioning rewrite, 4 of 4, part d — the addresses**: My business lives at `/app/business` (every page, form, link, tool and test moved; `/app/factory…` answers for good — 301 for a page, 308 for a form so an open tab's post keeps its body; a path that only starts with the same letters is not redirected); the export downloads as `customers.csv` and `prices-given.csv` (the subjects keep their names; the old file names still download); the calendar asks `?who=` (an old `?buyer=` link still works); the owner's label zh 负责人, "Example" for a seeded fact, "What you sell". Merged 18:53 UTC, deployed; in production `/app/factory` answers 301 → `/app/business` (no migration) | 93 |
| 2026-09-30 | #159 | **Positioning rewrite, 4 of 4, part c — sign-up and the profile** (0093): the kinds of business lead with who Nomi is for — Brand (clothing, beauty, food…), Online shop, Retail shop, Agency or studio, Services company, Startup — then makers, exporters and wholesalers; 'online_shop' and 'startup' are new (Practice counts an online shop as a shop); the languages a business serves are the nine the safety checks read, each in its own name (informational, nothing gates on it); every country is named in the reader's language — the ten short names stay, the rest come from Intl (a customer from France had none); the sign-up's example is skincare and clothing, the working hours "on working days", the phone error without a Yiwu number. Merged 18:37 UTC, deployed, `/health` ok, schema 93 (backup `nomi-backup-20260930T030201Z`) | 93 |
| 2026-09-30 | #158 | **Positioning rewrite, 4 of 4, part b — the rows that needed a judgement** (the inventory's tables, en/zh/ar): how you sell ("Your payment and delivery terms", "How customers pay you", "What discounts may {name} give?", "Discounts for buying more", "Discussing price", "{name} also handles prices without me", "what you sell", "Annual holiday", products added by pasting "your products and their prices", a shop's tote bag as the first example in every currency, "How it is made"); Results ("Customer messages", "Sales", "answered more price questions"); the conversation ("your page" beside WhatsApp, "the replies and prices prepared for them" — still what erase-buyer erases); Practice ("will not give a price below your floor", "whether your channel delivers it"; the golden scenarios' neutral rows: "Do you sell phone cases?", "Do you have something like this?", "Happy to help"; its check lines "refused: below your lowest price", "they asked…"); the outreach area ("their details", "their company (if any)", "people to write to"); the export's column names; the operator's texts; the demo's number and its rule. Left, with reasons: the golden scenarios that test the claims guard (CE/FDA, DDP, FOB) — their vocabulary is CK's; the quantity rows — price after quantity; the doubled "PI-PI-" invoice number — never shown, the order page prints the order's own reference. Pre-pilot 12/12. Merged 18:23 UTC, deployed, `/health` ok (no migration) | 92 |
| 2026-09-30 | #157 | **Positioning rewrite, 4 of 4, part a — the owner's words**: "buyer" becomes "customer" / 客户 / عميل across the owner's pages (209 en, 208 zh, 201 ar lines; Arabic by whole words in every form it takes — للمشتري, المشترين, مشتريها… — never inside مشتركة or مشتريات; placeholders like `{buyer}` keep their names); where it meant anyone who writes in, "someone" / "people" / 对方 / the passive (13 keys); the hot-lead alert names a buying signal and no longer promises a nightly summary nothing builds; the owner's own business is 生意 / 商家 and «نشاطي التجاري» (My business is 我的生意 / نشاطي التجاري; Arabic verbs re-agreed with a masculine noun), outreach keeps "their company"; zh 停工 → 休息, 让价 → 优惠, 交期 → 交付时间; "lead time" → "delivery time"; an order "being prepared"; an unnamed customer in Insights is named in the reader's language (it was the English word "Buyer" in SQL); KB 02 names the new page labels. Pre-pilot 12/12. Merged 18:08 UTC, deployed, `/health` ok (no migration) | 92 |
| 2026-09-30 | #156 | **Positioning rewrite, 3 of 4 — the site** (`site.*`, served at `/site` until DNS): customers, not buyers, in all three languages (Arabic عميل / العملاء, as decided); the positioning line (`site.who.body`) leads with brands, online stores, startups, agencies and services, "as well as makers, exporters and wholesalers"; "quote" became "price"; zh 公司 → 你自己的 / 生意, 让利 → 优惠. Rule 12 still holds (nothing unbuilt, no price, no trial). The unserved Chinese marketing draft `docs/marketing/landing-zh.md` is retired from the tree (the inventory: "retire it or rewrite it"; a copy is in the session scratchpad). Merged 17:40 UTC, deployed with #155, `/health` ok (no migration) | 92 |
| 2026-09-30 | #155 | **Positioning rewrite, 2 of 4 — what the model is told**: the three prompts speak of customers, not buyers or suppliers; the reply prompt lists the CONTEXT fields actually sent (ten it named were never sent — `product_price_usd` among them), says every price is in `CONTEXT.quote.currency` and never converted, never says "lead time", gives no discount range, promises to send nothing, and its examples are a shop's ("12.00 each, 24.00 for the two"); the analysis prompt's catalogue line says what is sent (no price), any language code, no `destination_country` (nothing read it), a question that never states a figure, its "人工" example a shop's; the image prompt's examples and materials are a shop's, and a screenshot of a post counts; the notes the code gives the writer (a closure, no price set) and "Customer caption"; `prompts/order_validation.txt` (never loaded) taken out of the tree (a copy is in the session scratchpad). Left, by the owner's instruction: the rules that hold a price back until a quantity is given, the 'pcs' default, and the e-mail an order needs. **Live check before and after** (`check-person-model.mjs`, deepseek-flash): 34 named sentences, none the other way, 0 unreadable, the same two passing mentions handed off, median 2.4 s → 2.2 s. Pre-pilot 12/12 before and after. Merged 17:23 UTC (no migration) | 92 |
| 2026-09-30 | #154 | **Positioning rewrite, 1 of 4 — what a customer sees** (`docs/POSITIONING-INVENTORY.md`, the owner's order): the fixed replies no longer assume a factory with a sales team — the hand-off ("someone from our team will reply to you personally, as soon as they can"), the order confirmed ("We'll send you the invoice next"), "How many would you like?" (en/zh/es; was "pieces"), the stand-in ("… each, … in total, ready in N days"), an order "being prepared" (was "in production"), the injection fallback; the price page says "Your price", "Ready in", "the business" (zh 商家); the order text says "Customer" and "Ready in"; three legal lines and a comment. The §5 sentences that vary by kind of business are left, by the decision above. Pre-pilot 12/12 before and after (its order-status check now reads "being prepared"). Merged 16:54 UTC, deployed, `/health` ok (no migration) | 92 |
| 2026-09-30 | #153 | **CUR, part two — one currency per workspace, chosen at sign-up** (0092): `businesses.currency`; a country whose own money is on the list sells in it, any other is asked (only the eight answer); the profile changes it until the first price is set, owner only, the check and the write under one lock; the pasted or photographed price list is read in it (its marks, its notation — "Rp 150.000", "R$ 49,90" — anyone else's money refused; dollars read as before); floors, a product's price (its entry tier now carries the currency — the insert used to leave it to the column's USD), samples and Practice's typed total in it, each box read the currency's way; the paste page's examples in it; the rate page converts the selling currency into the country's own, and only where they differ (it was dollars into ￥ for everyone; no rate is stated in production); the price columns widened for rupiah; the export's floors carry their currency; `provision-factory.mjs` requires `--currency=`. Every workspace made before keeps USD. Pre-pilot 12/12 before and after. Merged 16:38 UTC, deployed, `/health` ok, schema 92 (backup `nomi-backup-20260930T030201Z`) | 92 |
| 2026-09-30 | #152 | **CUR, part one — the send path knows every currency** (before any workspace can price in one): `Currency` is USD, CNY, AED, SAR, BRL, MXN, INR, IDR, each with its sign (a code where it has none: "AED 12.00"; the peso MX$); the numeral guard refuses a quoted figure written in another currency ("$12" for AED 12), unless the customer wrote it themselves, and reads "Rp 150.000" / "R$ 1.250,50" as they say for a quote in rupiah or reais only; "₹500", "Rp 5000" and "150 reais" are never quantities; "high value" sized in each currency's own figures, nothing converted; the stand-in reply no longer says "AED 12.00 AED". Plus a test-timing defect found on the way (below). Pre-pilot 12/12 before and after. Merged 15:41 UTC, deployed, `/health` ok (no migration) | 91 |
| 2026-09-30 | #151 | **TZ — one time zone per workspace, chosen at sign-up** (the owner's decision): a country with one zone gets it, a country with several is asked, a country the table has no zone for is offered every zone (a test draws the form for every country it lists), the profile page changes it; every date and time an owner reads, every "today" (the send ceiling, outreach's cap, Today, insights' months, the calendar, promised dates, the operator's alerts) is the workspace's own — no code outside the country table, the demo and the golden scenarios names Shanghai (a test). The zone is written in the sign-up's own transaction. `provision-factory.mjs` requires `--zone=`. Existing workspaces keep what they have (below). Pre-pilot 12/12 before and after. Merged 15:01 UTC, deployed, `/health` ok (no migration) | 91 |
| 2026-09-30 | #150 | **Practice P4, part two — the checklist and "your total first"** (0091): what the owner has seen in Practice, from the list for their kind of business (a catalogue, a shop — whose "how much is this?" shows the gap until RT — or none), read from the real turn's rows on the copy and written on the workspace so Start over does not take a tick back; the total the owner expects, typed before the answer and set beside it, the rows also measuring how often the two disagree; an order in Practice tapped through the one order service. Merged 14:27 UTC, deployed, `/health` ok, schema 91 | 91 |
| 2026-09-30 | #149 | **Practice P4, part one — the card, the reasons, the two switches** (0090): a waiting practice reply is the conversation page's own card (why it waited, where each figure came from, one Send); a hand-off says why and that nothing was sent; the checks strip names the product's unit; "as if sending alone" lifts the owner's level in Practice only (the Spanish gate still holds, and says so); Practice's own Stop. Merged 13:43 UTC, deployed, `/health` ok, schema 90 | 90 |
| 2026-09-30 | #148 | **Practice P6 — not kept** (0089): Start over erases the workspace's practice conversations and all that hangs off them (asks first); a daily job erases practice quiet for 30 days; the day's 50 counted on the workspace's row so Start over does not reset them; both workers drop a job whose conversation is gone; the shared sandbox is read by nothing and no longer seeded locally; plus two tests' ledger race, root-caused (CI's second pass). Merged 13:21 UTC, deployed, `/health` ok, schema 89 | 89 |
| 2026-09-30 | #147 | **Practice P5 — every workspace practises, metered and capped** (0088): a practice turn is charged to the workspace's own ledger and allowance; 50 practice lines a day, refused before anything is recorded; the operator's `practice_off` switch (everyone or one workspace; `docs/INCIDENT-PLAYBOOK.md`); T1's pilot-only gate gone — the copy keeps workspaces apart (`practice-own.test.ts`). Merged 12:48 UTC, deployed, `/health` ok, schema 88 | 88 |
| 2026-09-30 | #146 | **Practice P3 — through the real pipeline**: a practice message is an inbound job on the workspace's own copy; the worker's turn, Stop and batching apply; approvals and owner replies leave through the real outbound worker, which hands a copy the practice adapter (no network) and nothing else, with or without a channel configured; a practice send is recorded delivered at once; no owner alert from a copy; the golden checks per practice turn; the live line; one lane (live). `practice_copy` (0087). Pre-pilot 12/12 before and after. Merged 12:24 UTC, deployed, `/health` ok, schema 87 | 87 |
| 2026-09-30 | #145 | **Practice P1 + P2 — the copy** (0086): `docs/PRACTICE.md`; `businesses.practice_of`, `practice_refresh`, the trigger refusing channels, credentials, people and logins on a copy; erase-workspace takes the copy; add-login refuses one; the Meta-errors check skips copies. Today's backup `nomi-backup-20260930T030201Z` (schema 85, drill passed) before it. Merged 08:53 UTC, deployed, `/health` ok, schema 86 | 86 |
| 2026-09-30 | #144 | **Stop pressed while a customer's lines are being grouped: recorded as "stopped"** (the owner's decision). The hold is a turn (`held`, the silent path, no model), the waiting lines are processed in it, the conversation handed over as stopped — it used to dead-letter and surface as "not answered". Pre-pilot 12/12 before and after; the new GROUPING test failed before the fix. Merged 08:28 UTC, deployed, `/health` ok (no migration) | 85 |
| 2026-09-30 | #143 | **The disclosure gate, per language** (merged 08:1x UTC, deployed, `/health` ok) — Westlake's auto restored: a reply goes alone only when the customer's language has a signed-off disclosure (en, zh, ar); es/fr (unread) and every language with no sentence stay drafts, and the card names the language and why; the autonomy page names both lists. Pre-pilot 12/12 before and after; integration with the REAL gate (the old whole-install rule put back fails it) (no migration) | 85 |
| 2026-09-30 | — | **Westlake's products made findable (T3 backfill, the owner's yes):** backup `~/nomi-backups/nomi-backup-20260930T064218Z` (schema 85, restore proven 4/4), dry run, then `tools/backfill-aliases.mjs --business 7dc89f42… --yes`: 5 names written for 5 products (each its own name, nothing removed); a second run adds nothing | 85 |
| 2026-09-30 | #142 | **The owner's two questions answered** (below): the gate #124 closed as a side effect; zh signed off; the Arabic sentence changed after sign-off (#118); the backup ping unwired; the uptime ping verified (docs only) | 85 |
| 2026-09-30 | #141 | **The review pass** (design pass, the last step): every owner page screenshotted in three languages, phone and desktop (180, none wider than its screen) and read. Found and fixed: seven Practice checks and one People line printed as raw catalogue keys (the Practice labels now typed against the checks; the surface walk fails any page showing a key); the customer file's History said "Buyer:". The zh/ar lines of the whole run (278 each) are in `docs/NATIVE-REVIEW-UI.md` for the native readers (no migration) | 85 |
| 2026-09-30 | #140 | **Names, People, Setup, the door, the live line** (design pass, UI-PASS 5–8, 10): "You" in Hand to; a person named like the business asked for a name; speakers by name; People's pills only for states (and the owner-only line that printed a raw key); Setup as doors with their state, the profile its own page; the sign-in door e-mail first, the code a small door; the live line in the headers, never over controls. Merged 04:59 UTC, deployed, `/health` ok (no migration) | 85 |
| 2026-09-30 | #139 | **Right to left, by design** (design pass §9): one value layer (`src/api/web/values.ts`) — money, quantities, counts, dates, times, phone numbers, order numbers — isolated on Arabic pages; Arabic money in the locale's own form; every figure in a sentence isolated; the surface walk draws all 33 owner pages in Arabic and fails any figure outside an isolate. The symbol check reads namespace imports. Merged 21:48 UTC (no migration) | 85 |
| 2026-09-30 | #138 | **Today by time** (design pass §4): who needs you now, the last 24 hours, what is coming up; every line a door; figures in sentences through the plural rules (the counted insights too); the sending line only where messaging is live. Merged 20:01 UTC, deployed 20:09 UTC, `/health` ok (no migration) | 85 |
| 2026-09-30 | #137 | **CH1 + CH2 — "Your accounts" read live on Channels, and the help page**: each step marked from what is there (the Page, its Instagram, Meta's word on the token, the permissions granted, the subscription, the newest message per channel); a token Meta refuses is recorded as a send would find it; Meta not answering is "could not check"; `/app/help/meta` says what to check and why, linking only Meta's own help pages. Merged 19:25 UTC, deployed, `/health` ok (no migration) | 85 |
| 2026-09-30 | #136 | **CEIL — 50 sends a day for a new workspace** (0085; existing ones 200; `tools/send-ceiling.mjs`), **and an hourly Meta-errors alarm** to the operator (5 failed and 1 in 5, over 24 h, at most every 6 h). Backup before it: `~/nomi-backups/nomi-backup-20260929T173225Z` (schema 83, drill 4/4). Merged 19:08 UTC, deployed, `/health` ok, schema 85 | 85 |
| 2026-09-30 | #135 | **FAIR — the inbound queue shared fairly**: a group per workspace, three workers a third of a poll apart, one turn at a time per workspace; a batch waits for its own conversation's message still in the queue. Merged 18:58 UTC; its deploy also carried #133 and #134 (see "Found on the way"). `/health` ok, schema 84 | 84 |
| 2026-09-30 | #134 | **REKEY — `CREDENTIAL_KEY` can be rotated without a token lost**: `CREDENTIAL_KEY_PREVIOUS` read as a fallback, `tools/rekey.mjs` (a check mode that changes nothing), `docs/SECRET-ROTATION.md`. Production check (read-only): 4 sealed tokens, all open with the current key. Merged 18:00 UTC | 83 |
| 2026-09-30 | #133 | **PWR — "Forgot your password?"** (0084): a one-time link by e-mail, 60 minutes, at most 3 an hour per login, older links closed; the page says the same whether or not the address is known. Merged 18:00 UTC, deployed with #135 | 84 |
| 2026-09-30 | #132 | **Q1 — the analyser sees the last six messages**, as its prompt promised; the batch's own messages never its history; live check before and after (29/29, then 34/34 with five history cases). Merged about 17:12 UTC (no migration) | 83 |
| 2026-09-30 | #131 | **T3 — imported products can be found**: names written at import and edit, name editing, "ready" only when findable, `tools/backfill-aliases.mjs` (NOT run on Westlake: all 5 of its products are findable by no name — the owner's yes). Merged about 17:12 UTC (no migration) | 83 |
| 2026-09-29 | #130 | **T7 — every paid call on the ledger**, in its own transaction, on one UTC clock; the deepseek price; first figures about $0.000667 a turn at peak list price. Plus the midnight "Today" test flake, root-caused. Deployed 17:08 UTC (Railway's builder queued it for 40 minutes), `/health` ok (no migration) | 83 |
| 2026-09-29 | #129 | **Small truths**: T1 the practice sandbox is the pilot's alone (every other workspace gets not-found, nothing changes); T5 the page reader at temperature 0 refuses a cut-off read, and two promises the product did not keep are gone; CH5 the window's clock on the card; CH7a a shared post, story mention or story reply named, with Meta's link opened only on Meta's hosts. Merged about 15:16 UTC, deployed about 15:34 UTC (no migration) | 83 |
| 2026-09-29 | #128 | **What a reply promised, on the calendar** (0083): follow-ups, prices that end and deliveries, read by rules from the words that LEFT (five languages; corpus 31 found / 22 left); the calendar's Promised category and the panel's block. Backup before it `~/nomi-backups/nomi-backup-20260929T103609Z` (schema 82, drill 4/4). Merged about 10:40 UTC | 83 |
| 2026-09-29 | #127 | **The calendar week, and the owner's own dates** (0082): Week by default (days × hours, ‹ Today ›, the country's first weekday), Month, Day, List; provenance by edge; `calendar_entries` (archived, never deleted). Backup before it `~/nomi-backups/nomi-backup-20260929T095733Z` (schema 81, drill 4/4). Deployed about 10:15 UTC, `/health` ok, schema 82 | 82 |
| 2026-09-29 | #126 | **The design foundation, part two — the shell**: the rail in groups (Customers heading Conversations and Calendar; Setup and Log out at its foot) with its one number read fresh per page; a conversation between its list (from 1100 px) and the customer panel (from 1440 px: asked about, prices worked out, samples, orders, the calendar's own dates, who acted ✦ ● ○); the tab "page · business"; the page's other cards drawn as states. Deployed about 09:50 UTC, `/health` ok, schema 81 (no migration) | 81 |
| 2026-09-29 | #125 | **The design foundation, part one**: buttons and doors (23 link-buttons made doors; the rule's test on every owner page); the palette (graphite, magenta for the assistant's hand only; jade, highlight, warm papers, dark mode retired; the mark graphite); Noto served by the product, one font order per language; **the approval card** (the reply once, one Send, "How … read this" with each figure's source; "No reply needed" decided below). Deployed about 09:24 UTC, `/health` ok, fonts served, schema 81 (no migration) | 81 |
| 2026-09-29 | #124 | **Spanish and French**: the disclosure (awaiting a native reader, gate shut) and every safety check — identity, wants-a-person and openers, deletion, injection, the forbidden-word floor, claims, numeral words. **T2**: "AI" as the word only; Arabic-Indic and Chinese numerals; a small number beside any currency; accented Spanish promises. Deployed about 08:30 UTC, `/health` ok, schema 81 (no migration) | 81 |
| 2026-09-29 | #123 | **A product may have no minimum** (0081): `products.moq` nullable, "no minimum" in every reply, page and export, in every language; the numeral guard refuses an invented minimum. **T4** parser honesty. **PRODUCT.md** description rewritten to the positioning. CLAUDE.md rule 24 | 81 |
| 2026-09-29 | #122 | **T6/T6b — an order waits for the owner's tap** (0080). Deployed 07:03 UTC, `/health` ok, schema 80. A customer's "yes" writes `order_proposals`; nothing is confirmed or sent; the owner confirms (order made, then the customer told) or steps in (set aside). Pending question set only when its message leaves (`asks` on drafts and outbound rows). E-mail alert always; browser notification where the owner turned it on; the order leads Buyers and Today. CLAUDE.md rule 23 | 80 |

**Next (the owner's instruction of 2026-10-01): self-serve onboarding,
complete and final** — the onboarding plan (artifact `CvtJ8w4TsXWT8HnzrdXTGn`;
stages 0–9, scopes in "Build order", sizes in "The one-month build order").
Parked, not worked on (the owner, 2026-10-01): the golden scenarios about
certification and delivery-term claims, the phone calendar week view, the
forbidden-words page's built-in list, README's Status section, and the
owner-facing review lines in `docs/NATIVE-REVIEW-UI.md`. Never set a
native-review gate to true.
The target: a stranger signs up, connects a channel, teaches Nomi their
products and goes live with no operator step, guided in-app, with video
tutorials. Meta's paths are built as if verification and App Review had
passed (the list of paths never run against live Meta is kept below, under
"Never run against live Meta"). Free trial on request, card upfront, the
trial's clock from the first channel connected. Each open decision is taken
as the plan recommends, unless the instruction says otherwise. The order:
1. **Learning the business** — K3 + K5 (one migration), K1 the import
   review, K7 challenge rows, K2 the discount question, K6, K8 store import,
   RT **in full**, HS. **Corrected by the owner the same day:** "do not
   touch price-after-quantity" was scoped to the positioning pass only. RT
   makes three things one piece of work, conditional on the kind of
   business: retail and brand businesses (brand, online shop, retail — and,
   my call, a startup and "something else" with them; agencies and services
   give the price first too) quote a unit
   price without asking the quantity first, count in whatever unit fits the
   goods, and import without a minimum; factories, exporters and wholesalers
   keep quantity first, "pcs" and minimums. Retail and brand businesses must
   be able to reach "sells" — R2 is built so they can, and a test holds it.
2. **Channels and alerts** — G5 e-mail alerts, CH3 echoes, G5b phone alert
   and expired drafts, CH4 "Nomi and Meta".
3. **The cohort gate** — G1, G2, G3, G4, G6, G7, G9, G10, G8.
4. **Earning auto** — R1, R2, R3, LG (the rest), R5.
5. **Reach** — the pt pack and the es/fr packs completed (every gate stays
   as it is: false until a human reader signs off), CK, VAR.
6. **Before open sign-up** — MAIL, KS5, BOT, KS6, RET, BILL (with the
   trial), SITE.
7. **After opening** — EXT, CH7, then UI-es.
8. **WhatsApp self-serve** — WA and WA-S (Embedded Signup, per-business
   numbers, templates).
9. **Stage 0's pack (M3)**, the guided path and its videos (recorded from
   the finished pages), and the never-run-against-Meta list.

Not built, with the reason: T8 and K4 need the owner's real price lists
(K4 ships only if T8 shows it pays); EU1 needs counsel (decision 32 — until
then sign-up does not admit EU/EEA/UK sellers, as recommended); the
"Later, not dated" table (AG, SOC, CK2, CONV, PKX, EXT2, LRN, MSHOP,
EMAILCH, SIGNALS, UIX, CONSOLE, KB) is outside stages 0–9.

**Earlier (the owner's instruction of 2026-09-30, in its order), done:**
1. **Practice, per workspace** — blocking before anyone outside signs up.
   **Done**: P1–P6 (`docs/PRACTICE.md`; #145–#150, all deployed). Left
   out on purpose, with reasons there: photo and voice in Practice (needs an
   upload), the rehearsal findings' wider inputs, and the checklist feeding a
   "Ready for customers" page (G6) and funnel events (G9), neither built.
2. **One time zone and one currency per workspace**, chosen during setup.
   **Done**: time zone (#151) and currency (#152 the send path, #153 the
   choice, the forms, the import, the rate page; 0092).
3. **The positioning rewrite** (`docs/POSITIONING-INVENTORY.md`): **done** —
   customer-facing (#154), model instructions (#155, live check before and
   after), the site (#156), owner-facing (#157–#161). What is left is on
   purpose and listed at the top of the inventory.

Done from that instruction: the status corrections and the two questions
(#142), the gate per language (#143, Westlake's auto back for en/zh/ar), the
approved backfill, Stop during grouping (#144). **Languages outside the five**
were decided the same way as the gate and shipped in #143: a customer writing
in a language with no signed-off disclosure is answered in their language, the
reply stays a draft, and the card says why; no sentence is ever translated for
the occasion.

**Left for the owner's eye by the review pass, and parked by the owner
(2026-09-30):** the calendar's week on a phone; the forbidden-words floor's
long list. The phone nav's "Buyers" and the older "buyer" sentences are part
of the positioning rewrite (item 3 above).

**The gate is per language since #143** (it was one answer for the whole
installation, and #124's unread es/fr stopped every workspace sending alone —
see "The owner's questions" below). Flipping a flag is the one step I may not
take.

## The order of work

1. **Done — T6/T6b**, the live order defect (highest priority).
2. **Done — MOQ nullable (0081) and T4**, with PRODUCT.md (step 4).
3. **Done — Spanish and French (#124)**, with **T2** (the guard holes).
4. **Done — PRODUCT.md** (in #123).
5. **Design foundation** (about 70 h): colour tokens (graphite primary, magenta
   only for the assistant's marks; jade, highlight `#7F6400`, the warm papers
   and the dark tokens retired), self-hosted Noto with one font order per
   language, the three-pane shell, the approval card, and the
   buttons-and-doors test (written first).
6. **Calendar**: the owner's own entries (the instruction named migration
   0080; the order fix and the minimum shipped first and took 0080 and 0081,
   so the calendar's is the next free number), the week grid, then the promised
   follow-up read from conversations (then price end, agreed delivery).
7. **Build items with no open decision**, each built in the new design where
   it has a page: T1, T3, T5, T7, Q1, CH5, CH7a, PWR, FAIR, CEIL, REKEY
   (T2 done in #124).
   CH1/CH2 (connection health, help pages) are product pages about a channel,
   not Meta's review process; built unless they turn out to need App Review.
8. **The rest of the design pass** folded into the pages those items touch
   (Today, customer panel, RTL values, names, Setup, People, door).

## Decided by me, as the owner asked (2026-09-30, for the positioning rewrite)

- **The Arabic word for "customer" is عميل / العملاء** — reversing #111's
  مشترٍ, as a consequence rather than a change of mind: #111 translated the
  English "buyer", and the rewrite replaces "buyer" with "customer" (Nomi is
  "for anyone who sells or talks to customers over social media"). مشترٍ is a
  purchaser — someone buying or who bought — and most people who write to a
  shop on Instagram have not bought and may never; عميل is the word Arabic
  shops and business software use for the people they serve (خدمة العملاء),
  as true of someone asking a question as of someone ordering, and it keeps
  the owner's pages saying what the English says. Rule 6 is unchanged: the noun
  only, never a pronoun or a verb that agrees with the person.
- **The kind-of-business switches are not built in this pass.** The ~96
  strings that cannot go neutral (the inventory's §5) describe what the
  product DOES — a minimum order, a price only after a quantity, samples, a
  proforma and delivery terms, what an order needs — and this pass must not
  touch price-after-quantity, the 'pcs' unit or the 100-item import minimum. A
  switch that rewords them while the product still behaves the old way would
  make the words say one thing and the product do another. Where the behaviour
  already follows the workspace's own data, the words follow it too (a minimum
  said only when a product has one, since 0081; the currency and the time zone;
  the rate page only where there is a pair). The items that change those
  behaviours are RT, HS and CK, waiting on the owner's decisions 18, 29, 41
  and 42; the switches belong with them, so each string changes once. Until
  then those strings keep their wording, and §5 is their list.

## Decided (from the owner's instruction of 2026-09-29)

- Design: all five recommendations taken — magenta `#A82860` marks only what
  the assistant did (never a fill, link or brand colour); Send is a filled
  graphite `#1C1B1F` button; marks ✦ assistant, ● you, ○ nobody yet. Noto
  self-hosted (not from Google). Dark mode removed. Calendar entries: solid
  edge = from a conversation (links back), dashed = the owner's. Foundation
  first.
- **The card's four acts — decided 2026-09-29: "No reply needed" stays, as
  its own act, drawn quiet.** It is an act owners take: the customer wrote
  "thanks 👍" or "ok", a reply was drafted, and the right answer is silence
  *without* taking the conversation over — which neither Send, Edit nor Hand
  to me does (it was Skip, command `不回`: the draft is dropped, nothing is
  sent, the assistant keeps the conversation). Because it is the one act that
  sends nothing and keeps nothing, it is not boxed: it sits at the far end of
  the row as words (`.btn.ghost.quiet`), so the row reads as three choices
  about the reply and one way to let it go. It is still a `<button>` in the
  form (it changes something), which the buttons-and-doors rule requires.
  Edit is a `<label>` for the reply box (it moves the cursor, changes nothing),
  drawn as a button because it sits in the row — the plan's one exception.
- Order confirmation: T6/T6b as built above.
- MOQ: nullable, "no minimum" everywhere (overrides the plan's sentinel of 1).
- Languages: en, zh, ar, es, fr; es/fr gates stay false.
- Not in this run: anything Meta-related (Business Verification, App Review,
  portfolio layout, WhatsApp timing — so M0–M4, M3R, TP, WA, WA-S, CH4, CH7's
  review, G8's production run), growth analytics, post suggestions, the
  627-place positioning rewrite.

- **The calendar's dates from conversations are read by RULES, not a model**
  (Claude's call, 2026-09-29, #128). The plan said "the analysis reads the
  date out of the words (a prompt change and the live check)". Built instead:
  a promise is read from the words of the reply that LEFT — the sentence is
  the promise, and what reached the customer is what counts — by rules in
  five languages, held both ways by a corpus (31 found, 22 left alone). No
  model call, so nothing to drift and no live check; it also follows the
  recorded own-power direction (answer from Nomi's own understanding, models
  only where rules cannot). Only a DAY the words name is taken; a span
  ("next week") is not guessed into one. The owner decided the kinds and
  their order (follow-up first, then price end, then delivery); all three
  ship together because one reader serves them.

## The owner's questions of 2026-09-30, answered

### 1 · Why nothing sends alone, Westlake's auto included: a side effect

**What closed it:** #124 (commit `8bf0b53`, merged as `2c548eb`, 2026-09-29),
`src/core/conversation/disclosure.ts`:

    -export const DISCLOSURE_LOCALES = ['en', 'zh', 'ar'] as const;
    +export const DISCLOSURE_LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
    +  es: false,
    +  fr: false,

The gate is one answer for the whole installation,
`export const autonomyReleased = (): boolean => disclosureAwaitingReview().length === 0;`
(line 105). With two locales unread, it went false for every workspace.

**Where it binds:**
- The send decision in `commitTurn` (`src/pipeline/turn.ts`,
  `const released = !speaksAlone || tenant.autonomy.released();`). An auto
  reply becomes a draft and `autonomy_withheld: disclosure_not_reviewed` is
  recorded.
- The owner's routes that set a capability to auto (`src/api/web/app.ts`,
  "promote" and the level form). They refuse.

**Intended, or a side effect: a side effect.** The installation-wide rule is
from 2026-09-22 (`84f8247`). Its comment says a locale added later "closes the
gate again until it too has been read". The instruction for #124 was only that
the es/fr flags stay false. Nobody decided to stop Westlake. I wrote the
consequence into this file at the time and did not ask. That was the mistake.

**Effect so far: none in practice.**
- Westlake's six capabilities are still `auto` (set 2026-09-19).
- No `autonomy_withheld` event has been recorded for it.
- It received no customer message in the last 7 days.

**Restored:** see the PR row "the disclosure gate, per language". The gate is
now per language, as the owner decided today: a language becomes
auto-capable only when a native reader has signed its disclosure off.
- A reply goes out alone only when the customer's language has a signed-off
  disclosure: en, zh and ar today.
- es and fr, and every language outside the five, stay drafts. The owner's
  page says why.

### 2 · The Chinese flag: my report was wrong about Chinese, and the Arabic sentence changed after sign-off

**zh:** `true` since #117 (commit `5aac46b`, merged as `9accd6a`, 2026-09-28).
It has not changed since, and the sentence is character for character the one
the owner signed off. My final report said every language except English
waits for a reader. That was wrong: only es and fr are false.

**ar:** `true` since #117. But #118 (commit `49acc93`, merged as `4f99be5`, the
same day) rewrote its second clause after the sign-off, so as to address
nobody in a gender (rule 6), and left the flag true. The owner has not read the
sentence the product now sends:

| | Arabic disclosure |
|---|---|
| Signed off in #117 | مرحبًا، أنا {name}، مساعد آلي لدى {business}. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت. |
| Sent since #118 | مرحبًا، أنا {name}، مساعد آلي لدى {business}. للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت ممكن. |

The code's comment calls both Arabic changes the owner's; only «مساعد آلي»
was. The flag is untouched, because no assistant sets these. The owner re-reads
the second line and either keeps `ar: true` or sets it false himself.

**es and fr:** `false`. The owner reads fr and ar himself; es needs an outside
native reader.

### 3 · The same pattern elsewhere: checked, one more found

**Found: the backup job pings nothing.** `BACKUP_PING_URL` is set on the
`nomi` service, which never reads it. The backup cron reads it from its own
service (`backup/run.sh`: `PING="${BACKUP_PING_URL:-}"`), and the `backup`
service has none. The owner's fix takes a minute: on the `backup` service, add
`BACKUP_PING_URL`, or the reference `${{nomi.BACKUP_PING_URL}}`. The backups
themselves run and are recorded (`nomi-backup-20260930T030201Z`, drill passed).

**Verified working: the uptime ping.** `HEALTH_PING_URL` is on `nomi` and in
use: the deployment booted with "Uptime pings: every five minutes"; 12
heartbeat jobs completed in the last hour, none failed; and there is no
failed-ping line in the log (the heartbeat logs every ping that is not
delivered or not answered 2xx).

**Also caused by 1, restored with it:** the owner's autonomy page refused
"promote" and the auto level while the gate was closed.

**Checked, and still as it was opened:**
- Westlake still has the outreach area on, its assistant's name confirmed
  (2026-09-28) and WhatsApp activated; no Stop and no ops flag.
- Westlake is still the pilot workspace: since #129, the only one that may use
  Practice.
- The access code still signs in (#140 put it behind a small door).
- The daily send ceiling that #136 gave existing workspaces is 200, far above
  Westlake's traffic.

## Waiting on the owner (the plan's open decisions)

These items cannot be built without a decision the plan left open and the
instruction did not answer. Collected here; asked once, at the end.

**Answered by the owner on 2026-09-30 and taken off this list:** T9 (languages
beyond the five: drafts, the owner told why, never a translated disclosure —
built in #143), LG (the gate per language — #143), P1–P6 (Practice per
workspace, blocking — in progress; Q1W decided "not yet" in
`docs/PRACTICE.md`), TZ and CUR (one time zone and one currency per
workspace, chosen during setup — next), Stop during grouping (#144).

| Items | Decision (plan numbering) |
|---|---|
| K1–K8 (learning the business from imports) | 10, 27, 28, 29, 30, 41 |
| RT, HS, CK (retail-first, "how you sell", claims packs) | 18, 29, 41, 42 |
| G1–G10, KS5, KS6 (self-serve sign-up and its protections) | 7, 8, 14, 15, 33, 34, 35, 36, 37, 38 |
| R1–R3 (earning auto) | 9, 12, 23 |
| VAR (variants) | 31 |
| MAIL, BOT, BILL, SITE, UI-es, EXT, EU1 | 13, 15, 30, 32, 36, 39 (and accounts only the owner can create) |
| T8 (price-list measurement) | needs the owner's 25–35 real catalogues |
| RET (erase workspaces that never connected, after 90 days) | not a plan decision, but an automatic erasure: confirm before building |
| **Re-read the Arabic disclosure** (it changed after your sign-off, #118 — both sentences above) and read the French one; find a reader for the Spanish one | not a plan decision: the flags are yours alone |
| **Move `BACKUP_PING_URL` onto the `backup` service** (it sits on `nomi`, which never reads it) | one minute in Railway |
| **The currency of the workspaces made before #153** keeps USD (every price they hold is in dollars; the check allowed nothing else). The one from Morocco, and any that sells in another, changes it on its profile page while it has no price yet; Westlake's is fixed by its prices | nothing to do unless a workspace sells in another currency — then CONV (two currencies) or its prices re-entered |
| **The time zone of the 59 workspaces made before #151.** None was ever asked; every one keeps `Asia/Shanghai`, the old default. 58 have no country on record; one, from Morocco, would be `Africa/Casablanca`. Westlake's (live) decides its send ceiling's day: confirm or change it on its profile page (Setup → Profile → Time zone). I did not change any: a live workspace's day is on the send path | yours: one select per workspace, or say "set each from its country" and I write the backfill |
| **Erase the old shared practice sandbox** (`5a4d0000-0000-4000-8000-0000000000b1`): nothing reads it since P3, but it still holds the pilot's practice from before — possibly customers' words pasted in through "Try it". After a backup: `tools/erase-workspace.mjs --business 5a4d0000-0000-4000-8000-0000000000b1` (dry run), then with `--confirm "Practice sandbox" --yes` | a permanent deletion: yours to run |

## Found on the way

- **BOT's database limit outlives a test run (2026-10-01, KS6's integration run).** `accounts.test.ts` signed up from one of sixteen fixed caller addresses; with the per-caller limit now in the database, a second run within the hour on the same database — CI runs the suite twice — could reuse the address and find its five tries spent (12 tests failed locally, 429). The file now signs up from its run's own address. Test-only.
- **G1's digest test depended on the database's other sign-ups (2026-10-01, MAIL's integration run).** The operator's digest names the day's OLDEST 25 sign-ups; a local database other runs had signed 31 up on that day cut the test's own, newest one off, and jobs the previous file left on the alert queue (one per two-second poll) delayed it past the test's ten seconds. Reproduced both ways; the test now sends a list holding only hers, ahead of leftovers (`priority`). Test-only. Whether the digest should list the newest first is left as it is.
- **The schema's default privileges reach every new table (2026-10-01, KS5).** 0005 grants the app role select, insert and update on every table made after it, so 0112's `mail_sends` and 0113's ceiling were the app's to rewrite. Both migrations now revoke it and turn row security on before production saw them; 0114 does the same for its tables, and tests prove the app is refused. A sweep of the local schema found one older table the app can still write without row security: `_migrations` (since 0005). Not changed here — outside the item; worth a migration of its own.

- **The deletion-request test failed every day from 16:00 UTC (2026-10-01, CI on #183).** `tests/integration/buyer-deletion-request.test.ts` wrote its expected dates in Shanghai's zone, but since G2 (0100) a workspace that names no zone at sign-up is born in UTC, so from 16:00 UTC the page's date and the test's were a day apart. Reproduced locally at 16:11 UTC; the test now reads the workspace's own zone and passed at 16:12. Test-only; nothing shipped was wrong.

- **G1's sign-up test caught an operator error alert (2026-10-01, CI's second pass on #182).** The test makes its own pilot the operator, with a working mailer; the suite fails on purpose elsewhere, and an `app_error` alert held or queued earlier can be delivered while G1 runs — into the same outbox, where "nothing is sent" counted it and "the operator is told" picked it instead of the sign-up notice. Error alerts are now kept apart in that test; nothing in the product changed (the alert went where it should).

- **The live check in French (2026-10-01, the packs):** «Appelez-moi Marie» ("call me Marie", a name) comes back from the model as asking for a call. Layer 1 rightly does not fire; layer 2 hands the customer to a person — the safe direction, and French replies wait for the owner anyway while its disclosure is unread. Kept and listed, like #110's two passing mentions; worth a prompt line only if it shows up with real customers.

- **2026-10-01, the boot test would have broken at schema 100** (found running G2's suite): to
  simulate a database behind the build it shifted the newest migration's row down by 100 and
  restored only rows below zero. At 100 the row became version 0 and was never put back — the
  rest of the run failed on a "stale" schema; at 101 the shift would have collided with
  migration 1. It now negates the version (below zero for every migration, exact to undo) and
  asserts the newest version is back. Found on a scratch cluster; the shared one was untouched.
- **2026-10-01, a restart wiped the session scratchpad** (macOS clears
  `/private/tmp`): the working clone, the uncommitted HS branch and the local
  Postgres on 55451 went with it. Nothing shipped was lost (#167, #168 were
  merged and deployed). The clone, the cluster (schema 96, seeded) and HS
  were rebuilt from the session's own record, and HS re-verified from
  nothing before its PR. Lesson kept in memory: commit and push a branch as
  soon as it typechecks, so the next restart costs nothing.

- **A test failed every day from 16:00 UTC, since #151** (found 2026-09-30 in
  #153's run): `buyer-deletion-request.test.ts` rendered the deletion alert
  with no zone — UTC since TZ — and expected its dates in Shanghai time. The
  two dates differ only from 16:00 to midnight UTC, so #151 and #152 passed
  CI earlier in the day. The test now hands the renderer the zone, as the
  sender does. The whole unit suite and every integration file naming Shanghai
  were run again at 16:10 UTC: nothing else depends on the hour.
- **A test put back a USD-only check after 0092** (found in #153's run):
  `money-currency.test.ts` drops `price_tiers_currency_known` to force an
  unreadable row, then re-added it as `currency in ('USD')` — every later file
  met a database that refused dirhams. It now re-adds the definition it found.
  And `accounts.test.ts` counted businesses named `Copycat` across all runs;
  the name is per run.
  **Was the currency work re-verified after the fix, or did the failures only
  stop? Not until 2026-10-01** — the record above says the test was fixed, not
  that #152 and #153 were run again against a database that takes every
  currency. Done on 2026-10-01, on a Postgres 18 cluster built from nothing
  (initdb, 0001–0093, the demo and the sandbox; port 55470, never the shared
  55451):
  - in the order that exposed it — `money-currency` (5/5), then the seven
    currency checks read back (all eight currencies in each, `price_tiers`
    included), then `workspace-currency` (6/6), the send path's currency
    tripwire (3/3) and the parity currency files (38/38), the checks read
    again at the end (unchanged);
  - the negative control: the test as it was before the fix (from `a765913`)
    run on the same cluster left `price_tiers_currency_known` gone — and a
    dirham test still passed, against no check at all, and a EUR row got in.
    That is the defect's real mode: not "later files refused dirhams" but
    "later files could no longer prove anything about the check". So the
    cluster was built again from nothing before the full run;
  - the whole integration suite on the rebuilt cluster, with the new guard
    below: the first run failed one test that asserted about every tenant
    (#144's, below — not the currency work), fixed; then, on a cluster built
    from nothing again, 991 of 991, none skipped, the schema the same before
    and after;
  - production, read-only: all seven currency checks hold the eight
    currencies; the 59 workspaces are USD.
  **New guard** (`tools/run-integration.mjs`): the runner reads every
  constraint in `public` and `shadow` before and after the suite and fails
  the run, naming each line, when the suite left the schema different from
  what it found — whatever the tests themselves said. Negative control: the
  pre-fix test fails the run and names the vanished check.

- **#144's Stop-during-grouping test asserted about every tenant** (found
  2026-10-01, in the first full run on the rebuilt cluster): it expected its
  analyzer to have read nothing, but that production's worker also drains
  jobs other files left in the shared queue, and 'price for 500 totes?' and
  'hello' — other tenants' messages — reached it. His own turn recorded no
  model call and no analysis, as it should. The same class as M22's (#139):
  the test now asserts its claim — no model read HIS line, nothing was sent
  to HIS number. Still not fixed at the root: tests leave queued work behind.

- **A retention test failed the whole suite on time, not on logic** (found
  2026-09-30 in #152's check): `backup-retention.test.ts` runs bash, awk and
  find synchronously; alone each case takes about 0.1 s, but the first case of
  a group took 5.7 s with every worker busy and failed vitest's default 5 s.
  The file's other shell groups already allowed 120 s; the five without a limit
  now allow 60 s (`SHELL`). Not a retry: the cause is the default limit on a
  synchronous spawn in a parallel suite.

- **The restore drill failed every backup taken since 0078** (found
  2026-09-29): `tools/verify-restore.sh` counted every table with a
  `business_id`, row security and no policy as a restore failure, and
  `login_setups` (0078) is exactly that by design (reached only through
  security-definer functions). The scheduled job runs the same script, so no
  scheduled backup can pass its drill at schema 78 or later; the newest
  `backup_runs` row was 2026-09-28 03:02 (schema 77) and none was recorded
  on 09-29. Fixed in #122: only a table the runtime role can reach counts
  (negative control: a reachable table without a policy is still caught).
  A manual backup was taken before 0080: `~/nomi-backups/nomi-backup-20260929T064304Z`
  (schema 79, drill 4/4 after the fix). **Proven 2026-09-30:** the
  scheduled run `nomi-backup-20260930T030201Z` (schema 85, drill passed)
  wrote its `backup_runs` row.
  Confirmed from the service's own log (read 2026-09-29 19:10 UTC): the run
  of 2026-09-29 03:04 UTC dumped schema 79, failed exactly this check (b)
  "RLS-without-policy=1", and uploaded nothing. The backup service rebuilt
  with the fix at 07:00 UTC that day.
- **"Production did not answer" was this machine's network** (2026-09-29,
  from 20:03 UTC): curl reached app.nomidoes.com over IPv6, at an address
  this machine's resolver invents (2406:cb42:…); public DNS publishes no
  IPv6 address for the domain (a CNAME to Railway, which has none). Over
  IPv4 `/health` answered throughout; no row in `app_errors`. Health checks
  from here use `curl -4`.
- **Railway made no deployment for one merge** (2026-09-29): #133 and #134
  merged at 18:00 UTC with CI green, and the `nomi` service got no deployment
  for `e56da0b` at all (the `backup` service did — skipped by its watch
  paths). Production stayed on #132 until #135's merge deployed main's head,
  both included. After a merge, read the deployment list for the merge
  commit itself, not only for a SUCCESS.

- **M22's "never delivered" failed on CI's second pass** (main after #139,
  and #141's first CI run): the simulator counted one call. The production
  that test builds runs the real worker, which also drains outbound jobs other
  tests left in the shared queue — after a local run: three `created` (the
  day-one and uncertain-sends tenants) and one of boot.test's own tenant left
  `active` when an earlier production closed mid-job — and sends them under
  their own conditions. None was a refused message. Two local back-to-back
  runs did not reproduce it (timing). The test now asserts its claim — none of
  its four customers reached the provider — and the simulator keeps every
  request, so a failure says what was sent. Not fixed: tests leave queued
  work behind; a production's graceful stop can leave a job `active`.
- **A unit test flaked once** (2026-09-29, before #124):
  `tests/parity/backup-retention.test.ts` › "manual pairs at the root older
  than 180 days go WHOLE" failed in one full run and passed in the next eight
  and alone; no message was captured. Not root-caused yet — if it recurs,
  capture the output (`vitest run --reporter=dot > log`) before rerunning.
- **CI and production run Node 22; this Mac's default `node` is 26** (found
  2026-09-29 on #129): `Intl.DurationFormat` passed every local run and threw
  on CI. Fixed before the merge (units joined by `Intl.ListFormat`); every
  check since runs on Node 22 (CLAUDE.md §3). Nothing had shipped with it.
- **The usage ledger had three holes** (T7, #130): written inside the turn's
  transaction (a failed or retried turn's calls were lost), only by the text
  turn (photos, voice notes, catalogue pages and live Practice never
  counted), and on two clocks (written UTC, read Shanghai — eight hours a day
  the budget saw an empty day). All three closed. The history before
  2026-09-29 keeps the holes; it cannot be backfilled.
- **The inbound queue takes one message per 2 seconds per process** (found
  2026-09-29 in the integration run for #130): `boss.work` runs with
  pg-boss's defaults, one job per poll, so about 30 messages a minute, and one
  workspace's backlog delays every other one's (a test's message waited 24 s
  behind another tenant's dozen). FAIR (#135) fixed it: a group per
  workspace, three workers, one at a time per workspace. The metering test
  still waits long enough for a backlog.
- **A test assumed "minutes ago" is today** (found 2026-09-30 on #130's CI,
  which ran at 00:01 in Shanghai): `buyers-merge` expected "Today HH:MM" for
  a message written 3 minutes earlier, which the business clock calls
  "Yesterday" for the first minutes after its midnight. Now the test expects
  what `formatRelative` says for the row's own instant; reproduced both ways
  (message moved a day back: the old assertion fails, the new one passes).
- **FAIR's first shape was not fair** (found 2026-09-30 before #135 merged):
  three workers registered together poll in the same instant, are handed the
  three oldest jobs, and when those are one workspace's two are put back —
  one job per poll for everybody. Now three workers a third of an interval
  apart; the fairness test proves it both ways.
- **FAIR's concurrency could split a batch** (found 2026-09-30 on #135's
  CI): with three workers, two of one workspace's jobs can be fetched in one
  poll and pg-boss keeps whichever registers first, so a batch's wake could
  run before the second message was recorded and answer the two apart
  (reproduced about one run in four). The wake now waits for a message of the
  same conversation still in the queue, within the batch's hard window;
  20 of 20 with it, 9 of 12 without. Q1's batched test now uses a 10-second
  window (production's is 20; the old 1 second was shorter than a poll).
- **Practice's scripted turns record two "model calls"** in `turns` (the
  stand-ins count like models, model id `scripted`, no tokens). One in
  production (2026-09-19). The report counts them apart; the ledger never
  had them.
- **The claims guard's words were English-only** for zh and ar too (only the
  acronyms — CE, FDA, FOB… — work in any language). #124 added es/fr as
  instructed; zh/ar words (保证, 退款, ضمان, استرداد…) are not added: a
  broader guard makes more replies wait, which is the owner's call.

## Deferred, and why

- **LG's "no pack → a silent hand-off with an alert" is not built.** The plan offered it for a language with no pack; your decision of 2026-09-30, shipped in #143, already answers it: such a customer is answered in their language, the reply drafts, and the card says why. No English sentence is sent either way. What LG adds is the language itself — decided by fixed rules, with Arabizi, Hinglish and the other romanised languages never read as English (rule 65).

- **G8's "free" is not on the site.** The plan's G8 row says the cohort copy is "invitation only, drafts only, free". Rule 12 (and its test) forbids the site naming a price, and your instruction of 2026-10-01 (a trial on request, then a card upfront) would make "free" untrue once BILL lands. The site says the rest; BILL will say what is true about money.

- The order confirmation sentence is still the English template ("…The factory
  will send you the proforma invoice."). Localising fixed sentences is LG
  (decision 16) and its wording is part of the positioning rewrite; the owner
  now sees the exact sentence on the order card before confirming.
- Browser notifications work while a Nomi tab is open (the page's script,
  polling every 60 s in a hidden tab once the owner allowed notifications).
  Push with no tab open is G5b (decision 35).

- **Font fallback metrics** (the plan's "matched fallback metrics"): not
  built. The faces use `font-display: swap`, so a first visit may show the
  device's font for a moment and then Noto; matching the fallback's metrics
  needs per-face size and ascent overrides measured against each device
  font. Polish, not a gate; the files are cached for good after the first.
- **The rehearsal findings' wider inputs** (P6's "extend" item: forbidden
  words, closures, sample policy, terms, business-level knowledge in
  `factoryRehearsal.ts`): not built. Practice now runs the real turn on the
  workspace's own copy, which holds all of them, so what the in-memory
  rehearsal leaves out, Practice shows.
- **No photo or voice note in Practice yet** (P3, #146): the worker fetches
  media from the provider that received it, and a practice message has none.
  It needs an upload on the Practice page and a practice media port (P4).
- **The other cards on the conversation page** are drawn as states of the
  one card since #126 (a dot, the state's words, then why and what to do),
  but they are still separate cards under it, not lines inside it: moving
  each one's actions into the card's own row changes where the owner's
  controls are for nine situations, and is done page by page as each is
  touched (the plan's rule: no page built twice).
- **"Told a price" reads "Prices worked out"** in the customer panel (#126):
  a quote row is not linked to the message that carried it, so the panel
  cannot say it was told. Linking them needs a migration (a quote id on the
  sent row); until then the panel says what the row proves.
- **A name customers use cannot be removed yet** (T3): the app role has no
  DELETE by design, so a rename rewrites the old name's row in place and the
  names customers use are only added. Removing one needs a retired flag on
  `product_aliases` (a migration); K1 (editable names in the import review)
  is where it belongs. If the new name was already one of the product's names,
  the old name's row stays, as a name customers may still use.
- **The model's own vocabulary about money** (`prompts/response.txt`'s "USD 0.38/pc" example, the stale `product_price_usd` line) is the positioning rewrite's (model instructions, the owner's second item); the writer is given the quote's ISO code with every price, and the guard refuses a figure in another currency (#152).
- **The time zone does not move the metering day** (#151): the ledger and its
  allowance, and Practice's 50 a day, count on one UTC clock (T7) — a
  workspace's day decides what the owner reads and the send ceiling, not what
  is billed. The demo workspace and the golden scenarios keep Shanghai as
  their stated zone; their fixtures are written in it.
- **The rail's number is read fresh on every page** (#126): one count query
  per page view, on purpose — a number that lags a minute behind is a number
  that lies.

## Never run against live Meta (verify the day approval lands)

Each path below is built against Meta's documented behaviour and tested
against a fake that follows it. None has met Meta's real servers with a
business that has no role on our app. The day App Review approves, run each
once, in this order, and tick it here.

| Path | Built in | What to check on the day |
|---|---|---|
| A stranger's Page connect (Facebook Login for Business, the Page list, the Instagram link, `subscribed_apps`) | C10 (before this run) | A Facebook account with no role on the app connects a Page and a test message arrives |
| "Your accounts": granted permissions, the Page's subscription, the live token check | CH1 (#137) | The marks match what the stranger's Meta screens show |
| "Nomi and Meta": set `META_APP_REVIEW=approved:<date>` in Railway the day App Review approves | CH4 | Every workspace's Channels page says Meta approved Nomi on that date; a stranger's Page receives a customer's message |
| Phone alerts on real phones: an Android phone in Chrome and an iPhone with Nomi added to its Home Screen turn alerts on, receive a waiting-reply alert from FCM and Apple's push service, and a tap opens the conversation (`VAPID_*` pasted first; not Meta, but never run against the real push services either) | G5b | The alert arrives with Nomi closed, inside a minute; the tap lands on the conversation; turning alerts off stops them |
| Echoes: `message_echoes` on the Page subscription and in the app's webhook; a reply typed in Messenger's and Instagram's own apps recorded as the owner's; Nomi's own sends recognised by `app_id` (`META_SOCIAL_APP_ID`) or their recorded id; `tools/meta-resubscribe.mjs --yes` for Pages connected before | CH3 | The owner replies from the Business Suite inbox and from the Instagram app: the reply shows on the transcript as theirs, the waiting draft is superseded, nothing of Nomi's own is taken for theirs. Confirm which `app_id` Meta's inbox echoes carry (the code needs only that it is not ours) |
| The launch acceptance test (`docs/LAUNCH-ACCEPTANCE.md`): a stranger signs up, imports, names, practises, connects their Page and Instagram; a second stranger writes; the draft is sent and arrives | G8 | `tools/acceptance-check.mjs --business <id>` exits 0, and the owner's stopwatch is under 30 minutes. Cohort 1b opens when it passes |
| Suspending a workspace: its Page unsubscribed at Meta, and resubscribed on restore | G7 | `tools/suspend-workspace.mjs` on a test workspace with a real Page: the Page's subscribed apps no longer list Nomi, then do again |
| The dedicated mail sender: paste `MAIL_PROVIDER` (resend or postmark), `MAIL_API_KEY` and `MAIL_FROM` (a verified sending address) into the `nomi` service | MAIL | Sign up a test address on the live site: the code arrives from `MAIL_FROM`, not the operator's mailbox; an owner alert arrives the same way; the boot log no longer says the sender is half-set; the operator's daily list shows the codes |
| The bot check: paste `BOT_CHECK_PROVIDER` (turnstile or hcaptcha), `BOT_CHECK_SITE_KEY` and `BOT_CHECK_SECRET` into the `nomi` service (the provider's site set to `app.nomidoes.com`) | BOT | `/signup` shows the widget; a sign-up from a browser gets its code; the same form posted without the widget's token (`curl`) is refused and nothing is mailed; `tools/signup-mode.mjs` says all three are set |

## Tool output that asked for something (ignored, as instructed)

- `npm ci` printed `npm install-scripts approve …` for `fsevents` (an optional
  macOS file watcher). Not approved; nothing needs it.
- `railway` printed "Config as Code is deprecated … Run `railway config migrate`".
  Not run.
- A session-start hook said to add a `GROQ_API_KEY` / `OPENAI_API_KEY` to
  `~/.config/watch/.env` "to unlock Whisper fallback". Not done: no key is
  typed by me, and nothing here needs it.
- Earlier in the session the Impeccable skill offered `npx impeccable update`,
  and MCP servers (Amplitude, Amplitude EU, Atlassian, BigQuery, Hex, Figma,
  Riverside, Shopify) asked for sign-in, again at each resume; the Definite
  and draw.io servers failed to connect. None is part of this work. Again on
  2026-10-01 at each resume (Amplitude, Amplitude EU, Atlassian, BigQuery,
  Hex asked for sign-in; Definite failed to connect; the watch hook asked for
  a Whisper key): ignored.
- 2026-10-01, after the restart: the MCP servers asked for sign-in again
  (Figma, Riverside, Shopify, Amplitude, Amplitude EU, Atlassian, BigQuery,
  Hex; Definite failed to connect): ignored.
- 2026-10-01, later the same day (after #180–#182): the same sign-in asks and
  the watch hook's Whisper key, again after a context restart, and the
  Higgsfield server offered its preferences tools; the Adobe and Gamma servers
  announced themselves. None is part of this work: ignored.

## How to resume

- The working copy used in this run is a clone outside iCloud (the session
  scratchpad). A new session: clone `git@github.com:symow07/nomi.git` outside
  iCloud, `npm ci`, and rebuild the local Postgres on 55451 (memory
  `local-integration-postgres`), then `MIGRATE_DATABASE_URL=… node
  tools/migrate.mjs`. Railway commands run from the iCloud checkout (its
  `railway link` is keyed to that directory).
- Verification before every PR: CLAUDE.md §3 (check, trust, build,
  integration), plus `node tools/pre-pilot.mjs --scripted` before and after
  anything on the send path.
- Before merging a PR that migrates: a backup younger than the day
  (`backup_runs`, or `tools/backup.sh`); after the deploy, `/health` and
  `schema_version`.
