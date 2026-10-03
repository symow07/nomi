import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { confirmableFromProposal } from '../../src/core/commerce/confirmable.js';
import { driveConversationOutbound, type ConversationSendContext, type OutboundStore, type OutboundWorkRow } from '../../src/outbound/worker.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';
import { alertKindFor, goesByMail, interrupts, renderOwnerAlert } from '../../src/pipeline/notify.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { usd } from '../../src/core/types/money.js';
import type { PendingQuestion } from '../../src/core/types/conversation.js';

/**
 * 0080 — AN ORDER WAITS FOR THE OWNER'S TAP: the pure parts.
 *
 * The turn is proved in tests/pipeline/order-waits.test.ts (T6, T6b) and the
 * whole path over Postgres in tests/integration/order-proposal.test.ts. This
 * holds the pieces that decide on their own: what a proposal may become, the
 * send path setting the pending question only when a message leaves, the
 * owner's alert, the migration, and the card the owner decides on.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');

const PROPOSAL = {
  productId: 'b0000000-0000-0000-0000-000000000001',
  quantity: 40, unit: 'boxes',
  unitPrice: usd(2.1), total: usd(84),
  email: 'customer@example.com',
  paymentTerms: null, incoterm: null,
};

describe('0080 · what a proposal may become', () => {
  it('exactly what the customer said yes to, as a ConfirmableOrder', () => {
    const r = confirmableFromProposal(PROPOSAL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.quantity).toEqual({ value: 40, unit: 'boxes' });
    expect(r.value.total).toEqual(usd(84));
    expect(r.value.email).toBe('customer@example.com');
  });

  it('never an order that lacks what every order needs, or whose arithmetic is off', () => {
    const bad = (over: Partial<typeof PROPOSAL>) => confirmableFromProposal({ ...PROPOSAL, ...over });
    expect(bad({ productId: 'not-a-uuid' })).toMatchObject({ ok: false, error: ['missing_product'] });
    expect(bad({ quantity: 0 })).toMatchObject({ ok: false });
    expect(bad({ unitPrice: usd(0), total: usd(0) })).toMatchObject({ ok: false });
    expect(bad({ total: usd(85) })).toMatchObject({ ok: false, error: ['total_mismatch'] });
    expect(bad({ email: 'no address' })).toMatchObject({ ok: false, error: ['email_missing'] });
  });
});

// ── The send path sets the pending question when a message LEAVES ──────────

const NOW = new Date('2026-09-29T10:00:00Z');
type Row = { -readonly [K in keyof OutboundWorkRow]: OutboundWorkRow[K] };

function memStore(asks: PendingQuestion | null, ctx: Partial<ConversationSendContext> = {}, origin: OutboundWorkRow['origin'] = 'employee') {
  const row: Row = {
    id: 'o1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null,
    to: '971500000001', body: 'Shall I go ahead and confirm the order?', origin, sendingSince: null,
    ...(asks ? { asks } : {}),
  };
  const asked: { conversationId: string; asks: PendingQuestion | null }[] = [];
  const context: ConversationSendContext = {
    assignedTo: null, paused: false, lastInboundAt: new Date(NOW.getTime() - 3600_000), template: 'none',
    pilotMode: false, activated: true, silenced: false, stopped: false, ...ctx,
  };
  const store: OutboundStore = {
    async load() { return { rows: [{ ...row }], ctx: context }; },
    async transition(_id, to) { row.status = to; if (to === 'sent') row.sentAt = NOW; },
    async recordProviderId() {},
    async scheduleRetry() {},
    async deadLetter() {},
    async markQuestionAsked(conversationId, q) { asked.push({ conversationId, asks: q }); },
  };
  return { store, row, asked };
}

const adapter = (result: SendResult): ChannelAdapter => ({
  kind: 'whatsapp', provider: 'test', verifyWebhook: () => false, parseWebhook: () => [],
  sendText: async () => result,
});
const drive = (store: OutboundStore, result: SendResult = { ok: true, providerMessageId: 'wamid.1' }) =>
  driveConversationOutbound({ store, adapter: adapter(result), now: () => NOW }, 'conv1');

describe('0080 · the pending question is set when its message leaves, and only then', () => {
  it('a message that asks it, accepted by the provider: now it is pending', async () => {
    const m = memStore('order_confirmation');
    await drive(m.store);
    expect(m.row.status).toBe('sent');
    expect(m.asked).toEqual([{ conversationId: 'conv1', asks: 'order_confirmation' }]);
  });

  it('a message that asks nothing clears it — and so do the owner\'s own words', async () => {
    const plain = memStore(null);
    await drive(plain.store);
    expect(plain.asked).toEqual([{ conversationId: 'conv1', asks: null }]);
    const own = memStore('order_confirmation', {}, 'owner');
    await drive(own.store);
    expect(own.asked).toEqual([{ conversationId: 'conv1', asks: null }]);
  });

  it('refused at send time, or refused by the provider: nothing was asked', async () => {
    for (const ctx of [{ stopped: true }, { silenced: true }, { assignedTo: 'owner' }, { paused: true }] as Partial<ConversationSendContext>[]) {
      const m = memStore('order_confirmation', ctx);
      await drive(m.store);
      expect(m.row.status, JSON.stringify(ctx)).not.toBe('sent');
      expect(m.asked, JSON.stringify(ctx)).toEqual([]);
    }
    const failed = memStore('order_confirmation');
    await drive(failed.store, { ok: false, retryable: false, error: 'recipient blocked' });
    expect(failed.asked).toEqual([]);
  });

  it('the database store writes it in one place, and the row carries the question from the queue', () => {
    expect(read('src/db/pendingQuestion.ts')).toMatch(/update conversation_state set pending_question/);
    const channels = read('src/db/channels.ts');
    expect(channels).toMatch(/async markQuestionAsked\(conversationId, asks\)/);
    expect(channels).toMatch(/origin, sending_since, kind, media_url, channel, subject, asks,/);
    expect(read('src/main.ts')).toMatch(/enqueueOutboundRow\(tx, businessId\.value, job\.data\.conversationId, job\.data\.reply,\s*'employee', null, job\.data\.asks \?\? null\)/);
    expect(read('src/worker/main.ts')).toMatch(/asks: effects\.outbound\.asks \?\? null/);
  });
});

describe('0080 · the owner is told, by e-mail as well', () => {
  it('a fresh proposal is its own alert; a repeat is not; a deletion request still comes first', () => {
    const base = { hotLeadAlert: false, handoffAlert: false };
    expect(alertKindFor({ ...base, orderProposed: { fresh: true } })).toBe('order_proposed');
    expect(alertKindFor({ ...base, orderProposed: { fresh: false } })).toBeNull();
    expect(alertKindFor({ ...base, deletionAlert: true, orderProposed: { fresh: true } })).toBe('deletion_requested');
    // Phase 8 of the warmth run, deliberately — the owner (2026-10-03): "Only two things may interrupt the owner outside the app: an order waiting for their tap, and a conversation the assistant handed over because it could not handle it. Everything else waits quietly in-app."
    // An order waiting is one of the two: it goes the owner's own way, e-mail under it, not "e-mail always".
    expect(goesByMail('order_proposed')).toBe(false);
    expect(interrupts('order_proposed')).toBe(true);
  });

  it('says what happened and what to do, in every language, with a subject', () => {
    for (const locale of LOCALES) {
      const body = renderOwnerAlert(locale, 'order_proposed');
      expect(body.length).toBeGreaterThan(20);
      expect(t(locale, 'notify.order_proposed.subject').length).toBeGreaterThan(5);
    }
    expect(renderOwnerAlert('en', 'order_proposed')).toMatch(/Nothing was confirmed and nothing was sent/);
  });
});

describe('0080 · the migration, and the build that needs it', () => {
  const sql = read('migrations/0080_order_proposals.sql').split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
  it('a tenant table the app may not delete from, one waiting per conversation', () => {
    expect(sql).toMatch(/create table if not exists order_proposals/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/using \(business_id = current_business_id\(\)\)/);
    expect(sql).toMatch(/revoke delete, truncate on order_proposals from nomi_app/);
    expect(sql).toMatch(/order_proposals_one_pending\s+on order_proposals \(conversation_id\) where state = 'pending'/);
  });
  it('a draft and an outbound message carry the question they ask', () => {
    expect(sql).toMatch(/alter table drafts\s+add column if not exists asks text/);
    expect(sql).toMatch(/alter table outbound_messages\s+add column if not exists asks text/);
    expect(sql).toMatch(/insert into _migrations \(version, name\) values \(80, 'order_proposals'\)/);
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(80);
  });
  it('the customer eraser knows the table', () => {
    expect(read('tools/erase-buyer.mjs')).toMatch(/order_proposals: \{ do: 'erase' \}/);
  });
});

describe('0080 · the card the owner decides on', () => {
  const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
    conversationId: 'conv-1', buyer: 'Maya', country: 'GB', status: 'awaiting',
    product: { name: 'Gift box', nameZh: null }, quantity: 40, quote: null, order: null, messages: [], pendingDraft: null,
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [],
    unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
    rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    orderProposal: {
      id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1',
      productId: PROPOSAL.productId, productName: 'Gift box', quantity: 40, unit: 'boxes',
      unitPrice: usd(2.1), total: usd(84), email: 'customer@example.com',
      paymentTerms: null, incoterm: null, createdAt: new Date('2026-09-29T09:00:00Z'),
    },
    ...over,
  });
  const NOW = new Date('2026-09-29T10:00:00Z');

  it('says exactly what they said yes to, that nothing was sent, and what they will be sent', () => {
    for (const locale of LOCALES) {
      const html = renderConversationDetail(detail(), locale, NOW, null, OWNER_VIEW);
      expect(html, locale).toContain(esc(t(locale, 'order.card.title')));
      expect(html, locale).toContain(esc(t(locale, 'order.card.intro')));
      expect(html, locale).toContain('Gift box');
      expect(html, locale).toContain('customer@example.com');
      expect(html, locale).toContain(esc(t(locale, 'order.card.willSend')));
      expect(html, locale).toContain('Your order is confirmed');
    }
  });

  it('two answers, each a button in a form that posts: confirm, or step in', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null, OWNER_VIEW);
    expect(html).toMatch(/<form method="post" action="\/app\/inbox\/conv-1\/order\/confirm"[^>]*>\s*<input type="hidden" name="proposalId" value="f0000000-0000-0000-0000-000000000001" \/>\s*<button class="btn send needs" type="submit">Confirm the order<\/button>/);
    expect(html).toMatch(/<form method="post" action="\/app\/inbox\/conv-1\/order\/step-in"[^>]*>\s*<input type="hidden" name="proposalId"[^>]*\/>\s*<button class="btn" type="submit">I'll answer them<\/button>/);
  });

  it('first of the things to do: above the draft card, and only while one waits', () => {
    const withDraft = renderConversationDetail(detail({
      pendingDraft: { draftId: 'd1', draftText: 'Anything else I can help with?', capability: 'qualify', heldBecause: 'order_waits_for_owner' },
    }), 'en', NOW, null, OWNER_VIEW);
    expect(withDraft.indexOf('order/confirm')).toBeLessThan(withDraft.indexOf('/act"'));
    expect(withDraft).toContain(esc(t('en', 'inbox.draft.held.order_waits_for_owner')));
    const none = renderConversationDetail(detail({ orderProposal: null }), 'en', NOW, null, OWNER_VIEW);
    expect(none).not.toContain('order/confirm');
  });
});
