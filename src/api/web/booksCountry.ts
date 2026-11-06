import type { Locale } from '../../core/owner/i18n/locale.js';
import { countryName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { BOOKS_COUNTRIES, COUNTRY_PACKS, US_STATES, isBooksCountry, type BooksCountry } from '../../core/books/countryPacks.js';
import type { CountryBooksView } from '../../db/booksCountry.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { fieldRow, rowsCard, saveBar } from './rows.js';
import * as show from './values.js';

/**
 * THE COUNTRY PAGE (Block 2 PR 1; 0225) — Layout 7: one subject, its fields, one Save. The country, the currency (read
 * here, changed on its own page), the period length (chosen once: `books_start()`), the first financial year (the first
 * `fiscal_years` row), the pack's tax scheme, how long the records are kept, and the identifier the pack asks for. What
 * is already decided is shown as a value, not a control. Below it, for the United States only, the second subject with
 * its own Save: a sales-tax rate per state.
 */
export type CountryForm = {
  readonly values: Readonly<Record<string, string>>;
  readonly errors: Readonly<Partial<Record<'company_number' | 'ein', string>>>;
};

const day = (locale: Locale, ymd: string) => show.dateYear(locale, new Date(`${ymd}T12:00:00Z`));
const value = (inner: string) => `<span class="fr-value">${inner}</span>`;
const muted = (s: string) => `<span class="muted">${esc(s)}</span>`;
const err = (id: string, text: string | undefined) => (text ? `<span class="fielderr" role="alert" id="${id}">${esc(text)}</span>` : undefined);
/** A stored rate ("8.2500") as the owner typed it ("8.25%"): the text itself, never a float (A1). */
const rateOf = (locale: Locale, rate: string) => show.isolate(locale, `${rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate}%`);

export function renderBooksCountry(locale: Locale, v: CountryBooksView, form: CountryForm | null, states: readonly { readonly state: string; readonly rate: string }[], today: string): string {
  const chosen = form?.values['country'] ?? v.country;
  const pack = isBooksCountry(chosen) ? COUNTRY_PACKS[chosen] : null;
  const name = (c: string) => countryName(locale, c) ?? c;
  const option = (code: string, label: string) => `<option value="${esc(code)}"${code === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const options = [
    ...(chosen && !isBooksCountry(chosen) ? [option(chosen, name(chosen))] : []),
    ...(!chosen ? [`<option value="" selected>${esc(t(locale, 'books.country.none'))}</option>`] : []),
    ...BOOKS_COUNTRIES.map((c) => option(c, name(c))),
  ].join('');
  const notYet = chosen && !isBooksCountry(chosen) ? `<span class="fr-need">${esc(t(locale, 'books.country.notYet', { country: name(chosen) }))}</span>` : '';
  const periodLabel = (l: 'month' | 'quarter') => t(locale, `books.country.period.${l}` as MessageKey);
  const periodValue = form?.values['period'] ?? pack?.periodDefault ?? 'month';
  const yearValue = form?.values['year_start'] ?? `${today.slice(0, 4)}-01-01`;
  const rows: string[] = [
    fieldRow({ label: t(locale, 'books.country.country'), forId: 'bc-country', desc: t(locale, 'books.country.countryWhy'),
      control: `<select id="bc-country" name="country">${options}</select>${notYet}` }),
    fieldRow({ label: t(locale, 'books.country.currency'), desc: t(locale, 'books.country.currencyWhy'),
      control: value(v.currency ? `<bdi dir="ltr">${esc(v.currency)}</bdi>` : muted(t(locale, 'books.country.none'))) +
        ` <a class="deeper" href="/app/settings/business/currency">${esc(t(locale, 'books.country.currencyDoor'))}</a>` }),
    v.start
      ? fieldRow({ label: t(locale, 'books.country.period'), desc: t(locale, 'books.country.periodWhy'),
        control: value(esc(t(locale, 'books.country.periodStarted', { length: periodLabel(v.start.length), day: day(locale, v.start.day) }))) })
      : fieldRow({ label: t(locale, 'books.country.period'), forId: 'bc-period', desc: t(locale, 'books.country.periodWhy'),
        control: `<select id="bc-period" name="period">${(['month', 'quarter'] as const).map((l) =>
          `<option value="${l}"${l === periodValue ? ' selected' : ''}>${esc(periodLabel(l))}</option>`).join('')}</select>` }),
    v.firstYear
      ? fieldRow({ label: t(locale, 'books.country.yearStart'), desc: t(locale, 'books.country.yearStartWhy'),
        control: value(esc(t(locale, 'books.country.yearRange', { from: day(locale, v.firstYear.startsOn), to: day(locale, v.firstYear.endsOn) }))) })
      : fieldRow({ label: t(locale, 'books.country.yearStart'), forId: 'bc-year', desc: t(locale, 'books.country.yearStartWhy'),
        control: `<input id="bc-year" name="year_start" type="date" value="${esc(yearValue)}" required />` }),
    fieldRow({ label: t(locale, 'books.country.tax'),
      control: value(esc(pack ? t(locale, `books.country.tax.${pack.country}` as MessageKey) : t(locale, 'books.country.tax.none'))) }),
    fieldRow({ label: t(locale, 'books.country.chart'),
      control: value(v.accounts > 0 ? esc(t(locale, 'books.country.chartCount', { n: v.accounts })) : muted(t(locale, 'books.country.chartNone'))) }),
    ...(pack ? [fieldRow({ label: t(locale, 'books.country.kept'), control: value(esc(t(locale, 'books.country.keptYears', { n: pack.retentionYears }))) })] : []),
    ...identifierRow(locale, pack?.country ?? null, v, form),
  ];
  const statesBlock = v.country === 'US' && pack ? renderStateTaxes(locale, states) : '';
  return `<h1 class="page">${esc(t(locale, 'books.country.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.country.lede'))}</p>
    <form method="post" action="/app/books/country" class="sform">
      ${rowsCard(null, rows, 'country')}
      ${saveBar(t(locale, 'books.country.save'))}
    </form>${statesBlock}`;
}

function identifierRow(locale: Locale, country: BooksCountry | null, v: CountryBooksView, form: CountryForm | null): string[] {
  if (country === 'GB') {
    return [fieldRow({ label: t(locale, 'books.country.companyNumber'), forId: 'bc-company', desc: t(locale, 'books.country.companyNumberWhy'),
      error: err('bc-company-err', form?.errors.company_number),
      control: `<input id="bc-company" name="company_number" dir="ltr" value="${esc(form?.values['company_number'] ?? v.companyNumber ?? '')}"${form?.errors.company_number ? ' aria-invalid="true" aria-describedby="bc-company-err"' : ''} />` })];
  }
  if (country === 'US') {
    return [fieldRow({ label: t(locale, 'books.country.ein'), forId: 'bc-ein', desc: t(locale, 'books.country.einWhy'),
      error: err('bc-ein-err', form?.errors.ein),
      control: `<input id="bc-ein" name="ein" dir="ltr" inputmode="numeric" value="${esc(form?.values['ein'] ?? v.ein ?? '')}"${form?.errors.ein ? ' aria-invalid="true" aria-describedby="bc-ein-err"' : ''} />` })];
  }
  if (country === 'MA') {
    return [fieldRow({ label: t(locale, 'books.country.ids'),
      control: value(esc(t(locale, v.moroccanIds ? 'books.country.idsGiven' : 'books.country.idsMissing'))) +
        ` <a class="deeper" href="/app/settings/business/profile#identifiers">${esc(t(locale, 'books.country.idsDoor'))}</a>` })];
  }
  return [];
}

/** The United States' second subject: one sales-tax rate per state, each a tax code on the sales-tax account. */
function renderStateTaxes(locale: Locale, states: readonly { readonly state: string; readonly rate: string }[]): string {
  const taken = new Set(states.map((s) => s.state));
  const options = US_STATES.filter((s) => !taken.has(s)).map((s) => `<option value="${s}">${s}</option>`).join('');
  return `<section class="block" id="states">
      <h2>${esc(t(locale, 'books.country.states'))}</h2>
      <p>${esc(t(locale, 'books.country.statesWhy'))}</p>
      ${states.length === 0 ? `<p class="muted">${esc(t(locale, 'books.country.noStates'))}</p>` : `<ul class="rows">${states.map((s) =>
        `<li class="row"><span><bdi dir="ltr">${esc(s.state)}</bdi></span><span>${rateOf(locale, s.rate)}</span></li>`).join('')}</ul>`}
      ${options ? `<form method="post" action="/app/books/country/state-tax" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.country.state'))}</span><select name="state" required>${options}</select></label>
        <label class="pq"><span>${esc(t(locale, 'books.country.rate'))}</span><input name="rate" inputmode="decimal" required placeholder="8.25" dir="ltr" /></label>
        <button class="btn" type="submit">${esc(t(locale, 'books.country.addState'))}</button>
      </form>` : ''}
    </section>`;
}

/**
 * THE ACCOUNTS PAGE'S OWN SUBJECT (0225): which accounts hold money. Every active asset account with nothing under it,
 * a tick each (`money_<id>`: the form parser keeps the last of a repeated key, so one key per account); one Save. An
 * account the code's rules already recognise says so, and its tick changes nothing.
 */
export function renderMoneyAccounts(locale: Locale, accounts: readonly { readonly id: string; readonly code: string; readonly name: string; readonly marked: boolean; readonly byRule: boolean }[]): string {
  return `<div class="block" id="money">
      <h2>${esc(t(locale, 'books.country.money'))}</h2>
      <p>${esc(t(locale, 'books.country.moneyWhy'))}</p>
      ${accounts.length === 0 ? `<p class="muted">${esc(t(locale, 'books.country.moneyNone'))}</p>` : `<form method="post" action="/app/books/accounts/money" class="pform">
        <ul class="choices">${accounts.map((a) => `<li><label><input type="checkbox" name="money_${esc(a.id)}" value="1"${a.marked || a.byRule ? ' checked' : ''}${a.byRule ? ' disabled' : ''} /> <bdi dir="ltr">${esc(a.code)}</bdi> · <bdi>${esc(a.name)}</bdi>${a.byRule ? ` <span class="muted">${esc(t(locale, 'books.country.moneyByRule'))}</span>` : ''}</label></li>`).join('')}</ul>
        <button class="btn" type="submit">${esc(t(locale, 'books.country.moneySave'))}</button>
      </form>`}
    </div>`;
}
