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
#
# PRUNES THE FOLDER IT WRITES TO, like tools/backup.sh: after a fetch that
# succeeded, pairs in <destination> older than 180 days are removed
# (backup/retention.sh) — never the pair just fetched, the newest pair, or a
# name with no date in it (the age key is safe). The dates are read with this
# machine's clock, so the prune first checks that clock against the time the
# newest daily was taken, and skips if they disagree. KEEP_ALL=1 keeps
# everything. This and tools/backup.sh are the only things that ever prune the
# laptop's copies: nothing does while neither runs.
set -uo pipefail

BUCKET_NAME="${RAILWAY_BUCKET:-nomi-backups}"
DEST="${1:-$HOME/nomi-backups}"
RETENTION_OK=""
if [ -r "$(dirname "$0")/../backup/retention.sh" ] && . "$(dirname "$0")/../backup/retention.sh"; then RETENTION_OK=1; fi
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
# Folders 700, files 600. (`chmod 600 "$OUT"/*` also caught encrypted/, and a
# folder at 600 cannot be opened or emptied, even by its owner.)
chmod 700 "$OUT" "$OUT/encrypted"; find "$OUT" -type f -exec chmod 600 {} + 2>/dev/null
echo "decrypted into $OUT:"
ls -l "$OUT" | tail -n +2 | awk '{printf "    %-34s %s\n", $9, $5}'
grep -E '^(schema_version|taken_utc|restore_drill):' "$OUT/MANIFEST.txt" | sed 's/^/    /'

# ── prune this folder ───────────────────────────────────────────────────────
# There is no database here to ask the time, so this machine's clock is used
# only if it agrees with the pair just fetched: a daily is taken every day, so
# it must be less than three days old — and not from the future.
echo
FETCHED_AT="$(stamp_epoch "$NEWEST" 2>/dev/null)"
NOW="$(date -u +%s)"
if [ -n "${KEEP_ALL:-}" ] && [ "$KEEP_ALL" != "0" ]; then
  echo "KEEP_ALL=$KEEP_ALL — nothing pruned in $DEST"
elif [ -z "$RETENTION_OK" ]; then
  echo "not pruning $DEST: backup/retention.sh was not found beside this script" >&2
else
  case "$FETCHED_AT" in ''|-*|*[!0-9]*) FETCHED_AT="" ;; esac
  if [ -z "$FETCHED_AT" ]; then
    echo "not pruning $DEST: $NEWEST has no date in its name to check this machine's clock against" >&2
  elif [ "$NOW" -lt $(( FETCHED_AT - 3600 )) ]; then
    echo "not pruning $DEST: this machine's clock says it is earlier than $NEWEST was taken — the clock is wrong" >&2
  elif [ "$NOW" -gt $(( FETCHED_AT + 3 * 86400 )) ]; then
    echo "not pruning $DEST: by this machine's clock the newest daily is over three days old —" >&2
    echo "  either the clock is ahead, or the daily backup has stopped (the owner's alert would say so)" >&2
  else
    echo "pruning $DEST: pairs older than $BACKUP_KEEP_MANUAL_DAYS days go (KEEP_ALL=1 keeps them)"
    prune_local "$DEST" "$BACKUP_KEEP_MANUAL_DAYS" "$NOW" "$NEWEST" \
      || echo "    the fetch above is complete; the prune did not finish and tries again next run" >&2
  fi
fi
echo
echo "now:  bash tools/verify-restore.sh \"$OUT\""
