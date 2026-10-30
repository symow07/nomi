import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import type { PriceRules } from '../../src/core/commerce/priceRules.js';
import { renderPriceRules, type PriceRulesView } from '../../src/api/web/priceRules.js';
import { renderFec } from '../../src/api/web/booksReports.js';
import { renderFields } from '../../src/api/web/booksFields.js';
import { renderPapers } from '../../src/api/web/booksPapers.js';
import { renderNewEntry } from '../../src/api/web/booksEntries.js';
import { renderBooksChart, renderBooksOff, ACCOUNTANT_ALSO } from '../../src/api/web/books.js';
import { renderPeople, type PeopleView } from '../../src/api/web/people.js';
import { renderAccount } from '../../src/api/web/account.js';
import { renderLanguage } from '../../src/api/web/settings.js';
import { renderPageFactsForm, isPasted, sourceLabel } from '../../src/api/web/pageFacts.js';
import { shell } from '../../src/api/web/layout.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { readinessOf, checklistFor } from '../../src/db/practiceChecklist.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { linkedCss } from './linked-css.js';

/**
 * AUDIT BATCH 4 — user-facing defects, each held by what the page draws. The routes are walked in
 * tests/integration/audit-batch-4.test.ts.
 */

const scope = (over: Partial<RequestScope> = {}): RequestScope =>
  ({ name: null, several: false, outreach: false, setup: null, ...over });
const filled = (html: string): string[] =>
  [...html.matchAll(/<button class="btn send"[^>]*>([^<]*)</g)].map((m) => m[1]!.trim());

describe('B16 · readiness, one count', () => {
  it('done and total come from one place: items seen of the items that can pass', () => {
    const items = checklistFor('retail');
    const r = readinessOf(items, new Set(['quoted', 'bot_answered']));
    expect([r.done, r.total, r.complete]).toEqual([2, items.length, false]);
    // An item seen that the list for this kind does not hold is not counted.
    expect(readinessOf(checklistFor('no_catalogue'), new Set(['quoted'])).done).toBe(0);
    expect(readinessOf(items, new Set(items)).complete).toBe(true);
  });
});

describe('B18 · the accountant keeps their own sign-in', () => {
  it('the password and the language pages are theirs to reach', () => {
    for (const r of ['GET /app/settings/account', 'POST /app/settings/account/password', 'GET /app/settings/language'])
      expect(ACCOUNTANT_ALSO.has(r), r).toBe(true);
  });
  it('their sign-in page leads back to the books and on to the language; the language page back to it', () => {
    const acct = renderAccount({ email: 'a@x.example', passwordMin: 12, accountant: true }, 'en', null, t('en', 'nav.books'));
    expect(acct).toContain('href="/app/books"');
    expect(acct).toContain('href="/app/settings/language"');
    expect(acct).toContain('action="/app/settings/account/password"');
    const owner = renderAccount({ email: 'o@x.example', passwordMin: 12 }, 'en', null, t('en', 'nav.setup'));
    expect(owner).toContain('href="/app/settings/setup"');
    expect(owner).not.toContain('href="/app/settings/language"');
    expect(renderLanguage('en', true)).toContain('href="/app/settings/account"');
    expect(renderLanguage('en')).toContain('href="/app/settings/setup"');
  });
  it('their rail is the books\' with a door to their sign-in, on every page they reach — never the sales side', () => {
    const page = (path: string) => withWorkspace(scope({ business: 'Atlas Soap', viewerRole: 'accountant' }), () =>
      shell({ title: 'T', active: 'settings', locale: 'en', path, bodyHtml: '<h1 class="page">T</h1>' }));
    for (const path of ['/app/settings/account', '/app/settings/language', '/app/books']) {
      const html = page(path);
      expect(html, path).toContain('data-nav="books"');
      expect(html, path).toContain('data-nav="account"');
      expect(html, path).not.toContain('data-nav="inbox"');
    }
    expect(page('/app/settings/account')).toMatch(/href="\/app\/settings\/account" class="navlink active"/);
  });
  it('the books switched off: a page that says so, in every language, with the way to their sign-in', () => {
    for (const l of LOCALES) {
      const html = renderBooksOff(l, 'Atlas Soap');
      expect(html, l).toContain(t(l, 'books.off.title'));
      expect(html, l).toContain('Atlas Soap');
      expect(html, l).toContain('href="/app/settings/account"');
    }
  });
});

