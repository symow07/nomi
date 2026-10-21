import { endpointFor, refreshAccessToken, OAUTH_TIMEOUT_MS, type OAuthClient, type OAuthFetch } from '../../connectors/oauth.js';
import { refused, type BooksConnector, type ConnectRefusal, type Grant } from '../../core/books/connector.js';
import type { BooksData } from '../../core/books/interchange.js';
import type { XlsxCell, XlsxSheet, XlsxValue } from '../../net/xlsx.js';
import { SHEETS, isTheNomiWorkbook, sheetsToBooks, workbookSheets } from './excel.js';

/**
 * B3 (Phase 5, §5 option B) — THE NOMI WORKBOOK IN THE OWNER'S GOOGLE SHEETS. The same sheets and columns as the file
 * (B2), read and written through the Sheets API, with ONE scope: `drive.file` — this app sees only the spreadsheet it
 * made, never the rest of the owner's Drive. Google calls the scope non-sensitive: no verification is needed.
 *
 *   connect     the OAuth code (PKCE), exchanged for a refresh token; refused unless `drive.file` was granted and a
 *               refresh token came back. The spreadsheet is made after (`createSpreadsheet`), with the books in it.
 *   read        values:batchGet, UNFORMATTED (numbers as numbers, dates as serials), parsed so no number ever passes
 *               through a float: the response's own digits are kept, then read like a number cell (B2).
 *   refused     a revoked or expired grant is "connect again" (`revoked`) — never empty books; a spreadsheet deleted
 *               or no longer reachable is `source_missing`; Google busy or down is `unreachable`.
 *
 * Writing an existing spreadsheet again would overwrite what the owner typed in it: that is C4's (conflicts shown,
 * never overwritten). B3 writes once, into the spreadsheet it creates.
 *
 * Built and tested against a recorded fake of Google's responses (tests/books-connectors/sheets.test.ts); proven live
 * on deploy day, when the installation has its Google client (SHEETS_CLIENT_ID / SHEETS_CLIENT_SECRET — D18 stops
 * the boot until the privacy page names Google Sheets).
 */

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const TABS = [SHEETS.about, SHEETS.accounts, SHEETS.journals, SHEETS.parties, SHEETS.taxCodes, SHEETS.journal] as const;

export type SheetsDeps = { readonly client: OAuthClient; readonly fetch: OAuthFetch };
export type SheetsSource = { readonly accessToken: string; readonly spreadsheetId: string | null };

type Answer = { readonly status: number; readonly text: string } | null;
async function call(deps: SheetsDeps, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<Answer> {
  try {
    const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS) });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}
const bearer = (token: string, json = false): Record<string, string> =>
  ({ Authorization: `Bearer ${token}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) });

/** What an API answer means for the books: a refusal by its status, or null when it is an answer to read. */
function refusalOf(a: Answer): ConnectRefusal | null {
  if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
  if (a.status === 401) return refused('revoked');
  if (a.status === 403 || a.status === 404) return refused('source_missing');
  if (a.status !== 200) return refused('unreadable');
  return null;
}

/**
 * JSON whose numbers keep their own digits: `{ number: "33.34" }`, never 33.34 as a float. Uses the parser's source
 * text (V8's JSON.parse source access); where that is missing, the answer is unreadable rather than read loosely.
 */
function parseExact(text: string): unknown {
  return JSON.parse(text, function (this: unknown, _k: string, v: unknown, ctx?: { source?: string }) {
    if (typeof v !== 'number') return v;
    if (!ctx || typeof ctx.source !== 'string') throw new Error('sheets: numbers cannot be read exactly here');
    return { number: ctx.source };
  } as (this: unknown, k: string, v: unknown) => unknown);
}

/** The body for the API, with each `{ number }` written as the JSON number it is — its digits, not a float's. */
function bodyWithNumbers(v: unknown): string {
  const MARK = '\u0000n';
  const text = JSON.stringify(v, (_k, x: unknown) =>
    (x && typeof x === 'object' && 'number' in x && typeof (x as { number: unknown }).number === 'string' ? `${MARK}${(x as { number: string }).number}` : x));
  return text.replace(/"\\u0000n(-?\d+(?:\.\d+)?)"/g, '$1');
}

const range = (tab: string): string => `'${tab.replace(/'/g, "''")}'`;

