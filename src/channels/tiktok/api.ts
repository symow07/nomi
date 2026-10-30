import { createHmac, timingSafeEqual } from 'node:crypto';
import { acceptedWithoutId, thrownSend } from '../sendFailure.js';

/**
 * TIKTOK, OVER THE WIRE — the Business Messaging API's sign-in and the one call that sends (docs/TIKTOK-CHANNEL.md,
 * surface A). Read from TikTok API for Business's own documentation (2026-10-24); built against a recorded fake of
 * those answers (tests/channels/tiktok-fake.ts). Nothing here has met TikTok: the access steps are the owner's.
 *
 *   · SIGN-IN: the "TikTok account holder authorization URL" is copied from the developer app's page (TikTok builds
 *     it; it is not made here), with a `state` and `disable_auto_auth=1` added. Back come `code` and `state`; the code
 *     (ten minutes, once) is exchanged at /tt_user/oauth2/token/ for an access token (a day), a refresh token (a year)
 *     and the account's `open_id`. The four permissions the messaging calls need must be in the granted scope.
 *   · RENEWAL: /tt_user/oauth2/refresh_token/; REVOKE: /tt_user/oauth2/revoke/ (the access token).
 *   · SEND: /business/message/send/ with the `Access-Token` header; the account is `business_id` = its open_id, the
 *     customer is the CONVERSATION (`recipient_type: CONVERSATION`, `recipient` = conversation_id). Text up to 6,000.
 *   · ANSWERS: TikTok answers HTTP 200 with `code` 0 for success and another code for a refusal; its words are never
 *     repeated (they can echo the request). 40105 is read as a dead token (TikTok's return-code appendix, not read
 *     for this build: NOT CONFIRMED — a code it does not know is a refusal that is not retried).
 */
export type TikTokFetch = (url: string, init: { method: 'POST' | 'GET'; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ readonly status: number; text(): Promise<string> }>;

export const TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3';
export const TIKTOK_TEXT_MAX = 6000;
const TIMEOUT_MS = 15_000;
/** The access token is used again while it has more than five minutes left; refreshed otherwise. */
export const TIKTOK_ACCESS_MARGIN_MS = 5 * 60 * 1000;
/** The four permissions the messaging calls need ("Authorization", step 2), by their scope names. */
export const TIKTOK_MESSAGING_SCOPES = ['message.list.read', 'message.list.send', 'message.list.manage', 'user.account.type'] as const;

export type TikTokApp = {
  readonly appId: string;
  readonly appSecret: string;
  /** The account holder authorization URL from the developer app's page, as TikTok made it. */
  readonly authUrl: string;
};

/**
 * All three or nothing. The URL must be TikTok's own (https, www.tiktok.com) — a mistyped one must not send an owner
 * to another site with Nomi's state on it.
 */
export function tiktokAppFrom(env: Readonly<Record<string, string | undefined>>): TikTokApp | null {
  const appId = (env['TIKTOK_APP_ID'] ?? '').trim();
  const appSecret = (env['TIKTOK_APP_SECRET'] ?? '').trim();
  const authUrl = (env['TIKTOK_AUTH_URL'] ?? '').trim();
  if (!/^[0-9A-Za-z]{6,64}$/.test(appId) || appSecret.length < 16) return null;
  let u: URL;
  try { u = new URL(authUrl); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'www.tiktok.com') return null;
  return { appId, appSecret, authUrl };
}

/** Where the owner is sent: TikTok's own authorization URL, with our state, never skipping the consent screen. */
export function tiktokAuthorizeUrl(app: TikTokApp, state: string): string {
  const u = new URL(app.authUrl);
  u.searchParams.set('state', state);
  // A grant already given redirects with no code at all ("Authorization", note): ask again, so a code comes back.
  u.searchParams.set('disable_auto_auth', '1');
  return u.toString();
}

// ── The grant: sealed whole by the caller (CREDENTIAL_KEY) ─────────────────────────────────────────────────────────

/** What is kept for a connection: both tokens and when each ends (ms since the epoch). */
export type TikTokGrant = { readonly a: string; readonly ae: number; readonly r: string; readonly re: number };
export const packTikTokGrant = (g: TikTokGrant): string => JSON.stringify(g);
export function openTikTokGrant(secret: string): TikTokGrant | null {
  try {
    const g = JSON.parse(secret) as Partial<TikTokGrant>;
    return typeof g.a === 'string' && typeof g.r === 'string' && typeof g.ae === 'number' && typeof g.re === 'number' ? g as TikTokGrant : null;
  } catch { return null; }
}

type Answer = { readonly status: number; readonly body: Record<string, unknown> } | null;
/** One call; it throws when no answer came (the caller decides what that means). */
async function request(fetchImpl: TikTokFetch, path: string, body: Record<string, unknown>, accessToken?: string): Promise<NonNullable<Answer>> {
  const res = await fetchImpl(`${TIKTOK_API}${path}`, {
    method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { 'Access-Token': accessToken } : {}) },
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(await res.text()) as Record<string, unknown>; } catch { /* not JSON: an empty body */ }
  return { status: res.status, body: parsed };
}
async function post(fetchImpl: TikTokFetch, path: string, body: Record<string, unknown>, accessToken?: string): Promise<Answer> {
  try {
    return await request(fetchImpl, path, body, accessToken);
  } catch {
    return null;
  }
}
const codeOf = (a: Answer): number | null => (a && typeof a.body['code'] === 'number' ? a.body['code'] : null);
const dataOf = (a: Answer): Record<string, unknown> => (a && typeof a.body['data'] === 'object' && a.body['data'] !== null ? a.body['data'] as Record<string, unknown> : {});

