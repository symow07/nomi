import { describe, it, expect } from 'vitest';
import { odooConnector, odooKeyState } from '../../src/books/connectors/odoo.js';
import { recordsOf, type BooksData } from '../../src/core/books/interchange.js';
import { conformance } from './conformance.js';
import { odooFake } from './odoo-fake.js';
import { SAMPLE_BOOKS } from './sample.js';

/**
 * B4 — the shop's own Odoo, over JSON-2 (PHASE-5.md §4): against a recorded Odoo 19 fake. Item 15: a Free or
 * Standard plan, a wrong key and a wrong database each give their own reason before anything is saved. Item 14: a
 * key 80 days old raises the reminder, and an expired key stops the sync with that reason.
 */
const TODAY = '2026-10-22';
const GOOD = { url: 'https://shop.odoo.com', database: 'shop-db', key: 'good-key', expires: '2027-01-15' };

/** What Odoo holds of the sample: no parent account; a tax is ODOO-<id>, with NO start date (never a guessed one); an entry's document is its Odoo number. */
const odooHolds = (d: BooksData): BooksData => {
  const tax = new Map(d.taxCodes.map((t, i) => [t.code, `ODOO-${i + 1}`]));
  return {
    accounts: d.accounts.map((a) => ({ ...a, parent: null })),
    journals: d.journals.map((j) => ({ ...j, kind: j.kind === 'closing' ? 'general' : j.kind })),
    parties: d.parties,
    taxCodes: d.taxCodes.map((t) => ({ ...t, code: tax.get(t.code)!, validFrom: null, validTo: null })),
    entries: d.entries.map((e) => ({ ...e, documentRef: e.key, lines: e.lines.map((l) => ({ ...l, taxCode: l.taxCode === null ? null : tax.get(l.taxCode)! })) })),
  };
};

const odoo = odooFake();
conformance({
  name: 'the shop\'s own Odoo (JSON-2)',
  connector: odooConnector(odoo.post, 'MAD', () => TODAY),
  sample: SAMPLE_BOOKS,
  holds: odooHolds,
  connectTo: (data) => { odoo.publish(data); return GOOD; },
  refusedWith: { values: { ...GOOD, key: 'a-key-odoo-does-not-know' }, reason: 'wrong_credentials' },
});

describe('B4 · item 15 — connecting says what is wrong, before anything is saved', () => {
  const fresh = () => { const f = odooFake(); f.publish(SAMPLE_BOOKS); return { f, c: odooConnector(f.post, 'MAD', () => TODAY) }; };
  it('a wrong key, a wrong database, a Free or Standard plan: each its own reason', async () => {
    const { f, c } = fresh();
    expect(await c.connect({ ...GOOD, key: 'nope' })).toMatchObject({ reason: 'wrong_credentials' });
    expect(await c.connect({ ...GOOD, database: 'another-db' })).toMatchObject({ reason: 'wrong_database' });
    f.plan('standard');
    expect(await c.connect(GOOD)).toMatchObject({ reason: 'plan_without_api' });
    f.plan('custom');
    expect(await c.connect(GOOD)).toMatchObject({ kind: 'connected', grant: { secret: 'good-key', expiresAt: '2027-01-15' } });
  });
  it('an address that is not a public https one is never called; a server that is not an Odoo 19 is unreadable', async () => {
    const { f, c } = fresh();
    for (const url of ['http://shop.odoo.com', 'https://10.0.0.5', 'https://localhost', 'https://odoo.internal']) {
      expect(await c.connect({ ...GOOD, url }), url).toMatchObject({ reason: 'not_an_address' });
    }
    expect(f.calls).toEqual([]);
    const notOdoo = odooConnector(async () => ({ status: 404, text: '<!DOCTYPE html><title>Not found</title>' }), 'MAD', () => TODAY);
    expect(await notOdoo.connect(GOOD)).toMatchObject({ reason: 'unreadable' });
    const silent = odooConnector(async () => null, 'MAD', () => TODAY);
    expect(await silent.connect(GOOD)).toEqual({ kind: 'refused', reason: 'unreachable', retryable: true });
  });
});

