import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { BooksAccounts } from '../../db/booksOrders.js';
import type { CloseView } from './booksClose.js';
import type { FiscalYear } from '../../db/booksClose.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import {
  pageHead, setSection, setRow, setNotice, saveForm, saveActs, rowAction, searchList, listRow, pickList, pickField,
  type PickOption,
} from './settingsPage.js';

/**
 * THE SETTINGS OVERHAUL (rule 104) — the BOOKS pages that were rebuilt on the one template: Accounts (and the chart it
 * opens), Starting balances, Invoices. Only where controls are drawn changed: every form posts what it posted, to a
 * route that calls the save function it called.
 */

type Row = { readonly id: string; readonly code: string; readonly name: string };
export type MoneyChoice = Row & { readonly marked: boolean; readonly byRule: boolean };

/** An account as a searchable choice: what is sent is its number and name, the words the person saw. */
export const accountOption = (a: Row): PickOption => ({ value: a.id, label: `${a.code} · ${a.name}` });
/** The accounts the owner may ADD to those that hold money: the choices not yet ticked, and not counted by their name. */
export const moneyCandidates = (money: readonly MoneyChoice[]): readonly MoneyChoice[] => money.filter((a) => !a.marked && !a.byRule);

/** The four posting accounts chosen by search: the form field, and its label. */
export const POSTING_FIELDS = [
  ['receivable', 'books.accounts.receivable', 'receivableAccountId'],
  ['sales', 'books.accounts.sales', 'salesAccountId'],
  ['fxLoss', 'books.accounts.fxLoss', 'fxLossAccountId'],
  ['fxGain', 'books.accounts.fxGain', 'fxGainAccountId'],
] as const satisfies readonly (readonly [string, MessageKey, keyof BooksAccounts])[];

/** A form sent back: what was typed in each field, and the refusal under the field it is about. */
export type AccountsDraft = { readonly values: Readonly<Record<string, string>>; readonly errors: Readonly<Record<string, string>> };

const CHART_LIST = 'chart-accounts';
const MONEY_LIST = 'money-accounts';
const account = (a: Row): string => `<bdi dir="ltr">${esc(a.code)}</bdi> · <bdi>${esc(a.name)}</bdi>`;
const fieldErr = (id: string, text: string | undefined): string | undefined =>
  text ? `<span class="fielderr" role="alert" id="${esc(id)}">${esc(text)}</span>` : undefined;
const invalid = (id: string, text: string | undefined): string => text ? ` aria-invalid="true" aria-describedby="${esc(id)}"` : '';

/**
 * ACCOUNTS. Three subjects, in the order they are needed: the accounts Nomi posts to (the page's ONE Save), the
 * accounts that hold money (a short list: each row acts at once), and the chart itself (its state, the action that
 * loads it, a door to see it). The chart is written ONCE, as the list the four search fields complete from: the page
 * used to write it four times as dropdowns and once more as 210 tick boxes.
 */
