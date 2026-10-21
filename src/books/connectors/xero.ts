import { OAUTH_TIMEOUT_MS, type OAuthFetch } from '../../connectors/oauth.js';
import { refused, type BooksConnector, type ConnectRefusal, type Grant, type Located } from '../../core/books/connector.js';
import {
  booksProblems, taxCodeKey, type BooksAccount, type BooksData, type BooksEntry, type BooksLine, type BooksParty, type BooksProblem,
  type BooksTaxCode, type CustomValues, type RecordKind,
} from '../../core/books/interchange.js';
import type { Decimal } from '../../core/types/decimal.js';
import { excelNumber } from './excel.js';
import { parseExact } from './exactJson.js';

/**
 * D8 (Phase 5, item 12; decision 4) — THE SHOP'S OWN XERO, over its Accounting API, with our own client: OAuth 2.0
 * (the web app's code flow, the client's secret in a Basic header), then `/connections` for the organisation, then
 * the API with `xero-tenant-id`. Everything here is read from Xero's developer documentation (2026-10-22; the extracts
 * in the session's notes), and built against a recorded fake of those answers (tests/books-connectors/xero-fake.ts).
 * Live on deploy day, within the free tier (Starter: 5 connections).
 *
 * SIGN-IN
 *   · scopes: `offline_access` (else no refresh token) and the granular ones an app made after 2 March 2026 must use —
 *     `accounting.settings.read` (accounts, tax rates, the organisation), `accounting.contacts.read`, and
 *     `accounting.manualjournals` (read, and C4's write);
 *   · the organisation is the ONE the owner chose on Xero's consent screen: `/connections` filtered by the token's own
 *     `authentication_event_id`, tenant type ORGANISATION. None is `source_missing`; several, `several_organisations`
 *     (connect again choosing one) — never a guess;
 *   · tokens: the access token lasts 30 minutes; the refresh token 60 days, and it ROTATES — every refresh returns a
 *     new one and the old stops working (after a 30-minute grace). So a refresh's new token is kept before anything
 *     else is done (src/db/booksConnections.ts `rotateGrant`); an `invalid_grant` is `revoked`, connect again.
 *
 * WHAT XERO HOLDS OF THE BOOKS, said in the open (tests/books-connectors/xero.test.ts `xeroHolds`):
 *   · ACCOUNTS: a code of at most 10, a name, a class (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE) — no parent. Only
 *     ACTIVE ones (an archived account takes nothing);
 *   · CONTACTS: Nomi's party code is the contact's `ContactNumber`; the ICE is its `CompanyNumber`, the tax number its
 *     `TaxNumber`. Customer or supplier is Xero's own reading of the contact's transactions. A contact has no notes a
 *     connector can write (History is append-only): a party's custom values do not travel to Xero;
 *   · TAX RATES: its `TaxType` is the code; its account is the organisation's tax account (the one whose
 *     `SystemAccount` is "GST": Xero's "GST / VAT"); NO START DATE (as Odoo: the owner confirms the day, C0);
 *   · ENTRIES: Xero's manual journals. No journals of its own: every one reads as Xero's ("XERO"). In the books'
 *     currency only — Xero's manual journals have no currency — so an entry with a line in another currency is not
 *     held by the mapping, and C4 sends Nomi's converted amounts. A line names no contact in Xero: Nomi's party, the
 *     line's tax code and the custom values travel in Nomi's mark, `[nomi:…]` (JSON in URL-safe base64), at the end
 *     of the narration (the entry's key and values) and of each line's description. Debits are positive, credits
 *     negative (Xero's convention). Amounts are read from Xero's own digits, never through a float.
 */

export const XERO_SCOPES = ['offline_access', 'accounting.settings.read', 'accounting.contacts.read', 'accounting.manualjournals'] as const;
const AUTHORIZE = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
const REVOKE = 'https://identity.xero.com/connect/revocation';
const CONNECTIONS = 'https://api.xero.com/connections';
const API = 'https://api.xero.com/api.xro/2.0';
/** Every entry read from Xero is in this journal: Xero has manual journals, and no journals of its own. */
export const XERO_JOURNAL = 'XERO';
const PAGE = 100;

