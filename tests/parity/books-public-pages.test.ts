import { describe, it, expect } from 'vitest';
import { renderPrivacy, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { HOSTING, aiProcessor, processorLabel } from '../../src/core/legal/processors.js';
import { OPTIONAL_RECIPIENTS, recipientNamed } from '../../src/core/legal/recipients.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * A6 (2026-10-28; docs/LAUNCH-CHECKLIST.md, "Before the books are switched on for ANY workspace") — the public pages
 * describe the books before anyone's are switched on: what they hold and who sees them, the shop's own Odoo, the
 * provider that reads a paper the owner asks it to (the replies' own provider, D6), what closure keeps, for how long
 * and why, imported history; and, on the deletion page, that a customer's deletion leaves the books' entries that
 * name them, and that the shop's own copies are the shop's to delete.
 */
const deepseek = aiProcessor('https://api.deepseek.com');
const FACTS: LegalFacts = { processor: deepseek, hosting: HOSTING };
const line = (l: (typeof LOCALES)[number], key: MessageKey, params?: Record<string, string>) => esc(t(l, key, params));

describe('A6 · the books on /privacy and /data-deletion, in every language', () => {
  it('the privacy page has the books section, in order, with the reader named as the replies\' provider', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderPrivacy(l, null, FACTS));
      const at = [
        `<h2 id="books">${line(l, 'legal.privacy.books.title')}</h2>`,
        line(l, 'legal.privacy.books.what'),
        line(l, 'legal.privacy.books.odoo'),
        line(l, 'legal.privacy.books.reader', { processor: processorLabel(deepseek, l) }),
        line(l, 'legal.privacy.books.kept'),
        line(l, 'legal.privacy.books.history'),
      ].map((x) => h.indexOf(x));
      expect(at.every((i) => i > 0), `${l} ${JSON.stringify(at)}`).toBe(true);
      expect([...at].sort((a, b) => a - b), l).toEqual(at);
      // after the business section's own lines, before the cookies
      expect(h.indexOf('<h2 id="business">'), l).toBeLessThan(at[0]!);
      expect(at[0]!, l).toBeLessThan(h.indexOf('<h2 id="cookies">'));
      // the customer's half and the owner's half each point at it
      expect(h, l).toContain(line(l, 'legal.privacy.howLong.books'));
      expect(h, l).toContain(line(l, 'legal.privacy.owner.howLongBooks'));
    }
  });

  it('the ten years and the two laws are said in every language; the systems D18 holds off are not named', () => {
    for (const l of LOCALES) {
      const kept = t(l, 'legal.privacy.books.kept');
      expect(kept, l).toContain('L123-22');
      expect(kept, l).toContain('211');
      const h = renderPrivacy(l, null, FACTS);
      for (const off of ['Google Sheets', 'Xero', 'QuickBooks', 'Intuit']) expect(h, `${l} ${off}`).not.toContain(off);
      expect(h, l).toContain('Odoo');
    }
  });

  it('the deletion page keeps the books that name a customer and leaves the shop\'s own copies to the shop', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataDeletion(l, null));
      const kept = h.indexOf(`<h2>${line(l, 'legal.deletion.kept.title')}</h2>`);
      expect(kept, l).toBeGreaterThan(0);
      for (const key of ['legal.deletion.kept.books', 'legal.deletion.kept.booksCopies'] as const) {
        expect(h.indexOf(`<li>${line(l, key)}</li>`), `${l} ${key}`).toBeGreaterThan(kept);
      }
      // closing erases everything — but the books, which the next paragraph says
      expect(h, l).toContain(`<p>${line(l, 'legal.deletion.closed')}</p>`);
      expect(h, l).toContain(`<p>${line(l, 'legal.deletion.closedBooks')}</p>`);
    }
  });

  it('Odoo is named (D18) by its line; Sheets, Xero, Intuit and the separate document reader still are not', () => {
    const odoo = OPTIONAL_RECIPIENTS.find((r) => r.id === 'odoo');
    expect(odoo?.named).toEqual({ key: 'legal.privacy.books.odoo' });
    expect(recipientNamed('odoo')).toBe(true);
    for (const id of ['googleSheets', 'xero', 'intuit', 'documentReader'] as const) expect(recipientNamed(id), id).toBe(false);
  });
});
