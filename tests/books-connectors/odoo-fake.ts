import type { PublicPost } from '../../src/net/publicFetch.js';
import { booksToOdoo, type OdooRaw } from '../../src/books/connectors/odoo.js';
import { canonical, type BooksData } from '../../src/core/books/interchange.js';

/**
 * B4 — a recorded fake of an Odoo 19 server's External JSON-2 API: POST /json/2/<model>/<method>, "bearer" and the
 * key, the database in X-Odoo-Database. Answers as documented: 200 and the method's value; an error as Odoo's JSON
 * object (name, message, arguments, context, debug) with 401 "Invalid apikey" for a wrong key. A database the server
 * does not have is a 404 with Odoo's own no-database HTML page, as Odoo 19's source answers it (odoo/http.py,
 * `NOT_FOUND_NODB`, read 2026-10-21). Not documented and not in the open source, and so assumed here until a real
 * Odoo Online answers it: a Free or Standard plan refuses an authenticated call with 403.
 *
 * C4 adds what writing back uses: search_read on any of these models with Odoo's domain triples (`=`, `in`, `>`),
 * res.currency (the active ones), and account.move's `create` (vals_list, one2many `[0, 0, vals]` lines; a move
 * whose debits and credits differ is refused with Odoo's UserError, as Odoo does) and `action_post` (the move gets
 * its sequence name, JOURNAL/YEAR/NNNN, and a later write_date).
 */
export type OdooFake = {
  readonly post: PublicPost;
  /** The shop's books in this Odoo, as Odoo would hold them; each entry changed since the last publish gets a later write_date. */
  publish(data: BooksData): void;
  /** The plan the database is on. */
  plan(p: 'custom' | 'standard'): void;
  readonly calls: string[];
  /** The domain of every account.move search, as JSON: where reading went on from. */
  readonly moveDomains: string[];
  /** The currencies active in this Odoo (default MAD, EUR, USD). */
  currencies(names: readonly string[]): void;
  /** The moves created through the API, with their lines as sent. */
  readonly created: { readonly id: number; readonly vals: Record<string, unknown> }[];
};

const error = (status: number, name: string, message: string) => ({ status, text: JSON.stringify({ name, message, arguments: [message], context: {}, debug: `Traceback (most recent call last):\n${name}: ${message}` }) });
/** JSON with each `{ number }` written as the number it is (Odoo sends numbers as JSON numbers). */
const numbers = (v: unknown) => JSON.stringify(v, (_k, x: unknown) =>
  (x && typeof x === 'object' && 'number' in x ? `\u0000${(x as { number: string }).number}` : x)).replace(/"\\u0000(-?[0-9.]+)"/g, '$1');

