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

- ~~**The owner's advisor is metered.**~~ **DONE (A4, audit batch 5, 2026-10-31).**
  Before each question, the advisor route asks the day's allowance (the rule every
  model call follows, the installation's spend breaker included); used up, the
  model is asked nothing and the owner reads "Today's allowance is used up, so
  nothing was looked up" (`advisor.allowanceUsed`). Every call that answered is
  written on the workspace's ledger, calls and tokens, never a turn
  (`answerFollowUp` returns `spent`; the route records it through its `spent`
  port). Tests: `tests/integration/advisor-metering.test.ts`, the A4 cases in
  `tests/parity/advisor-build.test.ts`. Was: up to two model calls a question,
  unchecked and unrecorded (the isolation sweep, item 10).

## Before any customer or workspace in the EU or UK — BLOCKING (the owner, 2026-10-28)

- **Before any customer or workspace in the EU or UK: counsel confirms the transfer basis and safeguards for
  DeepSeek (China), and the privacy page says it.** GDPR art. 13(1)(f) (and the UK GDPR's) asks the page to say that
  personal data goes to a country outside, and on what basis. `/privacy` names where it goes ("DeepSeek (China)";
  messages, pictures and documents "are processed there") and says nothing of a basis or safeguards — none is
  written that we cannot back up. The same question for Morocco is PHASE-5.md §6.4
  ([§6, item 4](PHASE-5.md#6--the-privacy-load-accepted-as-written-with-the-owners-note)), parked as a lawyer's
  question.
- **Workspaces: held at sign-up** (2026-10-28, `src/core/legal/transfer.ts`). A business whose country is in the EU,
  the EEA (Iceland, Liechtenstein, Norway — the GDPR applies there in full) or the UK is told plainly, with the legal
  contact address, before any code is sent, and again at `/verify` if the hold came back while the code was out.
  Nothing it typed is kept. **The switch is the owner's:** `EU_UK_SIGNUP=open` on the `nomi` service lifts it — only
  once this line is cleared and `/privacy` says the basis. Unset (today) holds. Not covered: a workspace the operator
  makes by hand (`provision-factory.mjs`) and the 59 made before — none has an EU, EEA or UK country (production,
  2026-10-28).
- **Customers: cannot be gated.** No customer's country is recorded: Instagram and Messenger give none, and a
  WhatsApp number's calling code says where the number was issued, not where its holder lives or is. So a customer
  in the EU or UK writing to any workspace, Westlake included, is not held by anything; that part of this line is the
  owner's to weigh with counsel, not something the code can enforce.

## Before the books are switched on for ANY workspace — BLOCKING (the owner, 2026-10-21)

The books are off everywhere (`businesses.books_area`, 0176). An owner who
wants to stop using Nomi and have their data erased must always be able to.
So, before `tools/books-area.mjs --on` runs for anyone:

- ~~The owner's copy of their papers, and closure of a workspace holding
  papers.~~ **Done (E1, 0205, 2026-10-22):** the owner downloads every paper in
  one archive with its index (`/app/settings/data/papers.zip`), and closing
  waits for the owner's own copy of every one (NE012) — an accountant's
  download does not count, and a paper added later makes the copy old again.
- ~~**The public pages describe the books.**~~ **Done (A6's lines, 2026-10-28; the owner reads the wording
  before it merges):** `/privacy` has "If your business keeps its books in Nomi" (what they hold, who sees them,
  Odoo, the reader, what closure keeps and why, imported history), and `/data-deletion` lists the books among what
  is kept and the shop's own copies among what is the shop's to delete. Odoo is named (D18). The item, as written:
  `/privacy` and `/data-deletion` say
  what is kept when a workspace closes, for how long, why, and that the owner
  leaves with their copy (PHASE-5.md §6), including that an imported file kept
  as history is kept whole until its newest entry's date, so its older entries
  outlast their own (the owner, 2026-10-23; Your data already says it). And `/privacy` names the shop's own
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

- ~~The business's legal identifiers — ICE, IF and RC — held on its profile,
  shape-checked, and carried by the FEC.~~ **Done (E2, 0206, 2026-10-22):** held
  on the business, given on its profile by the owner (`business_identifiers`),
  and carried on every line of the FEC after the Avis's eighteen fields. Checked
  only where an official source publishes a rule (PHASE-5.md, E2): the ICE's
  15 positions (OMPIC; the ICE portal's guide), and a party's ICE by the same
  rule, only for a party in Morocco (0208). The IF has no published format and is kept as typed; the RC is
  kept with its court (Code de commerce, art. 49 and 154), its number unchecked:
  no rule because no source, not "no rule yet". The FEC page names any of the
  three still missing.
- ~~**The FEC named as the DGI requires.**~~ **Closed (R2, 0209, 2026-10-23):
  no official name exists, so the name is a configurable default.** Checked on
  2026-10-22 and again for R2: the Avis n° 24 annex ends at "Id devise" and sets
  no name, extension, separator or encoding; CGI art. 210 asks for "une copie du
  fichier des écritures comptables" with no name; the DGI's 2025 activity report
  says its reception system is built and publishes no specification. Nomi's
  default is `{ICE}FEC{YYYYMMDD}.txt` (the business's ICE, "FEC", the fiscal
  year's last day), and each workspace's owner can change it on the FEC page,
  which says, word for word: "Nomi's default filename convention. Your
  accountant may ask for a different one — you can change it here." Never
  "required", "official" or "DGI-compliant" (PHASE-5.md, R2).

Enforced in `tools/books-area.mjs`: for a workspace whose country is Morocco,
`--on` refuses while `MOROCCO_BLOCKERS` (`tools/lib/books-blockers.mjs`) names
an item. **Since R2 it names none:** nothing in this section blocks any more.


## Before the books are switched on for a shop selling to companies OUTSIDE Morocco — BLOCKING (the owner, 2026-10-23)

- ~~**A party registry-number field.**~~ **Built (R3, 0210, 2026-10-23)** for France (SIREN, SIRET), the United
  Kingdom (company number) and every other country (kept as typed), with Spain's Registro Mercantil entry; copied
  onto invoices and credit notes at issue (PHASE-5.md, R3).
- ~~**Spain's NIF rule.**~~ **Decided and built (the owner, 2026-10-23):** all three forms (an entity's, a person's,
  a foreign resident's NIE) pass; any other nine capitals and digits warn, never refuse. Nothing in this section
  blocks any more.
- **Not blocking, said on the books' page (`books.notYet.registry`):** no connector carries the registry number yet.

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

- **Four sentence sets, signed in ONE pass** (the owner signs the English, a native reader each of the others, named in
  the commit that writes them into `SIGNED`):
  1. the survey question (`src/core/conversation/survey.ts`, `TEXT`);
  2. the survey's thank-you (`survey.ts`, `THANKS`) — until signed, an answer is met by silence (a known gap);
  3. the Telegram /start greeting (`src/core/conversation/greeting.ts`) — until signed, a /start is met by silence;
  4. strict mode's starters (`src/core/conversation/strict.ts`, `PROPOSED`).
  Then the owner switches surveys on (`/app/surveys`).
- **Strict mode (S4) is built and NOT USABLE** until the writer is taught the signed sentences: that needs a bounded
  live model run, which the owner approves with a call count when there is budget.
- **Telegram (S7):** the owner creates Nomi's bot with @BotFather and pastes `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_USERNAME` into Railway (docs/env-checklist.md). After the deploy, run
  `railway run --service nomi -- node tools/telegram-webhook.mjs` once, then `--check`. Each business then turns it
  on and shares its start link.
- **The chat page (S7):** nothing to set up; each business turns it on and shares its address or the widget's line.
- **D10 (Morocco):** nothing to set up. The period length is decided (the owner, 2026-10-27): each workspace chooses
  month or quarter when its books start, monthly by default (PHASE-5.md, D10). The rule engages for a Moroccan
  workspace the moment its owner starts the books on the closing page.

## Somebody hears when it breaks (CC-10)

- `HEALTH_PING_URL` is set on the `nomi` service and the Healthchecks.io
  check "Nomi app" is green — the steps are in `docs/MONITORING.md`. Railway
  only swaps in a deploy whose `/health` answers (the service's Healthcheck Path, `docs/DEPLOYMENT.md`).
- Errors inside the app reach the pilot workspace's sign-in address; read them
  with `node tools/errors.mjs` (same page).
