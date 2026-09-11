import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { usd } from '../../src/core/types/money.js';
import { canTransition, ownershipOf, aiMaySpeak } from '../../src/core/conversation/ownership.js';
import { renderConversationDetail, renderInboxList, type ConversationDetail, type InboxList } from '../../src/api/web/inbox.js';
import type { Person } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G12 — hand a conversation to a named person. The walk is in
 * tests/integration/people.test.ts; this is the model and the two surfaces.
 */

const NOW = new Date('2026-09-11T08:00:00Z');
const owner: Person = { id: 'p-owner', name: 'Mrs Wang', isOwner: true };
const chen: Person = { id: 'p-chen', name: 'Xiao Chen', isOwner: false };
const people = [owner, chen];

describe('G12 · the move is inside the ownership model, not beside it', () => {
  it('person to person is allowed; the AI is silent either way', () => {
    expect(canTransition('OWNER_CONTROLLED', 'OWNER_CONTROLLED')).toBe(true);
    expect(aiMaySpeak(ownershipOf(chen.id))).toBe(false);
    expect(ownershipOf(chen.id)).toBe('OWNER_CONTROLLED');
  });

  it('and the moves that were never allowed still are not', () => {
    expect(canTransition('OWNER_CONTROLLED', 'WAITING_HUMAN')).toBe(false);
    expect(canTransition('AI', 'AI')).toBe(false);
    expect(canTransition('WAITING_HUMAN', 'WAITING_HUMAN')).toBe(false);
  });

  it('who may receive one is a live person of this business — checked in the service', async () => {
    const src = await readFile(fileURLToPath(new URL('../../src/conversations/takeover.ts', import.meta.url)), 'utf8');
    const fn = src.slice(src.indexOf('export async function handTo'));
    expect(fn).toContain('archived_at is null');
    expect(fn).toContain('business_id = ${input.businessId}');
    expect(fn).toContain("'unknown_person'");
    expect(fn).toContain("append(cid, 'handed_to'");
  });
});

describe('G12 · the conversation says whose it is', () => {
  const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'paused',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: null, quote: null,
    order: null, messages: [], pendingDraft: null, ownership: 'OWNER_CONTROLLED',
    heldBy: chen.id, people, refusals: [], handoffReasons: [], unheardReason: null,
    lastHumanAction: { type: 'handed_to', actor: owner.id, to: chen.id, at: NOW },
    knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
    proof: { quoteId: null, token: null }, ...over,
  });

  it('to the owner: his name, and what happened last', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null, { id: owner.id, isOwner: true });
    expect(html).toContain(esc(t('en', 'people.holding', { who: 'Xiao Chen' })));
    expect(html).toContain(esc(t('en', 'takeover.last.handed_to', { who: 'Xiao Chen' })));
  });

  it('to the person holding it: it is theirs, not "held by" someone', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null, { id: chen.id, isOwner: false });
    expect(html).toContain(esc(t('en', 'takeover.status.owner')));
    expect(html).not.toContain(esc(t('en', 'people.holding', { who: 'Xiao Chen' })));
  });

  it('offers everyone but whoever already holds it — and nobody, when there is nobody else', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null, { id: owner.id, isOwner: true });
    expect(html).toContain('action="/app/inbox/conv-1/handto"');
    expect(html).toContain(`value="${owner.id}"`);
    expect(html).not.toContain(`value="${chen.id}"`);        // he has it already
    const alone = renderConversationDetail(detail({ people: [owner], heldBy: owner.id }), 'en', NOW, null, { id: owner.id, isOwner: true });
    expect(alone).not.toContain('/handto');
  });

  it('every string exists in all three locales', () => {
    for (const l of LOCALES) {
      for (const k of ['handto.label', 'handto.button', 'inbox.filter.mine',
        'takeover.flash.handed', 'takeover.flash.unknown_person', 'takeover.last.handed_to'] as MessageKey[]) {
        const said = t(l, k, { name: 'Xiao Chen', who: 'Xiao Chen' });
        expect(said, `${l} ${k}`).not.toBe(k);
        expect(said, `${l} ${k}`).not.toContain('{');
      }
    }
  });
});

describe('G12 · Mine', () => {
  const list = (over: Partial<InboxList> = {}): InboxList => ({
    filter: 'mine', waitingCount: 0, blockedCount: 0, mineCount: 1,
    conversations: [{
      conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'paused',
      needsAction: false, ownership: 'OWNER_CONTROLLED', heldBy: chen.id, awaitingReview: false,
      handoffReason: null, latestMessage: 'Can you do 5000 pcs?', latestAt: NOW,
      product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000, unitPrice: usd(0.92),
    }],
    ...over,
  });

  it('the tab appears once there is more than one person — never for a lone owner', () => {
    expect(renderInboxList(list(), 'en', NOW, people)).toContain('/app/inbox?filter=mine');
    expect(renderInboxList(list({ filter: 'all' }), 'en', NOW, [owner])).not.toContain('filter=mine');
  });

  it('it counts what this reader is holding', () => {
    expect(renderInboxList(list(), 'en', NOW, people)).toContain(`${t('en', 'inbox.filter.mine')} (1)`);
  });
});
