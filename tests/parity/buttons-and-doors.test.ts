import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { usd } from '../../src/core/types/money.js';

/**
 * Buttons do things; doors go places — the rule (./buttons-and-doors.ts),
 * proved to catch each way it can be broken, held over the source of every
 * page, and over the page the owner uses most. Every real page, in two
 * languages, on real rows, goes through the same checker in
 * tests/integration/surface-walk.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('the checker catches each way the rule breaks — and passes what keeps it', () => {
  it('a link dressed as a button, a button outside a form, a form that posts with nothing to post it', () => {
    expect(buttonsAndDoors('<a class="btn send" href="/app/products/add">Teach</a>')).toEqual(['a link drawn as a button: /app/products/add']);
    expect(buttonsAndDoors('<a class="btn" href="/x">Go</a>')).toHaveLength(1);
    expect(buttonsAndDoors('<button class="btn">Save</button>')).toHaveLength(1);
    expect(buttonsAndDoors('<button type="button" class="btn">Look</button>')).toHaveLength(1);
    expect(buttonsAndDoors('<form method="post" action="/x"><input name="a"></form>')).toEqual(['a form that posts has no button to post it']);
  });
  it('a door, a button in a form, a script control, a search form', () => {
    expect(buttonsAndDoors('<a class="deeper" href="/x">Go<span class="go">›</span></a>')).toEqual([]);
    expect(buttonsAndDoors('<form method="post" action="/x"><button class="btn send">Send</button></form>')).toEqual([]);
    expect(buttonsAndDoors('<button type="button" class="btn ghost" data-notify-ask hidden>Tell me</button>')).toEqual([]);
    expect(buttonsAndDoors('<form method="get" action="/app/inbox"><input name="q"></form>')).toEqual([]);
  });
});

describe('the source of every page draws no link as a button', () => {
  it('src/api/web — not one <a class="btn">', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(`${ROOT}src/api/web`).filter((n) => n.endsWith('.ts'))) {
      const src = readFileSync(`${ROOT}src/api/web/${f}`, 'utf8');
      for (const m of src.matchAll(/<a\b[^>]*\bclass="(?:[^"$]*\s)?btn(?:[\s"])/g)) {
        offenders.push(`${f}: ${src.slice(m.index!, m.index! + 70).replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the page the owner uses most keeps the rule', () => {
  it('the conversation page, with a reply to review and an order waiting', () => {
    const d: ConversationDetail = {
      conversationId: 'conv-1', buyer: 'Maya', country: 'GB', status: 'awaiting',
      product: { name: 'Gift box', nameZh: null }, quantity: 40, quote: null, order: null, messages: [],
      pendingDraft: { draftId: 'd1', draftText: 'Anything else I can help with?', capability: 'qualify', heldBecause: null },
      ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [],
      unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
      rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
      orderProposal: {
        id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1', productId: 'b0000000-0000-0000-0000-000000000001',
        productName: 'Gift box', quantity: 40, unit: 'boxes', unitPrice: usd(2.1), total: usd(84), email: 'c@example.com',
        paymentTerms: null, incoterm: null, createdAt: new Date('2026-09-29T09:00:00Z'),
      },
    };
    expect(buttonsAndDoors(renderConversationDetail(d, 'en', new Date('2026-09-29T10:00:00Z'), null, OWNER_VIEW))).toEqual([]);
  });
});
