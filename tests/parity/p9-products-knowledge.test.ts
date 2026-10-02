import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderProductList, renderProductDetail, renderAddForm, renderPricesToMe, renderOpenImport, isUuid,
  type ProductListItem, type ProductDetail,
} from '../../src/api/web/products.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc, shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';

/**
 * Phase 9, round two — Products, the product page, the add page and the
 * import review, price limits, Knowledge and the price-list export. Each test
 * reads the page again after the change, in the locales where it matters, and
 * names the finding it holds.
 */

const NBSP = ' ';
const plain = (s: string): string => s.replace(/[\u2066-\u2069\u200f]/g, '');

const item = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', moq: 500, unit: 'pcs', entryQty: 500,
  entryPrice: usd(1.05), learned: true, status: 'learned', imageMatchable: true, isActive: true, ...over,
});

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  currency: 'USD', id: 'de300000-0000-4000-8000-000000000101', name: 'Canvas Tote Bag 38x40cm', nameZh: '帆布袋', sku: 'ZX-100',
  category: 'bags', unit: 'pcs', moq: 500, leadTimeDays: 15, customizable: false, learned: true, status: 'learned',
  isActive: true, imageMatchable: true,
  tiers: [{ minQty: 500, maxQty: null, unitPrice: usd(1.05) }, { minQty: 2000, maxQty: null, unitPrice: usd(0.92) },
    { minQty: 10000, maxQty: null, unitPrice: usd(0.85) }],
  aliases: ['canvas bag', 'tote bag', 'حقيبة قماش', '帆布包'], images: [],
  recentQuotes: [{ quantity: 500, unitPrice: usd(1.05), total: usd(525), at: new Date('2026-10-01T09:00:00Z'), customer: 'Omar', conversationId: 'c-1' }],
  ...over,
});

describe('Products — the list', () => {
  it('V1-299 / V1-317 — one notation for a price: the price of one unit, singular, in every language', () => {
    const en = plain(renderProductList([item()], 'en'));
    expect(en).toContain(`<bdi>$1.05/pc</bdi> · Min. order: <bdi>500${NBSP}pcs</bdi>`);
    expect(en).not.toContain('500 pcs: $1.05');
    expect(en).not.toContain('/pcs');
    expect(plain(renderProductList([item()], 'zh'))).toContain('<bdi>$1.05/个</bdi>　最低起订：<bdi>500个</bdi>');
    expect(plain(renderProductList([item()], 'ar'))).toContain('لكل قطعة');
    expect(plain(renderProductList([item()], 'es'))).toContain('/ud.</bdi>');
    // The quantity it starts from is said only where the price starts above the minimum.
    expect(plain(renderProductList([item({ entryQty: 2000 })], 'en'))).toContain(`From 2,000${NBSP}pcs: <bdi>$1.05/pc</bdi>`);
  });

  it('V1-301 / V1-304 — the way to add says "add", under the title, in the list\'s column, in every language', () => {
    for (const l of LOCALES) {
      const html = renderProductList([item()], l);
      // The title stands alone in its row; the door follows it, before the list.
      expect(html, l).toContain(`<h1 class="page">${esc(t(l, 'nav.products'))}</h1></div>`);
      expect(html, l).toContain(`<a class="deeper prod-add" href="/app/products/add">${esc(t(l, 'product.teach'))}<span class="go" aria-hidden="true">›</span></a>`);
      expect(html.indexOf('prod-add'), l).toBeLessThan(html.indexOf('class="rows"'));
    }
    expect(t('en', 'product.teach')).toBe('Add your products');
  });

  it('V1-302 — each row that opens ends in the chevron', () => {
    const html = renderProductList([item(), item({ id: 'p2' })], 'en');
    expect(html.match(/<a class="prod" href="\/app\/products\/p\d">[\s\S]*?<span class="go" aria-hidden="true">›<\/span><\/a>/g)).toHaveLength(2);
  });

  it('V1-303 / V1-379 — the list leads to the price limits, to what the assistant knows, and to a copy', () => {
    for (const l of LOCALES) {
      const html = renderProductList([item()], l);
      expect(html, l).toContain(`href="/app/business/prices">${esc(t(l, 'prices.title'))}`);
      expect(html, l).toContain('href="/app/knowledge">');
      expect(html, l).toContain(`href="/app/settings/data/products" download>${esc(t(l, 'product.list.copy'))}`);
    }
    // Money and data are the owner's: a colleague sees none of those doors.
    const staff = renderProductList([item()], 'en', null, { isOwner: false });
    expect(staff).not.toContain('/app/settings/data/products');
    expect(staff).not.toContain('/app/products/add');
  });
});

