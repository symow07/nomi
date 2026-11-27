import { type Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { booksMay, type Viewer } from '../../core/conversation/people.js';
import { FIELD_APPLIES, FIELD_KINDS, type BooksField, type CustomValues } from '../../core/books/interchange.js';
import type { FieldRow } from '../../db/booksFields.js';
import { t } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import { pageHead, setSection, setRow, setNotice, rowAction, searchList, listRow } from './settingsPage.js';

/**
 * D7 (Phase 5, item 9) — THE OWNER'S CUSTOM FIELDS ON THE PAGE: the list (the accountant sees it), a new one, a
 * field retired and used again — the owner's. And the pieces the forms share: one input per field, and the values
 * shown where they are.
 */
type Who = Viewer & { readonly kind?: 'team' | 'accountant' };
const owner = (v: Who) => booksMay({ id: v.id ?? '', name: '', ...v }, 'post');
const word = (locale: Locale, k: string) => t(locale, k as MessageKey);

export function renderFields(locale: Locale, viewer: Who, rows: readonly FieldRow[]): string {
  // Rule 104: a row's act is sent at once, in its own small form; retiring asks first (it stops new values).
  const row = (f: FieldRow) => `<li class="row"${listRow(`${f.label} ${f.appliesTo}.${f.key}`)}>
      <span><bdi>${esc(f.label)}</bdi> <span class="caption muted"><bdi>${esc(`${f.appliesTo}.${f.key}`)}</bdi> · ${esc(word(locale, `books.fields.applies.${f.appliesTo}`))} · ${
        esc(word(locale, `books.fields.kind.${f.kind}`))}${f.choices ? ` · <bdi>${esc(f.choices.join(' | '))}</bdi>` : ''}</span>${
        f.required ? ` <span class="pill">${esc(t(locale, 'books.fields.required'))}</span>` : ''}${
        f.inUse ? '' : ` <span class="pill warn">${esc(t(locale, 'books.fields.retired'))}</span>`}</span>
      ${!owner(viewer) ? '' : rowAction({ action: `/app/books/fields/${f.id}/${f.inUse ? 'retire' : 'use'}`, label: t(locale, f.inUse ? 'books.fields.retire' : 'books.fields.useAgain'),
        confirm: f.inUse ? t(locale, 'setBooks.fields.retireAsk', { field: f.label }) : undefined })}</li>`;
  // The list's own "Add": a form of always-visible fields, sent by its verb. Choices shows only for "One of a list".
  const add = !owner(viewer) ? '' : setSection({ id: 'new-field', title: t(locale, 'books.fields.add'), help: t(locale, 'books.fields.lede'), rows:
    `<form method="post" action="/app/books/fields" class="bk-form">${
      setRow(locale, { label: t(locale, 'books.fields.appliesTo'), forId: 'bf-on', control: `<select id="bf-on" name="appliesTo" required>${FIELD_APPLIES.map((a) =>
        `<option value="${a}">${esc(word(locale, `books.fields.applies.${a}`))}</option>`).join('')}</select>` })}${
      setRow(locale, { label: t(locale, 'books.fields.label'), forId: 'bf-label', control: '<input id="bf-label" name="label" required maxlength="80" />' })}${
      setRow(locale, { label: t(locale, 'books.fields.key'), forId: 'bf-key', desc: t(locale, 'books.fields.keyHint'),
        control: '<input id="bf-key" name="key" required maxlength="40" pattern="[a-z][a-z0-9_]{0,39}" dir="ltr" />' })}${
      setRow(locale, { label: t(locale, 'books.fields.kindOf'), forId: 'bf-kind', control: `<select id="bf-kind" name="kind" required>${FIELD_KINDS.map((k) =>
        `<option value="${k}">${esc(word(locale, `books.fields.kind.${k}`))}</option>`).join('')}</select>` })}
      <div class="bf-choices">${setRow(locale, { label: t(locale, 'books.fields.choices'), forId: 'bf-choices', desc: t(locale, 'books.fields.choicesHint'),
        control: '<textarea id="bf-choices" name="choices" rows="3" maxlength="2000"></textarea>' })}</div>
      <div class="bf-required"><label class="check"><input type="checkbox" name="required" value="1" aria-describedby="bf-required-hint" /> <span>${esc(t(locale, 'books.fields.required'))}</span></label>
          <p class="caption muted" id="bf-required-hint">${esc(t(locale, 'books.fields.requiredHint'))}</p></div>
      <div class="bk-acts"><button class="btn send" type="submit">${esc(t(locale, 'books.fields.add'))}</button></div>
    </form>` });
  return pageHead(t(locale, 'books.fields.title'), t(locale, 'setBooks.fields.lede'))
    + (rows.length === 0 ? `<p class="muted">${esc(t(locale, 'books.fields.none'))}</p>` : searchList(locale, `<ul class="rows">${rows.map(row).join('')}</ul>`))
    + setNotice({ text: t(locale, 'books.fields.travel') })
    + add;
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
    return o.bare ? `<td data-label="${esc(f.label)}">${input}</td>` : `<label class="pq"><span><bdi>${esc(f.label)}</bdi></span>${input}</label>`;
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
