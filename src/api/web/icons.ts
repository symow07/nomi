/**
 * THE WARMTH RUN (2026-10-03), phase 1 — the rail's icons, and the settings
 * menu's. The owner: "Give each rail item an icon so the eye catches shape,
 * not text."
 *
 * Drawn here, by hand, as lines in the text's own colour: no icon font, no
 * emoji (V1 removed 🏠 💬 👩 🏭 because they drew differently on every device
 * and sat badly beside Arabic), nothing fetched. Each is 24 units square, one
 * stroke weight; the active entry's icon is drawn heavier by the stylesheet.
 * Every icon is `aria-hidden`: the word beside it is what is read.
 *
 * `flips` — an icon that points (Log out's arrow) is mirrored on a
 * right-to-left page, as the "›" doors are.
 */
export type IconId = 'today' | 'customers' | 'inbox' | 'calendar' | 'assistant' | 'settings' | 'business' | 'setup' | 'logout'
  // Phase 7 — the assistant's menu.
  | 'talk' | 'book' | 'question' | 'nope' | 'check' | 'play' | 'flag' | 'history' | 'tag'
  // Phase 7 — the rows of My business and Setup.
  | 'chat' | 'power' | 'box' | 'coins' | 'shield' | 'receipt' | 'gift' | 'exchange'
  | 'bell' | 'globe' | 'person' | 'key' | 'card' | 'folder' | 'guide'
  | DateIconId;

/**
 * THE WARMTH RUN, phase 6 — the KIND of a date on the calendar, one icon each:
 * a sample (a parcel), an order (a van), a price (a tag), a reply owed (a
 * speech bubble), a follow-up (a turning arrow), a closure (a crossed-out
 * day), a closed conversation (a box put away), the owner's own date (a pin),
 * a promise (quotation marks). Drawn as the rail's are; colour stays the
 * signals' (✓ ○ ✕ ✦), never the kind's.
 */
export type DateIconId = 'date-sample' | 'date-order' | 'date-price' | 'date-reply' | 'date-followup'
  | 'date-closure' | 'date-closed' | 'date-own' | 'date-promise';

const PATHS: Readonly<Record<IconId, string>> = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  customers: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.9-3.5 3.5-5.5 6.5-5.5s5.6 2 6.5 5.5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.8c2 .7 3.4 2.4 4 5.2"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5L14 16h-4l-1.5-2.5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  assistant: '<path d="M11 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5z"/><path d="M19 15c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  business: '<path d="M4.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-8.5"/><path d="M3 9 5 4h14l2 5c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3S3 10.7 3 9z"/><path d="M10 20.5v-5h4v5"/>',
  setup: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.5 6.5 1.4 1.4L7.5 5.3M3.5 12l1.4 1.4 2.6-2.6"/><circle cx="5.3" cy="17.5" r="1.4"/>',
  logout: '<path d="M13.5 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7"/><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  // Phase 7 — the assistant's menu: what it can talk about (a speech bubble),
  // what it was taught (an open book), what it still needs (a question), the
  // words it never uses (a circle struck through), checking its work, Practice
  // (play), what comes next (a flag), what changed (a clock turning back), and
  // what you sell (a price tag). None of them points, so none is mirrored.
  talk: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 1-1.5 1.5h-8L6.5 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6.5A1.5 1.5 0 0 1 5 5z"/><path d="M8 9.5h8M8 12.5h5"/>',
  book: '<path d="M12 6.5C10.2 5.2 7.7 4.5 4.5 4.5v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2z"/><path d="M12 6.5v13"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.7v.4"/><path d="M12 16.8v.1"/>',
  nope: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 8.8v6.4l5-3.2z"/>',
  flag: '<path d="M5.5 20.5v-16"/><path d="M5.5 5h11.5l-2.3 3.8L17 12.5H5.5"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7"/><path d="M12 8v4.3l2.8 1.7"/>',
  tag: '<path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
  'date-sample': '<path d="M3.75 8.25 12 3.75l8.25 4.5v7.5L12 20.25l-8.25-4.5z"/><path d="M3.75 8.25 12 12.75l8.25-4.5M12 12.75v7.5"/>',
  'date-order': '<path d="M2.5 6.5h11.5v9.5H2.5z"/><path d="M14 9.5h4.25l3.25 3.25v3.25H14z"/><circle cx="6.5" cy="17.25" r="1.9"/><circle cx="17.5" cy="17.25" r="1.9"/>',
  'date-price': '<path d="M12.75 3.75h7.5v7.5l-9 9-7.5-7.5z"/><circle cx="16.25" cy="7.75" r="1.1"/>',
  'date-reply': '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 19.75V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z"/>',
  'date-followup': '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 3.75v3.75h-3.75"/>',
  'date-closure': '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M9.5 12.75l5 5M14.5 12.75l-5 5"/>',
  'date-closed': '<rect x="3" y="4.5" width="18" height="5" rx="1.5"/><path d="M4.5 9.5V18a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V9.5M9.75 13.5h4.5"/>',
  'date-own': '<path d="M12 21s-6.5-5.75-6.5-10.75a6.5 6.5 0 0 1 13 0C18.5 15.25 12 21 12 21z"/><circle cx="12" cy="10.25" r="2.25"/>',
  'date-promise': '<path d="M4.5 14.25c0-3.75 1.5-6 4.5-7.5M4.5 14.25h4v4.5h-4zM13.5 14.25c0-3.75 1.5-6 4.5-7.5M13.5 14.25h4v4.5h-4z"/>',
  // Phase 7 — My business: the kind, where customers write, answering them,
  // the products, their price limits, what is promised, how it is sold (and,
  // a level down, its questions, samples and the rate).
  chat: '<path d="M4.5 5h15A1.5 1.5 0 0 1 21 6.5V16a1.5 1.5 0 0 1-1.5 1.5H11L6.5 21v-3.5h-2A1.5 1.5 0 0 1 3 16V6.5A1.5 1.5 0 0 1 4.5 5z"/>',
  power: '<path d="M12 3v8"/><path d="M7.2 6.2a7.5 7.5 0 1 0 9.6 0"/>',
  box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
  coins: '<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  receipt: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>',
  gift: '<rect x="4" y="8.5" width="16" height="4" rx="1"/><path d="M5.5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-6.5M12 8.5v12"/><path d="M12 8.5C11 5.5 7 4.5 7 7s5 1.5 5 1.5zM12 8.5c1-3 5-4 5-1.5s-5 1.5-5 1.5z"/>',
  exchange: '<path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5"/><path d="M20 16H6M9.5 12.5 6 16l3.5 3.5"/>',
  // Phase 7 — Setup: alerts, language, the people, the sign-in, billing, the
  // data, and getting started (the guide's videos).
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  folder: '<path d="M3.5 6.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5V9a1.5 1.5 0 0 0-1.5-1.5h-7L10 5H5a1.5 1.5 0 0 0-1.5 1.5z"/>',
  guide: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5v7l5.5-3.5z"/>',
};

const FLIPS: ReadonlySet<IconId> = new Set(['logout']);

/** `className` is the page's own placement for it (the rail's and the menu's is `ni`; a date's kind is `kind-icon`). */
export function icon(id: IconId, className = 'ni'): string {
  return `<svg class="${className}${FLIPS.has(id) ? ' flips' : ''}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[id]}</svg>`;
}