export function renderBooksAccountsPage(locale: Locale, o: {
  readonly accounts: readonly Row[]; readonly journals: readonly Row[]; readonly chosen: BooksAccounts;
  readonly money: readonly MoneyChoice[]; readonly cgnc: boolean; readonly draft?: AccountsDraft | null;
}): string {
  const options = o.accounts.map(accountOption);
  const d = o.draft ?? null;
  const posting = [
    setRow(locale, { label: t(locale, 'books.accounts.salesJournal'), forId: 'acc-salesJournal',
      control: `<select id="acc-salesJournal" name="salesJournal"><option value=""></option>${o.journals.map((j) =>
        `<option value="${esc(j.id)}"${(d ? d.values['salesJournal'] : o.chosen.salesJournalId) === j.id ? ' selected' : ''}>${esc(j.code)} · ${esc(j.name)}</option>`).join('')}</select>` }),
    ...POSTING_FIELDS.map(([name, label, column]) => {
      const typed = d?.values[name];
      const current = typed !== undefined ? { value: '', label: typed } : options.find((x) => x.value === o.chosen[column]) ?? null;
      const error = d?.errors[name];
      return setRow(locale, { label: t(locale, label), forId: `acc-${name}`,
        desc: name === 'fxLoss' ? t(locale, 'setBooks.acc.fxLossHelp') : name === 'fxGain' ? t(locale, 'setBooks.acc.fxGainHelp') : undefined,
        control: pickField(locale, { id: `acc-${name}`, name, list: CHART_LIST, current, invalid: invalid(`acc-${name}-err`, error) }),
        error: fieldErr(`acc-${name}-err`, error) });
    }),
  ];

  const held = o.money.filter((a) => a.marked || a.byRule);
  const can = moneyCandidates(o.money);
  const heldList = held.length === 0
    ? `<p class="muted">${esc(t(locale, o.money.length === 0 ? 'books.country.moneyNone' : 'setupList.moneyNone'))}</p>`
    : searchList(locale, `<ul class="rows bk-held">${held.map((a) => `<li class="row"${listRow(`${a.code} ${a.name}`)}><span>${account(a)}</span>${a.byRule
      ? `<span class="muted">${esc(t(locale, 'setBooks.acc.byName'))}</span>`
      : rowAction({ action: '/app/books/accounts/money/remove', label: t(locale, 'setBooks.acc.remove'), hidden: { account: a.id },
        ariaLabel: t(locale, 'setBooks.acc.removeOf', { account: `${a.code} · ${a.name}` }),
        confirm: t(locale, 'setBooks.acc.removeAsk', { account: `${a.code} · ${a.name}` }) })}</li>`).join('')}</ul>`);
  const addError = d?.errors['account'];
  const add = can.length === 0 ? '' : `<form method="post" action="/app/books/accounts/money/add" class="bk-addform" id="money-add">${
    setRow(locale, { label: t(locale, 'setBooks.acc.addMoney'), forId: 'acc-money',
      desc: t(locale, 'setBooks.acc.addMoneyHelp', { n: show.count(locale, can.length) }),
      control: `<div class="bk-add">${pickField(locale, { id: 'acc-money', name: 'account', list: MONEY_LIST, required: true,
        current: d?.values['account'] !== undefined ? { value: '', label: d.values['account'] } : null, invalid: invalid('acc-money-err', addError) })
      }<button class="btn" type="submit">${esc(t(locale, 'setBooks.acc.add'))}</button></div>`,
      error: fieldErr('acc-money-err', addError) })}</form>${pickList(MONEY_LIST, can.map(accountOption))}`;

  const chart = [
    setRow(locale, { label: t(locale, 'books.country.chart'),
      control: o.accounts.length > 0
        ? `<span class="fr-value">${esc(t(locale, 'books.country.chartCount', { n: show.count(locale, o.accounts.length) }))}</span> <a class="deeper" href="/app/settings/books/accounts/chart">${esc(t(locale, 'setBooks.acc.seeChart'))}</a>`
        : `<span class="muted">${esc(t(locale, 'books.country.chartNone'))}</span>` }),
    ...(o.cgnc ? [setRow(locale, { label: t(locale, 'books.chart.title'), desc: t(locale, 'setBooks.acc.cgncLine'),
      control: rowAction({ action: '/app/books/chart/cgnc', label: t(locale, 'books.chart.apply') }) })] : []),
    setRow(locale, { label: t(locale, 'books.orders.title'),
      control: `<a class="deeper" href="/app/books/orders" aria-label="${esc(t(locale, 'books.orders.title'))}">${esc(t(locale, 'setBooks.conn.open'))}</a>` }),
  ];

  return pageHead(t(locale, 'booksArea.accounts'), t(locale, 'setBooks.acc.lede'))
    + pickList(CHART_LIST, options)
    + saveForm('/app/books/settings/accounts', setSection({ title: t(locale, 'setBooks.acc.posting'), rows: posting }) + saveActs(locale), { id: 'accounts' })
    + setSection({ id: 'money', title: t(locale, 'books.country.money'), rows: setNotice({ text: t(locale, 'setBooks.acc.moneyRule') }) + heldList + add })
    + setSection({ id: 'chart', title: t(locale, 'books.country.chart'), rows: chart });
}

