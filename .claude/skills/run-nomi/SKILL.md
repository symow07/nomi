---
name: run-nomi
description: Build, run, start, launch, and drive Nomi locally — the Fastify server that serves the owner Command Center (server-rendered pages) plus /health, backed by Postgres. Use when asked to run/start/launch Nomi, boot the server, log in to the Command Center, inspect or screenshot a page, or smoke-test it end-to-end. Runs in `disabled` mode with no Meta/WhatsApp credentials.
---

Nomi is a single Node/TypeScript monolith: one Fastify process that serves a
public `/health` probe and the owner **Command Center** (server-rendered HTML at
`/app/*`, behind a login). It needs Postgres and — in `disabled` mode — **no Meta
credentials**. It is headless (no browser UI); you drive it with `curl`.

**Drive it with the smoke script** — one command brings up an ephemeral Postgres,
migrates + seeds the demo **and sandbox** tenants, builds, launches the server,
and drives the whole owner walkthrough (auth gate → login → Today →
Pilot runbook → Sandbox → buyer turn → take over → owner reply → hand back),
leaving the server running:

```bash
bash .claude/skills/run-nomi/smoke.sh
```

**To verify a DEPLOYED instance instead** (read-only — GETs plus one login POST;
never posts an owner action, never sends a message, safe against production):

```bash
bash .claude/skills/run-nomi/verify-remote.sh https://<host> "$OWNER_ACCESS_CODE"
```

It checks `/health` (including that it leaks no build info), the auth gate on
every owner surface, the `Secure`/`HttpOnly`/`SameSite` cookie flags over https,
that no webhook is mounted while messaging is disabled, that the owner pages
render, and reports the running version. Exit 0 = all passed. Without an access
code it runs the public checks only. See `docs/DEPLOYMENT.md`.

All paths below are relative to the repo root.

## Prerequisites

Postgres 16, Node 20+, and `curl`. Verified on macOS with these already installed
via Homebrew:

```bash
brew install postgresql@16 node    # provides initdb / pg_ctl / psql / createdb, node, npm
```

On Debian/Ubuntu the equivalent is `apt-get install -y postgresql nodejs npm curl`
(not run here — this session was macOS/darwin).

## Setup

Install dependencies:

```bash
npm install
```

No `.env` is needed for the smoke path — the script exports a safe local
environment and overrides `DATABASE_URL`, so any prod values in a checked-in
`.env` are ignored.

## Build

`start` runs the compiled `dist/`, so build first (fast — plain `tsc`):

```bash
npm run build        # tsc -p tsconfig.build.json → dist/main.js
```

## Run (agent path)

The smoke script is the driver. It is idempotent (wipes and recreates its scratch
dir each run) and self-contained:

```bash
bash .claude/skills/run-nomi/smoke.sh
```

On success it prints `PASS` and leaves the server running, e.g.:

```
PASS — Nomi is running and the owner walkthrough was driven end-to-end.
  walkthrough:  auth gate → login → Today → Pilot runbook → Sandbox
                → buyer turn → take over → owner reply → hand back
                rehearsal observed by the runbook: Practice before launch · 3/5
                sandbox channel credentials: 0 (must be 0 — nothing delivered)
  health:       {"ok":true,"db":true,"worker":true,"provider":"disabled"}
  URL:          http://127.0.0.1:8787
  login code:   smoke-code
  server PID:   <pid>   (LEFT RUNNING)
```

Artifacts land in `/tmp/yf-run/`: `app.log` (server log), `app-home.html`,
`app-onboard.html`, `app-sandbox.html` (the rendered pages), `cookies.txt` (an
authenticated session).

The walkthrough is the regression net for the owner path: it asserts each
surface renders, that every owner action is a 302 (Post/Redirect/Get), that the
runbook **observes** the rehearsal it just practised (`3/5` or better), and that
the sandbox tenant still has **zero** channel credentials — i.e. nothing was
really delivered. Any missing marker or wrong status code aborts with `FAIL`.

Override the ports or login code via env: `PGPORT=... PORT=... OWNER_ACCESS_CODE=... bash .claude/skills/run-nomi/smoke.sh`.

### Drive more (authenticated)

The script leaves a logged-in cookie jar. These return the expected marker text:

```bash
curl -sb /tmp/yf-run/cookies.txt http://127.0.0.1:8787/app/knowledge  | grep -o 'What she knows'
curl -sb /tmp/yf-run/cookies.txt http://127.0.0.1:8787/app/onboarding | grep -o 'Getting ready'
curl -sb /tmp/yf-run/cookies.txt http://127.0.0.1:8787/app/sandbox    | grep -o 'This is practice only'
```

