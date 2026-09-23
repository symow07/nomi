#!/usr/bin/env bash
# backup/run.sh — the daily backup, run by Railway on a cron schedule inside the
# project's private network, so the public TCP proxy (which accepts a
# connection and then goes silent, 2026-09-22/23) is not on the path.
#
# Six steps, in this order, and the order is the point:
#   1. dump   roles + database, over postgres.railway.internal
#   2. drill  restore the pair into a throwaway cluster IN THIS CONTAINER and
#             run the same four checks the laptop runs (tools/verify-restore.sh)
#             — a dump that does not restore is not uploaded
#   3. encrypt with the age PUBLIC key (the private key never lives on Railway)
#   4. upload to the bucket under daily/<name>/, then read the listing back
#   5. prune  dailies older than RETENTION_DAYS (the laptop's manual pairs at the
#             bucket root are never touched)
#   6. record a row in backup_runs (what the app's stale-backup alert reads),
#             then ping the dead-man's switch
#
# CONNECTION. Everything comes from the environment as Railway reference
# variables — PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE from the Postgres
# service, ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT/BUCKET from the bucket.
# No URL is built and nothing secret is ever an argument to a command
# (tests/parity/no-secret-in-argv.test.ts).
#
# Any failure exits non-zero: Railway shows the run as failed, the /fail ping
# fires if a ping URL is set, and nothing half-made reaches the bucket.
set -uo pipefail

: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${AGE_RECIPIENT:?}" "${BUCKET:?}" "${ACCESS_KEY_ID:?}" "${SECRET_ACCESS_KEY:?}" "${ENDPOINT:?}"
RETENTION_DAYS="${RETENTION_DAYS:-60}"
PING="${BACKUP_PING_URL:-}"
PGBIN="${PGBIN:-/usr/lib/postgresql/18/bin}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="nomi-backup-$TS"
WORK="$(mktemp -d /tmp/bk.XXXXXX)"
STAGE="$WORK/$NAME"
mkdir -p "$STAGE"
trap 'rm -rf "$WORK"' EXIT

ping() { [ -n "$PING" ] && curl -fsS -m 10 --retry 2 -o /dev/null "$PING$1" ${2:+--data-raw "$2"} || true; }
fail() { echo "FAILED: $*" >&2; ping /fail "$*"; exit 1; }
ping /start

# ── 1 · dump ────────────────────────────────────────────────────────────────
echo "[1/6] dumping $PGDATABASE from $PGHOST"
SERVER="$("$PGBIN/psql" -tAc 'show server_version' 2>/dev/null | tr -d ' ')"
SCHEMA_V="$("$PGBIN/psql" -tAc 'select max(version) from _migrations' 2>/dev/null | tr -d ' ')"
RUNTIME_ROLE="$("$PGBIN/psql" -tAc \
  "select rolname from pg_roles where rolname in ('nomi_app','yiwuflow_app') order by rolname limit 1" 2>/dev/null | tr -d ' ')"
[ -n "$SERVER" ] && [ -n "$SCHEMA_V" ] && [ -n "$RUNTIME_ROLE" ] \
  || fail "could not read what to back up (server='$SERVER' schema='$SCHEMA_V' role='$RUNTIME_ROLE')"

"$PGBIN/pg_dumpall" --roles-only -l "$PGDATABASE" -f "$STAGE/roles-$TS.sql" || fail "roles dump"
grep -qE "CREATE ROLE $RUNTIME_ROLE([^a-zA-Z0-9_]|$)" "$STAGE/roles-$TS.sql" \
  || fail "roles file does not contain $RUNTIME_ROLE — a restore would lose every RLS policy"
"$PGBIN/pg_dump" -Fc -f "$STAGE/nomi-$TS.dump" || fail "database dump"
[ -s "$STAGE/nomi-$TS.dump" ] || fail "dump file is empty"
"$PGBIN/pg_restore" -l "$STAGE/nomi-$TS.dump" 2>/dev/null | grep -q businesses || fail "dump has no businesses table"

