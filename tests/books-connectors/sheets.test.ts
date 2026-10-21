import { describe, it, expect } from 'vitest';
import { createSpreadsheet, sheetsAccess, sheetsConnector } from '../../src/books/connectors/sheets.js';
import { recordsOf } from '../../src/core/books/interchange.js';
import { conformance } from './conformance.js';
import { googleFake } from './google-fake.js';
import { SAMPLE_BOOKS } from './sample.js';

/**
 * B3 — the Nomi workbook in Google Sheets (PHASE-5.md §4): the same workbook through the API with `drive.file`; a
 * revoked grant reads as "connect again", never as empty books. Against the recorded fake (./google-fake.ts).
 */
const client = { clientId: 'nomi-test.apps.googleusercontent.com', clientSecret: 'test-secret' };
const SIGN_IN = { code: 'good-code', verifier: 'the-verifier', redirectUri: 'https://app.example/app/books/sheets/callback' };

const google = googleFake();
const deps = { client, fetch: google.fetch };
const connector = sheetsConnector(deps, 'MAD');
conformance({
  name: 'the Nomi workbook in Google Sheets',
  connector,
  sample: SAMPLE_BOOKS,
  connectTo: async (data) => {
    const signedIn = await connector.connect(SIGN_IN);
    if (signedIn.kind !== 'connected') throw new Error(signedIn.reason);
    const made = await createSpreadsheet(deps, signedIn.source.accessToken, 'Nomi books', data);
    if (made.kind !== 'created') throw new Error(made.reason);
    return { ...SIGN_IN, spreadsheet: made.spreadsheetId };
  },
  refusedWith: { values: { ...SIGN_IN, code: 'a-code-google-does-not-know' }, reason: 'wrong_credentials' },
});

describe('B3 · what Google says, and what the books make of it', () => {
  const fresh = async () => {
    const g = googleFake();
    const d = { client, fetch: g.fetch };
    const made = await createSpreadsheet(d, 'ya29.first', 'Nomi books', SAMPLE_BOOKS);
    if (made.kind !== 'created') throw new Error(made.reason);
    return { g, d, id: made.spreadsheetId, url: made.url, sheets: sheetsConnector(d, 'MAD') };
  };

  it('one scope only — drive.file; granted without it, nothing is connected', async () => {
    const g = googleFake();
    g.withoutScope();
    expect(await sheetsConnector({ client, fetch: g.fetch }, 'MAD').connect(SIGN_IN)).toEqual({ kind: 'refused', reason: 'wrong_credentials', retryable: false });
  });

  it('the spreadsheet it makes holds the books, at its Google address, numbers as numbers and codes as text', async () => {
    const { g, id, url, sheets } = await fresh();
    expect(url).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`);
    expect(g.calls.filter((c) => c.startsWith('POST sheets'))).toEqual(['POST sheets.googleapis.com/v4/spreadsheets', `POST sheets.googleapis.com/v4/spreadsheets/${id}/values:batchUpdate`]);
    const read = await sheets.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null);
    if (read.kind !== 'read') throw new Error(read.reason);
    expect(read.problems).toEqual([]);
    expect(recordsOf(read.data)).toEqual(recordsOf(SAMPLE_BOOKS));
  });

  it('what the owner types in Sheets is read exactly: a figure as a number, a date as Sheets\' serial', async () => {
    const { g, id, sheets } = await fresh();
    g.type(id, 'Journal', 2, 12, 1440.6);          // Debit, typed again as a number
    g.type(id, 'Journal', 2, 3, 46114);            // Date: 2026-04-02 as Sheets' serial
    const read = await sheets.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null);
    if (read.kind !== 'read') throw new Error(read.reason);
    expect(read.problems).toEqual([]);
    expect(recordsOf(read.data)).toEqual(recordsOf(SAMPLE_BOOKS));
  });

  it('A REVOKED GRANT reads as "connect again" — never as empty books', async () => {
    const { g, d, id, sheets } = await fresh();
    g.revoke();
    expect(await sheetsAccess(d, { secret: '1//refresh-token', expiresAt: null })).toEqual({ kind: 'refused', reason: 'revoked', retryable: false });
    const read = await sheets.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null);
    expect(read).toEqual({ kind: 'refused', reason: 'revoked', retryable: false });
  });

  it('a spreadsheet deleted in Drive is said so; Google down is "try later", and only that', async () => {
    const { g, id, sheets } = await fresh();
    g.drop(id);
    expect(await sheets.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null)).toEqual({ kind: 'refused', reason: 'source_missing', retryable: false });
    const down = sheetsConnector({ client, fetch: async () => ({ status: 503, text: async () => '' }) }, 'MAD');
    expect(await down.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null)).toEqual({ kind: 'refused', reason: 'unreachable', retryable: true });
  });

  it('a spreadsheet that is not the Nomi workbook is refused as such', async () => {
    const { g, id, sheets } = await fresh();
    g.type(id, 'Nomi', 1, 1, 'My own sheet');
    expect(await sheets.changedSince({ accessToken: 'ya29.first', spreadsheetId: id }, null)).toEqual({ kind: 'refused', reason: 'not_a_nomi_workbook', retryable: false });
  });

  it('a number Google sends with a double\'s tail is read at the sheet\'s precision, never through a float', async () => {
    const tail = sheetsConnector({ client, fetch: async (url) => {
      if (!url.includes('batchGet')) return { status: 404, text: async () => '' };
      const rows = (h: string[], ...r: unknown[][]) => ({ values: [h, ...r] });
      return { status: 200, text: async () => JSON.stringify({ valueRanges: [
        { values: [['Nomi workbook', '1']] },
        rows(['Code', 'Name', 'Kind', 'Parent'], ['5141', 'Banque', 'asset'], ['7111', 'Ventes', 'income']),
        rows(['Code', 'Name', 'Kind'], ['BQ', 'Banque', 'bank']),
        rows(['Code', 'Name', 'Kind', 'Country', 'ICE', 'Tax number']),
        rows(['Code', 'Label', 'Rate', 'Kind', 'Account', 'Valid from', 'Valid to']),
        rows(['Entry', 'Journal', 'Date', 'Label', 'Document', 'Document date', 'State', 'Account', 'Party', 'Tax code', 'Currency', 'Debit', 'Credit', 'Line label'],
          ['e1', 'BQ', '2026-04-09', 'Virement', '', '', '', '5141', '', '', 'MAD', 'NUM', '', ''],
          ['e1', '', '', '', '', '', '', '7111', '', '', 'MAD', '', 33.34, '']),
      ] }).replace('"NUM"', '33.340000000000003') };
    } }, 'MAD');
    const read = await tail.changedSince({ accessToken: 'x', spreadsheetId: '1NomiTestSheet000000' }, null);
    if (read.kind !== 'read') throw new Error(read.reason);
    expect(read.problems).toEqual([]);
    expect(read.data.entries[0]!.lines.map((l) => l.debit ?? l.credit)).toEqual(['33.34', '33.34']);
  });
});
