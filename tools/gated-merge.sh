#!/bin/bash
# tools/gated-merge.sh <pr> <head sha> — THE way a pull request is merged into main. Never merge on github.com.
#
# It merges only when:
#   1. the pull request is BASED ON MAIN'S CURRENT HEAD (B, the owner, 2026-10-16). CI no longer runs on pushes to
#      main, so the tree a pull request's run tested must be the tree that lands. A PR main has moved past is refused,
#      loudly, with what to do. The repo is on GitHub Free, where a private repo has no branch protection to require
#      this; this script is the requirement, and every merge goes through it.
#   2. EVERY check run on that exact SHA completed with success — at least two, none failed or still running
#      (an empty or partial list is "not yet").
#
# A FAILED API CALL IS NEVER "0 CHECKS" (2026-10-16). #368's gate threw GitHub's errors away (2>/dev/null), read
# 55 minutes of GitHub not answering as "0 seen", and gave up with CI already green. Now the call's own error is
# printed, failures do not use up the polls, and it gives up only after 4 hours of failures or 150 answered polls.
#
# Exit: 0 merged · 1 a check failed, the merge was refused, or it never finished · 2 usage · 3 NOT BASED ON MAIN.
pr=$1; sha=$2
if [ -z "$pr" ] || ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then echo "usage: tools/gated-merge.sh <pr number> <full 40-character head sha>"; exit 2; fi
cd "$(dirname "$0")/.." || exit 2

# 1 · Based on main's current head? `behind_by` is how many commits main has that this head lacks.
based_on_main() {
  local out rc
  out=$(timeout 60 gh api "repos/{owner}/{repo}/compare/main...$sha" --jq '[.behind_by, .merge_base_commit.sha] | @tsv' 2>&1); rc=$?
  if [ $rc -ne 0 ] || ! [[ "$out" =~ ^[0-9]+$'\t'[0-9a-f]{40}$ ]]; then
    echo "$(date -u +%T) could not ask GitHub whether #$pr is based on main (rc=$rc): $(echo "$out" | tr '\n' ' ' | cut -c1-200)"
    return 2
  fi
  local behind base; read -r behind base <<<"$out"
  if [ "$behind" != "0" ]; then
    local head; head=$(timeout 60 gh api "repos/{owner}/{repo}/commits/main" --jq .sha 2>/dev/null)
    echo ""
    echo "  ✗ REFUSED — #$pr is NOT based on main's current head. Nothing was merged."
    echo "    main is at ${head:0:8}; this branch forks from ${base:0:8} and lacks $behind commit(s) main has."
    echo "    CI on this PR tested a tree that is not what would land. Rebase, push, and gate the new head:"
    echo "      git fetch origin main && git rebase origin/main && git push --force-with-lease"
    echo "      tools/gated-merge.sh $pr \$(git rev-parse HEAD)"
    echo ""
    return 3
  fi
  return 0
}
until based_on_main; do
  rc=$?
  [ $rc -eq 3 ] && exit 3
  sleep 60
done

# 2 · Every check on this exact SHA, completed and green.
answered=0; failing_since=""
while [ "$answered" -lt 150 ]; do
  out=$(timeout 60 gh api "repos/{owner}/{repo}/commits/$sha/check-runs" --jq \
    '[.check_runs | length, (map(select(.status=="completed" and .conclusion=="success")) | length), (map(select(.status=="completed" and .conclusion!="success")) | length)] | @tsv' 2>&1)
  rc=$?
  if [ $rc -ne 0 ] || ! [[ "$out" =~ ^[0-9]+$'\t'[0-9]+$'\t'[0-9]+$ ]]; then
    [ -z "$failing_since" ] && failing_since=$(date +%s)
    echo "$(date -u +%T) GitHub did not answer (rc=$rc): $(echo "$out" | tr '\n' ' ' | cut -c1-200)"
    if [ $(( $(date +%s) - failing_since )) -gt 14400 ]; then echo "GitHub has not answered for 4 hours — not merging"; exit 1; fi
    sleep 60; continue
  fi
  failing_since=""; answered=$((answered + 1))
  read -r seen ok bad <<<"$out"
  echo "$(date -u +%T) checks: $seen seen, $ok succeeded, $bad failed"
  if [ "$bad" != "0" ]; then echo "a check FAILED — not merging"; exit 1; fi
  if [ "$seen" -ge 2 ] && [ "$ok" = "$seen" ]; then
    # main may have moved while CI ran: ask again, right before merging.
    until based_on_main; do rc=$?; [ $rc -eq 3 ] && exit 3; sleep 60; done
    timeout 120 gh pr merge "$pr" --merge --delete-branch --match-head-commit "$sha" && exit 0
    echo "merge refused by GitHub"; exit 1
  fi
  sleep 30
done
echo "checks never finished (150 answered polls)"; exit 1
