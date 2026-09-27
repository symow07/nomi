#!/usr/bin/env bash
# A stand-in for `pg_restore -l <archive>`, for tests/parity/backup-retention.test.ts
# only: a table of contents with the businesses table in it.
printf ';\n; Archive created by a stand-in\n;\n215; 1259 16385 TABLE public businesses postgres\n'
