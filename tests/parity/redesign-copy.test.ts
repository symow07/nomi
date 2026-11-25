import { describe, expect, it } from 'vitest';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

describe('approved English redesign copy', () => {
  it('resolves new navigation through the catalogue in every existing locale', () => {
    for (const locale of LOCALES) {
      // The navigation block (2026-11-25): the rail's own words are written in every language now.
      expect(t(locale, 'nav.customers' as MessageKey)).toBe(({ en: 'Customers', zh: '客户', ar: 'العملاء', es: 'Clientes', fr: 'Clients' } as const)[locale]);
      expect(t(locale, 'area1.results.title' as MessageKey)).toBe('Sales results');
    }
  });

  it('keeps existing translations while the new copy uses English fallback', () => {
    expect(messages.zh['nav.products']).toBe('产品目录');
    expect(messages.fr['nav.products']).toBe('Produits');
  });
});
