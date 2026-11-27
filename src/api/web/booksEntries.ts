import { safeBooksReturn } from './booksNavigation.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { addDecimal, compareDecimal, type Decimal } from '../../core/types/decimal.js';
import { CURRENCIES, moneyFromRow } from '../../core/types/money.js';
import type { EntryRow, EntryView } from '../../db/booksEntries.js';
import type { BooksAccounts, OrderToEnter } from '../../db/booksOrders.js';
import type { BooksField } from '../../core/books/interchange.js';
import { customHeads, customInputs, customShown } from './booksFields.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { isNoref } from '../../core/books/spending.js';
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
/** F22 (UI correction, Block 5) — a cell's own label, read on a phone where each row is a card. */
export const cellLabel = (locale: Locale, k: MessageKey, extra?: string): string => ` data-label="${esc(t(locale, k))}${extra ? ` · ${esc(extra)}` : ''}"`;
/** F22 — the frame a wide table scrolls in, if it must: reachable by keyboard and named. */
export const tableFrame = (locale: Locale, title: string, cls = ''): string =>
  `<div class="imp-table bk-rows${cls ? ` ${cls}` : ''}" role="region" tabindex="0" aria-label="${esc(t(locale, 'booksEntry.tableOf', { title }))}">`;
const statePill = (locale: Locale, s: EntryRow['state']) =>
  `<span class="pill ${s === 'posted' ? 'ok' : 'warn'}">${esc(t(locale, `books.entry.state.${s}` as MessageKey))}</span>`;

export function renderEntries(locale: Locale, viewer: Who, rows: readonly EntryRow[]): string {
  return `<h1 class="page">${esc(t(locale, 'books.entries.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.entries.lede'))}</p>
    ${mayPost(viewer) ? `<p><a class="deeper" href="/app/books/advanced/entries/new">${esc(t(locale, 'books.entries.new'))}</a></p>` : ''}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.home.empty'))}</p>` : `${tableFrame(locale, t(locale, 'books.entries.title'), 'bk-cards')}<table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.date'))}</th><th scope="col">${esc(t(locale, 'books.entry.number'))}</th>
        <th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col" class="num">${esc(t(locale, 'books.entry.total'))}</th><th scope="col">${esc(t(locale, 'booksInvoice.state'))}</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="bk-date"${cellLabel(locale, 'books.entry.date')}><span>${esc(show.isolate(locale, show.dateYear(locale, new Date(`${r.date}T12:00:00Z`))))}</span></td>
        <td class="bk-key"${cellLabel(locale, 'books.entry.number')}><a href="/app/books/advanced/entries/${esc(r.id)}"><bdi>${esc(r.state === 'posted' ? r.key : t(locale, 'books.entry.state.draft'))}</bdi></a></td>
        <td class="bk-text"${cellLabel(locale, 'books.entry.label')}><bdi>${esc(r.label)}</bdi></td><td class="num"${cellLabel(locale, 'books.entry.total')}><span>${amount(locale, r.total as Decimal, r.currency)}</span></td>
        <td class="bk-state"${cellLabel(locale, 'booksInvoice.state')}><span>${statePill(locale, r.state)}${r.reversedBy ? ` <span class="pill">${esc(t(locale, 'books.entry.reversed'))}</span>` : ''}</span></td></tr>`).join('')}</tbody>
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

