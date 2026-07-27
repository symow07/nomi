import { describe, it, expect } from 'vitest';
import {
  renderProductList, renderProductDetail, renderAddForm, renderReview, reviewImport,
  type ProductListItem, type ProductDetail,
} from '../../src/api/web/products.js';

const items: ProductListItem[] = [
  { id: 'p1', nameZh: '帆布袋', sku: 'ZX-100', moq: 1000, unit: 'pcs', entryQty: 5000, entryPriceUsd: 0.92, learned: true, imageMatchable: true },
  { id: 'p2', nameZh: '新样品', sku: 'NEW-1', moq: 100, unit: 'pcs', entryQty: null, entryPriceUsd: null, learned: false, imageMatchable: false },
];

const detail: ProductDetail = {
  id: 'p1', nameZh: '帆布袋', nameEn: 'Canvas Tote Bag', sku: 'ZX-100', categoryZh: 'bags',
  unit: 'pcs', moq: 1000, leadTimeDays: 15, customizable: false, learned: true, imageMatchable: true,
  tiers: [{ minQty: 500, maxQty: 2000, unitPriceUsd: 1.05 }, { minQty: 2000, maxQty: null, unitPriceUsd: 0.92 }],
  aliases: ['canvas bag', 'tote bag', '帆布包'],
  images: [],
  recentQuotes: [{ quantity: 5000, unitPriceUsd: 0.92, totalUsd: 4600 }],
};

describe('M9.5 · product list (pure)', () => {
  it('shows name, sku, price, MOQ, status, and image-match capability', () => {
    const html = renderProductList(items);
    expect(html).toContain('产品目录');
    expect(html).toContain('帆布袋');
    expect(html).toContain('ZX-100');
    expect(html).toContain('$0.92');
    expect(html).toContain('最低起订：1000个');
    expect(html).toContain('已学习 ✓');
    expect(html).toContain('可以被图片识别');
    expect(html).toContain('href="/app/products/p1"');
  });

  it('unlearned product shows 需要确认 and 价格待补, no image-match claim', () => {
    const html = renderProductList(items);
    expect(html).toContain('需要确认');
    expect(html).toContain('价格待补');
    // the unlearned product does not claim image recognition
    expect(html).not.toMatch(/新样品[\s\S]*?可以被图片识别/);
  });

  it('empty catalog teaches the next action, never "no data"', () => {
    const html = renderProductList([]);
    expect(html).toContain('上传产品目录开始培训');
    expect(html.toLowerCase()).not.toContain('no data');
  });
});

describe('M9.5 · product detail (pure)', () => {
  it('shows info, pricing tiers, buyer-facing names, and related quotes', () => {
    const html = renderProductDetail(detail);
    expect(html).toContain('帆布袋');
    expect(html).toContain('Canvas Tote Bag');
    expect(html).toContain('价格');
    expect(html).toContain('$1.05'); expect(html).toContain('$0.92');
    expect(html).toContain('买家怎么称呼它');
    for (const a of detail.aliases) expect(html).toContain(a);
    expect(html).toContain('可以被图片识别');
    expect(html).toContain('最近报过的价');
    expect(html).toContain('共 $4,600.00');
  });

  it('escapes buyer-facing aliases (untrusted content)', () => {
    const html = renderProductDetail({ ...detail, aliases: ['<script>alert(1)</script>'] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('M9.5 · teach flow (parser reuse + trust rule)', () => {
  it('review parses pasted price lines (reuses the M6 parser)', () => {
    const v = reviewImport('帆布袋 1.05美元 500个起\n保温杯 $2.60 MOQ 1000\n随便聊两句');
    expect(v.accepted.length).toBeGreaterThanOrEqual(2);
    expect(v.accepted[0]!.name).toContain('帆布袋');
    expect(v.accepted[0]!.priceUsd).toBe(1.05);
  });

  it('a price-less line is accepted as 需要确认 in the review, never auto-priced', () => {
    const v = reviewImport('新款化妆包');
    const html = renderReview(v, '新款化妆包');
    expect(html).toContain('需要确认');
    expect(html).toContain('价格待补');
    // confirm form carries the raw text for a deterministic re-parse
    expect(html).toContain('action="/app/products/add/confirm"');
    expect(html).toContain('name="text"');
  });

  it('add form promises nothing is enabled before confirmation', () => {
    const html = renderAddForm();
    expect(html).toContain('教她认产品');
    expect(html).toContain('确认之前，什么都不会启用');
    expect(html).toContain('没有价格的产品会标「需要确认」');
  });
});

describe('M9.5 · owner language + mobile', () => {
  const all = renderProductList(items) + renderProductDetail(detail) + renderAddForm();
  it('no technical / AI vocabulary', () => {
    const lower = all.toLowerCase();
    for (const banned of ['ai', 'llm', 'model', 'api', 'token', 'database', 'webhook', 'sku=', '模型', '人工智能', 'retrieval', 'embedding']) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z_ =]+$/.test(needle) ? new RegExp(`\\b${needle.replace(/=/g, '\\=')}`).test(lower) : lower.includes(needle);
      expect(hit, `"${banned}"`).toBe(false);
    }
  });
  it('no tables', () => { expect(all).not.toContain('<table'); });
});
