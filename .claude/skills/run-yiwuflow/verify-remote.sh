#!/usr/bin/env bash
# verify-remote — READ-ONLY verification of a DEPLOYED YiwuFlow (M17.1).
#
#   bash .claude/skills/run-yiwuflow/verify-remote.sh https://<host> [access-code]
#
# Answers "is the deployment actually up and correctly locked down?" without
# changing anything: it performs GETs plus a single login POST when an access
# code is supplied. It NEVER posts an owner action, never touches the sandbox,
# and never sends a message — safe to run against production.
#
# Exit 0 = every check passed. Exit 1 = the first failure, with detail.
set -uo pipefail

BASE="${1:-}"
CODE="${2:-${OWNER_ACCESS_CODE:-}}"
JAR="$(mktemp /tmp/yfv.XXXX)"
PASS=0

if [ -z "$BASE" ]; then
  echo "usage: verify-remote.sh https://<host> [access-code]" >&2
  echo "       (access code may also come from \$OWNER_ACCESS_CODE)" >&2
  exit 2
fi
BASE="${BASE%/}"
case "$BASE" in
  https://*) ;;
  http://127.0.0.1*|http://localhost*) echo "note: plain http local target — Secure-cookie checks are skipped" >&2 ;;
  http://*) echo "REFUSING: $BASE is plain http and not local — a login over http would expose the code." >&2; exit 2 ;;
esac

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; rm -f "$JAR"; exit 1; }

code_of() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

echo "verifying $BASE"

# ── 1. health ────────────────────────────────────────────────────────────────
HEALTH="$(curl -sS --max-time 20 "$BASE/health" 2>/dev/null)" || fail "/health unreachable"
case "$HEALTH" in
  *'"ok":true'*) ok "/health ok  $HEALTH" ;;
  *) fail "/health did not report ok:true → $HEALTH" ;;
esac
case "$HEALTH" in
  *'"db":true'*) ok "database reachable from the app" ;;
  *) fail "/health reports db:false — the app cannot reach Postgres" ;;
esac
# M17.1: the public probe must not advertise the build.
case "$(printf '%s' "$HEALTH" | tr 'A-Z' 'a-z')" in
  *commit*|*sha*|*branch*|*version*) fail "/health leaks build information: $HEALTH" ;;
  *) ok "/health leaks no build information" ;;
esac

# ── 2. auth gate ─────────────────────────────────────────────────────────────
for p in /app /app/onboarding /app/inbox /app/sandbox; do
  c="$(code_of "$BASE$p")"
  [ "$c" = "302" ] || [ "$c" = "301" ] || fail "$p returned $c for an anonymous visitor (expected a redirect to /login)"
done
ok "every owner surface redirects when signed out"

c="$(code_of -X POST "$BASE/app/inbox/00000000-0000-0000-0000-000000000000/takeover")"
[ "$c" = "302" ] || fail "an unauthenticated owner ACTION returned $c (expected 302)"
ok "owner actions reject anonymous callers"

[ "$(code_of "$BASE/login")" = "200" ] || fail "/login did not render"
ok "/login renders"

# webhook must stay absent while messaging is disabled
c="$(code_of "$BASE/webhook/whatsapp?hub.mode=subscribe&hub.challenge=x")"
case "$HEALTH" in
  *'"provider":"disabled"'*)
    [ "$c" = "404" ] || fail "provider is disabled but /webhook/whatsapp answered $c (expected 404)"
    ok "messaging is disabled and no webhook is mounted" ;;
  *) ok "messaging provider is active (webhook check skipped — /webhook/whatsapp → $c)" ;;
esac

# ── 3. owner surfaces render (only with an access code) ──────────────────────
if [ -z "$CODE" ]; then
  echo "  (no access code given — skipping the authenticated checks)"
  echo "PASS — $PASS public checks; pass an access code to also verify the owner surfaces."
  rm -f "$JAR"; exit 0
fi

SETC="$(curl -sS -i --max-time 20 -c "$JAR" -X POST "$BASE/login" \
  -H 'content-type: application/x-www-form-urlencoded' --data "code=$CODE" 2>/dev/null \
  | tr -d '\r' | grep -i '^set-cookie:')" || true
[ -n "$SETC" ] || fail "login failed — no session cookie (is the access code right?)"
ok "login succeeded"

case "$BASE" in https://*)
  case "$SETC" in *Secure*) ok "session cookie is Secure" ;; *) fail "session cookie is NOT Secure over https: $SETC" ;; esac
  case "$SETC" in *HttpOnly*) ok "session cookie is HttpOnly" ;; *) fail "session cookie is NOT HttpOnly" ;; esac
  case "$SETC" in *SameSite=Lax*) ok "session cookie is SameSite=Lax" ;; *) fail "session cookie is not SameSite=Lax" ;; esac
esac

check_page() {  # check_page <path> <marker> <label>
  local body; body="$(curl -sS --max-time 25 -b "$JAR" "$BASE$1" 2>/dev/null)" || fail "GET $1 failed"
  case "$body" in *"$2"*) ok "$3" ;; *) fail "$3 — marker '$2' missing from $1" ;; esac
}
check_page /app            "Needs your attention"    "Operations Home renders"
check_page /app/onboarding "Practice before launch"  "Pilot runbook renders"
check_page /app/onboarding "Running version"         "deployment info visible to the owner"
check_page /app/inbox      "Inbox"                   "Inbox renders"
check_page /app/knowledge  "Factory knowledge"       "Knowledge renders"

# Report the running build (informational, not a gate).
BUILD="$(curl -sS --max-time 25 -b "$JAR" "$BASE/app/onboarding" 2>/dev/null \
  | grep -oE 'Running version</span><b class="n mono">[^<]*' | sed 's/.*mono">//')"
[ -n "$BUILD" ] && echo "  running version: $BUILD"

rm -f "$JAR"
echo "PASS — $PASS checks against $BASE"
