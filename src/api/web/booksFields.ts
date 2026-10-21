import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { FIELD_APPLIES, FIELD_KINDS, type BooksField, type CustomValues } from '../../core/books/interchange.js';
import type { FieldRow } from '../../db/booksFields.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';

/**
 * D7 (Phase 5, item 9) — THE OWNER'S CUSTOM FIELDS ON THE PAGE: the list (the accountant sees it), a new one, a
 * field retired and used again — the owner's. And the pieces the forms share: one input per field, and the values
 * shown where they are.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const word = (locale: Locale, k: string) => t(locale, k as MessageKey);

export function renderFields(locale: Locale, viewer: Who, rows: readonly FieldRow[]): string {
  const row = (f: FieldRow) => `<li class="row">
      <span><bdi>${esc(f.label)}</bdi> <span class="caption muted"><bdi>${esc(`${f.appliesTo}.${f.key}`)}</bdi> · ${esc(word(locale, `books.fields.applies.${f.appliesTo}`))} · ${
        esc(word(locale, `books.fields.kind.${f.kind}`))}${f.choices ? ` · <bdi>${esc(f.choices.join(' | '))}</bdi>` : ''}</span>${
        f.required ? ` <span class="pill">${esc(t(locale, 'books.fields.required'))}</span>` : ''}${
        f.inUse ? '' : ` <span class="pill warn">${esc(t(locale, 'books.fields.retired'))}</span>`}</span>
      ${!owner(viewer) ? '' : `<form method="post" action="/app/books/fields/${esc(f.id)}/${f.inUse ? 'retire' : 'use'}" class="pform">
        <button class="btn ghost" type="submit">${esc(t(locale, f.inUse ? 'books.fields.retire' : 'books.fields.useAgain'))}</button></form>`}</li>`;
  const add = !owner(viewer) ? '' : `<div class="block" id="new-field"><h2>${esc(t(locale, 'books.fields.add'))}</h2>
      <form method="post" action="/app/books/fields" class="pform">
        <label class="pq"><span>${esc(t(locale, 'books.fields.appliesTo'))}</span><select name="appliesTo" required>${FIELD_APPLIES.map((a) =>
          `<option value="${a}">${esc(word(locale, `books.fields.applies.${a}`))}</option>`).join('')}</select></label>
        <label class="pq"><span>${esc(t(locale, 'books.fields.label'))}</span><input name="label" required maxlength="80" /></label>
        <label class="pq"><span>${esc(t(locale, 'books.fields.key'))}</span><input name="key" required maxlength="40" pattern="[a-z][a-z0-9_]{0,39}" dir="ltr" />
          <span class="caption muted">${esc(t(locale, 'books.fields.keyHint'))}</span></label>
        <label class="pq"><span>${esc(t(locale, 'books.fields.kindOf'))}</span><select name="kind" required>${FIELD_KINDS.map((k) =>
          `<option value="${k}">${esc(word(locale, `books.fields.kind.${k}`))}</option>`).join('')}</select></label>
        <label class="pq"><span>${esc(t(locale, 'books.fields.choices'))}</span><textarea name="choices" rows="3" maxlength="2000"></textarea>
          <span class="caption muted">${esc(t(locale, 'books.fields.choicesHint'))}</span></label>
        <label class="pq"><span><input type="checkbox" name="required" value="1" /> ${esc(t(locale, 'books.fields.required'))}</span>
          <span class="caption muted">${esc(t(locale, 'books.fields.requiredHint'))}</span></label>
        <button class="btn" type="submit">${esc(t(locale, 'books.fields.add'))}</button>
      </form></div>`;
  return `<h1 class="page">${esc(t(locale, 'books.fields.title'))}</h1>
    <p class="lede">${esc(t(locale, 'books.fields.lede'))}</p>
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.fields.none'))}</p>` : `<ul class="rows">${rows.map(row).join('')}</ul>`}
    ${add}
    <p class="caption muted">${esc(t(locale, 'books.fields.travel'))}</p>
    <p><a class="deeper" href="/app/books">${esc(t(locale, 'books.workbook.again'))}</a></p>`;
}

/** One input per field of this kind of row, named `<prefix><key>`, holding `values` (a form sent back keeps them). */
export function customInputs(locale: Locale, fields: readonly BooksField[], applies: BooksField['appliesTo'], prefix: string,
  values: Readonly<Record<string, string>>, o: { readonly bare?: boolean; readonly n?: number } = {}): string {
  return fields.filter((f) => f.appliesTo === applies).map((f) => {
    const name = `${prefix}${f.key}`;
    const label = o.n === undefined ? f.label : `${f.label} ${o.n}`;
    const v = esc(values[name] ?? '');
    const input = f.kind === 'choice'
      ? `<select name="${esc(name)}" aria-label="${esc(label)}"${f.required ? ' required' : ''}><option value=""></option>${(f.choices ?? []).map((c) =>
        `<option${values[name] === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`
      : `<input name="${esc(name)}" value="${v}" aria-label="${esc(label)}"${f.required ? ' required' : ''}${
        f.kind === 'date' ? ' type="date"' : f.kind === 'number' ? ' inputmode="decimal" dir="ltr"' : ' maxlength="500"'} />`;
    return o.bare ? `<td>${input}</td>` : `<label class="pq"><span><bdi>${esc(f.label)}</bdi></span>${input}</label>`;
  }).join('');
}

/** The header cells for the line fields of a form's table. */
export const customHeads = (fields: readonly BooksField[], applies: BooksField['appliesTo']): string =>
  fields.filter((f) => f.appliesTo === applies).map((f) => `<th scope="col"><bdi>${esc(f.label)}</bdi></th>`).join('');

/** Values shown as "Label: value", by the field's label where it is still known (a date in the page's language). */
export function customShown(locale: Locale, fields: readonly BooksField[], applies: BooksField['appliesTo'], values: CustomValues | undefined): string {
  return Object.entries(values ?? {}).map(([k, v]) => {
    const f = fields.find((x) => x.appliesTo === applies && x.key === k);
    const shown = f?.kind === 'date' ? show.dateYear(locale, new Date(`${v}T12:00:00Z`)) : v;
    return `<bdi>${esc(f?.label ?? k)}</bdi>: <bdi>${esc(shown)}</bdi>`;
  }).join(' · ');
}
