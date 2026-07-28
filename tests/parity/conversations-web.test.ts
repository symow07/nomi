import { describe, it, expect } from 'vitest';
import {
  renderCustomerList, renderCustomerFile, type CustomerList, type CustomerFile,
} from '../../src/api/web/conversations.js';

const NOW = new Date('2026-07-27T02:30:00Z'); // 10:30 Beijing

const list: CustomerList = {
  query: '',
  customers: [
    { conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channelZh: 'WhatsApp',
      statusZh: '等待确认', statusTone: 'warn', needsOwner: true, productsZh: ['保温杯'],
      lastActivity: new Date('2026-07-27T02:30:00Z') },
    { conversationId: 'c2', buyer: 'Ivan', country: 'RU', channelZh: 'WhatsApp',
      statusZh: '已报价', statusTone: 'ok', needsOwner: false, productsZh: ['帆布袋'],
      lastActivity: new Date('2026-07-20T02:30:00Z') },
  ],
};

const file: CustomerFile = {
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channelZh: 'WhatsApp',
  statusZh: '等待确认', statusTone: 'warn', needsOwner: true,
  profile: { firstContact: new Date('2026-07-01T00:00:00Z'), productsZh: ['保温杯'], quoteCount: 3, orderCount: 1 },
  timeline: [
    { icon: '💬', kind: 'buyer', textZh: '买家发来产品图片', at: new Date('2026-07-10T02:00:00Z') },
    { icon: '💰', kind: 'quote', textZh: '小雅报价：5000个 · $0.92/个', at: new Date('2026-07-10T03:00:00Z') },
    { icon: '👤', kind: 'owner', textZh: '老板确认发送', at: new Date('2026-07-10T04:00:00Z') },
  ],
  context: {
    products: [{ sku: 'ZX-100', nameZh: '帆布袋' }],
    latestQuote: { qty: 5000, unitUsd: 0.92, totalUsd: 4600 },
    order: { statusZh: '已成交', reference: 'ORD-1', qty: 5000, totalUsd: 4600 },
    corrections: ['交期'],
  },
};

describe('M9.7 · conversations / customer memory (pure)', () => {
  it('list renders each customer: buyer, channel, status, product, last activity', () => {
    const html = renderCustomerList(list, NOW);
    expect(html).toContain('客户');
    expect(html).toContain('Ahmed');
    expect(html).toContain('🇦🇪');
    expect(html).toContain('阿联酋');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('等待确认');
    expect(html).toContain('保温杯');
    expect(html).toContain('最后联系：今天');
    expect(html).toContain('href="/app/conversations/c1"');
  });

  it('list has a simple search box that keeps the query', () => {
    const q = renderCustomerList({ ...list, query: 'Ahmed' }, NOW);
    expect(q).toContain('name="q"');
    expect(q).toContain('value="Ahmed"');
    expect(q).toContain('清除'); // clear link appears when a query is active
  });

  it('empty states are honest — never "no data"', () => {
    const none = renderCustomerList({ query: '', customers: [] }, NOW);
    expect(none).toContain('暂无客户记录');
    expect(none).not.toContain('no data');
    const noHit = renderCustomerList({ query: '张三', customers: [] }, NOW);
    expect(noHit).toContain('没找到「张三」');
  });

  it('buyer profile shows only data that exists', () => {
    const html = renderCustomerFile(file, NOW);
    expect(html).toContain('客户档案');
    expect(html).toContain('首次联系');
    expect(html).toContain('关注产品');
    expect(html).toContain('报价次数');
    expect(html).toContain('订单');
    // when quotes/orders are zero, those rows disappear
    const bare = renderCustomerFile({ ...file, profile: { ...file.profile, quoteCount: 0, orderCount: 0 } }, NOW);
    expect(bare).toContain('首次联系');
    expect(bare).not.toContain('报价次数');
  });

  it('relationship timeline renders milestones; empty state is honest', () => {
    const html = renderCustomerFile(file, NOW);
    expect(html).toContain('沟通记录');
    expect(html).toContain('买家发来产品图片');
    expect(html).toContain('小雅报价：5000个');
    expect(html).toContain('老板确认发送');
    const empty = renderCustomerFile({ ...file, timeline: [] }, NOW);
    expect(empty).toContain('还没有沟通记录');
  });

  it('business context shows products, quote, order, and owner corrections', () => {
    const html = renderCustomerFile(file, NOW);
    expect(html).toContain('业务往来');
    expect(html).toContain('ZX-100');
    expect(html).toContain('$0.92/个');
    expect(html).toContain('ORD-1');
    expect(html).toContain('已成交');
    expect(html).toContain('老板曾修改');
    expect(html).toContain('交期');
    // context section vanishes entirely when nothing exists
    const empty = renderCustomerFile({ ...file, context: { products: [], latestQuote: null, order: null, corrections: [] } }, NOW);
    expect(empty).not.toContain('业务往来');
  });

  it('needsOwner links to the inbox (the one action path) — no approval form here', () => {
    const html = renderCustomerFile(file, NOW);
    expect(html).toContain('href="/app/inbox/c1"');
    expect(html).not.toContain('<form method="post"');
  });

  it('escapes buyer text and messages (no XSS)', () => {
    const evil = renderCustomerFile({
      ...file, buyer: '<script>x</script>',
      timeline: [{ icon: '💬', kind: 'buyer', textZh: '买家：<img src=x onerror=1>', at: NOW }],
    }, NOW);
    expect(evil).not.toContain('<script>x');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).not.toContain('<img src=x');
    expect(evil).toContain('&lt;img');
  });

  it('no technical vocabulary anywhere', () => {
    const html = (renderCustomerList(list, NOW) + renderCustomerFile(file, NOW)).toLowerCase();
    for (const w of ['\\bai\\b', '\\bllm\\b', '\\bmodel\\b', '\\bapi\\b', '\\bwebhook\\b',
      '\\bautomation\\b', '\\bconfidence\\b']) {
      expect(new RegExp(w).test(html), w).toBe(false);
    }
    for (const zh of ['模型', '人工智能', '置信度', '准确率']) {
      expect(html.includes(zh), zh).toBe(false);
    }
  });

  it('mobile: no tables anywhere', () => {
    expect(renderCustomerList(list, NOW)).not.toContain('<table');
    expect(renderCustomerFile(file, NOW)).not.toContain('<table');
  });
});
