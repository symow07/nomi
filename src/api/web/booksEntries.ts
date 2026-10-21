import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { addDecimal, compareDecimal, type Decimal } from '../../core/types/decimal.js';
import { CURRENCIES, moneyFromRow } from '../../core/types/money.js';
import type { EntryRow, EntryView } from '../../db/booksEntries.js';
import type { BooksAccounts, OrderToEnter } from '../../db/booksOrders.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * C1 (Phase 5, item 3) — THE BOOKS' ENTRIES, ON THE PAGE: the list, one entry, and a new one by hand. Posting,
 * discarding and reversing are the owner's (`post`); an accountant sees all of it and acts on none (A5). A posted
 * entry offers one thing only: its reversal — never an edit.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const mayPost = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const amount = (locale: Locale, d: Decimal | null, currency: string): string => {
  if (d === null) return '';
  const m = moneyFromRow(d, currency);
  return m ? esc(show.money(locale, m)) : esc(d);
};
const statePill = (locale: Locale, s: EntryRow['state']) =>
  `<span class="pill ${s === 'posted' ? 'ok' : 'warn'}">${esc(t(locale, `books.entry.state.${s}` as MessageKey))}</span>`;

export function renderEntries(locale: Locale, viewer: Who, rows: readonly EntryRow[]): string {
  return `<h1 class="page">${esc(t(locale, 'books.entries.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.entries.lede'))}</p>
    ${mayPost(viewer) ? `<p><a class="deeper" href="/app/books/entries/new">${esc(t(locale, 'books.entries.new'))}</a></p>` : ''}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.home.empty'))}</p>` : `<div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.date'))}</th><th scope="col">${esc(t(locale, 'books.entry.number'))}</th>
        <th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.entry.total'))}</th><th scope="col"></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(show.dateYear(locale, new Date(`${r.date}T12:00:00Z`)))}</td>
        <td><a href="/app/books/entries/${esc(r.id)}"><bdi>${esc(r.state === 'posted' ? r.key : t(locale, 'books.entry.state.draft'))}</bdi></a></td>
        <td><bdi>${esc(r.label)}</bdi></td><td>${amount(locale, r.total as Decimal, r.currency)}</td>
        <td>${statePill(locale, r.state)}${r.reversedBy ? ` <span class="pill">${esc(t(locale, 'books.entry.reversed'))}</span>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/** Each currency's debits and credits, for the line under the lines: balanced, or by how much it is not. */
function totals(e: EntryView): { currency: string; debit: Decimal; credit: Decimal }[] {
  const by = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const l of e.lines) {
    const t0 = by.get(l.currency) ?? { debit: '0' as Decimal, credit: '0' as Decimal };
    by.set(l.currency, { debit: l.debit ? addDecimal(t0.debit, l.debit) : t0.debit, credit: l.credit ? addDecimal(t0.credit, l.credit) : t0.credit });
  }
  return [...by].map(([currency, x]) => ({ currency, ...x }));
}

