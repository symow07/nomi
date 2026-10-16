# The deploy stop's delivery, what B needs from the plan, the merge gate (2026-10-16)

Written for the owner, answering "PHASE 4 — CI, THE DEPLOY STOP, AND THE ORDER". It covers item (a) of the order, plus what (b) needs. Nothing in B is built yet; it waits for your go.

## Next: yours

1. **Railway support, when you choose.** Railway received every push and did nothing for `nomi` (§1). The facts for the ticket are in the session report, not here, because the repo is still public. I haven't opened a ticket.
2. **Choose how B keeps its gap closed (§2).** On a private repo, "Require branches to be up to date" needs GitHub Pro. Option 2 is free and covers every merge I make; option 1 is GitHub Pro.
3. **Then say go on B.** About 30 minutes of work.

## 1 · The webhook check: the pushes reached Railway; Railway did nothing for `nomi`

**There's no webhook to look at.**
- The repo has no webhooks at all: `GET repos/symow07/nomi/hooks` returns `[]`.
- Railway connects through its GitHub App (`railway-app[bot]`).
- An app's delivery log, with each payload and its response code, is visible only to the app's owner, which is Railway.
- So "Settings → Webhooks → Recent Deliveries" doesn't exist for this connection.

**What answers the question instead: the statuses Railway's app writes back on each commit.**

| Merge | What `railway-app[bot]` posted |
|---|---|
| #353 `2ecdad05`, 2026-10-14 18:11 UTC | `nomi - backup`: success "No deployment needed - watched paths not modified" · `nomi - nomi`: pending "Railway is deploying the service", then success "Success - app.nomidoes.com" |
| each of the 14 merges since (#354 … #368) | `nomi - backup`: success "No deployment needed…", within 3 seconds of the push · **nothing for `nomi - nomi`** |

- **Delivery isn't the problem.** GitHub delivered every push, and Railway processed each one, for `backup`, within seconds.
- **What changed is that Railway stopped acting for `nomi`.** It created no deployment, wrote no GitHub deployment record (the last is #353's, 18:11:10 UTC), and posted no status.
- **In Railway's own settings** (read-only, 2026-10-16), the two services are connected identically: same repo, branch `main`, check suites off, nothing staged, and nothing queued or waiting for approval.

That leaves **a question for Railway support**: the app received the push, evaluated `backup`, and silently skipped `nomi`, from 2026-10-14 18:11 UTC onwards.

## 2 · B: what it needs from the plan

**"Require branches to be up to date before merging" exists only on a protected branch.** It's GitHub's strict status check: the branch "must be up to date with the base branch before merging".

| | Public (today) | Private, GitHub Free | Private, GitHub Pro |
|---|---|---|---|
| Protected branches | yes | **no** | yes ("Protected branches" is listed under Pro's "Advanced tools and insights in private repositories") |
| Included Actions minutes | free, no limit | 2,000 / month | 3,000 / month |

- `main` has no protection today, and no rulesets.
- GitHub's pricing page lists Free, Team and Enterprise but not Pro's price, so I'm not quoting one.

**So your plan (private, then B with up-to-date required) needs Pro, or a substitute:**
- **Option 1: GitHub Pro.** Branch protection with "up to date" required, and 3,000 included minutes. At B with an hourly watcher (about 5,700 minutes a month), that's about $16 of minutes plus Pro's price, against about $22 on Free.
- **Option 2: stay on Free, and the merge gate refuses a PR that isn't based on current `main`.** Every merge here goes through that gate, so it gives the same protection at no cost. What it doesn't stop: a merge made by hand in GitHub's web page.

**One correction to "it costs a rebase, nothing else":**
- A rebase re-runs the PR's CI, about 35 minutes.
- That costs nothing when PRs go in one at a time.
- In a batch, each merge sends the PRs behind it round again. At worst that's one extra run per merge, the same as the CI-on-`main` it replaces, so it never costs more.

## 3 · The merge gate's 75 minutes: my diagnosis was wrong

- **CI wasn't queued.** #368's run started at 20:16 UTC, within a second of the push, and finished at 20:44.
- **The gate saw both checks until 20:36.** From 20:37:23 its API calls to GitHub stopped answering, for 55 minutes.
- **The script threw the errors away** (`2>/dev/null`) and read each failure as "0 checks". It used up its polls and gave up with CI already green. Why GitHub didn't answer can't be known now, because the errors are gone.
- **Fixed in the gate:**
  - a failed call prints GitHub's own error, and is never counted as "no checks";
  - failures don't use up the poll budget;
  - it waits through up to 4 hours of failures.

  Both paths were tried: an answer reads `2 2 0`, and a refused call prints its error.
- **For item 5:** this wasn't queueing, so fewer CI runs doesn't make it likelier. If it happens again, the gate now says why.

## Found, not fixed: `main` was red on #353's push

- **What failed:** CI's push run on #353 (`2ecdad05`, 2026-10-14 18:25 UTC). Two `g1-signup` tests ("WITHOUT THE TERMS TICKED, nothing is sent…" and "AGE: under 18 … refused before anything is sent") each found **one** message sent where they expected none.
- **The same tree passed on its PR run,** so it's an intermittent failure, and it needs root-causing.
- **B drops the run that caught it** (CI on pushes to `main`). The nightly run and the PR runs would still see it.
- **It's yours to order.** I haven't started on it.
