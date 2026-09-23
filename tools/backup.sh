#!/usr/bin/env bash
# backup.sh — the two-artifact logical backup BACKUP-RESTORE.md specifies.
#
#   MIGRATE_DATABASE_URL='<admin url>' bash tools/backup.sh [destination-dir]
#
# Produces, as ONE unit, into <destination>/nomi-backup-<UTC timestamp>/:
#
#   roles-<ts>.sql   pg_dumpall --roles-only — CLUSTER roles, which a plain
#                    pg_dump does not contain
#   nomi-<ts>.dump   pg_dump -Fc of the application database
#   MANIFEST.txt     sizes, sha256 of both, server version, role name, and the
#                    schema version the pair was taken at
#
# WHY TWO ARTIFACTS. Roles live at the cluster level, not in the database. A
# data dump restored without its roles file comes back with RLS *enabled* and
# ZERO policies: every `create policy ... to <role>` fails because the role does
# not exist, pg_restore reports those as ignorable errors, row counts match
# perfectly, and tenant isolation is gone. It looks like a clean restore. That
# is the whole reason this script refuses to produce one file without the other.
#
# ATOMIC. Everything is written to a staging directory and moved into place only
# after both artifacts exist, are non-empty, and pass their readback checks. A
# failed or interrupted run leaves NO directory behind that could be mistaken
# for a backup. A roles file without its matching data dump is not a backup.
#
# NEVER LOGS THE CONNECTION STRING. Every command's stderr is filtered through
# `redact` before it reaches the terminal, and the URL is never interpolated
# into any message.
#
# NEVER PUTS THE PASSWORD IN A COMMAND LINE EITHER. Until 2026-09-23 the pg
# tools were given `-d "$MIGRATE_DATABASE_URL"`, which put the whole credential
# in the process list for the length of every dump — readable by any local user
# and by any `ps` a session runs. Now the password goes to libpq through
# PGPASSWORD (environment; `ps` does not show it) and the tools are given the
# URL WITHOUT it (`tools/lib/pgenv.py`). A test holds this for every tool.
#
# RETRIES. Railway's public TCP proxy drops connections intermittently — the
# 0025 migration needed three attempts on 2026-08-08. Each dump is retried up to
# ATTEMPTS times. A dropped connection is not corruption; it is a retry.
set -uo pipefail

ATTEMPTS="${ATTEMPTS:-4}"
DEST="${1:-${BACKUP_DIR:-$HOME/nomi-backups}}"

# NO SILENT HANGS. On 2026-09-22 the public proxy accepted connections and then
# never answered, and a tool with no limits waits on that forever. libpq honours
# PGCONNECT_TIMEOUT in psql, pg_dump and pg_dumpall alike; ATTEMPT_LIMIT bounds
# one whole attempt, so a dump that connected and then stalled becomes a RETRY
# like any other dropped connection. Both are seconds, and both can be raised.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-20}"
ATTEMPT_LIMIT="${ATTEMPT_LIMIT:-900}"
QUERY_LIMIT="${QUERY_LIMIT:-60}"

# within <seconds> <command…> — run it, and stop it if it outlives the limit.
# Exit 124 means the limit was hit (the same code coreutils' timeout uses);
# macOS has no `timeout`, so this is written out.
within() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  # stderr of the watchdog and of `wait` is bash's own "Terminated: 15" job
  # chatter, never the command's — its output goes straight through.
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) 2>/dev/null &
  local dog=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  if kill -0 "$dog" 2>/dev/null; then
    pkill -P "$dog" 2>/dev/null; kill "$dog" 2>/dev/null
  elif [ "$rc" -eq 143 ]; then
    rc=124   # the watchdog fired; a command that finished just in time keeps its own code
  fi
  wait "$dog" 2>/dev/null
  return "$rc"
}

if [ -z "${MIGRATE_DATABASE_URL:-}" ]; then
  echo "MIGRATE_DATABASE_URL is required (the superuser/admin url)." >&2
  echo "It is never printed by this script and must not be pasted into logs." >&2
  exit 2
