# Nomi — handoff for the next session

Last updated **2026-09-22**, after PR #50 deployed. Written so the next session
(starting **D**) needs nothing from the one that wrote it.

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

**Before any deploy that migrates:** backup via `tools/backup.sh` per
`docs/BACKUP-RESTORE.md`; after it, confirm `/health` and that
`schema_version` equals `REQUIRED_SCHEMA_VERSION`. See
`docs/LAUNCH-CHECKLIST.md`.

**Tooling quirks**
- The Bash safety classifier sometimes times out. Keep shell calls simple;
  prefer small Python scripts in the scratchpad for multi-anchor edits (assert
  each anchor occurs exactly once). If blocked repeatedly, give the user the
  exact command.
- The checkout lives in an **iCloud-synced Desktop**: it spawns `* 2.ts`
  duplicates that break `tsc`, and `.git/refs/heads/main 2` that breaks
  `git pull`. Move them to the scratchpad.
- No foreground `sleep`; use an `until …; do sleep N; done` loop or a
  background command.

## 3 · Verification set (run all four before a PR)

```bash
env -u DATABASE_URL -u MIGRATE_DATABASE_URL npm run check     # typecheck, boundaries, 2056 unit
npm run trust                                                 # 33/33 golden scenarios
npm run build
MIGRATE_DATABASE_URL=postgresql://postgres@127.0.0.1:55451/nomi \
DATABASE_URL=postgresql://nomi_app:nomi_app@127.0.0.1:55451/nomi \
  node tools/run-integration.mjs                              # 651/651, ~2 min
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

## 4 · What is live (production, 2026-09-22)

- **Deployed:** `bf86fd2` (merge of #50). `/health` → `{"ok":true,"db":true,"worker":true,"provider":"active"}`.
- **Schema:** 67. Last three: `0065 assistant_named`, `0066 ai_disclosed`,
  `0067 draft_replaced_by_disclosure`.
- **Backup before this deploy:** `~/nomi-backups/nomi-backup-20260922T142658Z`
  (schema 64; dump 1.4 MB / 1,448,801 B; roles 938 B), encrypted and uploaded
  to the `nomi-backups` bucket.
- **Fleet:** 59 businesses; **1 live** (the user's own; find it with
  `channels.activated_at is not null`), six capabilities set to auto. **Zero `assistants` rows** in
  production. Traffic is low (8 employee sends in the 7 days before deploy).

Recent PRs, newest first:

| # | What |
|---|---|
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
6. **Buyer references are gender-neutral** ("they"; 买家/对方; Arabic phrased
   with no pronoun agreeing with the buyer). The assistant is "she" by product
   convention; the owner is addressed in the feminine in ar by catalogue
   convention.
7. **Names come from the `assistants` table**, via `withAssistantName` /
   `assistantName(locale)`. `EMPLOYEE_NAME` is only a default at birth.

## 6 · What's next

**D — split the drawer.** Spec: `docs/IA-PROPOSAL.md` §D and "Decided —
2026-09-21". In short:
- Settings becomes **Setup** and joins the nav (five entries, no conditional
  sixth). While onboarding is incomplete: a **progress badge** on Setup, and a
  **"finish setup" card on Today**.
- The six *what you sell* pages (terms, samples, closures, rate, prices,
  products) go under **My business**; the three *how she behaves* pages
  (forbidden words, what she knows, practice) under **{assistant name}**.
- **Outreach** (sequences, prospects, write-first) behind a **per-workspace
  flag, OFF for new workspaces**, on for the pilot's. Hidden means **no links
  anywhere**, not just no nav entry.
- URLs do not move. `/app/factory` stays. No page is written twice.

**Then A** — merge Buyers into Customers (keep the name "Buyers"), with search
and paging.

**Parked / owner's to unblock**
- Native review of the zh/ar disclosure (gates all autonomy).
- The live workspace confirming its assistant's name.
- C4.d per-channel activation (after the pilot is live); M48 WeChat (needs an
  Official Account); M52 platform reviews (last, always).
- Pre-existing: the rest of the Arabic `/privacy` page addresses the reader in
  the feminine; it's a buyer page and should be neutral. Not touched in #50.

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
