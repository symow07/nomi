import { describe, it, expect } from 'vitest';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * Block 5 (the tester's small texts, 2026-11-21) — two sentences that said something untrue:
 * a NEW credit note refused for "more than is left" told the owner to discard a draft there is none of, and a bill
 * refused for its amount said an entry's "Line {n}: …" with the placeholder left in (a bill has no lines).
 */
describe('Block 5 · small texts', () => {
  it('a credit note over what is left names no draft to discard, in every language', () => {
    const draft = /draft|草稿|مسودة|borrador|brouillon/i;
    for (const l of LOCALES) {
      const s = t(l, 'books.credit.moreThanLeft', { line: 2 });
      expect(s, l).toContain('2');
      expect(s, l).not.toMatch(draft);
      expect(s, l).not.toMatch(/\{\w+\}/);
      // the same refusal fires when the owner simply typed too much on a new note: it claims no other note, and
      // names no quantity (a price reduction is refused the same way)
      expect(s, l).not.toMatch(/in between|期间|في الأثناء|entretanto|entre-temps|数量/);
    }
  });

  it('a bill refused for its amount says what it needs, with no line number and no placeholder', () => {
    for (const l of LOCALES) {
      const s = t(l, 'booksSpending.flash.billRefused', { why: t(l, 'booksSpending.refused.amount') });
      expect(s, l).not.toMatch(/\{\w+\}/);
      expect(s, l).not.toMatch(/Line|行|السطر|línea|ligne/i);
    }
    expect(t('en', 'booksSpending.flash.billRefused', { why: t('en', 'booksSpending.refused.amount') }))
      .toBe('The bill was not recorded: it needs its date and an amount above zero, tax included.');
  });
});
