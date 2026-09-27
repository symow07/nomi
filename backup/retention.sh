# backup/retention.sh — how long each backup copy is kept, and the one rule
# that prunes them. SOURCED, never run: by backup/run.sh in the container
# (step 5), and by tools/backup.sh and tools/fetch-backup.sh on the laptop.
#
# THE TWO LIMITS, side by side. In days; a pair goes once it is OLDER than its
# limit — more than N × 24 hours after the time in its name.
BACKUP_KEEP_DAILY_DAYS=60      # daily/<name>/ in the bucket: one a day, made by backup/run.sh
BACKUP_KEEP_MANUAL_DAYS=180    # <name>/ at the bucket root: made by hand with tools/backup.sh;
                               # and every pair on the laptop, whichever tool wrote it
#
# THE RULE, the same for both. A pair is dated by the UTC time in its name,
# nomi-backup-YYYYMMDDTHHMMSSZ — the moment its dump was taken. Not by upload
# time or file time: the name is the one date that travels with the pair to
# the bucket, to the laptop and back, and that a copy or a re-upload cannot
# move. "Now" comes from the caller, from the most trustworthy clock it has
# (run.sh and backup.sh ask the database for it).
#
# WHAT IT NEVER PRUNES
#   · anything whose name is not a pair name with a real date in it. Whatever
#     else lives beside the pairs (the age key, another tool's files, a folder
#     moved aside to be kept) is not this rule's to judge;
#   · the pair the caller has just made or fetched;
#   · the newest pair, and the newest COMPLETE pair (roles and dump both
#     present), whatever their age — so at least one copy of each kind always
#     survives, and a half-finished upload can never be why the last good
#     copy went;
#   · a pair named more than an hour ahead of now: a clock was wrong when it
#     was named, and nothing is deleted on a wrong clock's word.
#
# Both halves of a pair go together: the unit of pruning is the pair's
# directory, never a file inside it. Every pair pruned is named in the log
# with its age, and every call ends with the count.

BACKUP_PAIR_GLOB='nomi-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'

# The dating, in awk: the same on the container's mawk, macOS's awk and gawk,
# with no `date` flags (GNU and BSD disagree) and no time zone anywhere — the
# name is UTC and so is the arithmetic.
_RETENTION_AWK_DATES='
function civil_days(y, m, d,    era, yoe, doy, doe) {
  # days from 1970-01-01 to y-m-d (H. Hinnant, days_from_civil), for y > 0
  y -= (m <= 2)
  era = int(y / 400)
  yoe = y - era * 400
  doy = int((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  return era * 146097 + doe - 719468
}
function stamp_seconds(name,    s, y, mo, d, h, mi, se, dim) {
  # the UTC second a pair name stands for, or -1 when it is not a real time
  if (name !~ /^nomi-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z$/) return -1
  s = substr(name, 13)
  y = substr(s, 1, 4) + 0; mo = substr(s, 5, 2) + 0; d = substr(s, 7, 2) + 0
  h = substr(s, 10, 2) + 0; mi = substr(s, 12, 2) + 0; se = substr(s, 14, 2) + 0
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return -1
  if (mo == 2) dim = ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0) ? 29 : 28
  else if (mo == 4 || mo == 6 || mo == 9 || mo == 11) dim = 30
  else dim = 31
  if (d > dim) return -1
  return civil_days(y, mo, d) * 86400 + h * 3600 + mi * 60 + se
}
'

# The plan. Reads a listing — one line per object or folder, relative to the
# folder the pairs sit in: "<pair>/", "<pair>/<file>", "<pair>/<sub>/<file>" —
# and prints one decision per top-level name:
#   prune <pair> <age-seconds> pair|partial
#   keep <pair> <age-seconds> made|newest|complete|future|young
#   undated <name>
#   loose <count>          objects that sit in no folder at all
# A pair is complete when a roles-*.sql and a nomi-*.dump (either may end in
# .age) are somewhere in it. It deletes nothing.
_RETENTION_AWK_PLAN='
{
  sub(/\r$/, "")
  if ($0 == "") next
  slash = index($0, "/")
  if (slash <= 1) { loose++; next }
  top = substr($0, 1, slash - 1)
  file = substr($0, slash + 1)
  sub(/.*\//, "", file)
  if (!(top in seen)) { seen[top] = 1; names[++n] = top }
  if (file ~ /^roles-.*\.sql(\.age)?$/) roles[top] = 1
  if (file ~ /^nomi-.*\.dump(\.age)?$/) dumps[top] = 1
}
END {
  newest = ""; complete = ""
  for (i = 1; i <= n; i++) {
    t = names[i]; at[t] = stamp_seconds(t)
    if (at[t] < 0) continue
    if (newest == "" || t > newest) newest = t
    if ((t in roles) && (t in dumps) && (complete == "" || t > complete)) complete = t
  }
  for (i = 1; i <= n; i++) {
    t = names[i]
    if (at[t] < 0) { print "undated", t; continue }
    age = now - at[t]
    if (t == made)                    why = "made"
    else if (t == newest)             why = "newest"
    else if (t == complete)           why = "complete"
    else if (age < -3600)             why = "future"
    else if (age > keep_days * 86400) why = "prune"
    else                              why = "young"
    if (why == "prune") printf "prune %s %d %s\n", t, age, ((t in roles) && (t in dumps)) ? "pair" : "partial"
    else                printf "keep %s %d %s\n", t, age, why
  }
  if (loose > 0) printf "loose %d\n", loose
}
'

# retention_plan <now-epoch> <keep-days> [<just-made>]  < listing
retention_plan() {
  local out
  out="$(LC_ALL=C "${AWK:-awk}" -v now="$1" -v keep_days="$2" -v made="${3:-}" \
    "$_RETENTION_AWK_DATES$_RETENTION_AWK_PLAN")" || return 1
  printf '%s\n' "$out" | LC_ALL=C sort -k2,2
}

# stamp_epoch <pair-name> — the UTC epoch second its name stands for, or -1.
stamp_epoch() {
  LC_ALL=C "${AWK:-awk}" -v name="$1" "$_RETENTION_AWK_DATES"'BEGIN { printf "%d\n", stamp_seconds(name) }'
}

# The name is checked again, in the shell, at the moment of deleting: a plan
# line is never trusted to be a pair name just because the plan said so.
retention_name_ok() {
  # shellcheck disable=SC2254
  case "$1" in $BACKUP_PAIR_GLOB) return 0 ;; *) return 1 ;; esac
}

