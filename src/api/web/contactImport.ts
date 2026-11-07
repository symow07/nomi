import type {
  ContactImportColumns, ContactImportConfirmResult, ContactImportFileRefusal, ContactImportPreview, ImportedContact,
} from '../../core/onboard/setupMinutes.js';
import { CONTACT_IMPORT_COLUMNS } from '../../core/onboard/setupMinutes.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { flashBanner, type Flash } from './flash.js';
import { esc, back, deeper } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';

export type ContactImportPageOptions = { readonly flash?: Flash | null };
export type ContactImportUploadOptions = ContactImportPageOptions & {
  readonly problem?: { readonly source: 'file' | 'paste'; readonly reason: ContactImportFileRefusal } | null;
  /** Submitted paste, retained only for this response; never a Shopify credential. */
  readonly text?: string;
};
export type ContactImportColumnsOptions = ContactImportPageOptions & {
  readonly problem?: ContactImportFileRefusal | null;
};

/**
 * Route-facing signatures and form contract.
 * Owner-only routes supply fragments to shell; each renderer supplies one h1.
 * POST /app/customers/import: multipart `file` OR urlencoded `text` (separate forms).
 * POST /app/customers/import/:id/columns: name, phone, language, notes (indexes or ''), header=on.
 * POST /app/customers/import/:id/confirm: repeated `rows` = selected one-based source record numbers.
 * POST /app/customers/import/:id/select: selection=all|none, same review form; stores selection only.
 * POST /app/customers/import/:id/discard: no customer fields; deletes the staged import.
 * GET /app/customers/import/:id is Check; /:id/columns is Columns.
 */
const HOME = '/app/customers/import';
const at = (id: string) => `${HOME}/${encodeURIComponent(id)}`;
const words = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) =>
  `<bdi lang="en" dir="ltr">${esc(show.isolateFigures(locale, t('en', key, params)))}</bdi>`;
const raw = (text: string | null) => `<bdi dir="auto">${esc(text ?? '')}</bdi>`;
const frame = (locale: Locale, title: MessageKey, options: ContactImportPageOptions, body: string, step?: number) =>
  `<section class="contact-import">${back('/app/customers', t('en', 'contactImport.customers'))}${flashBanner(options.flash ?? null)}
    <header><h1 class="page">${words(locale, title)}</h1>${step ? `<p class="caption">${words(locale, 'contactImport.step', { n: show.count(locale, step) })}</p>` : ''}</header>${body}</section>`;
const error = (locale: Locale, reason: ContactImportFileRefusal, id: string) =>
  `<p id="${id}" class="perr" role="alert">${words(locale, `contactImport.refused.${reason}`)}</p>`;
const columnsHeader = (locale: Locale, selection = false) => `<thead><tr>${selection ? '<th></th>' : ''}${CONTACT_IMPORT_COLUMNS.map(key =>
  `<th scope="col">${words(locale, `contactImport.columns.${key}`)}</th>`).join('')}</tr></thead>`;
const notes = (text: string | null) => text && text.length > 80
  ? `<details class="ci-notes"><summary>${raw(text.slice(0, 80))}…</summary>${raw(text)}</details>` : raw(text);
const contactCells = (locale: Locale, contact: ImportedContact) =>
  `<td class="ci-name">${contact.name ? raw(contact.name) : words(locale, 'contactImport.check.unnamed')}</td>
   <td class="ci-phone"><bdi dir="ltr">${esc(`+${contact.phone}`)}</bdi></td><td class="ci-language">${raw(contact.language)}</td><td class="ci-notes-cell">${notes(contact.notes)}</td>`;

