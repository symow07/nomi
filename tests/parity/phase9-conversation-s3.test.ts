import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { usd } from '../../src/core/types/money.js';
import { esc, shell } from '../../src/api/web/layout.js';
import { renderConversationDetail, type ConversationDetail, type ConversationSummary, type InboxList } from '../../src/api/web/inbox.js';
import { renderListPane, renderCustomerPanel, paneRowOf } from '../../src/api/web/panes.js';
import { renderCustomerFile, customerFileTitle, type CustomerFile } from '../../src/api/web/conversations.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import { conversationDetail } from './fixtures.js';

/**
 * Phase 9, round two — the conversation area's S3 and S4 findings
 * (docs/UI-AUDIT.md §5): the conversation page, the draft card, the customer's
 * file, the customer panel and Practice. Each is checked on the rendered page,
 * in every locale where the words matter.
 */

const NOW = new Date('2026-10-02T09:53:00Z');
const ago = (min: number): Date => new Date(NOW.getTime() - min * 60_000);
const OWNER = { id: 'p-owner', name: 'Symow', isOwner: true };
const CHEN = { id: 'p-chen', name: '陈莉', isOwner: false };
const plain = (s: string): string => s.replace(/[⁦-⁩]/g, '');

const draft = (over: Partial<ConversationDetail> = {}): ConversationDetail => conversationDetail({
  buyer: 'Aisha Bello', country: 'NG', channel: 'whatsapp', status: 'awaiting',
  product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 5000,
  quote: { unitPrice: usd(1.45), total: usd(7250), quantity: 5000 },
  messages: [{ direction: 'inbound', text: 'Hello, what is your price for 5,000 pcs of the LED string lights 10m?', at: ago(35) }],
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs of LED String Lights 10m (ZX-300): $1.45/pc FOB Ningbo, lead time 25 days.', capability: 'quote' },
  ...over,
});

const row = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, buyer: `B-${id}`, country: null, status: 'awaiting', needsAction: true, ownership: 'AI',
  heldBy: null, awaitingReview: false, handoffReason: null, latestMessage: `last from ${id}`, latestAt: NOW,
  product: { name: null, nameZh: null }, quantity: null, unitPrice: null, ...over,
});

const panel = (over: Partial<CustomerPanel> = {}): CustomerPanel => ({
  clientId: 'cl-1', name: 'Aisha Bello', country: 'NG', channel: 'whatsapp', address: '2345000000261', language: 'en',
  firstWrote: ago(35), conversations: 1, askedAbout: [],
  prices: [{ unitPrice: usd(1.45), name: 'LED String Lights 10m', nameZh: null, at: ago(33), conversationId: 'conv-here' }],
  samples: [], promised: [], orders: [], activity: [{ kind: 'waiting', at: ago(33) }], ...over,
});

const file = (over: Partial<CustomerFile> = {}): CustomerFile => ({
  conversationId: 'conv-here', buyer: 'Aisha Bello', country: 'NG', channel: 'whatsapp',
  status: { t: 'awaiting' }, statusTone: 'warn', needsOwner: true,
  profile: { firstContact: ago(35), products: [{ name: 'LED String Lights 10m', nameZh: null }], quoteCount: 1, orderCount: 0 },
  timeline: [
    { kind: 'buyer_text', at: ago(35), text: 'Hello, what is your price for 5,000 pcs of the LED string lights 10m?', qty: null, unitPrice: null, orderStatus: null },
    { kind: 'quote', at: ago(33), text: null, qty: 5000, unitPrice: usd(1.45), orderStatus: null },
  ],
  context: { products: [{ sku: null, name: 'LED String Lights 10m', nameZh: null }], latestQuote: { qty: 5000, unitPrice: usd(1.45), total: usd(7250) }, order: null, corrections: [] },
  deletion: null, deletionAsk: null, ...over,
});

