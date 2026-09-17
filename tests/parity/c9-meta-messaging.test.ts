import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseMetaMessaging, metaMessagingSender, metaProfileLookup, socialAppSecret, WEBHOOK_OBJECT } from '../../src/channels/meta/messaging.js';
import { instagramAdapter } from '../../src/channels/instagram/adapter.js';
import { messengerAdapter } from '../../src/channels/messenger/adapter.js';
import { CHANNEL_REGISTRY, mayInitiate } from '../../src/core/channel/registry.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { channelSendPlan } from '../../src/core/channel/window.js';

/**
 * C9 — Instagram and Messenger: she answers, she never starts.
 *
 * Meta carries both over one API, so the parser and the sender are shared and
 * the adapters are thin. What is on trial here is the pair of claims that make
 * these channels safe to carry at all: a buyer's message reaches the right
 * conversation, and nothing this product can do will send a first message on
 * either — no configuration, no requirement met, no owner switch.
 */

const APP_SECRET = 'meta-app-secret-for-tests';
const sign = (body: string): string =>
  `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`;

const ig = instagramAdapter({
  accountId: '17841400000000000', accessToken: 'page-token', appSecret: APP_SECRET, graphVersion: 'v23.0',
});
const fb = messengerAdapter({
  accountId: '102000000000000', accessToken: 'page-token', appSecret: APP_SECRET, graphVersion: 'v23.0',
});

const envelope = (object: string, o: {
  sender?: string; recipient?: string; mid?: string; text?: string;
  attachments?: unknown[]; echo?: boolean; timestamp?: number;
} = {}) => ({
  object,
  entry: [{
    id: o.recipient ?? '17841400000000000',
    time: 1789600000000,
    messaging: [{
      sender: { id: o.sender ?? 'BUYER_SCOPED_ID' },
      recipient: { id: o.recipient ?? '17841400000000000' },
      timestamp: o.timestamp ?? 1789600000000,
      message: {
        mid: o.mid ?? 'mid.abc123',
        ...(o.text !== undefined ? { text: o.text } : {}),
        ...(o.attachments ? { attachments: o.attachments } : {}),
        ...(o.echo ? { is_echo: true } : {}),
      },
    }],
  }],
});

