import { BUSINESS_KINDS, TEAM_SIZES, CHANNELS_USED, countryOptions } from '../../core/owner/business.js';
import { zoneChoices, zoneLabel } from '../../core/owner/zones.js';
import { asksCurrency, currencyLabel, CURRENCY_CHOICES } from '../../core/owner/currencies.js';
import { type Locale, dirOf, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { type MessageKey, ASSISTANT_FALLBACK } from '../../core/owner/i18n/messages.js';
import { t, assistantName, assistantsAreSeveral, setupState, businessName, needsYouCount, tn } from './say.js';
import { cssVariables } from '../../core/owner/css.js';
import { DESIGN_TOKENS } from '../../core/owner/tokens.js';
import { isolate } from './values.js';
import { markDetail, markSmall, faviconDataUri } from '../../core/owner/brand.js';
import { INSTALL_LINKS } from './phone.js';
import { createHash } from 'node:crypto';
import { LIVE_SCRIPT } from './liveScript.js';
import { TYPE_CSS, TYPE_ZH_CSS, typeSetFor, fontAt } from './type.js';

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
  { href: '/app/employee',  id: 'employee' },
  { href: '/app/business',   id: 'factory' },
  // D (2026-09-21) — Setup: how this installation is wired. "What I sell" and
  // "how this is wired" are different questions asked at different times, and
  // they were one drawer. Five entries, no conditional sixth: while setup is
  // incomplete this entry carries a count, and Today carries a card.
  { href: '/app/settings',  id: 'settings' },
];

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
  { hub: '/app/business', routes: [
    '/app/products', '/app/business/prices',
    '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate',
  ] },
  { hub: '/app/employee', routes: ['/app/knowledge', '/app/settings/forbidden', '/app/sandbox'] },
  // V2 — the calendar: each entry opens a buyer, so it is reached from Buyers.
  { hub: '/app/inbox', routes: ['/app/calendar'] },
  // M38 — everyone the assistant may write to, reached from the list of
  // everyone who wrote. A — that list is Buyers now (it was Customers).
  { hub: '/app/inbox', routes: ['/app/contacts'], outreach: true },
  { hub: '/app/settings', routes: [
    '/app/onboarding', '/app/channels',
    '/app/settings/people', '/app/settings/business', '/app/settings/account', '/app/settings/data',
  ] },
  // Phase 3 of the UI rebuild — the component gallery (`/app/settings/components`)
  // is no longer a door on Setup: it is a page for whoever builds the product
  // (the screenshots tool walks it), not a setting. It still lights Setup, by
  // sitting under its address.
  // Phase 4b — the machine room is reached from Getting ready, and lights Setup through it.
  { hub: '/app/onboarding', routes: ['/app/onboarding/technical', '/app/ready'] },
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

/**
 * THE ASSISTANT'S HAND (the design pass, 2026-09-29): its name where it is
 * the author, after a ✦, in magenta — the one colour that means something by
 * itself. Only ever text; never on a link, a button, a heading or the mark
 * (`palette.test.ts`). The ✦ is hidden from a screen reader, which hears the
 * name. `name` arrives escaped or is escaped here.
 */
