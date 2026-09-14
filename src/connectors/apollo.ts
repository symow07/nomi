import type {
  EnrichOutcome, Organization, Prospect, ProspectSource, RevealOutcome, SearchFilter, SearchOutcome,
  SourceFailure,
} from './contract.js';

/**
 * C5 · M41 — Apollo, as one `ProspectSource`.
 *
 * ── WHAT THIS HAS AND HAS NOT BEEN CHECKED AGAINST ────────────────────────
 *
 * The endpoints, headers and response shapes below are Apollo's public REST API
 * as documented: `X-Api-Key` authentication, `GET organizations/enrich`,
 * `POST mixed_people/search`, `POST people/match`. They have NOT been exercised
 * against the live service from this repository — there is no key here, and
 * none belongs in a test. What IS tested is everything on this side of the
 * wire: the requests it builds, how every status maps to a reason, and that a
 * shape it does not recognise is `unreadable` rather than a guess. The first
 * real call is M52's, with her key, and a surprise there fails closed.
 *
 * ── HER KEY GOES ONE PLACE ────────────────────────────────────────────────
 *
 * In the `X-Api-Key` header of a request to Apollo, and nowhere else: never a
 * query string (servers log URLs), never an error, never a log line. A failure
 * leaves this module as a reason code; the vendor's body, which can echo the
 * request, is read only to find the words "credit" and is then dropped.
 */

export type ApolloFetch = (url: string, init: {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export const APOLLO_BASE_URL = 'https://api.apollo.io';
export const APOLLO_TIMEOUT_MS = 15_000;
/** A page of a search. Enough to judge; small enough to read. */
export const APOLLO_PAGE_SIZE = 25;

const failed = (reason: SourceFailure['reason'], retryable: boolean): SourceFailure =>
  ({ kind: 'failed', reason, retryable });

/** A status and, for the credit case only, a glance at the words. */
async function failureFor(res: { status: number; text(): Promise<string> }): Promise<SourceFailure> {
  if (res.status === 401 || res.status === 403) return failed('unauthorized', false);
  if (res.status === 429) return failed('rate_limited', true);
  if (res.status >= 500) return failed('unavailable', true);
  if (res.status === 402 || res.status === 422) {
    const body = await res.text().catch(() => '');
    if (/credit/i.test(body)) return failed('no_credits', false);
  }
  return failed('unreadable', false);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** A domain from whatever Apollo put in `primary_domain` or `website_url`. */
function domainOf(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]!.replace(/^www\./i, '').toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

export function readOrganization(raw: unknown): Organization | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = str(o['name']);
  if (!name) return null;
  return {
    name,
    domain: domainOf(o['primary_domain']) ?? domainOf(o['website_url']),
    industry: str(o['industry']),
    employees: int(o['estimated_num_employees']),
    country: str(o['country']),
    city: str(o['city']),
    website: str(o['website_url']),
    linkedinUrl: str(o['linkedin_url']),
    foundedYear: int(o['founded_year']),
  };
}

export function readProspect(raw: unknown): Prospect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const sourceId = str(p['id']);
  const name = str(p['name']) ?? ([str(p['first_name']), str(p['last_name'])].filter(Boolean).join(' ') || null);
  if (!sourceId || !name) return null;
  const org = typeof p['organization'] === 'object' && p['organization'] !== null
    ? p['organization'] as Record<string, unknown> : {};
  return {
    sourceId, name,
    title: str(p['title']),
    organization: str(org['name']),
    organizationDomain: domainOf(org['primary_domain']) ?? domainOf(org['website_url']),
    country: str(p['country']),
    city: str(p['city']),
  };
}

/**
 * An address Apollo is willing to stand behind. It answers a person it will not
 * reveal with a placeholder such as `email_not_unlocked@domain.com`, and with a
 * status for the ones it has not verified — neither is an address anyone should
 * be written to at.
 */
export function readRevealedEmail(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const person = (raw as Record<string, unknown>)['person'];
  if (typeof person !== 'object' || person === null) return null;
  const p = person as Record<string, unknown>;
  const email = str(p['email']);
  if (!email || /not_unlocked|^email_/i.test(email)) return null;
  const status = str(p['email_status']);
  if (status !== null && status !== 'verified') return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}

export function apolloSource(cfg: {
  readonly apiKey: string;
  readonly fetchImpl?: ApolloFetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}): ProspectSource {
  const doFetch: ApolloFetch = cfg.fetchImpl ?? (fetch as unknown as ApolloFetch);
  const base = (cfg.baseUrl ?? APOLLO_BASE_URL).replace(/\/$/, '');
  const headers = {
    'X-Api-Key': cfg.apiKey,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    Accept: 'application/json',
  };

  /** One request, read as JSON; every way it can fail is a reason. */
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<
    { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly failure: SourceFailure }
  > {
    try {
      const res = await doFetch(`${base}${path}`, {
        method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? APOLLO_TIMEOUT_MS),
      });
      if (res.status < 200 || res.status >= 300) return { ok: false, failure: await failureFor(res) };
      try {
        return { ok: true, json: JSON.parse(await res.text()) as unknown };
      } catch {
        return { ok: false, failure: failed('unreadable', false) };
      }
    } catch {
      // A timeout, a DNS failure, a reset connection: nothing it said is kept.
      return { ok: false, failure: failed('unavailable', true) };
    }
  }

  return {
    name: 'apollo',

    async enrichDomain(domain: string): Promise<EnrichOutcome> {
      const r = await call('GET', `/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`);
      if (!r.ok) return r.failure;
      const org = readOrganization((r.json as { organization?: unknown } | null)?.organization);
      return org ? { kind: 'found', organization: org } : { kind: 'not_found' };
    },

    async searchPeople(filter: SearchFilter): Promise<SearchOutcome> {
      const range = filter.employeesMin !== null || filter.employeesMax !== null
        ? [`${filter.employeesMin ?? 1},${filter.employeesMax ?? 1_000_000}`] : undefined;
      const r = await call('POST', '/api/v1/mixed_people/search', {
        page: Math.max(1, filter.page), per_page: APOLLO_PAGE_SIZE,
        ...(filter.titles.length ? { person_titles: filter.titles } : {}),
        ...(filter.countries.length ? { person_locations: filter.countries } : {}),
        ...(filter.keywords ? { q_keywords: filter.keywords } : {}),
        ...(range ? { organization_num_employees_ranges: range } : {}),
      });
      if (!r.ok) return r.failure;
      const j = r.json as { people?: unknown; pagination?: { page?: unknown; total_pages?: unknown } } | null;
      if (!j || !Array.isArray(j.people)) return failed('unreadable', false);
      return {
        kind: 'results',
        prospects: j.people.map(readProspect).filter((p): p is Prospect => p !== null),
        page: int(j.pagination?.page) ?? filter.page,
        totalPages: int(j.pagination?.total_pages) ?? 0,
      };
    },

    async revealEmail(sourceId: string): Promise<RevealOutcome> {
      const r = await call('POST', '/api/v1/people/match', { id: sourceId, reveal_personal_emails: false });
      if (!r.ok) return r.failure;
      const email = readRevealedEmail(r.json);
      return email ? { kind: 'found', email } : { kind: 'not_found' };
    },
  };
}
