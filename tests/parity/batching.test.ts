import { describe, it, expect } from 'vitest';
import { decideBatch, DEFAULT_BATCH_CONFIG, type Fragment } from '../../src/core/conversation/batching.js';

const t = (s: number) => new Date(2026, 6, 15, 10, 0, s);
const frag = (id: string, text: string, sec: number): Fragment => ({ id, text, receivedAt: t(sec) });

describe('inbound batching — the fragment problem (ASSUMPTIONS P1)', () => {
  it('the canonical burst merges into ONE turn in arrival order', () => {
    const fragments = [
      frag('m1', 'hello', 0),
      frag('m2', 'price?', 3),
      frag('m3', 'the bags', 5),
      frag('m4', '5000pcs', 8),
    ];
    const d = decideBatch(fragments, t(15)); // 7s quiet after m4
    expect(d.action).toBe('process');
    if (d.action === 'process') {
      expect(d.mergedText).toBe('hello\nprice?\nthe bags\n5000pcs');
      expect(d.stats.fragments).toBe(4);
      expect(d.stats.burst).toBe(false); // closed by quiet, not by cap
    }
  });

  it('waits while the buyer is still typing', () => {
    const d = decideBatch([frag('m1', 'hello', 0), frag('m2', 'I need', 4)], t(6)); // only 2s quiet
    expect(d.action).toBe('wait');
    if (d.action === 'wait') expect(d.checkAgainAt).toEqual(t(10)); // m2 + 6s debounce
  });

  it('a single message processes after one debounce — no added latency beyond it', () => {
    const d = decideBatch([frag('m1', 'do you have led candles?', 0)], t(7));
    expect(d.action).toBe('process');
  });

  it('maxWindow forces processing mid-monologue (a reply beats completeness)', () => {
    // buyer keeps typing every 4s forever — never 6s quiet
    const fragments = [0, 4, 8, 12, 16, 19].map((s, i) => frag(`m${i}`, `part ${i}`, s));
    const d = decideBatch(fragments, t(21)); // 21s > 20s window, only 2s quiet
    expect(d.action).toBe('process');
    if (d.action === 'process') expect(d.stats.burst).toBe(true);
  });

  it('maxFragments caps a machine-gun burst', () => {
    const fragments = Array.from({ length: 8 }, (_, i) => frag(`m${i}`, `${i}`, i));
    const d = decideBatch(fragments, t(8)); // 0s quiet, 8s span — but 8 fragments
    expect(d.action).toBe('process');
    if (d.action === 'process') expect(d.stats.burst).toBe(true);
  });

  it('merge is deterministic regardless of input order (replay support)', () => {
    const shuffled = [frag('m2', 'b', 2), frag('m1', 'a', 0), frag('m3', 'c', 4)];
    const d1 = decideBatch(shuffled, t(12));
    const d2 = decideBatch([...shuffled].reverse(), t(12));
    expect(d1).toEqual(d2);
    if (d1.action === 'process') expect(d1.mergedText).toBe('a\nb\nc');
  });

  it('config is honoured (per-tenant tuning)', () => {
    const cfg = { ...DEFAULT_BATCH_CONFIG, debounceMs: 2_000 };
    const d = decideBatch([frag('m1', 'hi', 0)], t(3), cfg);
    expect(d.action).toBe('process');
  });
});

describe('M51.1 · the batch is REACHED, not merely decided', () => {
  /**
   * `decideBatch` has been correct and unreachable since it was written. The
   * tests above prove the decision; these prove a production job asks for it.
   *
   * ASSUMPTIONS P1 said "build before shadow", and the reason it stayed open
   * is the reason it matters: nothing failed. Four fragments became four
   * turns, each analysed alone, and the suite was green throughout.
   */
  it('the worker records a fragment before deciding anything', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('await boss.work<InboundJob>'));
    // Persisted FIRST: a crash between recording and deciding must lose
    // nothing, which is why message_fragments is a table and not a variable.
    expect(handler.indexOf('await recordFragment('))
      .toBeLessThan(handler.indexOf('decideBatch('));
  });

  it('a WAIT re-enqueues at the time decideBatch chose — not a constant', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/startAfter: batch\.checkAgainAt/);
    // A transcribed delay here would drift from the config the owner sets.
    expect(src).not.toMatch(/startAfter: \d/);
  });

  it('an empty pending list does NOT schedule another wake', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    // Four fragments produce four jobs; the first wake to win merges them and
    // the rest find nothing. Re-arming there is how a debounce becomes a loop
    // that never empties.
    expect(src).toContain('if (pending.length === 0) return null;');
    expect(src).toMatch(/if \(!decision\) return;/);
  });

  it('the fragments are marked answered in the SAME transaction as the answer', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    const turn = src.slice(src.indexOf('const effects = await withTenantTx'),
      src.indexOf('// Effects enqueue AFTER'));
    expect(turn).toContain('await markFragmentsProcessed(');
    expect(turn).toContain('await commitTurn(');
  });

  it('MEDIA IS NOT MERGED INTO TEXT — provenance is the reason', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    // The batch branch is entered only when nothing was heard and nothing was
    // seen. A transcript merged into typed lines would make M34.5's rule —
    // a figure a machine read is treated differently from one she typed —
    // unenforceable, because the turn could no longer say which was which.
    expect(src).toContain('if (heard === null && seen === null) {');
  });

  it('but media FLUSHES a pending batch first, so replies keep his order', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('await boss.work<InboundJob>'));
    const flushAt = handler.indexOf('const flush = await withTenantTx');
    const mediaTurnAt = handler.lastIndexOf('await runTurn({');
    expect(flushAt).toBeGreaterThan(0);
    expect(flushAt, 'the text he typed is answered before the photo').toBeLessThan(mediaTurnAt);
  });

  it('the config comes from HER row, and falls back to the defaults', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/db/fragments.ts', import.meta.url), 'utf8');
    expect(src).toContain('batch_debounce_ms');
    // The failure mode of an unreadable config must not be "no batching" —
    // that is the behaviour this milestone exists to remove.
    expect(src).toContain('if (!row) return DEFAULT_BATCH_CONFIG;');
  });
});