/** THE CHART, to look at: every active account by number, 50 at a time, with a search box. Nothing is changed here. */
export function renderBooksChartPage(locale: Locale, accounts: readonly Row[]): string {
  const table = `<table class="team-table bk-chart"><thead><tr><th scope="col">${esc(t(locale, 'setBooks.chart.number'))}</th><th scope="col">${esc(t(locale, 'setBooks.chart.name'))}</th></tr></thead><tbody>${
    accounts.map((a) => `<tr${listRow(`${a.code} ${a.name}`)}><th scope="row"><bdi dir="ltr">${esc(a.code)}</bdi></th><td><bdi>${esc(a.name)}</bdi></td></tr>`).join('')}</tbody></table>`;
  return pageHead(t(locale, 'books.country.chart'), t(locale, 'setBooks.chart.lede'))
    + `<p><a class="deeper" href="/app/settings/books/accounts#chart">${esc(t(locale, 'setBooks.chart.back'))}</a></p>`
    + (accounts.length === 0 ? `<p class="muted">${esc(t(locale, 'books.country.chartNone'))}</p>` : searchList(locale, table, { step: 50 }));
}

type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who): boolean => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const dayOf = (locale: Locale, iso: string): string => show.dateYear(locale, new Date(`${iso}T12:00:00Z`));
/** The year after one ending on `endsOn`: the next day, for twelve months. */
function nextYear(endsOn: string): { starts: string; ends: string } {
  const s = new Date(`${endsOn}T12:00:00Z`); s.setUTCDate(s.getUTCDate() + 1);
  const e = new Date(s); e.setUTCFullYear(e.getUTCFullYear() + 1); e.setUTCDate(e.getUTCDate() - 1);
  return { starts: s.toISOString().slice(0, 10), ends: e.toISOString().slice(0, 10) };
}

/**
 * STARTING BALANCES. When the books begin (set once: a day and a period length, started by a button that asks first),
 * the fiscal years (a list, and "Open this fiscal year"), and, for a Moroccan workspace, how its books are best
 * started: one line each on the page, the long form in the page's help (`help.g.booksStart`).
 */
export function renderStartingBalances(locale: Locale, viewer: Who, v: Pick<CloseView, 'years' | 'start' | 'morocco' | 'openingJournals' | 'today'>): string {
  const openYears = v.years.filter((y) => y.state === 'open');
  const length = (l: 'month' | 'quarter'): string => t(locale, `books.close.length.${l}`);
  const avis = v.morocco ? setNotice({ text: t(locale, 'setBooks.start.avis') }) : '';
  const start = v.start
    ? setSection({ id: 'start', title: t(locale, 'books.close.start.title'),
      rows: `<p>${esc(t(locale, 'books.close.started', { day: dayOf(locale, v.start.day), length: length(v.start.length) }))}</p>${avis}` })
    : !owner(viewer) || openYears.length === 0 ? ''
    : setSection({ id: 'start', title: t(locale, 'books.close.start.title'), help: t(locale, 'books.close.start.explain'),
      rows: `<form method="post" action="/app/books/closing/start" class="bk-form">${
        setRow(locale, { label: t(locale, 'books.close.start.day'), forId: 'start-day',
          control: `<input id="start-day" type="date" name="day" min="${esc(openYears[openYears.length - 1]!.startsOn)}" max="${esc(openYears[0]!.endsOn)}" required />` })}${
        setRow(locale, { label: t(locale, 'books.close.start.length'), forId: 'start-length',
          control: `<select id="start-length" name="length"><option value="month">${esc(length('month'))}</option><option value="quarter">${esc(length('quarter'))}</option></select>` })}${avis}
        <div class="bk-acts"><button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.close.start.ask'))}">${esc(t(locale, 'books.close.start.save'))}</button></div></form>` });
  const next = v.years[0] ? nextYear(v.years[0].endsOn) : { starts: `${v.today.slice(0, 4)}-01-01`, ends: `${v.today.slice(0, 4)}-12-31` };
  const yearRow = (y: FiscalYear): string =>
    `<li class="row"><span>${esc(dayOf(locale, y.startsOn))} – ${esc(dayOf(locale, y.endsOn))}</span><span class="pill ${y.state === 'closed' ? 'ok' : 'muted'}">${esc(t(locale, `books.close.year.${y.state}` as MessageKey))}</span></li>`;
  const years = setSection({ id: 'years', title: t(locale, 'books.close.years'), rows:
    (v.years.length === 0 ? `<p role="status"><span class="pill warn long">${esc(t(locale, 'books.close.noYear'))}</span></p>` : `<ul class="rows">${v.years.map(yearRow).join('')}</ul>`)
    + (owner(viewer) && openYears.length < 2 ? `<form method="post" action="/app/books/closing/open-year" class="bk-form">${
      setRow(locale, { label: t(locale, 'books.trial.from'), forId: 'year-from', control: `<input id="year-from" type="date" name="startsOn" value="${esc(next.starts)}" required />` })}${
      setRow(locale, { label: t(locale, 'books.trial.to'), forId: 'year-to', control: `<input id="year-to" type="date" name="endsOn" value="${esc(next.ends)}" required />` })}
      <div class="bk-acts"><button class="btn" type="submit">${esc(t(locale, 'books.close.openYear'))}</button></div></form>` : '')
    + (owner(viewer) && v.openingJournals !== undefined && v.openingJournals.length === 0
      ? setNotice({ text: t(locale, 'books.close.needOpening'), act: rowAction({ action: '/app/books/closing/opening-journal', label: t(locale, 'books.close.addOpening') }) }) : '') });
  const morocco = !v.morocco ? '' : setSection({ id: 'morocco-start', title: t(locale, 'books.morocco.title'),
    rows: (['when', 'rule', 'systems'] as const).map((k) => setNotice({ text: t(locale, `setBooks.start.${k}`) })).join('') });
  return pageHead(t(locale, 'booksArea.opening'), t(locale, 'setBooks.start.lede')) + start + years + morocco;
}

