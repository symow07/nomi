import { describe, it, expect } from 'vitest';
import {
  META_LOGIN_SCOPES, metaLoginFrom, metaDialogUrl, mintMetaState, readMetaState, sameMetaNonce, META_STATE_TTL_MS,
  exchangeMetaCode, listMetaPages, subscribeMetaPage, type MetaLogin,
} from '../../src/channels/meta/connect.js';
import { renderMetaPagePicker } from '../../src/api/web/metaConnect.js';
import type { MetaFetch } from '../../src/channels/meta/messaging.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * C10 — a business connects its OWN Page and Instagram. What is on trial here
 * is the wire and the state: that the dialog asks for the right things, that
 * a callback answers only to the person who pressed Connect, that Meta's
 * answers are read without trust, and that nothing here can send.
 */

const LOGIN: MetaLogin = { appId: '4070500000000001', appSecret: 'social-secret', configId: '1234567890' };
const V = 'v23.0';

type Call = { url: string; method: string; body: string | undefined };
const fakeFetch = (answer: (url: string, method: string) => { status: number; body: unknown } | 'throw', calls: Call[] = []): MetaFetch =>
  async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    const a = answer(url, init.method);
    if (a === 'throw') throw new Error('unreachable');
    return { status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) };
  };

describe('C10 · the login this installation offers', () => {
  it('THE SEVEN SCOPES are the ones a Page token needs to receive and answer on Instagram', () => {
    expect([...META_LOGIN_SCOPES].sort()).toEqual([
      'business_management', 'instagram_basic', 'instagram_manage_messages',
      'pages_manage_metadata', 'pages_messaging', 'pages_read_engagement', 'pages_show_list',
    ]);
  });

  it('is offered only when app id, configuration and secret are ALL there — half a login opens a dialog that refuses', () => {
    expect(metaLoginFrom({ META_SOCIAL_APP_ID: '4070500000000001', META_LOGIN_CONFIG_ID: '1234567890' }, 'secret'))
      .toEqual({ appId: '4070500000000001', appSecret: 'secret', configId: '1234567890' });
    expect(metaLoginFrom({ META_SOCIAL_APP_ID: '4070500000000001' }, 'secret')).toBeNull();
    expect(metaLoginFrom({ META_LOGIN_CONFIG_ID: '1234567890' }, 'secret')).toBeNull();
    expect(metaLoginFrom({ META_SOCIAL_APP_ID: '4070500000000001', META_LOGIN_CONFIG_ID: '1234567890' }, undefined)).toBeNull();
    expect(metaLoginFrom({ META_SOCIAL_APP_ID: 'not-an-id', META_LOGIN_CONFIG_ID: '1234567890' }, 'secret')).toBeNull();
  });

  it('sends her to Meta with the configuration, the callback and the nonce, asking for a CODE', () => {
    const url = new URL(metaDialogUrl(LOGIN, { redirectUri: 'https://nomi.test/app/connect/meta/callback', state: 'nonce-1', graphVersion: V }));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: LOGIN.appId, redirect_uri: 'https://nomi.test/app/connect/meta/callback', state: 'nonce-1',
      config_id: LOGIN.configId, response_type: 'code', override_default_response_type: 'true',
    });
    // No secret, no scopes in the URL: the configuration names them.
    expect(url.toString()).not.toContain('social-secret');
  });
});

describe('C10 · the state that ties the callback to the person who pressed Connect', () => {
  const NOW = 1_800_000_000_000;

  it('round-trips, with or without a token riding in it', () => {
    const bare = mintMetaState('s', { nonce: 'n1', personId: 'p1', tokenCiphertext: null }, NOW);
    expect(readMetaState('s', bare, NOW + 1000)).toEqual({ nonce: 'n1', personId: 'p1', tokenCiphertext: null, exp: NOW + META_STATE_TTL_MS });
    const carrying = mintMetaState('s', { nonce: 'n1', personId: 'p1', tokenCiphertext: 'v1.cipher' }, NOW);
    expect(readMetaState('s', carrying, NOW + 1000)?.tokenCiphertext).toBe('v1.cipher');
  });

  it('DIES IN TEN MINUTES, and refuses a forgery, another secret, or a mail-connect state', () => {
    const s = mintMetaState('s', { nonce: 'n1', personId: 'p1', tokenCiphertext: null }, NOW);
    expect(readMetaState('s', s, NOW + META_STATE_TTL_MS + 1)).toBeNull();
    expect(readMetaState('other', s, NOW)).toBeNull();
    expect(readMetaState('s', `${s.slice(0, -2)}xx`, NOW)).toBeNull();
    expect(readMetaState('s', undefined, NOW)).toBeNull();
    expect(readMetaState('s', 'not.a.state', NOW)).toBeNull();
  });

  it('compares nonces in constant time and by value', () => {
    expect(sameMetaNonce('abc', 'abc')).toBe(true);
    expect(sameMetaNonce('abc', 'abd')).toBe(false);
    expect(sameMetaNonce('abc', 'ab')).toBe(false);
  });
});