export function renderEntry(locale: Locale, viewer: Who, e: EntryView, today: string, bookCurrency: string): string {
  const posted = e.state === 'posted';
  const foreign = e.lines.some((l) => l.rate !== null);
  const sums = totals(e);
  const balanced = sums.every((s) => compareDecimal(s.debit, s.credit) === 0);
  const meta = [
    `${esc(t(locale, 'books.entry.journal'))}: <bdi>${esc(e.journal)}</bdi>`,
    `${esc(t(locale, 'books.entry.date'))}: ${esc(show.dateYear(locale, new Date(`${e.date}T12:00:00Z`)))}`,
    e.documentRef ? `${esc(t(locale, 'books.entry.document'))}: <bdi>${esc(e.documentRef)}</bdi>${e.documentDate ? ` · ${esc(show.dateYear(locale, new Date(`${e.documentDate}T12:00:00Z`)))}` : ''}` : '',
  ].filter(Boolean);
  const actions = !mayPost(viewer) ? '' : e.state === 'draft' ? `
      ${!e.documentRef || !e.documentDate ? `<p class="caption muted">${esc(t(locale, 'books.entry.needsDocument'))}</p>` : ''}
      <form method="post" action="/app/books/entries/${esc(e.id)}/post" class="pform"><button class="btn" type="submit">${esc(t(locale, 'books.entry.post'))}</button></form>
      <form method="post" action="/app/books/entries/${esc(e.id)}/discard" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.entry.discardAsk'))}">${esc(t(locale, 'books.entry.discard'))}</button></form>`
    : posted && !e.reversedBy ? `
      <form method="post" action="/app/books/entries/${esc(e.id)}/reverse" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.entry.reverseOn'))}</span><input type="date" name="date" value="${esc(today)}" required /></label>
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.entry.reverseAsk'))}">${esc(t(locale, 'books.entry.reverse'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.entry.onlyReverse'))}</p>` : '';
  return `<h1 class="page"><bdi>${esc(posted ? e.key : t(locale, 'books.entry.state.draft'))}</bdi> · <bdi>${esc(e.label)}</bdi></h1>
    <p>${statePill(locale, e.state)}${e.reversedBy ? ` <a href="/app/books/entries/${esc(e.reversedBy)}">${esc(t(locale, 'books.entry.seeReversal'))}</a>` : ''}${
      e.reverses ? ` <a href="/app/books/entries/${esc(e.reverses)}">${esc(t(locale, 'books.entry.seeOriginal'))}</a>` : ''}</p>
    <p class="caption muted">${meta.join(' · ')}</p>
    <div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.account'))}</th><th scope="col">${esc(t(locale, 'books.entry.party'))}</th>
        <th scope="col">${esc(t(locale, 'books.entry.debit'))}</th><th scope="col">${esc(t(locale, 'books.entry.credit'))}</th>
        ${foreign ? `<th scope="col">${esc(t(locale, 'books.entry.inBooks'))}</th>` : ''}</tr></thead>
      <tbody>${e.lines.map((l) => `<tr><td><bdi>${esc(l.account)}</bdi> <span class="muted"><bdi>${esc(l.accountName)}</bdi></span>${
          l.isFx ? ` <span class="pill">${esc(t(locale, 'books.entry.fx'))}</span>` : ''}${l.label ? `<br><span class="caption muted"><bdi>${esc(l.label)}</bdi></span>` : ''}</td>
        <td>${l.party ? `<bdi>${esc(l.party)}</bdi>` : ''}</td>
        <td>${amount(locale, l.debit, l.currency)}</td><td>${amount(locale, l.credit, l.currency)}</td>
        ${foreign ? `<td>${l.rate !== null && (l.bookDebit ?? l.bookCredit) ? `${amount(locale, l.bookDebit ?? l.bookCredit, bookCurrency)} <span class="caption muted">× ${esc(l.rate)}</span>` : ''}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>
    <p class="caption ${balanced ? 'muted' : ''}">${balanced ? esc(t(locale, 'books.entry.balanced'))
      : esc(t(locale, 'books.entry.notBalanced', { by: sums.filter((s) => compareDecimal(s.debit, s.credit) !== 0).map((s) => `${s.currency} ${s.debit} / ${s.credit}`).join(' · ') }))}</p>
    ${actions}
    <p><a class="deeper" href="/app/books/entries">${esc(t(locale, 'books.entries.title'))}</a></p>`;
}

export type EntryChoices = {
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string; from: string }[];
  readonly bookCurrency: string;
};
export const ENTRY_FORM_LINES = 8;

/** A new entry by hand: up to eight lines; empty ones are left out. Saved as a DRAFT, posted from its own page. */
export function renderNewEntry(locale: Locale, c: EntryChoices, values: Readonly<Record<string, string>>, problems: readonly string[], today: string): string {
  const v = (k: string) => esc(values[k] ?? '');
  const options = (rows: readonly { id: string; code: string; name?: string; label?: string }[], name: string, blank: boolean) =>
    `${blank ? '<option value=""></option>' : ''}${rows.map((r) => `<option value="${esc(r.id)}"${values[name] === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name ?? r.label ?? '')}</option>`).join('')}`;
  const currencies = (name: string) => CURRENCIES.map((cur) => `<option${(values[name] ?? c.bookCurrency) === cur ? ' selected' : ''}>${cur}</option>`).join('');
  const line = (i: number) => `<tr>
      <td><select name="account${i}" aria-label="${esc(t(locale, 'books.entry.account'))} ${i + 1}">${options(c.accounts, `account${i}`, true)}</select></td>
      <td><select name="party${i}" aria-label="${esc(t(locale, 'books.entry.party'))} ${i + 1}">${options(c.parties, `party${i}`, true)}</select></td>
      <td><select name="tax${i}" aria-label="${esc(t(locale, 'books.entry.tax'))} ${i + 1}">${options(c.taxCodes, `tax${i}`, true)}</select></td>
      <td><select name="currency${i}" aria-label="${esc(t(locale, 'books.entry.currency'))} ${i + 1}">${currencies(`currency${i}`)}</select></td>
      <td><input name="debit${i}" inputmode="decimal" value="${v(`debit${i}`)}" aria-label="${esc(t(locale, 'books.entry.debit'))} ${i + 1}" /></td>
      <td><input name="credit${i}" inputmode="decimal" value="${v(`credit${i}`)}" aria-label="${esc(t(locale, 'books.entry.credit'))} ${i + 1}" /></td>
      <td><input name="label${i}" value="${v(`label${i}`)}" aria-label="${esc(t(locale, 'books.entry.lineLabel'))} ${i + 1}" /></td>
      <td><input type="checkbox" name="fx${i}" value="1"${values[`fx${i}`] ? ' checked' : ''} aria-label="${esc(t(locale, 'books.entry.fx'))} ${i + 1}" /></td></tr>`;
  return `<h1 class="page">${esc(t(locale, 'books.entries.new'))}</h1>
    <p class="lede">${esc(t(locale, 'books.entry.newLede'))}</p>
    ${problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    <form method="post" action="/app/books/entries" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span><select name="journal" required>${options(c.journals, 'journal', false)}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.date'))}</span><input type="date" name="date" value="${values['date'] ? v('date') : esc(today)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.label'))}</span><input name="label" value="${v('label')}" required maxlength="200" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.document'))}</span><input name="documentRef" value="${v('documentRef')}" maxlength="80" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.documentDate'))}</span><input type="date" name="documentDate" value="${v('documentDate')}" /></label>
      <div class="imp-table"><table>
        <thead><tr><th scope="col">${esc(t(locale, 'books.entry.account'))}</th><th scope="col">${esc(t(locale, 'books.entry.party'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.tax'))}</th><th scope="col">${esc(t(locale, 'books.entry.currency'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.debit'))}</th><th scope="col">${esc(t(locale, 'books.entry.credit'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.lineLabel'))}</th><th scope="col">${esc(t(locale, 'books.entry.fx'))}</th></tr></thead>
        <tbody>${Array.from({ length: ENTRY_FORM_LINES }, (_, i) => line(i)).join('')}</tbody>
      </table></div>
      <button class="btn" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button>
    </form>
    <p class="caption muted">${esc(t(locale, 'books.entry.draftNote'))}</p>`;
}

