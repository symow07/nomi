import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  addressFromIdToken, authorizeUrl, exchangeCode, mintOAuthState, oauthClientsFrom, pkcePair,
  readOAuthState, refreshAccessToken, spfIncludeFor, OAUTH_STATE_TTL_MS, type OAuthFetch,
} from '../../src/connectors/oauth.js';
import { gmailSender, graphSender, mimeMessage } from '../../src/channels/email/senders.js';
import { renderAccounts, type AccountsView } from '../../src/api/web/connect.js';
import type { ConnectOutcome } from '../../src/channels/email/connectMailbox.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * C6 · M50 — connecting her mailbox, and the transport that finally sends.
 *
 * Everything on this side of the providers' wires: the URL she is sent to, the
 * PKCE pair, the state that ties a callback to the person who started it, every
 * way a token response can be wrong, the MIME message both providers receive,
 * and a page that never offers a button that can only fail.
 */

const NOW = Date.parse('2026-09-15T08:00:00Z');
const GOOGLE = { clientId: 'google-client.apps.googleusercontent.com', clientSecret: 'g-secret' };
const MS = { clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 'm-secret' };

const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const googleId = (over: Record<string, unknown> = {}) => jwt({
  iss: 'https://accounts.google.com', aud: GOOGLE.clientId, exp: NOW / 1000 + 3600,
  email: 'Lily@YiwuHF.com', email_verified: true, ...over,
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function wire(answer: (c: Call) => { status: number; body: unknown }): { fetchImpl: OAuthFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const c = { url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) };
      calls.push(c);
      const a = answer(c);
      return { status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
    },
  };
}

