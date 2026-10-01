import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  waLoginFrom, waDialogUrl, exchangeWaCode, sharedWabas, wabaNumbers, subscribeWaba, registerNumber, newPin,
} from '../../src/channels/whatsapp/embeddedSignup.js';
import { renderChannels, type ChannelsData } from '../../src/api/web/channels.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * WA (0120) — Embedded Signup's calls, against a fake that answers the way
 * Meta's documentation says it does, and the WhatsApp card's own-number
 * states. Nothing here reaches Meta (the never-run list).
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const LOGIN = { appId: '1092000000001', appSecret: 's3cret', configId: '1093000000001' };
type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
const fake = (answer: (c: Call) => { status: number; body: unknown }) => {
  const calls: Call[] = [];
  const f = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const c = { method: init.method, url, headers: init.headers, ...(init.body ? { body: init.body } : {}) };
    calls.push(c);
    const a = answer(c);
    return { status: a.status, text: async () => JSON.stringify(a.body) };
  };
  return { f, calls };
};

describe('WA · the login', () => {
  it('all three or nothing; ids are digits', () => {
    expect(waLoginFrom({ META_WHATSAPP_APP_ID: '1092000000001', META_WHATSAPP_ES_CONFIG_ID: '1093000000001' }, 's')).toEqual({ appId: '1092000000001', appSecret: 's', configId: '1093000000001' });
    expect(waLoginFrom({ META_WHATSAPP_APP_ID: '1092000000001' }, 's')).toBeNull();
    expect(waLoginFrom({ META_WHATSAPP_APP_ID: '1092000000001', META_WHATSAPP_ES_CONFIG_ID: '1093000000001' }, undefined)).toBeNull();
    expect(waLoginFrom({ META_WHATSAPP_APP_ID: 'abc', META_WHATSAPP_ES_CONFIG_ID: '1093000000001' }, 's')).toBeNull();
  });
  it('the dialog opens Embedded Signup: the configuration, a code back, session info version 3', () => {
    const u = new URL(waDialogUrl(LOGIN, { redirectUri: 'https://app.test/app/connect/whatsapp/callback', state: 'n0nce', graphVersion: 'v23.0' }));
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v23.0/dialog/oauth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: LOGIN.appId, config_id: LOGIN.configId, response_type: 'code', state: 'n0nce', override_default_response_type: 'true' });
    expect(JSON.parse(u.searchParams.get('extras')!)).toEqual({ setup: {}, featureType: '', sessionInfoVersion: '3' });
  });
});

