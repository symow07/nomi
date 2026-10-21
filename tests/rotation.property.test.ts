import { describe, it, expect } from 'vitest';
import { nextInRotation, type RotationMember } from '../src/core/conversation/rotation.js';

/**
 * S3 (Phase 5, item 21) — the done-criterion (PHASE-5.md §4): "Assignment rotates fairly among available people
 * (property test). Absent people are skipped." Thousands of random teams and hand-off sequences, from a seeded
 * generator, so a failure is the same failure every time it runs.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const T0 = Date.parse('2026-10-22T08:00:00Z');
const minute = (n: number) => new Date(T0 + n * 60_000);
type Team = RotationMember[];
const team = (r: () => number, size: number): Team => Array.from({ length: size }, (_, i) => ({
  id: `p${String(i).padStart(2, '0')}-${Math.floor(r() * 1e6)}`, inRotation: true, archived: false, accountant: false,
  awayUntil: null, lastGivenAt: r() < 0.3 ? minute(-Math.floor(r() * 500)) : null, joinedAt: minute(-1000 - i),
}));
/** One hand-off at minute t: the one given it has their turn moved to now. */
function give(m: Team, t: number): string | null {
  const id = nextInRotation(m, minute(t));
  if (id) { const i = m.findIndex((x) => x.id === id); m[i] = { ...m[i]!, lastGivenAt: minute(t) }; }
  return id;
}
const RUNS = 2000;

describe('S3 · hand-offs in turn, as properties', () => {
  it('FAIR: with everyone in, any run of hand-offs gives each person their share to within one, and goes round in a cycle', () => {
    const r = rng(21);
    for (let run = 0; run < RUNS; run++) {
      const m = team(r, 1 + Math.floor(r() * 7));
      // the first round settles whoever had been given one before; from then on it is a strict cycle
      for (let t = 0; t < m.length; t++) give(m, t);
      const n = m.length * (1 + Math.floor(r() * 5)) + Math.floor(r() * m.length);
      const counts = new Map(m.map((x) => [x.id, 0]));
      const order: string[] = [];
      for (let t = 0; t < n; t++) { const id = give(m, m.length + t)!; counts.set(id, counts.get(id)! + 1); order.push(id); }
      const c = [...counts.values()];
      expect(Math.max(...c) - Math.min(...c), `run ${run}`).toBeLessThanOrEqual(1);
      for (let i = m.length; i < order.length; i++) expect(order[i], `run ${run}`).toBe(order[i - m.length]);
    }
  });

  it('ABSENT are skipped: nobody away, archived, out of turn or an accountant is ever given one', () => {
    const r = rng(22);
    for (let run = 0; run < RUNS; run++) {
      const m = team(r, 2 + Math.floor(r() * 6)).map((x) => {
        const roll = r();
        return roll < 0.15 ? { ...x, awayUntil: minute(10_000) } : roll < 0.25 ? { ...x, archived: true }
          : roll < 0.35 ? { ...x, inRotation: false } : roll < 0.42 ? { ...x, accountant: true } : x;
      });
      for (let t = 0; t < 30; t++) {
        const id = give(m, t);
        // the oracle, written out on its own (never the rule's own predicate)
        const open = m.filter((x) => x.inRotation && !x.archived && !x.accountant && (x.awayUntil === null || x.awayUntil.getTime() <= minute(t).getTime()));
        if (open.length === 0) { expect(id, `run ${run}`).toBeNull(); continue; }
        expect(open.map((x) => x.id), `run ${run}`).toContain(id);
      }
    }
  });

  it('BACK FROM AWAY: next once, then in the cycle again — never a burst of everything missed', () => {
    const r = rng(23);
    for (let run = 0; run < RUNS; run++) {
      const m = team(r, 3 + Math.floor(r() * 5));
      const away = Math.floor(r() * m.length);
      const until = 20 + Math.floor(r() * 40);
      m[away] = { ...m[away]!, awayUntil: minute(until) };
      for (let t = 0; t < until; t++) expect(give(m, t)).not.toBe(m[away]!.id);
      const after: string[] = [];
      for (let t = until; t < until + m.length; t++) after.push(give(m, t)!);
      expect(after[0], `run ${run}`).toBe(m[away]!.id);
      expect(after.filter((x) => x === m[away]!.id), `run ${run}`).toHaveLength(1);
    }
  });

  it('the answer depends on the people, never on the order the rows came in', () => {
    const r = rng(24);
    for (let run = 0; run < RUNS; run++) {
      const m = team(r, 1 + Math.floor(r() * 8)).map((x) => (r() < 0.5 ? { ...x, lastGivenAt: minute(-5) } : x));
      const shuffled = [...m].sort(() => r() - 0.5);
      expect(nextInRotation(shuffled, minute(0)), `run ${run}`).toBe(nextInRotation(m, minute(0)));
    }
  });
});
