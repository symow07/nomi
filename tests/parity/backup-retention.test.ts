import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BACKUP RETENTION — dailies 60 days, manual pairs 180, one rule, run for real.
 *
 * The owner's decision (2026-09-27): manual backups are pruned after 180 days,
 * as the dailies are after 60. Until then a manual pair — at the bucket root,
 * and on the laptop — was kept with no end date, so a buyer erased from the
 * database lived on in it for ever.
 *
 * Nothing here reads a script for a pattern and calls that proof. The rule in
 * backup/retention.sh is run: its plan on listings written here, its bucket
 * prune over a folder standing in for the bucket (tests/parity/backup-fakes/
 * rclone.sh maps "BK:<path>" to that folder), step 5 of backup/run.sh lifted
 * out and run, and tools/backup.sh and tools/fetch-backup.sh run end to end
 * in a temporary HOME with stand-ins for pg, rclone, age and railway. Every
 * write goes under the system's temporary directory; the real ~/nomi-backups
 * and the real bucket are never touched, and no Railway command runs (the
 * stand-in refuses anything but `bucket credentials`, and HOME holds no
 * Railway login).
 *
 * The guards that KEEP a pair (the newest, the newest complete, a name with no
 * date, the database's clock) each come with a control in which the same pair
 * GOES once that reason is removed, so a rule that kept everything could not
 * pass; and the docs check is run against the old wording first.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const LIB = join(ROOT, 'backup/retention.sh');
const FAKES = join(ROOT, 'tests/parity/backup-fakes');
const DAY = 86_400;
const HOUR = 3_600;
/** A fixed "now" for the cases that pass their own clock: 2026-09-27T09:06:40Z. */
const NOW = 1_790_500_000;

const stamp = (epoch: number) =>
  new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
const pair = (epoch: number) => `nomi-backup-${stamp(epoch)}`;
const tsOf = (name: string) => name.slice('nomi-backup-'.length);
/** The three objects of a pair, as a bucket listing names them. */
const objects = (name: string) =>
  [`${name}/roles-${tsOf(name)}.sql.age`, `${name}/nomi-${tsOf(name)}.dump.age`, `${name}/MANIFEST.txt.age`];

let TMP = '';
let BIN = '';
let PGBIN = '';
let CLOCK = '';

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nomi-retention-'));
  BIN = join(TMP, 'bin');
  PGBIN = join(TMP, 'pgbin');
  CLOCK = join(TMP, 'clock');
  for (const d of [BIN, PGBIN, CLOCK]) mkdirSync(d);
  const install = (dir: string, name: string) => {
    const to = join(dir, name);
    writeFileSync(to, readFileSync(join(FAKES, `${name}.sh`)));
    chmodSync(to, 0o755);
  };
  for (const n of ['rclone', 'railway', 'age']) install(BIN, n);
  for (const n of ['psql', 'pg_dump', 'pg_dumpall', 'pg_restore']) install(PGBIN, n);
  install(CLOCK, 'date');
});

afterAll(() => {
  if (!TMP) return;
  spawnSync('chmod', ['-R', 'u+rwX', TMP]);        // a folder a case left at 600 must not outlive the run
  rmSync(TMP, { recursive: true, force: true });
});

