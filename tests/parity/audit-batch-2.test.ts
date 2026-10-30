import { describe, it, expect } from 'vitest';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { tradesForExport } from '../../src/core/owner/sellingStyle.js';
import { BUSINESS_KINDS } from '../../src/core/owner/business.js';
import { keepsMoroccanBooks } from '../../src/core/books/identifiers.js';
import { isExportRoute, isMoroccanBooksRoute } from '../../src/api/web/layout.js';
import { renderBooksHome } from '../../src/api/web/books.js';

/**
 * AUDIT BATCH 2 (2026-10-30) — what a business is shown follows what it is.
 *
 *  · B14 — the export trade's screens (terms with their delivery term, samples, the proforma's "no delivery term"
 *    line) are a business's that sells by quantity. A shop, a brand or an agency is never shown them, and their
 *    addresses answer as unknown ones (tests/integration/audit-batch-2.test.ts runs the routes).
 *  · B15 — the owner's pages say "customer", never "buyer", in all five languages; the list is the Inbox, never
 *    "Buyers"; and Today, the Inbox, the calendar and the insights on Today say "price", never "quote".
 *  · B17 — the Moroccan FEC and the CGNC chart are offered only to books kept to Morocco's rules.
 */

const entries = (l: Locale) => Object.entries(messages[l]) as [MessageKey, string][];
const strip = (s: string) => s.replace(/\{[a-zA-Z_]+\}/g, ' ');

describe('B14 · the export screens are a business\'s that sells by quantity', () => {
  it('a factory, an exporter, a wholesaler and a workspace with no kind trade for export; every other kind does not', () => {
    const exporters = new Set(['manufacturer', 'trading', 'wholesale']);
    for (const kind of BUSINESS_KINDS) expect(tradesForExport(kind), kind).toBe(exporters.has(kind));
    expect(tradesForExport(null)).toBe(true);
    expect(tradesForExport(undefined)).toBe(true);
  });

  it('the gate knows the pages and every form under them, and nothing beside them', () => {
    for (const url of ['/app/settings/terms', '/app/settings/samples', '/app/settings/samples?x=1',
      '/app/settings/samples/7f0c/address', '/app/settings/samples/7f0c/handled']) expect(isExportRoute(url), url).toBe(true);
    for (const url of ['/app/settings/termsx', '/app/settings/closures', '/app/business/how-you-sell', '/terms', '/app/settings'])
      expect(isExportRoute(url), url).toBe(false);
  });
});

/** The old word, as each language wrote it (placeholders like `{buyer}` are not words a reader sees). */
const BUYER: Readonly<Record<Locale, RegExp>> = {
  en: /\bbuyers?\b/i,
  zh: /买家/,
  ar: /مشترٍ|مشتري(?!ات)|المشترين|المشترون|مشترين|مشتريان/,
  es: /comprador/i,
  fr: /acheteu[rs]/i,
};
/** The list's old name, as a place ("on Buyers"). */
const BUYERS_PAGE: Readonly<Record<Locale, RegExp>> = {
  en: /\bBuyers\b/,
  zh: /“买家”|「买家」|买家列表/,
  ar: /قائمة المشترين/,
  es: /\bCompradores\b/,
  fr: /\bAcheteurs\b/,
};
const QUOTE: Readonly<Record<Locale, RegExp>> = {
  en: /\bquot(e|es|ed|ing)\b/i,
  zh: /报价/,
  ar: /عرض (ال)?سعر|عروض (ال)?أسعار|تسعير/,
  es: /cotiz|presupuest/i,
  fr: /\bdevis\b/i,
};
/** Today, the Inbox and its conversation, the calendar, and the insights Today shows. */
const TODAY_INBOX_CALENDAR = ['today.', 'ops.', 'buyers.', 'inbox.', 'conv.', 'live.', 'calendar.', 'insight.', 'nav.'];

describe('B15 · the owner reads "customer", the Inbox and "price", in all five languages', () => {
  for (const l of LOCALES) {
    it(`${l}: no catalogue line says "buyer"`, () => {
      expect(entries(l).filter(([, v]) => BUYER[l].test(strip(v))).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    });
    it(`${l}: no line sends the owner to a list called "Buyers"`, () => {
      expect(entries(l).filter(([, v]) => BUYERS_PAGE[l].test(strip(v))).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    });
    it(`${l}: Today, the Inbox, the calendar and the insights say "price", never "quote"`, () => {
      const bad = entries(l).filter(([k, v]) => TODAY_INBOX_CALENDAR.some((p) => k.startsWith(p)) && QUOTE[l].test(strip(v)));
      expect(bad.map(([k, v]) => `${k}: ${v}`)).toEqual([]);
    });
  }

  it('the checks fire on what they exist for', () => {
    expect(BUYER.en.test('the buyer asked')).toBe(true);
    expect(BUYER.ar.test('هذا المشتري')).toBe(true);
    expect(BUYER.ar.test('المشتريات')).toBe(false); // purchases, not a buyer
    expect(BUYER.ar.test('مشتركًا')).toBe(false); // shared
    expect(QUOTE.en.test('Quote sent to Carlos')).toBe(true);
    expect(QUOTE.ar.test('عرض سعر أُرسل')).toBe(true);
    expect(strip('{buyer} has not answered')).not.toMatch(BUYER.en);
  });
});

describe('B17 · the Moroccan FEC and the CGNC chart are for books kept to Morocco\'s rules', () => {
  it('Morocco, or its identifiers already given; never books with no country or another one', () => {
    expect(keepsMoroccanBooks({ country: 'MA' })).toBe(true);
    expect(keepsMoroccanBooks({ country: null, ice: '001234567000089' })).toBe(true);
    expect(keepsMoroccanBooks({ country: null, rc: '12345' })).toBe(true);
    expect(keepsMoroccanBooks({ country: null })).toBe(false);
    expect(keepsMoroccanBooks({ country: null, ice: null, taxId: null, rc: null })).toBe(false);
    for (const c of ['FR', 'GB', 'ES', 'US', 'CN', 'AE']) expect(keepsMoroccanBooks({ country: c }), c).toBe(false);
  });

  it('the gate knows the FEC page, its files, its file name and the chart', () => {
    for (const url of ['/app/books/fec', '/app/books/fec/0f0e0d0c-0000-4000-8000-000000000001.txt', '/app/books/fec/filename', '/app/books/chart/cgnc'])
      expect(isMoroccanBooksRoute(url), url).toBe(true);
    for (const url of ['/app/books', '/app/books/trial-balance', '/app/books/closing', '/app/books/fecx'])
      expect(isMoroccanBooksRoute(url), url).toBe(false);
  });

  it('the books\' home draws the FEC door only for Moroccan books, in every language', () => {
    const holding = { hasBooks: false, keepUntil: null, law: null, lastCopyAt: null, copyCoversAll: true };
    for (const l of LOCALES) {
      expect(renderBooksHome(l, { isOwner: true }, holding), l).not.toContain('href="/app/books/fec"');
      expect(renderBooksHome(l, { isOwner: true }, holding, undefined, { moroccanBooks: false }), l).not.toContain('href="/app/books/fec"');
      expect(renderBooksHome(l, { isOwner: true }, holding, undefined, { moroccanBooks: true }), l).toContain('href="/app/books/fec"');
    }
  });
});
