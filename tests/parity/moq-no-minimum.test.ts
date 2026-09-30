import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeQuote, startingQuantity } from '../../src/core/commerce/quote.js';
import { toConfirmableOrder } from '../../src/core/commerce/confirmable.js';
import { orderBlockedReply, quoteRefusalContext } from '../../src/core/conversation/templates.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { renderProductList, renderProductDetail, type ProductListItem, type ProductDetail } from '../../src/api/web/products.js';
import { reviewPage } from './reviewPage.js';
import { renderProof, type ProofView } from '../../src/api/web/proof.js';
import { parsePriceLines, validateExtracted } from '../../src/core/onboard/catalogImport.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { usd } from '../../src/core/types/money.js';
import type { Email } from '../../src/core/types/ids.js';
import { emptyState, product, tiers, policy, PRODUCT } from './fixtures.js';

/**
 * 0081 — A PRODUCT MAY HAVE NO MINIMUM ORDER, AND NOTHING PRETENDS IT HAS.
 *
 * `products.moq` is nullable; NULL is "no minimum". The owner's rule
 * (2026-09-29): no reply, no page and no export ever prints "minimum 1",
 * "minimum order 1", an empty value, "null", or a blank where a minimum would
 * go. Where there is none, it reads "no minimum" in every language. The
 * export is proved over Postgres in tests/integration/moq-no-minimum.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const NONE = product({ moq: null });

/** What a place that shows a minimum must never say instead of "no minimum". */
const NEVER = [/minimum\s*(?:order\s*)?(?:of\s*)?1\b/i, /\bMOQ\s*[:：]?\s*1\b/, /\bnull\b/, /\bundefined\b/, /\bNaN\b/];
const neverSays = (html: string, where: string) => {
  for (const re of NEVER) expect(re.test(html), `${where}: ${re}`).toBe(false);
};

