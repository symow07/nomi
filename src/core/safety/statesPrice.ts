import { asciiDigits, currencyBeside } from './numerals.js';

/**
 * K5 — "PRICES GO TO ME": does this reply state a price?
 *
 * A business whose prices go to the owner has told Nomi no price, so no price
 * is sourced and the numeral guard refuses an invented one. But the guard
 * counts the CUSTOMER'S own figures as sourced — "is it $20?" answered "yes,
 * $20" would pass it — and that is exactly the answer this business asked not
 * to be given. So here any figure written as money is a price: a currency sign
 * or code beside it, in any currency, or a price word just before it. A reply
 * that states one is thrown away and the turn goes to the owner (turn.ts).
 *
 * Precision is the point, both ways: "we have 3 colours", "size 38", "open
 * from 9 to 6" state no price. `tests/parity/k5-prices-to-owner.test.ts` holds
 * the corpus; a new phrasing goes there with its reason. Pure.
 */

/** Words that make the figure after them a price, in the languages the safety checks read. */
const PRICE_BEFORE = new RegExp([
  String.raw`(?<![A-Za-z])(?:price|prices|priced|cost|costs|costing|pay|charge|charged|total)\s*(?:is|are|of|:)?\s*$`,
  String.raw`(?:价格|价钱|售价|单价|报价|收费|总共|一共)\s*(?:是|为|:|：)?\s*$`,
  String.raw`(?:السعر|سعر|بسعر|التكلفة|المجموع)\s*(?:هو|:)?\s*$`,
  String.raw`(?<![A-Za-z])(?:precio|cuesta|cuestan|prix|coûte|coûtent|preço|custa)\s*(?:es|de|est|é|:)?\s*$`,
].join('|'), 'i');

/** Words that make the figure before them a price: "20 each", "20 a piece", "20 per pair". */
const PRICE_AFTER = /^\s*(?:each|apiece|a piece|per\s+(?:piece|item|unit|pair|set|pack|box|bottle|dozen|kg|metre|meter)|\/\s*(?:pc|pcs|piece|item|each|unit))(?![A-Za-z])|^\s*(?:元|块|美元)|^\s*(?:للقطعة|للواحدة)/i;

const FIGURE = /\d[\d.,]*/g;

export function statesAPrice(reply: string): boolean {
  const text = asciiDigits(reply);
  for (const m of text.matchAll(FIGURE)) {
    const at: readonly [number, number] = [m.index, m.index + m[0].length];
    if (currencyBeside(text, at) !== null) return true;
    if (PRICE_BEFORE.test(text.slice(Math.max(0, at[0] - 24), at[0]))) return true;
    if (PRICE_AFTER.test(text.slice(at[1], at[1] + 16))) return true;
  }
  return false;
}
