import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderProductList, renderProductDetail, renderAddForm, renderPricesToMe, renderOpenImport, isUuid, loadProductDetail,
  type ProductListItem, type ProductDetail,
} from '../../src/api/web/products.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc, shell } from '../../src/api/web/layout.js';
import * as show from '../../src/api/web/values.js';
import { linkedCss } from './linked-css.js';
import { reviewModel } from './reviewPage.js';
import { renderImportReview } from '../../src/api/web/importFlow.js';
import { parsePriceLines } from '../../src/core/onboard/catalogImport.js';
import { flagsOf, needsTick, editRow } from '../../src/core/onboard/importReview.js';
import { renderPriceRules, type PriceRulesView } from '../../src/api/web/priceRules.js';
import { renderFactory, type FactoryView } from '../../src/api/web/factory.js';
import { renderKnowledgeIndex, renderProductKnowledge, loadProductKnowledge, type KnowledgeIndex, type ProductKnowledge } from '../../src/api/web/knowledge.js';
import { renderKnowledgeOps, renderKnowledgePeriod, type KnowledgeOps } from '../../src/api/web/knowledge-insights.js';
import { renderPageFactsForm } from '../../src/api/web/pageFacts.js';
import { readFileSync } from 'node:fs';
import type { Db } from '../../src/db/client.js';
import { productsSheet, priceRulesSheet, plainMoney } from '../../src/api/web/dataExport.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { csvRows } from '../../src/core/owner/csv.js';
import { buttonsAndDoors } from './buttons-and-doors.js';

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
      expect(off, l).toContain(`onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'product.pricesToMe.confirmOn'))}">${esc(t(l, 'product.pricesToMe.turnOn'))}</button>`);
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

