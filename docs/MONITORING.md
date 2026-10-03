# Monitoring — how you hear that something is wrong

Audit finding CC-10: *"If the app throws at 3 a.m. nobody learns. No error
reporting, no uptime check, no alerting; `/health` exists but nothing watches
it."* Since CC-10 three things watch the app, and each reaches you without
anyone having to look:

| What | Where it runs | How you hear |
|---|---|---|
| **Errors inside the app** — a page that crashed, a job that failed, the process itself | in the app | an e-mail from Nomi to your sign-in address (and WhatsApp, where a channel is live) |
| **The app is down** — the process, the database or the job queue stopped | **outside Railway**, at Healthchecks.io | an e-mail from Healthchecks.io |
| **A deploy that cannot start** | Railway | the new deploy fails; the running one keeps serving |

The daily backup has its own dead-man's switch (`BACKUP_PING_URL`, see
`docs/BACKUP-RESTORE.md` "Scheduled backups"). This page is the same idea for
the app itself.

---

## 1 · The uptime heartbeat (the dead-man's switch)

Every five minutes the app checks itself from the inside:

1. the database answers (`select 1`), **and**
2. its own web server answers `/health` on loopback
   (`http://127.0.0.1:$PORT/health`, 5 s limit).

Then it pings `HEALTH_PING_URL` — or `HEALTH_PING_URL/fail` when either check
failed (Healthchecks.io's failure signal). The ping has a 10 s limit, never
stops the app, and the address is never written to a log.

**The point is the silence.** If the process dies, the database goes, or the
job queue (pg-boss, which runs the five-minute tick) stops, the pings simply
stop — and Healthchecks.io, which is not on Railway, e-mails you when the
check is late. Nothing that is broken is trusted to report that it is broken.
A `/fail` ping is an alert at once; silence is one once the grace time runs
out (10 minutes past the missed ping, with the settings below).

Unset, nothing is pinged, and every boot logs one line:
`Uptime pings are not configured (HEALTH_PING_URL is unset) …`.

### Your steps (≈5 minutes, once)

1. **Healthchecks.io** → sign in → your project → **Add Check**.
   - Name: `Nomi app`
   - Schedule: **Simple** — Period **5 minutes**, Grace Time **10 minutes**.
   - Save.
2. On the check's page → **Integrations** (or the project's *Integrations*
   tab): make sure **Email** is on for this check, to the address you read.
3. Copy the check's **ping URL** (`https://hc-ping.com/…`). Treat it like a
   password: whoever has it can mark the check up.
4. **Railway** → project → service **nomi** → **Variables** → **New
   Variable**: name `HEALTH_PING_URL`, value the URL you copied → **Add**.
   Railway redeploys the service.
5. **Test it:**
   - **Look for the first ping.** Within ten minutes the check on
     Healthchecks.io turns **green** and its *Events* list shows a ping every
     five minutes. The app's deploy log shows `Uptime pings: every five
     minutes …` once at boot.
   - **Pause the check.** The next ping (within five minutes) takes it off
     pause and turns it green again — proof the app's pings reach it.
   - To see what the alert e-mail looks like without breaking anything:
     *Integrations* → Email → **Test**.

A value that is not an `https://` address with a path makes the boot refuse,
naming the variable — never printing it.

### Deploys: `/health` must answer first

`railway.json` sets `"healthcheckPath": "/health"`. A new deploy only
replaces the running one after its `/health` answers 200 (within Railway's
default window, 300 s; the app answers within seconds of starting). A build
that cannot reach the database answers 503 and never goes live — the running
one keeps serving. The migration (`preDeployCommand`) runs before that, as
before. The instance being replaced stops its heartbeat before it closes its
server, so a deploy is never reported as an outage.

---

## 2 · Errors inside the app

Every failure path writes the error down in `app_errors` (migration 0074):

| Where | What is recorded |
|---|---|
| `web` | a page or webhook that crashed — status 500 or above only (a refusal the code meant, a 4xx, is not an error) |
| `web` · `DoorMailFailed` | a reset link or a "your password was changed" mail that could not leave (PWR2). The door said "on its way" whatever happened — it must, or it would tell a stranger which addresses sign in — so this row is the only sign. The transport's reason is kept, with any address taken out; a daily cap that held the mail is not a failure |
| `worker:<queue>` | a queue job that failed — `message.inbound`, `message.outbound`, `notify.team`, the scheduled jobs — each attempt; a **dead letter** (a job that gave up after its retries) as its own kind; the minute sweep's own caught failures |
| `process` | an unhandled rejection or uncaught exception. The process still ends with code 1 and Railway restarts it, as before — it is only written down first (at most 2 s) |

