import { BUSINESS_KINDS, TEAM_SIZES, CHANNELS_USED, countryOptions } from '../../core/owner/business.js';
import { type Locale, dirOf, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName, assistantsAreSeveral, setupState } from './say.js';
import { cssVariables } from '../../core/owner/css.js';
import { markDetail, markSmall, faviconDataUri } from '../../core/owner/brand.js';

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
  { href: '/app/factory',   id: 'factory' },
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
  { hub: '/app/factory', routes: [
    '/app/products', '/app/factory/prices',
    '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate',
  ] },
  { hub: '/app/employee', routes: ['/app/knowledge', '/app/settings/forbidden', '/app/sandbox'] },
  { hub: '/app/settings', routes: [
    '/app/onboarding', '/app/channels',
    '/app/settings/people', '/app/settings/business', '/app/settings/account', '/app/settings/data',
    '/app/settings/components',
  ] },
  { hub: '/app/conversations', routes: ['/app/contacts'], outreach: true },
  // C4.b — follow-ups are written for the people on her list, so they are
  // reached from it.
  { hub: '/app/contacts', routes: ['/app/sequences', '/app/prospects'], outreach: true },
  { hub: '/app', routes: ['/app/conversations', '/app/analytics'] },
];

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
export const deeper = (href: string, label: string, extra = ''): string =>
  `<a class="deeper${extra ? ` ${extra}` : ''}" href="${href}">${esc(label)}<span class="go" aria-hidden="true">›</span></a>`;