sha() { sha256sum "$1" | awk '{print $1}'; }
DUMP_BYTES="$(stat -c %s "$STAGE/nomi-$TS.dump")"
DUMP_SHA="$(sha "$STAGE/nomi-$TS.dump")"
{
  echo "Nomi logical backup"
  echo "taken_utc:       $TS"
  echo "taken_by:        railway-cron"
  echo "database:        $PGDATABASE"
  echo "server_version:  $SERVER"
  echo "client_pg_dump:  $("$PGBIN/pg_dump" --version | sed 's/^pg_dump (PostgreSQL) //')"
  echo "schema_version:  $SCHEMA_V"
  echo "runtime_role:    $RUNTIME_ROLE"
  echo
  echo "roles-$TS.sql    $(stat -c %s "$STAGE/roles-$TS.sql") bytes  sha256=$(sha "$STAGE/roles-$TS.sql")"
  echo "nomi-$TS.dump    $DUMP_BYTES bytes  sha256=$DUMP_SHA"
  echo
  echo "RESTORE ROLES FIRST. See docs/BACKUP-RESTORE.md."
} > "$STAGE/MANIFEST.txt"
echo "    $DUMP_BYTES bytes, schema $SCHEMA_V, role $RUNTIME_ROLE"

# ── 2 · drill ───────────────────────────────────────────────────────────────
# The laptop's script, unchanged: a throwaway cluster, roles first, the four
# checks. It exits non-zero unless all four pass, and (d) — isolation denies
# with no tenant context — is the one that catches a roles-less restore.
echo "[2/6] restore drill"
PGBIN="$PGBIN" bash /app/verify-restore.sh "$STAGE" || fail "restore drill did not pass — this dump is NOT uploaded"
echo "restore_drill:   passed 4/4 in the backup container" >> "$STAGE/MANIFEST.txt"

# ── 3 · encrypt ─────────────────────────────────────────────────────────────
echo "[3/6] encrypting (recipient ${AGE_RECIPIENT:0:16}…)"
ENC="$STAGE/encrypted"; mkdir -p "$ENC"
for f in "$STAGE/roles-$TS.sql" "$STAGE/nomi-$TS.dump" "$STAGE/MANIFEST.txt"; do
  age -r "$AGE_RECIPIENT" -o "$ENC/$(basename "$f").age" "$f" || fail "age failed on $(basename "$f")"
done

# ── 4 · upload ──────────────────────────────────────────────────────────────
echo "[4/6] uploading to $BUCKET/daily/$NAME/"
export RCLONE_CONFIG_BK_TYPE=s3 RCLONE_CONFIG_BK_PROVIDER=Other
export RCLONE_CONFIG_BK_ACCESS_KEY_ID="$ACCESS_KEY_ID" RCLONE_CONFIG_BK_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY"
export RCLONE_CONFIG_BK_ENDPOINT="$ENDPOINT" RCLONE_CONFIG_BK_REGION="${REGION:-auto}"
rclone copy "$ENC" "BK:$BUCKET/daily/$NAME/" --s3-no-check-bucket || fail "upload"
LISTED="$(rclone ls "BK:$BUCKET/daily/$NAME/" 2>/dev/null)"
[ "$(echo "$LISTED" | grep -c '\.age$')" = "3" ] || fail "readback: expected 3 objects, got: $LISTED"
echo "$LISTED" | awk '{printf "      %-40s %s bytes\n", $2, $1}'

# ── 5 · prune ───────────────────────────────────────────────────────────────
echo "[5/6] pruning dailies older than $RETENTION_DAYS days"
rclone delete "BK:$BUCKET/daily/" --min-age "${RETENTION_DAYS}d" || echo "    (prune skipped: $?)" >&2
rclone rmdirs "BK:$BUCKET/daily/" --leave-root 2>/dev/null || true

# ── 6 · record, then ping ───────────────────────────────────────────────────
echo "[6/6] recording the run"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q \
  -v name="$NAME" -v taken="$TS" -v bytes="$DUMP_BYTES" -v sha="$DUMP_SHA" -v schema="$SCHEMA_V" <<'SQL' \
  || fail "could not record the run in backup_runs (is migration 0069 applied?)"
insert into backup_runs (name, taken_at, dump_bytes, sha256, schema_version, drill_passed, taken_by)
values (:'name', to_timestamp(:'taken', 'YYYYMMDD"T"HH24MISS"Z"') at time zone 'UTC', :'bytes'::bigint, :'sha', :'schema'::int, true, 'railway-cron');
SQL

ping ""
echo "OK — $NAME: dumped, restored in a throwaway cluster, encrypted, uploaded, recorded."