export type XeroClient = { readonly clientId: string; readonly clientSecret: string };
export type XeroDeps = { readonly client: XeroClient; readonly fetch: OAuthFetch };
export type XeroSource = { readonly accessToken: string; readonly tenantId: string; readonly tenantName?: string };

/** The raw records, as Xero's JSON gives them (numbers kept as their digits), and as the mapping writes them back. */
export type XeroRaw = {
  readonly baseCurrency: string;
  readonly accounts: readonly Record<string, unknown>[];
  readonly contacts: readonly Record<string, unknown>[];
  readonly taxRates: readonly Record<string, unknown>[];
  readonly journals: readonly Record<string, unknown>[];
};

type Answer = { readonly status: number; readonly text: string } | null;
async function call(deps: XeroDeps, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<Answer> {
  try {
    const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS) });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}
const basic = (c: XeroClient) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`;
const api = (s: XeroSource, json = false): Record<string, string> => ({
  Authorization: `Bearer ${s.accessToken}`, 'xero-tenant-id': s.tenantId, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}),
});

/** An API answer: a refusal by its status (Xero's words are never repeated), or null to read on. */
function refusalOf(a: Answer): ConnectRefusal | null {
  if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
  if (a.status === 401) return refused('revoked');
  // 403 "AuthenticationUnsuccessful": the organisation disconnected the app, or was deleted.
  if (a.status === 403) return refused('source_missing');
  if (a.status !== 200) return refused('unreadable');
  return null;
}

/** The token endpoint, for a code or a refresh token: the pair, or why not. */
async function tokens(deps: XeroDeps, body: Record<string, string>): Promise<{ readonly access: string; readonly refresh: string } | ConnectRefusal> {
  const a = await call(deps, TOKEN, { method: 'POST',
    headers: { Authorization: basic(deps.client), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString() });
  if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
  // invalid_grant: a code used or expired, a refresh token rotated away or revoked — the owner connects again.
  if (a.status !== 200) return refused(body['grant_type'] === 'refresh_token' ? 'revoked' : 'wrong_credentials');
  let j: Record<string, unknown>;
  try { j = JSON.parse(a.text) as Record<string, unknown>; } catch { return refused('unreadable'); }
  if (typeof j['access_token'] !== 'string' || typeof j['refresh_token'] !== 'string') return refused('wrong_credentials');
  return { access: j['access_token'], refresh: j['refresh_token'] };
}

/** The access token's own `authentication_event_id` (a JWT claim): which consent this token came from. */
function authEventOf(accessToken: string): string | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    const id = claims['authentication_event_id'];
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}

/** A refresh token given back: Xero removes the app's connections the owner made with it. */
async function revokeToken(deps: XeroDeps, token: string): Promise<void> {
  await call(deps, REVOKE, { method: 'POST', headers: { Authorization: basic(deps.client), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString() });
}

/** Where the owner is sent to let Nomi in, and choose the organisation. */
export function xeroAuthorizeUrl(client: XeroClient, o: { readonly redirectUri: string; readonly state: string }): string {
  return `${AUTHORIZE}?${new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: o.redirectUri,
    scope: XERO_SCOPES.join(' '), state: o.state }).toString()}`;
}

/** A grant held, refreshed into an access token for one use — and the NEW grant, which the caller keeps first. */
export async function xeroAccess(deps: XeroDeps, grant: Grant): Promise<{ readonly accessToken: string; readonly grant: Grant } | ConnectRefusal> {
  const t = await tokens(deps, { grant_type: 'refresh_token', refresh_token: grant.secret });
  if ('kind' in t) return t;
  return { accessToken: t.access, grant: { secret: t.refresh, expiresAt: null } };
}

// ── the mark ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type EntryMark = { readonly k?: string; readonly c?: CustomValues };
type LineMark = { readonly p?: string; readonly t?: string; readonly c?: CustomValues };
const MARK_IN = /\s*\[nomi:([A-Za-z0-9_-]+)\]/;
const sortedValues = (c: CustomValues | undefined) => (c && Object.keys(c).length > 0 ? Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b))) : undefined);
/** Nomi's mark: only what is there, as JSON in URL-safe base64 ("" when there is nothing to say). */
export function xeroMark(m: EntryMark | LineMark): string {
  const kept = Object.fromEntries(Object.entries({ ...m, c: sortedValues(m.c) }).filter(([, v]) => v !== undefined && v !== null));
  return Object.keys(kept).length === 0 ? '' : `[nomi:${Buffer.from(JSON.stringify(kept)).toString('base64url')}]`;
}
/** A text, and the mark at its end read back (anything that is not Nomi's mark, of texts, is no mark). */
export function readXeroMark(text: string | null): { readonly rest: string | null; readonly mark: Record<string, unknown> } {
  const m = text === null ? null : MARK_IN.exec(text);
  if (!m || text === null) return { rest: text, mark: {} };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let v: unknown = null;
  try { v = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')); } catch { v = null; }
  return { rest: rest === '' ? null : rest, mark: v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {} };
}
const textOf = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const valuesOf = (v: unknown): CustomValues | undefined =>
  (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string') ? sortedValues(v as CustomValues) : undefined);

// ── the mapping ──────────────────────────────────────────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): Decimal | null =>
  (v && typeof v === 'object' && 'number' in v ? excelNumber((v as { number: string }).number) : typeof v === 'string' ? excelNumber(v.trim()) : null);
/** Xero's "/Date(1486166400000+0000)/" as the day it names (UTC); a plain day as it is. */
export function xeroDay(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(v);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}
const KIND_OF_CLASS: Record<string, BooksAccount['kind']> = { ASSET: 'asset', LIABILITY: 'liability', EQUITY: 'equity', REVENUE: 'income', EXPENSE: 'expense' };
const TYPE_OF_KIND: Record<BooksAccount['kind'], [string, string] | null> = {
  asset: ['CURRENT', 'ASSET'], liability: ['CURRLIAB', 'LIABILITY'], equity: ['EQUITY', 'EQUITY'], income: ['REVENUE', 'REVENUE'], expense: ['EXPENSE', 'EXPENSE'],
  off_balance: null,
};
const CODE = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;
const TAX_CODE = /^[A-Z0-9_-]{1,12}$/;

/** Xero's records as the books (B1's shape), every problem located at its object and Xero id. */
export function xeroToBooks(raw: XeroRaw, bookCurrency: string): { data: BooksData; problems: BooksProblem[]; where: Located } {
  const problems: BooksProblem[] = [];
  const at = new Map<string, { sheet: string; row: number }>();
  const lineAt = new Map<string, number[]>();
  const note = (kind: RecordKind, key: string, object: string) => at.set(`${kind}:${key}`, { sheet: object, row: 0 });
  const bad = (object: string, column: string, reason: BooksProblem['reason']) => problems.push({ sheet: object, row: 0, column, reason });

  const accounts: BooksAccount[] = [];
  for (const a of raw.accounts) {
    if (a['Status'] !== undefined && a['Status'] !== 'ACTIVE') continue;
    const code = str(a['Code']); const kind = KIND_OF_CLASS[String(a['Class'] ?? '')];
    if (!code || !CODE.test(code)) { bad(`Account ${str(a['Name']) ?? ''}`, 'Code', 'bad_code'); continue; }
    if (!kind) { bad(`Account ${code}`, 'Class', 'unknown_kind'); continue; }
    accounts.push({ code, name: str(a['Name']) ?? code, kind, parent: null });
    note('account', code, 'Account');
  }
  const parties: BooksParty[] = [];
  for (const c of raw.contacts) {
    if (c['ContactStatus'] !== undefined && c['ContactStatus'] !== 'ACTIVE') continue;
    const number = str(c['ContactNumber']);
    const id = str(c['ContactID']) ?? '';
    const code = number && CODE.test(number) ? number : `X${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    const registry = str(c['CompanyNumber']);
    const country = (Array.isArray(c['Addresses']) ? (c['Addresses'] as Record<string, unknown>[]) : []).map((x) => str(x['Country'])).find((x) => x && /^[A-Z]{2}$/.test(x)) ?? null;
    parties.push({ code, name: str(c['Name']) ?? code,
      kind: c['IsCustomer'] === true ? 'customer' : c['IsSupplier'] === true ? 'supplier' : 'other',
      country, ice: registry && /^[0-9]{15}$/.test(registry) ? registry : null, taxNumber: str(c['TaxNumber']) });
    note('party', code, 'Contact');
  }
  // Xero posts every tax to the organisation's own tax account: "GST / VAT", SystemAccount "GST" (Accounting API types).
  const taxAccount = raw.accounts.filter((a) => a['SystemAccount'] === 'GST').map((a) => str(a['Code'])).find((c) => c !== null) ?? null;
  const taxCodes: BooksTaxCode[] = [];
  for (const t of raw.taxRates) {
    if (t['Status'] !== undefined && t['Status'] !== 'ACTIVE') continue;
    const code = str(t['TaxType']); const rate = num(t['EffectiveRate'] ?? t['DisplayTaxRate']);
    if (!code || !TAX_CODE.test(code)) { bad('TaxRate', 'TaxType', 'bad_code'); continue; }
    if (rate === null) { bad(`TaxRate ${code}`, 'EffectiveRate', 'not_an_amount'); continue; }
    const yes = (v: unknown) => v === true || v === 'true';
    const kind = rate === '0' ? 'exempt' : yes(t['CanApplyToRevenue']) ? 'collected' : yes(t['CanApplyToExpenses']) ? 'deductible' : null;
    if (!kind) { bad(`TaxRate ${code}`, 'CanApplyTo', 'unknown_kind'); continue; }
    taxCodes.push({ code, label: str(t['Name']) ?? code, rate, kind, account: kind === 'exempt' ? null : taxAccount, validFrom: null, validTo: null });
    note('tax_code', taxCodeKey({ code, validFrom: null }), 'TaxRate');
  }
  const entries: BooksEntry[] = [];
  for (const m of raw.journals) {
    const status = String(m['Status'] ?? 'DRAFT');
    if (status !== 'DRAFT' && status !== 'POSTED') continue;   // deleted or voided: not in the books
    const id = str(m['ManualJournalID']) ?? '';
    const narration = readXeroMark(str(m['Narration']));
    const key = textOf(narration.mark['k']) ?? `xero-${id}`;
    const date = xeroDay(m['Date']);
    if (!date) { bad(`ManualJournal ${id}`, 'Date', 'not_a_date'); continue; }
    const lines: BooksLine[] = (Array.isArray(m['JournalLines']) ? (m['JournalLines'] as Record<string, unknown>[]) : []).flatMap((l): BooksLine[] => {
      const amount = num(l['LineAmount']);
      if (amount === null || amount === '0') return [];
      const d = readXeroMark(str(l['Description']));
      const custom = valuesOf(d.mark['c']);
      return [{
        account: str(l['AccountCode']) ?? '', party: textOf(d.mark['p']) ?? null, taxCode: str(l['TaxType']) === 'NONE' ? null : (str(l['TaxType']) ?? textOf(d.mark['t']) ?? null),
        currency: raw.baseCurrency, debit: amount.startsWith('-') ? null : amount, credit: amount.startsWith('-') ? (amount.slice(1) as Decimal) : null,
        label: d.rest, ...(custom ? { custom } : {}),
      }];
    });
    const custom = valuesOf(narration.mark['c']);
    entries.push({ key, journal: XERO_JOURNAL, date, label: narration.rest ?? key, documentRef: key, documentDate: null,
      state: status === 'POSTED' ? 'posted' : 'draft', lines, ...(custom ? { custom } : {}) });
    note('entry', key, `ManualJournal ${id}`);
    lineAt.set(key, lines.map((_, i) => i + 1));
  }
  const data: BooksData = { accounts, journals: entries.length > 0 ? [{ code: XERO_JOURNAL, name: 'Xero', kind: 'general' }] : [], parties, taxCodes, entries };
  const where: Located = (kind, key, line) => {
    const w = at.get(`${kind}:${key}`) ?? { sheet: '', row: 0 };
    return kind === 'entry' && line !== undefined ? { sheet: `${w.sheet} line`, row: lineAt.get(key)?.[line] ?? 0 } : w;
  };
  const none = new Set<string>();
  problems.push(...booksProblems(data, { accounts: none, journals: none, parties: none, taxCodes: none, bookCurrency }, where)
    .filter((p) => !['unknown_account', 'unknown_party', 'unknown_tax_code', 'unknown_field'].includes(p.reason)));
  return { data, problems, where };
}

