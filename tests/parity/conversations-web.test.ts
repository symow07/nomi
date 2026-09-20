import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderCustomerList, renderCustomerFile, type CustomerList, type CustomerFile, type Milestone,
} from '../../src/api/web/conversations.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const NOW = new Date('2026-07-27T02:30:00Z'); // 10:30 Beijing
const m = (o: Partial<Milestone> & Pick<Milestone, 'kind' | 'at'>): Milestone =>
  ({ text: null, qty: null, unitPrice: null, orderStatus: null, ...o });

const list: CustomerList = {
  query: '',
  customers: [
    { conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
      status: { t: 'awaiting' }, statusTone: 'warn', needsOwner: true,
      product: { name: 'Vacuum cup', nameZh: '保温杯' }, lastActivity: NOW },
    { conversationId: 'c2', buyer: 'Ivan', country: 'RU', channel: 'whatsapp',
      status: { t: 'quoted' }, statusTone: 'ok', needsOwner: false,
      product: { name: 'Canvas bag', nameZh: '帆布袋' }, lastActivity: new Date('2026-07-20T02:30:00Z') },
  ],
};

const file: CustomerFile = {
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
  status: { t: 'awaiting' }, statusTone: 'warn', needsOwner: true,
  profile: { firstContact: new Date('2026-07-01T00:00:00Z'), products: [{ name: 'Vacuum cup', nameZh: '保温杯' }], quoteCount: 3, orderCount: 1 },
  timeline: [
    m({ kind: 'buyer_image', at: new Date('2026-07-10T02:00:00Z') }),
    m({ kind: 'quote', at: new Date('2026-07-10T03:00:00Z'), qty: 5000, unitPrice: usd(0.92) }),
    m({ kind: 'owner_approved', at: new Date('2026-07-10T04:00:00Z') }),
  ],
  context: {
    products: [{ sku: 'ZX-100', name: 'Canvas bag', nameZh: '帆布袋' }],
    latestQuote: { qty: 5000, unitPrice: usd(0.92), total: usd(4600) },
    order: { status: 'confirmed', reference: 'ORD-1', qty: 5000, total: usd(4600) },
    corrections: ['quote'],   // capability code
  },
};

