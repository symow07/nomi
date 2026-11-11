import { describe, it, expect } from 'vitest';
import { readReply } from '../../src/core/owner/reading.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { extractQuantity, PIECE_WORDS } from '../../src/core/conversation/understand.js';
import { emptyState } from './fixtures.js';

/**
 * N1 (2026-11-11) — "How {name} read this" marked a customer's own "3 items" as having no source, while "3 pcs" read
 * "in their own words". A small figure is the customer's on the card only when both the reply and the customer write
 * it as a quantity, and the card knew only pieces, pcs, units and bottles. It now reads every word a customer counts
 * pieces with (`PIECE_WORDS`, the words `extractQuantity` already reads). An invented figure still has no source.
 */

const read = (reply: string, theirs: string) => readReply({
  reply, includeSmallFigures: true, productNames: [], quote: null, theirTexts: [theirs], heldQuantity: null,
});
const figure = (reply: string, theirs: string, value: number) =>
  read(reply, theirs).lines.find((l) => l.kind === 'figure' && l.value === value);

describe('N1: a quantity the customer wrote is theirs on the card, whatever word counts it', () => {
  it.each([
    ['en', 'items', 'Your order #1002 for 3 items, Rp 889900 in all, was placed on 9 November 2026.', 'Where is my order #1002? I paid Rp 889900 for 3 items.', '3 items'],
    ['en', 'item', 'Yes, 1 item is in your order.', 'I ordered 1 item', '1 item'],
    ['en', 'pcs', 'Your order #1002 for 3 pcs, Rp 889900 in all, was placed on 9 November 2026.', 'Where is my order #1002? I paid Rp 889900 for 3 pcs.', '3 pcs'],
    ['en', 'pieces', 'We have 3 pieces ready.', 'I need 3 pieces', '3 pieces'],
    ['en', 'units', 'We have 3 units ready.', 'I need 3 units', '3 units'],
    ['ar', 'قطع', 'طلبك رقم 1002 يحتوي على 3 قطع.', 'أين طلبي؟ دفعت مقابل 3 قطع', '3 قطع'],
    ['ar', 'قطعة', 'طلبك يحتوي على 3 قطعة.', 'أريد 3 قطعة', '3 قطعة'],
    ['ar', 'Arabic-Indic digits', 'طلبك يحتوي على ٣ قطع.', 'دفعت مقابل ٣ قطع', '٣ قطع'],
    ['es', 'unidades', 'Tu pedido tiene 3 unidades.', 'Pedí 3 unidades', '3 unidades'],
    ['fr', 'pièces', 'Votre commande compte 3 pièces.', "J'ai commandé 3 pièces", '3 pièces'],
    ['zh', '件', '您的订单有3件。', '我买了3件', '3件'],
  ])('%s, "%s": sourced to the customer', (_lang, _unit, reply, theirs, words) => {
    expect(figure(reply, theirs, 3) ?? figure(reply, theirs, 1)).toMatchObject({ source: 'their_words', words, customerText: theirs });
  });

  it('the customer\'s "3 pcs" sources the reply\'s "3 items", and the other way: one quantity, two words', () => {
    expect(figure('Your 3 items are packed.', 'I want 3 pcs', 3)).toMatchObject({ source: 'their_words' });
    expect(figure('Your 3 pcs are packed.', 'I want 3 items', 3)).toMatchObject({ source: 'their_words' });
    expect(figure('تم تجهيز 3 قطع.', 'I want 3 items', 3)).toMatchObject({ source: 'their_words' });
  });

  it.each([
    ['en', 'Your order for 4 items was placed.', 'I paid for 3 items.'],
    ['en', 'Your order for 4 pcs was placed.', 'I paid for 3 pcs.'],
    ['ar', 'طلبك يحتوي على 4 قطع.', 'دفعت مقابل 3 قطع'],
  ])('%s: an invented "%s" still has no source', (_lang, reply, theirs) => {
    expect(figure(reply, theirs, 4)).toMatchObject({ source: 'unsourced' });
    expect(read(reply, theirs).everyFigureSourced).toBe(false);
  });

  it('a word that only begins like a counting word is not one: "3 itemsx", "3 unitsy" read no quantity', () => {
    expect(figure('Your 3 itemsx are here.', 'I want 3 items', 3)).toMatchObject({ source: 'unsourced' });
    expect(figure('Your 3 unitsy are here.', 'I want 3 units', 3)).toMatchObject({ source: 'unsourced' });
  });

  it('a figure the customer wrote with no counting word is still not promoted (the card\'s rule for small figures)', () => {
    expect(figure('Your 3 items are packed.', 'I paid on the 3rd', 3)).toMatchObject({ source: 'unsourced' });
  });

  it('PIECE_WORDS is the alternation extractQuantity reads as pieces, unchanged by sharing it', () => {
    expect(PIECE_WORDS.split('|')).toEqual(expect.arrayContaining(['items?', 'units?', 'قطع', 'قطعة', '件']));
    expect(extractQuantity('I need 300 items')).toEqual({ value: 300, unit: 'pcs' });
    expect(extractQuantity('أريد 300 قطع')).toEqual({ value: 300, unit: 'pcs' });
    expect(extractQuantity('I need 300 pcs')).toEqual({ value: 300, unit: 'pcs' });
  });
});

describe('N1: the send side — the figure guard never held the customer\'s own quantity', () => {
  const guard = (reply: string, clientText: string) =>
    guardNumerals({ reply, quote: null, state: emptyState(), clientText });

  it.each([
    ['Your order #1002 for 3 items, Rp 889900 in all, was placed on 9 November.', 'Where is my order #1002? I paid Rp 889900 for 3 items.'],
    ['Your 30 items are packed.', 'I ordered 30 items'],
    ['طلبك يحتوي على 30 قطع.', 'دفعت مقابل 30 قطع'],
  ])('lets "%s" through: every figure is the customer\'s', (reply, clientText) => {
    expect(guard(reply, clientText).ok).toBe(true);
  });

  it("the tester's #1002 reply: the only figure held is the year, which the order's facts allow on the real path (`orderFactNumbers` in turn.ts) — never the 3", () => {
    const r = guard('Your order #1002 for 3 items, Rp 889900 in all, was placed on 9 November 2026.', 'Where is my order #1002? I paid Rp 889900 for 3 items.');
    expect(r.ok ? [] : r.error.numerals).toEqual([2026]);
  });

  it('a small figure passes as a word whatever the customer wrote (the guard\'s own rule, not N1)', () => {
    expect(guard('Your 4 items are packed.', 'I ordered 3 items').ok).toBe(true);
  });

  it('an invented larger quantity is still held', () => {
    const r = guard('Your 40 items are packed.', 'I ordered 30 items');
    expect(r.ok).toBe(false);
  });
});