/** The books as Xero's records: what Xero can hold of them (see the header), for the mapping both ways. */
export function booksToXero(d: BooksData, baseCurrency: string): XeroRaw {
  const n = (v: Decimal) => ({ number: v });
  const id = (prefix: string, i: number) => `${prefix}000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
  const taxAccount = d.taxCodes.find((t) => t.account !== null)?.account ?? null;
  return {
    baseCurrency,
    accounts: d.accounts.filter((a) => TYPE_OF_KIND[a.kind] !== null).map((a, i) => ({ AccountID: id('a', i), Code: a.code, Name: a.name,
      Type: TYPE_OF_KIND[a.kind]![0], Class: TYPE_OF_KIND[a.kind]![1], Status: 'ACTIVE', ...(a.code === taxAccount ? { SystemAccount: 'GST' } : {}) })),
    contacts: d.parties.map((p, i) => ({ ContactID: id('c', i), ContactNumber: p.code, Name: p.name, ContactStatus: 'ACTIVE',
      IsCustomer: p.kind === 'customer', IsSupplier: p.kind === 'supplier', ...(p.ice ? { CompanyNumber: p.ice } : {}), ...(p.taxNumber ? { TaxNumber: p.taxNumber } : {}),
      Addresses: p.country ? [{ AddressType: 'POBOX', Country: p.country }] : [] })),
    taxRates: d.taxCodes.map((t) => ({ Name: t.label, TaxType: t.code, Status: 'ACTIVE', EffectiveRate: n(t.rate), DisplayTaxRate: n(t.rate),
      CanApplyToRevenue: t.kind !== 'deductible', CanApplyToExpenses: t.kind !== 'collected' })),
    journals: d.entries.filter((e) => e.lines.every((l) => l.currency === baseCurrency)).map((e, i) => ({
      ManualJournalID: id('e', i), Date: e.date, Status: e.state === 'posted' ? 'POSTED' : 'DRAFT', LineAmountTypes: 'NoTax',
      Narration: [e.label, xeroMark({ k: e.key, ...(e.custom ? { c: e.custom } : {}) })].join(' '),
      JournalLines: e.lines.map((l) => ({ AccountCode: l.account, LineAmount: n(l.debit ?? (`-${l.credit}` as Decimal)),
        Description: [l.label, xeroMark({ ...(l.party ? { p: l.party } : {}), ...(l.taxCode ? { t: l.taxCode } : {}), ...(l.custom ? { c: l.custom } : {}) })].filter(Boolean).join(' ') })),
    })),
  };
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function getJson(deps: XeroDeps, s: XeroSource, path: string, since?: string | null): Promise<{ readonly body: Record<string, unknown> } | ConnectRefusal> {
  const a = await call(deps, `${API}/${path}`, { method: 'GET', headers: { ...api(s), ...(since ? { 'If-Modified-Since': since } : {}) } });
  const no = refusalOf(a);
  if (no) return no;
  try {
    const v = parseExact(a!.text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v as Record<string, unknown> } : refused('unreadable');
  } catch { return refused('unreadable'); }
}
/** Every page of a paged object (Contacts, ManualJournals), 100 at a time. */
async function allPages(deps: XeroDeps, s: XeroSource, object: string, since: string | null): Promise<Record<string, unknown>[] | ConnectRefusal> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page++) {
    const r = await getJson(deps, s, `${object}?page=${page}&pageSize=${PAGE}`, since);
    if ('kind' in r) return r;
    const rows = Array.isArray(r.body[object]) ? (r.body[object] as Record<string, unknown>[]) : null;
    if (!rows) return refused('unreadable');
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  return out;
}

/** Everything the books take from this organisation (manual journals changed since the cursor), as raw records. */
async function readXero(deps: XeroDeps, s: XeroSource, cursor: string | null): Promise<{ raw: XeroRaw; cursor: string | null } | ConnectRefusal> {
  const org = await getJson(deps, s, 'Organisation');
  if ('kind' in org) return org;
  const baseCurrency = str((Array.isArray(org.body['Organisations']) ? (org.body['Organisations'] as Record<string, unknown>[])[0] : undefined)?.['BaseCurrency']);
  if (!baseCurrency) return refused('unreadable');
  const accounts = await getJson(deps, s, 'Accounts'); if ('kind' in accounts) return accounts;
  const taxRates = await getJson(deps, s, 'TaxRates'); if ('kind' in taxRates) return taxRates;
  const contacts = await allPages(deps, s, 'Contacts', null); if ('kind' in contacts) return contacts;
  const journals = await allPages(deps, s, 'ManualJournals', cursor); if ('kind' in journals) return journals;
  const list = (v: unknown) => (Array.isArray(v) ? v as Record<string, unknown>[] : []);
  // the newest change seen, as If-Modified-Since takes it (UTC, to the second)
  const newest = journals.map((j) => updatedOf(j['UpdatedDateUTC'])).filter((x): x is string => x !== null).sort().pop() ?? cursor;
  return { raw: { baseCurrency, accounts: list(accounts.body['Accounts']), contacts, taxRates: list(taxRates.body['TaxRates']), journals }, cursor: newest ?? null };
}
const updatedOf = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^\/Date\((\d+)([+-]\d{4})?\)\/$/.exec(v) : null;
  return m ? new Date(Number(m[1])).toISOString().slice(0, 19) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 19) : null;
};

/**
 * The connector (B1's shape). `connect` exchanges the code (`code`, `redirectUri`) and finds the organisation the
 * owner chose; `refresh` returns the NEW grant (Xero rotates it); `changedSince` reads.
 */
export function xeroConnector(deps: XeroDeps, bookCurrency: string): BooksConnector<XeroSource, XeroRaw> {
  return {
    config: { system: 'xero', signIn: 'oauth',
      fields: [{ name: 'code', kind: 'secret', required: true }, { name: 'redirectUri', kind: 'url', required: true }] },
    async connect(values) {
      const [code, redirectUri] = [values['code'], values['redirectUri']];
      if (typeof code !== 'string' || typeof redirectUri !== 'string') return refused('wrong_credentials');
      const t = await tokens(deps, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if ('kind' in t) return t;
      // Refused after the exchange, the grant Xero just gave is given back: nothing Nomi will not keep stays open there.
      const giveBack = async (no: ConnectRefusal) => { await revokeToken(deps, t.refresh); return no; };
      const event = authEventOf(t.access);
      const a = await call(deps, `${CONNECTIONS}${event ? `?authEventId=${event}` : ''}`, { method: 'GET',
        headers: { Authorization: `Bearer ${t.access}`, Accept: 'application/json' } });
      const no = refusalOf(a);
      if (no) return giveBack(no);
      let list: unknown;
      try { list = JSON.parse(a!.text); } catch { return giveBack(refused('unreadable')); }
      const orgs = (Array.isArray(list) ? list as Record<string, unknown>[] : []).filter((c) => c['tenantType'] === 'ORGANISATION' && typeof c['tenantId'] === 'string');
      if (orgs.length === 0) return giveBack(refused('source_missing'));
      if (orgs.length > 1) return giveBack(refused('several_organisations'));
      const org = orgs[0]!;
      return { kind: 'connected', source: { accessToken: t.access, tenantId: String(org['tenantId']), tenantName: str(org['tenantName']) ?? '' },
        grant: { secret: t.refresh, expiresAt: null } };
    },
    async refresh(grant: Grant) {
      const r = await xeroAccess(deps, grant);
      return 'kind' in r ? r : r.grant;
    },
    async revoke(grant: Grant) { await revokeToken(deps, grant.secret); },
    toBooks: (raw) => xeroToBooks(raw, bookCurrency),
    fromBooks: (d) => booksToXero(d, bookCurrency),
    async changedSince(source, cursor) {
      const read = await readXero(deps, source, cursor);
      if ('kind' in read) return read;
      const { data, problems, where } = xeroToBooks(read.raw, bookCurrency);
      return { kind: 'read', data, problems, where, cursor: read.cursor };
    },
  };
}

// ── C4: writing back ─────────────────────────────────────────────────────────────────────────────────────────────────
/** One of Nomi's posted entries as Xero takes it: the books' own amounts (Xero's manual journals have no currency). */
export type XeroEntryOut = {
  readonly key: string; readonly date: string; readonly label: string; readonly custom?: CustomValues;
  readonly lines: readonly { readonly account: string; readonly party: string | null; readonly taxCode: string | null; readonly label: string | null;
    readonly bookDebit: Decimal; readonly bookCredit: Decimal; readonly custom?: CustomValues }[];
};
export type XeroSent = { readonly key: string; readonly journalId: string };
export type XeroWriteConflict = { readonly key: string; readonly reason: 'already_in_xero' | 'no_account' | 'no_currency' | 'refused'; readonly detail: string };

/**
 * C4 (item 13, part 2) — NOMI'S POSTED ENTRIES INTO THE SHOP'S XERO, each a POSTED manual journal whose narration
 * carries Nomi's number in the mark. Never over anything: one Xero already holds (its mark names the number), one
 * naming an account Xero lacks or has archived, books kept in another currency than the organisation's — a CONFLICT,
 * shown, left for the owner. Xero's own refusal (a system or bank account) is a conflict too. Each is sent with an
 * Idempotency-Key, so a retried request never makes a second journal.
 */
export async function sendEntriesToXero(deps: XeroDeps, s: XeroSource, bookCurrency: string, entries: readonly XeroEntryOut[]):
  Promise<{ readonly written: readonly XeroSent[]; readonly conflicts: readonly XeroWriteConflict[] } | ConnectRefusal> {
  const read = await readXero(deps, s, null);
  if ('kind' in read) return read;
  const accounts = new Set(read.raw.accounts.filter((a) => a['Status'] === undefined || a['Status'] === 'ACTIVE').map((a) => String(a['Code'])));
  const there = new Set(read.raw.journals.filter((j) => j['Status'] === 'DRAFT' || j['Status'] === 'POSTED')
    .map((j) => textOf(readXeroMark(str(j['Narration'])).mark['k'])).filter((k): k is string => k !== undefined));
  const written: XeroSent[] = []; const conflicts: XeroWriteConflict[] = [];
  for (const e of entries) {
    if (read.raw.baseCurrency !== bookCurrency) { conflicts.push({ key: e.key, reason: 'no_currency', detail: read.raw.baseCurrency }); continue; }
    if (there.has(e.key)) { conflicts.push({ key: e.key, reason: 'already_in_xero', detail: e.key }); continue; }
    const missing = e.lines.find((l) => !accounts.has(l.account));
    if (missing) { conflicts.push({ key: e.key, reason: 'no_account', detail: missing.account }); continue; }
    const body = { ManualJournals: [{ Date: e.date, Status: 'POSTED', LineAmountTypes: 'NoTax',
      Narration: [e.label, xeroMark({ k: e.key, ...(e.custom ? { c: e.custom } : {}) })].join(' '),
      JournalLines: e.lines.map((l) => ({ AccountCode: l.account, LineAmount: { number: l.bookDebit !== '0' ? l.bookDebit : `-${l.bookCredit}` },
        Description: [l.label ?? e.label, xeroMark({ ...(l.party ? { p: l.party } : {}), ...(l.taxCode ? { t: l.taxCode } : {}), ...(l.custom ? { c: l.custom } : {}) })].filter(Boolean).join(' ') })) }] };
    // POST creates a journal that names no ManualJournalID (and could update one that did: none is ever named here).
    const a = await call(deps, `${API}/ManualJournals`, { method: 'POST',
      headers: { ...api(s, true), 'Idempotency-Key': `nomi-${e.key}`.slice(0, 128) }, body: exactBody(body) });
    if (!a || a.status >= 500 || a.status === 429 || a.status === 401) return refused(!a || a.status !== 401 ? 'unreachable' : 'revoked');
    if (a.status === 403) return refused('source_missing');
    if (a.status !== 200) { conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    let made: unknown;
    try { made = (JSON.parse(a.text) as { ManualJournals?: { ManualJournalID?: unknown }[] }).ManualJournals?.[0]?.ManualJournalID; } catch { made = null; }
    written.push({ key: e.key, journalId: typeof made === 'string' ? made : `#${e.key}` });
  }
  return { written, conflicts };
}

/** A body whose `{ number }` values are written as JSON numbers with their own digits — never a float's. */
function exactBody(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    (x && typeof x === 'object' && 'number' in x && typeof (x as { number: unknown }).number === 'string' ? `\u0000n${(x as { number: string }).number}` : x))
    .replace(/"\\u0000n(-?\d+(?:\.\d+)?)"/g, '$1');
}