export function renderEntry(locale: Locale, viewer: Who, e: EntryView, today: string, bookCurrency: string, fields: readonly BooksField[] = [], opts:{readonly returnHref?:string}={}): string {
  const returnHref=safeBooksReturn(opts.returnHref);const returnField=returnHref?`<input type="hidden" name="from" value="${esc(returnHref)}">`:'';const returnQuery=returnHref?'?from='+encodeURIComponent(returnHref):'';
  const posted = e.state === 'posted';
  const foreign = e.lines.some((l) => l.rate !== null);
  const sums = totals(e);
  const balanced = sums.every((s) => compareDecimal(s.debit, s.credit) === 0);
  const meta = [
    `${esc(t(locale, 'books.entry.journal'))}: <bdi>${esc(e.journal)}</bdi>`,
    `${esc(t(locale, 'books.entry.date'))}: ${esc(show.dateYear(locale, new Date(`${e.date}T12:00:00Z`)))}`,
    e.documentRef ? `${esc(t(locale, 'books.entry.document'))}: <bdi>${esc(e.documentRef)}</bdi>${e.documentDate ? ` · ${esc(show.dateYear(locale, new Date(`${e.documentDate}T12:00:00Z`)))}` : ''}${isNoref(e.documentRef) ? ` · ${esc(t(locale, 'booksSpending.bill.noRefEntry'))}` : ''}` : '',
    customShown(locale, fields, 'entry', e.custom),
  ].filter(Boolean);
  const actions = !mayPost(viewer) ? '' : e.state === 'draft' ? `
      <p><a class="deeper" href="/app/books/advanced/entries/${esc(e.id)}/edit${returnQuery}">${esc(t(locale, 'books.draft.edit'))}</a></p>
      ${!e.documentRef || !e.documentDate ? `<p class="caption muted">${esc(t(locale, 'books.entry.needsDocument'))}</p>` : ''}
      <form method="post" action="/app/books/entries/${esc(e.id)}/post" class="pform">${returnField}<button class="btn send" type="submit">${esc(t(locale, 'booksArea.save'))}</button></form>
      <form method="post" action="/app/books/entries/${esc(e.id)}/discard" class="pform">${returnField}
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.entry.discardAsk'))}">${esc(t(locale, 'books.entry.discard'))}</button></form>`
    : posted && !e.reversedBy ? `
      <form method="post" action="/app/books/entries/${esc(e.id)}/reverse" class="pform">${returnField}
        <label class="pq"><span>${esc(t(locale, 'books.entry.reverseOn'))}</span><input type="date" name="date" value="${esc(today)}" required /></label>
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.entry.reverseAsk'))}">${esc(t(locale, 'books.entry.reverse'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.entry.onlyReverse'))}</p>` : '';
  return `${returnHref?`<p><a href="${esc(returnHref)}">${esc(t(locale,'booksArea.support'))}</a></p>`:''}<h1 class="page"><bdi>${esc(posted ? e.key : t(locale, 'books.entry.state.draft'))}</bdi> · <bdi>${esc(e.label)}</bdi></h1>
    <p>${statePill(locale, e.state)}${e.reversedBy ? ` <a href="/app/books/advanced/entries/${esc(e.reversedBy)}">${esc(t(locale, 'books.entry.seeReversal'))}</a>` : ''}${
      e.reverses ? ` <a href="/app/books/advanced/entries/${esc(e.reverses)}">${esc(t(locale, 'books.entry.seeOriginal'))}</a>` : ''}</p>
    <p class="caption muted">${meta.join(' · ')}</p>
    ${tableFrame(locale, t(locale, 'books.entries.title'))}<table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.account'))}</th><th scope="col">${esc(t(locale, 'books.entry.party'))}</th>
        <th scope="col" class="num">${esc(t(locale, 'books.entry.debit'))}</th><th scope="col" class="num">${esc(t(locale, 'books.entry.credit'))}</th>
        ${foreign ? `<th scope="col" class="num">${esc(t(locale, 'books.entry.inBooks'))}</th>` : ''}</tr></thead>
      <tbody>${e.lines.map((l) => `<tr><td class="bk-text bk-lead"${cellLabel(locale, 'books.entry.account')}><span><bdi>${esc(l.account)}</bdi> <span class="muted"><bdi>${esc(l.accountName)}</bdi></span>${
          l.isFx ? ` <span class="pill">${esc(t(locale, 'books.entry.fx'))}</span>` : ''}${l.label ? `<br><span class="caption muted"><bdi>${esc(l.label)}</bdi></span>` : ''}${
          Object.keys(l.custom ?? {}).length > 0 ? `<br><span class="caption muted">${customShown(locale, fields, 'line', l.custom)}</span>` : ''}</span></td>
        <td class="bk-text"${cellLabel(locale, 'books.entry.party')}>${l.party ? `<bdi>${esc(l.party)}</bdi>` : ''}</td>
        <td class="num"${cellLabel(locale, 'books.entry.debit')}>${l.debit ? `<span>${amount(locale, l.debit, l.currency)}</span>` : ''}</td><td class="num"${cellLabel(locale, 'books.entry.credit')}>${l.credit ? `<span>${amount(locale, l.credit, l.currency)}</span>` : ''}</td>
        ${foreign ? `<td class="num"${cellLabel(locale, 'books.entry.inBooks')}>${l.rate !== null && (l.bookDebit ?? l.bookCredit) ? `<span>${amount(locale, l.bookDebit ?? l.bookCredit, bookCurrency)} <span class="caption muted">× <bdi>${esc(l.rate)}</bdi></span></span>` : ''}</td>` : ''}</tr>`).join('')}</tbody>
    </table></div>
    <p class="caption ${balanced ? 'muted' : ''}">${balanced ? esc(t(locale, 'books.entry.balanced'))
      : esc(t(locale, 'books.entry.notBalanced', { by: sums.filter((s) => compareDecimal(s.debit, s.credit) !== 0).map((s) => `${s.currency} ${s.debit} / ${s.credit}`).join(' · ') }))}</p>
    ${actions}
    <p><a class="deeper" href="/app/books/advanced/entries">${esc(t(locale, 'books.entries.title'))}</a></p>`;
}

