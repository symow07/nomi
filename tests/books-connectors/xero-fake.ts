import { randomUUID } from 'node:crypto';
import type { OAuthFetch } from '../../src/connectors/oauth.js';
import { booksToXero, type XeroRaw } from '../../src/books/connectors/xero.js';
import type { BooksData } from '../../src/core/books/interchange.js';

/**
 * D8 — a recorded fake of Xero, from its developer documentation (2026-10-22): the identity server's token and
 * revocation endpoints (the client's secret in a Basic header; a refresh token that ROTATES — the old one stops
 * working), `/connections` (filtered by `authEventId`), and the Accounting API calls the connector makes, in JSON:
 * Organisation, Accounts, TaxRates, Contacts and ManualJournals (paged, 100 a page, `If-Modified-Since`), and creating
 * a manual journal (POST, an `Idempotency-Key` answered the same within its six minutes). As Xero does, it answers a
 * date as "/Date(ms+0000)/" and an amount as a JSON number; a wrong tenant is 403 "AuthenticationUnsuccessful", an
 * unknown token 401, a journal that does not balance, names an unknown account or a system one, 400
 * "ValidationException". Checked live against Xero on deploy day.
 */
export type XeroFake = {
  readonly fetch: OAuthFetch;
  /** The organisation's books, as Xero would hold them; each journal changed since the last publish gets a later UpdatedDateUTC. */
  publish(data: BooksData, baseCurrency?: string): void;
  /** The owner let Nomi into these organisations on the consent screen (default: one, "Westlake Canvas Co."). */
  organisations(names: readonly string[]): void;
  /** A fresh authorisation code, as Xero's redirect would bring one (each is used once). */
  code(): string;
  /** The owner disconnected the app in Xero (Settings → Connected apps). */
  disconnect(): void;
  /** The manual journals created through the API, as sent. */
  readonly created: { readonly body: Record<string, unknown>; readonly idempotencyKey: string | null }[];
  /** A system account (AR, AP, retained earnings): journals naming it are refused, as Xero does. */
  systemAccount(code: string): void;
  readonly calls: string[];
  /** The refresh tokens Xero would still honour. */
  readonly liveRefresh: () => readonly string[];
  /** 0212 — the revocation endpoint does not answer (503) — or, with `false`, answers again. */
  revokeDown(down?: boolean): void;
  /** 0212 — revoking a refresh token ends EVERY connection the person made (Xero's own words, devblog 2020-08), not
   * only the consent it came from — the case a stale grant given back must catch. */
  revokeEndsEverything(): void;
};

export const XERO_CLIENT = { clientId: 'nomi-xero-test-client', clientSecret: 'xero-test-secret' };
const N = '~#n#~';
/** JSON as Xero writes it: `{ number }` values as JSON numbers with their own digits. */
const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) =>
  (x && typeof x === 'object' && 'number' in x && Object.keys(x).length === 1 ? `${N}${(x as { number: string }).number}` : x))
  .replace(new RegExp(`"${N}(-?[0-9.]+)"`, 'g'), '$1');
