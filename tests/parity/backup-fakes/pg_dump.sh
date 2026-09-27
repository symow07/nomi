#!/usr/bin/env bash
# A stand-in for pg_dump, for tests/parity/backup-retention.test.ts only.
# FAKE_DUMP_FAILS=1 loses the connection, as the public proxy does.
if [ "${1:-}" = "--version" ]; then echo 'pg_dump (PostgreSQL) 18.6'; exit 0; fi
if [ -n "${FAKE_DUMP_FAILS:-}" ]; then echo 'pg_dump: error: connection to server lost' >&2; exit 1; fi
out=""
while [ $# -gt 0 ]; do [ "$1" = "-f" ] && out="$2"; shift; done
printf 'PGDMP a stand-in archive\n' > "$out"