type Ran = { status: number | null; out: string; err: string };
const ran = (r: ReturnType<typeof spawnSync>): Ran =>
  ({ status: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') });

/**
 * A bash with the stand-ins first on PATH and NOTHING else from the
 * developer's shell: no bucket, no age key, no database URL can leak in.
 */
const sh = (script: string, extra: Record<string, string> = {}): Ran =>
  ran(spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { PATH: `${BIN}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, HOME: TMP, LANG: 'C', RETENTION_LIB: LIB, ...extra },
  }));

const fresh = (label: string) => mkdtempSync(join(TMP, `${label}-`));

/** Every path under a folder, sorted — a snapshot to compare before and after. */
const tree = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split('\\').join('/')).sort();

/** A pair as the bucket holds it: its .age objects under <dir>/<name>/. */
const bucketPair = (dir: string, name: string, parts: readonly string[] = ['roles', 'dump', 'manifest']) => {
  const d = join(dir, name);
  const ts = tsOf(name);
  mkdirSync(d, { recursive: true });
  if (parts.includes('roles')) writeFileSync(join(d, `roles-${ts}.sql.age`), 'CREATE ROLE nomi_app;\n');
  if (parts.includes('dump')) writeFileSync(join(d, `nomi-${ts}.dump.age`), 'PGDMP\n');
  if (parts.includes('manifest')) writeFileSync(join(d, 'MANIFEST.txt.age'), `taken_utc:       ${ts}\nschema_version:  74\n`);
  return d;
};

/** A pair as the laptop holds it: plaintext, with its encrypted copies beside. */
const laptopPair = (dest: string, name: string) => {
  const d = join(dest, name);
  const ts = tsOf(name);
  mkdirSync(join(d, 'encrypted'), { recursive: true });
  writeFileSync(join(d, `roles-${ts}.sql`), 'CREATE ROLE nomi_app;\n');
  writeFileSync(join(d, `nomi-${ts}.dump`), 'PGDMP\n');
  writeFileSync(join(d, 'MANIFEST.txt'), `taken_utc:       ${ts}\n`);
  for (const f of [`roles-${ts}.sql.age`, `nomi-${ts}.dump.age`, 'MANIFEST.txt.age']) writeFileSync(join(d, 'encrypted', f), 'x');
  return d;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('the two limits, side by side, in one file', () => {
  const lib = read('backup/retention.sh');

  it('60 days for dailies and 180 for manual pairs, on neighbouring lines', () => {
    const lines = lib.split('\n');
    const daily = lines.findIndex((l) => /^BACKUP_KEEP_DAILY_DAYS=60\s/.test(l));
    const manual = lines.findIndex((l) => /^BACKUP_KEEP_MANUAL_DAYS=180\s/.test(l));
    expect(daily, 'BACKUP_KEEP_DAILY_DAYS=60').toBeGreaterThan(-1);
    expect(manual, 'the manual limit sits on the next line').toBe(daily + 1);
    expect(sh('. "$RETENTION_LIB" && echo "$BACKUP_KEEP_DAILY_DAYS $BACKUP_KEEP_MANUAL_DAYS"').out.trim()).toBe('60 180');
  });

  it('the job prunes daily/ with the first and the root with the second; the laptop tools use the second', () => {
    const run = read('backup/run.sh');
    expect(run).toContain('prune_bucket daily "BK:$BUCKET/daily/" "$BACKUP_KEEP_DAILY_DAYS" "$NOW" "$NAME"');
    expect(run).toContain('prune_bucket manual "BK:$BUCKET/" "$BACKUP_KEEP_MANUAL_DAYS" "$NOW"');
    expect(read('tools/backup.sh')).toContain('prune_local "$DEST" "$BACKUP_KEEP_MANUAL_DAYS"');
    expect(read('tools/fetch-backup.sh')).toContain('prune_local "$DEST" "$BACKUP_KEEP_MANUAL_DAYS" "$NOW" "$NEWEST"');
    // No second copy of a number anywhere a script decides with it.
    for (const f of ['backup/run.sh', 'tools/backup.sh', 'tools/fetch-backup.sh']) {
      expect(read(f), f).not.toMatch(/--min-age|RETENTION_DAYS:-\d|KEEP_(DAILY|MANUAL)_DAYS=\d/);
    }
  });
});

describe('a pair is dated by the UTC time in its name', () => {
  // Every awk on this machine: macOS's, and on Linux mawk — the container's.
  const AWKS = [...new Set(['awk', 'mawk', 'gawk', 'original-awk', 'nawk']
    .filter((a) => sh(`command -v ${a}`).status === 0))];

  const VALID = ['nomi-backup-20260927T090640Z', 'nomi-backup-20240229T235959Z', 'nomi-backup-20000101T000000Z',
    'nomi-backup-21000228T120000Z', 'nomi-backup-20261231T235959Z', 'nomi-backup-20270204T030000Z'];
  const INVALID = ['nomi-backup-20250229T000000Z', 'nomi-backup-21000229T000000Z', 'nomi-backup-20261301T000000Z',
    'nomi-backup-20260931T000000Z', 'nomi-backup-20260927T240000Z', 'nomi-backup-20260927T236000Z',
    'nomi-backup-2026927T090640Z', 'nomi-backup-20260927T090640', 'nomi-backup-20260927T090640Z.bak',
    'nomi-backup-19991231T235959Z', 'daily', 'pgbackrest', 'age-key.txt', ''];
  const utc = (name: string) => {
    const s = tsOf(name);
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15)) / 1000;
  };

  it('reads the same second JavaScript does — leap days, a century, the year end — with every awk here', () => {
    expect(AWKS.length).toBeGreaterThan(0);
    for (const awk of AWKS) {
      for (const n of VALID) {
        expect(sh('. "$RETENTION_LIB" && stamp_epoch "$N"', { N: n, AWK: awk }).out.trim(), `${awk}: ${n}`).toBe(String(utc(n)));
      }
      expect(stamp(Number(sh('. "$RETENTION_LIB" && stamp_epoch "$N"', { N: pair(NOW), AWK: awk }).out))).toBe(stamp(NOW));
    }
  });

  it('a name that is not a real UTC time has no date (-1), whatever it looks like', () => {
    for (const awk of AWKS) {
      for (const n of INVALID) {
        expect(sh('. "$RETENTION_LIB" && stamp_epoch "$N"', { N: n, AWK: awk }).out.trim(), `${awk}: '${n}'`).toBe('-1');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** The plan for a listing: pair → "prune" | "keep:<why>" | "undated"; "(loose)" → count. */
const plan = (listing: readonly string[], keep: number, opts: { now?: number; made?: string; awk?: string } = {}) => {
  const r = sh('. "$RETENTION_LIB" && printf "%s\\n" "$LISTING" | retention_plan "$NOW_S" "$KEEP" "$MADE"', {
    LISTING: listing.join('\n'), NOW_S: String(opts.now ?? NOW), KEEP: String(keep), MADE: opts.made ?? '', AWK: opts.awk ?? 'awk',
  });
  expect(r.status, r.err).toBe(0);
  const d: Record<string, string> = {};
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [verb = '', name = '', , why = ''] = line.split(' ');
    if (verb === 'loose') d['(loose)'] = name;
    else d[name] = verb === 'keep' ? `keep:${why}` : verb;
  }
  return d;
};

describe('the plan — which pairs go, and which never do', () => {
  it('older than 180 days goes: 181 days goes, 179 stays; exactly 180 stays, one second more goes', () => {
    const p181 = pair(NOW - 181 * DAY), p179 = pair(NOW - 179 * DAY);
    const p180 = pair(NOW - 180 * DAY), p180s = pair(NOW - 180 * DAY - 1), newest = pair(NOW - DAY);
    const d = plan([p181, p179, p180, p180s, newest].flatMap(objects), 180);
    expect(d).toEqual({ [p181]: 'prune', [p179]: 'keep:young', [p180]: 'keep:young', [p180s]: 'prune', [newest]: 'keep:newest' });
  });

  it('the same rule at 60 days for the dailies: 61 goes, 59 stays', () => {
    const p61 = pair(NOW - 61 * DAY), p59 = pair(NOW - 59 * DAY), today = pair(NOW - 6 * HOUR);
    expect(plan([p61, p59, today].flatMap(objects), 60, { made: today }))
      .toEqual({ [p61]: 'prune', [p59]: 'keep:young', [today]: 'keep:made' });
  });

  it('the NEWEST pair stays whatever its age — and goes once a newer one exists (the control)', () => {
    const p400 = pair(NOW - 400 * DAY), p300 = pair(NOW - 300 * DAY);
    expect(plan([p400, p300].flatMap(objects), 180)).toEqual({ [p400]: 'prune', [p300]: 'keep:newest' });
    const later = pair(NOW - 10 * DAY);
    expect(plan([p400, p300, later].flatMap(objects), 180)[p300]).toBe('prune');
  });

  it('when the newest is HALF a pair, the newest COMPLETE pair stays too — and goes once the newest is whole (control)', () => {
    const whole = pair(NOW - 250 * DAY), half = pair(NOW - 200 * DAY);
    const halfOnly = [`${half}/nomi-${tsOf(half)}.dump.age`];
    expect(plan([...objects(whole), ...halfOnly], 180)).toEqual({ [whole]: 'keep:complete', [half]: 'keep:newest' });
    expect(plan([...objects(whole), ...objects(half)], 180)).toEqual({ [whole]: 'prune', [half]: 'keep:newest' });
  });

  it('a name with no real date is never judged; a dated pair of the same age goes (control)', () => {
    const feb30 = 'nomi-backup-20250230T000000Z', feb28 = 'nomi-backup-20250228T000000Z';
    const d = plan([
      `${feb30}/nomi-x.dump.age`, `${feb30}/roles-x.sql.age`,
      ...objects(feb28),
      'nomi-backup-old/roles-x.sql.age',
      'pgbackrest/backup.info',
      'stray.txt',
      ...objects(pair(NOW - DAY)),
    ], 180);
    expect(d[feb30]).toBe('undated');
    expect(d['nomi-backup-old']).toBe('undated');
    expect(d['pgbackrest']).toBe('undated');
    expect(d['(loose)']).toBe('1');
    expect(d[feb28]).toBe('prune');
  });

  it('never the pair just made; a pair named in the future stays and is reported', () => {
    const made = pair(NOW - 400 * DAY);
    expect(plan([...objects(made), ...objects(pair(NOW - DAY))], 180, { made })[made]).toBe('keep:made');
    const soon = pair(NOW + 2 * DAY), later = pair(NOW + 5 * DAY);
    const d = plan([...objects(soon), ...objects(later), ...objects(pair(NOW - 300 * DAY))], 180);
    expect(d[soon]).toBe('keep:future');
    expect(d[later]).toBe('keep:newest');
  });

  it('gives the same plan with every awk on this machine', () => {
    const listing = [pair(NOW - 400 * DAY), pair(NOW - 179 * DAY), pair(NOW - 181 * DAY), pair(NOW - DAY)].flatMap(objects);
    const want = plan(listing, 180);
    for (const awk of ['mawk', 'gawk', 'original-awk'].filter((a) => sh(`command -v ${a}`).status === 0)) {
      expect(plan(listing, 180, { awk }), awk).toEqual(want);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** A bucket on disk: dailies under daily/, manual pairs at the root, and neighbours that are not ours. */
const bucketFixture = () => {
  const b = fresh('bucket');
  const daily = join(b, 'daily');
  const d = {
    d400: pair(NOW - 400 * DAY), d61: pair(NOW - 61 * DAY), d59: pair(NOW - 59 * DAY), today: pair(NOW - 6 * HOUR),
    m181: pair(NOW - 181 * DAY), m179: pair(NOW - 179 * DAY), m3: pair(NOW - 3 * DAY),
  };
  for (const n of [d.d400, d.d61, d.d59, d.today]) bucketPair(daily, n);
  for (const n of [d.m181, d.m179, d.m3]) bucketPair(b, n);
  bucketPair(b, 'nomi-backup-20250230T000000Z');                 // no real date
  mkdirSync(join(b, 'pgbackrest', 'archive', 'db'), { recursive: true });
  writeFileSync(join(b, 'pgbackrest', 'backup.info'), 'not ours');
  writeFileSync(join(b, 'pgbackrest', 'archive', 'db', '000000010000000000000001'), 'not ours');
  writeFileSync(join(b, 'stray.txt'), 'not ours');
  return { b, daily, ...d };
};

const pruneBucket = (args: string, extra: Record<string, string> = {}) =>
  sh(`. "$RETENTION_LIB" && prune_bucket ${args}; echo "rc=$? pruned=$RETENTION_PRUNED kept=$RETENTION_KEPT"`, extra);

describe('the bucket — prune_bucket over a folder standing in for it', () => {
  it('manual pairs at the root older than 180 days go WHOLE; daily/ is not touched by the manual rule', () => {
    const f = bucketFixture();
    const dailyBefore = tree(f.daily);
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: f.b, NOW_S: String(NOW) });
    expect(r.out, r.err).toContain('rc=0 pruned=1 kept=2');
    expect(r.out).toContain(`manual: pruned ${f.m181} — 181 d 0 h old`);
    expect(r.out).toContain('manual: 1 pruned, 2 kept');
    expect(existsSync(join(f.b, f.m181)), 'both halves and the manifest, as one').toBe(false);
    for (const n of [f.m179, f.m3]) expect(readdirSync(join(f.b, n)).sort(), n).toEqual(['MANIFEST.txt.age', `nomi-${tsOf(n)}.dump.age`, `roles-${tsOf(n)}.sql.age`]);
    expect(tree(f.daily), 'a 400-day daily is not the manual rule’s to judge').toEqual(dailyBefore);
    expect(existsSync(join(f.b, 'nomi-backup-20250230T000000Z', 'MANIFEST.txt.age'))).toBe(true);
    expect(existsSync(join(f.b, 'pgbackrest', 'archive', 'db', '000000010000000000000001'))).toBe(true);
    expect(existsSync(join(f.b, 'stray.txt'))).toBe(true);
    expect(r.out).toContain('left alone, no date in its name: nomi-backup-20250230T000000Z');
    expect(r.out, 'the log itself says daily/ is not the manual rule’s').toContain('manual: left alone, no date in its name: daily');
  });

  it('a pair whose objects sit one folder down (uploaded folder and all) is still seen, and goes whole', () => {
    const b = fresh('bucket');
    const nested = pair(NOW - 300 * DAY);
    mkdirSync(join(b, nested, 'encrypted'), { recursive: true });
    writeFileSync(join(b, nested, 'encrypted', `nomi-${tsOf(nested)}.dump.age`), 'x');
    bucketPair(b, pair(NOW - DAY));
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: b, NOW_S: String(NOW) });
    expect(r.out, r.err).toContain(`manual: pruned ${nested} — 300 d 0 h old (half a pair)`);
    expect(existsSync(join(b, nested))).toBe(false);
  });

  it('dailies still go at 60 days, by the same rule — never the one just uploaded', () => {
    const f = bucketFixture();
    const rootBefore = tree(f.b).filter((p) => !p.startsWith('daily'));
    const r = pruneBucket('daily "BK:$B/daily/" 60 "$NOW_S" "$MADE"', { B: f.b, NOW_S: String(NOW), MADE: f.today });
    expect(r.out, r.err).toContain('rc=0 pruned=2 kept=2');
    expect(readdirSync(f.daily).sort()).toEqual([f.d59, f.today].sort());
    expect(r.out).toContain(`daily: pruned ${f.d400} — 400 d 0 h old`);
    expect(r.out).toContain(`daily: pruned ${f.d61} — 61 d 0 h old`);
    expect(tree(f.b).filter((p) => !p.startsWith('daily')), 'the root is not the daily rule’s').toEqual(rootBefore);
  });

  it('the newest manual pair stays even at 300 days, and says so — until a newer one exists (control)', () => {
    const b = fresh('bucket');
    const p400 = pair(NOW - 400 * DAY), p300 = pair(NOW - 300 * DAY);
    bucketPair(b, p400); bucketPair(b, p300);
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: b, NOW_S: String(NOW) });
    expect(readdirSync(b)).toEqual([p300]);
    expect(r.out).toContain(`kept ${p300}, 300 d 0 h old, because it is the newest pair here`);
    bucketPair(b, pair(NOW - 5 * DAY));
    pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: b, NOW_S: String(NOW) });
    expect(readdirSync(b)).toEqual([pair(NOW - 5 * DAY)]);
  });

  it('half a pair goes whole, and is named as half', () => {
    const b = fresh('bucket');
    const half = pair(NOW - 200 * DAY);
    bucketPair(b, half, ['dump']);
    bucketPair(b, pair(NOW - DAY));
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: b, NOW_S: String(NOW) });
    expect(r.out).toContain(`manual: pruned ${half} — 200 d 0 h old (half a pair)`);
    expect(existsSync(join(b, half))).toBe(false);
  });

  it('--dry-run names what would go and deletes nothing', () => {
    const f = bucketFixture();
    const before = tree(f.b);
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S" "" --dry-run', { B: f.b, NOW_S: String(NOW) });
    expect(r.out, r.err).toContain(`manual: would prune ${f.m181} — 181 d 0 h old`);
    expect(r.out).toContain('rc=0 pruned=1 kept=2');
    expect(tree(f.b)).toEqual(before);
  });

  it('a listing that fails is not an empty bucket: nothing is deleted, and the call fails', () => {
    const f = bucketFixture();
    const before = tree(f.b);
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: f.b, NOW_S: String(NOW), FAKE_RCLONE_LIST_FAILS: '1' });
    expect(r.out).toContain('rc=1 pruned=0');
    expect(r.err).toContain('could not list');
    expect(tree(f.b)).toEqual(before);
  });

  it('a delete that fails is named, fails the call, and leaves the pair for the next run', () => {
    const f = bucketFixture();
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: f.b, NOW_S: String(NOW), FAKE_RCLONE_DELETE_FAILS: '1' });
    expect(r.out).toContain('rc=1 pruned=0');
    expect(r.err).toContain(`could NOT prune ${f.m181}`);
    expect(existsSync(join(f.b, f.m181, 'MANIFEST.txt.age'))).toBe(true);
  });

  it('an empty bucket is fine: nothing to prune', () => {
    const b = fresh('bucket');
    const r = pruneBucket('manual "BK:$B/" 180 "$NOW_S"', { B: b, NOW_S: String(NOW) });
    expect(r.out, r.err).toContain('rc=0 pruned=0 kept=0');
  });

  it('refuses a path that is not a directory of the bucket, a limit of 0, and a clock of 0 — deleting nothing', () => {
    const f = bucketFixture();
    const before = tree(f.b);
    for (const args of ['manual "BK:" 180 "$NOW_S"', 'manual "BK:$B" 180 "$NOW_S"', 'manual "$B/" 180 "$NOW_S"',
      'manual "BK:$B/" 0 "$NOW_S"', 'manual "BK:$B/" 180 0', 'manual "BK:$B/" 180 ""', 'manual "BK:$B/" -5 "$NOW_S"']) {
      const r = pruneBucket(args, { B: f.b, NOW_S: String(NOW) });
      expect(r.out, args).toContain('rc=1');
      expect(r.err, args).toMatch(/refusing/);
    }
    expect(tree(f.b)).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('backup/run.sh — step 5 and the ending, lifted out and run', () => {
  const run = read('backup/run.sh');
  const step5 = run.slice(run.indexOf('# ── 5 · prune'), run.indexOf('# ── 6 · record'));
  const ending = run.slice(run.indexOf('# The copy is safe and recorded'));

  const stepFive = (b: string, made: string, extra: Record<string, string> = {}) => sh([
    'set -uo pipefail',
    'RETENTION_OK=""; . "$RETENTION_LIB" && RETENTION_OK=1',
    '[ -n "${DROP_LIB:-}" ] && RETENTION_OK=""',
    'BUCKET="$B"; NAME="$MADE"',
    'CLOCK_OFFSET=$(( NOW_S - $(date -u +%s) ))',
    '[ -n "${NO_CLOCK:-}" ] && CLOCK_OFFSET=""',
    'eval "$STEP"',
    'echo "PROBLEM=[$PRUNE_PROBLEM]"',
    'echo "SUMMARY=[$PRUNE_SUMMARY]"',
  ].join('\n'), { B: b, MADE: made, NOW_S: String(NOW), STEP: step5, ...extra });

  it('is found where the tests expect it', () => {
    expect(step5).toContain('prune_bucket daily');
    expect(ending).toContain('ping ""');
  });

  it('prunes both kinds in one pass over a real-shaped bucket, and sums it up', () => {
    const f = bucketFixture();
    const r = stepFive(f.b, f.today);
    expect(r.out, r.err).toContain('PROBLEM=[]');
    expect(r.out).toContain('SUMMARY=[pruned 2 daily and 1 manual pair(s)]');
    expect(readdirSync(f.daily).sort()).toEqual([f.d59, f.today].sort());
    expect(existsSync(join(f.b, f.m181))).toBe(false);
    expect(existsSync(join(f.b, f.m179))).toBe(true);
  });

  it('names the problem, and deletes nothing, when the listing fails, the rule file is missing, or the clock is unknown', () => {
    for (const [extra, problem] of [
      [{ FAKE_RCLONE_LIST_FAILS: '1' }, 'PROBLEM=[the dailies and the manual pairs]'],
      [{ DROP_LIB: '1' }, 'PROBLEM=[backup/retention.sh is not beside run.sh in the image]'],
      [{ NO_CLOCK: '1' }, "PROBLEM=[could not read the database's clock to date the pairs by]"],
    ] as const) {
      const f = bucketFixture();
      const before = tree(f.b);
      const r = stepFive(f.b, f.today, extra);
      expect(r.out, JSON.stringify(extra)).toContain(problem);
      expect(tree(f.b), JSON.stringify(extra)).toEqual(before);
    }
  });

  const end = (problem: string) => sh([
    'set -uo pipefail',
    'ping() { echo "PING[$1][${2:-}]"; }',
    'fail() { echo "FAILED: $*"; ping /fail "$*"; exit 1; }',
    'NAME=nomi-backup-20260927T030000Z',
    'eval "$ENDING"',
  ].join('\n'), { ENDING: ending, PRUNE_PROBLEM: problem, PRUNE_SUMMARY: 'pruned 1 daily and 0 manual pair(s)' });

  it('a prune that did not finish fails the run — after the record, with the reason — and a clean one pings OK with the count', () => {
    const bad = end('the manual pairs');
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('FAILED: nomi-backup-20260927T030000Z is uploaded and recorded, but the prune did not finish: the manual pairs');
    expect(bad.out).toContain('PING[/fail]');
    const good = end('');
    expect(good.status).toBe(0);
    expect(good.out).toContain('PING[][pruned 1 daily and 0 manual pair(s)]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** A laptop: a temporary HOME with ~/nomi-backups and the age key in it. */
const laptop = () => {
  const home = fresh('home');
  const dest = join(home, 'nomi-backups');
  mkdirSync(dest);
  writeFileSync(join(dest, 'age-key.txt'), 'AGE-SECRET-KEY-TEST-ONLY\n');
  mkdirSync(join(home, 'tmp'));
  return { home, dest };
};

const runBackup = (home: string, extra: Record<string, string> = {}): Ran => ran(spawnSync('bash', [join(ROOT, 'tools/backup.sh')], {
  encoding: 'utf8',
  timeout: 90_000,
  env: {
    PATH: `${PGBIN}:${BIN}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C',
    PGBIN, MIGRATE_DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/nomi', ATTEMPTS: '1', ...extra,
  },
}));

