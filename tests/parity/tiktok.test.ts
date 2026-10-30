import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  exchangeTikTokCode, openTikTokGrant, packTikTokGrant, refreshTikTokGrant, revokeTikTokGrant, sendTikTokText, tiktokAppFrom,
  tiktokAuthorizeUrl, tiktokSignatureValid,
} from '../../src/channels/tiktok/api.js';
import { parseTikTokWebhook, tiktokDelivery, tiktokSendAdapter } from '../../src/channels/tiktok/messaging.js';
import { tiktokMaySend, TIKTOK_INITIAL_MAX, TIKTOK_QUIET_MAX } from '../../src/core/channel/tiktokLimits.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { sendPlan } from '../../src/core/channel/window.js';
import { CHANNEL_REGISTRY } from '../../src/core/channel/registry.js';
import { TIKTOK_APP, tiktokFake, tiktokDelivery as signed, customerSays } from '../channels/tiktok-fake.js';

/**
 * 0215 — TIKTOK DIRECT MESSAGES (docs/TIKTOK-CHANNEL.md, surface A; the owner, 2026-10-26: the direct-message path
 * only). Built against TikTok's documented answers (tests/channels/tiktok-fake.ts); nothing has met TikTok.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NOW = Date.parse('2026-10-26T12:00:00Z');
const h = (hours: number) => new Date(NOW - hours * 3600_000);

describe('0215 · the webhook is TikTok\'s, or nothing', () => {
  const content = customerSays({ conversation: 'conv-1', text: 'Do you ship to Rabat?' });
  it('a delivery signed with the app\'s secret, recent, is accepted; tampered, stale, unsigned or signed by another secret is not', () => {
    const now = Math.floor(NOW / 1000);
    const d = signed(TIKTOK_APP, 'im_receive_msg', 'oid-1', content, now);
    expect(tiktokSignatureValid(d.body, d.signature, TIKTOK_APP.appSecret, now)).toBe(true);
    expect(tiktokSignatureValid(d.body.replace('Rabat', 'Paris'), d.signature, TIKTOK_APP.appSecret, now)).toBe(false);
    expect(tiktokSignatureValid(d.body, d.signature, TIKTOK_APP.appSecret, now + 301)).toBe(false);
    expect(tiktokSignatureValid(d.body, undefined, TIKTOK_APP.appSecret, now)).toBe(false);
    expect(tiktokSignatureValid(d.body, d.signature, 'another-secret-entirely', now)).toBe(false);
    expect(tiktokSignatureValid(d.body, 't=abc,s=zz', TIKTOK_APP.appSecret, now)).toBe(false);
  });
});

describe('0215 · what a delivery becomes', () => {
  const parse = (event: string, c: Record<string, unknown>) => parseTikTokWebhook(JSON.parse(signed(TIKTOK_APP, event, 'oid-1', c).body));
  it('a customer\'s text is a message: the conversation is the handle, the account the tenant, the name the customer\'s own', () => {
    const [e] = parse('im_receive_msg', customerSays({ conversation: 'conv-1', text: 'Do you ship to Rabat?', from: 'amira.shop' }));
    expect(e).toMatchObject({ kind: 'message', waId: 'conv-1', phoneNumberId: 'oid-1', messageType: 'text', received: 'text',
      text: 'Do you ship to Rabat?', profileName: '@amira.shop', mediaId: null });
  });
  it('an image or a shared post is NAMED, never opened; a post\'s link is kept only when it is TikTok\'s own', () => {
    const [img] = parse('im_receive_msg', customerSays({ conversation: 'c', type: 'image' }));
    expect(img).toMatchObject({ kind: 'message', messageType: 'unsupported', received: 'image', text: null, mediaId: null });
    const post = (url: string) => parse('im_receive_msg', { ...customerSays({ conversation: 'c', type: 'share_post' }), share_post: { embed_url: url, video_id: '1' } })[0];
    expect(post('https://www.tiktok.com/@shop/video/1')).toMatchObject({ received: 'share_post', ref: 'https://www.tiktok.com/@shop/video/1' });
    expect(post('https://evil.example/tiktok.com')).toMatchObject({ ref: null });
  });
  it('the account\'s own sends are echoes — from the app, the web or an API — and TikTok\'s automatic messages are dropped', () => {
    for (const source of ['APP', 'WEB', 'API', 'UNKNOWN_SOURCE']) {
      const [e] = parse('im_send_msg', { ...customerSays({ conversation: 'c', text: 'Yes we do' }), message_tag: { source } });
      expect(e, source).toMatchObject({ kind: 'echo', waId: 'c', phoneNumberId: 'oid-1', text: 'Yes we do', appId: null });
      expect(e!.dedupKey, source).toMatch(/^echo:tt:/);
    }
    expect(parse('im_send_msg', { ...customerSays({ conversation: 'c', text: 'Welcome!' }), message_tag: { source: 'OTHERS' } })).toEqual([]);
  });
  it('a message from the EEA, Switzerland or the UK carries nothing to answer: no event, only a count on the account', () => {
    const eu = JSON.parse(signed(TIKTOK_APP, 'im_receive_msg_eu', 'oid-1', { to: 'westlake.canvas', to_user: { id: 'x', role: 'business_account' }, timestamp: NOW }).body);
    expect(parseTikTokWebhook(eu)).toEqual([]);
    expect(tiktokDelivery(eu)).toEqual({ openId: 'oid-1', username: 'westlake.canvas', eu: true });
    expect(tiktokDelivery(JSON.parse(signed(TIKTOK_APP, 'im_send_msg', 'oid-1', customerSays({ conversation: 'c', text: 'x', from: 'westlake.canvas' })).body)))
      .toEqual({ openId: 'oid-1', username: 'westlake.canvas', eu: false });
  });
  it('the read receipt, a referral and anything else are nothing; malformed is nothing, never a throw', () => {
    for (const ev of ['im_mark_read_msg', 'im_referral_msg', 'comment.update']) expect(parse(ev, customerSays({ conversation: 'c', text: 'x' })), ev).toEqual([]);
    expect(parseTikTokWebhook({ event: 'im_receive_msg', user_openid: 'oid', content: '{not json' })).toEqual([]);
    expect(parseTikTokWebhook(null)).toEqual([]);
  });
});

describe('0215 · TikTok\'s limits (a count, not a window), held by the send gate for everyone', () => {
  const base = { firstInboundAt: h(1), lastInboundAt: h(1), repliedToUs: false, sentSinceFirst: 0, sentSinceQuiet: 0 };
  it('never to someone who never wrote', () => {
    expect(tiktokMaySend({ ...base, firstInboundAt: null, lastInboundAt: null }, new Date(NOW))).toEqual({ send: false, why: 'never_wrote' });
  });
  it('after a first message: ten in the 48 hours, then nothing until they write', () => {
    expect(tiktokMaySend({ ...base, sentSinceFirst: TIKTOK_INITIAL_MAX - 1 }, new Date(NOW)).send).toBe(true);
    expect(tiktokMaySend({ ...base, sentSinceFirst: TIKTOK_INITIAL_MAX }, new Date(NOW))).toEqual({ send: false, why: 'initial_used' });
  });
  it('once they reply to the account: any number for the 48 hours after each reply', () => {
    expect(tiktokMaySend({ ...base, repliedToUs: true, sentSinceFirst: 40 }, new Date(NOW)).send).toBe(true);
  });
  it('after 48 hours of silence: three more, then nothing until they write again', () => {
    const quiet = { ...base, firstInboundAt: h(100), lastInboundAt: h(49), repliedToUs: true };
    expect(tiktokMaySend({ ...quiet, sentSinceQuiet: TIKTOK_QUIET_MAX - 1 }, new Date(NOW)).send).toBe(true);
    expect(tiktokMaySend({ ...quiet, sentSinceQuiet: TIKTOK_QUIET_MAX }, new Date(NOW))).toEqual({ send: false, why: 'quiet_used' });
  });
  it('the gate refuses with its own reason — and the owner\'s own reply too: TikTok refuses the account\'s message whoever typed it', () => {
    const g = { origin: 'owner' as const, assignedTo: 'owner', paused: false, windowPlan: sendPlan('open', 'reply', 'none'), activated: true,
      pilotMode: false, silenced: false, stopped: false, frozen: false };
    expect(gateOutbound({ ...g, channelLimitReached: true })).toEqual({ allow: false, reason: 'tiktok_limit' });
    expect(gateOutbound(g)).toEqual({ allow: true, viaTemplate: false });
  });
  it('the registry: never writes first, a 48-hour channel, no delivery receipts', () => {
    expect(CHANNEL_REGISTRY.tiktok).toMatchObject({ availableHere: true, coldInitiate: 'never', replyWindowHours: 48, deliveryReceipts: false });
  });
});

describe('0215 · signing in, renewing, giving back, sending (against the fake)', () => {
  it('the app is all three or nothing, and its URL must be TikTok\'s own', () => {
    const env = { TIKTOK_APP_ID: TIKTOK_APP.appId, TIKTOK_APP_SECRET: TIKTOK_APP.appSecret, TIKTOK_AUTH_URL: TIKTOK_APP.authUrl };
    expect(tiktokAppFrom(env)).toEqual(TIKTOK_APP);
    expect(tiktokAppFrom({ ...env, TIKTOK_AUTH_URL: 'https://evil.example/v2/auth/authorize' })).toBeNull();
    expect(tiktokAppFrom({ ...env, TIKTOK_AUTH_URL: 'http://www.tiktok.com/v2/auth/authorize' })).toBeNull();
    expect(tiktokAppFrom({ ...env, TIKTOK_APP_SECRET: '' })).toBeNull();
  });
  it('the owner goes to TikTok\'s own URL, with the state, and never past the consent screen', () => {
    const u = new URL(tiktokAuthorizeUrl(TIKTOK_APP, 'the-nonce'));
    expect(u.origin).toBe('https://www.tiktok.com');
    expect(u.searchParams.get('state')).toBe('the-nonce');
    expect(u.searchParams.get('disable_auto_auth')).toBe('1');
    expect(u.searchParams.get('client_key')).toBe(TIKTOK_APP.appId);
  });
  it('a code becomes one grant; renewed, it gets a new access token; given back, nothing works', async () => {
    const tt = tiktokFake();
    const r = await exchangeTikTokCode(TIKTOK_APP, tt.code('oid-9'), 'https://app.example/app/connect/tiktok/callback', tt.fetch, NOW);
    expect(r.ok && r.openId).toBe('oid-9');
    if (!r.ok) throw new Error('fixture');
    expect(r.grant.ae).toBe(NOW + 86_400_000);
    expect(openTikTokGrant(packTikTokGrant(r.grant))).toEqual(r.grant);
    const sent = await sendTikTokText(tt.fetch, { accessToken: r.grant.a, openId: 'oid-9', conversationId: 'c-1', body: 'Hello' });
    expect(sent.ok).toBe(true);
    const renewed = await refreshTikTokGrant(TIKTOK_APP, r.grant, tt.fetch, NOW);
    expect(renewed.ok && renewed.grant.a).not.toBe(r.grant.a);
    if (!renewed.ok) throw new Error('fixture');
    expect(await revokeTikTokGrant(TIKTOK_APP, renewed.grant, tt.fetch)).toBe(true);
    expect(tt.live('oid-9')).toBe(false);
    const after = await sendTikTokText(tt.fetch, { accessToken: renewed.grant.a, openId: 'oid-9', conversationId: 'c-1', body: 'Hello' });
    expect(after).toMatchObject({ ok: false, dead: true, retryable: false });
    expect(JSON.stringify(after)).not.toContain('access token invalid');   // TikTok's words are never repeated
  });
  it('a send TikTok calls a dead token tells the account once; a renewal TikTok did not answer is retried, never marked', async () => {
    const tt = tiktokFake();
    let told = 0;
    const a = tiktokSendAdapter({ openId: 'oid-1', fetchImpl: tt.fetch, accessToken: async () => ({ token: 'act.not-issued' }), onDead: async () => { told++; } });
    expect(await a.sendText('c-1', 'Hi')).toMatchObject({ ok: false, retryable: false });
    expect(told).toBe(1);
    const b = tiktokSendAdapter({ openId: 'oid-1', fetchImpl: tt.fetch, accessToken: async () => ({ token: null, retryable: true }), onDead: async () => { told++; } });
    expect(await b.sendText('c-1', 'Hi')).toMatchObject({ ok: false, retryable: true });
    expect(told).toBe(1);
  });
});

describe('0215 · the database and the boot', () => {
  const m = readFileSync(`${ROOT}migrations/0215_tiktok.sql`, 'utf8');
  it('the channel on all six lists; one live account per business and per account; row security; no delete; no practice copy', () => {
    for (const c of ['conversations_channel_check', 'client_channels_channel_check', 'channel_sources_channel_check',
      'outbound_messages_channel_check', 'channel_credentials_channel_check', 'channels_kind_check']) {
      expect(m, c).toMatch(new RegExp(`add  constraint ${c}[\\s\\S]*?'tiktok'`));
    }
    expect(m).toContain('tiktok_accounts_one_live on tiktok_accounts (business_id) where archived_at is null');
    expect(m).toContain('tiktok_accounts_account_live on tiktok_accounts (open_id) where archived_at is null');
    expect(m).toContain('alter table tiktok_accounts enable row level security');
    expect(m).toContain('revoke delete, truncate on tiktok_accounts from nomi_app');
    expect(m).toContain('execute function practice_refuses()');
  });
  it('TikTok is listed as a recipient and NOT named: the boot refuses its variables until the privacy line is read', async () => {
    const { OPTIONAL_RECIPIENTS, unnamedRecipientProblems } = await import('../../src/core/legal/recipients.js');
    expect(OPTIONAL_RECIPIENTS.find((r) => r.id === 'tiktok')).toMatchObject({ named: false });
    expect(unnamedRecipientProblems({ TIKTOK_APP_ID: 'x' }).join(' ')).toContain('TikTok');
  });
});

describe('Audit batch 1 · B5 — a TikTok send with no answer, or a yes naming nothing, is uncertain', () => {
  const args = { accessToken: 'at', openId: 'oid', conversationId: 'c', body: 'Hello' };
  it('a timeout: uncertain, never retried', async () => {
    const r = await sendTikTokText(async () => { throw new DOMException('timeout', 'TimeoutError'); }, args);
    expect(r).toMatchObject({ ok: false, retryable: false, uncertain: true, dead: false });
  });
  it('a refused connection never left: retried', async () => {
    const r = await sendTikTokText(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }, args);
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(r).not.toHaveProperty('uncertain');
  });
  it('code 0 with no message id: uncertain', async () => {
    const r = await sendTikTokText(async () => ({ status: 200, text: async () => JSON.stringify({ code: 0, data: {} }) }), args);
    expect(r).toMatchObject({ ok: false, retryable: false, uncertain: true });
  });
});
