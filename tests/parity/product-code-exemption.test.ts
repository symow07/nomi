import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { guardNumerals, catalogueWords, type ProductWords } from '../../src/core/safety/numerals.js';
import { usd } from '../../src/core/types/money.js';
import type { Quote } from '../../src/core/types/commerce.js';
import { emptyState, PRODUCT } from './fixtures.js';

/**
 * PC (2026-10-04, the owner's decision; docs/PRODUCT-CODE-CHECK.md) — A
 * PRODUCT'S OWN NAME AND CODE PASS BY THEIR TEXT, NEVER BY THEIR VALUE.
 *
 * "Exempt a product's exact catalogue text from the send-path check, never its
 * figures. So a reply may contain a product's own code like 'ZX-300', but
 * invented numbers, prices and quantities stay guarded exactly as now."
 *
 * Every case runs the guard's own extraction (`guardNumerals`). The pipeline
 * proof is tests/pipeline/product-code-turn.test.ts; the database proof, with
 * the live workspace's five products, tests/integration/product-code-exemption.test.ts.
 */

/** Westlake Canvas Co.'s five active products, read from production (read-only) on 2026-10-04: name | sku. */
const WESTLAKE: readonly ProductWords[] = [
  { names: ['Canvas tote bag 12oz natural', null], sku: 'NEW-mu7040xb-0' },
  { names: ['Canvas tote bag 12oz black', null], sku: 'NEW-mu7040xc-1' },
  { names: ['Cotton drawstring bag 20x25cm', null], sku: 'NEW-mu7040xd-2' },
  { names: ['Zipper canvas pouch A5', null], sku: 'NEW-mu7040xe-3' },
  { names: ['Jute shopping bag laminated', null], sku: 'NEW-mu7040xh-4' },
];
/** A product whose code the owner typed herself, and one whose name carries a figure. */
const ZX: ProductWords = { names: ['Insulated bottle', '保温瓶'], sku: 'ZX-300' };
const THERMOS: ProductWords = { names: ['Thermos 500ml', null], sku: 'TH-A' };

const CATALOGUE = catalogueWords([...WESTLAKE, ZX, THERMOS]);

/** A quote of 5,000 pcs at $1.45, $7,250 in all — the figures the guard reads from one. */
const QUOTE = {
  productId: PRODUCT, quantity: { value: 5000, unit: 'pcs' }, unitPrice: usd(1.45), discountPct: 0,
  total: usd(7250), moq: null, leadTimeDays: null, leadTimeBlocked: null, requiresHuman: false,
} as unknown as Quote;

/** The guard's verdict: null when the reply passes, else the figures it held. */
const held = (reply: string, catalogue: readonly string[] = CATALOGUE, over: { clientText?: string; quote?: Quote | null } = {}) => {
  const r = guardNumerals({ reply, quote: over.quote ?? null, state: emptyState(), clientText: over.clientText ?? '', catalogue });
  return r.ok ? null : r.error.numerals;
};

describe('PC · the catalogue text: every name, and only the owner’s own codes', () => {
  it('the five Westlake names are in; their codes, made up by the import (CC-31), are not', () => {
    const words = catalogueWords(WESTLAKE);
    expect(words).toEqual([
      'Canvas tote bag 12oz natural', 'Canvas tote bag 12oz black', 'Cotton drawstring bag 20x25cm',
      'Zipper canvas pouch A5', 'Jute shopping bag laminated',
    ]);
    for (const p of WESTLAKE) expect(words).not.toContain(p.sku);
  });
  it('a code she typed is in, with the name in every column it is written in', () => {
    expect(catalogueWords([ZX])).toEqual(['Insulated bottle', '保温瓶', 'ZX-300']);
  });
});

