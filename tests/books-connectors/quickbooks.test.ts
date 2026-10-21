import { describe, it, expect } from 'vitest';
import { qboAccess, qboAuthorizeUrl, qboConnector, sendEntriesToQbo, QBO_JOURNAL } from '../../src/books/connectors/quickbooks.js';
import { recordsOf, type BooksData } from '../../src/core/books/interchange.js';
import type { Decimal } from '../../src/core/types/decimal.js';
import { conformance } from './conformance.js';
import { qboFake, QBO_CLIENT } from './quickbooks-fake.js';
import { SAMPLE_BOOKS, SAMPLE_WITH_FIELDS } from './sample.js';

/**
 * D9 — the shop's own QuickBooks Online (PHASE-5.md §4): the conformance suite against a recorded fake of Intuit's
 * documented answers, and what is QuickBooks' own — the company by its realmId, a refresh token that changes each day,
 * a subscription that ended said for what it is, and C4's write-back as journal entries, never over one already there.
 */
const REDIRECT = 'https://app.example/app/books/quickbooks/callback';

/**
 * What QuickBooks holds of the books: accounts WITH their parents; customers (a party that is neither customer nor
 * supplier among them, so marked) and vendors — a tax number comes back masked, so none is read, and a vendor carries
 * neither an ICE nor custom values; NO tax codes (QuickBooks' rates name no account); entries in one currency each,
 * all posted (QuickBooks keeps no draft), in one journal of its own; no custom fields (the values travel in the mark).
 */
const qboHolds = (d: BooksData): BooksData => {
  const entries = d.entries.filter((e) => new Set(e.lines.map((l) => l.currency)).size === 1)
    .map((e) => ({ ...e, journal: QBO_JOURNAL, documentRef: e.key, documentDate: null, state: 'posted' as const }));
  return {
    accounts: d.accounts.filter((a) => a.kind !== 'off_balance'),
    journals: entries.length > 0 ? [{ code: QBO_JOURNAL, name: 'QuickBooks', kind: 'general' }] : [],
    parties: [...d.parties.filter((p) => p.kind !== 'supplier').map((p) => ({ ...p, taxNumber: null })),
      ...d.parties.filter((p) => p.kind === 'supplier').map(({ custom: _c, ...p }) => ({ ...p, ice: null, taxNumber: null }))],
    taxCodes: [],
    entries,
  };
};

const qbo = qboFake();
conformance({
  name: 'the shop\'s own QuickBooks Online (Accounting API)',
  connector: qboConnector({ client: QBO_CLIENT, fetch: qbo.fetch }, 'MAD'),
  sample: SAMPLE_WITH_FIELDS,
  holds: qboHolds,
  connectTo: (data) => { qbo.publish(data); return { ...qbo.code(), redirectUri: REDIRECT }; },
  refusedWith: { values: { code: 'a-code-intuit-never-issued', realmId: qbo.realmId, redirectUri: REDIRECT }, reason: 'wrong_credentials' },
});

const fresh = () => { const f = qboFake(); f.publish(SAMPLE_BOOKS); return { f, c: qboConnector({ client: QBO_CLIENT, fetch: f.fetch }, 'MAD') }; };
const connected = async () => {
  const { f, c } = fresh();
  const r = await c.connect({ ...f.code(), redirectUri: REDIRECT });
  if (r.kind !== 'connected') throw new Error(`fixture: ${r.reason}`);
  return { f, c, r, deps: { client: QBO_CLIENT, fetch: f.fetch } };
};

describe('D9 · signing in to QuickBooks', () => {
  it('Intuit\'s page asks for the accounting scope, and nothing more', () => {
    const u = new URL(qboAuthorizeUrl(QBO_CLIENT, { redirectUri: REDIRECT, state: 'n0nce' }));
    expect(`${u.origin}${u.pathname}`).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: QBO_CLIENT.clientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: REDIRECT, state: 'n0nce' });
  });

  it('the company by its realmId, checked before anything is kept; a company that does not answer gives the grant back', async () => {
    const { r, f } = await connected();
    expect(r).toMatchObject({ source: { realmId: f.realmId, companyName: 'Westlake Canvas Co.' }, grant: { expiresAt: null } });
    const { f: g, c } = fresh();
    const live = g.liveRefresh().length;
    expect(await c.connect({ ...g.code(), realmId: '1111', redirectUri: REDIRECT })).toMatchObject({ kind: 'refused', reason: 'revoked' });
    expect(g.liveRefresh().length).toBe(live);
    expect(await c.connect({ code: 'x', realmId: 'not-a-realm', redirectUri: REDIRECT })).toMatchObject({ reason: 'wrong_credentials' });
  });

  it('the refresh token stays the same within a day and CHANGES after; the one before is then refused — so the returned one is kept', async () => {
    const { f, r, c, deps } = await connected();
    const same = await qboAccess(deps, r.grant!);
    if ('kind' in same) throw new Error('fixture');
    expect(same.grant.secret).toBe(r.grant!.secret);
    f.nextDay();
    const next = await qboAccess(deps, r.grant!);
    if ('kind' in next) throw new Error('fixture');
    expect(next.grant.secret).not.toBe(r.grant!.secret);
    expect(await c.refresh(r.grant!)).toEqual({ kind: 'refused', reason: 'revoked', retryable: false });
    expect(f.liveRefresh()).toEqual([next.grant.secret]);
  });

  it('refusals by status and Fault code, never Intuit\'s words: an unknown token, a subscription that ended, Intuit not answering', async () => {
    const { f, r, c } = await connected();
    expect(await c.changedSince({ ...r.source, accessToken: 'old' }, null)).toMatchObject({ reason: 'revoked' });
    f.lapse();
    expect(await c.changedSince(r.source, null)).toMatchObject({ reason: 'source_missing' });
    await c.revoke(r.grant!);
    expect(f.liveRefresh()).toEqual([]);
    const silent = qboConnector({ client: QBO_CLIENT, fetch: async () => { throw new Error('offline'); } }, 'MAD');
    expect(await silent.connect({ code: 'x', realmId: '1', redirectUri: REDIRECT })).toEqual({ kind: 'refused', reason: 'unreachable', retryable: true });
  });
});