fi

# The password into the environment, the rest of the URL into PG_URL_NOPASS.
# Every pg tool below is given the latter; libpq finds the former by itself.
eval "$(python3 "$(dirname "$0")/lib/pgenv.py" MIGRATE_DATABASE_URL)" || exit 2

# Redact anything that looks like a connection string, whatever the source.
redact() { sed -E 's#postgres(ql)?://[^[:space:]"'"'"']*#<redacted-url>#g'; }

# ── the client must not be older than the server ────────────────────────────
# pg_dump refuses to dump a server newer than itself, and a silently older
# dumper is how you discover at restore time that the archive is unusable.
find_pgbin() {
  local c
  for c in "${PGBIN:-}" /opt/homebrew/opt/postgresql@18/bin /usr/lib/postgresql/18/bin ""; do
    [ -n "$c" ] && [ -x "$c/pg_dump" ] && { echo "$c"; return; }
  done
  command -v pg_dump >/dev/null && dirname "$(command -v pg_dump)"
}
PGBIN="$(find_pgbin)"
[ -n "$PGBIN" ] || { echo "no pg_dump found" >&2; exit 2; }

DUMP="$PGBIN/pg_dump"
DUMPALL="$PGBIN/pg_dumpall"
RESTORE="$PGBIN/pg_restore"
PSQL="$PGBIN/psql"

client_mm() { "$1" --version | grep -oE '[0-9]+' | head -1; }
CLIENT_MAJOR="$(client_mm "$DUMP")"

# One question to the server, bounded like everything else here.
pq() { within "$QUERY_LIMIT" "$PSQL" -d "$PG_URL_NOPASS" -tAc "$1"; }

SERVER_FULL="$(pq 'show server_version' 2>/dev/null | tr -d ' ')"
if [ -z "$SERVER_FULL" ]; then
  echo "cannot reach the database to read its version (checked with psql;" >&2
  echo "connect limit ${PGCONNECT_TIMEOUT}s, answer limit ${QUERY_LIMIT}s)." >&2
  exit 1
fi
SERVER_MAJOR="${SERVER_FULL%%.*}"
if [ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]; then
  echo "REFUSING: pg_dump is $CLIENT_MAJOR, server is $SERVER_MAJOR." >&2
  echo "A dump taken by an older client is not guaranteed restorable." >&2
  echo "Set PGBIN to a PostgreSQL $SERVER_MAJOR bin directory." >&2
  exit 2
fi

DBNAME="$(pq 'select current_database()' 2> >(redact >&2) | tr -d ' ')"
SCHEMA_V="$(pq 'select max(version) from _migrations' 2>/dev/null | tr -d ' ')"
RUNTIME_ROLE="$(pq \
  "select rolname from pg_roles where rolname in ('nomi_app','yiwuflow_app') order by rolname limit 1" 2> >(redact >&2) | tr -d ' ')"
# An empty answer here is a connection that dropped between questions, not a
# fact about the database. An empty RUNTIME_ROLE in particular would make the
# roles-file check below match ANY role and pass — so it is a stop, not a guess.
if [ -z "$DBNAME" ] || [ -z "$SCHEMA_V" ] || [ -z "$RUNTIME_ROLE" ]; then
  echo "lost the database while reading what to back up (name='$DBNAME' schema='$SCHEMA_V' role='$RUNTIME_ROLE')." >&2
  echo "Nothing was written. Run it again." >&2
  exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="nomi-backup-$TS"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/$NAME.XXXXXX")"
FINAL="$DEST/$NAME"

cleanup() { [ -n "${STAGE:-}" ] && rm -rf "$STAGE"; }
trap cleanup EXIT

fail() { echo "FAILED: $*" >&2; exit 1; }

