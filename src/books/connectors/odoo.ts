import { readStoreAddress } from '../../core/onboard/storeAddress.js';
import type { Decimal } from '../../core/types/decimal.js';
import { refused, type BooksConnector, type ConnectRefusal, type Grant, type Located } from '../../core/books/connector.js';
import { partyIce } from '../../core/books/identifiers.js';
import {
  booksProblems, taxCodeKey, type BooksAccount, type BooksData, type BooksEntry, type BooksLine, type BooksProblem, type BooksTaxCode, type CustomValues, type RecordKind,
} from '../../core/books/interchange.js';
import type { PublicPost } from '../../net/publicFetch.js';
import { excelNumber } from './excel.js';
import { parseExact } from './exactJson.js';

/**
 * B4 (Phase 5; decision 4, items 14 and 15) — THE SHOP'S OWN ODOO, OVER JSON-2, WITH OUR OWN CLIENT. JSON-2 only:
 * XML-RPC and JSON-RPC "are scheduled for removal in Odoo 22 (fall 2028) / Odoo Online 21" (Odoo 19 docs). No
 * odoo-jsonrpc dependency: a POST of a JSON object to `/json/2/<model>/<method>`, "bearer" and the owner's API key,
 * the database named in `X-Odoo-Database` (Odoo 19, External JSON-2 API).
 *
 * ITEM 15 — WHAT CONNECTING CHECKS, BEFORE ANYTHING IS SAVED, each with its own sentence:
 *   · a wrong key: Odoo answers 401 "Invalid apikey" (documented);
 *   · a wrong database: read from Odoo 19's own source (odoo/http.py, `_get_session_and_dbname`, `_serve_nodb`, and
 *     `_generate_routing_rules`, 2026-10-21): an `X-Odoo-Database` the server's dbfilter rejects, or one it has no
 *     database for, leaves the request with no database; the no-database routes are only those with `auth='none'`, and
 *     JSON-2's is `bearer`, so the answer is a 404 whose body is Odoo's own HTML page, "No database is selected and the
 *     requested URL was not found in the server-wide controllers" (`NOT_FOUND_NODB`) — not a JSON error;
 *   · a Free or Standard plan: "Access to data via the external API is only available on Custom Odoo pricing plans"
 *     (documented) — answered, with a valid key, as 403 (Odoo does not document the status: it is read so, and
 *     checked live on deploy day);
 *   · a server that is not an Odoo 19 (no JSON-2): unreadable.
 * ITEM 14 — THE KEY'S OWN EXPIRY. "API keys cannot last more than three months" (Odoo 19). The owner gives the
 * expiry Odoo showed when the key was made; from 80 days of a key's life the books' page asks for a new one, and on
 * its expiry reading STOPS with that reason (`key_expired`) — Nomi never keeps calling with a key Odoo will refuse.
 *
 * READING. The chart (account.account), the journals, the partners that are customers or suppliers, the percent
 * taxes with their tax account, and the entries (account.move, draft or posted) with their lines. "Changed since"
 * is Odoo's own `write_date` for the entries; the chart and the rest are read whole and the read-in keeps only what
 * changed. Amounts are read from Odoo's own digits, never through a float. What Odoo cannot say is not invented:
 *   · an account has no parent here;
 *   · a tax has NO START DATE in Odoo: it is read with none (`validFrom: null`), and the read-in takes it as in force
 *     from the day it was first read — never earlier (the owner, 2026-10-21: a date before that would be a guess
 *     wearing a fact's clothes). An entry dated before then that names it is refused with that reason;
 *   · a tax has no CODE in Odoo: Nomi names it `ODOO-<id>`, Odoo's own id inside the name, so an accountant reading
 *     the books sees whose it is;
 *   · a foreign line is read in its own currency (`amount_currency`); its conversion is the owner's (A3);
 *   · D7 — Odoo has no place for the owner's CUSTOM VALUES that every Odoo has (a Studio field is the shop's own), so
 *     they travel in a mark Nomi writes and reads back, "[nomi:…]": the values as JSON, in URL-safe base64 — which an
 *     HTML field's cleaning leaves alone. An entry's in its move's notes (`narration`), a party's in the partner's
 *     notes (`comment`), a line's at the end of its label (`name`, with the label read back without it). The FIELDS
 *     themselves do not travel: Odoo cannot hold them, and its values are checked against Nomi's.
 *
 * Built against a recorded fake (tests/books-connectors/odoo-fake.ts) of the documented answers; live on deploy day
 * against the shop's Odoo, which needs Odoo's Custom plan (the shop's cost, not Nomi's — PHASE-5.md §7).
 */

