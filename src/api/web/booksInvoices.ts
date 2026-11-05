import {booksDay} from './booksOverview.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { addDecimal, compareDecimal, signOf, subDecimal, type Decimal } from '../../core/types/decimal.js';
import { CURRENCIES, moneyFromRow } from '../../core/types/money.js';
import { owedOn, type BilledTo, type InvoiceRow, type InvoiceStatus, type InvoiceView } from '../../db/booksInvoices.js';
import type { CreditableLine, CreditNoteView } from '../../db/booksCreditNotes.js';
import { customInputs } from './booksFields.js';
import { formLines } from './booksEntries.js';
import { DATE_FORMATS, type LayoutGuess } from '../../core/books/statements.js';
import { registryLabelKey } from '../../core/books/registry.js';
import { t } from './say.js';
import { esc, back } from './layout.js';
import type { BusinessProfile } from './settings.js';
import * as show from './values.js';

/**
 * C2 (Phase 5, item 5) — INVOICES ON THE PAGE: the list with each one's standing, one invoice with its lines, its
 * payments and what is still owed, and a new one. Issuing, discarding and recording a payment are the owner's; the
 * accountant sees all of it. An issued invoice offers no edit: what it says is what was issued.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const mayPost = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const plainMoney = (locale: Locale, d: Decimal, currency: string): string => { const m = moneyFromRow(d, currency); return m ? show.money(locale, m) : d; };
const money = (locale: Locale, d: Decimal, currency: string) => esc(plainMoney(locale, d, currency));
const day = (locale: Locale, iso: string) => esc(booksDay(locale,iso));
const PILL: Record<InvoiceStatus, string> = { draft: 'warn', open: '', partly_paid: 'warn', paid: 'ok', overdue: 'bad', credited: 'muted', refund_due: 'warn', discarded: '' };
const status = (locale: Locale, s: InvoiceStatus) => `<span class="pill ${PILL[s]}">${esc(t(locale, `books.invoice.status.${s}` as MessageKey))}</span>`;

export type BooksDocumentContext = {
  readonly issuer?: Pick<BusinessProfile, 'name' | 'postalAddress' | 'contactEmail' | 'contactPhone' | 'identifiers'>;
  readonly returnHref?: string;
};
export type InvoiceListOptions = {
  readonly q?: string; readonly state?: string; readonly returnHref?: string;
  readonly page?: { readonly from: number; readonly to: number; readonly total: number; readonly next: string | null; readonly prev: string | null };
};
const INVOICE_FILTERS = ['all', 'draft', 'unpaid', 'overdue', 'paid', 'refund_due'] as const;
/** Only a bounded local list URL can be carried through a document action. */
export function invoiceReturnHref(raw: string | undefined): string {
  if (!raw || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//')) return '/app/books/invoices';
  try {
    const url = new URL(raw, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || url.pathname !== '/app/books/invoices') return '/app/books/invoices';
    const query = new URLSearchParams();
    const q = url.searchParams.get('q')?.trim().slice(0, 200); if (q) query.set('q', q);
    const state = url.searchParams.get('state'); if (state && INVOICE_FILTERS.some(s => s === state) && state !== 'all') query.set('state', state);
    const page = Number(url.searchParams.get('page')); if (Number.isSafeInteger(page) && page > 1) query.set('page', String(page));
    const hash = /^#invoice-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.hash) ? url.hash : '';
    return url.pathname + (query.size ? '?' + query : '') + hash;
  } catch { return '/app/books/invoices'; }
}
const documentReturnField = (opts: BooksDocumentContext): string => opts.returnHref ? `<input type="hidden" name="from" value="${esc(invoiceReturnHref(opts.returnHref))}">` : '';
const documentReturnQuery = (opts: BooksDocumentContext): string => opts.returnHref ? '?from=' + encodeURIComponent(invoiceReturnHref(opts.returnHref)) : '';
const invoiceStateLabel = (locale: Locale, state: typeof INVOICE_FILTERS[number]): string =>
  t(locale, state === 'all' ? 'booksDocs.all' : state === 'unpaid' ? 'booksDocs.unpaid' : `books.invoice.status.${state}`);

export function renderInvoices(locale: Locale, viewer: Who, rows: readonly InvoiceRow[], opts: InvoiceListOptions = {}): string {
  const query = new URLSearchParams(); if(opts.q) query.set('q',opts.q); if(opts.state) query.set('state',opts.state);
  const source = invoiceReturnHref(opts.returnHref ?? '/app/books/invoices' + (query.size ? '?' + query : '')).split('#')[0]!;
  const page = opts.page;
  const filters = page || opts.q || opts.state ? `<form method="get" action="/app/books/invoices" class="bd-filters"><label>${esc(t(locale,'booksDocs.search'))}<input type="search" name="q" value="${esc(opts.q ?? '')}" placeholder="${esc(t(locale,'booksDocs.searchHint'))}"></label><label>${esc(t(locale,'booksDocs.state'))}<select name="state">${INVOICE_FILTERS.map(state=>`<option value="${state}"${state===(opts.state??'all')?' selected':''}>${esc(invoiceStateLabel(locale,state))}</option>`).join('')}</select></label><button class="btn" type="submit">${esc(t(locale,'booksDocs.show'))}</button>${opts.q || opts.state && opts.state !== 'all' ? `<a href="/app/books/invoices">${esc(t(locale,'booksDocs.clear'))}</a>` : ''}</form>` : '';
  const pager = page ? `<nav class="bd-pager" aria-label="${esc(t(locale,'booksDocs.pages'))}">${page.prev?`<a href="${esc(invoiceReturnHref(page.prev))}">${esc(t(locale,'booksDocs.previous'))}</a>`:'<span></span>'}<span>${esc(t(locale,'booksDocs.range',{from:show.count(locale,page.from),to:show.count(locale,page.to),total:show.count(locale,page.total)}))}</span>${page.next?`<a href="${esc(invoiceReturnHref(page.next))}">${esc(t(locale,'booksDocs.next'))}</a>`:'<span></span>'}</nav>` : '';
  return `<section class="books-invoices"><h1 class="page">${esc(t(locale, 'books.invoices.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.invoices.lede'))}</p>
    ${mayPost(viewer) ? `<p><a class="deeper" href="/app/books/invoices/new">${esc(t(locale, 'books.invoices.new'))}</a></p>` : ''}${filters}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale,opts.q || opts.state && opts.state !== 'all' ? 'booksDocs.noMatch' : 'books.invoices.none'))}</p>` : `<ul class="bd-invoices">${rows.map(r=>{
      const outstanding=owedOn(r.total,r.credited,r.paid);
      const issued=r.status!=='draft'&&r.status!=='discarded';
      const refund=issued&&signOf(outstanding)<0;
      const href='/app/books/invoices/'+encodeURIComponent(r.id)+(page||opts.returnHref?'?from='+encodeURIComponent(source+'#invoice-'+r.id):'');
      return `<li class="bd-invoice-row" id="invoice-${esc(r.id)}"><div class="bd-invoice-name"><a href="${esc(href)}"><bdi>${esc(r.key ?? t(locale,'books.entry.state.draft'))}</bdi></a><bdi>${esc(r.party)}</bdi>${status(locale,r.status)}</div><dl class="bd-invoice-facts"><div><dt>${esc(t(locale,'books.entry.date'))}</dt><dd>${day(locale,r.issueDate)}</dd></div><div><dt>${esc(t(locale,'books.invoice.due'))}</dt><dd>${r.dueDate?day(locale,r.dueDate):esc(t(locale,'booksDocs.noDue'))}</dd></div><div><dt>${esc(t(locale,'books.entry.total'))}</dt><dd><bdi>${money(locale,r.total,r.currency)}</bdi></dd></div><div><dt>${esc(t(locale,refund?'books.invoice.status.refund_due':'books.invoice.owed'))}</dt><dd><bdi>${issued?money(locale,refund?subDecimal('0' as Decimal,outstanding):outstanding,r.currency):esc(t(locale,'booksDocs.notIssued'))}</bdi></dd></div></dl></li>`;
    }).join('')}</ul>`}${pager}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p></section>`;
}

export type PaymentChoices = {
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
};

/** D0 (0187) — who the invoice is to. Issued: the copy taken at issue, said as such; a draft: what will be copied. */
function billedTo(locale: Locale, b: BilledTo): string {
  const row = (label: MessageKey, value: string | null) => (value ? `<div class="row"><dt>${esc(t(locale, label))}</dt><dd><bdi>${esc(value)}</bdi></dd></div>` : '');
  return `<h2>${esc(t(locale, 'books.invoice.billedTo'))}</h2>
    <dl class="bd-address">${row('books.party.name', b.name)}${row('books.party.code', b.code)}${row('books.party.address', b.address)}${row('books.party.country', b.country)}${
      row('books.party.ice', b.ice)}${row('books.party.taxNumber', b.taxNumber)}${
      row(registryLabelKey(b.country), b.registry)}${row('books.party.siret', b.siret)}${row('books.party.registro', b.registro)}</dl>
    <p class="caption muted">${esc(t(locale, b.asIssued ? 'books.invoice.partyAtIssue' : 'books.invoice.partyTaken'))}</p>`;
}

function issuerDetails(locale: Locale, issuer: BooksDocumentContext['issuer'], issued: boolean): string {
  const identifiers: readonly [MessageKey, string | null | undefined][] = [
    ['settings.ids.ice',issuer?.identifiers?.ice], ['settings.ids.if',issuer?.identifiers?.taxId],
    ['settings.ids.rc',issuer?.identifiers?.rc], ['settings.ids.rcCourt',issuer?.identifiers?.rcCourt],
  ];
  return `<section class="bd-issuer"><h2>${esc(t(locale,'booksDocs.issuer'))}</h2>${issuer?`<p><strong><bdi>${esc(issuer.name)}</bdi></strong></p>${issuer.postalAddress?`<p class="bd-address-text">${esc(issuer.postalAddress)}</p>`:''}${issuer.contactEmail?`<p><bdi>${esc(issuer.contactEmail)}</bdi></p>`:''}${issuer.contactPhone?`<p><bdi>${esc(issuer.contactPhone)}</bdi></p>`:''}<dl class="bd-address">${identifiers.filter(([,value])=>!!value).map(([key,value])=>`<div class="row"><dt>${esc(t(locale,key))}</dt><dd><bdi>${esc(value!)}</bdi></dd></div>`).join('')}</dl><p class="caption muted">${esc(t(locale,issued?'booksDocs.currentIssuer':'booksDocs.currentIssuerDraft'))}</p>`:`<p>${esc(t(locale,'booksDocs.issuerMissing'))}</p>`}</section>`;
}

export function renderInvoice(locale: Locale, viewer: Who, v: InvoiceView, pay: PaymentChoices, today: string, opts: BooksDocumentContext = {}): string {
  const net = v.lines.reduce((s, l) => addDecimal(s, l.net), '0' as Decimal);
  const tax = v.lines.reduce((s, l) => addDecimal(s, l.tax), '0' as Decimal);
  const owed = owedOn(v.total, v.credited, v.paid);
  const pick = (name: string, rows: readonly { id: string; code: string; name: string }[]) =>
    `<select name="${name}" required>${rows.map((r) => `<option value="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  // The account is the owner's to name each time: nothing is selected, so a form pressed as drawn records nothing.
  const bankAccount = `<select name="account" required><option value="" selected>${esc(t(locale, 'books.invoice.bankChoose'))}</option>${pay.accounts.map((r) =>
    `<option value="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  const noBank = `<p>${esc(t(locale, 'books.invoice.noBank'))}</p><p><a class="deeper" href="/app/books#workbook">${esc(t(locale, 'books.workbook.title'))}</a></p>`;
  // 0216 (c) — paid in another currency: which, and how much of it; the amount above is what it settles.
  const across = `
        <label class="pq"><span>${esc(t(locale, 'books.invoice.paidIn'))}</span><select name="paidIn">${CURRENCIES.map((c) =>
          `<option value="${c}"${c === v.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.arrivedAmount'))}</span><input name="arrived" inputmode="decimal" /></label>
        <p class="caption muted">${esc(t(locale, 'books.invoice.acrossHelp', { currency: v.currency }))}</p>`;
  const actions = !mayPost(viewer) ? '' : v.status === 'draft' ? `
      <p><a class="deeper" href="/app/books/invoices/${esc(v.id)}/edit${documentReturnQuery(opts)}">${esc(t(locale, 'books.draft.edit'))}</a></p>
      <form method="post" action="/app/books/invoices/${esc(v.id)}/issue" class="pform">${documentReturnField(opts)}
        <button class="btn send" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.invoice.issueAsk'))}">${esc(t(locale, 'books.invoice.issue'))}</button></form>
      <form method="post" action="/app/books/invoices/${esc(v.id)}/discard" class="pform">${documentReturnField(opts)}
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.invoice.discardAsk'))}">${esc(t(locale, 'books.entry.discard'))}</button></form>`
    : v.status === 'discarded' ? '' : signOf(owed) > 0 ? `<div class="block" id="pay">
      <h2>${esc(t(locale, 'books.invoice.recordPayment'))}</h2>
      ${pay.accounts.length === 0 ? noBank : `<form method="post" action="/app/books/invoices/${esc(v.id)}/payments" class="pform">${documentReturnField(opts)}
        <label class="pq"><span>${esc(t(locale, 'books.invoice.paidOn'))}</span><input type="date" name="paidOn" value="${esc(today)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.amount', { currency: v.currency }))}</span><input name="amount" inputmode="decimal" value="${esc(owed)}" required /></label>${across}
        <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span>${pick('journal', pay.journals)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.bank'))}</span>${bankAccount}</label>
        <button class="btn send" type="submit">${esc(t(locale, 'books.invoice.record'))}</button>
      </form>`}</div>` : signOf(owed) < 0 ? `<div class="block" id="refund">
      <h2>${esc(t(locale, 'books.credit.refund'))}</h2>
      <p>${esc(t(locale, 'books.credit.refundExplain'))}</p>
      ${pay.accounts.length === 0 ? noBank : `<form method="post" action="/app/books/invoices/${esc(v.id)}/refunds" class="pform">${documentReturnField(opts)}
        <label class="pq"><span>${esc(t(locale, 'books.invoice.paidOn'))}</span><input type="date" name="paidOn" value="${esc(today)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.amount', { currency: v.currency }))}</span><input name="amount" inputmode="decimal" value="${esc(subDecimal('0' as Decimal, owed))}" required /></label>${across}
        <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span>${pick('journal', pay.journals)}</label>
        <label class="pq"><span>${esc(t(locale, 'books.invoice.bank'))}</span>${bankAccount}</label>
        <button class="btn send" type="submit">${esc(t(locale, 'books.credit.recordRefund'))}</button>
      </form>`}</div>` : '';
  const creditDoor = mayPost(viewer) && v.status !== 'draft' && v.status !== 'discarded' && compareDecimal(v.credited, v.total) < 0
    ? `<p><a class="deeper" href="/app/books/invoices/${esc(v.id)}/credit-notes/new${documentReturnQuery(opts)}">${esc(t(locale, 'books.credit.make'))}</a></p>` : '';
  const notes = v.creditNotes.length === 0 ? '' : `<h2>${esc(t(locale, 'books.credit.title'))}</h2><ul class="rows">${v.creditNotes.map((c) =>
    `<li class="row"><span><a href="/app/books/credit-notes/${esc(c.id)}${documentReturnQuery(opts)}"><bdi>${esc(c.key ?? t(locale, 'books.entry.state.draft'))}</bdi></a> · ${day(locale, c.issueDate)}</span><span>${money(locale, c.total, v.currency)}</span></li>`).join('')}</ul>`;
  return `<section class="book-doc-page"><div class="bd-outside">${back(esc(invoiceReturnHref(opts.returnHref)),t(locale,'books.invoices.title'))}</div><article class="book-document"><header class="bd-header"><h1 class="page">${esc(t(locale,'booksDocs.invoice'))} <bdi>${esc(v.key ?? t(locale, 'books.entry.state.draft'))}</bdi></h1><p><bdi>${esc(v.party)}</bdi></p>
    <p>${status(locale, v.status)}</p></header><div class="bd-parties">${issuerDetails(locale,opts.issuer,v.status!=='draft'&&v.status!=='discarded')}<section>${billedTo(locale, v.billedTo)}</section></div>
    <p class="caption muted">${esc(t(locale, 'books.entry.date'))}: ${day(locale, v.issueDate)}${v.dueDate ? ` · ${esc(t(locale, 'books.invoice.due'))}: ${day(locale, v.dueDate)}` : ''}${
      v.label ? ` · <bdi>${esc(v.label)}</bdi>` : ''}</p>
    <p class="bd-currency">${esc(t(locale,'booksDocs.currency',{currency:v.currency}))}</p><div class="bd-lines"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.invoice.quantity'))}</th>
        <th scope="col">${esc(t(locale, 'books.invoice.unitPrice'))}</th><th scope="col">${esc(t(locale, 'booksDocs.tax'))}</th>
        <th scope="col">${esc(t(locale, 'booksDocs.subtotal'))}</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr><td data-label="${esc(t(locale, 'books.entry.label'))}"><bdi>${esc(l.label)}</bdi></td><td data-label="${esc(t(locale, 'books.invoice.quantity'))}">${esc(l.quantity)}</td><td data-label="${esc(t(locale, 'books.invoice.unitPrice'))}">${esc(l.unitPrice)}</td>
        <td data-label="${esc(t(locale, 'booksDocs.tax'))}"><span>${l.taxCode ? `<bdi>${esc(l.taxCode)}</bdi> ${money(locale, l.tax, v.currency)}` : ''}</span></td><td data-label="${esc(t(locale, 'booksDocs.subtotal'))}">${money(locale, l.net, v.currency)}</td></tr>`).join('')}</tbody>
    </table></div>
    <dl class="bd-totals"><div class="row"><dt>${esc(t(locale, 'booksDocs.subtotal'))}</dt><dd>${money(locale, net, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, 'booksDocs.tax'))}</dt><dd>${money(locale, tax, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, 'books.entry.total'))}</dt><dd><strong>${money(locale, v.total, v.currency)}</strong></dd></div>
      ${v.status === 'draft' || v.status === 'discarded' ? '' : `${signOf(v.credited) > 0 ? `<div class="row"><dt>${esc(t(locale, 'books.credit.credited'))}</dt><dd>${money(locale, v.credited, v.currency)}</dd></div>` : ''}
      <div class="row"><dt>${esc(t(locale, 'books.invoice.paid'))}</dt><dd>${money(locale, v.paid, v.currency)}</dd></div>
      <div class="row"><dt>${esc(t(locale, signOf(owed)<0?'books.invoice.status.refund_due':'books.invoice.owed'))}</dt><dd>${money(locale, signOf(owed)<0?subDecimal('0' as Decimal,owed):owed, v.currency)}</dd></div>`}</dl>
    </article><div class="bd-outside">${v.entryId ? `<p><a href="/app/books/advanced/entries/${esc(v.entryId)}">${esc(t(locale, 'books.invoice.seeEntry'))}</a></p>` : ''}
    ${v.payments.length > 0 ? `<h2>${esc(t(locale, 'books.invoice.payments'))}</h2><ul class="rows">${v.payments.map((p) =>
      `<li class="row"><span>${day(locale, p.paidOn)} · <bdi>${esc(p.account)}</bdi>${p.refund ? ` · ${esc(t(locale, 'books.credit.refunded'))}` : ''}</span><span>${money(locale, p.amount, v.currency)}${p.paid ? ` · ${esc(t(locale, 'books.invoice.arrived', { amount: plainMoney(locale, p.paid.amount, p.paid.currency) }))}` : ''} <a href="/app/books/advanced/entries/${esc(p.entryId)}">${esc(t(locale, 'books.invoice.seeEntry'))}</a></span></li>`).join('')}</ul>` : ''}
    ${notes}${creditDoor}
    ${actions ? `<section class="bd-actions"><h2>${esc(t(locale,'booksDocs.actions'))}</h2>${actions}</section>` : ''}
    <p><a class="deeper" href="${esc(invoiceReturnHref(opts.returnHref))}">${esc(t(locale, 'books.invoices.title'))}</a></p></div></section>`;
}

export type InvoiceChoices = {
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string }[];
  readonly bookCurrency: string;
  readonly salesAccountId: string | null;
  /** D7 — the custom fields in use (the party form asks for the parties'). */
  readonly fields?: readonly import('../../core/books/interchange.js').BooksField[];
};
/** D7 — a party's custom value's name in its form. */
export const PARTY_CUSTOM = 'cf_party_';
export const INVOICE_FORM_LINES = 5;

/** A new invoice, saved as a draft; 0216 (a) — or, with `editing`, a draft's own form, saving over it. */
export function renderNewInvoice(locale: Locale, c: InvoiceChoices, values: Readonly<Record<string, string>>, problems: readonly string[], today: string,
  editing: string | null = null, opts: BooksDocumentContext = {}): string {
  const v = (k: string) => esc(values[k] ?? '');
  const options = (rows: readonly { id: string; code: string; name?: string; label?: string }[], name: string, blank: boolean, fallback?: string | null) =>
    `${blank ? '<option value=""></option>' : ''}${rows.map((r) => `<option value="${esc(r.id)}"${(values[name] ?? fallback) === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name ?? r.label ?? '')}</option>`).join('')}`;
  const line = (i: number) => `<fieldset class="bd-edit-line"><legend>${esc(t(locale,'booksDocs.line',{n:i+1}))}</legend>
      <label class="pq bd-line-description"><span>${esc(t(locale,'books.entry.label'))}</span><input name="label${i}" value="${v(`label${i}`)}" maxlength="200" aria-label="${esc(t(locale,'books.entry.label'))} ${i+1}" /></label>
      <label class="pq"><span>${esc(t(locale,'books.invoice.quantity'))}</span><input name="quantity${i}" inputmode="decimal" value="${v(`quantity${i}`)}" aria-label="${esc(t(locale,'books.invoice.quantity'))} ${i+1}" /></label>
      <label class="pq"><span>${esc(t(locale,'books.invoice.unitPrice'))}</span><input name="price${i}" inputmode="decimal" value="${v(`price${i}`)}" aria-label="${esc(t(locale,'books.invoice.unitPrice'))} ${i+1}" /></label>
      <label class="pq"><span>${esc(t(locale,'books.entry.tax'))}</span><select name="tax${i}" aria-label="${esc(t(locale,'books.entry.tax'))} ${i+1}">${options(c.taxCodes,`tax${i}`,true)}</select></label>
      <label class="pq"><span>${esc(t(locale,'books.entry.account'))}</span><select name="account${i}" aria-label="${esc(t(locale,'books.entry.account'))} ${i+1}">${options(c.accounts,`account${i}`,false,c.salesAccountId)}</select></label></fieldset>`;
  return `<section class="book-doc-editor">${back(esc(invoiceReturnHref(opts.returnHref)),t(locale,'books.invoices.title'))}<h1 class="page">${esc(t(locale, editing ? 'books.draft.editTitle' : 'books.invoices.new'))}</h1>
    <p class="lede">${esc(t(locale, 'books.invoice.newLede'))}</p>
    ${problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    ${c.parties.length === 0 ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.invoice.noCustomer'))}</span></p>` : ''}
    <form method="post" action="${editing ? `/app/books/invoices/${esc(editing)}/edit` : '/app/books/invoices'}" class="pform bd-editor-form">${documentReturnField(opts)}
      <fieldset class="bd-header-fields"><legend>${esc(t(locale,'booksDocs.details'))}</legend><label class="pq"><span>${esc(t(locale, 'books.invoice.customer'))}</span><select name="party" required>${options(c.parties, 'party', false)}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.date'))}</span><input type="date" name="issueDate" value="${values['issueDate'] ? v('issueDate') : esc(today)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.invoice.due'))}</span><input type="date" name="dueDate" value="${v('dueDate')}" /></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.currency'))}</span><select name="currency">${CURRENCIES.map((cur) => `<option${(values['currency'] ?? c.bookCurrency) === cur ? ' selected' : ''}>${cur}</option>`).join('')}</select></label>
      <label class="pq"><span>${esc(t(locale, 'books.entry.label'))}</span><input name="label" value="${v('label')}" maxlength="200" /></label>
      </fieldset><section class="bd-edit-lines"><h2>${esc(t(locale,'booksDocs.lines'))}</h2>${Array.from({length:formLines(values,INVOICE_FORM_LINES,'label')},(_,i)=>line(i)).join('')}</section>
      <button class="btn send" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button>
    </form>
    <div class="block" id="customer">
      <h2>${esc(t(locale, 'books.invoice.addCustomer'))}</h2>
      <form method="post" action="/app/books/parties" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.party.code'))}</span><input name="code" required maxlength="20" pattern="[0-9A-Za-z][0-9A-Za-z.\\-]{0,19}" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.name'))}</span><input name="name" required maxlength="200" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.country'))}</span><input name="country" maxlength="2" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.ice'))}</span><input name="ice" maxlength="20" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.taxNumber'))}</span><input name="taxNumber" maxlength="40" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.registry'))}</span><input name="registry" maxlength="40" /></label>
        <p class="caption muted">${esc(t(locale, 'books.party.registryHelp'))}</p>
        <label class="pq"><span>${esc(t(locale, 'books.party.siret'))}</span><input name="siret" inputmode="numeric" maxlength="20" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.registro'))}</span><input name="registro" maxlength="200" /></label>
        <label class="pq"><span><input type="checkbox" name="registryConfirmed" value="1" /> ${esc(t(locale, 'books.party.registryConfirm'))}</span></label>
        <label class="pq"><span>${esc(t(locale, 'books.party.address'))}</span><textarea name="address" maxlength="400" rows="3"></textarea></label>
        ${customInputs(locale, c.fields ?? [], 'party', PARTY_CUSTOM, {})}
        <button class="btn" type="submit">${esc(t(locale, 'books.invoice.addCustomer'))}</button>
      </form>
    </div></section>`;
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
  const choose = `<form method="get" action="/app/books/bank" class="pform bb-account">
      <label class="pq"><span>${esc(t(locale, 'books.bank.account'))}</span><select name="account">${c.accounts.map((a) =>
        `<option value="${esc(a.id)}"${a.id === c.accountId ? ' selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></label>
      <button class="btn" type="submit">${esc(t(locale, 'books.bank.show'))}</button></form>`;
  const head=`<section class="books-bank"><h1 class="page">${esc(t(locale, 'books.bank.title'))}</h1><p class="lede">${esc(t(locale, 'books.bank.lede'))}</p>${choose}`;
  if (!c.accountId) return `${head}</section>`;
  const selected=c.accounts.find(a=>a.id===c.accountId);
  const upload = owner ? `<details class="bb-upload"${c.open.length+c.matched.length===0?' open':''}><summary>${esc(t(locale,'bankDocs.import'))}</summary><div id="read-statement"><form method="post" action="/app/books/bank/import?account=${esc(c.accountId)}" enctype="multipart/form-data" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.bank.file'))}</span><input type="file" name="statement" accept=".csv,.ofx,.qfx,.xml,text/csv,application/xml" required /></label>
      <button class="btn send" type="submit">${esc(t(locale, 'books.bank.read'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.bank.formats'))}</p></div></details>` : '';
  const line = (l: { bookedOn: string; amount: Decimal; currency: string; wording: string | null; reference: string | null }) =>
    `<div class="bb-statement"><p class="bb-wording"><bdi>${esc(l.wording??t(locale,'bankDocs.noDescription'))}</bdi></p><dl class="bb-facts"><div><dt>${esc(t(locale,'books.entry.date'))}</dt><dd>${day(locale,l.bookedOn)}</dd></div><div><dt>${esc(t(locale,'bankDocs.amount'))}</dt><dd class="bb-amount"><bdi>${money(locale,l.amount,l.currency)}</bdi></dd></div>${l.reference?`<div class="bb-reference"><dt>${esc(t(locale,'bankDocs.reference'))}</dt><dd><bdi>${esc(l.reference)}</bdi></dd></div>`:''}</dl></div>`;
  const suggestion=(l:import('../../db/bankStatements.js').OpenLine,s:import('../../db/bankStatements.js').Suggestion)=>
    `<div class="bb-suggestion"><p class="bb-suggested">${esc(t(locale,'books.bank.suggested',{key:s.key}))}</p><a href="/app/books/advanced/entries/${esc(s.entryId)}"><bdi>${esc(s.key)}</bdi></a><p>${day(locale,s.date)}${s.label?` · <bdi>${esc(s.label)}</bdi>`:''}</p>${owner?`<form method="post" action="/app/books/bank/match" class="pform"><input type="hidden" name="account" value="${esc(c.accountId!)}" /><input type="hidden" name="line" value="${esc(l.id)}" /><input type="hidden" name="journalLine" value="${esc(s.journalLineId)}" /><button class="btn" type="submit">${esc(t(locale,'books.bank.matchWith',{key:s.key}))}</button></form>`:''}</div>`;
  return `${head}${selected?`<p class="bb-scope">${esc(t(locale,'bankDocs.scope',{account:selected.code+' · '+selected.name}))}</p>`:''}${upload}
    <nav class="bb-sections" aria-label="${esc(t(locale,'bankDocs.review'))}"><a href="#bank-open">${esc(t(locale,c.open.length===1?'bankDocs.unmatchedOne':'bankDocs.unmatchedMany',{n:show.count(locale,c.open.length)}))}</a><a href="#bank-matched">${esc(t(locale,c.matched.length===1?'bankDocs.matchedOne':'bankDocs.matchedMany',{n:show.count(locale,c.matched.length)}))}</a></nav><p class="bb-scope">${esc(t(locale,'bankDocs.shownScope'))}</p>
    <section class="bb-review" id="bank-open"><h2>${esc(t(locale, 'books.bank.open'))}</h2>
    ${c.open.length === 0 ? `<p class="muted">${esc(t(locale, 'books.bank.noneOpen'))}</p>` : `<ul class="bb-lines">${c.open.map(l=>`<li class="bb-review-line" id="bank-line-${esc(l.id)}">${line(l)}<div class="bb-line-actions">${l.suggestions.length===0?`<p class="muted">${esc(t(locale,'books.bank.noSuggestion'))}</p>`:l.suggestions.map(s=>suggestion(l,s)).join('')}</div></li>`).join('')}</ul>`}</section>
    <section class="bb-review" id="bank-matched"><h2>${esc(t(locale, 'books.bank.matched'))}</h2>
    ${c.matched.length === 0 ? `<p class="muted">${esc(t(locale, 'books.bank.noneMatched'))}</p>` : `<ul class="bb-lines">${c.matched.map(m=>`<li class="bb-review-line is-matched">${line(m)}<div class="bb-line-actions"><p><span class="pill ok">${esc(t(locale,'books.bank.matched'))}</span></p><a href="/app/books/advanced/entries/${esc(m.entryId)}"><bdi>${esc(m.key)}</bdi></a>${owner?`<form method="post" action="/app/books/bank/unmatch" class="pform"><input type="hidden" name="account" value="${esc(c.accountId!)}" /><input type="hidden" name="match" value="${esc(m.matchId)}" /><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale,'books.bank.unmatchAsk'))}">${esc(t(locale,'books.bank.unmatch'))}</button></form>`:''}</div></li>`).join('')}</ul>`}</section>
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p></section>`;
}

/**
 * D1b (0188) — A CREDIT NOTE on the page: drafted from an issued invoice's lines (how much of each, never more than
 * is left), with its reason and its day; then issued — its number, its entry posted, never changed after.
 */
export function renderNewCreditNote(locale: Locale, inv: { readonly id: string; readonly key: string; readonly party: string; readonly currency: string },
  lines: readonly CreditableLine[], values: Readonly<Record<string, string>>, problems: readonly string[], today: string, editing: string | null = null, opts: BooksDocumentContext = {}): string {
  const v = (k: string) => esc(values[k] ?? '');
  return `<section class="book-doc-editor"><h1 class="page">${esc(editing ? t(locale, 'books.draft.editTitle') : t(locale, 'books.credit.new', { invoice: inv.key }))}</h1>
    <p class="lede">${esc(t(locale, 'books.credit.newLede'))}</p>
    ${problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    <form method="post" action="${editing ? `/app/books/credit-notes/${esc(editing)}/edit` : `/app/books/invoices/${esc(inv.id)}/credit-notes`}" class="pform bd-editor-form">${documentReturnField(opts)}
      <label class="pq"><span>${esc(t(locale, 'books.entry.date'))}</span><input type="date" name="issueDate" value="${values['issueDate'] ? v('issueDate') : esc(today)}" required /></label>
      <label class="pq"><span>${esc(t(locale, 'books.credit.reason'))}</span><input name="reason" value="${v('reason')}" maxlength="200" required /></label>
      <section class="bd-edit-lines"><h2>${esc(t(locale,'booksDocs.lines'))}</h2>${lines.map(l=>`<fieldset class="bd-edit-line"><legend>${esc(t(locale,'booksDocs.line',{n:l.lineNo}))} · <bdi>${esc(l.label)}</bdi></legend><dl class="bd-line-facts"><div><dt>${esc(t(locale,'books.invoice.quantity'))}</dt><dd>${esc(l.quantity)}</dd></div><div><dt>${esc(t(locale,'books.credit.left'))}</dt><dd>${esc(l.left)}</dd></div></dl>
      ${signOf(l.left)>0?`<label class="pq"><span>${esc(t(locale,'books.credit.quantity'))}</span><input name="qty${l.lineNo}" inputmode="decimal" value="${values[`qty${l.lineNo}`]!==undefined?v(`qty${l.lineNo}`):esc(l.left)}" aria-label="${esc(t(locale,'books.credit.quantity'))} ${l.lineNo}" /></label>`:''}
      ${signOf(l.leftNet)>0?`<label class="pq"><span>${esc(t(locale,'books.credit.reduction',{currency:inv.currency}))}</span><input name="red${l.lineNo}" inputmode="decimal" value="${v(`red${l.lineNo}`)}" aria-label="${esc(t(locale,'books.credit.reduction',{currency:inv.currency}))} ${l.lineNo}" /></label>`:''}</fieldset>`).join('')}</section>
      <p class="caption muted">${esc(t(locale, 'books.credit.reductionHelp'))}</p>
      <button class="btn send" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button>
    </form>
    <p><a class="deeper" href="/app/books/invoices/${esc(inv.id)}${documentReturnQuery(opts)}">${esc(inv.key)}</a></p></section>`;
}

export function renderCreditNote(locale: Locale, viewer: Who, c: CreditNoteView, opts: BooksDocumentContext = {}): string {
  const net = c.lines.reduce((sum,line)=>addDecimal(sum,line.net),'0' as Decimal);
  const tax = c.lines.reduce((sum,line)=>addDecimal(sum,line.tax),'0' as Decimal);
  const pill = c.state === 'issued' ? `<span class="pill ok">${esc(t(locale, 'books.credit.issued'))}</span>`
    : `<span class="pill ${c.state === 'draft' ? 'warn' : ''}">${esc(t(locale, `books.entry.state.${c.state}` as MessageKey))}</span>`;
  const actions = mayPost(viewer) && c.state === 'draft' ? `
      <p><a class="deeper" href="/app/books/credit-notes/${esc(c.id)}/edit${documentReturnQuery(opts)}">${esc(t(locale, 'books.draft.edit'))}</a></p>
      <form method="post" action="/app/books/credit-notes/${esc(c.id)}/issue" class="pform">${documentReturnField(opts)}
        <button class="btn send" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.credit.issueAsk'))}">${esc(t(locale, 'books.credit.issue'))}</button></form>
      <form method="post" action="/app/books/credit-notes/${esc(c.id)}/discard" class="pform">${documentReturnField(opts)}
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.credit.discardAsk'))}">${esc(t(locale, 'books.entry.discard'))}</button></form>` : '';
  return `<section class="book-doc-page"><div class="bd-outside">${back('/app/books/invoices/'+esc(c.invoiceId)+documentReturnQuery(opts),t(locale,'books.credit.against',{invoice:c.invoiceKey}))}</div><article class="book-document"><header class="bd-header"><h1 class="page">${esc(t(locale,'booksDocs.creditNote'))} <bdi>${esc(c.key ?? t(locale, 'books.entry.state.draft'))}</bdi></h1><p><bdi>${esc(c.billedTo.name)}</bdi></p>
    <p>${pill} <a href="/app/books/invoices/${esc(c.invoiceId)}${documentReturnQuery(opts)}">${esc(t(locale, 'books.credit.against', { invoice: c.invoiceKey }))}</a></p></header><div class="bd-parties">${issuerDetails(locale,opts.issuer,c.state==='issued')}<section>${billedTo(locale,c.billedTo)}</section></div>
    <p class="caption muted">${esc(t(locale, 'books.entry.date'))}: ${day(locale, c.issueDate)} · <bdi>${esc(c.reason)}</bdi></p>
    <p class="bd-currency">${esc(t(locale,'booksDocs.currency',{currency:c.currency}))}</p><div class="bd-lines"><table>
      <thead><tr><th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.invoice.quantity'))}</th>
        <th scope="col">${esc(t(locale, 'booksDocs.subtotal'))}</th><th scope="col">${esc(t(locale, 'booksDocs.tax'))}</th></tr></thead>
      <tbody>${c.lines.map((l) => `<tr><td data-label="${esc(t(locale,'books.entry.label'))}"><bdi>${esc(l.label)}</bdi>${signOf(l.quantity) === 0 ? ` <span class="caption muted">${esc(t(locale, 'books.credit.priceLowered'))}</span>` : ''}</td>
        <td class="num" data-label="${esc(t(locale,'books.invoice.quantity'))}">${signOf(l.quantity) === 0 ? '' : esc(l.quantity)}</td><td class="num" data-label="${esc(t(locale,'booksDocs.subtotal'))}">${money(locale, l.net, c.currency)}</td>
        <td class="num" data-label="${esc(t(locale,'booksDocs.tax'))}">${money(locale, l.tax, c.currency)}</td></tr>`).join('')}</tbody>
    </table></div>
    <dl class="bd-totals"><div class="row"><dt>${esc(t(locale, 'booksDocs.subtotal'))}</dt><dd>${money(locale,net,c.currency)}</dd></div><div class="row"><dt>${esc(t(locale, 'booksDocs.tax'))}</dt><dd>${money(locale,tax,c.currency)}</dd></div><div class="row"><dt>${esc(t(locale, 'books.entry.total'))}</dt><dd><strong>${money(locale, c.total, c.currency)}</strong></dd></div></dl>
    </article><div class="bd-outside">${c.entryId?`<p><a href="/app/books/advanced/entries/${esc(c.entryId)}">${esc(t(locale,'books.invoice.seeEntry'))}</a></p>`:''}${actions?`<section class="bd-actions"><h2>${esc(t(locale,'booksDocs.creditActions'))}</h2>${actions}</section>`:''}<p><a href="${esc(invoiceReturnHref(opts.returnHref))}">${esc(t(locale,'books.invoices.title'))}</a></p></div></section>`;
}

/**
 * 0216 (d) — A BANK'S CSV, ITS COLUMNS SAID ONCE: the file's first lines as they came, and which column is what — the
 * page's guesses chosen already, each hers to change. Posted, the answer is kept on the bank account; the file is then
 * given again and read with it (nothing of the file is stored here). Shown again when a later file is not laid out the
 * same way, or when a line cannot be read with what was kept.
 */
export function renderStatementColumns(locale: Locale, o: {
  readonly accountId: string; readonly account: string; readonly book: string;
  readonly preview: readonly (readonly string[])[]; readonly guess: LayoutGuess; readonly problems: readonly string[];
}): string {
  const g = o.guess;
  const width = Math.min(40, Math.max(0, ...o.preview.map((r) => r.length)));
  const head = o.preview[g.headerRow] ?? [];
  const sample = o.preview[g.headerRow + 1] ?? [];
  const columns = (name: string, chosen: number | null, none: boolean) => `<select name="${name}">${none ? `<option value=""${chosen === null ? ' selected' : ''}>${esc(t(locale, 'books.bank.columns.none'))}</option>` : ''}${
    Array.from({ length: width }, (_, i) => `<option value="${i}"${chosen === i ? ' selected' : ''}>${i + 1} · ${esc((head[i] ?? '').slice(0, 40))}${sample[i] ? ` · ${esc(sample[i]!.slice(0, 24))}` : ''}</option>`).join('')}</select>`;
  const pick = (label: MessageKey, control: string) => `<label class="pq"><span>${esc(t(locale, label))}</span>${control}</label>`;
  const single = 'single' in g.amount;
  const preview = o.preview.slice(0, 8).map((r, i) => `<tr><th scope="row">${i + 1}</th>${Array.from({ length: width }, (_, j) => `<td><bdi>${esc((r[j] ?? '').slice(0, 40))}</bdi></td>`).join('')}</tr>`).join('');
  return `<section class="bank-mapping">${back('/app/books/bank?account='+esc(o.accountId),t(locale,'books.bank.title'))}<h1 class="page">${esc(t(locale, 'books.bank.columns.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.bank.columns.lede', { account: o.account }))}</p>
    ${o.problems.map((p) => `<p class="perr" role="alert">${esc(p)}</p>`).join('')}
    <h2 id="bank-preview-heading">${esc(t(locale, 'bankDocs.preview'))}</h2>
    <div class="imp-table bb-preview" role="region" aria-labelledby="bank-preview-heading" tabindex="0"><table><tbody>${preview}</tbody></table></div>
    <form method="post" action="/app/books/bank/columns?account=${esc(o.accountId)}" class="pform bb-map-form">
      <input type="hidden" name="sep" value="${g.sep === '\t' ? 'tab' : esc(g.sep)}" />
      <input type="hidden" name="preview" value="${esc(JSON.stringify(o.preview.slice(0, 12).map((r) => r.slice(0, 40).map((c) => c.slice(0, 80)))))}" />
      <fieldset class="bb-map-fields"><legend>${esc(t(locale,'bankDocs.mapDate'))}</legend>
      ${pick('books.bank.columns.headerRow', `<select name="headerRow">${o.preview.slice(0, 10).map((_, i) => `<option value="${i}"${i === g.headerRow ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>`)}
      ${pick('books.bank.columns.date', columns('date', g.date, false))}
      ${pick('books.bank.columns.dateFormat', `<select name="dateFormat">${DATE_FORMATS.map((f) => `<option${f === g.dateFormat ? ' selected' : ''}>${f}</option>`).join('')}</select>`)}
      </fieldset><fieldset class="bb-map-fields"><legend>${esc(t(locale,'bankDocs.mapAmounts'))}</legend>
      ${pick('books.bank.columns.shape', `<select name="shape"><option value="single"${single ? ' selected' : ''}>${esc(t(locale, 'books.bank.columns.single'))}</option><option value="split"${single ? '' : ' selected'}>${esc(t(locale, 'books.bank.columns.split'))}</option></select>`)}
      ${pick('books.bank.columns.amount', columns('amount', single ? (g.amount as { single: number }).single : null, true))}
      ${pick('books.bank.columns.out', columns('out', single ? null : (g.amount as { out: number }).out, true))}
      ${pick('books.bank.columns.in', columns('in', single ? null : (g.amount as { in: number }).in, true))}
      ${pick('books.bank.columns.decimal', `<select name="decimal"><option value="."${g.decimal === '.' ? ' selected' : ''}>${esc(t(locale, 'books.bank.columns.point'))}</option><option value=","${g.decimal === ',' ? ' selected' : ''}>${esc(t(locale, 'books.bank.columns.comma'))}</option></select>`)}
      ${pick('books.bank.columns.currency', columns('currency', g.currency, true).replace(esc(t(locale, 'books.bank.columns.none')), esc(t(locale, 'books.bank.columns.allIn', { currency: o.book }))))}
      </fieldset><fieldset class="bb-map-fields"><legend>${esc(t(locale,'bankDocs.mapDetails'))}</legend>
      ${pick('books.bank.columns.description', columns('description', g.description, true))}
      ${pick('books.bank.columns.reference', columns('reference', g.reference, true))}
      </fieldset><button class="btn send" type="submit">${esc(t(locale, 'books.bank.columns.save'))}</button>
    </form>
    <p><a class="back" href="/app/books/bank?account=${esc(o.accountId)}">${esc(t(locale, 'books.bank.title'))}</a></p></section>`;
}
