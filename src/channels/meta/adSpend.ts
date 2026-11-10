import { createHmac } from 'node:crypto';
import { exchangeMetaCode, type ConnectFailure } from './connect.js';
import { isMetaAmount, readUsage, type Usage } from '../../core/ads/spend.js';

/**
 * 0238 — AD SPEND, read from Meta's Marketing API. Nothing here is the Page connect.
 *
 * The owner turns ad spend on with a SECOND Facebook Login for Business configuration
 * (`META_ADS_LOGIN_CONFIG_ID`) that holds `ads_read` and nothing else. The base login (`META_LOGIN_SCOPES`,
 * `metaDialogUrl`, `connect.ts`) never asks for it, so a permission still waiting for App Review cannot break
 * anyone's Page connect. Unset, ad spend is not offered, no route proceeds and no read is made.
 *
 * Meta's pages this relies on (saved 2026-11-08, read 2026-11-10):
 *   - Marketing API versions: v27.0, released 2026-11-04 — its OWN constant, never the social `v23.0` default.
 *   - Ad Account Insights reference: the fields, `level`, `time_increment`, `breakdowns`, `time_range`,
 *     `spend` a numeric string and estimated, the error codes.
 *   - Insights best practices and Graph rate limiting: the three usage headers and the throttle codes.
 * Not in those pages, assumed and left open: how an incremental login is asked under a configuration;
 * `/me/adaccounts` and `timezone_name`; the values `publisher_platform` takes; 190's subcodes; `paging.next`;
 * throttle codes beyond 4 and 613.
 */

export const MARKETING_API_VERSION = 'v27.0';
/** Exactly these, always named: Meta's default fields are not ours to rely on. */
export const INSIGHTS_FIELDS = 'account_id,account_currency,date_start,date_stop,spend' as const;
/** A read stops after this many pages, recorded as incomplete: never a loop. */
export const INSIGHTS_PAGE_CAP = 20;
export const INSIGHTS_PAGE_SIZE = 100;
export const ADS_TIMEOUT_MS = 15_000;
/** Any usage figure at or above this stops the read and waits. */
export const USAGE_STOP_PCT = 75;

/** The fetch this module needs: Meta's usage arrives in headers, so they must be readable. */
export type AdsFetch = (url: string, init: {
  method: string; headers: Record<string, string>; signal?: AbortSignal;
}) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export type AdsLogin = { readonly appId: string; readonly appSecret: string; readonly configId: string };

/** All three or nothing, like the Page login: half a configuration is a dialog that opens and then refuses. */
export function adsLoginFrom(env: Record<string, string | undefined>, appSecret: string | undefined): AdsLogin | null {
  const appId = env['META_SOCIAL_APP_ID']?.trim();
  const configId = env['META_ADS_LOGIN_CONFIG_ID']?.trim();
  if (!appId || !configId || !appSecret) return null;
  if (!/^[0-9]{5,}$/.test(appId) || !/^[0-9]{5,}$/.test(configId)) return null;
  return { appId, appSecret, configId };
}

/** Where the owner is sent: the ads configuration, nothing else. The base dialog is `metaDialogUrl`, untouched. */
export function adsDialogUrl(login: AdsLogin, o: { readonly redirectUri: string; readonly state: string }): string {
  const q = new URLSearchParams({
    client_id: login.appId, redirect_uri: o.redirectUri, state: o.state, config_id: login.configId,
    response_type: 'code', override_default_response_type: 'true',
  });
  return `https://www.facebook.com/${MARKETING_API_VERSION}/dialog/oauth?${q.toString()}`;
}

/**
 * The ads flow's state is signed with a key of its own, so a Page connect's state can never finish an ads
 * connection, nor the reverse. Same shape (`mintMetaState`), different key.
 */
export const adsStateSecret = (sessionSecret: string): string =>
  createHmac('sha256', sessionSecret).update('yf-meta-ads-state-v1').digest('hex');

