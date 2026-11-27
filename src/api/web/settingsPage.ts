import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';
import { t } from './say.js';
import { fieldRow, type FieldRow } from './rows.js';

/**
 * THE SETTINGS OVERHAUL (2026-11-27, the owner's decision; rule 104) — ONE PAGE TEMPLATE. Every settings page is made
 * of the parts in this file and nothing else, so the 23 pages read as one product:
 *
 *   1. `pageHead`     the title, which IS the menu label word for word, and ONE line under it;
 *   2. `setSection`   a heading and rows; a row (`setRow`) is a label with at most one line of help on the start side
 *                     and its control on the end side, stacked on a phone; fields are always visible;
 *   3. `setNotice`    a safety or honesty line, on the page, beside what it is about;
 *   4. `saveForm` + `saveActs`   the page's ONE Save, at the end of the form, with Cancel; never sticky;
 *   5. `dangerZone`   last on the page: each row says in one line what happens, and asks before acting.
 *
 * THE ONE SAVING RULE (the owner's condition 2): anything inside a table or list ROW acts at once, in its own small
 * form (`rowAction`, `rowSwitch`), asking first when it is risky; FIELDS wait for Save. A form drawn with `saveForm`
 * is watched by the page's script (liveScript.ts `unsaved`): leaving with a changed field asks first, in the
 * browser's own words.
 *
 * Lists: `searchList` gives a list over ten rows its search box and shows 25 at a time; `pickList` + `pickField` are
 * a searchable choice among many (a chart of accounts), its options written ONCE per page.
 *
 * Styles: settingsAreaStyle.ts ("the settings page template"). The gallery (components.ts) draws every part.
 */

/** The page's one Save is labelled with this key in every language: plain "Save". */
export const SAVE_KEY = 'autonomy.save' satisfies MessageKey;

/** 1 · The title (the menu label, word for word) and one line that says what the page controls. */
export const pageHead = (title: string, lede?: string | null): string =>
  `<h1 class="page">${esc(title)}</h1>${lede ? `<p class="lede set-lede">${esc(lede)}</p>` : ''}`;

/**
 * 2 · A row: `fieldRow` with the template's "Needed" mark — the field setup is still waiting for — in place of a
 * sentence. `desc` is the row's ONE line of help.
 */
export const setRow = (locale: Locale, r: FieldRow & { readonly needed?: boolean }): string =>
  fieldRow(r.needed ? { ...r, mark: t(locale, 'set.needed') } : r);

/** 2 · A section: its heading, at most one line of help, and its rows (or any list or table of the page). */
export const setSection = (o: {
  readonly title: string; readonly rows: readonly string[] | string;
  readonly help?: string | undefined; readonly id?: string | undefined;
}): string =>
  `<section class="set-sec"${o.id ? ` id="${esc(o.id)}"` : ''}><h2 class="set-h">${esc(o.title)}</h2>${o.help ? `<p class="set-help">${esc(o.help)}</p>` : ''}<div class="set-rows">${typeof o.rows === 'string' ? o.rows : o.rows.join('')}</div></section>`;

/**
 * 3 · A safety or honesty line, ON the page beside what it concerns (never only in help). `text` is plain words;
 * `html` is for a line that carries a value already escaped. On its end side: a door (`door`), or an act already
 * drawn (`act`: a `rowAction`).
 */
export const setNotice = (o: {
  readonly text?: string; readonly html?: string; readonly id?: string | undefined;
  readonly door?: { readonly href: string; readonly label: string } | undefined; readonly act?: string | undefined;
}): string =>
  `<p class="set-note"${o.id ? ` id="${esc(o.id)}"` : ''}><span>${o.html ?? esc(o.text ?? '')}</span>${o.door
    ? `<a href="${esc(o.door.href)}">${esc(o.door.label)}</a>` : ''}${o.act ?? ''}</p>`;

/**
 * 4 · The form the page's ONE Save sends. `data-save` is what the page's script watches for unsaved changes.
 * Row forms (`rowAction`, `rowSwitch`) are never drawn inside it: a form cannot hold a form. Draw the page's tables
 * and its danger zone after it.
 */
export const saveForm = (action: string, inner: string, o: { readonly id?: string; readonly files?: boolean } = {}): string =>
  `<form method="post" action="${esc(action)}" class="set-form" data-save${o.id ? ` id="${esc(o.id)}"` : ''}${o.files ? ' enctype="multipart/form-data"' : ''}>${inner}</form>`;

/** 4 · Save and Cancel, at the END of the form. Cancel puts the form back as the page drew it (a reset). Not sticky. */
export const saveActs = (locale: Locale): string =>
  `<div class="set-save"><button class="btn send" type="submit">${esc(t(locale, SAVE_KEY))}</button><button class="btn" type="reset">${esc(t(locale, 'common.cancel'))}</button></div>`;