const pairsIn = (dest: string) => readdirSync(dest).filter((n) => n.startsWith('nomi-backup-')).sort();

describe('the laptop — tools/backup.sh, end to end, in a temporary HOME', () => {
  it('at the end of a good run, pairs older than 180 days go; the new pair, undated folders, a link and the key stay', () => {
    const { home, dest } = laptop();
    const now = Math.floor(Date.now() / 1000);
    const old = pair(now - 181 * DAY), young = pair(now - 179 * DAY), half = pair(now - 400 * DAY);
    laptopPair(dest, old); laptopPair(dest, young);
    mkdirSync(join(dest, half, 'encrypted'), { recursive: true });
    writeFileSync(join(dest, half, 'encrypted', `nomi-${tsOf(half)}.dump.age`), 'x');
    mkdirSync(join(dest, 'nomi-backup-20250230T000000Z'));
    mkdirSync(join(dest, 'nomi-backup-old'));
    mkdirSync(join(dest, 'notes'));
    const elsewhere = join(home, 'elsewhere');
    laptopPair(elsewhere, pair(now - 300 * DAY));
    symlinkSync(join(elsewhere, pair(now - 300 * DAY)), join(dest, pair(now - 300 * DAY)));
    const before = new Set(pairsIn(dest));

    const r = runBackup(home);
    expect(r.status, r.err + r.out).toBe(0);
    const made = pairsIn(dest).filter((n) => !before.has(n));
    expect(made).toHaveLength(1);
    expect(readdirSync(join(dest, made[0]!)).sort()).toEqual(['MANIFEST.txt', `nomi-${tsOf(made[0]!)}.dump`, `roles-${tsOf(made[0]!)}.sql`]);

    expect(r.out).toContain(`pruning ${dest}: pairs older than 180 days go`);
    expect(r.out).toContain(`pruned ${old} — 181 d`);
    expect(r.out).toContain(`pruned ${half} — 400 d 0 h old (half a pair)`);
    expect(r.out).toContain(': 2 pruned,');
    expect(existsSync(join(dest, old))).toBe(false);
    expect(existsSync(join(dest, half))).toBe(false);
    for (const kept of [young, made[0]!, 'nomi-backup-20250230T000000Z', 'nomi-backup-old', 'notes', 'age-key.txt']) {
      expect(existsSync(join(dest, kept)), kept).toBe(true);
    }
    expect(lstatSync(join(dest, pair(now - 300 * DAY))).isSymbolicLink(), 'a link is never followed or removed').toBe(true);
    expect(tree(join(elsewhere, pair(now - 300 * DAY))).length).toBeGreaterThan(3);
    expect(readFileSync(join(dest, 'age-key.txt'), 'utf8')).toBe('AGE-SECRET-KEY-TEST-ONLY\n');
  }, 120_000);

  it('KEEP_ALL=1 keeps everything, and says so', () => {
    const { home, dest } = laptop();
    const old = pair(Math.floor(Date.now() / 1000) - 400 * DAY);
    laptopPair(dest, old);
    const r = runBackup(home, { KEEP_ALL: '1' });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`KEEP_ALL=1 — nothing pruned in ${dest}`);
    expect(existsSync(join(dest, old))).toBe(true);
  }, 120_000);

  it('dates by the DATABASE’s clock: a laptop 30 days ahead does not age a 200-day pair past 180 — at the true time it goes (control)', () => {
    const now = Math.floor(Date.now() / 1000);
    const p200 = pair(now - 200 * DAY);
    const ahead = laptop();
    laptopPair(ahead.dest, p200);
    const r = runBackup(ahead.home, { FAKE_DB_EPOCH: String(now - 30 * DAY) });
    expect(r.status, r.err).toBe(0);
    expect(existsSync(join(ahead.dest, p200)), 'by the database it is 170 days old').toBe(true);
    const right = laptop();
    laptopPair(right.dest, p200);
    expect(runBackup(right.home).status).toBe(0);
    expect(existsSync(join(right.dest, p200))).toBe(false);
  }, 120_000);

  it('a run that fails prunes nothing', () => {
    const { home, dest } = laptop();
    const old = pair(Math.floor(Date.now() / 1000) - 400 * DAY);
    laptopPair(dest, old);
    const r = runBackup(home, { FAKE_DUMP_FAILS: '1' });
    expect(r.status).toBe(1);
    expect(r.err).toContain('FAILED');
    expect(r.out).not.toContain('pruning');
    expect(existsSync(join(dest, old))).toBe(true);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────

const runFetch = (home: string, bucket: string, extra: Record<string, string> = {}): Ran => {
  const env = {
    PATH: `${CLOCK}:${BIN}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, HOME: home, LANG: 'C',
    FAKE_BUCKET: bucket, FAKE_RAILWAY_LOG: join(home, 'railway.log'), ...extra,
  };
  // The Railway CLI this script calls is the stand-in, or nothing runs at all.
  const which = ran(spawnSync('bash', ['-c', 'command -v railway'], { encoding: 'utf8', env }));
  expect(which.out.trim()).toBe(join(BIN, 'railway'));
  return ran(spawnSync('bash', [join(ROOT, 'tools/fetch-backup.sh')], { encoding: 'utf8', timeout: 90_000, env }));
};

/** A bucket whose newest daily was taken five hours ago, with the laptop's folder beside it. */
const drill = () => {
  const { home, dest } = laptop();
  const bucket = fresh('bucket');
  const now = Math.floor(Date.now() / 1000);
  const newest = pair(now - 5 * HOUR);
  bucketPair(join(bucket, 'daily'), pair(now - 29 * HOUR));
  bucketPair(join(bucket, 'daily'), newest);
  return { home, dest, bucket, now, newest };
};

describe('the laptop — tools/fetch-backup.sh, end to end, in a temporary HOME', () => {
  it('fetches the newest daily, then prunes pairs older than 180 days — even one the old fetch left unreadable', () => {
    const { home, dest, bucket, now, newest } = drill();
    const old = pair(now - 181 * DAY), young = pair(now - 179 * DAY), locked = pair(now - 250 * DAY);
    laptopPair(dest, old); laptopPair(dest, young); laptopPair(dest, locked);
    chmodSync(join(dest, locked, 'encrypted'), 0o600);    // what `chmod 600 "$OUT"/*` used to leave

    const r = runFetch(home, bucket);
    expect(r.status, r.err + r.out).toBe(0);
    expect(readdirSync(join(dest, newest)).sort()).toEqual(['MANIFEST.txt', 'encrypted', `nomi-${tsOf(newest)}.dump`, `roles-${tsOf(newest)}.sql`]);
    expect(readdirSync(join(dest, newest, 'encrypted')), 'encrypted/ is readable now').toHaveLength(3);
    expect(r.out).toContain(`pruned ${old} — 181 d`);
    expect(r.out).toContain(`pruned ${locked} — 250 d`);
    expect(existsSync(join(dest, old))).toBe(false);
    expect(existsSync(join(dest, locked))).toBe(false);
    for (const kept of [young, newest, 'age-key.txt']) expect(existsSync(join(dest, kept)), kept).toBe(true);
    expect(r.out.trimEnd().split('\n').pop(), 'the next step stays the last line').toContain('verify-restore.sh');
    expect(readFileSync(join(home, 'railway.log'), 'utf8')).toBe('bucket credentials -b nomi-backups --json\n');
  }, 120_000);

  it('trusts this machine’s clock only near the fetched pair’s own time: ahead or behind, nothing goes', () => {
    for (const [offset, says] of [[10 * DAY, 'over three days old'], [-DAY, 'earlier than']] as const) {
      const { home, dest, bucket, now } = drill();
      const old = pair(now - 400 * DAY);
      laptopPair(dest, old);
      const r = runFetch(home, bucket, { FAKE_NOW: String(now + offset) });
      expect(r.status, r.err).toBe(0);
      expect(r.err, String(offset)).toContain(says);
      expect(existsSync(join(dest, old)), String(offset)).toBe(true);
    }
  }, 120_000);

  it('KEEP_ALL=1 keeps everything', () => {
    const { home, dest, bucket, now } = drill();
    const old = pair(now - 400 * DAY);
    laptopPair(dest, old);
    const r = runFetch(home, bucket, { KEEP_ALL: '1' });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`KEEP_ALL=1 — nothing pruned in ${dest}`);
    expect(existsSync(join(dest, old))).toBe(true);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the docs say what the code does', () => {
  /** What "kept with no end date" looked like, in the words these files used. */
  const FOREVER = [/manual pairs[^.]*never (touched|pruned)/i, /kept (forever|indefinitely)/i, /Do not prune them/i, /never touched\)/i];
  const OLD = [
    '5. **Prune** dailies older than `RETENTION_DAYS` (60). Manual pairs at the\n   bucket root are never touched.',
    '5. prunes dailies older than 60 days (manual pairs at the bucket root are\n   never touched);',
    'recover the state before the rename. Do not prune them because they look stale.',
    '#   5. prune  dailies older than RETENTION_DAYS (the laptop\'s manual pairs at the\n#             bucket root are never touched)',
  ];
  const FILES = ['docs/BACKUP-RESTORE.md', 'backup/README.md', 'backup/run.sh', 'tools/backup.sh', 'tools/fetch-backup.sh',
    'docs/DATA-DELETION-RUNBOOK.md', 'docs/FACTORY-PROVISIONING.md'];

  it('the patterns catch the old wording (the negative control)', () => {
    for (const old of OLD) expect(FOREVER.some((re) => re.test(old)), old).toBe(true);
  });

  it('no file still says a manual pair is kept with no end date', () => {
    for (const f of FILES) for (const re of FOREVER) expect(read(f), `${f} ${re}`).not.toMatch(re);
  });

  it('the retention docs and the erasure tool name both numbers', () => {
    for (const f of ['docs/BACKUP-RESTORE.md', 'backup/README.md', 'docs/DATA-DELETION-RUNBOOK.md']) {
      expect(read(f), f).toContain('60 days');
      expect(read(f), f).toContain('180 days');
    }
    expect(read('tools/erase-buyer.mjs')).toMatch(/dailies after 60 days, manual pairs after 180/);
    expect(read('docs/BACKUP-RESTORE.md')).toMatch(/only when one of these tools runs/i);
  });
});
