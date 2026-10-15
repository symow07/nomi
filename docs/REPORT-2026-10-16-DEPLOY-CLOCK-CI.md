# The approval lead, the CI bill, #363's clock (2026-10-16)

Written for the owner, answering "PHASE 4 — DECISIONS" (the second one that day). The preview at `127.0.0.1:8787` stayed up throughout.

## Next: yours

1. **Choose how CI spends its minutes (§2):** A, B, or neither. That decides the number you sign up for.
2. **Then flip the repo private and add a payment method.** The outside watcher's token waits on that (`docs/DEPLOY-DRIFT.md`), as you said.
3. **From your list:** the preview, the Mac's disk, the fallback key, the reply check for #3, the Resend setup, the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, and Westlake's Chinese names.

## 1 · The `NEEDS_APPROVAL` lead: dead

These were read-only queries through Railway's own API, for the `nomi` service in production:

| Status | Deployments |
|---|---|
| `NEEDS_APPROVAL` | **none** |
| `WAITING`, `QUEUED`, `FAILED` | none |
| `SKIPPED` | one: #131, on 2026-09-29 |
| everything, newest first | #353 (`SUCCESS`, 2026-10-14 18:11 UTC), then older merges (`REMOVED`) |

- **Railway created no record at all for the 13 merges since #353.** Nothing is waiting for a click.
- **The two services are connected the same way:**
  - `nomi` and `backup` have the same repo (`symow07/nomi`), the same branch (`main`), and check suites off.
  - Neither has staged changes; the staged patch `a850b939` is gone.
- So the settings don't explain why only `backup` heard about the merges. The stop stays **unexplained**.
- **What "turn deploys back on" means, then:** no setting to switch back, and no queue to approve.
  - One "Deploy latest commit" on the `nomi` service deploys main's head, with all 13 merges and migrations 0161–0167 in order.
  - If later merges still leave no record, the outside watcher will say so once it's set up.

## 2 · CI: why the integration suite runs twice, and what each choice costs

**Why twice, in one line:** the workflow says the second pass "proves the suite is repeatable (M22)". The suite changes the database it tests, and only a second pass on the same database catches a test that passes only on a fresh one.

So there is a reason, and I didn't change it. Running it nightly keeps the check, but a test that only passes once would surface the next morning instead of on its PR.

**A second duplicate, larger in run count:** CI also runs on every push to `main`.
- That's 366 of the 806 runs in 30 days.
- Each one re-tests the tree its pull request already tested, unless `main` moved in between.

**The numbers** (30 days at this month's pace, which was a heavy building month: about 27 runs a day):
- Each integration pass takes about 15 minutes, so the integration job is about 31 of each run's roughly 35 minutes.
- GitHub Free includes 2,000 minutes a month; Linux minutes cost $0.006 each after that.

| Choice | Minutes / 30 days | Cost / month on Free | What's given up |
|---|---|---|---|
| Today | about 13,300 | **about $68** | nothing |
| **A.** The second pass runs nightly on `main` | about 7,800 | **about $35** | a test that only passes once is caught the next morning, not on its PR |
| **B.** A, plus no CI on pushes to `main`; a nightly full run on `main` instead | about 5,000 | **about $18** | a fault that shows only once merges combine is caught the next morning |
| Add-on: the outside watcher | +about 1,440 | +about $9 | |

- **My recommendation: B.** It's about $27 a month with the watcher.
  - Merges here go through one at a time, each gated on its own green PR run.
  - The nightly full run on `main` still catches the rare combination.
  - The watcher alone would use 72% of the free 2,000 minutes, so it's the next thing to trim if the bill matters. Every 60 minutes instead of 30 halves it.
- **Doing it is a 20-minute change.** I'll make it on your word.

## 3 · #363's clock: fixed (this PR)

- **The fix:** the inside watcher now measures from the oldest merge production lacks, like the outside one. A merge that hasn't arrived after an hour is the alarm, however many merges follow it.
- **Found while fixing it:** the app asks GitHub without a key, and GitHub allows 60 such requests an hour. Walking back merge by merge, as the outside watcher does, would run out exactly when production is far behind, and the alarm would go quiet. So the app makes **one** call to GitHub's compare endpoint, which returns every merge production lacks, and follows `main`'s own line through them.
- **One alert per merge that didn't arrive.** The wording changed in all five languages: "{main} has been on main for {minutes} minutes ({title}) and never arrived".
- **Proven:**
  - over Postgres, an active day: a merge every 20 minutes with production stuck reads "deploying" up to 60 minutes and "behind" from 70. It alerts once, naming the first merge that didn't arrive.
  - with the old clock, three rule tests and that Postgres case fail.
- **Live, one call to GitHub from production's `2ecdad05`:** 13 merges missing (#354–#367), the oldest 1477 minutes old.
- **Still not live:** it reaches production with the next deploy, like everything since #353.

## Verification

| Step | Result |
|---|---|
| Typecheck and unit tests | passed (8395) |
| Golden scenarios | passed (44) |
| Build | passed |
| Integration (its own Postgres) | 1593 of 1593, none skipped |
| Negative control (the old clock) | 3 parity tests and the Postgres active-day case fail |
| Live | one compare call to GitHub: 13 merges, the oldest 1477 min |

Not on the send path, so no pre-pilot. No prompt or model change, so no live model check.
