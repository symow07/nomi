#!/usr/bin/env bash
# verify-restore.sh — prove a backup pair actually restores. An untested backup
# is a belief, not a backup.
#
#   bash tools/verify-restore.sh ~/nomi-backups/nomi-backup-<ts>
#
# Builds a THROWAWAY PostgreSQL cluster in a temp directory, restores the pair
# into it roles-first, and runs the four checks that were run against production
# on 2026-08-08 — so the numbers are directly comparable, not merely plausible.
#
#   a) schema version           max(version) from _migrations
#   b) RLS intact               every business_id table: RLS on AND >=1 policy
#   c) runtime role restored    can log in, not superuser, no BYPASSRLS
#   d) isolation actually DENIES as the runtime role, no tenant context:
#                               select count(*) from businesses  ==  0
#
# (d) IS THE ONE THAT MATTERS. It is what a roles-less restore silently breaks:
# the tables come back, the rows come back, the query returns them, and nothing
# anywhere reports an error. If (d) is not 0, the backup is not usable.
#
# Touches nothing outside its temp directory. Never connects to production, and
# never takes a URL — it cannot reach production even by accident.
set -uo pipefail

BK="${1:-}"
[ -n "$BK" ] && [ -d "$BK" ] || { echo "usage: verify-restore.sh <backup-dir>" >&2; exit 2; }

ROLES="$(ls "$BK"/roles-*.sql 2>/dev/null | head -1)"
DUMP="$(ls "$BK"/nomi-*.dump 2>/dev/null | head -1)"
[ -f "$ROLES" ] || { echo "no roles-*.sql in $BK — this is not a complete pair" >&2; exit 2; }
[ -f "$DUMP" ]  || { echo "no nomi-*.dump in $BK — this is not a complete pair" >&2; exit 2; }

find_pgbin() {
  local c
  for c in "${PGBIN:-}" /opt/homebrew/opt/postgresql@18/bin /usr/lib/postgresql/18/bin ""; do
    [ -n "$c" ] && [ -x "$c/initdb" ] && { echo "$c"; return; }
  done
  command -v initdb >/dev/null && dirname "$(command -v initdb)"
}
PGBIN="$(find_pgbin)"
[ -n "$PGBIN" ] || { echo "no PostgreSQL server binaries found (need initdb)" >&2; exit 2; }

# ── the restore target must be able to satisfy the dump's extensions ────────
# Production carries pgvector, so `products.embedding` is of type `vector`. A
# cluster WITHOUT pgvector cannot create that type, so the products table fails
# to restore — and every object depending on it follows, including the RLS
# policies on price_tiers, product_aliases and product_images. The result is
# tables with RLS enabled and ZERO policies: open, and silent. That is the same
# end state as a roles-less restore, reached by a different road.
#
# PostgreSQL 18 can load extensions from outside its own tree, so a Homebrew
# pgvector is used in place without touching any prefix.
PGMAJOR="$("$PGBIN/initdb" --version | grep -oE '[0-9]+' | head -1)"
PGV_SHARE="$(ls -d /opt/homebrew/Cellar/pgvector/*/share/postgresql@"$PGMAJOR" 2>/dev/null | head -1)"
PGV_LIB="$(ls -d /opt/homebrew/Cellar/pgvector/*/lib/postgresql@"$PGMAJOR" 2>/dev/null | head -1)"

# These are written into postgresql.conf rather than passed via `pg_ctl -o`:
# the literal `$system` / `$libdir` placeholders must reach the server intact,
# and a shell layer that eats them leaves a zero-length path component, which
# silently disables the BUILT-IN extensions too (pg_trgm, pgcrypto).

PORT="${PGPORT:-55460}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nomi-restore.XXXXXX")"
SOCK="$(mktemp -d /tmp/nrs.XXXX)"   # unix socket dir must be a SHORT path
DB=nomi_restored
PASS=0
FAILED=0

cleanup() {
  "$PGBIN/pg_ctl" -D "$WORK/pg" -s -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK" "$SOCK"
}
trap cleanup EXIT

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; FAILED=$((FAILED+1)); }

