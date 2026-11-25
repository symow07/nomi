import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LISTS_CSS } from '../../src/api/web/listsStyle.js';
import { notFoundInside, missingPage, shell, esc } from '../../src/api/web/layout.js';
import { renderProductMissing } from '../../src/api/web/products.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

// UI correction, Block 9 — the tester's round 2 on head b6bc3ecf. Four things it found, each held here:
// 1. F09: on Orders at ar 320 / 390 the state was drawn over the product, and "250,000 قطعة" broke inside itself; a
//    13-digit customer number broke on Customers and Products (new since d31df0bb's rows; 0 at aa752c3c). A figure, a
//    quantity with its unit and an ID now never break inside themselves; the text around them wraps instead.
// 2. The draft invoice's link ("Draft") was 36 x 44 on the card, because `td>*{min-width:0}` overrode the link's own
//    44 px. Links and buttons on the card keep it.
// 3. F47: the missing product and the signed-in 404 are the state block too (markup only, the same words), and the
//    design system's note on `forbidden` says what a team member really meets.
// 4. The twelve round-2 words are on the native-review list.
// Measured in a browser by the harness (leaf9: crossings, breaks inside a figure, targets under 44, page overflow,
// head against aa752c3c); this file holds the rules, the markup and the records.

const media = (q: string, has: string): string => {
  let at = LISTS_CSS.indexOf(`@media(${q}){`);
  while (at >= 0) {
    const end = LISTS_CSS.indexOf('\n}', at);
    const block = LISTS_CSS.slice(at, end);
    if (block.includes(has)) return block;
    at = LISTS_CSS.indexOf(`@media(${q}){`, end);
  }
  throw new Error(`no @media(${q}) block holds ${has}`);
};
// the rules outside every @media block
const everyWidth = (): string => LISTS_CSS.replace(/@media\([^)]*\)\{[\s\S]*?\n\}/g, '');

