import type { OAuthFetch } from '../../src/connectors/oauth.js';

/**
 * B3 — a recorded fake of Google: the token endpoint and the Sheets calls the connector makes, answering with
 * the shapes Google documents (Sheets API v4: spreadsheets.create, values.batchUpdate, values.batchGet, and C4's
 * values.batchClear — values only, the sheets stay; OAuth 2.0
 * token and revoke). Like Google, it stores a RAW number as a double and gives it back as JSON's shortest digits; it
 * leaves out empty trailing cells and the `values` of an empty range. Recorded from the documentation; checked live
 * against Google on deploy day.
 */
export type GoogleFake = {
  readonly fetch: OAuthFetch;
  /** The owner withdrew the grant (Google account → Security → third-party access). */
  revoke(): void;
  /** The spreadsheet was deleted in Drive. */
  drop(id: string): void;
  /** A sheet's rows, as stored. */
  rows(id: string, sheet: string): readonly (readonly unknown[])[];
  /** Delete a row as a person would in Sheets (the rows below move up). */
  deleteRow(id: string, sheet: string, row: number): void;
  /** Set a cell as a person would type it in Sheets (a number, a text). */
  type(id: string, sheet: string, row: number, col: number, value: string | number): void;
  /** Grant without drive.file (the owner unticked it on the consent screen). */
  withoutScope(): void;
  readonly calls: string[];
};

const ok = (body: unknown) => ({ status: 200, text: async () => JSON.stringify(body) });
const err = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
const UNAUTH = { error: { code: 401, message: 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.', status: 'UNAUTHENTICATED' } };
const NOT_FOUND = { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } };

export function googleFake(): GoogleFake {
  let revoked = false;
  let scope = 'https://www.googleapis.com/auth/drive.file';
  const live = new Set(['ya29.first', 'ya29.refreshed']);
  const books = new Map<string, Map<string, unknown[][]>>();
  const calls: string[] = [];
  let n = 0;
  const authorised = (h: Record<string, string>) => !revoked && live.has((h['Authorization'] ?? '').replace(/^Bearer /, ''));
  const fetch: OAuthFetch = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.host}${u.pathname}`);
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const f = new URLSearchParams(init.body ?? '');
      if (f.get('grant_type') === 'authorization_code') {
        // a PKCE verifier is 43–128 characters of base64url (RFC 7636 §4.1); the unit tests' short one is accepted by name
        const verifier = f.get('code_verifier') ?? '';
        if (f.get('code') !== 'good-code' || !(verifier === 'the-verifier' || /^[A-Za-z0-9_-]{32,128}$/.test(verifier))) {
          return err(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        }
        revoked = false;   // a new consent is a new grant
        return ok({ access_token: 'ya29.first', expires_in: 3599, refresh_token: '1//refresh-token', scope, token_type: 'Bearer' });
      }
      if (f.get('grant_type') === 'refresh_token') {
        if (revoked || f.get('refresh_token') !== '1//refresh-token') return err(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        return ok({ access_token: 'ya29.refreshed', expires_in: 3599, scope, token_type: 'Bearer' });
      }
      return err(400, { error: 'unsupported_grant_type' });
    }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') { revoked = true; return ok({}); }
    if (u.host !== 'sheets.googleapis.com') return err(404, NOT_FOUND);
    if (!authorised(init.headers)) return err(401, UNAUTH);
    if (init.method === 'POST' && u.pathname === '/v4/spreadsheets') {
      const body = JSON.parse(init.body ?? '{}') as { properties: { title: string }; sheets: { properties: { title: string } }[] };
      const id = `1Nomi${String(++n).padStart(6, '0')}AbCdEfGhIjKlMnOpQrStUv`;
      books.set(id, new Map(body.sheets.map((s) => [s.properties.title, []])));
      return ok({ spreadsheetId: id, properties: body.properties, sheets: body.sheets.map((s, i) => ({ properties: { sheetId: i, title: s.properties.title } })),
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` });
    }
    const m = /^\/v4\/spreadsheets\/([^/]+)\/values:(batchUpdate|batchGet|batchClear)$/.exec(u.pathname);
    if (!m) return err(404, NOT_FOUND);
    const book = books.get(decodeURIComponent(m[1]!));
    if (!book) return err(404, NOT_FOUND);
    const tabOf = (r: string) => r.replace(/!.*$/, '').replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    if (m[2] === 'batchClear') {
      const body = JSON.parse(init.body ?? '{}') as { ranges: string[] };
      for (const r of body.ranges) if (book.has(tabOf(r))) book.set(tabOf(r), []);
      return ok({ spreadsheetId: m[1], clearedRanges: body.ranges });
    }
    if (m[2] === 'batchUpdate') {
      // RAW: a JSON number is stored as a double, a string as a string
      const body = JSON.parse(init.body ?? '{}') as { valueInputOption: string; data: { range: string; values: unknown[][] }[] };
      if (body.valueInputOption !== 'RAW') return err(400, { error: { code: 400, message: 'expected RAW', status: 'INVALID_ARGUMENT' } });
      for (const d of body.data) book.set(tabOf(d.range), d.values.map((r) => [...r]));
      return ok({ spreadsheetId: m[1], totalUpdatedSheets: body.data.length, responses: [] });
    }
    if (u.searchParams.get('valueRenderOption') !== 'UNFORMATTED_VALUE') return err(400, { error: { code: 400, message: 'test expects UNFORMATTED_VALUE', status: 'INVALID_ARGUMENT' } });
    return ok({ spreadsheetId: m[1], valueRanges: u.searchParams.getAll('ranges').map((r) => {
      const rows = (book.get(tabOf(r)) ?? []).map((row) => {
        const cells = row.map((c) => (c === null ? '' : c));
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        return cells;
      });
      while (rows.length > 0 && rows[rows.length - 1]!.length === 0) rows.pop();
      return rows.length > 0 ? { range: `${r}!A1:Z${rows.length}`, majorDimension: 'ROWS', values: rows } : { range: `${r}!A1:Z1000`, majorDimension: 'ROWS' };
    }) });
  };
  return {
    fetch, calls,
    revoke: () => { revoked = true; },
    drop: (id) => { books.delete(id); },
    rows: (id, sheet) => books.get(id)?.get(sheet) ?? [],
    deleteRow: (id, sheet, row) => { books.get(id)!.get(sheet)!.splice(row - 1, 1); },
    withoutScope: () => { scope = 'openid'; },
    type: (id, sheet, row, col, value) => {
      const tab = books.get(id)!.get(sheet)!;
      while (tab.length < row) tab.push([]);
      const r = tab[row - 1]!;
      while (r.length < col) r.push('');
      r[col - 1] = value;
    },
  };
}
