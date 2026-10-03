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
  // Phase 4 — the Inbox's mark on a regular: a customer who keeps coming back.
  | 'regular';

const PATHS: Readonly<Record<IconId, string>> = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  customers: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.9-3.5 3.5-5.5 6.5-5.5s5.6 2 6.5 5.5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.8c2 .7 3.4 2.4 4 5.2"/>',
  regular: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5L14 16h-4l-1.5-2.5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  assistant: '<path d="M11 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5z"/><path d="M19 15c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  business: '<path d="M4.5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-8.5"/><path d="M3 9 5 4h14l2 5c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3S3 10.7 3 9z"/><path d="M10 20.5v-5h4v5"/>',
  setup: '<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.5 6.5 1.4 1.4L7.5 5.3M3.5 12l1.4 1.4 2.6-2.6"/><circle cx="5.3" cy="17.5" r="1.4"/>',
  logout: '<path d="M13.5 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7"/><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>',
};

const FLIPS: ReadonlySet<IconId> = new Set(['logout']);

export function icon(id: IconId): string {
  return `<svg class="ni${FLIPS.has(id) ? ' flips' : ''}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[id]}</svg>`;
}
