import { esc } from './layout.js';

/**
 * PHASE 3 OF THE UI REBUILD (2026-10-02) — a setting is a row, not a stack of
 * paragraphs. On a wide screen: what the setting is (its name, one line under
 * it where there is one) on the line's start side, its control on the end
 * side. On a phone the two stack, name first. Rows sit in cards, one card per
 * labelled group, as on Setup itself; a settings form has ONE save, in a bar
 * that stays at the foot of the screen while the form scrolls.
 */
export type FieldRow = {
  readonly label: string;
  /** The control's id, so the name is its label; absent for a row that only shows a value. */
  readonly forId?: string | undefined;
  readonly desc?: string | undefined;
  /** The control (or the value), already escaped. */
  readonly control: string;
  /** The field's own error, already escaped (`role="alert"`), under the control. */
  readonly error?: string | undefined;
};

export const fieldRow = (r: FieldRow): string =>
  `<div class="setrow${r.error ? ' bad' : ''}"><div class="fr-l">${r.forId
    ? `<label class="fr-name" for="${esc(r.forId)}">${esc(r.label)}</label>`
    : `<span class="fr-name">${esc(r.label)}</span>`}${r.desc ? `<span class="fr-desc">${esc(r.desc)}</span>` : ''}</div>
    <div class="fr-c">${r.control}${r.error ?? ''}</div></div>`;

/** A labelled group: one card of rows. The title is optional for a page with one group. */
export const rowsCard = (title: string | null, rows: readonly string[], id?: string): string =>
  `<section class="sgroup"${id ? ` id="${esc(id)}"` : ''}>${title ? `<h2 class="sgroup-h">${esc(title)}</h2>` : ''}<div class="scard">${rows.join('')}</div></section>`;

/** The one save of a settings form. */
export const saveBar = (label: string): string =>
  `<div class="savebar"><button class="btn send" type="submit">${esc(label)}</button></div>`;

/**
 * PHASE 6 OF THE UI REBUILD (2026-10-02) — A FORM SENT BACK. A refusal that is
 * about one field is said under that field, on the same page, with everything
 * typed still in the form; it was a notice at the top of the page after a
 * redirect that emptied the form.
 */
export type Kept = { readonly values: Readonly<Record<string, string>>; readonly field: string; readonly text: string };
/** What was typed in `name`, escaped for an attribute; '' when nothing was kept. */
export const keptValue = (k: Kept | null | undefined, name: string): string => esc(k?.values[name] ?? '');
/** The field's own error, when it is the one that was wrong. */
export const keptError = (k: Kept | null | undefined, field: string, id: string): string | undefined =>
  k && k.field === field ? `<span class="fielderr" role="alert" id="${esc(id)}">${esc(k.text)}</span>` : undefined;
/** The control's attributes when it is the one that was wrong: marked, described, and where the cursor goes. */
export const keptInvalid = (k: Kept | null | undefined, field: string, id: string): string =>
  k && k.field === field ? ` aria-invalid="true" aria-describedby="${esc(id)}" autofocus` : '';

/** The act at the end of a card that adds something (a closure, a word): inside the card, not a bar. */
export const cardActs = (inner: string): string => `<div class="fr-acts">${inner}</div>`;