describe('C9 · a buyer writes, and it lands in the right place', () => {
  it('an Instagram message becomes one canonical event: who wrote, to which account', () => {
    const [event] = parseMetaMessaging('instagram', envelope('instagram', { text: 'price for 500?' }));
    expect(event).toMatchObject({
      kind: 'message', eventId: 'mid.abc123', dedupKey: 'mid.abc123',
      waId: 'BUYER_SCOPED_ID', phoneNumberId: '17841400000000000',
      messageType: 'text', received: 'text', text: 'price for 500?',
    });
    // Meta sends milliseconds; WhatsApp sends seconds. Getting this wrong would
    // date every message to 1970 and the staleness guard would drop them all.
    expect(event!.occurredAt.getTime()).toBe(1789600000000);
  });

  it('THE MAPPING ONTO THE CANONICAL EVENT IS FIXED: account resolves the tenant, sender is the buyer', () => {
    const [event] = parseMetaMessaging('messenger', envelope('page', {
      sender: 'PSID_BUYER', recipient: 'PAGE_ID_OF_FACTORY', text: 'hello',
    }));
    // Inverting these would deliver a buyer's message to a stranger's factory.
    expect(event!.kind).toBe('message');
    expect(event).toMatchObject({ phoneNumberId: 'PAGE_ID_OF_FACTORY', waId: 'PSID_BUYER' });
  });

  it('EACH CHANNEL READS ONLY ITS OWN WEBHOOK OBJECT — one app carries all three', () => {
    expect(WEBHOOK_OBJECT).toEqual({ instagram: 'instagram', messenger: 'page' });
    expect(parseMetaMessaging('instagram', envelope('page', { text: 'hi' }))).toEqual([]);
    expect(parseMetaMessaging('messenger', envelope('instagram', { text: 'hi' }))).toEqual([]);
    // And a WhatsApp payload belongs to neither.
    expect(parseMetaMessaging('instagram', { object: 'whatsapp_business_account', entry: [] })).toEqual([]);
  });

  it('OUR OWN MESSAGE COMING BACK IS NOT A BUYER — an echo would be a loop', () => {
    expect(parseMetaMessaging('instagram', envelope('instagram', { text: 'our reply', echo: true }))).toEqual([]);
  });

  it('what she cannot read is named, not answered as empty text', () => {
    const [story] = parseMetaMessaging('instagram', envelope('instagram', {
      attachments: [{ type: 'story_mention', payload: {} }],
    }));
    expect(story).toMatchObject({ messageType: 'unsupported', received: 'story_mention', text: null });
    const [nothing] = parseMetaMessaging('messenger', envelope('page', {}));
    expect(nothing).toMatchObject({ messageType: 'unsupported', received: 'unsupported' });
  });

  it('a payload with no message, sender or id yields nothing rather than a half event', () => {
    expect(parseMetaMessaging('instagram', { object: 'instagram' })).toEqual([]);
    expect(parseMetaMessaging('instagram', envelope('instagram', { mid: '' }))).toEqual([]);
    expect(parseMetaMessaging('instagram', 'not an object')).toEqual([]);
  });

  it('the webhook is verified with the app secret, like every other Meta payload', () => {
    const body = JSON.stringify(envelope('instagram', { text: 'hi' }));
    expect(ig.verifyWebhook(body, sign(body))).toBe(true);
    expect(ig.verifyWebhook(body, 'sha256=deadbeef')).toBe(false);
    expect(ig.verifyWebhook(body, undefined)).toBe(false);
    expect(fb.verifyWebhook(body, sign(body))).toBe(true);
  });

  it('the adapters name their own channel and share one provider', () => {
    expect([ig.kind, fb.kind]).toEqual(['instagram', 'messenger']);
    expect([ig.provider, fb.provider]).toEqual(['meta', 'meta']);
    // Neither carries a subject or a picture: a reply here is text.
    expect(ig.sendMail).toBeUndefined();
    expect(fb.sendMedia).toBeUndefined();
  });
});