/** Its opposite. The arrow is a mirrored span, never a character in the copy. */
export const back = (href: string, label: string): string =>
  `<a class="back" href="${href}"><span class="go" aria-hidden="true">‹</span>${esc(label)}</a>`;

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
  body { margin: 0; background: var(--color-surface-alt); color: var(--color-ink);
    font: var(--font-size-base)/var(--line-height) var(--font-family); }
  a { color: inherit; text-decoration: none; }
  /* Anything a PERSON says — her draft, a buyer's quoted words. Never a label. */
  .voice { font-family: var(--font-voice); }
  .layout { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
  /* A grid child does not shrink below its own content unless told to: its
     default min-width is auto, so one unbreakable string — a long sku, a URL a
     buyer pasted — widens the content track and scrolls the whole page
     sideways. Nothing in the product does that today; this is the guard, not a
     repair. */
  .layout > * { min-width: 0; }
  nav.side { background: var(--color-paper); border-inline-end: 1px solid var(--color-border);
    padding: var(--space-16) var(--space-12); }
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
  nav.side a.navlink { display: flex; align-items: center; gap: var(--space-8); padding: var(--space-12);
    min-height: 44px; border-radius: var(--radius-card); color: var(--color-ink-secondary);
    font-size: var(--font-size-small); margin-bottom: var(--space-4); }
  nav.side a.navlink:hover { background: var(--color-paper-sunk); color: var(--color-ink); }
  /* M49 — the active destination reads by WEIGHT and a recess, not by colour.
     Green was being spent five times on one screen: this slab, a panel, every
     link, the language pill and the button. Colour that appears everywhere
     marks nothing; jade now means only "this sends" and "this is a state". */
  nav.side a.navlink.active { background: var(--color-paper-sunk); color: var(--color-ink); font-weight:600; }
  /* D — the setup count on the Setup entry: a figure at the far end of the
     row, in the secondary ink. Not a state, so no state colour. */
  /* V1 step three — the count sits BESIDE its word, not at the far end of the row. */
  nav.side .navcount { margin-inline-start:var(--space-8); font-size:var(--font-size-caption);
    font-weight:500; color:var(--color-ink-secondary); font-variant-numeric:tabular-nums; }
  /* V1 · option A (2026-09-24) — there is no header band. The nav row is the
     chrome; the language switch and log out are the first rows of Setup, and
     the login page keeps its own switcher. */
  .langsw { display:inline-flex; gap:var(--space-4); background:var(--color-paper-sunk);
    border:1px solid var(--color-border); border-radius:var(--radius-chip); padding:3px; }
  .langsw a { display:inline-flex; align-items:center; min-height:44px; padding:0 14px;
    border-radius:var(--radius-chip); font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); white-space:nowrap; }
  /* The switcher is chrome. A solid jade fill made it the loudest object
     on a page whose subject was somebody's business. */
  .langsw a.on { background:var(--color-surface); color:var(--color-ink); font-weight:600; }
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
  .pill.owner { background:var(--color-highlight-wash); color:var(--color-highlight); }

  /* One button. Quiet does nothing on its own; jade sends; red takes something away. */
  .btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px;
    padding:10px 18px; border-radius:var(--radius-card); border:0;
    background:var(--color-paper-sunk); color:var(--color-ink);
    font:inherit; font-size:var(--font-size-small); cursor:pointer; }
  .btn.send { background:var(--color-jade); color:var(--color-surface); box-shadow:var(--shadow-lift1); }
  .btn.send:hover { background:var(--color-jade-deep); }
  .btn.danger { background:var(--color-warn-wash); color:var(--color-warn); }
  .btn.ghost { background:transparent; border:1px solid var(--color-border); color:var(--color-ink-secondary); }
  .inline { display:inline; }
  .doors { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
  /* M49 — a button in a column form stretched to the width of the input above
     it, which made "Save" a 455px slab. A button is as wide as its word. */
  form .btn, form button:not(.full) { align-self:start; }

  /* ── The form. ONE definition, in the shell, because five pages use it.
     Three of them (the rate, the closures, the samples) referenced these
     classes while emitting no rule for them, so their fields rendered as
     inline labels strung across the page — the same failure as a renderer
     reaching for a token nobody emits, and invisible to every test that reads
     strings rather than boxes. Caught by a screenshot. */
  .pform { display:flex; flex-direction:column; gap:var(--space-16);
           max-width:var(--measure-form); margin-top:var(--space-12); }
  .fld { display:flex; flex-direction:column; gap:var(--space-4);
         font-size:var(--font-size-small); color:var(--color-ink); }
  .pform input, .pform textarea, .pform select {
    background:var(--color-paper-sunk); border:1px solid var(--color-border);
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
  .flash { background:var(--color-jade-wash); color:var(--color-jade-deep);
    border:1px solid transparent;
    border-radius:var(--radius-card); padding:var(--space-12) var(--space-16);
    margin-bottom:var(--space-16); font-size:var(--font-size-small); }
  .flash.bad { background:var(--color-warn-wash); color:var(--color-warn);
    border-color:var(--color-warn-line); }

  /* One tab row. */
  .tabs { display:flex; gap:var(--space-8); margin-bottom:var(--space-16); }
  .tab { display:inline-flex; align-items:center; min-height:44px; padding:8px 16px;
    border-radius:var(--radius-chip); background:var(--color-surface);
    border:1px solid var(--color-border); color:var(--color-ink-secondary);
    font-size:var(--font-size-small); }
  .tab.on { background:var(--color-paper-sunk); border-color:var(--color-border); color:var(--color-ink); font-weight:600; }

  .list { display:flex; flex-direction:column; gap:var(--space-12); }
  .back { display:inline-flex; align-items:center; gap:var(--space-4); min-height:44px;
    color:var(--color-ink); font-size:var(--font-size-small); }
  pre { background:var(--color-paper-sunk); border:1px solid var(--color-border);
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
  .deeper:hover, .deeper:focus-visible { color:var(--color-jade-deep); }
  /* The chevron carries the affordance now that the label does not shout. */
  .go { font-size:var(--font-size-base); color:var(--color-ink-secondary); }
  [dir="rtl"] .go { transform:scaleX(-1); display:inline-block; }
  /* The chevron above mirrors because it POINTS — "onward" is to the left in
     Arabic. The mark does NOT, and its absence here is deliberate rather than an
     oversight: a brand mark is a constant, the same object in every language,
     and flipping it would make Nomi a different mark for Arabic readers. Only
     directional glyphs mirror. Do not add .mark to this rule. */
  a:focus-visible, button:focus-visible, input:focus-visible,
  textarea:focus-visible, select:focus-visible { outline:2px solid var(--color-jade); outline-offset:2px; }
  .muted { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  /* M49 — one empty state, aligned like everything else. It was centred while
     the page around it was left-aligned, which is the single clearest way to
     make a considered page look like an accident. It mirrors in RTL on its own. */
  .empty { text-align:start; color:var(--color-ink-secondary);
    font-size:var(--font-size-small); padding:var(--space-24) 0;
    max-width:var(--measure-prose); }

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
    background:var(--color-paper-sunk); border-start-start-radius:4px; }
  /* Her sent replies: neutral. These carried an amber fill — colour on every
     message she ever sent, marking no state at all. */
  .msg.outbound .bubble { font-size:var(--font-size-small);
    background:var(--color-surface); border:1px solid var(--color-border);
    border-start-end-radius:4px; }
  .ts { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  /* Her PROPOSAL — visually subordinate to the buyer's words above it. Not a
     boxed rival: a quiet serif paragraph behind a jade hairline that means
     "hers, awaiting your decision". border-inline-start keeps the hairline on
     the reading edge in RTL with no override. */
  .proposed { font-family:var(--font-voice); font-size:var(--font-size-small);
    border-inline-start:2px solid var(--color-jade); padding:2px 14px;
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
  .perr { color:var(--color-highlight); font-size:var(--font-size-caption); margin:0; }
  .pq { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); color:var(--color-ink); }
  .subline { font-size:var(--font-size-caption); margin-bottom:var(--space-12); }
  .dhead { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; margin-bottom:var(--space-8); }
  .chips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); }
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
  .row.lines { display:grid; gap:var(--space-4); }
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
  .pill.stop { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
  /* The one-time access code on the People page; tests read it by this class. */
  .issued .code { font-size:var(--font-size-display); font-weight:600; letter-spacing:.08em; margin:var(--space-8) 0; }
  .choices { border:0; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-16); }
  .choices legend { padding:0; margin-bottom:var(--space-4); font-size:var(--font-size-caption); }
  /* Today (step four). The calm state IS the page: a short rule and one
     sentence in the product's voice — quiet, not jade, while messaging is off.
     And a count you can tap: the stat row as a link, its figure one step up. */
  .calm-page { padding:var(--space-32) 0 var(--space-48); }
  .calm-rule { height:2px; width:3.5rem; background:var(--color-jade); border-radius:2px; margin-bottom:var(--space-24); }
  .calm-page.off .calm-rule { background:var(--color-border); }
  .calm-say { font-size:var(--font-size-title); line-height:1.45; color:var(--color-ink); margin:0; max-width:var(--measure-prose); }
  a.stat { color:inherit; }
  a.stat:hover .go, a.stat:focus-visible .go { color:var(--color-jade-deep); }
  .stat.need .v { font-size:var(--font-size-title); }
  /* The controls the browser used to draw — the hand-to select, a details
     disclosure, a textarea outside a form — get the same recess as an input. */
  main select, main textarea, main input:not([type=checkbox]):not([type=radio]) {
    background:var(--color-paper-sunk); border:1px solid var(--color-border);
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
  .btn:hover:not(.send), .btn.is-hover:not(.send) { background:var(--color-border); }
  .btn.send.is-hover { background:var(--color-jade-deep); }
  .is-focus { outline:2px solid var(--color-jade); outline-offset:2px; }
  .btn:disabled, .btn.is-disabled { background:var(--color-paper-sunk); color:var(--color-ink-secondary);
    box-shadow:none; cursor:default; }

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
    nav.side { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:var(--space-4);
      padding:10px 12px; border-inline-end:none; border-bottom:1px solid var(--color-border); }
    /* The mark belongs to the product, so it sits with the product's nav — small,
       and without the word beside it. */
    nav.side .brand { display:flex; padding:0; margin-inline-end:var(--space-4); }
    nav.side .brand .mark-detail { display:none; }
    nav.side .brand .mark-small { display:flex; }
    nav.side .brand .brandname { display:none; }
    nav.side a.navlink { flex:1; flex-direction:row; flex-wrap:wrap; gap:var(--space-4); margin:0;
      padding:var(--space-8) var(--space-4); min-height:56px; align-items:center; justify-content:center;
      font-size:var(--font-size-caption); text-align:center; }
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
  .fielderr { color:var(--color-warn); font-size:var(--font-size-caption); }
  .fld.bad input, .fld.bad textarea { border-color:var(--color-warn-line); }
  .langs { display:flex; flex-wrap:wrap; gap:var(--space-12); padding-top:2px; }
  .cats { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cat { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
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
  .sreq-a textarea { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .sreq-do { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }

  /* ── pilot.ts — moved here whole in step four: page-specific names, defined once. */
  .rbsub { font-size:var(--font-size-caption); letter-spacing:0; color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .rbrow { display:flex; align-items:center; gap:var(--space-8); padding:8px 0; border-bottom:1px solid var(--color-paper-sunk); }
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
  .pr { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; padding:12px 0; border-bottom:1px solid var(--color-paper-sunk); }
  .pr:last-child { border-bottom:0; }
  .pr .mk { font-size:var(--font-size-base); font-weight:700; }
  .pr.done .mk { color:var(--color-ok); }
  .pr.todo .mk { color:var(--color-ink-secondary); }
  .pr .lbl { font-size:var(--font-size-small); }
  .pr-b { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; margin-inline-start:auto; }
  .badge { font-size:var(--font-size-caption); padding:3px 10px; border-radius:999px; }
  .badge.sys { background:var(--color-jade-wash); color:var(--color-ok); }
  .badge.owner { background:var(--color-highlight-wash); color:var(--color-highlight); }
  .verdict { margin-top:var(--space-16); padding:14px; border-radius:12px; background:var(--color-surface); border:1px solid var(--color-border); text-align:center; font-weight:600; }
  .verdict.ok { background:var(--color-jade-wash); color:var(--color-ok); border-color:var(--color-jade-line); }

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
  .empty-p { margin:0 0 var(--space-12); }
  .gaps { display:flex; flex-direction:column; gap:var(--space-8); }
  a.gap { display:grid; grid-template-columns:1fr auto; gap:var(--space-4) var(--space-12); background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:12px; padding:14px 16px; }
  a.gap:hover, a.gap:focus-visible { border-color:var(--color-jade-line); }
  .gq { font-size:var(--font-size-small); color:var(--color-ink); }
  .gmeta { font-size:var(--font-size-caption); grid-column:1; }
  .gact { grid-row:1 / span 2; align-self:center; color:var(--color-jade); font-size:var(--font-size-small); white-space:nowrap; }
  @media (max-width:560px) { a.gap { grid-template-columns:1fr; } .gact { grid-row:auto; text-align:start; } }
  .emp-h { display:flex; align-items:center; gap:var(--space-12); }
  .emp-name { font-size:var(--font-size-title); font-weight:700; }
  .dgroup { margin-bottom:var(--space-16); }
  .dtitle { font-weight:600; margin-bottom:var(--space-8); }
  .ditem { padding:8px 12px; border-radius:8px; margin-bottom:var(--space-8); font-size:var(--font-size-small); background:var(--color-paper-sunk); border:1px solid var(--color-border); }
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
  .fwarn { color:var(--color-highlight); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fok { color:var(--color-jade); font-size:var(--font-size-small); margin:var(--space-12) 0 0; }
  .fchips { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .fchip { font-size:var(--font-size-caption); padding:6px 13px; border-radius:999px; background:var(--color-paper-sunk); color:var(--color-ink); border:1px solid var(--color-border); }
  .frules { margin:var(--space-16) 0 0; padding-inline-start:18px; color:var(--color-ink); font-size:var(--font-size-small); line-height:1.6; }
  /* The promise the whole product rests on — read it before the fine print. */
  .fnever { margin:var(--space-16) 0 0; font-size:var(--font-size-small); line-height:1.6; color:var(--color-ink); max-width:var(--measure-prose); border-inline-start:2px solid var(--color-jade); padding-inline-start:14px; }
  .fsteps { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .fsteps li { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .fsteps li.done { color:var(--color-ink); }
  .sub3 { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); margin:var(--space-24) 0 var(--space-4); }
  /* Findings are a to-do list, not an alarm: same weight as any other step. */
  .rehear { margin-top:var(--space-12); display:flex; flex-direction:column; gap:var(--space-12); }
  .fgap .fnames { margin-top:var(--space-4); }
  .alform { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-16); max-width:var(--measure-form); }
  .alform .fld { display:flex; flex-direction:column; gap:var(--space-4); font-size:var(--font-size-small); }
  .alform input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .rm { margin-inline-start:var(--space-8); }
  /* M49 — a link is ink; jade is spent on sending and on state. */
  .blink { color:var(--color-ink); text-decoration:underline; text-underline-offset:3px; }
  .fconn { display:flex; align-items:center; gap:var(--space-12); }
  .fconn-t { font-size:var(--font-size-small); color:var(--color-ink); }
  .fconn-s { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  .fconn-h { font-size:var(--font-size-caption); margin-top:var(--space-4); }
  .fconn-i { font-size:var(--font-size-title); }
  .fconn.on .fconn-s { color:var(--color-jade); }
  /* Not connected stops everything, so it looks like it and links to the fix. */
  .fconn.off { background:var(--color-highlight-wash); border:1px solid var(--color-highlight); border-radius:14px; padding:14px 16px; }
  .fconn.off:hover, .fconn.off:focus-visible { border-color:var(--color-highlight); }
  .fconn.off .fconn-s { color:var(--color-highlight); }
  .fconn.off .go { margin-inline-start:auto; }
  .fblock .deeper { margin-top:var(--space-8); }

  /* ── products.ts — moved here whole in step four: page-specific names, defined once. */
  .pq input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:11px 14px; font:inherit; min-height:44px; }
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
  .tier { display:flex; justify-content:space-between; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:8px; padding:10px 12px; }
  .imgs { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .imgs img { width:96px; height:96px; object-fit:cover; border-radius:10px; border:1px solid var(--color-border); }
  .qrow { font-size:var(--font-size-caption); padding:6px 0; border-bottom:1px solid var(--color-border); }
  .qrow:last-child { border-bottom:none; }
  .rev { display:flex; align-items:center; gap:var(--space-8); padding:10px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); flex-wrap:wrap; }
  .rev:last-child { border-bottom:none; }
  .rev-src { flex-basis:100%; font-size:var(--font-size-caption); }
  .rev-move { flex-basis:100%; }
  .photo-in { display:block; width:100%; margin:var(--space-12) 0; font:inherit; color:var(--color-ink); min-height:44px; }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:12px; font:inherit; resize:vertical; margin:var(--space-12) 0; }
  @media (max-width:560px) { .imgs img { width:72px; height:72px; } }

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
  /* V1 type scale — the headline pill carries a sentence ("You can write first once these are in place"); at caption 13 it no longer fits beside the name on a 390 px phone, and a pill is nowrap by rule. Let the row wrap and let this one pill break, rather than push the page 7 px wider than the screen. */
  .ch-h { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-8); }
  .ch-h .pill { white-space:normal; }
  .ch-name { font-size:var(--font-size-small); font-weight:700; }
  .ch-desc { font-size:var(--font-size-caption); margin:var(--space-8) 0 var(--space-12); }
  .ch-info { display:flex; flex-direction:column; gap:var(--space-4); background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); }
  .ch-acts { display:flex; gap:var(--space-8); flex-wrap:wrap; }
  .prob { background:var(--color-waiting-wash); color:var(--color-waiting); border-radius:10px; padding:12px; font-size:var(--font-size-small); margin-bottom:var(--space-12); line-height:1.6; }
  .ownerform { display:flex; flex-direction:column; gap:var(--space-4); margin-bottom:var(--space-8); }
  .ownerform input { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
  .soon { display:flex; flex-wrap:wrap; gap:var(--space-8); margin-bottom:var(--space-12); }
  .soon-chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:6px 14px; color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .guide { padding-inline-start:20px; line-height:2; }
  .guide li { margin-bottom:var(--space-4); }

  /* ── knowledge.ts — moved here whole in step four: page-specific names, defined once. */
  /* The two scopes sit side by side, so each says which one it is. */
  /* A scope caption explains; it is not a state, so it gets no colour. */
  .scope { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-4) 0 var(--space-12); }
  .klist { display:flex; flex-direction:column; gap:var(--space-8); }
  .krow { display:flex; justify-content:space-between; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; padding:12px 16px; }
  .krow:hover { border-color:var(--color-border); }
  .kitem { border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:var(--space-12); }
  .kh { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  .kh .src { margin-inline-start:auto; font-size:var(--font-size-caption); }
  .kc { margin:var(--space-8) 0; white-space:pre-wrap; }
  .teach, .krow-actions { display:flex; flex-direction:column; gap:var(--space-8); margin-top:var(--space-12); }
  .teach h3 { margin:0; font-size:var(--font-size-small); }
  input[type=text], textarea, select { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; }
  .kbtns { display:flex; gap:var(--space-8); }
  .certs { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cert { padding:8px 14px; border-radius:999px; border:1px solid var(--color-border); background:var(--color-paper-sunk); color:var(--color-ink-secondary); cursor:pointer; font-size:var(--font-size-caption); }
  .cert.on { background:var(--color-jade-wash); color:var(--color-ok); border-color:var(--color-jade-line); }

  /* ── knowledge-insights.ts — moved here whole in step four: page-specific names, defined once. */
  h3.sub { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:var(--space-16) 0 var(--space-8); }
  .reqs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-4); }
  .reqs .q { color:var(--color-ink); }
  .gap { border:1px solid var(--color-border); border-radius:12px; padding:14px; margin-bottom:var(--space-12); }
  .ki-q { font-size:var(--font-size-small); margin-bottom:var(--space-8); }
  .ki-meta { display:flex; gap:var(--space-8); align-items:center; margin-bottom:var(--space-12); }
  .gacts { display:flex; gap:var(--space-8); }
  .pill.reason { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .pill.taught { background:var(--color-jade-wash); color:var(--color-ok); }
  .pill.corrected { background:var(--color-highlight-wash); color:var(--color-highlight); }
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
  .pill.wait { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }

  /* ── sandbox.ts — moved here whole in step four: page-specific names, defined once. */
  .pcount { font-size:var(--font-size-display); font-weight:600; color:var(--color-ink); font-variant-numeric:tabular-nums; margin:var(--space-4) 0 var(--space-12); }
  .pcases { list-style:none; margin:0; padding:0; }
  .pcase { display:flex; gap:var(--space-8); padding:7px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-small); }
  .pcase:last-child { border-bottom:0; }
  .pcase.ok .pmark { color:var(--color-ok); }
  .pcase.bad .pmark { color:var(--color-warn); }
  .ptitle { color:var(--color-ink-secondary); }
  .pproves { margin:var(--space-12) 0 0; max-width:var(--measure-prose); line-height:1.6; }
  .sbx-banner { background:var(--color-waiting-wash); color:var(--color-waiting); border:1px solid var(--color-waiting-line); border-radius:12px; padding:12px 16px; font-weight:600; font-size:var(--font-size-small); margin:var(--space-8) 0 var(--space-12); }
  .sbx-intro { margin:0 0 var(--space-16); }
  .sbx-compose { display:flex; flex-direction:column; gap:var(--space-12); }
  .modebar { display:flex; align-items:center; gap:var(--space-12); flex-wrap:wrap; font-size:var(--font-size-small); }
  .radio { display:inline-flex; align-items:center; gap:var(--space-4); cursor:pointer; }
  .radio.off { opacity:.5; cursor:not-allowed; }
  .scenariobar { display:flex; align-items:center; gap:var(--space-8); flex-wrap:wrap; }
  select { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; max-width:100%; }
  .msgbar { display:flex; flex-direction:column; gap:var(--space-8); }
  .msgacts { display:flex; align-items:center; justify-content:space-between; gap:var(--space-8); flex-wrap:wrap; }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  .sbx-trust { border-color:var(--color-highlight-line); }
  .sbx-trust.pass { border-color:var(--color-jade-line); }
  .sbx-trust.fail { border-color:var(--color-warn-line); }
  .sbx-trust .verdict { font-weight:700; text-transform:none; letter-spacing:0; }
  .sbx-trust.pass .verdict { color:var(--color-ok); }
  .sbx-trust.fail .verdict { color:var(--color-warn); }
  .chip.auto { background:var(--color-jade-wash); color:var(--color-ok); border-color:var(--color-jade-line); }
  .chip.draft { background:var(--color-waiting-wash); color:var(--color-waiting); border-color:var(--color-waiting-line); }
  .chip.warn { background:var(--color-warn-wash); color:var(--color-warn); }
  .chip.badge { background:var(--color-jade-wash); color:var(--color-highlight); }
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
 * V1 step four — the ONE public document: the legal pages, the unsubscribe
 * page and the proof page stand outside the owner's shell (no nav, no
 * session). Same tokens, one stylesheet, a page's own rules passed in — so a
 * second hand-rolled palette cannot drift.
 */
export function publicDocument(input: {
  readonly locale: Locale; readonly title: string; readonly body: string;
  readonly noindex?: boolean; readonly extraCss?: string; readonly mainClass?: string;
}): string {
  return `<!doctype html>
<html lang="${esc(input.locale)}" dir="${esc(dirOf(input.locale))}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${input.noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<title>${esc(input.title)}</title>
<style>
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
           border-radius:var(--radius-card); background:var(--color-jade);
           color:var(--color-surface); cursor:pointer; }
${input.extraCss ?? ''}
</style>
</head><body><main${input.mainClass ? ` class="${esc(input.mainClass)}"` : ''}>${input.body}</main></body></html>`;
}

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
 * is reached from `/app/conversations`, which is reached from `/app` — only
 * that last one is in the nav. So the lookup FOLLOWS the chain rather than
 * stopping at the first hop, which would light nothing three times over.
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
}): string {
  const { locale } = input;
  const name = assistantName(locale);
  const here = hubFor(input.path, input.active);
  const setup = setupState();
  const nav = NAV.map((n) => {
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
    const badge = count ? `<span class="navcount" aria-hidden="true">${count.done}/${count.total}</span>` : '';
    const aria = count
      ? ` aria-label="${esc(label)}, ${esc(t(locale, 'nav.setup.progress', { done: count.done, total: count.total }))}"`
      : '';
    // A11y — `aria-current="page"` is what tells a screen reader which of five
    // identical links is the one you are on. The class is for everyone else.
    return `<a href="${n.href}" class="navlink ${on ? 'active' : ''}"${on ? ' aria-current="page"' : ''}${aria}
       >${esc(label)}${badge}</a>`;
  }).join('');
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · ${esc(name)}</title>
<link rel="icon" href="${faviconDataUri()}">
<style>${STYLE}${STYLE_PAGES}</style></head>
<body><div class="layout">
  <nav class="side">
    <div class="brand"><span class="mark-detail">${markDetail(40, null)}</span><span class="mark-small">${markSmall(28, null)}</span><span class="brandname">Nomi<small>${esc(t(locale, 'app.tagline', { name }))}</small></span></div>
    ${nav}
  </nav>
  <div class="content">
    <main>${input.bodyHtml}</main>
  </div>
</div></body></html>`;
}

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
    border:1px solid var(--color-border); background:var(--color-paper-sunk);
    color:var(--color-ink); font-size:var(--font-size-base); margin:var(--space-8) 0 var(--space-16); }
  /* M49 — as wide as its word, like every other button in the product. */
  button { min-height:44px; padding:12px var(--space-24); border:0; border-radius:var(--radius-card);
    background:var(--color-jade); color:var(--color-surface); font-weight:600;
    font-size:var(--font-size-small); cursor:pointer; }
  button:hover { background:var(--color-jade-deep); }
  select { width:100%; min-height:44px; padding:10px 14px; border-radius:var(--radius-card);
    border:1px solid var(--color-border); background:var(--color-paper-sunk);
    color:var(--color-ink); font-size:var(--font-size-base); margin:var(--space-8) 0 var(--space-16); }
  .login h2 { font-size:var(--font-size-small); color:var(--color-ink-secondary); margin:var(--space-24) 0 var(--space-8); font-weight:600; }
  .login form > h2:first-child { margin-top:0; }
  fieldset.checks { border:0; padding:0; margin:0 0 var(--space-16); }
  fieldset.checks legend { color:var(--color-ink-secondary); font-size:var(--font-size-caption); padding:0; margin-bottom:var(--space-8); }
  label.check { display:inline-flex; align-items:center; gap:var(--space-8); min-height:44px; margin-inline-end:var(--space-16); color:var(--color-ink); }
  label.check input { width:auto; margin:0; }
  .err { color:var(--color-warn); font-size:var(--font-size-caption); margin-bottom:var(--space-8); }
  .fld-err { color:var(--color-warn); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
  .hint { color:var(--color-ink-secondary); font-size:var(--font-size-caption); margin:calc(-1 * var(--space-8)) 0 var(--space-16); }
  label { color:var(--color-ink-secondary); font-size:var(--font-size-caption); display:block; }
  details { margin-top:var(--space-24); border-top:1px solid var(--color-border); padding-top:var(--space-16); }
  summary { cursor:pointer; color:var(--color-ink-secondary); font-size:var(--font-size-caption); min-height:44px; display:flex; align-items:center; }
  details form { margin-top:var(--space-8); }
  .login .other { text-align:center; margin:var(--space-16) 0 0; font-size:var(--font-size-caption); }
  .login .foot { text-align:center; font-size:var(--font-size-caption); }
`;

const doorFrame = (locale: Locale, path: string, title: string, card: string, other: string): string => `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi · ${esc(title)}</title>
<link rel="icon" href="${faviconDataUri()}">
<style>${STYLE}${DOOR_STYLE}</style></head>
<body><div class="login">
  <div class="top-sw">${switcher(locale, path)}</div>
  <div class="brand">Nomi<small class="muted">${esc(t(locale, 'login.brandTagline'))}</small></div>
  <div class="card">${card}</div>
  ${other}
  <p class="muted foot">${esc(t(locale, 'login.footer'))}</p>
</div></body></html>`;

export type LoginProblem = 'code' | 'password' | 'locked' | 'slow';

export function loginPage(input: {
  readonly locale: Locale; readonly path: string;
  /** Kept for the callers that only know "it failed": the access-code sentence. */
  readonly error?: boolean; readonly problem?: LoginProblem;
  readonly email?: string; readonly signupOpen?: boolean;
}): string {
  const { locale } = input;
  const problem: LoginProblem | null = input.problem ?? (input.error ? 'code' : null);
  const sentence = problem === 'password' ? t(locale, 'login.errorPassword')
    : problem === 'locked' ? t(locale, 'login.locked')
    : problem === 'slow' ? t(locale, 'login.slow')
    : problem === 'code' ? t(locale, 'login.error') : null;
  const card = `
    ${sentence && problem !== 'code' ? `<div class="err" role="alert">${esc(sentence)}</div>` : ''}
    <form method="post" action="/login">
      <label for="login-email">${esc(t(locale, 'login.emailLabel'))}</label>
      <input id="login-email" type="email" name="email" value="${esc(input.email ?? '')}" required
        autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" ${problem === 'code' ? '' : 'autofocus'} />
      <label for="login-password">${esc(t(locale, 'login.secretLabel'))}</label>
      <input id="login-password" type="password" name="password" required autocomplete="current-password" />
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>
    <details${problem === 'code' ? ' open' : ''}>
      <summary>${esc(t(locale, 'login.codeToggle'))}</summary>
      ${problem === 'code' ? `<div class="err" role="alert">${esc(sentence ?? '')}</div>` : ''}
      <form method="post" action="/login">
        <label for="login-code">${esc(t(locale, 'login.passwordLabel'))}</label>
        <input id="login-code" type="password" name="code" required autocomplete="off" ${problem === 'code' ? 'autofocus' : ''} />
        <button type="submit">${esc(t(locale, 'login.codeSubmit'))}</button>
      </form>
    </details>`;
  const other = input.signupOpen === false ? ''
    : `<p class="other"><a href="/signup">${esc(t(locale, 'login.toSignup'))}</a></p>`;
  return doorFrame(locale, input.path, t(locale, 'login.title'), card, other);
}

export type SignupPageInput = {
  readonly locale: Locale; readonly path: string;
  readonly mode: 'open' | 'invite' | 'closed';
  readonly passwordMin: number;
  readonly contact?: string | null;
  readonly values?: {
    readonly factory?: string; readonly name?: string; readonly email?: string; readonly invite?: string;
    readonly kind?: string; readonly sells?: string; readonly country?: string; readonly website?: string;
    readonly teamSize?: string; readonly channels?: readonly string[];
  };
  /** Sentences, already chosen by the route: one per field, plus one for the whole form. */
  readonly problems?: Partial<Record<'factory' | 'name' | 'email' | 'password' | 'invite'
    | 'kind' | 'sells' | 'country' | 'website' | 'teamSize', string>>;
  readonly error?: string | null;
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