describe('0081 · the engine: no minimum is no minimum', () => {
  it('any quantity is quoted — one serum included — and the quote carries no minimum', () => {
    const q = computeQuote({ product: NONE, tiers: tiers(), policy: policy(), rules: [], quantity: 1 });
    if (!q.ok && q.error.kind === 'below_moq') throw new Error('refused as below a minimum that does not exist');
    const big = computeQuote({ product: NONE, tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.value.moq).toBeNull();
  });

  it('an order is never blocked as below it', () => {
    const q = computeQuote({ product: NONE, tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!q.ok) throw new Error('fixture');
    const r = toConfirmableOrder({
      state: emptyState({
        product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantity: { value: 5000, unit: 'pcs' }, contact: { email: 'c@example.com' as Email },
      }),
      product: NONE, quote: q.value, paymentTerms: null,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('where to start pricing: her minimum, or where her prices start — never an invented one', () => {
    expect(startingQuantity({ moq: 500 }, [{ minQty: 1 }])).toBe(500);
    expect(startingQuantity({ moq: null }, [{ minQty: 100 }, { minQty: 10 }])).toBe(10);
    expect(startingQuantity({ moq: null }, [])).toBe(1);
  });

  it('a minimum nobody stated is refused in a reply, in five languages — a stated one passes', () => {
    const none = computeQuote({ product: NONE, tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    const fifty = computeQuote({ product: product({ moq: 50 }), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!none.ok || !fifty.ok) throw new Error('fixture');
    const guard = (reply: string, quote: typeof none.value) =>
      guardNumerals({ reply, quote, clientText: 'price for 5000?', state: emptyState() });
    for (const reply of [
      'The minimum order is 1 piece.', 'Minimum order: 1', 'MOQ 1', 'Our minimum is 2 units.',
      '起订量：1个', '1个起订', 'الحد الأدنى للطلب 1', 'El pedido mínimo es de 1 unidad.',
      'La commande minimum est de 1 pièce.',
    ]) {
      expect(guard(reply, none.value).ok, reply).toBe(false);
    }
    expect(guard('The minimum order is 50 pieces.', fifty.value).ok).toBe(true);
    // An ordinary small number is still ordinary language.
    expect(guard('We can ship it in 2 boxes.', none.value).ok).toBe(true);
  });
});

describe('0081 · the fixed sentences never name a minimum that is not there', () => {
  it('the blocked-order question names a stated minimum in the product\'s own unit — never "pieces", never 1', () => {
    const stated = computeQuote({ product: product({ moq: 50, unit: 'boxes' }), tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!stated.ok) throw new Error('fixture');
    const s = orderBlockedReply(['quantity_below_moq'], stated.value);
    expect(s).toContain('50 boxes');
    expect(s).not.toMatch(/pieces/);
    const none = computeQuote({ product: NONE, tiers: tiers(), policy: policy(), rules: [], quantity: 5000 });
    if (!none.ok) throw new Error('fixture');
    neverSays(orderBlockedReply(['quantity_below_moq'], none.value), 'blocked reply, no minimum');
  });

  it('a below-minimum refusal only exists where a minimum was stated', () => {
    const c = quoteRefusalContext({ kind: 'below_moq', moq: 50, requested: 10 });
    expect(c.note).toMatch(/minimum of 50/);
  });
});

const listItem = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1', name: 'Rose face serum', nameZh: null, sku: 'RS-50', moq: null, unit: 'pcs',
  entryQty: 1, entryPrice: usd(34.9), learned: true, status: 'learned', imageMatchable: false, isActive: true,
  ...over,
} as ProductListItem);
const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  currency: 'USD',
  id: 'p1', name: 'Rose face serum', nameZh: null, sku: 'RS-50', category: null, unit: 'pcs', moq: null,
  leadTimeDays: null, customizable: false, learned: true, status: 'learned', imageMatchable: false, isActive: true,
  tiers: [{ minQty: 1, maxQty: null, unitPrice: usd(34.9) }], aliases: [], images: [], recentQuotes: [],
  ...over,
} as ProductDetail);
const PROOF: ProofView = {
  seller: 'Rosa & Clay', productName: 'Rose face serum', sku: 'RS-50',
  quantity: 2, unit: 'pcs', unitPrice: usd(34.9), total: usd(69.8),
  tier: null, moq: null, leadTimeDays: null, certifications: [], taught: [],
  issuedAt: new Date('2026-09-29T02:00:00Z'), locale: 'en',
};

describe('0081 · every page says "no minimum" where the minimum would go — in every language', () => {
  for (const locale of LOCALES) {
    const said = esc(t(locale as Locale, 'product.noMinimum'));
    it(`${locale} · the product list and the product's page`, () => {
      const list = renderProductList([listItem()], locale);
      expect(list).toContain(said);
      neverSays(list, 'list');
      const page = renderProductDetail(detail(), locale);
      expect(page).toContain(said);
      neverSays(page, 'product page');
      // The edit box is empty, and says what empty means.
      expect(page).toMatch(/<input name="moq" inputmode="numeric" placeholder="[^"]+"\s*value=""/);
      expect(page).toContain(esc(t(locale as Locale, 'product.edit.moq.hint')));
    });

    it(`${locale} · the proof page a customer opens`, () => {
      const html = renderProof({ ...PROOF, locale: locale as Locale });
      expect(html).toContain(said);
      neverSays(html, 'proof');
    });

    it(`${locale} · the import review, for a line that states none`, () => {
      const html = reviewPage('Rose face serum 50 ml $34.90', locale as Locale);
      expect(html).toContain(said);
      neverSays(html, 'review');
    });
  }

  it('a stated minimum is still shown as stated', () => {
    const page = renderProductDetail(detail({ moq: 50 }), 'en');
    expect(page).toContain('value="50"');
    expect(page).not.toContain(esc(t('en', 'product.noMinimum')) + '</div>');
  });
});

describe('0081 · what the model is told', () => {
  it('the candidate line says "no minimum", never MOQ:null; the writer gets no minimum key at all', () => {
    const src = read('src/llm/anthropic.ts');
    expect(src).toContain("c.moq === null ? 'no minimum' : `MOQ:${c.moq}`");
    expect(src).toContain('...(quote.moq !== null ? { moq: quote.moq } : {})');
    expect(src).not.toMatch(/\n\s*moq: quote\.moq,/);
  });
});

describe('0081 · the migration and the import', () => {
  it('the column takes NULL, has no default, and is never 0', () => {
    const sql = read('migrations/0081_moq_nullable.sql');
    expect(sql).toMatch(/alter table products alter column moq drop not null;/);
    expect(sql).toMatch(/alter table products alter column moq drop default;/);
    expect(sql).toMatch(/check \(moq is null or moq > 0\)/);
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(81);
  });

  it('an imported line that states no minimum is written with none — the old 100 is gone', () => {
    const src = read('src/api/web/products.ts');
    expect(src).not.toMatch(/p\.moq \?\? 100/);
    // K1 — the one writer writes the row's own minimum: the line's, or the owner's edit, or none.
    expect(src).toMatch(/\$\{p\.unit\}, \$\{p\.moq\},/);
  });
});
