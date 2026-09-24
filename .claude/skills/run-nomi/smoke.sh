#!/usr/bin/env bash
# run-nomi — clean machine → running, seeded, verified Nomi server.
#
# Brings up an EPHEMERAL Postgres, migrates + seeds the demo tenant, builds,
# launches the server in `disabled` mode (no Meta credentials needed), and
# drives /health + /login + /app. On success the server is LEFT RUNNING and the
# script prints how to reach and stop it. Exit 0 = the Command Center rendered
# for a logged-in owner.
#
# Nothing here touches production: DATABASE_URL is overridden to the local
# ephemeral cluster, so the repo's .env (which may hold prod creds) is ignored.
set -uo pipefail

# Repo root = three levels up from this skill dir (.claude/skills/run-nomi/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

PGPORT="${PGPORT:-55440}"
APPPORT="${PORT:-8787}"
CODE="${OWNER_ACCESS_CODE:-smoke-code}"
SK="${SK:-/tmp/yf-run}"                 # scratch: ephemeral PG data + logs + HTML
BASEURL="http://127.0.0.1:${APPPORT}"

rm -rf "$SK"; mkdir -p "$SK"
SOCK="$(mktemp -d /tmp/yfs.XXXX)"       # PG unix-socket dir must be a SHORT path (<103 chars)

fail() {
  echo "FAIL: $*" >&2
  [ -f "$SK/app.log" ] && { echo "--- app.log tail ---" >&2; tail -20 "$SK/app.log" >&2; }
  # Only the server THIS run started. `kill 0` — what an unset APP_PID used to
  # expand to — signals the whole process group, the caller's shell included,
  # so a failure before launch killed whatever ran this script.
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  pg_ctl -D "$SK/pg" -w stop >/dev/null 2>&1
  exit 1
}

echo "[1/6] ephemeral Postgres on :$PGPORT"
initdb -D "$SK/pg" -U postgres --auth-local=trust --auth-host=trust >/dev/null 2>&1 || fail "initdb"
pg_ctl -D "$SK/pg" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCK" \
  -l "$SK/pg.log" -w start >/dev/null 2>&1 || fail "postgres start (see $SK/pg.log)"
createdb -h 127.0.0.1 -p "$PGPORT" -U postgres nomi || fail "createdb"

echo "[2/6] migrate + grant app-role login + seed demo & sandbox tenants"
export MIGRATE_DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/nomi"
node tools/migrate.mjs >/dev/null 2>&1 || fail "migrate"
# Migration 0005 creates the role NOLOGIN; local runs need it to log in.
# 0005 creates it under its original name and 0026 renames it to nomi_app;
# both have run by the time we get here.
# Host/port/user flags, never the URL as an argument (the rule every tool keeps;
# tests/parity/no-secret-in-argv.test.ts). Local, so there is no password.
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d nomi -tAc "alter role nomi_app login;" >/dev/null 2>&1 || fail "grant login"
node tools/seed-demo.mjs >/dev/null 2>&1 || fail "seed demo"
# The sandbox tenant is what the rehearsal walkthrough (step 7) practises in.
DATABASE_URL="postgresql://nomi_app@127.0.0.1:$PGPORT/nomi" \
  node tools/seed-sandbox.mjs >/dev/null 2>&1 || fail "seed sandbox"

echo "[3/6] build (tsc → dist)"
npm run build >/dev/null 2>&1 || fail "build"

echo "[4/6] launch server (disabled mode) on :$APPPORT"
# Local, safe env. `env -u NODE_ENV` keeps cookies non-Secure so login works
# over http; DATABASE_URL/ANTHROPIC override anything in .env.
env -u NODE_ENV \
  WHATSAPP_PROVIDER=disabled \
  DATABASE_URL="postgresql://nomi_app@127.0.0.1:$PGPORT/nomi" \
  ANTHROPIC_API_KEY="sk-ant-smoke-not-a-real-key-00000000" \
  CREDENTIAL_KEY="$(printf 'a%.0s' $(seq 1 64))" \
  WEBHOOK_VERIFY_TOKEN="smoke-verify-token-0001" \
  WEBHOOK_SECRET="smoke-webhook-secret-0000000000000000" \
  OWNER_ACCESS_CODE="$CODE" \
  LEGAL_CONTACT_EMAIL="privacy@example.com" \
  PORT="$APPPORT" \
  node dist/main.js &> "$SK/app.log" &
APP_PID=$!

echo "[5/6] wait for /health"
# Up to three minutes: on an iCloud-synced checkout a cold boot can take well
# over the thirty seconds this once allowed (2026-09-24).
for _ in $(seq 1 360); do
  curl -sf "$BASEURL/health" >/dev/null 2>&1 && break
  kill -0 "$APP_PID" 2>/dev/null || fail "server exited during startup"
  sleep 0.5
done
HEALTH="$(curl -sS "$BASEURL/health" 2>/dev/null)" || fail "health never came up"
echo "  health: $HEALTH"

