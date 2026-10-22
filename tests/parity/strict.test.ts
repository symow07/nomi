import { describe, it, expect } from 'vitest';
import { STRICT_LOCALES, STRICT_SIGNED, onlySignedSentences, proposedSentences, strictSetFor } from '../../src/core/conversation/strict.js';

/**
 * S4 (Phase 5, item 16) — strict mode per language, the pure part: what counts as a reply made only of signed
 * sentences. The 500 varied turns through the send decision: tests/pipeline/strict-mode.test.ts.
 */
const facts = { product: 'Canvas Tote 12oz', business: 'Atlas Bags', name: 'Lily' };
const en = proposedSentences('en');

describe('S4 · gated on a person', () => {
  it('NO SET IS SIGNED: strict mode is in force in no language until a reader signs one, in strict.ts', () => {
    expect(STRICT_SIGNED).toEqual({});
    for (const l of STRICT_LOCALES) expect(strictSetFor(l), l).toBeNull();
  });
  it('a signed set makes its language strict, and only its language', () => {
    expect(strictSetFor('en-US', { en })).toBe(en);
    expect(strictSetFor('fr', { en })).toBeNull();
    expect(strictSetFor(null, { en })).toBeNull();
  });
  it('the starter sets use only the blanks Nomi can fill', () => {
    for (const l of STRICT_LOCALES) for (const s of proposedSentences(l)) {
      for (const b of s.match(/\{[a-z]+\}/g) ?? []) expect(['{product}', '{business}', '{name}', '{qty}', '{price}', '{days}'], `${l}: ${s}`).toContain(b);
    }
  });
});

describe('S4 · only signed sentences, end to end', () => {
  it('signed sentences, in any order, their blanks filled with this turn\'s facts, separated by a space or a line', () => {
    for (const reply of [
      'Hello, thank you for your message.',
      'Hello, thank you for your message. How many pieces do you need?',
      'The minimum order for Canvas Tote 12oz is 500 pieces.\nWe can send a sample of Canvas Tote 12oz.',
      'The price of Canvas Tote 12oz is $0.92 per piece for 1,000 pieces. Thank you!',
      'The price of Canvas Tote 12oz is USD 1.20 per piece for 500 pieces.',
      'Canvas Tote 12oz can be ready in 25 days.',
    ]) expect(onlySignedSentences(reply, en, facts), reply).toBe(true);
  });
  it('anything else waits: a word changed, a sentence added, another product, a blank filled with words, nothing at all', () => {
    for (const reply of [
      'Hello, thanks for your message.',
      'Hello, thank you for your message. We are the best factory in Yiwu.',
      'The minimum order for Leather Bag is 500 pieces.',
      'The minimum order for Canvas Tote 12oz is a few pieces.',
      'How many pieces do you need?!',
      'Canvas Tote 12oz can be ready in 2500 days.',
      '',
    ]) expect(onlySignedSentences(reply, en, facts), JSON.stringify(reply)).toBe(false);
  });
  it('a blank with no fact to fill it matches nothing: no product this turn, no sentence naming one', () => {
    expect(onlySignedSentences('We can send a sample of Canvas Tote 12oz.', en, { ...facts, product: null })).toBe(false);
    expect(onlySignedSentences('How many pieces do you need?', en, { ...facts, product: null })).toBe(true);
  });
  it('Chinese runs its sentences together; Arabic and French keep their own punctuation', () => {
    const zh = proposedSentences('zh');
    expect(onlySignedSentences('您好，感谢您的留言。请问您需要多少件？', zh, facts)).toBe(true);
    expect(onlySignedSentences('您好，感谢您的留言。请问您要多少件？', zh, facts)).toBe(false);
    expect(onlySignedSentences('الحد الأدنى للطلب من Canvas Tote 12oz هو ٥٠٠ قطعة.', proposedSentences('ar'), facts)).toBe(true);
    expect(onlySignedSentences('Merci !', proposedSentences('fr'), facts)).toBe(true);
    expect(onlySignedSentences('Merci!', proposedSentences('fr'), facts)).toBe(false);
  });
});