/**
 * INVOICES (0226): the workspace's one switch, the owner's alone. Off: nothing is sent and the order-confirmed reply
 * promises no invoice; that line is on the page, beside the switch. How an invoice goes and when it is reminded are one
 * line each; their long form is in the page's help (`help.g.booksInvoices`).
 */
export function renderInvoicesOutPage(locale: Locale, on: boolean, mayChange: boolean): string {
  const lines = setNotice({ text: t(locale, on ? 'invoice.settings.stateOn' : 'invoice.settings.stateOff'), id: 'invoices-state' })
    + setNotice({ text: t(locale, 'setBooks.inv.reminders') }) + setNotice({ text: t(locale, 'invoice.settings.promise') });
  const head = pageHead(t(locale, 'side.booksInvoices'), t(locale, 'setBooks.inv.lede'));
  if (!mayChange) return head + lines + `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;
  return head + saveForm('/app/settings/books/invoices-out', setSection({ id: 'invoices-out', title: t(locale, 'invoice.settings.title'), rows: [
    setRow(locale, { label: t(locale, 'invoice.settings.switch'), forId: 'inv-on', desc: t(locale, 'setBooks.inv.how'),
      control: `<label class="chkbox"><input id="inv-on" type="checkbox" name="on" value="1"${on ? ' checked' : ''} /> <span>${esc(t(locale, 'followUp.on'))}</span></label>` }),
  ] }) + lines + saveActs(locale));
}

/**
 * COUNTRY AND TAX, its second subject: the business's legal details (kept on the business profile, linked by name),
 * and the dates the owner confirmed for a connected source's taxes. `forms` is the existing confirmation form, one
 * per source that has confirmed dates.
 */
export function renderTaxSection(locale: Locale, forms: string): string {
  return setSection({ id: 'tax', title: t(locale, 'booksArea.taxDates'), help: t(locale, 'setBooks.tax.help'), rows:
    setNotice({ text: t(locale, 'setBooks.tax.details'), door: { href: '/app/settings/business/profile#identifiers', label: t(locale, 'setBooks.tax.detailsDoor') } })
    + setNotice({ text: t(locale, 'setBooks.tax.rules'), door: { href: '/app/settings/books/connections', label: t(locale, 'booksArea.connections') } })
    + '<span id="tax-start"></span>' + (forms || `<p class="muted">${esc(t(locale, 'setBooks.tax.none'))}</p>`) });
}
