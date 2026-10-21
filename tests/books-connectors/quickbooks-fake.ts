import { randomUUID } from 'node:crypto';
import type { OAuthFetch } from '../../src/connectors/oauth.js';
import { booksToQbo, type QboRaw } from '../../src/books/connectors/quickbooks.js';
import type { BooksData } from '../../src/core/books/interchange.js';

/**
 * D9 — a recorded fake of Intuit's QuickBooks Online, from its developer documentation (2026-10-22): the token
 * endpoint (Basic auth; the code comes back with the company's realmId; the refresh token stays the same within a day
 * and CHANGES after, the old one then refused), the revoke endpoint (JSON `{ token }`), and the Accounting API calls
 * the connector makes at `/v3/company/{realmId}`: preferences, companyinfo, `query` (SELECT … WHERE
 * Metadata.LastUpdatedTime > … STARTPOSITION … MAXRESULTS, 1,000 at most), and creating a journal entry (a `requestid`
 * answered the same again; a DocNumber already used refused as 6140 "Duplicate Doc Num", the company warning of
 * duplicates; debits not equal to credits 6000; an account that is not there 2500). Faults are
 * `{ Fault: { Error: [{ Message, Detail, code }], type }, time }`: 401 AuthenticationFault 3200 for a token it does not
 * know; 400 6190 "Invalid Company Status" when the subscription ended. Amounts are JSON numbers. Checked live on deploy
 * day.
 */
export type QboFake = {
  readonly fetch: OAuthFetch;
  /** The company's books, as QuickBooks would hold them; each entry changed since the last publish gets a later LastUpdatedTime. */
  publish(data: BooksData, homeCurrency?: string): void;
  /** A fresh authorisation code, and the realmId Intuit sends back with it. */
  code(): { readonly code: string; readonly realmId: string };
  /** A day passes: the next refresh returns a NEW refresh token, and the one before it is refused. */
  nextDay(): void;
  /** The company's subscription ended (6190 on every call). */
  lapse(): void;
  /** A company in the United States (no GlobalTaxCalculation). */
  inUnitedStates(): void;
  readonly created: { readonly body: Record<string, unknown>; readonly requestId: string | null }[];
  readonly liveRefresh: () => readonly string[];
  readonly calls: string[];
  readonly realmId: string;
};

export const QBO_CLIENT = { clientId: 'nomi-qbo-test-client', clientSecret: 'qbo-test-secret' };
const N = '~#n#~';
const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) =>
  (x && typeof x === 'object' && 'number' in x && Object.keys(x).length === 1 ? `${N}${(x as { number: string }).number}` : x))
  .replace(new RegExp(`"${N}(-?[0-9.]+)"`, 'g'), '$1');
const answer = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : json(body)) });
const fault = (status: number, code: string, message: string, type = 'ValidationFault') =>
  answer(status, { Fault: { Error: [{ Message: message, Detail: message, code, element: '' }], type }, time: '2026-10-22T09:00:00.000-07:00' });