echo "restoring $(basename "$BK") into a throwaway cluster"
[ -f "$BK/MANIFEST.txt" ] && grep -E '^(schema_version|runtime_role|server_version):' "$BK/MANIFEST.txt" | sed 's/^/    /'

# ── throwaway cluster ───────────────────────────────────────────────────────
"$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust -E UTF8 >/dev/null 2>&1 \
  || { echo "initdb failed" >&2; exit 1; }
if [ -n "$PGV_SHARE" ] && [ -n "$PGV_LIB" ]; then
  {
    printf "extension_control_path = '\$system:%s'\n" "$PGV_SHARE"
    printf "dynamic_library_path = '\$libdir:%s'\n" "$PGV_LIB"
  } >> "$WORK/pg/postgresql.conf"
fi

"$PGBIN/pg_ctl" -D "$WORK/pg" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null 2>&1 \
  || { echo "could not start scratch cluster:" >&2; tail -20 "$WORK/pg.log" >&2; exit 1; }

HAS_VECTOR="$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -tAc \
  "select count(*) from pg_available_extensions where name='vector'" | tr -d ' ')"
if [ "$HAS_VECTOR" = "0" ]; then
  echo "  WARNING: this target has no pgvector. The dump's products.embedding is" >&2
  echo "  of type vector, so products and everything depending on it will fail to" >&2
  echo "  restore, leaving tables with RLS on and no policies. Install pgvector" >&2
  echo "  (brew install pgvector) before trusting this drill." >&2
else
  echo "    pgvector available on the restore target"
fi

q()     { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -tAc "$1" 2>/dev/null | tr -d ' '; }
# Multi-value queries return '|'-separated fields; q() strips spaces, so never
# use a space as the separator here.
qf()    { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -tAc "$1" 2>/dev/null | tr -d ' \n'; }
qrole() { "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U "$1" -d "$DB" -tAc "$2" 2>&1 | tr -d ' '; }

# ── 1. ROLES FIRST — the whole point of two artifacts ───────────────────────
echo "[1/3] roles"
"$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -f "$ROLES" >/dev/null 2>"$WORK/roles.err"
# "role postgres already exists" is expected and harmless.
if grep -qiE 'error' "$WORK/roles.err" && ! grep -qi 'already exists' "$WORK/roles.err"; then
  echo "roles restore reported errors:" >&2; sed 's/^/    /' "$WORK/roles.err" >&2; exit 1
fi

RUNTIME_ROLE="$("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -tAc \
  "select rolname from pg_roles where rolname in ('nomi_app','yiwuflow_app') order by rolname limit 1" | tr -d ' ')"
[ -n "$RUNTIME_ROLE" ] || { echo "no runtime role in the roles file" >&2; exit 1; }
echo "    runtime role restored: $RUNTIME_ROLE"

# ── 2. the database ─────────────────────────────────────────────────────────
echo "[2/3] database"
"$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres "$DB" || exit 1
"$PGBIN/pg_restore" -h "$SOCK" -p "$PORT" -U postgres -d "$DB" --no-owner "$DUMP" \
  > "$WORK/restore.log" 2>&1
# pg_restore exits non-zero on ignorable errors; the checks below are the real verdict.
RESTORE_ERRS="$({ grep -c '^pg_restore: error' "$WORK/restore.log" 2>/dev/null || true; } | head -1)"
echo "    pg_restore reported $RESTORE_ERRS error line(s)"

# ── 3. the four checks ──────────────────────────────────────────────────────
echo "[3/3] verification"

# (a) schema version — taken from the pair's own manifest, never a constant.
# Hardcoding it means every migration silently turns this check into a lie.
EXPECT_V="$(sed -n 's/^schema_version: *//p' "$BK/MANIFEST.txt" 2>/dev/null | tr -d ' ')"
V="$(q 'select max(version) from _migrations')"
if [ -z "$EXPECT_V" ]; then
  bad "(a) no schema_version in MANIFEST.txt — cannot verify (restored: ${V:-<none>})"
