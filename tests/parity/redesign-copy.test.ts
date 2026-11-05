import { describe, expect, it } from 'vitest';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

describe('approved English redesign copy', () => {
  it('resolves new navigation through the catalogue in every existing locale', () => {
    for (const locale of LOCALES) {
      expect(t(locale, 'nav.customers' as MessageKey)).toBe('Customers');
      expect(t(locale, 'area1.results.title' as MessageKey)).toBe('Sales results');
    }
  });

  it('keeps existing translations while the new copy uses English fallback', () => {
    expect(messages.zh['nav.products']).toBe('产品目录');
    expect(messages.fr['nav.products']).toBe('Produits');
  });
});