describe('C9 · she answers here, and can never start here', () => {
  it('NO SET OF SATISFIED REQUIREMENTS OPENS A FIRST MESSAGE', () => {
    for (const channel of ['instagram', 'messenger'] as const) {
      const all = new Set(['approved_template', 'business_verification', 'privacy_policy_url',
        'verified_sending_domain'] as const);
      const decision = mayInitiate(channel, all);
      expect(decision.ok, `${channel} would initiate`).toBe(false);
      expect(decision.ok === false && decision.error.kind).toBe('never');
    }
  });

  it('and the gate refuses an uninvited message on both, however the row got there', () => {
    for (const channel of ['instagram', 'messenger'] as const) {
      const refusal = gateOutbound({
        origin: 'outreach', assignedTo: null, paused: false, silenced: false,
        activated: true, pilotMode: false, recipientAllowed: true,
        windowPlan: { action: 'wait_for_buyer', ownerNoteZh: '' },
        outreach: {
          channel, availableHere: true, enabled: true, satisfied: new Set(),
          consent: { evidence: 'owner_attestation', obtainedAt: new Date(), recordedBy: 'Lily' },
          suppression: null, ceilingReached: false,
        },
      });
      expect(refusal.allow, `${channel} allowed a cold message`).toBe(false);
    }
  });

  it('the 24-hour window is the buyer\'s own, and a cold start has no window to be inside', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    const recent = new Date(now.getTime() - 60 * 60_000);
    const old = new Date(now.getTime() - 30 * 60 * 60_000);
    for (const channel of ['instagram', 'messenger'] as const) {
      expect(CHANNEL_REGISTRY[channel].replyWindowHours).toBe(24);
      expect(channelSendPlan(channel, recent, now, 'none').action).toBe('send_free');
      // Outside it, there is no template to fall back on here — unlike WhatsApp.
      expect(channelSendPlan(channel, old, now, 'approved').action).toBe('wait_for_buyer');
      expect(channelSendPlan(channel, null, now, 'approved').action).toBe('wait_for_buyer');
    }
  });

  it('BOTH ARE CARRIED HERE NOW — the registry agrees with the adapters on disk', async () => {
    const { readdir } = await import('node:fs/promises');
    const dirs = (await readdir(new URL('../../src/channels/', import.meta.url), { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name);
    for (const channel of ['instagram', 'messenger'] as const) {
      expect(dirs).toContain(channel);
      expect(CHANNEL_REGISTRY[channel].availableHere).toBe(true);
    }
  });
});

describe('C9 · whose app signs these webhooks', () => {
  it('THEIR OWN APP\'S SECRET when they live apart from WhatsApp', () => {
    // nomi-social signs Instagram and Messenger; nomi-pilot signs WhatsApp.
    // Using one secret for both would 401 every genuine payload.
    expect(socialAppSecret({ META_SOCIAL_APP_SECRET: 'social-secret' }, 'whatsapp-secret')).toBe('social-secret');
  });

  it('and WhatsApp\'s when one app carries all three', () => {
    expect(socialAppSecret({}, 'whatsapp-secret')).toBe('whatsapp-secret');
    expect(socialAppSecret({ META_SOCIAL_APP_SECRET: '   ' }, 'whatsapp-secret')).toBe('whatsapp-secret');
  });

  it('and nothing at all when neither app is configured — no channel is built', () => {
    expect(socialAppSecret({}, undefined)).toBeUndefined();
  });
});

describe('C9 · handing a reply to Meta', () => {
  const sender = (status: number, body: unknown) => metaMessagingSender({
    accountId: '102000000000000', accessToken: 'page-token', graphVersion: 'v23.0',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: init.body ?? "", auth: init.headers['Authorization'] ?? '' });
      return { status, text: async () => JSON.stringify(body) };
    },
  });
  let calls: { url: string; body: string; auth: string }[] = [];

  it('posts to the account it was built for, with the buyer as recipient', async () => {
    calls = [];
    const r = await sender(200, { message_id: 'mid.out.1' })('PSID_BUYER', 'Our price is $0.92.');
    expect(r).toEqual({ ok: true, providerMessageId: 'mid.out.1' });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/102000000000000/messages');
    expect(JSON.parse(calls[0]!.body)).toEqual({
      recipient: { id: 'PSID_BUYER' }, message: { text: 'Our price is $0.92.' },
    });
    expect(calls[0]!.auth).toBe('Bearer page-token');
  });

  it('AN EXPIRED WINDOW IS PERMANENT; a bad minute at Meta is not', async () => {
    calls = [];
    expect(await sender(400, { error: {} })('PSID', 'hi')).toMatchObject({ ok: false, retryable: false });
    expect(await sender(429, {})('PSID', 'hi')).toMatchObject({ ok: false, retryable: true });
    expect(await sender(503, {})('PSID', 'hi')).toMatchObject({ ok: false, retryable: true });
  });

  it('an acceptance with no id is retried, because a reply must be matchable later', async () => {
    calls = [];
    expect(await sender(200, { ok: true })('PSID', 'hi')).toMatchObject({ ok: false, retryable: true });
  });

  it('nothing the provider said comes back as text — only its status', async () => {
    calls = [];
    const r = await sender(403, { error: { message: 'This person is not available: PSID_BUYER' } })('PSID', 'hi');
    expect(r).toEqual({ ok: false, retryable: false, error: 'meta 403' });
  });
});