describe('PC · each Westlake product passes, named by its exact name', () => {
  const NAMED = [
    'Canvas tote bag 12oz natural is in stock.',
    'Canvas tote bag 12oz black is in stock.',
    'Cotton drawstring bag 20x25cm comes in white.',
    'Zipper canvas pouch A5 has a zip along the top.',
    'Jute shopping bag laminated is our sturdiest bag.',
  ];
  it('in English, one at a time', () => {
    for (const reply of NAMED) expect(held(reply), reply).toBeNull();
  });
  it('and inside Chinese, Arabic, Spanish and French replies', () => {
    for (const reply of [
      'Cotton drawstring bag 20x25cm 有白色的。',
      'Cotton drawstring bag 20x25cm有白色的。',
      'نعم، يتوفر Cotton drawstring bag 20x25cm باللون الأبيض.',
      'El Cotton drawstring bag 20x25cm viene en blanco.',
      'Le Cotton drawstring bag 20x25cm existe en blanc.',
    ]) expect(held(reply), reply).toBeNull();
  });
  it('the one that tripped by its name alone, before: held without the catalogue, for 20 and 25', () => {
    expect(held('Cotton drawstring bag 20x25cm comes in white.', [])).toEqual([20, 25]);
  });
  it('ALL FIVE TOGETHER: none of them trips the check', () => {
    const reply = 'We make the Canvas tote bag 12oz natural, the Canvas tote bag 12oz black, the Cotton drawstring bag 20x25cm, '
      + 'the Zipper canvas pouch A5 and the Jute shopping bag laminated.';
    expect(held(reply, catalogueWords(WESTLAKE))).toBeNull();
  });
  it('written the way people write: any case, a doubled or no-break space', () => {
    for (const reply of ['cotton drawstring bag 20x25cm comes in white.', 'COTTON DRAWSTRING BAG 20X25CM comes in white.',
      'Cotton  drawstring bag 20x25cm comes in white.']) expect(held(reply), reply).toBeNull();
  });
});

describe('PC · a code the owner typed passes', () => {
  it('"The ZX-300 comes in blue" — en, zh, ar, es, fr', () => {
    for (const reply of ['The ZX-300 comes in blue.', 'Yes, the ZX-300 comes in blue.', 'ZX-300 有蓝色的。', 'ZX-300有蓝色的。',
      'نعم، يتوفر ZX-300 باللون الأزرق.', 'El ZX-300 viene en azul.', 'Le ZX-300 existe en bleu.']) {
      expect(held(reply), reply).toBeNull();
    }
  });
  it('without the catalogue it is held, as before', () => {
    expect(held('The ZX-300 comes in blue.', [])).toEqual([300]);
  });
  it('the investigation’s other rows: a figure in a name, and a code beside a real quote', () => {
    expect(held('The Thermos 500ml keeps drinks hot for 12 hours.')).toBeNull();
    expect(held('For 5,000 pcs of the ZX-300 it is $1.45 each, $7,250 in all.', CATALOGUE, { quote: QUOTE })).toBeNull();
    expect(held('For 5,000 pcs of the ZX-300 it is $1.45 each, $7,250 in all.', [], { quote: QUOTE })).toEqual([300]);
  });
  it('the same name in other digits and other forms: Arabic-Indic, full-width, composed or not', () => {
    const cat = catalogueWords([{ names: ['حقيبة ٣٠٠', null], sku: 'B-1' }, { names: ['Café mug 350', null], sku: 'C-1' }, { names: ['Ｍｕｇ ４５０', null], sku: 'M-1' }]);
    expect(held('حقيبة 300 متوفرة باللون الأزرق', cat)).toBeNull();
    expect(held('حقيبة ٣٠٠ متوفرة باللون الأزرق', cat)).toBeNull();
    expect(held('The Café mug 350 is back.', cat)).toBeNull();
    expect(held('The Mug 450 is back.', cat)).toBeNull();
  });
});

describe('PC · an invented figure is still held, with the codes in the catalogue', () => {
  it('a price, a quantity and a minimum nobody set', () => {
    expect(held('It is $300.')).toEqual([300]);
    expect(held('We can do 300 pieces by Friday.')).toEqual([300]);
    expect(held('Minimum order is 500.')).toEqual([500]);
    expect(held('السعر 300 درهم')).toEqual([300]);
    expect(held('五百个起订')).toEqual([500]);
  });
  it('a code beside an invented number: the number is caught', () => {
    expect(held('The ZX-300 is $300 each.')).toEqual([300]);
    expect(held('Cotton drawstring bag 20x25cm, 450 pieces ready.')).toEqual([450]);
    expect(held('ZX-300 每个300元。')).toEqual([300]);
    expect(held('El ZX-300 cuesta 300 dólares.')).toEqual([300]);
  });
  it('the code’s figure is never a sourced value: the same 300 alone is held', () => {
    expect(held('We have 300 in blue.')).toEqual([300]);
    expect(held('We have 500 left.')).toEqual([500]);
  });
});

