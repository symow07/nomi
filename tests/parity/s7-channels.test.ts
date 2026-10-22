import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderChatPage } from '../../src/api/web/webChat.js';
import { telegramFrom } from '../../src/channels/telegram/adapter.js';
import { CHANNEL_REGISTRY } from '../../src/core/channel/registry.js';
import { channelSendPlan } from '../../src/core/channel/window.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S7 (Phase 5, item 22) — the chat page and Telegram, the pure parts and the wiring: the page arrives complete and
 * reaches nothing but itself; both channels never write first and have no window; the public routes are argued; the
 * owner's switches are the owner's; Telegram needs its three settings and its own signature header. End to end:
 * tests/integration/web-chat.test.ts and telegram.test.ts.
 */
const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

describe('S7 · the chat page', () => {
  it('in every language: the business named, the visitor\'s own lines, a form to this page, and a script that asks only this page', () => {
    for (const l of LOCALES) {
      const html = renderChatPage({ locale: l, key: KEY, business: 'Atlas Bags', mark: '0', now: new Date(),
        lines: [{ id: '1', mine: true, text: 'Do you make <b>bags</b>?', at: new Date() }, { id: '2', mine: false, text: 'Yes.', at: new Date() }] });
      expect(html, l).toContain('Atlas Bags');
      expect(html, l).toContain(`action="/chat/${KEY}"`);
      expect(html, l).toContain('maxlength="2000"');
      expect(html, l).toContain('Do you make &lt;b&gt;bags&lt;/b&gt;?');
      expect(html, l).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, l).toContain(`/chat/${KEY}/mark`);
      expect(html.match(/id="latest"/g)?.length, l).toBe(1);
      // nothing reached anywhere else: no external address in the page at all
      expect(html, l).not.toMatch(/https?:\/\/|src="|<link /);
    }
  });
  it('its three public routes are argued, and nothing else under /chat', () => {
    const chat = PUBLIC_ROUTES.filter((r) => r.url.startsWith('/chat'));
    expect(chat.map((r) => `${r.method} ${r.url}`).sort()).toEqual(['GET /chat/:key', 'GET /chat/:key/mark', 'GET /chat/:key/widget.js', 'POST /chat/:key']);
  });
});

describe('S7 · both channels', () => {
  it('never write first, and have no window: a reply is always free to go', () => {
    for (const c of ['web_chat', 'telegram'] as const) {
      expect(CHANNEL_REGISTRY[c].coldInitiate, c).toBe('never');
      expect(CHANNEL_REGISTRY[c].replyWindowHours, c).toBeNull();
      expect(CHANNEL_REGISTRY[c].deliveryReceipts, c).toBe(false);
      expect(channelSendPlan(c, null, new Date(), 'none').action, c).toBe('send_free');
    }
  });
  it('turning either on is the owner\'s (going live)', () => {
    const app = src('api/web/app.ts');
    for (const path of ['/app/channels/chat', '/app/channels/telegram']) {
      const route = app.slice(app.indexOf(`app.post('${path}'`));
      expect(route.slice(0, 200), path).toContain("ownerOnly(req, reply, 'messaging_activation'");
    }
  });
});

describe('S7 · Telegram', () => {
  it('needs all three settings, each in its shape; anything less is no Telegram here', () => {
    const ok = { TELEGRAM_BOT_TOKEN: '7012345678:AAH-not-a-real-token_xyz', TELEGRAM_WEBHOOK_SECRET: 'a-secret-of-sixteen+', TELEGRAM_BOT_USERNAME: '@NomiBot' };
    expect(telegramFrom({ ...ok, TELEGRAM_WEBHOOK_SECRET: 'a-secret-of-sixteen' })?.username).toBe('NomiBot');
    for (const [k, v] of [['TELEGRAM_BOT_TOKEN', ''], ['TELEGRAM_BOT_TOKEN', 'not-a-token'], ['TELEGRAM_WEBHOOK_SECRET', 'short'],
      ['TELEGRAM_BOT_USERNAME', 'Nomi'], ['TELEGRAM_BOT_USERNAME', '']] as const) {
      expect(telegramFrom({ ...ok, TELEGRAM_WEBHOOK_SECRET: 'a-secret-of-sixteen', [k]: v }), `${k}=${v}`).toBeNull();
    }
  });
  it('its webhook is checked by its own header, and every update is routed before it is stored', () => {
    const main = src('main.ts');
    expect(main).toContain("{ path: '/webhook/telegram', adapter: telegramBot.adapter, signatureHeader: 'x-telegram-bot-api-secret-token' }");
    expect(main).toContain("route: async (e, channel) => (channel === 'telegram' && e.kind === 'message' ? routeTelegram(e) : e),");
    // and only while the privacy page names Telegram (D18)
    expect(main).toContain("const telegramBot = recipientNamed('telegram') ? telegramFrom(process.env, overrides?.telegramFetch) : null;");
    const ingress = src('api/ingress.ts');
    expect(ingress.indexOf('const event = deps.route ? await deps.route(parsed, adapter.kind) : parsed;'))
      .toBeLessThan(ingress.indexOf('const outcome = await deps.persistEvent(event, payload, adapter.kind);'));
  });
});
