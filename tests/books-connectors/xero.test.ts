import { describe, it, expect } from 'vitest';
import { readXeroMark, sendEntriesToXero, xeroAccess, xeroAuthorizeUrl, xeroConnector, xeroDay, xeroMark, XERO_JOURNAL } from '../../src/books/connectors/xero.js';
import { recordsOf, type BooksData } from '../../src/core/books/interchange.js';
import type { Decimal } from '../../src/core/types/decimal.js';
import { conformance } from './conformance.js';
import { xeroFake, XERO_CLIENT } from './xero-fake.js';
import { SAMPLE_BOOKS, SAMPLE_WITH_FIELDS } from './sample.js';

/**
 * D8 — the shop's own Xero (PHASE-5.md §4): the conformance suite against a recorded fake of Xero's documented
 * answers, and what is Xero's own — the organisation the owner chose, a refresh token that rotates, Xero's refusals
 * named, and C4's write-back of posted entries as manual journals, never over one already there.
 */
const REDIRECT = 'https://app.example/app/books/xero/callback';

/**
 * What Xero holds of the books: no parent account; one journal of its own (manual journals); contacts without their
 * custom values (no notes a connector can write); a tax rate's TaxType as its code, its account the organisation's tax
 * account, and NO start date;
 * an entry only in the books' currency, its document its key; no custom fields (the values travel in Nomi's mark).
 */
const xeroHolds = (d: BooksData): BooksData => {
  const entries = d.entries.filter((e) => e.lines.every((l) => l.currency === 'MAD'))
    .map((e) => ({ ...e, journal: XERO_JOURNAL, documentRef: e.key, documentDate: null }));
  return {
    accounts: d.accounts.filter((a) => a.kind !== 'off_balance').map((a) => ({ ...a, parent: null })),
    journals: entries.length > 0 ? [{ code: XERO_JOURNAL, name: 'Xero', kind: 'general' }] : [],
    parties: d.parties.map(({ custom: _c, ...p }) => p),
    taxCodes: d.taxCodes.map((t) => ({ ...t, validFrom: null, validTo: null })),
    entries,
  };
};

const xero = xeroFake();
conformance({
  name: 'the shop\'s own Xero (Accounting API)',
  connector: xeroConnector({ client: XERO_CLIENT, fetch: xero.fetch }, 'MAD'),
  sample: SAMPLE_WITH_FIELDS,
  holds: xeroHolds,
  connectTo: (data) => { xero.publish(data); return { code: xero.code(), redirectUri: REDIRECT }; },
  refusedWith: { values: { code: 'a-code-xero-never-issued', redirectUri: REDIRECT }, reason: 'wrong_credentials' },
});

const fresh = () => { const f = xeroFake(); f.publish(SAMPLE_BOOKS); return { f, c: xeroConnector({ client: XERO_CLIENT, fetch: f.fetch }, 'MAD') }; };

describe('D8 · signing in to Xero', () => {
  it('the consent screen asks for offline access and the granular scopes an app made after 2 March 2026 uses — no more', () => {
    const u = new URL(xeroAuthorizeUrl(XERO_CLIENT, { redirectUri: REDIRECT, state: 'n0nce' }));
    expect(`${u.origin}${u.pathname}`).toBe('https://login.xero.com/identity/connect/authorize');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['accounting.contacts.read', 'accounting.manualjournals', 'accounting.settings.read', 'offline_access']);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: 'code', client_id: XERO_CLIENT.clientId, redirect_uri: REDIRECT, state: 'n0nce' });
  });

  it('the ONE organisation the owner chose — none, or several, is refused with its own reason, never guessed', async () => {
    const { f, c } = fresh();
    const one = await c.connect({ code: f.code(), redirectUri: REDIRECT });
    expect(one).toMatchObject({ kind: 'connected', source: { tenantName: 'Westlake Canvas Co.' }, grant: { expiresAt: null } });
    f.organisations(['Westlake Canvas Co.', 'Westlake Holdings']);
    const live = f.liveRefresh().length;
    expect(await c.connect({ code: f.code(), redirectUri: REDIRECT })).toEqual({ kind: 'refused', reason: 'several_organisations', retryable: false });
    // the grant that refused connection gave is given back at once: nothing stays open at Xero that Nomi does not hold
    expect(f.liveRefresh().length).toBe(live);
    f.organisations([]);
    expect(await c.connect({ code: f.code(), redirectUri: REDIRECT })).toMatchObject({ reason: 'source_missing' });
    // a code is used once
    f.organisations(['Westlake Canvas Co.']);
    const code = f.code();
    expect((await c.connect({ code, redirectUri: REDIRECT })).kind).toBe('connected');
    expect(await c.connect({ code, redirectUri: REDIRECT })).toMatchObject({ reason: 'wrong_credentials' });
  });

  it('the refresh token ROTATES: each use returns the next, the one before stops working — so the new one is the one kept', async () => {
    const { f, c } = fresh();
    const r = await c.connect({ code: f.code(), redirectUri: REDIRECT });
    if (r.kind !== 'connected') throw new Error('fixture');
    const next = await xeroAccess({ client: XERO_CLIENT, fetch: f.fetch }, r.grant!);
    if ('kind' in next) throw new Error('fixture');
    expect(next.grant.secret).not.toBe(r.grant!.secret);
    expect(f.liveRefresh()).toEqual([next.grant.secret]);
    expect(await c.refresh(r.grant!)).toEqual({ kind: 'refused', reason: 'revoked', retryable: false });
    expect('kind' in (await c.refresh(next.grant))).toBe(false);
  });

  it('Xero\'s refusals by their status, never its words: a wrong tenant, a token it no longer knows, the app disconnected', async () => {
    const { f, c } = fresh();
    const r = await c.connect({ code: f.code(), redirectUri: REDIRECT });
    if (r.kind !== 'connected') throw new Error('fixture');
    expect(await c.changedSince({ ...r.source, tenantId: '00000000-0000-4000-8000-000000000000' }, null)).toMatchObject({ reason: 'source_missing' });
    expect(await c.changedSince({ ...r.source, accessToken: 'eyJ.old.token' }, null)).toMatchObject({ reason: 'revoked' });
    await c.revoke(r.grant!);
    expect(f.liveRefresh()).toEqual([]);
    expect(await c.changedSince(r.source, null)).toMatchObject({ reason: 'revoked' });
    const silent = xeroConnector({ client: XERO_CLIENT, fetch: async () => { throw new Error('offline'); } }, 'MAD');
    expect(await silent.connect({ code: 'x', redirectUri: REDIRECT })).toEqual({ kind: 'refused', reason: 'unreachable', retryable: true });
  });
});

