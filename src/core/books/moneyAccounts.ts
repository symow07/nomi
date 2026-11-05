/**
 * WHICH ACCOUNT MONEY LANDS IN (the Books audit, 2026-11-05). The chart stores a kind ('asset'), not "this is a bank":
 * the payment form offered all 294 asset accounts of the Moroccan chart with the first selected, so pressing Record as
 * drawn put the money in a fixed asset, and a posted entry can only be reversed.
 *
 * Read from the account itself, by fixed rules, never from where money was posted before: past postings carry that
 * very mistake. Caller's part: an asset account, active, with no account under it.
 *
 *   · the CGNC's own numbering: 514 banks, the Trésorerie Générale and postal cheques; 516 cash. 511 (cheques still to
 *     be cashed) is neither.
 *   · any other chart: "bank" or "cash" as a word of the name, in the languages the owner's pages and the fixed replies
 *     use, and German's "Kasse" for the charts read in from elsewhere. A word, so "Riverbank premises" and "Cashmere
 *     stock" are not. The corpus, both ways: tests/parity/books-money-accounts.test.ts.
 *
 * A bank account named by neither ("1000 · Barclays Current") is not offered, and the page says what to do.
 */
const CGNC_MONEY = /^51[46]/;
const WORD = /(?<![\p{L}\p{N}])(?:banks?|banques?|bancos?|cash|caisses?|cajas?|caixas?|kasse|kassen)(?![\p{L}\p{N}])/u;
/** "Bons de caisse" are short-term securities (CGNC 35061), not a till. */
const NOT_MONEY = /bons? de caisse/u;
/** Neither script spaces its words as Latin does: 银行存款 and 库存现金 are whole, البنك carries its article. */
const NO_SPACES = /银行|现金|(?<![\p{L}\p{N}])(?:ال)?(?:بنك|مصرف|صندوق)(?![\p{L}\p{N}])/u;

export const holdsMoney = (code: string, name: string): boolean => {
  if (CGNC_MONEY.test(code)) return true;
  const said = name.normalize('NFKC').toLowerCase();
  return !NOT_MONEY.test(said) && (WORD.test(said) || NO_SPACES.test(said));
};
