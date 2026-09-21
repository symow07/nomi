import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a tool, plain JS on purpose; only its pure guard is imported.
import { refusalFor } from '../../tools/prune-test-tenants.mjs';

/**
 * The guard on the one tool that deletes every tenant but two.
 *
 * It exercises the PREDICATE rather than reading the source for a pattern,
 * because "the file mentions localhost" and "the file refuses production" are
 * different claims, and only the second one is worth anything here.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const LOCAL = 'postgresql://postgres@127.0.0.1:55451/nomi';

describe('prune-test-tenants refuses anything but this machine', () => {
  it('allows loopback, by any of its spellings', () => {
    expect(refusalFor(LOCAL, {})).toBeNull();
    expect(refusalFor('postgresql://u@localhost:5432/nomi', {})).toBeNull();
    expect(refusalFor('postgresql://u@[::1]:5432/nomi', {})).toBeNull();
  });

  it('REFUSES A RAILWAY-SHAPED URL — the one that would matter', () => {
    for (const url of [
      'postgresql://postgres:pw@postgres.railway.internal:5432/railway',
      'postgresql://postgres:pw@monorail.proxy.rlwy.net:41234/railway',
      'postgresql://postgres:pw@containers-us-west-1.railway.app:6543/railway',
    ]) {
      const why = refusalFor(url, {});
      expect(why, url).not.toBeNull();
      expect(why, 'the refusal names the host so the reader can see what they nearly did').toMatch(/not this machine/);
    }
  });

  it('refuses any other remote host, not just Railway', () => {
    expect(refusalFor('postgresql://u:p@db.example.com:5432/x', {})).not.toBeNull();
    expect(refusalFor('postgresql://u:p@10.0.0.7:5432/x', {})).not.toBeNull();
    // A host that merely CONTAINS the word is not this machine.
    expect(refusalFor('postgresql://u:p@localhost.evil.test:5432/x', {})).not.toBeNull();
    expect(refusalFor('postgresql://u:p@not-127.0.0.1.example.com:5432/x', {})).not.toBeNull();
  });

  it('refuses in production even on loopback', () => {
    expect(refusalFor(LOCAL, { NODE_ENV: 'production' })).toMatch(/NODE_ENV is production/);
  });

  it('refuses when there is no url at all, and when it is not a url', () => {
    expect(refusalFor(undefined, {})).toMatch(/not set/);
    expect(refusalFor('', {})).toMatch(/not set/);
    expect(refusalFor('this is not a url', {})).not.toBeNull();
  });

  it('THERE IS NO OVERRIDE. A flag past this guard is the bug.', () => {
    const src = read('tools/prune-test-tenants.mjs');
    expect(src, 'a --force would be the thing typed at 2 a.m. from shell history')
      .not.toMatch(/--force/);
    // And the guard takes no argument that could turn it off.
    expect(refusalFor('postgresql://u:p@db.example.com:5432/x', { FORCE: '1' })).not.toBeNull();
  });

  it('importing it neither connects nor deletes', () => {
    // The module ran at import time above. If its body were not behind the
    // "only when run" check, that import would have opened a connection.
    const src = read('tools/prune-test-tenants.mjs');
    expect(src).toMatch(/import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  });
});

describe('erase-workspace still needs a person to have asked', () => {
  // Confirmed here so a change to one tool cannot quietly weaken the other:
  // the two are the only things in the repo that delete product rows.
  const tool = read('tools/erase-workspace.mjs');

  it('refuses without an OPEN deletion request', () => {
    expect(tool).toMatch(/scope = 'workspace' and state = 'open'/);
    expect(tool).toMatch(/has no OPEN workspace deletion request/);
    expect(tool, 'the request IS the authorisation').toMatch(/The request is the authorisation/);
  });

  it('still refuses a wrong name, and still dry-runs by default', () => {
    expect(tool).toMatch(/--confirm does not match/);
    expect(tool).toMatch(/Dry run\. Nothing was deleted\./);
  });

  it('and it has no override either', () => {
    expect(tool).not.toMatch(/--force/);
  });
});
