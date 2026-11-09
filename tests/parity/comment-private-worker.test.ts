import { describe, it, expect } from 'vitest';
import {
  driveConversationOutbound, type OutboundStore, type OutboundWorkRow, type ConversationSendContext,
} from '../../src/outbound/worker.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { sendPlan } from '../../src/core/channel/window.js';
import { instagramAdapter } from '../../src/channels/instagram/adapter.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';

/**
 * 5.4 Part B, the outbound ruling's tests 1–3 on the worker itself: this kind goes only through the comment method,
 * with a claim, for the account the facts name — or nothing is called at all. A DM failure the provider marks
 * retryable is still retried; a comment failure never is.
 */
const NOW = new Date('2026-11-10T12:00:00Z');
const WEEK = 7 * 86_400_000;
type Row = { -readonly [K in keyof OutboundWorkRow]: OutboundWorkRow[K] };
type Facts = NonNullable<ConversationSendContext['commentPrivateReplies']>[string];
const facts = (f: Partial<Facts> = {}): Facts => ({ enabled: true, asking: true, accountBound: true, claim: 'ready',
  createdAt: new Date(NOW.getTime() - 3_600_000), accountId: '12345', ...f });

function store(o: { row?: Partial<Row>; ctx?: Partial<ConversationSendContext>; facts?: Facts | null; claim?: string | null | 'absent' } = {}) {
  const row: Row = { id: 'r1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null, to: '67890',
    body: 'Hi, thanks for your comment.', origin: 'owner', approved: true, channel: 'instagram', kind: 'comment_private_reply',
    sendingSince: null, ...o.row };
  const f = o.facts === undefined ? facts() : o.facts;
  const ctx: ConversationSendContext = { assignedTo: null, paused: false, lastInboundAt: null, template: 'none',
    pilotMode: false, activated: true, silenced: false, stopped: false, frozen: false,
    ...(f ? { commentPrivateReplies: { [row.id]: f } } : {}), ...o.ctx };
  const log: string[] = []; let claims = 0;
  const s: OutboundStore = {
    async load() { return { rows: [{ ...row }], ctx }; },
    async transition(id, to, detail) { log.push(`${row.status}->${to}${detail ? ` (${detail})` : ''}`); if (to === 'sending') { row.attempts += 1; row.sendingSince = NOW; } row.status = to; },
    async recordProviderId() {},
    async scheduleRetry(_id, ms) { log.push(`retry ${ms}`); },
    async deadLetter() { log.push('dead'); },
    ...(o.claim === 'absent' ? {} : { async claimCommentPrivateReply() { claims++; return o.claim === undefined ? '9876' : o.claim; } }),
  };
  return { s, log, row, claims: () => claims };
}

function spy(o: { kind?: ChannelAdapter['kind']; account?: string | null; result?: SendResult; dm?: SendResult } = {}) {
  const calls = { comment: [] as [string, string][], text: 0, media: 0 };
  const a: ChannelAdapter = {
    kind: o.kind ?? 'instagram',
    verifyWebhook: () => true, parseWebhook: () => [],
    sendText: async () => { calls.text++; return o.dm ?? { ok: true, providerMessageId: 'dm.1' }; },
    sendMedia: async () => { calls.media++; return { ok: true, providerMessageId: 'media.1' }; },
    ...(o.account === null ? {} : {
      commentPrivateReplyAccountId: o.account ?? '12345',
      sendCommentPrivateReply: async (id: string, body: string) => { calls.comment.push([id, body]); return o.result ?? { ok: true, providerMessageId: 'mid.1', recipientId: '67890' }; },
    }),
  } as ChannelAdapter;
  return { a, calls };
}
const drive = (s: OutboundStore, a: ChannelAdapter) => driveConversationOutbound({ store: s, adapters: () => a, now: () => NOW }, 'c1');

