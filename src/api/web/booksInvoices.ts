import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { addDecimal, signOf, subDecimal, type Decimal } from '../../core/types/decimal.js';
import { CURRENCIES, moneyFromRow } from '../../core/types/money.js';
import type { BilledTo, InvoiceRow, InvoiceStatus, InvoiceView } from '../../db/booksInvoices.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * C2 (Phase 5, item 5) — INVOICES ON THE PAGE: the list with each one's standing, one invoice with its lines, its
 * payments and what is still owed, and a new one. Issuing, discarding and recording a payment are the owner's; the
 * accountant sees all of it. An issued invoice offers no edit: what it says is what was issued.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const mayPost = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const money = (locale: Locale, d: Decimal, currency: string) => { const m = moneyFromRow(d, currency); return m ? esc(show.money(locale, m)) : esc(d); };
const day = (locale: Locale, iso: string) => esc(show.dateYear(locale, new Date(`${iso}T12:00:00Z`)));
const PILL: Record<InvoiceStatus, string> = { draft: 'warn', open: '', partly_paid: 'warn', paid: 'ok', overdue: 'bad', discarded: '' };
const status = (locale: Locale, s: InvoiceStatus) => `<span class="pill ${PILL[s]}">${esc(t(locale, `books.invoice.status.${s}` as MessageKey))}</span>`;

export function renderInvoices(locale: Locale, viewer: Who, rows: readonly InvoiceRow[]): string {
  return `<h1 class="page">${esc(t(locale, 'books.invoices.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.invoices.lede'))}</p>
    ${mayPost(viewer) ? `<p><a class="deeper" href="/app/books/invoices/new">${esc(t(locale, 'books.invoices.new'))}</a></p>` : ''}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.invoices.none'))}</p>` : `<div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.number'))}</th><th scope="col">${esc(t(locale, 'books.invoice.customer'))}</th>
        <th scope="col">${esc(t(locale, 'books.entry.date'))}</th><th scope="col">${esc(t(locale, 'books.invoice.due'))}</th>
        <th scope="col">${esc(t(locale, 'books.entry.total'))}</th><th scope="col">${esc(t(locale, 'books.invoice.owed'))}</th><th scope="col"></th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><a href="/app/books/invoices/${esc(r.id)}"><bdi>${esc(r.key ?? t(locale, 'books.entry.state.draft'))}</bdi></a></td>
        <td><bdi>${esc(r.party)}</bdi></td><td>${day(locale, r.issueDate)}</td><td>${r.dueDate ? day(locale, r.dueDate) : ''}</td>
        <td>${money(locale, r.total, r.currency)}</td><td>${r.status === 'draft' ? '' : money(locale, subDecimal(r.total, r.paid), r.currency)}</td>
        <td>${status(locale, r.status)}</td></tr>`).join('')}</tbody>
    </table></div>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

export type PaymentChoices = {
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
};

/** D0 (0187) — who the invoice is to. Issued: the copy taken at issue, said as such; a draft: what will be copied. */
function billedTo(locale: Locale, b: BilledTo): string {
  const row = (label: MessageKey, value: string | null) => (value ? `<div class="row"><dt>${esc(t(locale, label))}</dt><dd><bdi>${esc(value)}</bdi></dd></div>` : '');
  return `<h2>${esc(t(locale, 'books.invoice.billedTo'))}</h2>
    <dl class="scard">${row('books.party.name', b.name)}${row('books.party.code', b.code)}${row('books.party.address', b.address)}${row('books.party.country', b.country)}${
      row('books.party.ice', b.ice)}${row('books.party.taxNumber', b.taxNumber)}</dl>
    <p class="caption muted">${esc(t(locale, b.asIssued ? 'books.invoice.partyAtIssue' : 'books.invoice.partyTaken'))}</p>`;
}