describe('V1-232, V1-271 · one state, one name: the tab\'s, wherever it is said', () => {
  it('the header, the hand-over card, the draft card, the panel, the buyer file and the list say the same words', () => {
    for (const l of LOCALES) {
      const word = esc(t(l, 'inbox.filter.pending'));
      // a reply waiting: the header pill
      const page = plain(renderConversationDetail(draft({ pendingDraft: { ...draft().pendingDraft!, heldBecause: 'discount_needs_owner' } }), l, NOW, null));
      expect(page, l).toContain(`<span class="pill warn">${word}</span>`);
      // …and the card's state line
      expect(page, l).toContain(`<b>${word}</b>`);
      // handed to a person: the header and the card
      const waiting = plain(renderConversationDetail(draft({ ownership: 'WAITING_HUMAN', pendingDraft: null, handoffReasons: ['human_requested'] }), l, NOW, null));
      expect(waiting.split(`<span class="pill warn">${word}</span>`).length - 1, l).toBe(2);
      // the customer panel's activity, and the buyer file's pill
      expect(plain(renderCustomerPanel(panel(), [], l, NOW, 'conv-here')), l).toContain(`○</span> ${word}`);
      expect(plain(renderCustomerFile(file(), l, NOW)), l).toContain(`<span class="pill warn">${word}</span>`);
      // and the list's group says it the same way
      expect(t(l, 'buyers.group.needsYou'), l).toBe(t(l, 'inbox.filter.pending'));
    }
  });
});

describe('V1-262 · the same act has one name on every page', () => {
  it('the draft card\'s button and the hand-over card\'s button say the same, in every locale', () => {
    for (const l of LOCALES) {
      expect(t(l, 'takeover.action.take'), l).toBe(t(l, 'card.handToMe'));
      const withDraft = renderConversationDetail(draft(), l, NOW, null);
      const without = renderConversationDetail(draft({ pendingDraft: null, status: 'done' }), l, NOW, null);
      expect(withDraft, l).toContain(`>${esc(t(l, 'card.handToMe'))}</button>`);
      expect(without, l).toContain(`>${esc(t(l, 'takeover.action.take'))}</button>`);
    }
    expect(t('en', 'card.handToMe')).toBe('I’ll reply');
  });
});

describe('V1-243, V1-264 · "Hand to" offers the reader as the label\'s own object', () => {
  it('"Pasar a mí", «إحالة إلى نفسي», "Hand to me" — never "Pasar a Tú" or «إحالة إلى أنت»', () => {
    const held = draft({ pendingDraft: null, ownership: 'OWNER_CONTROLLED', heldBy: CHEN.id, people: [OWNER, CHEN] });
    const option = (l: Locale) => {
      const html = renderConversationDetail(held, l, NOW, null, { id: OWNER.id, isOwner: true });
      return html.slice(html.indexOf('<select id="handto"'), html.indexOf('</select>', html.indexOf('<select id="handto"')));
    };
    expect(option('es')).toContain('>mí</option>');
    expect(option('es')).not.toContain('>Tú</option>');
    expect(option('ar')).toContain('>نفسي</option>');
    expect(option('ar')).not.toContain('>أنت</option>');
    expect(option('en')).toContain('>me</option>');
    for (const l of LOCALES) expect(option(l), l).toContain(`>${esc(t(l, 'handto.self'))}</option>`);
  });
});

describe('V1-233 · the list beside a conversation heads its rows as the list page does', () => {
  const list: InboxList = {
    filter: 'pending', waitingCount: 2, blockedCount: 0, deletionCount: 0, mineCount: 1,
    conversations: [row('c-1', { awaitingReview: true }), row('c-2', { ownership: 'OWNER_CONTROLLED', heldBy: OWNER.id })],
  };
  it('under "Needs you" no row is headed "Your team is handling"; on All every group is headed', () => {
    for (const l of LOCALES) {
      const pending = renderListPane(list, l, NOW, 'c-1', [OWNER, CHEN]);
      expect(pending, l).not.toContain(esc(t(l, 'buyers.group.team')));
      expect(pending, l).not.toContain('class="lp-group"');
      const all = renderListPane({ ...list, filter: 'all' }, l, NOW, 'c-1', [OWNER, CHEN]);
      expect(all, l).toContain(`<li class="lp-group" aria-hidden="true">${esc(t(l, 'buyers.group.team'))}</li>`);
    }
  });
});

