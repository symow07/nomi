import { describe, expect, it } from 'vitest';
import { LISTS_CSS } from '../../src/api/web/listsStyle.js';
import { EDIT_FOLD_CSS } from '../../src/api/web/editFoldStyle.js';
import { CUSTOMERS_CSS } from '../../src/api/web/customersStyle.js';
import { PRODUCTS_CSS } from '../../src/api/web/productsStyle.js';
import { BOOKS_INVOICE_CSS } from '../../src/api/web/booksInvoiceStyle.js';
import { renderCustomers } from '../../src/api/web/customers.js';
import { renderCustomerOrders } from '../../src/api/web/customerOrders.js';
import { renderProductList } from '../../src/api/web/products.js';
import { renderSavedReplies } from '../../src/api/web/savedReplies.js';
import { errorPage, missingPage } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

// UI correction, Block 9 — the tester's round on head 1c1e17ac. Four things it found, each held here:
// 1. F09: on an invoice card the figure column could shrink under its figure (minmax(0,1fr)), so a long amount was
//    drawn over the due date (40 views at the head, 0 at base, the tester's overlap probe). The figure column is now
//    sized to its figure (auto), the other cells may wrap, and on a phone the card is two columns: what it is on the
//    start side, its figures on the end side, one per line.
// 2. F10: with the script off, Cancel kept `hidden` in the markup but `.btn{display:inline-flex}` drew it anyway, a
//    button that did nothing. A hidden Cancel is now not drawn.
// 3. Guarantee: the pager's links (now above the list too) are 44 px both ways ("Next" was 33 wide).
// 4. F47: the customers, orders, products and saved-replies pages with nothing take the state block, empty or
//    no-match; the error page's card names its kind (error, or unavailable for an address that leads nowhere).
// Measured in a browser by the harness (overlap9, nojs9, the guard); this file holds the rules and the markup.

const block = (css: string, media: string): string => {
  const at = css.indexOf(`@media(${media}){\n .bk-cards.bd-inv tr{`);
  expect(at, media).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('\n}', at));
};
const rule = (css: string, sel: string): string => {
  const at = css.indexOf(`${sel}{`);
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};
const now = new Date('2026-11-06T09:00:00Z');

describe('UI Block 9 · the tester round', () => {
  it('F09: an invoice card never lets a figure shrink under itself, and on a phone the figures stand alone', () => {
    const desk = block(LISTS_CSS, 'max-width:900px');
    expect(desk).toContain('.bk-cards.bd-inv tr{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;}');
    expect(desk).not.toContain('minmax(0,auto) minmax(0,auto) minmax(0,1fr)');
    expect(desk).toContain('overflow-wrap:anywhere');
    const phone = block(LISTS_CSS, 'max-width:600px');
    expect(phone).toContain('.bk-cards.bd-inv tr{grid-template-columns:minmax(0,1fr) auto;}');
    for (const c of ['bd-owed', 'bd-total', 'bk-state']) expect(phone, c).toMatch(new RegExp(`td\\.${c}\\{grid-column:2;`));
    for (const c of ['bk-key', 'bk-text', 'bk-date']) expect(phone, c).toMatch(new RegExp(`td\\.${c}\\{grid-column:1;`));
  });

  it('F10: a Cancel the script has not shown is not drawn', () => {
    expect(EDIT_FOLD_CSS).toContain('button.btn.ghost[data-edit-cancel][hidden]{display:none;}');
  });

  it('every pager link is 44 px both ways', () => {
    for (const [css, sel] of [[CUSTOMERS_CSS, '.ca-pager a'], [PRODUCTS_CSS, '.pa-pager a'], [BOOKS_INVOICE_CSS, '.bd-pager a']] as const) {
      const all = css.split(`${sel}{`).slice(1).map((r) => r.slice(0, r.indexOf('}'))).join(';');
      expect(all, sel).toContain('min-width:44px');
      expect(`${rule(css, sel)};${all}`, sel).toMatch(/min-height:44px/);
    }
  });

  it('F47: the none pages are state blocks, empty apart from no match, in every language', () => {
    const page = { rows: [], total: 0, from: 0, to: 0, next: null, prev: null };
    for (const l of LOCALES) {
      expect(renderCustomers({ ...page, q: '', label: null }, l, now), l).toContain('data-state="empty"');
      expect(renderCustomers({ ...page, q: 'zzz', label: null }, l, now), l).toContain('data-state="nomatch"');
      expect(renderCustomerOrders({ ...page, q: '', clientId: null, state: null }, l, now), l).toContain('data-state="empty"');
      expect(renderCustomerOrders({ ...page, q: 'zzz', clientId: null, state: null }, l, now), l).toContain('data-state="nomatch"');
      expect(renderProductList([], l), l).toContain('data-state="empty"');
      expect(renderProductList([], l, null, OWNER_VIEW, null, { page: { items: [], q: 'zzz', total: 0, page: 1, pageSize: 50, next: null, prev: null } }), l)
        .toContain('data-state="nomatch"');
      expect(renderSavedReplies(l, []), l).toContain('data-state="empty"');
      expect(renderSavedReplies(l, [], { query: 'zzz' }), l).toContain('data-state="nomatch"');
      expect(errorPage({ locale: l, path: '/app/x', kind: 'crash', reference: 'c0ffee11' }), l).toContain('<main class="card" data-state="error">');
      expect(errorPage({ locale: l, path: '/app/x', kind: 'notfound' }), l).toContain('<main class="card" data-state="unavailable">');
      expect(missingPage(l, 'x', { href: '/app/inbox', label: 'y' }), l).toContain('<section class="state" data-state="unavailable"><h1 class="page state-h">');
    }
  });
});