describe('B19 · a reading waiting for ticks is found again', () => {
  it('the knowledge page lists each with a door back to its lines', () => {
    const open = [{ id: '0f000000-0000-4000-8000-000000000001', source: 'https://shop.example/pages/shipping', lines: 3, createdAt: new Date('2026-10-30T09:00:00Z') },
      { id: '0f000000-0000-4000-8000-000000000002', source: 'pasted:0123456789abcdef', lines: 2, createdAt: new Date('2026-10-30T10:00:00Z') }];
    for (const l of LOCALES) {
      const html = renderPageFactsForm(l, null, open);
      expect(html, l).toContain(t(l, 'pageFacts.waiting.title'));
      expect(html, l).toContain('href="/app/knowledge/from-page/0f000000-0000-4000-8000-000000000001"');
      expect(html, l).toContain('shop.example');
      expect(html, l).toContain(t(l, 'pageFacts.pasted'));
    }
    expect(renderPageFactsForm('en', null, [])).not.toContain(t('en', 'pageFacts.waiting.title'));
  });
  it('text pasted is known by its fingerprint, and still called "text you pasted"', () => {
    expect(isPasted('pasted')).toBe(true);
    expect(isPasted('pasted:0123456789abcdef')).toBe(true);
    expect(isPasted('https://pasted.example/')).toBe(false);
    expect(sourceLabel('en', 'pasted:0123456789abcdef')).toBe(t('en', 'pageFacts.pasted'));
    expect(sourceLabel('en', 'https://shop.example/pages/shipping')).toBe('shop.example');
    expect(sourceLabel('en', 'https://shop.example/pages/shipping', true)).toBe('https://shop.example/pages/shipping');
  });
});

describe('B20 · the FEC page fits a phone', () => {
  it('a pill that holds a sentence wraps, and the stylesheet lets it', () => {
    const html = renderFec('en', [{ id: 'y1', startsOn: '2026-01-01', endsOn: '2026-12-31', state: 'open', lines: 4,
      numbering: [{ journal: 'VT', missing: [3, 4, 5], repeated: [7] }], offChart: [] }], ['ice', 'taxId', 'rc']);
    for (const key of ['books.fec.identityMissing', 'books.fec.numberingBad', 'books.fec.open'] as const) {
      const at = html.indexOf(t('en', key, { which: '', journal: 'VT', missing: '3, 4, 5', repeated: '7' }).slice(0, 18));
      expect(at, key).toBeGreaterThan(0);
      expect(html.slice(html.lastIndexOf('<span class="pill', at), at), key).toMatch(/class="pill [a-z]+ long"/);
    }
    const css = linkedCss(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app/books/fec', bodyHtml: html }));
    expect(css).toMatch(/\.pill\.long \{[^}]*white-space:normal[^}]*max-width:100%/);
  });
});