Log in from scratch (the flow the script automates):

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/app                  # 302 (unauth → /login)
curl -s -c /tmp/jar -X POST http://127.0.0.1:8787/login \
  -H 'content-type: application/x-www-form-urlencoded' -d 'code=smoke-code'          # 302 → /app + Set-Cookie
curl -s -b /tmp/jar http://127.0.0.1:8787/app | grep -o '<h1 class="page">Today'   # Today renders
```

### Stop

```bash
kill <server-pid>; pg_ctl -D /tmp/yf-run/pg stop      # the exact command is printed by the script
```

If the PID is lost, free the port: `lsof -ti:8787 -sTCP:LISTEN | xargs -r kill`.

## Run (human path)

`npm start` runs `node dist/main.js` in the foreground. It still needs a migrated
Postgres and the same env vars (below); on first run it generates its own secrets
into `.env`. Useless purely headless — prefer the smoke script. Stop with Ctrl-C.

## Environment

The smoke script sets these; listed for the human/`npm start` path. Two DB URLs:
migrations/seed run as the **admin** role, the app runs as **`nomi_app`** (RLS).

| Variable | Required | Value used | Notes |
|---|---|---|---|
| `WHATSAPP_PROVIDER` | No | `disabled` | unset ⇒ disabled; `meta`/`360dialog` need provider creds |
| `DATABASE_URL` | Yes | `postgresql://nomi_app@127.0.0.1:55440/nomi` | app role — RLS enforced |
| `MIGRATE_DATABASE_URL` | migrate/seed | `postgresql://postgres@127.0.0.1:55440/nomi` | admin role (DDL) |
| `ANTHROPIC_API_KEY` | Yes (shape) | `sk-ant-smoke-...` (len ≥ 20) | not called in disabled mode |
| `CREDENTIAL_KEY` | Yes | 64 hex chars | derives the session-cookie secret |
| `WEBHOOK_VERIFY_TOKEN` | Yes | any ≥ 16 chars | |
| `OWNER_ACCESS_CODE` | No | `smoke-code` | Command Center login; else generated + logged |
| `PORT` | No | `8787` | |

## Test

```bash
npm run check        # tsc + src/core purity boundaries + vitest (617 pass; DB-backed tests skipped without DATABASE_URL)
```

The DB-backed integration tests run only when `DATABASE_URL` points at a migrated
Postgres — the smoke script's cluster works: `DATABASE_URL=postgresql://nomi_app@127.0.0.1:55440/nomi npx vitest run tests/integration/boot.test.ts`.

## Gotchas

- **Postgres socket path length.** `initdb`/`pg_ctl` fail with *"Unix-domain socket
  path is too long (maximum 103 bytes)"* if the socket dir is deep. The script uses
  a short `mktemp -d /tmp/yfs.XXXX` for `unix_socket_directories` — don't point it at
  a long scratch path.
- **`NODE_ENV=production` breaks login over http.** It flips the session cookie to
  `Secure`, so it's never sent back over plain http and every `/app` request bounces
  to `/login`. The script runs with `env -u NODE_ENV`; keep it unset locally.
- **The runtime role is created `NOLOGIN`** — by migration 0005, under its
  original name `yiwuflow_app`; migration 0026 renames it to `nomi_app`. Local
  runs must grant it login (the script does, under whichever name is present) or
  the app can't connect.
- **The repo `.env` may hold prod credentials.** `main.ts` loads `.env` but only for
  *unset* vars, so the script's explicit `DATABASE_URL` wins — nothing hits prod.
  Don't rely on `.env` for the local run.
- **`disabled` mode mounts no webhook.** `/webhook/whatsapp` returns 404 by design;
  `/health` reports `"provider":"disabled"`. Only `/health` + `/app/*` exist.
- **`ANTHROPIC_API_KEY` only needs the right shape** (≥ 20 chars) — in disabled mode
  no turn runs, so it's never called. A dummy is fine.

## Troubleshooting

- **`health` shows `"db":false` / 503**: Postgres isn't reachable or not migrated —
  check `/tmp/yf-run/pg.log` and that `node tools/migrate.mjs` ran (needs
  `MIGRATE_DATABASE_URL`).
- **`/app` always 302 → /login even after POST /login**: `NODE_ENV=production` is set
  (Secure cookie) — unset it. Or the access code didn't match `OWNER_ACCESS_CODE`.
- **`server exited during startup` in the script**: read `/tmp/yf-run/app.log`. Most
  often an env-shape failure — the log prints `environment invalid:` with the offending
  var (e.g. `CREDENTIAL_KEY: invalid shape` if it isn't 64 hex chars).
- **Port already in use**: a previous run is still up — `lsof -ti:8787 -sTCP:LISTEN | xargs -r kill` and `pg_ctl -D /tmp/yf-run/pg stop`.
