import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * THE MIGRATOR'S MARK (2026-10-28) — a no-op run of the real tools/migrate.mjs against this database leaves its mark
 * on `_migrations`, naming Railway's commit and deployment; tools/migrate-mark.mjs proves it for that commit and for
 * no other. The comment is put back as it was afterwards.
 */
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHA = '0123456789abcdef0123456789abcdef01234567';
const DEPLOYMENT = '11111111-2222-4333-8444-555555555555';

const tool = (file: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    env: { PATH: process.env['PATH'] ?? '', MIGRATE_DATABASE_URL: MIGRATE_URL ?? '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('the pre-deploy step leaves proof it ran (requires MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let admin: pg.Client;
  let before: string | null = null;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    before = (await admin.query(`select obj_description('public._migrations'::regclass, 'pg_class') as c`)).rows[0]?.c ?? null;
  });
  afterAll(async () => {
    await admin.query(before === null ? 'comment on table public._migrations is null'
      : `comment on table public._migrations is ${admin.escapeLiteral(before)}`);
    await admin.end();
  });

  it('a run with nothing to apply says it started, marks the table with the deploy, and still says done', async () => {
    const r = tool('tools/migrate.mjs', [], { RAILWAY_GIT_COMMIT_SHA: SHA, RAILWAY_DEPLOYMENT_ID: DEPLOYMENT });
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n')[0]).toBe(`migrate: start · commit ${SHA} · deployment ${DEPLOYMENT}`);
    expect(r.out).toMatch(/done — \d+ migrations recorded/);
    const c = (await admin.query(`select obj_description('public._migrations'::regclass, 'pg_class') as c`)).rows[0]?.c as string;
    expect(c).toMatch(new RegExp(`^migrate ran \\S+ · commit ${SHA} · deployment ${DEPLOYMENT} · applied 0 · recorded \\d+$`));
    // the time is this run's
    const at = new Date(/^migrate ran (\S+)/.exec(c)![1]!);
    expect(Math.abs(Date.now() - at.getTime())).toBeLessThan(120_000);
  });

  it('the check proves that commit (short or full), refuses any other, and --status shows the last run', () => {
    expect(tool('tools/migrate-mark.mjs', ['--expect', SHA.slice(0, 8)]).code).toBe(0);
    expect(tool('tools/migrate-mark.mjs', ['--expect', SHA]).code).toBe(0);
    const other = tool('tools/migrate-mark.mjs', ['--expect', 'fedcba9876543210']);
    expect(other.code).toBe(4);
    expect(other.out).toContain('no proof the pre-deploy step ran for this deploy');
    expect(tool('tools/migrate.mjs', ['--status']).out).toContain(`last run: `);
  });

  it('a run with no Railway around (a laptop) marks itself local, which proves no deploy', async () => {
    expect(tool('tools/migrate.mjs', []).code).toBe(0);
    const c = (await admin.query(`select obj_description('public._migrations'::regclass, 'pg_class') as c`)).rows[0]?.c as string;
    expect(c).toContain('· commit local · deployment none ·');
    expect(tool('tools/migrate-mark.mjs', ['--expect', SHA]).code).toBe(4);
  });

  it('with no mark at all, the check says so and fails', async () => {
    await admin.query('comment on table public._migrations is null');
    const r = tool('tools/migrate-mark.mjs', ['--expect', SHA]);
    expect(r.code).toBe(4);
    expect(r.out).toContain('No migrator mark');
  });
});
