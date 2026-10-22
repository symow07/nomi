import { type Locale } from '../../core/owner/i18n/locale.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { moneyFromRow } from '../../core/types/money.js';
import type { Decimal } from '../../core/types/decimal.js';
import type { ReadingProblem } from '../../core/books/reading.js';
import type { PaperRow, ReadingRow } from '../../db/booksDocuments.js';
import { t } from './say.js';
import { esc } from './layout.js';
import { icon } from './icons.js';
import * as show from './values.js';

/**
 * D6 (Phase 5, item 7) — THE BOOKS' PAPERS on the page: kept (sealed, in the workspace's residency), read on request
 * where a reader is configured, and — from a reading with no problem — one draft the owner shapes: every account,
 * the supplier, each tax code chosen here. Nothing read is ever posted from this page.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const money = (locale: Locale, d: Decimal, currency: string | null) => {
  const m = currency ? moneyFromRow(d, currency) : null; return m ? esc(show.money(locale, m)) : esc(d);
};

export function problemText(locale: Locale, p: ReadingProblem): string {
  switch (p.kind) {
    case 'ambiguous': return t(locale, 'books.papers.problem.ambiguous', { where: p.where });
    case 'not_an_amount': return t(locale, 'books.papers.problem.notAnAmount', { where: p.where });
    case 'not_adding_up': return t(locale, 'books.papers.problem.notAddingUp', { lines: p.lines, total: p.total });
    case 'unknown_currency': return t(locale, 'books.papers.problem.currency', { currency: p.currency || '—' });
    case 'no_total': return t(locale, 'books.papers.problem.noTotal');
    case 'no_date': return t(locale, 'books.papers.problem.noDate');
    case 'no_number': return t(locale, 'books.papers.problem.noNumber');
  }
}

export function renderPapers(locale: Locale, viewer: Who, rows: readonly PaperRow[], offered: boolean): string {
  return `<h1 class="page">${esc(t(locale, 'books.papers.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.papers.lede'))}</p>
    ${owner(viewer) && offered ? `<form method="post" action="/app/books/papers" enctype="multipart/form-data" class="pform">
      <label class="pq"><span>${esc(t(locale, 'books.papers.file'))}</span><input type="file" name="paper" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
      <button class="btn" type="submit">${esc(t(locale, 'books.papers.keep'))}</button></form>` : ''}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.papers.none'))}</p>` : `<ul class="rows">${rows.map((r) => `<li class="row">
      <span><a href="/app/books/papers/${esc(r.id)}"><bdi>${esc(r.name)}</bdi></a> · <span class="caption muted">${esc(show.dateYear(locale, new Date(`${r.addedOn}T12:00:00Z`)))}</span></span>
      <span>${r.historyThrough ? `<span class="pill">${esc(t(locale, 'books.papers.history'))}</span>` : r.draftedEntryId ? `<span class="pill ok">${esc(t(locale, 'books.papers.drafted'))}</span>`
        : r.lastOutcome === null ? '' : r.lastOutcome !== 'read' || r.lastProblems > 0 ? `<span class="pill warn">${esc(t(locale, 'books.papers.needsLook'))}</span>`
        : `<span class="pill">${esc(t(locale, 'books.papers.readOk'))}</span>`}</span></li>`).join('')}</ul>`}
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

export type PaperChoices = {
  readonly journals: readonly { id: string; code: string; name: string }[];
  readonly parties: readonly { id: string; code: string; name: string }[];
  readonly accounts: readonly { id: string; code: string; name: string }[];
  readonly taxCodes: readonly { id: string; code: string; label: string }[];
  readonly payableDefault: string | null; readonly purchasesDefault: string | null;
};

export function renderPaper(locale: Locale, viewer: Who, p: { id: string; name: string; mediaType: string; readings: readonly ReadingRow[];
  keepUntil?: string; history?: { readonly entries: number; readonly through: string } | null },
  c: PaperChoices, reader: { readonly available: boolean; readonly canRead: boolean }): string {
  const last = p.readings[0] ?? null;
  const pick = (name: string, rows: readonly { id: string; code: string; name: string }[], chosen: string | null, label: string) =>
    `<select name="${name}" required aria-label="${esc(label)}"><option value=""></option>${rows.map((r) =>
      `<option value="${esc(r.id)}"${chosen === r.id ? ' selected' : ''}>${esc(r.code)} · ${esc(r.name)}</option>`).join('')}</select>`;
  const reading = !last ? '' : last.outcome !== 'read' || !last.reading
    ? `<p role="alert"><span class="pill warn">${esc(t(locale, last.outcome === 'cut_off' ? 'books.papers.cutOff' : 'books.papers.unreadable'))}</span></p>`
    : `<h2>${esc(t(locale, 'books.papers.reading'))}</h2>
      <dl class="scard">
        <div class="row"><dt>${esc(t(locale, 'books.papers.supplier'))}</dt><dd><bdi>${esc(last.reading.supplierName ?? '—')}</bdi>${last.reading.supplierTaxId ? ` · <bdi>${esc(last.reading.supplierTaxId)}</bdi>` : ''}</dd></div>
        <div class="row"><dt>${esc(t(locale, 'books.entry.document'))}</dt><dd><bdi>${esc(last.reading.number ?? '—')}</bdi></dd></div>
        <div class="row"><dt>${esc(t(locale, 'books.entry.date'))}</dt><dd>${last.reading.date ? esc(show.dateYear(locale, new Date(`${last.reading.date}T12:00:00Z`))) : '—'}</dd></div>
        <div class="row"><dt>${esc(t(locale, 'books.entry.total'))}</dt><dd>${last.reading.total ? money(locale, last.reading.total, last.reading.currency) : '—'}</dd></div>
      </dl>
      ${last.problems.map((x) => `<p class="perr" role="alert">${esc(problemText(locale, x))}</p>`).join('')}
      <p class="caption muted">${esc(t(locale, 'books.papers.readBy'))}</p>`;
  const draftable = last && last.outcome === 'read' && last.reading && last.problems.length === 0 && !last.entryId && owner(viewer);
  const form = !draftable || !last?.reading ? '' : `<div class="block" id="draft"><h2>${esc(t(locale, 'books.papers.draft'))}</h2>
      <p>${esc(t(locale, 'books.papers.draftExplain'))}</p>
      <form method="post" action="/app/books/papers/${esc(p.id)}/draft" class="pform"><input type="hidden" name="reading" value="${esc(last.id)}" />
        <label class="pq"><span>${esc(t(locale, 'books.entry.journal'))}</span>${pick('journal', c.journals, c.purchasesDefault, t(locale, 'books.entry.journal'))}</label>
        <label class="pq"><span>${esc(t(locale, 'books.papers.supplier'))}</span>${pick('party', c.parties, null, t(locale, 'books.papers.supplier'))}</label>
        <label class="pq"><span>${esc(t(locale, 'books.papers.payable'))}</span>${pick('payable', c.accounts, c.payableDefault, t(locale, 'books.papers.payable'))}</label>
        <div class="imp-table"><table><thead><tr><th scope="col">${esc(t(locale, 'books.entry.label'))}</th><th scope="col">${esc(t(locale, 'books.invoice.net'))}</th>
          <th scope="col">${esc(t(locale, 'books.entry.tax'))}</th><th scope="col">${esc(t(locale, 'books.entry.account'))}</th></tr></thead>
        <tbody>${last.reading.lines.map((l, i) => `<tr><td><bdi>${esc(l.label)}</bdi></td><td class="num">${money(locale, l.net, last.reading!.currency)}</td>
          <td><select name="tax${i}" aria-label="${esc(t(locale, 'books.entry.tax'))} ${i + 1}"><option value=""></option>${c.taxCodes.map((x) =>
            `<option value="${esc(x.id)}">${esc(x.code)} · ${esc(x.label)}</option>`).join('')}</select> ${money(locale, l.tax, last.reading!.currency)}</td>
          <td>${pick(`account${i}`, c.accounts, null, `${t(locale, 'books.entry.account')} ${i + 1}`)}</td></tr>`).join('')}</tbody></table></div>
        <button class="btn" type="submit">${esc(t(locale, 'books.entry.saveDraft'))}</button></form></div>`;
  const drafted = last?.entryId ? `<p><span class="pill ok">${esc(t(locale, 'books.papers.drafted'))}</span> <a href="/app/books/entries/${esc(last.entryId)}">${esc(t(locale, 'books.invoice.seeEntry'))}</a></p>` : '';
  const read = !owner(viewer) ? '' : !reader.available ? `<p class="caption muted">${esc(t(locale, 'books.papers.noReader'))}</p>`
    : !reader.canRead ? `<p class="caption muted">${esc(t(locale, 'books.papers.pdfNotRead'))}</p>`
    : `<form method="post" action="/app/books/papers/${esc(p.id)}/read" class="pform"><button class="btn ghost" type="submit">${esc(t(locale, last ? 'books.papers.readAgain' : 'books.papers.read'))}</button></form>`;
  // E3 (0207) — an import's source file kept as history: said for what it is, downloaded like any paper, never read
  // into an entry (the database refuses it too).
  const history = p.history ? `<p role="status"><span class="pill">${esc(t(locale, 'books.papers.history'))}</span></p>
    <p>${esc(t(locale, 'books.papers.historyExplain', { n: p.history.entries, through: show.dateYear(locale, new Date(`${p.history.through}T12:00:00Z`)) }))}</p>
    ${p.keepUntil ? `<p class="caption muted">${esc(t(locale, 'books.papers.keptUntil', { date: show.dateYear(locale, new Date(`${p.keepUntil}T12:00:00Z`)) }))}</p>` : ''}` : '';
  return `<h1 class="page"><bdi>${esc(p.name)}</bdi></h1>
    ${history}
    <ul class="scard dl-files"><li class="row"><span>${esc(t(locale, 'books.papers.original'))}</span>
      <a class="dl-get" href="/app/books/papers/${esc(p.id)}/file" download>${icon('download')}<span>${esc(t(locale, 'books.pack.download'))}</span></a></li></ul>
    ${p.history ? '' : `${read}${reading}${drafted}${form}`}
    <p><a class="deeper" href="/app/books/papers">${esc(t(locale, 'books.papers.title'))}</a></p>`;
}

