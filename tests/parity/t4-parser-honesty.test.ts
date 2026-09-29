import { describe, it, expect } from 'vitest';
import { parsePriceLines, validateExtracted, validatePage } from '../../src/core/onboard/catalogImport.js';
import { renderReview } from '../../src/api/web/products.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { usd } from '../../src/core/types/money.js';

/**
 * T4 — THE PRICE LIST IS READ HONESTLY, OR NOT AT ALL.
 *
 * A price read wrongly is a price a customer is quoted. The parser reads a
 * figure one way or refuses it with a reason the review names:
 *
 *   · thousands commas are thousands — "$1,250.00" was read as $1.00;
 *   · a figure that reads two ways ("1.250,00", "12,50", "1.250") is refused;
 *   · only US dollars for now (until a workspace has its own currency): "€",
 *     "18元", "HK$25" are refused — they came in as no price, or as dollars;
 *   · a spreadsheet row with several numbers and none marked as the price is
 *     refused instead of priced from whichever came first;
 *   · a line that states no minimum has none (0081), and «حد أدنى» is read.
 */

const one = (line: string) => parsePriceLines(line)[0]!;

describe('T4 · separators', () => {
  it('thousands commas are thousands', () => {
    expect(one('Leather bag $1,250.00').price).toEqual(usd(1250));
    expect(one('Sofa $12,500').price).toEqual(usd(12500));
    expect(one('Leather bag 1,250.00 USD').price).toEqual(usd(1250));
  });
  it('a figure that reads two ways is refused, never guessed', () => {
    for (const line of ['Bag $1.250,00', 'Bag $12,50', 'Bag $1.250', 'Bag\t1.250,00']) {
      expect(one(line), line).toMatchObject({ price: null, problem: 'ambiguous_price' });
    }
  });
  it('an ordinary decimal, and sentence punctuation after it, are fine', () => {
    expect(one('Cup $0.125').price).toEqual(usd(0.125));
    expect(one('Rose face serum 50 ml $34.90.').price).toEqual(usd(34.9));
    expect(one('Serum US$25').price).toEqual(usd(25));
  });
});

describe('T4 · only US dollars, for now', () => {
  it('another currency is refused, not read as dollars or as no price', () => {
    for (const line of ['Serum €34.90', 'Serum £30', 'Serum HK$25', 'Serum A$40', 'Mug 18元', 'Mug RMB 18', 'عطر 50 درهم']) {
      expect(one(line), line).toMatchObject({ price: null, problem: 'not_usd' });
    }
  });
  it('美元 is dollars, not 元', () => {
    expect(one('帆布袋 1.05美元 500个起')).toMatchObject({ price: usd(1.05), moq: 500 });
  });
});

describe('T4 · spreadsheet rows', () => {
  it('one number is the price; a price and a whole minimum is the documented shape', () => {
    expect(one('Tote\t2.6')).toMatchObject({ price: usd(2.6), moq: null });
    expect(one('保温杯\t2.6\t1000')).toMatchObject({ price: usd(2.6), moq: 1000 });
  });
  it('several numbers and none marked as the price: refused', () => {
    for (const line of ['Tote\t2.6\t3.1', 'Tote\t2.6\t3.1\t1000']) {
      expect(one(line), line).toMatchObject({ price: null, problem: 'several_numbers' });
    }
    // A $ says which one it is.
    expect(one('Tote\t$2.6\t3.1')).toMatchObject({ price: usd(2.6) });
  });
});

describe('T4 · the minimum', () => {
  it('none stated is none — and the Arabic word for it is read', () => {
    expect(one('Rose face serum 50 ml $34.90').moq).toBeNull();
    expect(one('حقيبة $3 حد أدنى 50').moq).toBe(50);
    expect(one('حقيبة $3 الحد الأدنى: 50')).toMatchObject({ moq: 50, name: 'حقيبة' });
  });
});

describe('T4 · the review names each refusal, with the line itself', () => {
  it('refused with its reason, in paste and on a page, never brought in', () => {
    const text = ['Bag $1.250,00', 'Serum €34.90', 'Tote\t2.6\t3.1', 'Cup $2.60'].join('\n');
    for (const v of [validateExtracted(parsePriceLines(text)), validatePage(parsePriceLines(text))]) {
      expect(v.accepted.map((p) => p.name)).toEqual(['Cup']);
      expect(v.rejected.map((r) => r.reason)).toEqual(['ambiguous_price', 'not_usd', 'several_numbers']);
    }
  });
  it('the review shows the line as written, and why, in every language', () => {
    const text = 'Serum €34.90';
    const v = validateExtracted(parsePriceLines(text));
    for (const locale of LOCALES) {
      const html = renderReview(v, text, locale as Locale);
      expect(html, locale).toContain('Serum €34.90');
      expect(html, locale).toContain(esc(t(locale as Locale, 'product.reject.not_usd' as MessageKey)));
    }
  });
  it('the paste page shows a shop-style example, not only wholesale ones', () => {
    for (const locale of LOCALES) {
      expect(t(locale as Locale, 'product.add.example3' as MessageKey), locale).toMatch(/\$34\.90/);
    }
  });
});