export type EntryChoices = {
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string; from: string }[];
  readonly bookCurrency: string;
  /** D7 — the custom fields in use. */
  readonly fields?: readonly BooksField[];
};
export const ENTRY_FORM_LINES = 8;
/** D7 — a custom value's name in the entry form: the entry's, or line i's. */
export const ENTRY_CUSTOM = 'cf_entry_';
export const lineCustom = (i: number): string => `cf_line${i}_`;

/**
 * 0216 (a) — how many line rows a form draws: its own number, or a draft's lines and two more (a draft made from an
 * order or a workbook may have more than the form's eight). The handler reads the same number of rows back.
 */
export const formLines = (values: Readonly<Record<string, string>>, base: number, key: string): number => {
  let last = -1;
  for (const k of Object.keys(values)) { const m = new RegExp(`^${key}(\\d{1,3})$`).exec(k); if (m && values[k]) last = Math.max(last, Number(m[1])); }
  return Math.min(200, Math.max(base, last + 3));
};

/**
 * A new entry by hand: up to eight lines; empty ones are left out. Saved as a DRAFT, posted from its own page.
 * 0216 (a) — `editing`, a draft's id: the same form, filled with the draft, saving over it.
 */
export function renderNewEntry(locale: Locale, c: EntryChoices, values: Readonly<Record<string, string>>, problems: readonly string[], today: string,
  editing: string | null = null, opts:{readonly returnHref?:string}={}): string {
  const returnHref=safeBooksReturn(opts.returnHref);
  const v = (k: string) => esc(values[k] ?? '');
  const options = (rows: readonly { id: string; code: string; name?: string; label?: string }[], name: string, blank: boolean) =>
    `${blank ? '<option value=""></option>' : ''}${rows.map((r) => `<option value="${esc(r.id)}"${values[name] === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name ?? r.label ?? '')}</option>`).join('')}`;
  const currencies = (name: string) => CURRENCIES.map((cur) => `<option${(values[name] ?? c.bookCurrency) === cur ? ' selected' : ''}>${cur}</option>`).join('');
  const line = (i: number) => `<tr>
      <td class="el-account" data-n="${i + 1}" data-label="${esc(t(locale, 'books.entry.account'))}"><select name="account${i}" data-echo aria-label="${esc(t(locale, 'books.entry.account'))} ${i + 1}">${options(c.accounts, `account${i}`, true)}</select><span class="el-echo" data-echo-out aria-hidden="true"></span></td>
      <td class="el-party" data-label="${esc(t(locale, 'books.entry.party'))}"><select name="party${i}" data-echo aria-label="${esc(t(locale, 'books.entry.party'))} ${i + 1}">${options(c.parties, `party${i}`, true)}</select><span class="el-echo" data-echo-out aria-hidden="true"></span></td>
      <td class="el-tax" data-label="${esc(t(locale, 'books.entry.tax'))}"><select name="tax${i}" data-echo aria-label="${esc(t(locale, 'books.entry.tax'))} ${i + 1}">${options(c.taxCodes, `tax${i}`, true)}</select><span class="el-echo" data-echo-out aria-hidden="true"></span></td>
      <td class="el-currency" data-label="${esc(t(locale, 'books.entry.currency'))}"><select name="currency${i}" aria-label="${esc(t(locale, 'books.entry.currency'))} ${i + 1}">${currencies(`currency${i}`)}</select></td>
      <td class="el-amount" data-label="${esc(t(locale, 'books.entry.debit'))}"><input name="debit${i}" inputmode="decimal" value="${v(`debit${i}`)}" aria-label="${esc(t(locale, 'books.entry.debit'))} ${i + 1}" /></td>
      <td class="el-amount" data-label="${esc(t(locale, 'books.entry.credit'))}"><input name="credit${i}" inputmode="decimal" value="${v(`credit${i}`)}" aria-label="${esc(t(locale, 'books.entry.credit'))} ${i + 1}" /></td>
      <td class="el-label" data-label="${esc(t(locale, 'books.entry.lineLabel'))}"><input name="label${i}" value="${v(`label${i}`)}" aria-label="${esc(t(locale, 'books.entry.lineLabel'))} ${i + 1}" /></td>
      <td class="el-fx" data-label="${esc(t(locale, 'books.entry.fx'))}"><label class="el-fx-hit"><input type="checkbox" name="fx${i}" value="1"${values[`fx${i}`] ? ' checked' : ''} aria-label="${esc(t(locale, 'books.entry.fx'))} ${i + 1}" /></label></td>
      ${customInputs(locale, c.fields ?? [], 'line', lineCustom(i), values, { bare: true, n: i + 1 })}</tr>`;
  // F22 (UI correction, Block 5; F21's remainder) — eight full lines made the phone form 4,839 px. The lines up to the
  // last one holding anything (at least two: an entry needs two) are open; the empty ones after it sit behind one
  // disclosure, inside the same form, with the same names: a closed disclosure's fields are still sent.
  const count = formLines(values, ENTRY_FORM_LINES, 'account');
  const filled = (i: number) => Object.keys(values).some((k) => values[k] !== '' && values[k] !== undefined && (k.startsWith(lineCustom(i))
    || ['account', 'party', 'tax', 'debit', 'credit', 'label', 'fx'].some((f) => k === `${f}${i}`)));
  let last = -1;
  for (let i = 0; i < count; i += 1) if (filled(i)) last = i;
  const open = Math.min(count, Math.max(2, last + 1));
  const linesTable = (from: number, to: number) => `<div class="imp-table entry-lines" role="region" tabindex="0" aria-label="${esc(t(locale, 'books.entries.new'))}"><table>
        <thead><tr><th scope="col">${esc(t(locale, 'books.entry.account'))}</th><th scope="col">${esc(t(locale, 'books.entry.party'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.tax'))}</th><th scope="col">${esc(t(locale, 'books.entry.currency'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.debit'))}</th><th scope="col">${esc(t(locale, 'books.entry.credit'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.lineLabel'))}</th><th scope="col">${esc(t(locale, 'books.entry.fx'))}</th>${customHeads(c.fields ?? [], 'line')}</tr></thead>
        <tbody>${Array.from({ length: to - from }, (_, k) => line(from + k)).join('')}</tbody>
      </table></div>`;
  return `<h1 class="page">${esc(t(locale, editing ? 'books.draft.editTitle' : 'books.entries.new'))}</h1>
    <p class="lede">${esc(t(locale, 'books.entry.newLede'))}</p>
    ${problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    <form method="post" action="${editing ? `/app/books/entries/${esc(editing)}/edit` : '/app/books/entries'}" class="pform entry-form">${returnHref?`<input type="hidden" name="from" value="${esc(returnHref)}">`:''}
      <div class="entry-head"><label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span><select name="journal" required>${options(c.journals, 'journal', false)}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.date'))}</span><input type="date" name="date" value="${values['date'] ? v('date') : esc(today)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.label'))}</span><input name="label" value="${v('label')}" required maxlength="200" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.document'))}</span><input name="documentRef" value="${v('documentRef')}" maxlength="80" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.documentDate'))}</span><input type="date" name="documentDate" value="${v('documentDate')}" /></label>
      ${customInputs(locale, c.fields ?? [], 'entry', ENTRY_CUSTOM, values)}</div>
      ${/* Audit F21, and its fix round — each line is a labelled group at every width: the account on its own line, then who and what, then the figures. A select marked data-echo has its choice written out under it when the box is too narrow to show it whole (the page's script; without it the open list still shows every name in full). */ ''}${linesTable(0, open)}${open < count ? `<details class="el-more"><summary>${esc(t(locale, 'booksEntry.moreLines', { n: show.count(locale, count - open) }))}</summary>${linesTable(open, count)}</details>` : ''}
      <button class="btn send" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button>
    </form>
    <p class="caption muted">${esc(t(locale, 'books.entry.draftNote'))}</p>`;
}

