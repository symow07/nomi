import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderProductList, renderProductDetail, renderAddForm, renderReview, reviewImport,
  type ProductListItem, type ProductDetail,
} from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

const items: ProductListItem[] = [
  { id: 'p1', name: 'Canvas bag', nameZh: '帆布袋', sku: 'ZX-100', moq: 1000, unit: 'pcs', entryQty: 5000, entryPrice: usd(0.92), learned: true, status: 'learned', imageMatchable: true, isActive: true },
  { id: 'p2', name: 'New sample', nameZh: '新样品', sku: 'NEW-1', moq: 100, unit: 'pcs', entryQty: null, entryPrice: null, learned: false, status: 'needs_price', imageMatchable: false, isActive: true },
];

const detail: ProductDetail = {
  id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', category: 'bags',
  unit: 'pcs', moq: 1000, leadTimeDays: 15, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: true,
  tiers: [{ minQty: 500, maxQty: 2000, unitPrice: usd(1.05) }, { minQty: 2000, maxQty: null, unitPrice: usd(0.92) }],
  aliases: ['canvas bag', 'tote bag', '帆布包'],
  images: [],
  recentQuotes: [{ quantity: 5000, unitPrice: usd(0.92), total: usd(4600) }],
};

describe('M9.5 · product list (localized)', () => {
  it('zh: prefers name_zh; shows sku, price, MOQ, status, image-match', () => {
    const html = renderProductList(items, 'zh');
    expect(html).toContain('产品目录'); expect(html).toContain('帆布袋'); expect(html).toContain('ZX-100');
    expect(html).toContain('$0.92');
    expect(html).toContain('最低起订: 1000个');
    expect(html).toContain('已学习 ✓'); expect(html).toContain('可以被图片识别');
    expect(html).toContain('href="/app/products/p1"');
    expect(html).toContain('需要价格'); expect(html).toContain('价格待补');
  });

  it('en: uses the neutral latin name; localized chrome', () => {
    const html = renderProductList(items, 'en');
    expect(html).toContain('Products'); expect(html).toContain('Canvas bag');
    expect(html).toContain('Min. order: 1,000pcs');
    expect(html).toContain('Learned ✓'); expect(html).toContain('Recognizable by photo');
    expect(html).toContain('Needs a price'); expect(html).toContain('Price to add');
    expect(html).not.toContain('帆布袋');   // zh name not shown in en list
  });

  it('empty catalog teaches the next action per locale, never "no data"', () => {
    expect(renderProductList([], 'en')).toContain('Upload your catalog to start');
    expect(renderProductList([], 'zh')).toContain('上传产品目录开始培训');
    expect(renderProductList([], 'ar')).toContain('ارفع قائمتك للبدء');
    expect(renderProductList([], 'en').toLowerCase()).not.toContain('no data');
  });
});

