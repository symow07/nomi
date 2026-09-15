import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * C6 · M50 — connecting her mailbox with a few clicks: OAuth 2.0 authorization
 * code with PKCE, for Google and Microsoft, in the providers' DEV MODE.
 *
 * ── WHAT IS ASKED FOR, AND WHAT IS NOT ────────────────────────────────────
 *
 * The scope to SEND as her (`gmail.send`, `Mail.Send`), and `openid email` to
 * learn which address that is. Nothing that reads her mailbox. A buyer's reply
 * therefore lands in her own inbox as it always has; reading it into the product
 * would need `gmail.readonly`, which Google classes as RESTRICTED and gates
 * behind a paid security assessment — a decision for the owner (M52), not a
 * scope to slip in here.
 *
 * ── WHAT HAS AND HAS NOT BEEN CHECKED ─────────────────────────────────────
 *
 * The endpoints and parameters are the providers' documented ones. They have not
 * been exercised from this repository: dev-mode OAuth needs her own Google Cloud
 * project and Entra app (M52 #3, #4). Everything on this side of the wire is
 * tested — the URL built, PKCE, the state that ties a callback to the person who
 * started it, and every way a token response can be wrong.
 *
 * ── THE ID TOKEN IS READ, NOT VERIFIED BY SIGNATURE ───────────────────────
 *
 * It arrives in the token endpoint's response, over TLS, to a request
 * authenticated with our client secret — the case in which OpenID Connect Core
 * (3.1.3.7) permits using TLS server validation in place of the signature. Its
 * audience, issuer and expiry ARE checked: a token for another app, from another
 * issuer, or already expired is refused.
 */

export const OAUTH_PROVIDERS = ['google', 'microsoft'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type OAuthClient = {
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * Microsoft only — the directory the app is registered in. An app registered
   * for "this organization only" (what a factory registering in its own
   * Microsoft 365 naturally picks) is REFUSED at `/common`; it must be asked at
   * its own tenant. Absent is `common`, which serves a multitenant app.
   */
  readonly tenant?: string;
};
export type OAuthClients = Partial<Record<OAuthProvider, OAuthClient>>;

export type OAuthFetch = (url: string, init: {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export const OAUTH_TIMEOUT_MS = 15_000;

export const PROVIDER = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
    sendScope: 'https://www.googleapis.com/auth/gmail.send',
    issuer: (iss: string) => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
    /** The SPF mechanism her domain must publish for Google to send as it. */
    spfInclude: '_spf.google.com',
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/Mail.Send'],
    sendScope: 'https://graph.microsoft.com/Mail.Send',
    issuer: (iss: string) => /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/.test(iss),
    spfInclude: 'spf.protection.outlook.com',
  },
} as const satisfies Record<OAuthProvider, unknown>;

/** The SPF mechanism her domain must list for the mailbox she connected — or null. */
export const spfIncludeFor = (provider: OAuthProvider | null | undefined): string | null =>
  provider ? PROVIDER[provider].spfInclude : null;

/** A Microsoft tenant as Entra names one: a GUID, a verified domain, or a well-known alias. */
const TENANT_SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]+(\.[a-z0-9-]+)+|common|organizations|consumers)$/i;

/** Where this client's authorize and token requests go. */
export function endpointFor(provider: OAuthProvider, client: OAuthClient, kind: 'authorize' | 'token'): string {
  const url = kind === 'authorize' ? PROVIDER[provider].authorizeUrl : PROVIDER[provider].tokenUrl;
  return provider === 'microsoft' && client.tenant ? url.replace('/common/', `/${client.tenant}/`) : url;
}

/**
 * The installation's apps, from the environment. Both halves or nothing: an id
 * with no secret would send her to a consent screen whose code can never be
 * exchanged, and a warning at boot costs less than that afternoon.
 */
