#!/usr/bin/env bash
# fetch-backup.sh — pull the newest SCHEDULED backup from the bucket and decrypt
# it, so the monthly drill on the laptop is one command:
#
#   bash tools/fetch-backup.sh            # newest daily/ pair → ~/nomi-backups/<name>/
#   bash tools/verify-restore.sh ~/nomi-backups/<name>
#
# This is the one check the job cannot do for itself: that the ENCRYPTED copy
# in the bucket opens with the private key you hold. The key stays here
# (~/nomi-backups/age-key.txt), never on Railway. Credentials come from
# `railway bucket credentials` into rclone's environment — nothing on a
# command line, nothing on disk.
set -uo pipefail

BUCKET_NAME="${RAILWAY_BUCKET:-nomi-backups}"
DEST="${1:-$HOME/nomi-backups}"
KEY="${AGE_KEY:-$HOME/nomi-backups/age-key.txt}"
[ -f "$KEY" ] || { echo "age key not found at $KEY" >&2; exit 2; }
command -v rclone >/dev/null || { echo "rclone not installed (brew install rclone)" >&2; exit 2; }
command -v age >/dev/null || { echo "age not installed (brew install age)" >&2; exit 2; }

CREDS_JSON="$(railway bucket credentials -b "$BUCKET_NAME" --json 2>/dev/null)" || { echo "could not read bucket credentials" >&2; exit 1; }
eval "$(printf '%s' "$CREDS_JSON" | python3 -c "
import json,sys,shlex
d=json.load(sys.stdin)
for k,v in {
  'RCLONE_CONFIG_BK_TYPE':'s3','RCLONE_CONFIG_BK_PROVIDER':'Other',
  'RCLONE_CONFIG_BK_ACCESS_KEY_ID':d['accessKeyId'],'RCLONE_CONFIG_BK_SECRET_ACCESS_KEY':d['secretAccessKey'],
  'RCLONE_CONFIG_BK_ENDPOINT':d['endpoint'],'RCLONE_CONFIG_BK_REGION':d.get('region','auto'),'BK_NAME':d['bucketName'],
}.items(): print(f'export {k}={shlex.quote(str(v))}')")"

NEWEST="$(rclone lsf "BK:$BK_NAME/daily/" --dirs-only 2>/dev/null | sort | tail -1 | tr -d '/')"
[ -n "$NEWEST" ] || { echo "no daily/ backups in the bucket yet" >&2; exit 1; }
OUT="$DEST/$NEWEST"
mkdir -p "$OUT/encrypted"
echo "fetching daily/$NEWEST"
rclone copy "BK:$BK_NAME/daily/$NEWEST/" "$OUT/encrypted/" || { echo "download failed" >&2; exit 1; }
for f in "$OUT"/encrypted/*.age; do
  age -d -i "$KEY" -o "$OUT/$(basename "${f%.age}")" "$f" || { echo "decrypt failed on $(basename "$f")" >&2; exit 1; }
done
chmod 700 "$OUT"; chmod 600 "$OUT"/* 2>/dev/null
echo "decrypted into $OUT:"
ls -l "$OUT" | tail -n +2 | awk '{printf "    %-34s %s\n", $9, $5}'
grep -E '^(schema_version|taken_utc|restore_drill):' "$OUT/MANIFEST.txt" | sed 's/^/    /'
echo
echo "now:  bash tools/verify-restore.sh \"$OUT\""