describe('Products — one product', () => {
  const page = (l: Locale, over: Partial<ProductDetail> = {}) => plain(renderProductDetail(detail(over), l));

  it('V1-310 / V1-320 — the name is the page\'s title (and so the tab\'s), with the back link above it', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toMatch(/<a class="back" href="\/app\/products">[\s\S]*?<\/a>\s*<h1 class="page"><bdi>(Canvas Tote Bag 38x40cm|帆布袋)<\/bdi><\/h1>/);
      expect(html.match(/<h1[\s>]/g), l).toHaveLength(1);
    }
    expect(page('zh')).toContain('<h1 class="page"><bdi>帆布袋</bdi></h1>');
  });

  it('V1-305 — the price box says which quantity it prices, and what happens to the others', () => {
    const en = page('en');
    expect(en).toContain(`Price for one, from 500${NBSP}pcs (USD)`);
    expect(en).toContain(`Your prices for larger orders (2,000+${NBSP}pcs and 10,000+${NBSP}pcs) stay as they are.`);
    expect(en).toContain('name="price" inputmode="decimal"\n               value="1.05"');
    for (const l of LOCALES) {
      const caption = page(l).split('name="price"')[1]!.split('</label>')[0]!;
      expect(caption, l).toMatch(/2,000|2000/);
      expect(caption, l).toMatch(/10,000|1万/);
    }
    // A product priced from one keeps "Price for one".
    expect(page('en', { tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(2) }] })).toContain('Price for one (USD)');
  });

  it('V1-314 / missed-02 — the prices are plain rows; "and up" in each language\'s own words', () => {
    const en = page('en');
    expect(en).toContain(`<li class="row"><span>500+${NBSP}pcs</span><b><bdi>$1.05/pc</bdi></b></li>`);
    expect(en).not.toContain('class="tier"');
    const ar = page('ar');
    expect(ar).toContain(`500${NBSP}قطعة فأكثر`);
    expect(ar).not.toMatch(/\d\+/);
    expect(page('zh')).toContain('500个起');
    expect(page('es')).toContain(`500${NBSP}uds. o más`);
    expect(page('fr')).toContain('et plus');
  });

  it('V1-306 — a recent quote says when, for whom, and opens its conversation', () => {
    const en = page('en');
    expect(en).toContain('href="/app/inbox/c-1#latest"');
    expect(en).toContain('Omar');
    expect(en).toMatch(/Oct 1/);
    expect(en).toContain(`<bdi>500${NBSP}pcs</bdi> · <bdi>$1.05/pc</bdi> · <bdi>total $525.00</bdi>`);
  });

  it('V1-308 / V1-006 — no raw category, no "Customizable" nobody set', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).not.toContain('bags');
    }
    expect(page('en')).not.toContain('Customizable');
    expect(page('zh')).not.toContain('可定制');
  });

  it('V1-309 / V1-006 — the unit is chosen in the reader\'s own words; the owner\'s own word is kept', () => {
    expect(page('zh')).toContain('<option value="pcs" selected>个</option>');
    expect(page('ar')).toContain('<option value="pcs" selected>قطعة</option>');
    expect(page('es')).toContain('<option value="pcs" selected>uds.</option>');
    expect(page('zh')).not.toMatch(/<input name="unit"/);
    expect(page('en', { unit: 'rolls' })).toContain('<option value="rolls" selected>rolls</option>');
  });

  it('V1-311 — each fact is called what its field is called', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html.split(esc(t(l, 'product.list.moq'))).length - 1, `${l} min. order`).toBeGreaterThanOrEqual(2);
      expect(html, l).toContain(esc(t(l, 'product.detail.leadTime')));
      expect(t(l, 'product.edit.leadTime').startsWith(t(l, 'product.detail.leadTime')), l).toBe(true);
    }
  });

  it('V1-318 — the days agree with their number in Arabic', () => {
    expect(page('ar')).toContain('15 يومًا');
    expect(page('ar', { leadTimeDays: 5 })).toContain('5 أيام');
    expect(page('en', { leadTimeDays: 1 })).toContain('1 day');
    expect(page('en')).toContain('15 days');
  });

  it('V1-312 — a name in Chinese is asked only where there is one, or the page is Chinese', () => {
    expect(page('en')).toContain('name="nameZh"');                  // it has one
    expect(page('en', { nameZh: null })).not.toContain('name="nameZh"');
    expect(page('zh', { nameZh: null })).toContain('name="nameZh"');
  });

  it('V1-313 — the names on record stand above the box that adds more', () => {
    const en = page('en');
    expect(en.indexOf('What customers call it')).toBeLessThan(en.indexOf('name="customerNames"'));
    expect(en).toContain('More names customers use');
  });

  it('V1-315 / V1-376 — the product leads to what the assistant knows about it and to its price limits; untick to stop offering', () => {
    const en = page('en');
    expect(en).toContain('href="/app/knowledge/de300000-0000-4000-8000-000000000101"');
    expect(en).toContain('href="/app/business/prices?product=de300000-0000-4000-8000-000000000101#p-de300000-0000-4000-8000-000000000101"');
    expect(en).toContain('it stays in your list, and nothing about it is erased');
  });

  it('V1-316 — the options help says "one per line" like the next help', () => {
    expect(t('en', 'product.edit.options.hint')).toMatch(/^One per line:/);
  });

  it('V1-319 / new-04 — being found by photo is a quiet caption: no dash, no colour, never louder than the name', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(`<p class="caption muted">${esc(t(l, 'product.detail.imageMatchBig'))}</p>`);
      expect(html, l).not.toContain('p-tag big');
      expect(t(l, 'product.detail.imageMatchBig'), l).not.toContain(' — ');
    }
    expect(t('zh', 'product.detail.imageMatchBig')).not.toContain('可以被图片识别');
  });

  it('missed-03 — an address cut short is not a product: the loader answers "not here", never a crash', () => {
    expect(isUuid('de300000-0000-4000-8000-000000000101')).toBe(true);
    expect(isUuid('de300000-0000-4000-8000-00000000010')).toBe(false);
    expect(isUuid('nonsense')).toBe(false);
  });
});

