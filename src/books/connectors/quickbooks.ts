import { OAUTH_TIMEOUT_MS, type OAuthFetch } from '../../connectors/oauth.js';
import { refused, type BooksConnector, type ConnectRefusal, type Grant, type Located } from '../../core/books/connector.js';
import { iceOrNull } from '../../core/books/identifiers.js';
import {
  booksProblems, type BooksAccount, type BooksData, type BooksEntry, type BooksLine, type BooksParty, type BooksProblem, type CustomValues, type RecordKind,
} from '../../core/books/interchange.js';
import type { Decimal } from '../../core/types/decimal.js';
import { excelNumber } from './excel.js';
import { exactBody, parseExact } from './exactJson.js';
import { nomiMark as mark, readNomiMark as readMark } from './mark.js';

/**
 * D9 (Phase 5, item 12; decision 4) — THE SHOP'S OWN QUICKBOOKS ONLINE, over Intuit's Accounting API, with our own
 * client: OAuth 2.0 (the client's secret in a Basic header; the company's `realmId` comes back with the code), then
 * `/v3/company/{realmId}/…` at minor version 75 (the lowest Intuit still serves since 1 August 2025). Read from
 * Intuit's developer documentation (2026-10-22), built against a recorded fake of those answers
 * (tests/books-connectors/quickbooks-fake.ts). Live on deploy day, on the Builder tier: free, with reads (GET and
 * /query, "CorePlus") capped at 500,000 a month and blocked above; writes uncapped.
 *
 * SIGN-IN
 *   · one scope, `com.intuit.quickbooks.accounting`;
 *   · the company is the one the owner connected on Intuit's page (`realmId`); connecting checks it answers
 *     (companyinfo) before anything is saved, and gives the grant back when it does not;
 *   · tokens: an hour for the access token; the refresh token lasts 100 days rolling (five years at most) and CHANGES —
 *     every 24 hours, Intuit returns a new one and the old one expires. So the one each refresh returns is kept
 *     (src/db/booksConnections.ts `rotateGrant`), as Xero's.
 *
 * WHAT QUICKBOOKS HOLDS OF THE BOOKS, said in the open (tests/books-connectors/quickbooks.test.ts `qboHolds`):
 *   · ACCOUNTS: the code is the account's number (`AcctNum`, 7 characters at most in the US, UK and India), with its
 *     parent (QuickBooks nests accounts); the kind is QuickBooks' classification;
 *   · PARTIES: customers and vendors — a vendor's code is its `AcctNum`; a customer has no such field, so its code,
 *     its ICE and its custom values travel in Nomi's mark (`[nomi:…]`) in its `Notes`. A tax identifier comes back
 *     masked to its last characters: it is not read. A vendor has no notes: its custom values do not travel;
 *   · TAXES are not read: QuickBooks' tax rates name no account the books could post them to (none is documented), and
 *     a United States company's sales tax is QuickBooks' own automation. Nomi's tax codes stay Nomi's; a line's tax
 *     code travels in the mark;
 *   · ENTRIES: journal entries, in ONE journal ("QBO" — QuickBooks has no journals), keyed by `DocNumber` (21 at most).
 *     QuickBooks has no draft: every entry there is posted (read in, it is a draft here, as every read-in). One
 *     currency per entry (`CurrencyRef`): an entry whose lines are in two currencies is not held by the mapping, and
 *     C4 sends the books' converted amounts. A line's party is its `Entity`; its custom values, and the entry's, are
 *     in the mark at the end of the description and the private note.
 */

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API = 'https://quickbooks.api.intuit.com/v3/company';
const MINOR = 'minorversion=75';
/** Every entry read from QuickBooks is in this journal: it keeps journal entries, and no journals. */
export const QBO_JOURNAL = 'QBO';
const PAGE = 1000;

export type QboClient = { readonly clientId: string; readonly clientSecret: string };
export type QboDeps = { readonly client: QboClient; readonly fetch: OAuthFetch };
export type QboSource = { readonly accessToken: string; readonly realmId: string; readonly companyName?: string };
export type QboRaw = {
  readonly homeCurrency: string; readonly country: string; readonly multiCurrency: boolean;
  readonly accounts: readonly Record<string, unknown>[];
  readonly customers: readonly Record<string, unknown>[];
  readonly vendors: readonly Record<string, unknown>[];
  readonly journals: readonly Record<string, unknown>[];
};