/** The text an escaped fragment stands for: the inverse of `esc`, for the five it writes. */
export const unescapeHtml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

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
  ok: ['.pill.ok', '.pill.taught', '.fconn.on .fconn-s', '.sbx-trust.pass .verdict', '.chip.auto', '.sr-value.ok', '.p-tag.big'],
  waiting: ['.pill.warn', '.pill.reason', '.fconn.off .fconn-s', '.fwarn', '.imp-warn', '.draft .held-why', '.chip.draft', '.sr-value.warn', '.prob'],
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
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration:1ms !important; animation-iteration-count:1 !important;
      animation-delay:0s !important; transition-duration:1ms !important; scroll-behavior:auto !important; }
  }
  @keyframes nomi-arrive { from { opacity:0; transform:translateY(-4px); } }
  @keyframes nomi-rise { from { opacity:0; transform:translateY(8px); } }
  @keyframes nomi-breathe { from { opacity:0.25; } to { opacity:1; } }
  @keyframes nomi-fade { from { opacity:0; } }
  /* The assistant at work: its mark, what it is doing, three dots. */
  .working { display:flex; align-items:baseline; gap:var(--space-8); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .working .dots { display:inline-flex; gap:var(--space-4); }
  .working .dots i { width:6px; height:6px; border-radius:var(--radius-chip); background:var(--color-ink-secondary); }
  /* Asking first: the product's own dialog over a dimmed page. */
  dialog.ask { border:0; border-radius:var(--radius-card); padding:var(--space-24); max-width:var(--measure-form);
    inline-size:min(var(--measure-form), calc(100vw - var(--space-32))); box-shadow:var(--shadow-lift2);
    background:var(--color-surface); color:var(--color-ink); }
  dialog.ask::backdrop { background:var(--color-ink); opacity:0.35; }
  .ask-q { margin:0 0 var(--space-16); }
  .ask-acts { display:flex; gap:var(--space-8); flex-wrap:wrap; }
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
  .langsw a { display:inline-flex; align-items:center; min-height:44px; padding:0 14px;
    border-radius:var(--radius-chip); font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); white-space:nowrap; }
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
  .navgroup + .navgroup { margin-top: var(--space-16); }
  .navfoot { margin-top:auto; padding-top: var(--space-16); }
  nav.side a.navlink[href="/app/inbox"] { display:none; }
  .navhub { display:flex; flex-direction:column; }
  .navhead { padding: var(--space-8) var(--space-12) var(--space-4); font-size: var(--font-size-small);
    color: var(--color-ink-secondary); }
  nav.side .subnav { display:flex; align-items:center; width:100%; min-height:40px;
    padding: var(--space-8) var(--space-12) var(--space-8) var(--space-24); border:0; border-radius: var(--radius-card);
    background:transparent; color: var(--color-ink-secondary); font: inherit; font-size: var(--font-size-small);
    text-align:start; cursor:pointer; margin-bottom: var(--space-4); }
  .navout { margin:0; }
  nav.side .navout .subnav { padding-inline-start: var(--space-12); }
  nav.side .subnav:hover { background: var(--color-surface); color: var(--color-ink); }
  nav.side .subnav.active { background: var(--color-surface); color: var(--color-ink); font-weight:600; }
  /* Log out is the rail's foot on a wide screen; Setup's last row is the phone's. One on each. */
  @media (min-width: 721px) { .block.signout { display:none; } }
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
  .brand .brandname { min-width:0; overflow-wrap:anywhere; }
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
  nav.side a.navlink { display: flex; align-items: center; gap: var(--space-8); padding: var(--space-12);
    min-height: 44px; border-radius: var(--radius-card); color: var(--color-ink-secondary);
    font-size: var(--font-size-small); margin-bottom: var(--space-4); }
  nav.side a.navlink:hover { background: var(--color-surface); color: var(--color-ink); }
  /* M49 — the active destination reads by WEIGHT and a recess, not by colour.
     Green was being spent five times on one screen: this slab, a panel, every
     link, the language pill and the button. Colour that appears everywhere
     marks nothing; jade now means only "this sends" and "this is a state". */
  nav.side a.navlink.active { background: var(--color-surface); color: var(--color-ink); font-weight:600; }
  .nl-short { display:none; }
  /* D — the setup count on the Setup entry: a figure at the far end of the
     row, in the secondary ink. Not a state, so no state colour. */
  /* V1 step three — the count sits BESIDE its word, not at the far end of the row. */
  nav.side .navcount { margin-inline-start:var(--space-8); font-size:var(--font-size-caption);
    font-weight:500; color:var(--color-ink-secondary); font-variant-numeric:tabular-nums; }
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
  h1.page { font-size: var(--font-size-title); margin: 0 0 var(--space-16); }
  /* The hairline in --shadow-lift1 does what a 1px border used to; two would
     read as a double rule at the same edge. */
  .card { background:var(--color-surface); border:0; border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift1); padding:var(--space-16); margin:var(--space-16) 0; }
  /* Phase F: section headings speak to the owner in her own sentence case.
     The 13px tracked-uppercase eyebrow was the one SaaS tell the product had. */
  .card h2, .block h2, main h2 { font-size:var(--font-size-base); font-weight:600;
    color:var(--color-ink); margin:0 0 var(--space-12); text-transform:none; letter-spacing:0; }

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
  .pform input, .pform textarea, .pform select {
    background:var(--color-surface); border:1px solid var(--color-ink-secondary);
    border-radius:10px; color:var(--color-ink); padding:11px 14px; font:inherit;
    min-height:44px; resize:vertical; }
  .chkbox { display:inline-flex; align-items:center; gap:var(--space-8);
            font-size:var(--font-size-small); color:var(--color-ink); min-height:44px; }
  .chkbox input { min-height:0; }
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
  .tab.on { background:var(--color-paper); border-color:var(--color-border); color:var(--color-ink); font-weight:600; }

  .list { display:flex; flex-direction:column; gap:var(--space-12); }
  .back { display:inline-flex; align-items:center; gap:var(--space-4); min-height:44px;
    color:var(--color-ink); font-size:var(--font-size-small); }
  pre { background:var(--color-paper); border:1px solid var(--color-border);
    border-radius:var(--radius-card); padding:18px; overflow-x:auto;
    font:var(--font-size-small)/1.55 "SF Mono", ui-monospace, Menlo, monospace;
    color:var(--color-ink); white-space:pre; margin:0; }
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
  /* A setting as a row inside its card: what it is on the start side, its
     control on the end side; stacked on a phone. One save per form, in a bar
     that stays at the foot of the screen while the form scrolls. */
  .scard > .setrow + .setrow, .scard > .setrow + .fr-acts { border-top:1px solid var(--color-border); }
  .setrow { display:grid; grid-template-columns:minmax(0, 2fr) minmax(0, 3fr); gap:var(--space-8) var(--space-16);
    align-items:start; padding:var(--space-12) var(--space-16); }
  .fr-l { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; padding-top:var(--space-8); }
  .fr-name { font-weight:600; font-size:var(--font-size-small); }
  .fr-desc { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fr-c { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .fr-c > input:not([type="checkbox"]):not([type="radio"]), .fr-c > select, .fr-c > textarea { width:100%; }
  .fr-c > .fr-value { padding-top:var(--space-8); }
  .setrow.bad .fr-c > input, .setrow.bad .fr-c > textarea, .setrow.bad .fr-c > select { border-color:var(--color-warn); }
  .fr-acts { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--space-8); padding:var(--space-12) var(--space-16); }
  .savebar { position:sticky; bottom:0; z-index:1; display:flex; justify-content:flex-end; gap:var(--space-8);
    margin:var(--space-8) 0 0; padding:var(--space-12) 0; background:var(--color-paper); border-top:1px solid var(--color-border); }
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
  }
  .tl-why, .tl-when { color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .today-date { font-weight:400; }
  .today-worth { margin-top:var(--space-12); }
  .today-foot { font-size:var(--font-size-small); margin:var(--space-16) 0 0; }
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
  .bubble { font-family:var(--font-voice); padding:10px 14px; border-radius:14px;
    white-space:pre-wrap; word-break:break-word; }
  /* The buyer's words are FULL SIZE; every reply is one step down. The page
     belongs to the buyer's business — she works inside it. */
  .msg.inbound .bubble { font-size:var(--font-size-base);
    background:var(--color-paper); border-start-start-radius:4px; }
  /* Her sent replies: neutral. These carried an amber fill — colour on every
     message she ever sent, marking no state at all. */
  .msg.outbound .bubble { font-size:var(--font-size-small);
    background:var(--color-surface); border:1px solid var(--color-border);
    border-start-end-radius:4px; }
  .ts { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .as { color:var(--color-assistant); }
  /* CC-25 — a link into a transcript lands on its newest message: clear of the
     sticky phone nav, with the message before it still in view. After an
     action it lands on the notice the action left, drawn under that message.
     The practice box is a landing of the same kind. */
  #latest, #compose, #main { scroll-margin-top:25vh; }
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
  .takeover { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .acts { display:flex; gap:var(--space-8); flex-wrap:wrap; margin-bottom:var(--space-16); }
  .perr { color:var(--color-warn); font-size:var(--font-size-caption); margin:0; }
  /* Phase 6 — a form's refusal under the field it concerns: why, the rule it follows, the way on. */
  .perr-block { margin:var(--space-8) 0; display:flex; flex-direction:column; gap:var(--space-4); }
  .perr-block p { margin:0; }
  .pq { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); color:var(--color-ink); }
  .subline { font-size:var(--font-size-caption); margin-bottom:var(--space-12); }
  .dhead { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; margin-bottom:var(--space-8); }
  .chips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .chip { background:var(--color-paper); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); }
  .as-box { display:inline-flex; align-items:center; gap:var(--space-4); font-size:var(--font-size-small); }
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
  .pill.stop { background:var(--color-paper); color:var(--color-ink-secondary); }
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
    border-radius:10px; color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
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
    /* The groups dissolve into the one row; "Customers" is its entry, and its
       two pages and Log out are reached from the pages themselves. */
    .navgroup, .navfoot { display:contents; }
    .navhub, .navout { display:none; }
    nav.side a.navlink[href="/app/inbox"] { display:flex; }
    /* The mark belongs to the product, so it sits with the product's nav — small,
       and without the word beside it. */
    nav.side .brand { display:flex; padding:0; margin-inline-end:var(--space-4); }
    nav.side .brand .mark-detail { display:none; }
    nav.side .brand .mark-small { display:flex; }
    nav.side .brand .brandname { display:none; }
    .business-name { display:block; }
    nav.side a.navlink { flex:1 1 auto; flex-direction:row; flex-wrap:nowrap; white-space:nowrap; gap:var(--space-4); margin:0;
      padding:var(--space-8) var(--space-4); min-height:56px; align-items:center; justify-content:center;
      font-size:var(--font-size-caption); text-align:center; }
    /* Phase 7 — one line: the shorter phone label where there is one, and a sideways scroll as the last resort. */
    nav.side { overflow-x:auto; scrollbar-width:none; padding-inline:var(--space-8); }
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
  /* Phase 7 — the narrowest phones: the five entries before the small mark. */
  @media (max-width: 379px) {
    nav.side .brand { display:none; }
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
  /* ── guide.ts — the guided path: five steps, each with its video and its words. */
  .guide { list-style:none; margin:var(--space-16) 0 0; padding:0; display:flex; flex-direction:column; gap:var(--space-24); }
  .guide-step { border:1px solid var(--color-border); border-radius:12px; padding:var(--space-16); background:var(--color-surface); }
  .guide-step.next { border-color:var(--color-ink-secondary); }
  .guide-step h2 { display:flex; align-items:baseline; gap:var(--space-8); flex-wrap:wrap; margin:0 0 var(--space-12); }
  .guide-step ol { margin:0 0 var(--space-12); padding-inline-start:var(--space-24); max-width:var(--measure-prose); }
  .guide-video { display:block; width:100%; max-width:var(--measure-prose); border-radius:8px; background:var(--color-paper); margin-bottom:var(--space-8); }
  /* ── channels.ts — WA-S, writing after 24 hours, under the number it belongs to. */
  .ch-reopen { margin-top:var(--space-16); border-top:1px solid var(--color-border); padding-top:var(--space-12); }
  .fielderr { color:var(--color-warn); font-size:var(--font-size-caption); }
  .fld.bad input, .fld.bad textarea { border-color:var(--color-warn-line); }
  .langs { display:flex; flex-wrap:wrap; gap:var(--space-12); padding-top:2px; }
  .cats { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cat { background:var(--color-paper); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fterms { list-style:none; margin:var(--space-12) 0 0; padding:0; }
  .fterms li { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  .fterms li:last-child { border-bottom:0; }
  .fterms.floor li { color:var(--color-ink-secondary); }
  .fterms .fnote { display:block; font-size:var(--font-size-caption); margin-top:var(--space-4); }
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
  .sreq-a textarea { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .sreq-do { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }

  /* ── pilot.ts — moved here whole in step four: page-specific names, defined once. */
  .rbsub { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .rbrow { display:flex; align-items:center; gap:var(--space-8); padding:8px 0; border-bottom:1px solid var(--color-paper); }
  .rbrow:last-child { border-bottom:0; }
  .rbrow .lbl { font-size:var(--font-size-small); }
  .rbrow .n { margin-inline-start:auto; font-size:var(--font-size-small); font-weight:700; color:var(--color-ink); }
  .rblink { font-size:var(--font-size-caption); }
  .rbsteps { margin:var(--space-8) 0 var(--space-16); padding-inline-start:20px; color:var(--color-ink-secondary); font-size:var(--font-size-small); }
  .rbsteps li { padding:2px 0; }
  .rbrow .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  /* Engine evidence: raw on purpose — it is read by whoever fixes the defect. */
  .ev { border:1px solid var(--color-warn-line); background:var(--color-warn-wash); border-radius:12px; padding:12px 14px; margin-top:var(--space-12); }
  .ev-h { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .ev-h .mono { font:var(--font-size-caption)/1.4 "SF Mono", ui-monospace, Menlo, monospace; font-weight:600; unicode-bidi:plaintext; }
  .ev-d { font-size:var(--font-size-caption); color:var(--color-warn); margin-top:var(--space-8); }
  .ev-p { font:var(--font-size-caption)/1.5 "SF Mono", ui-monospace, Menlo, monospace; color:var(--color-ink-secondary); margin:var(--space-8) 0 0; overflow-x:auto; unicode-bidi:plaintext; direction:ltr; text-align:start; }
  .pr { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; padding:12px 0; border-bottom:1px solid var(--color-paper); }
  .pr:last-child { border-bottom:0; }
  .pr .mk { font-size:var(--font-size-base); font-weight:700; }
  .pr.done .mk { color:var(--color-ok); }
  .pr.todo .mk { color:var(--color-ink-secondary); }
  .pr.unknown .mk { color:var(--color-ink-secondary); }
  .pr-note { flex-basis:100%; font-size:var(--font-size-caption); color:var(--color-ink-secondary); padding-inline-start:var(--space-24); }
  .help-links { margin:var(--space-8) 0 0; padding-inline-start:18px; font-size:var(--font-size-small); }
  .pr .lbl { font-size:var(--font-size-small); }
  .pr-b { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; margin-inline-start:auto; }
  .badge { font-size:var(--font-size-caption); padding:3px 10px; border-radius:999px; }
  .badge.sys { background:var(--color-ok-wash); color:var(--color-ok); }
  .badge.owner { background:var(--color-paper); color:var(--color-ink); font-weight:600; }
  .verdict { margin-top:var(--space-16); padding:14px; border-radius:12px; background:var(--color-surface); border:1px solid var(--color-border); text-align:center; font-weight:600; }
  .verdict.ok { background:var(--color-ok-wash); color:var(--color-ok); border-color:var(--color-ok-line); }

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
  a.gap { display:grid; grid-template-columns:1fr auto; gap:var(--space-4) var(--space-12); background:var(--color-paper); border:1px solid var(--color-border); border-radius:12px; padding:14px 16px; }
  a.gap:hover, a.gap:focus-visible { border-color:var(--color-ink-secondary); }
  .gq { font-size:var(--font-size-small); color:var(--color-ink); }
  .gmeta { font-size:var(--font-size-caption); grid-column:1; }
  .gact { grid-row:1 / span 2; align-self:center; color:var(--color-ink); font-size:var(--font-size-small); white-space:nowrap; }
  @media (max-width:560px) { a.gap { grid-template-columns:1fr; } .gact { grid-row:auto; text-align:start; } }
  .emp-h { display:flex; align-items:center; gap:var(--space-12); }
  .emp-name { font-size:var(--font-size-title); font-weight:700; }
  .dgroup { margin-bottom:var(--space-16); }
  .dtitle { font-weight:600; margin-bottom:var(--space-8); }
  .ditem { padding:8px 12px; border-radius:8px; margin-bottom:var(--space-8); font-size:var(--font-size-small); background:var(--color-paper); border:1px solid var(--color-border); }
  .ditem.ok { color:var(--color-ok); }
  .ditem.warn { color:var(--color-waiting); }
  .ditem.no { color:var(--color-ink-secondary); }
  .growth { list-style:none; padding:0; margin:0; }
  .growth li { padding:9px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .growth li:last-child { border-bottom:none; }
  .pstage { margin:var(--space-8) 0; font-size:var(--font-size-small); }
  .conds { margin-top:var(--space-12); display:flex; flex-direction:column; gap:var(--space-8); }
  .cond { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .cond.met { color:var(--color-ok); }
  .actrow { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .actrow:last-of-type { border-bottom:none; }

  /* ── factory.ts — moved here whole in step four: page-specific names, defined once. */
  .lede { color:var(--color-ink-secondary); margin:0 0 var(--space-24); font-size:var(--font-size-small); max-width:var(--measure-prose); }
  /* The next step is a door, not a checklist row. It vanishes when done. */
  /* M49 — the next step is an ACTION, not a state. Filled in jade it was the loudest object on a page about somebody's factory, and it competed with the two lines that actually report how her business stands. A raised sheet says "start here" without spending the one colour that means something. */
  /* Sections are grouped decisions, not settings panels. */
  .fblock { border-top:1px solid var(--color-border); padding:var(--space-24) 0; }
  .fblock:first-of-type { border-top:0; padding-top:0; }
  .fhead { margin-bottom:var(--space-12); }
  .fhead h2 { margin:0; font-size:var(--font-size-base); font-weight:600; color:var(--color-ink); }
  .fq { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fname { font-size:var(--font-size-title); font-weight:600; color:var(--color-ink); }
  .fdesc { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:var(--space-8) 0 0; max-width:var(--measure-prose); }
  .fdesc-lead { margin:0 0 var(--space-12); }
  .fempty { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:0; max-width:var(--measure-prose); }
  .fval { color:var(--color-ink); }
  /* A product tally is never the loudest thing an owner reads. */
  .fcount { font-size:var(--font-size-title); font-weight:600; color:var(--color-ink); display:flex; align-items:baseline; gap:var(--space-8); font-variant-numeric:tabular-nums; }
  .fcount-l { font-size:var(--font-size-small); font-weight:400; color:var(--color-ink-secondary); }
  .fnames { color:var(--color-ink-secondary); font-size:var(--font-size-small); line-height:1.6; margin:var(--space-8) 0 0; }
  .fwarn { color:var(--color-waiting); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fok { color:var(--color-ink); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fchips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .fchip { font-size:var(--font-size-caption); padding:6px 13px; border-radius:999px; background:var(--color-paper); color:var(--color-ink); border:1px solid var(--color-border); }
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
  .alform { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-16); max-width:var(--measure-form); }
  .alform .fld { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); }
  .alform input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .rm { margin-inline-start:var(--space-8); }
  /* M49 — a link is ink; jade is spent on sending and on state. */
  .blink { color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  .fconn { display:flex; align-items:center; gap:var(--space-12); }
  .fconn-t { font-size:var(--font-size-small); color:var(--color-ink); }
  .fconn-s { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fconn-h { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .fconn-i { font-size:var(--font-size-title); }
  .fconn.on .fconn-s { color:var(--color-ok); }
  /* Not connected stops everything, so it looks like it and links to the fix. */
  .fconn.off { background:var(--color-waiting-wash); border:1px solid var(--color-waiting-line); border-radius:14px; padding:14px 16px; }
  .fconn.off:hover, .fconn.off:focus-visible { border-color:var(--color-waiting); }
  .fconn.off .fconn-s { color:var(--color-waiting); }
  .fconn.off .go { margin-inline-start:auto; }
  .fblock .deeper { margin-top:var(--space-8); }

  /* ── products.ts — moved here whole in step four: page-specific names, defined once. */
  .pq input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
  .pcheck { display:flex; align-items:center; gap:var(--space-8); font-size:var(--font-size-small); color:var(--color-ink); min-height:44px; }
  .phead { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
  /* Products are a dense list (decision 2), not a card each. */
  .prod { display:block; padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); color:inherit; }
  .prod:last-child { border-bottom:0; }
  .prod-h { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .prod-b { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .p-tag { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin-top:var(--space-8); }
  .p-tag.big { color:var(--color-ok); font-size:var(--font-size-small); margin-bottom:var(--space-12); }
  .info, .tiers { display:flex; flex-direction:column; gap:var(--space-8); font-size:var(--font-size-small); }
  .tier { display:flex; justify-content:space-between; background:var(--color-paper); border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; }
  .imgs { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .imgs img { width:96px; height:96px; object-fit:cover; border-radius:10px; border:1px solid var(--color-border); }
  .qrow { font-size:var(--font-size-caption); padding:6px 0; border-bottom:1px solid var(--color-border); }
  .qrow:last-child { border-bottom:none; }
  .rev { display:flex; align-items:center; gap:var(--space-8); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); flex-wrap:wrap; }
  .rev:last-child { border-bottom:none; }
  .rev-src { flex-basis:100%; font-size:var(--font-size-caption); }
  .rev-move { flex-basis:100%; }
  .photo-in { display:block; width:100%; margin:var(--space-12) 0; font:inherit; color:var(--color-ink); min-height:44px; }
  textarea { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:12px; font:inherit; resize:vertical; margin:var(--space-12) 0; }
  @media (max-width:560px) { .imgs img { width:72px; height:72px; } }
  /* The import review: the photos beside the rows from a wide screen, above them on a phone. */
  .imp { display:block; }
  .imp.with-photos { display:grid; gap:var(--space-16); }
  @media (min-width:1100px) { .imp.with-photos { grid-template-columns:minmax(0, 2fr) minmax(0, 3fr); align-items:start; }
    .imp-photos { position:sticky; top:var(--space-16); } }
  .imp-photo { margin:0 0 var(--space-16); }
  .imp-photo img { display:block; width:100%; height:auto; border:1px solid var(--color-border); border-radius:10px; background:var(--color-paper); }
  .imp-photo figcaption { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin-top:var(--space-4); }
  .imp-row { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .imp-row:last-child { border-bottom:0; }
  .imp-row.need { border-inline-start:3px solid var(--color-waiting); padding-inline-start:var(--space-12); }
  .imp-row.out { opacity:0.6; }
  .imp-h { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .imp-warn { display:block; color:var(--color-waiting); font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .imp-typed, .imp-q { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); margin-top:var(--space-8); }
  .imp-typed input, .imp-pct input, .imp-edit input, .imp-edit select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; min-height:44px; }
  .imp-typed input, .imp-pct input { width:8em; }
  .imp-edit { margin-top:var(--space-8); }
  .imp-edit summary { cursor:pointer; color:var(--color-ink-secondary); min-height:44px; display:flex; align-items:center; }
  .imp-edit label { display:flex; flex-direction:column; gap:var(--space-4); margin:var(--space-8) 0; }
  .imp-edit label.pcheck { flex-direction:row; }
  .imp-acts { display:flex; flex-wrap:wrap; gap:var(--space-12); align-items:center; margin:var(--space-16) 0; }
  .imp-floor { align-items:flex-start; padding:var(--space-8) 0; border-bottom:1px solid var(--color-border); }
  /* A store's table, a few rows of it, scrolling sideways inside its own box on a phone. */
  .imp-table { overflow-x:auto; margin:var(--space-12) 0; border:1px solid var(--color-border); border-radius:10px; }
  .imp-table table { border-collapse:collapse; font-size:var(--font-size-caption); min-width:100%; }
  .imp-table th, .imp-table td { padding:6px 10px; border-bottom:1px solid var(--color-border); text-align:start; white-space:nowrap; }
  .imp-cols label { display:flex; flex-direction:column; gap:var(--space-4); margin:var(--space-12) 0; }
  .imp-cols label.pcheck { flex-direction:row; }
  .imp-cols select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; min-height:44px; }

  /* ── channels.ts — moved here whole in step four: page-specific names, defined once. */
  .reach .reqs, .reach .instead ul { list-style:none; margin:var(--space-8) 0 0; padding:0; }
  .reach .reqs li, .reach .instead li { padding:var(--space-4) 0; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
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
  .ch-info { display:flex; flex-direction:column; gap:var(--space-4); background:var(--color-paper); border:1px solid var(--color-border); border-radius:10px; padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); }
  .ch-acts { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .prob { background:var(--color-waiting-wash); color:var(--color-waiting); border-radius:10px; padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); line-height:1.6; }
  .prob.bad { background:var(--color-warn-wash); color:var(--color-warn); }
  .ownerform { display:flex; flex-direction:column; gap:var(--space-4); margin-bottom:var(--space-8); }
  .ownerform input { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .soon { display:flex; flex-wrap:wrap; gap:var(--space-8); margin-bottom:var(--space-12); }
  .soon-chip { background:var(--color-paper); border:1px solid var(--color-border); border-radius:999px; padding:6px 14px; color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .guide { padding-inline-start:20px; line-height:2; }
  .guide li { margin-bottom:var(--space-4); }

  /* ── knowledge.ts — moved here whole in step four: page-specific names, defined once. */
  /* The two scopes sit side by side, so each says which one it is. */
  /* A scope caption explains; it is not a state, so it gets no colour. */
  .scope { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-4) 0 var(--space-12); }
  .klist { display:flex; flex-direction:column; gap:var(--space-8); }
  .krow { display:flex; justify-content:space-between; background:var(--color-paper); border:1px solid var(--color-border); border-radius:10px; padding:12px 16px; }
  .krow:hover { border-color:var(--color-border); }
  .kitem { border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:var(--space-12); }
  .kh { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .kh .src { margin-inline-start:auto; font-size:var(--font-size-caption); }
  .kc { margin:var(--space-8) 0; white-space:pre-wrap; }
  .teach, .krow-actions { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
  .teach h3 { margin:0; font-size:var(--font-size-small); }
  input[type=text], textarea, select { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; }
  .kbtns { display:flex; gap:var(--space-8); }
  .certs { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cert { padding:8px 14px; border-radius:999px; border:1px solid var(--color-border); background:var(--color-paper); color:var(--color-ink-secondary); cursor:pointer; font-size:var(--font-size-caption); }
  .cert.on { background:var(--color-ok-wash); color:var(--color-ok); border-color:var(--color-ok-line); }

  /* ── knowledge-insights.ts — moved here whole in step four: page-specific names, defined once. */
  h3.sub { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .reqs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); }
  .reqs .q { color:var(--color-ink); }
  .gap { border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:var(--space-12); }
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

  /* ── calendar.ts — V2: a read-only list of dated rows under day headings. The kind of each row is the row's neutral tag: a kind is not a state. */
  .cal-tabs { flex-wrap:wrap; }
  .cal-buyer { margin-bottom:var(--space-12); }
  .cal-span { margin:var(--space-8) 0 0; color:var(--color-ink-secondary); }
  .cal-day { margin:var(--space-24) 0 0; }
  .cal-when { flex:none; min-width:4.5em; color:var(--color-ink-secondary); font-size:var(--font-size-caption); font-variant-numeric:tabular-nums; }
  .cal-go { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); min-height:44px; color:inherit; }
  .cal-go:hover .go, .cal-go:focus-visible .go { color:var(--color-ink); }
  .cal-head { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); }
  .cal-kind { color:var(--color-ink); font-weight:500; }
  /* The design pass: the week. Days are columns and hours rows; where a date
     came from is its EDGE — solid, from a conversation; dashed, put there by
     the owner — and colour is left for state. Past dates in Stone. */
  .cal-top { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8) var(--space-16); flex-wrap:wrap; }
  .cal-top h1.page { margin:0; }
  .cal-views { margin:0; }
  .cal-move { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; margin:var(--space-12) 0; }
  .cal-move .back, .cal-move .deeper { min-width:44px; justify-content:center; }
  .cal-today { display:inline-flex; align-items:center; min-height:44px; padding:0 var(--space-12); font-weight:600; font-size:var(--font-size-small); }
  .cal-move .cal-span { margin:0 var(--space-8); }
  .cal-legend { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; color:var(--color-ink-secondary); margin:var(--space-8) 0; }
  .cal-legend .wk-e { display:inline-block; width:var(--space-24); min-height:var(--space-16); padding:0; margin:0; }
  /* Phase 7 — a grid wider than the screen SAYS so: a shade at each edge that
     has more beyond it (it goes when that edge is reached), and a thin bar. */
  .wk-scroll { overflow-x:auto; margin:var(--space-12) 0; scrollbar-width:thin; scrollbar-color:var(--color-ink-secondary) transparent;
    overscroll-behavior-x:contain; background-color:var(--color-surface);
    background-image:linear-gradient(to right, var(--color-surface), transparent), linear-gradient(to left, var(--color-surface), transparent),
      linear-gradient(to right, var(--color-ink-secondary), transparent), linear-gradient(to left, var(--color-ink-secondary), transparent);
    background-position:left center, right center, left center, right center;
    background-size:var(--space-32) auto, var(--space-32) auto, var(--space-8) auto, var(--space-8) auto;
    background-repeat:no-repeat; background-attachment:local, local, scroll, scroll; }
  /* Phase 7 — columns wide enough for a whole surname (a name wraps between words, never inside one). */
  .wk, .mo { width:100%; min-width:780px; border-collapse:collapse; table-layout:fixed; background:transparent; }
  /* The hours stay in view while the days scroll past them. */
  .wk tbody th, .wk .wk-corner { position:sticky; inset-inline-start:0; z-index:1; background:var(--color-surface); }
  .wk th, .wk td, .mo th, .mo td { border:1px solid var(--color-border); vertical-align:top; padding:var(--space-4); }
  .wk thead th, .mo thead th { font-size:var(--font-size-caption); font-weight:400; color:var(--color-ink-secondary); text-align:start; padding:var(--space-8); }
  .wk thead th b { color:var(--color-ink); font-weight:600; }
  .wk thead th.today { box-shadow:inset 0 -2px 0 var(--color-ink); }
  .wk tbody th { width:3.5em; font-size:var(--font-size-caption); font-weight:400; color:var(--color-ink-secondary); text-align:end; font-variant-numeric:tabular-nums; }
  .wk .wk-corner { width:3.5em; }
  .wk td { height:2.75em; }
  .wk-e { display:flex; flex-direction:column; gap:0; margin-bottom:var(--space-4); padding:var(--space-4) var(--space-8);
    border:1px solid var(--color-ink-secondary); border-inline-start-width:3px; border-radius:6px;
    background:var(--color-surface); color:var(--color-ink); font-size:var(--font-size-caption); line-height:1.35; }
  .wk-e.solid { border-style:solid; }
  .wk-e.dashed { border-style:dashed; }
  .wk-e.past { color:var(--color-ink-secondary); border-color:var(--color-border); }
  /* Phase 7 — a name is never cut: it wraps (a Latin name inside Arabic too, isolated by its bdi). */
  .wk-e b { font-weight:600; overflow-wrap:break-word; }
  .wk-k, .wk-t { overflow-wrap:break-word; }
  .wk-t { font-variant-numeric:tabular-nums; color:var(--color-ink-secondary); }
  a.wk-e:hover, a.wk-e:focus-visible { background:var(--color-paper); }
  .cal-rm { margin:var(--space-4) 0 0; }
  .cal-rm .btn { min-height:32px; padding:0; font-size:var(--font-size-caption); }
  .row.dashed .grow { border-inline-start:2px dashed var(--color-ink-secondary); padding-inline-start:var(--space-8); }
  .mo td { height:7em; }
  .mo td.other { background:var(--color-paper); }
  .mo td.today .mo-d { box-shadow:inset 0 -2px 0 var(--color-ink); font-weight:600; }
  .mo-d { display:inline-flex; min-width:1.75em; min-height:1.75em; align-items:center; justify-content:center;
    font-size:var(--font-size-caption); font-variant-numeric:tabular-nums; margin-bottom:var(--space-4); }
  .mo-more { display:block; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .cal-add { margin:var(--space-16) 0; }
  .cal-add summary { cursor:pointer; font-weight:600; font-size:var(--font-size-small); min-height:44px; display:flex; align-items:center; gap:var(--space-8); }
  .cal-times { display:flex; gap:var(--space-12); flex-wrap:wrap; }
  /* Phase 7 — the day as ONE list in time order: the hour, the kind's icon, the name whole, what it is. */
  .dl { list-style:none; margin:var(--space-12) 0; padding:0; background:var(--color-surface);
    border:1px solid var(--color-border); border-radius:var(--radius-card); max-width:var(--measure-prose); }
  .dl-row { display:flex; align-items:flex-start; gap:var(--space-12); padding:var(--space-12); border-top:1px solid var(--color-border); }
  .dl-row:first-child { border-top:0; }
  .dl-hour { flex:none; min-width:4.5em; font-size:var(--font-size-small); font-variant-numeric:tabular-nums; }
  .dl-row .kind-icon { flex:none; margin-top:var(--space-4); color:var(--color-ink-secondary); }
  .dl-go { flex:1; min-width:0; display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); color:inherit; text-decoration:none; }
  .dl-body { display:flex; flex-direction:column; gap:var(--space-4); min-width:0; }
  .dl-body b { font-weight:600; overflow-wrap:break-word; }
  .dl-row.dashed .dl-go { border-inline-start:2px dashed var(--color-ink-secondary); padding-inline-start:var(--space-8); }
  /* Done is greyed, never hidden. */
  .dl-row.done { color:var(--color-ink-secondary); }
  .dl-row.done .dl-body b { font-weight:400; }

  /* ── inbox.ts — Buyers (one list since A) and the conversation page; moved in at the V1 close-out. */
  /* The search: the field takes the room, its button and the way back beside it. */
  .search { display:flex; align-items:center; gap:var(--space-8); margin:0 0 var(--space-16); max-width:var(--measure-prose); }
  .search input { flex:1; min-width:0; appearance:none; }
  .search .clear { display:inline-flex; align-items:center; min-height:44px; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
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
  /* A customer still waiting for an answer: full ink, as the transcript writes whose words lead. */
  .crow.unanswered .cr-text { color:var(--color-ink); }
  .cr-why { grid-row:2; grid-column:3; justify-self:end; min-width:0; max-width:100%; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .is-needs .cr-why { color:var(--color-waiting); font-weight:600; }
  @media (max-width: 720px) {
    .cr-detail { display:none; }
  }
  .dhead .who { font-size:var(--font-size-small); }
  /* CC-20 — on the conversation, the buyer's and the product's page, the name
     in the header is the page's title (an h1), drawn the size it always was. */
  .dhead h1.who { margin:0; font-weight:400; }
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
  #approve .und { display:flex; gap:var(--space-4) var(--space-12); flex-wrap:wrap; margin:0; font-size:var(--font-size-small); }
  #approve .k { color:var(--color-ink-secondary); }
  #approve details { font-size:var(--font-size-small); border-top:1px solid var(--color-border); padding-top:var(--space-4); }
  #approve summary { display:flex; flex-wrap:wrap; gap:var(--space-4) var(--space-8); cursor:pointer; min-height:44px; align-items:center; }
  #approve summary .c { margin-inline-start:auto; color:var(--color-ink-secondary); }
  #approve summary .c.warn { color:var(--color-waiting); font-weight:600; }
  #approve details .und { margin:var(--space-4) 0 0; }
  .reasons { list-style:none; margin:var(--space-8) 0 0; padding:var(--space-8) var(--space-12); display:grid; gap:var(--space-4);
    background:var(--color-paper); border-radius:6px; }
  .reasons li { display:grid; grid-template-columns:1.2em minmax(6em, max-content) 1fr; gap:var(--space-8); align-items:baseline; }
  .reasons .mk.warn { color:var(--color-waiting); }
  .approve { display:flex; flex-direction:column; gap:var(--space-8); }
  .approve textarea { font-family:var(--font-voice); font-size:var(--font-size-base); color:var(--color-ink);
    background:var(--color-surface); border:1.5px solid var(--color-ink); border-radius:6px; padding:10px 14px;
    width:100%; min-height:4.5em; max-height:50vh; resize:vertical; margin:0; field-sizing:content; }
  .approve .acts { align-items:center; margin:0; }
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
  .listpane .tabs { padding:0 var(--space-16); flex-wrap:wrap; }
  .tab-n { margin-inline-start:var(--space-4); font-variant-numeric:tabular-nums; color:var(--color-ink-secondary); }
  .listpane .crows { margin:var(--space-8) 0; background:none; border:0; border-radius:0; }
  .listpane a.crow { padding-inline:var(--space-12) var(--space-16); }
  .listpane a.crow:hover, .listpane a.crow:focus-visible, .listpane a.crow.on { background:var(--color-surface); }
  .listpane .crows > li.lp-group, .listpane .crows > li.lp-group + li { border-top:0; }
  /* Beside a conversation the group heading says why; the narrow column keeps the name and the message. */
  .listpane .cr-why { display:none; }
  .lp-group { padding:var(--space-12) var(--space-16) var(--space-4); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .lp-empty { padding:var(--space-8) var(--space-16); }
  .listpane .search, .listpane .deeper { margin:var(--space-16); }
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
  .handto { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8);
    margin-top:var(--space-12); font-size:var(--font-size-small); }
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
  .prow, .cx { max-width:var(--measure-prose); border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .prow { display:flex; justify-content:space-between; gap:var(--space-12); padding:var(--space-8) 0; }
  .cx { display:flex; gap:var(--space-12); padding:var(--space-8) 0; }
  .prow:last-child, .cx:last-child { border-bottom:0; }
  .cx-l { color:var(--color-ink-secondary); min-width:72px; }
  /* The history: a line down the reading edge, each kind told by its mark, not by a colour. */
  .tl { list-style:none; padding:0; margin:0; max-width:var(--measure-prose); }
  .tl li { display:flex; gap:var(--space-12); position:relative; padding:10px 0; padding-inline-start:16px;
    margin-inline-start:var(--space-8); border-inline-start:2px solid var(--color-border); }
  .tl li .ic { position:absolute; inset-inline-start:-11px; top:9px; background:var(--color-paper);
    display:inline-flex; justify-content:center; width:20px; font-size:var(--font-size-small); line-height:1; }
  .tl .tx { font-size:var(--font-size-small); }

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
  .pcases { list-style:none; margin:0; padding:0; }
  .pcase { display:flex; gap:var(--space-8); padding:7px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .pcase:last-child { border-bottom:0; }
  .pcase.ok .pmark { color:var(--color-ok); }
  .pcase.bad .pmark { color:var(--color-warn); }
  .ptitle { color:var(--color-ink-secondary); }
  .pproves { margin:var(--space-12) 0 0; max-width:var(--measure-prose); line-height:1.6; }
  .sbx-banner { background:var(--color-paper); color:var(--color-ink); border:1px solid var(--color-border); border-radius:12px; padding:12px 16px; font-weight:600; font-size:var(--font-size-small); margin:var(--space-8) 0 var(--space-12); }
  .sbx-intro { margin:0 0 var(--space-16); }
  .sbx-compose { display:flex; flex-direction:column; gap:var(--space-12); }
  .sbx-mode { display:flex; flex-direction:column; align-items:flex-start; gap:var(--space-8); }
  .sbx-checklist .chk.gap .mk { color:var(--color-ink-secondary); }
  .modebar { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; font-size:var(--font-size-small); }
  .radio { display:inline-flex; align-items:center; gap:var(--space-4); cursor:pointer; }
  .radio.off { opacity:.5; cursor:not-allowed; }
  .scenariobar { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  select { background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; max-width:100%; }
  .msgbar { display:flex; flex-direction:column; gap:var(--space-8); }
  .msgacts { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); flex-wrap:wrap; }
  textarea { width:100%; background:var(--color-surface); border:1px solid var(--color-ink-secondary); border-radius:10px; color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  .sbx-trust { border-color:var(--color-waiting-line); }
  .sbx-trust.pass { border-color:var(--color-ok-line); }
  .sbx-trust.fail { border-color:var(--color-warn-line); }
  .sbx-trust .verdict { font-weight:700; text-transform:none; letter-spacing:0; }
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
  h1 { font-size:var(--font-size-title); line-height:1.25; margin:0 0 var(--space-12); font-weight:600; }
  h2 { font-size:inherit; font-weight:600; margin:var(--space-32) 0 var(--space-8); }
  p, li { margin:0 0 var(--space-12); color:var(--color-ink-secondary); }
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
  const setup = setupState();
  const link = (n: typeof NAV[number]) => {
    const on = n.id === here;
    // A5 — the entry for the assistants is the assistant's NAME while there is
    // one, and "Team" once there are several. A menu item that reads as a
    // person is the right label for a business with one assistant and the
    // wrong one for a business with four, and `nav.employee` is literally
    // `{name}`.
    const label = n.id === 'employee' && assistantsAreSeveral()
      ? t(locale, 'nav.team')
      : t(locale, `nav.${n.id}` as MessageKey);
    // D — while setup is incomplete, Setup carries the count: "3/5". A count,
    // not a colour — nothing here is wrong, it is simply not finished. It
    // disappears when the last step is done, and the entry stays.
    const count = n.id === 'settings' && setup && setup.next !== null ? setup : null;
    const badge = count ? `<span class="navcount" aria-hidden="true">${esc(isolate(locale, `${count.done}/${count.total}`))}</span>` : '';
    const aria = count
      ? ` aria-label="${esc(label)}, ${esc(t(locale, 'nav.setup.progress', { done: count.done, total: count.total }))}"`
      : '';
    // PHASE 7 OF THE UI REBUILD (2026-10-02) — on a phone the five entries
    // share ONE line, and none breaks in two: "Your assistant" (while it has no
    // name) and "My business" have a shorter phone form. The stylesheet shows
    // one of the two; a screen reader hears only the one shown.
    const short = n.id === 'factory' ? t(locale, 'nav.short.factory')
      : n.id === 'employee' && !assistantsAreSeveral() && label.toLocaleLowerCase() === ASSISTANT_FALLBACK[locale].toLocaleLowerCase()
        ? t(locale, 'nav.short.employee') : null;
    const text = short && short !== label ? `<span class="nl-long">${esc(label)}</span><span class="nl-short">${esc(short)}</span>` : esc(label);
    // A11y — `aria-current="page"` is what tells a screen reader which of five
    // identical links is the one you are on. The class is for everyone else.
    return `<a href="${n.href}" class="navlink ${on ? 'active' : ''}"${on ? ' aria-current="page"' : ''}${aria}
       >${text}${badge}</a>`;
  };
  const byId = (id: string) => NAV.find((n) => n.id === id)!;
  /**
   * THE RAIL HAS GROUPS (the design pass, 2026-09-29; the plan's §2). The work
   * — Today, and the customers: their conversations and the calendar; then
   * what is the owner's — the assistant and the business; Setup and Log out at
   * the foot. Still five entries (D's rule): on a phone they are the one row,
   * and "Customers" is its entry; on a wide screen "Customers" heads its two
   * pages, and Conversations carries the one number in the rail — how many
   * customers need the owner now. Log out is a button: it changes something.
   */
  const url = (input.path.split('?')[0] ?? input.path).replace(/\/+$/, '') || '/app';
  const inConversations = url === '/app/inbox' || url.startsWith('/app/inbox/') || url.startsWith(`${MERGED_INTO_BUYERS}/`);
  const inCalendar = url === '/app/calendar';
  const needs = needsYouCount();
  const sub = (href: string, key: MessageKey, on: boolean, count: number | null) =>
    `<a href="${href}" class="subnav${on ? ' active' : ''}"${on ? ' aria-current="page"' : ''}${
      count ? ` aria-label="${esc(t(locale, key))}, ${esc(tn(locale, 'nav.needsYou', count))}"` : ''}>${esc(t(locale, key))}${
      count ? `<span class="navcount" aria-hidden="true">${esc(isolate(locale, String(count)))}</span>` : ''}</a>`;
  const nav = `<div class="navgroup">${link(byId('home'))}${link(byId('inbox'))}
      <div class="navhub" role="group" aria-labelledby="nav-customers">
        <span class="navhead" id="nav-customers">${esc(t(locale, 'nav.customers'))}</span>
        ${sub('/app/inbox', 'nav.conversations', inConversations, needs && needs > 0 ? needs : null)}
        ${sub('/app/calendar', 'nav.calendar', inCalendar, null)}
      </div></div>
    <div class="navgroup">${link(byId('employee'))}${link(byId('factory'))}</div>
    <div class="navfoot">${link(byId('settings'))}
      <form method="post" action="/logout" class="navout"><button type="submit" class="subnav">${esc(t(locale, 'header.logout'))}</button></form>
    </div>`;
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
  const home = ((input.path.split('?')[0] ?? input.path).replace(/\/+$/, '') || '/app') === '/app';
  const heading = business && home ? `<p class="business-name"><bdi>${esc(business)}</bdi></p>` : '';
  // Phase 9 (V1-003) — the tab names the PAGE: its own heading when it has one
  // (an account page, a closure list, an order, a product), the area's name
  // only where the page has none. Every Setup page was "Setup · …".
  const ownHeading = /<h1 class="page"[^>]*>([\s\S]*?)<\/h1>/.exec(input.bodyHtml)?.[1];
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
    <main id="main"${input.wide ? ' class="wide"' : ''}>${heading}${placeLive(input.bodyHtml, input.live ?? '')}</main>
  </div>
</div>${askDialog(locale)}</body></html>`;
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
  .login .brand { font-weight:700; font-size:var(--font-size-title); margin-bottom:var(--space-8); padding:0; }
  .login h1 { font-size:var(--font-size-base); margin:0 0 var(--space-8); }
  .login .lead { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:0 0 var(--space-16); }
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
  .err { color:var(--color-warn); font-size:var(--font-size-caption); margin-bottom:var(--space-8); }
  .fld-err { color:var(--color-warn); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
${markBefore('failed', ['.err', '.fld-err'])}
  .hint { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
  label { color:var(--color-ink-secondary); font-size:var(--font-size-caption); display:block; }
  details { margin-top:var(--space-24); border-top:1px solid var(--color-border); padding-top:var(--space-16); }
  summary { cursor:pointer; color:var(--color-ink-secondary); font-size:var(--font-size-caption); min-height:44px; display:flex; align-items:center; }
  details form { margin-top:var(--space-8); }
  .login .other { text-align:center; margin:var(--space-16) 0 0; font-size:var(--font-size-caption); }
  .login .other.small { margin-top:var(--space-8); }
  .login .other.small a { color:var(--color-ink-secondary); }
  .login .foot { text-align:center; font-size:var(--font-size-caption); }
  .forgot { margin:var(--space-8) 0 0; font-size:var(--font-size-caption); }
`;

/** The door's sheet: the base rules and the door's own — never the pages' sections. */
const DOOR_SHEET = sheet('door', STYLE + DOOR_STYLE);

/**
 * CC-20 — every door page has one heading. Sign-up, the code and the error
 * pages carry theirs in the card; the sign-in page has none there, so its
 * brand line is its heading (`brandIsTitle`), drawn exactly as before.
 */
const doorFrame = (locale: Locale, path: string, title: string, card: string, other: string, brandIsTitle = false): string => `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi · ${esc(title)}</title>
<link rel="icon" href="${faviconDataUri()}">
${linkTo(DOOR_SHEET)}
${typeLink(locale)}</head>
<body><div class="login">
  <div class="top-sw">${switcher(locale, path)}</div>
  <${brandIsTitle ? 'h1' : 'div'} class="brand">Nomi<small class="muted">${esc(t(locale, 'login.brandTagline'))}</small></${brandIsTitle ? 'h1' : 'div'}>
  <div class="card">${card}</div>
  ${other}
  <p class="muted foot">${esc(t(locale, 'login.footer'))}</p>
</div></body></html>`;

export type LoginProblem = 'code' | 'password' | 'locked' | 'slow';

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
  // THE DESIGN PASS (UI-PASS 10): the door leads with the e-mail. The access
  // code is for the pilot's owner and staff codes; most owners never need it,
  // so it is no longer a question on the page but a small door at its foot,
  // to a card of its own — and a door back.
  const codeCard = `
    ${problem === 'code' ? `<div class="err" role="alert">${esc(sentence ?? '')}</div>` : ''}
    <form method="post" action="/login">
      <label for="login-code">${esc(t(locale, 'login.passwordLabel'))}</label>
      <input id="login-code" type="password" name="code" required autocomplete="off" autofocus />
      <button type="submit">${esc(t(locale, 'login.codeSubmit'))}</button>
    </form>`;
  const card = codeMode ? codeCard : `
    ${input.notice ? `<div class="hint" role="status">${esc(input.notice)}</div>` : ''}
    ${sentence ? `<div class="err" role="alert">${esc(sentence)}</div>` : ''}
    <form method="post" action="/login">
      <label for="login-email">${esc(t(locale, 'login.emailLabel'))}</label>
      <input id="login-email" type="email" name="email" value="${esc(input.email ?? '')}" required
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" autofocus />
      <label for="login-password">${esc(t(locale, 'login.secretLabel'))}</label>
      <input id="login-password" type="password" name="password" required autocomplete="current-password" />
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>
    ${input.recoveryOn ? `<p class="forgot"><a href="/login/forgot">${esc(t(locale, 'login.forgot'))}</a></p>` : ''}`;
  const other = [
    input.signupOpen === false || codeMode ? '' : `<p class="other"><a href="/signup">${esc(t(locale, 'login.toSignup'))}</a></p>`,
    codeMode
      ? `<p class="other"><a href="/login">${esc(t(locale, 'login.withEmail'))}</a></p>`
      : `<p class="other small"><a href="/login?with=code">${esc(t(locale, 'login.codeToggle'))}</a></p>`,
  ].join('');
  return doorFrame(locale, input.path, t(locale, 'login.title'), card, other, true);
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
  const fieldErr = (k: keyof typeof p): string => (p[k] ? `<div class="fld-err" role="alert">${esc(p[k]!)}</div>` : '');
  const invite = input.mode === 'invite' ? `
      <label for="su-invite">${esc(t(locale, 'signup.invite'))}</label>
      <input id="su-invite" type="text" name="invite" value="${esc(v.invite ?? '')}" required autocomplete="off" autocapitalize="none" spellcheck="false" />
      ${fieldErr('invite') || `<div class="hint">${esc(t(locale, 'signup.inviteHint'))}</div>`}` : '';
  // A2 — about the business. Every answer but two is a choice from a list.
  const option = (value: string, label: string, chosen: string | undefined): string =>
    `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const pick = `<option value="">${esc(t(locale, 'signup.pick'))}</option>`;
  const used = new Set(v.channels ?? []);
  const about = `
      <h2>${esc(t(locale, 'signup.about'))}</h2>
      <label for="su-factory">${esc(t(locale, 'signup.factory'))}</label>
      <input id="su-factory" type="text" name="factory" value="${esc(v.factory ?? '')}" required maxlength="120" autocomplete="organization" autofocus />
      ${fieldErr('factory')}
      <label for="su-kind">${esc(t(locale, 'signup.kind'))}</label>
      <select id="su-kind" name="kind" required>${pick}${BUSINESS_KINDS.map((k) =>
        option(k, t(locale, `business.kind.${k}` as MessageKey), v.kind)).join('')}</select>
      ${fieldErr('kind')}
      <label for="su-sells">${esc(t(locale, 'signup.sells'))}</label>
      <input id="su-sells" type="text" name="sells" value="${esc(v.sells ?? '')}" required maxlength="300"
        placeholder="${esc(t(locale, 'signup.sells.placeholder'))}" />
      ${fieldErr('sells')}
      <label for="su-country">${esc(t(locale, 'signup.country'))}</label>
      <select id="su-country" name="country" required autocomplete="country">${pick}${countryOptions(locale).map((c) =>
        option(c.code, c.name, v.country)).join('')}</select>
      ${fieldErr('country')}
      ${/* TZ — asked only where the country has several zones; a country with one gets it. */
        zoneChoices(v.country).length > 1 ? `
      <label for="su-zone">${esc(t(locale, 'signup.zone'))}</label>
      <select id="su-zone" name="zone" required>${pick}${zoneChoices(v.country).map((z) =>
        option(z, zoneLabel(locale, z), v.zone)).join('')}</select>
      ${fieldErr('zone')}` : ''}
      ${/* CUR — asked only where the country's own money is not on the list; a country whose is sells in it. */
        asksCurrency(v.country) ? `
      <label for="su-currency">${esc(t(locale, 'signup.currency'))}</label>
      <select id="su-currency" name="currency" required>${pick}${CURRENCY_CHOICES.map((c) =>
        option(c, currencyLabel(locale, c), v.currency)).join('')}</select>
      ${fieldErr('currency')}` : ''}
      <label for="su-website">${esc(t(locale, 'signup.website'))}</label>
      <input id="su-website" type="text" name="website" value="${esc(v.website ?? '')}" maxlength="200"
        inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="url" placeholder="yourbusiness.com" />
      ${fieldErr('website')}
      <label for="su-team">${esc(t(locale, 'signup.teamSize'))}</label>
      <select id="su-team" name="teamSize" required>${pick}${TEAM_SIZES.map((s) =>
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
    <form method="post" action="/signup">
      ${about}
      <h2>${esc(t(locale, 'signup.you'))}</h2>
      <label for="su-name">${esc(t(locale, 'signup.name'))}</label>
      <input id="su-name" type="text" name="name" value="${esc(v.name ?? '')}" required maxlength="80" autocomplete="name" />
      ${fieldErr('name')}
      <label for="su-email">${esc(t(locale, 'signup.email'))}</label>
      <input id="su-email" type="email" name="email" value="${esc(v.email ?? '')}" required maxlength="254"
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" />
      ${fieldErr('email')}
      <label for="su-password">${esc(t(locale, 'signup.password'))}</label>
      <input id="su-password" type="password" name="password" required minlength="${input.passwordMin}" autocomplete="new-password" />
      ${fieldErr('password') || `<div class="hint">${esc(t(locale, 'signup.passwordHint', { n: input.passwordMin }))}</div>`}
      ${invite}
      <label class="check"><input type="checkbox" name="terms" required${v.terms ? ' checked' : ''} />
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
}): string {
  const { locale } = input;
  const other = `<p class="other"><a href="/login">${esc(t(locale, 'setpw.toLogin'))}</a></p>`;
  if (!input.link) {
    return doorFrame(locale, input.path, t(locale, 'setpw.title'),
      `<h1>${esc(t(locale, 'setpw.title'))}</h1><p class="lead">${esc(t(locale, 'setpw.gone'))}</p>`, other);
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
}): string {
  const { locale, kind } = input;
  const title = t(locale, kind === 'notfound' ? 'error.notfound.title' : 'error.crash.title');
  const card = `
    <h1>${esc(title)}</h1>
    <p class="lead">${esc(t(locale, kind === 'notfound' ? 'error.notfound.body' : 'error.crash.body'))}</p>
    ${kind === 'crash' && input.reference
      ? `<p class="hint">${esc(t(locale, 'error.reference', { ref: input.reference }))}</p>` : ''}`;
  const other = `<p class="other"><a href="/app">${esc(t(locale, 'error.home'))}</a></p>`;
  return doorFrame(locale, input.path, title, card, other);
}
