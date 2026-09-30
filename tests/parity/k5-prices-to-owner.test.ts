import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { statesAPrice } from '../../src/core/safety/statesPrice.js';
import { renderAddForm, renderPricesToMe } from '../../src/api/web/products.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { PROBLEM_SIGNAL_KINDS, TRIGGER_REASONS } from '../../src/core/scoring/signals.js';

/**
 * K5 — "prices go to me" (the onboarding plan, Stage 2; 0094). The corpus
 * that holds `statesAPrice` both ways: a reply that states a price where the
 * owner's prices go to her is thrown away, and one that states none goes as
 * written. A new phrasing goes here with its reason.
 */

/** Each of these states a price. */
const PRICES: readonly [string, string][] = [
  ['Yes, it is $20.', 'a dollar sign'],
  ['The scarf is 45 AED.', 'a code after the figure'],
  ['AED 45 each.', 'a code before the figure'],
  ['It costs 20.', 'a price word before a bare figure'],
  ['The price is 120.', 'the word "price"'],
  ['That one is 12 each.', '"each" after a bare figure'],
  ['12 per pair.', '"per pair"'],
  ['这款 45元。', 'yuan after the figure'],
  ['价格是 120。', 'a Chinese price word'],
  ['السعر 45.', 'an Arabic price word'],
  ['بسعر 120 درهم', 'an Arabic price word and dirhams'],
  ['El precio es 30.', 'a Spanish price word'],
  ['Il coûte 25 €.', 'a French price and the euro'],
  ['R$ 49,90 cada.', 'reais'],
  ['Rp 150.000 saja.', 'rupiah'],
  ['₹500 only.', 'rupees'],
];

/** None of these states a price. */
const NOT_PRICES: readonly [string, string][] = [
  ['We have it in 3 colours.', 'a count'],
  ['Yes, we have size 38.', 'a size'],
  ['We are open from 9 to 6.', 'hours'],
  ['It takes 3 days to arrive.', 'a delivery time'],
  ['Only 2 left in black.', 'stock, "only" is not a price word here'],
  ['Limit 2 per person.', '"per person" is not a unit of sale'],
  ['我们有 3 种颜色。', 'a count in Chinese'],
  ['لدينا 3 ألوان.', 'a count in Arabic'],
  ['Happy to help — someone will reply with the price.', 'the word "price" with no figure'],
];

describe('K5 · statesAPrice — both ways', () => {
  for (const [reply, why] of PRICES) it(`states a price: ${JSON.stringify(reply)} (${why})`, () => expect(statesAPrice(reply)).toBe(true));
  for (const [reply, why] of NOT_PRICES) it(`states none: ${JSON.stringify(reply)} (${why})`, () => expect(statesAPrice(reply)).toBe(false));
});

describe('K5 · the owner\'s choice', () => {
  it('the add page offers it, and says what it does, in every language; when on, how to come back', () => {
    for (const l of LOCALES) {
      const off = renderAddForm(l);
      expect(off, l).toContain('action="/app/products/prices-to-me"');
      expect(off, l).toContain('name="on" value="1"');
      const on = renderPricesToMe(l, true);
      expect(on, l).toContain('name="on" value="0"');
      expect(on, l).not.toMatch(/\bproduct\.pricesToMe\./);
    }
  });

  it('staff see no form they would be refused (rule 11): the add page is the owner\'s', () => {
    expect(renderAddForm('en', { isOwner: false })).not.toContain('prices-to-me');
  });

  it('its hand-off has a reason in every language and on the escalation trail', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('price_to_owner');
    expect(TRIGGER_REASONS).toContain('price_to_owner');
    for (const l of LOCALES) expect(t(l, 'takeover.reason.price_to_owner'), l).not.toBe('takeover.reason.price_to_owner');
  });

  it('the route is the owner\'s, and completes Setup\'s products step', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/app\.post\('\/app\/products\/prices-to-me'[\s\S]{0,200}ownerOnly\(req, reply, 'price_rules'/);
    const setup = readFileSync(new URL('../../src/db/setup.ts', import.meta.url), 'utf8');
    expect(setup).toMatch(/or coalesce\(\(select prices_to_owner from businesses/);
  });
});
