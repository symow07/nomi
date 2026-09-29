# Nomi — handoff for the next session

**A roadmap run is in progress (from 2026-09-29): read `docs/PROGRESS.md`
first.** It says what shipped, what is next, what waits on the owner, and how
to resume — without asking the owner anything.

Last updated **2026-09-29**, after #123 — **a product may have no minimum**
(0081, §5 rule 24) with T4's honest price-list reading, and PRODUCT.md's
description rewritten to the positioning. Before it, #122 — **an order waits
for the owner's tap** (0080, rule 23). Before that, #121 — "told" is what REACHED the buyer
(0079): a shop's opener asked again hands off only once a message carrying the
disclosure was accepted by the provider, in draft and auto alike (§5 rules 3,
19). The positioning is recorded in §0 — read it before writing any copy.
Before it, #120 (shop openers), #119 ("wants a person" in zh/ar), #117 (the
disclosure gate is open, rule 1), #115 (`tools/add-login.mjs`, 0078) and the
"clear the queue" batch (#110–#113). Written so the next session needs nothing from the
one that wrote it.

Nomi is a server-rendered Fastify + Postgres app: an AI sales employee
("Lily" by default — but the name is the owner's, see below) that answers a
business's customers on Instagram / Messenger / WhatsApp / e-mail, drafting or
sending under rules the owner sets. Owner UI in en / zh / ar (RTL).

---

## 0 · What Nomi is — the positioning (the owner's, 2026-09-28)

**Nomi is for anyone who sells or talks to customers over social media:**
clothing and cosmetics brands, online stores, startups, agencies — and
exporters and factories too. **Global, not China-specific.** The common thread
is social media as the sales channel, not manufacturing.

- It is **not** a tool for Yiwu factories. The first pilot sells canvas bags,
  and the code grew up around export trade — buyers, quotes, MOQ, lead times,
  samples, factory closures, `/app/factory`, `BUSINESS_TZ = 'Asia/Shanghai'`.
  That history is not the product; do not let it back into new work.
- **Before writing any copy, prompt, help article, page or seed data**, read
  it as a cosmetics brand and as an online clothing store would. A business's
  customer is a *customer*, not a *buyer*; most never receive a *quote*, have
  no *minimum order*, no *lead time*, no *factory*.
- **Every place the product's words still assume export trade is listed in
  `docs/POSITIONING-INVENTORY.md`** — customer-facing and owner-facing
  separately, each with a suggested neutral wording, and the ones that cannot
  go neutral and must vary by kind of business flagged. Nothing has been
  rewritten yet (the owner's order: inventory first). When copy is rewritten,
  work from that list and keep it current.
- New work adds no export- or China-only assumption: no default currency,
  timezone, country, channel or language that presumes one; quantity tiers and
  minimum orders are optional features of some businesses, never the frame.
- Code identifiers may keep their old names (renaming code is not copy);
  anything a person reads — including URLs in the address bar and text the
  model is told to write — may not.

## 1 · How to talk to the user

- The user has ADHD and runs the `i-have-adhd` skill: **lead with the next
  action**, numbered steps, ≤5 items per list, restate state each turn,
  concrete time estimates, no preamble / recap / closers, matter-of-fact about
  errors.
- Standing instruction: plan, then build **without asking**; report back when
  done. Ask only when a decision is genuinely theirs.
- They review carefully and push back with specific corrections. When they
  name a requirement, meet it literally *and* check what it implies (e.g. "gate
  the page" also meant "gate the send").

## 2 · Rules that are not negotiable

**Security**
- Never type passwords, tokens or API keys into anything; never create
  accounts. Secrets are pasted into Railway by the user.
- Read Railway variables by **name only** (`railway variables --json` prints
  values — pipe through a script that prints keys). Run anything that needs a
  secret *inside* `railway run --service <svc> -- …` so it never appears in a
  command line or in output.
- The user's e-mail identifies them; never send it to an outside service.
- The GitHub repo is **public**: never commit tokens, invite links or personal
  data.

**Destructive actions**
- You do not permanently delete things. Move them (e.g. to the scratchpad)
  and let the user delete. This includes iCloud `* 2.ts` duplicates and stale
  git refs.
- **Never edit an applied migration.** G20 checksums (`tools/migrate.mjs`)
  catch it. Write a new migration instead.

**Before any deploy that migrates:** a backup younger than the day — the
Railway cron (`backup/`, 03:00 UTC, see `docs/BACKUP-RESTORE.md` "Scheduled
backups") normally provides it; check `backup_runs` or the bucket's `daily/`.
Otherwise `tools/backup.sh` by hand. After the deploy, confirm `/health` and
that `schema_version` equals `REQUIRED_SCHEMA_VERSION`. See
`docs/LAUNCH-CHECKLIST.md`.
- A connection URL is never a command argument: pg tools get the password
  through the environment (`tools/lib/pgenv.py`; the cron job uses Railway
  reference variables). `tests/parity/no-secret-in-argv.test.ts` holds it.

**Tooling quirks**
- The Bash safety classifier sometimes times out. Keep shell calls simple;
  prefer small Python scripts in the scratchpad for multi-anchor edits (assert
  each anchor occurs exactly once). If blocked repeatedly, give the user the
  exact command.
- The checkout lives in an **iCloud-synced Desktop**: it spawns `* 2.ts`
  duplicates that break `tsc`, and `.git/refs/heads/main 2` that breaks
  `git pull`. Move them to the scratchpad. `git fetch`/`pull` can hang for an
  hour there: run them with a time cap, and `kill` the stuck `git fetch` (see
  `ps`). The user has the steps to move the repo to `~/dev/nomi`; if it has
  moved, the Railway CLI needs `railway link` again (its link is keyed by
  directory path) and the memory folder key changes.
- Ad-hoc production reads: `psql` inside `railway run --service Postgres`,
  read-only, retried — the Node driver stalls on the public proxy. Operator
  tools use `tools/lib/db.mjs` (connect + reply limits, PR #52).
- No foreground `sleep`; use an `until …; do sleep N; done` loop or a
  background command.

## 3 · Verification set (run all four before a PR)

```bash
env -u DATABASE_URL -u MIGRATE_DATABASE_URL npm run check     # typecheck, boundaries, ~3040 unit
npm run trust                                                 # 41/41 golden scenarios (44 tests)
npm run build
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55451/nomi \
DATABASE_URL=postgresql://nomi_app:nomi_app@127.0.0.1:55451/nomi \
  node tools/run-integration.mjs                              # ~862, none skipped, ~5 min
```

For anything touching sending, also `node tools/pre-pilot.mjs --scripted`
(12/12) with the same two DB vars, **before and after**. For anything touching
the analysis prompt or the model (`LLM_MODEL` / `LLM_BASE_URL`), also the live
check, before and after: `npm run build && railway run --service nomi -- node
tools/check-person-model.mjs` — a model that stops answering `wants_person`
hands EVERY analysed turn to a person (§5 rule 19). Never run it while
the integration suite runs (both start pg-boss workers on the same queues).

The integration runner prunes earlier runs' tenants **and their queued pg-boss
jobs** first (PR #49). If integration goes flaky, suspect leftover state
before suspecting code.

**PR flow:** branch → `gh pr create` → `gh pr checks N --watch --fail-fast` →
`gh pr merge N --merge --delete-branch` → poll
`railway deployment list --service nomi --json` until the merge commit is
`SUCCESS` → `curl https://app.nomidoes.com/health`. Gate chained steps with
`&&`. Commits end with the Co-Authored-By line; PR bodies with the Claude Code
footer.

## 4 · What is live (production, 2026-09-28)

- **Deployed:** the merge of #123 (`528203b`, 0081 — no minimum), 2026-09-29 07:41 UTC; production `schema_version` = **81**; backup before it `~/nomi-backups/nomi-backup-20260929T072729Z` (schema 80, drill 4/4). Before it, the merge of #122 (`9581518`, 0080 — an order waits for the owner's tap), 2026-09-29 07:03 UTC. Backup before it: `~/nomi-backups/nomi-backup-20260929T064304Z` (manual, schema 79, drill 4/4 — see `docs/PROGRESS.md` "Found on the way": no scheduled backup could pass its drill since 0078 until #122 fixed the drill). Before it, the merge of #121 (0079, the disclosure delivered). Before it
  #120 (shop openers), #119, #118, #117 (the gate), #116, the merge of #115
  (`tools/add-login.mjs`, 0078), `079d776` (#113, the audit's last items), #112 (CC-26), #111 (A + the V1
  close-out), #110 (0077, "wants a person" in two layers). `/health` → `{"ok":true,"db":true,"worker":true,"provider":"active"}`;
  production `schema_version` = **79**; no business is stopped and no silence flag is on; exactly one business has `outreach_area` on (59 businesses). Backup before 0078 and 0079:
  `nomi-backup-20260928T030213Z` (drill passed; PITR on).
  `TRANSCRIBE_API_KEY` is unset in production — if it is ever set, the privacy
  page must name that processor too. **`HEALTH_PING_URL` is unset** — the app
  says so at boot; until the owner pastes a Healthchecks.io URL
  (`docs/MONITORING.md`), nothing outside Railway notices if the app stops.
- **Schema:** 79. Last three: `0077 not_answered`, `0078 login_setups`,
  `0079 disclosure_delivered`.
- **Scheduled backups are LIVE** (2026-09-23): Railway service `backup`
  (cron `0 3 * * *`, private network, `backup/README.md`). First proven run
  `nomi-backup-20260923T102036Z`: 1.6 MB, schema 69, drill 4/4 in the
  container, laptop `verify-restore.sh` 4/4 on the encrypted copy, one row in
  `backup_runs`. The app alerts the owner by e-mail (and WhatsApp where live)
  when no run completes for 36 h. **PITR is enabled** on Postgres (WAL to a
  Railway bucket; the window starts from the first base backup after
  enabling). Still the owner's: paste a Healthchecks.io ping URL into the
  service as `BACKUP_PING_URL`, and do the monthly laptop drill
  (`tools/fetch-backup.sh` → `tools/verify-restore.sh`).
- **Backup before this deploy:** `~/nomi-backups/nomi-backup-20260923T035402Z`
  (schema 67; dump 1.5 MB; roles 938 B), encrypted and uploaded to the
  `nomi-backups` bucket. The proxy dropped several attempts first; the
  script's new guards stopped each one cleanly ("Nothing was written"). Run it
  with `ATTEMPT_LIMIT=120 ATTEMPTS=6 QUERY_LIMIT=30` on a bad day.
  The previous pair (`…20260922T142658Z`, schema 64) was restored and compared
  against production on 2026-09-22 — 85 of 86 tables identical, the one
  difference `pgboss.job` (jobs queued after the dump).
- **Fleet:** 59 businesses; **1 live** — Westlake Canvas Co.,
  `7dc89f42-852e-465a-920f-8af170dc83cd`, the user's own (find it with
  `channels.activated_at is not null`), six capabilities set to auto. The owner
  was confirming its assistant's name on Getting ready on 2026-09-23.
  Traffic is low (8 employee sends in the 7 days before #50).

Recent PRs, newest first:

| # | What |
|---|---|
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

## 5 · Open rules in force right now

1. **The disclosure gate is SHUT again since 2026-09-29 (#124): Spanish and
   French await a native reader.** The owner's instruction added es and fr to
   the disclosure and to every safety check, "awaiting native review — do not
   set them true yourself". `DISCLOSURE_NATIVE_REVIEW` = `{ en: true, zh: true,
   ar: true, es: false, fr: false }`, and the gate is installation-wide by
   design, so **nothing sends alone anywhere** (Westlake's auto included) until
   a reviewer reads the two sentences and the flags flip — in one commit that
   names the reviewer and updates `tests/integration/autonomy-level.test.ts`
   and `tests/pipeline/disclosure.test.ts`. Everything else for es/fr is built
   and tested. Before that, the gate was **OPEN from 2026-09-28** (#117): the owner read the
   zh and ar sentences; the Arabic now says «مساعد آلي» (an automated
   assistant) where it said «المساعد الذكي» ("the smart assistant"), and (#118)
   addresses the buyer in neither gender: «مرحبًا، أنا {name}، مساعد آلي لدى
   {business}. للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت
   ممكن.» The Chinese is unchanged. `DISCLOSURE_NATIVE_REVIEW` in
   `src/core/conversation/disclosure.ts` was `{ en: true, zh: true, ar: true }`.
   The mechanism stays, on both owner routes that turn autonomy on and at the
   send decision in `commitTurn` (`autonomy_withheld: disclosure_not_reviewed`):
   a disclosure locale added later starts `false` and closes it again for every
   workspace until it is read; `tests/integration/autonomy-level.test.ts` pins
   the real flag and proves the refusal with the gate held closed.
   **What sent alone while it was open** (production, 2026-09-28): only Westlake Canvas Co.
   — the one workspace with capabilities on auto (greet, qualify, recommend,
   quote, negotiate, follow_up), its name confirmed, not stopped. Replies to a
   buyer's message go out without approval on Instagram and Messenger (anyone
   who writes first, inside the platform's window) and on WhatsApp only to
   numbers on its pilot list (one); the first such reply in a conversation
   carries the disclosure. Confirming an order stays the owner's (`confirm_order` never auto); e-mail answers
   always go to a person; holds (a voice-note quantity, a discount past the
   ask-first line) and hand-offs still draft or stop. The ~54 demo copies with
   greet/qualify on auto still draft: no confirmed name, no activated channel.
2. **The assistant's name must be confirmed** (Getting ready →
   `onboarding_state.assistant_named_at`) before activation, and before
   anything sends alone. The live workspace must confirm its name.
3. **Any message sent without approval** carries the AI disclosure on the
   first such message of a conversation; again whenever a buyer asks what they
   are talking to. A reply the disclosure replaced cannot be sent unchanged
   (`needs_edit`).
   - **"First" is counted by what reached the buyer** (0079, #121): `conversations.ai_disclosure_delivered_at` is written by the send path (`driveConversationOutbound` → `markDisclosureDelivered`) the moment the provider accepts a message that carries the sentence (`carriesDisclosure`, any language, any name, the earlier Arabic wording) — whoever wrote it: a reply sent alone, the sentence sent when a buyer asked, an approved draft or an owner's reply that carries it. Never by queueing, never by `saveState` (a turn's stale copy must not erase it). A reply carrying it that was refused (Stop, hand-over, allowlist) or failed — including one the provider accepted and its status webhook later reported failed (`reconcileStatus` rebuilds the stamp from what still stands) — told nothing, so the next reply sent alone says it again. Until one is accepted EVERY reply sent alone carries it: a queued one may still fail and a reply can overtake it, so two replies queued before either leaves both say it (read twice, rarely — never zero; the review of #121 found the "on its way" shortcut could send a reply with none). `ai_disclosed_at` (0066) stays: when it was first QUEUED. Approved drafts still never get the sentence added (a person answered) — so a workspace that only drafts never tells anyone.
4. **She never claims to be human** (`src/core/safety/identity.ts`). Self-denial
   only; handoff offers must pass. The context rule fires on a *question about
   the interlocutor*, never on a message that merely contains "real person".
5. **Owner-facing copy never says "AI" / 机器人 / 系统 / 模型**
   (`BANNED_OWNER_TERMS`). The only exceptions are listed by key in
   `HONEST_ABOUT_AI_KEYS` — buyer-facing sentences whose job is to say it.
6. **Nobody is gendered in copy** (decided 2026-09-23).
   - The assistant has **no pronouns**: `{name}`, or reword. Never she/her/it/they, 她/他/它, or an Arabic verb or suffix that agrees with her.
   - Buyers are "they" / 买家 / 对方, and in Arabic no pronoun agrees with them.
   - Arabic addresses the owner (and a buyer on a buyer page) in **neither** gender:
     - verbal nouns for buttons;
     - a noun phrase, the passive, or «يمكن / يُرجى» for sentences;
     - the unvowelled ـك is fine;
     - no plural address.
   - `tests/parity/assistant-pronouns.test.ts` holds this. Its lists live in `assistant-pronouns.lists.ts`.
   - Reworded zh/ar lines wait in `docs/NATIVE-REVIEW-UI.md`. That list is **not** a gate.
   - **Buyer-facing Arabic too** (swept 2026-09-28, #118): the catalogue's `legal.*`, `unsub.*` and `proof.*`, the disclosure and the fast path's fixed replies — 103 strings — address the buyer in no gender, and call the assistant «مساعد آلي», never «ذكي». `tests/parity/buyer-arabic.test.ts` holds it.
7. **Names come from the `assistants` table**, via `withAssistantName` / `assistantName(locale)`, and **count only once chosen**.
   - The main assistant's row name is a default until Getting ready stamps `assistant_named_at` (`chosenName` in `src/db/assistants.ts`). Until then, owner copy says "your assistant" / 你的助手 / مساعدك (`ASSISTANT_FALLBACK`), and the model gets no name.
   - `DEFAULT_ASSISTANT_NAME` is only the row's value at birth. There is no `EMPLOYEE_NAME` any more.
8. **The outreach area is per workspace, OFF by default** (`businesses.outreach_area`, 0068).
   - Off means: every `/app/contacts|prospects|sequences` and `/app/channels/outreach` address is 404 (preHandler in `app.ts`, `isOutreachRoute`), no page links there, and `outreachFacts` reports not enabled, so nothing is written first — whatever `outreach_settings` says.
   - No owner switch. Operators use `node tools/outreach-area.mjs --business <uuid> --on|--off`.
   - On for Westlake Canvas Co. only.
9. **Every page draws from `workspaceFacts`** (`src/db/workspace.ts`): name, several, outreach, and the five-step setup progress (`src/db/setup.ts` — profile, products, name, channels, first reply). Cached a minute per business in `app.ts`; every write that completes a step calls `facts.evict`. The Setup nav entry shows `done/total`; Today shows a "finish setting up" card; both vanish when complete.
10. **The backup alert never depends on WhatsApp.** `backup_stale` (daily check, `QUEUES.backups`, 06:30 UTC; rule in `src/core/ops/backups.ts`, 36 h) goes by e-mail to the owner's sign-in address always, and by WhatsApp only where a channel is live (`deliverBackupAlert` in `src/pipeline/notify.ts`). `tests/integration/backup-watch.test.ts` proves it fires with no channel connected. The job writes `backup_runs`; the app may only read it.
11. **Money and going live are the owner's** (Phase 4, 2026-09-27). Staff may teach facts, set closures, forbidden words, the business profile, and record a sample's address/handled — nothing that changes a price or a go-live condition. Guards are the existing `OWNER_ONLY` actions (`price_rules`, `messaging_activation`); renderers take a `Viewer`. `tests/integration/phase4-permissions.test.ts` snapshots every table the gated routes write.
12. **nomidoes.com is served by this app** (`SITE_HOSTS`). The site states nothing unbuilt: no price, no trial, invite-only CTA to the legal contact address. `tests/parity/site.test.ts` holds it.
13. **The owner's Stop binds the assistant on every channel** (0070, 2026-09-27; `src/db/assistantStop.ts`).
   - `businesses.assistant_stopped_at`, set and cleared only by the owner (`/app/factory/stop-assistant`, `/start-assistant`, `messaging_activation`). Separate from WhatsApp's activation and from the ops kill switch (`ops_flags` is read-only to the app, so Start can never lift an operator's silence).
   - While set: the send gate refuses the assistant's messages and automated follow-ups (`stopped`, at send time — a reply queued before Stop is cancelled, never sent late); the worker runs no turn — each message is recorded (media named, not opened) and the conversation handed to a person (`assistant_stopped` signal), which keeps the buyer on "Needs you"; hand-back (`resumeAi`, so also answer-now) and approve/edit are refused and the draft stays pending. The owner's own replies always go.
   - Start leaves conversations handed over during the stop with their person. `tests/integration/assistant-stop.test.ts` holds all of it; each guard is proven load-bearing by switching it off.
   - **The ops kill switch behaves the same** (0071): while `global_silence` is on, the worker hands each buyer to a person under `ops_silenced` (not the owner's reason), and hand-back / approve / edit are refused (`assistant_silenced`). One question answers both: `assistantHold` in `src/db/assistantStop.ts` (ops first). Today and My business say sending is paused. `tests/integration/ops-silence-handoff.test.ts`.
14. **The owner's words survive a refusal** (CC-24, 0072; `src/db/ownerWords.ts`). The draft edit box opens with the draft itself, or with the owner's kept edit (`drafts.owner_edit`). An edit refused anywhere — the approval path's hold refusal, or the route's window/allowlist verdict — is kept on the draft; the owner's own reply refused before queueing is kept in `conversations.owner_unsent_reply` and cleared when a reply goes. Nothing kept is sent except by the owner pressing send again. `tests/integration/kept-words.test.ts`.
15. **A buyer's data can be deleted, and /data-deletion says exactly how** (CC-02; 0073).
   - The owner records it on the buyer file (`/app/conversations/:id`, owner-only `data_rights`; one open request per buyer); `/app/settings/data` lists it with its due date (asked + 30 days). The legal contact gets a notice the day it is recorded; the daily `deletion_due` operator alert fires from 7 days before the date (`deletion_requests_due()`, security definer).
   - The operator carries it out with `tools/erase-buyer.mjs --request <id>` (admin role; dry run by default; `--yes --confirm <8 chars> --by "<name>"`; refuses anything it cannot classify). Erased: the buyer's identities, messages, drafts, quotes, samples, signals, events, their conversations. Kept: orders (detached from contact details), do-not-contact entries, the request row. `/data-deletion` promises exactly that and nothing more — no automatic confirmation to the buyer.
   - `tools/erase-workspace.mjs` also erases `shadow.turn_decisions` and the workspace's queued jobs, and refuses a row-security-filtered role (found 2026-09-27; `tests/integration/erase-workspace.test.ts` runs it for real).
16. **The conversation page always shows the newest messages** (CC-25): newest 50 (`TRANSCRIPT_WINDOW`, `src/db/transcript.ts`), "Earlier messages" pages back by cursor (`<epoch_ms>_<uuid>`, tenant-checked); transcript first, then the draft and take-over cards; Buyers rows land on `#latest`. Practice and the buyer file use the same window.
17. **Errors are reported and the app has a heartbeat** (CC-10; 0074; `docs/MONITORING.md`). Every 5xx, failed queue job, dead letter and process crash upserts `app_errors` (redacted, fingerprinted) and sends the operator an `app_error` e-mail — once per fingerprint per 6 h, at most 6 an hour. `tools/errors.mjs` lists them. Every 5 minutes the app checks its DB and its own `/health` and pings `HEALTH_PING_URL` (`/fail` when unhealthy) — the dead-man's switch; unset until the owner pastes it. `railway.json` has `healthcheckPath: /health`.
18. **A buyer who asks in chat for their data to be deleted is answered by a person, and the assistant says NOTHING** (0075, the owner's decision 2026-09-27; `src/core/safety/deletion.ts`).
   - Layer 1, before any model: `asksForDeletion` — a deletion verb with the buyer's OWN data as its object, or a fixed phrase (right to be forgotten / 被遗忘权 / الحق في النسيان); en/zh/ar/es/fr in full (#124: es/fr eight requests and eight passing mentions each) + pt/de/ru/tr. It is the `deletion_requested` signal (problem 100): the turn is gated, handed off, and the hand-off sends nothing — not `HANDOFF_REPLY`, not a receipt (`answerPath: 'silent'`). Any unresolved request keeps later hand-offs silent.
   - Layer 2, the reply: `promisesDeletion` on every writer attempt and the final reply (taught answers, stand-ins too). A promise is thrown away and the turn re-decided as the same silent hand-off, in auto AND draft; no quote is recorded; a `deletion_promise_withheld` event keeps the words.
   - Precision is the point: `tests/parity/deletion-requests.test.ts` holds 43 requests and 45 passing mentions, and 19 promises and 13 non-promises for the reply net ("delete that line from the quote", "remove my email from the cc", 我的邮箱写错了，删掉重发, احذف السطر من عرض السعر…). A new phrasing goes into that file with its reason, never into the patterns alone.
   - Owner side: reason `takeover.reason.deletion_requested`; the card on the conversation page (nothing was sent, why, a door to `/app/conversations/:id#deletion` — the CC-02 control; staff get `staff.deletionAsked`); the Buyers badge prefers this reason. The owner alert is its own since #105 (below).
   - A request that also reads as an injection ("Forget everything you know about me") is the same silent hand-off: `decideTurn`'s injection gate yields to `deletion_requested` (#120; before, the injection's canned reply went out).
   - Not covered, by design: while the assistant is stopped or silenced a request shows under that reason (the worker hands over before any turn); a request in words neither layer knows, answered by a reply that promises nothing ("I'll pass that on"), still goes out; languages outside the nine. Handing the conversation back resolves the signal like every hand-off — record the request first.
   - Tests: `tests/pipeline/deletion-handoff.test.ts`, 7 golden scenarios (40 in all; the pin is `factory-rehearsal.test.ts`), `tests/parity/deletion-handoff-page.test.ts`, `tests/integration/deletion-handoff.test.ts` (production composition, en/zh/ar). Each layer switched off fails its own tests.
   - **0076 — written down when it arrives** (`src/db/deletionAsks.ts`, table `deletion_asks`). The hand-off writes the buyer, the conversation, the message that asked and its time, in the turn's transaction, whoever holds the conversation — and on the paths where no turn runs (stopped, paused, unlisted number, e-mail reply: `handToPerson(…, said)`). The REMINDER, never the action: `erase-buyer` acts only on an open `deletion_requests` row. One waiting per buyer: a repeat is counted (`asks`), the first time kept; after the owner recorded one, nothing new is noted. The owner decides on the buyer's page: record it (no note; `asked_at` = when the buyer asked) or "not a deletion request" (`deletion_dismissed` on the audit trail). Handing back clears the hand-off's reason, never this row.
   - **Its own alert** `deletion_requested` — never the generic hand-off's — sent when a request is new or the conversation was handed over because of one; delivered like the operator alerts (e-mail to the sign-in address always, WhatsApp where live; `goesByMail`). It names no deadline: the only one stored is Nomi's 30 days, which starts when the owner records it and is shown there.
   - **Its own thing wherever hand-offs are listed:** the conversation card stays while it waits (with the date); the Buyers list leads with a headed group and a `filter=deletion` tab; Today's second attention row (under "did not reach the buyer"); Your data lists it first. The erasure tools erase it with the buyer (`deletion_asks: erase`).
   - The "account manager" exception (one of the 45 passing mentions handed off by the "wants a person" list) is gone since #107: all 45 are answered as usual, and the turn test now demands it.
19. **"Wants a person", in two layers** (the owner's direction, 2026-09-28; 0077; `src/core/scoring/detect.ts`, `prompts/analysis.txt`).
   - **Layer 1, before any model — `asksForPerson`:** unambiguous requests only. A request's frame around a person who can only be the seller's: "can I talk to …", "I'd like to speak with …", "put me through to …", "please call me", 转人工 / 人工客服 / 你们经理, «أريد التحدث مع …» / «مديركم» / «حولني على موظف», and since #124 "quiero hablar con una persona", "pásame con un agente", "¿me pueden llamar?", "je voudrais parler à une vraie personne", "passez-moi le service client", "pouvez-vous m'appeler ?" (shop openers «¿hay alguien?», «il y a quelqu'un ?» too). Normalised like the deletion check (NFKC, case, Arabic hamza and diacritics, ی/ک). Never: bare "human" ("human hair"), 找人工 / 人工成本, «احدث», "call me Ahmed", a person followed by the buyer's own side ("in my team", «في شركتي»), a negation (不用转人工, «لا أريد»). #107's manager split stands: the buyer's own manager is not a hand-off; an ambiguous English "the manager …" still is.
   - **Layer 2, the analysis the turn already makes:** `wants_person` → `Analysis.wantsPerson`, read after the analysis and BEFORE the writer. `true` → `human_requested` (the ordinary sentence); `false` → nothing; **`null` (unreadable, or JSON that does not parse) → `not_answered`, a SILENT hand-off**; absent (scripted analysers) → nothing. Ambiguous means hand off.
   - **Failure:** the analysis request is `{ timeout 30 s, maxRetries 1 }`; a turn that still fails is retried by the queue, and a dead-lettered inbound job hands its conversation to a person as `not_answered` with the ordinary alert (`handOverUnanswered`, `src/pipeline/received.ts`; the worker's dead-letter handler).
   - **Live, on the production provider (deepseek-flash, 2026-09-28):** the owner's sentences both ways in en/zh/ar all as intended, none unreadable; median +39 ms. Of the 45 deletion passing mentions, «أرسل رقمي إلى المندوب» (4/4 runs) and 把我的号码加到群里 (3/4) come back as wanting a person — the ordinary hand-off, kept. Re-run `tools/check-person-model.mjs` (§3) whenever the model or the prompt changes.
   - Identity questions ("are you a bot?") no longer hand off by the word "human": they are answered, with the disclosure (rule 3), unless the buyer also asks for a person.
   - Tests: `tests/person/person-request.test.ts` (per layer), `tests/pipeline/{person-handoff,analyzer-wants-person,unanswered}.test.ts`, `tests/integration/person-request.test.ts`. Layer 1, layer 2 and `not_answered` each switched off fail their own tests.
   - **Built out in Chinese and Arabic (#119, 2026-09-28)**, so a plain ask hands off at layer 1 as reliably as in English: zh — talk with / find / call / "someone else" / "not a machine" frames around 人, 真人, 客服, 业务员, 销售, 你们的人, and calls (给我打电话, 打电话给我, 请回电); ar — calls («اتصل بي», «كلمني», «ممكن اتصال»), a real person or human outright, one of their staff, «هل يوجد أحد أتكلم معه», help from a person, "not a robot", the seller «البائع» / sales. Guards: 在找 is sourcing; a report of a call (他给我打电话了, «اتصل بي مديري») is not a request. 人工在吗 / 真人在不在 name the human agent: a plain ask (#120).
   - **A shop's opener is answered; asked again AFTER the disclosure, it hands off** (the owner's decision, 2026-09-28; #120; `shopOpener` in `detect.ts`). 客服在吗, 老板在吗, 掌柜/店家在吗, 有人吗, 有没有人 · "Is anyone there?", "Anyone around?", "Is customer service available?" · «فيه أحد؟», «هل يوجد أحد؟», «أحد موجود؟», «فيه أحد يرد؟», «هل خدمة العملاء موجودة؟» — a greeting aimed at a shop, in its own clause. Keyed to `aiDisclosureDeliveredAt` — the disclosure DELIVERED (rule 3, 0079, #121), never merely queued, and never the mode:
     - not yet told: a message that is ONLY an opener (greetings, 请问, stops around it) is answered — the model's `wantsPerson` is set aside, true or unreadable — and the disclosure goes with the reply (rule 3). An opener with more ("客服在吗？这个包多少钱") goes to the model, whose prompt says the opener asks for nobody and to judge the rest.
     - told: the opener anywhere in the message hands off at layer 1, before any model. A second ask is not an opener.
     - Not openers, either state: 在吗, 亲在吗, "Are you there?", «موجود؟» (addressed to whoever answers); 客服在哪里; the words mid-sentence (有人说…, «في أحد المصانع»). A plain ask is layer 1's on the first message, opener or not (人工在吗, "Anyone there? Can I talk to someone?"); so is every deletion request.
     - The same rule in draft and in auto-send (#121, the owner's correction): delivered → a repeat hands off; not delivered → still an opener, answered. In a workspace that only drafts, nothing carries the disclosure (rule 3), so a repeat keeps being answered — until a message carrying it goes out (an auto-sent reply, an identity answer, or an owner's message that includes it). A reply refused at send time (Stop) is NOT told.
     - Four states in the corpus turn test, each opener: auto/delivered 35/35 hand off, auto/not delivered 35/35 answered (and the disclosure said again), draft/not delivered 35/35 answered, draft/delivered 35/35 hand off; with more (7 × 2 modes) → the model before delivery, 14/14 hand off after. Queued but never delivered: 0/42 hand off (#120 handed off 42/42 on the queued stamp).
     - Corpus: `OPENERS` (35: en 9, zh 16, ar 10), `OPENERS_WITH_MORE` (7), `NOT_OPENERS`, `PLAIN_ASKS_THAT_LOOK_LIKE_OPENERS`; the turn test runs each opener as two turns of one conversation (answered with the disclosure, then handed off with no model call). Live (deepseek-flash, 2026-09-28): first message handed off 35/35 → 0/35, with more 7/7 → 0/7; after the disclosure 42/42. The prompt line moved groups 2/3 11/100 → 9/100 over two paired runs (noise).
   - **The corpus is `tests/person/person-corpus.ts`**, like the deletion one: 1 requests, 2 other meanings, 3 the buyer's own side — each in en/zh/ar — plus passing chat, declined, identity questions, and what is left to layer 2 on purpose; `tests/pipeline/person-corpus.test.ts` runs all of it through the real turn. Measured on it: requests missed at layer 1 — the old list 91/115, #110 40/115, #119 0/115, #120 0/117; non-requests fired on a first message — the old list 25/156, since #110 0/156, #120 0/170 (openers included); after the disclosure 0/128 besides the 42 openers; the deletion 45 never. Live (deepseek-flash, 2026-09-28) the model hands off 4 of the 50 group-2/3 sentences (one by the prompt's own rule: "I'll call you" needs a person) and every greeting left to it, 客服在吗 included.
20. **Buyers is ONE list** (A, #111, 2026-09-28; `src/db/buyersList.ts`).
   - `/app/inbox`: the tabs (Needs you, All, Mine, Did not send, Deletion requests); search `q` over the name, the phone / e-mail / handle (a number matched on its digits) and the product in en/zh — never message text (that needs a full-text index: a migration); keyset paging, 50 a page (`after` / `before` = `<rank>_<µs|n>_<uuid>`), ranked by the page's own groups (deletion → waiting for a person → a reply to review → held by a person → the assistant's), so everyone who needs the owner is on page 1; "51–100 of 312"; the counts are of everything (A9); a stale cursor is the first page.
   - `/app/conversations` → 302 `/app/inbox?filter=all` (or `?q=`); the buyer's page `/app/conversations/:id` stays and lights Buyers (`MERGED_INTO_BUYERS`). The row is decision 5's: name, last message, time.
   - Tests: `tests/parity/buyers-merge.test.ts`, `tests/integration/buyers-merge.test.ts`.
21. **A page left open says when something new arrived** (CC-26, #112; `src/api/web/live.ts`, `liveScript.ts`).
   - The conversation page, Buyers and Today are drawn with a MARK, read before the page; the page asks `GET /app/live/{conversation/:id,buyers,today}?since=<mark>` every 20 s while the tab is visible (`EVERY`), and the server compares marks — the browser's clock decides nothing. Poll, not server-sent events (one process on Railway, every deploy drops a stream, and nothing would push). Session + RLS; another business's conversation is 404; signed out, 401 and the script stops.
   - One quiet line (a polite live region, the line itself the door — the conversation lands at `#latest`); never a reload. Typed words are kept in the tab's `sessionStorage`, per conversation and box, and forgotten when sent and on sign-out; CC-24's kept words stay the box's first text. The buyer's page does not watch.
   - The app's ONE script, `/assets/live.<hash>.js`, served like the stylesheets (`assetAt`, `layout.ts`); every page works without it. Tests: `tests/parity/live-refresh.test.ts`, `tests/integration/live-refresh.test.ts`; the endpoint, the script's link and the kept words each switched off fail their own tests.

22. **A workspace that exists gets a login from the operator, never from SQL** (0078, 2026-09-28; `tools/add-login.mjs`, `docs/FACTORY-PROVISIONING.md`).
   - `MIGRATE_DATABASE_URL=<admin url> PUBLIC_BASE_URL=https://app.nomidoes.com node tools/add-login.mjs <business-id> <e-mail>` gives the workspace's OWNER (`people.is_owner`; `--name` only when none is on record) a login — e-mail normalised and shape-checked like sign-up, scrypt with sign-up's parameters of random bytes thrown away — and prints a one-time link `/login/set-password?t=…` (72 h, `--hours`). No password on any command line.
   - `login_setups` keeps only the token's SHA-256; the app role reaches it through `login_setup_open` / `login_setup_spend` only. Opening the link spends nothing (a preview must not use it up); saving does, once, sets the password like a password change and closes every other open link; then the ordinary door (A3's device code included). Those routes log nothing at `info` (the token is in the address) and send `no-referrer`.
   - Refuses, changing nothing: no such business, switched off, the practice sandbox, an e-mail another workspace signs in with (named), a role row security filters. A workspace that already has a login is listed and needs `--replace` (archives the owner's login — one live login per person, one owner per business); the owner's own e-mail needs `--reset` (a fresh link; the old password works until the new one is saved).
   - **The product has no self-service recovery.** Nothing e-mails an owner a link to choose a new password: `login_codes` (0058) only confirm a sign-up or a new browser after the password was right; `email_confirmations` is orders'. An owner who forgets the password asks the operator for `--reset`. The pilot's workspace also opens with the deployment's `OWNER_ACCESS_CODE`.
   - Tests: `tests/parity/add-login.test.ts`, `tests/integration/add-login.test.ts` (runs the tool for real and signs the login in).

23. **An order waits for the owner's tap, in every mode** (0080, 2026-09-29, T6/T6b; `src/db/orderProposals.ts`, `src/pipeline/orderProposal.ts`).
   - A customer's "yes" that passes every order rule (`toConfirmableOrder`) writes an `order_proposals` row — exactly what they said yes to — and nothing else: no order, nothing sent or drafted, the conversation stays open. Draft, auto, any grant: the same. A turn never creates an order (`commitTurn`; the golden scenario `order-yes-waits-for-the-owner-in-auto`, invariant `orderWaitsForOwner`).
   - The owner (or staff — "a sales assistant can record an order", `people.ts`) decides on the conversation page's first card: **Confirm the order** (`POST /app/inbox/:id/order/confirm`: the order is created from the proposal through `confirmableFromProposal` → the one order writer, the conversation closes, and only then is the confirmation queued through the ordinary outbound path; window/allowlist refusals and Stop/silence refuse the tap and it keeps waiting) or **I'll answer them** (`/order/step-in`: set aside, the conversation taken over, nothing sent). Locked and decided once.
   - While one waits, every reply in that conversation is held for the owner (`order_waits_for_owner`, first of the hold reasons).
   - The owner is told: an `order_proposed` alert by e-mail always, WhatsApp where live (`goesByMail`), once per proposal; the conversation leads Buyers (rank 0, "Said yes to an order") and Today ("Orders waiting for you", first); every live answer carries `orders`, and a page the owner allowed to notify (Today's button) raises a browser notification when it rises — while a Nomi tab is open (push with no tab is G5b).
   - **The pending question is what the customer was actually asked.** It travels with the reply (`asks` on `drafts` and `outbound_messages`) and is set by the send path when the provider accepts the message (`markQuestionAsked`, `src/db/pendingQuestion.ts`); the owner's own words and an edited draft ask nothing; a turn keeps a question only if it was already asked and is still the one being asked. A "yes" after a "shall I confirm?" draft nobody sent proposes nothing.
   - Tests: `tests/pipeline/order-waits.test.ts` (T6: every capability in draft, seven kinds of message, nothing sent; T6b: every mode), `tests/parity/order-proposal.test.ts`, `tests/integration/order-proposal.test.ts` (production composition). The hold, the pending rule and the proposal each switched off fail their own tests. Pre-pilot scenario 10 goes through the tap.

24. **A product may have no minimum order, and nothing pretends it has** (0081, 2026-09-29; the owner overrode the plan's sentinel of 1).
   - `products.moq` is nullable; NULL means no minimum (never 0; existing values kept — nothing records whether a stored 100 was stated or the old default). An imported line that states none is written with none (it was 100). The product page's box, left empty, is "no minimum".
   - No reply, page or export prints "minimum 1", "minimum order 1", a blank, or "null" where a minimum goes: the product list and page, the import review, the customer's proof page and the products export say "No minimum" / 无最低起订量 / بلا حد أدنى (`product.noMinimum`; the export in the owner's language). Quotes and orders are never refused as below a minimum that does not exist; a photo or rehearsal with no stated quantity is priced where her prices start (`startingQuantity`).
   - The model is told "no minimum" in the candidate line and gets no `moq` key at all when there is none; a figure after "minimum"/MOQ/起订/«حد أدنى»/pedido mínimo/commande minimum is a commercial figure the numeral guard requires to be sourced, so an invented "minimum 1" is refused in five languages.
   - **T4 — the price list is read honestly or refused with a reason**: thousands commas are thousands ($1,250.00 was $1.00); a figure that reads two ways (1.250,00, 12,50, 1.250) is refused; only US dollars for now (€, 元, HK$ … refused until a workspace has its own currency, CUR); a spreadsheet row with several numbers and none marked is refused; «حد أدنى» is read. The review shows the refused line as written, and why.
   - Tests: `tests/parity/moq-no-minimum.test.ts`, `tests/parity/t4-parser-honesty.test.ts`, `tests/integration/moq-no-minimum.test.ts`. The live model check ran before and after (unchanged: 29 named, 0 flipped, 0 unreadable).
25. **The design foundation** (the design pass, decided 2026-09-29; the plan is artifact `G24Rxqbhb8yWDzhKNAHNfh`).
   - **Buttons do things, doors go places.** A `<button>` in a form changes something; an `<a>` goes somewhere and is drawn as words with its arrow (`deeper`, `back`), never `class="btn"`. A button outside a form is only a script's (`type="button"` + `data-`). Starting a connection is a GET form with a button. `tests/parity/buttons-and-doors.ts` checks a page; the surface walk runs it on every owner page in en and ar (the components gallery is skipped by name).
   - **The palette is six values** (`tokens.ts`): Graphite `#1C1B1F` (ink, the one FILL — Send), Stone `#5E5A66` (secondary text, the edge of an outlined button or a field), Rule `#E2E0E6` (between panes; never a control's edge), Paper `#F5F4F6` + white, and **Magenta `#A82860` — the assistant's hand only**: text, never a fill, wash, border, link, button, heading or the mark (`byAssistant()` in `layout.ts`: ✦ + the name). The three states keep their values. Jade, highlight, the warm papers and the dark palette are retired. `tests/parity/palette.test.ts`.
   - **Type is Noto, served by the product** (`assets/fonts/`, vendored by `tools/fonts.mjs` from @fontsource, OFL; `src/api/web/type.ts`; never Google). One font order per language, led by its own face (tokens `font.family` / `font.voice` per locale). The shell and the door link `type` (Latin + Arabic faces) or `typezh` (+ Chinese) after their own sheet; public documents link nothing. `tests/parity/type.test.ts`.
   - **The approval card** (`approvalCard` in `inbox.ts`): who asked, where, when; ✦ drafted; the state line (what made it wait); their words; Understood (from the turn's stored analysis); "How {name} read this" (closed: each product name and figure with its source — `src/core/owner/reading.ts`, the numeral guard's own sources — taught facts, and whether a second, separate reading agreed, from `own_understanding`); the reply ONCE, in the box; Send · Edit (a label) · Hand to me (`formaction` take-over) · No reply needed (quiet, `不回`). Send posts `command=send` with the box: the draft's own words go as `发送`, others as `改`, an empty box as nothing (`inbox.flash.empty`) — the approval path is unchanged. "Stop doing this alone" left the card (the assistant's page sets how much it sends alone). Docked at the foot of the conversation from 1100 px. Counted sentences use `tn()` (Intl.PluralRules, six keys per sentence). `tests/parity/approval-card.test.ts`, `tests/integration/approval-card.test.ts`; pre-pilot presses the card's real Send.

## 6 · What's next

**The 2026-09-28 batch — "clear the queue"** (the owner's order): Task 1
"wants a person" in two layers (#110, rule 19); Task 2 A and the V1 close-out
(#111, rule 20); Task 3 CC-26 live refresh (#112, rule 21); Task 4 the audit's
last items (#113); Task 5 housekeeping — the `backup` service's unread
`RETENTION_DAYS` deleted, iCloud's `.git/index 2` moved to the scratchpad.
- Task 4 closed **CC-13** (the locale's own punctuation; a figure and its unit
  spaced once — `formatQtyUnit`: "5,000 pcs", "5,000 قطعة", "5000个"), **CC-14**
  (the business's name in the rail, "Nomi" under it), **CC-20** (skip link,
  `aria-current` on every tab set, one `h1` per page, field errors as alerts;
  `waiting` `#A64C08` and `highlight` `#7F6400` now clear 4.5:1 on their wash —
  Symow may pick other values that do), **CC-29** (17 more destructive actions
  confirm with `data-confirm`; the one-tap ones left are named in
  `tests/parity/audit-closeout.test.ts`) and **CC-31** (a SKU the import made up
  is never shown; `src/core/owner/sku.ts`). **CC-09** needs nothing more in code.

Still the owner's, from before:
- **DNS** — `docs/SITE-DNS.md` (Railway custom domain `www.nomidoes.com`,
  `SITE_HOSTS`, GoDaddy www CNAME + apex forwarding; never touch MX/SPF/`app`).
  Until then the site is only at `/site`.
- CC-28 open vs invite sign-up; the site's zh/ar copy wants a native read;
  "Ready to go live" on My business still says "Connect WhatsApp" (it is
  WhatsApp activation — send path); KB 01 still says 连 WhatsApp.
- Builder worktrees under `.claude/worktrees/` are picked up by vitest and
  inflate every count ×4 — keep them outside the checkout (the scratchpad).

**V1 is done** (`docs/DESIGN-V1-BRIEF.md`; decisions 1–4 Symow, 2026-09-24;
decision 5, 2026-09-28: **the row stays** — name, last message, time — to be
revisited after real daily use). Every owner page and the door link one
content-hashed stylesheet (`/assets/app.<hash>.css`, `/assets/door.<hash>.css`,
`assetAt` in `layout.ts`, cached for good; an older hash gets this build's text,
not cached). The ONE `<style>` left is `publicDocument()`'s (legal,
unsubscribe, proof, site), on purpose: those pages must arrive complete with
nothing to fetch (`legal-pages.test.ts`, `m40-unsubscribe.test.ts`);
`tools/style-baseline.json` = 1. Page tests read CSS through the links
(`tests/parity/linked-css.ts`); the served sheets and the script are scanned
for banned words. Log out is Setup's last row, a button (`POST /logout`).
Recurring traps: a CSS comment or class name ships to the browser and is
scanned (no "token", no "stack", no "%"); a page never paints its own notice
(`flashBanner`); `<a class="btn">` is still common — the buttons-versus-doors
rule is not tested yet. Screenshots: `docs/design/v1-closeout/`,
`docs/design/live-refresh/`; the full set is `node tools/screenshots.mjs` on a
local instance.

The queue (`docs/ROADMAP.md` §2b) is down to: the owner runs the usability
script, then Phase 6 billing, then Meta Tech Provider (M52 last, always).

**The usability session** (top of the queue, the owner runs it): two commands
prepare the local workspace — `bash .claude/skills/run-nomi/smoke.sh`, then
`MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node
tools/seed-usability.mjs`, which checks the script's list and says Ready.
Login: "I have an access code" → `smoke-code`. The doc has the three ways a
local instance differs. Never host the 55451 integration cluster in
`/tmp/yf-run`: `smoke.sh` wipes it (it did, 2026-09-24; rebuilt in the
session scratchpad — see memory `local-integration-postgres`).

D shipped (see §4). What it did, for orientation: `src/api/web/layout.ts`
(NAV, `CONTEXTUAL_ROUTES_BY_HUB`, `OUTREACH_PREFIXES`), `src/db/workspace.ts`
+ `src/db/setup.ts`, the Setup page (`settings.ts`), the "How you sell"
section on My business, the "More about {name}" doors on the assistant's
page, the Today card (`operations.ts`), the outreach gate (`app.ts`
preHandler, `db/outreach.ts`). Tests: `tests/parity/d-split-drawer.test.ts`,
`tests/integration/outreach-area.test.ts`.

**Owner decisions, 2026-09-27**
- The personal address removed from `docs/legal/PRIVACY-zh.md` stays in git history — the owner chose not to rewrite history (open PRs; the address is public on served pages).
- Manual backups prune after 180 days (#99). Open: the pre-0026 backups that BACKUP-RESTORE.md once said "do not prune" will go from about 2027-02-04 unless moved out of the bucket root — the owner's call. PITR keeps ~4 weeks (Railway: last 4 weekly full backups); Railway volume-backup retention was not checked (not visible to the tools).
- **Deletion requests in chat → a person, nothing sent** — the owner chose NOTHING (no receipt, no acknowledgment); built and deployed as #102 (§5 rule 18).
- **"Wants a person": the buyer's own manager is not a hand-off** (#107, rule 19). The other words' problems were reported and left for the owner.
- **…written down when the hand-off fires, with its own alert** (#105). Claude's calls, reported: a repeat while one waits REUSES it (counted; the first time is when it was received); a waiting request shows on Today (second row); the alert names no date (none is stored before the owner records it).

**Owner decisions and Claude's calls, 2026-09-28**
- **Decision 5: the row stays as it is for V1 — deliberately provisional** (Symow, 2026-09-28; recorded in his words, brief §8). A larger UI/UX pass comes later; what it should look at first is `docs/UI-PASS-CANDIDATES.md`. The calendar's kind is its own choice: the first word of the entry's line, never a pill (#116).
- **"Wants a person" in two layers** (rule 19). Claude's calls, reported: the model's layer sits inside the analysis, before any reply; an unreadable answer or a failed turn is a SILENT hand-off (`not_answered`), like an unheard voice note; the analysis gives up after 30 s and one retry; latency measured live +39 ms median; identity questions are answered with the disclosure rather than handed off; the two live hand-offs among the 45 passing mentions are kept.
- **A** (rule 20): "unread" is not recorded anywhere, so the row says who wrote last (a real per-person "seen" is a migration); search leaves message text out (a full-text index is a migration); Customers' VIP-first order is dropped (only the demo seed set VIP); the relationship pill stays on the buyer's page, not the row. Arabic `common.buyer` is مشترٍ now (was عميل), for the native read.
- **CC-26** (rule 21): 20 s is one constant (`EVERY`); Buyers' line also fires on the assistant's own replies (the list does change — it may be noisy in auto mode); a "this conversation has changed" line when it is handed over, taken or a send is refused; the line is its own door.

**Parked / owner's to unblock**
- **Decided 2026-09-28 (the owner): the two Chinese labels stay** —
  `login.brandTagline` 你的数字员工工作台 (员工, an employee) and
  `assistants.role.support` 客服. Both are seen by the owner, never a buyer, and
  "employee" is what the product is. Noted beside each in `messages.ts` as a
  decision, not an oversight. (The Arabic privacy page's «مساعد ذكي» and the
  disclosure's masculine «فأخبرني» were fixed in #118.)
- The live workspace confirming its assistant's name (in progress 2026-09-23;
  check `onboarding_state.assistant_named_at` for Westlake).
- Moving the checkout out of iCloud (steps given 2026-09-23; see §2).
- C4.d per-channel activation (after the pilot is live); M48 WeChat (needs an
  Official Account); M52 platform reviews (last, always).
- Native review of the reworded zh/ar UI lines (`docs/NATIVE-REVIEW-UI.md`).
  Not a gate; only the disclosure sentences gate autonomy.
- Buyer-facing fixed sentences in `src/core/conversation/fastpath.ts` address
  the buyer in the Arabic masculine («تحتاج»). They are on the send path and
  were left alone in the pronoun PR.
- **Self-service password recovery ("e-mail me a link") is not built** (rule 22).
  The pieces exist — a system mail sender (A3) and `login_setups` (0078) — but
  no page asks for a link. Until then a lost password is the operator's
  `add-login.mjs --reset`.
- **Found, not fixed (send path, needs a decision):** Stop pressed while a
  buyer's batch is still waiting fails the hold path — `markFragmentsProcessed`
  writes `processed_in`, which references `turns`, and the hold path writes no
  turn. The job dead-letters and, since #110, the buyer reaches "Needs you" as
  `not_answered` about five minutes later instead of as "stopped". Fix: a turn
  row for the hold, leave the lines pending, or a schema change.
- In Chromium on macOS (the screenshots, desktop Chrome) English renders in
  PingFang SC: the font stack starts with `-apple-system`, which Chromium does
  not match (hyphens look wide). `system-ui` after it would fix it — type is
  Symow's to decide.

## 7 · Where things are

- Roadmap and audit trail: `docs/ROADMAP.md` (blocks A–G; §3 standing
  instructions for every milestone).
- Launch rules: `docs/LAUNCH-CHECKLIST.md`. Backups: `docs/BACKUP-RESTORE.md`.
- i18n: `src/core/owner/i18n/messages.ts` (en/zh/ar, same keys; tests enforce
  completeness, banned terms, flash tone classification in
  `src/core/owner/flashTone.ts`).
- The one send decision: `commitTurn` in `src/pipeline/turn.ts`. The one
  approval path: `applyOwnerCommand` in `src/pipeline/approve.ts`.
- Design tokens only (`src/api/web/layout.ts`); a state colour needs a
  state-named class (`tests/parity/shell.test.ts`). Inline CSS comments ship to
  the browser — they're scanned too.
- The Buyers list: `src/db/buyersList.ts`. The live line: `src/api/web/live.ts`, `liveScript.ts`.
  Static files (stylesheets, the one script): `assetAt` in `layout.ts`, route `/assets/:file`.
- Local Postgres: port 55451 (see memory "local-integration-postgres").
