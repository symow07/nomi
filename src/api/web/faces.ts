import { DESIGN_TOKENS } from '../../core/owner/tokens.js';
import { esc } from './layout.js';
import { icon } from './icons.js';

/**
 * THE WARMTH RUN (2026-10-03) — A CUSTOMER'S FACE, the one way it is drawn.
 *
 * The owner: "Real customer faces are the main source of colour and life."
 * Every page that names a customer beside a picture draws it here, so a face
 * is the same size, shape and colour on Today, in the Inbox, at the head of a
 * conversation, on the calendar and in the profile card.
 *
 *   - A photo where the channel gave one (Instagram, Messenger): kept by the
 *     product (`client_faces`, 0123), served from `/app/faces/:clientId` with
 *     its version in the address, so the browser keeps it until it changes.
 *     The page NEVER waits for a photo: the face is drawn from what the page's
 *     own query already knew (`photo`), and nothing is fetched from Meta while
 *     a page renders (the fetching is a background job, `src/worker/faces.ts`).
 *   - A coloured initial otherwise (e-mail; WhatsApp, whose Cloud API gives no
 *     photo): the first letter of the name, on one of eight tints chosen by
 *     the customer's id, so a customer keeps their colour everywhere.
 *   - A photo that fails to load is dropped silently by the page's script and
 *     the initial under it shows (`img` sits ON the initial, never instead).
 *
 * The face says nothing a screen reader needs: the name beside it does. It is
 * `aria-hidden`, and the name is always written next to it or in the link's
 * own label.
 */

export type FaceSize = 'xs' | 's' | 'm' | 'l' | 'xl';
/** 24 · 32 · 40 · 56 · 96 px — a calendar line, a band, a row, the face row, the card. */
export const FACE_PX: Readonly<Record<FaceSize, number>> = { xs: 24, s: 32, m: 40, l: 56, xl: 96 };

export type FaceOf = {
  readonly clientId: string;
  /** What the owner sees as their name: a display name, an @handle, a number, an address. */
  readonly name: string | null;
  /** The photo's version (`client_faces.version`) when one is on record; null draws the initial. */
  readonly photo?: string | null;
};

/** One of the eight tints, by the customer's id: the same customer, the same colour, on every page. */
export function tintOf(clientId: string): number {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  return (h % DESIGN_TOKENS.faceTint.length) + 1;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The first letter of the name, as a reader would pick it: past an @, a +, a
 * quotation mark or a space; a whole character (an accented letter, a Chinese
 * character, an Arabic letter in its own form), upper-cased where the script
 * has case. A name with no letter (a number, nothing) has no initial: the
 * face draws a person's outline instead.
 */
export function initialOf(name: string | null): string | null {
  if (!name) return null;
  // The warmth run's re-audit (w4-whole-20) — an Arabic name's article (ال) is
  // not its initial: "الشركة المتحدة" is ش, not a bare alef that reads as a bar.
  const text = name.normalize('NFC').trim().replace(/^ال(?=\p{L})/u, '');
  for (const { segment } of segmenter.segment(text)) {
    if (/\p{L}/u.test(segment)) return segment.toLocaleUpperCase();
  }
  return null;
}

/**
 * A person's outline, for a customer with no name yet (a number on WhatsApp).
 * The Solar run (2026-10-05): Solar's person, at 1.4em of the face's size, its
 * line the one for the size it is drawn at (layout.ts); Phosphor's, bold, before.
 */
const OUTLINE = icon('person', 'fi');

/** Where a customer's photo is served from; `v` changes when the photo does. */
export const faceSrc = (clientId: string, version: string): string =>
  `/app/faces/${encodeURIComponent(clientId)}?v=${encodeURIComponent(version)}`;

/**
 * The face. `extra` is a class the page adds for its own placement (never a
 * colour: the tint is the face's). Always `aria-hidden`: the name is said
 * beside it.
 */
export function face(who: FaceOf, size: FaceSize = 'm', extra = ''): string {
  const initial = initialOf(who.name);
  const ground = `<span class="face-i">${initial ? esc(initial) : OUTLINE}</span>`;
  const photo = who.photo
    ? `<img class="face-p" src="${esc(faceSrc(who.clientId, who.photo))}" alt="" width="${FACE_PX[size]}" height="${FACE_PX[size]}" loading="lazy" decoding="async">`
    : '';
  return `<span class="face face-${size} t${tintOf(who.clientId)}${extra ? ` ${esc(extra)}` : ''}" aria-hidden="true">${ground}${photo}</span>`;
}

/**
 * THE PROFILE CARD'S DOOR (phase 3). A face, or a face with a name, that
 * opens the customer's card: with the page's script, the card springs up over
 * the page (a bottom sheet on a phone); without it, the link goes to the
 * card's own page, which is the same card. `label` is what a screen reader
 * hears for the link — the customer's name, and anything the page adds.
 */
export const cardHref = (clientId: string): string => `/app/customers/${encodeURIComponent(clientId)}`;

export function faceLink(who: FaceOf, opts: {
  readonly size?: FaceSize;
  /** Inner HTML drawn after the face (already escaped by the caller): a name, a word. */
  readonly after?: string;
  /** What the link says to a screen reader when `after` does not say it. */
  readonly label?: string;
  readonly className?: string;
} = {}): string {
  const label = opts.label ? ` aria-label="${esc(opts.label)}"` : '';
  return `<a class="face-link${opts.className ? ` ${esc(opts.className)}` : ''}" href="${cardHref(who.clientId)}" data-card${label}>`
    + `${face(who, opts.size ?? 'm')}${opts.after ?? ''}</a>`;
}