describe('ui-block9 r3 · 1 · a figure, a quantity with its unit or an ID never breaks inside itself', () => {
  it('Orders: on a phone the quantity is its own line, whole, and the card lines keep a gap', () => {
    const phone = media('max-width:600px', '.customer-orders .ca-orders .ca-order{');
    expect(phone).toContain('.customer-orders .ca-order-facts>div:first-child dd>span{display:block;');
    expect(phone).not.toMatch(/dd>span\{display:inline;/);
    expect(phone).toMatch(/\.customer-orders \.ca-orders \.ca-order\{[^}]*gap:var\(--space-12\) var\(--space-16\);/);
    expect(everyWidth()).toContain('.customer-orders .ca-order-facts dd>span,.customer-orders .ca-of-amount dd,.customer-orders .ca-order-title>a:first-child{white-space:nowrap;}');
  });
  it('Customers: the person has the whole first line on a phone; facts break only between words', () => {
    const phone = media('max-width:600px', '.ca-customers .ca-customer{');
    expect(phone).toContain('grid-template-areas:"p p" "s s" "v o" "l l" "n n";');
    expect(everyWidth()).toContain('.ca-customers .ca-row-facts dd,.customer-orders .ca-order-facts dd{overflow-wrap:normal;}');
    // a contact (a phone number, an address) breaks only when it is wider than the whole line
    expect(everyWidth()).toContain('.ca-customers .ca-contact{overflow-wrap:break-word;}');
    expect(LISTS_CSS).not.toMatch(/\.ca-contact\{[^}]*overflow-wrap:anywhere/);
  });
  it('Invoices: the number and the figures stay whole; the desk table never lets the number wrap', () => {
    const card = media('max-width:900px', '.bk-cards.bd-inv');
    expect(card).toContain('.bk-cards.bd-inv td.bk-key>*,.bk-cards.bd-inv td.num>*{white-space:nowrap;overflow-wrap:normal;}');
    expect(card).toContain('.bk-cards.bd-inv td.bk-text>*{overflow-wrap:anywhere;}');
    const desk = media('min-width:901px', '.bk-rows.bd-inv');
    expect(desk).not.toMatch(/td\.bk-key\{white-space:normal/);
    expect(desk).not.toMatch(/td\.bk-key,|,\.books-area \.bk-rows\.bd-inv td\.bk-key\{/);
    // a Chinese date wraps between its parts, never inside 2026年
    expect(desk).toContain('.books-area .bk-rows.bd-inv td.bk-date{white-space:normal;word-break:keep-all;}');
  });
});

describe('ui-block9 r3 · 2 · links and buttons on the invoice card keep their 44 px', () => {
  it('no rule lets a cell shrink a link or a button under its own minimum', () => {
    expect(LISTS_CSS).not.toContain('.bk-cards.bd-inv tr>td>*{min-width:0');
    expect(media('max-width:900px', '.bk-cards.bd-inv')).toContain('.bk-cards.bd-inv tr>td>:not(a,button){min-width:0;max-width:100%;}');
    // where the 44 comes from (booksAreaStyle): still there
    expect(readFileSync(new URL('../../src/api/web/booksAreaStyle.ts', import.meta.url), 'utf8')).toMatch(/\.books-area a\[href\]\{[^}]*min-width:44px/);
  });
});

describe('ui-block9 r3 · 3 · the missing product and the signed-in 404 are the state block', () => {
  it('both carry data-state="unavailable", with their own words and their door', () => {
    for (const l of LOCALES) {
      const nf = notFoundInside(l);
      expect(nf, l).toContain(`<section class="state" data-state="unavailable"><h1 class="page state-h">${esc(t(l, 'error.notfound.title'))}</h1><p class="state-p">${esc(t(l, 'error.notfound.body'))}</p><p class="state-next">`);
      expect(nf, l).toContain('href="/app"');
      const pm = renderProductMissing(l);
      expect(pm, l).toContain(`<section class="state" data-state="unavailable"><h1 class="page state-h">${esc(t(l, 'product.notFound'))}</h1><p class="state-p">${esc(t(l, 'product.notFound.body'))}</p><p class="state-next">`);
      expect(pm, l).toContain('href="/app/products"');
      expect(pm, l).not.toContain('class="empty"');
    }
  });
  it('a state block\'s heading still names the tab (found on the way: since b6bc3ecf a missing record\'s tab showed only the area\'s name)', () => {
    for (const l of LOCALES) {
      const tab = (body: string): string => /<title>([^<]*)<\/title>/.exec(shell({ title: 'AREA', active: 'none', locale: l, path: '/app/x', bodyHtml: body }))?.[1] ?? '';
      expect(tab(missingPage(l, t(l, 'order.notFound'), { href: '/app/customers', label: 'x' })), l).toContain(esc(t(l, 'order.notFound')));
      expect(tab(renderProductMissing(l)), l).toContain(esc(t(l, 'product.notFound')));
      expect(tab(notFoundInside(l)), l).toContain(esc(t(l, 'error.notfound.title')));
      expect(tab('<h1 class="page" data-greeting>Hi</h1>'), l).toContain('AREA');
    }
  });
  it('the design system says what a team member meets, and names the open case', () => {
    const ds = readFileSync(new URL('../../docs/design/ui-correction/DESIGN-SYSTEM.md', import.meta.url), 'utf8');
    const s7 = ds.slice(ds.indexOf('## 7 · States'), ds.indexOf('\n## ', ds.indexOf('## 7 · States') + 5));
    expect(s7).not.toContain('answers the not-found page');
    expect(s7).toContain('`staff.notAllowed`: "Only the owner can do that."');
    expect(s7).toContain('`/app/settings/people`, `/app/settings/billing`, `/app/customers/import`');
    expect(s7).toMatch(/\*\*OPEN \(the same at aa752c3c\):\*\* a team member who opens the books \(`\/app\/books\/invoices`\) lands on Today with\s+no words/);
    expect(s7).toContain('`renderProductMissing`');
    expect(s7).toContain('`notFoundInside`');
    expect(t('en', 'staff.notAllowed')).toBe('Only the owner can do that.');
  });
});

describe('ui-block9 r3 · 4 · the twelve round-2 words wait for a native read', () => {
  it('each is named on docs/NATIVE-REVIEW-UI.md under Block 9', () => {
    const doc = readFileSync(new URL('../../docs/NATIVE-REVIEW-UI.md', import.meta.url), 'utf8');
    const b9 = doc.slice(doc.indexOf('**The UI correction, Block 9'));
    expect(b9.length).toBeGreaterThan(100);
    // the twelve, written as the list writes a group: `state.customers.h / .p / ...` names each of them
    expect(b9).toContain('`state.clearFilters`');
    expect(b9).toContain('`state.customers.h / .p / .next / .none.h /\n  .none.p`');
    expect(b9).toContain('`state.orders.h / .p / .none.h / .none.p`');
    expect(b9).toContain('`state.replies.p / .none.p`');
    expect(b9).toContain('thirty-two lines `state.*`');
    expect(b9).not.toContain('twenty lines `state.*`');
  });
});
