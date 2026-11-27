import { describe, it, expect } from 'vitest';
import { sectionSidebar, AREAS } from '../../src/api/web/sections.js';
import { booksSetupCard, booksSetupSteps, type BooksSetupState } from '../../src/api/web/booksSetup.js';
import { renderBooksOverview } from '../../src/api/web/booksOverview.js';
import { renderBooksConnections } from '../../src/api/web/books.js';
import { renderFields } from '../../src/api/web/booksFields.js';
import { settingsPageLinks } from '../../src/api/web/settingsArea.js';
import { BOOKS_AREA_CSS } from '../../src/api/web/booksAreaStyle.js';
import { withWorkspace, t, type RequestScope } from '../../src/api/web/say.js';
import type { BooksConnection } from '../../src/db/booksConnections.js';
import type { BooksOverview } from '../../src/db/booksOverview.js';
import { decimal } from '../../src/core/types/decimal.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withoutIsolates } from './isolates.js';

/**
 * F46 (UI correction, Block 5) — the books' setup: a short checklist (country, year, accounts, tax, bank) whose progress
 * is read from what is saved, one task per step; connections and imports; custom fields show Choices only for a
 * choice, with Required beside its field.
 *
 * REWRITTEN for the settings overhaul (rule 104; the owner's decision 2026-11-27). What each test guarded is kept:
 *   - the checklist is the same five steps with the same states, read from what is saved — it is drawn as a CARD on
 *     Books › Overview until 5 of 5 is done (it was the page /app/settings/books), and its "More settings" list is the
 *     Settings menu's Books group now;
 *   - connections: every source says its state in words; the one that needs connecting again says so and offers it —
 *     as ONE TABLE of the sources with each source's section under it, every field in sight (it was a group of folds,
 *     one open at a time);
 *   - custom fields: Choices only for a choice, Required beside its field.
 */
const FULL: BooksSetupState = { country: 'US', start: '2026-01-01', years: 1, accounts: true, identifier: true, money: 3 };
const EMPTY: BooksSetupState = { country: null, start: null, years: 0, accounts: false, identifier: false, money: 0 };
const steps = (html: string) => [...(html.split('<ol class="bs-steps">')[1] ?? '').split('</ol>')[0]!.matchAll(/<li( class="done")?><a href="([^"]+)">/g)].map((m) => [m[2], !!m[1]] as const);
const progress = (html: string) => /<progress max="(\d+)" value="(\d+)"/.exec(html)?.slice(1).map(Number);
const ALMOST: BooksSetupState = { ...FULL, identifier: false };

