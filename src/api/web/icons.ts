import { PHOSPHOR } from './phosphor.js';

/**
 * THE ICONS (the icons run, 2026-10-04). The owner: "Move the whole app to one
 * crafted, consistent icon family … Match icon stroke weight to the adjacent
 * text weight … Size icons up slightly so they balance the labels." The
 * family is Phosphor (phosphor.ts, copied from the package by tools/icons.mjs;
 * MIT, assets/icons/PHOSPHOR-LICENSE.txt). It replaced the line drawings the
 * warmth run made by hand here, which were one 1.8-unit stroke scaled to five
 * sizes, so their lines ran from 1.05 to 2.11 px on screen.
 *
 * Nothing is fetched and no font draws an icon: each is its drawing inlined,
 * filled in the colour of the words beside it, and silent to a screen reader
 * (the word beside it is what is read). No emoji: V1 removed them because
 * they drew differently on every device and sat badly beside Arabic.
 *
 * THE WEIGHT IS CHOSEN BY THE WORDS BESIDE IT. A Phosphor line is 16 units of
 * 256 in regular and 24 in bold, so at a size it is a known width. Measured on
 * the served Noto files, a 15 px label at 500 has stems of 1.5 to 1.6 px:
 * regular at 24 px (1.5 px) beside it. A 13 px label, or bold words, take bold
 * at a smaller size (bold at 16 px is 1.5 px). Each place's size is its
 * stylesheet's; the weight is the caller's `weight`.
 *
 * ONE MEANING, ONE SHAPE. The hand-drawn set reused a drawing for unrelated
 * rows (the sliders for Settings and "One kind at a time", the calendar for
 * Calendar and "This month") and drew near-copies for different things (the
 * cube, the turning arrow, the circled play). Each id here is one meaning.
 *
 * `FLIPS` — an icon that points (Log out's arrow, a reply's) is mirrored on a
 * right-to-left page, as the doors' carets are.
 */
type Drawings = typeof PHOSPHOR;
type PhosphorName = keyof Drawings;
/** The icons drawn in both line weights (tools/icons.mjs, `LINES`). */
type Lined = { [K in PhosphorName]: Drawings[K] extends { readonly regular: string; readonly bold: string } ? K : never }[PhosphorName];
export type Weight = 'regular' | 'bold';

const ICON = {
  // The assistant's menu: what it can talk about, what it was taught, what it still needs, the words it never
  // uses, its name, each kind of reply, one kind at a time, checking its work, Practice, this month, what comes
  // next, what changed.
  talk: 'chat-text', knowledge: 'book-open', question: 'question', nope: 'prohibit', name: 'identification-badge',
  kinds: 'list-bullets', sliders: 'sliders-horizontal', check: 'check-circle', practice: 'play-circle',
  month: 'calendar-dots', next: 'flag', history: 'clock-counter-clockwise',
  // My business: the business, how it sells, its products, what it promises, what it does, where customers reach
  // it (and each way: WhatsApp, Instagram and Messenger, e-mail), going live, its price limits, the alerts, its
  // terms, samples, closed days, the exchange rate.
  business: 'storefront', sell: 'handshake', products: 'package', promise: 'shield-check', kind: 'briefcase',
  reach: 'chats', whatsapp: 'chat-circle', meta: 'chat-teardrop', email: 'envelope-simple', live: 'power',
  prices: 'coins', alerts: 'bell', terms: 'file-text', samples: 'gift', closures: 'calendar-x', rate: 'arrows-left-right',
  // Setup and Settings: getting started (the guide's videos), the checklist, the language, the people, the
  // sign-in, billing, your data, logging out.
  guide: 'monitor-play', setup: 'list-checks', language: 'translate', people: 'users-three', account: 'key',
  billing: 'credit-card', data: 'folder', logout: 'sign-out',
  // The pages: a file saved, a customer who keeps coming back, an empty calendar, a customer with no name yet,
  // what a customer sent that is not words (a file, a voice note, a photo), a door, the way back, closing.
  download: 'download-simple', regular: 'repeat', calendar: 'calendar-blank', person: 'user',
  file: 'paperclip', voice: 'microphone', photo: 'image', go: 'caret-right', back: 'caret-left', close: 'x',
  // A door that opens another site, in a new tab.
  external: 'arrow-up-right',
  // The calendar's kinds of date: a sample (the same gift as My business's samples), an order on its way, a
  // price, a reply owed, a follow-up, a closure, a conversation put away, the owner's own date, a promise.
  'date-sample': 'gift', 'date-order': 'truck', 'date-price': 'tag', 'date-reply': 'arrow-bend-up-left',
  'date-followup': 'arrow-clockwise', 'date-closure': 'calendar-x', 'date-closed': 'archive', 'date-own': 'push-pin',
  'date-promise': 'quotes',
} as const satisfies Readonly<Record<string, Lined>>;

