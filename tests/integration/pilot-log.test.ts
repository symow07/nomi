import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * GATE A — tools/pilot-log.mjs, run for real against Postgres: the one writer of `pilot_log` (0012) and the order
 * the pilot's evenings are triaged in (docs/GATE-A-KIT.md §3). What is proved: an entry is written as given; the
 * triage puts blockers first, then the worst, then the most trust lost, then the oldest, and leaves out what is
 * fixed; a status moves; and every refusal the tool promises writes nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const PILOT = `91107000-0000-4000-8000-${RUN}0001`;
const OTHER = `91107000-0000-4000-8000-${RUN}0002`;

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[]): Run => {
  const r = spawnSync(process.execPath, ['tools/pilot-log.mjs', ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const add = (over: Record<string, string> = {}, extra: string[] = []): Run => tool(['add', ...Object.entries({
  business: PILOT, owner: '王老板', surface: 'approval card', kind: 'hesitated_before_approval',
  event: 'Looked at the card for twelve seconds before sending', severity: '2', trust: '-1', ...over,
}).flatMap(([k, v]) => [`--${k}`, v]), ...extra]);

d('Gate A · the pilot log is written, ordered and moved by one tool (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  const count = async (biz = PILOT) => Number((await admin.query('select count(*)::int as n from pilot_log where business_id = $1', [biz])).rows[0].n);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query('insert into businesses (id, name) values ($1, $2), ($3, $4) on conflict (id) do nothing',
      [PILOT, `Pilot ${RUN}`, OTHER, `Other ${RUN}`]);
  });
  // The run's tenants are pruned by the next integration run (tools/prune-test-tenants.mjs), as every test's are.
  afterAll(async () => { await admin.end(); });

  it('writes an entry exactly as given, the owner\'s words kept verbatim', async () => {
    const r = add({ quote: '这个英文我又看不懂发的对不对', expected: 'A translation', happened: 'English only', at: '2026-10-20T09:15:00+08:00' });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(/written as #\d+\./);
    const row = (await admin.query('select * from pilot_log where business_id = $1', [PILOT])).rows[0];
    expect(row).toMatchObject({ owner_label: '王老板', surface: 'approval card', kind: 'hesitated_before_approval', severity: 2,
      trust_impact: -1, owner_quote: '这个英文我又看不懂发的对不对', owner_expected: 'A translation', what_happened: 'English only',
      blocks_launch: false, status: 'new', linked_task: null });
    expect(new Date(row.at).toISOString()).toBe('2026-10-20T01:15:00.000Z');
  });

  it('triage: blockers first, then the worst, then the most trust lost, then the oldest — and what is fixed is left out', async () => {
    expect(add({ kind: 'positive_surprise', event: 'Showed his wife the night reply', severity: '1', trust: '2', at: '2026-10-20T08:00:00Z' }).code).toBe(0);
    expect(add({ kind: 'missed_important_notification', event: 'No alert for a hand-over', severity: '3', trust: '-2', at: '2026-10-21T08:00:00Z' }).code).toBe(0);
    expect(add({ kind: 'felt_too_technical', event: 'Asked what an allowlist is', severity: '1', trust: '0', at: '2026-10-19T08:00:00Z' },
      ['--blocker', '--fix', 'Say "numbers it may answer"']).code).toBe(0);
    const r = tool(['triage', '--business', PILOT]);
    expect(r.code, r.err).toBe(0);
    // The observations' block; the pilot's decisions follow it after a blank line (0154).
    const lines = r.out.trim().split('\n\n')[0]!.split('\n');
    expect(r.out).toContain('PILOT DECISIONS — none');
    expect(lines[0]).toBe('PILOT TRIAGE — 4 open / 4 total');
    expect(lines.slice(1).map((l) => /(\w+) @ /.exec(l)![1])).toEqual(
      ['felt_too_technical', 'missed_important_notification', 'hesitated_before_approval', 'positive_surprise']);
    expect(lines[1]).toMatch(/^\[BLOCKER\] S1 trust:\+0 felt_too_technical @ approval card — Asked what an allowlist is → Say "numbers it may answer"/);

    const id = /#(\d+) · new\]/.exec(lines[2]!)![1]!;
    const moved = tool(['set', '--id', id, '--status', 'fixed', '--task', '#330']);
    expect(moved.code, moved.err).toBe(0);
    expect((await admin.query('select status, linked_task from pilot_log where id = $1', [id])).rows[0]).toEqual({ status: 'fixed', linked_task: '#330' });
    expect(tool(['triage', '--business', PILOT]).out).toContain('PILOT TRIAGE — 3 open / 4 total');
    // Another workspace's log is its own.
    expect(tool(['triage', '--business', OTHER]).out).toContain('PILOT TRIAGE — 0 open / 0 total');
  });

  it('every refusal writes nothing', async () => {
    const before = await count();
    const refusals: [Run, number][] = [
      [add({ kind: 'was_annoyed' }), 2],
      [add({ severity: '4' }), 2],
      [add({ trust: '-3' }), 2],
      [add({ event: '' }), 2],
      [add({ owner: '' }), 2],
      [add({ at: 'next tuesday' }), 2],
      [add({ business: 'not-a-uuid' }), 2],
      [add({ business: `91107000-0000-4000-8000-${RUN}0009` }), 1],
      [tool(['set', '--id', '999999999', '--status', 'fixed']), 1],
      [tool(['set', '--id', '1', '--status', 'done']), 2],
      [tool(['wipe']), 2],
    ];
    for (const [r, code] of refusals) expect(r.code, `${r.out}${r.err}`).toBe(code);
    expect(await count()).toBe(before);
  });

  it('DECISIONS (0154): one made for the pilot is written with the day it ends, listed apart, and flagged once it has ended', async () => {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const r = tool(['decision', '--business', OTHER, '--what', 'Billing exempt for the pilot week; the send ceiling and the model limits unchanged',
      '--until', until, '--by', 'the operator']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toMatch(new RegExp(`decision written as #\\d+, until ${until}`));
    const row = (await admin.query("select kind, ends_on::text as ends_on, owner_label, surface from pilot_log where business_id = $1 and kind = 'pilot_decision'", [OTHER])).rows[0];
    expect(row).toEqual({ kind: 'pilot_decision', ends_on: until, owner_label: 'the operator', surface: 'operator' });

    // Listed apart from what the owner did: the observations' count is untouched.
    let out = tool(['triage', '--business', OTHER]).out;
    expect(out).toContain('PILOT TRIAGE — 0 open / 0 total');
    expect(out).toContain('PILOT DECISIONS — 1');
    expect(out).toContain(`[until ${until}] Billing exempt for the pilot week`);

    // Its day passes: the triage says to undo it.
    await admin.query("update pilot_log set ends_on = current_date - 1 where business_id = $1 and kind = 'pilot_decision'", [OTHER]);
    out = tool(['triage', '--business', OTHER]).out;
    expect(out).toMatch(/\[ENDED \d{4}-\d{2}-\d{2} — undo it\] Billing exempt/);
  });

  it('a decision needs its words, who made it, and a day still to come — or nothing is written', async () => {
    const before = await count(OTHER);
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const [args, code] of [
      [['--what', 'x', '--until', future, '--by', 'op'], 2],
      [['--what', 'Billing exempt', '--until', '2026-13-40', '--by', 'op'], 2],
      [['--what', 'Billing exempt', '--until', '2020-01-01', '--by', 'op'], 2],
      [['--what', 'Billing exempt', '--until', future], 2],
    ] as const) {
      const r = tool(['decision', '--business', OTHER, ...args]);
      expect(r.code, `${args.join(' ')}: ${r.out}${r.err}`).toBe(code);
    }
    expect(tool(['decision', '--business', `91107000-0000-4000-8000-${RUN}0009`, '--what', 'Billing exempt', '--until', future, '--by', 'op']).code).toBe(1);
    expect(await count(OTHER)).toBe(before);
  });

  it('names the nineteen kinds without a database', () => {
    const r = spawnSync(process.execPath, ['tools/pilot-log.mjs', 'kinds'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(19);
  });
});
