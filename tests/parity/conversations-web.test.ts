import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderCustomerFile, type CustomerFile, type Milestone } from '../../src/api/web/conversations.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

const NOW = new Date('2026-07-27T02:30:00Z'); // 10:30 Beijing
const m = (o: Partial<Milestone> & Pick<Milestone, 'kind' | 'at'>): Milestone =>
  ({ text: null, qty: null, unitPrice: null, orderStatus: null, ...o });

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

/**
 * A (2026-09-28) — the Customers LIST merged into Buyers; its tests (the
 * channel, the search box, the empty states) moved with it, to
 * tests/parity/buyers-merge.test.ts. What stays here is the buyer's own page,
 * which did not move.
 */
describe('M9.7 · the buyer\'s own page (localized)', () => {
  it('buyer profile shows only data that exists', () => {
    const en = renderCustomerFile(file, 'en', NOW);
    // A — one word for one idea: the page is about a BUYER, never a "customer".
    expect(en).toContain('About this buyer'); expect(en).not.toContain('Customer');
    expect(en).toContain('First contact');
    expect(en).toContain('Products of interest'); expect(en).toContain('Quotes'); expect(en).toContain('Orders');
    const bare = renderCustomerFile({ ...file, profile: { ...file.profile, quoteCount: 0, orderCount: 0 } }, 'en', NOW);
    expect(bare).toContain('First contact'); expect(bare).not.toContain('>Quotes<');
  });

  it('timeline milestones localize from neutral kinds; empty state honest', () => {
    const zh = renderCustomerFile(file, 'zh', NOW);
    expect(zh).toContain('沟通记录'); expect(zh).toContain('买家发来产品图片');
    expect(zh).toContain(t('zh', 'conv.tl.quote', { detail: '5000个 · $0.92/个' })); expect(zh).toContain('你确认发送');
    const en = renderCustomerFile(file, 'en', NOW);
    expect(en).toContain('Buyer sent a photo'); expect(en).toContain(t('en', 'conv.tl.quote', { detail: '5,000pcs · $0.92/pcs' }));
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
    // CC-25 — onto the newest message, where the reply waits for her OK.
    // V1 (decision 4) — it goes somewhere, so it is a door, not a button.
    expect(html).toMatch(/class="card need-card">[\s\S]*?<a class="deeper next" href="\/app\/inbox\/c1#latest"/);
    expect(html).not.toMatch(/<a class="btn/);
    // Approving is the inbox's, and only the inbox's: no draft command posts
    // from this page. The one form here (2026-09-18) names the buyer — it
    // posts to this page's own route and carries no draft, no command.
    const forms = [...html.matchAll(/<form[^>]*action="([^"]+)"/g)].map((m) => m[1]);
    // CC-02a — and, for the owner only, the one that records this buyer's
    // request to be deleted. It posts to this page's own route too, and
    // carries a note, never a draft or a command.
    expect(forms).toEqual(['/app/conversations/c1/name', '/app/conversations/c1/deletion']);
    const staff = renderCustomerFile(file, 'en', NOW, null, { isOwner: false });
    expect([...staff.matchAll(/<form[^>]*action="([^"]+)"/g)].map((m) => m[1])).toEqual(['/app/conversations/c1/name']);
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
      const html = renderCustomerFile(file, l, NOW).toLowerCase();
      for (const w of ['ai', 'llm', 'model', 'api', 'webhook', 'automation', 'confidence']) {
        expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      }
      for (const zh of ['模型', '人工智能', '置信度', '准确率']) expect(html.includes(zh), `${l}:${zh}`).toBe(false);
    }
  });

  it('mobile: no tables', () => {
    expect(renderCustomerFile(file, 'en', NOW)).not.toContain('<table');
  });

  it('A — back goes to Buyers, the one list; the page carries no stylesheet of its own', () => {
    for (const l of LOCALES) {
      const html = renderCustomerFile(file, l, NOW);
      expect(html, l).toContain('<a class="back" href="/app/inbox">');
      expect(html, l).not.toContain('href="/app/conversations"');
      expect(html, l).not.toContain('<style');
    }
  });

  it('CC-13 — each locale writes its own lists: no Chinese enumeration comma in English or Arabic', () => {
    const two = { ...file, profile: { ...file.profile, products: [{ name: 'Vacuum cup', nameZh: '保温杯' }, { name: 'Canvas bag', nameZh: '帆布袋' }] },
      context: { ...file.context, corrections: ['quote', 'confirm_order'] } };
    const en = renderCustomerFile(two, 'en', NOW);
    const ar = renderCustomerFile(two, 'ar', NOW);
    const zh = renderCustomerFile(two, 'zh', NOW);
    for (const [l, html] of [['en', en], ['ar', ar]] as const) {
      expect(html, l).not.toContain('、');
      expect(html, l).not.toContain('：');
      expect(html, l).not.toContain('　');
    }
    expect(en).toContain('Vacuum cup and Canvas bag');
    expect(zh).toContain('保温杯和帆布袋');
  });
});
