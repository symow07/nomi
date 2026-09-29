import { META_LOGIN_SCOPES, type MetaLogin } from './connect.js';
import type { MetaFetch } from './messaging.js';

/**
 * CH1 (the one-month build order, 2026-09-30) — "YOUR ACCOUNTS", READ LIVE.
 *
 * Connecting wrote down what was asked for and never read back what was
 * granted: `scopes` held the requested list, the Page's subscription to Nomi
 * was written and never checked, and a token Meta stopped accepting was found
 * only when a send failed. So the Channels page asks Meta, when it is drawn:
 *
 *   · the token — is it still good (`debug_token`, with the app's own token);
 *   · the permissions — which of the ones the login asks for Meta did NOT grant
 *     (the same answer's `scopes`);
 *   · the subscription — is the Page subscribed to this app for `messages`
 *     (`/{page}/subscribed_apps`, with the Page's own token).
 *
 * Each answer is its own: Meta slow or down makes that line "could not check
 * now", never a failure the owner must fix. Nothing here is stored except by
 * the caller, and only the one thing a send would have found anyway: a token
 * Meta says is no longer good.
 */

/** A page is drawn while this waits, so it waits briefly. */
export const LIVE_CHECK_TIMEOUT_MS = 5_000;

export type MetaLiveCheck = {
  /** Meta says the token is good, says it is not, or did not answer. */
  readonly token: 'valid' | 'invalid' | 'unknown';
  /** The login's permissions Meta did not grant; null when it could not be read. */
  readonly missing: readonly string[] | null;
  /** The Page subscribed to this app for messages; null when it could not be read. */
  readonly subscribed: boolean | null;
};

type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});

const read = async (fetchImpl: MetaFetch, url: string): Promise<{ status: number; body: J } | null> => {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: {}, signal: AbortSignal.timeout(LIVE_CHECK_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    let body: J = {};
    try { body = obj(JSON.parse(text)); } catch { /* not JSON: nothing to read */ }
    return { status: res.status, body };
  } catch {
    return null;
  }
};

export async function checkMetaAccount(input: {
  readonly pageId: string; readonly token: string; readonly login: MetaLogin;
  readonly graphVersion: string; readonly fetchImpl: MetaFetch;
}): Promise<MetaLiveCheck> {
  const base = `https://graph.facebook.com/${input.graphVersion}`;
  const [dbg, sub] = await Promise.all([
    read(input.fetchImpl, `${base}/debug_token?${new URLSearchParams({
      input_token: input.token, access_token: `${input.login.appId}|${input.login.appSecret}`,
    }).toString()}`),
    read(input.fetchImpl, `${base}/${encodeURIComponent(input.pageId)}/subscribed_apps?${new URLSearchParams({
      access_token: input.token,
    }).toString()}`),
  ]);

  const data = dbg && dbg.status >= 200 && dbg.status < 300 ? obj(dbg.body['data']) : null;
  const token: MetaLiveCheck['token'] = data === null || typeof data['is_valid'] !== 'boolean' ? 'unknown'
    : data['is_valid'] ? 'valid' : 'invalid';
  const scopes = data && Array.isArray(data['scopes']) ? (data['scopes'] as unknown[]).filter((s): s is string => typeof s === 'string') : null;
  const missing = token === 'valid' && scopes !== null ? META_LOGIN_SCOPES.filter((s) => !scopes.includes(s)) : null;

  let subscribed: boolean | null = null;
  if (sub && sub.status >= 200 && sub.status < 300 && Array.isArray(sub.body['data'])) {
    subscribed = (sub.body['data'] as unknown[]).map(obj).some((app) =>
      String(app['id'] ?? '') === input.login.appId
      && Array.isArray(app['subscribed_fields']) && (app['subscribed_fields'] as unknown[]).includes('messages'));
  }
  return { token, missing, subscribed };
}