describe('5.4 · the comment reply leaves only by the comment method', () => {
  it('accepted: one call with the stored comment id, never sendText or sendMedia', async () => {
    const m = store(); const p = spy();
    expect(await drive(m.s, p.a)).toEqual([{ kind: 'sent', id: 'r1', providerMessageId: 'mid.1' }]);
    expect(p.calls).toEqual({ comment: [['9876', 'Hi, thanks for your comment.']], text: 0, media: 0 });
    expect(m.log).toEqual(['queued->sending', 'sending->sent']);
  });

  const zero: [string, () => { m: ReturnType<typeof store>; p: ReturnType<typeof spy> }, string][] = [
    ['the adapter has no comment method', () => ({ m: store(), p: spy({ account: null }) }), 'channel_unavailable'],
    ['the account does not match', () => ({ m: store(), p: spy({ account: '99999' }) }), 'channel_unavailable'],
    ['a Messenger adapter', () => ({ m: store(), p: spy({ kind: 'messenger' }) }), 'channel_unavailable'],
    ['the store has no claim', () => ({ m: store({ claim: 'absent' }), p: spy() }), 'comment_unchecked'],
    ['the claim is already used (lost the race)', () => ({ m: store({ claim: null }), p: spy() }), 'comment_used'],
    ['no locked facts for the row', () => ({ m: store({ facts: null }), p: spy() }), 'comment_unchecked'],
    ['facts say used', () => ({ m: store({ facts: facts({ claim: 'used' }) }), p: spy() }), 'comment_used'],
    ['comments off', () => ({ m: store({ facts: facts({ enabled: false }) }), p: spy() }), 'comments_off'],
    ['not an asking comment', () => ({ m: store({ facts: facts({ asking: false }) }), p: spy() }), 'comment_not_asking'],
    ['account not bound', () => ({ m: store({ facts: facts({ accountBound: false }) }), p: spy() }), 'comment_unchecked'],
    ['origin is not the owner', () => ({ m: store({ row: { origin: 'employee' } }), p: spy() }), 'comment_unchecked'],
    ['not approved', () => ({ m: store({ row: { approved: false } }), p: spy() }), 'comment_unchecked'],
    ['opted out', () => ({ m: store({ ctx: { optOut: { lastAskedAt: new Date(NOW.getTime() - 1000) } } }), p: spy() }), 'opted_out'],
    ['expired', () => ({ m: store({ facts: facts({ createdAt: new Date(NOW.getTime() - WEEK) }) }), p: spy() }), 'comment_expired'],
    ['age unknown', () => ({ m: store({ facts: facts({ createdAt: null }) }), p: spy() }), 'comment_age_unknown'],
    ['billing lapsed (frozen binds the owner too)', () => ({ m: store({ ctx: { frozen: true } }), p: spy() }), 'frozen'],
    ['not activated', () => ({ m: store({ ctx: { activated: false } }), p: spy() }), ''],
  ];
  for (const [name, make, reason] of zero) it(`zero provider calls: ${name}`, async () => {
    const { m, p } = make();
    const fx = await drive(m.s, p.a);
    expect(fx[0]).toMatchObject({ kind: 'canceled', id: 'r1' });
    expect(m.log.at(-1)).toContain(reason);
    expect(p.calls).toEqual({ comment: [], text: 0, media: 0 });
  });

  for (const hold of ['silenced', 'stopped'] as const) it(`${hold} binds the assistant, not the owner's own reply, as for every owner message`, async () => {
    const m = store({ ctx: { [hold]: true } }); const p = spy();
    expect((await drive(m.s, p.a))[0]).toMatchObject({ kind: 'sent' });
    expect(p.calls.comment).toHaveLength(1);
  });

  it('the installation\'s own environment Instagram adapter has no comment method: refused, zero calls', async () => {
    const urls: string[] = [];
    const env = instagramAdapter({ pageId: '1111', accessToken: 'fake', appSecret: 'fake', graphVersion: 'v23.0',
      fetchImpl: async (url) => { urls.push(url); return { status: 200, text: async () => '{"message_id":"m","recipient_id":"r"}' }; } });
    const m = store();
    expect((await drive(m.s, env))[0]).toMatchObject({ kind: 'canceled', reason: 'channel_unavailable' });
    expect(urls).toEqual([]);
  });

  it('a retryable comment failure is never retried; a retryable DM failure still is', async () => {
    const c = store(); const cp = spy({ result: { ok: false, retryable: true, error: 'meta 500' } });
    const fx = await drive(c.s, cp.a);
    expect(fx[0]).toMatchObject({ kind: 'failed_permanent', id: 'r1' });
    expect(c.log.some((l) => l.startsWith('retry'))).toBe(false);
    const d = store({ row: { kind: 'text', origin: 'employee', approved: false }, facts: null, ctx: { lastInboundAt: new Date(NOW.getTime() - 60_000) } });
    const dp = spy({ dm: { ok: false, retryable: true, error: 'meta 500' } });
    expect((await drive(d.s, dp.a))[0]).toMatchObject({ kind: 'retry_scheduled', id: 'r1' });
    expect(dp.calls.text).toBe(1);
    expect(dp.calls.comment).toEqual([]);
  });

  it('an uncertain send is uncertain, and its claim stays used', async () => {
    const m = store(); const p = spy({ result: { ok: false, retryable: false, uncertain: true, error: 'meta acceptance unknown' } });
    expect((await drive(m.s, p.a))[0]).toMatchObject({ kind: 'uncertain', id: 'r1' });
    expect(m.claims()).toBe(1);
  });
});

describe('5.4 · the seven days, ±1 ms, on the gate itself', () => {
  const base = { origin: 'owner' as const, approved: true, windowPlan: sendPlan('closed', 'reply', 'none'), activated: true,
    assignedTo: null, paused: false, silenced: false, stopped: false, frozen: false, pilotMode: false };
  const at = (age: number) => gateOutbound({ ...base, messageKind: 'comment_private_reply',
    commentPrivateReply: { channel: 'instagram', enabled: true, asking: true, accountBound: true, claim: 'ready',
      createdAt: new Date(NOW.getTime() - age), now: NOW } } as Parameters<typeof gateOutbound>[0]);
  it('7 days less 1 ms: allowed, with no template', () => expect(at(WEEK - 1)).toEqual({ allow: true, viaTemplate: false }));
  it('exactly 7 days: expired', () => expect(at(WEEK)).toEqual({ allow: false, reason: 'comment_expired' }));
  it('7 days and 1 ms: expired', () => expect(at(WEEK + 1)).toEqual({ allow: false, reason: 'comment_expired' }));
  it('created 1 ms in the future: age unknown', () => expect(at(-1)).toEqual({ allow: false, reason: 'comment_age_unknown' }));
});
