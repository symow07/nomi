import { createHmac, timingSafeEqual } from 'node:crypto';
import { withTenantTx, type Db } from '../../db/client.js';
import {
  archiveMetaAccount, connectMetaAccount, liveMetaAccount, linkMetaCredentials, unlinkMetaCredentials,
  type MetaAccount,
} from '../../db/metaAccounts.js';
import { credentialFingerprint, decryptSecret, encryptSecret } from '../../security/credentials.js';
import type { BusinessId } from '../../core/types/ids.js';
import type { MetaFetch } from './messaging.js';

/**
 * C10 — a business connects its OWN Page and Instagram, and answers as itself.
 *
 * Meta's "Facebook Login for Business": she presses Connect, Meta's dialog asks
 * her which Page and which Instagram account the app may act for, and sends a
 * code back. From the code: a user token, exchanged for a long-lived one, from
 * which `/me/accounts` yields the Page's OWN token — long-lived, no expiry —
 * and the Instagram account linked to it. That token, encrypted, is what is
 * kept (0054). Nobody at Nomi sees it; nothing is pasted.
 *
 * The seven scopes the login configuration carries are the ones the Page token
 * must hold for buyers' messages to arrive at all — `docs/META-SOCIAL-SETUP.md`
 * § 6 records the day a Messenger-only token taught us that.
 *
 * WHAT IS OURS AND WHAT IS NOT. Everything below works for any account that
 * holds a role on the app. For a stranger's Page — a real customer's — Meta
 * grants the scopes only after App Review. The code does not change; the
 * app's access level does.
 */

export const META_LOGIN_SCOPES = [
  'pages_show_list', 'pages_messaging', 'pages_read_engagement', 'pages_manage_metadata',
  'instagram_basic', 'instagram_manage_messages', 'business_management',
] as const;

export type MetaLogin = {
  readonly appId: string;
  readonly appSecret: string;
  /** The Facebook Login for Business configuration that names the scopes. */
  readonly configId: string;
};

/**
 * All three or nothing: half a login is a dialog that opens and then refuses.
 * The secret is the social app's — the same one that signs the webhooks.
 */
export function metaLoginFrom(env: Record<string, string | undefined>, appSecret: string | undefined): MetaLogin | null {
  const appId = env['META_SOCIAL_APP_ID']?.trim();
  const configId = env['META_LOGIN_CONFIG_ID']?.trim();
  if (!appId || !configId || !appSecret) return null;
  if (!/^[0-9]{5,}$/.test(appId) || !/^[0-9]{5,}$/.test(configId)) return null;
  return { appId, appSecret, configId };
}

/** Where she is sent. `state` is the nonce the callback must echo. */
export function metaDialogUrl(login: MetaLogin, o: { readonly redirectUri: string; readonly state: string; readonly graphVersion: string }): string {
  const q = new URLSearchParams({
    client_id: login.appId, redirect_uri: o.redirectUri, state: o.state, config_id: login.configId,
    response_type: 'code', override_default_response_type: 'true',
  });
  return `https://www.facebook.com/${o.graphVersion}/dialog/oauth?${q.toString()}`;
}

// ── The state that ties the callback to the person who pressed Connect ─────

export const META_STATE_TTL_MS = 10 * 60 * 1000;

export type MetaState = {
  readonly nonce: string;
  readonly personId: string;
  /**
   * Between the callback and her choice of Page (when she manages several),
   * the user token has to survive one round trip. It travels in the state,
   * ENCRYPTED with the credential key and signed like the rest — never in the
   * clear, never in a URL, and dead in ten minutes.
   */
  readonly tokenCiphertext: string | null;
  readonly exp: number;
};

const stateKey = (secret: string): Buffer => createHmac('sha256', secret).update('yf-meta-state-v1').digest();
const b64url = (b: Buffer): string => b.toString('base64url');

export function mintMetaState(secret: string, s: Omit<MetaState, 'exp'>, now: number): string {
  const payload = b64url(Buffer.from(JSON.stringify([s.nonce, s.personId, s.tokenCiphertext, now + META_STATE_TTL_MS]), 'utf8'));
  return `${payload}.${b64url(createHmac('sha256', stateKey(secret)).update(payload).digest())}`;
}

export function readMetaState(secret: string, token: string | undefined, now: number): MetaState | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(b64url(createHmac('sha256', stateKey(secret)).update(payload).digest()));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [nonce, personId, tokenCiphertext, exp] = parsed as unknown[];
    if (typeof nonce !== 'string' || typeof personId !== 'string') return null;
    if (tokenCiphertext !== null && typeof tokenCiphertext !== 'string') return null;
    if (typeof exp !== 'number' || exp < now) return null;
    return { nonce, personId, tokenCiphertext: tokenCiphertext as string | null, exp };
  } catch {
    return null;
  }
}

