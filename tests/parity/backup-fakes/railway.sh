#!/usr/bin/env bash
# A stand-in for the Railway CLI, for tests/parity/backup-retention.test.ts
# only. It answers `bucket credentials` with a "bucket" that is a folder on
# this disk (FAKE_BUCKET) and refuses everything else: no test reaches Railway.
[ -n "${FAKE_RAILWAY_LOG:-}" ] && echo "$*" >> "$FAKE_RAILWAY_LOG"
if [ "${1:-} ${2:-}" != "bucket credentials" ] || [ -z "${FAKE_BUCKET:-}" ]; then
  echo "fake railway: refusing '$*'" >&2
  exit 97
fi
printf '{"accessKeyId":"test-only","secretAccessKey":"test-only","endpoint":"http://127.0.0.1:9","region":"auto","bucketName":"%s"}\n' "$FAKE_BUCKET"