export async function exchangeAdsCode(
  login: AdsLogin, input: { readonly code: string; readonly redirectUri: string }, fetchImpl: AdsFetch,
): Promise<{ readonly ok: true; readonly userToken: string } | { readonly ok: false; readonly reason: ConnectFailure }> {
  return exchangeMetaCode(login, { ...input, graphVersion: MARKETING_API_VERSION }, fetchImpl);
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

type Got = { readonly status: number; readonly body: J; readonly usage: Usage };
const getJson = async (fetchImpl: AdsFetch, url: string): Promise<Got | null> => {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: {}, signal: AbortSignal.timeout(ADS_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    let body: J = {};
    try { body = obj(JSON.parse(text)); } catch { /* not JSON: an empty body */ }
    return { status: res.status, body, usage: readUsage((n) => res.headers.get(n)) };
  } catch {
    return null;
  }
};

/** A zone the runtime knows, or nothing: a month cannot be drawn in a zone nobody can read. */
export const knownZone = (z: string): boolean => {
  if (!z || z.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; }
};

export type AdAccount = { readonly accountId: string; readonly name: string; readonly currency: string; readonly timezone: string };

/**
 * The ad accounts the token sees (O2: not in the saved pages — `/me/adaccounts` with `account_id`, `name`,
 * `currency`, `timezone_name`). An account without a currency code or a readable zone is left out, not guessed.
 */
export async function listAdAccounts(
  userToken: string, fetchImpl: AdsFetch,
): Promise<{ readonly ok: true; readonly accounts: readonly AdAccount[] } | { readonly ok: false; readonly reason: ConnectFailure }> {
  let url: string | null = `https://graph.facebook.com/${MARKETING_API_VERSION}/me/adaccounts?${new URLSearchParams({
    fields: 'account_id,name,currency,timezone_name', limit: '50', access_token: userToken,
  }).toString()}`;
  const accounts: AdAccount[] = [];
  for (let page = 0; url && page < 5; page++) {
    const r = await getJson(fetchImpl, url);
    if (!r) return { ok: false, reason: 'unavailable' };
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: r.status >= 500 ? 'unavailable' : 'rejected' };
    for (const raw of Array.isArray(r.body['data']) ? r.body['data'] as unknown[] : []) {
      const a = obj(raw);
      const accountId = str(a['account_id']) ?? str(a['id'])?.replace(/^act_/, '') ?? null;
      const currency = str(a['currency']);
      const timezone = str(a['timezone_name']);
      if (!accountId || !/^[0-9]{1,30}$/.test(accountId) || !currency || !/^[A-Z]{3}$/.test(currency) || !timezone || !knownZone(timezone)) continue;
      if (accounts.some((x) => x.accountId === accountId)) continue;
      accounts.push({ accountId, currency, timezone, name: (str(a['name']) ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) });
    }
    url = nextPage(r.body, '/me/adaccounts');
  }
  return { ok: true, accounts };
}

/**
 * O5 (not in the saved pages): `paging.next` is followed only when it is https on Meta's Graph host with the
 * path we asked for. Anything else is not followed.
 */
export function nextPage(body: J, path: string): string | null {
  const next = str(obj(body['paging'])['next']);
  if (!next) return null;
  try {
    const u = new URL(next);
    return u.protocol === 'https:' && u.hostname === 'graph.facebook.com' && u.pathname === `/${MARKETING_API_VERSION}${path}` ? u.toString() : 'refused';
  } catch {
    return 'refused';
  }
}

export type SpendRow = { readonly day: string; readonly platform: string; readonly amount: string; readonly currency: string };

export type InsightsRead =
  | { readonly kind: 'ok'; readonly rows: readonly SpendRow[]; readonly pages: number; readonly usage: readonly Usage[]; readonly waitSec: number | null }
  | {
    readonly kind: 'incomplete' | 'refused' | 'permission' | 'throttled' | 'failed';
    readonly pages: number; readonly usage: readonly Usage[]; readonly waitSec: number | null;
    readonly code: number | null; readonly subcode: number | null; readonly message: string;
  };

/** The request, exactly: v27.0, the five fields, account level, one row a day, broken down by placement only. */
export function insightsUrl(accountId: string, span: { readonly since: string; readonly until: string }, token: string): string {
  return `https://graph.facebook.com/${MARKETING_API_VERSION}/act_${accountId}/insights?${new URLSearchParams({
    fields: INSIGHTS_FIELDS, level: 'account', time_increment: '1', breakdowns: 'publisher_platform',
    time_range: JSON.stringify({ since: span.since, until: span.until }), limit: String(INSIGHTS_PAGE_SIZE), access_token: token,
  }).toString()}`;
}

