# Its own test database, the outside deploy check, the fallback's first call (2026-10-16)

Written for the owner, answering "PHASE 4 — ONE BATCH". The preview at `127.0.0.1:8787` was left running throughout.

## Next: yours

1. **Replace the fallback key: about 10 minutes.** The key in `LLM_FALLBACK_API_KEY` isn't scoped to a workspace, and Anthropic refuses every request made with it that doesn't name one (§3).
   - In the Claude Console → [API keys](https://platform.claude.com/settings/keys) → **Create key**:
     - **Linked account:** a service account. Anthropic's advice for "shared or automated workloads (CI, production services)"; a personal key "breaks when they leave".
     - **Scope it to one workspace.**
   - Paste it into `LLM_FALLBACK_API_KEY`. Leave `LLM_FALLBACK` unset. Tell me, and I make the call again and run the measurements.
2. **The outside deploy check: your call (§2).** Healthchecks watches only the most recent start, not each one. Build it on that basis, or don't build it.
3. **The repo's visibility: your call (§2b).** Nothing automatic makes it private; the evidence points to you, by hand. Decide once: public for good (my recommendation) or private (then CI stops).
4. **From your list:** the preview, the reply check for #3, the Resend setup, the Mac's disk, the WhatsApp round trip, the three cold demos, naming the boss, the spare SIM, and Westlake's Chinese names.
   - **The disk is at 99%** (4.5 GB free on 2026-10-16). One integration run needs a few hundred MB, so the next build could fail on space.

## 1 · Its own test database (this PR)

**What changed:**
- `node tools/run-integration-isolated.mjs` runs the integration suite on a Postgres made for that run.
- It's migrated with the checkout's own migrations and seeded as CI does, then stopped and removed whatever happens.
- It adds 15–20 seconds (the proof: migrated and seeded in 14 s). Two runs in two worktrees never meet.

**Proven on the exact mismatch that hit #364:** code at 0166 (#362's merge), with the shared database at 0167.

| | Result |
|---|---|
| Old runner, shared database | **failed**: 2 of 1590, "expected 167 to be 166", the same two as #364's first run |
| New runner, its own database | **passed**: 1590 of 1590, none skipped; migrated to 166 and seeded in 14 s; nothing left behind |

**CI never had this problem.** Its integration job gets a fresh Postgres service for every job and migrates it with the branch's own code. Only my local runner shared a database. CLAUDE.md §3 and PROGRESS now say so, so nobody "fixes" CI for it.

## 2 · The outside deploy check: stopped, as you said

**What Healthchecks' own docs say** ([Measuring script run time](https://healthchecks.io/docs/measuring_script_run_time/), [HTTP API](https://healthchecks.io/docs/http_api/)):

1. **A start with no success inside the grace time alerts. True.** "If a job sends a 'start' signal but does not send a 'success' signal within its configured grace time … It will mark the job as 'down' and send out alerts."
2. **Each start pairs with its own success. Not true for alerting.**
   - A run ID (`rid`, a UUID) pairs a start with its success only to measure how long it took.
   - For alerting: "Healthchecks.io will not monitor the execution times of all concurrent job runs", and it "will only monitor the execution time of the most recently started run."
   - Their own example: a run went past the grace time and nothing alerted, "because the most recently started run completed within the time limit".

**What that means for the design.** Only the newest merge has a clock, and each new merge restarts it.
- Mostly that's what we want: if the newest merge arrives, everything before it arrived too.
- **The hole:** a merge whose deploy never arrives, followed by another merge less than an hour later, has its clock reset. Merges kept coming under an hour apart would postpone the alarm for as long as they kept coming.
- **Not stated in the docs:** whether a success carrying an older merge's run ID clears the newest start.

**The options, yours to pick:**
- **A.** Build it without run IDs. Every merge sends a plain start, and a booting deploy that runs main's head sends a plain success. The rule becomes "the newest merge must arrive within an hour", and the hole above is written down as a limit. About 1.5 hours.
- **B.** Don't build it, and rely on #363 once deploys are back on.

My recommendation: **A**. The hole needs a stuck deploy *and* steady merges under an hour apart. During a stop like this one, a merge that doesn't arrive would still alarm an hour after the last merge.

**Written down either way:**
- **Nothing watches for a deploy stop today.** The alarm arrives with the next deploy, and that deploy has to be started by hand. This is now in PROGRESS.
- **If A is built, it is FAIL-SILENT.** If GitHub Actions doesn't fire, no start ping is sent, a stuck deploy goes unnoticed, and there is nothing to show for it. A quiet check is not proof of a healthy one. That's why #363 stays: two watchers that fail in different directions.

### 2b · Why the repo flips private

**Nothing automatic flips it.** There's no script, cron job, git hook, workflow, Claude session or GitHub policy behind it. The evidence points to you switching it back by hand, because "public" was agreed as temporary:

- **2026-09-15**, you: "we just need to finish the merge and the pull request then I will turn it back to be in private again".
- **2026-09-15 and 09-16:** Claude told you more than once to switch it back to private ("You can switch the repo back to private now").
- **Until 2026-09-18:** "Repo back to private" stayed on your to-do list in the session notes.
- **The private windows,** from CI's history: 09-18 13:52–14:35, 09-20 09:21–16:43, and 09-24 13:07 to 09-26 17:11. Each ended with your own "it's public now".
- **No command that changes visibility** appears in any session, script or tool.
- **A guess, labelled:** on 09-18 Claude's memory recorded "public for good", but no message I found ever told you so. Public probably still looked temporary to you.
- **Only GitHub can say who clicked:** github.com → Settings → Archives → Security log, filter `action:repo.access`. It has no API for a personal account.

## 3 · The fallback: the call reached Anthropic and was refused

One real call from the app's own client, inside Railway's environment so the key never showed, with the app's request shape:

```
provider: custom · base URL: https://api.anthropic.com · model asked: claude-haiku-4-5-20251001
key: set · LLM_FALLBACK: (unset)
→ 400 invalid_request_error, 1481 ms (a second try: 5513 ms)
  "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header
   with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace."
```

- **The model string it answered as:** none. It didn't answer, so there's no response shape to report beyond the error above.
- **Why**, from Anthropic's [authentication page](https://platform.claude.com/docs/en/manage-claude/authentication): "API keys that are created for a specific workspace only work in that workspace, and API requests using these keys can omit the workspace ID. If your API key isn't scoped to a workspace, you must specify the workspace ID in the `anthropic-workspace-id` header for each request."
- **What it would have done if switched on:** nothing. A 400 is "our request", so it never fails over, and the fallback would have been dead while looking configured.
- **The app would show it:** once #362 is deployed, the five-minute check records a refused check as `not_answering` with the reason `http_400`.
- **The fix is the key, not the code:** one scoped to a workspace. The other way is a new `LLM_FALLBACK_WORKSPACE_ID` variable and code to send the header. That would be a new workstream; I didn't start it.
- **The measurements** (the language sweep, the "wants a person" check, the Arabic run, side by side) wait for a key that answers. Nothing was measured against the fallback.
- **Spend so far:** two calls, both refused before any answer.

## Verification

| Step | Result |
|---|---|
| Typecheck and unit tests | passed (8376) |
| Golden scenarios | passed (44) |
| Build | passed |
| Integration, run through the new runner itself | 1592 of 1592, none skipped (its own Postgres, migrated to 167 and seeded in 10 s, removed after) |
| The proof (§1) | old runner 2 of 1590 failed; new runner 1590 of 1590 |

Not on the send path, so no pre-pilot was run. No prompt or model change, so no live check either.