export function renderContactImportUpload(locale: Locale, options: ContactImportUploadOptions = {}): string {
  const failed = (source: 'file' | 'paste') => options.problem?.source === source;
  return frame(locale, 'contactImport.title', options, `<p>${words(locale, 'contactImport.intro')}</p>
    <p>${words(locale, 'contactImport.example')}</p><pre dir="ltr">name,phone,language,notes\nAvery Example,+12025550101,en,Ask about blue.</pre><p>${words(locale, 'contactImport.phoneHint')}</p>
    <form method="post" action="${HOME}" enctype="multipart/form-data" class="ci-form">
      <label for="contact-file">${words(locale, 'contactImport.file')}</label>
      <input id="contact-file" type="file" name="file" accept=".csv,.tsv,.txt,.xlsx"${failed('file') ? ' aria-invalid="true" aria-describedby="contact-file-error" autofocus' : ''}>
      ${failed('file') ? error(locale, options.problem!.reason, 'contact-file-error') : ''}
      <button class="btn send" type="submit">${words(locale, 'contactImport.read')}</button></form>
    <form method="post" action="${HOME}" class="ci-form"><label for="contact-text">${words(locale, 'contactImport.paste')}</label>
      <textarea id="contact-text" name="text" rows="6" dir="auto"${failed('paste') ? ' aria-invalid="true" aria-describedby="contact-paste-error" autofocus' : ''}>${esc(options.text ?? '')}</textarea>
      ${failed('paste') ? error(locale, options.problem!.reason, 'contact-paste-error') : ''}
      <button class="btn" type="submit">${words(locale, 'contactImport.read')}</button></form>`, 1);
}

export function renderContactImportColumns(view: ContactImportColumns, locale: Locale, options: ContactImportColumnsOptions = {}): string {
  const width = view.rows.reduce((n, row) => Math.max(n, row.length), view.headers.length);
  const fields = CONTACT_IMPORT_COLUMNS.map(key => `<label for="contact-column-${key}">${words(locale, `contactImport.columns.${key}`)}</label>
    <select id="contact-column-${key}" name="${key}"${key === 'phone' && options.problem ? ' aria-invalid="true" aria-describedby="contact-columns-error"' : ''}${key === 'phone' && options.problem === 'no_phone_column' ? ' autofocus' : ''}>
      <option value="">${esc(t('en', 'contactImport.columns.none'))}</option>${Array.from({ length: width }, (_, i) => {
        const label = view.hasHeader && view.headers[i] ? view.headers[i]! : t('en', 'contactImport.columns.numbered', { n: show.count(locale, i + 1) });
        return `<option value="${i}"${view.mapping[key] === i ? ' selected' : ''}>${esc(show.isolate(locale, label))}</option>`;
      }).join('')}</select>`).join('');
  const sample = view.rows.slice(0, 3).map(row => `<tr>${CONTACT_IMPORT_COLUMNS.map(key => {
    const column = view.mapping[key];
    return `<td class="ci-${key}">${raw(column === null ? '' : row[column] ?? '')}</td>`;
  }).join('')}</tr>`).join('');
  return frame(locale, 'contactImport.columns.title', options, `<form method="post" action="${at(view.importId)}/columns" class="ci-form">
    <div class="ci-columns">${fields}</div>${options.problem ? error(locale, options.problem, 'contact-columns-error') : ''}
    <label class="ci-check"><input type="checkbox" name="header" value="on"${view.hasHeader ? ' checked' : ''}>${words(locale, 'contactImport.columns.header')}</label>
    <h2 id="contact-preview-title">${words(locale, 'contactImport.columns.preview')}</h2>
    <table class="ci-table" aria-labelledby="contact-preview-title">${columnsHeader(locale)}<tbody>${sample}</tbody></table>
    <div class="ci-actions"><button class="btn send" type="submit">${words(locale, 'contactImport.continue')}</button>${back(HOME, t('en', 'contactImport.back'))}</div></form>`, 2);
}