export const ODOO_KEY_REMIND_AT_DAYS = 80; // item 14: from 80 days of a key's life, the page asks for a new one
/** Nomi's name for a tax Odoo gives no code: Odoo's own id inside it, so whose it is stays plain. */
export const odooTaxCode = (id: number): string => `ODOO-${id}`;

export type OdooSource = { readonly origin: string; readonly database: string; readonly key: string };

/** What a JSON-2 answer means: the value, or a refusal by Odoo's status and error. */
type Json2 = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly refusal: ConnectRefusal };

async function json2(post: PublicPost, s: OdooSource, model: string, method: string, args: Record<string, unknown>, exact = false): Promise<Json2> {
  const a = await post(`${s.origin}/json/2/${model}/${method}`, {
    authorization: `bearer ${s.key}`, 'content-type': 'application/json; charset=utf-8', 'x-odoo-database': s.database,
    accept: 'application/json',
  }, exact ? exactBody(args) : JSON.stringify(args));
  if (!a || a.status >= 500 || a.status === 429) return { ok: false, refusal: refused('unreachable') };
  let body: unknown = null;
  try { body = parseExact(a.text); } catch { body = null; }
  if (a.status === 401) return { ok: false, refusal: refused('wrong_credentials') };
  if (a.status === 403) return { ok: false, refusal: refused('plan_without_api') };
  // A wrong database is Odoo's own no-database page (see the header); any other 404 is not this Odoo's JSON-2.
  if (a.status === 404) return { ok: false, refusal: refused(/No database is selected/.test(a.text) ? 'wrong_database' : 'unreadable') };
  if (a.status !== 200 || body === null) return { ok: false, refusal: refused('unreadable') };
  return { ok: true, value: body };
}

/** A body whose `{ number }` values are written as JSON numbers with their own digits — never a float's (C4). */
function exactBody(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    (x && typeof x === 'object' && 'number' in x && typeof (x as { number: unknown }).number === 'string' ? `\u0000n${(x as { number: string }).number}` : x))
    .replace(/"\\u0000n(-?\d+(?:\.\d+)?)"/g, '$1');
}

/** D7 — custom values as a mark in an Odoo text ("" for none), and read back from one (an HTML field's too). */
export const customMark = (c: CustomValues | undefined): string => (c && Object.keys(c).length > 0
  ? `[nomi:${Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b))))).toString('base64url')}]` : '');
