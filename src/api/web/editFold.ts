import { esc } from './layout.js';
import { t } from './say.js';
import { cardActs } from './rows.js';
import type { Locale } from '../../core/owner/i18n/locale.js';

/**
 * UI correction, Block 9 — F10 "Read, create and edit tasks are concatenated". A record reads first: each independent
 * part shows its values in a short list, and its form opens on purpose behind its own "Change …" fold, with the part's
 * own Save and a Cancel beside it. The fold is open at rest only when the part still needs something or a save of it was
 * refused (the submission is kept in the form). Cancel (shown by the page's script, data-edit-cancel) puts the form back
 * as it was drawn, closes the fold and returns focus to its summary; Escape inside an open fold closes it and keeps what
 * was typed. Without the script the summary opens and closes the fold, and the form saves as before.
 */

/** One value of the summary: its name, and the value already escaped ('' reads "Not given yet"). */
export type Fact = readonly [label: string, valueHtml: string];

export const factList = (locale: Locale, facts: readonly Fact[]): string =>
  `<dl class="ef-sum">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value
    || `<span class="muted">${esc(t(locale, 'edit.notGiven'))}</span>`}</dd></div>`).join('')}</dl>`;

/** The part's fold: closed at rest unless `open`; the body is the part's whole form. */
export const editFold = (change: string, open: boolean, body: string): string =>
  `<details class="ef-fold" data-edit${open ? ' open' : ''}><summary>${esc(change)}</summary>${body}</details>`;

/** The part's acts: its own Save (what it saves, in its words) and a Cancel beside it. */
export const editActs = (locale: Locale, save: string, primary = false): string =>
  cardActs(`<button class="btn ${primary ? 'send' : 'second'}" type="submit">${esc(save)}</button><button class="btn ghost" type="button" data-edit-cancel hidden>${esc(t(locale, 'common.cancel'))}</button>`);

/** A record's part: its heading, its values, and the fold that changes them. */
export const editSection = (o: { readonly id: string; readonly title: string; readonly facts: string; readonly fold: string; readonly lede?: string }): string =>
  `<section class="sgroup ef" id="${esc(o.id)}"><h2 class="sgroup-h">${esc(o.title)}</h2>${o.lede ?? ''}${o.facts}${o.fold}</section>`;