export function odooFake(host = 'shop.odoo.com'): OdooFake {
  let raw: OdooRaw = booksToOdoo({ accounts: [], journals: [], parties: [], taxCodes: [], entries: [] }, 'MAD');
  let tier: 'custom' | 'standard' = 'custom';
  let clock = 0;
  const written = new Map<string, { content: string; at: string }>();
  const calls: string[] = [];
  const moveDomains: string[] = [];
  const idOf = (v: unknown) => Number(Array.isArray(v) ? (v[0] as { number: string }).number : (v as { number: string }).number);
  let active = ['MAD', 'EUR', 'USD'];
  const created: { id: number; vals: Record<string, unknown> }[] = [];
  let extraMoves: Record<string, unknown>[] = [];
  let extraLines: Record<string, unknown>[] = [];
  const seq = new Map<string, number>();
  /** A field's value as a domain compares it: a many2one's id, a `{ number }`'s digits. */
  const plain = (v: unknown): unknown => (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' ? plain(v[0])
    : v && typeof v === 'object' && 'number' in v ? Number((v as { number: string }).number) : v);
  const leaf = (row: Record<string, unknown>, d: unknown[]) => {
    const [f, op, want] = d as [string, string, unknown];
    const v = plain(row[f]);
    if (op === '=') return v === want;
    if (op === 'in') return (want as unknown[]).includes(v);
    if (op === '>') return typeof want === 'number' ? Number(v) > want : String(v) > String(want);
    throw new Error(`the fake does not know the operator ${op}`);
  };
  /** Odoo's domain: prefix '|' and '&' over the next two terms, an implicit '&' between the rest. */
  const matches = (row: Record<string, unknown>, domain: unknown[]) => {
    let i = 0;
    const term = (): boolean => {
      const d = domain[i++];
      if (d === '|') { const a = term(); const b = term(); return a || b; }
      if (d === '&') { const a = term(); const b = term(); return a && b; }
      return leaf(row, d as unknown[]);
    };
    let all = true;
    while (i < domain.length) all = term() && all;
    return all;
  };
  const post: PublicPost = async (url, headers, body) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.host !== host) return null;                                               // nothing answers there
    const m = /^\/json\/2\/([a-z.]+)\/([a-z_]+)$/.exec(u.pathname);
    if (!m) return { status: 404, text: '<!DOCTYPE html><title>404</title>' };
    // odoo/http.py (19.0) NOT_FOUND_NODB, verbatim: what a request with no usable database gets on a db route
    if (headers['x-odoo-database'] !== 'shop-db') return { status: 404, text: '<!DOCTYPE html>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n<p>No database is selected and the requested URL was not found in the server-wide controllers.</p>\n<p>Please verify the hostname, <a href=/web/login>login</a> and try again.</p>\n\n<!-- Alternatively, use the X-Odoo-Database header. -->\n' };
    if (headers['authorization'] !== 'bearer good-key') return error(401, 'werkzeug.exceptions.Unauthorized', 'Invalid apikey');
    if (tier === 'standard') return error(403, 'odoo.exceptions.AccessDenied', 'Access to data via the external API is only available on Custom Odoo pricing plans.');
    const [model, method] = [m[1]!, m[2]!];
    if (model === 'res.users' && method === 'context_get') return { status: 200, text: JSON.stringify({ lang: 'en_US', tz: 'Africa/Casablanca', uid: 2 }) };
    const moves = () => [...raw.moves.map((mv) => ({ ...mv, write_date: written.get(String(mv['name']))?.at ?? '2026-01-01 00:00:00' })), ...extraMoves];
    if (model === 'account.move' && method === 'create') {
      const { vals_list } = JSON.parse(body) as { vals_list: Record<string, unknown>[] };
      const ids: number[] = [];
      for (const vals of vals_list) {
        const lines = (vals['line_ids'] as [number, number, Record<string, unknown>][]).map((l) => l[2]);
        const cents = (k: 'debit' | 'credit') => lines.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0);
        if (cents('debit') !== cents('credit')) return error(422, 'odoo.exceptions.UserError', 'The entry is not balanced.');
        const journal = raw.journals.find((j) => idOf(j['id']) === vals['journal_id']);
        if (!journal) return error(422, 'odoo.exceptions.ValidationError', 'Journal does not exist.');
        const id = 1000 + created.length + 1;
        created.push({ id, vals });
        extraMoves.push({ id: { number: String(id) }, name: '/', journal_id: [{ number: String(vals['journal_id']) }, journal['code']], date: vals['date'],
          ref: vals['ref'], invoice_date: false, state: 'draft', write_date: `2026-10-23 09:${String(++clock).padStart(2, '0')}:00` });
        for (const l of lines) {
          const acc = raw.accounts.find((a) => idOf(a['id']) === l['account_id'])!;
          const cur = l['currency_id'] ? active[Number(l['currency_id']) - 1]! : raw.companyCurrency;
          extraLines.push({ id: { number: String(5000 + extraLines.length) }, move_id: [{ number: String(id) }, '/'], account_id: [{ number: String(l['account_id']) }, acc['code']],
            partner_id: l['partner_id'] ? [{ number: String(l['partner_id']) }, 'x'] : false, tax_ids: [], currency_id: [{ number: '1' }, cur], name: l['name'] ?? false,
            debit: { number: String(l['debit']) }, credit: { number: String(l['credit']) }, amount_currency: { number: String(l['amount_currency'] ?? 0) } });
        }
        ids.push(id);
      }
      return { status: 200, text: JSON.stringify(ids) };
    }
    if (model === 'account.move' && method === 'action_post') {
      const { ids } = JSON.parse(body) as { ids: number[] };
      for (const id of ids) {
        const mv = extraMoves.find((x) => idOf(x['id']) === id);
        if (!mv) return error(422, 'odoo.exceptions.MissingError', 'Record does not exist or has been deleted.');
        const code = String((mv['journal_id'] as unknown[])[1]); const year = String(mv['date']).slice(0, 4);
        const next = (seq.get(`${code}/${year}`) ?? 0) + 1; seq.set(`${code}/${year}`, next);
        const name = `${code}/${year}/${String(next).padStart(4, '0')}`;
        extraMoves = extraMoves.map((x) => (x === mv ? { ...x, name, state: 'posted', write_date: `2026-10-23 09:${String(++clock).padStart(2, '0')}:00` } : x));
        extraLines = extraLines.map((l) => (idOf(l['move_id']) === id ? { ...l, move_id: [{ number: String(id) }, name] } : l));
      }
      return { status: 200, text: 'false' };
    }
    if (method !== 'search_read') return error(404, 'werkzeug.exceptions.NotFound', '404 Not Found');
    const { domain = [] } = JSON.parse(body) as { domain?: unknown[] };
    if (model === 'account.move') moveDomains.push(JSON.stringify(domain));
    const rows: Record<string, Record<string, unknown>[]> = {
      'res.company': [{ id: { number: '1' }, currency_id: [{ number: '1' }, raw.companyCurrency] }],
      'account.account': [...raw.accounts], 'account.journal': [...raw.journals], 'res.partner': [...raw.partners],
      'account.tax': [...raw.taxes], 'account.tax.repartition.line': raw.taxAccounts.map((t) => ({ ...t, repartition_type: 'tax', document_type: 'invoice' })),
      'account.move': moves(), 'account.move.line': [...raw.lines, ...extraLines],
      'res.currency': active.map((name, i) => ({ id: { number: String(i + 1) }, name })),
    };
    if (!(model in rows)) return error(404, 'werkzeug.exceptions.NotFound', '404 Not Found');
    return { status: 200, text: numbers(rows[model]!.filter((r) => matches(r, domain))) };
  };
  return {
    post, calls, moveDomains, created,
    plan: (p) => { tier = p; },
    currencies: (names) => { active = [...names]; },
    publish(data) {
      raw = booksToOdoo(data, 'MAD');
      for (const e of data.entries) {
        const content = canonical(e);
        if (written.get(e.key)?.content !== content) written.set(e.key, { content, at: `2026-10-22 10:${String(++clock).padStart(2, '0')}:00` });
      }
    },
  };
}
