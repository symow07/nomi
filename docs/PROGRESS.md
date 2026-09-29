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
| 2026-09-29 | #126 | **The design foundation, part two — the shell**: the rail in groups (Customers heading Conversations and Calendar; Setup and Log out at its foot) with its one number read fresh per page; a conversation between its list (from 1100 px) and the customer panel (from 1440 px: asked about, prices worked out, samples, orders, the calendar's own dates, who acted ✦ ● ○); the tab "page · business"; the page's other cards drawn as states. Deployed about 09:50 UTC, `/health` ok, schema 81 (no migration) | 81 |
| 2026-09-29 | #125 | **The design foundation, part one**: buttons and doors (23 link-buttons made doors; the rule's test on every owner page); the palette (graphite, magenta for the assistant's hand only; jade, highlight, warm papers, dark mode retired; the mark graphite); Noto served by the product, one font order per language; **the approval card** (the reply once, one Send, "How … read this" with each figure's source; "No reply needed" decided below). Deployed about 09:24 UTC, `/health` ok, fonts served, schema 81 (no migration) | 81 |
| 2026-09-29 | #124 | **Spanish and French**: the disclosure (awaiting a native reader, gate shut) and every safety check — identity, wants-a-person and openers, deletion, injection, the forbidden-word floor, claims, numeral words. **T2**: "AI" as the word only; Arabic-Indic and Chinese numerals; a small number beside any currency; accented Spanish promises. Deployed about 08:30 UTC, `/health` ok, schema 81 (no migration) | 81 |
| 2026-09-29 | #123 | **A product may have no minimum** (0081): `products.moq` nullable, "no minimum" in every reply, page and export, in every language; the numeral guard refuses an invented minimum. **T4** parser honesty. **PRODUCT.md** description rewritten to the positioning. CLAUDE.md rule 24 | 81 |
| 2026-09-29 | #122 | **T6/T6b — an order waits for the owner's tap** (0080). Deployed 07:03 UTC, `/health` ok, schema 80. A customer's "yes" writes `order_proposals`; nothing is confirmed or sent; the owner confirms (order made, then the customer told) or steps in (set aside). Pending question set only when its message leaves (`asks` on drafts and outbound rows). E-mail alert always; browser notification where the owner turned it on; the order leads Buyers and Today. CLAUDE.md rule 23 | 80 |

**Next:** #127 — the calendar week and the owner's own dates (0082), open
with CI running; backup before it `~/nomi-backups/nomi-backup-20260929T095733Z`
(schema 81, drill 4/4). Then the promised follow-up read from the replies
(the analysis' words → a dated entry; the live model check before and
after), then the day a price ends and an agreed delivery date.

**Consequence the owner should know (since #124):** the disclosure gate is
installation-wide by design (CLAUDE.md rule 1), and es/fr now wait for a
native reader, so **nothing sends alone anywhere — Westlake's auto included —
until the two sentences are read and the flags flipped.** Replies wait as
drafts; the owner's page says why (`autonomy.notReleased`). Flipping them is
the one step I may not take.

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

## Waiting on the owner (the plan's open decisions)

These items cannot be built without a decision the plan left open and the
instruction did not answer. Collected here; asked once, at the end.

| Items | Decision (plan numbering) |
|---|---|
| HF (the hold-path defect: Stop pressed while a batch waits) | 25 |
| T9 (languages beyond the five get what?) | 20 |
| P1–P6, Q1W (per-workspace Practice) | 4, 5 |
| TZ (business time zone) | 22 |
| CUR (one currency per workspace) | 19 |
| K1–K8 (learning the business from imports) | 10, 27, 28, 29, 30, 41 |
| RT, HS, CK (retail-first, "how you sell", claims packs) | 18, 29, 41, 42 |
| G1–G10, KS5, KS6 (self-serve sign-up and its protections) | 7, 8, 14, 15, 33, 34, 35, 36, 37, 38 |
| R1–R3 (earning auto) | 9, 12, 23 |
| LG (the per-language gate) | 16 |
| VAR (variants) | 31 |
| MAIL, BOT, BILL, SITE, UI-es, EXT, EU1 | 13, 15, 30, 32, 36, 39 (and accounts only the owner can create) |
| T8 (price-list measurement) | needs the owner's 25–35 real catalogues |
| RET (erase workspaces that never connected, after 90 days) | not a plan decision, but an automatic erasure: confirm before building |

## Found on the way

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
  (schema 79, drill 4/4 after the fix). **Check the next scheduled run
  (2026-09-30 03:00 UTC) wrote a `backup_runs` row**; the backup service
  rebuilds on changes to `tools/verify-restore.sh` (its watch path).

- **A unit test flaked once** (2026-09-29, before #124):
  `tests/parity/backup-retention.test.ts` › "manual pairs at the root older
  than 180 days go WHOLE" failed in one full run and passed in the next eight
  and alone; no message was captured. Not root-caused yet — if it recurs,
  capture the output (`vitest run --reporter=dot > log`) before rerunning.
- **The claims guard's words were English-only** for zh and ar too (only the
  acronyms — CE, FDA, FOB… — work in any language). #124 added es/fr as
  instructed; zh/ar words (保证, 退款, ضمان, استرداد…) are not added: a
  broader guard makes more replies wait, which is the owner's call.

## Deferred, and why

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
- **Practice keeps the old card** (`sandbox.ts`, `/app/sandbox/act`): the
  practice sandbox is P1–P6's to rebuild (decisions 4 and 5), and a second
  copy of the new card there would have to be rebuilt again.
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
- **The rail's number is read fresh on every page** (#126): one count query
  per page view, on purpose — a number that lags a minute behind is a number
  that lies.

## Tool output that asked for something (ignored, as instructed)

- `npm ci` printed `npm install-scripts approve …` for `fsevents` (an optional
  macOS file watcher). Not approved; nothing needs it.
- `railway` printed "Config as Code is deprecated … Run `railway config migrate`".
  Not run.
- A session-start hook said to add a `GROQ_API_KEY` / `OPENAI_API_KEY` to
  `~/.config/watch/.env` "to unlock Whisper fallback". Not done: no key is
  typed by me, and nothing here needs it.
- Earlier in the session the Impeccable skill offered `npx impeccable update`,
  and MCP servers (Amplitude, Atlassian, BigQuery, Hex) asked for sign-in; the
  Definite server failed to connect. None is part of this work.

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