/**
 * C1 (0183) — Nomi's confirmed orders not in the books yet, each with a draft to make; and the owner's choice of the
 * accounts every drafted entry uses (sales journal, receivable, sales; the exchange loss and gain of 0182).
 */
export function renderBooksOrders(locale: Locale, orders: readonly OrderToEnter[], accountsSet: boolean, c: Pick<EntryChoices, 'parties' | 'taxCodes'>): string {
  const ready = accountsSet && c.parties.length > 0;
  const choose = (o: OrderToEnter) => `<form method="post" action="/app/books/orders/${esc(o.id)}/draft" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.invoice.customer'))}</span><select name="party" required><option value=""></option>${c.parties.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.tax'))}</span><select name="taxCode"><option value=""></option>${c.taxCodes.map((x) =>
        `<option value="${esc(x.id)}">${esc(x.code)} · ${esc(x.label)}</option>`).join('')}</select></label>
      <button class="btn" type="submit">${esc(t(locale, 'books.orders.draft'))}</button></form>`;
  return `<h1 class="page">${esc(t(locale, 'books.orders.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.orders.lede'))}</p>
    ${!accountsSet ? `<p role="status"><span class="pill warn long">${esc(t(locale, 'books.orders.setFirst'))}</span> <a class="deeper" href="/app/books#accounts">${esc(t(locale, 'books.accounts.title'))}</a></p>` : ''}
    ${accountsSet && c.parties.length === 0 ? `<p role="status"><span class="pill warn long">${esc(t(locale, 'books.orders.addCustomers'))}</span> <a class="deeper" href="/app/books/invoices/new#customer">${esc(t(locale, 'books.invoice.addCustomer'))}</a></p>` : ''}
    ${orders.length === 0 ? `<p class="muted">${esc(t(locale, 'books.orders.none'))}</p>` : `${tableFrame(locale, t(locale, 'books.orders.title'), 'bk-orders bk-cards')}<table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.date'))}</th><th scope="col">${esc(t(locale, 'books.entry.document'))}</th>
        <th scope="col">${esc(t(locale, 'books.orders.buyer'))}</th><th scope="col" class="num">${esc(t(locale, 'books.entry.total'))}</th><th scope="col">${esc(t(locale, 'books.orders.draft'))}</th></tr></thead>
      <tbody>${orders.map((o) => `<tr><td class="bk-date"${cellLabel(locale, 'books.entry.date')}><span>${esc(show.isolate(locale, show.dateYear(locale, new Date(`${o.confirmedOn}T12:00:00Z`))))}</span></td><td class="bk-key"${cellLabel(locale, 'books.entry.document')}><bdi>${esc(o.reference)}</bdi></td>
        <td class="bk-text"${cellLabel(locale, 'books.orders.buyer')}>${o.buyer ? `<bdi>${esc(o.buyer)}</bdi>` : ''}</td><td class="num"${cellLabel(locale, 'books.entry.total')}><span>${amount(locale, o.total as Decimal, o.currency)}</span></td>
        <td class="bk-act">${ready ? choose(o) : ''}</td></tr>`).join('')}</tbody>
    </table></div>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}