# Retry wrapper: a dropped proxy connection is transient, so try again rather
# than leaving the operator to guess whether the archive is damaged.
attempt() {
  local label="$1"; shift
  local n=1
  while [ "$n" -le "$ATTEMPTS" ]; do
    within "$ATTEMPT_LIMIT" "$@" 2> >(redact >&2)
    local rc=$?
    if [ "$rc" -eq 0 ]; then
      [ "$n" -gt 1 ] && echo "    ($label succeeded on attempt $n)"
      return 0
    fi
    [ "$rc" -eq 124 ] && echo "    $label stopped: no finish within ${ATTEMPT_LIMIT}s (ATTEMPT_LIMIT)" >&2
    echo "    $label attempt $n/$ATTEMPTS failed — retrying" >&2
    n=$((n + 1))
    sleep 3
  done
  return 1
}

echo "backing up $DBNAME (server $SERVER_FULL, schema $SCHEMA_V, role $RUNTIME_ROLE)"
echo "  client pg_dump $CLIENT_MAJOR from $PGBIN"

# ── artifact 1: cluster roles ───────────────────────────────────────────────
echo "[1/2] roles (pg_dumpall --roles-only)"
attempt "roles dump" "$DUMPALL" -d "$PG_URL_NOPASS" --roles-only -f "$STAGE/roles-$TS.sql" \
  || fail "roles dump did not complete after $ATTEMPTS attempts"
[ -s "$STAGE/roles-$TS.sql" ] || fail "roles file is empty"
grep -q "CREATE ROLE" "$STAGE/roles-$TS.sql" || fail "roles file contains no CREATE ROLE"
grep -qE "CREATE ROLE $RUNTIME_ROLE([^a-zA-Z0-9_]|$)" "$STAGE/roles-$TS.sql" \
  || fail "roles file does not contain the runtime role $RUNTIME_ROLE — a restore would lose every RLS policy"

# ── artifact 2: the database ────────────────────────────────────────────────
echo "[2/2] database (pg_dump -Fc)"
attempt "database dump" "$DUMP" -Fc -d "$PG_URL_NOPASS" -f "$STAGE/nomi-$TS.dump" \
  || fail "database dump did not complete after $ATTEMPTS attempts"
[ -s "$STAGE/nomi-$TS.dump" ] || fail "dump file is empty"
"$RESTORE" -l "$STAGE/nomi-$TS.dump" > "$STAGE/.toc" 2> >(redact >&2) \
  || fail "dump has no readable table of contents — it is not a valid archive"
grep -q "businesses" "$STAGE/.toc" || fail "dump TOC does not mention the businesses table"
rm -f "$STAGE/.toc"

# ── manifest ────────────────────────────────────────────────────────────────
sha() { shasum -a 256 "$1" | awk '{print $1}'; }
{
  echo "Nomi logical backup"
  echo "taken_utc:       $TS"
  echo "database:        $DBNAME"
  echo "server_version:  $SERVER_FULL"
  echo "client_pg_dump:  $("$DUMP" --version | sed 's/^pg_dump (PostgreSQL) //')"
  echo "schema_version:  $SCHEMA_V"
  echo "runtime_role:    $RUNTIME_ROLE"
  echo
  echo "roles-$TS.sql    $(wc -c < "$STAGE/roles-$TS.sql" | tr -d ' ') bytes  sha256=$(sha "$STAGE/roles-$TS.sql")"
  echo "nomi-$TS.dump    $(wc -c < "$STAGE/nomi-$TS.dump" | tr -d ' ') bytes  sha256=$(sha "$STAGE/nomi-$TS.dump")"
  echo
  echo "RESTORE ROLES FIRST. See docs/BACKUP-RESTORE.md. Restoring the .dump"
  echo "without roles-$TS.sql yields RLS enabled with zero policies: the data"
  echo "returns, the isolation does not, and nothing reports an error."
  if [ "$RUNTIME_ROLE" = "yiwuflow_app" ]; then
    echo
    echo "PRE-0026 PAIR. This roles file creates yiwuflow_app. Restoring it for a"
    echo "build that expects nomi_app needs the rename step in BACKUP-RESTORE.md."
  fi
} > "$STAGE/MANIFEST.txt"