describe('The import review', () => {
  // The audit's own list: two plain prices, two products on one line, and a heading.
  const LIST = 'Canvas tote 18.00\nWool scarf 24,50 each\nMug 8 or bowl 12\nSPRING SALE';
  const review = (l: Locale, text = LIST, opts: Parameters<typeof renderImportReview>[2] = {}) =>
    plain(renderImportReview(reviewModel(text), l, { canExtract: true, ...opts }));

  it('V1-334 — a plain price is read, flagged for its own tick; a figure that reads two ways is refused, never guessed', () => {
    const [tote, scarf, mug, sale] = parsePriceLines(LIST, 'USD');
    expect(tote).toMatchObject({ name: 'Canvas tote', price: usd(18) });
    expect(scarf).toMatchObject({ price: null, problem: 'ambiguous_price' });   // T4: "24,50" in a dollar workspace
    expect(mug).toMatchObject({ price: null });
    expect(sale).toMatchObject({ price: null });
    expect(parsePriceLines('Mug 2.50 each', 'USD')[0]).toMatchObject({ name: 'Mug', price: usd(2.5) });
    // A size, a quantity, a model number: no cents, never a price.
    for (const line of ['Thermos 500ml', 'Version 2.0', 'Bottle 0.75 l', 'Model ZX 300']) {
      expect(parsePriceLines(line, 'USD')[0]!.price, line).toBeNull();
    }
    const m = reviewModel('Canvas tote 18.00');
    const row = m.imp.rows[0]!;
    expect(flagsOf(row, m.imp.rows, m.ctx)).toContain('no_sign');
    expect(needsTick(row, m.imp.rows, m.ctx, false)).toBe(true);
    expect(flagsOf(reviewModel('Canvas tote $18.00').imp.rows[0]!, [], m.ctx)).not.toContain('no_sign');
    expect(review('en')).toContain(t('en', 'import.flag.no_sign', { currency: 'USD' }));
  });

  it('V1-335 — a line with no price and no figure is said to be added unpriced, with the way to leave it out', () => {
    for (const l of LOCALES) expect(review(l), l).toContain(esc(t(l, 'import.row.noPriceNote')));
    const en = review('en');
    // "3 new": the scarf is refused with its reason, not counted as a product.
    expect(en).toContain('3 new — not in your catalogue yet');
  });

  it('V1-336 — the tick is something the owner says, on its own line, never run into the name', () => {
    for (const l of LOCALES) {
      const html = review(l);
      expect(html, l).toContain(`<label class="pcheck imp-tick"><input type="checkbox" name="tick:l1" /> ${esc(t(l, 'import.row.checked'))}</label>`);
      expect(html, l).not.toMatch(/<div class="imp-h">\s*<label/);
    }
    expect(t('en', 'import.row.checked')).toBe('This line is right');
  });

  it('V1-337 — a flagged row keeps its form closed; it opens only for something refused', () => {
    const html = review('en');
    expect(html).not.toContain('<details class="imp-edit" open>');
    const refused = plain(renderImportReview(reviewModel(LIST), 'en', { errors: new Map([['l1', ['price_not_number']]]) }));
    expect(refused.match(/<details class="imp-edit" open>/g)).toHaveLength(1);
  });

  it('V1-338 / V1-339 — one control for the minimum; names in a box of lines', () => {
    const html = review('en');
    expect(html).not.toContain('name="nomin:');
    expect(html).toContain(`name="moq:l1" placeholder="${t('en', 'product.noMinimum')}"`);
    expect(html).toMatch(/<textarea name="names:l1" rows="2" dir="auto"><\/textarea>/);
    // An empty box is no minimum.
    expect(editRow(reviewModel('Tote $2 MOQ 50').imp.rows[0]!, { moq: '', noMinimum: false }).row.moq).toBeNull();
  });

  it('V1-340 — the "%" stays on the line of its box', () => {
    const css = linkedCss(shell({ title: 'x', active: 'products', locale: 'en', path: '/app/products/import/x', bodyHtml: review('en') }));
    expect(css).toContain('.imp-pct { display:inline-flex; align-items:center; gap:var(--space-4); white-space:nowrap; }');
  });

  it('V1-341 / new-12 — "Start again" is the red-outlined act, and its question names the same act', () => {
    for (const l of LOCALES) {
      const html = review(l);
      expect(html, l).toContain(`<button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'import.dropConfirm'))}">${esc(t(l, 'import.drop'))}</button>`);
      expect(t(l, 'import.dropConfirm').replace(/^¿/, '').startsWith(t(l, 'import.drop')), l).toBe(true);
      expect(html, l).not.toContain('quiet');
    }
  });

  it('V1-342 — what stands before "Add these products" is said beside it from the start', () => {
    const en = review('en');
    const before = en.slice(0, en.indexOf('name="next" value="add"'));
    expect(before).toContain('class="imp-pending"');
    expect(before).toContain(t('en', 'import.pending.why'));
    expect(t('en', 'import.discount.hint')).toMatch(/^With a discount here/);
  });

  it('V1-343 — the Arabic "per" list names each unit once', () => {
    const html = review('ar');
    const options = [...html.matchAll(/<select name="unit:l1">([\s\S]*?)<\/select>/g)][0]![1]!;
    const words = [...options.matchAll(/>([^<]+)<\/option>/g)].map((x) => x[1]);
    expect(new Set(words).size).toBe(words.length);
  });

  it('V1-344 — a way back to the add page; the tab named by the page\'s title', () => {
    for (const l of LOCALES) {
      const body = review(l);
      expect(body, l).toMatch(/^<a class="back" href="\/app\/products\/add">/);
      expect(shell({ title: t(l, 'nav.products'), active: 'products', locale: l, path: '/app/products/import/x', bodyHtml: body }), l)
        .toContain(`<title>${esc(t(l, 'import.title'))} · Nomi</title>`);
    }
  });

  it('missed-10 — the offer to read again comes after the lines it names, counts them right, and its note has no "it"', () => {
    const en = review('en');
    expect(en.indexOf('id="extract"')).toBeGreaterThan(en.indexOf('id="row-l4"'));
    // Two lines hold a figure and no price (the scarf is refused, the mug unread); the heading has none.
    expect(en).toContain('2 lines have a figure that was not read as a price, or were not read as a product.');
    expect(t('en', 'import.extract.hint')).not.toMatch(/\bit\b/);
  });

  it('missed-11 — an unread figure is said as that, never as digits left in the name', () => {
    for (const l of LOCALES) {
      const html = review(l);
      expect(html, l).toContain(esc(t(l, 'import.flag.unread_figure')));
      expect(html, l).not.toContain(esc(t(l, 'import.flag.digits_in_name')));
    }
  });

  it('V1-345 / V1-346 — one case, one unit per "per", no space after a Chinese full stop, plain Spanish, no counting chore', () => {
    const en = review('en');
    expect(en).toContain('$18.00/pc · No minimum');
    expect(en).not.toContain('no price yet');
    expect(review('es')).toContain('<option value="pcs" selected>ud.</option>');
    expect(review('zh')).not.toMatch(/。<\/b> /);
    expect(t('es', 'import.needYou.other')).not.toContain('van primero');
    for (const l of LOCALES) expect(t(l, 'import.countYours'), l).not.toMatch(/count|数一数|عدّ|Cuenta|Comptez/i);
  });
});