describe('WA · Meta, over the wire', () => {
  it('the code → the business token; a refusal and a silence are reasons, never throws', async () => {
    const ok = fake(() => ({ status: 200, body: { access_token: 'tok' } }));
    expect(await exchangeWaCode(LOGIN, { code: 'c', redirectUri: 'https://r', graphVersion: 'v23.0' }, ok.f)).toEqual({ ok: true, token: 'tok' });
    expect(new URL(ok.calls[0]!.url).searchParams.get('client_secret')).toBe('s3cret');
    expect(await exchangeWaCode(LOGIN, { code: 'c', redirectUri: 'https://r', graphVersion: 'v23.0' }, fake(() => ({ status: 400, body: {} })).f)).toEqual({ ok: false, reason: 'rejected' });
    expect(await exchangeWaCode(LOGIN, { code: 'c', redirectUri: 'https://r', graphVersion: 'v23.0' }, async () => { throw new Error('down'); })).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('the shared account: debug_token\'s management scope, asked with the app\'s own token; only ids', async () => {
    const f = fake(() => ({ status: 200, body: { data: { granular_scopes: [
      { scope: 'whatsapp_business_messaging', target_ids: ['111111'] },
      { scope: 'whatsapp_business_management', target_ids: ['222222', '222222', '../x'] }] } } }));
    expect(await sharedWabas(LOGIN, { token: 'tok', graphVersion: 'v23.0' }, f.f)).toEqual(['222222']);
    const q = new URL(f.calls[0]!.url).searchParams;
    expect(q.get('input_token')).toBe('tok');
    expect(q.get('access_token')).toBe(`${LOGIN.appId}|s3cret`);
  });
  it('its numbers, with the name and Meta\'s review of it; the subscription; the registration with a six-digit PIN', async () => {
    const f = fake((c) => c.url.includes('phone_numbers')
      ? { status: 200, body: { data: [{ id: '333333', display_phone_number: '+34 600', verified_name: 'Sol', name_status: 'APPROVED' }, { id: 'bad' }] } }
      : { status: 200, body: { success: true } });
    expect(await wabaNumbers({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0' }, f.f)).toEqual([{ id: '333333', display: '+34 600', verifiedName: 'Sol', nameStatus: 'APPROVED' }]);
    expect(f.calls[0]!.headers['Authorization']).toBe('Bearer tok');
    expect(await subscribeWaba({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0' }, f.f)).toBe(true);
    expect(f.calls[1]).toMatchObject({ method: 'POST', url: 'https://graph.facebook.com/v23.0/222222/subscribed_apps' });
    expect(await registerNumber({ phoneNumberId: '333333', token: 'tok', pin: '012345', graphVersion: 'v23.0' }, f.f)).toBe(true);
    expect(JSON.parse(f.calls[2]!.body!)).toEqual({ messaging_product: 'whatsapp', pin: '012345' });
    expect(await registerNumber({ phoneNumberId: '333333', token: 'tok', pin: '12', graphVersion: 'v23.0' }, f.f)).toBe(false);
    expect(await subscribeWaba({ wabaId: '../me', token: 'tok', graphVersion: 'v23.0' }, f.f)).toBe(false);
    for (let i = 0; i < 50; i++) expect(newPin()).toMatch(/^[0-9]{6}$/);
  });
});

describe('WA · the WhatsApp card', () => {
  const base: ChannelsData = {
    whatsapp: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false, activated: false, displayId: null, lastActivityAt: null, problem: null },
    ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null, canConnect: true,
  } as unknown as ChannelsData;
  it('with Embedded Signup, her own number is offered — never the installation\'s', () => {
    const html = renderChannels({ ...base, waSelfServe: true }, 'en', null);
    expect(html).toContain('href="/app/connect/whatsapp/start"');
    expect(html).not.toContain('action="/app/channels/whatsapp/connect"');
    expect(renderChannels(base, 'en', null)).toContain('action="/app/channels/whatsapp/connect"');
  });
  it('her number, the name customers see and where Meta\'s review stands; a dead token asks to connect again', () => {
    const connected = { ...base.whatsapp, connected: true, status: 'connected' } as ChannelsData['whatsapp'];
    const own = { display: '+34 600 00 00 00', verifiedName: 'Tienda Sol', nameStatus: 'DECLINED', needsAttention: false };
    const html = renderChannels({ ...base, whatsapp: connected, waSelfServe: true, waOwn: own }, 'en', null);
    expect(html).toContain('Tienda Sol');
    expect(html).toContain(esc(t('en', 'channel.wa.nameStatus.DECLINED')));
    expect(html).toContain('action="/app/connect/whatsapp/disconnect"');
    const dead = renderChannels({ ...base, whatsapp: connected, waSelfServe: true, waOwn: { ...own, needsAttention: true } }, 'en', null);
    expect(dead).toContain(esc(t('en', 'channel.wa.needsAttention')));
    expect(dead).toContain('href="/app/connect/whatsapp/start"');
    const odd = renderChannels({ ...base, whatsapp: connected, waOwn: { ...own, nameStatus: 'SOMETHING_NEW' } }, 'en', null);
    expect(odd).toContain(esc(t('en', 'channel.wa.nameStatus.other')));
  });
});

describe('WA · where it is decided', () => {
  it('owner-only on the decision that goes live; the stop and the approval before anything is asked of Meta', () => {
    const app = src('src/api/web/app.ts');
    for (const route of ["app.get('/app/connect/whatsapp/start'", "app.get('/app/connect/whatsapp/callback'", "app.post('/app/connect/whatsapp/choose'"]) {
      const body = app.slice(app.indexOf(route), app.indexOf(route) + 900);
      expect(body, route).toContain("ownerOnly(req, reply, 'messaging_activation', '/app/channels')");
      expect(body, route).toContain('connectionRefusal(s.businessId)');
    }
  });
  it('a business with its own number sends from it; a dead token sends nothing, never the installation\'s number', () => {
    const main = src('src/main.ts');
    expect(main).toContain("if (account.needsAttention) return { whatsapp: undefined };");
    expect(main).toContain('...waAdaptersFor(businessId, waAccount),');
  });
});
