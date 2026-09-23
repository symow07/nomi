import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * A DATABASE CREDENTIAL NEVER APPEARS IN A COMMAND LINE.
 *
 * Found 2026-09-23: `tools/backup.sh` ran `pg_dump -d "$MIGRATE_DATABASE_URL"`,
 * so the admin password sat in the process list for the length of every dump
 * — visible to any local user and to any `ps` a session runs. The script's
 * own output was redacted; argv is not something a script can redact.
 *
 * The rule, held here for every tool and skill script: a connection URL is
 * passed to a child process through the ENVIRONMENT (libpq reads PGPASSWORD,
 * the Node tools take the URL in-process), never as an argument. The URL a pg
 * tool is given has had its password removed by `tools/lib/pgenv.py`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const walk = (dir: string, ext: RegExp): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel, ext) : ext.test(f) ? [rel] : [];
  });

const URL_VARS = /\$\{?(MIGRATE_DATABASE_URL|DATABASE_URL|DATABASE_PUBLIC_URL)\b/;
const PG_TOOL = /(\$PSQL|\$DUMP|\$DUMPALL|\$RESTORE|\bpsql\b|\bpg_dump\b|\bpg_dumpall\b|\bpg_restore\b)/;
const URL_WITH_PASSWORD = /postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/;

describe('no connection URL as a command argument', () => {
  const shells = [...walk('tools', /\.sh$/), ...walk('.claude/skills', /\.sh$/)];
  expect(shells.length).toBeGreaterThan(1);

  for (const f of shells) {
    it(`${f}: a pg tool is never given a URL variable`, () => {
      const bad = read(f).split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !line.trim().startsWith('#'))
        .filter(({ line }) => PG_TOOL.test(line) && URL_VARS.test(line));
      expect(bad.map((b) => `${f}:${b.n}: ${b.line.trim()}`)).toEqual([]);
    });
  }

  const scripts = [...shells, ...walk('tools', /\.(mjs|js|py)$/)];
  for (const f of scripts) {
    it(`${f}: carries no literal credential`, () => {
      expect(read(f)).not.toMatch(URL_WITH_PASSWORD);
    });
  }

  for (const f of walk('tools', /\.mjs$/)) {
    it(`${f}: no child process is handed a database URL as an argument`, () => {
      const src = read(f);
      const bad: string[] = [];
      for (const m of src.matchAll(/\b(spawnSync|spawn|execFileSync|execFile|execSync|exec)\(/g)) {
        // the call's arguments, up to the options object or the closing paren
        const rest = src.slice(m.index!, m.index! + 600);
        const args = rest.slice(0, Math.max(rest.search(/\]\s*,\s*\{|\)\s*;|\)\.status|\)\)/), 0) || 600);
        if (/DATABASE_URL|postgres(ql)?:\/\//.test(args)) bad.push(args.split('\n')[0]!);
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('tools/lib/pgenv.py — the password leaves the URL and goes to the environment', () => {
  const run = (url: string) =>
    execFileSync('python3', [join(ROOT, 'tools/lib/pgenv.py'), 'X_URL'], { env: { ...process.env, X_URL: url }, encoding: 'utf8' });

  it('splits a Railway-shaped URL: PGPASSWORD decoded, PG_URL_NOPASS with everything else kept', () => {
    const out = run('postgresql://postgres:p%40ss%3Aw%2Frd@sakura.proxy.rlwy.net:50533/railway?sslmode=require');
    expect(out).toContain("export PGPASSWORD='p@ss:w/rd'");
    expect(out).toContain("PG_URL_NOPASS='postgresql://postgres@sakura.proxy.rlwy.net:50533/railway?sslmode=require'");
    expect(out).not.toMatch(/PG_URL_NOPASS=[^\n]*p%40ss/);
  });

  it("a password with a quote in it still comes out as one shell word", () => {
    const out = run("postgresql://u:it%27s@h/db");
    expect(out.split('\n')[0]).toBe(`export PGPASSWORD='it'"'"'s'`);
  });

  it('a local URL with no password gives an empty PGPASSWORD and the same URL', () => {
    const out = run('postgresql://postgres@127.0.0.1:55451/nomi');
    expect(out).toContain("export PGPASSWORD=''");
    expect(out).toContain("PG_URL_NOPASS='postgresql://postgres@127.0.0.1:55451/nomi'");
  });

  it('refuses anything that is not a postgres URL, and an unset variable, with exit 2', () => {
    for (const url of ['mysql://u:p@h/db', '']) {
      let code = 0;
      try { run(url); } catch (e) { code = (e as { status: number }).status; }
      expect(code, url).toBe(2);
    }
  });

  it('backup.sh uses it, and names the raw URL only to check it is set and to split it', () => {
    const src = read('tools/backup.sh');
    expect(src).toContain('eval "$(python3 "$(dirname "$0")/lib/pgenv.py" MIGRATE_DATABASE_URL)"');
    // The VALUE of the raw variable is read in exactly one place — the "is it
    // set" check. pgenv.py is handed its NAME, and reads it from its own
    // environment; nothing else in the script ever expands it.
    const uses = src.split('\n').filter((l) => !l.trim().startsWith('#') && /\$\{?MIGRATE_DATABASE_URL/.test(l));
    expect(uses.map((l) => l.trim())).toEqual(['if [ -z "${MIGRATE_DATABASE_URL:-}" ]; then']);
    expect(src.match(/-d "\$PG_URL_NOPASS"/g)?.length).toBe(3);
  });
});
