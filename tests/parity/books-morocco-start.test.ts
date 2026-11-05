import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moroccoStart } from '../../src/api/web/books.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * The owner, 2026-10-22 — a Moroccan shop is told in its Books starting-balances settings how its books are best started (a fiscal year's
 * first day; mid-year, one opening entry of balances), never left to learn it from a refusal. It says "period" as the
 * Avis n° 24 does: the Avis sets no length, so no line says "month".
 */

describe('the books of a Moroccan shop start with the advice', () => {
  it('shown for a Moroccan workspace, and only there', () => {
    expect(moroccoStart('en')).toContain('id="morocco-start"');
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const setup = app.slice(app.indexOf("app.get('/app/settings/books/starting-balances'"), app.indexOf('  const closeForm'));
    expect(setup).toContain("got.state.morocco?moroccoStart(locale):''");
    expect(readFileSync(new URL('../../src/db/booksClose.ts', import.meta.url), 'utf8')).toContain("const morocco = st?.country === 'MA'");
  });

  it('in every language, a period, never a month', () => {
    const month = { en: /month/i, zh: /月/, ar: /شهر|أشهر/, es: /\bmes(es)?\b/i, fr: /\bmois\b/i } as const;
    for (const l of LOCALES) {
      const said = ['books.morocco.title', 'books.morocco.when', 'books.morocco.rule', 'books.morocco.systems'].map((k) => t(l, k as never)).join(' ');
      expect(said, l).not.toMatch(month[l as keyof typeof month]);
      expect(said, l).toMatch(/24/);
    }
  });
});