describe('F46 · the checklist, read from what is saved', () => {
  it('five steps, in order, one page each; tax is a section of Country and tax', () => {
    expect(steps(booksSetupCard('en', ALMOST)).map(([h]) => h)).toEqual([
      '/app/settings/books/country', '/app/settings/books/starting-balances', '/app/settings/books/accounts', '/app/settings/books/country#tax', '/app/settings/books/accounts#money',
    ]);
  });
  it('progress counts only what is on record', () => {
    expect(booksSetupSteps('en', FULL).every((x) => x.done)).toBe(true);
    const almost = withoutIsolates(booksSetupCard('en', ALMOST));
    expect(progress(almost)).toEqual([5, 4]);
    expect(almost).toContain('4 of 5 done');
    const empty = withoutIsolates(booksSetupCard('en', EMPTY));
    expect(progress(empty)).toEqual([5, 0]);
    expect(steps(empty).some(([, d]) => d)).toBe(false);
    for (const k of ['Not chosen yet', 'Not set yet', 'No business identifier saved yet', 'No account marked as holding money yet']) expect(empty).toContain(k);
    // A first day with no fiscal year is not a year; a country without its books' pack is not chosen for the books.
    const half = withoutIsolates(booksSetupCard('en', { ...EMPTY, country: 'FR', start: '2026-01-01', years: 0 }));
    expect(progress(half)).toEqual([5, 0]);
    expect(steps(booksSetupCard('en', { ...FULL, money: 0 }))[4]).toEqual(['/app/settings/books/accounts#money', false]);
    expect(withoutIsolates(booksSetupCard('en', ALMOST))).toContain('Accounts that hold money: 3');
  });
  it('each step says its state in words with a mark, not by colour alone', () => {
    const html = booksSetupCard('en', ALMOST);
    expect((html.match(/<span class="pill ok">Done<\/span>/g) ?? []).length).toBe(4);
    expect((html.match(/<span class="pill">To do<\/span>/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<progress [^>]*aria-labelledby="bs-done"/);
  });
  it('every language has its words, and right to left every figure is isolated', () => {
    for (const locale of LOCALES) {
      const html = booksSetupCard(locale, ALMOST);
      expect(html, locale).not.toMatch(/setupList\.|booksArea\.|books\.country\./);
    }
    const ar = booksSetupCard('ar', ALMOST);
    const text = ar.replace(/<[^>]+>/g, ' ').replace(/\u2068[^\u2069]*\u2069/g, '');
    expect(text).not.toMatch(/[0-9٠-٩]/);
  });
});

const overview = { today: '2026-11-06', bookCurrency: 'USD', month: { from: '2026-11-01', to: '2026-11-06' }, fiscalYear: null,
  needsYou: { overdueInvoices: 0, unmatchedLines: 0, papers: { unread: 0, problem: 0, ready: 0, draft: 0, posted: 0, setAside: 0, pending: 0 } },
  customerOwed: { byCurrency: [] }, supplierOwed: { state: 'ready', owed: decimal('0') }, cashToday: { state: 'ready', balance: decimal('0'), defaulted: false },
  cash: { state: 'ready', received: decimal('0'), paidOut: decimal('0') }, profit: { amount: decimal('0'), from: '2026-01-01', to: '2026-11-06', basis: 'fiscal' } } as unknown as BooksOverview;
const home = (viewer: { isOwner: boolean; kind?: 'accountant' }, checklist: BooksSetupState | null) =>
  renderBooksOverview('en', viewer, overview, { today: '2026-11-06' }, [], [], { year: true, accounts: true }, checklist);

describe('rule 104 · the checklist is a card on Books › Overview until 5 of 5 is done', () => {
  it('drawn for the owner while a step is to do, each step a door to its settings page', () => {
    const html = home({ isOwner: true }, ALMOST);
    expect(html).toContain('<section class="bs-setup" id="setup" aria-labelledby="bs-steps">');
    expect(steps(html)).toHaveLength(5);
    expect(html).toContain(t('en', 'booksArea.setupHint'));
  });
  it('gone once every step is done; never drawn for someone the route gives no checklist (a team member, an accountant)', () => {
    expect(booksSetupCard('en', FULL)).toBe('');
    expect(home({ isOwner: true }, FULL)).not.toContain('bs-setup');
    expect(home({ isOwner: false, kind: 'accountant' }, null)).not.toContain('bs-setup');
  });
  it('the other books settings are pages of the Settings menu, and Payment links stays under Products', () => {
    const menu = AREAS.settings.find((g) => g.id === 'books')!.items.map((i) => i.href);
    for (const href of ['/app/settings/books/invoices-out', '/app/settings/books/connections', '/app/settings/books/fields']) expect(menu).toContain(href);
    expect(AREAS.products.flatMap((g) => g.items).map((i) => i.href)).toContain('/app/payments/stripe');
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
/** The table of sources: each row's name, its state in words, the section its action opens, and the action's word. */
const sources = (html: string) => [...(html.split('<table class="team-table bk-sources" id="sources">')[1] ?? '').split('</table>')[0]!
  .matchAll(/<tr class="tm"><th scope="row"><bdi>([^<]+)<\/bdi><\/th><td><span class="pill[^"]*">([^<]+)<\/span><\/td><td>(?:<a class="deeper" href="#([a-z-]+)"[^>]*>([^<]+)<\/a>)?<\/td><\/tr>/g)]
  .map((m) => [m[1], m[2], m[3] ?? null, m[4] ?? null] as const);
const sections = (html: string) => [...html.matchAll(/<section class="set-sec bk-source" id="([a-z-]+)">/g)].map((m) => m[1]);

describe('rule 104 · accounting connections: one table of the five sources, each with its state and one action', () => {
  const OWNER = { isOwner: true };
  it('every source is a row that says its state in words; a source that cannot be connected here says so and offers nothing', () => {
    const html = renderBooksConnections('en', OWNER, { sheets: { offered: false, connection: null }, odoo: { offered: true, connection: null, key: null },
      xero: { offered: true, connection: conn('connected') }, quickbooks: { offered: false, connection: null } });
    expect(sources(html)).toEqual([
      ['The Nomi workbook', 'Available', 'workbook', 'Open'],
      ['Google Sheets', 'Not available here yet', null, null],
      ['Odoo', 'Not connected', 'odoo', 'Connect'],
      ['Xero', 'Connected', 'xero', 'Open'],
      ['QuickBooks', 'Not available here yet', null, null],
    ]);
    expect(html).toContain('<span class="pill ok">Connected</span>');
    // every row's action leads to a section that is on the page
    for (const [, , id] of sources(html)) if (id) expect(sections(html)).toContain(id);
    expect(sections(html)).toEqual(['workbook', 'sheets', 'odoo', 'xero', 'quickbooks']);
  });
  it('no fold: a connection form\'s fields are in sight on first paint', () => {
    const html = renderBooksConnections('en', OWNER, { sheets: { offered: false, connection: null }, odoo: { offered: true, connection: null, key: null } });
    expect(html).not.toContain('<details');
    const odoo = html.slice(html.indexOf('<section class="set-sec bk-source" id="odoo">'));
    for (const name of ['url', 'database', 'key', 'expires']) expect(odoo).toContain(`name="${name}"`);
    expect(odoo).toContain('action="/app/books/odoo/connect"');
  });
  it('the one that needs connecting again says so in its row, and its action is "Connect again"', () => {
    const rows = sources(renderBooksConnections('en', OWNER, { sheets: { offered: false, connection: null }, xero: { offered: true, connection: conn('connect_again') } }));
    expect(rows.find(([name]) => name === 'Xero')).toEqual(['Xero', t('en', 'books.sheets.needsAgain'), 'xero', 'Connect again']);
  });
  it('the accountant sees the workbook alone, as before: no table of sources', () => {
    const html = renderBooksConnections('en', { isOwner: false, kind: 'accountant' }, { sheets: { offered: false, connection: null } });
    expect(sources(html)).toEqual([]);
    expect(sections(html)).toEqual(['workbook']);
  });
});

describe('F46 · forward chevrons mirror right to left by the app\'s one convention', () => {
  const chevrons = (html: string) => [...html.matchAll(/<a href="[^"]+">(?:(?!<\/a>).)*?<svg class="([^"]+)"/gs)].map((m) => m[1] ?? '');
  it('the steps carry flips, and nothing around them mirrors again', () => {
    const html = booksSetupCard('ar', ALMOST);
    const marks = chevrons(html);
    expect(marks.length).toBe(5);
    for (const c of marks) expect(c.split(' ')).toContain('flips');
    expect(html).not.toMatch(/class="go"/);
    expect(BOOKS_AREA_CSS).not.toMatch(/scaleX/);
  });
});

describe('F46 · custom fields: Choices only for a choice, Required beside its field', () => {
  const html = renderFields('en', { id: 'o', isOwner: true }, []);
  it('Choices is marked so it can be hidden for any other type', () => {
    expect(html).toMatch(/<div class="bf-choices"><div class="setrow">/);
    expect(BOOKS_AREA_CSS).toContain('#new-field form:not(:has(select[name="kind"] option[value="choice"]:checked)) .bf-choices{display:none;}');
  });
  it('Required is a checkbox with its words, its rule described beside it', () => {
    expect(html).toMatch(/<div class="bf-required"><label class="check"><input type="checkbox" name="required" value="1" aria-describedby="bf-required-hint" \/> <span>Required<\/span><\/label>\s*<p class="caption muted" id="bf-required-hint">/);
  });
});