export function oauthClientsFrom(env: Record<string, string | undefined>): OAuthClients {
  const pair = (id: string, secret: string, name: string): OAuthClient | undefined => {
    const clientId = env[id]?.trim(); const clientSecret = env[secret]?.trim();
    if (clientId && clientSecret) return { clientId, clientSecret };
    if (clientId || clientSecret) console.warn(`${name}: set both ${id} and ${secret}, or neither. Not configured.`);
    return undefined;
  };
  const google = pair('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'Google sending');
  const microsoftPair = pair('MICROSOFT_OAUTH_CLIENT_ID', 'MICROSOFT_OAUTH_CLIENT_SECRET', 'Microsoft sending');
  const tenant = env['MICROSOFT_OAUTH_TENANT']?.trim();
  if (tenant && !TENANT_SHAPE.test(tenant)) console.warn('MICROSOFT_OAUTH_TENANT: not a tenant id or domain. Using common.');
  const microsoft = microsoftPair && tenant && TENANT_SHAPE.test(tenant) ? { ...microsoftPair, tenant } : microsoftPair;
  return { ...(google ? { google } : {}), ...(microsoft ? { microsoft } : {}) };
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** RFC 7636 — the verifier stays with us; only its hash travels to the provider. */
export function pkcePair(): { readonly verifier: string; readonly challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export function authorizeUrl(
  provider: OAuthProvider, client: OAuthClient,
  o: { readonly redirectUri: string; readonly state: string; readonly challenge: string },
): string {
  const p = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: PROVIDER[provider].scopes.join(' '),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    // Google issues a refresh token only with offline access and, after the
    // first grant, only when consent is shown again.
    ...(provider === 'google'
      ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }
      : { response_mode: 'query', prompt: 'select_account' }),
  });
  return `${endpointFor(provider, client, 'authorize')}?${p.toString()}`;
}

// ── The state that ties a callback to the person who pressed "Connect" ─────

/** Short: she is on the provider's page for a minute, not an afternoon. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  readonly provider: OAuthProvider;
  readonly verifier: string;
  /** Echoed by the provider in `state`; compared with this. */
  readonly nonce: string;
  /** Who started it. A callback for anyone else is refused. */
  readonly personId: string;
  readonly exp: number;
};

/**
 * A key for THIS purpose, derived from the installation's secret — the
 * unsubscribe and staff-code precedent: a leak of one signed thing is not a
 * forgery of another.
 */
const stateKey = (secret: string): Buffer => createHmac('sha256', secret).update('yf-oauth-state-v1').digest();

export function mintOAuthState(secret: string, s: Omit<OAuthState, 'exp'>, now: number): string {
  const payload = b64url(Buffer.from(JSON.stringify([s.provider, s.verifier, s.nonce, s.personId, now + OAUTH_STATE_TTL_MS]), 'utf8'));
  return `${payload}.${b64url(createHmac('sha256', stateKey(secret)).update(payload).digest())}`;
}

/** Null for anything but an unexpired state this installation minted. */
export function readOAuthState(secret: string, token: string | undefined, now: number): OAuthState | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(b64url(createHmac('sha256', stateKey(secret)).update(payload).digest()));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [provider, verifier, nonce, personId, exp] = parsed as unknown[];
    if (!OAUTH_PROVIDERS.some((p) => p === provider)) return null;
    if (typeof verifier !== 'string' || typeof nonce !== 'string' || typeof personId !== 'string') return null;
    if (typeof exp !== 'number' || exp < now) return null;
    return { provider: provider as OAuthProvider, verifier, nonce, personId, exp };
  } catch {
    return null;
  }
}

/** Compare the `state` the provider echoed with the nonce in the cookie, in constant time. */
export function sameNonce(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── Tokens ─────────────────────────────────────────────────────────────────

export type ConnectFailure =
  /** The provider refused the code (expired, reused, wrong redirect). */
  | 'rejected'
  /** She did not grant the scope to send — she unticked it. */
  | 'missing_scope'
  /** No refresh token came back, so nothing could send later. */
  | 'no_refresh_token'
  /** The ID token was absent, or not for this app, this issuer, or now. */
  | 'no_address'
  /**
   * The provider refused THIS INSTALLATION'S APP, not her: a wrong client
   * secret, or one that expired (Entra secrets always do). Pressing Connect
   * again cannot fix it, so it must not be told to her as if it could.
   */
  | 'app_refused'
  | 'unavailable';

/** OAuth 2.0 (RFC 6749 §5.2): the client itself was not accepted. */
const appRefused = (r: { readonly status: number; readonly json: Record<string, unknown> | null }): boolean =>
  (r.status === 400 || r.status === 401)
  && (r.json?.['error'] === 'invalid_client' || r.json?.['error'] === 'unauthorized_client');

export type Connected = {
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly expiresInSec: number;
  readonly address: string;
  readonly scopes: string;
};

async function postForm(fetchImpl: OAuthFetch, url: string, fields: Record<string, string>): Promise<
  { readonly status: number; readonly json: Record<string, unknown> | null } | null
> {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(await res.text());
      json = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch { /* not JSON: judged by status below */ }
    return { status: res.status, json };
  } catch {
    return null;
  }
}

