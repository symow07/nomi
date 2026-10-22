# Launch checklist

Things that must be true before a capability, a channel or a workspace is
switched on in production. Each item says **where it is enforced**, because a
rule that lives only in this file is a rule somebody will miss at 2 a.m.

## Autonomy — anything sent without the owner reading it first

### 1. The zh and ar AI disclosure have had native review

**Hard rule.** No workspace turns on any autonomy capability in production until
a native speaker has read the Chinese and Arabic disclosure text and signed it
off.

- **Enforced in code.** `DISCLOSURE_NATIVE_REVIEW` in
  `src/core/conversation/disclosure.ts` is `{ en: true, zh: false, ar: false }`.
  While any value is `false`, `autonomyReleased()` is false, and:
  - the route that saves her choice (`POST /app/employee/autonomy`) refuses every
    level except `waits`, with a flash saying why;
  - her autonomy page says it above the three levels.
- **Proved** by `tests/integration/autonomy-level.test.ts` ("no autonomy until
  the disclosure has had native review"), which drives the real route against
  the real flag. It asserts the flag is down today — so flipping it without
  meaning to fails CI.
- **To lift it:** a native speaker reads the `zh` and `ar` strings in
  `disclosure.ts` and says what to change; apply their changes, set both flags
  to `true`, and update that test's first assertion — all in one commit, with
  the reviewer named in the commit message.

Why a gate and not a note: this is the one sentence in the product whose job is
to tell a buyer the truth about what is answering him. A translation that is
merely close is not good enough for it, and a workspace that writes only English
today can receive an Arabic message tomorrow.

### 2. The assistant's name is confirmed

- **Enforced in code.** Activation refuses with `assistant_not_named`
  (`src/channels/activation.ts`), and a capability in auto falls back to draft
  while the name is unconfirmed or there is no name to say (`commitTurn`,
  `autonomy_withheld` on the timeline).
- **Where the owner does it:** Getting ready (`/app/onboarding`), pre-filled
  with the signup-locale default.

As of 2026-09-22, production has **zero** `assistants` rows. Every workspace,
including the one live one (Westlake Canvas Co.), must confirm its name after
0065 deploys before anything is sent alone.

## Before any deploy that migrates

- **Backup first**, per `docs/BACKUP-RESTORE.md` (`tools/backup.sh`, roles +
  dump, encrypted, uploaded). The schedule is manual: before every migration.
- **After the deploy**, confirm `/health` answers and `schema_version` equals
  `REQUIRED_SCHEMA_VERSION` in `src/db/schemaVersion.ts`.

## Before the third paying workspace — BLOCKING (the owner, 2026-10-15)

- **The owner's advisor is metered.** `answerFollowUp` (`src/advisor/answer.ts`)
  makes up to two model calls a question with no allowance check and no spend
  record: one workspace's staff can spend without limit, uncounted, where the
  installation's spend breaker cannot see it. The owner's words: "metered
  before the third paying workspace." Not before. Not after. The isolation
  sweep, item 10 (the sweep report (kept outside the repo since 2026-10-16)).

## Before the books are switched on for ANY workspace — BLOCKING (the owner, 2026-10-21)

The books are off everywhere (`businesses.books_area`, 0176), and no workspace
holds papers. An owner who wants to stop using Nomi and have their data erased
must always be able to, and today a workspace holding papers cannot close.
That is acceptable only while nobody has the books. So, before
`tools/books-area.mjs --on` runs for anyone:

- **The owner's copy of their papers, and closure of a workspace holding
  papers.** Closing refuses (NE011, `erase_workspace_rows`, 0174) while
  documents exist, because the closing copy does not carry the papers yet.
  This is lifted only when the papers copy is built.
- **The public pages describe the books.** `/privacy` and `/data-deletion` say
  what is kept when a workspace closes, for how long, why, and that the owner
  leaves with their copy (PHASE-5.md §6). And `/privacy` names the shop's own
  systems the books can read from: Odoo (B4). Google Sheets is already held
  by D18, which stops the boot while `SHEETS_CLIENT_ID` is set and the privacy
  page does not name it; Xero (D8) and QuickBooks (D9) the same way, by `XERO_CLIENT_ID` and `QBO_CLIENT_ID`. And it says that a receipt, invoice or bill the owner
  asks Nomi to read is sent to the model provider, which reads it (D6).

Enforced in `tools/books-area.mjs`: `--on` refuses while `BLOCKERS`
(`tools/lib/books-blockers.mjs`) names an item, and prints each one. Remove an
item there in the commit that builds it. `tests/parity/books-launch-blockers.test.ts`
holds the tool and this list together.

## Before the books are switched on for a MOROCCAN workspace — BLOCKING (the owner, 2026-10-22)

A Moroccan workspace's FEC (D4) is not finished, and a file the DGI rejects on
its name is a file that does not work:

- **The business's legal identifiers — ICE, IF and RC — held on its profile**,
  shape-checked, and carried by the FEC.
- **The FEC named as the DGI requires.** Checked on 2026-10-22:
  - the Avis n° 24 sets no name and no envelope (Article 2 and point 3 name
    the file and its fields only);
  - the CGI 2026, article 210, asks for "une copie du fichier des écritures
    comptables établi selon un format électronique", with no name;
  - the DGI's 2025 activity report says its system for receiving FECs
    electronically is built, and publishes no specification;
  - the DGI's EDI specification (cahier des charges du mode EDI) lets its XML
    files be named freely — those are declarations, not the FEC, so that rule
    is not assumed here either.

  So the name is NOT known. It is not inferred from the French convention
  (SIREN + "FEC" + closing date). It waits for the DGI's own text, or the
  owner's accountant's confirmation of what the DGI accepts.

Enforced in `tools/books-area.mjs`: for a workspace whose country is Morocco,
`--on` refuses while `MOROCCO_BLOCKERS` (`tools/lib/books-blockers.mjs`) names
an item.

## Start early — lead-time items (the owner, 2026-10-22)

These cost nothing to begin and can each turn a ready product into a wait of
weeks. They start well before the deploy that needs them:

- **Intuit's App Assessment Questionnaire (QuickBooks, D9).** Production keys
  appear ("Show Credentials") only after Intuit approves the questionnaire, and
  the app details it needs: EULA and privacy URLs, host domain, launch,
  disconnect and connect/reconnect URLs, categories, regulated industries,
  hosting regions (developer.intuit.com, "Publish your app"). It can be
  reviewed and sent back for changes. Submit it as soon as the privacy page
  names Intuit.
- **Xero (D8): no review before production on the Starter tier**, as Xero's
  documentation stands (2026-10-22):
  - new apps default to Starter: 5 connections, no payment method;
  - certification is required only from the Plus tier (more than 50
    connections) and for an App Store listing;
  - limits that apply meanwhile: an organisation may connect at most five
    uncertified apps, and Starter allows 1,000 API calls a day per
    organisation;
  - the only step is accepting Xero's Developer Platform Terms (updated
    2 March 2026) when the app is made.

  Confirm on the day the app is created; nothing here needs starting early.