# ── publish atomically ──────────────────────────────────────────────────────
mkdir -p "$DEST" || fail "cannot create $DEST"
[ -e "$FINAL" ] && fail "$FINAL already exists"
mv "$STAGE" "$FINAL" || fail "could not move backup into $DEST"
STAGE=""
chmod 700 "$FINAL"
chmod 600 "$FINAL"/*

echo
echo "OK — both artifacts written as one unit:"
echo "  $FINAL"
ls -lh "$FINAL" | tail -n +2 | awk '{printf "    %-28s %s\n", $9, $5}'
echo
echo "This is tenant data. It does not belong in the repository."

# ── offsite: encrypt, then upload ───────────────────────────────────────────
# Both steps are optional and independent, but an unencrypted upload is refused:
# the roles file carries SCRAM verifiers and the dump carries buyer
# conversations, so plaintext in object storage would be worse than no offsite
# copy at all — it would be a copy you had to trust the bucket ACL to protect.
if [ -n "${RAILWAY_BUCKET:-}" ] && [ -z "${AGE_RECIPIENT:-}" ]; then
  echo
  echo "REFUSING to upload: RAILWAY_BUCKET is set but AGE_RECIPIENT is not." >&2
  echo "Set AGE_RECIPIENT to the age public key, or unset RAILWAY_BUCKET." >&2
  exit 1
fi

if [ -n "${AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || fail "age not installed (brew install age)"
  echo
  echo "encrypting for offsite copy (recipient ${AGE_RECIPIENT:0:16}…)"
  ENC="$FINAL/encrypted"
  mkdir -p "$ENC"
  for f in "$FINAL/roles-$TS.sql" "$FINAL/nomi-$TS.dump" "$FINAL/MANIFEST.txt"; do
    age -r "$AGE_RECIPIENT" -o "$ENC/$(basename "$f").age" "$f" || fail "age failed on $(basename "$f")"
  done
  chmod 600 "$ENC"/*
  echo "    $(ls "$ENC" | wc -l | tr -d ' ') encrypted artifacts"
fi

if [ -n "${RAILWAY_BUCKET:-}" ]; then
  command -v rclone >/dev/null || fail "rclone not installed (brew install rclone)"
  echo "uploading to Railway bucket $RAILWAY_BUCKET"
  # Credentials are read into the environment and never written to disk or
  # echoed; rclone is configured entirely through RCLONE_CONFIG_* env vars.
  CREDS_JSON="$(railway bucket credentials -b "$RAILWAY_BUCKET" --json 2>/dev/null)" \
    || fail "could not read bucket credentials"
  eval "$(printf '%s' "$CREDS_JSON" | python3 -c "
import json,sys,shlex
d=json.load(sys.stdin)
for k,v in {
  'RCLONE_CONFIG_BK_TYPE':'s3',
  'RCLONE_CONFIG_BK_PROVIDER':'Other',
  'RCLONE_CONFIG_BK_ACCESS_KEY_ID':d['accessKeyId'],
  'RCLONE_CONFIG_BK_SECRET_ACCESS_KEY':d['secretAccessKey'],
  'RCLONE_CONFIG_BK_ENDPOINT':d['endpoint'],
  'RCLONE_CONFIG_BK_REGION':d.get('region','auto'),
  'BK_NAME':d['bucketName'],
}.items():
    print(f'export {k}={shlex.quote(str(v))}')
")"
  rclone copy "$FINAL/encrypted" "BK:$BK_NAME/$NAME/" --s3-no-check-bucket 2> >(redact >&2) \
    || fail "upload failed — the local pair is intact at $FINAL"
  echo "    uploaded $NAME/ to $RAILWAY_BUCKET"
  rclone ls "BK:$BK_NAME/$NAME/" 2>/dev/null | awk '{printf "      %-40s %s bytes\n", $2, $1}'
fi
