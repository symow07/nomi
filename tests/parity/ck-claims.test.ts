import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectClaims, guardClaims, CATEGORY_CLAIMS, PRODUCT_CLAIMS, PRODUCT_CATEGORIES } from '../../src/core/safety/claims.js';
import { parseAnswer, linesFor, CATALOGUE_QUESTIONS, type SellingState } from '../../src/core/owner/howYouSell.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * CK (0110, decision 42) — CLAIMS BY PRODUCT CATEGORY, held both ways like the
 * deletion corpus: what each claim must catch, in the six languages Nomi
 * writes, and the ordinary words it must leave alone. A new phrasing goes here
 * first, with its reason. Over Postgres: tests/integration/ck-claims.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const keys = (text: string) => detectClaims(text).filter((c) => c.kind === 'product_attribute').map((c) => c.claimKey);

/** [claim, what must be caught] — en, es, fr, pt, zh, ar. */
const CAUGHT: readonly (readonly [string, string])[] = [
  ['vegan', 'This serum is vegan.'], ['vegan', 'Es un labial vegano'], ['vegan', 'Notre rouge est végane'], ['vegan', 'O batom é vegano'],
  ['vegan', '这款精华是纯素的'], ['vegan', 'هذا السيروم نباتي'], ['vegan', 'Vegan leather, of course'],
  ['cruelty_free', 'All our products are cruelty-free'], ['cruelty_free', 'Not tested on animals'], ['cruelty_free', 'No testado en animales'],
  ['cruelty_free', 'Non testé sur les animaux'], ['cruelty_free', 'Não testado em animais'], ['cruelty_free', '我们是零残忍品牌'], ['cruelty_free', 'لم يُختبر على الحيوانات'],
  ['halal', 'It is halal certified'], ['halal', 'Es halal'], ['halal', '这款是清真的'], ['halal', 'المنتج حلال'],
  ['organic', 'Made with organic oils'], ['organic', 'Aceite orgánico'], ['organic', 'Huile biologique'], ['organic', 'Óleo orgânico'],
  ['organic', '有机成分'], ['organic', 'زيت عضوي'],
  ['hypoallergenic', 'It is hypoallergenic'], ['hypoallergenic', 'Es hipoalergénico'], ['hypoallergenic', 'Hypoallergénique'], ['hypoallergenic', 'É hipoalergênico'],
  ['hypoallergenic', '低敏配方'], ['hypoallergenic', 'مضاد للحساسية'],
  ['dermatologically_tested', 'Dermatologically tested'], ['dermatologically_tested', 'Dermatológicamente probado'],
  ['dermatologically_tested', 'Dermatologiquement testé'], ['dermatologically_tested', 'Testado dermatologicamente'], ['dermatologically_tested', '经皮肤科测试'],
  ['pregnancy_safe', 'It is safe during pregnancy'], ['pregnancy_safe', 'Seguro durante el embarazo'], ['pregnancy_safe', 'Sans danger pendant la grossesse'],
  ['pregnancy_safe', 'Seguro na gravidez'], ['pregnancy_safe', '孕妇可用'], ['pregnancy_safe', 'آمن أثناء الحمل'],
  ['clears_acne', 'It clears acne in a week'], ['clears_acne', 'Elimina el acné'], ['clears_acne', "Élimine l'acné"], ['clears_acne', 'Acaba com a acne'],
  ['clears_acne', '祛痘效果好'], ['clears_acne', 'يعالج حب الشباب'],
  ['cotton_100', 'The shirt is 100% cotton'], ['cotton_100', 'Camiseta 100% algodón'], ['cotton_100', 'T-shirt 100 % coton'], ['cotton_100', 'Camiseta 100% algodão'],
  ['cotton_100', '这件是纯棉的'], ['cotton_100', 'قطن 100%'],
  ['waterproof', 'The jacket is waterproof'], ['waterproof', 'La chaqueta es impermeable'], ['waterproof', 'La veste est imperméable'],
  ['waterproof', 'A jaqueta é impermeável'], ['waterproof', '这件外套防水'], ['waterproof', 'الجاكيت مقاوم للماء'],
];

