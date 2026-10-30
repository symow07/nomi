import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { SERVICE_WORKER, appManifest, INSTALL_LINKS } from '../../src/api/web/phone.js';
import { APP_ICONS, FAVICON_ICO } from '../../src/api/web/appIcons.js';
import { renderPhoneAlerts } from '../../src/api/web/phoneAlerts.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';

/**
 * G5b — what a phone needs to hold Nomi, the page that turns alerts on, a
 * reply that waited past its channel's day, and a refusal that names the
 * conversation's own channel. Over Postgres: tests/integration/phone-alerts.test.ts.
 */

const NOW = new Date('2026-10-01T10:00:00Z');
const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'c-1', buyer: 'Noor', country: 'AE', status: 'awaiting',
  product: { name: 'Silk scarf', nameZh: null }, quantity: null, quote: null, order: null,
  messages: [{ direction: 'inbound', text: 'Do you ship to Dubai?', at: NOW }],
  pendingDraft: null, ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null }, channel: 'instagram',
  ...over,
});

describe('G5b · the phone\'s worker', () => {
  it('parses, shows the alert it is sent, and opens only an address of this app', () => {
    expect(() => new vm.Script(SERVICE_WORKER)).not.toThrow();
    expect(SERVICE_WORKER).toContain("addEventListener('push'");
    expect(SERVICE_WORKER).toContain('showNotification(');
    expect(SERVICE_WORKER).toContain("addEventListener('notificationclick'");
    expect(SERVICE_WORKER).toMatch(/to\.charAt\(0\) !== '\/' && to\.indexOf\(here \+ '\/'\) !== 0\) to = '\/app'/);
    for (const never of ['innerHTML', 'eval(', 'new Function', 'importScripts', 'fetch(']) expect(SERVICE_WORKER, never).not.toContain(never);
  });
  it('a tap on an alert whose address is another site\'s opens the app instead', async () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const opened: string[] = [];
    let waited: Promise<unknown> = Promise.resolve();
    const self = {
      location: { origin: 'https://app.nomidoes.com' },
      addEventListener: (n: string, f: (e: unknown) => void) => { handlers[n] = f; },
      registration: { showNotification: async () => undefined },
      clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
    };
    vm.runInNewContext(SERVICE_WORKER, { self, Promise, String });
    const tap = (url: string) => handlers['notificationclick']!({
      notification: { close: () => undefined, data: { url } }, waitUntil: (p: Promise<unknown>) => { waited = p; },
    });
    tap('https://evil.example/phish'); await waited;
    tap('https://app.nomidoes.com/app/inbox/x#latest'); await waited;
    expect(opened).toEqual(['/app', 'https://app.nomidoes.com/app/inbox/x#latest']);
  });
});

