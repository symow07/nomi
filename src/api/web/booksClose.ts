import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import type { BooksStart, ChecklistItem, FiscalYear, LockEvent } from '../../db/booksClose.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * D2 (Phase 5, item 6; 0189) — CLOSING THE BOOKS on one page: where the lock stands; the checklist for the month the
 * owner would lock to, each item counted and linked; the lock; a reopening (the owner's, with a reason); the fiscal
 * years — opening one, closing one into the closing journal; and every lock, reopening and closing, recorded.
 *
 * D10 (0211) — each year shows ITS OWN lock and its own reopening; the books' start is set here once (the day and the
 * period length); a Moroccan workspace is told that Avis 24's periods are kept by Nomi as each one begins.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const day = (locale: Locale, iso: string) => esc(show.dateYear(locale, new Date(`${iso}T12:00:00Z`)));
const ITEM_DOOR: Record<ChecklistItem, string> = {
  draft_entries: '/app/books/entries', draft_invoices: '/app/books/invoices', draft_credit_notes: '/app/books/invoices', unmatched_statement_lines: '/app/books/bank',
};

export type CloseView = {
  readonly years: readonly FiscalYear[]; readonly history: readonly LockEvent[];
  readonly start: BooksStart | null; readonly morocco: boolean;
  readonly equity: readonly { id: string; code: string; name: string }[]; readonly closingJournals: readonly { id: string; code: string; name: string }[];
  readonly openingJournals?: readonly { id: string; code: string; name: string }[];
  readonly month: string; readonly monthEnd: string; readonly checklist: readonly { item: ChecklistItem; n: number }[]; readonly today: string;
};

