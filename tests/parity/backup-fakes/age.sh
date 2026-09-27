#!/usr/bin/env bash
# A stand-in for `age -d -i <key> -o <out> <in>`, for
# tests/parity/backup-retention.test.ts only: the "ciphertext" in the test
# bucket is the plaintext, so decrypting is a copy.
out=""; in=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -i|-r) shift ;;
    -d) ;;
    *) in="$1" ;;
  esac
  shift
done
cp "$in" "$out"
