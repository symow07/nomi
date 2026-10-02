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
import { linkedCss } from './linked-css.js';
import { formatList, labelled } from '../../src/core/owner/i18n/format.js';

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
const plain = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');

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

// ── the draft card ───────────────────────────────────────────────────────────

const card = (html: string): string => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));
const css = (): string => linkedCss(shell({ title: 'x', active: 'inbox', locale: 'en', path: '/app/inbox/x', bodyHtml: '' }));
const withFigures = (): ConversationDetail => draft({
  pendingDraft: { draftId: 'd-1', capability: 'quote', draftText: 'Hello Aisha — for 5,000 pcs of LED String Lights 10m (ZX-300): $1.45/pc FOB Ningbo, lead time 25 days, CE certified.' },
});

describe('V1-222, conversation-new-04, V1-240 · the fold\'s line says which figure, and reads as one sentence', () => {
  it('the figures and the claim are named on the line; no count beside them; "Understood as:" leads the values', () => {
    for (const l of LOCALES) {
      const c = plain(card(renderConversationDetail(withFigures(), l, NOW, null)));
      const summary = c.slice(c.indexOf('<summary>'), c.indexOf('</summary>'));
      expect(summary, l).toContain(esc(t(l, 'card.unsourcedWhich', { figures: plain(formatList(l, ['300', '25'])) })));
      const claimOnly = plain(card(renderConversationDetail(draft({ pendingDraft: { ...draft().pendingDraft!, draftText: 'All our lamps are CE certified.' } }), l, NOW, null)));
      expect(claimOnly, l).toContain(esc(t(l, 'card.unconfirmedWhich', { claims: '“CE certified”' })));
      const fine = plain(card(renderConversationDetail(draft({ pendingDraft: { ...draft().pendingDraft!, draftText: 'For 5,000 pcs of LED String Lights 10m: $1.45/pc.' } }), l, NOW, null)));
      expect(fine.slice(fine.indexOf('<summary>'), fine.indexOf('</summary>')), l).not.toContain('class="c');
      expect(c, l).toContain(`<p class="und"><span class="k">${esc(labelled(l, t(l, 'card.understood'), '').trimEnd())}</span> <span>`);
    }
    expect(t('en', 'card.unsourcedWhich', { figures: '300 and 25' })).toBe('No source for 300 and 25');
    // conversation-new-04 — the warning follows the fold's words; it is not pushed to the far end
    expect(css()).toMatch(/#approve summary \.c \{ color:var\(--color-ink-secondary\); \}/);
  });
});

describe('V1-237 · the card keeps two answers in its row; "No reply needed" stands under them and asks first', () => {
  it('one primary act; the quiet act on its own line, with its question; the press does what it did', () => {
    for (const l of LOCALES) {
      const c = card(renderConversationDetail(draft(), l, NOW, null));
      const row = c.slice(c.indexOf('<div class="acts">'), c.indexOf('</div>', c.indexOf('<div class="acts">')));
      expect(row.match(/<button/g), l).toHaveLength(2);
      expect(c.match(/class="btn send"/g), l).toHaveLength(1);
      const more = c.slice(c.indexOf('<div class="acts-more">'));
      expect(more, l).toContain('name="command" value="不回"');
      expect(more, l).toContain(`data-confirm="${esc(t(l, 'card.noReply.confirm'))}"`);
    }
  });
});

describe('V1-230, V1-231 · the window says until when, in the sentence\'s own case, and what comes after', () => {
  it('"hasta mañana a las 17:18", "jusqu’à demain à 17:18"; and after that, only in the channel\'s app', async () => {
    const { formatUntil } = await import('../../src/core/owner/i18n/format.js');
    const at = new Date('2026-10-03T09:18:00Z');
    expect(formatUntil('es', at, NOW, 'Asia/Shanghai')).toBe('mañana a las 17:18');
    expect(formatUntil('fr', at, NOW, 'Asia/Shanghai')).toBe('demain à 17:18');
    expect(formatUntil('en', at, NOW, 'Asia/Shanghai')).toBe('17:18 tomorrow');
    for (const l of LOCALES) {
      expect(t(l, 'card.window', { channel: 'WhatsApp', time: '17:18' }).split('WhatsApp').length - 1, l).toBe(2);
    }
    expect(t('en', 'card.window', { channel: 'WhatsApp', time: '17:18 tomorrow' })).toBe('WhatsApp takes replies until 17:18 tomorrow; after that, only in the WhatsApp app');
  });
});

describe('V1-244, V1-247 · making the link says it sends nothing, and where the link appears', () => {
  it('before: what pressing does; after: the link to copy, never "sent"', () => {
    for (const l of LOCALES) {
      const before = renderConversationDetail(draft({ proof: { quoteId: 'q-1', token: null } }), l, NOW, null);
      expect(before, l).toContain(esc(t(l, 'proof.owner.none')));
      expect(before, l).toContain(`>${esc(t(l, 'proof.owner.issue'))}</button>`);
      const after = renderConversationDetail(draft({ proof: { quoteId: 'q-1', token: 'tok', url: 'https://app.nomidoes.com/p/tok' } }), l, NOW, null);
      expect(after, l).toContain(esc(t(l, 'proof.owner.live')));
    }
    expect(t('en', 'proof.owner.none')).toContain('Making the link sends nothing');
    expect(t('en', 'proof.owner.live')).not.toMatch(/sent/i);
    expect(css()).toContain('.proofrow > .muted { text-wrap:pretty; }');
  });
});

describe('V1-228, V1-258, V1-259, V1-260 · the quote line: per piece, and "total" kept with its amount', () => {
  it('"$1.45/pc" as the reply says it; each figure a run that never wraps apart', () => {
    for (const l of LOCALES) {
      const html = plain(renderConversationDetail(draft(), l, NOW, null));
      const ctx = html.slice(html.indexOf('<div class="ctx">'));
      expect(ctx, l).toContain(`/${esc(t(l, 'product.unit.pc'))}</bdi>`);
      expect(ctx, l).toContain(`<bdi class="fig">${esc(t(l, 'product.detail.total'))} `);
    }
    expect(plain(renderConversationDetail(draft(), 'en', NOW, null))).toContain('<bdi class="fig">$1.45/pc</bdi>');
    expect(plain(renderConversationDetail(draft(), 'es', NOW, null))).toContain('/ud.</bdi>');
    expect(css()).toContain('.fig { white-space:nowrap; }');
  });
});

describe('V1-242, conversation-missed-03 · the fold\'s rows on a phone', () => {
  it('a product\'s name stays whole where it fits; the source goes under what it explains', () => {
    const c = card(renderConversationDetail(draft(), 'ar', NOW, null));
    expect(c).toContain('<bdi class="pname">LED String Lights 10m</bdi>');
    const sheet = css();
    expect(sheet).toContain('.reasons .pname { display:inline-block; }');
    expect(sheet).toMatch(/@media \(max-width: 560px\) \{\s*\.reasons li \{ grid-template-columns:1\.2em minmax\(0, 1fr\);/);
  });
});

// ── the transcript, the hand-over card, the panes ───────────────────────────

describe('V1-236, V1-261, V1-292 · the customer\'s words have a bubble on a paper page too', () => {
  it('the inbound bubble carries the hairline the outbound one has', () => {
    expect(css()).toMatch(/\.msg\.inbound \.bubble \{[^}]*border:1px solid var\(--color-border\);/);
  });
});

describe('V1-267 · the day is said once, where it changes; each caption gives its time', () => {
  it('a divider per day, and no caption repeats "Today"', () => {
    const two = draft({ pendingDraft: null, status: 'done', messages: [
      { direction: 'inbound', text: 'What plug type?', at: ago(26 * 60) },
      { direction: 'inbound', text: 'Looking for 2,000 pcs.', at: ago(300) },
      { direction: 'outbound', text: 'EU, UK or US plug, same price.', at: ago(235), by: 'employee' },
    ] });
    for (const l of LOCALES) {
      const html = plain(renderConversationDetail(two, l, NOW, null));
      const days = [...html.matchAll(/<p class="tday"><span>([^<]+)<\/span><\/p>/g)].map((m) => m[1]);
      expect(days, l).toHaveLength(2);
      const captions = [...html.matchAll(/<div class="ts muted">([^<]*)/g)].map((m) => m[1]!);
      for (const c of captions) expect(c, l).toMatch(/^\d\d:\d\d/);
    }
    expect([...plain(renderConversationDetail(two, 'en', NOW, null)).matchAll(/<p class="tday"><span>([^<]+)</g)].map((m) => m[1])).toEqual(['Yesterday', 'Today']);
  });
});

describe('V1-265 · every country has its flag', () => {
  it('Brazil as much as Nigeria', async () => {
    const { flag, buyerWho } = await import('../../src/api/web/inbox.js');
    expect(flag('BR')).toBe('🇧🇷');
    expect(flag('NG')).toBe('🇳🇬');
    expect(flag('XX')).toBe('');
    expect(flag(null)).toBe('');
    expect(buyerWho('en', 'Carlos Mendes', 'BR')).toMatch(/^🇧🇷 /);
  });
});

describe('V1-239 · a short conversation does not move on landing', () => {
  it('on a laptop the newest message lands lower, so a page that fits is not scrolled through its header', () => {
    expect(css()).toContain('@media (min-width: 1100px) { #latest { scroll-margin-top:40vh; } }');
  });
});

describe('conversation-new-06, V1-238, V1-263 · the hand-over card reads down, and says when nothing waits', () => {
  it('no dashed box of its own; the line is on the card; the card is a column', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(draft({ pendingDraft: null, status: 'done' }), l, NOW, null);
      expect(html, l).not.toContain(`<div class="empty muted">${esc(t(l, 'inbox.draft.none'))}</div>`);
      const takeover = html.slice(html.indexOf('<div class="card takeover"'), html.indexOf('</div>', html.indexOf('<div class="card takeover"')));
      expect(takeover, l).toContain(`<p class="muted takeover-note">${esc(t(l, 'inbox.draft.none'))}</p>`);
      // with a reply waiting, the card does not say none waits
      expect(renderConversationDetail(draft(), l, NOW, null), l).not.toContain(esc(t(l, 'inbox.draft.none')));
    }
    const sheet = css();
    expect(sheet).toContain('.takeover { display:flex; flex-direction:column; align-items:flex-start; gap:var(--space-8); }');
    expect(sheet).toContain('.takeover > .pill { white-space:normal; margin:0; }');
  });
});

describe('V1-241, V1-235, V1-248 · the panes at a laptop\'s width', () => {
  it('the opened panel takes a column beside the conversation; the pane\'s search and tabs fit its column', () => {
    const sheet = css();
    expect(sheet).toContain('.panes:has(> .panel:target) { grid-template-columns:300px minmax(0, 1fr) 300px; }');
    expect(sheet).toMatch(/\.panes:has\(> \.panel:target\) > \.panel \{ position:sticky;/);
    expect(sheet).toContain('.listpane .search input { flex:1 1 100%; }');
    expect(sheet).toMatch(/\.listpane \.tabs \{[^}]*flex-wrap:nowrap;/);
  });
});

describe('V1-245, V1-246 · Chinese: a Latin name is set off on both sides, everywhere; the search button is a word', () => {
  it('"Lily 起草" and "Lily 正在处理" alike; 你的助手 runs on; 搜索', () => {
    expect(t('zh', 'card.drafted', { name: 'Lily' })).toBe('Lily 起草');
    expect(t('zh', 'takeover.status.ai', { name: 'Lily' })).toBe('Lily 正在处理');
    expect(t('zh', 'conv.tl.quote', { name: 'Lily', detail: 'x' })).toBe('Lily 算出了价格：x');
    expect(t('zh', 'takeover.status.ai')).toBe('你的助手正在处理');
    expect(t('zh', 'card.drafted')).toBe('你的助手起草');
    expect(t('zh', 'buyers.search.go')).toBe('搜索');
  });
});

describe('V1-249 · the ✦ before a row\'s last message says whose it is', () => {
  it('a screen reader hears the name; on the page the mark stands beside the name wherever it leads', () => {
    const list: InboxList = { filter: 'pending', waitingCount: 1, blockedCount: 0,
      conversations: [row('c-1', { awaitingReview: true, lastFrom: 'assistant' })] };
    for (const l of LOCALES) {
      const html = renderListPane(list, l, NOW, 'c-2');
      expect(html, l).toMatch(/<span class="as" aria-hidden="true">✦<\/span><span class="sr">[^<]+<\/span> <span class="cr-text"/);
      const page = renderConversationDetail(draft(), l, NOW, null);
      expect(page, l).toContain(`<span aria-hidden="true">✦</span> ${esc(t(l, 'card.drafted'))}`);
    }
  });
});
