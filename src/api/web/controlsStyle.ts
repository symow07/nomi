import { iconImage, iconMask } from './icons.js';

/**
 * THE CONTROLS PASS (2026-11-25) — the owner's comparison with Intercom found that nothing on screen was a shared
 * part: the text box was restyled by hand in a dozen places (44, 48 and 51 px tall, two text sizes), buttons came
 * in fifteen height and padding pairs, page titles in seven sizes, the reply box differed per page, and the page's
 * edge moved from tab to tab. Each page drew its own, so every page came out slightly different.
 *
 * This sheet is the one definition of each shared part, linked LAST on every signed-in page, so it is what a page
 * looks like whatever an older area rule said:
 *
 *   1. the text box (input, select, textarea): 40 px on a desk, 44 px under a finger, one padding, one edge;
 *   2. the button: a 36 px pill on a desk, 44 px under a finger; the main act ink, the rest white on a hairline;
 *   3. the page header: one title size, the page's actions at its far end, a hairline under it;
 *   4. the list row: one height, one hover, one "open now" tile;
 *   5. one "you are here": the white tile the rail already uses, on every menu and every tab row.
 *
 * A field that is deliberately frameless (inside a frame that is the box, as the reply box is) carries `bare`.
 * Sizes come from the `controlPx` tokens; nothing here types its own height.
 */
const FIELD = ':is(input:where(:not([type=checkbox], [type=radio], [type=file], [type=range], [type=color], [type=hidden], '
  + '[type=submit], [type=button], [type=reset], [type=image])), select, textarea):not(.bare)';
const LINE = 'input:where(:not([type=checkbox], [type=radio], [type=file], [type=range], [type=color], [type=hidden], '
  + '[type=submit], [type=button], [type=reset], [type=image])):not(.bare), select:not(.bare)';
const BUTTON = ':is(.btn, .sp-btn)';
/** Where the field rules reach: the page and its dialogs (a class, so the field rule outranks the older area rules). */
const AT = '.owner-shell :is(.layout, dialog)';