- **Xero's real ceiling, before certification** (the owner, 2026-10-22): 1,000 API calls a day per organisation,
  and at most five uncertified apps per organisation. That is a scaling limit, not a launch one. It decides when
  certification stops being optional:
  - a busy organisation's reads (the morning read, the owner's "Read it in", writing back) near 1,000 a day;
  - more than 50 connections (Core's ceiling) means the Plus tier, which requires certification.

## Phase 5 S — before these reach a buyer (2026-10-22)

Built and switched off by design; each waits on a person, not on code:

- **Surveys (S6):** nobody is asked anything until the sentence is signed in its language
  (`src/core/conversation/survey.ts`, `SIGNED`): the owner signs the English, a native reader each of the others,
  named in the commit. Then the owner switches surveys on (`/app/surveys`).
- **Strict mode (S4):** in force in no language until a native reader signs a set (`src/core/conversation/strict.ts`,
  `SIGNED`; the starter sets are `PROPOSED`). Telling the writer the set needs the live model check: ask first.
- **Telegram (S7):** the owner creates Nomi's bot with @BotFather and pastes `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_USERNAME` into Railway (docs/env-checklist.md). After the deploy, run
  `railway run --service nomi -- node tools/telegram-webhook.mjs` once, then `--check`. Each business then turns it
  on and shares its start link.
- **The chat page (S7):** nothing to set up; each business turns it on and shares its address or the widget's line.
- **D10 (Morocco):** waits for an accountant's answer on what a « période » is (PHASE-5.md, D10: the question is
  written there, in French).

## Somebody hears when it breaks (CC-10)

- `HEALTH_PING_URL` is set on the `nomi` service and the Healthchecks.io
  check "Nomi app" is green — the steps are in `docs/MONITORING.md`. Railway
  only swaps in a deploy whose `/health` answers (`railway.json`).
- Errors inside the app reach the pilot workspace's sign-in address; read them
  with `node tools/errors.mjs` (same page).
