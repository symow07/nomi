import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  BOOKS_SYSTEMS, CONNECT_REFUSALS, configProblems,
  type BooksConnector, type ConfigValues, type ConnectRefusalReason,
} from '../../src/core/books/connector.js';
import { changedRecords, recordsOf, type BooksData, type RecordKind } from '../../src/core/books/interchange.js';

/**
 * B1 (Phase 5, item 12) — THE CONFORMANCE SUITE EVERY BOOKS CONNECTOR PASSES (PHASE-5.md §4): its config, a mapping
 * round trip, a refused sign-in, and "changed since". A connector is a file that calls `conformance` with its own
 * fixture; the workbook (B2), Sheets (B3), Odoo (B4) and a test fake all pass the same checks.
 */
export type ConformanceFixture<S, R> = {
  readonly name: string;
  readonly connector: BooksConnector<S, R>;
  /** Books with at least one record of every kind, foreign currency and an exchange difference among them. */
  readonly sample: BooksData;
  /** What the owner gives to connect to a source that holds `data`. */
  readonly connectTo: (data: BooksData) => Promise<ConfigValues> | ConfigValues;
  /**
   * What the system can hold of the books, when it cannot hold all of them (Odoo has no parent account, no tax code,
   * no tax start date): said here, in the open, and the round trips are measured against it. Absent: everything.
   */
  readonly holds?: (data: BooksData) => BooksData;
  /** Values the config accepts but the system refuses at sign-in, and the reason it must give. */
  readonly refusedWith: { readonly values: ConfigValues; readonly reason: ConnectRefusalReason };
};

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const lastReadOf = (d: BooksData) => new Map(recordsOf(d).map((r) => [`${r.kind}:${r.key}`, digest(r.content)]));

export function conformance<S, R>(fx: ConformanceFixture<S, R>): void {
  const c = fx.connector;
  const kept = fx.holds ? fx.holds(fx.sample) : fx.sample;
  describe(`${fx.name} · the books' connector conformance (B1)`, () => {
    it('the sample holds a record of every kind (the suite checks what it means to)', () => {
      const kinds = new Set(recordsOf(fx.sample).map((r) => r.kind));
      expect([...kinds].sort()).toEqual((['account', 'entry', 'journal', 'party', 'tax_code'] as RecordKind[]).sort());
    });

    it('CONFIG: a known system, its fields declared; nothing required may be missing, and the right values pass', async () => {
      expect(BOOKS_SYSTEMS).toContain(c.config.system);
      expect(c.config.fields.length).toBeGreaterThan(0);
      const missing = configProblems(c.config, {});
      for (const f of c.config.fields.filter((x) => x.required)) expect(missing).toContain(`${f.name}: required`);
      expect(configProblems(c.config, await fx.connectTo(fx.sample))).toEqual([]);
    });

    it('MAPPING: the books to the system and back are the same books, and nothing is found wrong with them', () => {
      const back = c.toBooks(c.fromBooks(fx.sample));
      expect(back.problems).toEqual([]);
      expect(recordsOf(back.data)).toEqual(recordsOf(kept));
    });

    it('SIGN-IN REFUSED: with a reason from the closed list — and nothing the vendor said', async () => {
      expect(configProblems(c.config, fx.refusedWith.values)).toEqual([]);
      const r = await c.connect(fx.refusedWith.values);
      expect(r).toEqual({ kind: 'refused', reason: fx.refusedWith.reason, retryable: fx.refusedWith.reason === 'unreachable' });
      expect(CONNECT_REFUSALS).toContain(fx.refusedWith.reason);
    });

    it('A GRANT: what signing in holds can be refreshed and given back; a system that holds nothing holds no grant', async () => {
      const r = await c.connect(await fx.connectTo(fx.sample));
      if (r.kind !== 'connected') throw new Error(`could not connect: ${r.reason}`);
      if (c.config.signIn === 'none') { expect(r.grant).toBeNull(); return; }
      expect(r.grant).not.toBeNull();
      const again = await c.refresh(r.grant!);
      expect('kind' in again ? again.reason : 'renewed').toBe('renewed');
      await c.revoke(r.grant!);
    });

    it('CHANGED SINCE: first everything; read again, nothing; one record changed, that record and no other', async () => {
      const first = await c.connect(await fx.connectTo(fx.sample));
      if (first.kind !== 'connected') throw new Error(`could not connect: ${first.reason}`);
      const all = await c.changedSince(first.source, null);
      if (all.kind !== 'read') throw new Error(`could not read: ${all.reason}`);
      expect(all.problems).toEqual([]);
      expect(recordsOf(all.data)).toEqual(recordsOf(kept));
      const read = lastReadOf(all.data);
      // the same source again, from the cursor it gave: nothing has changed
      const again = await c.changedSince(first.source, all.cursor);
      if (again.kind !== 'read') throw new Error(`could not read: ${again.reason}`);
      expect(changedRecords(recordsOf(again.data), read, digest)).toEqual([]);
      // one party renamed at the source: exactly that record has changed
      const party = fx.sample.parties[0]!;
      const moved: BooksData = { ...fx.sample, parties: fx.sample.parties.map((p) => (p.code === party.code ? { ...p, name: `${p.name} (renamed)` } : p)) };
      const second = await c.connect(await fx.connectTo(moved));
      if (second.kind !== 'connected') throw new Error(`could not connect: ${second.reason}`);
      const since = await c.changedSince(second.source, all.cursor);
      if (since.kind !== 'read') throw new Error(`could not read: ${since.reason}`);
      expect(changedRecords(recordsOf(since.data), read, digest).map((r) => `${r.kind}:${r.key}`)).toEqual([`party:${party.code}`]);
    });
  });
}
