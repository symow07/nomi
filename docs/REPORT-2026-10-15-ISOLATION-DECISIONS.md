# The isolation sweep: your decisions, carried out (2026-10-15)

Written for the owner, answering "ISOLATION SWEEP — DECISIONS". The same split as before: what I checked, what I fixed, and where I was guessing.

## Next: yours

1. **Railway stopped deploying the app, 2 minutes.** Nothing merged since #353 (yesterday 18:11 UTC) has gone live: not #356's e-mail fix, and not this round. Production is healthy, on #353's code at schema 160. GitHub still reaches Railway: the `backup` service logs every push. Only the `nomi` service's trigger is off. I didn't change it, and I didn't deploy by hand in case you switched it off on purpose. To turn it back on: Railway → `nomi` → Settings → Source → branch `main` (or "Deploy latest commit"). One deploy then applies 0161–0164 in order. Today's 03:00 backup exists. Tell me and I'll confirm `/health` and schema 164.
2. **The reply check (#3), 2 minutes.** Reply "test" to any e-mail Nomi sent you (a sign-in code or an alert). Wait two minutes, then open Westlake → Buyers. If your reply is there, tell me: it gets fixed before the pilot. If it isn't, it comes off the list.
3. **The dedicated sender (#2), about 20 minutes plus the DNS wait.** Steps are under #2 below. Until it's set, the boss's codes still ride Westlake's Gmail.
4. **The Mac's disk is nearly full: under 1 GB free.** Every check needs room. Please free a few GB; I can't delete your files.
5. **The model provider isn't answering.** Every call I made today failed. Early on it was DeepSeek's "503 Service is too busy"; now each one times out after 30 s. The host resolves to a real AWS address, so it isn't a proxy on this Mac. Production hasn't had a turn since 2026-09-20, so it hasn't hit this yet. `/health` says `"model":"answering"`, but that field only tracks billing refusals. Your call: wait, or switch providers. Until it answers, every analysed turn fails and goes to a person (rule 19).

**Unchanged:** the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, Westlake's Chinese names.

## Done, in your order

### E-mail on orders, first (#356, migration 0161) — done (the analysis prompt closed it later on 2026-10-15)

*(Closed 2026-10-15, evening: the analysis prompt's three e-mail lines are gone. Live, deepseek-flash, the same seven conversations three times each: 18 of 21 answers asked for an e-mail before the change, 0 of 21 after. `docs/REPORT-2026-10-15-PREVIEW-AND-ALARM.md` §3.)*

*(Corrected 2026-10-15, on the owner's word: not done. Until the analysis prompt changes, a WhatsApp buyer can still be asked for an address. That change waits for the model to answer, so it can be checked live before and after.)*

- **The gate:** a missing e-mail blocks nothing. An address typed on your "Prepare the order" form that isn't an address still blocks it, as `email_invalid`.
- **The turn:** it no longer asks the buyer for an e-mail. The "missing e-mail" sentence is gone in every language, and the reply prompt now says "Never ask for an email address: an order does not need one."
- **The proposal** (0161) may have no address. **The order card** shows the e-mail row only when there is one.
- **The proforma:** unchanged. **A correction to my last report:** I said the address was "printed on the proforma". It never was. The proforma leaves it out (`src/api/web/proforma.ts:31`); it appears only on your order card and in a buyer's copy of their data.
- **Nothing downstream broke without an address.** Nothing sends to it.
- **Test:** a WhatsApp order with no e-mail, from hello to a confirmed proforma. Nobody asks for an address, nothing prints one, and `/pi/<token>` opens with the product and FOB and nothing address-shaped.
- **Not yet changed at the time, and it mattered (closed since, above):** three lines in the *analysis* prompt still list e-mail as part of confirming an order. The analysis suggests the next question to ask, and that suggestion reaches the writer and the guard's stand-in reply. So an e-mail question is still possible that way until it changes. Changing that prompt needs the live model check before and after, and the model isn't answering (Next 5). It's the first thing I'll do once the model answers.

### 4 · Order numbers (#357, migration 0162)

- Each workspace counts its own orders, per year in its own time zone: **2026-0001, 2026-0002 … 2027-0001**. There is no shared counter and no "YW".
- The count rises inside the order's own transaction, so an order that fails takes its number with it: no gaps. Two orders at the same moment get the next two numbers.
- Two workspaces may each have a 2026-0001. A reference is unique within its workspace.
- The old counter is still in the database but closed to the app.
- Production had no orders, so nothing was renumbered. An issued number is never rewritten.

### 2 · The shared mailer: the fix is built, it needs three settings

- **Already in the code** (decision 36): a dedicated sender over HTTPS, Resend or Postmark. Once it's set, **sign-in codes, reset links and owner alerts** leave through it. Westlake's Gmail then carries only mail *to the operator* (sign-up notices, the legal-contact notices). So your account activity can no longer break the boss's login.
- **Not set in production** (checked by variable name only): `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM`.
- **Can it be done this week? Yes, if you do these steps.** I can't create accounts.
  1. Create a Resend account (resend.com).
  2. Add the domain `nomidoes.com`. Resend shows three DNS records: a DKIM TXT at `resend._domainkey`, and an MX and an SPF TXT on the `send` subdomain. Add them at GoDaddy. They don't touch your root MX, your root SPF, or `app` (docs/SITE-DNS.md's rule).
  3. Wait for Resend to say "Verified" (minutes to a few hours).
  4. Create an API key with sending access only.
  5. In Railway → `nomi` → Variables, paste `MAIL_PROVIDER` = `resend`, `MAIL_API_KEY` = the key, `MAIL_FROM` = `Nomi <no-reply@nomidoes.com>`. Railway redeploys. Tell me, and I'll confirm the boot names the dedicated sender.
- **Choose a From that doesn't deliver into Westlake's Gmail.** That's #3's question again: a reply to `no-reply@` should go nowhere, not into a workspace's inbox.

### 3 · Replies landing in your inbox: the check is half done

- **What I could check, read-only:**
  - The system From address isn't Westlake's mailbox, but it's on the same domain.
  - Westlake's mailbox reads its inbox.
  - Production holds **no** reply to a Nomi e-mail in Westlake. The one buyer who matches a sign-in address is Westlake's own.
- **What I can't do:** the real test needs a person to reply (Next 2). **No fix was built.**

### 9 · Withdrawal narrowed to the language (#359, migration 0163)

- A reply that failed its checks (a forbidden word twice, or Arabic that couldn't be written without a gender) now withdraws its capability **in that language only**.
  - English buyers are answered alone as before.
  - The next Arabic buyer waits for you, and the draft says why.
- Your setting is untouched. Choosing the level again on the assistant's page (even the same level) lifts it, and so does granting that capability.
- Today, the alert and the assistant's page name the language: "Qualifying, in Arabic".
- **Left alone, as you said:** the earned rung is still cleared. **Also left as it was:** a spot check's withdrawal (your verdict on work sent alone) still spans every language; it's about the work, not the language.
- **One case still withdraws everywhere:** a reply whose language nobody could tell. Such a reply never goes alone anyway.

### 11 · The spare SIM: you would have been locked out. A release is built (#360)

- **Yes, locked out.** Disconnecting only switches the number's row off, and that row keeps the number for good. The attach tool refused the number for any other workspace ("belongs to another workspace, switched off there"), and a self-serve connect got "number taken". No operator path existed.
- **Built: `tools/release-number.mjs <business-id> <phone-number-id> [--yes]`.**
  - It frees a number only when it's switched off and has no live account in that workspace.
  - The row stays as the record, but gives up the number. The audit trail says who and when.
  - It refuses while the number is switched on and says how to switch it off.
  - Without `--yes` it shows and changes nothing.
- **Then:** attach it where it belongs. The workspace it left can still connect another number.
- **Tested:** wrong workspace → disconnect → refused → release → attached to the right one, routing there only.

### 12 · Cheap, so taken (#360, migration 0164)

A mailbox can be connected to one workspace at a time. The second connect is refused with its own notice ("That mailbox is already connected to another workspace, so it was not connected here."), and nothing changes on either side. Production had one live mailbox, so nothing collided.

### The comments

The ones that claimed a job key prevents duplicates now say what does:
- **the database claims:** a message's fragments are marked as answered by the turn that answered them; one webhook event is one row; an identical employee reply within ten minutes isn't queued again; one open order per conversation;
- **the per-conversation lock.**

Every queue here is pg-boss 12's `standard` policy. On it, a key is enforced only with a time window, which these keys don't set. Checked in pg-boss's own source (12.26.0). Changed: `src/queue/boss.ts` (twice), `src/db/fragments.ts`, `src/worker/main.ts` (three places).

## Waiting, and what makes each urgent

The table is in the sweep report (kept outside the repo since 2026-10-16) ("Waiting — and what makes each urgent"), for 1, 5, 6, 7, 8, 10 and 12. **10 has its hard marker:** "metered before the third paying workspace". It is a blocking line in `docs/LAUNCH-CHECKLIST.md` and a marker at `answerFollowUp` in the code.

## Found, not fixed

- **`/health` can't see a provider that times out.** Its `model` field turns `refusing` only on billing refusals (0128). A provider that's down reads as `answering`, and the heartbeat pings green. Today it said `answering` while every call failed.
- **#358 was closed by GitHub, not merged.** I'd opened it stacked on #357's branch; deleting that branch on merge closed it. #359 replaces it, with the same commits and the same verified tree. Noted, so it doesn't happen again.
- **A second confirmation of the same conversation can't take its "same order" path.** `orders.create` catches the open-order unique violation and then reads the existing order. But in Postgres a failed statement aborts the whole transaction, so that read fails too. Today the proposal's lock and state check stop a second confirm before it gets there, so I haven't seen it happen. It predates this work.

## Where I was guessing

- **The comment on retried alerts.** I couldn't prove a retried job never sends a second hand-off alert. The comment now says a second one is possible and tolerated, rather than that it can't happen.
- **"The doc".** I took it to mean the sweep report, so the waiting table is there. PROGRESS points to it.

## Verification

Every PR passed the four checks on Node 24 before it was opened. The integration suites were run on this Mac's Postgres; the PRs' CI ran them again.

| PR | check (unit) | trust | build | integration | pre-pilot (scripted) |
|---|---|---|---|---|---|
| #356 e-mail | 8297 | 44 | ok | 1570 / 1570 | 12/12 before · 12/12 after |
| #357 order numbers | 8301 | 44 | ok | 1575 / 1575 (the second run; the first found Practice's copy list to fill) | 12/12 · 12/12 ("2026-0001 · being prepared") |
| #359 language | 8333 | 44 | ok | 1578 / 1578 | 12/12 · 12/12 |
| #360 the rest | 8335 | 44 | ok | 1582 / 1582 | not run: nothing on the send path |

Negative controls (the fix switched off, its own tests fail):
- the old shared counter: 6 of the 9 new tests;
- the per-language check at the send decision, and separately the language handed to the writer;
- the mailbox catch;
- the attach tool's released-row exclusion.

The live model check (`tools/check-person-model.mjs`) wasn't run: the provider isn't answering (Next 5). That's why the analysis prompt is unchanged.