describe('Your price limits', () => {
  const RULES = { floor: usd(0.72), maxDiscountPct: 8, askAbovePct: 5 };
  const own = (id: string, name: string, price: number) => ({
    productId: id, sku: `GEN-${id}`, name, nameZh: null, listPrice: usd(price), own: RULES, inheritsDefault: false, isActive: true,
  });
  const view = (over: Partial<PriceRulesView> = {}): PriceRulesView => ({
    currency: 'USD', volume: [], businessDefault: null, unanswered: 0,
    products: [own('a1', 'Canvas Tote Bag', 1.05), own('a2', 'Bamboo board', 3.5)], ...over,
  });
  const page = (l: Locale, v: PriceRulesView = view(), draft: { productId?: string | null } = {}) => plain(renderPriceRules(v, l, null, {}, draft));

  it('V1-349 — the products with limits of their own are headed as that, never a bare "Set"', () => {
    for (const l of LOCALES) expect(page(l), l).toContain(`<h2>${esc(t(l, 'prices.answered.title'))}</h2>`);
    expect(t('en', 'prices.answered.title')).toBe('Products with their own limits');
    expect(t('zh', 'prices.answered.title')).not.toBe('已经定好的');
  });

  it('V1-351 — with every product answered and no answer for everything, that empty form is folded away; its question is about anything you sell', () => {
    const en = page('en');
    expect(en).toMatch(/<details class="pr-fold"><summary>Set one answer for everything<\/summary>/);
    expect(t('en', 'prices.q.floorAll', { currency: 'USD' })).toContain('one of anything you sell');
    expect(en).not.toContain('one of these');
    // A product still waiting: the form stands open, as before.
    const waiting = page('en', view({ products: [{ ...own('a3', 'Lamp', 3.5), own: null }] }));
    expect(waiting).not.toContain('pr-fold');
    expect(t('en', 'prices.default.sub')).toContain('A product priced below it needs an answer of its own');
  });

  it('V1-352 / V1-353 — sections are h2s, a product\'s name is in ink, each "change" is a door; the way back is at the top', () => {
    const en = page('en');
    expect(en).toMatch(/^<a class="back" href="\/app\/business">/);
    expect(en).toContain(`<h2>${t('en', 'prices.default.title')}</h2>`);
    expect(en).not.toContain('class="sub3">For everything');
    expect(en).toContain('<div class="pr-name"><b><bdi>Canvas Tote Bag</bdi></b>');
    expect(en).toContain('href="/app/business/prices?product=a1#p-a1">Change these limits<span class="go" aria-hidden="true">›</span></a>');
    expect(en).not.toContain('class="blink"');
  });

  it('V1-354 — one name: the export is "Your price limits" too', () => {
    for (const l of LOCALES) expect(t(l, 'data.export.subject.price-rules'), l).toBe(t(l, 'prices.title'));
  });

  it('V1-355 — the discount asks "from what quantity", never "pieces" for every product', () => {
    const en = page('en', view({ businessDefault: RULES, volume: [{ id: 'v1', productId: null, productLabel: null, minQty: 1000, discountPct: 4, asksFirst: false }] }));
    expect(en).toContain('From what quantity?');
    expect(en).toContain('Everything you sell — from 1,000: 4% off');
    for (const l of LOCALES) expect(t(l, 'prices.volume.q.minQty'), l).not.toMatch(/pieces|个起？|قطعة|unidades|unités/);
  });

  it('V1-356 / V1-331 — Arabic joins لـ to مساعدك on this page', () => {
    const ar = page('ar', view({ products: [{ ...own('a3', 'Lamp', 3.5), own: null }] }));
    expect(ar).toContain('لمساعدك');
    expect(ar).not.toMatch(/لـ\s*مساعدك/);
  });

  it('V1-357 — the Chinese question is plain', () => {
    expect(t('zh', 'prices.q.floor', { currency: 'USD' })).toBe('每个最低接受多少钱？（USD）');
  });

  it('missed-13 — opening a product lands on its row; its form can be closed; the page has one filled Save (new-14)', () => {
    const en = page('en', view(), { productId: 'a1' });
    expect(en).toContain('<li class="row lines" id="p-a1">');
    expect(en).toContain('<a class="deeper" href="/app/business/prices#p-a1">Close without saving</a>');
    expect(en.match(/class="btn send"/g)).toHaveLength(1);
    const opened = en.slice(en.indexOf('id="p-a1"'));
    expect(opened.indexOf('class="btn send"')).toBeLessThan(opened.indexOf('</li>'));
    // Nothing opened: the answer for everything carries the one fill.
    expect(page('en', view({ products: [{ ...own('a3', 'Lamp', 3.5), own: null }] })).match(/class="btn send"/g)).toHaveLength(1);
  });

  it('new-15 — "no discount" is a valid choice, said without the waiting mark', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(`<p class="fempty">${esc(t(l, 'prices.volume.none'))}</p>`);
      expect(html, l).not.toContain(`<p class="fwarn">${esc(t(l, 'prices.volume.none'))}`);
    }
  });

  it('missed-16 — a section\'s rule is as wide as its rows', () => {
    const css = linkedCss(shell({ title: 'x', active: 'factory', locale: 'en', path: '/app/business/prices', bodyHtml: page('en') }));
    expect(css).toContain('.pr-block { max-width:var(--measure-prose); }');
    expect(page('en').match(/<section class="fblock pr-block"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('V1-379 — the page leads to a copy of its limits', () => {
    expect(page('en')).toContain('href="/app/settings/data/price-rules" download>Take a copy of your price limits');
  });

  it('extra-prices-stated — no sentence points at discounts "below" where none is below, here or on My business', () => {
    for (const l of LOCALES) {
      for (const k of ['prices.stated', 'prices.stated.noDiscount'] as const) {
        expect(t(l, k), `${l} ${k}`).not.toMatch(/below,|written below|wrote below|下面你|أدناه|abajo|plus bas/);
      }
    }
    const channel = { kind: 'whatsapp' as const, connected: true, status: 'connected' as const, healthOk: true, displayId: '+971 50 ••• 4444', lastActivityAt: null, problem: null, activated: false };
    const f = {
      profile: { name: 'Shop', description: 'x', location: 'Yiwu', workingHours: 'Mon–Sat', contactEmail: 's@x.example', contactPhone: null, languagesServed: ['en'], categories: [] },
      products: { total: 1, needPrice: 0, names: [{ name: 'Cup', nameZh: null }] },
      promises: { certs: [], floorLow: usd(0.75), floorHigh: usd(0.75), ceilingPct: 8, ceilingVaries: false, askPct: 5, askVaries: false },
      connection: { channel, ownerPhone: '971500001111' }, nextStep: null,
      readiness: { canActivate: true, blockers: [], lifecycle: 'ready', live: false, activatedAt: null, activatedBy: null, recipients: [] },
      rehearsal: { findings: [], violations: [], probesRun: 1, productsChecked: 1, productsTotal: 1 },
      prices: { currency: 'USD', businessDefault: { floor: usd(0.35), maxDiscountPct: 10, askAbovePct: 7 }, products: [], unanswered: 0, volume: [] },
    } as unknown as FactoryView;
    for (const l of LOCALES) {
      const html = plain(renderFactory(f, l));
      const said = (k: 'prices.stated' | 'prices.stated.noDiscount') => esc(plain(t(l, k, { floor: show.money(l, usd(0.35)), max: 10, ask: 7 })));
      expect(html, l).toContain(said('prices.stated.noDiscount'));
      expect(html, l).not.toContain(said('prices.stated'));
    }
    const withOne = plain(renderFactory({ ...f, prices: { ...f.prices, volume: [{ id: 'v1', productId: null, productLabel: null, minQty: 100, discountPct: 4, asksFirst: false }] } }, 'en'));
    expect(withOne).toContain('Of the discounts you have written, up to 7% goes out without you');
  });
});

describe('What your assistant knows', () => {
  const NOW = new Date('2026-10-02T12:00:00Z');
  const quiet: KnowledgeOps = {
    range: 'week', hasActivity: false,
    report: { factsAdded: 0, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] }, gaps: [], activity: [],
  };
  const index: KnowledgeIndex = {
    products: [{ id: 'p2', name: 'Canvas Tote Bag 38x40cm', nameZh: '帆布袋', count: 0 }, { id: 'p1', name: 'Bamboo Cutting Board', nameZh: '竹砧板', count: 2 }],
    business: [], certs: ['CE'], appliesToProducts: 12,
  };
  // The page as app.ts draws it (knowledgeBody): what to do, what is taught, the page reader, the period last.
  const page = (l: Locale, ops: KnowledgeOps = quiet) => plain(renderKnowledgeOps(ops, l, NOW) + renderKnowledgeIndex(index, l)
    + renderPageFactsForm(l) + renderKnowledgePeriod(ops, l, NOW));

  it('V1-358 — the page opens on what there is to do; the period\'s counts come last, and no zero tiles', () => {
    const src = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/renderKnowledgeOps\(ops[\s\S]{0,400}renderKnowledgeIndex\(index[\s\S]{0,600}renderKnowledgePeriod\(ops/);
    for (const l of LOCALES) {
      const html = page(l);
      const at = (s: string) => html.indexOf(s);
      expect(at(esc(t(l, 'knowledge.ops.gaps'))), l).toBeLessThan(at(esc(t(l, 'knowledge.teach'))));
      expect(at(esc(t(l, 'knowledge.teach'))), l).toBeLessThan(at('id="period"'));
      expect(at('id="from-page"'), l).toBeLessThan(at('id="period"'));
      expect(html, l).not.toContain('class="stats"');
    }
  });

  it('V1-359 — with no question asked, it never says each one was answered from what was taught', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(esc(t(l, 'knowledge.ops.noQuestions', { period: t(l, 'knowledge.ops.period.week') })));
      expect(html, l).not.toContain(esc(t(l, 'knowledge.ops.noGaps', { period: t(l, 'knowledge.ops.period.week') })));
    }
  });

  it('V1-360 / V1-361 — each product row says what its number counts; Chinese shows and sorts Chinese names', () => {
    const en = page('en');
    expect(en).toContain('2 facts taught');
    expect(en).toContain('Nothing taught yet<span class="go"');
    const zh = page('zh');
    expect(zh).toContain('<bdi>竹砧板</bdi>');
    expect(zh).toContain('<bdi>帆布袋</bdi>');
    expect(zh).not.toContain('Bamboo Cutting Board');
    expect(zh.indexOf('帆布袋')).toBeLessThan(zh.indexOf('竹砧板'));   // 帆 before 竹 in Chinese order
  });

  it('V1-363 / V1-368 / V1-377 — every teach field is named by a label wrapping it, at the page\'s size', () => {
    for (const html of [page('en'), plain(renderProductKnowledge(product(), 'en', null))]) {
      expect(html).toMatch(/<label class="pq"><span>Type<\/span><select name="kind"/);
      expect(html).toMatch(/<label class="pq"><span>Title<\/span>\s*<input type="text" name="label"/);
      expect(html).toMatch(/<label class="pq"><span>The fact or answer<\/span>\s*<textarea name="content"/);
      expect(html).not.toContain('<label class="muted">');
    }
    expect(page('en')).toContain('aria-label="Or paste the page');
  });

  it('V1-364 — the business is taught business things, a product product things', () => {
    const biz = page('en').split('action="/app/knowledge/teach"')[1]!.split('</select>')[0]!;
    expect(biz).not.toContain('value="specification"');
    expect(biz).not.toContain('value="material"');
    expect(biz).not.toContain('value="usage"');
    expect(biz).toContain('value="faq"');
    expect(plain(renderProductKnowledge(product(), 'en', null))).toContain('value="specification"');
  });

  it('V1-365 — the page reader\'s description at the lede\'s size; its field as wide as the teach fields', () => {
    const html = page('en');
    expect(html).toContain(`<p class="fdesc">${esc(t('en', 'pageFacts.intro'))}</p>`);
    expect(html).toMatch(/action="\/app\/knowledge\/from-page" class="pform"/);
    expect(html).toMatch(/action="\/app\/knowledge\/teach" class="pform teach"/);
  });

  it('V1-367 / V1-370 — the period is named, the tab for today is not the nav\'s "Today", and the count says what it counts', () => {
    const counted = { ...quiet, hasActivity: true, report: { ...quiet.report, factsAdded: 1, certsAuthorized: 1 } };
    const en = plain(renderKnowledgePeriod(counted, 'en', NOW));
    expect(en).toContain('<h2>What changed this week</h2>');
    expect(en).toContain('>So far today</a>');
    expect(en).toContain('Certifications your assistant may now mention');
    expect(t('zh', 'knowledge.ops.thisPeriod', { period: t('zh', 'knowledge.ops.period.month') })).toBe('本月的变动');
  });

  it('V1-369 / missed-20 — the Chinese titles end on a noun; a short line never leaves one character alone', () => {
    expect(t('zh', 'nav.knowledge')).toMatch(/知道的事$/);
    expect(t('zh', 'knowledge.taught.title')).not.toMatch(/的$/);
    const css = linkedCss(shell({ title: 'x', active: 'knowledge', locale: 'zh', path: '/app/knowledge', bodyHtml: page('zh') }));
    expect(css).toMatch(/\.scope \{[^}]*text-wrap:pretty; \}/);
  });

  it('new-17 — lists, cards and empty panels share one measure', () => {
    const css = linkedCss(shell({ title: 'x', active: 'knowledge', locale: 'en', path: '/app/knowledge', bodyHtml: page('en') }));
    expect(css).toContain('.klist, .kitem, .gap { max-width:var(--measure-prose); }');
  });

  it('V1-371 / V1-372 / new-18 / V1-374 — a certification in words, on or off in words, switched by a button that says so', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).not.toMatch(/>food_grade<|>BPA_free<|for all 12[^<]*food_grade/);
      expect(html, l).toContain(`<b><bdi>${esc(t(l, 'claim.food_grade'))}</bdi></b> <span class="pill">${esc(t(l, 'knowledge.cert.off'))}</span>`);
      expect(html, l).toContain(`<b><bdi>${esc(t(l, 'claim.CE'))}</bdi></b> <span class="pill ok">${esc(t(l, 'knowledge.cert.on'))}</span>`);
      // The question names it in words, and the button — which the ask-first dialog repeats — says what it does.
      expect(html, l).toContain(`data-confirm="${esc(plain(t(l, 'knowledge.cert.confirmOn', { key: t(l, 'claim.food_grade'), n: 12 })))}">${esc(t(l, 'knowledge.cert.turnOn'))}</button>`);
    }
    // A plain button: it takes the page's font (`.btn { font:inherit }`), not the browser's.
    expect(page('en')).not.toMatch(/class="cert( on)? ?"/);
    expect(page('en')).toMatch(/<button class="btn" type="submit" onclick="return confirm\(this.dataset.confirm\)" data-confirm="Turn on/);
  });

  it('V1-373 / V1-376 — one product\'s page says which certifications are on and leads to where they are switched, and to the product', () => {
    const html = plain(renderProductKnowledge(product(), 'en', null));
    expect(html).not.toContain('action="/app/knowledge/cert"');
    expect(html).toContain('href="/app/knowledge#certs"');
    expect(html).toContain('href="/app/products/de300000-0000-4000-8000-000000000101"');
    expect(plain(renderProductKnowledge({ ...product(), certs: [] }, 'en', null))).toContain(t('en', 'knowledge.cert.noneHere'));
  });

  it('V1-375 — on a Chinese page the product is called by its Chinese name, as on its own page', () => {
    const zh = plain(renderProductKnowledge(product(), 'zh', null));
    expect(zh).toContain('<h1 class="page"><bdi>帆布袋</bdi></h1>');
    expect(zh).toContain('「帆布袋」');
  });

  it('V1-377 / V1-378 — the back link names the page it opens, above the title', () => {
    for (const l of LOCALES) {
      const html = plain(renderProductKnowledge(product(), l, null));
      expect(html, l).toMatch(new RegExp(`^\\s*<a class="back" href="/app/knowledge">[\\s\\S]*?${esc(t(l, 'nav.knowledge')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a>\\s*<h1 class="page">`));
    }
  });

  it('missed-03 — a knowledge address cut short is "not found", never a crash', async () => {
    const BIZ = 'de300000-0000-4000-8000-000000000001';
    // Answered before any query: no database is needed to say so.
    const noDb = null as unknown as Db;
    expect(await loadProductKnowledge(noDb, BIZ, 'de300000-0000-4000-8000-00000000010')).toBeNull();
    expect(await loadProductDetail(noDb, BIZ, 'de300000-0000-4000-8000-00000000010')).toBeNull();
  });

  const product = (): ProductKnowledge => ({
    productId: 'de300000-0000-4000-8000-000000000101', productName: 'Canvas Tote Bag 38x40cm', productNameZh: '帆布袋',
    items: [], certs: ['CE', 'food_grade'], appliesToProducts: 12,
  });
});

