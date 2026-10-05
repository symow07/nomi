import { PHOSPHOR } from './phosphor.js';
import { SOLAR } from './solar.js';

/**
 * THE ICONS — ONE FAMILY, SOLAR'S LINEAR SET (the Solar run, 2026-10-05). The owner: "Move EVERY
 * remaining icon in the app from Phosphor to Solar Linear, so the whole app speaks one visual language —
 * same family, same weight, same roundness as the nav … Scale sensibly per context — an inline icon in a
 * row shouldn't be 28px — but the LINE WEIGHT must look visually equal to the nav's at whatever size it's
 * drawn. Optical consistency over identical numbers." The nav moved first (the Solar nav, PR 228); every
 * other icon follows here. (Before: Phosphor, the icons run of 2026-10-04; before that, lines drawn by hand.)
 *
 * The drawings are solar.ts, copied unchanged from the package by tools/icons.mjs (Solar by 480 Design,
 * CC BY 4.0, credited in NOTICE). Nothing is fetched and no font draws an icon: each is its drawing
 * inlined, a line in the colour its place gives it, and silent to a screen reader (the word beside it is
 * what is read). No emoji: V1 removed them because they drew differently on every device.
 *
 * THE LINE. Every Solar icon carries the class `sl`; the stylesheet draws its line at a fixed width on
 * screen whatever the icon's size (`vector-effect: non-scaling-stroke`), lighter as the icon gets smaller
 * so it reads at the nav's weight: 1.75 px from 23 px up (the nav's), 1.65 at 20 to 22, 1.6 at 18 to 19.5,
 * 1.5 at 17 and under — measured side by side with the nav's 28 px icons. Each place's size is its own rule.
 *
 * ONE MEANING, ONE SHAPE. Each id here is one meaning; two ids share a drawing only when they mean the
 * same thing (a sample is the gift in My business and on the calendar).
 *
 * HELD — the meanings Solar has no good drawing for keep Phosphor's (phosphor.ts) until the owner picks
 * among Solar's candidates (tools/icons.mjs, HELD; docs/PROGRESS.md lists them with their candidates).
 * Nothing loosely related stands in for them. The list does not grow.
 *
 * `FLIPS` — an icon that points (Log out's arrow, a reply's) is mirrored on a right-to-left page, as the
 * doors' carets are.
 */
type SolarName = keyof typeof SOLAR;

const ICON = {
  // The assistant's menu: what it can talk about, what it was taught, what it still needs, the words it never
  // uses, its name, one kind at a time, checking its work, Practice, what comes next, what changed.
  talk: 'chat-square-line', knowledge: 'notebook-minimalistic', question: 'question-circle', nope: 'forbidden-circle',
  name: 'user-id', sliders: 'tuning-2', check: 'check-circle', practice: 'play-circle', next: 'flag', history: 'history',
  // My business: the business, its products, what it promises, what it does, where customers reach it (and
  // each way: WhatsApp, Instagram and Messenger, e-mail), going live, the alerts, its terms, samples, the
  // exchange rate.
  business: 'shop', products: 'box', promise: 'shield-check', kind: 'case', reach: 'dialog', whatsapp: 'chat-round',
  meta: 'chat-square', email: 'letter', live: 'power', alerts: 'bell', terms: 'file-text', samples: 'gift',
  rate: 'transfer-horizontal',
  // Setup and Settings: getting started (the guide's videos), the checklist, the people, the sign-in,
  // billing, your data, logging out.
  guide: 'video-frame-play-horizontal', setup: 'checklist', people: 'users-group-two-rounded', account: 'key',
  billing: 'card', data: 'folder', logout: 'logout',
  // The pages: a file saved, a customer who keeps coming back, an empty calendar, a customer with no name yet,
  // what a customer sent that is not words (a file, a voice note, a photo), a door, the way back, closing.
  download: 'download-minimalistic', regular: 'repeat', calendar: 'calendar-minimalistic', person: 'user',
  file: 'paperclip', voice: 'microphone', photo: 'gallery', go: 'alt-arrow-right', back: 'alt-arrow-left', close: 'close',
  // A door that opens another site, in a new tab.
  external: 'arrow-right-up',
  // The calendar's kinds of date: a sample (the same gift as My business's samples), a price, a reply owed, a
  // follow-up, a conversation put away, the owner's own date, a promise.
  'date-sample': 'gift', 'date-price': 'tag', 'date-reply': 'reply', 'date-followup': 'restart', 'date-closed': 'archive',
  'date-own': 'pin', 'date-promise': 'quote',
} as const satisfies Readonly<Record<string, SolarName>>;