describe('D9 · what QuickBooks holds', () => {
  it('accounts keep their parents; an entry in two currencies is not held; every entry there is posted', () => {
    const { c } = fresh();
    const back = c.toBooks(c.fromBooks(SAMPLE_BOOKS)).data;
    expect(back.accounts.find((a) => a.code === '71111')?.parent).toBe('7111');
    expect(back.entries.map((e) => [e.key, e.state])).toEqual([['VE-2026-1', 'posted'], ['row-17', 'posted']]);
    expect(back.taxCodes).toEqual([]);
    expect(recordsOf(back).filter((r) => r.kind === 'tax_code')).toEqual([]);
  });

  it('CHANGED SINCE: journal entries asked by their LastUpdatedTime after the newest read', async () => {
    const { f, r, c } = await connected();
    const all = await c.changedSince(r.source, null);
    if (all.kind !== 'read') throw new Error('fixture');
    expect(all.cursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-00:00$/);
    const none = await c.changedSince(r.source, all.cursor);
    expect(none.kind === 'read' && none.data.entries).toEqual([]);
    f.publish({ ...SAMPLE_BOOKS, entries: SAMPLE_BOOKS.entries.map((e) => (e.key === 'row-17' ? { ...e, label: 'BL 311, corrigé' } : e)) });
    const one = await c.changedSince(r.source, all.cursor);
    expect(one.kind === 'read' && one.data.entries.map((e) => e.key)).toEqual(['row-17']);
  });
});

describe('D9 · C4 — Nomi\'s posted entries into QuickBooks, never over anything', () => {
  const entry = (key: string, account = '7111', party: string | null = 'C001') => ({ key, date: '2026-05-02', label: `Facture ${key}`, custom: { project: 'Expo' },
    lines: [{ account: '3421', party, taxCode: null, label: null, bookDebit: '120.50' as Decimal, bookCredit: '0' as Decimal, custom: { weight_kg: '2' } },
      { account, party: null, taxCode: 'TVA20', label: 'Sacs', bookDebit: '0' as Decimal, bookCredit: '120.50' as Decimal }] });

  it('a journal entry by Nomi\'s number, the books\' own digits, the party as its Entity, a requestid — and read back as the same entry', async () => {
    const { f, r, c, deps } = await connected();
    expect(await sendEntriesToQbo(deps, r.source, 'MAD', [entry('VE-2026-7')])).toMatchObject({ conflicts: [], written: [{ key: 'VE-2026-7' }] });
    expect(f.created[0]!.requestId).toBe('nomi-VE-2026-7');
    expect(f.created[0]!.body).toMatchObject({ DocNumber: 'VE-2026-7', GlobalTaxCalculation: 'TaxExcluded', CurrencyRef: { value: 'MAD' } });
    const back = await c.changedSince(r.source, null);
    if (back.kind !== 'read') throw new Error('fixture');
    expect(back.data.entries.find((e) => e.key === 'VE-2026-7')).toEqual({ key: 'VE-2026-7', journal: QBO_JOURNAL, date: '2026-05-02', label: 'Facture VE-2026-7',
      documentRef: 'VE-2026-7', documentDate: null, state: 'posted', custom: { project: 'Expo' }, lines: [
        { account: '3421', party: 'C001', taxCode: null, currency: 'MAD', debit: '120.5', credit: null, label: 'Facture VE-2026-7', custom: { weight_kg: '2' } },
        { account: '7111', party: null, taxCode: 'TVA20', currency: 'MAD', debit: null, credit: '120.5', label: 'Sacs' }] });
  });

  it('a United States company is sent no GlobalTaxCalculation (QuickBooks refuses it there)', async () => {
    const { f, r, deps } = await connected();
    f.inUnitedStates();
    expect(await sendEntriesToQbo(deps, r.source, 'MAD', [entry('VE-2026-8')])).toMatchObject({ conflicts: [] });
    expect(f.created[0]!.body['GlobalTaxCalculation']).toBeUndefined();
  });

  it('conflicts, each with its reason, nothing written for them', async () => {
    const { f, r, deps } = await connected();
    await sendEntriesToQbo(deps, r.source, 'MAD', [entry('VE-2026-9')]);
    const out = await sendEntriesToQbo(deps, r.source, 'MAD', [entry('VE-2026-9'), entry('VE-2026-10', '9999'), entry('VE-2026-11', '7111', 'C404'),
      entry('VE-2026-00000000000012')]);
    expect(out).toEqual({ written: [], conflicts: [
      { key: 'VE-2026-9', reason: 'already_in_quickbooks', detail: 'VE-2026-9' }, { key: 'VE-2026-10', reason: 'no_account', detail: '9999' },
      { key: 'VE-2026-11', reason: 'no_party', detail: 'C404' }, { key: 'VE-2026-00000000000012', reason: 'refused', detail: 'VE-2026-00000000000012' }] });
    expect(await sendEntriesToQbo(deps, r.source, 'EUR', [entry('VE-2026-13')])).toEqual({ written: [], conflicts: [{ key: 'VE-2026-13', reason: 'no_currency', detail: 'MAD' }] });
    expect(f.created).toHaveLength(1);
  });
});
