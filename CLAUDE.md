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
sending under rules the owner sets. Owner UI in en / zh / ar (RTL) / es.

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

**No compliance or quality claim about a named vendor** (the owner, 2026-10-23, refined 2026-10-24)
- Never write a compliance or quality claim about a named vendor or competitor in this public repository, verified or
  not. If a point is worth making, make it about Nomi ("Avis 24 limits open current periods; Nomi enforces it").
- Facts we verified ourselves, against a source we can read (code, an official page), ARE kept — in the private notes
  outside the repo (the owner's `nomi-private` folder, as the isolation sweep's report since #366), with their
  sources. In public, say only the part about us (e.g. "no existing open-source Moroccan FEC export was available to
  reuse"). No vendor named in public; nothing lost in private.

**Asking first** (the owner, 2026-10-23)
- Ask before anything that **costs money, touches production, or sends data**
  to an outside service. Local dev tooling on this Mac (a Node version, a
  package for the checkout, a local database) needs no permission round-trip:
  install it, then say so. The zero-spend rule and production safety are what
  the asking protects, and a local install touches neither.

**Destructive actions**
- You do not permanently delete things. Move them (e.g. to the scratchpad)
  and let the user delete. This includes iCloud `* 2.ts` duplicates and stale
  git refs.
- **Never kill a process by name, pattern or port** (the owner, 2026-11-04). No `pkill`, `killall`, `kill $(pgrep …)`
  or `lsof … | xargs kill`. Kill only PIDs you started yourself. **Never touch another worktree's or session's temp
  folders.** Other sessions run on this Mac at the same time, with the same script names: a cleanup by name killed one's
  integration run and deleted its temporary Postgres (2026-11-04). If you did not start it, leave it and say so; if it
  holds a port, use your own `PORT`, `PGPORT` and `SK`.
- **Never edit an applied migration.** G20 checksums (`tools/migrate.mjs`)
  catch it. Write a new migration instead.

**Before any deploy that migrates:** a backup younger than the day — the
Railway cron (`backup/`, 03:00 UTC, see `docs/BACKUP-RESTORE.md` "Scheduled
backups") normally provides it; check `backup_runs` or the bucket's `daily/`.
Otherwise `tools/backup.sh` by hand. After the deploy, confirm `/health`,
that `schema_version` equals `REQUIRED_SCHEMA_VERSION`, and that
`tools/migrate-mark.mjs --expect <merge sha>` proves the pre-deploy step ran
(`docs/DEPLOYMENT.md`, "Proof it ran"). See
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
  hour there: always run them with a time cap (`timeout 120 git fetch …`), which ends
  its own stuck fetch. The user has the steps to move the repo to `~/dev/nomi`; if it has
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
env -u DATABASE_URL -u MIGRATE_DATABASE_URL \
  node tools/run-integration-isolated.mjs                     # its own Postgres; ~1590, none skipped
```

**Integration locally runs on a Postgres of its own** (since 2026-10-16):
`run-integration-isolated.mjs` makes one for the run, migrates it with this
checkout's migrations, seeds it as CI does, and removes it — about 20 s extra.
The shared 55451 database let a branch at 0166 fail against a database another
branch had taken to 0167 (#364's first run): two tests failed that were not
defects. **CI never had this problem** (a fresh Postgres per job) — do not
"fix" CI for it.

Run all of it on **Node 22** — production (Railpack reads `.nvmrc`: #353 was
built on 22.23.3) and CI use it. This Mac's default `node` is 26:
`PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"` (installed 2026-10-23;
22.23.2 left this Mac on 2026-10-07, and a PATH to a missing folder falls
through silently). **The runners now refuse any other Node** — `npm run check`,
`npm run trust`, both integration runners and `pre-pilot` stop with
"NOT RUN … .nvmrc pins 22" (`tools/lib/pinned-node.mjs`). `build` and `start`
are not guarded: Railway runs those.
#129 passed locally on Node 26 with `Intl.DurationFormat` and failed on CI.

For anything touching sending, also `node tools/pre-pilot.mjs --scripted`
(12/12) with the same two DB vars, **before and after**. For anything touching
the analysis prompt or the model (`LLM_MODEL` / `LLM_BASE_URL`), also the live
check, before and after: `npm run build && railway run --service nomi -- node
tools/check-person-model.mjs` — a model that stops answering `wants_person`
hands EVERY analysed turn to a person (§5 rule 19). Never run it while
the integration suite runs (both start pg-boss workers on the same queues).

Against a shared database (`run-integration.mjs` with the two URLs), the runner
prunes earlier runs' tenants **and their queued pg-boss jobs** first (PR #49).
If integration goes flaky there, suspect leftover state before suspecting code
— or run it isolated.

**Phase 5's working rhythm** (the owner, 2026-10-22; the plan is `docs/PHASE-5.md`):
- One branch per block: `phase5-A`, then `phase5-B`, `-C`, `-D`, `-S`.
- Commit after every finished item **and push the branch** (`git ls-remote` to confirm). A push triggers no CI (CI
  runs on pull requests and nightly) and means a session restart loses nothing.
- No PR and no merge per item. **One PR per block**, merged through `tools/gated-merge.sh` when the whole block is
  done.
- Tests are not skipped: each item passes its own tests locally before the next starts. The full four (above) run
  once at the end of each block, before its PR.
- Report to the owner once per block, not per item, unless something breaks or needs the owner's decision.

**PR flow:** branch from current `origin/main` → `gh pr create` →
`tools/gated-merge.sh N <head sha>` → poll
`railway deployment list --service nomi --json` until the merge commit is
`SUCCESS` → `curl https://app.nomidoes.com/health`. **While deploys are stalled
(production on #353), stop after the merge: no Railway check, and a merge is not
a deploy decision** (the owner, 2026-10-23; PROGRESS.md "Block E's review"). The
one deploy is decided once, and the pre-deploy checklist runs before it. Gate chained steps with
`&&`. Commits end with the Co-Authored-By line; PR bodies with the Claude Code
footer.

**Never merge on github.com; always through `tools/gated-merge.sh`** (the
owner, 2026-10-16). Since B, CI runs on pull requests and nightly on `main`,
not on every push to `main`; the script is what makes a PR's green run mean
the tree that lands. It refuses (exit 3, loudly) a PR not based on `main`'s
current head — rebase, push, gate the new head — and merges only on at least
two checks on that exact SHA, all completed and green. On GitHub Free a
private repo has no branch protection to require this; the script is the
requirement. A failed GitHub API call is never "no checks": it says so and
waits.

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
Schema-version history: `docs/team/history.md`
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

Recent PRs: `docs/team/prs.md`

## 5 · Open rules in force right now

Every rule below is in force; read its full text in docs/team/rules.md before working in its area.

1. **The disclosure gate is PER LANGUAGE** — `docs/team/rules.md`
2. **The assistant's name must be confirmed** — `docs/team/rules.md`
3. **Any message sent without approval** — `docs/team/rules.md`
4. **She never claims to be human** — `docs/team/rules.md`
5. **Owner-facing copy never says "AI" / 机器人 / 系统 / 模型** — `docs/team/rules.md`
6. **Nobody is gendered in copy** — `docs/team/rules.md`
7. **Names come from the `assistants` table** — `docs/team/rules.md`
8. **The outreach area is per workspace, OFF by default** — `docs/team/rules.md`
9. **Every page draws from `workspaceFacts`** — `docs/team/rules.md`
10. **The backup alert never depends on WhatsApp** — `docs/team/rules.md`
11. **Money and going live are the owner's** — `docs/team/rules.md`
12. **nomidoes.com is served by this app** — `docs/team/rules.md`
13. **The owner's Stop binds the assistant on every channel** — `docs/team/rules.md`
14. **The owner's words survive a refusal** — `docs/team/rules.md`
15. **A buyer's data can be deleted, and /data-deletion says exactly how** — `docs/team/rules.md`
16. **The conversation page always shows the newest messages** — `docs/team/rules.md`
17. **Errors are reported and the app has a heartbeat** — `docs/team/rules.md`
18. **A buyer who asks in chat for their data to be deleted** — `docs/team/rules.md`
19. **"Wants a person", in two layers** — `docs/team/rules.md`
20. **Buyers is ONE list** — `docs/team/rules.md`
21. **A page left open says when something new arrived** — `docs/team/rules.md`
22. **A workspace that exists gets a login from the operator, never from SQL** — `docs/team/rules.md`
23. **An order waits for the owner's tap, in every mode** — `docs/team/rules.md`
24. **A product may have no minimum order, and nothing pretends it has** — `docs/team/rules.md`
25. **The design foundation** — `docs/team/rules.md`
26. **The calendar is a week, and the owner's own dates are on it** — `docs/team/rules.md`
27. **What a reply promised is on the calendar, from the words that left** — `docs/team/rules.md`
28. **Small truths from the build order** — `docs/team/rules.md`
29. **Every paid call is on the ledger, on the UTC day** — `docs/team/rules.md`
30. **A product is found by its names, and only a findable product is "ready"** — `docs/team/rules.md`
31. **The analyser sees the last six messages** — `docs/team/rules.md`
32. **A forgotten password: "e-mail me a link"** — `docs/team/rules.md`
33. **`CREDENTIAL_KEY` can be rotated without a token lost** — `docs/team/rules.md`
34. **The inbound queue is shared fairly between workspaces** — `docs/team/rules.md`
35. **A send ceiling per workspace, and Meta's error rate for the operator** — `docs/team/rules.md`
36. **"Your accounts" on Channels, read live; the help page says what to check** — `docs/team/rules.md`
37. **Today is by time** — `docs/team/rules.md`
38. **Right to left, by design: every value on an owner page is isolated** — `docs/team/rules.md`
39. **Names, People, Setup, the door and the live line** — `docs/team/rules.md`
40. **Practice is per workspace: a copy that can reach nobody** — `docs/team/rules.md`
41. **One time zone per workspace, chosen at sign-up** — `docs/team/rules.md`
42. **One currency per workspace, no conversion** — `docs/team/rules.md`
43. **The positioning rewrite** — `docs/team/rules.md`
44. **An import is a kept list the owner checks row by row** — `docs/team/rules.md`
45. **"Prices go to me"** — `docs/team/rules.md`
46. **Ask about three of these** — `docs/team/rules.md`
47. **Store import** — `docs/team/rules.md`
48. **How a business sells** — `docs/team/rules.md`
49. **How you sell** — `docs/team/rules.md`
50. **Alerts about a customer go by e-mail too** — `docs/team/rules.md`
51. **A reply the owner types in Instagram's or Messenger's own app** — `docs/team/rules.md`
52. **Alerts on the phone; a reply that waited too long; the channel's own name** — `docs/team/rules.md`
53. **"Nomi and Meta" on Channels** — `docs/team/rules.md`
54. **A stranger signs up** — `docs/team/rules.md`
55. **A workspace is born with what the cohort needs** — `docs/team/rules.md`
56. **The day's allowance is held to BEFORE the model** — `docs/team/rules.md`
57. **Sending alone is earned in a workspace that signed itself up** — `docs/team/rules.md`
58. **"Ready for customers"; the installation's facts are the operator's** — `docs/team/rules.md`
59. **The operator's controls** — `docs/team/rules.md`
60. **The cohort's funnel, read from what is on record** — `docs/team/rules.md`
61. **A draft the owner may not be able to read** — `docs/team/rules.md`
62. **Opening the first cohort** — `docs/team/rules.md`
63. **The ramp: sending alone is earned in two rungs** — `docs/team/rules.md`
64. **The first quote of each product waits for the owner** — `docs/team/rules.md`
65. **The gate reads the customer's language by fixed rules** — `docs/team/rules.md`
66. **Supervision after promotion** — `docs/team/rules.md`
67. **The es / fr / pt packs** — `docs/team/rules.md`
68. **Claims by product category** — `docs/team/rules.md`
69. **A product's options, and stock goes to the owner** — `docs/team/rules.md`
70. **Mail strangers cause leaves by a dedicated sender, under daily caps** — `docs/team/rules.md`
71. **The installation has a daily spend ceiling; past it the beta waits** — `docs/team/rules.md`
72. **The sign-up's own guards before open mode** — `docs/team/rules.md`
73. **The operator approves each workspace's first connection** — `docs/team/rules.md`
74. **A workspace that never connected a channel goes after 90 days** — `docs/team/rules.md`
75. **Billing** — `docs/team/rules.md`
76. **The site's button follows sign-up as it stands** — `docs/team/rules.md`
77. **Lists the parser cannot read, and the pages of her own site** — `docs/team/rules.md`
78. **A shared post or a story reply** — `docs/team/rules.md`
79. **The owner's pages in Spanish** — `docs/team/rules.md`
80. **A business connects its OWN WhatsApp number** — `docs/team/rules.md`
81. **The guided path, with videos** — `docs/team/rules.md`
82. **The send path** — `docs/team/rules.md`
83. **Audit batch 3** — `docs/team/rules.md`
84. **A stop never waits for ever** — `docs/team/rules.md`
85. **The Split Today design, and the serif** — `docs/team/rules.md`
86. **Who needs you, and a cut name** — `docs/team/rules.md`
84. **Nothing of the writer's JSON reaches a customer** — `docs/team/rules.md`
87. **The OpenAI format under the one client** — `docs/team/rules.md`
88. **The page is "Inbox", in the Split look** — `docs/team/rules.md`
89. **The fallback, at Anthropic's own address** — `docs/team/rules.md`
90. **The assistant says "I", and promises only what happens** — `docs/team/rules.md`
91. **A payment lands in a bank or cash account the owner names** — `docs/team/rules.md`
92. **Block 1 of the finishing roadmap, the items without a migration** — `docs/team/rules.md`
93. **Block 1's records** — `docs/team/rules.md`
94. **The books' country packs: Morocco, the United Kingdom, the United States** — `docs/team/rules.md`
95. **Invoices that go out** — `docs/team/rules.md`
96. **Spending: bills, categories, recurring costs** — `docs/team/rules.md`
97. **The Books home is wired to the rows behind it** — `docs/team/rules.md`
98. **Reports in the owner's words** — `docs/team/rules.md`
99. **The assistant's voice, chosen once** — `docs/team/rules.md`
100. **Procedures** — `docs/team/rules.md`
101. **Before it goes live — "did teaching break anything?"** — `docs/team/rules.md`
102. **The hand-off that carries context** — `docs/team/rules.md`
103. **Two layers everywhere: the rail and each area's section sidebar** — `docs/team/rules.md`

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

D deployment orientation: `docs/team/history.md`

**Owner decisions, 2026-09-27**
- The personal address removed from `docs/legal/PRIVACY-zh.md` stays in git history — the owner chose not to rewrite history (open PRs; the address is public on served pages).
- Manual backups prune after 180 days (#99). Open: the pre-0026 backups that BACKUP-RESTORE.md once said "do not prune" will go from about 2027-02-04 unless moved out of the bucket root — the owner's call. PITR keeps ~4 weeks (Railway: last 4 weekly full backups); Railway volume-backup retention was not checked (not visible to the tools).
- **Deletion requests in chat → a person, nothing sent** — the owner chose NOTHING (no receipt, no acknowledgment); built and deployed as #102 (§5 rule 18).
- **"Wants a person": the buyer's own manager is not a hand-off** (#107, rule 19). The other words' problems were reported and left for the owner.
- **…written down when the hand-off fires, with its own alert** (#105). Claude's calls, reported: a repeat while one waits REUSES it (counted; the first time is when it was received); a waiting request shows on Today (second row); the alert names no date (none is stored before the owner records it).

**Owner decisions and Claude's calls, 2026-09-28**
- **Decision 5: the row stays as it is for V1 — deliberately provisional** (Symow, 2026-09-28; recorded in his words, brief §8). A larger UI/UX pass comes later; what it should look at first is `docs/UI-PASS-CANDIDATES.md`. The calendar's kind is its own choice: the first word of the entry's line, never a pill (#116).
- **"Wants a person" in two layers** (rule 19). Claude's calls, reported: the model's layer sits inside the analysis, before any reply; an unreadable answer or a failed turn is a SILENT hand-off (`not_answered`), like an unheard voice note; the analysis gives up after 30 s and one retry; latency measured live +39 ms median; identity questions are answered with the disclosure rather than handed off; the two live hand-offs among the 45 passing mentions are kept.
- **A** (rule 20): "unread" is not recorded anywhere, so the row says who wrote last (a real per-person "seen" is a migration; since 0223, one "opened" per conversation, rule 86); search leaves message text out (a full-text index is a migration); Customers' VIP-first order is dropped (only the demo seed set VIP); the relationship pill stays on the buyer's page, not the row. Arabic `common.buyer` is مشترٍ now (was عميل), for the native read.
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
- **Fixed 2026-09-30 (#144, the owner's decision): Stop pressed while a
  customer's lines wait to be grouped** is recorded as "stopped". The hold is a
  turn (`decision.action.kind = 'held'`, reason `assistant_stopped` /
  `ops_silenced`; no analysis, no model), the waiting lines are processed in
  it, and the conversation is handed over as stopped. Its `answer_path` is
  `silent` (the plan's HF); Today's "handled" and the herWords card leave held
  turns out.
  `tests/integration/assistant-stop.test.ts` › GROUPING failed before the fix
  with the foreign-key error.
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
