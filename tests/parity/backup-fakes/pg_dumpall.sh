#!/usr/bin/env bash
# A stand-in for pg_dumpall --roles-only, for tests/parity/backup-retention.test.ts only.
out=""
while [ $# -gt 0 ]; do [ "$1" = "-f" ] && out="$2"; shift; done
printf 'CREATE ROLE postgres;\nCREATE ROLE nomi_app;\nALTER ROLE nomi_app WITH NOSUPERUSER LOGIN;\n' > "$out"
