import { BUSINESS_KINDS, TEAM_SIZES, CHANNELS_USED, countryOptions } from '../../core/owner/business.js';
import { zoneChoices, zoneLabelsAmong } from '../../core/owner/zones.js';
import { asksCurrency, currencyLabel, CURRENCY_CHOICES } from '../../core/owner/currencies.js';
import { type Locale, dirOf, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { type MessageKey, ASSISTANT_FALLBACK } from '../../core/owner/i18n/messages.js';
import { t, assistantName, assistantsAreSeveral, businessName, needsYouCount, tn } from './say.js';
import { cssVariables } from '../../core/owner/css.js';
import { DESIGN_TOKENS } from '../../core/owner/tokens.js';
import { isolate } from './values.js';
import { markDetail, markSmall, faviconDataUri } from '../../core/owner/brand.js';
import { INSTALL_LINKS } from './phone.js';
import { createHash } from 'node:crypto';
import { LIVE_SCRIPT } from './liveScript.js';
import { TYPE_CSS, TYPE_ZH_CSS, typeSetFor, fontAt } from './type.js';
import { icon, type IconId } from './icons.js';

/**
 * M9.1 + ADR-0008 — The command-center shell (pure HTML), now locale-aware
 * (en/zh/ar) with RTL for Arabic and a language switcher. Owner language only.
 *
 * Phase A introduced the owner-facing brand "Nomi" while internal identifiers
 * kept the name `yiwuflow`. That split is reversed (B1): there is one name now.
 * The i18n KEYS are English-keyed by ADR-0008 and were never affected either
 * way — no owner-facing string ever contained the old name.
 */

/**
 * Nomi navigation — four destinations, one per question an owner has:
 * what needs me now (Today), who is talking to us (Buyers), how is she doing
 * (小雅), and what does she know about my business (My factory).
 *
 * Everything else is reached FROM one of these, never from a permanent slot:
 * conversations from Buyers, results from Today, practice and the go-live
 * runbook from My factory. Every one of those routes still works — this moved
 * the door, not the room.
 *
 * No icons. These carried 🏠 💬 👩 🏭, which rendered differently on every
 * device, sat badly next to Arabic, and were the loudest thing in a shell whose
 * whole argument is restraint. The words already say what the pictures gestured
 * at. The field is DELETED rather than blanked, so nothing can quietly put one
 * back for a single destination.
 */
export const NAV: readonly { readonly href: string; readonly id: string }[] = [
  { href: '/app',           id: 'home' },
  { href: '/app/inbox',     id: 'inbox' },
  // THE WARMTH RUN (2026-10-03), phase 1 — the rail is exactly: Today;
  // Customers, with Inbox and Calendar under it; the assistant, by the name the
  // business gave it; Settings. My business and Setup are rows of Settings, and
  // Log out is the foot of Settings, not of the rail.
  { href: '/app/calendar',  id: 'calendar' },
  { href: '/app/employee',  id: 'employee' },
  { href: '/app/settings',  id: 'settings' },
];

/**
 * THE WARMTH RUN — each entry's shape (icons.ts), so the eye finds it before
 * the word. The comment above (V1) took the emoji away for good reasons that
 * still hold: these are drawn by the product, in the text's colour, the same
 * on every device and beside every script.
 */
export const NAV_ICON: Readonly<Record<string, IconId>> = {
  home: 'today', inbox: 'inbox', calendar: 'calendar', employee: 'assistant', settings: 'settings',
};

/**
 * Reached from a surface above rather than the nav. Nothing here was removed.
 *
 * EACH ROUTE NAMES THE PAGE THAT LINKS TO IT, and the integration walk asserts
 * the link is actually there. It used to be a flat list with the hub written in
 * a trailing comment and the walk hardcoding `r !== '/app/conversations' && r
 * !== '/app/analytics'` — so a route reached from anywhere but My factory had
 * to be added to an exclusion list by hand, and one that was forgotten would be
 * asserted against the wrong page. The comment is now the data.
 *
 * D — the drawer split. What you SELL sits under My business; how the assistant
 * BEHAVES under the assistant's own entry; how the installation is WIRED under
 * Setup. URLs did not move: `/app/settings/terms` is still where it was, it is
 * reached from My business now. A group marked `outreach` exists only for a
 * workspace whose outreach area is switched on (`isOutreachRoute` below).
 */
export const CONTEXTUAL_ROUTES_BY_HUB: readonly {
  readonly hub: string; readonly routes: readonly string[]; readonly outreach?: true;
}[] = [
  // THE WARMTH RUN, phase 7 — My business is a menu: each row opens a page
  // that already owned its part (the profile, the kind, the products, the
  // price limits) or a screen of its own a level down.
  { hub: '/app/business', routes: [
    '/app/settings/profile', '/app/settings/business', '/app/business/channels', '/app/business/ready',
    '/app/products', '/app/business/prices', '/app/business/promises', '/app/business/how-you-sell',
  ] },
  // …How you sell is a menu of its own: the questions, then the same facts changed directly.
  { hub: '/app/business/how-you-sell', routes: [
    '/app/business/selling', '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate',
  ] },
  // …and the channels have ONE home, Where customers reach you: each of its rows opens Channels.
  { hub: '/app/business/channels', routes: ['/app/channels'] },
  // THE WARMTH RUN, phase 7 — the assistant's page is a menu: each row opens
  // a screen of its own (employee.ts `EMPLOYEE_SCREENS`; "check its work" is a
  // row only while a check waits, so it is not walked from here).
  { hub: '/app/employee', routes: ['/app/knowledge', '/app/settings/forbidden', '/app/sandbox',
    '/app/employee/talk', '/app/employee/learning', '/app/employee/name', '/app/employee/replies',
    '/app/employee/one-kind', '/app/employee/month', '/app/employee/next', '/app/employee/history'] },
  // M38 — everyone the assistant may write to, reached from the list of
  // everyone who wrote. A — that list is Buyers now (it was Customers).
  { hub: '/app/inbox', routes: ['/app/contacts'], outreach: true },
  // THE WARMTH RUN — My business is a row of Settings now, and the pages
  // reached from it follow it there (the map chains).
  { hub: '/app/settings', routes: ['/app/business', '/app/settings/setup'] },
  // Phase 7 — Setup is how the app is wired for the owner: getting started,
  // what is checked before going live, alerts, the language; the account.
  { hub: '/app/settings/setup', routes: [
    '/app/guide', '/app/onboarding', '/app/settings/alerts', '/app/settings/language',
    '/app/settings/people', '/app/settings/account', '/app/settings/billing', '/app/settings/data',
  ] },
  // Phase 3 of the UI rebuild — the component gallery (`/app/settings/components`)
  // is no longer a door on Setup: it is a page for whoever builds the product
  // (the screenshots tool walks it), not a setting. It still lights Setup, by
  // sitting under its address.
  // Phase 4b — the machine room was reached from Getting ready. Phase 9: no
  // owner's page links to it any more (it is the operator's, by its address),
  // so it is not a contextual route of any hub; it lights nothing.
  { hub: '/app/onboarding', routes: ['/app/ready'] },
  // C4.b — follow-ups are written for the people on her list, so they are
  // reached from it.
  { hub: '/app/contacts', routes: ['/app/sequences', '/app/prospects'], outreach: true },
  { hub: '/app', routes: ['/app/analytics'] },
];

/**
 * A (2026-09-28) — an address that is another page now. Customers
 * (`/app/conversations`) merged into Buyers: the address answers with a
 * redirect to the one list (app.ts), and the buyer's own pages beneath it
 * (`/app/conversations/:id`) did not move — the URLs of pages do not move
 * (`docs/IA-PROPOSAL.md`) — and belong to Buyers, which `hubFor` reads here.
 */
export const MERGED_INTO_BUYERS = '/app/conversations';

export const CONTEXTUAL_ROUTES: readonly string[] =
  CONTEXTUAL_ROUTES_BY_HUB.flatMap((g) => g.routes);

/**
 * D — the outreach area, by address. Everything under these answers 404 for a
 * workspace whose area is off, and nothing links there. One list, read by the
 * gate in app.ts and by the tests that walk every page for stray links.
 */
export const OUTREACH_PREFIXES: readonly string[] = [
  '/app/contacts', '/app/prospects', '/app/sequences', '/app/channels/outreach',
];
export const isOutreachRoute = (url: string): boolean => {
  const path = url.split('?')[0] ?? url;
  return OUTREACH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
};

/**
 * The one "go deeper" link. Phase F: every surface used to grow its own — .more,
 * .fmore, .link, a bare <a> — so the same affordance looked different on every
 * page. One shape, one style, mirrored in RTL by `.go`.
 */
/**
 * Phase 5 / 6 — something at work, said in place: what is happening and three
 * dots that breathe (still for a reader who asked for less motion); a polite
 * status, heard once. The assistant's work carries its ✦; anything else
 * (Stripe confirming a card) does not.
 */
export const atWork = (text: string, assistant = false): string =>
  `<div class="block working" role="status">${assistant ? '<span class="as" aria-hidden="true">✦</span> ' : ''}<span>${esc(text)}</span>`
  + `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`;

/**
 * Phase 6 — a page that is not there says so as a state, not a bare heading
 * and one word: what is missing, the likely reason, and the way back.
 */
export const missingPage = (locale: Locale, title: string, door: { readonly href: string; readonly label: string }): string =>
  `<h1 class="page">${esc(title)}</h1><div class="empty">${esc(t(locale, 'common.notFoundBody'))}<div>${deeper(door.href, door.label)}</div></div>`;

export const deeper = (href: string, label: string, extra = '', attrs = ''): string =>
  `<a class="deeper${extra ? ` ${extra}` : ''}" href="${href}"${attrs ? ` ${attrs}` : ''}>${esc(label)}<span class="go" aria-hidden="true">›</span></a>`;

/** The text an escaped fragment stands for: the inverse of `esc`, for the five it writes. */
export const unescapeHtml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

/**
 * THE ASSISTANT'S HAND (the design pass, 2026-09-29): its name where it is
 * the author, after a ✦, in magenta — the one colour that means something by
 * itself. Only ever text; never on a link, a button, a heading or the mark
 * (`palette.test.ts`). The ✦ is hidden from a screen reader, which hears the
 * name. `name` arrives escaped or is escaped here.
 */
export const byAssistant = (name: string): string =>
  `<span class="as"><span aria-hidden="true">✦</span> ${esc(name)}</span>`;

/** Its opposite. The arrow is a mirrored span, never a character in the copy. */
export const back = (href: string, label: string): string =>
  `<a class="back" href="${href}"><span class="go" aria-hidden="true">‹</span>${esc(label)}</a>`;

/** CC-25 — the address of a conversation: one definition, shared with the alerts (G5). */
export { conversationUrl } from '../../core/owner/addresses.js';

/* D — a stack of doors (`.doors`) is styled once, in the shell: My business,
   the assistant's page and Setup each hold one. */

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The EN·中文·العربية switcher — links to the public /locale route, returns to `path`. */
export function switcher(locale: Locale, path: string): string {
  // A plain path stays plain: percent-encoding would put `%` into the page,
  // and the owner surface bans that character (settings-web.test.ts scans
  // for it). Anything with a query or an odd character is encoded as before.
  const raw = path || '/app';
  const next = /^[A-Za-z0-9/_.-]*$/.test(raw) ? raw : encodeURIComponent(raw);
  return `<div class="langsw" role="group" aria-label="${esc(t(locale, 'switcher.aria'))}">
    ${LOCALES.map((l) =>
      `<a class="${l === locale ? 'on' : ''}" hreflang="${l}" lang="${l}" href="/locale?set=${l}&next=${next}">${esc(LOCALE_LABEL[l])}</a>`,
    ).join('')}</div>`;
}

/**
 * PHASE 4 OF THE UI REBUILD (2026-10-02) — THE FOUR SIGNALS (`signal` in
 * tokens.ts): ok ✓, waiting ○, failed ✕, the assistant ✦. Colour does those
 * jobs and no others, and never alone: each is a shape as well as a hue.
 *
 * `signalMark` draws the shape as its own element, for a line that a shape
 * opens (a state line, a calendar entry, Today's sending line). The class
 * names are the stylesheet's older ones — `warn` is the amber of waiting,
 * `bad` the red of failed — kept so one word does not mean two things in two
 * places of the same file.
 */
export type Signal = keyof typeof DESIGN_TOKENS.signal;
const SIGNAL_CLASS: Readonly<Record<Signal, string>> = { ok: 'ok', waiting: 'warn', failed: 'bad', assistant: 'as' };
export const signalMark = (s: Signal): string =>
  `<span class="dot ${SIGNAL_CLASS[s]}" aria-hidden="true">${DESIGN_TOKENS.signal[s]}</span>`;

/**
 * Where the stylesheet draws a signal's shape BEFORE a state's own words — a
 * pill, a field's error, a setting's value. The second `content` gives the
 * shape an empty alternative, so a screen reader says the words alone; a
 * browser that does not know that form keeps the first.
 * `phase4-colour.test.ts` holds that every use of a signal colour is either
 * here or named there with the way its shape is drawn.
 */
export const SIGNAL_BEFORE: Readonly<Record<Signal, readonly string[]>> = {
  ok: ['.pill.ok', '.pill.taught', '.sbx-trust.pass .verdict', '.chip.auto', '.sr-value.ok', '.p-tag.big'],
  waiting: ['.pill.warn', '.pill.reason', '.fwarn', '.imp-warn', '.draft .held-why', '.chip.draft', '.sr-value.warn', '.prob', '.pc-wait', 'nav.side .navcount'],
  failed: ['.pill.bad', '.flash.bad', '.perr', '.fielderr', '.ev-d', '.sbx-trust.fail .verdict', '.chip.warn', '.sr-value.bad', '.prob.bad'],
  assistant: ['.pill.as'],
};
const markBefore = (s: Signal, selectors: readonly string[]): string => {
  const shape = DESIGN_TOKENS.signal[s];
  return `  ${selectors.map((x) => `${x}::before`).join(', ')} { content:"${shape}"; content:"${shape}" / ""; margin-inline-end:var(--space-4); font-weight:600; }`;
};
const SIGNAL_CSS = `  /* Phase 4 — the four signals: a colour and a shape. */
  .dot { font-weight:600; }
  .dot.ok { color:var(--color-ok); }
  .dot.warn { color:var(--color-waiting); }
  .dot.bad { color:var(--color-warn); }
  .dot.as { color:var(--color-assistant); }
  .pill.as { background:transparent; color:var(--color-assistant); padding-inline:0; }
${(Object.keys(SIGNAL_BEFORE) as Signal[]).map((s) => markBefore(s, SIGNAL_BEFORE[s])).join('\n')}
`;

/**
 * PHASE 5 OF THE UI REBUILD (2026-10-02) — MOTION. The three durations of the
 * tokens and the one curve (`--motion-ease`), and nothing else:
 *
 *   fast   (120 ms)  a press, a hover, a fold or a menu opening
 *   normal (200 ms)  a notice arriving, the draft appearing, Undo
 *   max    (300 ms)  the assistant at work: one breath of its three dots
 *
 * Every rule that moves anything sits inside `prefers-reduced-motion:
 * no-preference`, so a reader who asked for less gets none of it; the block
 * after it stops anything else that would move. `phase5-motion.test.ts` holds
 * both, and that no duration is written as a number.
 */
const MOTION_CSS = `  @media (prefers-reduced-motion: no-preference) {
    .btn, .crow, .srow, a.navlink, .tab, .deeper, .chip, summary {
      transition: background-color var(--motion-fast) var(--motion-ease), border-color var(--motion-fast) var(--motion-ease),
        box-shadow var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease); }
    .btn:active { transform:scale(0.98); transition:transform var(--motion-fast) var(--motion-ease); }
    details[open] > :not(summary) { animation:nomi-arrive var(--motion-fast) var(--motion-ease) both; }
    .flash, #approve, .working { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }
    .working .dots i { animation:nomi-breathe var(--motion-max) var(--motion-ease) infinite alternate; }
    .working .dots i + i { animation-delay:var(--motion-fast); }
    .working .dots i + i + i { animation-delay:var(--motion-normal); }
    dialog.ask[open] { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }
    .btn[aria-busy="true"]::after { animation:nomi-breathe var(--motion-max) var(--motion-ease) infinite alternate; }
    dialog.ask[open]::backdrop { animation:nomi-fade var(--motion-fast) var(--motion-ease) both; }
    /* THE WARMTH RUN — the profile card springs up (its one curve of its own). */
    dialog.sheet[open] { animation:nomi-spring var(--motion-normal) var(--motion-spring) both; }
    dialog.sheet[open]::backdrop { animation:nomi-fade var(--motion-fast) var(--motion-ease) both; }
    /* The warmth run — Today's band and hero rise into place as the page arrives, the hero a beat after; its face row scrolls smoothly. */
    .tw, .td { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }
    .td { animation-delay:var(--motion-fast); }
    .td-row { scroll-behavior:smooth; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration:1ms !important; animation-iteration-count:1 !important;
      animation-delay:0s !important; transition-duration:1ms !important; scroll-behavior:auto !important; }
  }
  @keyframes nomi-arrive { from { opacity:0; transform:translateY(-4px); } }
  @keyframes nomi-rise { from { opacity:0; transform:translateY(8px); } }
  @keyframes nomi-breathe { from { opacity:0.25; } to { opacity:1; } }
  @keyframes nomi-fade { from { opacity:0; } }
  @keyframes nomi-spring { from { opacity:0; transform:translateY(var(--space-48)) scale(0.97); } }
  /* The assistant at work: its mark, what it is doing, three dots. */
  .working { display:flex; align-items:baseline; gap:var(--space-8); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .working .dots { display:inline-flex; gap:var(--space-4); }
  .working .dots i { width:6px; height:6px; border-radius:var(--radius-chip); background:var(--color-ink-secondary); }
  /* Asking first: the product's own dialog over a dimmed page. */
  dialog.ask { border:0; border-radius:var(--radius-card); padding:var(--space-24); max-width:var(--measure-form);
    inline-size:min(var(--measure-form), calc(100vw - var(--space-32))); box-shadow:var(--shadow-lift2);
    background:var(--color-surface); color:var(--color-ink); }
  dialog.ask::backdrop { background:var(--color-ink); opacity:0.35; }
  /* THE WARMTH RUN, phase 3 — THE PROFILE CARD (customerCard.ts): a rounded
     panel, the face large at its head, two figures, what they bought, and one
     action at its foot. As a page it sits in the column; lifted by the script
     into its sheet, it springs up over the page — from the bottom edge on a
     phone, where it is a bottom sheet. */
  .pcard { display:flex; flex-direction:column; gap:var(--space-16); max-width:var(--measure-form); margin-inline:auto;
    padding:var(--space-24); background:var(--color-surface); border-radius:var(--radius-panel); box-shadow:var(--shadow-lift1); }
  .pc-top { display:flex; flex-direction:column; align-items:center; gap:var(--space-4); text-align:center; }
  .pc-top .face { margin-block-end:var(--space-8); }
  .pc-name { margin:0; font-size:var(--font-size-display); line-height:1.2; overflow-wrap:anywhere; }
  .pc-meta { margin:0; display:flex; flex-wrap:wrap; justify-content:center; gap:var(--space-4) var(--space-12);
    color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .pc-wait { margin:0; color:var(--color-waiting); font-weight:600; font-size:var(--font-size-small); }
  .pc-regular { margin:0; color:var(--color-ink-secondary); font-weight:600; font-size:var(--font-size-caption); }
  .pc-facts { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-8); margin:0; }
  .pc-facts > div { padding:var(--space-12) var(--space-16); background:var(--color-paper); border-radius:var(--radius-card); }
  .pc-facts dt { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .pc-facts dd { margin:0; font-size:var(--font-size-title); font-weight:700; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
  .pc-h { margin:0 0 var(--space-4); font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink-secondary); }
  .pc-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); }
  .pc-qty, .pc-none { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .pc-none { margin:0; }
  .pc-top + .pc-facts, .pc-things + .pc-open { margin-block-start:var(--space-4); }
  .pc-open { align-self:stretch; width:auto; justify-content:center; min-height:48px; border-radius:var(--radius-control); background:var(--color-paper); font-weight:600; }
  dialog.sheet { border:0; padding:0; background:transparent; color:var(--color-ink); overflow:visible;
    inline-size:min(var(--measure-form), calc(100vw - var(--space-32))); max-width:var(--measure-form); }
  dialog.sheet::backdrop { background:var(--color-ink); opacity:0.35; }
  dialog.sheet .pcard { box-shadow:var(--shadow-lift2); max-block-size:calc(100vh - 2 * var(--space-48)); overflow-y:auto; }
  .sheet-bar { display:flex; justify-content:flex-end; margin:0 0 var(--space-8); }
  .sheet-x { inline-size:44px; block-size:44px; border:0; border-radius:var(--radius-chip); background:var(--color-surface);
    color:var(--color-ink); font:inherit; font-size:var(--font-size-title); line-height:1; cursor:pointer; box-shadow:var(--shadow-lift1); }
  @media (max-width: 720px) {
    dialog.sheet { inline-size:100%; max-width:100%; margin:auto 0 0; }
    dialog.sheet .pcard { border-end-start-radius:0; border-end-end-radius:0; max-block-size:calc(100vh - 2 * var(--space-48)); }
    .sheet-bar { padding-inline:var(--space-8); }
  }
  .ask-q { margin:0 0 var(--space-16); }
  /* Phase 9 (cross-new-04) — the two buttons share one row on a phone: a long word wraps inside its own button. */
  .ask-acts { display:flex; gap:var(--space-8); flex-wrap:nowrap; align-items:stretch; }
  .ask-acts .btn { min-width:0; }
  .ask-acts [data-ask-yes] { flex:1 1 auto; }
  .ask-acts [data-ask-no] { flex:none; }
  /* Phase 6 — a form on its way: its button says so, and does not take a second press. */
  .btn[aria-busy="true"] { cursor:progress; }
  .btn[aria-busy="true"]::after { content:"…"; margin-inline-start:var(--space-4); }
  /* Undo, inside the notice that says what was done. */
  .flash.has-undo { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8) var(--space-16); flex-wrap:wrap; }
  .flash .undo { margin:0; }
`;

/**
 * The switcher's rules, defined once: the shell carries them, and so does a
 * public document that shows the switch (the site, Phase 5) — it does not get
 * the shell's stylesheet, and a second copy of these rules would drift.
 */
export const LANGSW_CSS = `  .langsw { display:inline-flex; gap:var(--space-4); background:var(--color-paper);
    border:1px solid var(--color-border); border-radius:var(--radius-chip); padding:3px; }
  /* Phase 9 (public-missed-09) — the same pill on the site, the door and the shell:
     names, not underlined links. */
  .langsw a { display:inline-flex; align-items:center; min-height:44px; padding:0 var(--space-8);
    border-radius:var(--radius-chip); font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); white-space:nowrap; text-decoration:none; }
  /* Five names fit a 360 px phone with the narrow padding; a wider screen gets the roomier one. */
  @media (min-width: 25rem) { .langsw a { padding:0 var(--space-12); } }
  /* The switcher is chrome. A solid jade fill made it the loudest object
     on a page whose subject was somebody's business. */
  .langsw a.on { background:var(--color-surface); color:var(--color-ink); font-weight:600; }
`;

/**
 * The stylesheet holds NO literal colour and NO literal type size. Every one is
 * `var(--…)`, emitted by `cssVariables()` from `DESIGN_TOKENS`. This file used
 * to hand-write all of them, which is how the product shipped 15px/1.5 in cold
 * blue-grey while the token file described 17px/1.6 on warm paper, and how
 * `design-system.test.ts` asserted `base >= 16` and passed for months.
 *
 * Tints are `--color-*-wash` / `--color-*-line` tokens, not `color-mix(… 12% …)`:
 * the owner surface bans the `%` character in rendered HTML, and a CSS
 * percentage trips that rule exactly as a fake metric would. If you need a
 * colour that is not here, add it to `DESIGN_TOKENS.color` — it becomes a
 * variable on its own, with no edit to the emitter.
 */
const STYLE = `
${cssVariables()}
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-paper); color: var(--color-ink);
    font: var(--font-size-base)/var(--line-height) var(--font-family); }
  a { color: inherit; text-decoration: none; }
  /* Anything a PERSON says — her draft, a buyer's quoted words. Never a label. */
  .voice { font-family: var(--font-voice); }
  /* THE WARMTH RUN (2026-10-03) — a customer's face (faces.ts): their photo laid
     on their coloured initial, round. The initial is always there under it, so a
     photo that does not arrive leaves the initial, never a hole. */
  .face { position:relative; display:inline-grid; place-items:center; flex:none; overflow:hidden;
    border-radius:var(--radius-chip); inline-size:40px; block-size:40px; font-size:var(--font-size-base);
    font-weight:600; line-height:1; user-select:none; }
  .face-xs { inline-size:24px; block-size:24px; font-size:var(--font-size-caption); }
  .face-s { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
  .face-l { inline-size:56px; block-size:56px; font-size:var(--font-size-title); }
  .face-xl { inline-size:96px; block-size:96px; font-size:var(--font-size-hero); }
  .face-i { display:grid; place-items:center; inline-size:100%; block-size:100%; }
  .face-i svg { inline-size:1.4em; block-size:1.4em; }
  .face-p { position:absolute; inset:0; inline-size:100%; block-size:100%; object-fit:cover; }
  .face.t1 { background:var(--face-1-bg); color:var(--face-1-fg); }
  .face.t2 { background:var(--face-2-bg); color:var(--face-2-fg); }
  .face.t3 { background:var(--face-3-bg); color:var(--face-3-fg); }
  .face.t4 { background:var(--face-4-bg); color:var(--face-4-fg); }
  .face.t5 { background:var(--face-5-bg); color:var(--face-5-fg); }
  .face.t6 { background:var(--face-6-bg); color:var(--face-6-fg); }
  .face.t7 { background:var(--face-7-bg); color:var(--face-7-fg); }
  .face.t8 { background:var(--face-8-bg); color:var(--face-8-fg); }
  .face-link { display:inline-flex; align-items:center; gap:var(--space-8); color:inherit; min-width:0; }
  .face-link:focus-visible { outline:none; }
  .face-link:focus-visible .face { outline:2px solid var(--color-ink); outline-offset:2px; }
  .layout { display: grid; grid-template-columns: 208px 1fr; min-height: 100vh; }
  /* A grid child does not shrink below its own content unless told to: its
     default min-width is auto, so one unbreakable string — a long sku, a URL a
     buyer pasted — widens the content track and scrolls the whole page
     sideways. Nothing in the product does that today; this is the guard, not a
     repair. */
  .layout > * { min-width: 0; }
  /* The rail (the design pass): its groups down the side, Setup and Log out
     at its foot, and the whole of it in view while the page scrolls. */
  nav.side { background: var(--color-paper); border-inline-end: 1px solid var(--color-border);
    padding: var(--space-16) var(--space-12); display:flex; flex-direction:column;
    position:sticky; top:0; height:100vh; overflow-y:auto; }
  .navgroup + .navgroup { margin-top: var(--space-12); }
  .navfoot { margin-top:auto; padding-top: var(--space-16); }
  .navhub { display:flex; flex-direction:column; }
  /* THE WARMTH RUN — "Customers" heads its two pages: its own shape and word,
     not a door (the two under it are). */
  .navhead { display:flex; align-items:center; gap:var(--space-12); padding: var(--space-8) var(--space-12) var(--space-4);
    font-size: var(--font-size-small); color: var(--color-ink-secondary); }
  .navhead .ni { inline-size:20px; block-size:20px; }
  .brand { display:flex; align-items:center; gap:var(--space-8); font-weight: 700;
    font-size: var(--font-size-base); padding: 6px 12px 18px; letter-spacing: .3px; }
  .brand .mark { flex:none; }
  /* Two cuts of one mark (brand.ts): the detail cut beside the word on a desktop,
     the small reversed cut alone in the phone nav — below 40px the pale disc
     would not read. One is drawn at a time. */
  .brand .mark-detail { display:flex; }
  .brand .mark-small { display:none; }
  .brand small { display:block; color:var(--color-ink-secondary); font-weight:500;
    font-size:var(--font-size-caption); letter-spacing:0; margin-top:var(--space-4); }
  /* CC-14 — the business's own name leads the block, and a long one wraps
     inside the rail rather than widening it. */
  /* Phase 9 (V1-014, V1-099) — a Chinese name is one word: it breaks only at
     its spaces. One too long to sit beside the mark goes under it, where the
     rail's whole width is its own; a word longer than the rail still breaks. */
  .brand { flex-wrap:wrap; }
  .brand .brandname { flex:1 1 0; max-width:100%; overflow-wrap:break-word; }
  .brand .brandname bdi { word-break:keep-all; }
  /* On a phone the rail is one row with no room for a name, so the name heads
     Today instead: one line that scrolls away with the page. Drawn on the
     phone only; the rail carries it everywhere else. */
  .business-name { display:none; margin:0 0 var(--space-4); font-size:var(--font-size-caption);
    font-weight:600; color:var(--color-ink-secondary); overflow-wrap:anywhere; }
  /* CC-20 — the way past the nav for a keyboard: out of sight until it has
     focus, then the first thing on the page, over the rail. */
  .skip { position:absolute; top:calc(-2 * var(--space-48)); inset-inline-start:var(--space-8); z-index:3;
    padding:var(--space-8) var(--space-16); border-radius:var(--radius-card);
    background:var(--color-surface); color:var(--color-ink); box-shadow:var(--shadow-lift2);
    font-size:var(--font-size-small); font-weight:600; }
  .skip:focus, .skip:focus-visible { top:var(--space-8); }
  /* THE WARMTH RUN, phase 1 — each entry is its shape and its word. */
  nav.side a.navlink { display: flex; align-items: center; gap: var(--space-12); padding: var(--space-8) var(--space-12);
    min-height: 44px; border-radius: var(--radius-control); color: var(--color-ink-secondary);
    font-size: var(--font-size-small); margin-bottom: var(--space-4); }
  nav.side a.navlink.sub { padding-inline-start: var(--space-24); }
  nav.side .ni { flex:none; inline-size:22px; block-size:22px; }
  [dir="rtl"] .ni.flips { transform:scaleX(-1); }
  nav.side a.navlink:hover { background: var(--color-surface); color: var(--color-ink); }
  /* The entry you are on is unmistakable without a colour: a raised white
     tile on the rail's grey, its word in weight, its shape drawn heavier. */
  nav.side a.navlink.active { background: var(--color-surface); color: var(--color-ink); font-weight:600;
    box-shadow: var(--shadow-lift1); }
  nav.side a.navlink.active .ni { stroke-width:2.3; }
  .nl-short { display:none; }
  /* The rail's one number: customers waiting for the owner, in the waiting
     signal's colour, beside its word. */
  nav.side .navcount { display:inline-flex; justify-content:center; margin-inline-start:var(--space-8); min-inline-size:1.6em; padding:0 var(--space-4);
    font-size:var(--font-size-caption); font-weight:700; color:var(--color-waiting); background:var(--color-waiting-wash);
    border-radius:var(--radius-chip); font-variant-numeric:tabular-nums; line-height:1.6; }
  /* V1 · option A (2026-09-24) — there is no header band. The nav row is the
     chrome; the language switch and log out are the first rows of Setup, and
     the login page keeps its own switcher. */
${LANGSW_CSS}
  /* M49 — THE COLUMN. One measure for the whole product, centred in the space
     beside the nav rather than stuck against it. At 2000px the old page put a
     1040px block hard left and left 700px of nothing to its right, which reads
     as a window that failed to fill rather than a sheet placed on a desk.
     Centred is a decision; the accidental middle was not. */
  main { padding: var(--space-24); max-width: var(--measure-column); margin-inline: auto; width: 100%; }
  /* Prose is allowed to be narrower INSIDE the column. It may not be a
     different number: these two classes are the only prose measures there are. */
  .measure-prose { max-width: var(--measure-prose); }
  .measure-form { max-width: var(--measure-form); }
  /* Phase 9 (settings-a-new-19, settings-a-missed-17) — a heading that wraps breaks into even lines, never one word alone. */
  h1.page { font-size: var(--font-size-title); margin: 0 0 var(--space-16); text-wrap:balance; }
  /* The hairline in --shadow-lift1 does what a 1px border used to; two would
     read as a double rule at the same edge. */
  .card { background:var(--color-surface); border:0; border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift1); padding:var(--space-16); margin:var(--space-16) 0; }
  /* Phase F: section headings speak to the owner in her own sentence case.
     The 13px tracked-uppercase eyebrow was the one SaaS tell the product had. */
  .card h2, .block h2, main h2 { font-size:var(--font-size-base); font-weight:600;
    color:var(--color-ink); margin:0 0 var(--space-12); text-transform:none; letter-spacing:0; text-wrap:balance; }
  /* Phase 9 (missed-19, missed-21) — a heading that wraps leaves no word alone on its last line; nor does a paragraph. */
  h1.page, main h2, main h3 { text-wrap:balance; }
  main p, main li { text-wrap:pretty; }

  /* Counts. Never a KPI tile — a plain line, the way Today has always drawn it. */
  .stats { display:flex; flex-direction:column; }
  .stat { display:flex; align-items:baseline; gap:var(--space-8); padding:8px 0;
    border-bottom:1px solid var(--color-border); }
  .stat:last-child { border-bottom:0; }
  .stat .v { font-size:var(--font-size-base); font-weight:600; color:var(--color-ink);
    font-variant-numeric:tabular-nums; min-width:2.5em; }
  .stat .l { font-size:var(--font-size-small); color:var(--color-ink-secondary); }

  /* One pill. It marks STATE — never decoration, never a label wearing a costume. */
  .pill { display:inline-block; padding:4px 10px; border-radius:var(--radius-chip);
    font-size:var(--font-size-caption); font-weight:600;
    margin-inline-end:var(--space-8); margin-block-end:var(--space-8); white-space:nowrap; }
  .pill.ok { background:var(--color-ok-wash); color:var(--color-ok); }
  .pill.bad { background:var(--color-warn-wash); color:var(--color-warn); }
  .pill.warn { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .pill.owner { background:var(--color-paper); color:var(--color-ink); font-weight:600; }
${SIGNAL_CSS}${MOTION_CSS}
  /* One button (the design pass, 2026-09-29). The primary act is the one
     graphite FILL on a screen; every other button is outlined in Stone on
     white; a quiet one is words; red takes something away. No button is
     ever magenta — that colour is the assistant's hand. */
  .btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px;
    padding:10px 18px; border-radius:var(--radius-card);
    border:1.5px solid var(--color-ink-secondary);
    background:var(--color-surface); color:var(--color-ink);
    font:inherit; font-size:var(--font-size-small); font-weight:600; cursor:pointer; }
  .btn.send { background:var(--color-ink); border-color:var(--color-ink); color:var(--color-surface); }
  .btn.send:hover { box-shadow:var(--shadow-lift2); }
  .btn.danger { border-color:var(--color-warn); color:var(--color-warn); }
  .btn.ghost { background:transparent; border-color:transparent; color:var(--color-ink-secondary); font-weight:400; }
  .btn.ghost:hover { color:var(--color-ink); text-decoration:underline; }
  .inline { display:inline; }
  .doors { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
  /* M49 — a button in a column form stretched to the width of the input above
     it, which made "Save" a 455px slab. A button is as wide as its word. */
  form .btn, form button:not(.full) { align-self:start; }

  /* ── The form. ONE definition, in the shell, because five pages use it.
     Three of them (the rate, the closures, the samples) referenced these
     classes while emitting no rule for them, so their fields rendered as
     inline labels strung across the page — the same failure as a renderer
     reaching for a variable nobody emits, and invisible to every test that reads
     strings rather than boxes. Caught by a screenshot. */
  .pform { display:flex; flex-direction:column; gap:var(--space-16);
           max-width:var(--measure-form); margin-top:var(--space-12); }
  .fld { display:flex; flex-direction:column; gap:var(--space-4);
         font-size:var(--font-size-small); color:var(--color-ink); }
  /* Phase 9 — a text field's box, for text-like fields only: a tick or a
     radio given its padding, border and height drew a stretched, padded box
     and pushed the last choice of a row onto a line of its own. A choice is
     reached through its label, which is the 44px target. */
  .pform input:not([type="checkbox"]):not([type="radio"]), .pform textarea, .pform select {
    background:var(--color-surface); border:1px solid var(--color-ink-secondary);
    border-radius:var(--radius-control); color:var(--color-ink); padding:11px 14px; font:inherit;
    min-height:44px; resize:vertical; }
  .pform label.check { display:flex; align-items:center; gap:var(--space-8); min-height:44px; }
  /* Phase 9 (cross-new-03) — a field sent back is marked by its edge on every form, the calendar's too, not only a settings row. */
  main input[aria-invalid="true"], main textarea[aria-invalid="true"], main select[aria-invalid="true"] { border-color:var(--color-warn); }
  .chkbox { display:inline-flex; align-items:center; gap:var(--space-8);
            font-size:var(--font-size-small); color:var(--color-ink); min-height:44px; }
  .chkbox input { min-height:0; }
  /* Phase 9 (V1-416) — a chosen radio or tick in the ink of the page, not the browser's own blue. */
  input[type="radio"], input[type="checkbox"] { accent-color:var(--color-ink); }
  /* One figure, stated large: the rate she set, the sample price, the state an
     order is in. It is a READING, not a KPI tile. */
  .stated-now { font-size:var(--font-size-display); margin:var(--space-12) 0; }

  /* One notice — in two tones, because one of them is a refusal.
     D5: every notice was painted in the jade of a success, so "Only the owner
     may do that" and "Sent" looked alike at a glance. The bad tone carries
     a line as well as a wash, since the two washes are close enough in
     value that colour alone would be the whole signal. */
  .flash { background:var(--color-surface); color:var(--color-ink);
    border:1px solid var(--color-border);
    border-radius:var(--radius-card); padding:var(--space-12) var(--space-16);
    margin-bottom:var(--space-16); font-size:var(--font-size-small); }
  .flash.bad { background:var(--color-warn-wash); color:var(--color-warn);
    border-color:var(--color-warn-line); }
  /* CC-26 · the line a page shows when something new arrives while it is
     open: the notice's own tone, and the whole line one door to the newest.
     The design pass (UI-PASS 6): it sits in the page's header, in the flow —
     the list's, the conversation's — never over a control; empty, it takes
     no room. */
  .live { max-width:var(--measure-prose); }
  .dhead .live { margin-inline-start:auto; }
  .dhead.listhead { margin-bottom:var(--space-16); }
  .listhead h1.page { margin:0; }
  .live-line { padding:0; margin:0; }
  .live-line .deeper { gap:var(--space-8); padding:0 var(--space-12); color:inherit; font-weight:600; }

  /* One tab row. */
  .tabs { display:flex; gap:var(--space-8); margin-bottom:var(--space-16); }
  .tab { display:inline-flex; align-items:center; min-height:44px; padding:8px 16px;
    border-radius:var(--radius-chip); background:var(--color-surface);
    border:1px solid var(--color-border); color:var(--color-ink-secondary);
    font-size:var(--font-size-small); }
  /* Phase 9 (V1-171) — the chosen tab is the one that stands out: an ink edge and weight, not a paler grey than its neighbours. */
  .tab.on { background:var(--color-surface); border-color:var(--color-ink); box-shadow:inset 0 0 0 1px var(--color-ink); color:var(--color-ink); font-weight:600; }

  .list { display:flex; flex-direction:column; gap:var(--space-12); }
  .back { display:inline-flex; align-items:center; gap:var(--space-4); min-height:44px;
    color:var(--color-ink); font-size:var(--font-size-small); }
  pre { background:var(--color-paper); border:1px solid var(--color-border);
    border-radius:var(--radius-card); padding:18px; overflow-x:auto;
    font:var(--font-size-small)/1.55 "SF Mono", ui-monospace, Menlo, monospace;
    color:var(--color-ink); white-space:pre; margin:0; }
  /* Phase 9 (V1-193) — at the prose measure, as wide as the form above it reads, not the whole column. */
  pre.doc { white-space:pre-wrap; overflow-wrap:anywhere; text-align:start; max-width:var(--measure-prose); }
  /* One "go deeper" link for the whole product; the chevron mirrors in RTL. */
  /* Each "go deeper" is its own ROW. Inline-flex put three of them on one
     line on the settings page, where they read as one run-on sentence with
     chevrons in it rather than three separate doors. fit-content keeps the
     target the width of its words, not the width of the column. */
  .deeper { display:flex; width:fit-content; align-items:center; gap:var(--space-4); min-height:44px;
    padding:var(--space-8) 0; font-size:var(--font-size-small); color:var(--color-ink); }
  .deeper:hover, .deeper:focus-visible { text-decoration:underline; text-underline-offset:3px; }
  /* The chevron carries the affordance now that the label does not shout. */
  .go { font-size:var(--font-size-base); color:var(--color-ink-secondary); }
  [dir="rtl"] .go { transform:scaleX(-1); display:inline-block; }
  .tlines { list-style:none; margin:var(--space-8) 0 0; padding:0; display:flex; flex-direction:column; }
  .tline { display:flex; align-items:baseline; flex-wrap:wrap; gap:var(--space-4) var(--space-8); min-height:44px; padding:var(--space-8) 0;
    border-bottom:1px solid var(--color-paper); color:var(--color-ink); text-decoration:none; }
  .tline:hover, .tline:focus-visible { text-decoration:underline; text-underline-offset:3px; }
  .tline .go { margin-inline-start:auto; }
  .tl-who { font-weight:600; }
  /* Settings in labelled groups (phase 3 of the UI rebuild): one card of rows
     per group; a row names the setting, says it in one line, shows what it is
     set to now at the line's end, and opens it. */
  .sgroup { margin:0 0 var(--space-24); }
  .sgroup-h { font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink-secondary); margin:0 0 var(--space-8); }
  .scard { list-style:none; margin:0; padding:0; background:var(--color-surface); border:1px solid var(--color-border);
    border-radius:var(--radius-card); overflow:hidden; }
  .scard > li + li, .scard > .srow + .srow { border-top:1px solid var(--color-border); }
  .srow { display:flex; align-items:center; gap:var(--space-12); min-height:56px; padding:var(--space-8) var(--space-16); color:var(--color-ink); }
  a.srow:hover, a.srow:focus-visible { background:var(--color-paper); }
  .sr-main { display:flex; flex-direction:column; flex:1 1 auto; min-width:0; }
  .sr-label { font-weight:600; font-size:var(--font-size-small); }
  .sr-desc { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .sr-value { flex:0 1 auto; max-width:45%; font-size:var(--font-size-small); color:var(--color-ink-secondary); text-align:end; overflow-wrap:anywhere; }
  /* A value that is a state says which, with its shape (the four signals); any other value stays quiet. */
  .sr-value.ok { color:var(--color-ok); font-weight:600; }
  .sr-value.warn { color:var(--color-waiting); font-weight:600; }
  .sr-value.bad { color:var(--color-warn); font-weight:600; }
  .srow .go { flex:none; }
  .sr-ctl { flex:0 1 auto; min-width:0; }
  /* THE WARMTH RUN — a menu row (Settings, and the menus phase 7 makes of My
     business, the assistant and Setup): its shape, its name, where it stands,
     and the door. The value keeps to its line on a phone, cut short rather
     than pushed under. A row that does something (Log out) is a button drawn
     as a row, in its own card at the foot. */
  .sr-menu > .ni { flex:none; inline-size:22px; block-size:22px; color:var(--color-ink-secondary); }
  /* The owner's decision (2026-10-03): 56 for a row, 64 for a row that carries a line under its name. */
  a.srow.sr-menu:has(.sr-desc), div.srow.sr-menu:has(.sr-desc) { min-height:64px; }
  [dir="rtl"] .sr-menu > .ni.flips { transform:scaleX(-1); }
  button.srow { inline-size:100%; border:0; background:none; font:inherit; color:var(--color-ink); text-align:start; cursor:pointer; }
  button.srow:hover, button.srow:focus-visible { background:var(--color-paper); }
  .sr-foot { margin-block-start:var(--space-24); }
  /* A setting as a row inside its card: what it is on the start side, its
     control on the end side; stacked on a phone. One save per form, at the
     form's end. Phase 9 (settings-b-outreach-new-04): the bar no longer
     sticks to the foot of the screen, where it lay across the form's first
     screen and read as the save of whichever card it covered. */
  .scard > .setrow + .setrow, .scard > .setrow + .fr-acts { border-top:1px solid var(--color-border); }
  .setrow { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 3fr); gap:var(--space-8) var(--space-16);
    align-items:start; padding:var(--space-12) var(--space-16); }
  .fr-l { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; padding-top:var(--space-8); }
  .fr-name { font-weight:600; font-size:var(--font-size-small); }
  .fr-desc { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fr-c { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .fr-c > input:not([type="checkbox"]):not([type="radio"]), .fr-c > select, .fr-c > textarea { width:100%; }
  .fr-c > .fr-value { padding-top:var(--space-8); }
  /* A tick in the control column sits at its start, beside the line that names it, never centred in the column. */
  .fr-c > input[type="checkbox"], .fr-c > input[type="radio"], .fr-c > .chkbox { align-self:flex-start; }
  .setrow.bad .fr-c > input, .setrow.bad .fr-c > textarea, .setrow.bad .fr-c > select { border-color:var(--color-warn); }
  .fr-acts { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--space-8); padding:var(--space-12) var(--space-16); }
  .savebar { display:flex; justify-content:flex-end; gap:var(--space-8);
    margin:var(--space-8) 0 0; padding:var(--space-12) 0; border-top:1px solid var(--color-border); }
  @media (max-width: 720px) {
    .setrow { grid-template-columns:minmax(0, 1fr); }
    .fr-l { padding-top:0; }
    .savebar .btn, .fr-acts .btn { flex:1 1 auto; }
  }
  /* On a phone the value goes under the line that says what the setting is, the door staying at the end. */
  @media (max-width: 560px) {
    a.srow { flex-wrap:wrap; row-gap:0; }
    a.srow .sr-main { flex-basis:0; }
    .sr-value { order:3; flex-basis:100%; max-width:100%; text-align:start; }
    a.srow.sr-menu { flex-wrap:nowrap; }
    a.srow.sr-menu .sr-main { flex-basis:auto; }
    .sr-menu .sr-value { order:0; flex-basis:auto; max-width:50%; text-align:end; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  }
  .tl-why, .tl-when { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .today-date { font-weight:400; }
  .today-worth { margin-top:var(--space-12); }
  .today-worth .grow { text-wrap:pretty; }
  .today-foot { font-size:var(--font-size-small); margin:var(--space-16) 0 0; }
  .today-foot p { margin:0; }
  /* Phase 9 (V1-102) — the next step and its video, side by side where they fit. */
  .today-next { display:flex; flex-wrap:wrap; column-gap:var(--space-24); }
  /* THE WARMTH RUN, phase 2 — Today in three zones. 1 · who waits for you: a
     thin band whose one colour is the waiting signal's, a face and a name and
     one line of why per person, in a card of rows; nobody waiting is a calm,
     warm line on white, never a dashed box. */
  main h2.tw-head { margin:0 0 var(--space-12); }
  .tw-need { color:var(--color-waiting); font-weight:600; }
  .tw-calm-line { margin:var(--space-4) 0 0; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .tw.is-calm { background:var(--color-surface); border-radius:var(--radius-panel); box-shadow:var(--shadow-lift1);
    padding:var(--space-16) var(--space-24); margin-block-end:var(--space-24); }
  main .tw.is-calm h2.tw-head { margin:0; }
  .tw-note { margin:0 0 var(--space-12); }
  .tw-note-t { margin:0; font-weight:600; }
  .tw-note .muted { margin:var(--space-4) 0 0; }
  .tw-list { list-style:none; margin:0; padding:0; background:var(--color-surface); border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift1); overflow:hidden; }
  .tw-list > li + li { border-top:1px solid var(--color-border); }
  .tw-item { display:flex; align-items:center; gap:var(--space-12); padding-inline-start:var(--space-12); }
  .tw-go { display:flex; align-items:center; gap:var(--space-8); flex:1 1 auto; min-width:0; min-height:56px;
    padding-block:var(--space-8); padding-inline-end:var(--space-12); color:var(--color-ink); }
  .tw-go:hover .tw-name, .tw-go:focus-visible .tw-name { text-decoration:underline; text-underline-offset:3px; }
  .tw-who { display:flex; flex-direction:column; flex:1 1 auto; min-width:0; }
  .tw-name, .tw-why { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:match-parent; }
  .tw-name { font-weight:600; font-size:var(--font-size-small); }
  /* A Latin name on an Arabic page keeps the page's side, as the Inbox's row does. */
  [dir="rtl"] .tw-name:dir(ltr) { text-align:end; }
  .tw-why { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .tw-go .go { flex:none; }
  /* 2 · what the assistant handled: the headline in its name, then the faces,
     a word under each, in one row that scrolls sideways (from the right in
     Arabic), snaps to a face, and fades at its end to say there is more. The
     padding at the end leaves the last face clear of the fade. */
  main h2.td-head { font-size:var(--font-size-display); font-weight:600; margin:0 0 var(--space-16); }
  .td-ready { margin:0; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .td-row { list-style:none; margin:0 0 var(--space-8); padding:var(--space-4) 0; padding-inline-end:var(--space-48);
    display:flex; gap:var(--space-8); overflow-x:auto; overscroll-behavior-inline:contain;
    scroll-snap-type:inline proximity; scrollbar-width:thin; scrollbar-color:var(--color-ink-secondary) transparent;
    -webkit-mask-image:linear-gradient(to right, var(--color-ink) calc(100% - var(--space-48)), transparent);
    mask-image:linear-gradient(to right, var(--color-ink) calc(100% - var(--space-48)), transparent); }
  [dir="rtl"] .td-row {
    -webkit-mask-image:linear-gradient(to left, var(--color-ink) calc(100% - var(--space-48)), transparent);
    mask-image:linear-gradient(to left, var(--color-ink) calc(100% - var(--space-48)), transparent); }
  .td-row > li { flex:none; scroll-snap-align:start; }
  .td-face, .td-more { display:flex; flex-direction:column; align-items:center; gap:var(--space-4);
    inline-size:calc(56px + var(--space-16)); padding-block:var(--space-4); color:var(--color-ink); text-align:center; }
  .td-word { font-size:var(--font-size-caption); color:var(--color-ink-secondary); overflow-wrap:anywhere; }
  .td-face:hover .td-word, .td-more:hover .td-word { color:var(--color-ink); }
  .td-plus { display:grid; place-items:center; inline-size:56px; block-size:56px; border-radius:var(--radius-chip);
    background:var(--color-surface); box-shadow:var(--shadow-lift1); font-size:var(--font-size-small); font-weight:600; }
  .td-more:focus-visible { outline:none; }
  .td-more:focus-visible .td-plus { outline:2px solid var(--color-ink); outline-offset:2px; }
  /* 3 · the day's three figures: a figure over its word, in ink, side by side. */
  main h2.tt-head { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .tt-row { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:var(--space-12); }
  .tt-row > li { display:flex; flex-direction:column; min-width:0; }
  .tt-n { font-size:var(--font-size-title); font-weight:600; font-variant-numeric:tabular-nums; }
  .tt-l { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  @media (max-width: 560px) {
    main h2.td-head { font-size:var(--font-size-title); }
    .tw.is-calm { padding:var(--space-16); }
  }
  /* Phase 9 (V1-094) — on a phone a line's door goes under its sentence, so the sentence keeps the width. */
  @media (max-width: 560px) {
    .today-worth .row { flex-direction:column; align-items:flex-start; gap:0; }
  }
  /* The chevron above mirrors because it POINTS — "onward" is to the left in
     Arabic. The mark does NOT, and its absence here is deliberate rather than an
     oversight: a brand mark is a constant, the same object in every language,
     and flipping it would make Nomi a different mark for Arabic readers. Only
     directional glyphs mirror. Do not add .mark to this rule. */
  a:focus-visible, button:focus-visible, input:focus-visible,
  textarea:focus-visible, select:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }
  .muted { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  /* M49 — one empty state, aligned like everything else. It was centred while
     the page around it was left-aligned, which is the single clearest way to
     make a considered page look like an accident. It mirrors in RTL on its own.
     Phase 6 — and a panel of its own, so it never reads as the caption of the
     button above it: what will be here, why it is not yet, and where there is
     one, the door to the next step. */
  .empty { text-align:start; color:var(--color-ink); font-size:var(--font-size-small);
    padding:var(--space-16); margin:var(--space-12) 0 0; max-width:var(--measure-prose);
    background:var(--color-surface); border:1px dashed var(--color-border); border-radius:var(--radius-card); }
  .empty .muted { color:var(--color-ink-secondary); }
  .empty .deeper, .empty .doors { margin-top:var(--space-8); }

  /* ── Speech: the two voices. ─────────────────────────────────────────────
     Anything a PERSON says — the buyer's words, her drafts, her sent replies —
     is set in the voice serif. Everything around the speech (labels,
     timestamps, buttons, counts) is the product speaking, and stays sans.
     One family per speaker, everywhere: these components are declared HERE and
     owned by the shell, because inbox and sandbox each carrying a copy is how
     the two drifted apart last time. */
  .timeline { display:flex; flex-direction:column; gap:var(--space-12); }
  .msg { max-width:82%; }
  .msg.inbound { align-self:flex-start; } .msg.outbound { align-self:flex-end; }
  .bubble { font-family:var(--font-voice); padding:10px 14px; border-radius:var(--radius-card);
    white-space:pre-wrap; word-break:break-word; }
  /* The buyer's words are FULL SIZE; every reply is one step down. The page
     belongs to the buyer's business — she works inside it. */
  .msg.inbound .bubble { font-size:var(--font-size-base);
    background:var(--color-paper); border:1px solid var(--color-border); border-start-start-radius:4px; }
  /* Phase 9 (V1-236, V1-261, V1-292) — the hairline every bubble has: on a phone, and in Practice,
     the page is paper too, and the customer's words floated as indented text with no bubble. */
  /* Phase 9 (V1-267) — the day once, where it changes; each caption then gives its time. */
  .tday { align-self:center; margin:var(--space-8) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  /* Her sent replies: neutral. These carried an amber fill — colour on every
     message she ever sent, marking no state at all. */
  .msg.outbound .bubble { font-size:var(--font-size-small);
    background:var(--color-surface); border:1px solid var(--color-border);
    border-start-end-radius:4px; }
  /* THE WARMTH RUN, phase 5 — what the ASSISTANT said sits on its wash, and the caption under it
     says "✦ name" in magenta; a person's reply keeps the plain bubble. A newcomer to the
     conversation tells the two apart at a glance. A wash, never a frame: the hairline goes. */
  .msg.outbound .bubble.by-as { background:var(--color-assistant-wash); border-color:transparent; }
  .ts { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .as { color:var(--color-assistant); }
  /* CC-25 — a link into a transcript lands on its newest message: clear of the
     sticky phone nav, with the message before it still in view. After an
     action it lands on the notice the action left, drawn under that message.
     The practice box is a landing of the same kind. */
  #latest, #compose, #main { scroll-margin-top:25vh; }
  /* Phase 9 (V1-239) — on a laptop the newest message lands lower: a short conversation does not
     move at all, so the header is never cut through; a long one keeps the reply under it in view. */
  @media (min-width: 1100px) { #latest { scroll-margin-top:40vh; } }
  /* Her PROPOSAL — visually subordinate to the buyer's words above it. Not a
     boxed rival: a quiet serif paragraph behind a jade hairline that means
     "hers, awaiting your decision". border-inline-start keeps the hairline on
     the reading edge in RTL with no override. */
  .proposed { font-family:var(--font-voice); font-size:var(--font-size-small);
    border-inline-start:2px solid var(--color-ink); padding:2px 14px;
    margin-bottom:var(--space-12); white-space:pre-wrap; word-break:break-word; }

  /* ── A plain section: air and a hairline. The DEFAULT grouping. ──────────
     A card is reserved for a boundary that MEANS something — one buyer's
     business, one verdict. A page of prose and counts is sections, not boxes. */
  /* M49 — one gap between sections, from the scale. It was 22px here and
     anything from 40 to 180 once each page had added its own margins. */
  .block { padding:var(--space-24) 0; border-top:1px solid var(--color-border); }
  .block:first-of-type { border-top:0; padding-top:var(--space-4); }
  /* RTL needs NO override here: a grid's first track already sits on the
     inline-start edge, so the sidebar mirrors to the right on its own. The
     three rules that used to live here re-flipped it — putting the sidebar
     back on the LEFT in Arabic, and, because two explicitly-placed columns ran
     against DOM order, pushing the whole content column into grid row 2 behind
     a screen-height gap. Every page was affected at desktop width. */

  /* ── V1 step two — the shared families, defined ONCE (Symow, decision 4:
     "define what already exists, once, in one stylesheet"). Each rule below
     was declared in two or more pages with small differences; this is the one
     body, and tests/parity/v1-one-stylesheet.test.ts refuses a second. Names
     that meant two things (.acts, .certs, .tag, .prow…) were renamed on the
     page that used them differently, so a name has one meaning again. */
  .editform { display:flex; flex-direction:column; gap:var(--space-8); }
  .replyform { display:flex; flex-direction:column; gap:var(--space-8); }
  /* Phase 9 (V1-238, V1-263) — the hand-over card reads down: whose it is, why, then what to do.
     In a row its state floated mid-card beside a stray label, with an empty band above. */
  .takeover { display:flex; flex-direction:column; align-items:flex-start; gap:var(--space-8); }
  .takeover > .pill { white-space:normal; margin:0; }
  .takeover-note { margin:0; font-size:var(--font-size-small); }
  .acts { display:flex; gap:var(--space-8); flex-wrap:wrap; margin-bottom:var(--space-16); }
  .perr { color:var(--color-warn); font-size:var(--font-size-caption); margin:0; }
  /* Phase 6 — a form's refusal under the field it concerns: why, the rule it follows, the way on. */
  .perr-block { margin:var(--space-8) 0; display:flex; flex-direction:column; gap:var(--space-4); }
  .perr-block p { margin:0; }
  .pq { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); color:var(--color-ink); }
  .subline { font-size:var(--font-size-caption); margin-bottom:var(--space-12); }
  .dhead { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; margin-bottom:var(--space-8); }
  .chips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .chip { background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-chip); padding:5px 12px; font-size:var(--font-size-caption); }
  .as-box { display:inline-flex; align-items:center; gap:var(--space-4); font-size:var(--font-size-small); min-height:44px; }
  .facts { margin-top:var(--space-16); display:flex; flex-direction:column; gap:var(--space-8); }
  .sub { margin:var(--space-16) 0 var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .note { font-size:var(--font-size-small); margin-top:var(--space-8); margin-bottom:var(--space-12); }
  .ok-line { color:var(--color-ok); font-weight:600; margin-bottom:var(--space-12); }
  .frow { display:flex; gap:var(--space-12); font-size:var(--font-size-small); }
  .flabel { color:var(--color-ink-secondary); min-width:8.5em; }
  .dhead.spread { justify-content:space-between; }
  /* ── V1 · what ten pages each drew for themselves, named once (step four).
     A list of hairline rows — dense, as decision 2 says of lists — and the
     column that names someone; two text sizes; a fieldset of choices; the
     one-time access code; the stopped pill. */
  .rows { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  /* A list of counts or rows is read, not scanned: it keeps the prose measure,
     so a figure, its word and its chevron stay together at 1280 px. */
  .stats, .rows { max-width:var(--measure-prose); }
  .row { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap;
    padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  .row:last-child { border-bottom:0; }
  /* One column the width of the row, each line at its own width, so a line
     that spreads (a name and its state) reaches the row's far edge. Left to
     the row's space-between, the column shrank to its content, and on the
     channels page each state sat a different distance from its name. */
  .row.lines { display:grid; grid-template-columns:minmax(0, 1fr); justify-items:start; gap:var(--space-4); }
  .row.lines > .spread { justify-self:stretch; }
  .row.top { align-items:flex-start; }
  .row p { margin:0; }
  .row .btn { flex:none; }
  .grow { flex:1; min-width:0; }
  /* .who is the inbox's inline line (flag · name · country) and must stay
     inline; the column that names someone on People is .person. */
  .person { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .caption { font-size:var(--font-size-caption); }
  .small { font-size:var(--font-size-small); }
  ul.chips { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  /* The plain pill: a state that waits on nothing. Its hairline keeps it a pill on the page's own paper, not bare grey words. */
  .pill.stop { background:var(--color-paper); color:var(--color-ink-secondary); border:1px solid var(--color-border); }
  /* The one-time access code on the People page; tests read it by this class. */
  .issued .code { font-size:var(--font-size-display); font-weight:600; letter-spacing:.08em; margin:var(--space-8) 0; }
  .choices { border:0; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-16); }
  .choices legend { padding:0; margin-bottom:var(--space-4); font-size:var(--font-size-caption); }
  /* V1 · decision 5 (2026-09-28): the row's one tag. Caption size, never
     wrapped; state colour only when it names a state — now (waiting for the
     owner), you (a person here holds it). Any other label, the calendar's
     kinds among them, is the neutral tag. */
  .tag { display:inline-flex; align-items:center; padding:5px 11px; border-radius:var(--radius-chip);
    font-size:var(--font-size-caption); font-weight:600; white-space:nowrap;
    background:var(--color-paper); color:var(--color-ink-secondary); }
  .tag.you { background:transparent; color:var(--color-ink); font-weight:600; }
  /* The doors either side of one page of a list, and where it sits in the whole. */
  .pager { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-4) var(--space-24); margin-top:var(--space-24); }
  /* Today (step four). The calm state IS the page: a short rule and one
     sentence in the product's voice — quiet, not jade, while messaging is off.
     And a count you can tap: the stat row as a link, its figure one step up. */
  .calm-page { padding:var(--space-32) 0 var(--space-48); }
  .calm-rule { height:2px; width:3.5rem; background:var(--color-ink); border-radius:2px; margin-bottom:var(--space-24); }
  .calm-page.off .calm-rule { background:var(--color-border); }
  .calm-say { font-size:var(--font-size-title); line-height:1.45; color:var(--color-ink); margin:0; max-width:var(--measure-prose); }
  a.stat { color:inherit; }
  a.stat:hover .go, a.stat:focus-visible .go { color:var(--color-ink); }
  .stat.need .v { font-size:var(--font-size-title); }
  /* The controls the browser used to draw — the hand-to select, a details
     disclosure, a textarea outside a form — get the same recess as an input. */
  main select, main textarea, main input:not([type=checkbox]):not([type=radio]) {
    background:var(--color-surface); border:1px solid var(--color-ink-secondary);
    border-radius:var(--radius-control); color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
  main textarea { resize:vertical; }
  details > summary { display:flex; align-items:center; gap:var(--space-8); min-height:44px; cursor:pointer;
    color:var(--color-ink); font-size:var(--font-size-small); list-style:none; }
  details > summary::-webkit-details-marker { display:none; }
  details > summary::before { content:'›'; color:var(--color-ink-secondary); display:inline-block; }
  details[open] > summary::before { content:'⌄'; }
  [dir="rtl"] details:not([open]) > summary::before { transform:scaleX(-1); }
  /* The twins of :hover and :focus-visible, so a page can SHOW a state without a
     pointer. Only the components page under Setup wears them. */
  .btn:hover:not(.send):not(.ghost), .btn.is-hover:not(.send):not(.ghost) { background:var(--color-paper); }
  .btn.send.is-hover { box-shadow:var(--shadow-lift2); }
  .is-focus { outline:2px solid var(--color-ink); outline-offset:2px; }
  .btn:disabled, .btn.is-disabled { background:var(--color-paper); border-color:var(--color-border);
    color:var(--color-ink-secondary); box-shadow:none; cursor:default; }

  @media (max-width: 720px) {
    /* Rows matter here. .layout carries min-height:100vh, and with one column
       and no declared rows the nav and the content shared that height evenly:
       the nav row grew to half the viewport and, because a flex row stretches
       its children by default, the ACTIVE tab's background filled all of it —
       a jade slab down the page, on every surface, at phone width. */
    .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    /* Four destinations fit one row on a phone: an equal-width bottom-style bar
       at the top, each a full-height target, no wrapping to three ragged rows. */
    /* V1 step three — the nav STAYS (sticky) and compacts as the page scrolls.
       No script: the state is
       a pure function of scroll position, so nothing can be stuck collapsed and
       nothing changes when scripting is off. Where scroll-driven animation is
       unsupported the nav is simply sticky at full size. */
    nav.side { position:sticky; top:0; z-index:2; display:flex; flex-direction:row; align-items:center; gap:var(--space-4);
      height:auto; overflow:visible; padding:10px 12px; border-inline-end:none; border-bottom:1px solid var(--color-border); }
    /* The groups dissolve into the one row of five: Today, Inbox, Calendar,
       the assistant, Settings — each its icon over its word. "Customers", the
       wide rail's heading, is not an entry. */
    .navgroup, .navfoot, .navhub { display:contents; }
    .navhead { display:none; }
    /* The mark belongs to the product, so it sits with the product's nav — small,
       and without the word beside it. */
    nav.side .brand { display:flex; padding:0; margin-inline-end:var(--space-4); }
    nav.side .brand .mark-detail { display:none; }
    nav.side .brand .mark-small { display:flex; }
    nav.side .brand .brandname { display:none; }
    .business-name { display:block; }
    nav.side a.navlink, nav.side a.navlink.sub { position:relative; flex:1 1 0; flex-direction:column; flex-wrap:nowrap; white-space:nowrap;
      gap:var(--space-4); margin:0; padding:var(--space-4) 2px; min-height:56px; min-width:0; align-items:center; justify-content:center;
      font-size:var(--font-size-caption); text-align:center; box-shadow:none; }
    nav.side a.navlink.active { background: var(--color-surface); box-shadow: var(--shadow-lift1); }
    nav.side .nl-text { max-inline-size:100%; overflow:hidden; text-overflow:ellipsis; }
    /* The count rides the icon's corner on a phone: the word keeps its room. */
    nav.side .navcount { position:absolute; inset-block-start:2px; inset-inline-start:calc(50% + 4px); margin:0; }
    /* Phase 7 — one line: the shorter phone label where there is one, and a sideways scroll as the last resort. */
    nav.side { overflow-x:auto; scrollbar-width:none; padding-inline:var(--space-8); }
    /* Phase 9 (V1-014) — the entries sit edge to edge (each keeps its own padding), so "Customers" can carry its count on the one line. */
    nav.side { gap:0; }
    nav.side .navcount { margin-inline-start:var(--space-4); }
    .nl-long { display:none; }
    .nl-short { display:inline; }
    @supports (animation-timeline: scroll()) {
      @media (prefers-reduced-motion: no-preference) {
        nav.side { animation: nav-compact linear both; animation-timeline: scroll(root); animation-range: 0 160px; }
        nav.side a.navlink { animation: navlink-compact linear both; animation-timeline: scroll(root); animation-range: 0 160px; }
      }
    }
    main { padding:var(--space-16); }
    .msg { max-width:92%; }
    .stats { grid-template-columns: repeat(2,1fr); }
    .frow { flex-direction:column; align-items:flex-start; gap:var(--space-4); }
    .flabel { min-width:0; font-size:var(--font-size-caption); }
  }
  /* Phase 7 — the narrowest phones: the five entries before the small mark.
     Phase 9 (V1-014, cross-new-02) — up to 440 px, now that "Customers" carries
     its count and each entry has one name at every width (measured at 360–430
     in five languages); below 400 px the entries sit edge to edge. */
  @media (max-width: 379px) {
    nav.side .brand { display:none; }
  }
  @media (max-width: 440px) {
    nav.side .brand { display:none; }
  }
  @media (max-width: 400px) {
    nav.side a.navlink { padding-inline:0; }
  }
  /* V1 step three — the compaction the sticky phone nav plays over the first
     160px of scroll (see the phone block). Spacing from the scale only. */
  @keyframes nav-compact { to { padding-top:var(--space-4); padding-bottom:var(--space-4); } }
  @keyframes navlink-compact { to { min-height:44px; padding-top:var(--space-4); padding-bottom:var(--space-4); } }
`;

/**
 * V1 step four — the pages' own rules, one section per page, names defined
 * once. Served with the SHELL only: the login door and the public document
 * carry the base rules above and none of these, which kept the door at its
 * old size when the sections moved in.
 */
const STYLE_PAGES = `
  /* ── settings.ts — moved here whole in step four: page-specific names, defined once. */
  /* Phase 9 — five languages on the switch: it wraps inside its card rather than running past it on a phone. */
  .scard .langsw { flex-wrap:wrap; }
  /* Phase 7 — a menu row with a line under its name is 64 px; the line wraps rather than being cut,
     and the value beside it keeps its words (up to its half of the row) instead of giving way to the line. */
  .srow.sr-two { min-height:64px; }
  .srow.sr-menu.sr-two > .sr-main { flex:1 1 0; }
  /* ── guide.ts — the guided path: five steps, each with its video and its words. */
  .guide { list-style:none; margin:var(--space-16) 0 var(--space-32); padding:0; display:flex; flex-direction:column; gap:var(--space-24); }
  .guide-step { border:1px solid var(--color-border); border-radius:var(--radius-card); padding:var(--space-16); background:var(--color-surface); }
  .guide-step.next { border-color:var(--color-ink-secondary); }
  /* Phase 9 (V1-114) — the number holds the first line of a heading that wraps; the state ends its words. */
  .guide-step h2.gs-h { display:flex; align-items:baseline; gap:var(--space-8); margin:0 0 var(--space-12); }
  .gs-n { flex:none; }
  .gs-t { flex:1 1 auto; min-width:0; text-wrap:pretty; }
  .gs-t .pill { margin:0; margin-inline-start:var(--space-8); }
  .guide-step ol { margin:0 0 var(--space-12); padding-inline-start:var(--space-24); max-width:var(--measure-prose); }
  .guide-step ol li + li { margin-top:var(--space-4); }
  .guide-video { display:block; width:100%; max-width:var(--measure-prose); border-radius:var(--radius-card); background:var(--color-paper); margin-bottom:var(--space-8); }
  /* Phase 9 (today-onboarding-new-09) — a phone plays the step recorded at its own width. */
  .guide-video.narrow { display:none; }
  @media (max-width: 560px) { .guide-video.wide { display:none; } .guide-video.narrow { display:block; } }
  /* ── channels.ts — WA-S, writing after 24 hours, under the number it belongs to. */
  .ch-reopen { margin-top:var(--space-16); border-top:1px solid var(--color-border); padding-top:var(--space-12); }
  .fielderr { color:var(--color-warn); font-size:var(--font-size-caption); }
  .fld.bad input, .fld.bad textarea { border-color:var(--color-warn-line); }
  /* Phase 9 (V1-527) — the languages in even columns, not ragged rows: three on a wide screen, two on a phone. */
  .langs { display:grid; grid-template-columns:repeat(3, max-content); gap:0 var(--space-24); }
  @media (max-width: 560px) { .langs { grid-template-columns:repeat(2, max-content); } }
  .cats { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cat { background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-chip); padding:5px 12px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  /* Phase 9 (V1-502) — the fixed words, one line a language, inside their fold. */
  .floor-fold summary { cursor:pointer; min-height:44px; display:flex; align-items:center; font-size:var(--font-size-small); }
  .floor-langs { margin:var(--space-8) 0 0; }
  .floor-langs div { display:flex; flex-wrap:wrap; gap:var(--space-4) var(--space-12); padding:var(--space-4) 0; font-size:var(--font-size-small); }
  .floor-langs dt { font-weight:600; min-width:7em; }
  .floor-langs dd { margin:0; flex:1 1 16em; color:var(--color-ink-secondary); }
  /* Phase 9 (V1-492) — a file to take, one row of a card each: its name, and its own Download at the row's end. */
  .dl-files { max-width:var(--measure-prose); }
  .dl-files .row { padding:var(--space-4) var(--space-16); border-bottom:0; }
  /* Phase 9 (settings-a-new-10) — on a settings page an empty panel spans the column, as the cards above it do. */
  .empty.whole { max-width:100%; }
  /* Phase 9 (V1-483) — in Arabic a date or a time sits on the reading side of its field, like every word around it
     (the browser draws the field left to right, so its end is the right). */
  [dir="rtl"] input[type="date"], [dir="rtl"] input[type="time"] { text-align:end; }
  .rate-hist { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  .rate-hist li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .rate-hist li:last-child { border-bottom:0; }
  .closures { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  .closures li { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  .closures li:last-child { border-bottom:0; }
  .sreqs { list-style:none; margin:var(--space-12) 0 0; padding:0; display:flex; flex-direction:column; gap:var(--space-24); }
  .sreq-h { display:flex; align-items:baseline; gap:var(--space-8); flex-wrap:wrap; }
  .sreq-q { font-size:var(--font-size-small); margin-top:var(--space-4); max-width:var(--measure-prose); }
  .sreq-a { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-8); max-width:var(--measure-form); }
  .sreq-a textarea { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:10px 14px; font:inherit; }
  .sreq-do { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }

  /* ── pilot.ts — moved here whole in step four: page-specific names, defined once. */
  .rbsub { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  /* Phase 9 (V1-127, V1-128) — a count follows its label; a door ("Open ›") ends the row, as on every row of this page. */
  .rbrow { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-4) var(--space-8); min-height:44px; padding:4px 0; border-bottom:1px solid var(--color-paper); }
  .rbrow:last-child { border-bottom:0; }
  .rbrow .lbl { font-size:var(--font-size-small); text-wrap:pretty; }
  .rbrow .n { font-size:var(--font-size-small); font-weight:700; color:var(--color-ink); font-variant-numeric:tabular-nums; }
  .rbrow .rbgo, .rbrow .rbwhen { margin-inline-start:auto; }
  .rblink { font-size:var(--font-size-caption); }
  .rbsteps { margin:var(--space-8) 0 var(--space-16); padding-inline-start:20px; color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .rbsteps li { padding:2px 0; }
  .rbrow .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  /* Phase 9 (V1-143) — an Arabic value is words, not code: the page's own face, at its labels' size. */
  :lang(ar) .rbrow .mono { font-family:inherit; font-size:var(--font-size-small); line-height:inherit; }
  /* Engine evidence: raw on purpose — it is read by whoever fixes the defect. */
  .ev { border:1px solid var(--color-warn-line); background:var(--color-warn-wash); border-radius:var(--radius-card); padding:12px 14px; margin-top:var(--space-12); }
  .ev-h { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .ev-h .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  .ev-d { font-size:var(--font-size-caption); color:var(--color-warn); margin-top:var(--space-8); }
  .ev-p { font:var(--font-size-caption)/1.5 "SF Mono", ui-monospace, Menlo, monospace; color:var(--color-ink-secondary); margin:var(--space-8) 0 0; overflow-x:auto; unicode-bidi:plaintext; direction:ltr; text-align:start; }
  /* Phase 9 (V1-133–V1-135, V1-142, missed-15) — a checklist row is a grid: the
     mark in a column of its own (a ✓ and a ○ start their words at one edge, and a
     long label never leaves its mark alone on a line), the label, and what the
     row says or offers at its end; on a phone that last part goes under the
     label, from the label's own edge. */
  .pr { display:grid; grid-template-columns:1.5em minmax(10em, 1fr) minmax(0, auto); align-items:center;
    gap:var(--space-4) var(--space-8); padding:12px 0; border-bottom:1px solid var(--color-paper); }
  .pr:last-child { border-bottom:0; }
  .pr > .mk { grid-column:1; justify-self:center; font-size:var(--font-size-base); font-weight:700; }
  .pr > .lbl { grid-column:2; font-size:var(--font-size-small); text-wrap:pretty; }
  .pr > .lbl:first-child { grid-column:1 / 3; }
  .pr > :not(.mk):not(.lbl):not(.pr-note) { grid-column:3; justify-self:end; }
  .pr.done .mk { color:var(--color-ok); }
  .pr.todo .mk:not(.dot) { color:var(--color-ink-secondary); }
  .pr.unknown .mk { color:var(--color-ink-secondary); }
  .pr-note { grid-column:2 / -1; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .help-links { margin:var(--space-8) 0 0; padding-inline-start:18px; font-size:var(--font-size-small); }
  .pr-b { display:flex; align-items:center; justify-content:flex-end; gap:var(--space-4) var(--space-8); flex-wrap:wrap; }
  .pr .deeper, .pr .btn { flex:none; }
  /* The name row: its label, the line under it, then the field with Confirm beside it — in every language. */
  .pr.under > .pr-b { grid-column:2 / -1; justify-self:stretch; flex-direction:column; align-items:flex-start; }
  .pr-name { display:flex; flex-wrap:nowrap; align-items:center; gap:var(--space-8); width:100%; max-width:var(--measure-form); }
  .pr-name input { flex:1 1 auto; min-width:0; }
  @media (max-width: 560px) {
    .pr { grid-template-columns:1.5em minmax(0, 1fr); }
    .pr > :not(.mk):not(.lbl):not(.pr-note) { grid-column:2; justify-self:start; }
    .pr-b { justify-content:flex-start; }
  }
  .badge { font-size:var(--font-size-caption); padding:3px 10px; border-radius:var(--radius-chip); }
  .badge.sys { background:var(--color-ok-wash); color:var(--color-ok); }
  .badge.owner { background:var(--color-paper); color:var(--color-ink); font-weight:600; }
  /* Phase 9 (V1-130, missed-17) — where the page stands, said as a state line with its mark: not a box that looks pressable. */
  .verdict { margin:var(--space-16) 0 0; font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); text-wrap:pretty; }
  .verdict.ok { color:var(--color-ok); }
  /* ── ready.ts — Phase 9: the marks in one column, the state in words, its door under it. */
  .checks.rd .chk { grid-template-columns:1.25em minmax(0, 1fr); }
  .checks.rd .mk { justify-self:center; }
  .checks.rd .lbl { text-wrap:pretty; }
  .checks.rd .rd-state { grid-column:2; font-size:var(--font-size-small); color:var(--color-ink-secondary); text-wrap:pretty; }
  .checks.rd .deeper { grid-column:2; padding:0; min-height:44px; }

  /* ── Notifications (the warmth run, phase 8) — while the owner is in Nomi, a customer newly waiting
     shows wherever they are: a dot on Inbox, the count, and one small card. No sound, no counter
     in the tab's title, nothing that is not a customer waiting. */
  nav.side a.navlink[data-fresh] { position:relative; }
  nav.side a.navlink[data-fresh]::after { content:""; position:absolute; inset-block-start:var(--space-8);
    inset-inline-start:calc(var(--space-24) + 16px); inline-size:8px; block-size:8px;
    border-radius:var(--radius-chip); background:var(--color-waiting); }
  .toasts { position:fixed; z-index:6; inset-block-end:var(--space-24); inset-inline-end:var(--space-24);
    inline-size:min(var(--measure-form), calc(100vw - var(--space-48))); display:flex; flex-direction:column;
    align-items:flex-end; pointer-events:none; }
  .toast { pointer-events:auto; display:flex; align-items:center; min-block-size:44px; max-inline-size:100%;
    padding:var(--space-12) var(--space-16); border-radius:var(--radius-card); background:var(--color-surface);
    color:var(--color-ink); box-shadow:var(--shadow-lift2); font-size:var(--font-size-small); text-decoration:none;
    overflow-wrap:anywhere; }
  @media (max-width: 720px) {
    nav.side a.navlink[data-fresh]::after { inset-block-start:var(--space-4); inset-inline-start:calc(50% - 16px); }
    .toasts { inset-inline:var(--space-16); inset-block-end:var(--space-16); inline-size:auto; align-items:stretch; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .toast { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }
  }
  /* The Notifications page: the three ways one under another; one that cannot be chosen yet reads as such. */
  .choices.ways { flex-direction:column; }
  .choices.ways label.check:has(> input:disabled) { color:var(--color-ink-secondary); }
  /* ── employee.ts — moved here whole in step four: page-specific names, defined once. */
  .levels { display:flex; flex-direction:column; gap:var(--space-12); margin-top:var(--space-12); }
  .level { display:flex; align-items:flex-start; gap:var(--space-8); cursor:pointer; }
  .level > span { display:flex; flex-direction:column; gap:var(--space-4); }
  .lnote { font-size:var(--font-size-caption); }
  .levels .btn { align-self:flex-start; }
  /* Above the choice, not below it: she reads what happens before she decides, which is the whole point of putting it on this page. */
  .disclose { border-inline-start:1px solid var(--color-border); padding-inline-start:var(--space-12); margin-block:var(--space-12) 0; }
  /* M34.7 — a spot check reads as the work itself, not as a form to fill in. */
  .scheck { padding:12px 0; border-bottom:1px solid var(--color-border); }
  .scheck:last-child { border-bottom:0; }
  .sclabel { font-size:var(--font-size-caption); margin-top:var(--space-8); }
  .scsaid { padding:6px 0; }
  .scfix summary { color:var(--color-ink-secondary); font-size:var(--font-size-small); cursor:pointer; padding:6px 0; }
  .scfix textarea { width:100%; }
  /* Phase C: plain count rows and tappable gap rows — no matrix, no dense table. */
  .hrows { display:flex; flex-direction:column; gap:var(--space-4); }
  .hrow { display:flex; align-items:baseline; gap:var(--space-12); padding:8px 0; border-bottom:1px solid var(--color-border); }
  .hrow:last-child { border-bottom:0; }
  .hnum { font-size:var(--font-size-base); font-weight:700; color:var(--color-ink); min-width:2.2em; font-variant-numeric:tabular-nums; }
  .hlabel { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .gaps { display:flex; flex-direction:column; gap:var(--space-8); }
  a.gap { display:grid; grid-template-columns:1fr auto; gap:var(--space-4) var(--space-12); background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-card); padding:14px 16px; }
  a.gap:hover, a.gap:focus-visible { border-color:var(--color-ink-secondary); }
  .gq { font-size:var(--font-size-small); color:var(--color-ink); }
  .gmeta { font-size:var(--font-size-caption); grid-column:1; }
  .gact { grid-row:1 / span 2; align-self:center; color:var(--color-ink); font-size:var(--font-size-small); white-space:nowrap; }
  @media (max-width:560px) { a.gap { grid-template-columns:1fr; } .gact { grid-row:auto; text-align:start; } }
  /* Phase 9 — the card says what the assistant does today; the h1 above it is the name. */
  .emp-stage { font-size:var(--font-size-small); font-weight:600; }
  .emp-hired { margin-top:var(--space-8); }
  /* A task list is a list, not a pile of cards: nothing in it can be pressed. The prose measure, like every list. */
  .dgroup { margin-bottom:var(--space-16); max-width:var(--measure-prose); }
  .dtitle { font-weight:600; margin-bottom:var(--space-4); }
  .ditems { list-style:none; margin:0; padding:0; }
  .ditem { padding:var(--space-4) 0; margin:0; font-size:var(--font-size-small); }
  .growth { list-style:none; padding:0; margin:0; }
  .growth li { padding:9px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .growth li:last-child { border-bottom:none; }
  .pstage { margin:var(--space-8) 0; font-size:var(--font-size-small); }
  .conds { margin-top:var(--space-12); display:flex; flex-direction:column; gap:var(--space-8); }
  .cond { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .actrow { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .actrow:last-of-type { border-bottom:none; }
  /* THE WARMTH RUN, phase 7 — the landing: the control stands apart from the menu under it; what holds every level (stopped, paused) leads it. */
  .level-control { margin-bottom:var(--space-24); }
  /* A short value ("24 products", "3 words") is said whole; the name beside it wraps instead. A long one still stops at half the row. */
  .asst-menu .sr-value { flex-shrink:0; }
  .held-all { margin-bottom:var(--space-12); }
  .held-all p { margin:0 0 var(--space-4); }
  /* The name screen: the name itself, at the size of a name. */
  .emp-called { font-size:var(--font-size-title); font-weight:600; margin:0 0 var(--space-12); }

  /* ── factory.ts — moved here whole in step four: page-specific names, defined once. */
  .lede { color:var(--color-ink-secondary); margin:0 0 var(--space-24); font-size:var(--font-size-small); max-width:var(--measure-prose); }
  /* The next step is a door, not a checklist row. It vanishes when done. */
  /* M49 — the next step is an ACTION, not a state. Filled in jade it was the loudest object on a page about somebody's factory, and it competed with the two lines that actually report how her business stands. A raised sheet says "start here" without spending the one colour that means something. */
  /* Sections are grouped decisions, not settings panels. */
  .fblock { border-top:1px solid var(--color-border); padding:var(--space-24) 0; }
  .fblock:first-of-type { border-top:0; padding-top:0; }
  .fhead { margin-bottom:var(--space-12); }
  .fhead h2 { margin:0; font-size:var(--font-size-base); font-weight:600; color:var(--color-ink); }
  /* Phase 9 — the one line under a heading that answers it ("Not yet: 2 things first"). */
  .fready { margin:var(--space-8) 0 0; font-size:var(--font-size-small); color:var(--color-ink); max-width:var(--measure-prose); }
  /* The next step stands apart from the first section, not on its heading. */
  .lede + .deeper.next { margin-bottom:var(--space-16); }
  .fdesc { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:var(--space-8) 0 0; max-width:var(--measure-prose); }
  .fdesc-lead { margin:0 0 var(--space-12); }
  .fempty { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:0; max-width:var(--measure-prose); }
  .fval { color:var(--color-ink); }
  .fnames { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:var(--space-8) 0 0; }
  /* Phase 9 — a name and its separator are one unit: a line breaks between names, never inside one or before a "·". */
  .fitem { display:inline-block; }
  .fwarn { color:var(--color-waiting); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fok { color:var(--color-ink); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fchips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .fchip { font-size:var(--font-size-caption); padding:6px 13px; border-radius:var(--radius-chip); background:var(--color-paper); color:var(--color-ink); border:1px solid var(--color-border); }
  .frules { margin:var(--space-16) 0 0; padding-inline-start:18px; color:var(--color-ink); font-size:var(--font-size-small); line-height:1.6; }
  /* The promise the whole product rests on — read it before the fine print. */
  .fnever { margin:var(--space-16) 0 0; font-size:var(--font-size-small); line-height:1.6; color:var(--color-ink); max-width:var(--measure-prose); border-inline-start:2px solid var(--color-ink); padding-inline-start:14px; }
  .fsteps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .fsteps li { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .fsteps li.done { color:var(--color-ink); }
  .sub3 { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); margin:var(--space-24) 0 var(--space-4); }
  /* Findings are a to-do list, not an alarm: same weight as any other step. */
  .rehear { margin-top:var(--space-12); display:flex; flex-direction:column; gap:var(--space-12); }
  .fgap .fnames { margin-top:var(--space-4); }
  .fgap-s { margin:0; font-size:var(--font-size-small); color:var(--color-ink); max-width:var(--measure-prose); }
  .alform { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-16); max-width:var(--measure-form); }
  .alform .fld { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); }
  .alform input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:10px 14px; font:inherit; }
  .rm { margin-inline-start:var(--space-8); }
  /* M49 — a link is ink; jade is spent on sending and on state. */
  .blink { color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  /* Phase 7 — the channels are rows of their own screen now (the menu row's value carries the state); the cards' rules went with them. */
  .fblock .deeper { margin-top:var(--space-8); }
  /* Doors in a column keep the column's own gap, as everywhere else. */
  .fblock .doors .deeper { margin-top:0; }
  /* priceRules.ts, phase 9 — a section's rule is as wide as its rows (missed-16); a product's
     name is the row's loudest word (V1-352); the answer for everything folds away when unused (V1-351). */
  .pr-block { max-width:var(--measure-prose); }
  .pr-name { font-size:var(--font-size-small); color:var(--color-ink); display:flex; flex-wrap:wrap; align-items:baseline; gap:var(--space-8); }
  .pr-fold > summary { cursor:pointer; min-height:44px; display:flex; align-items:center; font-size:var(--font-size-small); }

  /* ── products.ts — moved here whole in step four: page-specific names, defined once. */
  .pq input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
  .pcheck { display:flex; align-items:center; gap:var(--space-8); font-size:var(--font-size-small); color:var(--color-ink); min-height:44px; }
  .phead { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
  /* Products are a dense list (decision 2), not a card each. */
  /* Phase 9 (V1-302) — a row that opens carries the chevron every door has, at its end. */
  .prod { display:flex; align-items:center; gap:var(--space-12); padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); color:inherit; }
  .prod:last-child { border-bottom:0; }
  .prod-m { flex:1; min-width:0; }
  .prod-h { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .prod-b { display:block; font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .p-tag { display:block; color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin-top:var(--space-8); }
  .prod-add { margin:0 0 var(--space-16); }
  /* w4-products-knowledge-12 — "printed or handwritten?" is a question, at the size of the page's other labels. */
  .choices.hand legend { font-size:var(--font-size-small); color:var(--color-ink); }
  .p-tag.big { color:var(--color-ok); font-size:var(--font-size-small); margin-bottom:var(--space-12); }
  .info { display:flex; flex-direction:column; gap:var(--space-8); font-size:var(--font-size-small); }
  .imgs { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .imgs img { width:96px; height:96px; object-fit:cover; border-radius:var(--radius-control); border:1px solid var(--color-border); }
  .qrow { font-size:var(--font-size-caption); padding:6px 0; border-bottom:1px solid var(--color-border); }
  .qrow:last-child { border-bottom:none; }
  .rev { display:flex; align-items:center; gap:var(--space-8); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); flex-wrap:wrap; }
  .rev:last-child { border-bottom:none; }
  .rev-src { flex-basis:100%; font-size:var(--font-size-caption); }
  .rev-move { flex-basis:100%; }
  .photo-in { display:block; width:100%; margin:var(--space-12) 0; font:inherit; color:var(--color-ink); min-height:44px; }
  /* Phase 9 (V1-323) — a file box in the page's own words: the browser's box stays the control
     (focusable, named by its label) but is not drawn, and the line beside it says whether one was chosen. */
  .filepick { position:relative; display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-12); margin:var(--space-12) 0; }
  .filepick input[type=file] { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }
  .filepick:focus-within .btn { outline:2px solid var(--color-ink); outline-offset:2px; }
  .filepick input:invalid ~ .filepick-some, .filepick input:valid ~ .filepick-none { display:none; }
  .filepick-some { font-size:var(--font-size-small); color:var(--color-ink); }
  textarea { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:12px; font:inherit; resize:vertical; margin:var(--space-12) 0; }
  @media (max-width:560px) { .imgs img { width:72px; height:72px; } }
  /* The import review: the photos beside the rows from a wide screen, above them on a phone. */
  .imp { display:block; }
  .imp.with-photos { display:grid; gap:var(--space-16); }
  @media (min-width:1100px) { .imp.with-photos { grid-template-columns:minmax(0, 2fr) minmax(0, 3fr); align-items:start; }
    .imp-photos { position:sticky; top:var(--space-16); } }
  .imp-photo { margin:0 0 var(--space-16); }
  .imp-photo img { display:block; width:100%; height:auto; border:1px solid var(--color-border); border-radius:var(--radius-control); background:var(--color-paper); }
  .imp-photo figcaption { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin-top:var(--space-4); }
  .imp-row { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .imp-row:last-child { border-bottom:0; }
  .imp-row.need { border-inline-start:3px solid var(--color-waiting-line); padding-inline-start:var(--space-12); }
  .imp-row.out { opacity:0.6; }
  .imp-h { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .imp-warn { display:block; color:var(--color-waiting); font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .imp-typed, .imp-q { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); margin-top:var(--space-8); }
  .imp-typed input, .imp-pct input, .imp-edit input, .imp-edit select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:9px 12px; font:inherit; min-height:44px; }
  .imp-typed input, .imp-pct input { width:8em; }
  /* Phase 9 (V1-340) — the figure and its sign stay on one line, in either direction. */
  .imp-pct { display:inline-flex; align-items:center; gap:var(--space-4); white-space:nowrap; }
  /* Phase 9 (V1-336, V1-335) — the tick the owner gives, on its own line; a note under a row. */
  .imp-tick { margin-top:var(--space-8); }
  .imp-note { display:block; margin-top:var(--space-4); }
  .imp-pending { font-size:var(--font-size-small); color:var(--color-ink); margin:var(--space-16) 0 0; max-width:var(--measure-prose); }
  .imp-edit { margin-top:var(--space-8); }
  .imp-edit summary { cursor:pointer; color:var(--color-ink-secondary); min-height:44px; display:flex; align-items:center; }
  .imp-edit label { display:flex; flex-direction:column; gap:var(--space-4); margin:var(--space-8) 0; }
  .imp-edit label.pcheck { flex-direction:row; }
  .imp-acts { display:flex; flex-wrap:wrap; gap:var(--space-12); align-items:center; margin:var(--space-16) 0; }
  .imp-floor { align-items:flex-start; padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  /* A store's table, a few rows of it, scrolling sideways inside its own box on a phone. */
  .imp-table { overflow-x:auto; margin:var(--space-12) 0; border:1px solid var(--color-border); border-radius:var(--radius-control); }
  .imp-table table { border-collapse:collapse; font-size:var(--font-size-caption); min-width:100%; }
  .imp-table th, .imp-table td { padding:6px 10px; border-bottom:1px solid var(--color-border); text-align:start; white-space:nowrap; }
  .imp-cols label { display:flex; flex-direction:column; gap:var(--space-4); margin:var(--space-12) 0; }
  .imp-cols label.pcheck { flex-direction:row; }
  .imp-cols select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:9px 12px; font:inherit; min-height:44px; }

  /* ── channels.ts — moved here whole in step four: page-specific names, defined once. */
  .reach .reqs, .reach .instead ul { list-style:none; margin:var(--space-8) 0 0; padding:0; }
  .reach .reqs li, .reach .instead li { padding:var(--space-4) 0; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  /* Phase 9 — a requirement's words wrap beside its pill, never back under it; what it takes sits under its name. */
  .reach .reqs li { display:flex; align-items:baseline; gap:var(--space-8); }
  .reach .reqs .pill { flex:none; margin:0; }
  .req-t { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .req-how { font-size:var(--font-size-caption); }
  /* One column on this page: the cards keep the measure the rows and the prose keep. */
  .card.ch, .card.reach { max-width:var(--measure-prose); }
  .reach .win { font-size:var(--font-size-small); margin-top:var(--space-8); }
  .reach .instead { margin-top:var(--space-12); padding-top:var(--space-8); border-top:1px solid var(--color-border); }
  .reach .outreach { margin-top:var(--space-12); padding-top:var(--space-12); border-top:1px solid var(--color-border); display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-12); }
  .reach .outreach .on { color:var(--color-ink); font-weight:600; }
  .reach .warn-line { flex-basis:100%; font-size:var(--font-size-small); margin:0; }
  .reach .capform { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--space-8); flex-basis:100%; }
  .reach .capform input[type=number] { width:8ch; }
  .reach .cap-hint { font-size:var(--font-size-small); }
  .dom { margin-top:var(--space-12); }
  .dom-h { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; }
  .dom .who { font-weight:600; }
  .dns { list-style:none; margin:var(--space-8) 0; padding:0; }
  .dns li { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; padding:var(--space-4) 0; font-size:var(--font-size-small); }
  .dns .host { color:var(--color-ink-secondary); overflow-wrap:anywhere; }
  .domform { display:grid; gap:var(--space-8); margin-top:var(--space-12); }
  /* M49 — a button is as wide as its word; a grid cell would stretch it to the card. */
  .domform .btn { justify-self:start; }
  /* V1 type scale — the headline pill carries a sentence ("You can write first once these are in place"); at caption 13 it no longer fits beside the name on a 390 px phone, and a pill is nowrap by rule. Let the row wrap and let this one pill break, rather than push the page 7 px wider than the screen. */
  .ch-h { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .ch-h .pill { white-space:normal; }
  .ch-name { font-size:var(--font-size-small); font-weight:700; }
  .ch-desc { font-size:var(--font-size-caption); margin:var(--space-8) 0 var(--space-12); }
  .ch-info { display:flex; flex-direction:column; gap:var(--space-4); background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-control); padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); }
  .ch-acts { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .prob { background:var(--color-waiting-wash); color:var(--color-waiting); border-radius:var(--radius-control); padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); line-height:1.6; }
  .prob.bad { background:var(--color-warn-wash); color:var(--color-warn); }
  .ownerform { display:flex; flex-direction:column; gap:var(--space-4); margin-bottom:var(--space-8); }
  .ownerform input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:10px 14px; font:inherit; }
  /* ── howYouSell.ts — Phase 9: the hub and its questions. */
  .hs-count { font-size:var(--font-size-small); color:var(--color-ink-secondary); margin:0 0 var(--space-12); }
  .hs-start { margin:0 0 var(--space-8); }
  /* The hub's rows run the column's width, like the sections of My business it opens from. */
  .hs-rows { max-width:100%; }
  /* A chip is one word on one line: its outline never splits across two. */
  .hs-q .chip { display:inline-block; white-space:nowrap; }
  .hs-pos { margin:0 0 var(--space-4); }
  /* The usual choice is said on its own line, so no dash leads a line and no character is left alone at the end of one. */
  .hs-usual { display:block; }
  .hs-choices .pcheck span, .hs-hint { text-wrap:pretty; }
  .hs-acts { margin:var(--space-16) 0 0; }
  /* Phase 9 — Connect WhatsApp: three numbered steps, read in order. */
  .wa-steps { list-style:decimal; margin:0 0 var(--space-16); padding-inline-start:var(--space-24); max-width:var(--measure-prose); font-size:var(--font-size-small); }
  .wa-steps li { margin-bottom:var(--space-8); }
  /* Phase 9 — the Meta help page: a step's title stands above its two lines; a link to Meta looks like a link and says it leaves. */
  .help-line { font-size:var(--font-size-small); margin:var(--space-8) 0 0; max-width:var(--measure-prose); }
  .help-links a { color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  .help-links .ext { margin-inline-start:var(--space-4); font-size:var(--font-size-small); }

  /* ── knowledge.ts — moved here whole in step four: page-specific names, defined once. */
  /* The two scopes sit side by side, so each says which one it is. */
  /* A scope caption explains; it is not a state, so it gets no colour. */
  /* Phase 9 (missed-20) — a short line never leaves one character alone on the next. */
  .scope { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-4) 0 var(--space-12); text-wrap:pretty; }
  /* Phase 9 (new-17) — lists, cards and empty panels share the one measure, so nothing on the page is narrower than its neighbours. */
  .klist, .kitem, .gap { max-width:var(--measure-prose); }
  .klist { display:flex; flex-direction:column; gap:var(--space-8); }
  .krow { display:flex; justify-content:space-between; background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-control); padding:12px 16px; }
  .krow:hover { border-color:var(--color-border); }
  .kitem { border:1px solid var(--color-border); border-radius:var(--radius-card); padding:14px; margin-bottom:var(--space-12); }
  .kh { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .kh .src { margin-inline-start:auto; font-size:var(--font-size-caption); }
  .kc { margin:var(--space-8) 0; white-space:pre-wrap; }
  .teach, .krow-actions { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
  .teach h3 { margin:0; font-size:var(--font-size-small); }
  input[type=text], textarea, select { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:9px 12px; font:inherit; }
  .kbtns { display:flex; gap:var(--space-8); }
  /* Phase 9 (V1-372) — a certification is a row: its name, on or off in words, and the button that switches it. */
  .cert-name { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); font-size:var(--font-size-small); }
  .cert-name .pill { margin:0; }

  /* ── knowledge-insights.ts — moved here whole in step four: page-specific names, defined once. */
  h3.sub { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .reqs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); }
  .reqs .q { color:var(--color-ink); }
  .gap { border:1px solid var(--color-border); border-radius:var(--radius-card); padding:14px; margin-bottom:var(--space-12); }
  .ki-q { font-size:var(--font-size-small); margin-bottom:var(--space-8); }
  .ki-meta { display:flex; gap:var(--space-8); align-items:center; margin-bottom:var(--space-12); }
  .gacts { display:flex; gap:var(--space-8); }
  .pill.reason { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .pill.taught { background:var(--color-ok-wash); color:var(--color-ok); }
  .pill.corrected { background:var(--color-paper); color:var(--color-ink); font-weight:600; }
  .pill.archived { background:var(--color-border); color:var(--color-ink-secondary); }
  .ki-acts { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .ki-acts li { display:flex; align-items:center; gap:var(--space-8); }
  .usage { font-size:var(--font-size-caption); margin-top:var(--space-8); }

  /* ── contacts.ts — moved here whole in step four: page-specific names, defined once. */
  .cts { list-style:none; margin:var(--space-12) 0; padding:0; }
  .ct { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
  .ct:last-child { border-bottom:0; }
  .ct.gone { opacity:.55; }
  .ct-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
  .ct .id { color:var(--color-ink-secondary); margin-inline-start:var(--space-8); }
  .ct-a { display:flex; gap:var(--space-8); flex-wrap:wrap; margin-top:var(--space-8); }
  .ct-b { font-size:var(--font-size-small); margin-top:var(--space-4); }
  .ct .reach-line { font-size:var(--font-size-small); margin-top:var(--space-8); }
  .ct .ct-co { font-size:var(--font-size-small); margin-top:var(--space-8); display:block; }
  .ct .st { display:inline-flex; align-items:baseline; gap:var(--space-8); }
  .ct .since { font-size:var(--font-size-small); }
  /* Permanent, and it should read that way at a glance. */
  .ct.stopped .who { color:var(--color-ink-secondary); }
  .btn.stop { color:var(--color-ink-secondary); }
  .cform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
  .confirm { display:flex; gap:var(--space-12); align-items:center; flex-wrap:wrap; margin-top:var(--space-12); }
  .wform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
  .wform textarea { width:100%; font:inherit; }
  .wact { display:flex; gap:var(--space-12); align-items:center; flex-wrap:wrap; }
  /* Phase 9 (V1-543, V1-544) — the list grouped by its answer, the reason said once at each group's head. */
  .ctgroup { margin-top:var(--space-24); }
  .ctgroup-h { margin:0 0 var(--space-4); }
  .ctgroup > p { margin:0 0 var(--space-4); max-width:var(--measure-prose); }
  .ctgroup > .cts { margin-top:var(--space-8); }
  /* ── Phase 9 · Who works here, the rate, samples and terms (settings-b). */
  .askname { margin-top:var(--space-16); }
  .owner-only { margin:var(--space-8) 0 var(--space-12); padding-inline-start:var(--space-24); max-width:var(--measure-prose);
    font-size:var(--font-size-small); color:var(--color-ink); }
  .owner-only li + li { margin-top:var(--space-4); }
  .act-fold { margin-top:var(--space-8); }
  .act-fold > .sform { margin-top:var(--space-8); }
  .as-chans { display:grid; grid-template-columns:repeat(2, max-content); gap:0 var(--space-16); }
  .fr-need { font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink); }
  /* A setting not made yet (the rate, samples, terms): a panel as wide as the
     card under it, apart from it, its last line never one word alone. */
  .empty.notset { max-width:100%; margin-bottom:var(--space-16); text-wrap:pretty; }

  /* ── calendar.ts — the warmth run, phase 6: the list first; every date a face and a sentence; the chrome folded away.
     Where a date came from is its EDGE (solid: a conversation; dashed: the owner); colour is left for state. */
  .cal-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8) var(--space-16); flex-wrap:wrap; }
  .cal-top h1.page { margin:0; }
  .cal-views { margin:0; gap:var(--space-4); flex-wrap:wrap; }
  .cal-views .tab { padding:var(--space-8) var(--space-12); }
  /* Phase 9 (V1-199) — the period's name, then how to move from it, in words; the warmth run — one compact line where it fits. */
  .cal-period { display:flex; align-items:center; justify-content:space-between; gap:0 var(--space-12); flex-wrap:wrap; margin:var(--space-8) 0 0; }
  .cal-period .cal-span { margin:0; font-weight:600; color:var(--color-ink); font-size:var(--font-size-base); }
  .cal-move { display:flex; align-items:center; gap:0 var(--space-12); flex-wrap:wrap; }
  .cal-today { display:inline-flex; align-items:center; min-height:44px; padding:0 var(--space-12); font-weight:600; font-size:var(--font-size-small); }
  .cal-chosen { margin:0; color:var(--color-ink-secondary); }
  .cal-chosen a { display:inline-flex; align-items:center; min-height:44px; margin-inline-start:var(--space-8); color:var(--color-ink);
    text-decoration:underline; text-underline-offset:3px; }
  /* The page's one fold: choosing one kind or one customer, adding a date, what the marks mean. Closed until reached for. */
  .cal-tools { margin:var(--space-4) 0 0; }
  .cal-tools > summary { color:var(--color-ink-secondary); }
  .cal-tools-in { display:grid; gap:var(--space-16); margin:var(--space-4) 0 var(--space-8); padding:var(--space-16); max-width:var(--measure-prose);
    background:var(--color-surface); border-radius:var(--radius-card); box-shadow:var(--shadow-lift1); }
  .cal-sub { margin:0 0 var(--space-4); font-weight:600; font-size:var(--font-size-small); color:var(--color-ink); }
  .cal-key { border-top:1px solid var(--color-border); padding-top:var(--space-12); }
  .cal-lede { margin:0; }
  /* Phase 9 (V1-200) — the legend draws each mark it explains; an edge is a small square-cornered swatch, not a pill. */
  .cal-legend { display:flex; align-items:center; gap:var(--space-4) var(--space-16); flex-wrap:wrap; color:var(--color-ink-secondary); margin:var(--space-8) 0 0; }
  .cal-li { display:inline-flex; align-items:center; gap:var(--space-4); }
  .cal-sw { display:inline-block; inline-size:var(--space-16); block-size:var(--space-12); border:1px solid var(--color-ink-secondary); border-inline-start-width:3px; border-radius:2px; }
  .cal-sw.dashed { border-style:dashed; }
  .cal-times { display:flex; gap:var(--space-12); flex-wrap:wrap; }
  .cal-rm { margin:var(--space-4) 0 0; }
  .cal-rm .btn { min-height:32px; padding:0; font-size:var(--font-size-caption); }
  /* TODAY is marked in magenta, in a word as well — one of magenta's three jobs, and only ever as text. */
  .cal-now { font-size:var(--font-size-caption); font-weight:700; color:var(--color-assistant); margin-inline-start:var(--space-4); }
  .cal-day .cal-now, .cal-span .cal-now { font-size:inherit; margin:0; }
  /* A list, a day at a time: the day's heading, then its dates in a rounded card. */
  .cal-dayblock { margin:var(--space-24) 0 0; }
  .cal-day { display:flex; align-items:baseline; flex-wrap:wrap; gap:0 var(--space-8); margin:0 0 var(--space-8); }
  .empty.cal-none { margin:0; }
  /* Phase 7 — the day as ONE list in time order; the warmth run — the hour, the face (its kind's icon on its corner), the sentence. */
  .dl { list-style:none; margin:var(--space-12) 0 0; padding:0; max-width:var(--measure-prose);
    background:var(--color-surface); border-radius:var(--radius-card); box-shadow:var(--shadow-lift1); }
  .cal-dayblock .dl { margin:0; }
  .dl-row { display:flex; align-items:flex-start; gap:var(--space-12); padding:var(--space-12); border-top:1px solid var(--color-border); }
  .dl-row:first-child { border-top:0; }
  .dl-hour { flex:none; inline-size:4em; padding-top:var(--space-8); font-size:var(--font-size-caption); color:var(--color-ink-secondary);
    font-variant-numeric:tabular-nums; overflow-wrap:break-word; }
  .dl-who { position:relative; flex:none; display:inline-grid; place-items:center; inline-size:32px; block-size:32px; }
  .dl-who .kind-icon { position:absolute; inset-block-end:-4px; inset-inline-end:-6px; inline-size:18px; block-size:18px; padding:2px;
    background:var(--color-surface); border-radius:var(--radius-chip); color:var(--color-ink-secondary); pointer-events:none; }
  /* A date that is nobody's — a closure, the owner's own — has its kind's icon in the face's place. */
  .dl-who.dl-only { border-radius:var(--radius-chip); background:var(--color-paper); }
  .dl-who.dl-only .kind-icon { position:static; inline-size:20px; block-size:20px; padding:0; background:transparent; }
  .dl-go { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); min-height:32px; color:inherit; text-decoration:none; }
  .dl-body { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  /* A name is never cut: it wraps, a Latin name inside Arabic too (isolated by its bdi). */
  .dl-say { color:var(--color-ink); overflow-wrap:break-word; text-wrap:pretty; }
  .dl-say bdi { font-weight:600; }
  .dl-row.dashed .dl-go { border-inline-start:2px dashed var(--color-ink-secondary); padding-inline-start:var(--space-8); }
  .dl-row.solid .dl-go { border-inline-start:2px solid var(--color-ink-secondary); padding-inline-start:var(--space-8); }
  /* Done is greyed, never hidden: the words in Stone, the face without its colour. */
  .dl-row.done, .dl-row.done .dl-say { color:var(--color-ink-secondary); }
  .dl-row.done .dl-say bdi { font-weight:400; }
  .dl-row.done .face, .mo-e.done .face { filter:grayscale(1); opacity:0.55; }
  /* The list's days behind today, folded below; open by themselves when something in them is still owed. */
  .cal-earlier { margin:var(--space-24) 0 0; }
  .cal-earlier > summary { font-weight:600; color:var(--color-ink-secondary); }
  .cal-owed { display:inline-flex; align-items:center; gap:var(--space-4); font-weight:400; font-size:var(--font-size-caption); }
  /* An empty period: one warm panel, its one door — never a grey box under rows of scaffolding. */
  .empty.cal-empty { display:grid; justify-items:start; gap:var(--space-8); margin:var(--space-16) 0 0; padding:var(--space-24);
    border:0; border-radius:var(--radius-panel); background:var(--color-surface); box-shadow:var(--shadow-lift1); }
  .cal-empty-i { display:grid; place-items:center; inline-size:56px; block-size:56px; border-radius:var(--radius-chip);
    background:var(--color-paper); color:var(--color-ink-secondary); }
  .cal-empty-ic { inline-size:28px; block-size:28px; }
  .cal-empty-t { margin:0; font-size:var(--font-size-title); font-weight:600; color:var(--color-ink); text-wrap:balance; }
  .cal-empty .muted { margin:0; font-size:var(--font-size-small); }
  .cal-empty .cal-add { margin:0; }
  .cal-empty .cal-add > summary { font-weight:600; }
  /* Phase 7 — the month on a phone SAYS it is wider than the screen: a shade at each edge that has more beyond it (it goes when
     that edge is reached), and a thin bar. The warmth run — its frame rounded. Positioned, so a screen reader's words scroll with it. */
  .wk-scroll { position:relative; overflow-x:auto; margin:var(--space-12) 0; scrollbar-width:thin; scrollbar-color:var(--color-ink-secondary) transparent;
    border:1px solid var(--color-border); border-radius:var(--radius-panel);
    overscroll-behavior-x:contain; background-color:var(--color-surface);
    background-image:linear-gradient(to right, var(--color-surface) var(--space-12), transparent), linear-gradient(to left, var(--color-surface) var(--space-12), transparent),
      linear-gradient(to right, var(--color-ink-secondary), transparent), linear-gradient(to left, var(--color-ink-secondary), transparent);
    background-position:left center, right center, left center, right center;
    background-size:var(--space-32) auto, var(--space-32) auto, var(--space-8) auto, var(--space-8) auto;
    background-repeat:no-repeat; background-attachment:local, local, scroll, scroll; }
  /* Columns wide enough for a whole surname beside its face (a name wraps between words, never inside one). */
  .mo { width:100%; min-width:840px; border-collapse:separate; border-spacing:0; table-layout:fixed; background:transparent; }
  .mo th, .mo td { border:0; border-inline-end:1px solid var(--color-border); border-block-end:1px solid var(--color-border); vertical-align:top; padding:var(--space-4); }
  .mo tr > :last-child { border-inline-end:0; }
  .mo tbody tr:last-child td { border-block-end:0; }
  .mo thead th { font-size:var(--font-size-caption); font-weight:400; color:var(--color-ink-secondary); text-align:start; padding:var(--space-8); }
  /* Every week the same height: a crowded day says "+N more" rather than stretching its row. */
  .mo td { height:7.5em; }
  .mo td.other { background:var(--color-paper); }
  .mo-d { display:inline-flex; min-width:1.75em; min-height:1.75em; align-items:center; justify-content:center;
    font-size:var(--font-size-caption); font-variant-numeric:tabular-nums; color:var(--color-ink); }
  .mo td.today .mo-d { color:var(--color-assistant); font-weight:700; }
  .mo-e { display:flex; align-items:center; gap:var(--space-4); margin-top:var(--space-4); font-size:var(--font-size-caption); line-height:1.3; color:var(--color-ink); }
  .mo-e .face-link { align-items:center; gap:var(--space-4); }
  .mo-n { min-width:0; overflow-wrap:break-word; }
  .mo-e .kind-icon { flex:none; inline-size:24px; block-size:24px; padding:3px; border-radius:var(--radius-chip); background:var(--color-paper); color:var(--color-ink-secondary); }
  .mo-e.done { color:var(--color-ink-secondary); }
  .mo-more { display:inline-flex; align-items:center; min-height:24px; margin-top:var(--space-4); font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink); }

  /* ── inbox.ts — Buyers (one list since A) and the conversation page; moved in at the V1 close-out. */
  /* The search: the field takes the room, its button and the way back beside it. */
  .search { display:flex; align-items:center; gap:var(--space-8); margin:0 0 var(--space-16); max-width:var(--measure-prose); }
  .search input { flex:1; min-width:0; appearance:none; }
  .search .clear { display:inline-flex; align-items:center; min-height:44px; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  /* Phase 9 (V1-171) — the button stands as tall as the field it sends, so their edges meet. */
  .search .btn { align-self:stretch; }
  /* Phase 9 (V1-181, inbox-calendar-missed-06) — the way back from a search is a link in what was found, never beside the field. */
  .found .clear { display:inline-flex; align-items:center; min-height:44px; color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  /* Phase 9 (V1-182) — the searched words, marked by weight and a line: no colour of their own. */
  mark.hit { background:transparent; color:inherit; font-weight:700; text-decoration:underline; text-underline-offset:2px; }
  /* Grouped by who is speaking. Phase 1 (2026-10-02): the list takes the
     whole column, one ruled sheet of rows, so a laptop shows ten or more. */
  .lhead { display:flex; flex-direction:column; }
  .lhead .search { order:1; }
  .lhead .tabs { order:2; }
  @media (min-width: 1100px) {
    .lhead { flex-direction:row; flex-wrap:wrap; align-items:center; gap:var(--space-12) var(--space-24); margin-bottom:var(--space-16); }
    .lhead .dhead.listhead, .lhead .search, .lhead .tabs { margin:0; order:0; }
    .lhead .search { margin-inline-start:auto; flex:0 1 26rem; }
  }
  .bgroup { margin-bottom:var(--space-12); }
  .bgroup-h { font-size:var(--font-size-caption); font-weight:600; color:var(--color-ink-secondary); margin:0 0 var(--space-4); }
  .crows { list-style:none; margin:0; padding:0; background:var(--color-surface); border:1px solid var(--color-border);
    border-radius:var(--radius-card); overflow:hidden; }
  .crows > li + li { border-top:1px solid var(--color-border); }
  /* The row: two lines in every script (56 to 72 px). The grid follows the
     page's direction, so in Arabic the mark is on the right and the time on the left. */
  a.crow { display:grid; grid-template-columns:1.25em minmax(0, 1fr) fit-content(40%); column-gap:var(--space-8); row-gap:0;
    align-items:baseline; min-height:56px; padding:6px var(--space-12); color:var(--color-ink);
    border-inline-start:3px solid transparent; }
  a.crow:hover, a.crow:focus-visible { background:var(--color-paper); }
  a.crow.on { background:var(--color-paper); border-inline-start-color:var(--color-ink); }
  .cr-mark { grid-row:1; grid-column:1; justify-self:center; font-size:var(--font-size-caption); line-height:1; }
  .is-needs .cr-mark { color:var(--color-waiting); }
  .is-yours .cr-mark { color:var(--color-ink); }
  .is-hers .cr-mark { color:var(--color-assistant); }
  .cr-l1 { grid-row:1; grid-column:2; display:flex; align-items:baseline; gap:var(--space-8); min-width:0; font-size:var(--font-size-small); }
  .cr-name { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:match-parent; }
  .crow.unanswered .cr-name { font-weight:600; }
  .cr-detail { flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .cr-when { grid-row:1; grid-column:3; justify-self:end; white-space:nowrap; font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); font-variant-numeric:tabular-nums; }
  .cr-l2 { grid-row:2; grid-column:2; display:flex; align-items:baseline; gap:var(--space-4); min-width:0;
    font-size:var(--font-size-small); color:var(--color-ink-secondary); white-space:nowrap; }
  .cr-text { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:match-parent; }
  /* Phase 9 (inbox-calendar-new-04) — a Latin preview on a right-to-left page sits under the name, and is still cut at its own end. */
  [dir="rtl"] .cr-text:dir(ltr) { text-align:end; }
  /* A customer still waiting for an answer: full ink, as the transcript writes whose words lead. */
  .crow.unanswered .cr-text { color:var(--color-ink); }
  .cr-why { grid-row:2; grid-column:3; justify-self:end; min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .is-needs .cr-why { color:var(--color-waiting); font-weight:600; }
  /* Phase 9 (inbox-calendar-new-02) — on a phone the product stays on line one, cut at its end; its figures go. */
  @media (max-width: 720px) {
    .cr-fig { display:none; }
  }
  /* Phase 9 (inbox-calendar-new-03) — what the row marks mean, under the rows. */
  .cr-key { display:flex; flex-wrap:wrap; gap:var(--space-4) var(--space-16); margin:var(--space-8) 0 var(--space-12); }
  .ck-i { display:inline-flex; align-items:baseline; gap:var(--space-4); }
  /* THE WARMTH RUN, phase 4 — the Inbox. One customer, one row, 64 px: the face
     (40 px, it opens their card), the name and the mark on a regular, what they
     spent as the headline number; under them why they need you (the waiting
     signal), the last message, the last contact. The row follows the page's
     direction: in Arabic the face is on the right, the time on the left. */
  .irows { list-style:none; margin:0; padding:0; background:var(--color-surface); border:1px solid var(--color-border);
    border-radius:var(--radius-card); overflow:hidden; }
  .irows > li + li { border-top:1px solid var(--color-border); }
  .irow { display:flex; align-items:stretch; min-height:64px; color:var(--color-ink); }
  .irow:hover, .irow:focus-within, .irow.on { background:var(--color-paper); }
  @media (prefers-reduced-motion: no-preference) { .irow, .arow { transition:background-color var(--motion-fast) var(--motion-ease); } }
  .irow > .ir-face { flex:none; display:inline-flex; align-items:center; padding-inline:var(--space-12) 10px; }
  .ir-main { flex:1 1 auto; min-width:0; display:grid; grid-template-columns:minmax(0, 1fr) auto; column-gap:var(--space-8);
    align-content:center; align-items:baseline; padding-block:5px; padding-inline-end:var(--space-12); color:inherit; }
  .ir-main:focus-visible { outline:2px solid var(--color-ink); outline-offset:-2px; }
  .ir-l1 { grid-row:1; grid-column:1; display:flex; align-items:baseline; gap:var(--space-8); min-width:0; font-size:var(--font-size-small); }
  .ir-name { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:match-parent; }
  .irow.unanswered .ir-name { font-weight:600; }
  .ir-reg { flex:none; display:inline-flex; align-items:center; gap:var(--space-4); white-space:nowrap;
    font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .ir-reg .ni { inline-size:1.1em; block-size:1.1em; flex:none; }
  .ir-spent { grid-row:1; grid-column:2; justify-self:end; white-space:nowrap; font-size:var(--font-size-base); font-weight:600;
    line-height:1.35; font-variant-numeric:tabular-nums; }
  .ir-l2 { grid-row:2; grid-column:1; display:flex; align-items:baseline; gap:var(--space-8); min-width:0; overflow:hidden;
    white-space:nowrap; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  /* Why they need you comes before the message, whole where it fits: the message takes what is left. */
  .ir-wait { flex:0 0 auto; max-width:100%; overflow:hidden; text-overflow:ellipsis; color:var(--color-waiting); font-weight:600; }
  .ir-wait .dot { margin-inline-end:var(--space-4); }
  .ir-hold, .ir-by { flex:none; }
  .ir-text { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:match-parent; }
  [dir="rtl"] .ir-text:dir(ltr) { text-align:end; }
  .irow.unanswered .ir-text { color:var(--color-ink); }
  .ir-when { grid-row:2; grid-column:2; justify-self:end; white-space:nowrap; font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); font-variant-numeric:tabular-nums; }
  /* On a phone the name keeps the room: the regular's mark is its shape (its word still said, and
     explained under the list), the channel goes, the narrowings are a size smaller. */
  @media (max-width: 720px) {
    .ir-reg-w { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
    .ir-chan { display:none; }
    .tabs.filters .tab { padding:8px 12px; font-size:var(--font-size-caption); }
  }
  /* The two lenses: one segmented switch, the width of a phone, its own size on a wide screen;
     the narrowings that hold something beside it, and what the lens orders by under it. */
  .lensbar { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-16); margin:var(--space-8) 0 var(--space-4); }
  .lensbar .tabs { margin:0; }
  .tabs.lens { flex:1 1 100%; gap:var(--space-4); padding:3px; background:var(--color-paper);
    border:1px solid var(--color-border); border-radius:var(--radius-chip); }
  .tabs.lens .tab { flex:1 1 0; justify-content:center; background:transparent; border-color:transparent; }
  .tabs.lens .tab.on { background:var(--color-surface); border-color:var(--color-border); box-shadow:none; }
  @media (min-width: 721px) { .tabs.lens { flex:none; } .tabs.lens .tab { flex:none; } }
  .tabs.filters { flex-wrap:wrap; align-items:center; }
  .tabs.filters .clear { display:inline-flex; align-items:center; min-height:44px; font-size:var(--font-size-small);
    color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  .lens-says { margin:0 0 var(--space-12); }
  /* "Needs attention": relationships slipping, in a soft panel above the switch. A face, a name, one
     line that may wrap — nothing cut; five, then the rest folded. */
  .attn { margin:0 0 var(--space-16); padding:var(--space-8) var(--space-16); background:var(--color-surface);
    border:1px solid var(--color-border); border-radius:var(--radius-panel); }
  .attn-h { font-size:var(--font-size-small); font-weight:600; margin:var(--space-4) 0; }
  .arows { list-style:none; margin:0; padding:0; }
  .arow { display:flex; align-items:stretch; min-height:52px; }
  .arow > .ar-face { flex:none; display:inline-flex; align-items:center; padding-inline-end:var(--space-12); }
  .ar-main { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; justify-content:center; padding-block:4px; color:inherit; }
  /* The name sits at the line's start in the page's direction, whatever its own script: a Latin name on an Arabic page stays on the right. */
  .ar-name { align-self:flex-start; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--font-size-small); font-weight:600; }
  .ar-line { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .attn-more > summary { font-size:var(--font-size-small); color:var(--color-ink); }
  /* Phase 9 (V1-166) — a door the rail already holds on a wide screen is the phone's alone. */
  @media (min-width: 721px) { .deeper.on-phone { display:none; } }
  .dhead .who { font-size:var(--font-size-small); }
  /* CC-20 — on the conversation, the buyer's and the product's page, the name
     in the header is the page's title (an h1), drawn the size it always was. */
  .dhead h1.who { margin:0; font-weight:400; }
  /* THE WARMTH RUN, phase 5 — the catch-up strip over the messages: the customer's face (it opens
     their card) beside their name and where they write; under both, the column's width for what
     they bought and spent, and where things stand. Right to left the face sits at the start. */
  .catchup { display:grid; grid-template-columns:auto minmax(0, 1fr); align-items:center; gap:var(--space-4) var(--space-12);
    margin:var(--space-4) 0 var(--space-16); }
  .catchup.bare { display:block; }
  .catchup > .face-link { grid-row:span 2; }
  .catchup h1.who { margin:0; font-size:var(--font-size-base); font-weight:400; align-self:end; }
  .cu-where { margin:0; font-size:var(--font-size-small); color:var(--color-ink-secondary); align-self:start; }
  .cu-facts, .cu-state { grid-column:1 / -1; margin:0; font-size:var(--font-size-small); }
  .cu-facts { color:var(--color-ink-secondary); }
  .cu-facts bdi { color:var(--color-ink); }
  .cu-regular { display:inline-block; padding:0 var(--space-8); border-radius:var(--radius-chip);
    background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-ink);
    font-size:var(--font-size-caption); white-space:nowrap; }
  .cu-state .pill { margin-block-end:0; }
  .cu-story b { font-weight:600; }
  .as-hand { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8);
    margin:var(--space-8) 0 var(--space-12); font-size:var(--font-size-small); }
  /* The approval card (the design pass): who asked, what was understood, how
     it was read, the reply once in the only box drawn in graphite, and the
     acts in one row with the quiet one at the far end. On a wide screen it
     stays in view at the foot of the conversation while the messages above
     it scroll; on a narrow one it sits in the page's own order. */
  #approve { display:flex; flex-direction:column; gap:var(--space-8); }
  #approve .top { display:flex; justify-content:space-between; align-items:baseline; gap:var(--space-4) var(--space-16);
    flex-wrap:wrap; font-size:var(--font-size-small); }
  #approve .top b { font-weight:600; }
  #approve .said { font-family:var(--font-voice); margin:0; white-space:pre-wrap; word-break:break-word; }
  /* Phase 9 (V1-240) — one sentence: "Understood as: a price question · …", its values running on after the label. */
  #approve .und { margin:0; font-size:var(--font-size-small); }
  #approve .k { color:var(--color-ink-secondary); }
  #approve details { font-size:var(--font-size-small); border-top:1px solid var(--color-border); padding-top:var(--space-4); }
  #approve summary { display:flex; flex-wrap:wrap; gap:var(--space-4) var(--space-8); cursor:pointer; min-height:44px; align-items:center; }
  /* Phase 9 (conversation-new-04) — what needs the owner follows the fold's own words, and starts its own line when it wraps: right-aligned under them, it read as cut off. */
  #approve summary .c { color:var(--color-ink-secondary); }
  #approve summary .c.warn { color:var(--color-waiting); font-weight:600; }
  #approve details .und { margin:var(--space-4) 0 0; }
  .reasons { list-style:none; margin:var(--space-8) 0 0; padding:var(--space-8) var(--space-12); display:grid; gap:var(--space-4);
    background:var(--color-paper); border-radius:var(--radius-control); }
  .reasons li { display:grid; grid-template-columns:1.2em minmax(6em, max-content) 1fr; gap:var(--space-8); align-items:baseline; }
  .reasons .mk.warn { color:var(--color-waiting); }
  /* Phase 9 (V1-242) — a product's name stays whole where the line has room. */
  .reasons .pname { display:inline-block; }
  /* Phase 9 (conversation-missed-03) — on a phone the source goes under what it explains, not into a sliver of a column. */
  @media (max-width: 560px) {
    .reasons li { grid-template-columns:1.2em minmax(0, 1fr); row-gap:0; }
    .reasons li > :last-child { grid-column:2; color:var(--color-ink-secondary); }
  }
  .approve { display:flex; flex-direction:column; gap:var(--space-8); }
  .approve textarea { font-family:var(--font-voice); font-size:var(--font-size-base); color:var(--color-ink);
    background:var(--color-surface); border:1.5px solid var(--color-ink); border-radius:var(--radius-control); padding:10px 14px;
    width:100%; min-height:4.5em; max-height:50vh; resize:vertical; margin:0; field-sizing:content; }
  .approve .acts { align-items:center; margin:0; }
  /* Phase 9 (V1-237) — the quiet act on its own line under the two answers, the window at its far end. */
  .acts-more { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8) var(--space-16); }
  /* Phase 9 (V1-259, V1-260, V1-277) — a figure and its word never wrap apart: "total" stays with "$7,250.00". */
  .fig { white-space:nowrap; }
  /* The window sits at the far end of the acts row, and under them where the row runs out of room. */
  .approve .src { margin:0; margin-inline-start:auto; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .stateline { margin:0; font-size:var(--font-size-small); }
  .stateline b { font-weight:600; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  /* The panes (the design pass): the list, the conversation, the customer.
     Below 1100 px the conversation stands alone, as it always did; the list
     and the customer are drawn and left out, so nothing waits on a script. */
  .panes > .listpane, .panes > .panel, .panel-open, .panel-close { display:none; }
  .panes > .conv { min-width:0; }
  .lp-h { font-size:var(--font-size-small); font-weight:600; margin:0 var(--space-16) var(--space-8); }
  /* Phase 9 (V1-248) — the three tabs on one line in every language: "Mías", «ما يخصّني» dropped to a second row. */
  .listpane .tabs { padding:0 var(--space-16); flex-wrap:nowrap; gap:var(--space-4); overflow-x:auto; scrollbar-width:none; }
  .listpane .tab { flex:none; padding:8px 12px; }
  .tab-n { margin-inline-start:var(--space-4); font-variant-numeric:tabular-nums; color:var(--color-ink-secondary); }
  .listpane .crows { margin:var(--space-8) 0; background:none; border:0; border-radius:0; }
  .listpane a.crow { padding-inline:var(--space-12) var(--space-16); }
  .listpane a.crow:hover, .listpane a.crow:focus-visible, .listpane a.crow.on { background:var(--color-surface); }
  .listpane .crows > li.lp-group, .listpane .crows > li.lp-group + li { border-top:0; }
  /* Phase 4 — the Inbox's own row beside a conversation: the open customer marked by an ink edge. */
  .listpane .irows { margin:var(--space-8) 0; background:none; border:0; border-radius:0; }
  .listpane .irow { border-inline-start:3px solid transparent; }
  .listpane .irow:hover, .listpane .irow:focus-within, .listpane .irow.on { background:var(--color-surface); }
  .listpane .irow.on { border-inline-start-color:var(--color-ink); }
  .listpane .irows > li.lp-group, .listpane .irows > li.lp-group + li { border-top:0; }
  .listpane .tabs.lens { margin:0 var(--space-16) var(--space-8); padding:3px; }
  .listpane .tabs.filters { margin:0 0 var(--space-8); }
  /* Beside a conversation the group heading says why; the narrow column keeps the name and the message. */
  .listpane .cr-why { display:none; }
  .lp-group { padding:var(--space-12) var(--space-16) var(--space-4); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .lp-empty { padding:var(--space-8) var(--space-16); }
  .listpane .search, .listpane .deeper { margin:var(--space-16); }
  /* Phase 9 (V1-235) — the field takes the column's width, its button under it: beside it, the placeholder was cut. */
  .listpane .search { flex-wrap:wrap; }
  .listpane .search input { flex:1 1 100%; }
  .panel h2 { font-size:var(--font-size-title); margin:0; }
  .pn-head { padding-bottom:var(--space-12); margin-bottom:var(--space-16); border-bottom:1px solid var(--color-border); }
  .pn-facts { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .pn-block { margin-bottom:var(--space-16); }
  .pn-block h3 { font-size:var(--font-size-small); font-weight:600; margin:0 0 var(--space-4); }
  .pn-rows { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); }
  .pn-rows li { display:flex; justify-content:space-between; align-items:baseline; gap:var(--space-8); }
  .pn-r { flex:none; color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .pn-you { color:var(--color-ink); }
  .pn-none { color:var(--color-ink-secondary); }
  /* Phase 9 (conversation-missed-05) — a door in the panel: in ink, its chevron set off from its words. */
  .pn-door { display:inline-flex; align-items:center; gap:var(--space-4); color:var(--color-ink); font-size:var(--font-size-small); }
  /* Phase 9 (V1-257) — the open conversation, when the tab does not list it: first, under its own heading. */
  .listpane .lp-current { margin-top:0; }
  @media (min-width: 1100px) {
    main.wide { max-width:100%; padding:0; }
    .panes { display:grid; grid-template-columns:300px minmax(0, 1fr); align-items:start; min-height:100vh; }
    .panes > .listpane { display:block; position:sticky; top:0; height:100vh; overflow-y:auto; padding:var(--space-16) 0;
      background:var(--color-paper); border-inline-end:1px solid var(--color-border); }
    .panes > .conv { background:var(--color-surface); padding:var(--space-24); min-height:100vh; }
    .panel-open { display:inline-flex; align-items:center; gap:var(--space-4); margin-inline-start:auto; font-size:var(--font-size-small); }
    /* Folded away until its door is used; then over the page, with a way to close it. */
    .panes > .panel:target { display:block; position:fixed; inset-block:0; inset-inline-end:0; width:320px; z-index:5;
      overflow-y:auto; padding:var(--space-16); background:var(--color-surface); box-shadow:var(--shadow-lift2); }
    .panes > .panel:target .panel-close { display:inline-flex; margin-bottom:var(--space-12); font-size:var(--font-size-small); }
    /* Phase 9 (V1-241) — opened, the panel takes a column of its own beside the conversation rather
       than lying over the customer's words and the reply box, with Send still pressable beside it. */
    .panes:has(> .panel:target) { grid-template-columns:300px minmax(0, 1fr) 300px; }
    .panes:has(> .panel:target) > .panel { position:sticky; top:0; height:100vh; width:auto; z-index:auto; box-shadow:none;
      border-inline-start:1px solid var(--color-border); }
    .panes:has(> .panel:target) .panel-open { display:none; }
  }
  @media (min-width: 1440px) {
    .panes { grid-template-columns:300px minmax(560px, 1fr) 300px; }
    .panes > .panel, .panes > .panel:target { display:block; position:sticky; top:0; height:100vh; width:auto; overflow-y:auto; z-index:auto;
      padding:var(--space-16); background:var(--color-paper); box-shadow:none; border-inline-start:1px solid var(--color-border); }
    .panel-open, .panes > .panel:target .panel-close, .conv .file-door { display:none; }
  }
  /* The reply waiting for review. */
  .review-intro { margin:0 0 var(--space-12); }
  .draft .held-why { margin:0 0 var(--space-12); font-size:var(--font-size-small); color:var(--color-waiting); }
  .draft .held-then { display:flex; flex-direction:column; gap:var(--space-4); margin:0 0 var(--space-12); font-size:var(--font-size-small); }
  .draft .held-then b { font-weight:600; }
  .revoke-note { margin:var(--space-8) 0 0; }
  .draft .editform { margin-top:var(--space-16); }
  /* Who holds it, and handing it on. The card a person holds is a column; its pill stays a pill. */
  .takeover.owner > .pill { align-self:flex-start; }
  .why, .lastact { flex-basis:100%; font-size:var(--font-size-caption); }
  .handto { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8); align-self:stretch;
    margin:0; font-size:var(--font-size-small); }
  /* The name, the list of people and the button on one line where they fit: a select at the full width pushed its own button under it. */
  .handto select, .as-hand select { width:auto; flex:1 1 12em; min-width:0; max-width:var(--measure-form); }
  /* M22 — a refusal is information, not an alarm: amber, like a disconnected
     channel. Something needs the owner, and nothing is broken. 0052 — a send
     nobody can account for is the same amber, with the words and two answers. */
  /* The design pass — no longer a washed box: the state line says it. */
  .card.refused, .card.unsure { background:var(--color-surface); }
  .card.refused .rf-h, .card.unsure .rf-h { margin:0 0 var(--space-8); }
  .rf-h { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); margin:0 0 var(--space-12); }
  .rf { padding:var(--space-12) 0; border-top:1px solid var(--color-waiting-wash); }
  .rf:first-of-type { border-top:0; padding-top:0; }
  .rf-w { font-size:var(--font-size-small); color:var(--color-ink); font-weight:600; }
  .rf-y { font-size:var(--font-size-caption); margin-top:var(--space-4); line-height:1.55; max-width:var(--measure-prose); }
  .rf-d { font-size:var(--font-size-small); color:var(--color-ink); margin-top:var(--space-8); }
  .rf-t { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .unsure-q { margin:var(--space-8) 0 0; padding:var(--space-8) var(--space-12);
    border-inline-start:2px solid var(--color-ink-secondary); background:var(--color-surface);
    font-size:var(--font-size-small); color:var(--color-ink); max-width:var(--measure-prose); white-space:pre-wrap; }
  .unsure-a { display:flex; gap:var(--space-8); margin-top:var(--space-12); flex-wrap:wrap; }
  /* M34 — a heard message says so. The label and the superseded reading are
     the product speaking about the speech, so they stay sans; the words keep
     the voice serif of the bubble. The bubble keeps a buyer's own line breaks;
     a voiced one holds several elements, so it opts out and the words opt in. */
  .bubble.voiced { white-space:normal; }
  .bubble.voiced .said { white-space:pre-wrap; }
  .heard-label { font-family:var(--font-family); font-size:var(--font-size-caption); margin-bottom:var(--space-8); }
  .unheard-line { font-family:var(--font-family); font-size:var(--font-size-small); }
  .orig { font-size:var(--font-size-caption); margin-top:var(--space-8);
    border-inline-start:2px solid var(--color-border); padding-inline-start:10px; }
  .fixheard { margin-top:var(--space-12); font-family:var(--font-family); }
  .fixheard summary { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fixheard form { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-8); }
  .voiceplay { display:block; margin:var(--space-8) 0; }
  .answernow { margin-top:var(--space-8); }
  /* What the assistant leaned on, and the deal: a provenance list and a sunk box. */
  .knewlist { list-style:none; margin:0; padding:0; max-width:var(--measure-prose); }
  .knewlist li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .knewlist li:last-child { border-bottom:0; }
  .ctx { display:flex; flex-direction:column; gap:var(--space-4); background:var(--color-paper);
    border:1px solid var(--color-border); border-radius:var(--radius-card); padding:var(--space-12) var(--space-16);
    margin-bottom:var(--space-16); font-size:var(--font-size-small); }
  .proofrow { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8);
    margin-top:var(--space-12); font-size:var(--font-size-small); }
  .prooflink { overflow-wrap:anywhere; color:var(--color-ink-secondary); }
  /* Phase 9 (V1-247) — the sentence before the button ends on more than a lone word: "…怎么来 / 的。". */
  .proofrow > .muted { text-wrap:pretty; }
  /* A quiet button on the sunk box would be the box's own colour: it lifts to the surface. */
  .ctx .btn:not(.send):not(.danger) { background:var(--color-surface); box-shadow:var(--shadow-lift1); }
  .ctx .btn:not(.send):not(.danger):hover { background:var(--color-border); }
  /* Three actions stay on one row: the destructive one belongs beside its alternatives. */
  @media (max-width:560px) { .acts .btn { padding-inline:12px; } }

  /* ── conversations.ts — the buyer's own page; moved in at the V1 close-out. */
  .pill.muted { background:var(--color-paper); color:var(--color-ink-secondary); }
  .need-card { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-12); font-size:var(--font-size-small); }
  .name-form { max-width:var(--measure-form); margin-bottom:var(--space-12); padding-bottom:var(--space-12); border-bottom:1px solid var(--color-border); }
  .name-form label { display:block; font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin-bottom:var(--space-4); }
  .name-row { display:flex; gap:var(--space-8); align-items:center; }
  .name-row input { flex:1; min-width:0; }
  .name-form .hint { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  /* A label and its value stay together at desktop: the prose measure, like every row. */
  /* Phase 9 (V1-280) — one layout for every label and its value on this page: the value beside its
     label in a column of its own. The first block pushed its values to the far edge, the second did not. */
  .prow, .cx { max-width:var(--measure-prose); border-bottom:1px solid var(--color-border); font-size:var(--font-size-small);
    display:grid; grid-template-columns:minmax(0, 11em) minmax(0, 1fr); gap:var(--space-4) var(--space-12);
    align-items:baseline; padding:var(--space-8) 0; }
  @media (max-width: 560px) { .prow, .cx { grid-template-columns:minmax(0, 8em) minmax(0, 1fr); } }
  .prow:last-child, .cx:last-child { border-bottom:0; }
  .cx-l { color:var(--color-ink-secondary); }
  /* The history: a line down the reading edge, each kind told by its mark, not by a colour. */
  .tl { list-style:none; padding:0; margin:0; max-width:var(--measure-prose); }
  .tl li { display:flex; gap:var(--space-12); position:relative; padding:10px 0; padding-inline-start:16px;
    margin-inline-start:var(--space-8); border-inline-start:2px solid var(--color-border); }
  .tl li .ic { position:absolute; inset-inline-start:-11px; top:9px; background:var(--color-paper);
    display:inline-flex; justify-content:center; width:20px; font-size:var(--font-size-small); line-height:1; }
  .tl .tx { font-size:var(--font-size-small); }
  /* Phase 9 (V1-276) — what someone said, on its own line in its own direction. */
  .tl .said { display:block; }
  /* Phase 9 (conversation-new-08) — the customer's mark is a dot you can see; each line names its speaker in words. */
  .tl li.tl-buyer .ic, .tl li.tl-event .ic { font-size:var(--font-size-title); }

  /* ── sequences.ts — moved here whole in step four: page-specific names, defined once. */
  .sqs { list-style:none; margin:var(--space-12) 0; padding:0; }
  .sq { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
  .sq:last-child { border-bottom:0; }
  .sq.gone { opacity:.55; }
  .sq-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
  .sq-name { font-weight:600; }
  .sq-b { font-size:var(--font-size-small); margin-top:var(--space-4); }
  .sqform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
  .sts, .ens { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  .st, .en { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); }
  .st:last-child, .en:last-child { border-bottom:0; }
  .st-h, .en-h { display:flex; align-items:baseline; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
  .st-n { font-weight:600; }
  .st-w { font-size:var(--font-size-small); }
  .st-s { font-weight:600; margin-top:var(--space-8); }
  .st-b { white-space:pre-wrap; margin-top:var(--space-4); }
  .en.gone { opacity:.7; }
  .en .id { color:var(--color-ink-secondary); margin-inline-start:var(--space-8); }
  .en-a { display:flex; gap:var(--space-12); align-items:center; flex-wrap:wrap; margin-top:var(--space-8); }
  .sqform { display:grid; gap:var(--space-12); margin-top:var(--space-12); }
  .sqform textarea { width:100%; font:inherit; }
  .pill.wait { background:var(--color-paper); color:var(--color-ink-secondary); }

  /* ── sandbox.ts — moved here whole in step four: page-specific names, defined once. */
  .pcount { font-size:var(--font-size-display); font-weight:600; color:var(--color-ink); font-variant-numeric:tabular-nums; margin:var(--space-4) 0 var(--space-12); }
  .pchecks > summary { cursor:pointer; }
  .pchecks > summary h2 { display:inline; }
  .pchecks > summary .pcount { font-size:inherit; margin:0; }
  .pcases { list-style:none; margin:0; padding:0; }
  .pcase { display:flex; gap:var(--space-8); padding:7px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .pcase:last-child { border-bottom:0; }
  .pcase.ok .pmark { color:var(--color-ok); }
  .pcase.bad .pmark { color:var(--color-warn); }
  .ptitle { color:var(--color-ink-secondary); }
  .pproves { margin:var(--space-12) 0 0; max-width:var(--measure-prose); line-height:1.6; }
  .sbx-banner { background:var(--color-paper); color:var(--color-ink); border:1px solid var(--color-border); border-radius:var(--radius-card); padding:12px 16px; font-weight:600; font-size:var(--font-size-small); margin:var(--space-8) 0 var(--space-12); }
  .sbx-intro { margin:0 0 var(--space-16); }
  .sbx-compose { display:flex; flex-direction:column; gap:var(--space-12); }
  .sbx-mode { display:flex; flex-direction:column; align-items:flex-start; gap:var(--space-8); }
  /* Phase 9 (conversation-missed-15) — the card's gap is its only space: a heading's and a paragraph's own margins left a 35 px band. */
  .sbx-mode > h2, .sbx-mode > p { margin:0; }
  /* Phase 9 (V1-291) — Start over sits with the conversation it erases, a button among buttons. */
  .sbx-log-h h2 { margin:0; }
  .sbx-checklist .chk.gap .mk { color:var(--color-ink-secondary); }
  .modebar { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; font-size:var(--font-size-small); }
  .radio { display:inline-flex; align-items:center; gap:var(--space-4); cursor:pointer; }
  .radio.off { opacity:.5; cursor:not-allowed; }
  .scenariobar { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:9px 12px; font:inherit; max-width:100%; }
  .msgbar { display:flex; flex-direction:column; gap:var(--space-8); }
  .msgacts { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); flex-wrap:wrap; }
  textarea { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  .sbx-trust { border-color:var(--color-waiting-line); }
  .sbx-trust.pass { border-color:var(--color-ok-line); }
  .sbx-trust.fail { border-color:var(--color-warn-line); }
  /* Phase 9 (V1-294) — the verdict in the heading is a word, not the general verdict box (padding, border, radius, centred). */
  .sbx-trust .verdict { font-weight:700; text-transform:none; letter-spacing:0; margin:0; padding:0; border:0; border-radius:0;
    background:none; text-align:start; }
  .sbx-trust.pass .verdict { color:var(--color-ok); }
  .sbx-trust.fail .verdict { color:var(--color-warn); }
  .chip.auto { background:var(--color-ok-wash); color:var(--color-ok); border-color:var(--color-ok-line); }
  .chip.draft { background:var(--color-waiting-wash); color:var(--color-waiting); border-color:var(--color-waiting-line); }
  .chip.warn { background:var(--color-warn-wash); color:var(--color-warn); }
  .chip.badge { background:var(--color-paper); color:var(--color-ink); font-weight:600; }
  .checks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .chk { display:grid; grid-template-columns:auto 1fr; gap:var(--space-4) var(--space-8); align-items:start; }
  .chk .mk { font-weight:700; }
  .chk.ok .mk { color:var(--color-ok); }
  .chk.bad .mk { color:var(--color-warn); }
  .chk .lbl { font-size:var(--font-size-small); }
  .chk .dt { grid-column:2; font-size:var(--font-size-caption); word-break:break-word; }
  .card.draft { border-color:var(--color-waiting-line); }
  /* .timeline/.msg/.bubble/.ts/.proposed are the shell's — the speech components live in one place so the two voices cannot fork per page. */
  .takeover.owner { flex-direction:column; align-items:stretch; }

`;

/**
 * V1 close-out (2026-09-28) — THE STYLESHEETS ARE FILES.
 *
 * Every page used to carry the whole stylesheet inside itself: an owner page
 * was about sixty kilobytes of markup of which half was the same rules, sent
 * again on every tap, on a phone. Each stylesheet is now served once, at an
 * address named by its content (`/assets/app.<hash>.css`), and kept by the
 * browser for good: a change to a rule is a new hash, so a new address, so
 * nobody is ever served yesterday's rules under today's page. No page carries
 * a stylesheet of its own; the count the one-stylesheet test keeps is zero.
 *
 * TWO SHEETS, the same split as before: the shell's (the base rules and
 * every page's section) and the door's (the base rules and the door's own —
 * the login, sign-up, code and error pages). The public document below keeps
 * its rules inside itself, on purpose; it says why.
 *
 * An address from an EARLIER build (a page drawn before a deploy, its sheet
 * not yet fetched) is answered with this build's rules, but not kept: only
 * the exact address is kept for good.
 */
export type Stylesheet = { readonly name: string; readonly href: string };

/**
 * CC-26 — and ONE SCRIPT, by the same mechanism: `/assets/live.<hash>.js`,
 * named by its content, kept for good at its exact address, never inline and
 * never per page (`liveScript.ts` says what it does). An asset is its name and
 * its kind; the kinds are the two a browser is sent.
 */
const ASSET_TYPES = { css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' } as const;
const FONT_TYPE = 'font/woff2';
type AssetKind = keyof typeof ASSET_TYPES;

const ASSETS = new Map<string, { readonly body: string; readonly hash: string }>();

/** Register an asset under its name and kind; its address carries the hash of its text. */
function asset(name: string, kind: AssetKind, body: string): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  ASSETS.set(`${name}.${kind}`, { body, hash });
  return `/assets/${name}.${hash}.${kind}`;
}

/** Register a stylesheet under its name; its address carries the hash of its rules. */
function sheet(name: string, css: string): Stylesheet {
  return { name, href: asset(name, 'css', css) };
}

/** The asset of this kind an address names, and whether it is this build's own address. */
function lookup(file: string, kind: AssetKind): { readonly body: string; readonly current: boolean } | null {
  const m = /^([a-z]+)\.([0-9a-f]{16})\.([a-z]+)$/.exec(file);
  const a = m && m[3] === kind ? ASSETS.get(`${m[1]!}.${kind}`) : undefined;
  return m && a ? { body: a.body, current: a.hash === m[2] } : null;
}

/**
 * The rules a stylesheet address names: `current` when it is this build's own
 * address, which may then be kept for good. The tests read the sheets through
 * this, the way the browser does (`tests/parity/linked-css.ts`).
 */
export function stylesheetAt(file: string): { readonly css: string; readonly current: boolean } | null {
  const a = lookup(file, 'css');
  return a ? { css: a.body, current: a.current } : null;
}

/**
 * What an address under `/assets/` names, for the route that serves it: a
 * stylesheet or the script, with its type. An address from an earlier build
 * gets this build's text, not kept; anything else is nothing.
 */
export function assetAt(file: string): { readonly body: string | Buffer; readonly type: string; readonly current: boolean } | null {
  const css = stylesheetAt(file);
  if (css) return { body: css.css, type: ASSET_TYPES.css, current: css.current };
  const js = lookup(file, 'js');
  if (js) return { body: js.body, type: ASSET_TYPES.js, current: js.current };
  // A font: named by its content when it was vendored, so its address is
  // always its own and it may always be kept (`type.ts`).
  const font = fontAt(file);
  return font ? { body: font, type: FONT_TYPE, current: true } : null;
}

const linkTo = (s: Stylesheet): string => `<link rel="stylesheet" href="${s.href}">`;

/** The public document's base rules: the same tokens, a reading page on paper. */
const PUBLIC_STYLE = `
${cssVariables()}
  * { box-sizing:border-box; }
  body { margin:0; background:var(--color-paper); color:var(--color-ink);
         font: var(--font-size-base)/var(--line-height) var(--font-family);
         -webkit-text-size-adjust:100%; }
  main { max-width:var(--measure-prose); margin:0 auto; padding:var(--space-48) var(--space-16); }
  h1 { font-size:var(--font-size-display); line-height:1.25; margin:0 0 var(--space-16); font-weight:600; }
  h2 { font-size:inherit; font-weight:600; margin:var(--space-32) 0 var(--space-8); }
  p, li { margin:0 0 var(--space-12); color:var(--color-ink-secondary); }
  p, li { text-wrap:pretty; }
  h1, h2 { text-wrap:balance; }
  ul, ol { margin:0 0 var(--space-12); padding-inline-start:var(--space-24); }
  a { color:var(--color-ink); }
  .updated { margin-top:var(--space-48); }
  button { font:inherit; padding:var(--space-12) var(--space-24); border:0;
           border-radius:var(--radius-card); background:var(--color-ink);
           color:var(--color-surface); cursor:pointer; }
`;

/**
 * V1 step four — the ONE public document: the legal pages, the unsubscribe
 * page, the proof page and the site stand outside the owner's shell (no nav,
 * no session). Same tokens, one stylesheet, a page's own rules passed in — so
 * a second hand-rolled palette cannot drift.
 *
 * V1 close-out — THE ONE PAGE FAMILY THAT KEEPS ITS RULES INSIDE ITSELF, on
 * purpose. A stranger opens these from an e-mail, a Page or a forwarded link,
 * often after a mail scanner or a platform's crawler has fetched the address
 * and nothing else; each must arrive complete, with nothing more to fetch —
 * no script, no stylesheet, no font (legal-pages.test.ts and
 * m40-unsubscribe.test.ts hold it). A cached file saves an owner who opens
 * sixty pages a day; it saves nothing for someone who opens one page once.
 */
export function publicDocument(input: {
  readonly locale: Locale; readonly title: string; readonly body: string;
  readonly noindex?: boolean; readonly extraCss?: string; readonly mainClass?: string;
  /** Phase 5 — the site: a search-result line, and the mark in the tab. */
  readonly description?: string; readonly icon?: boolean;
}): string {
  return `<!doctype html>
<html lang="${esc(input.locale)}" dir="${esc(dirOf(input.locale))}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${input.noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<title>${esc(input.title)}</title>
${input.description ? `<meta name="description" content="${esc(input.description)}">\n` : ''}${input.icon ? `<link rel="icon" href="${faviconDataUri()}">\n` : ''}<style>${PUBLIC_STYLE}${input.extraCss ?? ''}
</style>
</head><body><main${input.mainClass ? ` class="${esc(input.mainClass)}"` : ''}>${input.body}</main></body></html>`;
}

/**
 * Phase 9 (V1-058, V1-066, V1-073, V1-086) — a public page opens the way the site
 * does: the mark and the name, which lead to the site, and the language switch
 * (`path`, where it returns; none on a page whose address is a one-time link).
 * All of it arrives in the page — the mark is drawn inline, nothing is fetched.
 */
export const publicTop = (locale: Locale, home: string, path: string | null): string =>
  `<header class="pub-top"><a class="pub-brand" href="${esc(home)}">${markSmall(28, null)}<span>Nomi</span></a>`
  + `${path ? switcher(locale, path) : ''}</header>`;
export const PUBLIC_TOP_CSS = `${LANGSW_CSS}
  .pub-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8) var(--space-16);
    flex-wrap:wrap; margin:calc(-1 * var(--space-24)) 0 var(--space-32); }
  .pub-brand { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px; font-weight:700;
    font-size:var(--font-size-title); color:var(--color-ink); text-decoration:none; }
  .pub-brand .mark { flex:none; }
`;

/** The shell's sheet: the base rules and every page's section. */
const APP_SHEET = sheet('app', STYLE + STYLE_PAGES);

/**
 * The type (the design pass, 2026-09-29): the faces a page's language needs,
 * linked by the shell and the door after their own sheet. The public
 * documents do not link it — they arrive complete — and their stacks name the
 * device's own fonts after Noto.
 */
const TYPE_SHEETS = { base: sheet('type', TYPE_CSS), zh: sheet('typezh', TYPE_ZH_CSS) } as const;
const typeLink = (locale: Locale): string => linkTo(TYPE_SHEETS[typeSetFor(locale)]);

/**
 * CC-26 — the one script, linked by the shell on every owner page and by
 * nothing else: not the door, not a public document (those arrive complete,
 * with nothing to run). Deferred, so it runs once the page is read, and a page
 * that declares no watch gives it nothing to do but keep a half-typed reply.
 */
const LIVE_JS = asset('live', 'js', LIVE_SCRIPT);
const scriptTo = (href: string): string => `<script src="${href}" defer></script>`;

/**
 * A7 — WHICH of the four is lit, for a page that is not one of the four.
 *
 * THE MAP WAS ALREADY WRITTEN DOWN. `CONTEXTUAL_ROUTES_BY_HUB` above says which
 * hub every contextual route is reached from, two tests read it, and the
 * integration walk asserts the link is really there. `shell()` never looked at
 * it: it compared `active` against the four nav ids, and pages pass eleven
 * different values — `products`, `settings`, `knowledge`, `channels`,
 * `sandbox`, `onboarding`, `conversations`, `contacts` among them. Seven of
 * the eleven matched nothing, so on roughly twenty pages the sidebar showed no
 * "you are here" at all.
 *
 * The PATH decides, because the path is the thing the map is keyed on and the
 * thing a page cannot get wrong. `active` stays as the fallback for the four
 * hubs themselves, and for anything the map has not been told about yet —
 * which is better than lighting nothing.
 *
 * Longest match wins: `/app` is a prefix of every route, so a plain
 * `startsWith` would light Today on all of them.
 *
 * AND THE MAP CHAINS. `/app/sequences` is reached from `/app/contacts`, which
 * is reached from `/app/inbox` — only that last one is in the nav. So the
 * lookup FOLLOWS the chain rather than stopping at the first hop, which would
 * light nothing twice over.
 */
export function hubFor(path: string, active: string): string {
  const url = (path.split('?')[0] ?? path).replace(/\/+$/, '') || '/app';

  /**
   * Where a url belongs: the nav entry it IS or sits under, else the hub the
   * map says it is reached from. One pass over both, longest match wins —
   * `/app/inbox/<id>` must find Buyers and not Today, and `/app` is a prefix of
   * every address in the product.
   */
  const under = (u: string): { nav?: string; hub?: string } => {
    let best: { len: number; nav?: string; hub?: string } | null = null;
    const consider = (route: string, found: { nav?: string; hub?: string }, exactOnly = false) => {
      const hit = exactOnly ? u === route : (u === route || u.startsWith(`${route}/`));
      if (hit && (best === null || route.length > best.len)) best = { len: route.length, ...found };
    };
    // `/app` is Today AND the prefix of every address in the product, so it
    // matches only itself. Prefix-matching it would light Today on every page
    // the map has not been told about — which is louder than lighting nothing
    // and wrong in a way nobody would question. The other three own what sits
    // beneath them: `/app/inbox/<id>` really is Buyers.
    for (const n of NAV) consider(n.href, { nav: n.id }, n.href === '/app');
    for (const g of CONTEXTUAL_ROUTES_BY_HUB) for (const r of g.routes) consider(r, { hub: g.hub });
    // A — the buyer's pages sit under the address Customers had; they are Buyers'.
    consider(MERGED_INTO_BUYERS, { hub: '/app/inbox' });
    // Phase 9 (V1-191) — an order is one customer's, opened from their conversation: Customers' too.
    consider('/app/orders', { hub: '/app/inbox' });
    // THE WARMTH RUN — a customer's profile card is one of the customers'.
    consider('/app/customers', { hub: '/app/inbox' });
    return best ?? {};
  };

  let at: string | null = url;
  // The map is small and hand-written; the bound guards against somebody one
  // day writing a cycle into it, not an expected depth.
  for (let hop = 0; at !== null && hop < 8; hop++) {
    const found = under(at);
    if (found.nav !== undefined) return found.nav;
    at = found.hub ?? null;
  }
  return active;
}

/**
 * Phase 9 (V1-012, V1-110, V1-151) — the way back to the page a page is
 * reached from, for the pages that drew none: the settings pages reached from
 * My business, the assistant's or Setup, and setting up's own pages. Every
 * other page reached from a hub already starts with its "‹". The shell adds
 * it only where the page has none, so a page that draws its own keeps it.
 */
export const BACK_TO: Readonly<Record<string, { readonly href: string; readonly label: MessageKey }>> = {
  '/app/settings/closures': { href: '/app/business/how-you-sell', label: 'factory.sellhow.title' },
  '/app/settings/rate': { href: '/app/business/how-you-sell', label: 'factory.sellhow.title' },
  '/app/settings/samples': { href: '/app/business/how-you-sell', label: 'factory.sellhow.title' },
  '/app/settings/terms': { href: '/app/business/how-you-sell', label: 'factory.sellhow.title' },
  // Phase 7 — the products and the channels are rows of My business now.
  '/app/products': { href: '/app/business', label: 'nav.factory' },
  '/app/channels': { href: '/app/business/channels', label: 'factory.reach.title' },
  '/app/settings/forbidden': { href: '/app/employee', label: 'nav.employee' },
  // THE WARMTH RUN, phase 7 — a row of the assistant's menu.
  '/app/knowledge': { href: '/app/employee', label: 'nav.employee' },
  '/app/settings/people': { href: '/app/settings/setup', label: 'nav.setup' },
  '/app/guide': { href: '/app/settings/setup', label: 'nav.setup' },
  '/app/onboarding': { href: '/app/settings/setup', label: 'nav.setup' },
  // THE WARMTH RUN — Settings' two rows lead back to it.
  '/app/settings/setup': { href: '/app/settings', label: 'nav.settings' },
  '/app/business': { href: '/app/settings', label: 'nav.settings' },
  '/app/ready': { href: '/app/onboarding', label: 'nav.onboarding' },
};
const wayBack = (locale: Locale, path: string, body: string): string => {
  const to = BACK_TO[(path.split(/[?#]/)[0] ?? path).replace(/\/+$/, '')];
  return to && !body.includes('class="back"') ? back(to.href, t(locale, to.label)) : '';
};

/**
 * Phase 9 (V1-158–V1-162) — a mistyped /app address for an owner who is
 * signed in: the page inside the workspace (its rail, its name, its tab), what
 * is missing, and the door to Today. The door page (`errorPage`) is for
 * whoever is not signed in.
 */
export const notFoundInside = (locale: Locale): string =>
  `<h1 class="page">${esc(t(locale, 'error.notfound.title'))}</h1><div class="empty">${esc(t(locale, 'error.notfound.body'))}<div>${deeper('/app', t(locale, 'error.home'))}</div></div>`;

export function shell(input: {
  readonly title: string;
  readonly active: string;
  readonly locale: Locale;
  readonly path: string;
  /** Ignored since V1 step three: the assistant is named, never drawn. Kept so callers need not change. */
  readonly avatar?: string;
  readonly bodyHtml: string;
  /**
   * CC-26 — the page's live region (`liveRegion` in flash.ts): what it watches
   * and the line it shows when that changes. Placed at the foot of the column,
   * after everything the page draws. Absent, the page watches nothing.
   */
  readonly live?: string;
  /** The design pass — a page drawn as panes (a conversation) takes the whole width, not the reading column. */
  readonly wide?: boolean;
}): string {
  const { locale } = input;
  const name = assistantName(locale);
  const here = hubFor(input.path, input.active);
  /**
   * THE WARMTH RUN (2026-10-03), phase 1 — the rail: Today; Customers, with
   * Inbox and Calendar under it; the assistant; Settings at the foot. Daily
   * work at the top, management at the bottom. Each entry is its icon and its
   * word; the one you are on is a raised white tile with its word in weight
   * and its icon drawn heavier — unmistakable without a colour.
   *
   * ONE number in the rail: on Inbox, how many customers wait for the owner
   * now, in the waiting signal's magenta. Nothing else counts anything here —
   * not setting up, not the calendar: a number that is not a customer waiting
   * is the kind of badge the owner ruled out.
   */
  const entry = (n: typeof NAV[number], sub = false) => {
    const on = n.id === here;
    // A5 — the entry for the assistants is the assistant's NAME while there is
    // one, and "Team" once there are several.
    const label = n.id === 'employee' && assistantsAreSeveral()
      ? t(locale, 'nav.team')
      : t(locale, `nav.${n.id}` as MessageKey);
    const waiting = n.id === 'inbox' ? needsYouCount() : null;
    // Phase 9 (V1-172) — the number says what it counts ("3 waiting") where
    // there is room; on a phone's tile it is the figure alone, on the icon's corner.
    const badge = waiting ? `<span class="navcount" aria-hidden="true"><span class="nl-long">${esc(isolate(locale, t(locale, 'nav.waiting', { n: waiting })))}</span>`
      + `<span class="nl-short">${esc(isolate(locale, String(waiting)))}</span></span>` : '';
    const aria = waiting ? ` aria-label="${esc(label)}, ${esc(tn(locale, 'nav.needsYou', waiting))}"` : '';
    // On a phone the five entries share one line, icon over word: the longer
    // words have a phone form. The stylesheet shows one; a screen reader hears
    // the one shown.
    const short = n.id === 'inbox' ? t(locale, 'nav.short.inbox')
      : n.id === 'employee' && !assistantsAreSeveral() && label.toLocaleLowerCase() === ASSISTANT_FALLBACK[locale].toLocaleLowerCase()
        ? t(locale, 'nav.short.employee') : null;
    const text = short && short !== label
      ? `<span class="nl-text"><span class="nl-long">${esc(label)}</span><span class="nl-short">${esc(short)}</span></span>`
      : `<span class="nl-text">${esc(label)}</span>`;
    // A11y — `aria-current="page"` tells a screen reader which entry is this page.
    return `<a href="${n.href}" class="navlink${sub ? ' sub' : ''}${on ? ' active' : ''}" data-nav="${n.id}"${on ? ' aria-current="page"' : ''}${aria}
       >${icon(NAV_ICON[n.id] ?? 'today')}${text}${badge}</a>`;
  };
  const byId = (id: string) => NAV.find((n) => n.id === id)!;
  const nav = `<div class="navgroup">${entry(byId('home'))}</div>
    <div class="navgroup navhub" role="group" aria-labelledby="nav-customers">
      <span class="navhead" id="nav-customers">${icon('customers')}<span>${esc(t(locale, 'nav.customers'))}</span></span>
      ${entry(byId('inbox'), true)}${entry(byId('calendar'), true)}
    </div>
    <div class="navgroup">${entry(byId('employee'))}</div>
    <div class="navfoot">${entry(byId('settings'))}</div>`;
  /**
   * CC-14 — whose workspace this is, in the owner's own words. It read
   * "Nomi · Lily's workspace" to everyone, and a new owner never saw the name
   * they had typed two minutes earlier. The business leads; the product is the
   * line under it. Outside a workspace (a fragment in a test, a failed
   * look-up) the block says what it always said.
   *
   * On a phone the brand is the small mark alone (option A: the nav row is the
   * whole chrome, 80–87 px at rest), so the name is not squeezed into that row:
   * it heads Today instead — the page every visit starts on — as one line that
   * scrolls away with the page and is not drawn where the sidebar shows it.
   */
  const business = businessName();
  const brandname = business
    ? `<span class="brandname"><bdi>${esc(business)}</bdi><small>Nomi</small></span>`
    : `<span class="brandname">Nomi<small>${esc(t(locale, 'app.tagline', { name }))}</small></span>`;
  // Phase 9 (V1-105) — on a phone every page says whose workspace it is, not Today alone.
  const heading = business ? `<p class="business-name"><bdi>${esc(business)}</bdi></p>` : '';
  // Phase 9 (V1-003) — the tab names the PAGE: its own heading when it has one
  // (an account page, a closure list, an order, a product), the area's name
  // only where the page has none. Every Setup page was "Setup · …".
  const ownHeading = /<h1 class="page"[^>]*>([\s\S]*?)<\/h1>/.exec(input.bodyHtml)?.[1];
  /**
   * THE WARMTH RUN (2026-10-03), phase 8 — every page in a workspace asks the
   * rail's question (`railAnswer`, live.ts) from the number it was drawn with,
   * and this is where the answer surfaces: the one small card, in a polite
   * live region present and empty from the start. Outside a workspace (a
   * fragment, a page whose count could not be read) nothing asks.
   */
  const waiting = needsYouCount();
  const toasts = waiting === null ? ''
    : `<div class="toasts" role="status" aria-live="polite" data-rail="/app/live/rail?since=${waiting}"></div>`;
  const tabTitle = (ownHeading ? unescapeHtml(ownHeading.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : '') || input.title;
  // CC-20 — the first stop for a keyboard or a screen reader: past the five
  // nav entries, straight to the page. Out of sight until it has focus.
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tabTitle)} · ${esc(business ?? 'Nomi')}</title>
<link rel="icon" href="${faviconDataUri()}">
${INSTALL_LINKS}
${linkTo(APP_SHEET)}
${typeLink(locale)}
${scriptTo(LIVE_JS)}</head>
<body><a class="skip" href="#main">${esc(t(locale, 'shell.skip'))}</a><div class="layout">
  <nav class="side">
    <div class="brand"><span class="mark-detail">${markDetail(40, null)}</span><span class="mark-small">${markSmall(28, null)}</span>${brandname}</div>
    ${nav}
  </nav>
  <div class="content">
    <main id="main"${input.wide ? ' class="wide"' : ''}>${heading}${wayBack(locale, input.path, input.bodyHtml)}${placeLive(input.bodyHtml, input.live ?? '')}</main>
  </div>
</div>${toasts}${askDialog(locale)}${cardSheet(locale)}</body></html>`;
}

/**
 * PHASE 5 OF THE UI REBUILD (2026-10-02) — the product's own way of asking
 * first, in place of the browser's grey box. Every button that asks (CC-29's
 * idiom: its question in `data-confirm`) opens this, with the button's own
 * word on the button that goes ahead and Cancel focused. The page's script
 * fills it and opens it (liveScript.ts); with no script, or a browser without
 * dialogs, the button still asks the old way. Closed, it is not there.
 */
const askDialog = (locale: Locale): string =>
  `<dialog class="ask" aria-labelledby="ask-q" data-ask><p class="ask-q" id="ask-q" data-ask-q></p><div class="ask-acts">`
  // Its fill (or its red) is set when it opens, from the button that asked: closed, it is no page's primary act.
  + `<button type="button" class="btn" data-ask-yes>${esc(t(locale, 'common.goAhead'))}</button>`
  + `<button type="button" class="btn" data-ask-no autofocus>${esc(t(locale, 'common.cancel'))}</button></div></dialog>`;

/**
 * THE WARMTH RUN (2026-10-03), phase 3 — the sheet the profile card springs up
 * in. Empty and closed until a face is pressed; the page's script fetches the
 * card's own page and puts its card here (liveScript.ts). Closing is the
 * dialog's own: its button, Escape, or a press outside the card.
 */
const cardSheet = (locale: Locale): string =>
  `<dialog class="sheet" aria-labelledby="pc-name" data-sheet><form method="dialog" class="sheet-bar">`
  + `<button type="submit" class="sheet-x" aria-label="${esc(t(locale, 'pcard.close'))}">×</button></form><div data-sheet-body></div></dialog>`;

/**
 * A1 — the two pages a stranger may see: the door, and how to get a key.
 *
 * They share one frame because they are one decision ("do I have a workspace
 * yet?") and each links to the other. Neither names a tenant, and neither says
 * whether an e-mail address has an account.
 */
const DOOR_STYLE = `
  .login { max-width: var(--measure-form); margin: 10vh auto; padding: 0 var(--space-16); }
  .login .top-sw { display:flex; justify-content:center; margin-bottom:var(--space-16); }
  .login .card { padding: var(--space-24); }
  .login .brand { flex-direction:column; justify-content:center; gap:var(--space-4); text-align:center;
    font-weight:700; font-size:var(--font-size-title); margin-bottom:var(--space-8); padding:0; }
  /* Phase 9 (V1-040 and public-missed-10) — above: the site's mark and name, centred like
     the pill above them and the links below. */
  .login .brand small { margin-top:0; }
  .login h1 { font-size:var(--font-size-title); margin:0 0 var(--space-8); }
  .login .lead { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:0 0 var(--space-16); }
  /* No word or character left alone on a line (V1-056): a short lead in even lines, the rest pretty. */
  .login .lead { text-wrap:balance; }
  .login .hint, .login .err, .login .fld-err { text-wrap:pretty; }
  /* V1-031, V1-045, V1-049 — a field, a list and a button are drawn in the page's face,
     not the browser's own. */
  input, select, button, textarea { font-family:inherit; }
  /* V1-034, V1-050 — a link on the door looks like one. */
  .login .card a, .login .other a, .login .foot a { color:var(--color-ink); text-decoration:underline;
    text-underline-offset:0.2em; }
  input { width:100%; padding:12px 14px; border-radius:var(--radius-card);
    border:1px solid var(--color-ink-secondary); background:var(--color-surface);
    color:var(--color-ink); font-size:var(--font-size-base); margin:var(--space-8) 0 var(--space-16); }
  /* M49 — as wide as its word, like every other button in the product. */
  button { min-height:44px; padding:12px var(--space-24); border:0; border-radius:var(--radius-card);
    background:var(--color-ink); color:var(--color-surface); font-weight:600;
    font-size:var(--font-size-small); cursor:pointer; }
  button:hover { box-shadow:var(--shadow-lift2); }
  select { width:100%; min-height:44px; padding:10px 14px; border-radius:var(--radius-card);
    border:1px solid var(--color-ink-secondary); background:var(--color-surface);
    color:var(--color-ink); font-size:var(--font-size-base); margin:var(--space-8) 0 var(--space-16); }
  .login h2 { font-size:var(--font-size-small); color:var(--color-ink-secondary); margin:var(--space-24) 0 var(--space-8); font-weight:600; }
  .login form > h2:first-child { margin-top:0; }
  fieldset.checks { border:0; padding:0; margin:0 0 var(--space-16); }
  fieldset.checks legend { color:var(--color-ink-secondary); font-size:var(--font-size-caption); padding:0; margin-bottom:var(--space-8); }
  label.check { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px; margin-inline-end:var(--space-16); color:var(--color-ink); }
  label.check input { width:auto; margin:0; }
  /* V1-053 — the terms box keeps the form's own gap above the button. */
  label.check.terms { display:flex; margin-bottom:var(--space-16); }
  .err { color:var(--color-warn); font-size:var(--font-size-caption); margin-bottom:var(--space-8); }
  .err ul { margin:var(--space-4) 0 0; padding-inline-start:var(--space-24); }
  .err li { margin:0; }
  .fld-err { color:var(--color-warn); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
  /* public-missed-13 — the field refused is marked at its own edge (the terms box's
     refusal keeps the gap its margin leaves). */
  .err-field { border-color:var(--color-warn); }
  label.check .err-field { outline:2px solid var(--color-warn); outline-offset:2px; }
${markBefore('failed', ['.err', '.fld-err'])}
  .hint { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
  label { color:var(--color-ink-secondary); font-size:var(--font-size-caption); display:block; }
  details { margin-top:var(--space-24); border-top:1px solid var(--color-border); padding-top:var(--space-16); }
  summary { cursor:pointer; color:var(--color-ink-secondary); font-size:var(--font-size-caption); min-height:44px; display:flex; align-items:center; }
  details form { margin-top:var(--space-8); }
  .login .other { text-align:center; margin:var(--space-16) 0 0; font-size:var(--font-size-caption); }
  .login .other.small { margin-top:var(--space-8); }
  /* V1-038, V1-039 — the door's foot is where to read more, not a slogan. */
  .login .foot { display:flex; justify-content:center; flex-wrap:wrap; gap:0 var(--space-16);
    margin-top:var(--space-24); font-size:var(--font-size-caption); }
  .login .foot a { display:inline-flex; align-items:center; min-height:44px; color:var(--color-ink-secondary); }
  .forgot { margin:var(--space-8) 0 0; font-size:var(--font-size-caption); }
`;

/** The door's sheet: the base rules and the door's own — never the pages' sections. */
const DOOR_SHEET = sheet('door', STYLE + DOOR_STYLE);

/**
 * CC-20 — every door page has one heading, in its card: the task it asks
 * (Phase 9, V1-032 — the sign-in page's was the brand line).
 *
 * Phase 9 — the brand is the site's: its mark beside the name (public-missed-10).
 * The foot is three doors a stranger may want — the site, the privacy page and
 * the terms (V1-038, V1-039, V1-051). `site` is where the site is read: `/site`
 * on the app's own host, the default.
 *
 * The door runs no script (CC-26): it holds the password and the code fields,
 * and nothing on it needs one (public-new-11 was decided that way).
 */
type DoorOptions = { readonly site?: string };
const doorFrame = (locale: Locale, path: string, title: string, card: string, other: string, o: DoorOptions = {}): string => `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi · ${esc(title)}</title>
<link rel="icon" href="${faviconDataUri()}">
${linkTo(DOOR_SHEET)}
${typeLink(locale)}</head>
<body><div class="login">
  <div class="top-sw">${switcher(locale, path)}</div>
  <div class="brand">${markSmall(32, null)}<span>Nomi</span><small class="muted">${esc(t(locale, 'login.brandTagline'))}</small></div>
  <div class="card">${card}</div>
  ${other}
  <nav class="foot" aria-label="Nomi"><a href="${esc(o.site ?? '/site')}">${esc(t(locale, 'door.site'))}</a><a href="/privacy">${esc(t(locale, 'legal.privacyLink'))}</a><a href="/terms">${esc(t(locale, 'legal.termsLink'))}</a></nav>
</div></body></html>`;

export type LoginProblem = 'code' | 'password' | 'locked' | 'slow' | 'email_missing' | 'password_missing';

/**
 * Where a page's header wants the live line (UI-PASS 6): the list's title row,
 * the conversation's head. A page that marks no place gets it under its title.
 */
export const LIVE_SLOT = '<!--live-->';
const placeLive = (body: string, live: string): string =>
  body.includes(LIVE_SLOT) ? body.replace(LIVE_SLOT, live) : `${live}${body}`;

export function loginPage(input: {
  readonly locale: Locale; readonly path: string;
  /** Kept for the callers that only know "it failed": the access-code sentence. */
  readonly error?: boolean; readonly problem?: LoginProblem;
  readonly email?: string; readonly signupOpen?: boolean;
  /**
   * Phase 9 (V1-033) — how sign-up is open, so the door's link says it: "New
   * here?" only where anyone may; "Have an invitation?" where a code is needed.
   */
  readonly signupMode?: 'open' | 'invite' | 'closed';
  /** 0078 — said once, above the form: "your password is saved, sign in with it". */
  readonly notice?: string | null;
  /** PWR — the door can e-mail a link (the installation sends system mail). */
  readonly recoveryOn?: boolean;
  /** The design pass (UI-PASS 10) — the access-code form, reached by its small door. */
  readonly withCode?: boolean;
}): string {
  const { locale } = input;
  const problem: LoginProblem | null = input.problem ?? (input.error ? 'code' : null);
  const codeMode = input.withCode === true || problem === 'code';
  const sentence = problem === 'password' ? t(locale, 'login.errorPassword')
    : problem === 'locked' ? t(locale, 'login.locked')
    : problem === 'slow' ? t(locale, 'login.slow')
    : problem === 'code' ? t(locale, 'login.error') : null;
  // Phase 9 (V1-037, V1-042) — a refusal that is about one field is said under
  // it and tied to it; the sign-in form asks the page, not the browser, so an
  // empty field is answered in the page's language.
  const missing = problem === 'email_missing' ? 'email' : problem === 'password_missing' ? 'password' : null;
  const tied = (id: string, on: boolean): string => (on ? ` class="err-field" aria-invalid="true" aria-describedby="${id}-err"` : '');
  const under = (id: string, words: string): string => `<div class="fld-err" id="${id}-err" role="alert">${esc(words)}</div>`;
  // THE DESIGN PASS (UI-PASS 10): the door leads with the e-mail. The access
  // code is for the pilot's owner and staff codes; most owners never need it,
  // so it is no longer a question on the page but a small door at its foot,
  // to a card of its own — and a door back.
  // Phase 9 (V1-041, V1-043) — the card says what the code is and where it comes
  // from. The code is shown as it is typed: it is made to be read out and copied
  // off a message (no O/0, no I/l/1), like the e-mailed code on /verify. It
  // posts to the address it is on, so a wrong code comes back to this card.
  const codeCard = `
    <h1>${esc(t(locale, 'login.code.title'))}</h1>
    <p class="lead">${esc(t(locale, 'login.code.lead'))}</p>
    <form method="post" action="/login?with=code">
      <label for="login-code">${esc(t(locale, 'login.passwordLabel'))}</label>
      <input id="login-code" type="text" name="code" required autocomplete="off" autocapitalize="characters"
        spellcheck="false" autofocus${tied('login-code', problem === 'code')} />
      ${problem === 'code' ? under('login-code', sentence ?? '') : ''}
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>`;
  const card = codeMode ? codeCard : `
    <h1>${esc(t(locale, 'login.title'))}</h1>
    ${input.notice ? `<div class="hint" role="status">${esc(input.notice)}</div>` : ''}
    ${sentence ? `<div class="err" role="alert">${esc(sentence)}</div>` : ''}
    <form method="post" action="/login" novalidate>
      <label for="login-email">${esc(t(locale, 'login.emailLabel'))}</label>
      <input id="login-email" type="email" name="email" value="${esc(input.email ?? '')}" required
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false"${missing === 'password' ? '' : ' autofocus'}${tied('login-email', missing === 'email')} />
      ${missing === 'email' ? under('login-email', t(locale, 'login.problem.email_missing')) : ''}
      <label for="login-password">${esc(t(locale, 'login.secretLabel'))}</label>
      <input id="login-password" type="password" name="password" required autocomplete="current-password"${missing === 'password' ? ' autofocus' : ''}${tied('login-password', missing === 'password')} />
      ${missing === 'password' ? under('login-password', t(locale, 'login.problem.password_missing')) : ''}
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>
    ${input.recoveryOn ? `<p class="forgot"><a href="/login/forgot">${esc(t(locale, 'login.forgot'))}</a></p>` : ''}`;
  const toSignup = input.signupMode === 'invite' ? 'login.toSignup.invite' : 'login.toSignup';
  const other = [
    input.signupOpen === false || input.signupMode === 'closed' || codeMode ? '' : `<p class="other"><a href="/signup">${esc(t(locale, toSignup))}</a></p>`,
    codeMode
      ? `<p class="other"><a href="/login">${esc(t(locale, 'login.withEmail'))}</a></p>`
      : `<p class="other small"><a href="/login?with=code">${esc(t(locale, 'login.codeToggle'))}</a></p>`,
  ].join('');
  return doorFrame(locale, input.path, codeMode ? t(locale, 'login.code.title') : t(locale, 'login.title'), card, other);
}

export type SignupPageInput = {
  readonly locale: Locale; readonly path: string;
  readonly mode: 'open' | 'invite' | 'closed';
  readonly passwordMin: number;
  readonly contact?: string | null;
  readonly values?: {
    readonly factory?: string; readonly name?: string; readonly email?: string; readonly invite?: string;
    readonly kind?: string; readonly sells?: string; readonly country?: string; readonly website?: string;
    readonly teamSize?: string; readonly channels?: readonly string[]; readonly zone?: string;
    readonly currency?: string; readonly terms?: boolean;
  };
  /** Sentences, already chosen by the route: one per field, plus one for the whole form. */
  readonly problems?: Partial<Record<'factory' | 'name' | 'email' | 'password' | 'invite'
    | 'kind' | 'sells' | 'country' | 'website' | 'teamSize' | 'zone' | 'currency' | 'terms', string>>;
  readonly error?: string | null;
  /**
   * BOT — the provider's widget, drawn just above the button with its own
   * script; the token it makes arrives in `field`. Absent: no check.
   */
  readonly botCheck?: { readonly script: string; readonly className: string; readonly siteKey: string } | null;
};

export function signupPage(input: SignupPageInput): string {
  const { locale } = input;
  const v = input.values ?? {};
  const p = input.problems ?? {};
  const other = `<p class="other"><a href="/login">${esc(t(locale, 'signup.toLogin'))}</a></p>`;
  if (input.mode === 'closed') {
    const contact = input.contact
      ? `<p class="lead">${esc(t(locale, 'signup.closedContact', { email: input.contact }))}</p>` : '';
    return doorFrame(locale, input.path, t(locale, 'signup.title'),
      `<h1>${esc(t(locale, 'signup.title'))}</h1><p class="lead">${esc(t(locale, 'signup.closed'))}</p>${contact}`, other);
  }
  // Phase 9 (public-missed-12, public-missed-13) — a refused field is marked at
  // its edge and tied to its sentence; the first one refused takes the cursor,
  // and a line at the top lists each, as a door to it.
  const FIELD_ID: Readonly<Record<keyof typeof p, string>> = {
    invite: 'su-invite', factory: 'su-factory', kind: 'su-kind', sells: 'su-sells', country: 'su-country',
    zone: 'su-zone', currency: 'su-currency', website: 'su-website', teamSize: 'su-team', name: 'su-name',
    email: 'su-email', password: 'su-password', terms: 'su-terms',
  };
  const FIELD_LABEL: Readonly<Record<keyof typeof p, MessageKey>> = {
    invite: 'signup.invite', factory: 'signup.factory', kind: 'signup.kind', sells: 'signup.sells', country: 'signup.country',
    zone: 'signup.zone', currency: 'signup.currency', website: 'signup.website', teamSize: 'signup.teamSize', name: 'signup.name',
    email: 'signup.email', password: 'signup.password', terms: 'signup.termsLink',
  };
  const ORDER: readonly (keyof typeof p)[] = [...(input.mode === 'invite' ? ['invite' as const] : []),
    'factory', 'kind', 'sells', 'country', 'zone', 'currency', 'website', 'teamSize', 'name', 'email', 'password', 'terms'];
  const refused = ORDER.filter((k) => p[k]);
  const cameBack = refused.length > 0 || Boolean(input.error);
  // Where the cursor starts: the first refusal; else the invitation while it is empty; else the business's name.
  const first: keyof typeof p = refused[0] ?? (input.mode === 'invite' && !v.invite ? 'invite' : 'factory');
  const at = (k: keyof typeof p): string =>
    `${p[k] ? ` class="err-field" aria-invalid="true" aria-describedby="${FIELD_ID[k]}-err"` : ''}${k === first ? ' autofocus' : ''}`;
  const fieldErr = (k: keyof typeof p): string => (p[k] ? `<div class="fld-err" id="${FIELD_ID[k]}-err" role="alert">${esc(p[k]!)}</div>` : '');
  const summary = refused.length ? `<div class="err" role="alert">${esc(t(locale, 'signup.problem.summary'))}<ul>${refused.map((k) =>
    `<li><a href="#${FIELD_ID[k]}">${esc(t(locale, FIELD_LABEL[k]))}</a></li>`).join('')}</ul></div>` : '';
  const mailTo = (key: MessageKey): string => (input.contact
    ? esc(t(locale, key, { email: '\u0000' })).replace('\u0000', `<a href="mailto:${esc(input.contact)}">${esc(input.contact)}</a>`) : '');
  // Phase 9 (V1-047) — in invite mode the code comes first: nothing else can be
  // sent without it. It says where it is, and how to ask for one.
  const invite = input.mode === 'invite' ? `
      <label for="su-invite">${esc(t(locale, 'signup.invite'))}</label>
      <input id="su-invite" type="text" name="invite" value="${esc(v.invite ?? '')}" required autocomplete="off" autocapitalize="none" spellcheck="false"${at('invite')} />
      ${fieldErr('invite') || `<div class="hint">${esc(t(locale, 'signup.inviteHint'))}${input.contact ? ` ${mailTo('signup.inviteAsk')}` : ''}</div>`}` : '';
  // A2 — about the business. Every answer but two is a choice from a list.
  const option = (value: string, label: string, chosen: string | undefined): string =>
    `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const pick = `<option value="">${esc(t(locale, 'signup.pick'))}</option>`;
  const used = new Set(v.channels ?? []);
  const about = `
      <h2>${esc(t(locale, 'signup.about'))}</h2>
      <label for="su-factory">${esc(t(locale, 'signup.factory'))}</label>
      <input id="su-factory" type="text" name="factory" value="${esc(v.factory ?? '')}" required maxlength="120" autocomplete="organization"${at('factory')} />
      ${fieldErr('factory')}
      <label for="su-kind">${esc(t(locale, 'signup.kind'))}</label>
      <select id="su-kind" name="kind" required${at('kind')}>${pick}${BUSINESS_KINDS.map((k) =>
        option(k, t(locale, `business.kind.${k}` as MessageKey), v.kind)).join('')}</select>
      ${fieldErr('kind')}
      <label for="su-sells">${esc(t(locale, 'signup.sells'))}</label>
      <input id="su-sells" type="text" name="sells" value="${esc(v.sells ?? '')}" required maxlength="300"${at('sells')} />
      ${/* V1-048 — the example is a line under the field: a placeholder was cut at every width. */
        fieldErr('sells') || `<div class="hint">${esc(t(locale, 'signup.sells.hint'))}</div>`}
      <label for="su-country">${esc(t(locale, 'signup.country'))}</label>
      <select id="su-country" name="country" required autocomplete="country"${at('country')}>${pick}${countryOptions(locale).map((c) =>
        option(c.code, c.name, v.country)).join('')}</select>
      ${fieldErr('country')}
      ${/* TZ — asked only where the country has several zones; a country with one gets it. */
        zoneChoices(v.country).length > 1 ? `
      <label for="su-zone">${esc(t(locale, 'signup.zone'))}</label>
      <select id="su-zone" name="zone" required${at('zone')}>${pick}${((zs) => zs.map((z) =>
        option(z, zoneLabelsAmong(locale, zs)(z), v.zone)).join(''))(zoneChoices(v.country))}</select>
      ${fieldErr('zone')}` : ''}
      ${/* CUR — asked only where the country's own money is not on the list; a country whose is sells in it. */
        asksCurrency(v.country) ? `
      <label for="su-currency">${esc(t(locale, 'signup.currency'))}</label>
      <select id="su-currency" name="currency" required${at('currency')}>${pick}${CURRENCY_CHOICES.map((c) =>
        option(c, currencyLabel(locale, c), v.currency)).join('')}</select>
      ${fieldErr('currency')}` : ''}
      <label for="su-website">${esc(t(locale, 'signup.website'))}</label>
      <input id="su-website" type="text" name="website" value="${esc(v.website ?? '')}" maxlength="200"
        inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="url" placeholder="${esc(t(locale, 'signup.website.placeholder'))}"${at('website')} />
      ${fieldErr('website')}
      <label for="su-team">${esc(t(locale, 'signup.teamSize'))}</label>
      <select id="su-team" name="teamSize" required${at('teamSize')}>${pick}${TEAM_SIZES.map((s) =>
        option(s, t(locale, `business.team.${s}` as MessageKey), v.teamSize)).join('')}</select>
      ${fieldErr('teamSize')}
      <fieldset class="checks"><legend>${esc(t(locale, 'signup.channels'))}</legend>
        ${CHANNELS_USED.map((c) => `<label class="check"><input type="checkbox" name="channel_${c}"${used.has(c) ? ' checked' : ''} />
          <span>${esc(t(locale, `business.channel.${c}` as MessageKey))}</span></label>`).join('')}
      </fieldset>`;
  const card = `
    <h1>${esc(t(locale, 'signup.title'))}</h1>
    <p class="lead">${esc(t(locale, 'signup.lead'))}</p>
    ${input.error ? `<div class="err" role="alert">${esc(input.error)}</div>` : ''}
    ${summary}
    <form method="post" action="/signup">
      ${invite}
      ${about}
      <h2>${esc(t(locale, 'signup.you'))}</h2>
      <label for="su-name">${esc(t(locale, 'signup.name'))}</label>
      <input id="su-name" type="text" name="name" value="${esc(v.name ?? '')}" required maxlength="80" autocomplete="name"${at('name')} />
      ${fieldErr('name')}
      <label for="su-email">${esc(t(locale, 'signup.email'))}</label>
      <input id="su-email" type="email" name="email" value="${esc(v.email ?? '')}" required maxlength="254"
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false"${at('email')} />
      ${fieldErr('email')}
      <label for="su-password">${esc(t(locale, 'signup.password'))}</label>
      <input id="su-password" type="password" name="password" required minlength="${input.passwordMin}" autocomplete="new-password"${at('password')} />
      ${/* A typed password is never sent back; a page that came back says so (public-missed-12). */
        fieldErr('password') || `<div class="hint">${esc(t(locale, 'signup.passwordHint', { n: input.passwordMin }))}${cameBack ? ` ${esc(t(locale, 'signup.passwordAgain'))}` : ''}</div>`}
      <label class="check terms"><input id="su-terms" type="checkbox" name="terms" required${v.terms ? ' checked' : ''}${at('terms')} />
        <span>${esc(t(locale, 'signup.terms', { terms: '\u0000' })).replace('\u0000', `<a href="/terms" target="_blank" rel="noopener">${esc(t(locale, 'signup.termsLink'))}</a>`)}</span></label>
      ${fieldErr('terms')}
      ${input.botCheck ? `<div class="${esc(input.botCheck.className)}" data-sitekey="${esc(input.botCheck.siteKey)}"></div>
      <noscript><div class="hint">${esc(t(locale, 'signup.botcheck.noscript'))}</div></noscript>
      <script src="${esc(input.botCheck.script)}" async defer></script>` : ''}
      <button type="submit">${esc(t(locale, 'signup.submit'))}</button>
    </form>`;
  return doorFrame(locale, input.path, t(locale, 'signup.title'), card, other);
}

/**
 * A3 — "enter the code we sent you". The third page a stranger may see.
 *
 * It shows the address only masked: whoever is looking at this screen should
 * recognise it as theirs, not read it off someone else's.
 */
/**
 * 0078 — CHOOSE YOUR PASSWORD, from the one-time link tools/add-login.mjs
 * prints. The operator gives a workspace that exists a login; the owner picks
 * the password here, so it never passes through a command line or a chat.
 *
 * Opening the page spends nothing — a messenger that fetches the link to draw
 * a preview must not use it up; only saving does. A link that is not good says
 * one thing whatever the reason (used, lapsed, never made), so the page does
 * not tell a stranger which it was. The token rides in a hidden field, never
 * in anything the page links to.
 */
export type SetPasswordProblem = 'short' | 'long' | 'mismatch' | 'is_email';

export function setPasswordPage(input: {
  readonly locale: Locale; readonly path: string; readonly passwordMin: number; readonly passwordMax: number;
  /** Null: the link is not good (used, lapsed or unknown). */
  readonly link: { readonly token: string; readonly email: string } | null;
  readonly problem?: SetPasswordProblem | null;
  /** Phase 9 (V1-079) — the door can e-mail a new link (the installation sends system mail). */
  readonly recoveryOn?: boolean;
  /** …and where Nomi's team is written to, when it cannot. */
  readonly contact?: string | null;
}): string {
  const { locale } = input;
  const other = `<p class="other"><a href="/login">${esc(t(locale, 'setpw.toLogin'))}</a></p>`;
  if (!input.link) {
    // Phase 9 (V1-078–V1-080) — the heading says what happened, and the way on is
    // one that works for someone with no password: a new link to the address
    // they sign in with, or Nomi's team, who made the first one. Signing in is
    // for whoever already chose a password with it.
    const gone = t(locale, 'setpw.gone.title');
    const how = input.recoveryOn
      ? `<p class="lead">${esc(t(locale, 'setpw.gone.ask'))}</p><p><a href="/login/forgot">${esc(t(locale, 'setpw.gone.newLink'))}</a></p>`
      : input.contact
        ? `<p class="lead">${esc(t(locale, 'setpw.gone.write', { email: '\u0000' })).replace('\u0000', `<a href="mailto:${esc(input.contact)}">${esc(input.contact)}</a>`)}</p>`
        : '';
    return doorFrame(locale, input.path, gone,
      `<h1>${esc(gone)}</h1><p class="lead">${esc(t(locale, 'setpw.gone'))}</p>${how}`,
      `<p class="other"><a href="/login">${esc(t(locale, 'setpw.gone.signIn'))}</a></p>`);
  }
  const problem = input.problem
    ? t(locale, `setpw.problem.${input.problem}` as MessageKey, { n: input.problem === 'long' ? input.passwordMax : input.passwordMin })
    : null;
  const card = `
    <h1>${esc(t(locale, 'setpw.title'))}</h1>
    <p class="lead"><bdi>${esc(t(locale, 'setpw.lead', { email: input.link.email }))}</bdi></p>
    ${problem ? `<div class="err" role="alert">${esc(problem)}</div>` : ''}
    <form method="post" action="/login/set-password">
      <input type="hidden" name="t" value="${esc(input.link.token)}" />
      <input type="email" name="email" value="${esc(input.link.email)}" autocomplete="username" hidden readonly />
      <label for="setpw-password">${esc(t(locale, 'setpw.password'))}</label>
      <input id="setpw-password" type="password" name="password" required minlength="${input.passwordMin}"
        maxlength="${input.passwordMax}" autocomplete="new-password" autofocus />
      <div class="hint">${esc(t(locale, 'signup.passwordHint', { n: input.passwordMin }))}</div>
      <label for="setpw-repeat">${esc(t(locale, 'setpw.repeat'))}</label>
      <input id="setpw-repeat" type="password" name="repeat" required minlength="${input.passwordMin}"
        maxlength="${input.passwordMax}" autocomplete="new-password" />
      <button type="submit">${esc(t(locale, 'setpw.submit'))}</button>
    </form>`;
  return doorFrame(locale, input.path, t(locale, 'setpw.title'), card, other);
}

/**
 * PWR — "E-MAIL ME A LINK". The owner who forgot the password types the
 * address; a one-time link to choose a new one (0078's page) goes there.
 *
 * The page says the same thing whether or not the address signs in here, and
 * the route answers before any mail leaves — neither the words nor the time
 * tell a stranger which addresses have a login.
 */
export type ForgotProblem = 'email' | 'slow';

export function forgotPasswordPage(input: {
  readonly locale: Locale; readonly path: string; readonly minutes: number;
  readonly email?: string; readonly problem?: ForgotProblem | null;
  /** The address it was asked for: the page now says a link is on its way — if it signs in here. */
  readonly sent?: string | null;
}): string {
  const { locale } = input;
  const other = `<p class="other"><a href="/login">${esc(t(locale, 'setpw.toLogin'))}</a></p>`;
  if (input.sent) {
    return doorFrame(locale, input.path, t(locale, 'forgot.title'),
      `<h1>${esc(t(locale, 'forgot.title'))}</h1>
      <p class="lead" role="status"><bdi>${esc(t(locale, 'forgot.sent', { email: input.sent, minutes: input.minutes }))}</bdi></p>`, other);
  }
  const problem = input.problem === 'email' ? t(locale, 'signup.problem.email_invalid')
    : input.problem === 'slow' ? t(locale, 'login.slow') : null;
  const card = `
    <h1>${esc(t(locale, 'forgot.title'))}</h1>
    <p class="lead">${esc(t(locale, 'forgot.lead', { minutes: input.minutes }))}</p>
    ${problem ? `<div class="err" role="alert">${esc(problem)}</div>` : ''}
    <form method="post" action="/login/forgot">
      <label for="forgot-email">${esc(t(locale, 'login.emailLabel'))}</label>
      <input id="forgot-email" type="email" name="email" value="${esc(input.email ?? '')}" required maxlength="254"
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" autofocus />
      <button type="submit">${esc(t(locale, 'forgot.submit'))}</button>
    </form>`;
  return doorFrame(locale, input.path, t(locale, 'forgot.title'), card, other);
}

export function verifyPage(input: {
  readonly locale: Locale; readonly path: string; readonly maskedEmail: string;
  readonly purpose: 'signup' | 'device'; readonly error?: string | null; readonly notice?: string | null;
}): string {
  const { locale } = input;
  const card = `
    <h1>${esc(t(locale, 'verify.title'))}</h1>
    <p class="lead"><bdi>${esc(t(locale, input.purpose === 'device' ? 'verify.lead.device' : 'verify.lead', { email: input.maskedEmail }))}</bdi></p>
    ${input.notice ? `<div class="hint" role="status">${esc(input.notice)}</div>` : ''}
    ${input.error ? `<div class="err" role="alert">${esc(input.error)}</div>` : ''}
    <form method="post" action="/verify">
      <label for="otp-code">${esc(t(locale, 'verify.code'))}</label>
      <input id="otp-code" type="text" name="code" required autofocus inputmode="numeric" pattern="[0-9 ]{6,8}"
        maxlength="8" autocomplete="one-time-code" />
      <button type="submit">${esc(t(locale, 'verify.submit'))}</button>
    </form>
    <details>
      <summary>${esc(t(locale, 'verify.resend'))}</summary>
      <form method="post" action="/verify/resend"><button type="submit">${esc(t(locale, 'verify.resend'))}</button></form>
    </details>`;
  const other = `<p class="other"><a href="${input.purpose === 'device' ? '/login' : '/signup'}">${esc(t(locale, 'verify.back'))}</a></p>`;
  return doorFrame(locale, input.path, t(locale, 'verify.title'), card, other);
}

/**
 * CC-19 / A13 — the two pages nobody designed, which every product shows anyway.
 *
 * Until now a mistyped address answered `{"message":"Route GET:/app/nope not
 * found","error":"Not Found","statusCode":404}` — Fastify's own voice, in
 * English, to an owner reading an Arabic product. A thrown route answered the
 * same way with a 500. Both are the product speaking a language it does not
 * speak anywhere else, and the second one can leak an internal message.
 *
 * They use the door's frame, not the shell: an error may reach someone with no
 * session, and a navigation rail whose links might also 404 is not a comfort.
 * The only way out is offered as a LINK to a place that exists, never "go
 * back", because the thing she just did is what produced this.
 *
 * `crash` says nothing about what broke. The reason goes to the log with a
 * reference she can quote; the page carries the reference and no more.
 */
export function errorPage(input: {
  readonly locale: Locale; readonly path: string;
  readonly kind: 'notfound' | 'crash';
  /** Shown only for `crash`, so a report can be tied to one log line. */
  readonly reference?: string | null;
  /**
   * Phase 9 (V1-075, V1-076) — whether the reader has a workspace to go back to.
   * Signed out, the page speaks of no workspace, and offers the site and the door.
   */
  readonly signedIn?: boolean;
  /** Where the site is read from this host: `/` on the site's own, `/site` elsewhere. */
  readonly site?: string;
}): string {
  const { locale, kind } = input;
  const title = t(locale, kind === 'notfound' ? 'error.notfound.title' : 'error.crash.title');
  const body = kind === 'crash' ? 'error.crash.body' : input.signedIn ? 'error.notfound.body' : 'error.notfound.public';
  const card = `
    <h1>${esc(title)}</h1>
    <p class="lead">${esc(t(locale, body))}</p>
    ${kind === 'crash' && input.reference
      ? `<p class="hint">${esc(t(locale, 'error.reference', { ref: input.reference }))}</p>` : ''}`;
  const other = input.signedIn
    ? `<p class="other"><a href="/app">${esc(t(locale, 'error.home'))}</a></p>`
    : `<p class="other"><a href="${esc(input.site ?? '/site')}">${esc(t(locale, 'error.toSite'))}</a></p>`
      + `<p class="other small"><a href="/login">${esc(t(locale, 'login.title'))}</a></p>`;
  return doorFrame(locale, input.path, title, card, other, input.site ? { site: input.site } : {});
}
