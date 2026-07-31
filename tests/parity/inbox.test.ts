import { describe, it, expect } from 'vitest';
import {
  renderInboxList, renderConversationDetail, defaultFilter,
  type InboxList, type ConversationDetail,
} from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const NOW = new Date('2026-07-27T10:00:00Z');

const listWithWork: InboxList = {
  filter: 'pending', waitingCount: 1,
  conversations: [{
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE',
    status: 'awaiting', needsAction: true,
    latestMessage: 'Can you do 5000 pcs?', latestAt: NOW,
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000, unitPriceUsd: 0.92,
  }],
};

const detailWithDraft: ConversationDetail = {
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
  quote: { unitPriceUsd: 0.92, totalUsd: 4600, quantity: 5000 },
  order: null,
  messages: [
    { direction: 'inbound', text: 'Price for 5000?', at: new Date('2026-07-27T09:00:00Z') },
    { direction: 'outbound', text: 'Checking for you.', at: new Date('2026-07-27T09:01:00Z') },
  ],
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.' },
  ownership: 'AI', handoffReasons: [],
};

describe('M9.3 · inbox list (localized)', () => {
  it('zh: buyer, country, status, product, deep link', () => {
    const html = renderInboxList(listWithWork, 'zh', NOW);
    expect(html).toContain('收件箱'); expect(html).toContain('Ahmed'); expect(html).toContain('🇦🇪');
    expect(html).toContain('等你确认'); expect(html).toContain('需要你处理');
    expect(html).toContain('保温杯'); expect(html).toContain('5000个'); expect(html).toContain('$0.92');
    expect(html).toContain('href="/app/inbox/conv-1"');
  });

  it('en: localized chrome, latin product name', () => {
    const html = renderInboxList(listWithWork, 'en', NOW);
    expect(html).toContain('Inbox'); expect(html).toContain('Awaiting you');
    expect(html).toContain('Needs your attention'); expect(html).toContain('Vacuum cup');
    expect(html).toContain('5,000pcs');
    expect(html).not.toContain('保温杯');
  });

  it('empty pending → all-good per locale, not "no data"', () => {
    expect(renderInboxList({ filter: 'pending', waitingCount: 0, conversations: [] }, 'zh', NOW)).toContain('一切正常，不用管');
    const en = renderInboxList({ filter: 'pending', waitingCount: 0, conversations: [] }, 'en', NOW);
    expect(en).toContain('All good');
    expect(en.toLowerCase()).not.toContain('no data');
  });

  it('empty all → explains the next action', () => {
    expect(renderInboxList({ filter: 'all', waitingCount: 0, conversations: [] }, 'en', NOW)).toContain('No conversations yet');
  });

  it('default filter opens pending only when work is waiting', () => {
    expect(defaultFilter(2)).toBe('pending');
    expect(defaultFilter(0)).toBe('all');
  });
});

describe('M9.3 · conversation detail (localized)', () => {
  it('chronological, sender-distinguished timeline (buyer / employee per locale)', () => {
    const html = renderConversationDetail(detailWithDraft, 'zh', NOW, null);
    const inbound = html.indexOf('Price for 5000?');
    const outbound = html.indexOf('Checking for you.');
    expect(outbound).toBeGreaterThan(inbound);
    expect(html).toContain('msg inbound'); expect(html).toContain('msg outbound');
    expect(html).toContain('买家'); expect(html).toContain('小雅');
    expect(renderConversationDetail(detailWithDraft, 'en', NOW, null)).toContain('Lily');
  });

  it('pending draft: four actions, wire-command VALUES preserved, labels localized', () => {
    const html = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(html).toContain('Lily is waiting for your OK');
    expect(html).toContain('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    expect(html).toContain('action="/app/inbox/conv-1/act"');
    for (const v of ['发送', '不回', '收回', '改']) expect(html).toContain(`value="${v}"`);  // wire protocol
    expect(html).toContain('Send'); expect(html).toContain('Skip');   // localized labels
    expect(html).toContain('name="draftId" value="d-1"');
    expect(html).toContain('<textarea');
  });

  it('quote/order context localized, omitted cleanly when absent', () => {
    const en = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(en).toContain('Quote'); expect(en).toContain('total $4,600.00');
    expect(renderConversationDetail(detailWithDraft, 'zh', NOW, null)).toContain('报价');
    const noCtx = renderConversationDetail({ ...detailWithDraft, quote: null, order: null }, 'en', NOW, null);
    expect(noCtx).not.toContain('class="ctx"');
  });

  it('no pending draft → honest "nothing to confirm" state', () => {
    const html = renderConversationDetail({ ...detailWithDraft, pendingDraft: null }, 'en', NOW, null);
    expect(html).toContain('No reply is waiting');
    expect(html).not.toContain('Lily is waiting for your OK');
  });

  it('flash shown when present', () => {
    expect(renderConversationDetail(detailWithDraft, 'zh', NOW, '已发送。')).toContain('已发送。');
  });
});

describe('M9.3 · owner language + security (every locale)', () => {
  it('no technical / AI vocabulary', () => {
    for (const l of LOCALES) {
      const all = (renderInboxList(listWithWork, l, NOW) + renderConversationDetail(detailWithDraft, l, NOW, null)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'token', 'database', 'webhook', 'confidence', '模型', '人工智能', '数据库', 'draft_pending', 'autonomy']) {
        const hit = /^[a-z_ ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('no tables', () => { expect(renderInboxList(listWithWork, 'en', NOW)).not.toContain('<table'); });

  it('escapes buyer-controlled text', () => {
    const evil = renderConversationDetail({
      ...detailWithDraft, buyer: '<script>alert(1)</script>',
      messages: [{ direction: 'inbound', text: '<img src=x onerror=alert(1)>', at: NOW }],
      pendingDraft: { draftId: 'd', draftText: '</textarea><script>bad()</script>' },
    }, 'en', NOW, null);
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror');
    expect(evil).not.toContain('<script>bad()</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});