/** The claims of an ID token received straight from the token endpoint — see the header. */
export function addressFromIdToken(
  provider: OAuthProvider, client: OAuthClient, idToken: unknown, now: number,
): string | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  let claims: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    claims = parsed as Record<string, unknown>;
  } catch { return null; }
  const aud = claims['aud'];
  const audOk = aud === client.clientId || (Array.isArray(aud) && aud.includes(client.clientId));
  if (!audOk) return null;
  if (typeof claims['iss'] !== 'string' || !PROVIDER[provider].issuer(claims['iss'])) return null;
  if (typeof claims['exp'] !== 'number' || claims['exp'] * 1000 < now) return null;
  // Google says whether it verified the address; an unverified one is not hers to send as.
  if (provider === 'google' && claims['email_verified'] !== true) return null;
  const raw = provider === 'google' ? claims['email'] : (claims['email'] ?? claims['preferred_username']);
  if (typeof raw !== 'string') return null;
  const address = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

export async function exchangeCode(
  provider: OAuthProvider, client: OAuthClient,
  o: { readonly code: string; readonly verifier: string; readonly redirectUri: string },
  fetchImpl: OAuthFetch, now: number,
): Promise<{ readonly ok: true; readonly value: Connected } | { readonly ok: false; readonly reason: ConnectFailure }> {
  const r = await postForm(fetchImpl, endpointFor(provider, client, 'token'), {
    grant_type: 'authorization_code', code: o.code, redirect_uri: o.redirectUri,
    client_id: client.clientId, client_secret: client.clientSecret, code_verifier: o.verifier,
  });
  if (!r) return { ok: false, reason: 'unavailable' };
  if (r.status >= 500) return { ok: false, reason: 'unavailable' };
  if (appRefused(r)) return { ok: false, reason: 'app_refused' };
  if (r.status !== 200 || !r.json) return { ok: false, reason: 'rejected' };
  const j = r.json;
  const scopes = typeof j['scope'] === 'string' ? j['scope'] : '';
  if (!scopes.split(/\s+/).some((s) => s === PROVIDER[provider].sendScope || s === 'Mail.Send')) {
    return { ok: false, reason: 'missing_scope' };
  }
  if (typeof j['refresh_token'] !== 'string' || !j['refresh_token']) return { ok: false, reason: 'no_refresh_token' };
  if (typeof j['access_token'] !== 'string') return { ok: false, reason: 'rejected' };
  const address = addressFromIdToken(provider, client, j['id_token'], now);
  if (!address) return { ok: false, reason: 'no_address' };
  return {
    ok: true,
    value: {
      refreshToken: j['refresh_token'], accessToken: j['access_token'],
      expiresInSec: typeof j['expires_in'] === 'number' ? j['expires_in'] : 3600,
      address, scopes,
    },
  };
}

export type Refreshed =
  | {
    readonly ok: true; readonly accessToken: string; readonly expiresInSec: number;
    /** Microsoft rotates refresh tokens; when one comes back it replaces the stored one. */
    readonly rotatedRefreshToken: string | null;
  }
  | { readonly ok: false; readonly reason: 'revoked' | 'app_refused' | 'unavailable' };

export async function refreshAccessToken(
  provider: OAuthProvider, client: OAuthClient, refreshToken: string, fetchImpl: OAuthFetch,
): Promise<Refreshed> {
  const r = await postForm(fetchImpl, endpointFor(provider, client, 'token'), {
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: client.clientId, client_secret: client.clientSecret,
    ...(provider === 'microsoft' ? { scope: PROVIDER.microsoft.scopes.join(' ') } : {}),
  });
  if (!r || r.status >= 500 || r.status === 429) return { ok: false, reason: 'unavailable' };
  // Her token may be fine; the installation's secret is not. Marking her
  // mailbox dead would send her to reconnect, which fails the same way.
  if (appRefused(r)) return { ok: false, reason: 'app_refused' };
  // `invalid_grant` is the providers' word for a token that will never work
  // again: a changed password, a revoked app, an expired grant.
  if (r.status !== 200 || !r.json || typeof r.json['access_token'] !== 'string') return { ok: false, reason: 'revoked' };
  const rotated = r.json['refresh_token'];
  return {
    ok: true, accessToken: r.json['access_token'],
    expiresInSec: typeof r.json['expires_in'] === 'number' ? r.json['expires_in'] : 3600,
    rotatedRefreshToken: typeof rotated === 'string' && rotated && rotated !== refreshToken ? rotated : null,
  };
}
