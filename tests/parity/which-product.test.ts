import { describe, it, expect } from 'vitest';
import { CLOSE, NAMED, closeCall, whichOne } from '../../src/core/conversation/whichProduct.js';
import { addressesInGender } from '../../src/core/safety/address.js';
import type { RetrievedProduct } from '../../src/retrieval/ports.js';
import type { ProductId } from '../../src/core/types/ids.js';

/**
 * Products the words fit about equally: ask which, never guess (the owner, 2026-10-14). The scores below are the ones
 * the real search gives (0156's `alias_match`); over Postgres: tests/integration/which-product.test.ts; through a whole
 * turn, at the line itself: tests/pipeline/which-product-turn.test.ts.
 */
const p = (id: string, relevance: number, matchedVia: RetrievedProduct['matchedVia'] = 'trigram'): RetrievedProduct => ({
  productId: id as ProductId, sku: id, name: id, category: null, moq: null, relevance, matchedVia,
});
const ids = (r: readonly RetrievedProduct[] | null) => r?.map((x) => x.productId) ?? null;

describe('a close call: the best names are close', () => {
  it('«无纺布袋» — 无纺布购物袋 0.400, 无纺布手提袋 0.400: close; 帆布袋 0.25 is not in it', () => {
    expect(ids(closeCall([p('shopping', 0.4), p('tote', 0.4), p('canvas', 0.25)], null))).toEqual(['shopping', 'tote']);
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
  it(`THE LINE, ${CLOSE} of the best: 0.340 against 0.400 asks; 0.339 does not`, () => {
    expect(closeCall([p('a', 0.4), p('b', 0.34)], null)).not.toBeNull();
    expect(closeCall([p('a', 0.4), p('b', 0.339)], null)).toBeNull();
    expect(closeCall([p('a', 0.4), p('b', 0.4 * CLOSE)], null)).not.toBeNull();
    expect(closeCall([p('a', 0.4), p('b', 0.4 * CLOSE - 0.001)], null)).toBeNull();
  });
  it('THREE close: all three, best first — never two picked from three', () => {
    expect(ids(closeCall([p('b', 0.38), p('a', 0.4), p('c', 0.36), p('far', 0.2)], null))).toEqual(['a', 'b', 'c']);
  });
  it('every close one, however many: six variants tied are six', () => {
    const six = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map((id) => p(id, 0.4));
    expect(closeCall(six, null)).toHaveLength(6);
  });
  it('equal scores read in name order, whatever order the search returned them', () => {
    expect(ids(closeCall([p('tote', 0.4), p('shopping', 0.4)], null))).toEqual(['shopping', 'tote']);
  });
  it('one product found, or the same one twice: nothing to ask', () => {
    expect(closeCall([p('only', 0.4)], null)).toBeNull();
    expect(closeCall([p('only', 0.4), p('only', 0.4)], null)).toBeNull();
  });
  it('a product the buyer already confirmed is not asked about again — wherever it sits among the close ones', () => {
    expect(closeCall([p('shopping', 0.4), p('tote', 0.4)], 'tote' as ProductId)).toBeNull();
    expect(closeCall([p('a', 0.4), p('b', 0.39), p('c', 0.38)], 'c' as ProductId)).toBeNull();
  });
  it('a semantic rank is another scale: not read as a close call', () => {
    expect(closeCall([p('a', 0.016, 'semantic'), p('b', 0.0159, 'semantic')], null)).toBeNull();
  });
});

const LANGS = ['en', 'zh', 'ar', 'es', 'fr', 'pt'] as const;
const NAMES = ['无纺布购物袋', '无纺布手提袋', '无纺布背心袋', '无纺布抽绳袋', '无纺布保温袋', '无纺布折叠袋'];

describe('the question names them, in the buyer\'s language — and addresses nobody in a gender', () => {
  for (const n of [2, 3, NAMED]) {
    for (const lang of LANGS) {
      it(`${n} close · ${lang}: every name`, () => {
        const q = whichOne(NAMES.slice(0, n), lang);
        for (const name of NAMES.slice(0, n)) expect(q, name).toContain(name);
        expect(addressesInGender(q)).toBeNull();
      });
    }
  }
  for (const lang of LANGS) {
    it(`six close · ${lang}: the first ${NAMED} named and the other two counted — none dropped in silence`, () => {
      const q = whichOne(NAMES, lang);
      for (const name of NAMES.slice(0, NAMED)) expect(q, name).toContain(name);
      for (const name of NAMES.slice(NAMED)) expect(q, name).not.toContain(name);
      expect(q).toMatch(/2/);
      expect(addressesInGender(q)).toBeNull();
    });
  }
  it('two, as before: "Which one do you mean — A or B?" / 请问您指的是哪一款：A，还是B？', () => {
    expect(whichOne(['A', 'B'], 'en')).toBe('Which one do you mean — A or B?');
    expect(whichOne(['A', 'B'], 'zh')).toBe('请问您指的是哪一款：A，还是B？');
    expect(whichOne(['A', 'B', 'C'], 'en')).toBe('Which one do you mean — A, B or C?');
    expect(whichOne(['A', 'B', 'C'], 'zh')).toBe('请问您指的是哪一款：A、B，还是C？');
  });
});
