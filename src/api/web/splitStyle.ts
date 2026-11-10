import { SPLIT_FACES_CSS } from './type.js';

/**
 * Shared owner theme and overview layouts. Every signed-in shell links this
 * sheet. `.split` scopes the full-width Today/Inbox layout; `.owner-shell`
 * makes their navigation and palette consistent with all existing pages.
 */

const serif = {
  en: '"Newsreader Variable", "Noto Serif SC", "Noto Naskh Arabic Variable", Georgia, serif',
  zh: '"Noto Serif SC", "Newsreader Variable", "Noto Naskh Arabic Variable", serif',
  ar: '"Noto Naskh Arabic Variable", "Newsreader Variable", "Noto Serif SC", serif',
};
/** The page gutter centres the overview while retaining room for the rail. */
const GUT = `max(var(--space-24), calc((100% - 1240px) / 2))`;

export const SPLIT_CSS = `${SPLIT_FACES_CSS}
/* Rule 38 / 86: the English words isolate direction without changing page alignment. */
.owner-shell bdi[lang="en"] { text-align:match-parent; }

.split {
  --font-voice:${serif.en};
  --color-brand:var(--color-ink);
  --color-assistant:var(--color-ink);
  --color-ok-wash:var(--color-surface); --color-warn:var(--color-ink); --color-warn-wash:var(--color-surface);
  --shadow-lift1:none; --shadow-lift2:none; --shadow-lift3:none;
  background:var(--color-paper);
}
html[lang="zh"] .split { --font-voice:${serif.zh}; }
html[lang="ar"] .split { --font-voice:${serif.ar}; }

/* A customer with no photo: a neutral initial, one colour for everyone. */
.split .face { background:var(--color-sand); color:var(--color-ink-secondary); }

/* The rail */
.split nav.side { background:var(--color-paper); border-inline-end:1px solid var(--color-border); }
.split nav.side a.navlink.active { background:var(--color-sand); box-shadow:none; color:var(--color-ink); }
.split nav.side a.navlink.active .ni { color:var(--color-ink); }
.split .sp-me { display:flex; align-items:center; gap:var(--space-8); min-height:44px; padding:var(--space-4) var(--space-8); color:var(--color-ink);
  font-size:var(--font-size-small); text-decoration:none; border-radius:var(--radius-control); }
.split .sp-me:hover { background:var(--color-sand); }

/* The page: a keyboard's focus never lands under the phone's tab bar */
html:has(body.split) { scroll-padding-block-end:96px; }
.split main.wide { max-inline-size:none; padding:0; }
.sp { padding-block-end:var(--space-32); }
.sp-head { position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:var(--space-16);
  padding:var(--space-32) ${GUT} var(--space-24); }
.sp-head { isolation:isolate; }
.sp-panels { position:relative; }
.sp-headmark { display:none; }
.split h1.page { margin:0; font-family:var(--font-voice); font-size:var(--font-size-overview-title); font-weight:400; line-height:1.1; letter-spacing:-0.01em; color:var(--color-ink); }
html[lang="ar"] .split h1.page, html[lang="zh"] .split h1.page { letter-spacing:0; line-height:1.3; }
.sp-sub { margin:var(--space-4) 0 0; font-size:var(--font-size-small); color:var(--color-ink); }
.sp-new { flex:none; margin:0; }
.sp-panels { display:grid; grid-template-columns:minmax(0, 1.15fr) minmax(0, 1fr); gap:var(--space-24); padding-inline:${GUT}; align-items:start; }
.sp-panels.is-one { grid-template-columns:minmax(0, 720px); }
.sp-start { padding-inline:${GUT}; }
.sp-setup { padding:var(--space-24) ${GUT} 0; }
@media (max-width: 1100px) { .sp-panels { grid-template-columns:minmax(0, 1fr); } }

/* A panel: a heading on the paper, then flat cards with a hairline */
.sp-panel { display:grid; gap:var(--space-12); min-inline-size:0; }
.sp-phead { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); min-block-size:44px; }
.sp-phead h2 { display:flex; align-items:center; gap:var(--space-8); margin:0; font-family:var(--font-voice); font-size:var(--font-size-title); font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-phead .ni { inline-size:22px; block-size:22px; }
.sp-phead .deeper { margin:0; font-size:var(--font-size-small); }
.sp-phead .sp-cap { margin:0; }
.sp-card { padding:var(--space-20); background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); min-inline-size:0; }
.sp-card > *:first-child { margin-block-start:0; }
.sp-card h3 { margin:0; font-family:var(--font-voice); font-size:var(--font-size-title); font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-cap { margin:0 0 var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-card h3.sp-cap { margin-block-end:var(--space-16); font-family:inherit; font-size:var(--font-size-small); font-weight:500; line-height:1.4; color:var(--color-ink-secondary); }
.sp-phead h3.sp-cap { margin:0; }
/* One flat sheet per panel: its parts are ruled apart, never boxed apart. */
.sp-sheet { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); min-inline-size:0; }
.sp-sheet > .sp-card { background:transparent; border:0; border-radius:0; border-block-start:1px solid var(--color-border); padding-block:var(--space-16); }
.sp-sheet > .sp-card:first-child { border-block-start:0; }
.sp-sheet > .sp-decide { padding-block-start:var(--space-20); }
.sp-sheet > .sp-door { padding-block:var(--space-12); }

/* Primary actions, including Send, are black. Secondary actions are outlined. */
.sp-btn { display:inline-flex; align-items:center; justify-content:center; min-block-size:44px; padding:0 var(--space-20); cursor:pointer;
  font:inherit; font-size:var(--font-size-small); font-weight:500; color:var(--color-ink); background:var(--color-surface);
  border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); }
.sp-btn:hover { background:var(--color-sand); }
.sp-btn:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }
.sp-btn.sp-send { color:var(--color-surface); background:var(--color-ink); border-color:var(--color-ink); }
.sp-btn.sp-send:hover { background:var(--color-ink); filter:brightness(0.92); }
.sp-btn.sp-quiet { min-block-size:36px; padding-inline:var(--space-12); font-size:var(--font-size-caption); }
.sp-remind { margin:0; }

/* The decision card */
.sp-who { display:flex; align-items:center; gap:var(--space-16); min-inline-size:0; }
.sp-who .face { inline-size:72px; block-size:72px; font-size:var(--font-size-display); }
.sp-who-t { min-inline-size:0; }
.sp-name { display:block; font-family:var(--font-voice); font-size:var(--font-size-title); font-weight:500; line-height:1.3; color:var(--color-ink); text-decoration:none; overflow-wrap:anywhere; }
.sp-name:hover { text-decoration:underline; }
.sp-deal { display:flex; align-items:center; gap:var(--space-8); margin:var(--space-4) 0 0; font-size:var(--font-size-small); color:var(--color-ink); }
.sp-from { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-thumb { display:inline-block; flex:none; inline-size:36px; block-size:36px; object-fit:cover; border-radius:var(--radius-control); background:var(--color-sand); }
.sp-thumb-s { inline-size:28px; block-size:28px; }
.sp-thumb-none { background:transparent; }
.sp-q { margin:var(--space-16) 0 var(--space-8) !important; font-size:var(--font-size-display) !important; font-weight:400 !important; line-height:1.25 !important; }
.sp-form { margin:0; }
.sp-reply { display:block; inline-size:100%; margin:0 0 var(--space-12); padding:var(--space-12); font:inherit; font-size:var(--font-size-small); line-height:1.55; color:var(--color-ink);
  background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-control); resize:vertical; field-sizing:content; }
.sp-reply:focus { outline:2px solid var(--color-ink); outline-offset:1px; background:var(--color-surface); }
.sp-acts { display:flex; flex-wrap:wrap; gap:var(--space-8); }
.sp-window { margin:var(--space-8) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-decide details.reading { margin-block-start:var(--space-12); }

/* What else waits */
.sp-also { margin-block-start:var(--space-16); padding-block-start:var(--space-16); border-block-start:1px solid var(--color-border); }
.sp-also:first-child { margin-block-start:0; padding-block-start:0; border-block-start:0; }
.split .tw-head, .split .tw-need { color:var(--color-ink); }
.split .tw-note { background:transparent; border:0; padding:0; margin:0 0 var(--space-12); }
.split .notlive { margin:0 0 var(--space-12); color:var(--color-ink); font-size:var(--font-size-small); }
.split .today-foot { margin:0; font-size:var(--font-size-caption); }
.sp-notices:empty { display:none; }

/* The stage strip */
.sp-stages { display:flex; margin:0; padding:0; list-style:none; }
.sp-stages li { position:relative; flex:1 1 0; min-inline-size:0; display:flex; flex-direction:column; align-items:center; text-align:center; padding-block-start:var(--space-20); }
.sp-stages li::before { content:""; position:absolute; inset-block-start:6px; inset-inline-start:50%; inline-size:100%; block-size:1px; background:var(--color-border); }
.sp-stages li:last-child::before { display:none; }
.sp-dot { position:absolute; inset-block-start:0; z-index:1; inline-size:13px; block-size:13px; border-radius:50%; background:var(--color-surface); border:2px solid var(--color-border); }
.sp-stages li.is-done .sp-dot { background:var(--color-ok); border-color:var(--color-ok); }
.sp-stages li.is-waiting .sp-dot { border-color:var(--color-accent); }
.sp-stage { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-fig { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-val { font-size:var(--font-size-caption); color:var(--color-ink); font-variant-numeric:lining-nums; overflow-wrap:anywhere; }

/* Rows */
.sp-rows { display:block; margin:0; padding:0; list-style:none; }
.sp-row { display:grid; grid-template-columns:36px minmax(0, 1fr) 28px 96px 72px 40px 16px; align-items:center; gap:var(--space-8) var(--space-12); min-block-size:52px; padding-block:var(--space-8);
  color:var(--color-ink); text-decoration:none; border-block-start:1px solid var(--color-border); }
.sp-rows li:first-child .sp-row { border-block-start:0; }
.sp-row:hover .sp-rname { text-decoration:underline; }
.sp-row .face { inline-size:36px; block-size:36px; font-size:var(--font-size-small); }
.sp-rname { display:block; text-align:match-parent; font-size:var(--font-size-small); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* A name in the other direction keeps the page's edge: its own "end" is the page's "start". */
[dir="rtl"] .sp-rname:dir(ltr), [dir="ltr"] .sp-rname:dir(rtl) { text-align:end; }
.sp-rval { font-size:var(--font-size-small); text-align:end; font-variant-numeric:lining-nums tabular-nums; white-space:nowrap; }
.sp-rday { font-size:var(--font-size-caption); color:var(--color-ink-secondary); text-align:end; white-space:nowrap; }
.sp-chip { justify-self:start; padding:2px var(--space-8); font-size:var(--font-size-caption); line-height:1.5; white-space:nowrap; color:var(--color-ink-secondary); background:var(--color-sand); border-radius:var(--radius-chip); }
.sp-chip.is-done { color:var(--color-ok); background:var(--color-surface); }
.sp-chip.is-waiting { color:var(--color-ink); background:var(--color-surface); }
.sp-row .go { justify-self:end; color:var(--color-ink-secondary); }
.sp-row.sp-entry { grid-template-columns:36px minmax(0, 1fr) 96px 72px 60px 16px; }


/* The Inbox: its views over one flat sheet of Today's rows */
.si-body { position:relative; padding-inline:${GUT}; }
.si-tabs { display:flex; gap:var(--space-4); margin-block-end:var(--space-12); overflow-x:auto; scrollbar-width:none; border-block-end:1px solid var(--color-border); }
.si-tab { display:inline-flex; flex:none; align-items:center; gap:var(--space-8); min-block-size:44px; padding-inline:var(--space-12); font-size:var(--font-size-small); color:var(--color-ink-secondary); text-decoration:none; white-space:nowrap; border-block-end:2px solid transparent; }
.si-tab:hover { color:var(--color-ink); }
.si-tab.on { color:var(--color-ink); font-weight:600; border-block-end-color:var(--color-ink); }
.si-tab:focus-visible, .si-fil:focus-visible, .si-door:focus-visible::after { outline:2px solid var(--color-ink); outline-offset:-2px; }
.si-tabn { font-size:var(--font-size-caption); font-weight:400; font-variant-numeric:lining-nums tabular-nums; }
.si-tools { display:grid; gap:var(--space-8); padding:var(--space-16) var(--space-20) var(--space-8); border-block-end:1px solid var(--color-border); }
.si-search { display:flex; gap:var(--space-8); margin:0; }
.split .si-search input[type="search"] { flex:1 1 auto; inline-size:auto; min-inline-size:0; block-size:44px; min-block-size:44px; margin:0; padding:0 var(--space-12); box-shadow:none; font:inherit; font-size:var(--font-size-small); color:var(--color-ink); background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-control); }
.split .si-search input[type="search"]:focus { outline:2px solid var(--color-ink); outline-offset:1px; background:var(--color-surface); }
.si-filters { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0 var(--space-16); }
.si-fils { display:flex; align-items:center; gap:var(--space-4); min-inline-size:0; overflow-x:auto; scrollbar-width:none; }
.si-fil { position:relative; isolation:isolate; display:inline-flex; flex:none; align-items:center; min-block-size:44px; padding-inline:var(--space-12); font-size:var(--font-size-caption); color:var(--color-ink-secondary); text-decoration:none; white-space:nowrap; border-radius:var(--radius-control); }
.si-fil:hover { color:var(--color-ink); }
.si-fil.on { color:var(--color-ink); font-weight:600; }
/* The chosen one is a chip within its 44 px of reach. */
.si-fil.on::before { content:""; position:absolute; z-index:-1; inset-block:var(--space-8); inset-inline:0; background:var(--color-sand); border-radius:var(--radius-chip); }
.si-found { margin:0 0 var(--space-8); font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.si-list { padding-inline:var(--space-20); }
.si-group + .si-group { border-block-start:1px solid var(--color-border); }
.si-group > .sp-cap { margin:0; padding-block:var(--space-12) var(--space-4); font-size:var(--font-size-caption); font-weight:500; color:var(--color-ink-secondary); }
.si-group > h2.sp-cap + .sp-rows li:first-child .sp-row { border-block-start:0; }
.si-row { position:relative; grid-template-columns:8px 36px minmax(0, 1fr) 28px 96px 88px 40px 16px; }
.si-row .si-face { position:relative; z-index:1; display:block; line-height:0; border-radius:50%; }
.si-row:hover .sp-rname { text-decoration:underline; }
.si-dot { display:flex; align-items:center; justify-content:center; }
.split .si-dot .row-dot { flex:none; inline-size:8px; block-size:8px; border-radius:50%; background:var(--color-accent); }
.si-who { min-inline-size:0; }
.si-door { display:block; color:inherit; text-decoration:none; }
.si-door::after { content:""; position:absolute; inset:0; border-radius:var(--radius-control); }
.si-row.is-new .sp-rname { font-weight:700; }
.si-line { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 var(--space-8); min-inline-size:0; }
.si-why { font-size:var(--font-size-caption); line-height:1.4; color:var(--color-ink-secondary); }
/* The last message: one faded line, cut by the isolate that holds it. */
.si-said { flex:1 1 40%; display:flex; align-items:baseline; gap:var(--space-4); min-inline-size:0; font-size:var(--font-size-caption); line-height:1.4; color:var(--color-ink-secondary); }
.si-by { flex:none; }
.si-last { flex:1 1 auto; min-inline-size:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-align:match-parent; }
[dir="rtl"] .si-last:dir(ltr), [dir="ltr"] .si-last:dir(rtl) { text-align:end; }
.si-row.is-needs .si-why { color:var(--color-ink); }
.si-empty { margin:0; padding-block:var(--space-24); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.si-empty strong { color:var(--color-ink); font-weight:600; }
.si-emptydoor { padding-block-end:var(--space-24); }
.si-pager { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); min-block-size:44px; padding-inline:var(--space-20); font-size:var(--font-size-small); }
.si-pager .deeper, .si-pager .back { margin:0; }
.si-doors { display:flex; flex-wrap:wrap; gap:var(--space-4) var(--space-20); padding-block-start:var(--space-16); font-size:var(--font-size-small); }
.si-doors .deeper { margin:0; }

/* The list of who else waits sits on the sheet, at its edge */
.split .tw-list { background:transparent; box-shadow:none; }
.split .tw-item { padding-inline-start:0; }

/* Books */
.sp-money { display:grid; grid-template-columns:minmax(0, 1fr) 150px; gap:var(--space-4) var(--space-16); align-items:end; }
.sp-money h3 { grid-column:1 / -1; }
.sp-inout { margin:var(--space-4) 0 0; font-size:var(--font-size-small); color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-profit { display:flex; flex-wrap:wrap; align-items:baseline; gap:var(--space-8); margin:var(--space-8) 0 0; font-family:var(--font-voice); font-size:var(--font-size-title); color:var(--color-ink); }
.sp-profit.is-down { color:var(--color-ink); }
.sp-big { font-size:var(--font-size-overview-money); line-height:1.1; font-variant-numeric:lining-nums; }
.sp-trend { display:block; margin:0; }
.sp-tarea { fill:var(--color-ink); fill-opacity:0.1; }
.sp-tline { fill:none; stroke:var(--color-ink); stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.sp-tdot { fill:var(--color-ink); stroke:var(--color-surface); stroke-width:2; }
.sp-trend svg { display:block; inline-size:100%; block-size:auto; overflow:visible; }
.sp-owed { margin:var(--space-4) 0 0; font-size:var(--font-size-small); font-variant-numeric:lining-nums; }
.sp-over { margin:var(--space-4) 0 0; font-family:var(--font-voice); font-size:var(--font-size-title); font-weight:700; color:var(--color-accent); }
.sp-note { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-late { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-12); margin-block-start:var(--space-12); padding-block-start:var(--space-12); border-block-start:1px solid var(--color-border); font-size:var(--font-size-small); }
.sp-late .face { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
.sp-late-n { font-weight:500; min-inline-size:0; overflow-wrap:anywhere; }
.sp-late-d { color:var(--color-ink); font-size:var(--font-size-caption); }
.sp-remind { margin-inline-start:auto; }
.sp-door { display:flex; align-items:center; gap:var(--space-12); min-block-size:44px; color:var(--color-ink); text-decoration:none; font-size:var(--font-size-small); }
.sp-door:hover { text-decoration:underline; }
.sp-door > .go { margin-inline-start:auto; color:var(--color-ink-secondary); }
.sp-door .ni { inline-size:22px; block-size:22px; flex:none; }
.sp-phonedoor { display:none; }

/* A phone: Sales first, Books below, the tab bar at the foot */
@media (max-width: 720px) {
  .split nav.side { position:fixed; inset-block:auto 0; inset-inline:0; z-index:5; padding:var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
    background:var(--color-surface); border-inline-end:0; border-block-end:0; border-block-start:1px solid var(--color-border); animation:none; }
  .split nav.side .brand, .split .sp-me, .split nav.side a.navlink.sp-notab { display:none; }
  .split nav.side a.navlink { min-block-size:56px; gap:var(--space-4); animation:none; }
  .split nav.side a.navlink.active { background:transparent; font-weight:600; }
  .split nav.side .ni { inline-size:24px; block-size:24px; }
  .split .business-name { display:none; }
  .split .content { padding-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .split .toasts { inset-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .sp-head { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:0 var(--space-12); padding:var(--space-16) var(--space-16) var(--space-12); }
  .sp-headmark { display:block; line-height:0; }
  .sp-headt { display:contents; }
  .sp-headt > :not(h1) { grid-column:1 / -1; grid-row:2; }
  .sp-headt > .live { grid-row:3; }
  .sp-new { grid-column:3; grid-row:1; }
  .sp-new .sp-btn { min-block-size:40px; padding-inline:var(--space-12); }
  .split h1.page { font-size:var(--font-size-overview-phone); }
  .sp-panels { gap:var(--space-20); padding-inline:var(--space-12); }
  .sp-start { padding-inline:var(--space-12); }
  .sp-setup { padding-inline:var(--space-12); }
  .sp-card { padding:var(--space-16); }
  .sp-who .face { inline-size:56px; block-size:56px; font-size:var(--font-size-title); }
  .sp-acts .sp-btn { flex:1 1 auto; }
  .sp-row { grid-template-columns:36px 28px minmax(0, 1fr) auto 14px; grid-template-areas:"face thumb name val go" "face thumb chip day go"; gap:var(--space-4) var(--space-8); }
  .sp-row .face { grid-area:face; }
  .sp-row .sp-thumb { grid-area:thumb; }
  .sp-rname { grid-area:name; }
  .sp-chip { grid-area:chip; }
  .sp-rval { grid-area:val; }
  .sp-rday { grid-area:day; }
  .sp-row .go { grid-area:go; }
  .sp-row.sp-entry { grid-template-columns:36px minmax(0, 1fr) auto 14px; grid-template-areas:"face name val go" "face chip day go"; }
  .si-body { padding-inline:var(--space-12); }
  .si-tools { padding:var(--space-12) var(--space-12) var(--space-4); }
  .si-filters { flex-direction:column; align-items:stretch; }
  .si-list, .si-pager { padding-inline:var(--space-12); }
  .si-tab { padding-inline:var(--space-8); }
  .si-fil { padding-inline:var(--space-8); }
  .si-doors { padding-inline:var(--space-4); }
  .si-row { grid-template-columns:8px 36px 28px auto minmax(0, 1fr) auto 14px; grid-template-areas:"dot face thumb name name val go" "dot face thumb chip why day go" "dot face thumb said said said go"; gap:var(--space-4) var(--space-8); }
  .si-dot { grid-area:dot; }
  .si-row .si-face { grid-area:face; }
  .si-who { display:contents; }
  .si-door { grid-area:name; min-inline-size:0; }
  .si-line { display:contents; }
  .si-why { grid-area:why; align-self:center; min-inline-size:0; }
  .si-said { grid-area:said; }
  .si-row .sp-chip { justify-self:start; align-self:center; }
  .si-row .sp-rday { align-self:center; }
  .sp-money { grid-template-columns:minmax(0, 1fr) 110px; }
  .sp-big { font-size:var(--font-size-hero); }
  .sp-phonedoor { display:block; padding:var(--space-16) var(--space-16) 0; }
}

/* Shared owner shell: every area keeps the same rail and paper. */
.owner-shell { --color-brand:var(--color-ink); --color-needs-wash:var(--color-assistant-wash);
  --color-warn:var(--color-ink); --color-warn-wash:var(--color-surface);
  --shadow-lift1:none; --shadow-lift2:none; caret-color:var(--color-ink); scrollbar-color:var(--color-ink-secondary) var(--color-paper); }
.owner-shell ::selection { color:var(--color-surface); background:var(--color-accent); }
.owner-shell :focus-visible { outline:2px solid var(--color-ink); outline-offset:3px; }
.owner-shell .mark { --color-brand:var(--color-accent); }
.owner-shell .row-dot, .owner-shell .si-dot .row-dot { background:var(--color-accent); }
.owner-shell .wk-scroll { background-image:none; }
.owner-shell .adv-bar { background:var(--color-paper); }
.owner-shell .td-row { mask-image:none; -webkit-mask-image:none; }
.owner-shell .layout { grid-template-columns:224px minmax(0, 1fr); }
.owner-shell nav.side { inline-size:224px; padding:var(--space-24) var(--space-12); background:var(--color-paper); border-inline-end:1px solid var(--color-border); }
.owner-shell nav.side .brand { padding:0 var(--space-12) var(--space-24); gap:var(--space-12); }
.owner-shell nav.side .brandname { min-inline-size:0; font-size:var(--font-size-small); overflow-wrap:anywhere; }
.owner-shell nav.side .brandname small { font-size:var(--font-size-caption); }
.owner-shell nav.side .navgroup { display:flex; flex-direction:column; gap:var(--space-4); }
.owner-shell nav.side .navfoot { margin-block-start:auto; padding-block-start:var(--space-32); }
.owner-shell nav.side a.navlink { min-height:48px; padding:10px var(--space-12); gap:var(--space-12); border-radius:var(--radius-control); font-size:var(--font-size-small); color:var(--color-ink); }
.owner-shell nav.side a.navlink.active { color:var(--color-accent); background:transparent; box-shadow:none; font-weight:600; }
.owner-shell nav.side a.navlink.active .ni { color:inherit; }
.owner-shell nav.side .ni { inline-size:22px; block-size:22px; flex:none; }
.owner-shell nav.side .navcount { color:var(--color-accent); background:transparent; }
.owner-shell nav.side .navlink:hover { background:var(--color-sand); }
.owner-shell .nav-more { display:none; }
.owner-shell .face { background:var(--color-sand); color:var(--color-ink-secondary); }
.owner-shell .btn.send.needs, .owner-shell .sp-send { color:var(--color-surface); background:var(--color-ink); border-color:var(--color-ink); }
.owner-shell .deeper, .owner-shell .back, .owner-shell .fmore, .owner-shell p a, .owner-shell .reading a { color:var(--color-accent); text-underline-offset:3px; }
.owner-shell .held-all, .owner-shell .notlive, .owner-shell .setup-strip { background:transparent; border:0; border-radius:0; box-shadow:none; color:var(--color-ink); }
.owner-shell .held-all { padding:var(--space-16) 0; border-block-end:1px solid var(--color-border); }
.owner-shell .fwarn, .owner-shell .perr, .owner-shell .fielderr { color:var(--color-ink); }
.owner-shell .sp-profit, .owner-shell .sp-late-d, .owner-shell .notlive { color:var(--color-ink); }
.owner-shell .sp-tline { stroke:var(--color-ink); }
.owner-shell .sp-tarea, .owner-shell .sp-tdot { fill:var(--color-ink); }
.owner-shell .sp-chip.is-waiting { color:var(--color-ink); background:transparent; }
.owner-shell .sp-stages li.is-waiting .sp-dot, .owner-shell .si-dot { color:var(--color-accent); }
.owner-shell .sp-stages li.is-waiting .sp-dot { border-color:var(--color-accent); }
.owner-shell .si-tab.on, .owner-shell .si-fil.on { color:var(--color-accent); border-color:var(--color-accent); }
.owner-shell .sp-phonedoor { display:none; }
.area-nav { padding:var(--space-12) var(--space-32) 0; border-block-end:1px solid var(--color-border); }
.area-links { display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-24); }
.area-nav a { display:flex; align-items:center; min-block-size:44px; font-size:var(--font-size-small); color:var(--color-ink-secondary); border-block-end:2px solid transparent; }
.area-nav a[aria-current] { color:var(--color-accent); font-weight:600; border-block-end-color:var(--color-accent); }
.area-chooser { display:none; }
.sp-priority { padding:0 ${GUT} 32px; }
.sp-priority .sp-decide { max-inline-size:840px; }
.sp-priority .sp-reply { background:var(--color-assistant-wash); }
.results-page, .setup-page { max-inline-size:960px; }
.results-header, .setup-intro { max-inline-size:70ch; margin-block-end:var(--space-32); }
.results-page .results-header > .tabs { flex-wrap:wrap; }
.results-page .results-header > .tabs > .tab { white-space:nowrap; }
.results-sections { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:var(--space-32); }
.results-section { min-inline-size:0; }
.results-section h2 { margin-block:0 var(--space-16); }
.results-totals { margin:0; }
.result-row { display:flex; justify-content:space-between; align-items:baseline; gap:var(--space-24); padding-block:var(--space-12); border-block-end:1px solid var(--color-border); }
.result-row dt { font-size:var(--font-size-base); }
.result-row dd { margin:0; font-variant-numeric:tabular-nums; text-align:end; }
.setup-steps { margin-block:var(--space-32); }
.setup-steps .guide-step { padding:var(--space-20) 0; border-block-start:1px solid var(--color-border); background:transparent; box-shadow:none; border-radius:0; }
.gs-heading { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-12) var(--space-20); }
.gs-heading h2 { margin:0; flex:1; }
.gs-heading .deeper { margin:0; }
.gs-help { max-inline-size:70ch; margin-block-start:var(--space-12); }
.readiness-section { margin-block-start:var(--space-40); }
.calendar-page .cal-date-choice { display:grid; grid-template-columns:minmax(0, 220px) auto; align-items:end; gap:var(--space-8) var(--space-12); max-inline-size:400px; margin-block:var(--space-16) var(--space-24); }
.cal-date-choice label { grid-column:1 / -1; font-size:var(--font-size-small); }
.cal-date-choice input { min-block-size:44px; }
.calendar-page .cal-grid { margin:0; border:0; padding:0; }
.calendar-page .cal-grid-label { font-size:var(--font-size-base); min-block-size:44px; }
.sp-from .mark { vertical-align:middle; margin-inline-end:var(--space-4); }
.sp-acts-more { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-16); margin-block-start:var(--space-12); }
@media (min-width:1200px) {
  .calendar-page .cal-grid { grid-column:1; grid-row:1; }
  .calendar-page .cal-list { grid-column:2; grid-row:1; }
  .calendar-page .cal-grid-label { display:none; }
}
@media (max-width:720px) {
  html:has(body.owner-shell) { scroll-padding-block-end:100px; }
  .owner-shell .layout { display:block; }
  .owner-shell .content { padding-block-end:88px; }
  .owner-shell nav.side { position:fixed; inset-block:auto 0; inset-inline:0; inline-size:100%; z-index:5; display:flex; flex-direction:row; align-items:stretch;
    padding:var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom)); gap:0; background:var(--color-surface); border-inline-end:0; border-block-end:0; border-block-start:1px solid var(--color-border); overflow:visible; animation:none; }
  .owner-shell nav.side .brand, .owner-shell nav.side a.nav-desktop, .owner-shell nav.side .sp-me { display:none; }
  .owner-shell nav.side .navgroup, .owner-shell nav.side .navfoot { display:contents; }
  .owner-shell nav.side a.navlink, .owner-shell nav.side .nav-more > summary { display:flex; flex:1 1 0; flex-direction:column; justify-content:center; align-items:center;
    min-inline-size:0; min-block-size:60px; padding:var(--space-4) 2px; gap:var(--space-4); font-size:var(--font-size-caption); border:0; animation:none; background:transparent; }
  .owner-shell nav.side a.nav-desktop { display:none; }
  .owner-shell nav.side .navcount { inset-block-start:0; inset-inline-start:calc(50% + 5px); background:var(--color-surface); }
  .owner-shell nav.side .nav-more { position:relative; display:block; flex:1 1 0; }
  .owner-shell nav.side .nav-more > summary { cursor:pointer; list-style:none; }
  .owner-shell .nav-more > summary::-webkit-details-marker { display:none; }
  .owner-shell .nav-more > summary::before { display:none; }
  .owner-shell .nav-more > summary.active { color:var(--color-accent); font-weight:600; }
  .owner-shell .nav-more-menu { position:absolute; inset-block-end:calc(100% + 8px); inset-inline-end:0; min-inline-size:220px; padding:var(--space-8);
    background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-control); }
  .owner-shell .nav-more-menu a { display:flex; gap:var(--space-12); align-items:center; min-block-size:48px; padding:var(--space-8); font-size:var(--font-size-base); }
  .owner-shell .nav-more-menu a[aria-current] { color:var(--color-accent); font-weight:600; }
  .area-nav { padding:var(--space-8) var(--space-16); }
  .area-links { display:none; }
  .area-chooser { display:block; margin:0; }
  .area-chooser > summary { display:flex; align-items:center; justify-content:space-between; min-block-size:44px; font-size:var(--font-size-base); list-style:none; }
  .area-chooser > summary::before, .area-chooser > summary::-webkit-details-marker { display:none; }
  .area-chooser > div { display:flex; flex-direction:column; padding-block-end:var(--space-8); }
  .area-nav a { min-block-size:48px; border:0; }
  .sp-priority { padding:0 var(--space-12) var(--space-24); }
  .calendar-page .cal-screen { display:flex; flex-direction:column; }
  .calendar-page .cal-list { order:0; }
  .calendar-page .cal-grid { order:1; inline-size:100%; }
  .calendar-page .cal-grid-label { display:flex; align-items:center; }
  .calendar-page .cal-date-choice { align-items:stretch; }
  .cal-date-choice label { flex:1; min-inline-size:0; }
  .cal-date-choice input { inline-size:100%; min-inline-size:0; }
  .sp-acts-more { align-items:flex-start; }
  .results-sections { grid-template-columns:minmax(0, 1fr); gap:var(--space-32); }
  .gs-heading { align-items:flex-start; }
  .gs-heading h2 { flex-basis:100%; }
}
`;