describe('C6 · the apps this installation has', () => {
  it('both halves or nothing: an id without its secret is not configured', () => {
    expect(oauthClientsFrom({ GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' })).toEqual({ google: { clientId: 'a', clientSecret: 'b' } });
    expect(oauthClientsFrom({ MICROSOFT_OAUTH_CLIENT_ID: 'a' })).toEqual({});
    expect(oauthClientsFrom({})).toEqual({});
  });

  it('AN OUTLOOK APP REGISTERED FOR ONE ORGANISATION is asked at its own tenant — /common refuses it', async () => {
    const env = { MICROSOFT_OAUTH_CLIENT_ID: MS.clientId, MICROSOFT_OAUTH_CLIENT_SECRET: 's', MICROSOFT_OAUTH_TENANT: 'yiwuhf.onmicrosoft.com' };
    const client = oauthClientsFrom(env).microsoft!;
    expect(client.tenant).toBe('yiwuhf.onmicrosoft.com');
    expect(authorizeUrl('microsoft', client, { redirectUri: 'https://x.test/cb', state: 's', challenge: 'c' }))
      .toMatch(/^https:\/\/login\.microsoftonline\.com\/yiwuhf\.onmicrosoft\.com\/oauth2\/v2\.0\/authorize\?/);
    const w = wire(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await refreshAccessToken('microsoft', client, 'rt', w.fetchImpl);
    expect(w.calls[0]!.url).toBe('https://login.microsoftonline.com/yiwuhf.onmicrosoft.com/oauth2/v2.0/token');
    // Unset, or not a tenant at all: common, as a multitenant app needs.
    expect(oauthClientsFrom({ ...env, MICROSOFT_OAUTH_TENANT: 'not a tenant' }).microsoft!.tenant).toBeUndefined();
    expect(authorizeUrl('microsoft', MS, { redirectUri: 'https://x.test/cb', state: 's', challenge: 'c' }))
      .toContain('/common/oauth2/v2.0/authorize');
  });
});

describe('C6 · where she is sent, and what is asked for', () => {
  it('Google: send only, offline, consent shown so a refresh token comes back, PKCE S256', () => {
    const url = new URL(authorizeUrl('google', GOOGLE, { redirectUri: 'https://nomi.test/app/connect/google/callback', state: 'n1', challenge: 'c1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: GOOGLE.clientId, response_type: 'code', state: 'n1',
      code_challenge: 'c1', code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
      redirect_uri: 'https://nomi.test/app/connect/google/callback',
    });
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.send']);
  });

  it('NOTHING THAT READS HER MAILBOX is ever requested, from either provider', () => {
    for (const [p, c] of [['google', GOOGLE], ['microsoft', MS]] as const) {
      const scope = new URL(authorizeUrl(p, c, { redirectUri: 'https://x.test/cb', state: 's', challenge: 'c' })).searchParams.get('scope')!;
      expect(scope, p).not.toMatch(/readonly|Mail\.Read|gmail\.modify|mail\.google\.com/i);
    }
  });

  it('the challenge is the SHA-256 of a verifier that never leaves', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkcePair().verifier).not.toBe(verifier);
  });
});

describe('C6 · the callback belongs to the person who pressed Connect', () => {
  const SECRET = 'installation-secret';
  const state = { provider: 'google' as const, verifier: 'v', nonce: 'n', personId: 'p-owner' };

  it('round-trips for this installation, within ten minutes', () => {
    expect(readOAuthState(SECRET, mintOAuthState(SECRET, state, NOW), NOW + 60_000)).toMatchObject(state);
  });

  it('refused when expired, tampered, or signed by any other key', () => {
    const token = mintOAuthState(SECRET, state, NOW);
    expect(readOAuthState(SECRET, token, NOW + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    expect(readOAuthState('other-secret', token, NOW)).toBeNull();
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify(['google', 'v', 'n', 'p-attacker', NOW + 60_000])).toString('base64url');
    expect(readOAuthState(SECRET, `${forged}.${mac}`, NOW)).toBeNull();
    expect(readOAuthState(SECRET, `${payload}.x${mac}`, NOW)).toBeNull();
    expect(readOAuthState(SECRET, undefined, NOW)).toBeNull();
  });
});

describe('C6 · which address she connected — read from the ID token, checked', () => {
  it('Google: a verified address, for this app, from Google, not expired', () => {
    expect(addressFromIdToken('google', GOOGLE, googleId(), NOW)).toBe('lily@yiwuhf.com');
    expect(addressFromIdToken('google', GOOGLE, googleId({ email_verified: false }), NOW)).toBeNull();
    expect(addressFromIdToken('google', GOOGLE, googleId({ aud: 'another-app' }), NOW)).toBeNull();
    expect(addressFromIdToken('google', GOOGLE, googleId({ iss: 'https://evil.test' }), NOW)).toBeNull();
    expect(addressFromIdToken('google', GOOGLE, googleId({ exp: NOW / 1000 - 1 }), NOW)).toBeNull();
    expect(addressFromIdToken('google', GOOGLE, 'not.a.jwt!', NOW)).toBeNull();
  });

  it('Microsoft: a tenant issuer, with preferred_username where there is no email claim', () => {
    const token = jwt({
      iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0', aud: MS.clientId,
      exp: NOW / 1000 + 600, preferred_username: 'lily@yiwuhf.com',
    });
    expect(addressFromIdToken('microsoft', MS, token, NOW)).toBe('lily@yiwuhf.com');
  });
});

describe('C6 · the code exchange, and every way it can be wrong', () => {
  const ok = { access_token: 'at', refresh_token: 'rt-secret', expires_in: 3599, id_token: googleId(), scope: 'openid https://www.googleapis.com/auth/gmail.send email' };
  const run = (status: number, body: unknown) => {
    const w = wire(() => ({ status, body }));
    return { w, r: exchangeCode('google', GOOGLE, { code: 'c', verifier: 'ver', redirectUri: 'https://x.test/cb' }, w.fetchImpl, NOW) };
  };

  it('posts the verifier and the exact redirect, and returns the refresh token and address', async () => {
    const { w, r } = run(200, ok);
    expect(await r).toEqual({ ok: true, value: { refreshToken: 'rt-secret', accessToken: 'at', expiresInSec: 3599, address: 'lily@yiwuhf.com', scopes: ok.scope } });
    const form = new URLSearchParams(w.calls[0]!.body!);
    expect(w.calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'authorization_code', code_verifier: 'ver', redirect_uri: 'https://x.test/cb' });
  });

  it('refused: sending not granted, no lasting access, no address, a bad code, the provider down', async () => {
    expect(await run(200, { ...ok, scope: 'openid email' }).r).toEqual({ ok: false, reason: 'missing_scope' });
    expect(await run(200, { ...ok, refresh_token: undefined }).r).toEqual({ ok: false, reason: 'no_refresh_token' });
    expect(await run(200, { ...ok, id_token: googleId({ aud: 'x' }) }).r).toEqual({ ok: false, reason: 'no_address' });
    expect(await run(400, { error: 'invalid_grant' }).r).toEqual({ ok: false, reason: 'rejected' });
    // The installation's own secret is wrong or expired: not hers to fix.
    expect(await run(401, { error: 'invalid_client' }).r).toEqual({ ok: false, reason: 'app_refused' });
    expect(await run(400, { error: 'unauthorized_client' }).r).toEqual({ ok: false, reason: 'app_refused' });
    expect(await run(503, 'down').r).toEqual({ ok: false, reason: 'unavailable' });
    const thrown = await exchangeCode('google', GOOGLE, { code: 'c', verifier: 'v', redirectUri: 'https://x.test' },
      async () => { throw new Error('reset'); }, NOW);
    expect(thrown).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('every way connecting can end tells her what happened, in every locale', () => {
    // A Record over the type: a new outcome fails to compile here until it has words.
    const OUTCOMES: Record<ConnectOutcome, true> = {
      connected: true, not_configured: true, rejected: true, missing_scope: true,
      no_refresh_token: true, no_address: true, app_refused: true, unavailable: true,
    };
    for (const l of LOCALES) for (const o of Object.keys(OUTCOMES)) {
      expect(t(l, `connect.flash.${o}` as MessageKey, { address: 'x@y.test' }), `${l}/${o}`).not.toBe(`connect.flash.${o}`);
    }
  });

  it('a refresh token that no longer works is REVOKED; a provider that is down is not', async () => {
    const dead = wire(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    expect(await refreshAccessToken('google', GOOGLE, 'rt', dead.fetchImpl)).toEqual({ ok: false, reason: 'revoked' });
    const down = wire(() => ({ status: 503, body: '' }));
    expect(await refreshAccessToken('google', GOOGLE, 'rt', down.fetchImpl)).toEqual({ ok: false, reason: 'unavailable' });
    // An expired app secret is not her dead token: her mailbox must not be marked for reconnecting.
    const secretExpired = wire(() => ({ status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000222' } }));
    expect(await refreshAccessToken('microsoft', MS, 'rt', secretExpired.fetchImpl)).toEqual({ ok: false, reason: 'app_refused' });
    const rotated = wire(() => ({ status: 200, body: { access_token: 'at2', expires_in: 3600, refresh_token: 'rt-new' } }));
    expect(await refreshAccessToken('microsoft', MS, 'rt-old', rotated.fetchImpl)).toEqual({ ok: true, accessToken: 'at2', expiresInSec: 3600, rotatedRefreshToken: 'rt-new' });
  });
});

describe('C6 · the message both providers receive', () => {
  const msg = {
    from: 'lily@yiwuhf.com', to: 'buyer@gulf.test', subject: 'Canvas totes', text: 'We make them.',
    headers: { 'List-Unsubscribe': '<https://nomi.test/u?t=x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tag: 'signed',
  };

  it('carries the way out as written — the one thing Graph JSON cannot', () => {
    const mime = mimeMessage(msg, 'id-1@yiwuhf.com', new Date(NOW));
    expect(mime).toContain('\r\nList-Unsubscribe: <https://nomi.test/u?t=x>\r\n');
    expect(mime).toContain('\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    expect(mime).toContain('\r\nMessage-ID: <id-1@yiwuhf.com>\r\n');
    expect(mime.startsWith('From: lily@yiwuhf.com\r\n')).toBe(true);
  });

  it('NO HEADER CAN BE INJECTED, and none of ours overwritten', () => {
    const mime = mimeMessage({
      ...msg, subject: 'Hi\r\nBcc: everyone@x.test',
      headers: { 'X-Ok': 'fine\r\nBcc: x@y.test', 'From': 'someone@else.test', 'Bad Name': 'x' },
    }, 'id@x', new Date(NOW));
    const head = mime.split('\r\n\r\n')[0]!;
    expect(head).not.toMatch(/^Bcc:/m);
    expect(head.match(/^From:/gm)).toHaveLength(1);
    expect(head).not.toContain('Bad Name');
  });

  it('a Chinese or Arabic subject is encoded, and the body travels as base64', () => {
    const mime = mimeMessage({ ...msg, subject: '帆布袋报价', text: 'مرحبا' }, 'id@x', new Date(NOW));
    expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('帆布袋报价').toString('base64')}?=`);
    expect(mime.split('\r\n\r\n')[1]!.trim()).toBe(Buffer.from('مرحبا').toString('base64'));
  });

  it('Gmail: the raw message goes, and the Message-ID Gmail stored comes back', async () => {
    const w = wire((c) => c.method === 'POST'
      ? { status: 200, body: { id: 'gm1' } }
      : { status: 200, body: { payload: { headers: [{ name: 'Message-Id', value: '<stored@mail.gmail.com>' }] } } });
    const r = await gmailSender(w.fetchImpl, () => new Date(NOW))('access-1', msg);
    expect(r).toEqual({ ok: true, providerMessageId: 'stored@mail.gmail.com' });
    expect(w.calls[0]!.headers['Authorization']).toBe('Bearer access-1');
    const raw = Buffer.from((JSON.parse(w.calls[0]!.body!) as { raw: string }).raw, 'base64url').toString('utf8');
    expect(raw).toContain('List-Unsubscribe: <https://nomi.test/u?t=x>');
    expect(w.calls[1]!.url).toContain('/messages/gm1?format=metadata&metadataHeaders=Message-ID');
  });

  it('Gmail: a 401 asks for a fresh token; a 5xx is retried; an accepted send stays sent even if the read-back fails', async () => {
    expect(await gmailSender(wire(() => ({ status: 401, body: {} })).fetchImpl)('a', msg)).toEqual({ ok: false, unauthorized: true });
    expect(await gmailSender(wire(() => ({ status: 503, body: {} })).fetchImpl)('a', msg)).toMatchObject({ ok: false, retryable: true });
    const r = await gmailSender(wire((c) => c.method === 'POST' ? { status: 200, body: { id: 'gm2' } } : { status: 500, body: '' }).fetchImpl)('a', msg);
    expect(r.ok).toBe(true);
  });

  it('Graph: the message is created from MIME, then sent, and its internetMessageId is the id', async () => {
    const w = wire((c) => c.url.endsWith('/send')
      ? { status: 202, body: '' }
      : { status: 201, body: { id: 'AAMk1', internetMessageId: '<exch@outlook.test>' } });
    const r = await graphSender(w.fetchImpl, () => new Date(NOW))('access-2', msg);
    expect(r).toEqual({ ok: true, providerMessageId: 'exch@outlook.test' });
    expect(w.calls[0]!.headers['Content-Type']).toBe('text/plain');
    expect(Buffer.from(w.calls[0]!.body!, 'base64').toString('utf8')).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(w.calls[1]!.url).toBe('https://graph.microsoft.com/v1.0/me/messages/AAMk1/send');
  });
});

describe('C6 · the accounts page', () => {
  const base: AccountsView = {
    mail: null, connectable: { google: true, microsoft: false }, sendingDomain: 'yiwuhf.com', smtpFrom: null,
    apollo: { kind: 'none' },
  };

  it('a provider with no app here says so, with no Connect button that could only fail', () => {
    const html = renderAccounts(base, 'en');
    expect(html).toContain('href="/app/connect/google/start"');
    expect(html).not.toContain('href="/app/connect/microsoft/start"');
    expect(html).toContain(esc(t('en', 'connect.mail.notHere')));
  });

  it('only the owner is offered Connect and Disconnect', () => {
    const staff = renderAccounts({ ...base, mail: { provider: 'google', address: 'lily@yiwuhf.com', connectedBy: 'Lily', connectedAt: new Date(NOW), needsAttention: null } }, 'en', { isOwner: false });
    expect(staff).not.toContain('/app/connect/mail/disconnect');
    expect(staff).not.toContain('/start"');
    expect(staff).toContain('<bdi>lily@yiwuhf.com</bdi>');
  });

  it('a dead token asks her to connect again; a mailbox off her domain is warned about', () => {
    const dead = renderAccounts({ ...base, mail: { provider: 'google', address: 'lily@yiwuhf.com', connectedBy: 'Lily', connectedAt: new Date(NOW), needsAttention: 'revoked' } }, 'en');
    expect(dead).toContain(esc(t('en', 'connect.state.attention')));
    expect(dead).toContain(esc(t('en', 'connect.action.reconnect')));
    const off = renderAccounts({ ...base, mail: { provider: 'google', address: 'lily@gmail.com', connectedBy: 'Lily', connectedAt: new Date(NOW), needsAttention: null } }, 'en');
    expect(off).toContain(esc(t('en', 'connect.mail.offDomain', { domain: 'yiwuhf.com' })));
  });

  it('Instagram and Messenger: the registry\'s truth, and nothing to press', () => {
    const html = renderAccounts(base, 'zh');
    expect(html).toContain(esc(t('zh', 'reach.channel.instagram')));
    expect(html).toContain(esc(t('zh', 'reach.cold.never')));
  });

  it('her SPF must list the provider she connected', () => {
    expect(spfIncludeFor('google')).toBe('_spf.google.com');
    expect(spfIncludeFor('microsoft')).toBe('spf.protection.outlook.com');
    expect(spfIncludeFor(null)).toBeNull();
  });
});

describe('C6 · production no longer sends into the recording fake', () => {
  it('the composition root builds the account transport, and the fake is not imported there', async () => {
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).not.toContain('fakeMailTransport');
    expect(main).toContain('accountMailTransport(');
    // Tests may still hand one in, and an installation with its own mail
    // provider (SMTP) sends through that instead — never through a fake.
    expect(main).toContain('overrides?.mailTransport ?? (smtpConfig');
    expect(main).toContain('smtpMailTransport({');
  });
});