/** A dead or revoked access token (40105). NOT CONFIRMED from TikTok's own appendix; see the module's note. */
export const TIKTOK_TOKEN_DEAD = 40105;
/** Answers worth trying again later: no answer, a server error, a rate limit. */
const retryable = (a: Answer): boolean => a === null || a.status >= 500 || a.status === 429 || codeOf(a) === 40100 || (codeOf(a) ?? 0) >= 50000;

export type TokenOutcome =
  | { readonly ok: true; readonly grant: TikTokGrant; readonly openId: string; readonly scopes: readonly string[] }
  | { readonly ok: false; readonly reason: 'rejected' | 'unavailable' };

function tokensOf(a: Answer, now: number): TokenOutcome {
  if (!a || retryable(a)) return { ok: false, reason: 'unavailable' };
  const d = dataOf(a);
  const [access, refresh, openId] = [d['access_token'], d['refresh_token'], d['open_id']];
  if (codeOf(a) !== 0 || typeof access !== 'string' || typeof refresh !== 'string' || typeof openId !== 'string') return { ok: false, reason: 'rejected' };
  const ae = typeof d['expires_in'] === 'number' && d['expires_in'] > 0 ? d['expires_in'] : 86_400;
  const re = typeof d['refresh_token_expires_in'] === 'number' && d['refresh_token_expires_in'] > 0 ? d['refresh_token_expires_in'] : 31_536_000;
  const scopes = typeof d['scope'] === 'string' ? d['scope'].split(',').map((x) => x.trim()).filter(Boolean) : [];
  return { ok: true, openId, scopes, grant: { a: access, ae: now + ae * 1000, r: refresh, re: now + re * 1000 } };
}

/** The code TikTok sent back → the grant and the account's open_id. */
export async function exchangeTikTokCode(app: TikTokApp, code: string, redirectUri: string, fetchImpl: TikTokFetch, now = Date.now()): Promise<TokenOutcome> {
  return tokensOf(await post(fetchImpl, '/tt_user/oauth2/token/', {
    client_id: app.appId, client_secret: app.appSecret, grant_type: 'authorization_code', auth_code: code, redirect_uri: redirectUri,
  }), now);
}