export function qboFake(): QboFake {
  const realmId = '9341453050298431';
  let raw: QboRaw = booksToQbo({ accounts: [], journals: [], parties: [], taxCodes: [], entries: [] }, 'MAD');
  let country = 'MA';
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const updated = new Map<string, { content: string; at: number }>();
  let extra: Record<string, unknown>[] = [];
  const access = new Set<string>();
  const refreshLive = new Map<string, string>();   // refresh token → its family (one consent)
  const codes = new Map<string, string>();
  let day = 0; const issuedOn = new Map<string, number>();
  let lapsed = false;
  const created: QboFake['created'] = [];
  const requests = new Map<string, { status: number; body: unknown }>();
  const calls: string[] = [];
  const stamp = (at: number) => new Date(at).toISOString().replace('Z', '-00:00').replace('.000', '');

  const issue = (family: string, refresh?: string) => {
    const a = `qbo-access-${randomUUID()}`; access.add(a);
    const r = refresh ?? `AB11${randomUUID().replace(/-/g, '')}`;
    refreshLive.set(r, family); issuedOn.set(r, day);
    return { token_type: 'bearer', expires_in: 3600, refresh_token: r, x_refresh_token_expires_in: 8640000, access_token: a };
  };

  const fetch: OAuthFetch = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.host}${u.pathname}`);
    const h = init.headers;
    if (u.host === 'oauth.platform.intuit.com' || u.host === 'developer.api.intuit.com') {
      if (h['Authorization'] !== `Basic ${Buffer.from(`${QBO_CLIENT.clientId}:${QBO_CLIENT.clientSecret}`).toString('base64')}`) return answer(401, { error: 'invalid_client' });
      if (u.pathname === '/v2/oauth2/tokens/revoke') {
        const t = (JSON.parse(init.body ?? '{}') as { token?: string }).token ?? '';
        const family = refreshLive.get(t);
        if (!family) return answer(400, { error: 'invalid_token' });
        for (const [r, f] of [...refreshLive]) if (f === family) refreshLive.delete(r);
        access.clear();
        return answer(200, '');
      }
      const form = new URLSearchParams(init.body ?? '');
      if (form.get('grant_type') === 'authorization_code') {
        const family = codes.get(form.get('code') ?? '');
        if (!family) return answer(400, { error: 'invalid_grant' });
        codes.delete(form.get('code') ?? '');
        return answer(200, issue(family));
      }
      if (form.get('grant_type') === 'refresh_token') {
        const r = form.get('refresh_token') ?? '';
        const family = refreshLive.get(r);
        if (!family) return answer(400, { error: 'invalid_grant' });
        // the same value within a day; after it, a new one — and the old one expires
        if (issuedOn.get(r) === day) return answer(200, issue(family, r));
        refreshLive.delete(r);
        return answer(200, issue(family));
      }
      return answer(400, { error: 'unsupported_grant_type' });
    }
    const token = (h['Authorization'] ?? '').replace(/^Bearer /, '');
    if (!access.has(token)) return fault(401, '3200', 'message=AuthenticationFailed; errorCode=003200; statusCode=401', 'AuthenticationFault');
    const m = /^\/v3\/company\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (!m) return answer(404, 'Not Found');
    if (m[1] !== realmId) return fault(403, '120', 'Authorization Failure', 'AuthorizationFault');
    if (lapsed) return fault(400, '6190', 'Invalid Company Status');
    const path = m[2]!;
    const journals = (): Record<string, unknown>[] => [...raw.journals.map((j) => ({ ...j, MetaData: { CreateTime: stamp(clock), LastUpdatedTime: stamp(updated.get(String(j['Id']))?.at ?? clock) } })), ...extra];
    if (init.method === 'GET') {
      if (path === 'preferences') return answer(200, { Preferences: { CurrencyPrefs: { HomeCurrency: { value: raw.homeCurrency }, MultiCurrencyEnabled: true } }, time: stamp(clock) });
      if (path === `companyinfo/${realmId}`) return answer(200, { CompanyInfo: { CompanyName: 'Westlake Canvas Co.', Country: country, Id: '1' }, time: stamp(clock) });
      if (path === 'query') {
        const q = /^SELECT \* FROM (\w+)(?: WHERE Metadata\.LastUpdatedTime > '([^']+)')? STARTPOSITION (\d+) MAXRESULTS (\d+)$/.exec(u.searchParams.get('query') ?? '');
        if (!q) return fault(400, '4000', 'Error parsing query');
        const [, entity, since, start, max] = q;
        const all = entity === 'Account' ? raw.accounts : entity === 'Customer' ? raw.customers : entity === 'Vendor' ? raw.vendors : entity === 'JournalEntry' ? journals() : null;
        if (!all) return fault(400, '4000', 'Error parsing query');
        const rows = all.filter((r) => !since || Date.parse(String((r['MetaData'] as { LastUpdatedTime: string }).LastUpdatedTime)) > Date.parse(since))
          .slice(Number(start) - 1, Number(start) - 1 + Math.min(Number(max), 1000));
        return answer(200, { QueryResponse: rows.length > 0 ? { startPosition: Number(start), maxResults: rows.length, [entity!]: rows } : {}, time: stamp(clock) });
      }
      return answer(404, 'Not Found');
    }
    if (path === 'journalentry') {
      const requestId = u.searchParams.get('requestid');
      if (requestId && requests.has(requestId)) { const was = requests.get(requestId)!; return answer(was.status, was.body); }
      const body = JSON.parse(init.body ?? '{}', (_k, v: unknown, ctx?: { source?: string }) => (typeof v === 'number' ? { number: ctx!.source! } : v)) as Record<string, unknown>;
      const lines = (body['Line'] as { Amount: { number: string }; JournalEntryLineDetail: { PostingType: string; AccountRef: { value: string } } }[] | undefined) ?? [];
      const cents = (t: string) => lines.filter((l) => l.JournalEntryLineDetail.PostingType === t).reduce((s, l) => s + Math.round(Number(l.Amount.number) * 100), 0);
      const ids = new Set(raw.accounts.map((a) => String(a['Id'])));
      const out = journals().some((j) => j['DocNumber'] === body['DocNumber']) ? { status: 400, body: { Fault: { Error: [{ Message: 'Duplicate Document Number Error', Detail: 'Duplicate Document Number Error', code: '6140' }], type: 'ValidationFault' } } }
        : cents('Debit') !== cents('Credit') ? { status: 400, body: { Fault: { Error: [{ Message: 'Transaction must be balanced', code: '6000' }], type: 'ValidationFault' } } }
        : lines.some((l) => !ids.has(l.JournalEntryLineDetail.AccountRef.value)) ? { status: 400, body: { Fault: { Error: [{ Message: 'Invalid Reference Id', code: '2500' }], type: 'ValidationFault' } } }
        : country !== 'US' && !body['GlobalTaxCalculation'] ? { status: 400, body: { Fault: { Error: [{ Message: 'GlobalTaxCalculation is required', code: '2020' }], type: 'ValidationFault' } } }
        : country === 'US' && body['GlobalTaxCalculation'] ? { status: 400, body: { Fault: { Error: [{ Message: 'GlobalTaxCalculation is not supported', code: '6000' }], type: 'ValidationFault' } } }
        : (() => {
          clock += 60_000;
          const made = { ...body, Id: String(9000 + created.length), SyncToken: '0', domain: 'QBO', sparse: false,
            Line: lines.map((l, i) => ({ ...l, Id: String(i) })), MetaData: { CreateTime: stamp(clock), LastUpdatedTime: stamp(clock) } };
          extra.push(made); created.push({ body, requestId });
          return { status: 200, body: { JournalEntry: made, time: stamp(clock) } };
        })();
      if (requestId) requests.set(requestId, out);
      return answer(out.status, out.body);
    }
    return answer(404, 'Not Found');
  };

  return {
    fetch, created, calls, realmId,
    publish(data, homeCurrency = 'MAD') {
      raw = booksToQbo(data, homeCurrency, country);
      for (const j of raw.journals) {
        const id = String(j['Id']); const content = JSON.stringify(j);
        if (updated.get(id)?.content !== content) { clock += 60_000; updated.set(id, { content, at: clock }); }
      }
      extra = [];
    },
    code() { const c = `qbo-code-${randomUUID()}`; codes.set(c, randomUUID()); return { code: c, realmId }; },
    nextDay() { day++; },
    lapse() { lapsed = true; },
    inUnitedStates() { country = 'US'; },
    liveRefresh: () => [...refreshLive.keys()],
  };
}
