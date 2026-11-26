/**
 * UI correction, Block 9 — F07: ONE filter toolbar for every filtered list.
 *
 * - Each field is a <label> that wraps its own words and its control, so the words can never be parted from the
 *   control they name: at 390 px the words sit on the line above it, on a desk they sit above it in the row.
 * - Every control and both actions are 44 px tall and the row aligns their bottom edges, so Search, the selects and
 *   "Show results" share one baseline.
 * - The search is always in view. The other filters sit in <details class="fbar-more" data-fbar>: open on a desk
 *   (its summary is not drawn there), and on a phone an explicit "Filters" button, with the number of filters on,
 *   that opens them. The page arrives with it open, so without the script nothing is hidden; the shared script
 *   (filters() in liveScript.ts) closes it on a narrow screen when no filter is on and opens it again on a wide one.
 * - "Show results" is a SECONDARY act (white with a hairline edge): the page's primary act is never the filter.
 */
import { esc } from './layout.js';
import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';

export interface FilterField {
  /** The words that name the control (already plain text; escaped here). */
  label: string;
  /** The control's markup: an <input>, a <select>, or a group of them. Never a <label>. */
  control: string;
  /** Extra class on the field (for a page's own width rules). */
  cls?: string;
}

export interface FilterBar {
  locale: Locale;
  action: string;
  /** The page's own class, kept so its existing hooks and tests still find the form. */
  cls?: string;
  /** What the form searches (its accessible name, role="search"). */
  name: string;
  /** The search field, always in view. */
  search?: FilterField;
  /** The other filters (selects, ranges): behind "Filters" on a phone. */
  fields?: readonly FilterField[];
  /** Hidden inputs carried with every search. */
  hidden?: string;
  submit: string;
  /** The way back to everything, when a filter or a search is on. */
  clear?: { href: string; label: string } | null;
  /** How many of `fields` are set to something other than "all". */
  active?: number;
  /** Anything that belongs on the same row after the actions (a door to an import, say). */
  extra?: string;
}

// The controls pass (2026-11-25): the search field carries its mark inside it (controlsStyle.ts, `.field-search`).
const field = (f: FilterField, q = false): string =>
  `<label class="fbar-f${q ? ' fbar-q' : ''}${f.cls ? ' ' + f.cls : ''}"><span class="fbar-l">${esc(f.label)}</span>${q ? `<span class="field-search">${f.control}</span>` : f.control}</label>`;

export function filterBar(o: FilterBar): string {
  const fields = o.fields ?? [];
  const active = o.active ?? 0;
  const more = fields.length
    ? `<details class="fbar-more" data-fbar data-fbar-on="${active}" open><summary class="fbar-toggle">${esc(t(o.locale, 'filters.more'))}${active ? ` <span class="fbar-n"><bdi>${active}</bdi></span>` : ''}</summary><div class="fbar-fields">${fields.map((f) => field(f)).join('')}</div></details>`
    : '';
  const clear = o.clear ? `<a class="fbar-clear" href="${esc(o.clear.href)}">${esc(o.clear.label)}</a>` : '';
  // The controls pass (2026-11-25): a bar that is only a search box searches on Enter, as Intercom's does; its button
  // stays in the form for a keyboard and a screen reader, out of sight, and its label is the box's accessible name.
  const alone = !fields.length && Boolean(o.search);
  return `<form method="get" action="${esc(o.action)}" class="fbar${alone ? ' fbar-alone' : ''}${o.cls ? ' ' + o.cls : ''}" role="search" aria-label="${esc(o.name)}">${o.hidden ?? ''}${o.search ? field(o.search, true) : ''}${more}<div class="fbar-acts"><button class="btn${alone ? ' find-quiet' : ''}" type="submit">${esc(o.submit)}</button>${clear}</div>${o.extra ?? ''}</form>`;
}