describe('PC · whole words only, and only her own', () => {
  it('"ZX-3000" when only "ZX-300" exists stays held', () => {
    expect(held('The ZX-3000 comes in blue.')).toEqual([3000]);
    expect(held('The ZX-300A comes in blue.')).toEqual([300]);
    expect(held('The AZX-300 comes in blue.')).toEqual([300]);
    expect(held('Cotton drawstring bag 20x25cms come in white.')).toEqual([20, 25]);
  });
  it('a code the model invented, and the catalogue lacks, stays held', () => {
    expect(held('The ZX-500 comes in blue.')).toEqual([500]);
    expect(held('The ZX-301 comes in blue.')).toEqual([301]);
  });
  it('a code the import made up is not hers to show (CC-31): still held for its figures', () => {
    expect(held('Item NEW-mu7040xb-0 is in stock.', catalogueWords(WESTLAKE))).toEqual([7040]);
  });
  it('a figure glued to the code is not part of it', () => {
    expect(held('ZX-300,450 pieces')).toEqual([300450]);
    expect(held('ZX-300.5 litres')).toEqual([300.5]);
  });
});

describe('PC · the exemption can never carry a price', () => {
  it('refuses a name carrying a price, a percent, or the word for one', () => {
    const cat = catalogueWords([
      { names: ['Gift box $5 special', null], sku: 'G-1' },
      { names: ['Promo pack 20% off', null], sku: 'P-1' },
      { names: ['Low price tote 300', null], sku: 'L-1' },
      { names: ['特价袋300', null], sku: 'Z-1' },
      { names: ['حقيبة بسعر 300', null], sku: 'A-1' },
      { names: ['Bolsa precio 300', null], sku: 'E-1' },
      { names: ['Sac prix 300', null], sku: 'F-1' },
      { names: ['Tote 300 AED', null], sku: 'D-1' },
    ]);
    expect(held('Gift box $5 special is back.', cat)).toEqual([5]);
    expect(held('Promo pack 20% off is back.', cat)).toEqual([20]);
    expect(held('Low price tote 300 is back.', cat)).toEqual([300]);
    expect(held('特价袋300有货。', cat)).toEqual([300]);
    expect(held('حقيبة بسعر 300 متوفرة', cat)).toEqual([300]);
    expect(held('Bolsa precio 300 disponible.', cat)).toEqual([300]);
    expect(held('Sac prix 300 disponible.', cat)).toEqual([300]);
    expect(held('Tote 300 AED is back.', cat)).toEqual([300]);
  });
  it('a bare figure is a value, never a name — even as her own code', () => {
    const cat = catalogueWords([{ names: ['Bottle', null], sku: '300' }]);
    expect(cat).toContain('300');
    expect(held('We can do 300 pieces by Friday.', cat)).toEqual([300]);
  });
  it('the words around a name cannot put a price or a minimum on its figure', () => {
    const cat = catalogueWords([{ names: ['Tote 300', null], sku: 'T-1' }, ZX]);
    expect(held('Tote 300 is in stock.', cat)).toBeNull();
    expect(held('Minimum order: Tote 300', cat)).toEqual([300]);
    expect(held('MOQ Tote 300', cat)).toEqual([300]);
    expect(held('It costs $ ZX-300', cat)).toEqual([300]);
    expect(held('ZX-300% off', cat)).toEqual([300]);
    expect(held('ZX-300 AED', cat)).toEqual([300]);
    expect(held('起订量ZX-300', cat)).toEqual([300]);
    expect(held('discount of ZX-300', cat)).toEqual([300]);
  });
});

describe('PC · one rule, at every place a reply is checked', () => {
  const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
  it('all four call sites in the turn pass the same catalogue, read once', async () => {
    const turn = await src('src/pipeline/turn.ts');
    const calls = [...turn.matchAll(/guardNumerals\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
    expect(calls).toHaveLength(4);   // order status, taught answer, the writer's attempts, the stand-in
    for (const c of calls) expect(c).toMatch(/\bcatalogue\b/);
    expect(turn.match(/tenant\.catalog\.productWords\(\)/g)).toHaveLength(1);
    expect(turn).toContain('catalogue = catalogueWords(await tenant.catalog.productWords());');
  });
  it('the trust invariant re-runs the guard on the turn’s own catalogue', async () => {
    const inv = await src('src/trust/invariants.ts');
    expect(inv).toContain('catalogue: ctx.result.catalogue');
  });
});