export const CONTROLS_CSS = `

/* 1 · The text box. */
${AT} ${FIELD} { box-sizing:border-box; min-block-size:var(--control-field); padding:var(--space-8) var(--space-12);
  font-size:var(--font-size-base); line-height:1.4; color:var(--color-ink); background:var(--color-surface);
  border:1px solid var(--color-control-line); border-radius:var(--radius-control); box-shadow:none; }
${AT} :is(${LINE}) { block-size:var(--control-field); padding-block:0; }
/* A text box grows with its words and is never pulled by hand (the owner, 2026-11-26): two lines to start, half the window
   at most, then it scrolls. No margin of its own, so the gap under its label is the same as an input's. */
${AT} textarea:not(.bare) { inline-size:100%; min-block-size:calc(2 * var(--control-field)); max-block-size:50vh; margin-block:0;
  line-height:var(--line-height); resize:none; field-sizing:content; overflow-y:auto; }
/* One width for a form's fields: a line long enough for an address, never the whole page across. A search, and the
   reply boxes (Today, the conversation, a question to the assistant), keep their row's full width. */
${AT} ${FIELD}:not([type=search], .sp-form *, .approve *, .replyform *, .ask-form *, .cp-question *, .adv-box *, td *) { max-inline-size:var(--measure-prose); }
.owner-shell .pform { max-inline-size:var(--measure-prose); }
/* A field with its one button (a label to add): one row, the field taking the room, the button drawn as a button. */
.owner-shell form.label-add { display:flex; align-items:center; gap:var(--space-8); }
.owner-shell form.label-add > input { flex:1 1 auto; inline-size:auto; min-inline-size:0; margin:0; }
.owner-shell form.label-add > .btn { flex:none; border-color:var(--color-control-line); }
/* A group of fields is a heading and its fields, not a drawn box. */
${AT} fieldset:not(.bare) { border:0; padding:0; margin-inline:0; min-inline-size:0; }
${AT} fieldset:not(.bare) > legend { padding:0; margin-block-end:var(--space-8); font-weight:600; }
${AT} ${FIELD}:hover { border-color:var(--color-ink-secondary); }
${AT} ${FIELD}:focus, ${AT} ${FIELD}:focus-visible { border-color:var(--color-ink); }
${AT} ${FIELD}::placeholder { color:var(--color-ink-secondary); opacity:1; }
${AT} ${FIELD}[aria-invalid="true"] { border-color:var(--color-warn); }
/* A search box carries its mark inside it, where the words begin; the page's own Find button is for a keyboard and
   a screen reader only (Enter submits the form). */
${AT} input[type=search]:not(.bare) { padding-inline-start:calc(var(--space-12) + 16px + var(--space-8)); background:var(--color-surface); }
.owner-shell .field-search { position:relative; display:flex; flex:1 1 auto; min-inline-size:0; }
.owner-shell .field-search > input { flex:1 1 auto; inline-size:100%; min-inline-size:0; margin:0; }
.owner-shell .field-search::before { content:""; position:absolute; z-index:1; inset-block:0; inset-inline-start:var(--space-12); inline-size:16px;
  margin-block:auto; block-size:16px; background:var(--color-ink-secondary); pointer-events:none; ${iconMask('search', 16, 1.5)} }
/* A list in the search's place is not a search: no magnifier is drawn over its first letter. */
.owner-shell .field-search:has(> select)::before { content:none; }
/* A select draws the same arrow as the rest of the app (not the browser's own), set in from the edge like the search's mark. */
${AT} select:not(.bare):not([multiple]) { appearance:none; -webkit-appearance:none; padding-inline-end:calc(var(--space-12) + 16px + var(--space-12));
  background-image:${iconImage('pick', 16, 1.5)}; background-repeat:no-repeat; background-size:16px 16px; background-position:right 14px center; }
[dir="rtl"] ${AT} select:not(.bare):not([multiple]) { background-position:left 14px center; }
/* Today's one column stands in the middle of the page (the owner, 2026-11-25), its head and every block in it; the help
   button keeps the corner every other page gives it. */
.owner-shell .sp-panels.is-one { justify-content:center; }
.owner-shell .sp-priority :is(.sp-decide, .sp-attention, .sp-notices) { margin-inline:auto; }
/* The cleanup (2026-11-26) - beside two panels the page has ONE left edge: the title's, the notices', the card's, Sales'. */
.owner-shell .sp:has(> .sp-panels:not(.is-one)) > .sp-priority :is(.sp-decide, .sp-attention, .sp-notices) { margin-inline:0; }
@media (min-width:721px) { .owner-shell .sp:has(> .sp-panels.is-one) > :is(.sp-head, .sp-setup) { box-sizing:content-box; max-inline-size:840px; margin-inline:auto; padding-inline:var(--space-24); } }
/* Its title starts on the column's edge, and its button ends on it once the "?" in the corner is clear of the column. */
@media (min-width:1320px) { .owner-shell .content:has(.sp > .sp-panels.is-one) .sp-head > .sp-new { margin-inline-end:0; } }
.owner-shell .content:has(.sp > .sp-panels.is-one) > .help-door { inset-inline-start:auto; inset-inline-end:var(--space-16); }
/* The view chooser is one column, so its select ends on the search box's edge (its Show button is only for no-script). */
.owner-shell .il-view-form { grid-template-columns:minmax(0, 1fr); }
.owner-shell .find-quiet { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; padding:0; border:0; min-block-size:0; }
/* A label sits above its field in the list's size; what is said under a field is a caption. */
.owner-shell main :is(.fld, .fr-name, label) { font-size:var(--font-size-small); }

/* 2 · The button. */
.owner-shell ${BUTTON} { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; gap:var(--space-8);
  min-block-size:var(--control-button); padding:0 var(--space-16); border-radius:var(--radius-chip);
  font-family:inherit; font-size:var(--font-size-small); font-weight:500; line-height:1.2;
  background:var(--color-surface); border:1px solid var(--color-border); color:var(--color-ink); }
.owner-shell ${BUTTON}:not(:disabled):not(.is-disabled):hover { background:var(--color-sand); border-color:var(--color-border); }
.owner-shell :is(.btn.send, .sp-btn.sp-send) { background:var(--color-ink); border-color:transparent; color:var(--color-surface); font-weight:600; }
.owner-shell :is(.btn.send, .sp-btn.sp-send):not(:disabled):not(.is-disabled):hover { background:var(--color-ink-secondary); border-color:transparent; filter:none; }
.owner-shell .btn.danger { background:var(--color-surface); border:1.5px solid var(--color-ink); color:var(--color-ink); font-weight:600; }
.owner-shell .btn.ghost { background:transparent; border-color:transparent; color:var(--color-ink-secondary); font-weight:400; }
.owner-shell .btn.ghost:not(:disabled):hover { background:transparent; color:var(--color-ink); }
/* One height for every button on a page, over the areas' older 44 px rules (a Cancel beside its Save, the conversation's
   head); the hidden Find button keeps no size at all. */
${AT} ${BUTTON}:not(.find-quiet) { min-block-size:var(--control-button); }
${AT} .find-quiet.find-quiet { min-block-size:0; min-inline-size:0; }
.owner-shell ${BUTTON} > svg { flex:none; inline-size:18px; block-size:18px; }
/* A button that opens a fold is a button like any other: no caret inside it. */
.owner-shell summary:is(.btn, .sp-btn)::before { content:none; display:none; }

/* 3 · The page header. One title size on every page; the actions at the far end of the title's row, on every page;
   a hairline under the row. */
/* One page width: every page fills the space beside the rail, with the same gutter, so no edge moves from tab to tab.
   Long words keep their own measure (measure-prose, measure-form) inside it. */
.owner-shell main { max-inline-size:none; padding:var(--space-24) max(var(--space-24), calc((100% - 1240px) / 2)) var(--space-48); }
.owner-shell .area-links { max-inline-size:none; margin-inline:0; padding-inline:max(var(--space-24), calc((100% - 1240px) / 2)); }
/* Every page's row of tabs sits in the middle of its column (the owner, 2026-11-25), with the same room on both sides as the
   help button takes on one. */
.owner-shell :is(.area-links, .content .ca-nav, .content .pa-nav, .content .sa-pages) { justify-content:center; }
.owner-shell .content :is(.ca-nav, .pa-nav, .sa-pages) { padding-inline-start:calc(44px + var(--space-8)); }
.owner-shell main.wide { padding:0; }
.owner-shell main h1.page, .owner-shell .il-header h1 { font-family:var(--font-family); font-size:var(--font-size-display); font-weight:600;
  line-height:var(--line-height-tight); letter-spacing:var(--tracking-tight); margin:0 0 var(--space-16); }
.owner-shell .page-head, .owner-shell .il-header { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-16);
  min-block-size:var(--control-header); margin:0 0 var(--space-24); padding-block-end:var(--space-12); border-block-end:1px solid var(--color-border); }
.owner-shell .page-head > h1, .owner-shell .il-header > h1 { flex:1 1 auto; margin:0; }
.owner-shell .page-head > .page-acts, .owner-shell .il-header > :is(.sp-new, .page-acts) { display:flex; flex-wrap:wrap; gap:var(--space-8); margin:0; margin-inline-start:auto; }
.owner-shell .il-header > .live { flex:0 0 100%; max-inline-size:none; order:9; }
.owner-shell .sp-new .sp-btn { white-space:nowrap; }
/* What is said about a page under its title is a caption-sized line, not a second paragraph size. */
.owner-shell main h1.page + :is(p, .lede, .intro) { font-size:var(--font-size-small); color:var(--color-ink-secondary); margin-block-start:calc(-1 * var(--space-8)); }
.owner-shell main h2 { font-size:var(--font-size-title); font-weight:600; }
.owner-shell main h2.sp-q { font-size:var(--font-size-title); font-weight:600; }

/* A search bar that is only its box: the label is the box's name, not a line over it. */
.owner-shell .fbar-alone .fbar-q > .fbar-l { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.owner-shell .fbar-alone .fbar-acts:not(:has(.fbar-clear)) { display:none; }
.owner-shell .fbar-alone { align-items:center; }

/* 4 · The list row. */
.owner-shell .sp-rows > li > .sp-row:hover { background:var(--color-paper); }
.owner-shell .il-page .si-row { min-block-size:var(--control-header); padding-block:var(--space-8); }
.owner-shell .il-page .sp-rname, .owner-shell .il-compact-list .sp-rname { font-size:var(--font-size-small); font-weight:600; }
.owner-shell .il-page :is(.si-why, .si-said), .owner-shell .il-compact-list :is(.si-why, .si-said) { font-size:var(--font-size-caption); }
.owner-shell .il-compact-list .si-row { min-block-size:var(--control-header); }
.owner-shell .ca-person .face-m { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
.owner-shell .il-compact-list .si-row.is-selected, .owner-shell .il-page .si-row.is-selected { background:var(--color-sand); border-inline-start-color:transparent; }
/* The text audit (2026-11-26): a product's row and a customer's row are the same row as every other list's. A product's
   tile is the field's height, and the row's words sit level with it (they sat at the row's top beside a centred tile). */
.owner-shell .pa-products .prod { min-block-size:var(--control-header); padding-block:var(--space-4); align-items:center; }
.owner-shell .pa-products .p-tag { margin-block:0; }
.owner-shell .products-page > .block { border:0; padding:0; margin-block:var(--space-16); }
.owner-shell .pa-products .pa-thumb { inline-size:var(--control-field); block-size:var(--control-field); }
.owner-shell .pa-products .pa-initial { font-size:var(--font-size-base); }
.owner-shell .pa-products .prod-b { margin-block-start:0; }
.owner-shell .ca-customers .ca-customer { min-block-size:var(--control-header); padding-block:var(--space-8); }

/* The open conversation's head, on a desk: who on the left and the tools on the right, in ONE row, with the facts and
   the state on the line under the name. The list beside it is the way back, so "Inbox" is not drawn twice. */
@media (min-width: 1100px) {
  .owner-shell .conversation-workspace .conv-top { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:start; column-gap:var(--space-16); }
  .owner-shell .conversation-workspace .conv-top > .dhead { display:contents; }
  .owner-shell .conversation-workspace .conv-top > .dhead > .back { display:none; }
  .owner-shell .conversation-workspace .conv-top > .dhead > .live { grid-column:1 / -1; grid-row:2; }
  .owner-shell .conversation-workspace .conv-top .conversation-actions { grid-column:2; grid-row:1; margin:0; padding-inline-end:var(--space-48); }
  .owner-shell .conversation-workspace .conv-top > .catchup { grid-column:1; grid-row:1; display:flex; flex-wrap:wrap; align-items:center; column-gap:var(--space-8); row-gap:0; }
  .owner-shell .conversation-workspace .catchup::after { content:""; order:3; flex-basis:100%; }
  .owner-shell .conversation-workspace .catchup > * { align-self:center; }
  .owner-shell .conversation-workspace .catchup > .face-link { order:0; align-self:center; }
  .owner-shell .conversation-workspace .catchup .face-l { inline-size:32px; block-size:32px; font-size:var(--font-size-small); }
  .owner-shell .conversation-workspace .catchup > h1.who { order:1; flex:1 1 0%; min-inline-size:0; overflow-wrap:anywhere; margin:0; font-size:var(--font-size-title); }
  /* The second test (2026-11-26) - a long name stays beside the face, in its own column, on two lines at most (the panel has it whole). */
  .owner-shell .conversation-workspace .catchup > h1.who { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow:hidden; }
  /* One line under the name, as wide as the head: the tools beside the name are one row tall, so the line runs under them. */
  .owner-shell .conversation-workspace .conv-top { container-type:inline-size; }
  .owner-shell .conversation-workspace .catchup > .cu-line { order:4; flex:0 0 auto; inline-size:max-content; max-inline-size:calc(100cqi - 32px - var(--space-8)); margin:0; margin-block-start:var(--space-4); margin-inline-start:calc(32px + var(--space-8)); }
  .owner-shell .conversation-workspace .catchup > .cu-line > p { margin:0; font-size:var(--font-size-caption); }
}

/* 5 · One "you are here" in a menu down the side: the rail's own — a sand tile, its word in weight — on the Inbox's
   views and Settings' sections alike. A row of tabs across the top keeps its underline (a different shape of menu). */
.owner-shell :is(.il-views .si-tab, :is(.sa-nav, .aa-nav, .ba-nav) a:not(.sa-index)) { display:flex; align-items:center; min-block-size:var(--control-button); padding:var(--space-4) var(--space-12);
  border:0; border-radius:var(--radius-control); font-size:var(--font-size-small); color:var(--color-ink); font-weight:500; text-decoration:none; }
.owner-shell :is(.il-views .si-tab.on, :is(.sa-nav, .aa-nav, .ba-nav) a[aria-current]:not(.sa-index)) { background:var(--color-sand); color:var(--color-ink); font-weight:600; box-shadow:none; }
.owner-shell :is(.il-views .si-tab:not(.on), :is(.sa-nav, .aa-nav, .ba-nav) a:not([aria-current]):not(.sa-index)):hover { background:var(--color-surface); }
.owner-shell .il-views .si-tabn { color:var(--color-ink-secondary); font-weight:400; }
.owner-shell .ca-customers > .ca-customer { padding-block:var(--space-8); }
/* Settings has two layers of way, as Intercom's does: its menu and the page. Where the menu and the section's tabs are
   drawn, the back link over a title is a third, and goes; a phone, which has neither, keeps it. */
@media (min-width: 601px) { .owner-shell .sa-content > a.back:has(+ h1.page) { display:none; } }

/* The reply box (Today and the conversation, on a desk): the words in their own box, the answers on one row under it
   — never inside it (the owner, 2026-11-25) — the main act at the far end. A phone keeps its band (conversationStyle.ts). */
@media (min-width: 721px) {
  .owner-shell :is(form.sp-form, .conv-acts form.approve) { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); }
  .owner-shell :is(form.sp-form, .conv-acts form.approve) > :not(.sp-acts, .acts, .sp-acts-more, input[type=hidden], label.sr) { flex:1 1 100%; }
  ${AT} :is(form.sp-form, .conv-acts form.approve) > textarea { box-sizing:border-box; inline-size:100%; margin:0 0 var(--space-4); }
  .owner-shell :is(form.sp-form > .sp-acts, .conv-acts form.approve > .acts) { display:flex; flex-wrap:wrap; gap:var(--space-8); margin:0; margin-inline-start:auto; order:2; }
  .owner-shell :is(form.sp-form > .sp-acts, .conv-acts form.approve > .acts) > :is(.send, .sp-send) { order:2; }
  .owner-shell form.sp-form > .sp-acts-more { display:contents; }
  .owner-shell form.sp-form > .sp-acts-more > .sp-btn { order:1; }
  .owner-shell form.sp-form > .sp-acts-more > .sp-window { order:3; flex:1 1 100%; padding-inline:var(--space-4); }
  .owner-shell form.sp-form > .sp-acts-more .sp-window, .owner-shell .conv-acts #approve .acts-more .src { font-size:var(--font-size-caption); color:var(--color-ink-secondary); margin:0; }
  /* The cleanup (2026-11-26) - "No reply needed" stands in the answers' row, at its start; the window's line under the
     row. The form is drawn up over the row and lets a press through to the two answers beside its own button. */
  .owner-shell .conv-acts #approve .acts-more { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-12); margin-block:calc(-44px - var(--space-8)) 0; pointer-events:none; }
  .owner-shell .conv-acts #approve .acts-more > * { pointer-events:auto; }
  .owner-shell .conv-acts #approve .acts-more .src { flex:1 1 100%; text-align:start; }
  .owner-shell .conv-acts form.approve > .acts { min-block-size:44px; }
  /* What to check before sending: each on its own line, starting where the fold's words start (not under its arrow). */
  .owner-shell :is(.conv-acts, .sp-decide) details.reading > summary { flex-wrap:wrap; }
  .owner-shell :is(.conv-acts, .sp-decide) details.reading > summary .c.check { flex:1 1 100%; padding-inline-start:calc(16px + var(--space-8)); }
}
/* The text pass (2026-11-26) — an explanation that is wanted sometimes, never always: folded under its own name, opened by a tap, a click or the keyboard (a title attribute reaches no finger). One look on every page. */
.owner-shell details.note-fold { margin:0; padding:0; border:0; }
.owner-shell details.note-fold > summary { color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
.owner-shell details.note-fold > :not(summary) { margin:0 0 var(--space-8); color:var(--color-ink-secondary); font-size:var(--font-size-caption); }
/* The framed box under a conversation holds its contents a step in from its edge, like every other card. */
@media (min-width: 1100px) { .conversation-workspace .conv-acts:not(:empty) { padding-inline:var(--space-16); } }

/* Under a finger (a phone's width, or any touch screen): every field, button and menu row grows to the 44 px target, and a field's words stay 16 px (below that a phone zooms the page on a field). */
@media (max-width: 720px), (pointer: coarse) {
  ${AT} ${FIELD} { min-block-size:var(--control-touch); font-size:var(--font-size-field); }
  ${AT} :is(${LINE}) { block-size:var(--control-touch); }
  ${AT} textarea:not(.bare) { min-block-size:calc(2 * var(--control-touch)); }
  .owner-shell ${BUTTON}, ${AT} ${BUTTON}:not(.find-quiet) { min-block-size:var(--control-touch); }
  .owner-shell :is(.il-views .si-tab, :is(.sa-nav, .aa-nav, .ba-nav) a:not(.sa-index)) { min-block-size:var(--control-touch); }
}

/* The second test (2026-11-26) - a search box narrower than its hint ends the hint with an ellipsis, not mid-letter. */
.owner-shell input[type="search"] { text-overflow:ellipsis; }
`;
