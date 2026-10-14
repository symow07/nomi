import { describe, it, expect } from 'vitest';
import { CLOSE, closeCall, whichOne } from '../../src/core/conversation/whichProduct.js';
import { addressesInGender } from '../../src/core/safety/address.js';
import type { RetrievedProduct } from '../../src/retrieval/ports.js';
import type { ProductId } from '../../src/core/types/ids.js';

/**
 * Two products the words fit about equally: ask which, never guess (the owner, 2026-10-14). The scores below are the
 * ones the real search gives (0156's `alias_match`); over Postgres: tests/integration/which-product.test.ts.
 */
const p = (id: string, relevance: number, matchedVia: RetrievedProduct['matchedVia'] = 'trigram'): RetrievedProduct => ({
  productId: id as ProductId, sku: id, name: id, category: null, moq: null, relevance, matchedVia,
});

describe('a close call: the two best names are close', () => {
  it('«无纺布袋» — 无纺布购物袋 0.400, 无纺布手提袋 0.400: close', () => {
    expect(closeCall([p('shopping', 0.4), p('tote', 0.4), p('canvas', 0.25)], null)?.map((x) => x.productId)).toEqual(['shopping', 'tote']);
  });
  it('"the shopping bags" — canvas 0.308, non-woven 0.286: close', () => {
    expect(closeCall([p('canvas', 0.308), p('nonwoven', 0.286)], null)).not.toBeNull();
  });
  it('«无纺布购物袋» said whole — 1.0 against 0.4: not close', () => {
    expect(closeCall([p('shopping', 1.0), p('tote', 0.4)], null)).toBeNull();
  });
  it('«无纺布袋» against 帆布袋 — 0.40 against 0.25: not close', () => {
    expect(closeCall([p('shopping', 0.4), p('canvas', 0.25)], null)).toBeNull();
  });
  it(`the line is ${CLOSE}: just inside asks, just outside does not`, () => {
    expect(closeCall([p('a', 0.4), p('b', 0.4 * CLOSE)], null)).not.toBeNull();
    expect(closeCall([p('a', 0.4), p('b', 0.4 * CLOSE - 0.001)], null)).toBeNull();
  });
  it('one product found: nothing to ask', () => {
    expect(closeCall([p('only', 0.4)], null)).toBeNull();
  });
  it('a product the buyer already confirmed is not asked about again', () => {
    expect(closeCall([p('shopping', 0.4), p('tote', 0.4)], 'tote' as ProductId)).toBeNull();
  });
  it('a semantic rank is another scale: not read as a close call', () => {
    expect(closeCall([p('a', 0.016, 'semantic'), p('b', 0.0159, 'semantic')], null)).toBeNull();
  });
});

describe('the question names both, in the buyer\'s language — and addresses nobody in a gender', () => {
  for (const lang of ['en', 'zh', 'ar', 'es', 'fr', 'pt'] as const) {
    it(lang, () => {
      const q = whichOne('无纺布购物袋', '无纺布手提袋', lang);
      expect(q).toContain('无纺布购物袋');
      expect(q).toContain('无纺布手提袋');
      expect(addressesInGender(q)).toBeNull();
    });
  }
});