type Answer = { readonly status: number; readonly text: string } | null;
async function call(deps: QboDeps, url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }): Promise<Answer> {
  try {
    const res = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS) });
    return { status: res.status, text: await res.text() };
  } catch {
    return null;
  }
}
const basic = (c: QboClient) => `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`;
const api = (s: QboSource, json = false): Record<string, string> => ({
  Authorization: `Bearer ${s.accessToken}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}),
});
/** The Fault's first error code, where the answer is one (Intuit answers a Fault with 400, and sometimes with 200). */
const faultOf = (text: string): string | null => {
  try {
    const f = (JSON.parse(text) as { Fault?: { Error?: { code?: unknown }[] } }).Fault;
    return f ? String(f.Error?.[0]?.code ?? '') : null;
  } catch { return null; }
};

/** An API answer: a refusal by its status and Fault code (Intuit's words are never repeated), or null to read on. */
function refusalOf(a: Answer): ConnectRefusal | null {
  if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
  // 3200 a token invalid or expired; 3100 a scope not granted: the owner connects again.
  if (a.status === 401 || a.status === 403) return refused('revoked');
  const fault = faultOf(a.text);
  // 6190 "Invalid Company Status": the subscription ended or was cancelled; 120 the company is not this grant's.
  if (fault === '6190' || fault === '120' || fault === '140') return refused('source_missing');
  if (a.status !== 200 || fault !== null) return refused('unreadable');
  return null;
}

async function tokens(deps: QboDeps, body: Record<string, string>): Promise<{ readonly access: string; readonly refresh: string } | ConnectRefusal> {
  const a = await call(deps, TOKEN, { method: 'POST',
    headers: { Authorization: basic(deps.client), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString() });
  if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
  if (a.status !== 200) return refused(body['grant_type'] === 'refresh_token' ? 'revoked' : 'wrong_credentials');
  let j: Record<string, unknown>;
  try { j = JSON.parse(a.text) as Record<string, unknown>; } catch { return refused('unreadable'); }
  if (typeof j['access_token'] !== 'string' || typeof j['refresh_token'] !== 'string') return refused('wrong_credentials');
  return { access: j['access_token'], refresh: j['refresh_token'] };
}
async function revokeToken(deps: QboDeps, token: string): Promise<void> {
  await call(deps, REVOKE, { method: 'POST', headers: { Authorization: basic(deps.client), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token }) });
}

/** Where the owner is sent to connect the company. */
export function qboAuthorizeUrl(client: QboClient, o: { readonly redirectUri: string; readonly state: string }): string {
  return `${AUTHORIZE}?${new URLSearchParams({ client_id: client.clientId, response_type: 'code', scope: QBO_SCOPE, redirect_uri: o.redirectUri, state: o.state }).toString()}`;
}

/** A grant held, refreshed into an access token — and the grant Intuit returned (a new one every 24 hours), kept first. */
export async function qboAccess(deps: QboDeps, grant: Grant): Promise<{ readonly accessToken: string; readonly grant: Grant } | ConnectRefusal> {
  const t = await tokens(deps, { grant_type: 'refresh_token', refresh_token: grant.secret });
  if ('kind' in t) return t;
  return { accessToken: t.access, grant: { secret: t.refresh, expiresAt: null } };
}

// ── the mapping ──────────────────────────────────────────────────────────────────────────────────────────────────────
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): Decimal | null => (v && typeof v === 'object' && 'number' in v ? excelNumber((v as { number: string }).number) : null);
const ref = (v: unknown): string | null => (v && typeof v === 'object' ? str((v as { value?: unknown }).value) : null);
const textOf = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const valuesOf = (v: unknown): CustomValues | undefined =>
  (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === 'string')
    ? Object.fromEntries(Object.entries(v as CustomValues).sort(([a], [b]) => a.localeCompare(b))) : undefined);
const KIND_OF_CLASS: Record<string, BooksAccount['kind']> = { Asset: 'asset', Liability: 'liability', Equity: 'equity', Revenue: 'income', Expense: 'expense' };
const TYPE_OF_KIND: Record<BooksAccount['kind'], [string, string, string] | null> = {
  asset: ['Other Current Asset', 'OtherCurrentAssets', 'Asset'], liability: ['Other Current Liability', 'OtherCurrentLiabilities', 'Liability'],
  equity: ['Equity', 'OwnersEquity', 'Equity'], income: ['Income', 'SalesOfProductIncome', 'Revenue'], expense: ['Expense', 'OtherMiscellaneousServiceCost', 'Expense'],
  off_balance: null,
};
const CODE = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;

/** QuickBooks' records as the books (B1's shape), every problem located at its entity and id. */
export function qboToBooks(raw: QboRaw, bookCurrency: string): { data: BooksData; problems: BooksProblem[]; where: Located } {
  const problems: BooksProblem[] = [];
  const at = new Map<string, { sheet: string; row: number }>();
  const note = (kind: RecordKind, key: string, entity: string, id: string | null) => at.set(`${kind}:${key}`, { sheet: entity, row: Number(id ?? 0) || 0 });
  const bad = (entity: string, id: string | null, column: string, reason: BooksProblem['reason']) => problems.push({ sheet: entity, row: Number(id ?? 0) || 0, column, reason });

  const codeOf = new Map<string, string>();
  for (const a of raw.accounts) { const id = str(a['Id']); if (id) codeOf.set(id, str(a['AcctNum']) ?? `Q${id}`); }
  const accounts: BooksAccount[] = [];
  for (const a of raw.accounts) {
    if (a['Active'] === false) continue;
    const id = str(a['Id']); const code = id ? codeOf.get(id)! : null; const kind = KIND_OF_CLASS[String(a['Classification'] ?? '')];
    if (!code || !CODE.test(code)) { bad('Account', id, 'AcctNum', 'bad_code'); continue; }
    if (!kind) { bad('Account', id, 'Classification', 'unknown_kind'); continue; }
    const parent = ref(a['ParentRef']);
    accounts.push({ code, name: str(a['Name']) ?? code, kind, parent: parent ? (codeOf.get(parent) ?? null) : null });
    note('account', code, 'Account', id);
  }
  const partyOf = new Map<string, string>();
  const parties: BooksParty[] = [];
  const country = (c: Record<string, unknown>) => { const v = str((c['BillAddr'] as Record<string, unknown> | undefined)?.['Country']); return v && /^[A-Z]{2}$/.test(v) ? v : null; };
  for (const c of raw.customers) {
    if (c['Active'] === false) continue;
    const id = str(c['Id']) ?? '';
    const m = readMark(str(c['Notes'])).mark;
    const code = textOf(m['k']) ?? `QC${id}`;
    const ice = textOf(m['i']); const custom = valuesOf(m['c']);
    partyOf.set(`Customer:${id}`, code);
    parties.push({ code, name: str(c['DisplayName']) ?? code, kind: textOf(m['o']) === '1' ? 'other' : 'customer', country: country(c),
      ice: iceOrNull(ice ?? null), taxNumber: null, ...(custom ? { custom } : {}) });
    note('party', code, 'Customer', id);
  }
  for (const v of raw.vendors) {
    if (v['Active'] === false) continue;
    const id = str(v['Id']) ?? '';
    const number = str(v['AcctNum']);
    const code = number && CODE.test(number) ? number : `QV${id}`;
    partyOf.set(`Vendor:${id}`, code);
    parties.push({ code, name: str(v['DisplayName']) ?? code, kind: 'supplier', country: country(v), ice: null, taxNumber: null });
    note('party', code, 'Vendor', id);
  }
  const entries: BooksEntry[] = [];
  const lineAt = new Map<string, number[]>();
  for (const j of raw.journals) {
    const id = str(j['Id']);
    const noteMark = readMark(str(j['PrivateNote']));
    const key = str(j['DocNumber']) ?? `qbo-${id}`;
    const date = str(j['TxnDate']);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad('JournalEntry', id, 'TxnDate', 'not_a_date'); continue; }
    const currency = ref(j['CurrencyRef']) ?? raw.homeCurrency;
    const rows: number[] = [];
    const lines: BooksLine[] = (Array.isArray(j['Line']) ? (j['Line'] as Record<string, unknown>[]) : []).flatMap((l): BooksLine[] => {
      const d = (l['JournalEntryLineDetail'] ?? {}) as Record<string, unknown>;
      const amount = num(l['Amount']);
      if (l['DetailType'] !== 'JournalEntryLineDetail' || amount === null || amount === '0') return [];
      const entity = (d['Entity'] ?? {}) as Record<string, unknown>;
      const party = partyOf.get(`${String(entity['Type'] ?? '')}:${ref(entity['EntityRef']) ?? ''}`) ?? null;
      const desc = readMark(str(l['Description']));
      const custom = valuesOf(desc.mark['c']);
      const debit = d['PostingType'] === 'Debit';
      rows.push(Number(str(l['Id']) ?? 0) || 0);
      return [{ account: codeOf.get(ref(d['AccountRef']) ?? '') ?? '', party, taxCode: textOf(desc.mark['t']) ?? null, currency,
        debit: debit ? amount : null, credit: debit ? null : amount, label: desc.rest, ...(custom ? { custom } : {}) }];
    });
    const custom = valuesOf(noteMark.mark['c']);
    entries.push({ key, journal: QBO_JOURNAL, date, label: noteMark.rest ?? key, documentRef: key, documentDate: null, state: 'posted', lines, ...(custom ? { custom } : {}) });
    note('entry', key, 'JournalEntry', id);
    lineAt.set(key, rows);
  }
  const data: BooksData = { accounts, journals: entries.length > 0 ? [{ code: QBO_JOURNAL, name: 'QuickBooks', kind: 'general' }] : [], parties, taxCodes: [], entries };
  const where: Located = (kind, key, line) => (kind === 'entry' && line !== undefined
    ? { sheet: 'JournalEntry line', row: lineAt.get(key)?.[line] ?? 0 } : at.get(`${kind}:${key}`) ?? { sheet: '', row: 0 });
  const none = new Set<string>();
  problems.push(...booksProblems(data, { accounts: none, journals: none, parties: none, taxCodes: none, bookCurrency }, where)
    .filter((p) => !['unknown_account', 'unknown_party', 'unknown_tax_code', 'unknown_field'].includes(p.reason)));
  return { data, problems, where };
}

/** The books as QuickBooks' records: what QuickBooks can hold of them (see the header), for the mapping both ways. */
export function booksToQbo(d: BooksData, homeCurrency: string, country = 'MA'): QboRaw {
  const n = (v: Decimal) => ({ number: v });
  const accountId = new Map(d.accounts.map((a, i) => [a.code, String(i + 1)]));
  const customers = d.parties.filter((p) => p.kind !== 'supplier');
  const vendors = d.parties.filter((p) => p.kind === 'supplier');
  const partyRef = new Map<string, { Type: string; EntityRef: { value: string } }>([
    ...customers.map((p, i) => [p.code, { Type: 'Customer', EntityRef: { value: String(100 + i) } }] as const),
    ...vendors.map((p, i) => [p.code, { Type: 'Vendor', EntityRef: { value: String(500 + i) } }] as const)]);
  const address = (p: BooksParty) => (p.country ? { BillAddr: { Country: p.country } } : {});
  return {
    homeCurrency, country, multiCurrency: true,
    accounts: d.accounts.filter((a) => TYPE_OF_KIND[a.kind] !== null).map((a) => ({ Id: accountId.get(a.code), AcctNum: a.code, Name: a.name, Active: true,
      AccountType: TYPE_OF_KIND[a.kind]![0], AccountSubType: TYPE_OF_KIND[a.kind]![1], Classification: TYPE_OF_KIND[a.kind]![2],
      ...(a.parent ? { ParentRef: { value: accountId.get(a.parent) }, SubAccount: true } : {}) })),
    customers: customers.map((p, i) => ({ Id: String(100 + i), DisplayName: p.name, Active: true, ...address(p),
      Notes: mark({ k: p.code, ...(p.ice ? { i: p.ice } : {}), ...(p.kind === 'other' ? { o: '1' } : {}), ...(p.custom ? { c: p.custom } : {}) }) })),
    vendors: vendors.map((p, i) => ({ Id: String(500 + i), DisplayName: p.name, AcctNum: p.code, Active: true, ...address(p) })),
    journals: d.entries.filter((e) => new Set(e.lines.map((l) => l.currency)).size === 1).map((e, i) => ({
      Id: String(1000 + i), DocNumber: e.key, TxnDate: e.date, PrivateNote: [e.label, mark({ ...(e.custom ? { c: e.custom } : {}) })].filter(Boolean).join(' '),
      CurrencyRef: { value: e.lines[0]?.currency ?? homeCurrency },
      Line: e.lines.map((l, k) => ({ Id: String(k), DetailType: 'JournalEntryLineDetail', Amount: n(l.debit ?? l.credit!),
        Description: [l.label, mark({ ...(l.taxCode ? { t: l.taxCode } : {}), ...(l.custom ? { c: l.custom } : {}) })].filter(Boolean).join(' ') || undefined,
        JournalEntryLineDetail: { PostingType: l.debit !== null ? 'Debit' : 'Credit', AccountRef: { value: accountId.get(l.account) },
          ...(l.party && partyRef.has(l.party) ? { Entity: partyRef.get(l.party) } : {}) } })),
    })),
  };
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function getJson(deps: QboDeps, s: QboSource, path: string): Promise<{ readonly body: Record<string, unknown> } | ConnectRefusal> {
  const a = await call(deps, `${API}/${encodeURIComponent(s.realmId)}/${path}${path.includes('?') ? '&' : '?'}${MINOR}`, { method: 'GET', headers: api(s) });
  const no = refusalOf(a);
  if (no) return no;
  try {
    const v = parseExact(a!.text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { body: v as Record<string, unknown> } : refused('unreadable');
  } catch { return refused('unreadable'); }
}
/** Every row of a query, a thousand at a time (QuickBooks' most). */
async function queryAll(deps: QboDeps, s: QboSource, entity: string, where = ''): Promise<Record<string, unknown>[] | ConnectRefusal> {
  const out: Record<string, unknown>[] = [];
  for (let start = 1; start < 1_000_000; start += PAGE) {
    const r = await getJson(deps, s, `query?query=${encodeURIComponent(`SELECT * FROM ${entity}${where} STARTPOSITION ${start} MAXRESULTS ${PAGE}`)}`);
    if ('kind' in r) return r;
    const q = r.body['QueryResponse'] as Record<string, unknown> | undefined;
    if (!q || typeof q !== 'object') return refused('unreadable');
    const rows = Array.isArray(q[entity]) ? (q[entity] as Record<string, unknown>[]) : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  return out;
}

async function readQbo(deps: QboDeps, s: QboSource, cursor: string | null): Promise<{ raw: QboRaw; cursor: string | null } | ConnectRefusal> {
  const prefs = await getJson(deps, s, 'preferences'); if ('kind' in prefs) return prefs;
  const cp = ((prefs.body['Preferences'] as Record<string, unknown> | undefined)?.['CurrencyPrefs'] ?? {}) as Record<string, unknown>;
  const homeCurrency = ref(cp['HomeCurrency']);
  if (!homeCurrency) return refused('unreadable');
  const info = await getJson(deps, s, `companyinfo/${encodeURIComponent(s.realmId)}`); if ('kind' in info) return info;
  const country = str((info.body['CompanyInfo'] as Record<string, unknown> | undefined)?.['Country']) ?? '';
  const accounts = await queryAll(deps, s, 'Account'); if (!Array.isArray(accounts)) return accounts;
  const customers = await queryAll(deps, s, 'Customer'); if (!Array.isArray(customers)) return customers;
  const vendors = await queryAll(deps, s, 'Vendor'); if (!Array.isArray(vendors)) return vendors;
  const journals = await queryAll(deps, s, 'JournalEntry', cursor ? ` WHERE Metadata.LastUpdatedTime > '${cursor}'` : ''); if (!Array.isArray(journals)) return journals;
  const newest = journals.map((j) => str((j['MetaData'] as Record<string, unknown> | undefined)?.['LastUpdatedTime'])).filter((x): x is string => x !== null && /^\d{4}-\d{2}-\d{2}T[\d:]+([+-]\d{2}:\d{2}|Z)$/.test(x))
    .sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? cursor;
  return { raw: { homeCurrency, country, multiCurrency: cp['MultiCurrencyEnabled'] === true, accounts, customers, vendors, journals }, cursor: newest ?? null };
}

/** The connector (B1's shape): `connect` takes the code and the realmId Intuit sent back with it. */
export function qboConnector(deps: QboDeps, bookCurrency: string): BooksConnector<QboSource, QboRaw> {
  return {
    config: { system: 'quickbooks', signIn: 'oauth',
      fields: [{ name: 'code', kind: 'secret', required: true }, { name: 'realmId', kind: 'text', required: true }, { name: 'redirectUri', kind: 'url', required: true }] },
    async connect(values) {
      const [code, realmId, redirectUri] = [values['code'], values['realmId'], values['redirectUri']];
      if (typeof code !== 'string' || typeof realmId !== 'string' || !/^\d{1,30}$/.test(realmId) || typeof redirectUri !== 'string') return refused('wrong_credentials');
      const t = await tokens(deps, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if ('kind' in t) return t;
      const source: QboSource = { accessToken: t.access, realmId };
      const info = await getJson(deps, source, `companyinfo/${realmId}`);
      // Refused after the exchange: the grant Intuit just gave is given back.
      if ('kind' in info) { await revokeToken(deps, t.refresh); return info; }
      const name = str((info.body['CompanyInfo'] as Record<string, unknown> | undefined)?.['CompanyName']) ?? '';
      return { kind: 'connected', source: { ...source, companyName: name }, grant: { secret: t.refresh, expiresAt: null } };
    },
    async refresh(grant: Grant) {
      const r = await qboAccess(deps, grant);
      return 'kind' in r ? r : r.grant;
    },
    async revoke(grant: Grant) { await revokeToken(deps, grant.secret); },
    toBooks: (raw) => qboToBooks(raw, bookCurrency),
    fromBooks: (d) => booksToQbo(d, bookCurrency),
    async changedSince(source, cursor) {
      const read = await readQbo(deps, source, cursor);
      if ('kind' in read) return read;
      const { data, problems, where } = qboToBooks(read.raw, bookCurrency);
      return { kind: 'read', data, problems, where, cursor: read.cursor };
    },
  };
}

// ── C4: writing back ─────────────────────────────────────────────────────────────────────────────────────────────────
export type QboEntryOut = {
  readonly key: string; readonly date: string; readonly label: string; readonly custom?: CustomValues;
  readonly lines: readonly { readonly account: string; readonly party: string | null; readonly taxCode: string | null; readonly label: string | null;
    readonly bookDebit: Decimal; readonly bookCredit: Decimal; readonly custom?: CustomValues }[];
};
export type QboSent = { readonly key: string; readonly entryId: string };
export type QboWriteConflict = { readonly key: string; readonly reason: 'already_in_quickbooks' | 'no_account' | 'no_party' | 'no_currency' | 'refused'; readonly detail: string };

/**
 * C4 (item 13, part 2) — NOMI'S POSTED ENTRIES INTO THE SHOP'S QUICKBOOKS, each a journal entry whose DocNumber is
 * Nomi's number, in the books' own amounts. Never over anything: one QuickBooks already holds (by that number, or its
 * "Duplicate Doc Num", 6140), one naming an account or a party QuickBooks lacks, books in another currency than the
 * company's home one, a number longer than QuickBooks keeps (21) — a CONFLICT, shown, left for the owner. QuickBooks'
 * own refusal is a conflict too. Each request carries a `requestid`, so a retried one never makes a second entry.
 */
export async function sendEntriesToQbo(deps: QboDeps, s: QboSource, bookCurrency: string, entries: readonly QboEntryOut[]):
  Promise<{ readonly written: readonly QboSent[]; readonly conflicts: readonly QboWriteConflict[] } | ConnectRefusal> {
  const read = await readQbo(deps, s, null);
  if ('kind' in read) return read;
  const accountId = new Map(read.raw.accounts.filter((a) => a['Active'] !== false).map((a) => [str(a['AcctNum']) ?? `Q${str(a['Id'])}`, str(a['Id'])!]));
  const partyRef = new Map<string, { Type: string; EntityRef: { value: string } }>([
    ...read.raw.customers.map((c) => [textOf(readMark(str(c['Notes'])).mark['k']) ?? `QC${str(c['Id'])}`, { Type: 'Customer', EntityRef: { value: str(c['Id'])! } }] as const),
    ...read.raw.vendors.map((v) => [str(v['AcctNum']) ?? `QV${str(v['Id'])}`, { Type: 'Vendor', EntityRef: { value: str(v['Id'])! } }] as const)]);
  const there = new Set(read.raw.journals.map((j) => str(j['DocNumber'])).filter((k): k is string => k !== null));
  const written: QboSent[] = []; const conflicts: QboWriteConflict[] = [];
  for (const e of entries) {
    if (read.raw.homeCurrency !== bookCurrency) { conflicts.push({ key: e.key, reason: 'no_currency', detail: read.raw.homeCurrency }); continue; }
    if (there.has(e.key)) { conflicts.push({ key: e.key, reason: 'already_in_quickbooks', detail: e.key }); continue; }
    if (e.key.length > 21) { conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    const noAccount = e.lines.find((l) => !accountId.has(l.account));
    if (noAccount) { conflicts.push({ key: e.key, reason: 'no_account', detail: noAccount.account }); continue; }
    const noParty = e.lines.find((l) => l.party !== null && !partyRef.has(l.party));
    if (noParty) { conflicts.push({ key: e.key, reason: 'no_party', detail: noParty.party! }); continue; }
    const body = {
      DocNumber: e.key, TxnDate: e.date, PrivateNote: [e.label, mark({ ...(e.custom ? { c: e.custom } : {}) })].filter(Boolean).join(' ').slice(0, 4000),
      ...(read.raw.multiCurrency ? { CurrencyRef: { value: read.raw.homeCurrency } } : {}),
      // required outside the United States; no line names a tax code (Nomi's tax lines are written out), so nothing is added
      ...(read.raw.country !== 'US' ? { GlobalTaxCalculation: 'TaxExcluded' } : {}),
      Line: e.lines.map((l) => {
        const debit = l.bookDebit !== '0';
        const description = [l.label ?? e.label, mark({ ...(l.taxCode ? { t: l.taxCode } : {}), ...(l.custom ? { c: l.custom } : {}) })].filter(Boolean).join(' ');
        return { DetailType: 'JournalEntryLineDetail', Amount: { number: debit ? l.bookDebit : l.bookCredit }, Description: description.slice(0, 4000),
          JournalEntryLineDetail: { PostingType: debit ? 'Debit' : 'Credit', AccountRef: { value: accountId.get(l.account) },
            ...(l.party ? { Entity: partyRef.get(l.party) } : {}) } };
      }),
    };
    const a = await call(deps, `${API}/${encodeURIComponent(s.realmId)}/journalentry?${MINOR}&requestid=${encodeURIComponent(`nomi-${e.key}`.slice(0, 50))}`,
      { method: 'POST', headers: api(s, true), body: exactBody(body) });
    if (!a || a.status >= 500 || a.status === 429) return refused('unreachable');
    if (a.status === 401 || a.status === 403) return refused('revoked');
    const fault = faultOf(a.text);
    if (fault === '6190') return refused('source_missing');
    if (fault === '6140') { conflicts.push({ key: e.key, reason: 'already_in_quickbooks', detail: e.key }); continue; }
    if (a.status !== 200 || fault !== null) { conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    let made: unknown;
    try { made = (JSON.parse(a.text) as { JournalEntry?: { Id?: unknown } }).JournalEntry?.Id; } catch { made = null; }
    written.push({ key: e.key, entryId: typeof made === 'string' ? made : `#${e.key}` });
  }
  return { written, conflicts };
}
