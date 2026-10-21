import type { PublicPost } from '../../src/net/publicFetch.js';
import { booksToOdoo, type OdooRaw } from '../../src/books/connectors/odoo.js';
import { canonical, type BooksData } from '../../src/core/books/interchange.js';

/**
 * B4 — a recorded fake of an Odoo 19 server's External JSON-2 API: POST /json/2/<model>/<method>, "bearer" and the
 * key, the database in X-Odoo-Database. Answers as documented: 200 and the method's value; an error as Odoo's JSON
 * object (name, message, arguments, context, debug) with 401 "Invalid apikey" for a wrong key. Not documented, and
 * so assumed here and checked live on deploy day: a database the server does not have is a 404 with Odoo's error
 * object, and a Free or Standard plan refuses an authenticated call with 403.
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
  const post: PublicPost = async (url, headers, body) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (u.host !== host) return null;                                               // nothing answers there
    const m = /^\/json\/2\/([a-z.]+)\/([a-z_]+)$/.exec(u.pathname);
    if (!m) return { status: 404, text: '<!DOCTYPE html><title>404</title>' };
    if (headers['x-odoo-database'] !== 'shop-db') return error(404, 'werkzeug.exceptions.NotFound', '404 Not Found: the requested database does not exist on this server.');
    if (headers['authorization'] !== 'bearer good-key') return error(401, 'werkzeug.exceptions.Unauthorized', 'Invalid apikey');
    if (tier === 'standard') return error(403, 'odoo.exceptions.AccessDenied', 'Access to data via the external API is only available on Custom Odoo pricing plans.');
    const [model, method] = [m[1]!, m[2]!];
    if (model === 'res.users' && method === 'context_get') return { status: 200, text: JSON.stringify({ lang: 'en_US', tz: 'Africa/Casablanca', uid: 2 }) };
    if (method !== 'search_read') return error(404, 'werkzeug.exceptions.NotFound', '404 Not Found');
    const { domain = [] } = JSON.parse(body) as { domain?: unknown[] };
    if (model === 'account.move') moveDomains.push(JSON.stringify(domain));
    const after = (domain.find((d) => Array.isArray(d) && d[0] === 'write_date') as unknown[] | undefined)?.[2] as string | undefined;
    const inMoves = (domain.find((d) => Array.isArray(d) && d[0] === 'move_id') as unknown[] | undefined)?.[2] as number[] | undefined;
    const rows: Record<string, unknown[]> = {
      'res.company': [{ id: { number: '1' }, currency_id: [{ number: '1' }, raw.companyCurrency] }],
      'account.account': [...raw.accounts], 'account.journal': [...raw.journals], 'res.partner': [...raw.partners],
      'account.tax': [...raw.taxes], 'account.tax.repartition.line': [...raw.taxAccounts],
      'account.move': raw.moves.map((mv) => ({ ...mv, write_date: written.get(String(mv['name']))?.at ?? '2026-01-01 00:00:00' }))
        .filter((mv) => !after || String(mv['write_date']) > after),
      'account.move.line': raw.lines.filter((l) => !inMoves || inMoves.includes(idOf(l['move_id']))),
    };
    if (!(model in rows)) return error(404, 'werkzeug.exceptions.NotFound', '404 Not Found');
    return { status: 200, text: numbers(rows[model]) };
  };
  return {
    post, calls, moveDomains,
    plan: (p) => { tier = p; },
    publish(data) {
      raw = booksToOdoo(data, 'MAD');
      for (const e of data.entries) {
        const content = canonical(e);
        if (written.get(e.key)?.content !== content) written.set(e.key, { content, at: `2026-10-22 10:${String(++clock).padStart(2, '0')}:00` });
      }
    },
  };
}
