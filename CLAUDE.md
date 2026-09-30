# Nomi — handoff for the next session

**The roadmap run (2026-09-29 → 30) is complete: read `docs/PROGRESS.md`
first.** It says what shipped, what waits on the owner, what was found on the
way, and how to resume.

Last updated **2026-09-30**, after #141 — **the roadmap run's eight steps are
done** (#122–#141): the live order defect, no-minimum products, Spanish and
French, the design foundation, the calendar and its promised dates, the build
items (T1, T3, T5, T7, Q1, CH1/CH2/CH5/CH7a, PWR, FAIR, CEIL, REKEY), and the
design pass (Today by time, right-to-left values, names, Setup, People, the
door, the live line, the review pass). What waits is the owner's: see
`docs/PROGRESS.md` "Waiting on the owner". The positioning is recorded in §0 —
read it before writing any copy. Written so the next session needs nothing from the
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

Run all of it on **Node 22** — production and CI use it (`.nvmrc`); this
Mac's default `node` is newer (`PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`).
#129 passed locally on Node 26 with `Intl.DurationFormat` and failed on CI.

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

## 4 · What is live (production, 2026-09-30)

- **Deployed (2026-09-30):** the merge of #140 (`94a6130`, merged 04:59 UTC), then #141 (see PROGRESS); production `schema_version` = **85** (0084 login recovery, 0085 send ceiling); `/health` ok over IPv4 (from this Mac use `curl -4`: its resolver invents an IPv6 address). The newest scheduled backup `nomi-backup-20260930T030201Z` (schema 85, drill passed) — the first since #122 fixed the drill. The history below is kept for orientation. Earlier: the merge of #123 (`528203b`, 0081 — no minimum), 2026-09-29 07:41 UTC; production `schema_version` = **81**; backup before it `~/nomi-backups/nomi-backup-20260929T072729Z` (schema 80, drill 4/4). Before it, the merge of #122 (`9581518`, 0080 — an order waits for the owner's tap), 2026-09-29 07:03 UTC. Backup before it: `~/nomi-backups/nomi-backup-20260929T064304Z` (manual, schema 79, drill 4/4 — see `docs/PROGRESS.md` "Found on the way": no scheduled backup could pass its drill since 0078 until #122 fixed the drill). Before it, the merge of #121 (0079, the disclosure delivered). Before it
  #120 (shop openers), #119, #118, #117 (the gate), #116, the merge of #115
  (`tools/add-login.mjs`, 0078), `079d776` (#113, the audit's last items), #112 (CC-26), #111 (A + the V1
  close-out), #110 (0077, "wants a person" in two layers). `/health` → `{"ok":true,"db":true,"worker":true,"provider":"active"}`;
  production `schema_version` = **79**; no business is stopped and no silence flag is on; exactly one business has `outreach_area` on (59 businesses). Backup before 0078 and 0079:
  `nomi-backup-20260928T030213Z` (drill passed; PITR on).
  `TRANSCRIBE_API_KEY` is unset in production — if it is ever set, the privacy
  page must name that processor too. **`HEALTH_PING_URL` is set** (the owner,
  by 2026-09-30) and verified pinging every five minutes. **`BACKUP_PING_URL`
  is on the `nomi` service, which never reads it; the `backup` service needs it
  (or `${{nomi.BACKUP_PING_URL}}`)** — the owner's (PROGRESS, 2026-09-30).
- **Schema:** 85. Last three: `0083 promised_dates`, `0084 login_recovery`,
  `0085 send_ceiling`.
- **Scheduled backups are LIVE** (2026-09-23): Railway service `backup`
  (cron `0 3 * * *`, private network, `backup/README.md`). First proven run
  `nomi-backup-20260923T102036Z`: 1.6 MB, schema 69, drill 4/4 in the
  container, laptop `verify-restore.sh` 4/4 on the encrypted copy, one row in
  `backup_runs`. The app alerts the owner by e-mail (and WhatsApp where live)
  when no run completes for 36 h. **PITR is enabled** on Postgres (WAL to a
  Railway bucket; the window starts from the first base backup after
  enabling). Still the owner's: move `BACKUP_PING_URL` onto the `backup`
  service (it sits on `nomi`), and do the monthly laptop drill
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

## 5 · Open rules in force right now

1. **The disclosure gate is PER LANGUAGE (the owner, 2026-09-30; #143).** A
   reply goes out alone only when the customer's own language has a disclosure
   a native reader signed off (`autonomyReleasedFor`, read at the send decision
   in `commitTurn`): en, zh and ar today. es and fr are written and wait for a
   reader; every other language has no sentence and is never given one
   translated for the occasion — in all of those, every reply is a draft and the
   card says which language and why (`withheld` on the draft). Until
   2026-09-30 it was one answer for the whole product, so adding es/fr unread
   in #124 stopped every workspace sending alone, which nobody had decided
   (PROGRESS, "The owner's questions"). `DISCLOSURE_NATIVE_REVIEW` = `{ en:
   true, zh: true, ar: true, es: false, fr: false }`. **No assistant sets a flag,
   either way.** The owner reads fr and ar himself; es needs an outside reader;
   the Arabic sentence was rewritten in #118 after his sign-off and waits for
   his re-read. A flag flips in one commit that names the reviewer and updates
   `tests/integration/autonomy-level.test.ts` and
   `tests/pipeline/disclosure.test.ts`. Everything else for es/fr is built and
   tested. Before that, the gate was **OPEN from 2026-09-28** (#117): the owner read the
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
9. **Every page draws from `workspaceFacts`** (`src/db/workspace.ts`): name, several, outreach, and the five-step setup progress (`src/db/setup.ts` — profile, products, name, channels, first reply). Cached a minute per business in `app.ts`; every write that completes a step calls `facts.evict`. The Setup nav entry shows `done/total`; Today says it in one line at its foot (since #138); both vanish when complete.
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
   - **Its own thing wherever hand-offs are listed:** the conversation card stays while it waits (with the date); the Buyers list leads with a headed group and a `filter=deletion` tab; Today's line after "did not reach a customer" (a door to `filter=deletion`); Your data lists it first. The erasure tools erase it with the buyer (`deletion_asks: erase`).
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
   - **Self-service recovery since PWR (rule 32):** "Forgot your password?" on the door mails a link to the same page. Where the installation sends no system mail, `--reset` is still the way. The pilot's workspace also opens with the deployment's `OWNER_ACCESS_CODE`.
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
   - **The approval card** (`approvalCard` in `inbox.ts`): who asked, where, when; ✦ drafted; the state line (what made it wait); their words; Understood (from the turn's stored analysis); "How {name} read this" (closed: each product name and figure with its source — `src/core/owner/reading.ts`, the numeral guard's own sources — taught facts, and whether a second, separate reading agreed, from `own_understanding`); the reply ONCE, in the box; Send · Edit (a label) · Hand to me (`formaction` take-over) · No reply needed (quiet, `不回`). Send posts `command=send` with the box: the draft's own words go as `发送`, others as `改`, an empty box as nothing (`inbox.flash.empty`) — the approval path is unchanged. "Stop doing this alone" left the card (the assistant's page sets how much it sends alone). Docked at the foot of the conversation from 1100 px. Counted sentences use `tn()` (Intl.PluralRules, six keys per sentence). `tests/parity/approval-card.test.ts`, `tests/integration/approval-card.test.ts`; pre-pilot presses the card's real Send. The page's other cards (not heard, not readable, not listed, deletion, closure, own words, samples, did not reach, may not have) are drawn as states of the one card: `stateHead` — a dot and the state's words, then why and what to do; no washed boxes.
   - **The shell** (#126): the rail is 208 px in groups — Today and "Customers" (heading Conversations and Calendar), then the assistant and My business, Setup and Log out (a button) at its foot; still five `navlink` entries, the phone's one row (`.navgroup`/`.navfoot` dissolve there, `.navhub`/`.navout` are hidden). Conversations carries the rail's one number: Buyers' "Needs you", read FRESH per page in the preHandler (`needsYou` in the request scope; never the minute's cache). The browser tab reads "page · business". A conversation is drawn as panes (`src/api/web/panes.ts`): the list (Buyers' own default tab, rows by group, the current one marked, ✦ where the assistant wrote last) beside it from 1100 px, and the customer panel (`src/db/customerPanel.ts`: asked about, prices worked out, samples and orders, the calendar's own entries for them, who acted ✦ ● ○) from 1440 px; between the two the panel folds and `#customer` opens it over the page; below 1100 px the conversation stands alone. "Told a price" is "Prices worked out": a quote is not linked to the message that carried it. `tests/parity/shell-panes.test.ts`, `tests/integration/panes.test.ts`.

26. **The calendar is a week, and the owner's own dates are on it** (0082, the design pass 2026-09-29; `src/api/web/calendar.ts`, `src/db/calendarEntries.ts`).
   - `/app/calendar` opens on the WEEK holding today (`?view=week|day|month|list`, `?at=YYYY-MM-DD`): days as columns, hours as rows, an all-day row; ‹ Today › beside the dates; today marked by a line under its date (`aria-current="date"`). The week starts on the business's COUNTRY's first day (`businesses.country` → `Intl.Locale` week info: Monday for CN/GB, Sunday for US/SA, Saturday for EG; Monday when unknown). `?view=list` is the three-week agenda it always was (its doors carry `view=list`); the phone reads it best until the phone's own pass.
   - WHERE A DATE CAME FROM IS ITS EDGE (`edgeOf` in `src/db/calendar.ts`): solid — from a conversation, and it opens there; dashed — the owner's (their own dates, closures, a follow-up scheduled for someone who has not written). Colour is left for state (● on a reply due) and ✦ marks a price the assistant worked out. Past dates in Stone.
   - `calendar_entries` (0082): a title (≤ 80), a start, an optional end, all-day when no time. Put there by the owner or staff (like closures, rule 11); taken off = ARCHIVED (`removed_at`); the app role cannot delete. Belongs to the business, never a customer, so erase-buyer never reaches it; erase-workspace finds it by `business_id`. Times are read in the business's day (`dayStart`).
   - Tests: `tests/parity/calendar-week.test.ts`, `tests/integration/calendar-entries.test.ts` (RLS, archive, no delete); the list's own tests moved to `?view=list`.

27. **What a reply promised is on the calendar, from the words that left** (0083, the design pass 2026-09-29; `src/core/conversation/promises.ts`, `src/db/promisedDates.ts`).
   - When a message becomes SENT (the store's 'sent' transition, beside the line that copies it onto the timeline), each sentence is read for a promise and the one DAY it names: `follow_up` (the seller will get back: reply, confirm, check, send word), `price_end` (a price holds until a day), `delivery` (goods ship or arrive by a day). Today, tomorrow, a weekday (strictly after today), a date, "in 3 days", "within 2 working days" — never a span ("next week", "soon"). A question is no promise; neither is a sentence that says it cannot. Five languages. A draft, a refused or failed reply promised nothing. A fault in the reader is read as no promise; it can never cost a message its 'sent'.
   - READ BY RULES, NOT A MODEL (Claude's call, recorded in `docs/PROGRESS.md`): the sentence is the promise; no model call to drift, no live check. `tests/parity/promised-dates.test.ts` holds 31 found and 22 left alone — a new phrasing goes there with its reason, never into the patterns alone.
   - `promised_dates`: the sentence as sent (≤ 300), its day, its kind, `said_by` assistant | person; once per sent row and promise; no delete; erase-buyer erases it with the customer. The calendar shows them under "Promised" (solid edge — from a conversation; ✦ when the assistant said it; ● once its day has come and it is not kept); the customer panel lists what is open, soonest first. Nothing marks one kept yet (`kept_at` exists for it).
   - Tests: `tests/parity/promised-dates.test.ts`, `tests/integration/promised-dates.test.ts` (the real store and drive loop).

28. **Small truths from the build order** (#129, 2026-09-29).
   - **T1 — the practice sandbox is the pilot workspace's alone.** It is ONE shared tenant: every `/app/sandbox*` route answers any other workspace with the same not-found as a wrong address, and changes nothing; no page of theirs draws a door to it (`practiceShown()`, the request scope's `practice`). Per-workspace Practice (P1–P6) waits on decisions 4 and 5. `tests/integration/practice-closed.test.ts`.
   - **T5 — the page reader** asks at temperature 0 and reports a read that stopped at its limit (`cutOff`, from `stop_reason: max_tokens`); the photo import refuses it ("send it as two photos", `product.photo.refused.cut_off`) — half a price sheet is worse than none. Two promises the product did not keep are gone: "a buyer comments and {name} answers privately" (`comment_to_dm` left `INSTEAD`) and "follow-ups go out by themselves" under "talks". `tests/parity/t5-reader.test.ts`.
   - **CH5 — the window's clock:** under two hours left (`CLOSING_SOON_MS`), the approval card says "Closing soon — {channel} takes replies for 1 hour, 20 minutes more" first (`formatTimeLeft`: `Intl.NumberFormat` units joined by `Intl.ListFormat` — never `Intl.DurationFormat`, which Node 22 lacks). Expiry and its words belong to G5b.
   - **CH7a — what arrived, by name:** a shared post (`share`, reels), a story mention, a reply to the shop's story with no words are named on the card and the timeline, and the link Meta gave is kept on the hand-off's signal; the card opens it only when it is https on Meta's own hosts (`refOf`). A story reply with words is answered as before. Matching it to a product is CH7 (later, its own review). `tests/parity/ch7a-what-arrived.test.ts`.
29. **Every paid call is on the ledger, on the UTC day** (T7, #130, 2026-09-29; `src/db/usage.ts`).
   - `recordSpendAlone` writes `usage_ledger` in a transaction of its own and never throws: a turn's calls are recorded after its transaction, kept or rolled back (a turn is counted in `turns` only when kept — a retry is the same turn); a customer's photo (the vision call), a voice note (each transcription), a catalogue page (the page read, a refused cut-off read too) and a LIVE Practice turn (on the practice tenant's ledger; scripted stand-ins ask no model and are not recorded) add calls and tokens, never a turn. `record_usage()` (0008) is no longer called.
   - One clock: the ledger's day is `(now() at time zone 'UTC')::date` for the writer and every reader (`LEDGER_DAY`; the budget readers in `db/channels.ts` and `api/web/operations.ts` read Shanghai's before). A parity scan holds it.
   - `deepseek-flash` has its list price in `MODEL_PRICES_PER_MTOK` (input $0.30/M on a cache miss, output $1.20/M — PEAK; off-peak is half; read from DeepSeek's page 2026-09-29), so estimates are ceilings. `tools/answer-paths.mjs` prints per-turn tokens and cost (`PathSummary.perTurn`), the ledger's own totals beside the turns', and counts Practice's scripted turns (model `scripted`) apart.
   - First figures (production, 30 days to 2026-09-29): 9 measured turns — about 890 tokens in, 333 out, **$0.000667 per turn** (≈ $0.67 per 1,000 buyer messages); per model-worded turn about 1,001 in, 375 out, $0.00075.
   - Tests: `tests/integration/metering.test.ts` (production composition: text, voice, photo, a turn whose commit fails, catalogue photo, live and scripted Practice — each guard switched off fails its test), `tests/parity/metering.test.ts`.
30. **A product is found by its names, and only a findable product is "ready"** (T3, #131, 2026-09-29; `src/core/onboard/aliases.ts`, `src/db/productAliases.ts`).
   - Customers' words reach a product ONLY through `product_aliases` (`retrieve_products`, 0007), and a product retrieval did not return is dropped from the turn. The import wrote none before T3, so nothing imported could be found or quoted.
   - The import's confirm writes the name and the Chinese name; the owner's edit (name editing is new, on the product's page, owner-only like the rest of it) REWRITES the old name's row to the new name (the app role has no DELETE — rewrite in place) and adds the names customers use (one per line or comma-separated; ≤ 20 at a time, ≤ 120 characters each, refused whole otherwise). Nothing here removes a name.
   - "Ready" only when findable: status `not_findable` (offered, priced, found by no name) with its pill and a line on the product's page; the import's "ready to quote" count and Setup's products step require a name too.
   - `tools/backfill-aliases.mjs --business <uuid> [--yes]` adds each product's own name and Chinese name where missing (dry run by default; refuses a row-security-filtered role; `tools/lib/aliases.mjs` is its copy of the cleaner, held equal by a test). **On Westlake only with the owner's yes, after a backup** — the dry run on 2026-09-29 found all 5 of its products findable by no name.
   - Tests: `tests/parity/findability.test.ts`, `tests/integration/findability.test.ts` (an import found and quoted; the pre-T3 shape dropped from the same turn; the tool; rename; Setup).
31. **The analyser sees the last six messages** (Q1, #132, 2026-09-29; `HISTORY_TURNS` in `src/pipeline/turn.ts`, `recentMessages` in `src/db/repos.ts`).
   - `prompts/analysis.txt` always promised "Conversation history (last 6 turns)"; the turn handed it an empty list. Now: the conversation's last six messages, both sides, oldest first — duplicates left out, a voice note by its transcript, each at most 1,000 characters — and never the messages this turn answers (`TurnRequest.answering`: the batch's fragment ids; Practice records its message under the turn's id). Only the analyser; the reply writer's window is Q1W (conditional on P1).
   - Live check, before and after (deepseek-flash, 2026-09-29/30): before 29/29 named, 0 unreadable, median 1.9 s; after 34/34 — the five new history cases (`WITH_HISTORY` in `tools/check-person-model.mjs`: an earlier request already answered by a person does NOT hand the next turn over, in en/zh/ar; "Yes please" after "Would you like our manager to call you?" does) — 0 unreadable, median 1.86 s. Re-run it whenever the model or the prompt changes (§3).
   - Tests: `tests/pipeline/analyser-history.test.ts`, `tests/integration/analyser-history.test.ts` (the query; through the production worker, a batch of two is never its own history — switched off, it fails).
32. **A forgotten password: "e-mail me a link"** (PWR, 0084, #133, 2026-09-30; `/login/forgot`, `login_setup_request`).
   - "Forgot your password?" on the door (only where the installation sends system mail — `recoveryOn`) asks for the address. The reply is the SAME page, status and words (`forgot.sent`, "If {email} signs in to Nomi…") whether or not the address has a login, and it is sent before anything else happens: the token is made, stored as its SHA-256 by the definer function, and mailed after the reply. The link is 0078's `/login/set-password?t=…`, good for 60 minutes (`RECOVERY_MINUTES`).
   - In the database (0084): only the one live login of a switched-on workspace, person not archived; three recovery links an hour per login, whoever asks; asking again closes the older open links (the newest works). At the door: five asks an hour per caller (`recoveryThrottle`). The mail never reaches the log; a failure logs a fixed phrase.
   - Tests: `tests/integration/password-recovery.test.ts` (the whole flow, the same words for no login / archived / switched off with no mail, three an hour — switched off in the database, it fails — the newest link, the throttle), `tests/parity/password-recovery.test.ts`.
33. **`CREDENTIAL_KEY` can be rotated without a token lost** (REKEY, #134, 2026-09-30; `docs/SECRET-ROTATION.md`, `tools/rekey.mjs`).
   - The key seals every stored token (Page, mailbox, connector, channel). During a rotation `CREDENTIAL_KEY_PREVIOUS` holds the old key: the app OPENS with it, never seals with it (`acceptRetiredKeys`, set at boot; checked at boot as 64 hex).
   - Order: backup → the owner sets `CREDENTIAL_KEY_PREVIOUS` = old and `CREDENTIAL_KEY` = new in one change → `tools/rekey.mjs` (dry run, then `--yes`; keys and the admin address from the environment only — the doc's nested `railway run` supplies `ADMIN_DATABASE_URL` from Postgres and the keys from `nomi`) → run again: "Nothing to re-seal" → remove `CREDENTIAL_KEY_PREVIOUS`.
   - Without a previous key the tool only counts (production 2026-09-30: 4 sealed tokens, all open). `tools/lib/sealed.mjs` is its copy of the format and `SEALED` its list of columns; tests hold both to the app and to every `*_ciphertext` column in the migrations and the schema.
   - Tests: `tests/parity/rekey.test.ts`, `tests/integration/rekey.test.ts`.
34. **The inbound queue is shared fairly between workspaces** (FAIR, #135, 2026-09-30; `INBOUND_WORK` and `inboundGroup` in `src/queue/boss.ts`).
   - Every inbound job (the webhook's, the batch's wake, answer-now) carries its workspace as its pg-boss `group`. THREE workers whose polls are a third of an interval apart (`INBOUND_WORK`), at most ONE job per workspace (`localGroupConcurrency: 1`) — so one workspace's backlog holds one worker and the others keep answering, and a workspace never has two turns at once (so neither does a conversation; the advisory lock stays the belt).
   - **Apart, not together:** three workers polling in the same instant are each handed one of the three oldest jobs; all one workspace's, two are put back — one job per poll for everybody, the backlog first. The fairness test read the quiet customer 6th–7th with aligned polls (3 runs of 3) and within the first few with staggered ones (5 of 5).
   - The in-process limit, not pg-boss's database one: that one races (three workers polling in the same millisecond each took one of the same workspace's jobs), and pg-boss accepts only one of the two. Production runs ONE replica; with more, the limit becomes one per workspace per replica.
   - **Batching kept whole under concurrency:** two of one workspace's jobs can be fetched in the same poll, and the one pg-boss keeps is not always the older — a batch's wake could run before the message sent right after the first was even recorded, and answer them apart (Q1's batched test caught it on CI, ~1 run in 4). The wake now waits (a second at a time, within the batch's hard window) while an inbound job of the SAME conversation is still queued or in flight with its message not yet a fragment (`src/worker/main.ts`). Proven 20/20 with the wait, 9/12 without.
   - Before: one worker, one job per 2-second poll for everybody — a dozen of one tenant's messages held another's for 24 s. Tests: `tests/integration/fair-queue.test.ts` (8 busy + 1 quiet with a slow model: the quiet one is read before the backlog clears, the busy one never runs two at once; switched off, the quiet one is read ninth).
35. **A send ceiling per workspace, and Meta's error rate for the operator** (CEIL, 0085, #136, 2026-09-30).
   - `businesses.daily_send_ceiling`: how many of the assistant's messages a workspace may send in a day (the gate's `dailyCeilingReached`, Shanghai day, the owner's own replies never counted). A workspace made from 0085 on starts at **50**; the 59 that existed kept 200 (`DAILY_OUTBOUND_CEILING`, also the gate's fallback). No owner switch: `tools/send-ceiling.mjs --business <uuid> [--set N]` (1–10000).
   - `meta_error_rates(since)` (definer): per workspace, messages to Meta's channels (WhatsApp, Instagram, Messenger) and how many Meta refused or lost (`failed`/`uncertain`), with the provider's own words — never our gate's `canceled: …`, never e-mail. Every hour (`ops.meta_errors`, :15) the operator is told of any workspace with ≥ 5 refused or lost AND ≥ one in five of the day (`src/core/ops/metaErrors.ts`) — the `meta_errors` operator alert, e-mail always, at most once in 6 h.
   - Tests: `tests/integration/send-ceiling.test.ts` (the gate at 50, the tool, the counting; the per-workspace read switched off, it fails), `tests/parity/send-ceiling.test.ts`.
36. **"Your accounts" on Channels, read live; the help page says what to check** (CH1 + CH2, #137, 2026-09-30; `src/channels/meta/health.ts`, `src/api/web/yourAccounts.ts`, `src/api/web/help.ts`).
   - Where the installation offers Meta's login, Channels shows the steps of connecting a Page, each marked from what is there: the Page; its Instagram (professional, linked); Meta's word on the token (`debug_token` with the app's token); the permissions the login asks for that Meta did NOT grant (named); the Page's subscription to THIS app for `messages` (`/{page}/subscribed_apps`); the newest message a customer sent on each channel (our own `client_channels`). Meta slow or down (5 s) is "could not check" — never a verdict, never a write.
   - A token Meta says is no longer good is recorded (`markMetaAccountNeedsAttention`, `revoked`) — the same state a failed send would have left, so every page and every send agrees.
   - The page watches its own mark (`channels` in `live.ts`: channels a customer wrote on, when, and the Page connection's state) and says when something changed.
   - `/app/help/meta` (CH2): one section per step — what to check, why — in en/zh/ar, linking only to Meta help pages read and named on 2026-09-30 (create a Page; professional Instagram account; connect Instagram and a Page). "Allow access to messages" has no such page: the step says where the setting is, and the first message proves it. Plus what works on Instagram and Messenger (24 hours; the customer starts; shared posts and story mentions come to the owner).
   - Tests: `tests/parity/your-accounts.test.ts`, `tests/integration/your-accounts.test.ts` (a Page connected through the real flow; Meta answering each way; the recorded dead token — switched off, it fails; the live mark; the help page in en and ar). The end-to-end check with a user who has no role on the app waits for App Review.

37. **Today is by time** (the design pass §4, #138, 2026-09-30; `src/api/web/today.ts`, `renderOperationsHome` in `operations.ts`).
   - Three blocks, one heading each: **who needs you now** (the Buyers list's own "Needs you" — `loadInboxList('pending')`, its order — the first five named with the row's reason, `needsWhy`, each a door to `#latest`; then counted doors: all of them, messages that did not reach a customer, deletion requests, questions the assistant could not answer; insights inside it), **the last 24 hours** (the assistant's lines with its ✦, the owner's plain; zeros unsaid; the Results door always), **coming up** (the calendar's next three from now, each to its order or conversation). At the foot: which channels send (or paused), Setup while unfinished, the budget notice.
   - Every figure inside a sentence through `tn` (six plural forms per key); no tiles. "The last 24 hours", not "since you last looked" — nothing records a visit. A blocked message or a waiting deletion request is enough to lift "No one is waiting for you".
   - Tests: `tests/parity/operations.test.ts`, the Today assertions in `boot`, `assistant-stop`, `ops-silence-handoff`, `deletion-handoff` (integration).

38. **Right to left, by design: every value on an owner page is isolated** (the design pass §9, #139, 2026-09-30; `src/api/web/values.ts`).
   - One function per kind of value — `show.money`, `quantityOf`, `count`, `date`, `time`, `when`, `phone`, `orderNumber`… (`import * as show from './values.js'`). Pages never import the display formatters from `core/owner/i18n/format.ts` (a test holds it); e-mail and WhatsApp to the owner keep the plain ones.
   - Right to left, each comes back inside U+2068 … U+2069 (what `<bdi>` does, as characters: it works inside a catalogue sentence, an `<option>`, an attribute). Arabic money is the locale's own form, "1.95 US$", its sign a left-to-right word of its own (without it the browser drew "$US 1.95"); Western digits stay. English and Chinese pages are unchanged.
   - The web `t`/`tn` isolate every figure run in a finished sentence (a text parameter carrying a figure goes in whole; the catalogue's own "30 days", "{done}/{total}" as one run each). Customer-typed text (product names, calendar titles) goes in `<bdi>`.
   - The test: the surface walk draws every owner page in Arabic over real rows and fails any digit run or currency sign outside an isolate (`tests/parity/isolates.ts` reads it). Tests that check a page's WORDS read it through `withoutIsolates`. No literal direction character may be written into the source — escape it (`\u2068`); the Write tool turns escapes into the characters, so check new files.

39. **Names, People, Setup, the door and the live line** (the design pass, UI-PASS 5–8 and 10, #140, 2026-09-30).
   - **Names:** in "Hand to" the reader is "You" (whoever the row is called). On People anyone called by the business's name — an owner provisioned before logins (0035) — is asked for their own (`namedLikeBusiness`: case, width, spacing aside; `POST /app/settings/people/:id/name`, owner-only). The transcript names each speaker (the customer by name, "You", the assistant); no lone role word under a message, and the Buyers row does not repeat the customer under their own name.
   - **People:** pills only for states ("online now"); "You" is plain text. Every owner-only act has its line on the page (a test; `data_rights` printed a raw key until 2026-09-30).
   - **No raw key on any page** (#141): the surface walk fails any page, en or ar, showing text shaped like a catalogue key; Practice's check labels are typed against `InvariantId` (a check without words fails the typecheck). A key built at run time (`` `x.${id}` ``) needs one of the two.
   - **Setup:** doors, each with its state (`.tlines`, as on Today): Getting ready's count, channels connected or not, the profile done or not, the kind of business, how many people. The profile is its own page, `/app/settings/profile` (saving lands there; `STEP_LINK.profile`). Log out is the rail's; Setup keeps one only on a phone.
   - **The door:** the e-mail first; the access code (the pilot's owner and staff codes) is a small door at the foot to its own card, `/login?with=code`, with a door back; a wrong code shows that card.
   - **The live line** sits in the page's header, in the flow — the Buyers title row and the conversation's head (`LIVE_SLOT` in the body; else under the title) — never sticky over the reply box, never fixed. An owner reading the bottom of a long conversation sees it on scrolling up; a screen reader hears it (polite region) wherever it is.

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
- ~~Self-service password recovery~~ — built as PWR (#133, rule 32).
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
