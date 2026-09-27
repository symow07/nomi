#!/usr/bin/env bash
# A stand-in for date, for tests/parity/backup-retention.test.ts only:
# `date -u +%s` answers FAKE_NOW when it is set, so a test can put this
# machine's clock anywhere. Every other use is the real date.
if [ -n "${FAKE_NOW:-}" ] && [ "$*" = "-u +%s" ]; then echo "$FAKE_NOW"; exit 0; fi
exec /bin/date "$@"
