import { describe, it, expect } from 'vitest';
import {
  renderInboxList, renderConversationDetail, defaultFilter,
  type InboxList, type ConversationDetail,
} from '../../src/api/web/inbox.js';

const NOW = new Date('2026-07-27T10:00:00Z');

const listWithWork: InboxList = {
  filter: '等你处理', waitingCount: 1,
  conversations: [{
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE',
    statusZh: '等你确认', needsAction: true,
    latestMessage: 'Can you do 5000 pcs?', latestAt: NOW,
    productZh: '保温杯', quantity: 5000, unitPriceUsd: 0.92,
  }],
};

const detailWithDraft: ConversationDetail = {
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', statusZh: '等你确认',
  productZh: '保温杯', quantity: 5000,
  quote: { unitPriceUsd: 0.92, totalUsd: 4600, quantity: 5000 },
  order: null,
  messages: [
    { direction: 'inbound', text: 'Price for 5000?', at: new Date('2026-07-27T09:00:00Z') },
    { direction: 'outbound', text: 'Checking for you.', at: new Date('2026-07-27T09:01:00Z') },
  ],
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.' },
};

describe('M9.3 · inbox list (pure)', () => {
  it('shows buyer, country, status, product context, and links to the exact conversation', () => {
    const html = renderInboxList(listWithWork, NOW);
    expect(html).toContain('收件箱');
    expect(html).toContain('Ahmed');
    expect(html).toContain('🇦🇪');
    expect(html).toContain('等你确认');
    expect(html).toContain('需要你处理');
    expect(html).toContain('保温杯');
    expect(html).toContain('5000个');
    expect(html).toContain('$0.92');
    expect(html).toContain('href="/app/inbox/conv-1"');   // deep link
  });

  it('empty 等你处理 → 一切正常, not "no data"', () => {
    const html = renderInboxList({ filter: '等你处理', waitingCount: 0, conversations: [] }, NOW);
    expect(html).toContain('一切正常，不用管');
    expect(html.toLowerCase()).not.toContain('no data');
  });

  it('empty 全部 → explains the next action', () => {
    const html = renderInboxList({ filter: '全部', waitingCount: 0, conversations: [] }, NOW);
    expect(html).toContain('还没有对话');
    expect(html).toContain('WhatsApp');
  });

  it('default filter opens 等你处理 only when work is waiting', () => {
    expect(defaultFilter(2)).toBe('等你处理');
    expect(defaultFilter(0)).toBe('全部');
  });
});

describe('M9.3 · conversation detail (pure)', () => {
  it('renders a chronological, sender-distinguished timeline', () => {
    const html = renderConversationDetail(detailWithDraft, NOW, null);
    const inbound = html.indexOf('Price for 5000?');
    const outbound = html.indexOf('Checking for you.');
    expect(inbound).toBeGreaterThan(-1);
    expect(outbound).toBeGreaterThan(inbound);          // chronological
    expect(html).toContain('msg inbound');
    expect(html).toContain('msg outbound');
    expect(html).toContain('买家'); expect(html).toContain('小雅');
  });

  it('pending draft renders with the four actions, all posting to /act', () => {
    const html = renderConversationDetail(detailWithDraft, NOW, null);
    expect(html).toContain('小雅等你确认');
    expect(html).toContain('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    expect(html).toContain('action="/app/inbox/conv-1/act"');
    for (const v of ['发送', '不回', '收回', '改']) expect(html).toContain(`value="${v}"`);
    expect(html).toContain('method="post"');
    expect(html).toContain('name="draftId" value="d-1"');
    expect(html).toContain('<textarea');                 // edit path
  });

  it('shows quote/order context when present, omits cleanly when absent', () => {
    const withCtx = renderConversationDetail(detailWithDraft, NOW, null);
    expect(withCtx).toContain('报价');
    expect(withCtx).toContain('共 $4,600.00');
    const noCtx = renderConversationDetail({ ...detailWithDraft, quote: null, order: null }, NOW, null);
    expect(noCtx).not.toContain('报价</span>');           // no empty context card
  });

  it('no pending draft → honest "nothing to confirm" state', () => {
    const html = renderConversationDetail({ ...detailWithDraft, pendingDraft: null }, NOW, null);
    expect(html).toContain('没有需要你确认');
    expect(html).not.toContain('小雅等你确认');
  });

  it('flash message is shown when present (post/redirect/get result)', () => {
    expect(renderConversationDetail(detailWithDraft, NOW, '已发送。')).toContain('已发送。');
  });
});

describe('M9.3 · owner language + security', () => {
  const all = renderInboxList(listWithWork, NOW) + renderConversationDetail(detailWithDraft, NOW, null);

  it('no technical / AI vocabulary', () => {
    const lower = all.toLowerCase();
    for (const banned of ['ai', 'llm', 'model', 'token', 'database', 'webhook', 'confidence', '模型', '人工智能', '数据库', 'draft_pending', 'autonomy']) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z_ ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(lower) : lower.includes(needle);
      expect(hit, `"${banned}"`).toBe(false);
    }
  });

  it('mobile-first: no tables', () => {
    expect(all).not.toContain('<table');
  });

  it('escapes buyer-controlled text (name, message, draft)', () => {
    const evil = renderConversationDetail({
      ...detailWithDraft, buyer: '<script>alert(1)</script>',
      messages: [{ direction: 'inbound', text: '<img src=x onerror=alert(1)>', at: NOW }],
      pendingDraft: { draftId: 'd', draftText: '</textarea><script>bad()</script>' },
    }, NOW, null);
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror');
    expect(evil).not.toContain('<script>bad()</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});
