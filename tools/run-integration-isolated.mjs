#!/usr/bin/env node
/**
 * The integration suite on a Postgres of its OWN: made for this run, migrated
 * with THIS checkout's migrations, seeded, used, and removed.
 *
 * THE BUG THIS EXISTS FOR (2026-10-15). Local runs shared one long-lived
 * database (port 55451). #363's run migrated it to 0167; #364's branch, still
 * at 0166, then failed two tests against it — the boot guard's schema check
 * ("expected 167 to be 166") and the erasure tool's table list (`deploy_lag`
 * unknown). Neither was a defect in #364: two branches at different schema
 * versions had shared one database. It was the second cross-run interference
 * that week, and each one looks exactly like a real bug until someone spends
 * an hour proving it is not.
 *
 * CI NEVER HAD THIS PROBLEM. Its integration job gets a fresh Postgres service
 * container per job and migrates it with the branch's own code
 * (.github/workflows/ci.yml). Only the local runner shared a database. Do not
 * "fix" CI for it.
 *
 * WHAT IT DOES, in order: initdb into a new temporary directory, start it on a
 * free loopback port (socket under /tmp: macOS caps a socket path at 103
 * bytes), create `nomi`, run tools/migrate.mjs, give `nomi_app` a login (as CI
 * does), seed the demo and sandbox tenants (as CI does), then
 * tools/run-integration.mjs with the two URLs in its environment. Whatever
 * happens — pass, fail, Ctrl-C — the server is stopped and the directories this
 * run made are removed. About 20 seconds on top of the suite.
 *
 * Nothing else is touched: no shared cluster, no other port. Runs in parallel
 * worktrees no longer meet. The URLs go to child processes through the
 * environment only (tests/parity/no-secret-in-argv.test.ts).
 *
 * Run: node tools/run-integration-isolated.mjs [extra vitest args]
 * Needs initdb / pg_ctl / createdb / psql on PATH (Homebrew postgresql@16 here).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requirePinnedNode } from './lib/pinned-node.mjs';

requirePinnedNode('run-integration-isolated');

const say = (m) => console.log(`  · ${m}`);
const fail = (m) => { console.error(`\n  ✗ isolated integration: ${m}`); return 1; };

for (const bin of ['initdb', 'pg_ctl', 'createdb', 'psql']) {
  if (spawnSync('which', [bin], { encoding: 'utf8' }).status !== 0) {
    console.error(`  ✗ ${bin} is not on PATH — install Postgres (brew install postgresql@16)`);
    process.exit(2);
  }
}

/** A port nothing listens on right now, chosen by the system. */
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const data = mkdtempSync(join(tmpdir(), 'nomi-int-pg-'));
const sock = mkdtempSync('/tmp/nomi-s-');
const port = await freePort();
let started = false;

const cleanUp = () => {
  if (started) {
    spawnSync('pg_ctl', ['-D', data, 'stop', '-m', 'fast'], { stdio: 'ignore' });
    started = false;
  }
  // Only the two directories this run made.
  rmSync(data, { recursive: true, force: true });
  rmSync(sock, { recursive: true, force: true });
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { cleanUp(); process.exit(130); });

/** The two URLs, built — never a literal credential in this file. */
const urlFor = (user, password) => {
  const u = new URL(`postgresql://127.0.0.1:${port}/nomi`);
  u.username = user;
  if (password) u.password = password;
  return u.toString();
};
const pg = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'nomi' };
const env = {
  ...process.env,
  MIGRATE_DATABASE_URL: urlFor('postgres'),
  DATABASE_URL: urlFor('nomi_app', 'nomi_app'),
};
const step = (what, cmd, args, e = env) => {
  const r = spawnSync(cmd, args, { env: e, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) {
    console.error(`  ✗ ${what} failed:\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-8).join('\n')}`);
    return false;
  }
  return true;
};

let code = 1;
try {
  const t0 = Date.now();
  if (!step('initdb', 'initdb', ['-D', data, '-U', 'postgres', '--auth-local=trust', '--auth-host=trust', '-E', 'UTF8', '--no-sync'], process.env)) {
    code = fail('initdb');
  } else if (!step('starting Postgres', 'pg_ctl', ['-D', data, '-w', '-l', join(data, 'server.log'),
    '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${sock} -c fsync=off`, 'start'], process.env)) {
    code = fail('Postgres did not start');
  } else {
    started = true;
    say(`Postgres of its own on 127.0.0.1:${port}`);
    if (!step('createdb', 'createdb', [], pg)) code = fail('createdb');
    else if (!step('migrate', 'node', ['tools/migrate.mjs'])) code = fail("this checkout's migrations did not apply");
    else if (!step('the app role\'s login', 'psql', ['-v', 'ON_ERROR_STOP=1', '-qc', "alter role nomi_app login password 'nomi_app'"], pg)) code = fail('nomi_app login');
    else if (!step('seed the demo', 'node', ['tools/seed-demo.mjs'])) code = fail('seed:demo');
    else if (!step('seed the sandbox', 'node', ['tools/seed-sandbox.mjs'])) code = fail('seed:sandbox');
    else {
      const v = spawnSync('psql', ['-tAc', 'select max(version) from _migrations'], { env: pg, encoding: 'utf8' });
      say(`migrated to ${String(v.stdout).trim() || '?'} and seeded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      // A fresh database has nothing earlier runs left: nothing to prune.
      const run = spawnSync('node', ['tools/run-integration.mjs', '--no-prune', ...process.argv.slice(2)], { env, stdio: 'inherit' });
      code = run.status ?? 1;
    }
  }
} finally {
  cleanUp();
  say('its Postgres stopped and removed');
}
process.exit(code);
