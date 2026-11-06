import { esc } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { booksDay } from './booksOverview.js';
import { moneyFromRow } from '../../core/types/money.js';
import type { Decimal } from '../../core/types/decimal.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { EVERY } from '../../core/books/spending.js';
import type { Category, Proposal, Recurring, SpendingChoices, UnpaidBill } from '../../db/booksSpending.js';

/**
 * THE SPENDING BOOK (Block 2 PR 3; 0227) — what the owner sees above the receipts and bills the reader keeps: the
 * recurring costs waiting for a tick, the form for a bill, the bills not paid yet, the schedule, the categories. One
 * subject a form, the settings idiom (`.pform`, `.pq`, `.btn send`), no new CSS. Staff and the accountant read; only
 * the owner's forms are drawn (`booksMay(viewer, 'post')`).
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
export type SpendingBook = {
  readonly today: string;
  readonly proposals: readonly Proposal[];
  readonly unpaid: readonly UnpaidBill[];
  readonly recurring: readonly Recurring[];
  readonly spentThisMonth: Decimal;
  readonly monthFrom: string;
};

const money = (locale: Locale, d: Decimal, currency: string): string => { const m = moneyFromRow(d, currency); return esc(m ? show.money(locale, m) : d); };
const owner = (v: Who): boolean => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const option = (value: string, label: string, selected = false) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
const select = (name: string, label: string, options: string, extra = '') => `<label class="pq"><span>${esc(label)}</span><select name="${name}"${extra}>${options}</select></label>`;
const input = (name: string, label: string, type = 'text', extra = '') => `<label class="pq"><span>${esc(label)}</span><input type="${type}" name="${name}"${extra} /></label>`;

function supplierFields(locale: Locale, c: SpendingChoices): string {
  return select('supplier', t(locale, 'booksSpending.bill.supplier'), option('', t(locale, 'booksSpending.bill.supplierNone')) + c.suppliers.map((s) => option(s.id, `${s.code} · ${s.name}`)).join(''))
    + input('newSupplier', t(locale, 'booksSpending.bill.newSupplier'), 'text', ' maxlength="200" autocomplete="off"');
}
function costFields(locale: Locale, c: SpendingChoices): string {
  const category = select('category', t(locale, 'booksSpending.bill.category'), option('', t(locale, 'booksSpending.bill.categoryNone')) + c.categories.map((x) => option(x.id, x.name)).join(''));
  const account = select('account', t(locale, 'booksSpending.bill.account'), option('', '—') + c.expenseAccounts.map((a) => option(a.id, `${a.code} · ${a.name}`)).join(''));
  const tax = select('tax', t(locale, 'booksSpending.bill.tax'), option('', t(locale, 'booksSpending.bill.taxNone')) + c.taxCodes.map((x) => option(x.id, `${x.code} · ${x.label}`)).join(''));
  const payFrom = select('payFrom', t(locale, 'booksSpending.bill.payFrom'), option('', t(locale, 'booksSpending.bill.notPaid')) + c.payAccounts.map((a) => option(a.id, `${a.code} · ${a.name}`)).join(''));
  return category + account + tax + payFrom;
}

export function renderSpendingBook(locale: Locale, viewer: Who, d: SpendingBook, c: SpendingChoices): string {
  const may = owner(viewer);
  const cur = c.bookCurrency;
  const waiting = d.proposals.length === 0 ? '' : `<section class="block" id="waiting"><h2>${esc(t(locale, 'booksSpending.waiting.title'))}</h2><p class="muted">${esc(t(locale, 'booksSpending.waiting.lede'))}</p>
    <ul class="rows">${d.proposals.map((p) => `<li class="row"><span><bdi>${esc(p.label)}</bdi> · ${esc(booksDay(locale, p.dueOn))}${p.category ? ` · <bdi>${esc(p.category)}</bdi>` : ''}${p.payFrom ? ` · ${esc(t(locale, 'booksSpending.waiting.payFrom', { account: p.payFrom }))}` : ` · ${esc(t(locale, 'booksSpending.bill.notPaid'))}`}</span><b>${money(locale, p.amount, p.currency)}</b>${may ? `
      <form method="post" action="/app/books/spending/proposals/${esc(p.id)}/post" class="inline"><button class="btn send" type="submit">${esc(t(locale, 'booksSpending.waiting.post'))}</button></form>
      <form method="post" action="/app/books/spending/proposals/${esc(p.id)}/skip" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'booksSpending.waiting.skipAsk'))}">${esc(t(locale, 'booksSpending.waiting.skip'))}</button></form>` : ''}</li>`).join('')}</ul></section>`;
  const month = `<p class="caption muted">${esc(t(locale, 'booksSpending.month', { amount: show.money(locale, moneyFromRow(d.spentThisMonth, cur)!) , from: booksDay(locale, d.monthFrom) }))}</p>`;
  const bill = !may ? '' : `<section class="block" id="bill"><h2>${esc(t(locale, 'booksSpending.bill.title'))}</h2><p class="muted">${esc(t(locale, 'booksSpending.bill.lede'))}</p>
    ${c.purchasesJournal && (c.payableAccount || c.payAccounts.length) ? `<form method="post" action="/app/books/spending/bills" class="pform">
      ${input('date', t(locale, 'books.entry.date'), 'date', ` value="${esc(d.today)}" required`)}
      ${input('label', t(locale, 'books.entry.label'), 'text', ' maxlength="200" required')}
      ${input('ref', t(locale, 'booksSpending.bill.ref'), 'text', ' maxlength="120" required autocomplete="off"')}
      ${input('gross', t(locale, 'booksSpending.bill.gross', { currency: cur }), 'text', ' inputmode="decimal" required')}
      ${supplierFields(locale, c)}${costFields(locale, c)}
      <button class="btn send" type="submit">${esc(t(locale, 'booksSpending.bill.record'))}</button></form>` : `<p>${esc(t(locale, 'booksSpending.bill.noChart'))}</p><p><a class="deeper" href="/app/settings/books/country">${esc(t(locale, 'books.country.nav'))}</a></p>`}</section>`;
  const unpaid = `<section class="block" id="unpaid"><h2>${esc(t(locale, 'booksSpending.unpaid.title'))}</h2>${d.unpaid.length === 0 ? `<p class="muted">${esc(t(locale, 'booksSpending.unpaid.none'))}</p>` : `<ul class="rows">${d.unpaid.map((b) =>
    `<li class="row"><span><a href="/app/books/advanced/entries/${esc(b.entryId)}"><bdi>${esc(b.key)}</bdi></a> · ${esc(booksDay(locale, b.date))} · <bdi>${esc(b.label)}</bdi>${b.supplier ? ` · <bdi>${esc(b.supplier)}</bdi>` : ''}</span><b>${money(locale, b.gross, b.currency)}</b>${may && c.payAccounts.length ? `
      <form method="post" action="/app/books/spending/bills/${esc(b.id)}/pay" class="pform inline">${input('date', t(locale, 'books.invoice.paidOn'), 'date', ` value="${esc(d.today)}" required`)}
      ${select('account', t(locale, 'books.invoice.bank'), option('', t(locale, 'books.invoice.bankChoose')) + c.payAccounts.map((a) => option(a.id, `${a.code} · ${a.name}`)).join(''), ' required')}
      <button class="btn" type="submit">${esc(t(locale, 'booksSpending.unpaid.pay'))}</button></form>` : ''}</li>`).join('')}</ul>`}</section>`;
  const recurring = `<section class="block" id="recurring"><h2>${esc(t(locale, 'booksSpending.recurring.title'))}</h2><p class="muted">${esc(t(locale, 'booksSpending.recurring.lede'))}</p>
    ${d.recurring.length === 0 ? `<p class="muted">${esc(t(locale, 'booksSpending.recurring.none'))}</p>` : `<ul class="rows">${d.recurring.map((r) =>
    `<li class="row"><span><bdi>${esc(r.label)}</bdi> · ${esc(t(locale, `booksSpending.every.${r.every}` as MessageKey))} · ${esc(t(locale, 'booksSpending.recurring.next', { date: booksDay(locale, r.nextOn) }))}${r.category ? ` · <bdi>${esc(r.category)}</bdi>` : ''}</span><b>${money(locale, r.amount, r.currency)}</b>${may ? `
      <form method="post" action="/app/books/spending/recurring/${esc(r.id)}/archive" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'booksSpending.recurring.stopAsk'))}">${esc(t(locale, 'booksSpending.recurring.stop'))}</button></form>` : ''}</li>`).join('')}</ul>`}
    ${may && c.purchasesJournal ? `<form method="post" action="/app/books/spending/recurring" class="pform"><h3>${esc(t(locale, 'booksSpending.recurring.add'))}</h3>
      ${input('label', t(locale, 'books.entry.label'), 'text', ' maxlength="120" required')}
      ${input('amount', t(locale, 'booksSpending.bill.gross', { currency: cur }), 'text', ' inputmode="decimal" required')}
      ${select('every', t(locale, 'booksSpending.recurring.every'), EVERY.map((e) => option(e, t(locale, `booksSpending.every.${e}` as MessageKey), e === 'month')).join(''))}
      ${input('firstOn', t(locale, 'booksSpending.recurring.firstOn'), 'date', ` value="${esc(d.today)}" required`)}
      ${supplierFields(locale, c)}${costFields(locale, c)}
      <button class="btn" type="submit">${esc(t(locale, 'booksSpending.recurring.save'))}</button></form>` : ''}</section>`;
  const categories = `<section class="block" id="categories"><h2>${esc(t(locale, 'booksSpending.categories.title'))}</h2><p class="muted">${esc(t(locale, 'booksSpending.categories.lede'))}</p>
    ${c.categories.length === 0 ? '' : `<ul class="rows">${c.categories.map((x: Category) => `<li class="row"><span><bdi>${esc(x.name)}</bdi> · ${esc(x.accountCode)} · <bdi>${esc(x.accountName)}</bdi></span>${may ? `
      <form method="post" action="/app/books/spending/categories/${esc(x.id)}/archive" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'booksSpending.categories.removeAsk'))}">${esc(t(locale, 'booksSpending.categories.remove'))}</button></form>` : ''}</li>`).join('')}</ul>`}
    ${may && c.expenseAccounts.length ? `<form method="post" action="/app/books/spending/categories" class="pform">${input('name', t(locale, 'booksSpending.categories.name'), 'text', ' maxlength="60" required')}
      ${select('account', t(locale, 'booksSpending.bill.account'), c.expenseAccounts.map((a) => option(a.id, `${a.code} · ${a.name}`)).join(''), ' required')}
      <button class="btn" type="submit">${esc(t(locale, 'booksSpending.categories.add'))}</button></form>` : ''}</section>`;
  return `<section class="books-spending-book">${month}${waiting}${bill}${unpaid}${recurring}${categories}</section>`;
}