describe('B4 · item 14 — the key\'s own expiry', () => {
  it('a key at most three months: one already past is refused when connecting', async () => {
    const f = odooFake(); f.publish(SAMPLE_BOOKS);
    const c = odooConnector(f.post, 'MAD', () => TODAY);
    expect(await c.connect({ ...GOOD, expires: '2026-10-22' })).toMatchObject({ reason: 'key_expired' });
    expect(await c.connect({ ...GOOD, expires: 'soon' })).toMatchObject({ reason: 'key_expired' });
  });
  it('80 days in, the reminder; 10 days before its end, too; on its end, expired', () => {
    expect(odooKeyState('2026-08-03', '2026-11-30', '2026-10-21')).toBe('fine');      // 79 days, 40 left
    expect(odooKeyState('2026-08-03', '2026-11-30', '2026-10-22')).toBe('renew');     // 80 days
    expect(odooKeyState('2026-10-01', '2026-11-01', '2026-10-22')).toBe('renew');     // 10 days left
    expect(odooKeyState('2026-10-01', '2026-11-01', '2026-11-01')).toBe('expired');
    expect(odooKeyState('2026-08-01', null, '2026-10-31')).toBe('expired');           // no expiry given: 90 days
  });
  it('an expired key stops the sync with that reason: refreshing it is refused, nothing is called', async () => {
    const f = odooFake(); f.publish(SAMPLE_BOOKS);
    const later = odooConnector(f.post, 'MAD', () => '2027-01-15');
    expect(await later.refresh({ secret: 'good-key', expiresAt: '2027-01-15' })).toEqual({ kind: 'refused', reason: 'key_expired', retryable: false });
  });
});

describe('B4 · reading the shop\'s Odoo', () => {
  it('changed since: Odoo\'s write date narrows the entries; the chart is read whole', async () => {
    const f = odooFake(); f.publish(SAMPLE_BOOKS);
    const c = odooConnector(f.post, 'MAD', () => TODAY);
    const conn = await c.connect(GOOD);
    if (conn.kind !== 'connected') throw new Error(conn.reason);
    const first = await c.changedSince(conn.source, null);
    if (first.kind !== 'read') throw new Error(first.reason);
    expect(first.data.entries.length).toBe(3);
    expect(first.cursor).not.toBeNull();
    const again = await c.changedSince(conn.source, first.cursor);
    if (again.kind !== 'read') throw new Error(again.reason);
    expect(again.data.entries).toEqual([]);
    expect(again.data.accounts.length).toBe(SAMPLE_BOOKS.accounts.length);
    f.publish({ ...SAMPLE_BOOKS, entries: SAMPLE_BOOKS.entries.map((e) => (e.key === 'row-17' ? { ...e, label: 'Bon de livraison 311 (corrigé)' } : e)) });
    const since = await c.changedSince(conn.source, first.cursor);
    if (since.kind !== 'read') throw new Error(since.reason);
    expect(since.data.entries.map((e) => [e.key, e.label])).toEqual([['row-17', 'Bon de livraison 311 (corrigé)']]);
  });
  it('a foreign line is read in its own currency, exactly; the exchange difference stays its own line', async () => {
    const f = odooFake(); f.publish(SAMPLE_BOOKS);
    const c = odooConnector(f.post, 'MAD', () => TODAY);
    const conn = await c.connect(GOOD);
    if (conn.kind !== 'connected') throw new Error(conn.reason);
    const read = await c.changedSince(conn.source, null);
    if (read.kind !== 'read') throw new Error(read.reason);
    const usd = read.data.entries.find((e) => e.key === 'BQ-2026-3')!;
    expect(usd.lines.map((l) => [l.currency, l.debit, l.credit])).toEqual([
      ['USD', '33.33', null], ['USD', '33.33', null], ['USD', '33.34', null], ['USD', null, '100'], ['MAD', null, '0.01']]);
    expect(recordsOf(read.data)).toEqual(recordsOf(odooHolds(SAMPLE_BOOKS)));
  });
});