describe('V1-257 · the open conversation is in the list beside it', () => {
  it('shown first under its own heading, marked as the page, when the tab does not list it', () => {
    const list: InboxList = { filter: 'pending', waitingCount: 1, blockedCount: 0, conversations: [row('c-1', { awaitingReview: true })] };
    const open = paneRowOf(draft({ conversationId: 'c-9', buyer: 'Carlos Mendes', pendingDraft: null, status: 'done' }));
    for (const l of LOCALES) {
      const html = renderListPane(list, l, NOW, 'c-9', [], open);
      expect(html, l).toContain(esc(t(l, 'pane.current')));
      expect(html, l).toMatch(/<a class="crow [^"]* on" href="\/app\/inbox\/c-9#latest" aria-current="page">/);
      expect(html.indexOf('c-9#latest'), l).toBeLessThan(html.indexOf('c-1#latest'));
      // listed already: said once, where the tab has it
      const listed = renderListPane({ ...list, conversations: [...list.conversations, row('c-9')] }, l, NOW, 'c-9', [], open);
      expect(listed, l).not.toContain(esc(t(l, 'pane.current')));
      expect(listed.split('c-9#latest').length - 1, l).toBe(1);
    }
  });
});

describe('conversation-missed-02 · the list has one name beside the conversation', () => {
  it('the pane is headed what the back link and the list page call it', () => {
    const list: InboxList = { filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [] };
    for (const l of LOCALES) {
      const html = renderListPane(list, l, NOW, 'c-1');
      expect(html, l).toContain(`<h2 class="lp-h">${esc(t(l, 'nav.inbox'))}</h2>`);
      expect(t(l, 'inbox.detail.back'), l).toBe(t(l, 'nav.inbox'));
    }
  });
});

describe('V1-234, V1-266, conversation-missed-05 · the customer panel\'s doors', () => {
  it('the buyer\'s page by the conversation page\'s name; no door to the conversation already open; a door elsewhere set off', () => {
    for (const l of LOCALES) {
      const html = renderCustomerPanel(panel({
        prices: [
          { unitPrice: usd(1.45), name: 'LED String Lights 10m', nameZh: null, at: ago(33), conversationId: 'conv-here' },
          { unitPrice: usd(1.5), name: 'LED String Lights 10m', nameZh: null, at: ago(9000), conversationId: 'conv-before' },
        ],
      }), [], l, NOW, 'conv-here');
      expect(html, l).toContain(`>${esc(t(l, 'conv.file.title'))}<span class="go"`);
      expect(html, l).not.toContain('href="/app/inbox/conv-here#latest"');
      expect(html, l).toContain(`<a class="pn-door" href="/app/inbox/conv-before#latest">${esc(t(l, 'panel.priceDoor'))}<span class="go"`);
    }
  });
});

describe('V1-279, V1-284 · the buyer\'s page says where its doors go, and its tab says which page it is', () => {
  it('the waiting reply\'s door names the reply; the tab is not the conversation\'s', () => {
    for (const l of LOCALES) {
      const body = renderCustomerFile(file(), l, NOW);
      expect(body, l).toContain(`>${esc(t(l, 'conv.needCardCta'))}<span class="go"`);
      const title = customerFileTitle(l, file());
      const page = shell({ title, active: 'inbox', locale: l, path: '/app/conversations/conv-here', bodyHtml: body });
      expect(page, l).toContain(`<title>${esc(title)} · Nomi</title>`);
      expect(title, l).not.toBe('Aisha Bello');
    }
    expect(t('en', 'conv.needCardCta')).toBe('Review the reply');
  });
});
