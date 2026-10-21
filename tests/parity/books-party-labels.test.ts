import { describe, it, expect } from 'vitest';
import { t } from '../../src/api/web/say.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';

/**
 * D0 — the add-customer form's labels name what each field takes, in every language. C2 shipped them shuffled (the
 * Name field labelled "ICE (15 digits)", Country "Name", ICE "Country"): the words were right, their keys were not, and
 * no test read a label against its field. Each label must carry its own field's word, and no other field's.
 */
const WORDS: Record<Locale, Record<'name' | 'country' | 'ice' | 'address', string>> = {
  en: { name: 'Name', country: 'Country', ice: 'ICE', address: 'Address' },
  zh: { name: '名称', country: '国家', ice: 'ICE', address: '地址' },
  ar: { name: 'الاسم', country: 'البلد', ice: 'ICE', address: 'العنوان' },
  es: { name: 'Nombre', country: 'País', ice: 'ICE', address: 'Dirección' },
  fr: { name: 'Nom', country: 'Pays', ice: 'ICE', address: 'Adresse' },
};

describe('D0 · the customer form: each label names its own field', () => {
  for (const locale of Object.keys(WORDS) as Locale[]) {
    it(locale, () => {
      const w = WORDS[locale];
      for (const field of ['name', 'country', 'ice', 'address'] as const) {
        const label = t(locale, `books.party.${field}`);
        expect(label, `${field}`).toContain(w[field]);
        for (const other of ['country', 'ice', 'address'] as const) if (other !== field) expect(label, `${field} vs ${other}`).not.toContain(w[other]);
      }
    });
  }
});
