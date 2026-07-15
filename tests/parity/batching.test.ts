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
