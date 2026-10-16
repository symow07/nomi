# g1-signup's "one letter", the Railway ticket, B (2026-10-16)

Written for the owner, answering "PHASE 4 — STOP ON ONE THING, THEN PROCEED".

## Next: yours

1. **Post the Railway ticket: 5 minutes.** I can't sign in to Railway's Station for you, so the text is ready to paste (§2). It's kept out of the repo.
2. **Flip the repo private and add the payment method** (step d). B is in, so it's about $22 a month at this pace.
3. **Then the Railway token and the watcher's setup** (step e, `docs/DEPLOY-DRIFT.md`, now hourly: Healthchecks period 1 hour, grace 30 minutes). Deploys last.

## 1 · The g1-signup failure: test-only, and why

**First, a correction.**
- The failure was root-caused and fixed on 2026-10-14, in #354 (`b12faa9f`).
- That was the first merge Railway never deployed, which is why main's history still showed the red run as if open.
- I reported it yesterday as "found, not fixed" without checking that history. That was wrong.
- #354's explanation had been proven by injecting a letter, not by capturing the real one, so I did the capture now.

**What was "sent", and to whom.**
- This test watches the installation's system mail: sign-up codes, and notices to owners and the operator. No buyer is ever on it; buyer messages go through the channels, which this test doesn't watch.
- Before #354, its mailbox counted every letter the installation sent while the file ran.
- **Since #354, the test names each letter that isn't its own on CI's log. Three of the 28 CI runs since then caught one:**

| CI run | The letter (for another workspace's owner) |
|---|---|
| 2026-10-15 17:22 UTC (PR) | "Your morning summary" |
| 2026-10-15 18:31 UTC (PR) | "This month's customers on your plan are used" |
| 2026-10-16 01:16 UTC (push to main) | "This month's customers on your plan are used" |

- **These are ordinary owner notifications.** Other test files create workspaces with owners. The installation's workers, running while g1 runs, send those owners their scheduled mail: the morning summary, and the plan-usage notice.
- **Before #354, any one of them made "nothing is sent" fail.** That matches CI on 2026-10-14 exactly: "one letter at the first test, before any sign-up", and a 3-in-28 rate looks intermittent.

**Why it can't be the refused sign-up itself:**
- A sign-up without the terms ticked returns `400` at the validation step.
- An under-18 sign-up returns at the age refusal.
- Both return before `sendCode`, the only place a sign-up code is sent (`src/api/web/app.ts`).

**Reproduced locally, with every letter recorded:**
- **The setup:** the #353-era assertions (no letter at all), plus a recorder of each letter's recipient, subject and the test that was running.
- **50 runs:** all 50 passed. 202 letters, every one expected: 100 codes and 50 "new workspace" notices during the proper sign-up, 50 daily digests, and 2 error alerts at boot.
  - **None arrived during the terms or under-18 tests.**
  - One letter went to a previous run's operator: a job an earlier run left queued, mailed by this run's worker. That's the same mechanism, seen live.
- **One whole integration suite on its own Postgres, the probe included:** 1599 of 1599 passed, no stray letter. Locally the timing didn't line up.

**Could it happen in production?**
- Not as a message without the owner. The letters are notifications to owners, sent to each owner's own sign-in address on their own schedule.
- In production there is one installation, and that is its job.
- The test's fix (count only its own mail, and name anything else) stands. **No test was loosened.** Each of its assertions still demands zero letters to its own person.

## 2 · The Railway ticket: drafted, not posted

- **Why I couldn't post it:** Railway takes support requests only through its Station (`station.railway.com`), signed in. I can't sign in as you.
- **Where the text is:** in this session's scratchpad and in the session report, not the repo, because it names production IDs.
- **What it contains:** project, environment and both service IDs; the 15 commits not deployed with their UTC times; what GitHub shows (`backup` answered within 3 seconds on every push, `nomi` nothing); what's been ruled out; and a note that nothing was redeployed by hand, so Railway sees the state as it is.
- **The IDs aren't credentials,** but Station posts can be public. If you'd rather not show them there, I'll cut the text down to the commit list.

## 3 · B: built

- **CI** runs on pull requests, nightly on `main` at 04:41 UTC (after the 03:00 backup), and by hand. It no longer runs on every push to `main`.
- **The repeatability pass (M22)** runs only nightly and by hand.
- **The outside watcher** runs hourly, at 7 minutes past.
- **On a private repo, GitHub Free has no branch protection,** so `tools/gated-merge.sh` is the requirement:
  - It refuses, **with exit 3 and the reason**, a PR not based on `main`'s current head. It asks before the checks and again right before merging.
  - Tried live: a commit 20 behind `main` got "REFUSED — #999 is NOT based on main's current head. Nothing was merged", with the commands to rebase.
- **The script now lives in the repo.** It used to sit in my scratch folder, which a restart clears.
- **CLAUDE.md §3:** "Never merge on github.com; always through `tools/gated-merge.sh`."
- **The estimate:** about $22 a month once private on Free, at this month's pace (about 5,700 minutes against 2,000 included).

## Verification

VERIFY_BLOCK
