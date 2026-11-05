import { SPLIT_TOKENS as K } from '../../core/owner/tokens.js';
import { inkWashDataUri } from '../../core/owner/brand.js';
import { SPLIT_FACES_CSS } from './type.js';

/**
 * THE SPLIT TODAY PREVIEW'S STYLESHEET (2026-11-04; docs/DESIGN-SYSTEM.md). Linked after the app's own sheet by the one
 * page drawn with `body.split`; no other page sees a rule of it. It re-points the shell's own custom properties inside
 * `.split`, so what the shell draws (the rail, a notice, a door, a toast) follows without a second copy of its rules.
 */

const serif = {
  en: '"Newsreader Variable", "Noto Serif SC", "Noto Naskh Arabic Variable", Georgia, serif',
  zh: '"Noto Serif SC", "Newsreader Variable", "Noto Naskh Arabic Variable", serif',
  ar: '"Noto Naskh Arabic Variable", "Newsreader Variable", "Noto Serif SC", serif',
};
/** The page's gutter: a wide screen centres the panels while the wash runs edge to edge. */
const GUT = `max(${K.space[24]}px, calc((100% - 1240px) / 2))`;

export const SPLIT_CSS = `${SPLIT_FACES_CSS}
.split {
  --font-voice:${serif.en};
  --color-brand:var(--color-ink); --color-needs:${K.color.ochreText}; --color-needs-wash:${K.color.ochreWash};
  --color-assistant:var(--color-ink); --color-assistant-wash:var(--color-paper);
  --color-ok:${K.color.jade}; --color-ok-wash:${K.color.jadeWash}; --color-warn:${K.color.ochreText}; --color-warn-wash:${K.color.ochreWash};
  --shadow-lift1:none; --shadow-lift2:none; --shadow-lift3:none;
  background:var(--color-paper);
}
html[lang="zh"] .split { --font-voice:${serif.zh}; }
html[lang="ar"] .split { --font-voice:${serif.ar}; }
.split .mark { --color-brand:${K.color.wine}; }
/* A customer with no photo: a neutral initial, one colour for everyone. */
.split .face { background:${K.color.neutral}; color:var(--color-ink-secondary); }

/* The rail */
.split nav.side { background:var(--color-paper); border-inline-end:1px solid var(--color-border); }
.split nav.side a.navlink.active { background:${K.color.neutral}; box-shadow:none; color:var(--color-ink); }
.split nav.side a.navlink.active .ni { color:var(--color-ink); }
.split .sp-me { display:flex; align-items:center; gap:${K.space[8]}px; min-height:44px; padding:${K.space[4]}px ${K.space[8]}px; color:var(--color-ink);
  font-size:var(--font-size-small); text-decoration:none; border-radius:${K.radius.control}px; }
.split .sp-me:hover { background:${K.color.neutral}; }

/* The page: a keyboard's focus never lands under the phone's tab bar */
html:has(body.split) { scroll-padding-block-end:96px; }
.split main.wide { max-inline-size:none; padding:0; }
.sp { padding-block-end:${K.space[32]}px; }
.sp-head { position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:${K.space[16]}px;
  padding:${K.space[32]}px ${GUT} ${K.space[24]}px; }
.sp-head { isolation:isolate; }
/* The wash keeps its own proportions, so it stays a brushed blot and never a row of streaks. It hangs past the header's foot and fades out by itself; the panels paint over what is left. It is decoration, so it follows the title to the other side, right to left. */
.sp-head::before { content:""; position:absolute; z-index:-1; inset-block-start:0; inset-inline:0; block-size:176px; pointer-events:none;
  background:url("${inkWashDataUri()}") top center / max(100%, 1100px) 100% no-repeat; }
html[dir="rtl"] .sp-head::before { transform:scaleX(-1); }
.sp-panels { position:relative; }
.sp-headmark { display:none; }
.split h1.page { margin:0; font-family:var(--font-voice); font-size:${K.size.title}px; font-weight:400; line-height:1.1; letter-spacing:-0.01em; color:var(--color-ink); }
html[lang="ar"] .split h1.page, html[lang="zh"] .split h1.page { letter-spacing:0; line-height:1.3; }
.sp-sub { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink); }
.sp-new { flex:none; margin:0; }
.sp-panels { display:grid; grid-template-columns:minmax(0, 1.15fr) minmax(0, 1fr); gap:${K.space[24]}px; padding-inline:${GUT}; align-items:start; }
.sp-panels.is-one { grid-template-columns:minmax(0, 720px); }
.sp-start { padding-inline:${GUT}; }
@media (max-width: 1100px) { .sp-panels { grid-template-columns:minmax(0, 1fr); } }

/* A panel: a heading on the paper, then flat cards with a hairline */
.sp-panel { display:grid; gap:${K.space[12]}px; min-inline-size:0; }
.sp-phead { display:flex; align-items:center; justify-content:space-between; gap:${K.space[12]}px; min-block-size:44px; }
.sp-phead h2 { display:flex; align-items:center; gap:${K.space[8]}px; margin:0; font-family:var(--font-voice); font-size:${K.size.name}px; font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-phead .ni { inline-size:22px; block-size:22px; }
.sp-phead .deeper { margin:0; font-size:var(--font-size-small); }
.sp-phead .sp-cap { margin:0; }
.sp-card { padding:${K.space[20]}px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:${K.radius.panel}px; min-inline-size:0; }
.sp-card > *:first-child { margin-block-start:0; }
.sp-card h3 { margin:0; font-family:var(--font-voice); font-size:${K.size.name}px; font-weight:500; line-height:1.3; letter-spacing:0; color:var(--color-ink); }
.sp-cap { margin:0 0 ${K.space[12]}px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-card h3.sp-cap { margin-block-end:${K.space[16]}px; font-family:inherit; font-size:var(--font-size-small); font-weight:500; line-height:1.4; color:var(--color-ink-secondary); }
.sp-phead h3.sp-cap { margin:0; }
/* One flat sheet per panel: its parts are ruled apart, never boxed apart. */
.sp-sheet { background:var(--color-surface); border:1px solid var(--color-border); border-radius:${K.radius.panel}px; min-inline-size:0; }
.sp-sheet > .sp-card { background:transparent; border:0; border-radius:0; border-block-start:1px solid var(--color-border); padding-block:${K.space[16]}px; }
.sp-sheet > .sp-card:first-child { border-block-start:0; }
.sp-sheet > .sp-decide { padding-block-start:${K.space[20]}px; }
.sp-sheet > .sp-door { padding-block:${K.space[12]}px; }

/* Buttons: one filled magenta, on Send; everything else outlined */
.sp-btn { display:inline-flex; align-items:center; justify-content:center; min-block-size:44px; padding:0 ${K.space[20]}px; cursor:pointer;
  font:inherit; font-size:var(--font-size-small); font-weight:500; color:var(--color-ink); background:var(--color-surface);
  border:1px solid var(--color-ink-secondary); border-radius:${K.radius.control}px; }
.sp-btn:hover { background:${K.color.neutral}; }
.sp-btn:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }
.sp-btn.sp-send { color:${K.color.onSend}; background:${K.color.magenta}; border-color:${K.color.magenta}; }
.sp-btn.sp-send:hover { background:${K.color.magenta}; filter:brightness(0.92); }
.sp-btn.sp-quiet { min-block-size:36px; padding-inline:${K.space[12]}px; font-size:var(--font-size-caption); }
.sp-remind { margin:0; }

/* The decision card */
.sp-who { display:flex; align-items:center; gap:${K.space[16]}px; min-inline-size:0; }
.sp-who .face { inline-size:72px; block-size:72px; font-size:${K.size.question}px; }
.sp-who-t { min-inline-size:0; }
.sp-name { display:block; font-family:var(--font-voice); font-size:${K.size.name}px; font-weight:500; line-height:1.3; color:var(--color-ink); text-decoration:none; overflow-wrap:anywhere; }
.sp-name:hover { text-decoration:underline; }
.sp-deal { display:flex; align-items:center; gap:${K.space[8]}px; margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink); }
.sp-from { margin:${K.space[4]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-thumb { display:inline-block; flex:none; inline-size:36px; block-size:36px; object-fit:cover; border-radius:${K.radius.thumb}px; background:${K.color.neutral}; }
.sp-thumb-s { inline-size:28px; block-size:28px; }
.sp-thumb-none { background:transparent; }
.sp-q { margin:${K.space[16]}px 0 ${K.space[8]}px !important; font-size:${K.size.question}px !important; font-weight:400 !important; line-height:1.25 !important; }
.sp-form { margin:0; }
.sp-reply { display:block; inline-size:100%; margin:0 0 ${K.space[12]}px; padding:${K.space[12]}px; font:inherit; font-size:var(--font-size-small); line-height:1.55; color:var(--color-ink);
  background:var(--color-paper); border:1px solid var(--color-border); border-radius:${K.radius.control}px; resize:vertical; field-sizing:content; }
.sp-reply:focus { outline:2px solid var(--color-ink); outline-offset:1px; background:var(--color-surface); }
.sp-acts { display:flex; flex-wrap:wrap; gap:${K.space[8]}px; }
.sp-window { margin:${K.space[8]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-decide details.reading { margin-block-start:${K.space[12]}px; }

/* What else waits */
.sp-also { margin-block-start:${K.space[16]}px; padding-block-start:${K.space[16]}px; border-block-start:1px solid var(--color-border); }
.sp-also:first-child { margin-block-start:0; padding-block-start:0; border-block-start:0; }
.split .tw-head, .split .tw-need { color:var(--color-ink); }
.split .tw-note { background:transparent; border:0; padding:0; margin:0 0 ${K.space[12]}px; }
.split .notlive { margin:0 0 ${K.space[12]}px; color:${K.color.ochreText}; font-size:var(--font-size-small); }
.split .today-foot { margin:0; font-size:var(--font-size-caption); }
.sp-notices:empty { display:none; }

/* The stage strip */
.sp-stages { display:flex; margin:0; padding:0; list-style:none; }
.sp-stages li { position:relative; flex:1 1 0; min-inline-size:0; display:flex; flex-direction:column; align-items:center; text-align:center; padding-block-start:${K.space[20]}px; }
.sp-stages li::before { content:""; position:absolute; inset-block-start:6px; inset-inline-start:50%; inline-size:100%; block-size:1px; background:var(--color-border); }
.sp-stages li:last-child::before { display:none; }
.sp-dot { position:absolute; inset-block-start:0; z-index:1; inline-size:13px; block-size:13px; border-radius:50%; background:var(--color-surface); border:2px solid var(--color-border); }
.sp-stages li.is-done .sp-dot { background:${K.color.jade}; border-color:${K.color.jade}; }
.sp-stages li.is-waiting .sp-dot { border-color:${K.color.ochre}; }
.sp-stage { font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-fig { font-size:var(--font-size-small); font-weight:600; color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-val { font-size:var(--font-size-caption); color:var(--color-ink); font-variant-numeric:lining-nums; overflow-wrap:anywhere; }

/* Rows */
.sp-rows { display:block; margin:0; padding:0; list-style:none; }
.sp-row { display:grid; grid-template-columns:36px minmax(0, 1fr) 28px 96px 72px 40px 16px; align-items:center; gap:${K.space[8]}px ${K.space[12]}px; min-block-size:52px; padding-block:${K.space[8]}px;
  color:var(--color-ink); text-decoration:none; border-block-start:1px solid var(--color-border); }
.sp-rows li:first-child .sp-row { border-block-start:0; }
.sp-row:hover .sp-rname { text-decoration:underline; }
.sp-row .face { inline-size:36px; block-size:36px; font-size:var(--font-size-small); }
.sp-rname { display:block; text-align:match-parent; font-size:var(--font-size-small); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* A name in the other direction keeps the page's edge: its own "end" is the page's "start". */
[dir="rtl"] .sp-rname:dir(ltr), [dir="ltr"] .sp-rname:dir(rtl) { text-align:end; }
.sp-rval { font-size:var(--font-size-small); text-align:end; font-variant-numeric:lining-nums tabular-nums; white-space:nowrap; }
.sp-rday { font-size:var(--font-size-caption); color:var(--color-ink-secondary); text-align:end; white-space:nowrap; }
.sp-chip { justify-self:start; padding:2px ${K.space[8]}px; font-size:var(--font-size-caption); line-height:1.5; white-space:nowrap; color:var(--color-ink-secondary); background:${K.color.neutral}; border-radius:${K.radius.chip}px; }
.sp-chip.is-order, .sp-chip.is-done { color:${K.color.jade}; background:${K.color.jadeWash}; }
.sp-chip.is-waiting { color:${K.color.ochreText}; background:${K.color.ochreWash}; }
.sp-row .go { justify-self:end; color:var(--color-ink-secondary); }
.sp-row.sp-entry { grid-template-columns:36px minmax(0, 1fr) 96px 72px 60px 16px; }


/* The Inbox: its views over one flat sheet of Today's rows */
.si-body { position:relative; padding-inline:${GUT}; }
.si-tabs { display:flex; gap:${K.space[4]}px; margin-block-end:${K.space[12]}px; overflow-x:auto; scrollbar-width:none; border-block-end:1px solid var(--color-border); }
.si-tab { display:inline-flex; flex:none; align-items:center; gap:${K.space[8]}px; min-block-size:44px; padding-inline:${K.space[12]}px; font-size:var(--font-size-small); color:var(--color-ink-secondary); text-decoration:none; white-space:nowrap; border-block-end:2px solid transparent; }
.si-tab:hover { color:var(--color-ink); }
.si-tab.on { color:var(--color-ink); font-weight:600; border-block-end-color:var(--color-ink); }
.si-tab:focus-visible, .si-fil:focus-visible, .si-door:focus-visible::after { outline:2px solid var(--color-ink); outline-offset:-2px; }
.si-tabn { font-size:var(--font-size-caption); font-weight:400; font-variant-numeric:lining-nums tabular-nums; }
.si-tools { display:grid; gap:${K.space[8]}px; padding:${K.space[16]}px ${K.space[20]}px ${K.space[8]}px; border-block-end:1px solid var(--color-border); }
.si-search { display:flex; gap:${K.space[8]}px; margin:0; }
.split .si-search input[type="search"] { flex:1 1 auto; inline-size:auto; min-inline-size:0; block-size:44px; min-block-size:44px; margin:0; padding:0 ${K.space[12]}px; box-shadow:none; font:inherit; font-size:var(--font-size-small); color:var(--color-ink); background:var(--color-paper); border:1px solid var(--color-border); border-radius:${K.radius.control}px; }
.split .si-search input[type="search"]:focus { outline:2px solid var(--color-ink); outline-offset:1px; background:var(--color-surface); }
.si-filters { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0 ${K.space[16]}px; }
.si-fils { display:flex; align-items:center; gap:${K.space[4]}px; min-inline-size:0; overflow-x:auto; scrollbar-width:none; }
.si-fil { position:relative; isolation:isolate; display:inline-flex; flex:none; align-items:center; min-block-size:44px; padding-inline:${K.space[12]}px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); text-decoration:none; white-space:nowrap; border-radius:${K.radius.control}px; }
.si-fil:hover { color:var(--color-ink); }
.si-fil.on { color:var(--color-ink); font-weight:600; }
/* The chosen one is a chip within its 44 px of reach. */
.si-fil.on::before { content:""; position:absolute; z-index:-1; inset-block:${K.space[8]}px; inset-inline:0; background:${K.color.neutral}; border-radius:${K.radius.chip}px; }
.si-found { margin:0 0 ${K.space[8]}px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.si-list { padding-inline:${K.space[20]}px; }
.si-group + .si-group { border-block-start:1px solid var(--color-border); }
.si-group > .sp-cap { margin:0; padding-block:${K.space[12]}px ${K.space[4]}px; font-size:var(--font-size-caption); font-weight:500; color:var(--color-ink-secondary); }
.si-group > h2.sp-cap + .sp-rows li:first-child .sp-row { border-block-start:0; }
.si-row { position:relative; grid-template-columns:8px 36px minmax(0, 1fr) 28px 96px 88px 40px 16px; }
.si-row .si-face { position:relative; z-index:1; display:block; line-height:0; border-radius:50%; }
.si-row:hover .sp-rname { text-decoration:underline; }
.si-dot { display:flex; align-items:center; justify-content:center; }
.split .si-dot .row-dot { flex:none; inline-size:8px; block-size:8px; border-radius:50%; background:${K.color.wine}; }
.si-who { min-inline-size:0; }
.si-door { display:block; color:inherit; text-decoration:none; }
.si-door::after { content:""; position:absolute; inset:0; border-radius:${K.radius.thumb}px; }
.si-row.is-new .sp-rname { font-weight:700; }
.si-line { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 ${K.space[8]}px; min-inline-size:0; }
.si-why { font-size:var(--font-size-caption); line-height:1.4; color:var(--color-ink-secondary); }
/* The last message: one faded line, cut by the isolate that holds it. */
.si-said { flex:1 1 40%; display:flex; align-items:baseline; gap:${K.space[4]}px; min-inline-size:0; font-size:var(--font-size-caption); line-height:1.4; color:var(--color-ink-secondary); }
.si-by { flex:none; }
.si-last { flex:1 1 auto; min-inline-size:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; text-align:match-parent; }
[dir="rtl"] .si-last:dir(ltr), [dir="ltr"] .si-last:dir(rtl) { text-align:end; }
.si-row.is-needs .si-why { color:${K.color.ochreText}; }
.si-empty { margin:0; padding-block:${K.space[24]}px; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.si-empty strong { color:var(--color-ink); font-weight:600; }
.si-emptydoor { padding-block-end:${K.space[24]}px; }
.si-pager { display:flex; align-items:center; justify-content:space-between; gap:${K.space[12]}px; min-block-size:44px; padding-inline:${K.space[20]}px; font-size:var(--font-size-small); }
.si-pager .deeper, .si-pager .back { margin:0; }
.si-doors { display:flex; flex-wrap:wrap; gap:${K.space[4]}px ${K.space[20]}px; padding-block-start:${K.space[16]}px; font-size:var(--font-size-small); }
.si-doors .deeper { margin:0; }

/* The list of who else waits sits on the sheet, at its edge */
.split .tw-list { background:transparent; box-shadow:none; }
.split .tw-item { padding-inline-start:0; }

/* Books */
.sp-money { display:grid; grid-template-columns:minmax(0, 1fr) 150px; gap:${K.space[4]}px ${K.space[16]}px; align-items:end; }
.sp-money h3 { grid-column:1 / -1; }
.sp-inout { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); color:var(--color-ink); font-variant-numeric:lining-nums; }
.sp-profit { display:flex; flex-wrap:wrap; align-items:baseline; gap:${K.space[8]}px; margin:${K.space[8]}px 0 0; font-family:var(--font-voice); font-size:${K.size.name}px; color:${K.color.jade}; }
.sp-profit.is-down { color:var(--color-ink); }
.sp-big { font-size:${K.size.money}px; line-height:1.1; font-variant-numeric:lining-nums; }
.sp-trend { display:block; margin:0; }
.sp-tarea { fill:${K.color.jade}; fill-opacity:0.1; }
.sp-tline { fill:none; stroke:${K.color.jade}; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.sp-tdot { fill:${K.color.jade}; stroke:var(--color-surface); stroke-width:2; }
.sp-trend svg { display:block; inline-size:100%; block-size:auto; overflow:visible; }
.sp-owed { margin:${K.space[4]}px 0 0; font-size:var(--font-size-small); font-variant-numeric:lining-nums; }
.sp-over { margin:${K.space[4]}px 0 0; font-family:var(--font-voice); font-size:${K.size.name}px; font-weight:700; color:${K.color.ochre}; }
.sp-note { margin:${K.space[4]}px 0 0; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
.sp-late { display:flex; flex-wrap:wrap; align-items:center; gap:${K.space[8]}px ${K.space[12]}px; margin-block-start:${K.space[12]}px; padding-block-start:${K.space[12]}px; border-block-start:1px solid var(--color-border); font-size:var(--font-size-small); }
.sp-late .face { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
.sp-late-n { font-weight:500; min-inline-size:0; overflow-wrap:anywhere; }
.sp-late-d { color:${K.color.ochreText}; font-size:var(--font-size-caption); }
.sp-remind { margin-inline-start:auto; }
.sp-door { display:flex; align-items:center; gap:${K.space[12]}px; min-block-size:44px; color:var(--color-ink); text-decoration:none; font-size:var(--font-size-small); }
.sp-door:hover { text-decoration:underline; }
.sp-door > .go { margin-inline-start:auto; color:var(--color-ink-secondary); }
.sp-door .ni { inline-size:22px; block-size:22px; flex:none; }
.sp-phonedoor { display:none; }

/* A phone: Sales first, Books below, the tab bar at the foot */
@media (max-width: 720px) {
  .split nav.side { position:fixed; inset-block:auto 0; inset-inline:0; z-index:5; padding:${K.space[4]}px ${K.space[4]}px calc(${K.space[4]}px + env(safe-area-inset-bottom));
    background:var(--color-surface); border-inline-end:0; border-block-end:0; border-block-start:1px solid var(--color-border); animation:none; }
  .split nav.side .brand, .split .sp-me, .split nav.side a.navlink.sp-notab { display:none; }
  .split nav.side a.navlink { min-block-size:56px; gap:${K.space[4]}px; animation:none; }
  .split nav.side a.navlink.active { background:transparent; font-weight:600; }
  .split nav.side .ni { inline-size:24px; block-size:24px; }
  .split .business-name { display:none; }
  .split .content { padding-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .split .toasts { inset-block-end:calc(84px + env(safe-area-inset-bottom)); }
  .sp-head { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:0 ${K.space[12]}px; padding:${K.space[16]}px ${K.space[16]}px ${K.space[12]}px; }
  .sp-headmark { display:block; line-height:0; }
  .sp-headt { display:contents; }
  .sp-headt > :not(h1) { grid-column:1 / -1; grid-row:2; }
  .sp-new { grid-column:3; grid-row:1; }
  .sp-new .sp-btn { min-block-size:40px; padding-inline:${K.space[12]}px; }
  .split h1.page { font-size:${K.size.titlePhone}px; }
  .sp-panels { gap:${K.space[20]}px; padding-inline:${K.space[12]}px; }
  .sp-start { padding-inline:${K.space[12]}px; }
  .sp-card { padding:${K.space[16]}px; }
  .sp-who .face { inline-size:56px; block-size:56px; font-size:var(--font-size-title); }
  .sp-acts .sp-btn { flex:1 1 auto; }
  .sp-row { grid-template-columns:36px 28px minmax(0, 1fr) auto 14px; grid-template-areas:"face thumb name val go" "face thumb chip day go"; gap:${K.space[4]}px ${K.space[8]}px; }
  .sp-row .face { grid-area:face; }
  .sp-row .sp-thumb { grid-area:thumb; }
  .sp-rname { grid-area:name; }
  .sp-chip { grid-area:chip; }
  .sp-rval { grid-area:val; }
  .sp-rday { grid-area:day; }
  .sp-row .go { grid-area:go; }
  .sp-row.sp-entry { grid-template-columns:36px minmax(0, 1fr) auto 14px; grid-template-areas:"face name val go" "face chip day go"; }
  .si-body { padding-inline:${K.space[12]}px; }
  .si-tools { padding:${K.space[12]}px ${K.space[12]}px ${K.space[4]}px; }
  .si-filters { flex-direction:column; align-items:stretch; }
  .si-list, .si-pager { padding-inline:${K.space[12]}px; }
  .si-tab { padding-inline:${K.space[8]}px; }
  .si-fil { padding-inline:${K.space[8]}px; }
  .si-doors { padding-inline:${K.space[4]}px; }
  .si-row { grid-template-columns:8px 36px 28px auto minmax(0, 1fr) auto 14px; grid-template-areas:"dot face thumb name name val go" "dot face thumb chip why day go" "dot face thumb said said said go"; gap:${K.space[4]}px ${K.space[8]}px; }
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
  .sp-big { font-size:${K.size.moneyPhone}px; }
  .sp-phonedoor { display:block; padding:${K.space[16]}px ${K.space[16]}px 0; }
}
`;