echo "[6/6] drive the owner walkthrough (auth → home → runbook → sandbox rehearsal)"
J="$SK/cookies.txt"
FORM='content-type: application/x-www-form-urlencoded'
# authenticated GET → file, and assert a marker is present
get() {  # get <path> <outfile> <marker> <what>
  curl -sS -b "$J" "$BASEURL$1" -o "$2" || fail "GET $1"
  grep -q "$3" "$2" || fail "$4 (see $2)"
}
# authenticated POST; every owner action is Post/Redirect/Get → expect 302
post() {  # post <path> <data> <what>
  local c; c="$(curl -sS -b "$J" -o /dev/null -w '%{http_code}' -X POST "$BASEURL$1" -H "$FORM" --data "$2")"
  [ "$c" = "302" ] || fail "$3 (POST $1 returned $c, expected 302)"
}

#  auth gate — every owner surface must bounce when signed out
for p in /app /app/onboarding /app/sandbox; do
  [ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASEURL$p")" = "302" ] || fail "$p should redirect unauthenticated"
done
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASEURL/app/sandbox/takeover")" = "302" ] \
  || fail "POST /app/sandbox/takeover should redirect unauthenticated"

#  login
curl -sS -c "$J" -o /dev/null -X POST "$BASEURL/login" -H "$FORM" -d "code=$CODE" || fail "login POST"

#  the owner surfaces
get /app            "$SK/app-home.html"   '<h1 class="page">Today'  "Today did not render"
get /app/factory    "$SK/app-factory.html" "What you promise buyers" "My factory did not render"
get /app/onboarding "$SK/app-onboard.html" "Practice before launch" "Pilot runbook did not render"
get /app/sandbox    "$SK/app-sandbox.html" "This is practice only"        "Sandbox did not render"

#  My factory is the door to the four surfaces it contains — they must stay reachable
for r in /app/settings /app/products /app/knowledge /app/channels; do
  grep -q "href=\"$r\"" "$SK/app-factory.html" || fail "My factory no longer links to $r"
  [ "$(curl -sS -b "$J" -o /dev/null -w '%{http_code}' "$BASEURL$r")" = "200" ] || fail "$r stopped rendering"
done

#  rehearsal: buyer turn → take over → owner reply → hand back
post /app/sandbox/message  "mode=scripted&text=Do%20you%20make%20canvas%20tote%20bags%3F" "sandbox buyer turn"
get  /app/sandbox "$SK/app-sandbox.html" 'action="/app/sandbox/takeover"' "take-over control missing"
post /app/sandbox/takeover "mode=scripted" "sandbox takeover"
get  /app/sandbox "$SK/app-sandbox.html" 'action="/app/sandbox/reply"'   "owner reply box missing after takeover"
post /app/sandbox/reply    "mode=scripted&text=Owner%20here%20%E2%80%94%20yes%2C%20we%20can%20do%20that." "sandbox owner reply"
get  /app/sandbox "$SK/app-sandbox.html" "Owner here" "owner reply never reached the transcript"
post /app/sandbox/resume   "mode=scripted" "sandbox resume"
get  /app/sandbox "$SK/app-sandbox.html" 'action="/app/sandbox/takeover"' "did not hand back to the employee"

#  the runbook must now observe the rehearsal it just practised
get /app/onboarding "$SK/app-onboard.html" "Practice before launch" "Pilot runbook did not re-render"
REHEARSED="$(grep -o 'Practice before launch · [0-9]*/[0-9]*' "$SK/app-onboard.html" | head -1)"
case "$REHEARSED" in *"3/5"*|*"4/5"*|*"5/5"*) ;; *) fail "rehearsal not observed by the runbook (got '$REHEARSED')";; esac

#  nothing was really delivered: the sandbox tenant has no channel credential
CREDS="$(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d nomi -tAc \
  "select count(*) from channel_credentials where business_id='5a4d0000-0000-4000-8000-0000000000b1';" 2>/dev/null | tr -d ' ')"
[ "$CREDS" = "0" ] || fail "sandbox tenant must have NO channel credentials (found $CREDS)"

cat <<EOF

PASS — Nomi is running and the owner walkthrough was driven end-to-end.
  walkthrough:  auth gate → login → Today → Pilot runbook → Sandbox
                → My factory (+ the 4 surfaces it contains)
                → buyer turn → take over → owner reply → hand back
                rehearsal observed by the runbook: $REHEARSED
                sandbox channel credentials: $CREDS (must be 0 — nothing delivered)
  URL:          $BASEURL
  health:       $HEALTH
  login code:   $CODE          (POST /login  code=$CODE)
  pages:        $SK/app-home.html · app-factory.html · app-onboard.html · app-sandbox.html
  cookie jar:   $SK/cookies.txt     (authenticated session)
  app log:      $SK/app.log
  server PID:   $APP_PID            (LEFT RUNNING)

Drive more:
  curl -sb $SK/cookies.txt $BASEURL/app/knowledge | grep -o 'What she knows'
  curl -sb $SK/cookies.txt $BASEURL/app/inbox     | grep -o 'Buyers'

Stop everything:
  kill $APP_PID; pg_ctl -D $SK/pg stop
EOF