const hiddenFields = (h: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(h ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`).join('');
/** The product's one way of asking first: the question on the button (the shell's dialog; the browser's with no script). */
const asks = (confirm: string | undefined): string =>
  confirm ? ` onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(confirm)}"` : '';

/**
 * An act inside a table or list row: its own small POST form with one button, sent at once. `confirm` asks first
 * (give it for anything risky); `danger` draws the button as one that removes.
 */
export const rowAction = (o: {
  readonly action: string; readonly label: string; readonly confirm?: string | undefined; readonly danger?: boolean;
  readonly hidden?: Readonly<Record<string, string>>;
  /** The button's own name and value, where the route reads which button was pressed. */
  readonly name?: string; readonly value?: string;
  /** Said to a screen reader where the visible word alone ("Remove") does not say of what. */
  readonly ariaLabel?: string | undefined;
}): string =>
  `<form method="post" action="${esc(o.action)}" class="set-act">${hiddenFields(o.hidden)}<button class="btn${o.danger ? ' danger' : ''}" type="submit"${o.name
    ? ` name="${esc(o.name)}" value="${esc(o.value ?? '')}"` : ''}${o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : ''}${asks(o.confirm)}>${esc(o.label)}</button></form>`;

/**
 * An on/off switch inside a row: a real button (`role="switch"`) in its own POST form, sent at once. The form sends
 * `name` (default "on") with the state to switch TO: "1" to turn on, "0" to turn off (or `values`). `label` names
 * what is switched, for a screen reader; the words On / Off are drawn beside it.
 */
export const rowSwitch = (locale: Locale, o: {
  readonly action: string; readonly on: boolean; readonly label: string; readonly confirm?: string | undefined;
  readonly name?: string; readonly values?: readonly [on: string, off: string];
  readonly hidden?: Readonly<Record<string, string>>; readonly disabled?: boolean;
}): string => {
  const [toOn, toOff] = o.values ?? ['1', '0'];
  return `<form method="post" action="${esc(o.action)}" class="set-act">${hiddenFields(o.hidden)}<input type="hidden" name="${esc(o.name ?? 'on')}" value="${esc(o.on ? toOff : toOn)}" />`
    + `<button class="set-switch" type="submit" role="switch" aria-checked="${o.on ? 'true' : 'false'}" aria-label="${esc(o.label)}"${o.disabled ? ' disabled' : ''}${asks(o.confirm)}><span class="set-track" aria-hidden="true"></span><span class="set-state">${esc(t(locale, o.on ? 'followUp.on' : 'followUp.off'))}</span></button></form>`;
};

/** 5 · One row of the danger zone: what the action is, what happens in one line, and its button, which asks first. */
export type DangerRow = {
  readonly title: string; readonly what: string; readonly action: string; readonly verb: string; readonly confirm: string;
  readonly hidden?: Readonly<Record<string, string>>; readonly id?: string;
};
const dangerRow = (r: DangerRow): string =>
  `<div class="set-danger-row"${r.id ? ` id="${esc(r.id)}"` : ''}><div class="fr-l"><span class="fr-name">${esc(r.title)}</span><span class="fr-desc">${esc(r.what)}</span></div>${rowAction({ action: r.action, label: r.verb, confirm: r.confirm, danger: true, ...(r.hidden ? { hidden: r.hidden } : {}) })}</div>`;
/** 5 · The danger zone: the LAST section of the page. A row may also be drawn by the page (a string) where it needs a field. */
export const dangerZone = (locale: Locale, rows: readonly (DangerRow | string)[]): string => rows.length === 0 ? '' :
  `<section class="set-sec" id="danger-zone"><h2 class="set-h">${esc(t(locale, 'set.danger'))}</h2><div class="set-danger">${rows.map((r) => typeof r === 'string' ? r : dangerRow(r)).join('')}</div></section>`;

/**
 * A list with search. `body` is the page's own table or list; each of its rows carries `listRow()` (the words the
 * search reads default to the row's text). Over ten rows the script shows the search box and 25 rows at a time behind
 * "Show more"; without script, or with ten rows or fewer, every row is simply on the page.
 */
export const searchList = (locale: Locale, body: string, o: { readonly label?: string; readonly step?: number } = {}): string => {
  const label = o.label ?? t(locale, 'set.search');
  return `<div class="set-list" data-list="${o.step ?? 25}"><label class="set-find" data-list-find hidden><span class="sr">${esc(label)}</span><input type="search" data-list-q placeholder="${esc(label)}" autocomplete="off" /></label>${body}`
    + `<p class="set-none muted" data-list-none hidden>${esc(t(locale, 'set.noMatch'))}</p><button class="btn" type="button" data-list-more hidden>${esc(t(locale, 'set.showMore'))}</button></div>`;
};
/** The attribute a row of a `searchList` carries; `words` (optional) is what the search reads in place of the row's text. */
export const listRow = (words?: string): string => ` data-row${words === undefined ? '' : `="${esc(words)}"`}`;

/**
 * A searchable choice among many (a chart of 872 accounts). The options are written ONCE per page (`pickList`); each
 * field (`pickField`) is a text box that completes from them. What the form sends is the option's LABEL, the words
 * the person saw and chose; the route maps it back with `picked`. Labels must therefore be unique in a list (an
 * account's number and name are).
 */
export type PickOption = { readonly value: string; readonly label: string };
export const pickList = (id: string, options: readonly PickOption[]): string =>
  `<datalist id="${esc(id)}">${options.map((o) => `<option value="${esc(o.label)}"></option>`).join('')}</datalist>`;
export const pickField = (locale: Locale, o: {
  readonly id: string; readonly name: string; readonly list: string; readonly current: PickOption | null;
  readonly required?: boolean; readonly invalid?: string;
}): string =>
  `<input class="set-pick" type="text" id="${esc(o.id)}" name="${esc(o.name)}" list="${esc(o.list)}" value="${esc(o.current?.label ?? '')}" placeholder="${esc(t(locale, 'set.pick'))}" autocomplete="off" dir="auto"${o.required ? ' required' : ''}${o.invalid ?? ''} />`;
/**
 * What a `pickField` sent, as an option: the option whose label was sent (or, from an older form, whose value was);
 * `null` when the field was left empty; `undefined` when the words match no option (say so under the field).
 */
export const picked = (options: readonly PickOption[], sent: string | undefined): PickOption | null | undefined => {
  const words = (sent ?? '').trim();
  if (words === '') return null;
  return options.find((o) => o.label === words) ?? options.find((o) => o.value === words)
    ?? options.find((o) => o.label.toLowerCase() === words.toLowerCase());
};