const MARK_IN = /\s*\[nomi:([A-Za-z0-9_-]+)\]/;
export function readMark(text: string | null): { readonly rest: string | null; readonly custom: CustomValues | undefined } {
  const m = text === null ? null : MARK_IN.exec(text);
  if (!m || text === null) return { rest: text, custom: undefined };
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let v: unknown = null;
  try { v = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')); } catch { v = null; }
  const ok = v !== null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');
  const custom = ok && Object.keys(v as object).length > 0
    ? Object.fromEntries(Object.entries(v as Record<string, string>).sort(([a], [b]) => a.localeCompare(b))) : undefined;
  return { rest: rest === '' ? null : rest, custom };
}
const withValues = <T extends object>(r: T, c: CustomValues | undefined): T => (c ? { ...r, custom: c } : r);

/** Odoo's many2one: `[id, "name"]` (or the id alone). */
const idOf = (v: unknown): number | null =>
  (typeof v === 'object' && v !== null && 'number' in v ? Number((v as { number: string }).number)
    : Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'number' in v[0] ? Number((v[0] as { number: string }).number) : null);
const num = (v: unknown): Decimal | null => (typeof v === 'object' && v !== null && 'number' in v ? excelNumber((v as { number: string }).number) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const ids = (v: unknown): number[] => (Array.isArray(v) ? v.map(idOf).filter((x): x is number => x !== null) : []);

/** The raw records, as JSON-2's search_read gives them (and as the mapping writes them back). */
export type OdooRaw = {
  readonly companyCurrency: string;
  readonly accounts: readonly Record<string, unknown>[];
  readonly journals: readonly Record<string, unknown>[];
  readonly partners: readonly Record<string, unknown>[];
  readonly taxes: readonly Record<string, unknown>[];
  readonly taxAccounts: readonly Record<string, unknown>[];
  readonly moves: readonly Record<string, unknown>[];
  readonly lines: readonly Record<string, unknown>[];
};

const KIND_OF_TYPE = (t: string): BooksAccount['kind'] | null =>
  t.startsWith('asset') ? 'asset' : t.startsWith('liability') ? 'liability' : t.startsWith('equity') ? 'equity'
    : t.startsWith('income') ? 'income' : t.startsWith('expense') ? 'expense' : t === 'off_balance' ? 'off_balance' : null;
const TYPE_OF_KIND: Record<BooksAccount['kind'], string> = {
  asset: 'asset_current', liability: 'liability_current', equity: 'equity', income: 'income', expense: 'expense', off_balance: 'off_balance',
};
const JOURNAL_OF = { sale: 'sales', purchase: 'purchases', cash: 'cash', bank: 'bank', credit: 'bank', general: 'general' } as const;
const ODOO_JOURNAL = { sales: 'sale', purchases: 'purchase', cash: 'cash', bank: 'bank', general: 'general', closing: 'general' } as const;
const CODE = /^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/;

/** Odoo's records as the books (B1's shape), every problem located at its model and Odoo id. */
export function odooToBooks(raw: OdooRaw, bookCurrency: string): { data: BooksData; problems: BooksProblem[]; where: Located } {
  const problems: BooksProblem[] = [];
  const at = new Map<string, { sheet: string; row: number }>();
  const lineAt = new Map<string, number[]>();
  const note = (kind: RecordKind, key: string, model: string, id: number | null) => at.set(`${kind}:${key}`, { sheet: model, row: id ?? 0 });
  const bad = (model: string, id: number | null, column: string, reason: BooksProblem['reason']) => problems.push({ sheet: model, row: id ?? 0, column, reason });

  const accountCode = new Map<number, string>();
  const accounts: BooksAccount[] = [];
  for (const a of raw.accounts) {
    const id = idOf(a['id']); const code = str(a['code']); const kind = KIND_OF_TYPE(String(a['account_type'] ?? ''));
    if (!code || !CODE.test(code)) { bad('account.account', id, 'code', 'bad_code'); continue; }
    if (!kind) { bad('account.account', id, 'account_type', 'unknown_kind'); continue; }
    if (id !== null) accountCode.set(id, code);
    accounts.push({ code, name: str(a['name']) ?? code, kind, parent: null });
    note('account', code, 'account.account', id);
  }
  const journalCode = new Map<number, string>();
  const journals: BooksData['journals'][number][] = [];
  for (const j of raw.journals) {
    const id = idOf(j['id']); const code = str(j['code'])?.toUpperCase() ?? null;
    const kind = JOURNAL_OF[String(j['type'] ?? '') as keyof typeof JOURNAL_OF];
    if (!code || !/^[A-Z0-9]{1,8}$/.test(code)) { bad('account.journal', id, 'code', 'bad_code'); continue; }
    if (!kind) { bad('account.journal', id, 'type', 'unknown_kind'); continue; }
    if (id !== null) journalCode.set(id, code);
    journals.push({ code, name: str(j['name']) ?? code, kind });
    note('journal', code, 'account.journal', id);
  }
  const partnerCode = new Map<number, string>();
  const parties: BooksData['parties'][number][] = [];
  for (const p of raw.partners) {
    const id = idOf(p['id']);
    const ref = str(p['ref']);
    const code = ref && CODE.test(ref) ? ref : `P${id}`;
    const registry = str(p['company_registry']);
    if (id !== null) partnerCode.set(id, code);
    parties.push(withValues({
      code, name: str(p['name']) ?? code,
      kind: (num(p['customer_rank']) ?? '0') !== '0' ? 'customer' : (num(p['supplier_rank']) ?? '0') !== '0' ? 'supplier' : 'other',
      country: str(p['country_code']), ice: partyIce(str(p['country_code']), registry), taxNumber: str(p['vat']),
    }, readMark(str(p['comment'])).custom));
    note('party', code, 'res.partner', id);
  }
  const taxAccount = new Map<number, string>();
  for (const r of raw.taxAccounts) {
    const tax = idOf(r['tax_id']); const acc = idOf(r['account_id']);
    if (tax !== null && acc !== null && accountCode.has(acc)) taxAccount.set(tax, accountCode.get(acc)!);
  }
  const taxCode = new Map<number, string>();
  const taxCodes: BooksTaxCode[] = [];
  for (const t of raw.taxes) {
    const id = idOf(t['id']); const rate = num(t['amount']);
    if (id === null) continue;
    if (t['amount_type'] !== 'percent' || rate === null) { bad('account.tax', id, 'amount_type', 'unknown_kind'); continue; }
    const use = String(t['type_tax_use'] ?? '');
    const kind = rate === '0' ? 'exempt' : use === 'sale' ? 'collected' : use === 'purchase' ? 'deductible' : null;
    if (!kind) { bad('account.tax', id, 'type_tax_use', 'unknown_kind'); continue; }
    const code = odooTaxCode(id);
    taxCode.set(id, code);
    taxCodes.push({ code, label: str(t['name']) ?? code, rate, kind, account: kind === 'exempt' ? null : (taxAccount.get(id) ?? null), validFrom: null, validTo: null });
    note('tax_code', taxCodeKey({ code, validFrom: null }), 'account.tax', id);
  }
  const byMove = new Map<number, Record<string, unknown>[]>();
  for (const l of raw.lines) { const m = idOf(l['move_id']); if (m !== null) byMove.set(m, [...(byMove.get(m) ?? []), l]); }
  const entries: BooksEntry[] = [];
  for (const m of raw.moves) {
    const id = idOf(m['id']); const key = str(m['name']);
    const journal = journalCode.get(idOf(m['journal_id']) ?? -1);
    const date = str(m['date']);
    if (!key || key === '/' || !journal || !date) { bad('account.move', id, !journal ? 'journal_id' : 'name', 'required'); continue; }
    const rows: number[] = [];
    // A line of nothing (Odoo keeps zero tax lines) carries no side: it is not a line of the books.
    const moving = (byMove.get(id ?? -1) ?? []).filter((l) => ![num(l['debit']), num(l['credit']), num(l['amount_currency'])].every((x) => x === null || x === '0'));
    const lines: BooksLine[] = moving.map((l): BooksLine => {
      const currency = str(Array.isArray(l['currency_id']) ? l['currency_id'][1] : null) ?? raw.companyCurrency;
      const foreign = currency !== raw.companyCurrency;
      const amount = foreign ? num(l['amount_currency']) : null;
      const debit = foreign ? (amount !== null && !amount.startsWith('-') && amount !== '0' ? amount : null) : num(l['debit']);
      const credit = foreign ? (amount !== null && amount.startsWith('-') ? (amount.slice(1) as Decimal) : null) : num(l['credit']);
      const taxes = ids(l['tax_ids']);
      rows.push(idOf(l['id']) ?? 0);
      const named = readMark(str(l['name']));
      return withValues({
        account: accountCode.get(idOf(l['account_id']) ?? -1) ?? '', party: partnerCode.get(idOf(l['partner_id']) ?? -1) ?? null,
        taxCode: taxes.length === 1 ? (taxCode.get(taxes[0]!) ?? null) : null, currency,
        debit: debit === '0' ? null : debit, credit: credit === '0' ? null : credit, label: named.rest,
      }, named.custom);
    });
    entries.push(withValues({
      key, journal, date, label: str(m['ref']) ?? key, documentRef: key, documentDate: str(m['invoice_date']),
      state: m['state'] === 'posted' ? 'posted' : 'draft', lines,
    }, readMark(str(m['narration'])).custom));
    note('entry', key, 'account.move', id);
    lineAt.set(key, rows);
  }
  const data: BooksData = { accounts, journals, parties, taxCodes, entries };
  const where: Located = (kind, key, line) =>
    (kind === 'entry' && line !== undefined ? { sheet: 'account.move.line', row: lineAt.get(key)?.[line] ?? 0 } : at.get(`${kind}:${key}`) ?? { sheet: '', row: 0 });
  const none = new Set<string>();
  problems.push(...booksProblems(data, { accounts: none, journals: none, parties: none, taxCodes: none, bookCurrency }, where)
    .filter((p) => !['unknown_journal', 'unknown_party', 'unknown_tax_code', 'unknown_field'].includes(p.reason)));
  return { data, problems, where };
}

/** The books as Odoo's records (ids given in order): what Odoo can hold of them, for the mapping both ways. */
export function booksToOdoo(d: BooksData, companyCurrency: string): OdooRaw {
  const n = (v: Decimal | null) => ({ number: v ?? '0' });
  const accountId = new Map(d.accounts.map((a, i) => [a.code, i + 1]));
  const journalId = new Map(d.journals.map((j, i) => [j.code, i + 1]));
  const partnerId = new Map(d.parties.map((p, i) => [p.code, i + 1]));
  const taxId = new Map(d.taxCodes.map((t, i) => [t.code, i + 1]));
  let lineNo = 0;
  return {
    companyCurrency,
    accounts: d.accounts.map((a, i) => ({ id: { number: String(i + 1) }, code: a.code, name: a.name, account_type: TYPE_OF_KIND[a.kind] })),
    journals: d.journals.map((j, i) => ({ id: { number: String(i + 1) }, code: j.code, name: j.name, type: ODOO_JOURNAL[j.kind] })),
    partners: d.parties.map((p, i) => ({ id: { number: String(i + 1) }, ref: p.code, name: p.name,
      customer_rank: { number: p.kind === 'customer' ? '1' : '0' }, supplier_rank: { number: p.kind === 'supplier' ? '1' : '0' },
      country_code: p.country ?? false, vat: p.taxNumber ?? false, company_registry: p.ice ?? false, comment: customMark(p.custom) || false })),
    taxes: d.taxCodes.map((t, i) => ({ id: { number: String(i + 1) }, name: t.label, amount: { number: t.rate }, amount_type: 'percent',
      type_tax_use: t.kind === 'deductible' ? 'purchase' : 'sale' })),
    taxAccounts: d.taxCodes.filter((t) => t.account !== null).map((t) => ({ tax_id: [{ number: String(taxId.get(t.code)!) }, t.label],
      account_id: [{ number: String(accountId.get(t.account!)!) }, t.account] })),
    moves: d.entries.map((e, i) => ({ id: { number: String(i + 1) }, name: e.key, journal_id: [{ number: String(journalId.get(e.journal)!) }, e.journal],
      date: e.date, ref: e.label, invoice_date: e.documentDate ?? false, state: e.state, narration: customMark(e.custom) || false })),
    lines: d.entries.flatMap((e, i) => e.lines.map((l) => {
      const foreign = l.currency !== companyCurrency;
      return { id: { number: String(++lineNo) }, move_id: [{ number: String(i + 1) }, e.key],
        account_id: [{ number: String(accountId.get(l.account)!) }, l.account],
        partner_id: l.party === null ? false : [{ number: String(partnerId.get(l.party)!) }, l.party],
        tax_ids: l.taxCode === null ? [] : [{ number: String(taxId.get(l.taxCode)!) }],
        currency_id: [{ number: '1' }, l.currency], name: [l.label, customMark(l.custom)].filter(Boolean).join(' ') || false,
        debit: foreign ? { number: '0' } : n(l.debit), credit: foreign ? { number: '0' } : n(l.credit),
        amount_currency: foreign ? { number: l.debit !== null ? l.debit : `-${l.credit}` } : { number: '0' } };
    })),
  };
}

/** Item 14: a key's life, said on the books' page — fine, renew it soon (80 days in, or 10 days before it ends), or expired. */
export function odooKeyState(connectedOn: string, expiresOn: string | null, today: string): 'fine' | 'renew' | 'expired' {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;
  const ends = expiresOn ?? new Date((day(connectedOn) + 90) * 86_400_000).toISOString().slice(0, 10);
  if (today >= ends) return 'expired';
  if (day(today) - day(connectedOn) >= ODOO_KEY_REMIND_AT_DAYS || day(ends) - day(today) <= 10) return 'renew';
  return 'fine';
}

/** Read everything the books take from this Odoo (entries since the cursor), as raw records. */
async function readOdoo(post: PublicPost, s: OdooSource, cursor: string | null): Promise<{ raw: OdooRaw; cursor: string | null } | ConnectRefusal> {
  const search = async (model: string, domain: unknown[], fields: string[]) => {
    const r = await json2(post, s, model, 'search_read', { domain, fields, context: { lang: 'en_US' } });
    if (!r.ok) return r.refusal;
    return Array.isArray(r.value) ? (r.value as Record<string, unknown>[]) : refused('unreadable');
  };
  const company = await search('res.company', [], ['currency_id']);
  if (!Array.isArray(company)) return company;
  const companyCurrency = str(Array.isArray(company[0]?.['currency_id']) ? (company[0]!['currency_id'] as unknown[])[1] : null) ?? 'MAD';
  const accounts = await search('account.account', [], ['code', 'name', 'account_type']); if (!Array.isArray(accounts)) return accounts;
  const journals = await search('account.journal', [], ['code', 'name', 'type']); if (!Array.isArray(journals)) return journals;
  const partners = await search('res.partner', ['|', ['customer_rank', '>', 0], ['supplier_rank', '>', 0]],
    ['ref', 'name', 'customer_rank', 'supplier_rank', 'country_code', 'vat', 'company_registry', 'comment']); if (!Array.isArray(partners)) return partners;
  const taxes = await search('account.tax', [], ['name', 'amount', 'amount_type', 'type_tax_use']); if (!Array.isArray(taxes)) return taxes;
  const taxAccounts = await search('account.tax.repartition.line', [['repartition_type', '=', 'tax'], ['document_type', '=', 'invoice']],
    ['tax_id', 'account_id']); if (!Array.isArray(taxAccounts)) return taxAccounts;
  const moves = await search('account.move', [['state', 'in', ['draft', 'posted']], ...(cursor ? [['write_date', '>', cursor]] : [])],
    ['name', 'journal_id', 'date', 'ref', 'invoice_date', 'state', 'write_date', 'narration']); if (!Array.isArray(moves)) return moves;
  const moveIds = moves.map((m) => idOf(m['id'])).filter((x): x is number => x !== null);
  const lines = moveIds.length === 0 ? [] : await search('account.move.line', [['move_id', 'in', moveIds]],
    ['move_id', 'account_id', 'partner_id', 'tax_ids', 'currency_id', 'debit', 'credit', 'amount_currency', 'name']);
  if (!Array.isArray(lines)) return lines;
  const newest = moves.map((m) => str(m['write_date'])).filter((x): x is string => x !== null).sort().pop() ?? cursor;
  return { raw: { companyCurrency, accounts, journals, partners, taxes, taxAccounts, moves, lines }, cursor: newest ?? null };
}

/**
 * The connector (B1's shape). `connect` is item 15: the address read as a public https origin, the key tried against
 * Odoo, the plan and the database checked — and refused, with its reason, before anything is saved.
 */
export function odooConnector(post: PublicPost, bookCurrency: string, today: () => string): BooksConnector<OdooSource, OdooRaw> {
  return {
    config: {
      system: 'odoo', signIn: 'key',
      fields: [{ name: 'url', kind: 'url', required: true }, { name: 'database', kind: 'text', required: true },
        { name: 'key', kind: 'secret', required: true }, { name: 'expires', kind: 'text', required: true }],
    },
    async connect(values) {
      const [url, database, key, expires] = [values['url'], values['database'], values['key'], values['expires']];
      if (typeof url !== 'string' || typeof database !== 'string' || typeof key !== 'string' || typeof expires !== 'string') return refused('wrong_credentials');
      const address = readStoreAddress(url);
      if (!address.ok) return refused('not_an_address');
      if (!/^[A-Za-z0-9_.-]{1,63}$/.test(database.trim())) return refused('wrong_database');
      // Item 14: the expiry Odoo showed, within its three months; already past is refused now.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || expires <= today()) return refused('key_expired');
      const source: OdooSource = { origin: address.origin, database: database.trim(), key: key.trim() };
      const probe = await json2(post, source, 'res.users', 'context_get', {});
      if (!probe.ok) return probe.refusal;
      return { kind: 'connected', source, grant: { secret: source.key, expiresAt: expires } };
    },
    async refresh(grant: Grant) {
      // A key is not refreshed: it lasts until its own expiry, then a new one is made in Odoo (item 14).
      return grant.expiresAt !== null && grant.expiresAt <= today() ? refused('key_expired') : grant;
    },
    async revoke() { return 'nothing_held' as const; /* the key is the owner's to delete in Odoo (Preferences → Account Security); Nomi forgets it */ },
    toBooks: (raw) => odooToBooks(raw, bookCurrency),
    fromBooks: (d) => booksToOdoo(d, bookCurrency),
    async changedSince(source, cursor) {
      const read = await readOdoo(post, source, cursor);
      if ('kind' in read) return read;
      const { data, problems, where } = odooToBooks(read.raw, bookCurrency);
      return { kind: 'read', data, problems, where, cursor: read.cursor };
    },
  };
}


/** C4 — one of Nomi's posted entries, as Odoo takes it: amounts in the company's currency, and a foreign line's own. */
export type OdooEntryOut = {
  readonly key: string; readonly journal: string; readonly date: string; readonly label: string; readonly custom?: CustomValues;
  readonly lines: readonly { readonly account: string; readonly party: string | null; readonly currency: string; readonly label: string | null;
    readonly bookDebit: Decimal; readonly bookCredit: Decimal; readonly own: Decimal; readonly custom?: CustomValues }[];
};
/** A sent entry: Nomi's number, and the name Odoo gave the move when it was posted (null if Odoo would not say). */
export type OdooSent = { readonly key: string; readonly odooName: string | null };
export type OdooWriteConflict = { readonly key: string; readonly reason: 'already_in_odoo' | 'no_account' | 'no_journal' | 'no_partner' | 'no_currency' | 'refused'; readonly detail: string };

/**
 * C4 (item 13, part 2) — NOMI'S POSTED ENTRIES INTO THE SHOP'S ODOO, each created and posted there, its reference
 * Nomi's number. Never over anything: an entry Odoo already holds under that reference, or one naming an account,
 * journal, partner or currency Odoo does not have, is a CONFLICT — shown, and left for the owner; Nomi changes nothing
 * in Odoo for it. Odoo's own rules then apply (it refuses an entry that does not balance in its currency).
 */
export async function sendEntriesToOdoo(post: PublicPost, s: OdooSource, entries: readonly OdooEntryOut[]):
  Promise<{ readonly written: readonly OdooSent[]; readonly conflicts: readonly OdooWriteConflict[] } | ConnectRefusal> {
  const search = async (model: string, domain: unknown[], fields: string[]) => {
    const r = await json2(post, s, model, 'search_read', { domain, fields });
    if (!r.ok) return r.refusal;
    return Array.isArray(r.value) ? (r.value as Record<string, unknown>[]) : refused('unreadable');
  };
  const ids = async (model: string, field: string, values: readonly string[]) => {
    const rows = values.length === 0 ? [] : await search(model, [[field, 'in', [...new Set(values)]]], [field]);
    if (!Array.isArray(rows)) return rows;
    return new Map(rows.map((r) => [String(r[field]), idOf(r['id'])!]));
  };
  const accounts = await ids('account.account', 'code', entries.flatMap((e) => e.lines.map((l) => l.account))); if (!(accounts instanceof Map)) return accounts;
  const journals = await ids('account.journal', 'code', entries.map((e) => e.journal)); if (!(journals instanceof Map)) return journals;
  const partners = await ids('res.partner', 'ref', entries.flatMap((e) => e.lines.map((l) => l.party).filter((p): p is string => p !== null))); if (!(partners instanceof Map)) return partners;
  const currencies = await ids('res.currency', 'name', entries.flatMap((e) => e.lines.map((l) => l.currency))); if (!(currencies instanceof Map)) return currencies;
  const there = await ids('account.move', 'ref', entries.map((e) => e.key)); if (!(there instanceof Map)) return there;
  const company = await search('res.company', [], ['currency_id']);
  if (!Array.isArray(company)) return company;
  const companyCurrency = str(Array.isArray(company[0]?.['currency_id']) ? (company[0]!['currency_id'] as unknown[])[1] : null) ?? '';
  const written: OdooSent[] = []; const conflicts: OdooWriteConflict[] = [];
  for (const e of entries) {
    if (there.has(e.key)) { conflicts.push({ key: e.key, reason: 'already_in_odoo', detail: e.key }); continue; }
    if (!journals.has(e.journal)) { conflicts.push({ key: e.key, reason: 'no_journal', detail: e.journal }); continue; }
    const missing = e.lines.find((l) => !accounts.has(l.account)) ?? null;
    if (missing) { conflicts.push({ key: e.key, reason: 'no_account', detail: missing.account }); continue; }
    const noPartner = e.lines.find((l) => l.party !== null && !partners.has(l.party)) ?? null;
    if (noPartner) { conflicts.push({ key: e.key, reason: 'no_partner', detail: noPartner.party! }); continue; }
    const noCurrency = e.lines.find((l) => !currencies.has(l.currency)) ?? null;
    if (noCurrency) { conflicts.push({ key: e.key, reason: 'no_currency', detail: noCurrency.currency }); continue; }
    const n = (x: Decimal) => ({ number: x });
    const vals = { journal_id: journals.get(e.journal), date: e.date, ref: e.key, move_type: 'entry',
      ...(customMark(e.custom) ? { narration: customMark(e.custom) } : {}), line_ids: e.lines.map((l) => [0, 0, {
      account_id: accounts.get(l.account), partner_id: l.party === null ? false : partners.get(l.party),
      name: [l.label ?? e.label, customMark(l.custom)].filter(Boolean).join(' '),
      debit: n(l.bookDebit), credit: n(l.bookCredit),
      ...(l.currency !== companyCurrency ? { currency_id: currencies.get(l.currency), amount_currency: n(l.own) } : {}),
    }]) };
    const made = await json2(post, s, 'account.move', 'create', { vals_list: [vals] }, true);
    if (!made.ok) { if (made.refusal.reason === 'unreachable' || made.refusal.reason === 'wrong_credentials') return made.refusal; conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    const created = Array.isArray(made.value) ? idOf(made.value[0]) : idOf(made.value);
    if (created === null) { conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    const posted = await json2(post, s, 'account.move', 'action_post', { ids: [created] }, true);
    if (!posted.ok) { conflicts.push({ key: e.key, reason: 'refused', detail: e.key }); continue; }
    // its posted name, so the next read knows this move is Nomi's own and does not bring it back as a new entry
    const named = await search('account.move', [['id', '=', created]], ['name']);
    written.push({ key: e.key, odooName: Array.isArray(named) ? str(named[0]?.['name']) : null });
  }
  return { written, conflicts };
}