/** [what must pass, why]. */
const PASSES: readonly (readonly [string, string])[] = [
  ['Link in bio for the full list', '"bio" is Instagram, not organic'],
  ['A cotton blend, soft and light', 'cotton alone is a material, not a 100% claim'],
  ['We have a water-based formula', 'water-based is not waterproof'],
  ['Our team is free on Monday', '"free" without cruelty'],
  ['Is it suitable for oily skin?', 'a question, no promise'],
  ['Tenemos tallas S, M y L', 'sizes'],
  ['Nous avons du coton bio et du lin', 'still no claim: "coton bio" carries "bio", which is not read'],
  ['Temos tamanhos P, M e G', 'sizes'],
  ['这件是棉麻混纺的', 'a blend'],
  ['المقاسات المتوفرة صغير ومتوسط', 'sizes'],
  ['Pregnancy test kits are not something we sell', '"pregnancy" without "safe"'],
  ['The acne patches come in a box of 36', 'a product named, nothing promised'],
];

describe('CK · each claim is caught, in every language Nomi writes', () => {
  for (const [claim, text] of CAUGHT) {
    it(`${claim} — ${JSON.stringify(text)}`, () => { expect(keys(text), text).toContain(claim); });
  }
});

describe('CK · and ordinary words pass', () => {
  for (const [text, why] of PASSES) {
    it(`${why}: ${JSON.stringify(text)}`, () => { expect(keys(text), text).toEqual([]); });
  }
});

describe('CK · refused unless switched on', () => {
  it('a claim nobody allowed is refused; one the owner switched on goes', () => {
    expect(guardClaims({ reply: 'Yes, it is vegan.', policy: [] }).ok).toBe(false);
    expect(guardClaims({ reply: 'Yes, it is vegan.', policy: [{ kind: 'product_attribute', claimKey: 'vegan', allowed: true }] }).ok).toBe(true);
    expect(guardClaims({ reply: 'Yes, it is vegan and halal.', policy: [{ kind: 'product_attribute', claimKey: 'vegan', allowed: true }] }).ok).toBe(false);
  });
  it('the packs: cosmetics and apparel, as the plan names them; every claim once', () => {
    expect(CATEGORY_CLAIMS.cosmetics).toEqual(['vegan', 'cruelty_free', 'halal', 'organic', 'hypoallergenic', 'dermatologically_tested', 'pregnancy_safe', 'clears_acne']);
    expect(CATEGORY_CLAIMS.apparel).toEqual(['cotton_100', 'waterproof', 'organic', 'vegan']);
    expect(PRODUCT_CLAIMS).toHaveLength(10);
  });
  it('an operator-made workspace nobody categorised keeps what it said before; a self-serve one never does', () => {
    const r = src('src/db/repos.ts');
    expect(r).toContain('select (p.signed_up_at is not null or p.product_category is not null) as e');
    expect(r).toContain("if (enforced) return policy;");
  });
});

describe('CK · How you sell asks what the shop sells, and which claims are true', () => {
  const state: SellingState = {
    quantityFirst: false, products: [], allowed: new Set(['product_attribute:vegan']), terms: null, workingHours: null,
    closures: [], words: new Set(), told: {}, productCategory: null,
  };
  const ctx = { profile: 'retail' as const, pricesToOwner: false };
  it('a question of the catalogue, after certifications', () => {
    expect(CATALOGUE_QUESTIONS.indexOf('product_claims')).toBe(CATALOGUE_QUESTIONS.indexOf('certifications') + 1);
  });
  it('the category is required; only the chosen category\'s ticks are kept', () => {
    expect(parseAnswer('product_claims', {}, ctx).errors['category']).toBe('required');
    const r = parseAnswer('product_claims', { category: 'apparel', 'attr:waterproof': 'on', 'attr:halal': 'on' }, ctx);
    expect(r.answer).toEqual({ q: 'product_claims', category: 'apparel', keys: ['waterproof'] });
  });
  it('the lines: the category, then each of its claims that would change', () => {
    const r = parseAnswer('product_claims', { category: 'cosmetics', 'attr:halal': 'on' }, ctx);
    const lines = linesFor(r.answer!, state);
    expect(lines.map((l) => l.key)).toEqual(['category', 'attr:vegan', 'attr:halal']);
    expect(lines.find((l) => l.key === 'attr:vegan')).toMatchObject({ kind: 'attr', claimKind: 'product_attribute', to: false });
  });
  for (const l of LOCALES) {
    it(`${l} · every word exists`, () => {
      for (const k of [...PRODUCT_CLAIMS.map((c) => `claim.${c}`), ...PRODUCT_CATEGORIES.map((c) => `hs.category.${c}`),
        'hs.q.product_claims', 'hs.lede.product_claims', 'hs.product_claims.hint', 'hs.line.attr.on', 'hs.line.attr.off', 'hs.line.category']) {
        expect(t(l, k as MessageKey, { name: 'X', claim: 'Y', category: 'Z' }), `${l} ${k}`).not.toBe(k);
      }
    });
  }
});