describe('B21 · a price limit refused opens its own section', () => {
  const RULES: PriceRules = { floor: usd('0.35'), maxDiscountPct: 10, askAbovePct: 7 };
  const tote = { productId: 'p1', sku: 'BAG-001', name: 'Canvas tote', nameZh: null, listPrice: usd('0.45'), inheritsDefault: false, isActive: true };
  const view = (over: Partial<PriceRulesView> = {}): PriceRulesView => ({
    currency: 'USD', volume: [], businessDefault: null, products: [{ ...tote, own: null }], unanswered: 1, ...over });

  it('the answer for everything, folded away: refused, it is drawn open, says why once, keeps what was typed and is landed on', () => {
    const html = renderPriceRules(view({ products: [{ ...tote, own: RULES }], unanswered: 0 }), 'en', null,
      { floor: 'not_a_number' }, { productId: null, values: { floor: 'abc', maxDiscountPct: '5', askAbovePct: '3' } });
    expect(html).toContain('<details class="pr-fold" open>');
    expect(html.match(/class="perr"/g)?.length).toBe(1);
    expect(html).toContain('action="/app/business/prices#everything"');
    expect(html).toMatch(/name="floor" inputmode="decimal" required aria-invalid="true" aria-describedby="pr-err-floor" autofocus\s+value="abc"/);
    expect(html).toContain('value="5"');
  });

  it('a product\'s form refused: only that form says it, and the page lands on that product', () => {
    const html = renderPriceRules(view(), 'en', null, { maxDiscountPct: 'missing' },
      { productId: 'p1', values: { floor: '0.30', maxDiscountPct: '', askAbovePct: '2' } });
    expect(html.match(/class="perr"/g)?.length).toBe(1);
    const product = html.slice(html.indexOf('id="p-p1"'));
    expect(product).toContain('class="perr"');
    expect(product).toContain('action="/app/business/prices#p-p1"');
    expect(product).toContain('value="0.30"');
    // The answer for everything, drawn above it, holds no error and nothing typed into the other form.
    const everything = html.slice(html.indexOf('id="everything"'), html.indexOf('id="p-p1"'));
    expect(everything).not.toContain('perr');
    expect(everything).not.toContain('value="0.30"');
  });

  it('a discount refused: the volume section is landed on, its field marked, what was typed kept', () => {
    const html = renderPriceRules(view({ businessDefault: RULES }), 'en', null, {}, {}, { discountPct: 'above_max' },
      { productId: 'p1', minQty: '500', discountPct: '40' });
    expect(html).toContain('id="volume"');
    expect(html).toContain('action="/app/business/prices/volume#volume"');
    expect(html).toMatch(/name="discountPct"[^>]*aria-invalid="true"[^>]*autofocus[^>]*value="40"/);
    expect(html).toContain('name="minQty" inputmode="numeric" required value="500"');
    expect(html).toContain('<option value="p1" selected>');
  });
});

describe('B22 · the main action is a real primary button', () => {
  const owner = { id: 'o', isOwner: true };
  it('the books\' forms: one filled button, the form\'s own act', () => {
    expect(filled(renderFec('en', [], [], { pattern: '{ICE}FEC{YYYYMMDD}.txt', ice: null, canChange: true }))).toEqual([t('en', 'books.fec.filename.save')]);
    expect(filled(renderFields('en', owner, []))).toEqual([t('en', 'books.fields.add')]);
    expect(filled(renderPapers('en', owner, [], true))).toEqual([t('en', 'books.papers.keep')]);
    const c = { journals: [], accounts: [], parties: [], taxCodes: [], bookCurrency: 'MAD', fields: [] };
    expect(filled(renderNewEntry('en', c as never, {}, [], '2026-04-10'))).toEqual([t('en', 'books.entry.saveDraft')]);
    // On the books' home beside the workbook's own form: a real button, not a second filled one.
    expect(renderBooksChart('en')).toContain(`<button class="btn" type="submit">${t('en', 'books.chart.apply')}`);
  });
  it('People: no form\'s only button is drawn as text', () => {
    const view: PeopleView = {
      people: [{ id: 'o', name: 'Symow', isOwner: true, kind: 'team', addedAt: new Date(), lastSeenAt: null, signsInWithEmail: false }], justIssued: null,
      rotation: { on: true, people: [{ id: 'o', name: 'Symow', inRotation: true, awayUntil: null, lastGivenAt: null, accountant: false }] },
    };
    const html = renderPeople(view, 'en', null, new Date());
    expect(filled(html)).toEqual([t('en', 'people.add.button')]);
    const turn = html.slice(html.indexOf('action="/app/settings/people/o/turn"'));
    expect(turn).toMatch(new RegExp(`<button class="btn" type="submit">${t('en', 'turn.save')}`));
  });
});