describe('M9.7 · conversations / customer memory (localized)', () => {
  it('zh list: buyer, country, channel, status, product, last activity', () => {
    const html = renderCustomerList(list, 'zh', NOW);
    expect(html).toContain('客户'); expect(html).toContain('Ahmed'); expect(html).toContain('🇦🇪');
    expect(html).toContain('阿联酋'); expect(html).toContain('WhatsApp'); expect(html).toContain('等待确认');
    expect(html).toContain('保温杯'); expect(html).toContain('最后联系：今天');
    expect(html).toContain('href="/app/conversations/c1"');
  });

  it('en list: latin product name + localized chrome', () => {
    const html = renderCustomerList(list, 'en', NOW);
    expect(html).toContain('Customers'); expect(html).toContain('Vacuum cup');
    expect(html).toContain('Awaiting confirmation'); expect(html).toContain('Last contact');
    expect(html).not.toContain('保温杯');
  });

  it('search box keeps the query (per locale)', () => {
    const q = renderCustomerList({ ...list, query: 'Ahmed' }, 'en', NOW);
    expect(q).toContain('name="q"'); expect(q).toContain('value="Ahmed"'); expect(q).toContain('Clear');
  });

  it('empty states are honest, never "no data"', () => {
    // M34.8 — this pinned the literal string 暂无客户记录 while its own name
    // forbade "no data". 暂无 IS the dead-end phrase M2 banned, so the test was
    // holding the violation in place. It now asserts the RULE, in both
    // directions, and the copy was fixed rather than the assertion relaxed.
    const zh = renderCustomerList({ query: '', customers: [] }, 'zh', NOW);
    expect(zh).toContain('还没有客户');
    for (const dead of ['暂无', '无数据']) expect(zh).not.toContain(dead);
    const en = renderCustomerList({ query: '', customers: [] }, 'en', NOW);
    expect(en).toContain('No customers yet'); expect(en.toLowerCase()).not.toContain('no data');
    expect(renderCustomerList({ query: '张三', customers: [] }, 'zh', NOW)).toContain('没找到「张三」');
    const bob = renderCustomerList({ query: 'Bob', customers: [] }, 'en', NOW);
    expect(bob).toContain('No customers match'); expect(bob).toContain('Bob');
  });

  it('buyer profile shows only data that exists', () => {
    const en = renderCustomerFile(file, 'en', NOW);
    expect(en).toContain('Customer file'); expect(en).toContain('First contact');
    expect(en).toContain('Products of interest'); expect(en).toContain('Quotes'); expect(en).toContain('Orders');
    const bare = renderCustomerFile({ ...file, profile: { ...file.profile, quoteCount: 0, orderCount: 0 } }, 'en', NOW);
    expect(bare).toContain('First contact'); expect(bare).not.toContain('>Quotes<');
  });

  it('timeline milestones localize from neutral kinds; empty state honest', () => {
    const zh = renderCustomerFile(file, 'zh', NOW);
    expect(zh).toContain('沟通记录'); expect(zh).toContain('买家发来产品图片');
    expect(zh).toContain('小雅报价：5000个 · $0.92/个'); expect(zh).toContain('你确认发送');
    const en = renderCustomerFile(file, 'en', NOW);
    expect(en).toContain('Buyer sent a photo'); expect(en).toContain('Lily quoted: 5,000pcs · $0.92/pcs');
    expect(en).toContain('You approved sending');
    expect(renderCustomerFile({ ...file, timeline: [] }, 'en', NOW)).toContain('No history yet');
  });

  it('business context: products, quote, order, corrections (capability names)', () => {
    const en = renderCustomerFile(file, 'en', NOW);
    expect(en).toContain('Business'); expect(en).toContain('ZX-100'); expect(en).toContain('$0.92/pcs');
    expect(en).toContain('ORD-1'); expect(en).toContain('Confirmed');
    expect(en).toContain('You corrected'); expect(en).toContain('Quoting');   // capability 'quote' localized
    expect(renderCustomerFile(file, 'zh', NOW)).toContain('报价');
    const empty = renderCustomerFile({ ...file, context: { products: [], latestQuote: null, order: null, corrections: [] } }, 'en', NOW);
    expect(empty).not.toContain('>Business<');
  });

  it('needsOwner links to the inbox — no approval form here', () => {
    const html = renderCustomerFile(file, 'en', NOW);
    expect(html).toContain('href="/app/inbox/c1"');
    // Approving is the inbox's, and only the inbox's: no draft command posts
    // from this page. The one form here (2026-09-18) names the buyer — it
    // posts to this page's own route and carries no draft, no command.
    const forms = [...html.matchAll(/<form[^>]*action="([^"]+)"/g)].map((m) => m[1]);
    expect(forms).toEqual(['/app/conversations/c1/name']);
    expect(html).not.toContain('name="command"');
    expect(html).not.toContain('name="draftId"');
  });

  it('what she calls him is hers to change here — prefilled, capped, escaped', () => {
    const html = renderCustomerFile({ ...file, buyer: 'Ahmed "the Fast" <Al-Farsi>' }, 'en', NOW);
    expect(html).toContain('value="Ahmed &quot;the Fast&quot; &lt;Al-Farsi&gt;"');
    expect(html).toContain('maxlength="80"');
    // And a saved change is confirmed on the page she lands back on.
    expect(renderCustomerFile(file, 'zh', NOW, { text: '称呼已保存。', bad: false })).toContain('称呼已保存。');
  });

  it('escapes buyer text and messages (no XSS)', () => {
    const evil = renderCustomerFile({
      ...file, buyer: '<script>x</script>',
      timeline: [m({ kind: 'buyer_text', at: NOW, text: '<img src=x onerror=1>' })],
    }, 'en', NOW);
    expect(evil).not.toContain('<script>x'); expect(evil).toContain('&lt;script&gt;');
    expect(evil).not.toContain('<img src=x'); expect(evil).toContain('&lt;img');
  });

  it('no technical vocabulary — every locale', () => {
    for (const l of LOCALES) {
      const html = (renderCustomerList(list, l, NOW) + renderCustomerFile(file, l, NOW)).toLowerCase();
      for (const w of ['ai', 'llm', 'model', 'api', 'webhook', 'automation', 'confidence']) {
        expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      }
      for (const zh of ['模型', '人工智能', '置信度', '准确率']) expect(html.includes(zh), `${l}:${zh}`).toBe(false);
    }
  });

  it('mobile: no tables', () => {
    expect(renderCustomerList(list, 'en', NOW)).not.toContain('<table');
    expect(renderCustomerFile(file, 'en', NOW)).not.toContain('<table');
  });
});