/** The spreadsheet's values as the workbook's sheets, cell by cell. */
function sheetsOf(valueRanges: unknown): XlsxSheet[] | null {
  if (!Array.isArray(valueRanges) || valueRanges.length !== TABS.length) return null;
  return TABS.map((name, i) => {
    const rows = new Map<number, XlsxCell[]>();
    const values = (valueRanges[i] as { values?: unknown } | undefined)?.values;
    (Array.isArray(values) ? values : []).forEach((row: unknown, r: number) => {
      const cells = (Array.isArray(row) ? row : []).map((c: unknown): XlsxCell =>
        c && typeof c === 'object' && 'number' in c ? { text: String((c as { number: string }).number), number: true }
          : typeof c === 'boolean' ? { text: c ? 'TRUE' : 'FALSE', number: false }
          : { text: typeof c === 'string' ? c.trim() : '', number: false });
      if (cells.some((x) => x.text !== '')) rows.set(r + 1, cells);
    });
    return { name, rows };
  });
}

/** Read the Nomi spreadsheet: its six sheets, unformatted, dates as serial numbers (Sheets counts as Excel's 1900 does). */
async function readSpreadsheet(deps: SheetsDeps, source: SheetsSource): Promise<{ sheets: XlsxSheet[] } | ConnectRefusal> {
  if (!source.spreadsheetId) return refused('source_missing');
  const q = new URLSearchParams([...TABS.map((t) => ['ranges', range(t)]), ['majorDimension', 'ROWS'],
    ['valueRenderOption', 'UNFORMATTED_VALUE'], ['dateTimeRenderOption', 'SERIAL_NUMBER']]);
  const a = await call(deps, `${API}/${encodeURIComponent(source.spreadsheetId)}/values:batchGet?${q.toString()}`,
    { method: 'GET', headers: bearer(source.accessToken) });
  const no = refusalOf(a);
  if (no) return no;
  let parsed: unknown;
  try { parsed = parseExact(a!.text); } catch { return refused('unreadable'); }
  const sheets = sheetsOf((parsed as { valueRanges?: unknown } | null)?.valueRanges);
  if (!sheets) return refused('unreadable');
  if (!isTheNomiWorkbook(sheets)) return refused('not_a_nomi_workbook');
  return { sheets };
}

/** The books into a NEW spreadsheet the app makes (the only kind `drive.file` lets it touch), and its address. */
export async function createSpreadsheet(deps: SheetsDeps, accessToken: string, title: string, d: BooksData):
  Promise<{ readonly kind: 'created'; readonly spreadsheetId: string; readonly url: string } | ConnectRefusal> {
  const made = await call(deps, API, { method: 'POST', headers: bearer(accessToken, true),
    body: JSON.stringify({ properties: { title }, sheets: TABS.map((t) => ({ properties: { title: t } })) }) });
  const no = refusalOf(made);
  if (no) return no.reason === 'source_missing' ? refused('revoked') : no;
  let id: unknown; let url: unknown;
  try { ({ spreadsheetId: id, spreadsheetUrl: url } = JSON.parse(made!.text) as { spreadsheetId?: unknown; spreadsheetUrl?: unknown }); } catch { return refused('unreadable'); }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) return refused('unreadable');
  const sheets = workbookSheets(d);
  const values = (rows: readonly (readonly XlsxValue[])[]) => rows.map((r) => r.map((c) => (c === null ? '' : c)));
  const wrote = await call(deps, `${API}/${encodeURIComponent(id)}/values:batchUpdate`, { method: 'POST', headers: bearer(accessToken, true),
    body: bodyWithNumbers({ valueInputOption: 'RAW', data: sheets.map((s) => ({ range: `${range(s.name)}!A1`, majorDimension: 'ROWS', values: values(s.rows) })) }) });
  const notWritten = refusalOf(wrote);
  if (notWritten) return notWritten;
  return { kind: 'created', spreadsheetId: id, url: typeof url === 'string' && url.startsWith('https://docs.google.com/') ? url : `https://docs.google.com/spreadsheets/d/${id}` };
}

