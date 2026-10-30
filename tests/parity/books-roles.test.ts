import { describe, it, expect } from 'vitest';
import { booksMay, BOOKS_ACTIONS } from '../../src/core/conversation/people.js';
import { booksRouteOf, ACCOUNTANT_ALSO, renderBooksHome } from '../../src/api/web/books.js';
import { unnamedRecipientProblems } from '../../src/core/legal/recipients.js';

/** A5 (Phase 5; decision 12) — the three roles as one predicate, and the books' new processors held at the boot (D18). */
describe('A5 · who may do what in the books', () => {
  const owner = { id: 'o', name: 'Mei', isOwner: true };
  const staff = { id: 's', name: 'Sam', isOwner: false };
  const accountant = { id: 'a', name: 'Amal', isOwner: false, kind: 'accountant' as const };
  it('the owner sees, posts, exports; the accountant sees and exports; staff nothing', () => {
    expect(BOOKS_ACTIONS.map((a) => [booksMay(owner, a), booksMay(accountant, a), booksMay(staff, a)])).toEqual([
      [true, true, false], [true, false, false], [true, true, false],
    ]);
  });
  it('the routes say what each takes; outside them, an accountant has only the way out', () => {
    expect(booksRouteOf('GET', '/app/books')?.action).toBe('see');
    expect(booksRouteOf('GET', '/app/books/books.csv')?.action).toBe('export');
    expect(booksRouteOf('GET', '/app/inbox')).toBeNull();
    // B18 — and their own sign-in: the password and the language.
    expect([...ACCOUNTANT_ALSO]).toEqual(['POST /logout', 'GET /app/settings/account', 'POST /app/settings/account/password', 'GET /app/settings/language']);
  });
  it('the books\' home says to an accountant that posting is the owner\'s', () => {
    const b = { hasBooks: true, keepUntil: null, law: null, lastCopyAt: null, copyCoversAll: false };
    expect(renderBooksHome('en', { isOwner: false, kind: 'accountant' }, b)).toMatch(/Posting entries is the owner(&#39;|&#x27;|')s/);
    expect(renderBooksHome('en', { isOwner: true }, b)).not.toContain('Posting entries is the owner');
  });
});

describe('A5 · D18: the books\' processors stop the boot until the privacy page names them', () => {
  it('each, switched on, is refused by name', () => {
    for (const [env, name] of [
      [{ SHEETS_CLIENT_ID: 'x' }, 'Google (Sheets)'], [{ XERO_CLIENT_ID: 'x' }, 'Xero'], [{ QBO_CLIENT_ID: 'x' }, 'Intuit (QuickBooks)'],
      // S7 (2026-10-22) — Telegram left the list: the privacy page names it now (recipients.ts).
      [{ DOCUMENT_READER_API_KEY: 'x' }, 'reads receipts'],
    ] as const) {
      const p = unnamedRecipientProblems(env);
      expect(p, name).toHaveLength(1);
      expect(p[0], name).toContain(name);
    }
  });
});