describe('D8 · what Xero holds', () => {
  it('a day as Xero writes it; the mark at the end of a text, through anything; nothing else taken for one', () => {
    expect(xeroDay('/Date(1775088000000+0000)/')).toBe('2026-04-02');
    expect(xeroDay('2026-04-02T00:00:00')).toBe('2026-04-02');
    expect(xeroDay('02/04/2026')).toBeNull();
    const m = xeroMark({ p: 'C001', c: { weight_kg: '2.5', note: 'تسليم' } });
    expect(readXeroMark(`Sacs en toile ${m}`)).toEqual({ rest: 'Sacs en toile', mark: { p: 'C001', c: { note: 'تسليم', weight_kg: '2.5' } } });
    expect(xeroMark({})).toBe('');
    expect(readXeroMark('Facture [12]')).toEqual({ rest: 'Facture [12]', mark: {} });
    expect(readXeroMark('[nomi:not-json]').mark).toEqual({});
  });

  it('an entry with a line in another currency is not held (manual journals have none); Xero\'s own journals read by their id', async () => {
    const { c } = fresh();
    expect(recordsOf(c.toBooks(c.fromBooks(SAMPLE_BOOKS)).data).filter((r) => r.kind === 'entry').map((r) => r.key)).toEqual(['VE-2026-1', 'row-17']);
    const own = c.toBooks({ baseCurrency: 'MAD', accounts: [{ Code: '200', Name: 'Sales', Class: 'REVENUE', Status: 'ACTIVE' }, { Code: '610', Name: 'Debtors', Class: 'ASSET', Status: 'ACTIVE' },
      { Code: '820', Name: 'GST', Class: 'LIABILITY', Status: 'ACTIVE', SystemAccount: 'GST' },
      { Code: '090', Name: 'Old', Class: 'ASSET', Status: 'ARCHIVED' }], contacts: [], taxRates: [{ Name: 'TVA 20', TaxType: 'OUTPUT2', EffectiveRate: '20.0000', CanApplyToRevenue: 'true', Status: 'ACTIVE' }],
      journals: [{ ManualJournalID: 'f1e2d3c4-0000-4000-8000-000000000001', Date: '/Date(1775088000000+0000)/', Status: 'POSTED', Narration: 'Opening balance',
        JournalLines: [{ AccountCode: '610', LineAmount: { number: '1200.50' }, TaxType: 'NONE' }, { AccountCode: '200', LineAmount: { number: '-1200.50' }, TaxType: 'OUTPUT2', Description: 'Sales' }] },
      { ManualJournalID: 'f1e2d3c4-0000-4000-8000-000000000002', Date: '/Date(1775088000000+0000)/', Status: 'VOIDED', Narration: 'Gone', JournalLines: [] }] });
    expect(own.problems).toEqual([]);
    expect(own.data.accounts.map((a) => a.code)).toEqual(['200', '610', '820']);
    expect(own.data.taxCodes).toEqual([{ code: 'OUTPUT2', label: 'TVA 20', rate: '20', kind: 'collected', account: '820', validFrom: null, validTo: null }]);
    expect(own.data.entries).toEqual([{ key: 'xero-f1e2d3c4-0000-4000-8000-000000000001', journal: XERO_JOURNAL, date: '2026-04-02', label: 'Opening balance',
      documentRef: 'xero-f1e2d3c4-0000-4000-8000-000000000001', documentDate: null, state: 'posted', lines: [
        { account: '610', party: null, taxCode: null, currency: 'MAD', debit: '1200.5', credit: null, label: null },
        { account: '200', party: null, taxCode: 'OUTPUT2', currency: 'MAD', debit: null, credit: '1200.5', label: 'Sales' }] }]);
  });

  it('CHANGED SINCE is Xero\'s own: manual journals asked If-Modified-Since the newest change read', async () => {
    const { f, c } = fresh();
    const r = await c.connect({ code: f.code(), redirectUri: REDIRECT });
    if (r.kind !== 'connected') throw new Error('fixture');
    const all = await c.changedSince(r.source, null);
    if (all.kind !== 'read') throw new Error('fixture');
    expect(all.cursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const none = await c.changedSince(r.source, all.cursor);
    expect(none.kind === 'read' && none.data.entries).toEqual([]);
    f.publish({ ...SAMPLE_BOOKS, entries: SAMPLE_BOOKS.entries.map((e) => (e.key === 'row-17' ? { ...e, label: 'BL 311, corrigé' } : e)) });
    const one = await c.changedSince(r.source, all.cursor);
    expect(one.kind === 'read' && one.data.entries.map((e) => e.key)).toEqual(['row-17']);
  });
});

describe('D8 · C4 — Nomi\'s posted entries into Xero, never over anything', () => {
  const entry = (key: string, account = '7111') => ({ key, date: '2026-05-02', label: `Facture ${key}`, custom: { project: 'Expo' },
    lines: [{ account: '3421', party: 'C001', taxCode: null, label: null, bookDebit: '120.50' as Decimal, bookCredit: '0' as Decimal, custom: { weight_kg: '2' } },
      { account, party: null, taxCode: 'TVA20', label: 'Sacs', bookDebit: '0' as Decimal, bookCredit: '120.50' as Decimal }] });
  const connected = async () => {
    const { f, c } = fresh();
    const r = await c.connect({ code: f.code(), redirectUri: REDIRECT });
    if (r.kind !== 'connected') throw new Error('fixture');
    return { f, c, s: r.source, deps: { client: XERO_CLIENT, fetch: f.fetch } };
  };

  it('a POSTED manual journal, the books\' own digits, Nomi\'s number and values in the mark — and read back as the same entry', async () => {
    const { f, c, s, deps } = await connected();
    const sent = await sendEntriesToXero(deps, s, 'MAD', [entry('VE-2026-7')]);
    expect(sent).toMatchObject({ conflicts: [], written: [{ key: 'VE-2026-7' }] });
    expect(f.created[0]!.idempotencyKey).toBe('nomi-VE-2026-7');
    expect(f.created[0]!.body).toMatchObject({ Status: 'POSTED', LineAmountTypes: 'NoTax', Date: '2026-05-02' });
    const back = await c.changedSince(s, null);
    if (back.kind !== 'read') throw new Error('fixture');
    expect(back.data.entries.find((e) => e.key === 'VE-2026-7')).toEqual({ key: 'VE-2026-7', journal: XERO_JOURNAL, date: '2026-05-02', label: 'Facture VE-2026-7',
      documentRef: 'VE-2026-7', documentDate: null, state: 'posted', custom: { project: 'Expo' }, lines: [
        { account: '3421', party: 'C001', taxCode: null, currency: 'MAD', debit: '120.5', credit: null, label: 'Facture VE-2026-7', custom: { weight_kg: '2' } },
        { account: '7111', party: null, taxCode: 'TVA20', currency: 'MAD', debit: null, credit: '120.5', label: 'Sacs' }] });
  });

  it('conflicts, each with its reason, nothing written for them: already there, an account Xero lacks, a system account, another currency', async () => {
    const { f, s, deps } = await connected();
    await sendEntriesToXero(deps, s, 'MAD', [entry('VE-2026-8')]);
    f.systemAccount('3421');
    const out = await sendEntriesToXero(deps, s, 'MAD', [entry('VE-2026-8'), entry('VE-2026-9', '9999'), entry('VE-2026-10')]);
    expect(out).toEqual({ written: [], conflicts: [
      { key: 'VE-2026-8', reason: 'already_in_xero', detail: 'VE-2026-8' }, { key: 'VE-2026-9', reason: 'no_account', detail: '9999' },
      { key: 'VE-2026-10', reason: 'refused', detail: 'VE-2026-10' }] });
    expect(await sendEntriesToXero(deps, s, 'EUR', [entry('VE-2026-11')])).toEqual({ written: [], conflicts: [{ key: 'VE-2026-11', reason: 'no_currency', detail: 'MAD' }] });
    expect(f.created).toHaveLength(1);
  });
});