/** Meta's error, as a verdict. 190 is refused whatever its subcode; an unrecognised code is a failure, never a retry. */
export function verdictOf(code: number | null): 'refused' | 'permission' | 'throttled' | 'failed' {
  if (code === 190) return 'refused';
  if (code === 200) return 'permission';
  if (code === 4 || code === 613) return 'throttled';
  return 'failed';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One account's spend by day and placement, between two of the account's days. All or nothing: a row that is
 * not what was asked for (another account, another currency, a span longer than a day, a placement missing, an
 * amount that is not Meta's decimal string, the same day and placement twice) fails the read whole, so nothing
 * half-read is ever stored or summed.
 */
export async function readInsights(
  input: { readonly token: string; readonly accountId: string; readonly currency: string; readonly since: string; readonly until: string },
  fetchImpl: AdsFetch,
  o: { readonly pageCap?: number } = {},
): Promise<InsightsRead> {
  const cap = o.pageCap ?? INSIGHTS_PAGE_CAP;
  const path = `/act_${input.accountId}/insights`;
  const usage: Usage[] = [];
  const rows: SpendRow[] = [];
  const seen = new Set<string>();
  let url: string | null = insightsUrl(input.accountId, input, input.token);
  let pages = 0;
  const wait = () => usage.reduce<number | null>((m, u) => (u.waitSec !== null && (m === null || u.waitSec > m) ? u.waitSec : m), null);
  const stop = (kind: Exclude<InsightsRead['kind'], 'ok'>, message: string, code: number | null = null, subcode: number | null = null): InsightsRead =>
    ({ kind, pages, usage, waitSec: wait(), code, subcode, message: message.slice(0, 500) });

  while (url) {
    if (pages >= cap) return stop('incomplete', `page cap ${cap} reached`);
    const r = await getJson(fetchImpl, url);
    if (!r) return stop('failed', 'Meta did not answer');
    pages++;
    usage.push(r.usage);
    if (r.status < 200 || r.status >= 300) {
      const e = obj(r.body['error']);
      const code = typeof e['code'] === 'number' ? e['code'] : null;
      const subcode = typeof e['error_subcode'] === 'number' ? e['error_subcode'] : null;
      return stop(verdictOf(code), str(e['message']) ?? `HTTP ${r.status}`, code, subcode);
    }
    if (!Array.isArray(r.body['data'])) return stop('failed', 'no data in the answer');
    for (const raw of r.body['data'] as unknown[]) {
      const a = obj(raw);
      const accountId = str(a['account_id']); const currency = str(a['account_currency']);
      const start = str(a['date_start']); const end = str(a['date_stop']);
      const platform = str(a['publisher_platform']); const amount = str(a['spend']);
      if (accountId !== input.accountId) return stop('failed', 'a row of another account');
      if (currency !== input.currency) return stop('failed', `a row in ${currency ?? 'no currency'}, not ${input.currency}`);
      if (!start || !DAY.test(start) || start !== end) return stop('failed', 'a row that is not one day');
      if (start < input.since || start > input.until) return stop('failed', 'a row outside the span asked for');
      if (!platform || platform.length > 80 || /[\u0000-\u001f\u007f]/.test(platform)) return stop('failed', 'a row with no placement');
      if (!amount || !isMetaAmount(amount)) return stop('failed', 'an amount that is not a decimal string');
      const key = `${start}\u0000${platform}`;
      if (seen.has(key)) return stop('failed', 'the same day and placement twice');
      seen.add(key);
      rows.push({ day: start, platform, amount, currency });
    }
    const next = nextPage(r.body, path);
    if (next === 'refused') return stop('failed', 'a next page outside Meta\'s Graph address');
    // Paced on Meta's own figures: near the limit, the rest waits for another day.
    if (next && r.usage.peak !== null && r.usage.peak >= USAGE_STOP_PCT) return stop('throttled', `usage at ${r.usage.peak}%`);
    url = next;
  }
  return { kind: 'ok', rows, pages, usage, waitSec: wait() };
}