export function sameMetaNonce(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── Meta, over the wire ────────────────────────────────────────────────────

export const CONNECT_TIMEOUT_MS = 15_000;

type J = Record<string, unknown>;
const obj = (v: unknown): J => (typeof v === 'object' && v !== null ? v as J : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export type MetaPage = {
  readonly pageId: string;
  readonly name: string;
  /** The Page's own token — long-lived when the user token was. */
  readonly token: string;
  readonly instagram: { readonly id: string; readonly username: string | null } | null;
};

export type ConnectFailure =
  /** Meta refused the code (expired, reused, wrong redirect). */
  | 'rejected'
  /** Meta did not answer. */
  | 'unavailable';

const get = async (fetchImpl: MetaFetch, url: string): Promise<{ status: number; body: J } | null> => {
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: {}, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    let body: J = {};
    try { body = obj(JSON.parse(text)); } catch { /* not JSON: an empty body */ }
    return { status: res.status, body };
  } catch {
    return null;
  }
};

/**
 * The code Meta sent back → a long-lived USER token. Two calls: the code
 * exchange yields a short-lived token; `fb_exchange_token` makes it last (60
 * days), and the Page tokens read with it then never expire.
 */
export async function exchangeMetaCode(
  login: MetaLogin,
  input: { readonly code: string; readonly redirectUri: string; readonly graphVersion: string },
  fetchImpl: MetaFetch,
): Promise<{ readonly ok: true; readonly userToken: string } | { readonly ok: false; readonly reason: ConnectFailure }> {
  const base = `https://graph.facebook.com/${input.graphVersion}/oauth/access_token`;
  const first = await get(fetchImpl, `${base}?${new URLSearchParams({
    client_id: login.appId, client_secret: login.appSecret, redirect_uri: input.redirectUri, code: input.code,
  }).toString()}`);
  if (!first) return { ok: false, reason: 'unavailable' };
  const shortToken = str(first.body['access_token']);
  if (first.status < 200 || first.status >= 300 || !shortToken) return { ok: false, reason: first.status >= 500 ? 'unavailable' : 'rejected' };

  const second = await get(fetchImpl, `${base}?${new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: login.appId, client_secret: login.appSecret, fb_exchange_token: shortToken,
  }).toString()}`);
  // A long-lived token is what we want; the short one still works for the
  // minutes this flow takes, so a refused exchange is not a refused connect.
  const longToken = second && second.status >= 200 && second.status < 300 ? str(second.body['access_token']) : null;
  return { ok: true, userToken: longToken ?? shortToken };
}

/** Every Page she may act for, with its own token and its Instagram account. */
export async function listMetaPages(
  userToken: string, graphVersion: string, fetchImpl: MetaFetch,
): Promise<{ readonly ok: true; readonly pages: readonly MetaPage[] } | { readonly ok: false; readonly reason: ConnectFailure }> {
  const r = await get(fetchImpl, `https://graph.facebook.com/${graphVersion}/me/accounts?${new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: userToken,
  }).toString()}`);
  if (!r) return { ok: false, reason: 'unavailable' };
  if (r.status < 200 || r.status >= 300) return { ok: false, reason: r.status >= 500 ? 'unavailable' : 'rejected' };
  const data = Array.isArray(r.body['data']) ? r.body['data'] as unknown[] : [];
  const pages: MetaPage[] = [];
  for (const raw of data) {
    const p = obj(raw);
    const pageId = str(p['id']); const token = str(p['access_token']);
    if (!pageId || !token || !/^[0-9]{5,}$/.test(pageId)) continue;
    const ig = obj(p['instagram_business_account']);
    const igId = str(ig['id']);
    pages.push({
      pageId, token, name: (str(p['name']) ?? '').trim() || pageId,
      instagram: igId && /^[0-9]{5,}$/.test(igId) ? { id: igId, username: str(ig['username'])?.trim() || null } : null,
    });
  }
  return { ok: true, pages };
}

/** Subscribe the Page to this app's webhook fields, with the Page's own token. */
export async function subscribeMetaPage(page: { readonly pageId: string; readonly token: string }, graphVersion: string, fetchImpl: MetaFetch): Promise<boolean> {
  try {
    const res = await fetchImpl(
      `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(page.pageId)}/subscribed_apps?${new URLSearchParams({
        subscribed_fields: 'messages,messaging_postbacks', access_token: page.token,
      }).toString()}`,
      { method: 'POST', headers: {}, body: '', signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
    );
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

/** Best effort on disconnect: the row is archived whether or not Meta answers. */
export async function unsubscribeMetaPage(page: { readonly pageId: string; readonly token: string }, graphVersion: string, fetchImpl: MetaFetch): Promise<void> {
  try {
    await fetchImpl(
      `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(page.pageId)}/subscribed_apps?${new URLSearchParams({ access_token: page.token }).toString()}`,
      { method: 'DELETE', headers: {}, signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
    );
  } catch { /* archived regardless */ }
}

// ── The connection itself ──────────────────────────────────────────────────

export type MetaConnectOutcome =
  | { readonly outcome: 'connected'; readonly page: string; readonly instagram: string | null }
  /** She manages several Pages; she must choose. The token travels in the state. */
  | { readonly outcome: 'choose'; readonly pages: readonly { readonly pageId: string; readonly name: string; readonly instagram: string | null }[]; readonly tokenCiphertext: string }
  | { readonly outcome: 'no_pages' }
  | { readonly outcome: 'page_taken' }
  | { readonly outcome: 'subscribe_failed' }
  | { readonly outcome: 'not_configured' }
  | { readonly outcome: ConnectFailure };

export type MetaConnectDeps = {
  readonly db: Db;
  readonly credentialKey: Buffer | null;
  readonly login: MetaLogin | null;
  readonly fetchImpl: MetaFetch;
  readonly graphVersion: string;
};

/**
 * From a code (first visit) or a stored user token (after she chose a Page):
 * the Page's own token, encrypted, and the credential rows that route her
 * buyers' messages to her. The network calls happen before any transaction
 * opens; the write is one transaction, archive-then-insert.
 */
export async function completeMetaConnection(
  deps: MetaConnectDeps,
  input: {
    readonly businessId: BusinessId; readonly by: string;
    readonly redirectUri: string;
    readonly code?: string;
    /** The user token from the first visit, as the state carried it: encrypted. */
    readonly userTokenCiphertext?: string;
    /** Which Page, when she manages several. */
    readonly pageId?: string;
  },
): Promise<MetaConnectOutcome> {
  if (!deps.login || !deps.credentialKey) return { outcome: 'not_configured' };
  const key = deps.credentialKey;

  let userToken: string | null = null;
  if (input.userTokenCiphertext) {
    try { userToken = decryptSecret(input.userTokenCiphertext, key).plain; } catch { return { outcome: 'rejected' }; }
  }
  if (!userToken) {
    if (!input.code) return { outcome: 'rejected' };
    const ex = await exchangeMetaCode(deps.login, { code: input.code, redirectUri: input.redirectUri, graphVersion: deps.graphVersion }, deps.fetchImpl);
    if (!ex.ok) return { outcome: ex.reason };
    userToken = ex.userToken;
  }

  const listed = await listMetaPages(userToken, deps.graphVersion, deps.fetchImpl);
  if (!listed.ok) return { outcome: listed.reason };
  if (listed.pages.length === 0) return { outcome: 'no_pages' };

  const page = input.pageId
    ? listed.pages.find((p) => p.pageId === input.pageId)
    : listed.pages.length === 1 ? listed.pages[0] : undefined;
  if (!page) {
    if (input.pageId) return { outcome: 'rejected' };
    return {
      outcome: 'choose',
      pages: listed.pages.map((p) => ({ pageId: p.pageId, name: p.name, instagram: p.instagram?.username ?? p.instagram?.id ?? null })),
      tokenCiphertext: encryptSecret(userToken, key),
    };
  }

  if (!await subscribeMetaPage(page, deps.graphVersion, deps.fetchImpl)) return { outcome: 'subscribe_failed' };

  return withTenantTx(deps.db, input.businessId, async (tx) => {
    const stored = await connectMetaAccount(tx, input.businessId, {
      pageId: page.pageId, pageName: page.name,
      igAccountId: page.instagram?.id ?? null, igUsername: page.instagram?.username ?? null,
      ciphertext: encryptSecret(page.token, key), fingerprint: credentialFingerprint(page.token),
      scopes: META_LOGIN_SCOPES.join(' '), by: input.by,
    });
    if (!stored.ok) return { outcome: 'page_taken' as const };
    const linked = await linkMetaCredentials(tx, input.businessId, {
      accountId: stored.id, pageId: page.pageId, igAccountId: page.instagram?.id ?? null, actor: input.by,
    });
    if (linked === 'account_taken') return { outcome: 'page_taken' as const };
    return { outcome: 'connected' as const, page: page.name, instagram: page.instagram?.username ?? null };
  });
}

/** Meta forgets the subscription (best effort); the rows here are archived and the credentials switched off. */
export async function disconnectMetaAccount(
  deps: MetaConnectDeps, input: { readonly businessId: BusinessId; readonly by: string },
): Promise<boolean> {
  const account = await withTenantTx(deps.db, input.businessId, (tx) => liveMetaAccount(tx, input.businessId));
  if (!account) return false;
  if (deps.credentialKey) {
    try {
      const token = decryptSecret(account.ciphertext, deps.credentialKey).plain;
      await unsubscribeMetaPage({ pageId: account.pageId, token }, deps.graphVersion, deps.fetchImpl);
    } catch { /* a key that cannot open it: archive anyway */ }
  }
  return withTenantTx(deps.db, input.businessId, async (tx) => {
    await unlinkMetaCredentials(tx, input.businessId, input.by);
    return archiveMetaAccount(tx, input.businessId, input.by);
  });
}

/** The Page token, in memory for one send. Null when the key cannot open it. */
export function metaAccountToken(account: MetaAccount, credentialKey: Buffer): string | null {
  try {
    return decryptSecret(account.ciphertext, credentialKey).plain;
  } catch {
    return null;
  }
}