elif [ "$V" = "$EXPECT_V" ]; then
  ok "(a) schema version = $V (matches manifest)"
else
  bad "(a) schema version = ${V:-<none>}, manifest says $EXPECT_V"
fi

# (b) RLS on every business_id table, each with at least one policy
IFS='|' read -r TOTAL BID VIOL_OFF VIOL_NOPOL <<EOF
$(qf "with t as (
      select c.oid, c.relname, c.relrowsecurity as rls,
             (select count(*) from pg_policy p where p.polrelid=c.oid) as pol,
             exists(select 1 from information_schema.columns col
                     where col.table_schema='public' and col.table_name=c.relname
                       and col.column_name='business_id') as bid
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r')
    select count(*)||'|'||count(*) filter (where bid)||'|'||
           count(*) filter (where bid and not rls)||'|'||
           count(*) filter (where bid and rls and pol=0) from t")
EOF
# A table WITHOUT a business_id that has RLS on and no policy is deny-all by
# design (signup_invites, login_codes — reached only through security-definer
# functions, since 0055). Reported, never counted against the restore: the
# failure this check exists for is a TENANT table that came back open.
DENY_ALL="$(qf "select coalesce(string_agg(c.relname, ',' order by c.relname), '')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid=c.oid)
     and not exists (select 1 from information_schema.columns col
                      where col.table_schema='public' and col.table_name=c.relname and col.column_name='business_id')")"
[ -n "$DENY_ALL" ] && echo "      deny-all by design (no business_id, no policy): $DENY_ALL"
# The count was pinned at 40 when this was written (schema 25) and every
# migration since has added tables; the invariant is not the number but that
# EVERY business_id table came back with RLS on and at least one policy.
if [ -n "$BID" ] && [ "$BID" -gt 0 ] && [ "$VIOL_OFF" = "0" ] && [ "$VIOL_NOPOL" = "0" ]; then
  ok "(b) $BID business_id tables, all RLS-enabled with >=1 policy (of $TOTAL tables)"
else
  bad "(b) business_id tables=${BID:-?}, RLS-off=${VIOL_OFF:-?}, RLS-without-policy=${VIOL_NOPOL:-?}"
fi
POLICIES="$(q "select count(*) from pg_policy")"
echo "      total policies restored: $POLICIES"

# (c) the runtime role's attributes survived
IFS='|' read -r CANLOGIN SUPER BYPASS <<EOF
$(qf "select rolcanlogin||'|'||rolsuper||'|'||rolbypassrls from pg_roles where rolname='$RUNTIME_ROLE'")
EOF
if [ "$CANLOGIN" = "true" ] && [ "$SUPER" = "false" ] && [ "$BYPASS" = "false" ]; then
  ok "(c) $RUNTIME_ROLE: canlogin=true superuser=false bypassrls=false"
else
  bad "(c) $RUNTIME_ROLE: canlogin=$CANLOGIN superuser=$SUPER bypassrls=$BYPASS"
fi

# (d) THE DECISIVE ONE — isolation denies with no tenant context
N="$(qrole "$RUNTIME_ROLE" 'select count(*) from businesses')"
if [ "$N" = "0" ]; then
  ok "(d) as $RUNTIME_ROLE, no tenant context: businesses = 0 — isolation is LIVE"
else
  bad "(d) as $RUNTIME_ROLE, no tenant context: businesses = $N — EXPECTED 0."
  echo "      A non-zero count here means the policies did not restore. The data" >&2
  echo "      came back and the isolation did not. This backup is NOT usable." >&2
fi

# context: what a superuser sees, to show (d) is denial and not an empty database
ADMIN_N="$(q 'select count(*) from businesses')"
echo "      (as postgres, bypassing RLS: $ADMIN_N businesses — so (d)=0 is denial, not emptiness)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "RESTORE PROVEN — $PASS/4 checks passed against a throwaway cluster."
  exit 0
fi
echo "RESTORE NOT PROVEN — $FAILED check(s) failed." >&2
exit 1