/** The connector (B1's shape). Its `connect` exchanges the OAuth code; the books' pages hold the rest of the flow. */
export function sheetsConnector(deps: SheetsDeps, bookCurrency: string): BooksConnector<SheetsSource, readonly XlsxSheet[]> {
  return {
    config: {
      system: 'sheets', signIn: 'oauth',
      fields: [{ name: 'code', kind: 'secret', required: true }, { name: 'verifier', kind: 'secret', required: true },
        { name: 'redirectUri', kind: 'url', required: true }, { name: 'spreadsheet', kind: 'text', required: false }],
    },
    async connect(values) {
      const [code, verifier, redirectUri] = [values['code'], values['verifier'], values['redirectUri']];
      if (typeof code !== 'string' || typeof verifier !== 'string' || typeof redirectUri !== 'string') return refused('wrong_credentials');
      const a = await call(deps, endpointFor('google', deps.client, 'token'), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
          client_id: deps.client.clientId, client_secret: deps.client.clientSecret, code_verifier: verifier }).toString() });
      if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
      if (a.status !== 200) return refused('wrong_credentials');
      let j: Record<string, unknown>;
      try { j = JSON.parse(a.text) as Record<string, unknown>; } catch { return refused('unreadable'); }
      const scopes = typeof j['scope'] === 'string' ? j['scope'].split(/\s+/) : [];
      // Without the one scope, or without a refresh token, nothing could be read tomorrow: refused now.
      if (!scopes.includes(SHEETS_SCOPE) || typeof j['refresh_token'] !== 'string' || typeof j['access_token'] !== 'string') return refused('wrong_credentials');
      const spreadsheet = typeof values['spreadsheet'] === 'string' && values['spreadsheet'] ? values['spreadsheet'] : null;
      return { kind: 'connected', source: { accessToken: j['access_token'], spreadsheetId: spreadsheet }, grant: { secret: j['refresh_token'], expiresAt: null } };
    },
    async refresh(grant: Grant) {
      const r = await refreshAccessToken('google', deps.client, grant.secret, deps.fetch);
      if (!r.ok) return refused(r.reason === 'unavailable' ? 'unreachable' : 'revoked');
      return grant;
    },
    async revoke(grant: Grant) {
      await call(deps, REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: grant.secret }).toString() });
    },
    toBooks: (raw) => sheetsToBooks({ sheets: raw, date1904: false }, bookCurrency),
    fromBooks: (d) => workbookSheets(d).map((s) => ({ name: s.name, rows: new Map(s.rows.map((r, i) => [i + 1, r.map((c): XlsxCell =>
      (c === null ? { text: '', number: false } : typeof c === 'object' ? { text: c.number, number: true } : { text: c, number: false }))] as const)
      .filter(([, cells]) => cells.some((c) => c.text !== ''))) })),
    async changedSince(source) {
      const read = await readSpreadsheet(deps, source);
      if ('kind' in read) return read;
      const { data, problems, where } = sheetsToBooks({ sheets: read.sheets, date1904: false }, bookCurrency);
      return { kind: 'read', data, problems, where, cursor: null };
    },
  };
}

/** A grant held, turned into an access token for one read: refused as `revoked` when Google no longer honours it. */
export async function sheetsAccess(deps: SheetsDeps, grant: Grant): Promise<{ readonly accessToken: string } | ConnectRefusal> {
  const r = await refreshAccessToken('google', deps.client, grant.secret, deps.fetch);
  if (!r.ok) return refused(r.reason === 'unavailable' ? 'unreachable' : 'revoked');
  return { accessToken: r.accessToken };
}

/** Where the owner is sent to grant `drive.file`, and nothing else; offline, so a refresh token comes back. */
export function sheetsAuthorizeUrl(client: OAuthClient, o: { readonly redirectUri: string; readonly state: string; readonly challenge: string }): string {
  const p = new URLSearchParams({
    client_id: client.clientId, redirect_uri: o.redirectUri, response_type: 'code', scope: SHEETS_SCOPE, state: o.state,
    code_challenge: o.challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
  });
  return `${endpointFor('google', client, 'authorize')}?${p.toString()}`;
}