describe('M9.5 · product detail (localized)', () => {
  it('en: title=latin name, alt=chinese name, tiers, aliases, quotes', () => {
    const html = renderProductDetail(detail, 'en');
    expect(html).toContain('Canvas Tote Bag');
    expect(html).toContain('帆布袋');            // shown as the alternate name
    expect(html).toContain('Pricing');
    expect(html).toContain('$1.05'); expect(html).toContain('$0.92');
    expect(html).toContain('What buyers call it');
    for (const a of detail.aliases) expect(html).toContain(a);
    expect(html).toContain('Recent quotes');
    expect(html).toContain('total $4,600.00');
  });

  it('zh: title=chinese name; ar: Arabic chrome', () => {
    expect(renderProductDetail(detail, 'zh')).toContain('买家怎么称呼它');
    const ar = renderProductDetail(detail, 'ar');
    expect(ar).toContain('الأسعار'); expect(ar).toContain('ما يسمّيه المشترون');
  });

  it('escapes buyer-facing aliases (untrusted content)', () => {
    const html = renderProductDetail({ ...detail, aliases: ['<script>alert(1)</script>'] }, 'en');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('M9.5 · teach flow (parser reuse + trust rule)', () => {
  it('review reuses the M6 parser (product names are data, any UI locale)', () => {
    const v = reviewImport('帆布袋 1.05美元 500个起\n保温杯 $2.60 MOQ 1000\n随便聊两句');
    expect(v.accepted.length).toBeGreaterThanOrEqual(2);
    expect(v.accepted[0]!.name).toContain('帆布袋');
    expect(v.accepted[0]!.price).toEqual(usd(1.05));
  });

  it('a price-less line is "Needs a price" in the review, never auto-priced', () => {
    const v = reviewImport('新款化妆包');
    const en = renderReview(v, '新款化妆包', 'en');
    expect(en).toContain('Needs a price'); expect(en).toContain('Price to add');
    expect(en).toContain('action="/app/products/add/confirm"'); expect(en).toContain('name="text"');
    expect(renderReview(v, '新款化妆包', 'zh')).toContain('需要价格');
  });

  it('rejected reasons localize from the reason code', () => {
    const v = reviewImport('x\n帆布袋 $1\n帆布袋 $1'); // too-short name + duplicate
    expect(renderReview(v, 'x', 'en')).toMatch(/name unclear|duplicate/);
    expect(renderReview(v, 'x', 'zh')).toMatch(/名字没认出来|重复了/);
  });

  it('add form promises nothing is enabled before confirmation — per locale', () => {
    expect(renderAddForm('zh')).toContain('确认之前，什么都不会启用');
    const en = renderAddForm('en');
    expect(en).toContain('Teach her products');
    expect(en).toContain('Nothing is enabled until you confirm');
  });
});

describe('M9.5 · owner language + mobile (every locale)', () => {
  it('no technical / AI vocabulary', () => {
    for (const l of LOCALES) {
      const all = (renderProductList(items, l) + renderProductDetail(detail, l) + renderAddForm(l)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'api', 'token', 'database', 'webhook', '模型', '人工智能', 'retrieval', 'embedding']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });
  it('no tables', () => { expect(renderProductList(items, 'en')).not.toContain('<table'); });
});

/**
 * D1 — "Needs a price" beside a price. Every imported product said that, and
 * what it actually needed was one page away and unnamed. The badge now says
 * which of three different things is missing.
 */
describe('D1 · the badge says WHAT is missing', () => {
  it('four states from three facts, and a priced product never reads "needs a price"', async () => {
    const { productStatus } = await import('../../src/api/web/products.js');
    expect(productStatus({ isActive: false, hasPrice: false, hasLimits: false })).toBe('needs_price');
    expect(productStatus({ isActive: true, hasPrice: false, hasLimits: true }), 'no price is never learned').toBe('needs_price');
    expect(productStatus({ isActive: false, hasPrice: true, hasLimits: false })).toBe('needs_limits');
    expect(productStatus({ isActive: false, hasPrice: true, hasLimits: true })).toBe('not_offered');
    expect(productStatus({ isActive: true, hasPrice: true, hasLimits: true })).toBe('learned');
  });

  it('the list names the next step once, with a way there, and shows what the import said', () => {
    const waiting: ProductListItem[] = [
      { ...items[0]!, id: 'w1', learned: false, status: 'needs_limits', isActive: false },
      { ...items[0]!, id: 'w2', learned: false, status: 'needs_limits', isActive: false },
      { ...items[0]!, id: 'o1', learned: false, status: 'not_offered', isActive: false },
    ];
    const html = renderProductList(waiting, 'en', 'Added 3 products.');
    expect(html).toContain('Added 3 products.');
    expect(html).toContain(t('en', 'product.list.needLimits', { n: 2 }));
    expect(html).toContain('href="/app/factory/prices"');
    expect(html.split(t('en', 'product.status.needsLimits')).length - 1).toBe(2);
    expect(html).toContain(t('en', 'product.status.notOffered'));
    expect(html).not.toContain(t('en', 'product.status.needsConfirm'));
    expect(renderProductList(items, 'en'), 'nothing waiting, nothing said').not.toContain('/app/factory/prices');
  });
});

