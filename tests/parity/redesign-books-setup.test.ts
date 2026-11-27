import { describe, it, expect } from 'vitest';
import { sectionSidebar } from '../../src/api/web/sections.js';
import { renderBooksSetup, type BooksSetupState } from '../../src/api/web/booksSetup.js';
import { renderBooksConnections } from '../../src/api/web/books.js';
import { renderFields } from '../../src/api/web/booksFields.js';
import { settingsPageLinks } from '../../src/api/web/settingsArea.js';
import { BOOKS_AREA_CSS } from '../../src/api/web/booksAreaStyle.js';
import { withWorkspace, t, type RequestScope } from '../../src/api/web/say.js';
import type { BooksConnection } from '../../src/db/booksConnections.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withoutIsolates } from './isolates.js';

/**
 * F46 (UI correction, Block 5) — Books settings: a short checklist (country, year, accounts, tax, bank) whose progress is
 * read from what is saved, one task per step; the hub no longer repeats the tab row; connections and imports open one
 * method at a time; custom fields show Choices only for a choice, with Required beside its field.
 */
const FULL: BooksSetupState = { country: 'US', start: '2026-01-01', years: 1, accounts: true, identifier: true, money: 3 };
const EMPTY: BooksSetupState = { country: null, start: null, years: 0, accounts: false, identifier: false, money: 0 };
const MORE: [string, 'invoice.settings.title' | 'booksArea.connections' | 'booksArea.fields'][] = [
  ['/app/settings/books/invoices-out', 'invoice.settings.title'], ['/app/settings/books/connections', 'booksArea.connections'], ['/app/settings/books/fields', 'booksArea.fields'],
];
const steps = (html: string) => [...(html.split('<ol class="bs-steps">')[1] ?? '').split('</ol>')[0]!.matchAll(/<li( class="done")?><a href="([^"]+)">/g)].map((m) => [m[2], !!m[1]] as const);
const progress = (html: string) => /<progress max="(\d+)" value="(\d+)"/.exec(html)?.slice(1).map(Number);