/**
 * HELD for the owner (2026-10-05): each kind of reply (a bulleted list), how it sells (a handshake), the
 * language (a translation mark), its price limits (coins), closed days and a closure on the calendar (a
 * calendar crossed out), this month (a month's grid — Solar's is the nav's Calendar), an order on its way
 * (a truck). Phosphor's drawing, as before, until the owner chooses.
 */
const HELD = {
  kinds: 'list-bullets', sell: 'handshake', language: 'translate', prices: 'coins', closures: 'calendar-x',
  month: 'calendar-dots', 'date-order': 'truck', 'date-closure': 'calendar-x',
} as const satisfies Readonly<Record<string, keyof typeof PHOSPHOR>>;

export type IconId = keyof typeof ICON | keyof typeof HELD;
export type DateIconId = Extract<IconId, `date-${string}`>;

const FLIPS: ReadonlySet<IconId> = new Set<IconId>(['logout', 'date-reply']);

/** A Solar drawing, inline: the place's class and `sl` (the line rule), a box `size` square. */
export const solarSvg = (className: string, name: SolarName, size = 24): string =>
  `<svg class="${className} sl" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" aria-hidden="true" focusable="false">${SOLAR[name]}</svg>`;

/**
 * An icon in its place. `className` is the place (the menus' is `ni`; a date's kind is `kind-icon`), and
 * the place's stylesheet gives the size and, through it, the line.
 */
export function icon(id: IconId, className = 'ni'): string {
  const cls = `${className}${FLIPS.has(id) ? ' flips' : ''}`;
  if (id in HELD) {
    const d = PHOSPHOR[HELD[id as keyof typeof HELD]][className === 'kind-icon' ? 'bold' : 'regular'];
    return `<svg class="${cls} held" viewBox="0 0 256 256" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }
  return solarSvg(cls, ICON[id as keyof typeof ICON]);
}

/**
 * THE RAIL'S ICONS (the Solar nav, PR 228). One drawing per entry, the same at rest and where you are: the
 * stylesheet draws it in ink, and in the deep magenta on the entry you are on (with the white pill and the
 * word in weight). Nothing in the rail is filled. The assistant's entry is not here: that slot is
 * `agentMark`. Drawn at 28 px, the nav's 1.75 px line.
 */
export type RailIcon = 'home-2' | 'inbox' | 'calendar' | 'settings' | 'users-group-rounded';
export const railIcon = (name: RailIcon): string => solarSvg('ni', name, 28);

/**
 * A door's caret and the way back's, in the brand like the door's words. One shape: `.go` mirrors it on a
 * right-to-left page, so › points onward and ‹ back in either direction.
 */
export const GO = `<span class="go" aria-hidden="true">${icon('go', 'gi')}</span>`;
export const BACK = `<span class="go" aria-hidden="true">${icon('back', 'gi')}</span>`;
/** A door to another site (it opens in a new tab): the arrow that leaves, where `↗` was a character. */
export const AWAY = `<span class="go ext" aria-hidden="true">${icon('external', 'gi')}</span>`;

/**
 * An icon as a stylesheet image, for a mark the stylesheet draws itself (the fold's caret): the drawing,
 * cut out of a box painted in the text's colour. A mask is an image, so its line is set in the drawing's
 * own units for the box it fills: `line` px at `size` px. Written out, not percent-encoded (the owner
 * surface bans the percent sign), as marks.ts writes its shapes.
 */
export const iconMask = (id: keyof typeof ICON, size: number, line: number): string => {
  const units = Number((line * 24 / size).toFixed(3));
  const body = SOLAR[ICON[id]].replace(/"/g, "'").replace(/stroke='currentColor'/g, "stroke='black'")
    .replace("stroke-width='1.5'", `stroke-width='${units}'`);
  const url = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'>${body}</svg>")`;
  return `-webkit-mask-image:${url}; mask-image:${url}; -webkit-mask-size:contain; mask-size:contain; `
    + '-webkit-mask-repeat:no-repeat; mask-repeat:no-repeat; -webkit-mask-position:center; mask-position:center;';
};
