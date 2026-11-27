import Fastify, { type FastifyInstance } from 'fastify';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { registerWebApp, type WebDeps } from '../../src/api/web/app.js';
import { makeSessionCodec } from '../../src/api/web/session.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';
import { AREAS } from '../../src/api/web/sections.js';

/**
 * THE SETTINGS OVERHAUL (rule 104) — how a test draws a settings page: the REAL app and the real route, asked with a
 * signed-in owner's cookie, over a database that answers every question with nothing (a new workspace with nothing
 * set), except that the books are switched on so the Books group exists. Nothing is written; no Postgres is needed.
 * `answers` lets a test give one question rows of its own (matched against the SQL text) where a line it guards is
 * drawn only when something is there.
 */
const SECRET = 'x'.repeat(64);
/** Every page of the Settings menu, whoever is looking: the 23 of rule 104 and the three channels that come and go. */
export const SETTINGS_MENU_PAGES: readonly { readonly href: string; readonly label: MessageKey; readonly group: string }[] =
  AREAS.settings.flatMap((g) => g.items.map((i) => ({ href: i.href, label: i.label, group: g.id ?? '' })));

export const WORKSPACE = 'de300000-0000-4000-8000-0000000000b1';

export type Answers = readonly (readonly [RegExp, readonly unknown[]])[];
/** The select list of a query: its text up to the first FROM that is not inside brackets (all of it when there is none). */
const selectList = (q: string): { list: string; from: boolean } => {
  let depth = 0;
  for (let i = 0; i < q.length; i++) {
    if (q[i] === '(') depth++;
    else if (q[i] === ')') depth--;
    else if (depth === 0 && /^\sfrom\s/i.test(q.slice(i, i + 6))) return { list: q.slice(0, i), from: true };
  }
  return { list: q, from: false };
};
/** Split on commas that are not inside brackets. */
const parts = (list: string): string[] => {
  const out: string[] = []; let depth = 0, at = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++; else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) { out.push(list.slice(at, i)); at = i + 1; }
  }
  return [...out, list.slice(at)];
};
/**
 * A question that always has ONE row (a count, a sum, an "is there any", a value worked out with no table) is
 * answered as an empty workspace would answer it: 0, false, or nothing. Everything else has no rows.
 */