export function renderContactImportCheck(view: ContactImportPreview, locale: Locale, options: ContactImportPageOptions = {}): string {
  const counts = view.counts;
  const heading = (kind: 'toAdd' | 'existing' | 'refused', n: number) => `<h2 id="contact-${kind}">${words(locale, `contactImport.check.${kind}`)} <span class="ci-count">${esc(show.count(locale, n))}</span></h2>`;
  const empty = `<p class="muted">${words(locale, 'contactImport.check.empty')}</p>`;
  const additions = view.rows.flatMap(row => row.verdict.kind !== 'to_add' ? [] : [`<tr><td class="ci-tick"><label class="ci-check">
    <input type="checkbox" name="rows" value="${row.row}"${row.verdict.selected ? ' checked' : ''} aria-label="${esc(t('en', 'contactImport.check.select', { n: show.count(locale, row.row) }))}"></label></td>${contactCells(locale, row.verdict.contact)}</tr>`]).join('');
  const existing = view.rows.flatMap(row => row.verdict.kind !== 'existing' ? [] : [`<li><p>${raw(row.raw.name || row.raw.phone)}</p>
    <p>${words(locale, 'contactImport.check.onRecord', { name: row.verdict.customer.name ?? t('en', 'contactImport.check.unnamed') })}</p></li>`]).join('');
  const refusals = view.rows.flatMap(row => {
    if (row.verdict.kind !== 'refused' && row.verdict.kind !== 'duplicate_in_file') return [];
    const reason = row.verdict.kind === 'refused' ? row.verdict.reason : 'duplicate_in_file';
    return [`<li><p>${words(locale, 'contactImport.check.row', { n: show.count(locale, row.row) })}</p><div>${notes(CONTACT_IMPORT_COLUMNS.map(k => row.raw[k]).join(' · '))}</div>
      <p>${words(locale, `contactImport.refused.row.${reason}`, row.verdict.kind === 'duplicate_in_file' ? { n: show.count(locale, row.verdict.firstRow) } : undefined)}</p></li>`];
  }).join('');
  return frame(locale, 'contactImport.check.title', options, `<p>${words(locale, 'contactImport.check.summary', {
    rows: show.count(locale, counts.total), add: show.count(locale, counts.toAdd), existing: show.count(locale, counts.existing), refused: show.count(locale, counts.refused + counts.duplicateInFile),
  })}</p><form method="post" action="${at(view.importId)}/confirm">
    <section aria-labelledby="contact-toAdd">${heading('toAdd', counts.toAdd)}<div class="ci-actions">
      <button class="btn" type="submit" formaction="${at(view.importId)}/select" name="selection" value="all">${words(locale, 'contactImport.check.tickAll')}</button>
      <button class="btn" type="submit" formaction="${at(view.importId)}/select" name="selection" value="none">${words(locale, 'contactImport.check.untickAll')}</button></div>
      ${additions ? `<table class="ci-table ci-selectable" aria-labelledby="contact-toAdd">${columnsHeader(locale, true)}<tbody>${additions}</tbody></table>` : empty}</section>
    <section aria-labelledby="contact-existing">${heading('existing', counts.existing)}<p>${words(locale, 'contactImport.check.existingWhy')}</p>${existing ? `<ul class="ci-rows">${existing}</ul>` : empty}</section>
    <section aria-labelledby="contact-refused">${heading('refused', counts.refused + counts.duplicateInFile)}${refusals ? `<ul class="ci-rows">${refusals}</ul>` : empty}</section>
    <p>${words(locale, 'contactImport.check.deleted')}</p><button class="btn send" type="submit">${words(locale, 'contactImport.add')}</button>
    </form><div class="ci-actions">${back(`${at(view.importId)}/columns`, t('en', 'contactImport.back'))}
      <form method="post" action="${at(view.importId)}/discard"><button class="btn" type="submit" data-confirm="${esc(t('en', 'contactImport.discard.confirm'))}">${words(locale, 'contactImport.discard')}</button></form></div>`, 3);
}

/** Optional terminal fragment for a direct confirmation response; routes may instead flash + redirect. */
export function renderContactImportDone(result: ContactImportConfirmResult, locale: Locale, options: ContactImportPageOptions = {}): string {
  return frame(locale, 'contactImport.done.title', options, `<p>${words(locale, result.added === 1 ? 'contactImport.flash.added.one' : 'contactImport.flash.added.other', { n: show.count(locale, result.added) })}</p>
    <p>${words(locale, 'contactImport.done.counts', { existing: show.count(locale, result.existing), skipped: show.count(locale, result.notSelected), refused: show.count(locale, result.refused + result.duplicateInFile) })}</p>
    ${result.newlyMatched ? `<p>${words(locale, 'contactImport.done.matched', { n: show.count(locale, result.newlyMatched) })}</p>` : ''}${deeper('/app/customers', t('en', 'contactImport.customers'))}`);
}
