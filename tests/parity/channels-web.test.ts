import { describe, it, expect } from 'vitest';
import { renderChannels, renderConnectGuide, type ChannelsData } from '../../src/api/web/channels.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import type { Viewer } from '../../src/core/conversation/people.js';

const connected: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', connected: true, status: 'connected', healthOk: true,
    displayId: '+86 579****0001', lastActivityAt: new Date(), problem: null, activated: false,
  },
  ownerPhone: '+8613800000000', templateState: 'none', outreach: new Map(), domain: null,
};

const notConnected: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false,
    displayId: null, lastActivityAt: null, problem: null, activated: false,
  },
  ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null,
};

const needsAttention: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', connected: false, status: 'needs_attention', healthOk: false,
    displayId: '+86 579****0001', lastActivityAt: null, problem: 'needs_relogin', activated: false,
  },
  ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null,
};

describe('M9.4 · channel center (localized)', () => {
  it('connected: status, masked number, activity, health, manage actions — per locale', () => {
    const en = renderChannels(connected, 'en', null);
    expect(en).toContain('WhatsApp');
    expect(en).toContain('Connected ✓');
    expect(en).toContain('+86 579****0001');       // MASKED — never a secret
    expect(en).toContain('Today');                 // localized relative time
    expect(en).toContain('Health');
    expect(en).toContain('action="/app/channels/whatsapp/test"');
    expect(en).toContain('action="/app/channels/whatsapp/disconnect"');

    const zh = renderChannels(connected, 'zh', null);
    expect(zh).toContain('已连接 ✓'); expect(zh).toContain('今天');
    const ar = renderChannels(connected, 'ar', null);
    expect(ar).toContain('متصل ✓'); expect(ar).toContain('اليوم');
  });

  it('not connected: description + connect entry, no fake credential form', () => {
    const html = renderChannels(notConnected, 'en', null);
    expect(html).toContain('Buyers message this number');
    expect(html).toContain('href="/app/channels/whatsapp/connect"');
    expect(html).not.toContain('action="/app/channels/whatsapp/reconnect"'); // never-set-up ≠ reconnect
    expect(html).not.toContain('type="password"');
  });

  it('needs attention: three-part problem localized', () => {
    expect(renderChannels(needsAttention, 'zh', null)).toContain('WhatsApp 需要重新登录');
    const en = renderChannels(needsAttention, 'en', null);
    expect(en).toContain('WhatsApp needs to sign in again');
    expect(en).toContain('Lily cannot receive messages');
    const ar = renderChannels(needsAttention, 'ar', null);
    expect(ar).toContain('يحتاج واتساب لتسجيل الدخول');
  });

  it('coming-soon channels shown honestly, never as connected', () => {
    const en = renderChannels(connected, 'en', null);
    expect(en).toContain('Coming soon');
    for (const c of ['Instagram', 'Messenger', 'Telegram', 'WeCom', 'RED']) expect(en).toContain(c);
    expect(en).not.toMatch(/Instagram[^<]*Connected/);
    expect(renderChannels(connected, 'zh', null)).toContain('企业微信'); // WeCom localized in zh
  });

  it('owner alert-number card: localized, shows current number, posts to the settings action', () => {
    const en = renderChannels(connected, 'en', null);
    expect(en).toContain('Alert number');
    expect(en).toContain('action="/app/settings/owner-phone"');
    expect(en).toContain('+8613800000000');                 // current value shown
    const none = renderChannels(notConnected, 'en', null);
    expect(none).toContain('Not set');                        // honest empty state
    expect(renderChannels(connected, 'zh', null)).toContain('通知号码');
    expect(renderChannels(connected, 'ar', null)).toContain('رقم التنبيهات');
  });

  it('flash renders after an action', () => {
    expect(renderChannels(connected, 'en', { text: 'Disconnected. Lily…', bad: false })).toContain('Disconnected. Lily…');
  });

  it('connect guide localized, no secrets/technical setup', () => {
    const en = renderConnectGuide('en');
    expect(en).toContain('Connect WhatsApp');
    expect(en).toContain('WhatsApp number');
    expect(en).not.toContain('token'); expect(en).not.toContain('app secret');
    expect(renderConnectGuide('ar')).toContain('ربط واتساب');
  });

  it('RTL: connected page mirrors for ar (dir handled by shell; body uses logical CSS)', () => {
    const ar = renderChannels(connected, 'ar', null);
    expect(ar).not.toContain('padding-left');   // logical props only in this module
    expect(ar).not.toContain('<table');
  });
});

describe('M9.4 · security + language (every locale)', () => {
  it('no technical / AI vocabulary or secret-shaped content', () => {
    for (const l of LOCALES) {
      const all = (renderChannels(connected, l, null) + renderChannels(needsAttention, l, null) + renderConnectGuide(l)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'api', 'token', 'webhook', 'app secret', 'phone number id',
        'access_token', 'meta', '360dialog', 'database', '模型', '人工智能', 'sk-', 'bearer']) {
        const hit = /^[a-z_ -]+$/.test(banned) ? new RegExp(`\\b${banned.replace(/-/g, '\\-')}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('mobile-first: no tables', () => {
    expect(renderChannels(connected, 'en', null)).not.toContain('<table');
  });
});

/**
 * C10 — the Page and Instagram cards, in each state the page can be in. What
 * this pins: the login is offered wherever it can change something, including
 * over a connection the HOST's account made (the day it shipped, the owner's
 * own page showed "Connected." and no button, and read as "nothing changed");
 * a Page she connected herself is named and is hers to disconnect; a token
 * Meta refused says so and offers the login; the C9 form posts only when no
 * login is offered.
 */
describe('C10 · connect your own Page and Instagram, as the cards show it', () => {
  const OWNER: Viewer = { id: 'owner', isOwner: true };
  const links = (l: { configured: boolean; connected: boolean; connectHref?: string; connectedAs?: string; needsAttention?: boolean; noInstagram?: boolean }) =>
    new Map([['instagram', l], ['messenger', l]] as const);
  const render = (l: Parameters<typeof links>[0], viewer: Viewer = OWNER) =>
    renderChannels(connected, 'en', null, viewer, '', links(l));

  it('connected through the host\'s account, with a login offered: the login button is still there', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start' });
    expect(html).toContain('href="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });

  it('connected by herself: named, and hers to disconnect — no second Connect', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start', connectedAs: 'Nomi does · @nomidoes_' });
    expect(html).toContain('Nomi does · @nomidoes_');
    expect(html).toContain('action="/app/connect/meta/disconnect"');
    expect(html).not.toContain('href="/app/connect/meta/start"');
  });

  it('a token Meta refused says so and offers the login, not Disconnect', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start', connectedAs: 'Nomi does', needsAttention: true });
    expect(html).toContain('href="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });

  it('not connected: the login when offered, the host\'s account form only when it is not', () => {
    const login = render({ configured: true, connected: false, connectHref: '/app/connect/meta/start' });
    expect(login).toContain('href="/app/connect/meta/start"');
    expect(login).not.toContain('action="/app/channels/messenger/connect"');
    const host = render({ configured: true, connected: false });
    expect(host).toContain('action="/app/channels/messenger/connect"');
    expect(host).not.toContain('/app/connect/meta/start');
  });

  it('staff see the state and no button either way', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start' }, { id: 'p2', isOwner: false });
    expect(html).not.toContain('href="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });
});
