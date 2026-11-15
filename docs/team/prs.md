Recent PRs, newest first:

| # | What |
|---|---|
| 450 | **The hand-off that carries context** (no migration): `GET /app/conversations/:id/copilot` answers three lines as JSON — what the customer wants (the advisor's one worded line, checked, kept until a new message), what was said with each figure's source, what waits on the owner; "Suggest a reply" fills the box with the real turn's words, nothing sent — see §5 rule 102 |
| 449 | **Before it goes live** (0230): a taught fact, a procedure, the voice or a price is staged while the saved cases that touch it run again (each in a rolled-back transaction, each on the ledger, none a draft); the owner keeps or reverts — see §5 rule 101 |
| 448 | **Procedures** (0229): the owner's numbered steps for one situation; the analyser names the one a message starts; one step per turn; the hand-off step is `procedure_handoff`; a step with money, a figure, a promise or an instruction to the model is refused at save — see §5 rule 100 |
| 447 | **The assistant's voice, chosen once** (0228): tone, length and emoji on each assistant, one line "how we talk" scanned by the injection guard; the writer takes them as fixed instructions; no guard reads them — see §5 rule 99 |
| 446 | **A bill with no number** (no migration): the owner ticks "No number on this bill" and the books give it `NOREF-<YYYYMMDD>-<n>`, unique for the day, shown as Nomi's own on the row, the entry and the flash; NB008 untouched — see §5 rule 96 |
| 438 | **Block 1, the no-migration items** — the Bank page offers bank and cash accounts only, none opened; a PDF price list on the OpenAI format; the English survey, thank-you and Telegram greeting signed; B1 the tie-break for B7; the Telegram example token gone; the zone backfill tool and the profile's flag — see §5 rule 92 |
| 437 | **Stripe and the push services named on the privacy page** (D18): their keys no longer stop the boot — every deploy since the owner set them had failed |
| 436 | **Block 1 send path**: the identity path and `wants_deletion` alone pinned; `tools/check-identity.mjs` (3 calls, 3/3 on gpt-6-luna) |
| 427 | **A payment lands in a bank or cash account the owner names**; no invoice promised — see §5 rule 91 |
| 426 | **Honest answers in French; a denied name is a denial** |
| 444 | **Reports in the owner's words**: what you made, money in and out, tax you owe, top customers, unpaid by age — a page and a spreadsheet each, held to the trial balance (no migration) — see §5 rule 98 |
| 443 | **The Books home wired**: Cash today by account; the chart's own money accounts when none are chosen; each figure the sum of its rows (no migration) — see §5 rule 97 |
| 442 | **Spending** (0227): a bill in one form, paid or owed; the owner's categories; recurring costs proposed each period and posted only on a tick — see §5 rule 96 |
| 441 | **Invoices that go out** (0226): a PDF where the channel carries files, the proforma link where not; reminders at +3 and +10 days by e-mail or as a draft; the order-confirmed promise back only where sending is on — see §5 rule 95 |
| 440 | **The books' country packs: Morocco, the United Kingdom, the United States** (0225) — see §5 rule 94 |
| 439 | **Block 1's records** (0224): the quote a reply carried ("Told"), a larger-order price taken off, a practice photo or voice note, the Page unsubscribed on closure — see §5 rule 93 |
| 416 | **The Split Today design, behind `SPLIT_TODAY`** (open, the owner reviews before any merge) — see §5 rule 85 |
| 418 | **Who needs you** (0223): a wine count, a dot, bold until opened; the page was "Customers" everywhere (reversed by the owner the same day, rule 88); Needs attention under the rows that need you; Recent entries' latest event; names and messages take their own direction — see §5 rule 86 |
| 420 | **The OpenAI format under the one client, a warm sentence before a question, a customer is 您** — see §5 rule 87 |
| 421 | **The Inbox in the Split look; the page is "Inbox" again** (no migration) — see §5 rule 88 |
| 423 | **The last message back on the Inbox's rows**, one faded line (no migration) — see §5 rule 88 |
| 422 | **The fallback answers at Anthropic's own address; both companies named wherever words go** — see §5 rule 89 |
| 425 | **The assistant says "I" and promises only what happens; the model that answered is recorded; what Anthropic keeps on the pages** (no migration) — see §5 rule 90 |
| 426 | **Honest answers in French; a denied name is a denial in six languages** (no migration) — see §5 rule 4 |
| 141 | **The review pass** — every page in three languages read; no raw catalogue key on any page (walk + typed Practice labels); History names the customer; the run's 278 zh/ar lines in `docs/NATIVE-REVIEW-UI.md` — see §5 rule 39 |
| 140 | **Names, People, Setup, the door, the live line in the headers** — see §5 rule 39 |
| 139 | **Right to left, by design** — `src/api/web/values.ts`, every value isolated on Arabic pages, the Arabic walk — see §5 rule 38 |
| 138 | **Today by time** — who needs you now, the last 24 hours, coming up; plural rules — see §5 rule 37 |
| 137 | **CH1 + CH2 — "Your accounts" read live on Channels, and the help page** — see §5 rule 36 |
| 136 | **CEIL — 50 a day for a new workspace (0085), and an hourly Meta-errors alarm** for the operator — see §5 rule 35 |
| 135 | **FAIR — the inbound queue shared fairly between workspaces**: a group per workspace, three workers, one at a time per workspace — see §5 rule 34 |
| 134 | **REKEY — `CREDENTIAL_KEY` rotation without a token lost**: the app reads with the previous key during a rotation, `tools/rekey.mjs` re-seals, the doc rewritten around it — see §5 rule 33 |
| 133 | **PWR — "Forgot your password?"** (0084): a one-time link by e-mail, the same words whether or not the address signs in here — see §5 rule 32 |
| 132 | **Q1 — the analyser sees the last six messages**, as its prompt promised; the live check before and after, with history cases — see §5 rule 31 |
| 131 | **T3 — imported products can be found** — names written at import and edit, name editing, "ready" only when findable, the backfill tool (not run on Westlake) — see §5 rule 30 |
| 130 | **T7 — every paid call on the ledger** — its own transaction, photos, voice notes, catalogue pages and live Practice metered, one UTC clock, the deepseek price and the first per-turn figures — see §5 rule 29 |
| 129 | **Small truths** — T1 (the sandbox is the pilot's alone), T5 (the reader refuses a cut-off page; two unkept promises gone), CH5 (the window's clock), CH7a (what arrived, by name) — see §5 rule 28 |
| 128 | **What a reply promised, on the calendar** (0083) — follow-ups, prices that end, deliveries, read from the words that left — see §5 rule 27 |
| 127 | **The calendar week, and the owner's own dates** (0082) — see §5 rule 26 |
| 126 | **The design foundation, part two: the shell** — the rail in groups with its one number and Log out at the foot, the list and the customer panel beside a conversation, the other cards drawn as states — see §5 rule 25 |
| 125 | **The design foundation, part one** — buttons and doors (the rule and its test), the palette (graphite, magenta for the assistant's hand; jade, highlight, warm papers and dark mode retired), Noto served by the product with one font order per language, the approval card — see §5 rule 25 |
| 124 | **Spanish and French — the disclosure and every safety check**; the gate shut until a reviewer reads es/fr (rule 1); **T2** (the guard holes) |
| 123 | **A product may have no minimum** (0081) — see §5 rule 24; T4 (the price list read honestly); PRODUCT.md's description |
| 122 | **An order waits for the owner's tap** (0080, T6/T6b) — see §5 rule 23; `docs/PROGRESS.md` begins the roadmap run |
| 121 | **"Told" is what reached the buyer** (0079) — see §5 rules 3 and 19; the positioning recorded (§0) and inventoried (`docs/POSITIONING-INVENTORY.md`) |
| 120 | **A shop's opener is answered; asked again after the disclosure, it hands off** — see §5 rule 19; openers first message 35/35 handed off → 0/35, after the disclosure 35/35; and a deletion request that reads as an injection ("Forget everything you know about me") is the silent hand-off, not the injection's canned reply |
| 119 | **"Wants a person" built out in Chinese and Arabic** — layer 1 misses 40/115 → 0/115, no new false fire; `tests/person/person-corpus.ts` (three groups × three languages) through the real turn; the identity rule no longer reads 真人秀 as "a real person?" |
| 118 | **Buyer-facing Arabic:** the privacy page says «مساعد آلي»; the disclosure and one fixed reply no longer address the buyer in the masculine; all 103 buyer-facing Arabic strings held by `tests/parity/buyer-arabic.test.ts`; the two Chinese labels kept on purpose |
| 117 | **The disclosure gate is open** — Arabic «مساعد آلي» for «المساعد الذكي», zh/ar signed off by the owner, `DISCLOSURE_NATIVE_REVIEW` all true; see §5 rule 1 |
| 116 | **Decision 5 recorded in Symow's words, provisional**; the calendar's kind becomes the first word of its line (not a pill); `docs/UI-PASS-CANDIDATES.md`, the later pass's list |
| 115 | **`tools/add-login.mjs`** — a login for a workspace that exists, and `/login/set-password` (0078) — see §5 rule 22; integration hooks outlast a graceful stop (`--hookTimeout`) |
| 114 | CLAUDE.md handoff; ROADMAP §2b; the usability script after A |
| 113 | **The audit's last items** — see §6 |
| 112 | **CC-26 live refresh** — see §5 rule 21 |
| 111 | **A: Buyers and Customers are one list, searched and paged; the V1 close-out** — decision 5 (the row stays), stylesheets served as files, one `<style>` left on purpose; see §5 rule 20 |
| 110 | **"Wants a person" in two layers; a message nobody could read goes to a person** (0077) — see §5 rule 19; `tools/check-person-model.mjs` |
| 109 | Batch prep: the `not_answered` reason's words; the person-request test in its own folder |
| 108 | CLAUDE.md handoff |
| 107 | **"Wants a person": the buyer's own manager is not a request for a person** — see §5 rule 19; plus the usability seed's freshest conversation is always today's (the Monday-00:12 flake) |
| 106 | CLAUDE.md handoff |
| 105 | **The deletion request is written down when it arrives, and has its own alert** (0076) — see §5 rule 18 |
| 104 | CLAUDE.md: the corpus holds 43 requests, not 50 |
| 103 | CLAUDE.md handoff |
| 102 | **A deletion request in chat goes to a person; nothing is sent** (0075) — see §5 rule 18 |
| 101 | CLAUDE.md handoff |
| 100 | CC-25 leftovers — `conversationUrl()` (layout.ts) is the only way to address a conversation: every action redirect and every link lands at `#latest`, the notice renders there (`flashBanner` id); Practice puts its transcript before its draft (`practiceUrl`) |
| 99 | **Backup retention** — `backup/retention.sh`: dailies 60 days, manual pairs (bucket root and laptop) 180 days, by the UTC time in the name; never undated / just-made / newest / newest-complete / future copies. Laptop copies prune only when `tools/backup.sh` or `fetch-backup.sh` runs (`KEEP_ALL=1` skips). The `backup` service's `RETENTION_DAYS` variable is no longer read |
| 97 | **CC-10** — error reporting (`app_errors`, 0074, operator e-mail, rate-limited) and the uptime heartbeat (`HEALTH_PING_URL`); `railway.json` health check |
| 96 | **CC-02b** — `tools/erase-buyer.mjs`: carries out one buyer's deletion request per the contract; schema-driven, refuses what it cannot classify |
| 95 | **CC-25** — the conversation page shows the newest 50, pages back by cursor, transcript above the approval; verified on a 450-message thread |
| 94 | **CC-02a** — a buyer deletion request (buyer file → `/app/settings/data`, 0073), `/data-deletion` rewritten to what happens, the `deletion_due` alert; plus the PRIVACY-zh personal address removed and `erase-workspace` completed |
| 93 | Operator alerts: `deliverOperatorAlert` / `OPERATOR_ALERT_KINDS` (the backup alert's delivery, for any kind) |
| 91 | **CC-24** — the owner's words survive a refusal (0072): the edit box opens with the draft or the kept edit; a refused edit is kept on the draft; a refused own reply waits in the box |
| 90 | **The emergency silence hides nobody** (0071) — `global_silence` hands each buyer to a person (`ops_silenced`); hand-back / approve / edit refused; Today and My business say sending is paused |
| 88 | **The owner's Stop, on every channel** (0070) — see §5 rule 13; queued replies cancelled at send time, silent while stopped, waiting buyers handed to a person so they stay on Needs you; hand-back / answer-now / approve / edit refused while stopped |
| 87 | Tests never write into the tree — the phantom 2962 (the m45 probe wrote `tools/.probe-check.mjs` while `no-secret-in-argv` enumerated `tools/`); `tests-leave-the-tree-alone.test.ts` |
| 86 | My business: going live is per channel; Stop names WhatsApp |
| 85 | `check-reachable` flushes before it exits (the flaky m45 probe on CI) |
| 83 | **V2 the calendar** — `/app/calendar` (Buyers hub, door from the Buyers list): dates already on record per buyer — samples, order updates, quotes, open handoff deadlines, follow-ups (outreach area only), closures, closed conversations; category tabs + buyer select; past 7 + next 14 days; every row `data-src="table:id"`; category is the neutral `span.chip` until decision 5 gives V1's row tag; no new `<style>` (still 6); screenshots `docs/design/v2-calendar/` |
| 82 | **Phase 4a permissions** — money and going live are the owner's: products (edit/add/photo/price list), rate, sample policy → `price_rules`; attestations, assistant name, validate, allowlist, WhatsApp test/disconnect/reconnect, owner phone → `messaging_activation`; staff see values + `staff.ownerDecides`, never a form that refuses them |
| 81 | **Phase 4b first run without WhatsApp** — one definition of connected (`src/db/connectedChannels.ts`); any channel completes Setup's step; My business lists every channel (allowlist only under WhatsApp); refusal names no channel; placeholder from sign-up country (`callingCodes.ts`); one word "Practice"; machine room → owner-only `/app/onboarding/technical`; KB 02 true |
| 80 | **Phase 5 site** — the app serves nomidoes.com: `SITE_HOSTS` hosts get the site on `/` and 301 `/app*`,`/login`… to `PUBLIC_BASE_URL`; preview `https://app.nomidoes.com/site` (noindex); copy under `site.*` in three locales; `docs/SITE-DNS.md` |
| 78 | **V1 review fixes** — `.who` → `.person` (the stacked header), no face + quiet caveat on the assistant's page, products a dense list with marks only for what is NOT fine, `.stats/.rows` at the prose measure, `dir="auto"` on speech, titles on Today/Practice/Knowledge, one door idiom (`deeper next`) |
| 77 | `docs/DESIGN-V1-REVIEW.md` — a designer's pass, five worst things with screenshots |
| 76 | CLAUDE.md handoff |
| 75 | **V1 step four, the batch** — eleven pages' blocks moved into `STYLE_PAGES` (served with the shell only), legal/unsubscribe/proof share `publicDocument()`; baseline 29 → 6 (the shell's three, Buyers' two, Customers' one) |
| 74 | V1 step four, Today: counts are the shell's stat rows, tappable; the calm state moves to the shell; 30 → 29 |
| 73 | CLAUDE.md handoff |
| 72 | **V1 step four, batch one** — ten small pages retire their `<style>` blocks onto shell families (`.rows/.row`, `.who`, `.caption/.small`, `ul.chips`, `.pill.stop`, `.issued .code`, `.choices`); baseline 40 → 30 |
| 71 | CLAUDE.md handoff |
| 70 | **V1 option A** — no header band on any width; language switch + log out are Setup's first rows; `header.stage` retired; switcher encodes only when needed; phone chrome at rest 80–87 px (`docs/design/v1-chrome/built-A-*`) |
| 69 | Brief §11: the phone chrome at rest — four options measured, A recommended |
| 68 | **V1 step three** — the shell: sticky compacting phone nav (CSS scroll timeline, no script), the name band scrolls away, the mark is the product's (small cut in the phone nav), the Setup count beside its word; `tests/parity/v1-shell.test.ts`; measured in `docs/design/v1-step3/` |
| 67 | CLAUDE.md handoff |
| 66 | **V1 step two** — 17 shared families defined once in the shell, homonyms renamed, browser-drawn controls styled, `.is-hover`/`.is-focus` twins + quiet `:disabled`; `/app/settings/components` (signed-in, door on Setup); `tests/parity/v1-one-stylesheet.test.ts` (no class in two files; `<style>` count ≤ `tools/style-baseline.json` = 40, may only fall) |
| 65 | CLAUDE.md handoff |
| 64 | **V1 step one** — type scale 13/15/17/20/26/34, line-height per script on `html[lang]`, spacing without 64; 127 remaps, the seven size-22 calls reviewed by Symow; `tests/parity/v1-tokens.test.ts`; the channels headline pill wraps |
| 63 | V1 brief §8: Symow's decisions 1–4 recorded; 5 (the row) deferred until after the usability session |
| 62 | V1 brief `docs/DESIGN-V1-BRIEF.md` + reference screenshots; `tools/screenshots.mjs` login fixed |
| 61 | The usability workspace: `src/demo/usability.ts` + `tools/seed-usability.mjs` lay the script's prerequisites over the demo factory on a local instance and check them line by line; `smoke.sh` needs `LEGAL_CONTACT_EMAIL` and a 3-minute health wait; symbol ceiling 21 → 22 (argued in the baseline) |
| 60 | ROADMAP §2b: the post-audit queue with V1 (visual design pass) and V2 (calendar view) |
| 58 | `backup/run.sh`: the TOC check must not pipe into `grep -q` (pipefail); found by the first live run |
| 57 | Scheduled backups: `backup/` Railway cron on the private network (dump → restore drill → encrypt → upload → prune → `backup_runs` 0069 → ping); daily stale check → owner alert by **e-mail always**, WhatsApp where live; Getting ready "Backup tested" checked for the owner; `tools/fetch-backup.sh` for the monthly laptop drill |
| 56 | The database password never appears in a command line (`tools/lib/pgenv.py`, argv test) |
| 55 | CLAUDE.md: D deployed |
| 54 | IA **D**: Setup joins the nav (five entries), the drawer splits, setup count + Today card, outreach area behind `businesses.outreach_area` (0068; on for Westlake only) |
| 53 | No pronouns for the assistant; a name counts only once chosen; Arabic addresses nobody in a gender; 1266 catalogue lines; `docs/NATIVE-REVIEW-UI.md` |
| 52 | Operator tools fail loudly on a database that stops answering (`tools/lib/db.mjs`, `backup.sh` limits) |
| 51 | CLAUDE.md handoff |
| 50 | Assistant identity: denial guard + context rule, prompt rule, /privacy line, name gate, AI disclosure, native-review gate |
| 49 | Day-one test deterministic; pruner takes orphaned pg-boss jobs; M13 test owns its facts |
| 48 | No test reaches a real model (`offlineModels()`) |
| 47 | Phase 2 follow-ups |
| 46 | IA **B + C**: shell reads the hub map, Results door, hardcoded names removed, nav label follows assistant count |
| 44 | IA **A9** |