export function renderInvoice(locale: Locale, viewer: Who, v: InvoiceView, pay: PaymentChoices, today: string): string {
  const net = v.lines.reduce((s, l) => addDecimal(s, l.net), '0' as Decimal);
  const tax = v.lines.reduce((s, l) => addDecimal(s, l.tax), '0' as Decimal);
  const owed = subDecimal(v.total, v.paid);
  const pick = (name: string, rows: readonly { id: string; code: string; name: string }[]) =>
    `<select name="${name}" required>${rows.map((r) => `<option value="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  const actions = !mayPost(viewer) ? '' : v.status === 'draft' ? `
      <form method="post" action="/app/books/invoices/${esc(v.id)}/issue" class="pform">
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.invoice.issueAsk'))}">${esc(t(locale, 'books.invoice.issue'))}</button></form>
      <form method="post" action="/app/books/invoices/${esc(v.id)}/discard" class="pform">
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.invoice.discardAsk'))}">${esc(t(locale, 'books.entry.discard'))}</button></form>`
    : signOf(owed) > 0 ? `<div class="block" id="pay">
      <h2>${esc(t(locale, 'books.invoice.recordPayment'))}</h2>
      <form method="post" action="/app/books/invoices/${esc(v.id)}/payments" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.invoice.paidOn'))}</span><input type="date" name="paidOn" value="${esc(today)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.amount', { currency: v.currency }))}</span><input name="amount" inputmode="decimal" value="${esc(owed)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span>${pick('journal', pay.journals)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.bank'))}</span>${pick('account', pay.accounts)}</label>
        <button class="btn" type="submit">${esc(t(locale, 'books.invoice.record'))}</button>
      </form></div>` : '';
  return `<h1 class="page"><bdi>${esc(v.key ?? t(locale, 'books.entry.state.draft'))}</bdi> · <bdi>${esc(v.party)}</bdi></h1>
    <p>${status(locale, v.status)}${v.entryId ? ` <a href="/app/books/entries/${esc(v.entryId)}">${esc(t(locale, 'books.invoice.seeEntry'))}</a>` : ''}</p>
    ${billedTo(locale, v.billedTo)}
    <p class="caption muted">${esc(t(locale, 'books.entry.date'))}: ${day(locale, v.issueDate)}${v.dueDate ? ` · ${esc(t(locale, 'books.invoice.due'))}: ${day(locale, v.dueDate)}` : ''}${
      v.label ? ` · <bdi>${esc(v.label)}</bdi>` : ''}</p>
    <div class="imp-table"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.invoice.quantity'))}</th>
        <th scope="col">${esc(t(locale, 'books.invoice.unitPrice'))}</th><th scope="col">${esc(t(locale, 'books.entry.tax'))}</th>
        <th scope="col">${esc(t(locale, 'books.invoice.net'))}</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr><td><bdi>${esc(l.label)}</bdi></td><td>${esc(l.quantity)}</td><td>${esc(l.unitPrice)}</td>
        <td>${l.taxCode ? `<bdi>${esc(l.taxCode)}</bdi> ${money(locale, l.tax, v.currency)}` : ''}</td><td>${money(locale, l.net, v.currency)}</td></tr>`).join('')}</tbody>
    </table></div>
    <dl class="scard"><div class="row"><dt>${esc(t(locale, 'books.invoice.net'))}</dt><dd>${money(locale, net, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, 'books.entry.tax'))}</dt><dd>${money(locale, tax, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, 'books.entry.total'))}</dt><dd><strong>${money(locale, v.total, v.currency)}</strong></dd></div>
      ${v.status === 'draft' ? '' : `<div class="row"><dt>${esc(t(locale, 'books.invoice.paid'))}</dt><dd>${money(locale, v.paid, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, 'books.invoice.owed'))}</dt><dd>${money(locale, owed, v.currency)}</dd></div>`}</dl>
    ${v.payments.length > 0 ? `<h2>${esc(t(locale, 'books.invoice.payments'))}</h2><ul class="rows">${v.payments.map((p) =>
      `<li class="row"><span>${day(locale, p.paidOn)} · <bdi>${esc(p.account)}</bdi></span><span>${money(locale, p.amount, v.currency)} <a href="/app/books/entries/${esc(p.entryId)}">${esc(t(locale, 'books.invoice.seeEntry'))}</a></span></li>`).join('')}</ul>` : ''}
    ${actions}
    <p><a class="deeper" href="/app/books/invoices">${esc(t(locale, 'books.invoices.title'))}</a></p>`;
}

export type InvoiceChoices = {
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string }[];
  readonly bookCurrency: string;
  readonly salesAccountId: string | null;
};
export const INVOICE_FORM_LINES = 5;

export function renderNewInvoice(locale: Locale, c: InvoiceChoices, values: Readonly<Record<string, string>>, problems: readonly string[], today: string): string {
  const v = (k: string) => esc(values[k] ?? '');
  const options = (rows: readonly { id: string; code: string; name?: string; label?: string }[], name: string, blank: boolean, fallback?: string | null) =>
    `${blank ? '<option value=""></option>' : ''}${rows.map((r) => `<option value="${esc(r.id)}"${(values[name] ?? fallback) === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name ?? r.label ?? '')}</option>`).join('')}`;
  const line = (i: number) => `<tr>
      <td><input name="label${i}" value="${v(`label${i}`)}" maxlength="200" aria-label="${esc(t(locale, 'books.entry.label'))} ${i + 1}" /></td>
      <td><input name="quantity${i}" inputmode="decimal" value="${v(`quantity${i}`)}" aria-label="${esc(t(locale, 'books.invoice.quantity'))} ${i + 1}" /></td>
      <td><input name="price${i}" inputmode="decimal" value="${v(`price${i}`)}" aria-label="${esc(t(locale, 'books.invoice.unitPrice'))} ${i + 1}" /></td>
      <td><select name="tax${i}" aria-label="${esc(t(locale, 'books.entry.tax'))} ${i + 1}">${options(c.taxCodes, `tax${i}`, true)}</select></td>
      <td><select name="account${i}" aria-label="${esc(t(locale, 'books.entry.account'))} ${i + 1}">${options(c.accounts, `account${i}`, false, c.salesAccountId)}</select></td></tr>`;
  return `<h1 class="page">${esc(t(locale, 'books.invoices.new'))}</h1>
    <p class="lede">${esc(t(locale, 'books.invoice.newLede'))}</p>
    ${problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    ${c.parties.length === 0 ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.invoice.noCustomer'))}</span></p>` : ''}
    <form method="post" action="/app/books/invoices" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.invoice.customer'))}</span><select name="party" required>${options(c.parties, 'party', false)}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.date'))}</span><input type="date" name="issueDate" value="${values['issueDate'] ? v('issueDate') : esc(today)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.invoice.due'))}</span><input type="date" name="dueDate" value="${v('dueDate')}" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.currency'))}</span><select name="currency">${CURRENCIES.map((cur) => `<option${(values['currency'] ?? c.bookCurrency) === cur ? ' selected' : ''}>${cur}</option>`).join('')}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.label'))}</span><input name="label" value="${v('label')}" maxlength="200" /></label>
      <div class="imp-table"><table>
        <thead><tr><th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.invoice.quantity'))}</th>
          <th scope="col">${esc(t(locale, 'books.invoice.unitPrice'))}</th><th scope="col">${esc(t(locale, 'books.entry.tax'))}</th><th scope="col">${esc(t(locale, 'books.entry.account'))}</th></tr></thead>
        <tbody>${Array.from({ length: INVOICE_FORM_LINES }, (_, i) => line(i)).join('')}</tbody>
      </table></div>
      <button class="btn" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button>
    </form>
    <div class="block" id="customer">
      <h2>${esc(t(locale, 'books.invoice.addCustomer'))}</h2>
      <form method="post" action="/app/books/parties" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.party.code'))}</span><input name="code" required maxlength="20" pattern="[0-9A-Za-z][0-9A-Za-z.\\-]{0,19}" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.name'))}</span><input name="name" required maxlength="200" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.country'))}</span><input name="country" maxlength="2" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.ice'))}</span><input name="ice" inputmode="numeric" maxlength="15" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.taxNumber'))}</span><input name="taxNumber" maxlength="40" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.address'))}</span><textarea name="address" maxlength="400" rows="3"></textarea></label>
        <button class="btn ghost" type="submit">${esc(t(locale, 'books.invoice.addCustomer'))}</button>
      </form>
    </div>`;
}

/**
 * C3 (Phase 5, item 4) — RECONCILIATION ON THE PAGE: a bank account, its statement read in from a file, each line
 * not matched yet with what the rule suggests, and each match a person made — with the way to undo it.
 */
export function renderBank(locale: Locale, viewer: Who, c: {
  readonly accounts: readonly { id: string; code: string; name: string }[]; readonly accountId: string | null;
  readonly open: readonly import('../../db/bankStatements.js').OpenLine[]; readonly matched: readonly import('../../db/bankStatements.js').MatchedLine[];
}): string {
  const owner = mayPost(viewer);
  const choose = `<form method="get" action="/app/books/bank" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.bank.account'))}</span><select name="account">${c.accounts.map((a) =>
        `<option value="${esc(a.id)}"${a.id === c.accountId ? ' selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
      <button class="btn ghost" type="submit">${esc(t(locale, 'books.bank.show'))}</button></form>`;
  if (!c.accountId) return `<h1 class="page">${esc(t(locale, 'books.bank.title'))}</h1><p class="lede">${esc(t(locale, 'books.bank.lede'))}</p>${choose}`;
  const upload = owner ? `<form method="post" action="/app/books/bank/import?account=${esc(c.accountId)}" enctype="multipart/form-data" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.bank.file'))}</span><input type="file" name="statement" accept=".csv,.ofx,.qfx,.xml,text/csv,application/xml" required /></label>
      <button class="btn" type="submit">${esc(t(locale, 'books.bank.read'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.bank.formats'))}</p>` : '';
  const line = (l: { bookedOn: string; amount: Decimal; currency: string; wording: string | null; reference: string | null }) =>
    `${day(locale, l.bookedOn)} · ${money(locale, l.amount, l.currency)}${l.wording ? ` · <bdi>${esc(l.wording)}</bdi>` : ''}`;
  return `<h1 class="page">${esc(t(locale, 'books.bank.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.bank.lede'))}</p>
    ${choose}${upload}
    <h2>${esc(t(locale, 'books.bank.open'))}</h2>
    ${c.open.length === 0 ? `<p class="muted">${esc(t(locale, 'books.bank.noneOpen'))}</p>` : `<ul class="rows">${c.open.map((l) => `<li class="row"><span>${line(l)}</span>
      <span>${l.suggestions.length === 0 ? `<span class="caption muted">${esc(t(locale, 'books.bank.noSuggestion'))}</span>` : l.suggestions.map((s) => owner
        ? `<form method="post" action="/app/books/bank/match" class="pform"><input type="hidden" name="account" value="${esc(c.accountId!)}" />
            <input type="hidden" name="line" value="${esc(l.id)}" /><input type="hidden" name="journalLine" value="${esc(s.journalLineId)}" />
            <button class="btn ghost" type="submit">${esc(t(locale, 'books.bank.matchWith', { key: s.key }))}</button> <span class="caption muted"><bdi>${esc(s.label)}</bdi></span></form>`
        : `<span class="caption muted">${esc(t(locale, 'books.bank.suggested', { key: s.key }))}</span>`).join('')}</span></li>`).join('')}</ul>`}
    <h2>${esc(t(locale, 'books.bank.matched'))}</h2>
    ${c.matched.length === 0 ? `<p class="muted">${esc(t(locale, 'books.bank.noneMatched'))}</p>` : `<ul class="rows">${c.matched.map((m) => `<li class="row"><span>${line(m)} ·
      <a href="/app/books/entries/${esc(m.entryId)}"><bdi>${esc(m.key)}</bdi></a></span>${owner ? `<form method="post" action="/app/books/bank/unmatch" class="pform">
        <input type="hidden" name="account" value="${esc(c.accountId!)}" /><input type="hidden" name="match" value="${esc(m.matchId)}" />
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.bank.unmatchAsk'))}">${esc(t(locale, 'books.bank.unmatch'))}</button></form>` : ''}</li>`).join('')}</ul>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}