describe('C9 · his name, asked after the fact', () => {
  type Seen = { url: string; method: string; body: string | undefined; auth: string };
  const lookup = (channel: 'instagram' | 'messenger', status: number, body: unknown, seen: Seen[] = []) =>
    metaProfileLookup({
      channel, accessToken: 'page-token', graphVersion: 'v23.0',
      fetchImpl: async (url, init) => {
        seen.push({ url, method: init.method, body: init.body, auth: init.headers['Authorization'] ?? '' });
        if (status < 0) throw new Error('unreachable');
        return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
      },
    });

  it('Instagram: the profile name, else the handle as @handle; Messenger: first and last', async () => {
    expect(await lookup('instagram', 200, { name: ' Ahmed Al-Farsi ', username: 'ahmed.f' })('IGSID')).toBe('Ahmed Al-Farsi');
    expect(await lookup('instagram', 200, { username: 'kareem_trading' })('IGSID')).toBe('@kareem_trading');
    expect(await lookup('messenger', 200, { first_name: 'Fatima', last_name: 'Zahra' })('PSID')).toBe('Fatima Zahra');
    expect(await lookup('messenger', 200, { first_name: 'Fatima' })('PSID')).toBe('Fatima');
    // Nothing usable is no name, never an empty string she would see as blank.
    expect(await lookup('instagram', 200, { name: '  ' })('IGSID')).toBeNull();
    expect(await lookup('messenger', 200, {})('PSID')).toBeNull();
  });

  it('asks with a GET and no body, the fields Meta names, and the Page token', async () => {
    const seen: Seen[] = [];
    await lookup('instagram', 200, { name: 'x' }, seen)('17841400000000001');
    await lookup('messenger', 200, { first_name: 'x' }, seen)('PSID_1');
    expect(seen[0]).toMatchObject({
      url: 'https://graph.facebook.com/v23.0/17841400000000001?fields=name,username',
      method: 'GET', body: undefined, auth: 'Bearer page-token',
    });
    expect(seen[1]!.url).toBe('https://graph.facebook.com/v23.0/PSID_1?fields=first_name,last_name');
  });

  it('NEVER THROWS — no permission, a bad minute, garbage: all read as no name', async () => {
    expect(await lookup('instagram', 400, { error: { message: 'missing permission' } })('IGSID')).toBeNull();
    expect(await lookup('messenger', 503, {})('PSID')).toBeNull();
    expect(await lookup('instagram', 200, 'not json')('IGSID')).toBeNull();
    expect(await lookup('instagram', -1, {})('IGSID')).toBeNull();
  });

  it('a name is capped where the page would wrap it', async () => {
    expect((await lookup('messenger', 200, { first_name: 'a'.repeat(200) })('PSID'))?.length).toBe(80);
  });

  it('and both adapters offer it, WhatsApp does not need to', () => {
    expect(typeof ig.nameOf).toBe('function');
    expect(typeof fb.nameOf).toBe('function');
  });
});

describe('C9 · an installation with a Page and no number', () => {
  it('MOUNTS THE PAGE WITHOUT WHATSAPP — and nothing stands in for the missing one', async () => {
    // Production went live this way (Meta had not offered the number), and the
    // ingress could only be built around a WhatsApp adapter: with none, there
    // was no webhook at all, and Meta's verification met a 404.
    const { buildIngressApp } = await import('../../src/api/ingress.js');
    const seen: string[] = [];
    const app = buildIngressApp({
      verifyToken: 'vt-social',
      also: [{ path: '/webhook/messenger', adapter: fb }],
      persistEvent: async (e) => { seen.push(e.dedupKey); return 'new'; },
      onNewEvent: async () => {},
      now: () => new Date(1789600000000 + 1000),
    });
    const wa = await app.inject({ method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=vt-social&hub.challenge=c1' });
    expect(wa.statusCode, 'a WhatsApp route with no adapter behind it').toBe(404);

    const handshake = await app.inject({ method: 'GET',
      url: '/webhook/messenger?hub.mode=subscribe&hub.verify_token=vt-social&hub.challenge=c1' });
    expect([handshake.statusCode, handshake.body]).toEqual([200, 'c1']);

    const body = JSON.stringify(envelope('page', { text: 'hi', recipient: '102000000000000' }));
    const r = await app.inject({ method: 'POST', url: '/webhook/messenger', payload: body,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) } });
    expect(JSON.parse(r.body)).toMatchObject({ received: 1 });
    expect(seen).toEqual(['mid.abc123']);
    await app.close();
  });
});
