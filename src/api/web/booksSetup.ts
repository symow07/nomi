import type { Locale } from '../../core/owner/i18n/locale.js';
import { countryName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { isBooksCountry } from '../../core/books/countryPacks.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import { icon } from './icons.js';

/**
 * F46 — the books' setup as a short checklist: country, year, accounts, tax, bank; one page per step, each step's state
 * read from what is saved (nothing guessed, nothing counted as done that is not on record).
 *
 * The settings overhaul (rule 104): the checklist left Settings. It is a CARD on Books › Overview until its five steps
 * are done (`booksSetupCard`), each step a door to its settings page; the other settings are in the Settings menu.
 */
export type BooksSetupState = {
  /** The business's country (the books' country once chosen). */
  readonly country: string | null;
  /** The books' first day, when set; and how many fiscal years exist. */
  readonly start: string | null;
  readonly years: number;
  /** Where sales and payments are recorded: all three chosen (the rule the books' home uses). */
  readonly accounts: boolean;
  /** A business identifier on record: an EIN, a company number, or any of Morocco's three. */
  readonly identifier: boolean;
  /** Accounts that hold money (marked by the owner, or by the chart's own rule). */
  readonly money: number;
};

type Step = { readonly href: string; readonly title: MessageKey; readonly done: boolean; readonly reading: string };

/** The five steps, in order, each with its state and what is on record for it. */
export function booksSetupSteps(locale: Locale, s: BooksSetupState): readonly Step[] {
  const name = (c: string): string => countryName(locale, c) ?? c;
  return [
    { href: '/app/settings/books/country', title: 'books.country.nav', done: isBooksCountry(s.country),
      reading: !s.country ? t(locale, 'setupList.notChosen') : isBooksCountry(s.country) ? name(s.country) : t(locale, 'books.country.notYet', { country: name(s.country) }) },
    { href: '/app/settings/books/starting-balances', title: 'booksArea.opening', done: !!s.start && s.years > 0,
      reading: s.start && s.years > 0 ? t(locale, 'setupList.began', { day: show.dateYear(locale, new Date(`${s.start}T12:00:00Z`)) }) : t(locale, 'setupList.notSet') },
    { href: '/app/settings/books/accounts', title: 'booksArea.accounts', done: s.accounts,
      reading: t(locale, s.accounts ? 'setupList.chosen' : 'setupList.notChosen') },
    // Tax is a section of Country and tax (rule 104).
    { href: '/app/settings/books/country#tax', title: 'booksArea.taxDetails', done: s.identifier,
      reading: t(locale, s.identifier ? 'setupList.idSaved' : 'setupList.idNone') },
    { href: '/app/settings/books/accounts#money', title: 'setupList.bank', done: s.money > 0,
      reading: s.money > 0 ? t(locale, 'setupList.money', { n: show.count(locale, s.money) }) : t(locale, 'setupList.moneyNone') },
  ];
}

/** The card on Books › Overview: drawn while a step is still to do, and gone once all five are done. */
export function booksSetupCard(locale: Locale, s: BooksSetupState): string {
  const steps = booksSetupSteps(locale, s);
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return '';
  const state = (x: Step): string => x.done
    ? `<span class="pill ok">${esc(t(locale, 'setupList.done'))}</span>`
    : `<span class="pill">${esc(t(locale, 'setupList.todo'))}</span>`;
  return `<section class="bs-setup" id="setup" aria-labelledby="bs-steps">
      <h2 id="bs-steps">${esc(t(locale, 'booksArea.setup'))}</h2>
      <p class="caption muted">${esc(t(locale, 'booksArea.setupHint'))}</p>
      <p class="bs-progress"><progress max="${steps.length}" value="${done}" aria-labelledby="bs-done"></progress> <span id="bs-done">${esc(t(locale, 'setupList.progress', { done: String(done), total: String(steps.length) }))}</span></p>
      <ol class="bs-steps">${steps.map((x) => `<li${x.done ? ' class="done"' : ''}><a href="${esc(x.href)}"><span class="bs-step"><span>${esc(t(locale, x.title))}</span><span class="caption muted">${esc(x.reading)}</span></span>${state(x)}${icon('go', 'ni flips')}</a></li>`).join('')}</ol>
    </section>`;
}