export type IconId = keyof typeof ICON;
export type DateIconId = Extract<IconId, `date-${string}`>;

const FLIPS: ReadonlySet<IconId> = new Set<IconId>(['logout', 'date-reply']);

const svg = (className: string, d: string): string =>
  `<svg class="${className}" viewBox="0 0 256 256" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

/**
 * An icon in the weight its place takes. `className` is the place (the rail's
 * and the menus' is `ni`; a date's kind is `kind-icon`), and the place's
 * stylesheet gives the size.
 */
export function icon(id: IconId, className = 'ni', weight: Weight = 'regular'): string {
  const d = (PHOSPHOR[ICON[id]] as Readonly<Record<Weight, string>>)[weight];
  return svg(`${className}${FLIPS.has(id) ? ' flips' : ''}`, d);
}

/** A drawing by Phosphor's own name and weight, where a place needs one no meaning above names (the rail). */
export function drawn<N extends PhosphorName>(name: N, weight: keyof Drawings[N], className = 'ni'): string {
  return svg(className, (PHOSPHOR[name] as Readonly<Record<string, string>>)[weight as string]!);
}

/**
 * The rail's entries (not the assistant's: that slot is `agentMark`). An
 * outline at rest; FILLED on the entry you are on — a filled icon means "you
 * are here", and nothing else in the rail is filled.
 */
export type RailIcon = 'sun' | 'tray' | 'calendar-blank' | 'gear-six';
export const railIcon = (name: RailIcon, here: boolean): string => drawn(name, here ? 'fill' : 'regular');

/**
 * A door's caret and the way back's, in the brand like the door's words, bold
 * (the doors' words are 500 to 600). One shape: `.go` mirrors it on a
 * right-to-left page, so › points onward and ‹ back in either direction.
 */
export const GO = `<span class="go" aria-hidden="true">${icon('go', 'gi', 'bold')}</span>`;
export const BACK = `<span class="go" aria-hidden="true">${icon('back', 'gi', 'bold')}</span>`;
/** A door to another site (it opens in a new tab): the arrow that leaves, where `↗` was a character. */
export const AWAY = `<span class="go ext" aria-hidden="true">${icon('external', 'gi', 'bold')}</span>`;

/**
 * An icon as a stylesheet image, for a mark the stylesheet draws itself (the
 * fold's caret): the drawing, cut out of a box painted in the text's colour.
 * Written out, not percent-encoded (the owner surface bans the percent sign),
 * as marks.ts writes its shapes.
 */
export const iconMask = (id: IconId, weight: Weight): string => {
  const url = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><path d='${
    (PHOSPHOR[ICON[id]] as Readonly<Record<Weight, string>>)[weight]}'/></svg>")`;
  return `-webkit-mask-image:${url}; mask-image:${url}; -webkit-mask-size:contain; mask-size:contain; `
    + '-webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; -webkit-mask-position:center; mask-position:center;';
};
