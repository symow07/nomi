# The outside deploy watcher, what private would cost, two documents out (2026-10-16)

Written for the owner, answering "PHASE 4 — DECISIONS". The preview at `127.0.0.1:8787` stayed up throughout.

## Next: yours

1. **Set up the outside watcher: about 15 minutes.** The steps are in `docs/DEPLOY-DRIFT.md`:
   - a Healthchecks check (period 30 min, grace 30 min);
   - a Railway project token for production;
   - two GitHub Actions secrets;
   - one dry run to prove it.

   It will alarm at once while deploys are off, which is correct. Pause the check until deploys are back on if you don't want the alerts.
2. **Private: the real cause, and the price (§2).** Private means about **$68 a month** at this pace, or fewer CI minutes. Without a payment method on the account, CI stops. Your call, when you flip it.
3. **The fallback key:** yours, in progress. Tell me when it's pasted.
4. **From your list:** the preview, the Mac's disk, the reply check for #3, the Resend setup, the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, and Westlake's Chinese names.

## 1 · The outside deploy watcher: feasible, built (this PR)

Your design works, with three changes. Each one is pinned by a test.

**Change 1: the clock starts at the oldest merge production lacks, not at "matches main's head".**
- With an exact match, an active day can false-alarm: when merges land every 20–30 minutes, production is almost always one merge behind while that merge deploys.
- So it pings when production lacks no merge older than 60 minutes. A merge that hasn't arrived after an hour keeps the check from pinging, however many merges follow it.
- **That closes A's hole.** Measured from the newest merge instead, the hole test and "the day it was built for" both fail (2 of 12).

**Change 2: "behind" pings `/fail` with what it saw.** For example: `production 2ecdad0 · main 450725a · 11 merge(s) behind, the oldest 1380 min old`. The alert names the commits instead of waiting out the grace.

**Change 3: the run stays green when production is behind.** GitHub e-mails you about every failed scheduled run, so during a stop like the 14th's you'd get one every 30 minutes. A red run now means only that the watcher itself broke. Before the secrets exist, every run succeeds and says "Not set up".

**Which way it fails: loud, not silent. That corrects my last report.**
- Every failure of this job means no ping, and Healthchecks alarms:
  - Actions not running (a private repo with blocked minutes, a disabled schedule);
  - a revoked token;
  - Railway or GitHub not answering;
  - a bug in the script.
- It is silent only if Healthchecks itself can't alert you.
- #363 stays as the inside watcher.

**Checked against the live services, not memory:**
- **Railway's live schema has no `successfulOnly` filter,** though its deployments guide shows one. The status filter is `in` / `notIn`, so the query uses `status: { in: [SUCCESS] }`. Every query field was checked by asking the API itself.
- **A fake token reached the real Railway API.** The answer was "Project Token not found": the run failed and pinged nothing, as designed.
- **The walk from main back to production's commit (`2ecdad05`) ran against GitHub's real API.** It found 11 merges missing, the oldest (`fea2c56`, 2026-10-14 19:17 UTC) 1380 minutes old.
- **Not proven yet:** that a real project token can list deployments. The dry run in step 1 proves it.

**The cost you named:** a Railway project token in GitHub's secrets.
- It's scoped to the production environment.
- It's not read-only: Railway offers no read-only token, so it can do what that environment allows.
- The workflow never runs on a pull request, so a branch's code never sees it.

**Found while building, not fixed: #363 has the same hole.** Its clock is main's newest commit, so merges under an hour apart postpone it too. The fix is the same rule as here: measure from the oldest merge production lacks. About an hour, and it isn't live until deploys resume. Yours to order.

**A lead on the deploy stop, not chased** (you said leave it). Railway's live schema has a deployment status `NEEDS_APPROVAL`. If the merges since the 14th are waiting for an approval, that's the stop. One read-only query would answer it.

## 2 · The repo

**Why private stops CI, measured:**
- **Usage:** CI used about **13,300 Linux minutes in the last 30 days**. That's 802 runs; a 101-run sample shows the unit job at about 2 minutes and the integration job at about 15.
- **What GitHub's own docs say:**
  - public repositories are free;
  - private repositories get 2,000 minutes a month on Free (3,000 on Pro);
  - "If your account does not have a valid payment method on file, usage is blocked once you use up your quota";
  - Linux 2-core costs $0.006 a minute.
- **So the 3-second failures were the minutes running out with no payment method.** The message said "recent account payments have failed or your spending limit needs to be increased". Nothing needs public; it's money.
- **The price:**
  - about **$68 a month** on Free at this pace;
  - about $62 on Pro, plus the Pro plan's own price;
  - plus about 1,440 minutes a month for the outside watcher.
- **The lever:** CI runs the integration suite twice per job ("Integration suite, again", the repeatability check). Moving the second pass to a nightly run would roughly halve the integration minutes.
- **I couldn't read your billing page.** The API needs a permission on your login (`user` scope) that I didn't grant myself.

**The two documents are out of the repo (#366):**
- **Moved:** `PRE-LAUNCH.md` and the isolation sweep report.
- **Kept in `~/nomi-private/`** on this Mac, outside iCloud, readable only by you.
- **Repointed:** every doc that referred to them now says they're kept outside.
- **Not edited:** the applied migrations 0131–0134 name PRE-LAUNCH in their headers. They're never edited.
- **The data-protection audit was never a repo file.** Its D1–D20 list reached you in the session, and the repo holds only PROGRESS's record of the 20 fixes, all shipped.
- **Both files are still in the public git history.** Removing them from `main` doesn't remove them from earlier commits. Making the repo private hides that history; rewriting it is the other way, and both are your call.

**The memory note is corrected.** It now says what the record shows:
- the repo was created private;
- public was agreed as temporary on 2026-09-15 ("then I will turn it back to be in private again");
- earlier versions of the note wrongly called public the resolution;
- your decision on 2026-10-16 is PRIVATE.

## Verification

| | #366 (the documents) | This PR (the watcher) |
|---|---|---|
| Typecheck and unit tests | passed (8376) | passed (8391) |
| Golden scenarios | passed (44) | passed (44) |
| Build | passed | passed |
| Integration (its own Postgres) | 1592 of 1592, none skipped | 1592 of 1592, none skipped |
| CI | 2 of 2 passed, merged `af967ef6` | (below) |
| Negative control | n/a | measured from the newest merge, 2 of 12 tests fail |
| Live | n/a | GitHub walk: 11 merges, 1380 min; fake token refused by Railway, nothing pinged |
