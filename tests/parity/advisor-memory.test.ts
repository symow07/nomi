import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { advisorKeysFrom, sealAdvisor, openAdvisor } from '../../src/advisor/seal.js';
import { secretValuesIn } from '../../src/worker/appErrors.js';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { APP_SEALED } from '../../tools/lib/sealed.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { parseLedgerLine } from '../../tools/replay-erasures.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { RULES } from '../../tools/erase-buyer.mjs';

/**
 * 0130 — THE ADVISOR'S MEMORY, the code's side (docs/ADVISOR-MEMORY.md; the owner's decisions of
 * 2026-10-07). tests/integration/advisor-memory.test.ts holds the database's.
 *   D8 "a separate ADVISOR_KEY. If it is missing or wrong, the advisor keeps working …"
 *   "no tool under tools/ opens the encrypted columns or imports the decrypt function."
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const KEY = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const files = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(m?js|ts|sh|py)$/.test(f)) out.push(p);
  }
  return out;
};

describe('no tool opens the advisor\'s history', () => {
  const tools = files(join(ROOT, 'tools'));
  const COLUMNS: string[] = (APP_SEALED as { column: string }[]).map((s) => s.column);

  it('the sealed columns are named in tools/ only by the list that says no tool opens them', () => {
    expect(COLUMNS).toEqual(['title_ciphertext', 'question_ciphertext', 'params_ciphertext', 'answer_ciphertext', 'facts_ciphertext']);
    const naming = tools.filter((f) => COLUMNS.some((c) => readFileSync(f, 'utf8').includes(c))).map((f) => f.slice(ROOT.length + 1));
    expect(naming).toEqual(['tools/lib/sealed.mjs']);
  });

  it('no tool imports the advisor\'s seal, nor reads its key from the environment', () => {
    for (const f of tools) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/advisor\/seal|openAdvisor|sealAdvisor|advisorKeysFrom/);
      expect(src, f).not.toMatch(/env\[['"]ADVISOR_KEY|env\.ADVISOR_KEY|\$ADVISOR_KEY|\$\{ADVISOR_KEY/);
    }
  });

  it('the check can fail: the app\'s own code does import it (the control)', () => {
    expect(readFileSync(join(ROOT, 'src/main.ts'), 'utf8')).toMatch(/from '\.\/advisor\/seal\.js'/);
  });
});

describe('D8 · the advisor\'s key: missing or wrong, nothing breaks and nothing is kept', () => {
  const keys = advisorKeysFrom({ ADVISOR_KEY: KEY });

  it('sealed, then opened with the key that sealed it; the database holds ciphertext and the key\'s fingerprint only', () => {
    const s = sealAdvisor(keys, 'Who has gone quiet?')!;
    expect(s.ciphertext).not.toContain('quiet');
    expect(s.sealedWith).toMatch(/^[0-9a-f]{12}$/);
    expect(s.sealedWith).not.toBe(KEY.slice(0, 12));
    expect(openAdvisor(keys, s.ciphertext, s.sealedWith)).toEqual({ plain: 'Who has gone quiet?', stale: false });
  });

  it('missing: nothing can be sealed, so nothing is kept; not a 64-hex key: the same, and said why', () => {
    expect(advisorKeysFrom({})).toMatchObject({ current: null, problem: 'missing' });
    expect(advisorKeysFrom({ ADVISOR_KEY: 'too-short' })).toMatchObject({ current: null, problem: 'shape' });
    expect(sealAdvisor(advisorKeysFrom({}), 'x')).toBeNull();
  });

  it('wrong: what another key sealed does not open, and says so with nothing (never throws)', () => {
    const s = sealAdvisor(advisorKeysFrom({ ADVISOR_KEY: OTHER }), 'secret words')!;
    expect(openAdvisor(keys, s.ciphertext, s.sealedWith)).toBeNull();
    expect(openAdvisor(keys, 'not a seal', keys.current!.id)).toBeNull();
    const tampered = s.ciphertext.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(openAdvisor(advisorKeysFrom({ ADVISOR_KEY: OTHER }), tampered, s.sealedWith)).toBeNull();
  });

  it('a rotation: the previous key still opens, and says the words should be sealed again with the current one', () => {
    const old = sealAdvisor(advisorKeysFrom({ ADVISOR_KEY: OTHER }), 'kept from before')!;
    const rotating = advisorKeysFrom({ ADVISOR_KEY: KEY, ADVISOR_KEY_PREVIOUS: OTHER });
    expect(openAdvisor(rotating, old.ciphertext, old.sealedWith)).toEqual({ plain: 'kept from before', stale: true });
  });

  it('a key being rotated out is as secret as the one in force: error reports redact it (and CREDENTIAL_KEY_PREVIOUS)', () => {
    const found = secretValuesIn({ ADVISOR_KEY: KEY, ADVISOR_KEY_PREVIOUS: OTHER, CREDENTIAL_KEY_PREVIOUS: 'ef'.repeat(32) });
    expect(found).toEqual(expect.arrayContaining([KEY, OTHER, 'ef'.repeat(32)]));
  });
});

describe('the erasure system knows the advisor\'s tables', () => {
  it('erase-buyer\'s RULES classify all three; a turn that names them is the planner\'s to take whole', () => {
    expect(RULES.advisor_turn_subjects).toMatchObject({ do: 'erase' });
    expect(RULES.advisor_turns).toEqual({ do: 'erase' });
    expect(RULES.advisor_threads).toEqual({ do: 'erase' });
    const src = readFileSync(join(ROOT, 'tools/erase-buyer.mjs'), 'utf8');
    expect(src).toContain("// 3b · The advisor's turns that name them (0130)");
  });

  it('the replay reads an advisor line — and refuses one that does not say which conversations', () => {
    const line = {
      id: '11111111-1111-4111-8111-111111111111', kind: 'advisor', business_id: '22222222-2222-4222-8222-222222222222',
      customer_id: null, request_id: null, person_id: '33333333-3333-4333-8333-333333333333',
      thread_ids: ['44444444-4444-4444-8444-444444444444'], via: 'person', by_who: '33333333-3333-4333-8333-333333333333',
      at: '2026-10-07T00:00:00.000Z', counts: { erased: { advisor_threads: 1 } },
    };
    expect(parseLedgerLine(JSON.stringify(line)).ok).toBe(true);
    expect(parseLedgerLine(JSON.stringify({ ...line, thread_ids: [] })).ok).toBe(false);
    expect(parseLedgerLine(JSON.stringify({ ...line, thread_ids: null })).ok).toBe(false);
    expect(parseLedgerLine(JSON.stringify({ ...line, via: 'retention' })).ok).toBe(true);
  });

  it('the migration keeps the app role off DELETE and off rewriting a consent', () => {
    const m = readFileSync(join(ROOT, 'migrations/0130_advisor_memory.sql'), 'utf8');
    expect(m).not.toMatch(/grant[^;]*\bdelete\b[^;]*nomi_app/i);
    expect(m).toMatch(/grant select, insert on advisor_consents to nomi_app;/);
    expect(m).not.toMatch(/grant update[^;]*on advisor_consents/i);
  });
});