describe('C10 · reading Meta without trusting it', () => {
  it('the code becomes a LONG-LIVED user token — and the short one still connects when the exchange is refused', async () => {
    const calls: Call[] = [];
    const f = fakeFetch((url) => url.includes('fb_exchange_token')
      ? { status: 200, body: { access_token: 'long' } } : { status: 200, body: { access_token: 'short' } }, calls);
    expect(await exchangeMetaCode(LOGIN, { code: 'c', redirectUri: 'https://nomi.test/cb', graphVersion: V }, f)).toEqual({ ok: true, userToken: 'long' });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain(`client_id=${LOGIN.appId}`);
    expect(calls[0]!.url).toContain('code=c');
    expect(calls[1]!.url).toContain('grant_type=fb_exchange_token');

    const stubborn = fakeFetch((url) => url.includes('fb_exchange_token') ? { status: 400, body: {} } : { status: 200, body: { access_token: 'short' } });
    expect(await exchangeMetaCode(LOGIN, { code: 'c', redirectUri: 'r', graphVersion: V }, stubborn)).toEqual({ ok: true, userToken: 'short' });
  });

  it('a refused code is REJECTED; Meta not answering is UNAVAILABLE', async () => {
    expect(await exchangeMetaCode(LOGIN, { code: 'bad', redirectUri: 'r', graphVersion: V }, fakeFetch(() => ({ status: 400, body: { error: {} } }))))
      .toEqual({ ok: false, reason: 'rejected' });
    expect(await exchangeMetaCode(LOGIN, { code: 'c', redirectUri: 'r', graphVersion: V }, fakeFetch(() => 'throw')))
      .toEqual({ ok: false, reason: 'unavailable' });
    expect(await exchangeMetaCode(LOGIN, { code: 'c', redirectUri: 'r', graphVersion: V }, fakeFetch(() => ({ status: 503, body: {} }))))
      .toEqual({ ok: false, reason: 'unavailable' });
  });

  it('every Page she may act for, with its own token and its Instagram account; junk is skipped', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { data: [
      { id: '1020000000001', name: ' Atlas Bags ', access_token: 'pt-a', instagram_business_account: { id: '1784000000001', username: 'atlasbags' } },
      { id: '1020000000002', name: 'Bolt Tools', access_token: 'pt-b' },
      { id: 'nope', name: 'No id', access_token: 'x' },
      { id: '1020000000003', name: 'No token' },
      'garbage',
    ] } }));
    const r = await listMetaPages('user-token', V, f);
    expect(r).toEqual({ ok: true, pages: [
      { pageId: '1020000000001', name: 'Atlas Bags', token: 'pt-a', instagram: { id: '1784000000001', username: 'atlasbags' } },
      { pageId: '1020000000002', name: 'Bolt Tools', token: 'pt-b', instagram: null },
    ] });
    expect(await listMetaPages('u', V, fakeFetch(() => ({ status: 401, body: {} })))).toEqual({ ok: false, reason: 'rejected' });
    expect(await listMetaPages('u', V, fakeFetch(() => ({ status: 200, body: {} })))).toEqual({ ok: true, pages: [] });
  });

  it('subscribes the Page to messages with the PAGE\'s own token, and says so honestly when refused', async () => {
    const calls: Call[] = [];
    expect(await subscribeMetaPage({ pageId: '1020000000001', token: 'pt-a' }, V, fakeFetch(() => ({ status: 200, body: { success: true } }), calls))).toBe(true);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toContain('/1020000000001/subscribed_apps?');
    expect(calls[0]!.url).toContain('subscribed_fields=messages%2Cmessaging_postbacks');
    expect(calls[0]!.url).toContain('access_token=pt-a');
    expect(await subscribeMetaPage({ pageId: '1', token: 'x' }, V, fakeFetch(() => ({ status: 400, body: {} })))).toBe(false);
    expect(await subscribeMetaPage({ pageId: '1', token: 'x' }, V, fakeFetch(() => 'throw'))).toBe(false);
  });
});

describe('C10 · when she manages several Pages', () => {
  const pages = [
    { pageId: '1020000000001', name: 'Atlas Bags', instagram: 'atlasbags' },
    { pageId: '1020000000002', name: 'Bolt <Tools>', instagram: null },
  ];

  it('each Page is named with its Instagram, and the choice posts the state back — never the token', () => {
    for (const l of LOCALES) {
      const html = renderMetaPagePicker(pages, 'STATE.sig', l);
      expect(html).toContain('Atlas Bags');
      expect(html).toContain(esc(t(l, 'connect.meta.choose.instagram', { handle: '@atlasbags' })));
      expect(html).toContain(esc(t(l, 'connect.meta.choose.noInstagram')));
      expect(html).toContain('Bolt &lt;Tools&gt;');
      expect(html).toContain('action="/app/connect/meta/choose"');
      expect(html).toContain('name="page_id" value="1020000000001"');
      expect(html).toContain('name="state" value="STATE.sig"');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('access_token');
    }
  });
});