describe('The price-list export', () => {
  const productRow = {
    sku: 'ZX-100', name: 'Canvas Tote Bag', name_zh: '帆布袋', description: null, category: 'bags', unit: 'pcs', moq: 500,
    currency: 'USD', price: '1.0500', lead_time_days: 15, is_active: true, created_at: new Date('2026-10-02T09:53:15.273Z'),
    names: 'canvas bag; حقيبة قماش; 帆布包',
  };
  const parts = {
    floors: [{ product: 'Canvas Tote Bag', floor: '0.7200', currency: 'USD', max_discount_pct: '8.00', human_required_above_pct: '5.00' }],
    tiers: [{ product: 'Canvas Tote Bag', min_qty: 500, max_qty: null, price: '1.0500', currency: 'USD' },
      { product: 'Canvas Tote Bag', min_qty: 2000, max_qty: null, price: '0.9200', currency: 'USD' }],
    negotiation: [{ condition: { qtyGte: 1000 }, action: { kind: 'discount_pct', value: 4 }, is_active: true, product: null }],
    bundles: [], subs: [],
  };

  it('V1-380 — headers and words in the owner\'s language; the files differ by language', () => {
    const files = LOCALES.map((l) => csvRows(productsSheet([productRow], l, 'UTC').header, productsSheet([productRow], l, 'UTC').rows)
      + csvRows(priceRulesSheet(parts, l).header, priceRulesSheet(parts, l).rows));
    expect(new Set(files).size).toBe(LOCALES.length);
    expect(productsSheet([productRow], 'zh', 'UTC').header).toContain('货号');
    expect(priceRulesSheet(parts, 'ar').rows[0]![0]).toBe(t('ar', 'data.export.rule.floor'));
    expect(priceRulesSheet(parts, 'en').header).not.toContain('when');
  });

  it('V1-381 — figures as figures, words as words, a date as its day', () => {
    const [row] = productsSheet([productRow], 'en', 'UTC').rows;
    expect(row).toContain('1.05');
    expect(row).not.toContain('1.0500');
    expect(row).toContain('Yes');
    expect(row).toContain('2026-10-02');
    expect(row).toContain('pcs');
    expect(productsSheet([productRow], 'zh', 'UTC').rows[0]).toContain('个');
    expect(plainMoney('0.1250')).toBe('0.125');
    expect(plainMoney('18.0000')).toBe('18.00');
  });

  it('V1-382 — one figure to a cell: each quantity price its own row; the limits in their own columns', () => {
    const sheet = priceRulesSheet(parts, 'en');
    expect(sheet.header).toEqual(['What it is', 'Product', 'From quantity', 'Up to quantity', 'Price for one', 'Currency', 'Discount (%)',
      'Most that may come off (%)', 'You are asked above (%)', 'Note']);
    expect(sheet.rows[0]).toEqual(['Lowest price you accept', 'Canvas Tote Bag', null, null, '0.72', 'USD', null, '8', '5', null]);
    expect(sheet.rows[1]).toEqual(['Quantity price', 'Canvas Tote Bag', 500, null, '1.05', 'USD', null, null, null, null]);
    expect(sheet.rows[3]).toEqual(['Discount for buying more', 'Everything you sell', 1000, null, null, null, '4', null, null, '']);
    const body = csvRows(sheet.header, sheet.rows);
    expect(body).not.toContain('|');
    expect(body).not.toContain('most you will come down');
  });

  it('V1-384 — the names customers use are in the products file, in every script', () => {
    const sheet = productsSheet([productRow], 'en', 'UTC');
    expect(sheet.header).toContain(t('en', 'import.row.names'));
    expect(csvRows(sheet.header, sheet.rows)).toContain('حقيبة قماش');
  });

  it('V1-385 — the row ceiling is written as the locale writes a number', () => {
    const view: Parameters<typeof renderDataRights>[0] = { requests: [], businessName: 'Atlas' };
    expect(renderDataRights(view, 'en', null, { isOwner: true }, 'Setup')).toContain('20,000 rows');
    expect(renderDataRights(view, 'en', null, { isOwner: true }, 'Setup')).not.toContain('20000');
  });
});