export function renderClose(locale: Locale, viewer: Who, v: CloseView): string {
  const clear = v.checklist.every((c) => c.n === 0);
  // the lock the checklist's month falls under: its own year's (D10)
  const lock = v.years.find((y) => y.startsOn <= v.monthEnd && v.monthEnd <= y.endsOn)?.lockDate ?? null;
  const span = (y: FiscalYear) => ({ from: show.dateYear(locale, new Date(`${y.startsOn}T12:00:00Z`)), to: show.dateYear(locale, new Date(`${y.endsOn}T12:00:00Z`)) });
  const openYears = v.years.filter((y) => y.state === 'open');
  const pick = (name: string, rows: readonly { id: string; code: string; name: string }[]) =>
    `<select name="${name}" required>${rows.map((r) => `<option value="${esc(r.id)}">${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  const checklist = `<ul class="rows">${v.checklist.map((c) => `<li class="row"><span>${esc(t(locale, `books.close.item.${c.item}` as MessageKey))}</span>
      <span>${c.n === 0 ? `<span class="pill ok">${esc(t(locale, 'books.close.clear'))}</span>`
        : `<a href="${ITEM_DOOR[c.item]}"><span class="pill warn">${esc(t(locale, 'books.close.waiting', { n: c.n }))}</span></a>`}</span></li>`).join('')}</ul>`;
  const lockForm = !owner(viewer) ? '' : clear && (lock === null || v.monthEnd > lock) && v.monthEnd <= v.today
    ? `<form method="post" action="/app/books/closing/lock" class="pform"><input type="hidden" name="day" value="${esc(v.monthEnd)}" />
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.close.lockAsk', { day: show.dateYear(locale, new Date(`${v.monthEnd}T12:00:00Z`)) }))}">${
        esc(t(locale, 'books.close.lockTo', { day: show.dateYear(locale, new Date(`${v.monthEnd}T12:00:00Z`)) }))}</button></form>`
    : `<p class="caption muted">${esc(t(locale, !clear ? 'books.close.notClear' : v.monthEnd > v.today ? 'books.close.notEnded' : 'books.close.lockedAlready'))}</p>`;
  const locked = openYears.filter((y) => y.lockDate !== null);
  const reopen = !owner(viewer) || locked.length === 0 ? '' : `<div class="block" id="reopen">
      <h2>${esc(t(locale, 'books.close.reopen'))}</h2>
      <p>${esc(t(locale, 'books.close.reopenExplain'))}</p>
      ${locked.map((y) => `<form method="post" action="/app/books/closing/reopen" class="pform"><input type="hidden" name="year" value="${esc(y.id)}" />
        <h3>${esc(t(locale, 'books.close.yearSpan', span(y)))}</h3>
        <label class="pq"><span>${esc(t(locale, 'books.close.reopenTo'))}</span><input type="date" name="day" min="${esc(y.startsOn)}" max="${esc(y.lockDate!)}" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.close.why'))}</span><input name="reason" required minlength="3" maxlength="300" /></label>
        <button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.close.reopenAsk'))}">${esc(t(locale, 'books.close.reopen'))}</button>
      </form>`).join('')}</div>`;
  const length = (l: 'month' | 'quarter') => t(locale, `books.close.length.${l}`);
  const start = v.start ? `<div class="block" id="start">
      <h2>${esc(t(locale, 'books.close.start.title'))}</h2>
      <p>${esc(t(locale, 'books.close.started', { day: show.dateYear(locale, new Date(`${v.start.day}T12:00:00Z`)), length: length(v.start.length) }))}</p>
      ${v.morocco ? `<p class="caption muted">${esc(t(locale, 'books.close.startedMorocco'))}</p>` : ''}
    </div>` : !owner(viewer) || openYears.length === 0 ? '' : `<div class="block" id="start">
      <h2>${esc(t(locale, 'books.close.start.title'))}</h2>
      <p>${esc(t(locale, 'books.close.start.explain'))}</p>
      <form method="post" action="/app/books/closing/start" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.close.start.day'))}</span><input type="date" name="day" min="${esc(openYears[openYears.length - 1]!.startsOn)}" max="${esc(openYears[0]!.endsOn)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.close.start.length'))}</span><select name="length"><option value="month">${esc(length('month'))}</option><option value="quarter">${esc(length('quarter'))}</option></select></label>
        ${v.morocco ? `<p class="caption muted">${esc(t(locale, 'books.close.startedMorocco'))}</p>` : ''}
        <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.close.start.ask'))}">${esc(t(locale, 'books.close.start.save'))}</button>
      </form></div>`;
  const next = v.years[0] ? nextYear(v.years[0].endsOn) : { starts: `${v.today.slice(0, 4)}-01-01`, ends: `${v.today.slice(0, 4)}-12-31` };
  const years = `<div class="block" id="years">
      <h2>${esc(t(locale, 'books.close.years'))}</h2>
      ${v.years.length === 0 ? `<p role="status"><span class="pill warn">${esc(t(locale, 'books.close.noYear'))}</span></p>` : `<ul class="rows">${v.years.map((y) =>
        `<li class="row"><span>${day(locale, y.startsOn)} – ${day(locale, y.endsOn)}</span><span class="pill ${y.state === 'open' ? 'ok' : 'muted'}">${esc(t(locale, `books.close.year.${y.state}` as MessageKey))}</span></li>`).join('')}</ul>`}
      ${owner(viewer) && openYears.length < 2 ? `<form method="post" action="/app/books/closing/open-year" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.trial.from'))}</span><input type="date" name="startsOn" value="${esc(next.starts)}" required /></label>
        <label class="pq"><span>${esc(t(locale, 'books.trial.to'))}</span><input type="date" name="endsOn" value="${esc(next.ends)}" required /></label>
        <button class="btn ghost" type="submit">${esc(t(locale, 'books.close.openYear'))}</button></form>` : ''}
      ${owner(viewer) && v.openingJournals !== undefined && v.openingJournals.length === 0 ? `<form method="post" action="/app/books/closing/opening-journal" class="pform">
        <p>${esc(t(locale, 'books.close.needOpening'))}</p>
        <button class="btn ghost" type="submit">${esc(t(locale, 'books.close.addOpening'))}</button></form>` : ''}
      ${!owner(viewer) ? '' : openYears.filter((y) => y.endsOn < v.today).map((y) => v.closingJournals.length === 0
        ? `<form method="post" action="/app/books/closing/journal" class="pform"><p>${esc(t(locale, 'books.close.needJournal'))}</p>
            <button class="btn ghost" type="submit">${esc(t(locale, 'books.close.addJournal'))}</button></form>`
        : `<form method="post" action="/app/books/closing/year" class="pform"><input type="hidden" name="year" value="${esc(y.id)}" />
            <h3>${esc(t(locale, 'books.close.closeYear', { from: show.dateYear(locale, new Date(`${y.startsOn}T12:00:00Z`)), to: show.dateYear(locale, new Date(`${y.endsOn}T12:00:00Z`)) }))}</h3>
            <p>${esc(t(locale, 'books.close.closeExplain'))}</p>
            <label class="pq"><span>${esc(t(locale, 'books.close.resultAccount'))}</span>${pick('result', v.equity)}</label>
            <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span>${pick('journal', v.closingJournals)}</label>
            <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'books.close.closeAsk'))}">${esc(t(locale, 'books.close.closeNow'))}</button>
          </form>`).join('')}
    </div>`;
  const history = v.history.length === 0 ? '' : `<div class="block" id="history"><h2>${esc(t(locale, 'books.close.history'))}</h2><ul class="rows">${v.history.map((h) =>
    `<li class="row"><span>${esc(t(locale, `books.close.event.${h.action}` as MessageKey, { from: h.fromDate ? show.dateYear(locale, new Date(`${h.fromDate}T12:00:00Z`)) : '—',
      to: h.toDate ? show.dateYear(locale, new Date(`${h.toDate}T12:00:00Z`)) : '—' }))}${h.reason ? ` · <bdi>${esc(h.reason)}</bdi>` : ''}</span>
      <span class="caption muted">${esc(show.dateYear(locale, new Date(h.at)))}</span></li>`).join('')}</ul></div>`;
  return `<h1 class="page">${esc(t(locale, 'books.close.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.close.lede'))}</p>
    ${openYears.length === 0 ? `<p role="status">${esc(t(locale, 'books.close.notLocked'))}</p>` : `<ul class="rows" role="status">${openYears.map((y) => `<li class="row"><span>${
      esc(y.lockDate ? t(locale, 'books.close.yearLockedTo', { ...span(y), day: show.dateYear(locale, new Date(`${y.lockDate}T12:00:00Z`)) }) : t(locale, 'books.close.yearNotLocked', span(y)))}</span></li>`).join('')}</ul>`}
    ${start}
    <div class="block" id="lock">
      <h2>${esc(t(locale, 'books.close.checklist'))}</h2>
      <form method="get" action="/app/books/closing" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.close.month'))}</span><input type="month" name="month" value="${esc(v.month)}" required /></label>
        <button class="btn ghost" type="submit">${esc(t(locale, 'books.bank.show'))}</button></form>
      <p class="caption muted">${esc(t(locale, 'books.close.upTo', { day: show.dateYear(locale, new Date(`${v.monthEnd}T12:00:00Z`)) }))}</p>
      ${checklist}
      ${lockForm}
    </div>
    ${reopen}${years}${history}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/** The year after one ending on `endsOn`: the next day, for twelve months. */
function nextYear(endsOn: string): { starts: string; ends: string } {
  const s = new Date(`${endsOn}T12:00:00Z`); s.setUTCDate(s.getUTCDate() + 1);
  const e = new Date(s); e.setUTCFullYear(e.getUTCFullYear() + 1); e.setUTCDate(e.getUTCDate() - 1);
  return { starts: s.toISOString().slice(0, 10), ends: e.toISOString().slice(0, 10) };
}