# A limit is a whole number of days, at least one; "now" is an epoch second
# after 2017. Anything else is a caller's mistake, and prunes nothing.
retention_sane() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  case "$2" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$2" -gt 1500000000 ]
}

# "181 d 4 h" — an age in seconds, for the log.
retention_age() {
  local s="$1"
  if [ "$s" -lt 0 ]; then s=$(( -s )); fi
  printf '%d d %d h' $(( s / 86400 )) $(( s % 86400 / 3600 ))
}

# What the last prune_bucket / prune_local call did, for the caller's summary.
RETENTION_PRUNED=0
RETENTION_KEPT=0

# _retention_apply <label> <keep-days> <deleter> <just-made> <dry> < plan
# Carries the plan out through <deleter> (a function given the pair name),
# naming every pair it prunes, and ends with the count.
_retention_apply() {
  local label="$1" keep="$2" deleter="$3" made="$4" dry="$5"
  local verb name age why what problem=0 loose=0
  while read -r verb name age why; do
    case "$verb" in
      prune)
        if ! retention_name_ok "$name" || [ "$name" = "$made" ]; then
          echo "    $label: refusing to prune '$name'" >&2; problem=1; continue
        fi
        what="$name — $(retention_age "$age") old"
        [ "$why" = partial ] && what="$what (half a pair)"
        if [ "$dry" = "--dry-run" ]; then
          echo "    $label: would prune $what"
        elif "$deleter" "$name"; then
          echo "    $label: pruned $what"
        else
          echo "    $label: could NOT prune $name — it stays until the next run" >&2
          problem=1; continue
        fi
        RETENTION_PRUNED=$((RETENTION_PRUNED + 1)) ;;
      keep)
        RETENTION_KEPT=$((RETENTION_KEPT + 1))
        case "$why" in
          newest|complete)
            what="newest pair"; [ "$why" = complete ] && what="newest complete pair"
            if [ "$age" -gt $((keep * 86400)) ]; then
              echo "    $label: kept $name, $(retention_age "$age") old, because it is the $what here"
            fi ;;
          future)
            echo "    $label: kept $name — named $(retention_age "$age") ahead of now; the clock that named it was wrong" ;;
        esac ;;
      undated) echo "    $label: left alone, no date in its name: $name" ;;
      loose) loose="$name" ;;
    esac
  done
  if [ "$loose" != "0" ]; then echo "    $label: left alone, in no pair: $loose object(s)"; fi
  echo "    $label: $RETENTION_PRUNED pruned, $RETENTION_KEPT kept (a pair older than $keep days goes)"
  return "$problem"
}

