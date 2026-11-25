import { esc } from './layout.js';

/**
 * UI correction, Block 9 — F47 "Empty, unavailable and complete states are inconsistent". A page that has nothing to
 * list, nothing matching, something on its way, a fault, a part kept for someone else, or a feature this installation
 * does not offer says WHICH of those it is: a heading of its own, one short sentence of why, and one next step. The
 * kinds read differently on purpose, so an owner can tell "nothing yet" from "nothing matches" from "not here".
 *
 *   empty       — nothing recorded yet; the next step is where it starts.
 *   nomatch     — there is something, but not for this search or view; the next step widens it.
 *   loading     — on its way; announced politely, no next step but to wait (the page's script draws the answer in).
 *   error       — it did not work; what was kept, and how to try again.
 *   forbidden   — the part is someone else's to decide; who, and where to go instead.
 *   unavailable — this installation does not offer it (yet); nothing is pretended, and where to go instead.
 *
 * A missing figure is never drawn as zero here: a state block replaces a list or a feature, never an amount.
 */
export const STATE_KINDS = ['empty', 'nomatch', 'loading', 'error', 'forbidden', 'unavailable'] as const;
export type StateKind = (typeof STATE_KINDS)[number];

export interface StateWords {
  /** The state's own heading, in the page's language. */
  readonly heading: string;
  /** One short sentence (or two): why it is so. */
  readonly body: string;
  /** The one next step, already drawn: a link (a.deeper) or a button. Omitted only for `loading`. */
  readonly nextHtml?: string;
}

/** A link as the next step, in the product's door style. */
export const stateNext = (href: string, label: string): string => `<a class="deeper" href="${esc(href)}">${esc(label)}</a>`;

export const stateBlock = (kind: StateKind, w: StateWords, o: { readonly level?: 2 | 3; readonly id?: string } = {}): string => {
  const h = `h${o.level ?? 2}`;
  // a search's answer and a wait are announced when they arrive; the others are the page itself
  const role = kind === 'nomatch' || kind === 'loading' ? ' role="status"' : '';
  return `<section class="state" data-state="${kind}"${o.id ? ` id="${esc(o.id)}"` : ''}${role}>`
    + `<${h} class="state-h">${esc(w.heading)}</${h}><p class="state-p">${esc(w.body)}</p>`
    + (w.nextHtml ? `<p class="state-next">${w.nextHtml}</p>` : '') + `</section>`;
};