const answer = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : json(body)) });
const dateOf = (day: string) => `/Date(${Date.parse(`${day}T00:00:00Z`)}+0000)/`;
const FORBIDDEN = { Type: null, Title: 'Forbidden', Status: 403, Detail: 'AuthenticationUnsuccessful', Instance: randomUUID(), Extensions: {} };
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`;

export function xeroFake(): XeroFake {
  let raw: XeroRaw = booksToXero({ accounts: [], journals: [], parties: [], taxCodes: [], entries: [] }, 'MAD');
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const updated = new Map<string, { content: string; at: number }>();
  let orgs: { id: string; tenantId: string; name: string }[] = [{ id: randomUUID(), tenantId: randomUUID(), name: 'Westlake Canvas Co.' }];
  let extra: Record<string, unknown>[] = [];
  const access = new Map<string, string>();       // access token → auth event
  let refreshLive = new Set<string>();
  const codes = new Map<string, string>();
  const system = new Set<string>();
  const created: XeroFake['created'] = [];
  const idempotent = new Map<string, { body: string; answer: { status: number; body: unknown } }>();
  const calls: string[] = [];
  let tokenNo = 0;
  let revokeIsDown = false; let revokeEndsAll = false;

  const issue = (event: string) => {
    const a = jwt({ client_id: XERO_CLIENT.clientId, authentication_event_id: event, scope: ['offline_access'], exp: Math.floor(clock / 1000) + 1800, n: ++tokenNo });
    const r = `refresh-${tokenNo}-${randomUUID()}`;
    access.set(a, event); refreshLive.add(r);
    return { access_token: a, expires_in: 1800, token_type: 'Bearer', refresh_token: r, scope: 'offline_access accounting.settings.read accounting.contacts.read accounting.manualjournals' };
  };
  const eventOfRefresh = new Map<string, string>();

  const fetch: OAuthFetch = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.host}${u.pathname}`);
    const h = init.headers;
    if (u.host === 'identity.xero.com') {
      if (h['Authorization'] !== `Basic ${Buffer.from(`${XERO_CLIENT.clientId}:${XERO_CLIENT.clientSecret}`).toString('base64')}`) return answer(400, { error: 'invalid_client' });
      const form = new URLSearchParams(init.body ?? '');
      if (u.pathname === '/connect/revocation') {
        if (revokeIsDown) return answer(503, 'Service Unavailable');
        const t = form.get('token') ?? '';
        if (revokeEndsAll && refreshLive.has(t)) { refreshLive = new Set(); access.clear(); return answer(200, ''); }
        // the connections made with this grant end: its tokens, from the same consent, stop working
        const event = eventOfRefresh.get(t);
        if (refreshLive.has(t) && event) {
          refreshLive = new Set([...refreshLive].filter((r) => eventOfRefresh.get(r) !== event));
          for (const [a, e] of [...access]) if (e === event) access.delete(a);
        }
        return answer(200, '');
      }
      if (form.get('grant_type') === 'authorization_code') {
        const event = codes.get(form.get('code') ?? '');
        if (!event) return answer(400, { error: 'invalid_grant' });
        codes.delete(form.get('code') ?? '');   // a code is used once
        const t = issue(event); eventOfRefresh.set(t.refresh_token, event);
        return answer(200, t);
      }
      if (form.get('grant_type') === 'refresh_token') {
        const r = form.get('refresh_token') ?? '';
        if (!refreshLive.has(r)) return answer(400, { error: 'invalid_grant' });
        refreshLive.delete(r);   // rotated: the old one is invalid from now
        const t = issue(eventOfRefresh.get(r)!); eventOfRefresh.set(t.refresh_token, eventOfRefresh.get(r)!);
        return answer(200, t);
      }
      return answer(400, { error: 'unsupported_grant_type' });
    }
    const token = (h['Authorization'] ?? '').replace(/^Bearer /, '');
    if (!access.has(token)) return answer(401, { Type: null, Title: 'Unauthorized', Status: 401, Detail: 'TokenExpired: token expired', Instance: randomUUID() });
    if (u.pathname === '/connections') {
      return answer(200, orgs.map((o) => ({ id: o.id, authEventId: access.get(token), tenantId: o.tenantId, tenantType: 'ORGANISATION', tenantName: o.name,
        createdDateUtc: '2026-10-22T08:00:00.0000000', updatedDateUtc: '2026-10-22T08:00:00.0000000' })));
    }
    if (orgs.length === 0 || h['xero-tenant-id'] !== orgs[0]!.tenantId) return answer(403, FORBIDDEN);
    const path = u.pathname.replace('/api.xro/2.0/', '');
    const page = Number(u.searchParams.get('page') ?? '1'); const size = Number(u.searchParams.get('pageSize') ?? '100');
    const paged = (rows: Record<string, unknown>[]) => rows.slice((page - 1) * size, page * size);
    const since = h['If-Modified-Since'] ? Date.parse(`${h['If-Modified-Since']}Z`) : null;
    const journals = () => [...raw.journals.map((j) => ({ ...j, Date: dateOf(String(j['Date'])), UpdatedDateUTC: `/Date(${updated.get(String(j['ManualJournalID']))?.at ?? clock}+0000)/` })), ...extra];
    if (init.method === 'GET') {
      if (path === 'Organisation') return answer(200, { Organisations: [{ Name: orgs[0]!.name, BaseCurrency: raw.baseCurrency, OrganisationType: 'COMPANY', Class: 'STANDARD' }] });
      if (path === 'Accounts') return answer(200, { Accounts: raw.accounts.map((a) => ({ ...a, SystemAccount: system.has(String(a['Code'])) ? 'DEBTORS' : a['SystemAccount'] })) });
      if (path === 'TaxRates') return answer(200, { TaxRates: raw.taxRates });
      if (path === 'Contacts') return answer(200, { Contacts: paged([...raw.contacts]), pagination: { page, pageSize: size, pageCount: Math.ceil(raw.contacts.length / size), itemCount: raw.contacts.length } });
      if (path === 'ManualJournals') {
        const rows = journals().filter((j) => since === null || Number(/\d+/.exec(String(j['UpdatedDateUTC']))![0]) > since);
        return answer(200, { ManualJournals: paged(rows), pagination: { page, pageSize: size, pageCount: Math.ceil(rows.length / size), itemCount: rows.length } });
      }
      return answer(404, 'The resource you\'re looking for cannot be found');
    }
    if (path === 'ManualJournals') {
      const key = h['Idempotency-Key'] ?? null;
      if (key && idempotent.has(key)) {
        const was = idempotent.get(key)!;
        return was.body === init.body ? answer(was.answer.status, was.answer.body) : answer(400, { ErrorNumber: 10, Type: 'ValidationException', Message: `Idempotency Key: ${key} is used with a different request.` });
      }
      const body = JSON.parse(init.body ?? '{}') as { ManualJournals?: Record<string, unknown>[] };
      const mj = body.ManualJournals?.[0] ?? {};
      const lines = (mj['JournalLines'] as { AccountCode: string; LineAmount: number }[] | undefined) ?? [];
      const codesThere = new Set(raw.accounts.map((a) => String(a['Code'])));
      const why = lines.length < 2 ? 'Journal must have at least 2 lines'
        : Math.round(lines.reduce((s, l) => s + Math.round(l.LineAmount * 100), 0)) !== 0 ? 'The total debits must equal the total credits'
        : lines.find((l) => !codesThere.has(l.AccountCode)) ? `Account code '${lines.find((l) => !codesThere.has(l.AccountCode))!.AccountCode}' is not a valid code for this document.`
        : lines.find((l) => system.has(l.AccountCode)) ? `Account code '${lines.find((l) => system.has(l.AccountCode))!.AccountCode}' is a system account and cannot be used on a manual journal.` : null;
      const out = why ? { status: 400, body: { ErrorNumber: 10, Type: 'ValidationException', Message: 'A validation exception occurred', Elements: [{ ValidationErrors: [{ Message: why }] }] } } : (() => {
        const id = randomUUID(); clock += 60_000;
        const made = { ManualJournalID: id, Date: dateOf(String(mj['Date'])), Status: mj['Status'] ?? 'DRAFT', LineAmountTypes: mj['LineAmountTypes'] ?? 'NoTax',
          Narration: mj['Narration'], UpdatedDateUTC: `/Date(${clock}+0000)/`,
          JournalLines: (init.body ? (JSON.parse(init.body, (_k, v: unknown, ctx?: { source?: string }) => (typeof v === 'number' ? { number: ctx!.source! } : v)) as { ManualJournals: Record<string, unknown>[] }).ManualJournals[0]!['JournalLines'] : []) };
        extra.push(made); created.push({ body: mj, idempotencyKey: key });
        return { status: 200, body: { Id: randomUUID(), Status: 'OK', ProviderName: 'Nomi', ManualJournals: [made] } };
      })();
      if (key) idempotent.set(key, { body: init.body ?? '', answer: out });
      return answer(out.status, out.body);
    }
    return answer(404, 'The resource you\'re looking for cannot be found');
  };

  return {
    fetch, created, calls,
    publish(data, baseCurrency = 'MAD') {
      raw = booksToXero(data, baseCurrency);
      for (const j of raw.journals) {
        const id = String(j['ManualJournalID']); const content = JSON.stringify(j);
        if (updated.get(id)?.content !== content) { clock += 60_000; updated.set(id, { content, at: clock }); }
      }
      extra = [];
    },
    organisations(names) { orgs = names.map((name) => ({ id: randomUUID(), tenantId: randomUUID(), name })); },
    code() { const c = `code-${randomUUID()}`; codes.set(c, randomUUID()); return c; },
    disconnect() { orgs = []; },
    systemAccount(code) { system.add(code); },
    liveRefresh: () => [...refreshLive],
    revokeDown(down = true) { revokeIsDown = down; },
    revokeEndsEverything() { revokeEndsAll = true; },
  };
}