describe('Every page of this area keeps the rule: buttons do things, doors go places', () => {
  it('products, a product, adding, the review, price limits, knowledge', () => {
    const k: KnowledgeIndex = { products: [{ id: 'p1', name: 'Tote', count: 1 }], business: [], certs: ['CE'], appliesToProducts: 3 };
    const pages = {
      list: renderProductList([{ id: 'p1', name: 'Tote', nameZh: null, sku: 'ZX-1', moq: 1, unit: 'pcs', entryQty: 1, entryPrice: usd(1), learned: true, status: 'learned', imageMatchable: true, isActive: true }], 'en'),
      product: renderProductDetail({ currency: 'USD', id: 'de300000-0000-4000-8000-000000000101', name: 'Tote', nameZh: null, sku: 'ZX-1', category: null, unit: 'pcs', moq: null,
        leadTimeDays: null, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: false,
        tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(1) }], aliases: ['tote'], images: [], recentQuotes: [] }, 'en'),
      add: renderAddForm('en', { isOwner: true }, 'USD', { id: 'i1', createdAt: new Date(), lines: 2 }),
      review: renderImportReview(reviewModel('Canvas tote 18.00\nSPRING SALE'), 'en', { canExtract: true }),
      prices: renderPriceRules({ currency: 'USD', volume: [], businessDefault: null, unanswered: 1,
        products: [{ productId: 'a1', sku: 'S', name: 'Lamp', nameZh: null, listPrice: usd(3.5), own: null, inheritsDefault: false, isActive: false }] }, 'en'),
      knowledge: renderKnowledgeIndex(k, 'en') + renderPageFactsForm('en'),
      knowledgeProduct: renderProductKnowledge({ productId: 'p1', productName: 'Tote', items: [], certs: [], appliesToProducts: 3 }, 'en', null),
    };
    for (const [name, html] of Object.entries(pages)) expect(buttonsAndDoors(html), name).toEqual([]);
  });
});
