import { type Locale, dirOf, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { cssVariables } from '../../core/owner/css.js';
import { markDetail, faviconDataUri } from '../../core/owner/brand.js';

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
];

/** Reached from a surface above rather than the nav. Nothing here was removed. */
export const CONTEXTUAL_ROUTES: readonly string[] = [
  '/app/settings', '/app/products', '/app/knowledge', '/app/channels',   // in My factory
  '/app/onboarding', '/app/sandbox',                                     // in My factory → going live
  '/app/conversations',                                                  // in Buyers
  '/app/analytics',                                                      // in Today
];

/**
 * The one "go deeper" link. Phase F: every surface used to grow its own — .more,
 * .fmore, .link, a bare <a> — so the same affordance looked different on every
 * page. One shape, one style, mirrored in RTL by `.go`.
 */
export const deeper = (href: string, label: string): string =>
  `<a class="deeper" href="${href}">${esc(label)}<span class="go" aria-hidden="true">›</span></a>`;

/** Its opposite. The arrow is a mirrored span, never a character in the copy. */
export const back = (href: string, label: string): string =>
  `<a class="back" href="${href}"><span class="go" aria-hidden="true">‹</span>${esc(label)}</a>`;

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The EN·中文·العربية switcher — links to the public /locale route, returns to `path`. */
function switcher(locale: Locale, path: string): string {
  const next = encodeURIComponent(path || '/app');
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
  nav.side { background: var(--color-paper); border-inline-end: 1px solid var(--color-border);
    padding: var(--space-16) var(--space-12); }
  .brand { display:flex; align-items:center; gap:10px; font-weight: 700;
    font-size: var(--font-size-base); padding: 6px 12px 18px; letter-spacing: .3px; }
  .brand .mark { flex:none; }
  .brand small { display:block; color:var(--color-ink-secondary); font-weight:500;
    font-size:var(--font-size-micro); letter-spacing:0; margin-top:2px; }
  nav.side a.navlink { display: flex; align-items: center; gap: 10px; padding: var(--space-12);
    min-height: 44px; border-radius: var(--radius-card); color: var(--color-ink-secondary);
    font-size: var(--font-size-small); margin-bottom: 2px; }
  nav.side a.navlink:hover { background: var(--color-paper-sunk); color: var(--color-ink); }
  /* The active destination is the one accent on this screen. */
  nav.side a.navlink.active { background: var(--color-jade-wash); color: var(--color-jade-deep); font-weight:600; }
  header.top { display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 8px 12px; padding: var(--space-16) var(--space-24);
    border-bottom: 1px solid var(--color-border); }
  header.top .who { display:flex; align-items:center; gap:10px; }
  header.top .whoname { font-weight:600; }
  header.top .avatar { width: 30px; height: 30px; border-radius: var(--radius-chip);
    background:var(--color-jade-wash);
    display:flex; align-items:center; justify-content:center; font-size:var(--font-size-small); }
  header.top .right { display:flex; align-items:center; gap:14px; }
  /* Every header control is a real target: 44px tall, and never wrapped mid-word. */
  header.top .logout { display:inline-flex; align-items:center; min-height:44px; padding:0 4px;
    color:var(--color-ink-secondary); font-size:var(--font-size-note); white-space:nowrap; }
  /* Logging out is routine, not destructive — no warning colour on hover. */
  header.top .logout:hover { color:var(--color-ink); }
  .langsw { display:inline-flex; gap:2px; background:var(--color-paper-sunk);
    border:1px solid var(--color-border); border-radius:var(--radius-chip); padding:3px; }
  .langsw a { display:inline-flex; align-items:center; min-height:44px; padding:0 14px;
    border-radius:var(--radius-chip); font-size:var(--font-size-caption);
    color:var(--color-ink-secondary); white-space:nowrap; }
  .langsw a.on { background:var(--color-jade); color:var(--color-surface); }
  main { padding: var(--space-24); max-width: 1040px; }
  h1.page { font-size: var(--font-size-title); margin: 0 0 18px; }
  /* The hairline in --shadow-lift1 does what a 1px border used to; two would
     read as a double rule at the same edge. */
  .card { background:var(--color-surface); border:0; border-radius:var(--radius-card);
    box-shadow:var(--shadow-lift1); padding:var(--space-16); margin:var(--space-16) 0; }
  /* Phase F: section headings speak to the owner in her own sentence case.
     The 13px tracked-uppercase eyebrow was the one SaaS tell the product had. */
  .card h2, .block h2, main h2 { font-size:var(--font-size-base); font-weight:600;
    color:var(--color-ink); margin:0 0 14px; text-transform:none; letter-spacing:0; }

  /* Counts. Never a KPI tile — a plain line, the way Today has always drawn it. */
  .stats { display:flex; flex-direction:column; }
  .stat { display:flex; align-items:baseline; gap:10px; padding:8px 0;
    border-bottom:1px solid var(--color-border); }
  .stat:last-child { border-bottom:0; }
  .stat .v { font-size:var(--font-size-base); font-weight:600; color:var(--color-ink);
    font-variant-numeric:tabular-nums; min-width:2.5em; }
  .stat .l { font-size:var(--font-size-note); color:var(--color-ink-secondary); }

  /* One pill. It marks STATE — never decoration, never a label wearing a costume. */
  .pill { display:inline-block; padding:4px 10px; border-radius:var(--radius-chip);
    font-size:var(--font-size-micro); font-weight:600;
    margin-inline-end:8px; margin-block-end:8px; white-space:nowrap; }
  .pill.ok { background:var(--color-ok-wash); color:var(--color-ok); }
  .pill.bad { background:var(--color-warn-wash); color:var(--color-warn); }
  .pill.warn { background:var(--color-waiting-wash); color:var(--color-waiting); }
  .pill.owner { background:var(--color-highlight-wash); color:var(--color-highlight); }

  /* One button. Quiet does nothing on its own; jade sends; red takes something away. */
  .btn { display:inline-flex; align-items:center; justify-content:center; min-height:44px;
    padding:10px 18px; border-radius:var(--radius-card); border:0;
    background:var(--color-paper-sunk); color:var(--color-ink);
    font:inherit; font-size:var(--font-size-note); cursor:pointer; }
  .btn.send { background:var(--color-jade); color:var(--color-surface); box-shadow:var(--shadow-lift1); }
  .btn.send:hover { background:var(--color-jade-deep); }
  .btn.danger { background:var(--color-warn-wash); color:var(--color-warn); }
  .btn.ghost { background:transparent; border:1px solid var(--color-border); color:var(--color-ink-secondary); }
  .inline { display:inline; }

  /* One notice. */
  .flash { background:var(--color-jade-wash); color:var(--color-jade-deep);
    border-radius:var(--radius-card); padding:10px 14px;
    margin-bottom:14px; font-size:var(--font-size-note); }

  /* One tab row. */
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tab { display:inline-flex; align-items:center; min-height:44px; padding:8px 16px;
    border-radius:var(--radius-chip); background:var(--color-surface);
    border:1px solid var(--color-border); color:var(--color-ink-secondary);
    font-size:var(--font-size-note); }
  .tab.on { background:var(--color-jade-wash); border-color:var(--color-jade-line); color:var(--color-jade-deep); }

  .list { display:flex; flex-direction:column; gap:10px; }
  .back { display:inline-flex; align-items:center; gap:6px; min-height:44px;
    color:var(--color-jade); font-size:var(--font-size-note); }
  pre { background:var(--color-paper-sunk); border:1px solid var(--color-border);
    border-radius:var(--radius-card); padding:18px; overflow-x:auto;
    font:var(--font-size-note)/1.55 "SF Mono", ui-monospace, Menlo, monospace;
    color:var(--color-ink); white-space:pre; margin:0; }
  /* One "go deeper" link for the whole product; the chevron mirrors in RTL. */
  .deeper { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:10px 0;
    font-size:var(--font-size-note); color:var(--color-jade); }
  .deeper:hover, .deeper:focus-visible { color:var(--color-jade-deep); }
  .go { font-size:var(--font-size-base); color:var(--color-jade); }
  [dir="rtl"] .go { transform:scaleX(-1); display:inline-block; }
  /* The chevron above mirrors because it POINTS — "onward" is to the left in
     Arabic. The mark does NOT, and its absence here is deliberate rather than an
     oversight: a brand mark is a constant, the same object in every language,
     and flipping it would make Nomi a different mark for Arabic readers. Only
     directional glyphs mirror. Do not add .mark to this rule. */
  a:focus-visible, button:focus-visible, input:focus-visible,
  textarea:focus-visible, select:focus-visible { outline:2px solid var(--color-jade); outline-offset:2px; }
  .muted { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  /* One empty state: calm, centred, and never louder than the page. */
  .empty { text-align:center; color:var(--color-ink-secondary);
    font-size:var(--font-size-note); padding:28px 16px; }

  /* ── Speech: the two voices. ─────────────────────────────────────────────
     Anything a PERSON says — the buyer's words, her drafts, her sent replies —
     is set in the voice serif. Everything around the speech (labels,
     timestamps, buttons, counts) is the product speaking, and stays sans.
     One family per speaker, everywhere: these components are declared HERE and
     owned by the shell, because inbox and sandbox each carrying a copy is how
     the two drifted apart last time. */
  .timeline { display:flex; flex-direction:column; gap:12px; }
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
  .ts { font-size:var(--font-size-micro); margin-top:4px; }
  /* Her PROPOSAL — visually subordinate to the buyer's words above it. Not a
     boxed rival: a quiet serif paragraph behind a jade hairline that means
     "hers, awaiting your decision". border-inline-start keeps the hairline on
     the reading edge in RTL with no override. */
  .proposed { font-family:var(--font-voice); font-size:var(--font-size-small);
    border-inline-start:2px solid var(--color-jade); padding:2px 14px;
    margin-bottom:12px; white-space:pre-wrap; word-break:break-word; }

  /* ── A plain section: air and a hairline. The DEFAULT grouping. ──────────
     A card is reserved for a boundary that MEANS something — one buyer's
     business, one verdict. A page of prose and counts is sections, not boxes. */
  .block { padding:22px 0; border-top:1px solid var(--color-border); }
  .block:first-of-type { border-top:0; padding-top:6px; }
  /* RTL needs NO override here: a grid's first track already sits on the
     inline-start edge, so the sidebar mirrors to the right on its own. The
     three rules that used to live here re-flipped it — putting the sidebar
     back on the LEFT in Arabic, and, because two explicitly-placed columns ran
     against DOM order, pushing the whole content column into grid row 2 behind
     a screen-height gap. Every page was affected at desktop width. */
  @media (max-width: 720px) {
    /* Rows matter here. .layout carries min-height:100vh, and with one column
       and no declared rows the nav and the content shared that height evenly:
       the nav row grew to half the viewport and, because a flex row stretches
       its children by default, the ACTIVE tab's background filled all of it —
       a jade slab down the page, on every surface, at phone width. */
    .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    /* Four destinations fit one row on a phone: an equal-width bottom-style bar
       at the top, each a full-height target, no wrapping to three ragged rows. */
    nav.side { display:flex; gap:6px; padding:10px 12px; border-inline-end:none;
      border-bottom:1px solid var(--color-border); }
    nav.side .brand { display:none; }
    nav.side a.navlink { flex:1; flex-direction:column; gap:3px; margin:0; padding:8px 4px;
      min-height:56px; justify-content:center; font-size:var(--font-size-micro); text-align:center; }
    header.top { padding:var(--space-12) var(--space-16); }
    header.top .who .muted { display:none; }   /* five lines of subtitle in a 98px column */
    main { padding:var(--space-16); }
    .msg { max-width:92%; }
    .stats { grid-template-columns: repeat(2,1fr); }
  }
`;

export function shell(input: {
  readonly title: string;
  readonly active: string;
  readonly locale: Locale;
  readonly path: string;
  readonly avatar: string;
  readonly bodyHtml: string;
}): string {
  const { locale } = input;
  const name = EMPLOYEE_NAME[locale];
  const nav = NAV.map((n) =>
    `<a href="${n.href}" class="navlink ${n.id === input.active ? 'active' : ''}"
       >${esc(t(locale, `nav.${n.id}` as MessageKey))}</a>`).join('');
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} · ${esc(name)}</title>
<link rel="icon" href="${faviconDataUri()}">
<style>${STYLE}</style></head>
<body><div class="layout">
  <nav class="side">
    <div class="brand">${markDetail(40, null)}<span class="brandname">Nomi<small>${esc(t(locale, 'app.tagline', { name }))}</small></span></div>
    ${nav}
  </nav>
  <div class="content">
    <header class="top">
      <div class="who"><span class="avatar">${input.avatar}</span>
        <div><div class="whoname">${esc(name)}</div>
        <div class="muted">${esc(t(locale, 'header.stage'))}</div></div></div>
      <div class="right">${switcher(locale, input.path)}
        <a class="logout" href="/logout">${esc(t(locale, 'header.logout'))}</a></div>
    </header>
    <main>${input.bodyHtml}</main>
  </div>
</div></body></html>`;
}

export function loginPage(input: { readonly locale: Locale; readonly path: string; readonly error?: boolean }): string {
  const { locale } = input;
  return `<!doctype html>
<html lang="${locale}" dir="${dirOf(locale)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nomi · ${esc(t(locale, 'login.title'))}</title>
<link rel="icon" href="${faviconDataUri()}">
<style>${STYLE}
  .login { max-width: 360px; margin: 12vh auto; padding: 0 20px; }
  .login .top-sw { display:flex; justify-content:center; margin-bottom:14px; }
  .login .card { padding: var(--space-24); }
  .login .brand { font-weight:700; font-size:var(--font-size-title); margin-bottom:8px; padding:0; }
  input { width:100%; padding:12px 14px; border-radius:var(--radius-card);
    border:1px solid var(--color-border); background:var(--color-paper-sunk);
    color:var(--color-ink); font-size:var(--font-size-small); margin:8px 0 14px; }
  button { width:100%; padding:12px; border:0; border-radius:var(--radius-card);
    background:var(--color-jade); color:var(--color-surface); font-weight:600;
    font-size:var(--font-size-small); cursor:pointer; }
  button:hover { background:var(--color-jade-deep); }
  .err { color:var(--color-warn); font-size:var(--font-size-caption); margin-bottom:8px; }
  label { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
  .login .foot { text-align:center; font-size:var(--font-size-micro); }
</style></head>
<body><div class="login">
  <div class="top-sw">${switcher(locale, input.path)}</div>
  <div class="brand">Nomi<small class="muted">${esc(t(locale, 'login.brandTagline'))}</small></div>
  <div class="card">
    ${input.error ? `<div class="err">${esc(t(locale, 'login.error'))}</div>` : ''}
    <form method="post" action="/login">
      <label>${esc(t(locale, 'login.passwordLabel'))}</label>
      <input type="password" name="code" autofocus autocomplete="current-password" />
      <button type="submit">${esc(t(locale, 'login.submit'))}</button>
    </form>
  </div>
  <p class="muted foot">${esc(t(locale, 'login.footer'))}</p>
</div></body></html>`;
}