# prune_bucket <label> <remote-dir> <keep-days> <now-epoch> [<just-made>] [--dry-run]
#
#   remote-dir  an rclone path ending in "/" whose sub-directories are the
#               pairs: BK:<bucket>/daily/ or BK:<bucket>/ — the remote "BK" is
#               the caller's, configured through RCLONE_CONFIG_BK_* variables.
#
# Returns non-zero when it could not list, or could not remove a pair it meant
# to. A listing that fails is never taken for an empty bucket.
prune_bucket() {
  local label="$1" remote="$2" keep="$3" now="$4" made="${5:-}" dry="${6:-}" listing plan
  RETENTION_PRUNED=0; RETENTION_KEPT=0
  case "$remote" in
    BK:?*/) ;;
    *) echo "    $label: refusing to prune '$remote' — not a directory of the bucket" >&2; return 1 ;;
  esac
  retention_sane "$keep" "$now" \
    || { echo "    $label: refusing to prune — limit '$keep' days, clock '$now'" >&2; return 1; }
  # Folders AND files, two levels: every pair folder shows up even when its
  # objects sit one level deeper (a copy uploaded folder and all), and what is
  # in it says whether it is whole.
  if ! listing="$(rclone -q lsf "$remote" -R --max-depth 2 </dev/null)"; then
    echo "    $label: could not list $remote — nothing pruned" >&2
    return 1
  fi
  plan="$(printf '%s\n' "$listing" | retention_plan "$now" "$keep" "$made")" \
    || { echo "    $label: could not plan the prune — nothing pruned" >&2; return 1; }
  _RETENTION_REMOTE="$remote"
  _retention_apply "$label" "$keep" _retention_delete_remote "$made" "$dry" <<EOF
$plan
EOF
}

_retention_delete_remote() {
  rclone -q delete "$_RETENTION_REMOTE$1/" </dev/null || return 1
  rclone -q rmdirs "$_RETENTION_REMOTE$1/" </dev/null 2>/dev/null || true
}

# prune_local <dir> <keep-days> <now-epoch> [<just-made>] [--dry-run]
#
# The laptop's folder (~/nomi-backups unless told otherwise): its
# nomi-backup-<UTC> directories are the pairs — the manual ones, and the
# dailies the monthly drill fetched. Only real directories directly inside
# <dir> are looked at; a symbolic link is never followed and never removed.
prune_local() {
  local dir="$1" keep="$2" now="$3" made="${4:-}" dry="${5:-}" label plan
  RETENTION_PRUNED=0; RETENTION_KEPT=0
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "    no folder '$dir' — nothing pruned"; return 0; fi
  label="${dir%/}"; label="${label##*/}"
  retention_sane "$keep" "$now" \
    || { echo "    $label: refusing to prune — limit '$keep' days, clock '$now'" >&2; return 1; }
  plan="$(_retention_list_local "$dir" | retention_plan "$now" "$keep" "$made")" \
    || { echo "    $label: could not plan the prune — nothing pruned" >&2; return 1; }
  _RETENTION_DIR="$dir"
  _retention_apply "$label" "$keep" _retention_delete_local "$made" "$dry" <<EOF
$plan
EOF
}

# A sub-folder this user cannot read (fetch-backup.sh used to leave encrypted/
# at mode 600) makes the listing of that pair short, never the plan fail. The
# plaintext halves sit at the top of a laptop pair, so such a pair still reads
# as complete; and the newest pair is kept whatever its listing says.
_retention_list_local() {
  local d n f
  for d in "$1"/nomi-backup-*; do
    [ -d "$d" ] && [ ! -L "$d" ] || continue
    n="${d##*/}"
    printf '%s/\n' "$n"
    { ( cd "$d" && find . -type f ) 2>/dev/null || true; } \
      | while IFS= read -r f; do printf '%s/%s\n' "$n" "${f#./}"; done
  done
  return 0
}

# The pair's own folders are made traversable first — a folder at mode 600
# cannot be emptied, even by its owner — then the whole pair goes.
_retention_delete_local() {
  local d="$_RETENTION_DIR/$1"
  [ -d "$d" ] && [ ! -L "$d" ] || return 1
  chmod -R u+rwX "$d" 2>/dev/null
  rm -rf -- "$d" </dev/null && [ ! -e "$d" ]
}