describe('G5b · installable', () => {
  it('the manifest opens the app on its own, with the icons and the brand\'s colours', () => {
    const m = JSON.parse(appManifest());
    // The identity system (2026-10-04) — the brand and the paper the app is drawn with, wherever they move to.
    expect(m).toMatchObject({ name: 'Nomi', start_url: '/app', display: 'standalone', theme_color: DESIGN_TOKENS.color.brand, background_color: DESIGN_TOKENS.color.paper });
    // The seal (2026-10-31): two icons for any shape, and a maskable one with the seal inside the launcher's safe circle.
    expect(m.icons.map((i: { src: string; purpose: string }) => `${i.src} ${i.purpose}`)).toEqual([
      '/assets/icon-192.png any', '/assets/icon-512.png any', '/assets/icon-maskable-512.png maskable',
    ]);
    expect(INSTALL_LINKS).toBe('<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">');
  });
  it('the icons are PNGs of their stated size, the iPhone\'s at its own 180', () => {
    const SIZE = { '192': 192, '512': 512, 'maskable-512': 512, 'apple-touch': 180 } as const;
    expect(Object.keys(APP_ICONS).sort()).toEqual(Object.keys(SIZE).sort());
    for (const [key, png] of Object.entries(APP_ICONS)) {
      expect(png.subarray(1, 4).toString(), key).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], key).toEqual([SIZE[key as keyof typeof SIZE], SIZE[key as keyof typeof SIZE]]);
    }
  });
  it('/favicon.ico holds the coin at 16, 32 and 48, each a PNG', () => {
    expect([FAVICON_ICO.readUInt16LE(2), FAVICON_ICO.readUInt16LE(4)]).toEqual([1, 3]);   // an icon, three entries
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const at = 6 + 16 * i;
      sizes.push(FAVICON_ICO.readUInt8(at));
      const png = FAVICON_ICO.subarray(FAVICON_ICO.readUInt32LE(at + 12));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(FAVICON_ICO.readUInt8(at));
    }
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe('G5b · the page, in every language', () => {
  for (const locale of LOCALES) {
    const l = locale as Locale;
    it(`${l} · with the installation's key: the button (shown by the script), what a phone cannot, and the phones`, () => {
      const html = renderPhoneAlerts({
        publicKey: 'BKEY', phones: [{ id: '11111111-1111-4111-8111-111111111111', personId: null, endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a', device: 'iPhone', createdAt: NOW }],
      }, l, null);
      expect(html, l).not.toMatch(/\balerts\.[a-zA-Z_.]+/);
      expect(html, l).toMatch(/<button class="btn send" type="button" hidden data-push-key="BKEY" data-push-save="\/app\/settings\/alerts\/phone">/);
      expect(html, l).toContain('data-push-cannot');
      expect(html, l).toContain('action="/app/settings/alerts/phone/11111111-1111-4111-8111-111111111111/remove"');
      expect(html, l).toContain('action="/app/settings/alerts/test"');
    });
    it(`${l} · without it: says so, and offers no button`, () => {
      const html = renderPhoneAlerts({ publicKey: null, phones: [] }, l, null);
      // Phase 9 of the warmth run (w4-settings-a-08) — the way's own line says it ("Not available here yet");
      // no section repeats it, no promise, no empty list of phones.
      expect(html, l).not.toContain('id="alerts-phones"');
      expect(html, l).not.toContain(esc(t(l, 'alerts.phone.lede')));
      expect(html, l).not.toContain('data-push-key');
    });
  }
});

describe('G5b · the channel\'s own day', () => {
  it('a refusal names the conversation\'s channel, not WhatsApp on every channel', () => {
    const html = renderConversationDetail(detail({
      refusals: [{ outboundId: 'o-1', conversationId: 'c-1', buyer: 'Noor', reason: 'window_closed', at: NOW, origin: 'employee' }],
    }), 'en', NOW, null);
    expect(html).toContain('Instagram no longer allows a reply to this customer.');
    expect(html).toContain('Write to this customer in the Instagram app yourself.');
    expect(html).not.toContain('WhatsApp no longer allows');
  });
  for (const locale of LOCALES) {
    it(`${locale} · a reply that waited past the day: shown for what it was, never offered to send`, () => {
      const l = locale as Locale;
      const html = renderConversationDetail(detail({ expiredDraft: { text: 'Yes, we ship to Dubai.' } }), l, NOW, null);
      expect(html, l).toContain(esc(t(l, 'expired.title')));
      expect(html, l).toContain('Yes, we ship to Dubai.');
      expect(html, l).toContain(esc(t(l, 'expired.why', { channel: t(l, 'conv.channel.instagram') })));
      expect(html, l).not.toMatch(/\{channel\}|\{name\}/);
    });
  }
  it('a waiting reply wins over an expired one', () => {
    const html = renderConversationDetail(detail({
      expiredDraft: { text: 'old words' },
      pendingDraft: { draftId: 'd-1', draftText: 'new words', capability: 'qualify' },
    }), 'en', NOW, null);
    expect(html).not.toContain(esc(t('en', 'expired.title')));
  });
});