describe('Products — the add page', () => {
  const add = (l: Locale, ...rest: Parameters<typeof renderAddForm> extends [unknown, ...infer R] ? R : never) => renderAddForm(l, ...rest);
  const owner = { isOwner: true } as const;

  it('V1-328 / missed-09 — a way back to the list, and the tab named by the page\'s own title', () => {
    for (const l of LOCALES) {
      const body = add(l);
      expect(body, l).toMatch(/^<a class="back" href="\/app\/products">/);
      const html = shell({ title: t(l, 'nav.products'), active: 'products', locale: l, path: '/app/products/add', bodyHtml: body });
      expect(html, l).toContain(`<title>${esc(t(l, 'product.teach'))} · Nomi</title>`);
    }
  });

  it('V1-324 / V1-328 — the paste way has a heading, and the heading is the box\'s label', () => {
    for (const l of LOCALES) {
      const html = add(l);
      expect(html, l).toContain(`<h2 id="paste-h">${esc(t(l, 'product.add.pasteTitle'))}</h2>`);
      expect(html, l).toContain('<textarea name="text" rows="8" required aria-labelledby="paste-h"');
    }
  });

  it('missed-06 — nothing is focused on arrival', () => {
    for (const l of LOCALES) expect(add(l), l).not.toContain('autofocus');
  });

  it('V1-323 / V1-328 — both file boxes are drawn in the page\'s own words, inside their label', () => {
    for (const l of ['zh', 'ar', 'es', 'fr', 'en'] as const) {
      const html = add(l);
      expect(html, l).toMatch(/<label class="filepick"><input class="photo-in" type="file" name="page"[^>]*required \/><span class="btn" aria-hidden="true">/);
      expect(html, l).toMatch(/<label class="filepick"><input class="photo-in" type="file" name="file"[^>]*required \/>/);
      for (const k of ['product.add.photoChoose', 'product.add.photoNone', 'product.add.photoSome', 'import.file.choose', 'import.file.none', 'import.file.some'] as const) {
        expect(html, `${l} ${k}`).toContain(esc(t(l, k)));
      }
    }
    const css = linkedCss(shell({ title: 'x', active: 'products', locale: 'en', path: '/app/products/add', bodyHtml: add('en') }));
    expect(css).toContain('.filepick input:invalid ~ .filepick-some, .filepick input:valid ~ .filepick-none { display:none; }');
    expect(css).toContain('.filepick input[type=file] { position:absolute;');
  });

  it('V1-326 — "prices go to me" says what it does, and asks first', () => {
    for (const l of LOCALES) {
      const off = renderPricesToMe(l, false);
      expect(off, l).toContain(`data-confirm="${esc(t(l, 'product.pricesToMe.confirmOn'))}">${esc(t(l, 'product.pricesToMe.turnOn'))}</button>`);
      expect(renderPricesToMe(l, true), l).not.toContain('data-confirm');
    }
    expect(t('en', 'product.pricesToMe.turnOn')).toBe('Send every price question to me');
  });

  it('V1-327 / V1-330 — the currency box names the currency in words and says what a store in another one gets', () => {
    expect(add('en')).toContain('this business\'s currency: US Dollar (USD)');
    expect(add('zh')).toContain('美元（USD）');
    expect(add('zh')).not.toContain('价格是 USD');
    for (const l of LOCALES) expect(add(l), l).toContain(esc(t(l, 'import.store.currency.hint')));
    // The refusal names the same box the same way.
    expect(t('en', 'import.store.refused.currency_unconfirmed')).toContain('this business\'s currency');
    expect(t('en', 'import.store.currency', { currency: 'X' })).toContain('this business\'s currency');
  });

  it('V1-329 / V1-333 — the note names the tag the owner will see, in owner words', () => {
    for (const l of LOCALES) expect(add(l), l).toContain(esc(t(l, 'product.status.needsConfirm')));
    expect(add('zh')).not.toContain('需要确认');
    expect(add('es')).not.toContain('Necesita un precio');
    expect(add('en')).not.toMatch(/enabled/i);
  });

  it('V1-330 / V1-332 / missed-08 — the list left open says when as a person would; a date never breaks', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const open = (createdAt: Date) => ({ id: 'i1', createdAt, lines: 4 });
    expect(renderOpenImport('en', open(new Date('2026-10-02T08:00:00Z')), now)).toContain('A list you started today is waiting to be checked: 4 lines.');
    expect(renderOpenImport('en', open(new Date('2026-10-01T08:00:00Z')), now)).toContain('started yesterday');
    expect(renderOpenImport('zh', open(new Date('2026-10-02T08:00:00Z')), now)).toContain('你今天开始的一份清单');
    const older = plain(renderOpenImport('ar', open(new Date('2026-09-25T08:00:00Z')), now));
    expect(older).toMatch(/يوم الجمعة، 25 سبتمبر/);
    const zh = renderOpenImport('zh', open(new Date('2026-09-25T08:00:00Z')), now);
    expect(zh).not.toMatch(/周五 开始/);
    expect(zh).toContain('周五开始的');
  });

  it('V1-331 — Arabic joins لـ to مساعدك on the add page', () => {
    const ar = add('ar');
    expect(ar).not.toContain('لـمساعدك');
    expect(ar).not.toContain('لـ مساعدك');
  });

  it('missed-05 — the file type reads left to right inside the Arabic sentence', () => {
    expect(t('ar', 'import.file.intro')).toContain('(\u2066.xlsx\u2069،');
  });

  it('new-07 — a refusal keeps the currency tick and the printed-or-handwritten answer', () => {
    const store = add('en', owner, 'USD', null, null, false, false, { store: { form: 'store', reason: 'unreachable', address: 'shop.example', currencyConfirmed: true } });
    expect(store).toMatch(/<input type="checkbox" name="currency" checked \/>/);
    expect(store).toContain('value="shop.example"');
    const photo = add('en', owner, 'USD', null, null, false, false, { photo: '<p id="photo-err">x</p>', hand: 'printed' });
    expect(photo).toContain('value="printed" required checked');
  });

  it('V1-321 — the box is required, and an empty or unreadable paste is said on the add page', () => {
    for (const l of LOCALES) {
      expect(add(l), l).toMatch(/<textarea name="text"[^>]* required/);
      const said = add(l, owner, 'USD', null, { text: t(l, 'product.add.nothingRead'), bad: true });
      expect(said, l).toContain(esc(t(l, 'product.add.nothingRead')));
    }
  });
});
