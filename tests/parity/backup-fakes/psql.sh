#!/usr/bin/env bash
# A stand-in for psql, for tests/parity/backup-retention.test.ts only: it
# answers the questions tools/backup.sh asks as a PostgreSQL 18 server at
# schema 74 with the nomi_app role would, and nothing else. FAKE_DB_EPOCH,
# when set, is the database's clock.
q=""
for a in "$@"; do q="$a"; done
case "$q" in
  'show server_version') echo '18.6' ;;
  'select current_database()') echo 'nomi' ;;
  'select max(version) from _migrations') echo '74' ;;
  *pg_roles*) echo 'nomi_app' ;;
  *'extract(epoch from now())'*)
    if [ -n "${FAKE_DB_EPOCH:-}" ]; then echo "$FAKE_DB_EPOCH"; else date -u +%s; fi ;;
  *) echo "fake psql: not a question backup.sh asks: $q" >&2; exit 1 ;;
esac