/**
 * C1 (0183) — Nomi's confirmed orders not in the books yet, each with a draft to make; and the owner's choice of the
 * accounts every drafted entry uses (sales journal, receivable, sales; the exchange loss and gain of 0182).
 */
export function renderBooksOrders(locale: Locale, orders: readonly OrderToEnter[], accountsSet: boolean): string {
  return `<h1 class="page">${esc(t(locale, 'books.orders.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.orders.lede'))}</p>
    ${!accountsSet ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.orders.setFirst'))}</span> <a class="deeper" href="/app/books#accounts">${esc(t(locale, 'books.accounts.title'))}</a></p>` : ''}
    ${orders.length === 0 ? `<p class="muted">${esc(t(locale, 'books.orders.none'))}</p>` : `<div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.date'))}</th><th scope="col">${esc(t(locale, 'books.entry.document'))}</th>
        <th scope="col">${esc(t(locale, 'books.orders.buyer'))}</th><th scope="col">${esc(t(locale, 'books.entry.total'))}</th><th scope="col"></th></tr></thead>
      <tbody>${orders.map((o) => `<tr><td>${esc(show.dateYear(locale, new Date(`${o.confirmedOn}T12:00:00Z`)))}</td><td><bdi>${esc(o.reference)}</bdi></td>
        <td>${o.buyer ? `<bdi>${esc(o.buyer)}</bdi>` : ''}</td><td>${amount(locale, o.total as Decimal, o.currency)}</td>
        <td>${accountsSet ? `<form method="post" action="/app/books/orders/${esc(o.id)}/draft" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, 'books.orders.draft'))}</button></form>` : ''}</td></tr>`).join('')}</tbody>
    </table></div>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

export function renderBooksAccounts(locale: Locale, c: EntryChoices, a: BooksAccounts): string {
  const pick = (name: string, rows: readonly { id: string; code: string; name: string }[], chosen: string | null) =>
    `<select name="${name}"><option value=""></option>${rows.map((r) => `<option value="${esc(r.id)}"${chosen === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  return `<div class="block" id="accounts">
      <h2>${esc(t(locale, 'books.accounts.title'))}</h2>
      <p>${esc(t(locale, 'books.accounts.explain'))}</p>
      <form method="post" action="/app/books/settings/accounts" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.accounts.salesJournal'))}</span>${pick('salesJournal', c.journals, a.salesJournalId)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.accounts.receivable'))}</span>${pick('receivable', c.accounts, a.receivableAccountId)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.accounts.sales'))}</span>${pick('sales', c.accounts, a.salesAccountId)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.accounts.fxLoss'))}</span>${pick('fxLoss', c.accounts, a.fxLossAccountId)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.accounts.fxGain'))}</span>${pick('fxGain', c.accounts, a.fxGainAccountId)}</label>
        <button class="btn" type="submit">${esc(t(locale, 'books.accounts.save'))}</button>
      </form>
      <p><a class="deeper" href="/app/books/orders">${esc(t(locale, 'books.orders.title'))}</a></p>
    </div>`;
}