/** A renewed grant (a new access token; TikTok may return a new refresh token too), or why not. */
export async function refreshTikTokGrant(app: TikTokApp, grant: TikTokGrant, fetchImpl: TikTokFetch, now = Date.now()): Promise<TokenOutcome> {
  return tokensOf(await post(fetchImpl, '/tt_user/oauth2/refresh_token/', {
    client_id: app.appId, client_secret: app.appSecret, grant_type: 'refresh_token', refresh_token: grant.r,
  }), now);
}

/** The grant given back. True only when TikTok said so (`code` 0). */
export async function revokeTikTokGrant(app: TikTokApp, grant: TikTokGrant, fetchImpl: TikTokFetch): Promise<boolean> {
  const a = await post(fetchImpl, '/tt_user/oauth2/revoke/', { client_id: app.appId, client_secret: app.appSecret, access_token: grant.a });
  return codeOf(a) === 0;
}

export type SendOutcome =
  | { readonly ok: true; readonly messageId: string }
  | { readonly ok: false; readonly retryable: boolean; readonly dead: boolean; readonly error: string; readonly uncertain?: true };

/** One text to one conversation. TikTok's words are never kept: only its code. */
export async function sendTikTokText(fetchImpl: TikTokFetch, o: { readonly accessToken: string; readonly openId: string; readonly conversationId: string; readonly body: string }): Promise<SendOutcome> {
  if (o.body.length > TIKTOK_TEXT_MAX) return { ok: false, retryable: false, dead: false, error: `tiktok: longer than ${TIKTOK_TEXT_MAX} characters` };
  let a: Answer;
  try {
    a = await request(fetchImpl, '/business/message/send/', {
      business_id: o.openId, recipient_type: 'CONVERSATION', recipient: o.conversationId, message_type: 'TEXT', text: { body: o.body },
    }, o.accessToken);
  } catch (e) {
    // B5 — retried only when it provably never reached TikTok; a timeout may have been accepted.
    const r = thrownSend('tiktok', e);
    return { ...r, dead: false };
  }
  const id = (dataOf(a)['message'] as Record<string, unknown> | undefined)?.['message_id'];
  if (codeOf(a) === 0 && typeof id === 'string' && id !== '') return { ok: true, messageId: id };
  // B5 — a yes that named no message may still be on its way: never sent again by a machine.
  if (codeOf(a) === 0 && a.status >= 200 && a.status < 300) return { ...acceptedWithoutId('tiktok'), dead: false };
  return {
    ok: false, retryable: retryable(a), dead: codeOf(a) === TIKTOK_TOKEN_DEAD,
    error: a === null ? 'tiktok: network' : `tiktok ${a.status} code ${codeOf(a) ?? 'none'}`,
  };
}

// ── The webhook's signature ────────────────────────────────────────────────────────────────────────────────────────

/** How old a signed delivery may be. TikTok's sample allows 5 s; deliveries are retried, so five minutes, as Stripe's. */
export const TIKTOK_SIGNATURE_TOLERANCE_S = 300;

/**
 * `Tiktok-Signature: t=<seconds>,s=<hex>`: HMAC-SHA256 of `<t>.<body>` with the app's secret, compared in constant
 * time, and the timestamp within the tolerance ("Webhook verification"). Nothing is read before this says yes.
 */
export function tiktokSignatureValid(rawBody: string, header: string | undefined, appSecret: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !appSecret) return false;
  const parts = new Map(header.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const; }));
  const t = parts.get('t'); const s = parts.get('s');
  if (!t || !s || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(s)) return false;
  if (Math.abs(nowS - Number(t)) > TIKTOK_SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(`${t}.${rawBody}`).digest('hex'), 'utf8');
  const given = Buffer.from(s.toLowerCase(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
