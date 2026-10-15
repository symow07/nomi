# The outside deploy watcher

Every 30 minutes a GitHub Action checks whether production has every merge that has been on `main` for more than an hour. If it has, it pings a Healthchecks check. If it hasn't, it pings that check's `/fail`. If anything goes wrong, it pings nothing, and Healthchecks alarms on the silence.

**Files:** `.github/workflows/deploy-drift.yml` and `tools/deploy-drift.mjs`. **Tests:** `tests/parity/deploy-drift-outside.test.ts`.

## Why it exists

- From 2026-10-14 18:11 UTC, Railway deployed nothing for a day and six pushes, and nothing noticed. The cause is still unexplained.
- The inside watcher (#363, `deploy_lag`) can only watch once a deploy carries it in.
- This one runs outside Railway and outside the app.

## The rule

- **The clock starts at the oldest merge production lacks, not at main's newest.**
  - Production lacks no merge, or the oldest merge it lacks is under 60 minutes old (a deploy on its way): **ping**.
  - The oldest merge it lacks is over 60 minutes old: **`/fail`**, with a line naming both commits and how late.
- **"Running" means** the commit of the service's newest `SUCCESS` deployment, read through Railway's API.
- **"Lacks" is found** by walking main's first parents back from the head until production's commit, at most 60 merges.

Measured from the newest merge instead, merges less than an hour apart would postpone the alarm for as long as they kept coming. That's exactly what an active day looks like. The tests pin this property.

## Which way it fails

- **Loud, in every direction this job can fail:**
  - Actions don't run (a private repo with blocked minutes, a disabled schedule, an outage);
  - the Railway token is revoked or expired;
  - Railway or GitHub doesn't answer;
  - a bug in the script.

  In each case there's no ping, so Healthchecks alarms once the period and grace pass.
- **Silent only if Healthchecks itself can't alert you.** A quiet check means Healthchecks has heard a ping in time, and nothing more.
- **The inside watcher (#363) stays.** Two watchers, failing in different directions.

## Setup: the owner's, about 15 minutes, once

1. **Healthchecks.io** → new check, named "nomi deploy drift":
   - Schedule: Simple, **Period 30 minutes**, **Grace 30 minutes**.
   - Copy its ping URL.
2. **Railway** → the project → Settings → Tokens:
   - Create a **project token** for the **production** environment, named "deploy drift (GitHub)".
   - It's scoped to that one environment, but Railway offers no read-only token, so it can do what that environment allows. That is the cost of this watcher.
3. **GitHub** → `symow07/nomi` → Settings → Secrets and variables → Actions → **New repository secret**, twice:
   - `RAILWAY_DEPLOY_WATCH_TOKEN` = the Railway token;
   - `DEPLOY_DRIFT_PING_URL` = the Healthchecks ping URL.
4. **Prove it before trusting it:**
   - Actions → "Deploy drift (outside watcher)" → **Run workflow** (dry run is the default).
   - The log should read `behind: production 2ecdad0 … · 11 merge(s) behind…` while deploys are off. That shows the token reads Railway and the walk finds production's commit.

**Then expect it to alarm while deploys stay off.** That's correct, because production is behind. Pause the check in Healthchecks if you don't want the alerts until deploys are back on.

## Costs

- **On a public repo:** free.
- **On a private repo:** each run bills at least a minute, so about 1,440 Actions minutes a month. That's 72% of GitHub Free's 2,000 included minutes.
- **Railway's API:** 3 requests per run, 6 an hour (Hobby allows 1,000 an hour).
- **GitHub's API:** up to 60 requests per run when production is far behind (the run's own token allows 1,000 an hour).