**One row per kind of error**, not per occurrence: a fingerprint of where it
happened, the error's name and the first line of our own code in its stack
(for an error the database raised, which has no such line: the page or queue
and the shape of the message). A repeat adds to its count.

**What is kept:** the error's name, its message with anything secret-shaped
removed (keys, tokens, passwords, the passwords inside connection addresses,
the query strings of addresses, every secret value the environment holds) and
cut to 500 characters, the line of code, and for a page the route *pattern*
(`GET /app/inbox/:id`) — never the address asked, never a request body, never
a buyer's message beyond what the error's own message holds. The table is
operator data: no page shows it, and inside a workspace it cannot be read at
all. Erasing a workspace (`tools/erase-workspace.mjs`) takes its rows too.

### How the alerts arrive

An error alert is an **operator alert**, like the backup one: an e-mail to
the sign-in address of the pilot workspace (`PILOT_BUSINESS_ID` — whoever runs
this installation), always; and WhatsApp as well where a channel is live. It
never depends on WhatsApp, because WhatsApp can be the thing that broke.

Subject: *Nomi: something went wrong*. The body is one plain sentence, then
what the program said, word for word, then the count and where to look:

```
Something went wrong in Nomi and a piece of work did not finish. …

web · GET /app/inbox/:id
TypeError: Cannot read properties of undefined (reading 'id')
dist/api/web/inbox.js:212 · #7f3a9c2e1b4d

Times so far: 1. First seen: 2026-09-27 03:12 UTC.

The full list, with what each one said: node tools/errors.mjs
```

**It cannot bury you:**

- a kind of error is alerted **when first seen**, and again only if it
  happens **six hours or more after its last alert** — a burst is one e-mail;
- **at most six error alerts an hour** in all. Beyond that they are held, and
  the next alert says *"And N more in the same hour …"*. If the flood stops
  and no next alert comes, the held one is sent within five minutes of the
  hour having room (`ops.errors`, every five minutes).

An alert that fails to deliver is logged, never reported as a new error (that
would loop); a failure to record an error is logged the same way. Recording
is bounded too: at most four at a time per process, each waiting five
seconds at most for a lock, so an error flood cannot take the database
connections the working pages need — during one, the count is a floor.

### Reading them — `tools/errors.mjs`

```bash
# on the laptop, against production (the value never passes through a shell history):
railway run --service Postgres -- sh -c 'MIGRATE_DATABASE_URL="$DATABASE_PUBLIC_URL" node tools/errors.mjs'

node tools/errors.mjs                    # the latest 20 kinds, most recent first
node tools/errors.mjs --since 24h        # seen in the last 24 hours (or 7d)
node tools/errors.mjs --ref 7f3a9c2e1b4d # the one an alert names, in full
node tools/errors.mjs --limit 50
```

Each entry: when last seen, how many times, where (and the route), the error,
the line of code, first seen, whether and when it was alerted (or *held*),
the workspace it happened for, and its reference. The line is in `dist/` —
the built code production runs; `npm run build` locally gives the same file.

Railway's public database proxy sometimes accepts a connection and then says
nothing; the tool gives up after 15 s (connect) or 30 s (reply) and says so.
Run it again.

---

## 3 · What is NOT covered

- **Railway itself going down** takes the app *and* its pings down together.
  That is still caught: Healthchecks.io is outside Railway, so the missing
  pings are an alert. What you will not get is Nomi's own error e-mail — the
  thing that would send it is down too.
- **The mail sender failing.** Error alerts leave through the installation's
  own sender (A3: the connected mailbox, then SMTP). If that is broken, the
  alert is logged as not delivered and — with no live WhatsApp — goes
  nowhere. The heartbeat does not depend on it.
- **Deployment mode** (no channel configured at all): errors are recorded,
  but nothing consumes the alert queue, so none is e-mailed; `tools/errors.mjs`
  still lists them. A queued alert expires after a day.
- **A slow app that still answers.** The heartbeat asks "does `/health`
  answer within five seconds", not "is every page fast". Response times are
  on Railway's metrics.
- **Errors the code catches and handles on purpose** — a refused send, a
  provider saying no — are outcomes, not errors, and are shown where they
  belong (the conversation, the channels page), not here.
- **The buyer's side of Meta.** A webhook Meta never delivers is not an error
  in this app; `channels.last_webhook_at` on the channels page is where that
  shows.