describe('F46 · the checklist, read from what is saved', () => {
  it('five steps, in order, one page each', () => {
    expect(steps(renderBooksSetup('en', FULL, MORE)).map(([h]) => h)).toEqual([
      '/app/settings/books/country', '/app/settings/books/starting-balances', '/app/settings/books/accounts', '/app/settings/books/tax', '/app/settings/books/accounts#money',
    ]);
  });
  it('progress counts only what is on record', () => {
    const full = withoutIsolates(renderBooksSetup('en', FULL, MORE));
    expect(progress(full)).toEqual([5, 5]);
    expect(full).toContain('5 of 5 done');
    expect(steps(full).every(([, d]) => d)).toBe(true);
    const empty = withoutIsolates(renderBooksSetup('en', EMPTY, MORE));
    expect(progress(empty)).toEqual([5, 0]);
    expect(steps(empty).some(([, d]) => d)).toBe(false);
    for (const k of ['Not chosen yet', 'Not set yet', 'No business identifier saved yet', 'No account marked as holding money yet']) expect(empty).toContain(k);
    // A first day with no fiscal year is not a year; a country without its books' pack is not chosen for the books.
    const half = withoutIsolates(renderBooksSetup('en', { ...EMPTY, country: 'FR', start: '2026-01-01', years: 0 }, MORE));
    expect(progress(half)).toEqual([5, 0]);
    expect(steps(renderBooksSetup('en', { ...FULL, money: 0 }, MORE))[4]).toEqual(['/app/settings/books/accounts#money', false]);
    expect(withoutIsolates(renderBooksSetup('en', FULL, MORE))).toContain('Accounts that hold money: 3');
  });
  it('each step says its state in words with a mark, not by colour alone', () => {
    const html = renderBooksSetup('en', { ...FULL, identifier: false }, MORE);
    expect((html.match(/<span class="pill ok">Done<\/span>/g) ?? []).length).toBe(4);
    expect((html.match(/<span class="pill">To do<\/span>/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<progress [^>]*aria-labelledby="bs-done"/);
  });
  it('every language has its words, and right to left every figure is isolated', () => {
    for (const locale of LOCALES) {
      const html = renderBooksSetup(locale, FULL, MORE);
      expect(html, locale).not.toMatch(/setupList\.|booksArea\.|books\.country\./);
    }
    const ar = renderBooksSetup('ar', FULL, MORE);
    const text = ar.replace(/<[^>]+>/g, ' ').replace(/\u2068[^\u2069]*\u2069/g, '');
    expect(text).not.toMatch(/[0-9٠-٩]/);
  });
  it('the other settings follow, as doors', () => {
    const html = renderBooksSetup('en', FULL, MORE);
    expect(html).toContain('id="bs-more"');
    for (const [href] of MORE) expect(html).toContain(`href="${href}"`);
  });
});

const scope: RequestScope = { name: 'Lily', several: false, outreach: false, setup: null, books: true, viewerRole: 'owner', needsYou: 0, needsYouAt: 0 };
describe('F46 · the tab row is not repeated on the hub', () => {
  it('the hub has the checklist instead; a step page keeps its row', () => {
    withWorkspace(scope, () => {
      expect(settingsPageLinks('en', 'books', '/app/settings/books', { isOwner: true })).toBe('');
      // The navigation block (2026-11-25): no area draws its own row. The settings overhaul (2026-11-27, rule 104): a
      // step page is lit in the SETTINGS sidebar, under its Books group; tax is a section of Country and tax.
      expect(settingsPageLinks('en', 'books', '/app/settings/books/tax', { isOwner: true })).toBe('');
      const side = sectionSidebar('en', 'settings', '/app/settings/books/tax');
      expect(side).toContain('href="/app/settings/books/country" aria-current="page"');
      expect(side).toContain(`<p class="sect-head">${t('en', 'settingsArea.books')}</p>`);
      // The books' own sidebar keeps one "Settings" shortcut, and no Setup group.
      const books = sectionSidebar('en', 'books', '/app/books');
      expect(books.match(/href="\/app\/settings\/[^"]*"/g)).toEqual(['href="/app/settings/books/country"']);
      expect(books).not.toContain(`<p class="sect-head">${t('en', 'side.setup')}</p>`);
    });
  });
});

const conn = (state: BooksConnection['state']): BooksConnection => ({
  system: 'xero', state, reason: null, settings: {}, keyExpiresOn: null, cursor: null,
  connectedAt: '2026-10-20T08:00:00.000000Z', lastReadAt: null, lastOkAt: null, grant: null,
} as BooksConnection);
const methods = (html: string) => [...html.matchAll(/<details class="block ba-method" id="([a-z-]+)" name="books-method"( open)?>/g)].map((m) => [m[1], !!m[2]] as const);

describe('F46 · connections and imports: one method open at a time', () => {
  const OWNER = { isOwner: true };
  it('every method is a disclosure in one group; none opens by itself unless it needs connecting again', () => {
    const html = renderBooksConnections('en', OWNER, { sheets: { offered: false, connection: null }, odoo: { offered: true, connection: null, key: null }, xero: { offered: true, connection: conn('connected') } });
    const m = methods(html);
    expect(m.map(([id]) => id)).toEqual(['workbook', 'sheets', 'odoo', 'xero']);
    expect(m.filter(([, o]) => o)).toEqual([]);
    expect(html).toContain('<span class="pill ok">Connected</span>');
    expect(html).toContain('Not available here yet');
  });
  it('the one that needs connecting again is the one open', () => {
    const m = methods(renderBooksConnections('en', OWNER, { sheets: { offered: false, connection: null }, xero: { offered: true, connection: conn('connect_again') } }));
    expect(m.filter(([, o]) => o)).toEqual([['xero', true]]);
  });
  it('the accountant sees the workbook alone, as before: no group to open', () => {
    const html = renderBooksConnections('en', { isOwner: false, kind: 'accountant' }, { sheets: { offered: false, connection: null } });
    expect(methods(html)).toEqual([]);
    expect(html).toContain('id="workbook"');
  });
});

describe('F46 · forward chevrons mirror right to left by the app\'s one convention', () => {
  const chevrons = (html: string) => [...html.matchAll(/<a href="[^"]+">(?:(?!<\/a>).)*?<svg class="([^"]+)"/gs)].map((m) => m[1] ?? '');
  it('the steps and the Books doors carry flips, and nothing around them mirrors again', () => {
    const html = renderBooksSetup('ar', FULL, MORE);
    const marks = chevrons(html);
    expect(marks.length).toBe(8);
    for (const c of marks) expect(c.split(' ')).toContain('flips');
    expect(html).not.toMatch(/class="go"/);
    expect(BOOKS_AREA_CSS).not.toMatch(/scaleX/);
  });
});

describe('F46 · custom fields: Choices only for a choice, Required beside its field', () => {
  const html = renderFields('en', { id: 'o', isOwner: true }, []);
  it('Choices is marked so it can be hidden for any other type', () => {
    expect(html).toMatch(/<label class="pq bf-choices">/);
    expect(BOOKS_AREA_CSS).toContain('#new-field form:not(:has(select[name="kind"] option[value="choice"]:checked)) .bf-choices{display:none;}');
  });
  it('Required is a checkbox with its words, its rule described beside it', () => {
    expect(html).toMatch(/<div class="bf-required"><label class="check"><input type="checkbox" name="required" value="1" aria-describedby="bf-required-hint" \/> <span>Required<\/span><\/label>\s*<p class="caption muted" id="bf-required-hint">/);
  });
});