/** The words of an expression that are not inside brackets. */
const outside = (e: string): string => {
  let depth = 0, out = '';
  for (const c of e) { if (c === '(') depth++; else if (c === ')') depth--; else if (depth === 0) out += c; }
  return out;
};
/** The main SELECT of a query, past any WITH … AS (…) before it. */
const mainSelect = (q: string): string | null => {
  const text = q.trim();
  if (/^select\s/i.test(text)) return text;
  if (!/^with\s/i.test(text)) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0 && /^\)\s*select\s/i.test(text.slice(i, i + 40))) return text.slice(i + 1).trim(); }
  }
  return null;
};
const oneRow = (q: string): Record<string, unknown> | null => {
  const text = mainSelect(q);
  if (text === null || /\sgroup\s+by\s/i.test(outside(text))) return null;
  const { list, from } = selectList(text.replace(/^select\s+/i, ''));
  const cols = parts(list);
  const head = (e: string): string => e.trim().replace(/^[(\s]+/, '');
  const counts = (e: string): boolean => /^(select\s+)?(coalesce\s*\(\s*\(?\s*(select\s+)?)?(count|sum)\s*\(/i.test(head(e));
  const aggregate = (e: string): boolean => counts(e) || /^(max|min|bool_or|bool_and|array_agg|json_agg|jsonb_agg|string_agg|coalesce\s*\(\s*(max|min|bool_or|bool_and|array_agg|json_agg|jsonb_agg|string_agg))\s*\(/i.test(head(e))
    || /^(not\s+)?exists\b/i.test(head(e)) || /^\s*\(\s*select\b/i.test(e) || /^\s*(not\s+)?exists\s*\(/i.test(e);
  if (from && !cols.every(aggregate)) return null;
  const row: Record<string, unknown> = {};
  for (const e of cols) {
    const name = /\bas\s+"?(\w+)"?\s*$/i.exec(e.trim())?.[1] ?? /(\w+)\s*$/.exec(e.trim())?.[1];
    if (!name) continue;
    row[name] = counts(e) ? 0
      : /^(not\s+)?exists\b|^bool_/i.test(head(e)) || /\sis\s+(not\s+)?null|\s(=|<|>|<>|>=|<=)\s|\s(and|or)\s/i.test(outside(e)) ? false
      : /^(date_trunc|now)\s*\(/i.test(head(e)) ? new Date(0) : null;
  }
  return row;
};
const answer = (q: string, more: Answers): readonly unknown[] => {
  for (const [re, rows] of more) if (re.test(q)) return rows;
  // The books are on (so Settings has its Books group), and the workspace keeps no country's books yet.
  if (/select books_area as on from businesses/.test(q)) return [{ on: true }];
  // Every workspace has its default assistant.
  if (/select id::text as id, name, role, note, channels, is_default, tone, length, emoji from assistants/.test(q))
    return [{ id: 'de300000-0000-4000-8000-0000000000a1', name: 'Lily', role: 'sales', note: null, channels: null, is_default: true, tone: null, length: null, emoji: null }];
  if (/ as waiting,/.test(q)) return [{ waiting: 0, blocked: 0, mine: 0, deletion: 0, channels: 0 }];
  const one = oneRow(q);
  return one ? [one] : [];
};
const quietDb = (more: Answers): Kysely<never> => new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createDriver: () => ({
      init: async () => {}, destroy: async () => {},
      acquireConnection: async () => ({
        executeQuery: async (q: CompiledQuery) => ({ rows: answer(q.sql, more) as never[] }),
        // eslint-disable-next-line require-yield
        streamQuery: async function* () { return; },
      }),
      beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
      releaseConnection: async () => {},
    }),
  },
});

export const settingsApp = (o: { readonly answers?: Answers; readonly deps?: Partial<WebDeps> } = {}): FastifyInstance => {
  const a = Fastify({ logger: false });
  registerWebApp(a, {
    db: quietDb(o.answers ?? []) as never, sessionSecret: SECRET, accessCode: 'let-me-in',
    businessId: WORKSPACE, employeeName: 'Lily', avatar: '', provider: 'disabled',
    secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    ...o.deps,
  });
  return a;
};
const cookie = (locale: Locale): string =>
  `yf_session=${makeSessionCodec(SECRET).sign({ businessId: WORKSPACE, exp: Date.now() + 3_600_000 })}; yf_locale=${locale}`;

/** The page at `path` as the owner sees it in `locale`: its status and its HTML (the whole document). */
export async function drawSettingsPage(app: FastifyInstance, path: string, locale: Locale): Promise<{ status: number; html: string; location: string | null }> {
  const r = await app.inject({ method: 'GET', url: path, headers: { accept: 'text/html', cookie: cookie(locale) } });
  return { status: r.statusCode, html: r.body, location: (r.headers['location'] as string | undefined) ?? null };
}
/** A form of a settings page, sent as the owner sends it: its status, its HTML and where it sends the browser. */
export async function postSettingsForm(app: FastifyInstance, path: string, locale: Locale, fields: Readonly<Record<string, string>>): Promise<{ status: number; html: string; location: string | null }> {
  const r = await app.inject({ method: 'POST', url: path, payload: new URLSearchParams(fields).toString(),
    headers: { accept: 'text/html', cookie: cookie(locale), 'content-type': 'application/x-www-form-urlencoded' } });
  return { status: r.statusCode, html: r.body, location: (r.headers['location'] as string | undefined) ?? null };
}
/** The page's own content: what is inside `<main>`. */
export const mainOf = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
/** The words of the page's one `<h1>`. */
export const h1Of = (html: string): string | null =>
  /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(mainOf(html))?.[1]?.replace(/<[^>]+>/g, '').trim() ?? null;
