#!/usr/bin/env bash
# run-yiwuflow — clean machine → running, seeded, verified YiwuFlow server.
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

# Repo root = three levels up from this skill dir (.claude/skills/run-yiwuflow/).
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
  kill "${APP_PID:-0}" 2>/dev/null
  pg_ctl -D "$SK/pg" -w stop >/dev/null 2>&1
  exit 1
}

echo "[1/6] ephemeral Postgres on :$PGPORT"
initdb -D "$SK/pg" -U postgres --auth-local=trust --auth-host=trust >/dev/null 2>&1 || fail "initdb"
pg_ctl -D "$SK/pg" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCK" \
  -l "$SK/pg.log" -w start >/dev/null 2>&1 || fail "postgres start (see $SK/pg.log)"
createdb -h 127.0.0.1 -p "$PGPORT" -U postgres yiwuflow || fail "createdb"

echo "[2/6] migrate + grant app-role login + seed demo tenant"
export MIGRATE_DATABASE_URL="postgresql://postgres@127.0.0.1:$PGPORT/yiwuflow"
node tools/migrate.mjs >/dev/null 2>&1 || fail "migrate"
# migration 0005 creates yiwuflow_app NOLOGIN; local runs need it to log in.
psql "$MIGRATE_DATABASE_URL" -tAc "alter role yiwuflow_app login;" >/dev/null 2>&1 || fail "grant login"
node tools/seed-demo.mjs >/dev/null 2>&1 || fail "seed demo"

echo "[3/6] build (tsc → dist)"
npm run build >/dev/null 2>&1 || fail "build"

echo "[4/6] launch server (disabled mode) on :$APPPORT"
# Local, safe env. `env -u NODE_ENV` keeps cookies non-Secure so login works
# over http; DATABASE_URL/ANTHROPIC override anything in .env.
env -u NODE_ENV \
  WHATSAPP_PROVIDER=disabled \
  DATABASE_URL="postgresql://yiwuflow_app@127.0.0.1:$PGPORT/yiwuflow" \
  ANTHROPIC_API_KEY="sk-ant-smoke-not-a-real-key-00000000" \
  CREDENTIAL_KEY="$(printf 'a%.0s' $(seq 1 64))" \
  WEBHOOK_VERIFY_TOKEN="smoke-verify-token-0001" \
  WEBHOOK_SECRET="smoke-webhook-secret-0000000000000000" \
  OWNER_ACCESS_CODE="$CODE" \
  PORT="$APPPORT" \
  node dist/main.js &> "$SK/app.log" &
APP_PID=$!

echo "[5/6] wait for /health"
for _ in $(seq 1 60); do
  curl -sf "$BASEURL/health" >/dev/null 2>&1 && break
  kill -0 "$APP_PID" 2>/dev/null || fail "server exited during startup"
  sleep 0.5
done
HEALTH="$(curl -sS "$BASEURL/health" 2>/dev/null)" || fail "health never came up"
echo "  health: $HEALTH"

echo "[6/6] drive the Command Center (auth gate → login → home)"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASEURL/app")" = "302" ] || fail "/app should redirect unauthenticated"
curl -sS -c "$SK/cookies.txt" -o /dev/null -X POST "$BASEURL/login" \
  -H 'content-type: application/x-www-form-urlencoded' -d "code=$CODE" || fail "login POST"
curl -sS -b "$SK/cookies.txt" "$BASEURL/app" -o "$SK/app-home.html" || fail "GET /app"
grep -q "Lily's summary today" "$SK/app-home.html" || fail "Command Center home did not render (see $SK/app-home.html)"

cat <<EOF

PASS — YiwuFlow is running and was driven end-to-end.
  URL:          $BASEURL
  health:       $HEALTH
  login code:   $CODE          (POST /login  code=$CODE)
  home HTML:    $SK/app-home.html   ($(wc -c < "$SK/app-home.html" | tr -d ' ') bytes, rendered with demo data)
  cookie jar:   $SK/cookies.txt     (authenticated session)
  app log:      $SK/app.log
  server PID:   $APP_PID            (LEFT RUNNING)

Drive more:
  curl -sb $SK/cookies.txt $BASEURL/app/knowledge | grep -o 'Factory knowledge'
  curl -sb $SK/cookies.txt $BASEURL/app/onboarding | grep -o 'Pilot readiness'

Stop everything:
  kill $APP_PID; pg_ctl -D $SK/pg stop
EOF
