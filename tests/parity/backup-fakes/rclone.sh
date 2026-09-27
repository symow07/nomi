#!/usr/bin/env bash
# A stand-in for rclone, for tests/parity/backup-retention.test.ts only. The
# remote "BK:<absolute path>" is that folder on this disk. It answers what
# backup/retention.sh, backup/run.sh and tools/fetch-backup.sh ask, in the
# shape rclone answers it (lsf: paths relative to the listed folder, a folder
# with a trailing slash; checked against rclone 1.75 on a local remote,
# 2026-09-27), and refuses anything else.
#
#   FAKE_RCLONE_LIST_FAILS=1    lsf fails, as a dropped connection would
#   FAKE_RCLONE_DELETE_FAILS=1  delete fails
#   FAKE_RCLONE_LOG=<file>      every call is appended there
cmd=""; rec=""; depth=""; files=""; dirs=""; leave=""
paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    -R|--recursive) rec=1 ;;
    --max-depth) depth="$2"; shift ;;
    --files-only) files=1 ;;
    --dirs-only) dirs=1 ;;
    --leave-root) leave=1 ;;
    -q|--quiet|--s3-no-check-bucket) ;;
    -*) echo "fake rclone: unexpected flag $1" >&2; exit 9 ;;
    *) if [ -z "$cmd" ]; then cmd="$1"; else paths+=("$1"); fi ;;
  esac
  shift
done
[ -n "${FAKE_RCLONE_LOG:-}" ] && echo "$cmd ${paths[*]}" >> "$FAKE_RCLONE_LOG"

on_disk() {
  case "$1" in
    BK:/*) printf '%s' "${1#BK:}" ;;
    /*) printf '%s' "$1" ;;
    *) return 1 ;;
  esac
}
p0="$(on_disk "${paths[0]:-}")" || { echo "fake rclone: not a path it knows: '${paths[0]:-}'" >&2; exit 9; }

case "$cmd" in
  lsf)
    [ -n "${FAKE_RCLONE_LIST_FAILS:-}" ] && { echo "ERROR : fake: the listing failed" >&2; exit 1; }
    [ -d "$p0" ] || { echo "ERROR : error listing: directory not found" >&2; exit 3; }
    [ -n "$rec" ] || depth=1
    ( cd "$p0" && find . -mindepth 1 ${depth:+-maxdepth "$depth"} ) | sed 's#^\./##' | LC_ALL=C sort |
      while IFS= read -r e; do
        if [ -d "$p0/$e" ]; then [ -n "$files" ] || printf '%s/\n' "$e"
        else [ -n "$dirs" ] || printf '%s\n' "$e"; fi
      done ;;
  delete)
    [ -d "$p0" ] || { echo "ERROR : directory not found" >&2; exit 3; }
    [ -n "${FAKE_RCLONE_DELETE_FAILS:-}" ] && { echo "ERROR : fake: the delete failed" >&2; exit 1; }
    find "$p0" -type f -exec rm -f {} + ;;
  rmdirs)
    [ -d "$p0" ] || exit 0
    find "$p0" -mindepth 1 -depth -type d -empty -exec rmdir {} \; 2>/dev/null
    [ -n "$leave" ] || rmdir "$p0" 2>/dev/null
    exit 0 ;;
  copy)
    p1="$(on_disk "${paths[1]:-}")" || { echo "fake rclone: not a path it knows: '${paths[1]:-}'" >&2; exit 9; }
    [ -d "$p0" ] || exit 3
    mkdir -p "$p1" && cp -R "$p0"/. "$p1"/ ;;
  ls)
    [ -d "$p0" ] || exit 3
    ( cd "$p0" && find . -type f ) | sed 's#^\./##' | while IFS= read -r f; do
      printf '%9d %s\n' "$(wc -c < "$p0/$f" | tr -d ' ')" "$f"
    done ;;
  *) echo "fake rclone: '$cmd' is not something the backup scripts run" >&2; exit 9 ;;
esac
