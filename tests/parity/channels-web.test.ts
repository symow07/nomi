import { describe, it, expect } from 'vitest';
import { renderChannels, renderConnectGuide, type ChannelsData } from '../../src/api/web/channels.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import type { Viewer } from '../../src/core/conversation/people.js';
import { readFileSync } from 'node:fs';
import { renderMetaPanel, renderReach } from '../../src/api/web/channels.js';
import { renderAccounts, type AccountsView } from '../../src/api/web/connect.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';

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
    expect(en).toContain('<span class="pill ok">Connected</span>');   // the ✓ is the pill's own (phase 4)
    expect(en).toContain('+86 579****0001');       // MASKED — never a secret
    expect(en).toContain('Today');                 // localized relative time
    expect(en).toContain('Health');
    expect(en).toContain('action="/app/channels/whatsapp/test"');
    expect(en).toContain('action="/app/channels/whatsapp/disconnect"');

    const zh = renderChannels(connected, 'zh', null);
    expect(zh).toContain('<span class="pill ok">已连接</span>'); expect(zh).toContain('今天');
    const ar = renderChannels(connected, 'ar', null);
    expect(ar).toContain('<span class="pill ok">متصل</span>'); expect(ar).toContain('اليوم');
  });

  it('not connected: description + connect entry, no fake credential form', () => {
    const html = renderChannels(notConnected, 'en', null);
    expect(html).toContain('Connect the WhatsApp number your customers write to.');
    // Phase 9 (new-17) — connecting is the page's main act: its one filled button.
    expect(html).toContain('<form method="get" action="/app/channels/whatsapp/connect" class="inline"><button class="btn send" type="submit">Connect WhatsApp</button></form>');
    expect(html).not.toContain('action="/app/channels/whatsapp/reconnect"'); // never-set-up ≠ reconnect
    expect(html).not.toContain('type="password"');
  });

  it('needs attention: three-part problem localized', () => {
    expect(renderChannels(needsAttention, 'zh', null)).toContain('WhatsApp 需要重新登录');
    const en = renderChannels(needsAttention, 'en', null);
    expect(en).toContain('WhatsApp needs to sign in again');
    expect(en).toContain(t('en', 'channel.problem.needs_relogin.doing'));
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
    expect(en).toContain('<h2>Alerts</h2>');
    expect(en).toContain('action="/app/settings/owner-phone"');
    expect(en).toContain('+8613800000000');                 // current value shown
    const none = renderChannels(notConnected, 'en', null);
    expect(none).toContain('Not set');                        // honest empty state
    expect(renderChannels(connected, 'zh', null)).toContain('<h2>提醒</h2>');
    expect(renderChannels(connected, 'ar', null)).toContain('<h2>التنبيهات</h2>');
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
    expect(html).toContain('action="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });

  it('connected by herself: named, and hers to disconnect — no second Connect', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start', connectedAs: 'Nomi does · @nomidoes_' });
    expect(html).toContain('Nomi does · @nomidoes_');
    expect(html).toContain('action="/app/connect/meta/disconnect"');
    expect(html).not.toContain('action="/app/connect/meta/start"');
  });

  it('a token Meta refused says so and offers the login, not Disconnect', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start', connectedAs: 'Nomi does', needsAttention: true });
    expect(html).toContain('action="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });

  it('not connected: the login when offered, the host\'s account form only when it is not', () => {
    const login = render({ configured: true, connected: false, connectHref: '/app/connect/meta/start' });
    expect(login).toContain('action="/app/connect/meta/start"');
    expect(login).not.toContain('action="/app/channels/messenger/connect"');
    const host = render({ configured: true, connected: false });
    expect(host).toContain('action="/app/channels/messenger/connect"');
    expect(host).not.toContain('/app/connect/meta/start');
  });

  it('staff see the state and no button either way', () => {
    const html = render({ configured: true, connected: true, connectHref: '/app/connect/meta/start' }, { id: 'p2', isOwner: false });
    expect(html).not.toContain('action="/app/connect/meta/start"');
    expect(html).not.toContain('action="/app/connect/meta/disconnect"');
  });
});

describe('Phase 9 · the Connect WhatsApp page has the thing its first step asks for (V1-450, V1-451)', () => {
  const STAFF: Viewer = { id: 'p2', isOwner: false };
  it('with a mailer: a number field and one button, in every locale; no Test or switch it does not have', () => {
    for (const l of LOCALES) {
      const html = renderConnectGuide(l, { canAsk: true });
      expect(html, l).toContain('action="/app/channels/whatsapp/ask"');
      expect(html, l).toMatch(/<input name="number" type="tel"/);
      expect(html, l).toContain(t(l, 'channel.connect.send'));
      expect(html, l).not.toContain('action="/app/channels/whatsapp/test"');
      expect((html.match(/<button/g) ?? []).length, l).toBe(1);
    }
    expect(renderConnectGuide('en', { canAsk: true })).not.toMatch(/on\/off|this page, managed by you/);
  });
  it('sent back: what was typed stays, the field is marked and says why', () => {
    const html = renderConnectGuide('en', { canAsk: true, kept: '12ab', invalid: true });
    expect(html).toContain('value="12ab"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(t('en', 'channel.connect.error.number'));
  });
  it('without a mailer: the address to write to; without that, plainly not open yet', () => {
    const mail = renderConnectGuide('en', { canAsk: false, contact: 'hello@nomi.test' });
    expect(mail).toContain('href="mailto:hello@nomi.test"');
    expect(mail).not.toContain('<form');
    const none = renderConnectGuide('ar', { canAsk: false, contact: null });
    expect(none).toContain(t('ar', 'channel.connect.unavailable'));
  });
  it('staff are told the owner decides, and get no form', () => {
    const html = renderConnectGuide('en', { canAsk: true, viewer: STAFF });
    expect(html).not.toContain('<form');
    expect(html).toContain(t('en', 'staff.ownerDecides'));
  });
});

/* ── Phase 9 · B5 — Where customers reach you, Connect WhatsApp ─────────── */

describe('Phase 9 · B5 · Where customers reach you', () => {
  const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
  const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');
  const accounts: AccountsView = { mail: null, connectable: { google: false, microsoft: false }, sendingDomain: null, smtpFrom: null, apollo: { kind: 'none' } };
  const scope = { name: null, several: false, outreach: true, setup: null };
  const page = (l: (typeof LOCALES)[number], d: ChannelsData = notConnected) => withWorkspace(scope, () =>
    renderChannels(d, l, null, undefined, renderAccounts(accounts, l), new Map(), '', { state: 'reviewing' }));

  it('V1-434 · new-16 · Apollo is not one of the owner’s accounts here', () => {
    for (const l of LOCALES) expect(page(l), l).not.toContain('Apollo');
  });

  it('V1-435 · V1-438 · new-16 · the Meta block is about the owner’s customers, under the two channels’ name, with no amber and no h3', () => {
    for (const l of LOCALES) {
      const panel = renderMetaPanel({ state: 'reviewing' }, l);
      expect(panel, l).toContain(`<h2>${esc(t(l, 'meta.panel.title'))}</h2>`);
      expect(visible(panel), l).not.toMatch(/\bNomi\b/);
      expect(panel, l).not.toContain('dot warn');
      expect(panel, l).not.toContain('<h3');
      expect(panel, l).toContain('href="/app/help/meta"');
    }
    expect(t('en', 'meta.panel.title')).toBe('Instagram and Messenger');
  });

  it('V1-437 · each requirement not met says what it takes and where', () => {
    for (const l of LOCALES) {
      const html = page(l);
      for (const r of ['verified_sending_domain', 'approved_template', 'business_verification', 'privacy_policy_url'] as const) {
        expect(html, `${l} ${r}`).toContain(`<span class="req-how">${esc(t(l, `reach.req.${r}.how`))}</span>`);
      }
    }
  });

  it('missed-15 · missed-20 · an account that cannot be connected here is named once, plainly; no developer status, no outreach rule as its state', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).not.toContain(esc(t(l, 'connect.mail.notHere')));
      const accountsBlock = html.slice(html.indexOf('id="accounts"'), html.indexOf('</div>', html.indexOf('id="accounts"') + 30) + 6);
      expect(accountsBlock, l).not.toContain(esc(t(l, 'reach.cold.never')));
      expect(accountsBlock, l).toContain(esc(t(l, 'connect.unavailable').split('{list}')[0]!));
      // and the lede no longer promises e-mail that cannot be connected here
      expect(accountsBlock, l).not.toContain(esc(t(l, 'connect.intro.mail')));
    }
  });

  it('V1-436 · while the list is not done, the switch says what pressing it does now', () => {
    for (const l of LOCALES) expect(page(l), l).toContain(esc(t(l, 'outreach.notYet')));
  });

  it('V1-439 · V1-453 · one name for the page: the guide’s tab, its back link and its steps say it', () => {
    for (const l of LOCALES) {
      const guide = renderConnectGuide(l);
      expect(guide, l).toContain(`<span class="go" aria-hidden="true">‹</span>${esc(t(l, 'nav.channels'))}</a>`);
      expect(guide, l).toContain(esc(t(l, 'nav.channels')));
    }
    expect(app).toContain("title: t(locale, 'channel.connect.title'), bodyHtml: guide(s, locale, { flash: takeFlash(req, reply) })");
    expect(t('en', 'channel.connect.step3', { page: t('en', 'nav.channels') })).not.toContain('Channels page');
  });

  it('V1-440 · V1-454 · nothing here says "you decide what goes out": the levels decide; sentences end', () => {
    for (const l of LOCALES) {
      for (const k of ['channel.whatsapp.desc', 'channel.whatsapp.desc.none', 'channel.connect.intro'] as const) {
        expect(t(l, k), `${l} ${k}`).toMatch(/[.。]$/);
      }
    }
    expect(t('en', 'channel.whatsapp.desc') + t('en', 'channel.connect.intro')).not.toMatch(/you decide what goes out/);
    expect(t('ar', 'channel.whatsapp.desc')).not.toContain('لا تُرسَل إلا بقرار منك');
    expect(page('en', connected)).toContain(esc(t('en', 'channel.whatsapp.desc')));
    expect(page('en')).toContain(esc(t('en', 'channel.whatsapp.desc.none')));
  });

  it('V1-441 · V1-447 · one pill for "not yet", visible on any ground; one column; requirement words beside their pill', () => {
    expect(page('en')).toContain('<span class="pill stop">Not connected</span>');
    expect(css).toMatch(/\.pill\.stop \{[^}]*border:1px solid var\(--color-border\)/);
    expect(css).toMatch(/\.card\.ch, \.card\.reach \{ max-width:var\(--measure-prose\); \}/);
    expect(css).toMatch(/\.reach \.reqs li \{ display:flex; align-items:baseline;/);
  });

  it('V1-442 · Instagram’s and Messenger’s 24 hours are said once; the two pages say the same about media', () => {
    const html = page('en');
    expect(html.split(esc(t('en', 'reach.window', { hours: '24' }))).length - 1).toBe(1);   // WhatsApp's own
    const help = readFileSync(new URL('../../src/api/web/help.ts', import.meta.url), 'utf8');
    expect(help).toContain("t(locale, 'meta.rules.media', { name })");
    expect(help).not.toContain('help.meta.rules.media');
  });

  it('V1-443 · missed-18 · V1-449 · what is coming is a sentence, in the reader’s words; no ask with nowhere to answer', () => {
    for (const l of LOCALES) expect(page(l), l).not.toContain('soon-chip');
    expect(page('zh')).toContain('微信');
    expect(page('zh')).not.toContain('WeChat');
    for (const l of LOCALES) expect(t(l, 'channel.soon.note'), l).toContain('{list}');
    expect(t('en', 'channel.soon.note')).not.toMatch(/prioriti[sz]e|Tell us/);
  });

  it('V1-444 · missed-19 · the alerts section names both ways, without internal words', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(`<div class="block" id="alerts">\n    <h2>${esc(t(l, 'settings.alerts.title'))}</h2>`);
      expect(html, l).toContain(`href="/app/settings/alerts">${esc(t(l, 'meta.phoneAlerts'))}`);
    }
    expect(t('en', 'settings.alerts.desc')).not.toMatch(/handoff|signal/);
    expect(t('zh', 'settings.alerts.desc')).not.toContain('接手');
    expect(t('ar', 'settings.alerts.desc')).not.toContain('تحويل');
    expect(t('es', 'settings.alerts.desc')).not.toContain('traspaso');
  });

  it('V1-445 · V1-446 · one spelling, and in Arabic one script and one verb', () => {
    expect(t('en', 'reach.channel.email')).toBe('E-mail');
    const ar = page('ar');
    expect(ar).toContain('<span class="ch-name">واتساب</span>');
    expect(ar).not.toContain('📱');
    expect(visible(ar)).not.toContain('WhatsApp');
    expect(withWorkspace(scope, () => renderChannels(notConnected, 'ar', null, { id: 'p2', isOwner: false }))).toContain('>ربط<');
    expect(t('ar', 'meta.panel.reviewing')).not.toContain('تراجع Meta طلب');
    expect(t('ar', 'meta.rules.first')).not.toContain('لـ Nomi');
  });

  it('new-17 · the page’s one filled button is Connect WhatsApp', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html.split('class="btn send"').length - 1, l).toBe(1);
      expect(html, l).toContain(`<button class="btn send" type="submit">${esc(t(l, 'channel.connect.title'))}</button>`);
    }
  });

  it('V1-448 · the domain example is not English in Chinese and Arabic', () => {
    expect(t('zh', 'domain.field.placeholder')).not.toBe('yourbusiness.com');
    expect(t('ar', 'domain.field.placeholder')).not.toBe('yourbusiness.com');
  });

  it('V1-403 · no picture stands for WhatsApp', () => {
    for (const l of LOCALES) expect(page(l), l).not.toContain('📱');
  });
});

describe('Phase 9 · B5 · Connect WhatsApp', () => {
  const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
  it('V1-452 · missed-21 · the steps are numbered; the lede sits where every page’s lede sits', () => {
    for (const l of LOCALES) {
      const html = renderConnectGuide(l, { canAsk: true });
      expect(html, l).toContain('<ol class="wa-steps">');
      expect(html, l).not.toContain('<ol class="guide">');
      expect(html.indexOf('<p class="lede">'), l).toBeLessThan(html.indexOf('<div class="block">'));
      // the back link sits above the heading, like every other page's
      expect(html.indexOf('class="back"'), l).toBeLessThan(html.indexOf('<h1'));
    }
    expect(css).toMatch(/\.wa-steps \{ list-style:decimal;/);
  });

  it('V1-455 · "we" is Nomi’s team, named', () => {
    for (const l of LOCALES) {
      const text = renderConnectGuide(l, { canAsk: true });
      expect(text, l).toContain('Nomi');
    }
    expect(renderConnectGuide('en', { canAsk: true })).not.toMatch(/We help/);
  });
});
