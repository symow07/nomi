# Nomi — handoff for the next session

Last updated **2026-09-24**, in the PR that queues **V1 / V2**. Written so the
next session needs nothing from the one that wrote it.

Nomi is a server-rendered Fastify + Postgres app: an AI sales employee
("Lily" by default — but the name is the owner's, see below) that answers a
business's buyers on WhatsApp / Instagram / Messenger / e-mail, drafting or
sending under rules the owner sets. Owner UI in en / zh / ar (RTL).

---

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
env -u DATABASE_URL -u MIGRATE_DATABASE_URL npm run check     # typecheck, boundaries, ~2100 unit
npm run trust                                                 # 33/33 golden scenarios
npm run build
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55451/nomi \
DATABASE_URL=postgresql://nomi_app:nomi_app@127.0.0.1:55451/nomi \
  node tools/run-integration.mjs                              # ~660, none skipped, ~2 min
```

For anything touching sending, also `node tools/pre-pilot.mjs --scripted`
(12/12) with the same two DB vars, **before and after**. Never run it while
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

## 4 · What is live (production, 2026-09-23)

- **Deployed:** `ad3435f` (merge of #70). `/health` →
  `{"ok":true,"db":true,"worker":true,"provider":"active"}`; production
  `schema_version` = **69**; exactly one business has `outreach_area` on.
- **Schema:** 69. Last three: `0067 draft_replaced_by_disclosure`,
  `0068 outreach_area`, `0069 backup_runs`.
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

1. **Nothing sends alone anywhere until the zh/ar disclosure has native
   review.** `DISCLOSURE_NATIVE_REVIEW` in
   `src/core/conversation/disclosure.ts` = `{ en: true, zh: false, ar: false }`.
   Enforced on both owner routes that turn autonomy on **and** at the send
   decision in `commitTurn` (`autonomy_withheld: disclosure_not_reviewed`).
   No env var lifts it. To lift: native speaker reviews, flags flipped in the
   same commit, reviewer named, and the assertion in
   `tests/integration/autonomy-level.test.ts` updated deliberately.
2. **The assistant's name must be confirmed** (Getting ready →
   `onboarding_state.assistant_named_at`) before activation, and before
   anything sends alone. The live workspace must confirm its name.
3. **Any message sent without approval** carries the AI disclosure on the
   first such message of a conversation; again whenever a buyer asks what they
   are talking to. A reply the disclosure replaced cannot be sent unchanged
   (`needs_edit`).
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
7. **Names come from the `assistants` table**, via `withAssistantName` / `assistantName(locale)`, and **count only once chosen**.
   - The main assistant's row name is a default until Getting ready stamps `assistant_named_at` (`chosenName` in `src/db/assistants.ts`). Until then, owner copy says "your assistant" / 你的助手 / مساعدك (`ASSISTANT_FALLBACK`), and the model gets no name.
   - `DEFAULT_ASSISTANT_NAME` is only the row's value at birth. There is no `EMPLOYEE_NAME` any more.
8. **The outreach area is per workspace, OFF by default** (`businesses.outreach_area`, 0068).
   - Off means: every `/app/contacts|prospects|sequences` and `/app/channels/outreach` address is 404 (preHandler in `app.ts`, `isOutreachRoute`), no page links there, and `outreachFacts` reports not enabled, so nothing is written first — whatever `outreach_settings` says.
   - No owner switch. Operators use `node tools/outreach-area.mjs --business <uuid> --on|--off`.
   - On for Westlake Canvas Co. only.
9. **Every page draws from `workspaceFacts`** (`src/db/workspace.ts`): name, several, outreach, and the five-step setup progress (`src/db/setup.ts` — profile, products, name, channels, first reply). Cached a minute per business in `app.ts`; every write that completes a step calls `facts.evict`. The Setup nav entry shows `done/total`; Today shows a "finish setting up" card; both vanish when complete.
10. **The backup alert never depends on WhatsApp.** `backup_stale` (daily check, `QUEUES.backups`, 06:30 UTC; rule in `src/core/ops/backups.ts`, 36 h) goes by e-mail to the owner's sign-in address always, and by WhatsApp only where a channel is live (`deliverBackupAlert` in `src/pipeline/notify.ts`). `tests/integration/backup-watch.test.ts` proves it fires with no channel connected. The job writes `backup_runs`; the app may only read it.

## 6 · What's next

The queue is `docs/ROADMAP.md` §2b (written 2026-09-24). In order: the owner
runs the usability script → **V1 visual design pass** (Symow directs, Claude
Code implements) → **A** → **V2 calendar view** → Phase 4 permissions and
first-run → Phase 5 marketing site → Phase 6 billing, then Meta Tech Provider.
**V1 is in progress.** Decisions 1–4 are in the brief's §8 (Symow,
2026-09-24); decision 5, the row, waits for the usability session. Step one
(tokens, #64) and step two (one stylesheet + the components page, #66)
shipped, and step three (the shell, #68) too: the phone nav is sticky and
compacts through a CSS scroll timeline (no script — measured in
`docs/design/v1-step3/`), the name band scrolls away, the mark is the
product's, the Setup count sits with its word. **Option A built** (brief
§11): no header band on any width; the language switch and log out are
Setup's first rows; the login page keeps its switcher; `header.stage`
retired. Chrome at rest on a phone is the nav row alone.
**Step four is under way:** pages retire their `<style>` blocks onto the
shell's families (brief §8, decision 4). First batch done: ten small pages,
baseline 40 → 30 (`tools/style-baseline.json`; lower it each time). Still
carrying a block: Today (`operations.ts`), Buyers (`inbox.ts`, waits on
decision 5), Customers (`conversations.ts`), My business (`factory.ts`),
products, the assistant (`employee.ts`), Practice (`sandbox.ts`), channels,
knowledge and its insights, Getting ready (`pilot.ts`), Setup
(`settings.ts`), contacts, sequences, proof; and the two public pages
(legal, unsubscribe) which have no shell. Each is a PR with screenshots.
Recurring traps: a CSS comment or class name ships to the browser and is
scanned (no "token", no "stack", no "%"); a page never paints its own
notice (`flashBanner`); `<a class="btn">` is still common — the
buttons-versus-doors rule is not tested yet. **The V1 brief for Symow is `docs/DESIGN-V1-BRIEF.md`**
(tokens, where styling lives — 40 page-level stylesheets, 37 classes defined
twice — the component inventory, 27 surfaces, what the screenshots show, the
five decisions in the shape the implementer needs). Reference screenshots in
`docs/design/v1-before/`; the full set is `node tools/screenshots.mjs` on a
local instance (its login was fixed 2026-09-24).

**The usability session** (top of the queue, the owner runs it): two commands
prepare the local workspace — `bash .claude/skills/run-nomi/smoke.sh`, then
`MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/nomi node
tools/seed-usability.mjs`, which checks the script's list and says Ready.
Login: "I have an access code" → `smoke-code`. The doc has the three ways a
local instance differs. Never host the 55451 integration cluster in
`/tmp/yf-run`: `smoke.sh` wipes it (it did, 2026-09-24; rebuilt in the
session scratchpad — see memory `local-integration-postgres`).

**A — merge Buyers into Customers** (keep the name "Buyers"), with search and
paging. Spec: `docs/IA-PROPOSAL.md` §A. `/app/conversations` then redirects
to `/app/inbox`; the hub map's `/app/conversations` group moves with it.
Styled in V1's language, so it comes after V1.

D shipped (see §4). What it did, for orientation: `src/api/web/layout.ts`
(NAV, `CONTEXTUAL_ROUTES_BY_HUB`, `OUTREACH_PREFIXES`), `src/db/workspace.ts`
+ `src/db/setup.ts`, the Setup page (`settings.ts`), the "How you sell"
section on My business, the "More about {name}" doors on the assistant's
page, the Today card (`operations.ts`), the outreach gate (`app.ts`
preHandler, `db/outreach.ts`). Tests: `tests/parity/d-split-drawer.test.ts`,
`tests/integration/outreach-area.test.ts`.

**Parked / owner's to unblock**
- Native review of the zh/ar disclosure (gates all autonomy).
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
- Local Postgres: port 55451 (see memory "local-integration-postgres").
