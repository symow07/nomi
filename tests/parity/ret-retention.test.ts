import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { QUEUES, RETIRED_QUEUES, unscheduleRetired } from '../../src/queue/boss.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
// @ts-expect-error — the operator tools are plain JS on purpose (tools/ is not type-checked).
import { OPERATOR_FLAGS, RETIRED_FLAGS, setOperatorFlag } from '../../tools/lib/operator.mjs';

/**
 * RET (0116) IS RETIRED (0126, the owner's direction of 2026-10-04).
 *
 * "The retention model is NOT delete-after-90-days": a customer's data is
 * deleted when they ask, a workspace's when it closes. RET was built and never
 * switched on; it must now be impossible to run. Nothing schedules it, nothing
 * works it, its tool refuses, its switch cannot be set, its warning has no
 * words left to say. Over Postgres (the functions gone, the switch refused by
 * the database, a schedule written back taken out at boot):
 * tests/integration/ret-retention.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|mjs|js)$/.test(f) ? [rel] : [];
});

describe('RET · nothing can schedule or run it', () => {
  it('no queue of the running app is the retention job, and the boot takes its schedule out', () => {
    expect(Object.values(QUEUES)).not.toContain('ops.retention');
    expect(RETIRED_QUEUES.retention).toBe('ops.retention');
    const main = src('src/main.ts');
    expect(main).not.toMatch(/boss\.(schedule|work|send)\([^)]*retention/i);
    expect(main).toContain('await unscheduleRetired(boss);');
  });

  it('the boot\'s unschedule asks pg-boss to remove every retired schedule', async () => {
    const asked: string[] = [];
    await unscheduleRetired({ unschedule: async (name: string) => { asked.push(name); } });
    expect(asked).toEqual(['ops.retention']);
  });

  it('no source file reads what RET read, or sends its warning', () => {
    for (const f of walk('src')) {
      const s = src(f);
      expect(s, f).not.toMatch(/retention_workspaces|claim_retention_warnings|retention_warning|retentionWarnings/);
    }
    expect(walk('src')).not.toContain('src/pipeline/retention.ts');
  });

  it('0126 drops the functions, clears and forbids the switch, and removes the job\'s schedule', () => {
    const m = src('migrations/0126_erasure.sql');
    expect(m).toContain('drop function if exists claim_retention_warnings();');
    expect(m).toContain('drop function if exists retention_workspaces();');
    expect(m).toContain("update ops_flags set cleared_at = now() where flag = 'retention' and cleared_at is null;");
    expect(m).toContain("check (flag <> 'retention' or cleared_at is not null)");
    expect(m).toContain("delete from pgboss.schedule where name = 'ops.retention';");
    // 0116 itself is never edited (G20).
    expect(src('migrations/0116_retention.sql')).toContain("insert into _migrations (version, name) values (116, 'retention')");
  });
});

describe('RET · the operator cannot turn it on', () => {
  const env = { ...process.env, MIGRATE_DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none' };

  it('tools/retention.mjs refuses whatever it is asked, before any database', () => {
    for (const args of [[], ['--erase', '--by', 'me', '--yes']]) {
      const r = spawnSync(process.execPath, ['tools/retention.mjs', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/retired \(0126\): nothing is erased after 90 days/);
    }
  });

  it('tools/ops-flags.mjs refuses to set it, before any database', () => {
    const r = spawnSync(process.execPath, ['tools/ops-flags.mjs', '--set', 'retention', '--all', '--reason', 'x', '--by', 'me', '--yes'],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/retention is retired \(0126\)/);
  });

  it('the operator library knows it only as retired, and refuses it before any query', async () => {
    expect(OPERATOR_FLAGS).not.toContain('retention');
    expect(RETIRED_FLAGS).toEqual(['retention']);
    let queried = false;
    const c = { query: async () => { queried = true; return { rows: [], rowCount: 0 }; } };
    await expect(setOperatorFlag(c, { flag: 'retention', businessId: null, reason: 'x', by: 'me' })).rejects.toThrow(/retired/);
    expect(queried).toBe(false);
  });
});

describe('RET · no owner is told a workspace will be erased after 90 days', () => {
  for (const l of LOCALES) {
    it(`${l} · the warning and the operator's line are gone from the catalogue`, () => {
      const keys = Object.keys(messages[l]);
      expect(keys.filter((k) => k.startsWith('notify.retention'))).toEqual([]);
      expect(keys).not.toContain('notify.signup_digest.retention');
      expect(Object.values(messages[l]).filter((v) => /tools\/retention\.mjs/.test(String(v)))).toEqual([]);
    });
  }
});
