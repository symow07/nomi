import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderStartingBalances } from '../../src/api/web/booksSettingsPages.js';
import { GUIDES, guideLines, helpFor } from '../../src/api/web/helpTopics.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * The owner, 2026-10-22 — a Moroccan shop is told in its Books starting-balances settings how its books are best started (a fiscal year's
 * first day; mid-year, one opening entry of balances), never left to learn it from a refusal. It says "period" as the
 * Avis n° 24 does: the Avis sets no length, so no line says "month".
 *
 * Rewritten for the settings overhaul (rule 104): the advice is ONE LINE each on the page (`setBooks.start.*`), and its
 * long form, word for word as the page said it, is the page's help guide (`help.g.booksStart`), in every language. The
 * properties are the same: shown for a Moroccan workspace and only there; a period, never a month; Avis 24 named.
 */
const owner = { isOwner: true, id: 'o' };
const view = (morocco: boolean) => ({ years: [], start: null, morocco, today: '2026-11-27' });
const SHORT = ['setBooks.start.avis', 'setBooks.start.when', 'setBooks.start.rule', 'setBooks.start.systems'] as const;
const LONG = ['books.morocco.title', 'books.morocco.when', 'books.morocco.rule', 'books.morocco.systems', 'books.close.startedMorocco'] as const;

describe('the books of a Moroccan shop start with the advice', () => {
  it('shown for a Moroccan workspace, and only there', () => {
    const ma = renderStartingBalances('en', owner, view(true));
    expect(ma).toContain('id="morocco-start"');
    for (const k of ['setBooks.start.when', 'setBooks.start.rule', 'setBooks.start.systems'] as const) expect(ma, k).toContain(t('en', k));
    const other = renderStartingBalances('en', owner, view(false));
    expect(other).not.toContain('id="morocco-start"');
    for (const k of SHORT) expect(other, k).not.toContain(t('en', k));
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const setup = app.slice(app.indexOf("app.get('/app/settings/books/starting-balances'"), app.indexOf('  const closeForm'));
    expect(setup).toContain('renderStartingBalances(locale, personOf(s), { ...got.state, today })');
    expect(readFileSync(new URL('../../src/db/booksClose.ts', import.meta.url), 'utf8')).toContain("const morocco = st?.country === 'MA'");
  });

  it('every line is on the page, in every language', () => {
    for (const l of LOCALES) {
      const html = renderStartingBalances(l, owner, { ...view(true), start: { day: '2026-01-01', length: 'month', by: 'o', at: '2026-01-01T09:00:00Z' } });
      for (const k of SHORT) expect(html, `${l} ${k}`).toContain(t(l, k));
    }
  });

  it('once the books have begun, the Avis 24 line is beside the day they began', () => {
    const html = renderStartingBalances('en', owner, { ...view(true), start: { day: '2026-01-01', length: 'month', by: 'o', at: '2026-01-01T09:00:00Z' } });
    const start = html.slice(html.indexOf('id="start"'), html.indexOf('id="years"'));
    expect(start).toContain(t('en', 'setBooks.start.avis'));
  });

  it('in every language, a period, never a month: the lines on the page and their long form', () => {
    const month = { en: /month/i, zh: /月/, ar: /شهر|أشهر/, es: /\bmes(es)?\b/i, fr: /\bmois\b/i } as const;
    for (const l of LOCALES) {
      for (const keys of [SHORT, ['books.morocco.title', 'books.morocco.when', 'books.morocco.rule', 'books.morocco.systems'] as const]) {
        const said = keys.map((k) => t(l, k as never)).join(' ');
        expect(said, l).not.toMatch(month[l as keyof typeof month]);
        expect(said, l).toMatch(/24/);
      }
    }
  });

  it('nothing was lost: the long form is the page\'s help guide, word for word, in every language', () => {
    expect(helpFor('/app/settings/books/starting-balances')[0]).toBe('booksStart');
    expect(GUIDES.booksStart.door).toBe('/app/settings/books/starting-balances');
    for (const l of LOCALES) {
      const guide = (['help.g.booksStart.title' as MessageKey, ...guideLines('booksStart')]).map((k) => messages[l][k]).join(' ');
      for (const k of LONG) expect(guide, `${l} ${k}`).toContain(messages[l][k]);
    }
  });
});
