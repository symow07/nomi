/** A phone's conversation: the screen's column, the tab bar's set height, and the band's parts (see the sheet's own note). */
const PAGE = '.owner-shell .layout:has(.conversation-workspace)';
const BAR = 'calc(69px + env(safe-area-inset-bottom))';
/** The screen's column while the named band is on it: the conversation shown (no tool pane over it) and that band drawn. */
const shown = (band: string, more = ''): string =>
  `.owner-shell .layout:has(.conversation-workspace:not([data-tool-open]) .conv-acts[data-band="${band}"]${more}):not(:has(#customer:target))`;
const ACTS = '.conversation-workspace .conv-acts';
const APPROVE = `${ACTS}[data-band="approve"] form.approve`;
const QUIET = `${ACTS}[data-band="approve"] #approve .acts-more .btn`;
const REPLY = `${ACTS}[data-band="reply"] .replyform .answer`;
const ORDER = `${ACTS}[data-band="order"] #order .answer`;
const TAKE = `${ACTS}[data-band="take"] .takeover > form.answer`;
const BAND = [APPROVE, REPLY, ORDER, TAKE];
const ANSWERS = [`${APPROVE} .acts .btn`, QUIET, `${REPLY} > .btn`, `${ORDER} .btn`, `${TAKE} .btn`];
/** One band's height, written twice from one figure: the room the region gives up while it is drawn, and its own. */
const sized = (name: string, sel: string, size: string, more = ''): string =>
  `${shown(name, more)} > .content { margin-block-end:${size}; }\n  ${sel} { block-size:${size}; }`;

/** Shared Inbox conversation layout. All state colors and type come from the owner theme. */
export const CONVERSATION_CSS = `
.conversation-workspace { --font-voice:var(--font-family); display:block; min-width:0; background:var(--color-surface); }
.conversation-workspace > .conv { min-width:0; padding:var(--space-16); background:var(--color-surface); }
.conversation-workspace > .listpane { display:none; }
/* F44: a conversation is routine work, opened many times a day. Its answers are there when the page is: the card a reply
   waits in does not rise in again on every arrival (the page's own transition carries it), so Send is never hidden for
   its delay. And on a phone an entrance would leave a transform on the card, which carries the band fixed inside it. */
.conversation-workspace #approve, .conversation-workspace #order, .conversation-workspace .conv-acts[data-band] > .card { animation:none; }
.conversation-workspace .catchup { border:0; border-block-end:1px solid var(--color-border); border-radius:0; background:none; padding:0 0 var(--space-16); }
.conversation-workspace .catchup h1.who { font-size:var(--font-size-title); }
/* THE UI CORRECTION (2026-11-13, audit F12) — the compact head. One row: the way back, the live line, the two tools
   and "More"; then who (face, name, channel on one line), the facts and the state. Ask Nomi is a quiet button here:
   the one fill on this page is the act on the reply below. */
.conversation-workspace .conv-top { padding-block-end:var(--space-12); border-block-end:1px solid var(--color-border); }
.conversation-workspace .conv-top .dhead { margin-block-end:var(--space-4); gap:var(--space-8) var(--space-12); }
/* A phone: the way back, Ask Nomi and More share the first row; the customer's door takes the next. */
@media (max-width:1099px) {
  .conversation-workspace .conv-top .conversation-actions { display:contents; }
  .conversation-workspace .conv-top .dhead > .back { order:1; margin-inline-end:auto; }
  .conversation-workspace .conv-top .conversation-actions > form { order:2; }
  .conversation-workspace .conv-top .conv-more { order:3; }
  .conversation-workspace .conv-top .dhead > .live { order:4; flex-basis:100%; }
  .conversation-workspace .conv-top .conversation-actions > .file-door { order:5; flex-basis:100%; margin:0; }
}
/* A phone (the fix rounds of 2026-11-13; the owner's rule: no control rests under the tab bar, no control covers
   content). Held by CONSTRUCTION, not by measuring a conversation:
   1. On a conversation the tab bar is a ROW of the screen, not a layer over the page. The screen is a column — the
      page's own scroll region, then the bar — so the region ends where the bar begins and nothing can be under the
      bar, in any state, language or size, with script or without.
   2. The answers the page's state asks of the owner stand in a BAND of a set height between the region and the bar,
      in EVERY state (Block 2): a waiting reply's box and its three answers (Send, Hand to me, No reply needed); an
      order's two (Confirm the order, Hand to me); the owner's own reply and its Send; or "Hand to me" alone. The page
      names which (data-band, from what it drew: one at most); each band's height is ONE figure here, written twice —
      as the room the region gives up while that band is drawn, and as the band's own height. So the
      band is over nothing, and its answers are whole at every moment whatever the reply's length, the language or
      what is typed (a box in it takes what the answers leave and scrolls inside itself).
   Nothing is sticky. A screen under 400 px tall has no band: everything is in the region, in the page's order. */
@media (max-width:720px) {
  ${PAGE} { display:flex; flex-direction:column; block-size:100vh; block-size:100dvh; }
  ${PAGE} > nav.side { position:relative; order:2; flex:none; box-sizing:border-box; block-size:${BAR}; }
  ${PAGE} > .content { order:1; flex:1 1 0; min-block-size:0; overflow-y:auto; padding-block-end:0; scroll-padding-block-end:var(--space-16); }
  /* A door lands on the newest message near the top of the region here (a quarter down elsewhere): the room under it
     is for what was drafted and why it waits. */
  .conversation-workspace:has(.draft-dock) #latest { scroll-margin-top:var(--space-16); }
}
@media (max-width:720px) and (min-height:400px) {
  ${sized('take', TAKE, '64px')}
  ${sized('reply', REPLY, 'clamp(168px, 30dvh, 260px)')}
  ${sized('approve', APPROVE, 'clamp(232px, 40dvh, 340px)')}
  /* A note in the band (the owner's kept words, why a reply waits) takes its room from the band, not from the box. */
  ${sized('approve', `${APPROVE}:has(> p)`, 'clamp(288px, 46dvh, 380px)', ' form.approve > p')}
  ${sized('order', ORDER, '104px')}
  ${BAND.join(', ')} { position:fixed; z-index:3; inset-inline:0; inset-block-end:${BAR}; box-sizing:border-box; margin:0;
    padding:var(--space-8) var(--space-16); background:var(--color-surface); border-block-start:1px solid var(--color-border); }
  /* A waiting reply: the box, two answers under it, and the third in the band's last row (its own form, set there). */
  ${APPROVE} { padding-block-end:64px; }
  ${APPROVE} textarea, ${REPLY} textarea { flex:1 1 0; block-size:auto; min-block-size:0; max-block-size:none; field-sizing:fixed; resize:none; }
  ${APPROVE} > p { flex:none; margin:0; font-size:var(--font-size-caption); }
  ${APPROVE} .acts { flex:none; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:var(--space-8); }
  ${ANSWERS.join(', ')} { box-sizing:border-box; inline-size:100%; block-size:48px; min-block-size:0; min-inline-size:0; padding:var(--space-4) var(--space-8);
    justify-content:center; text-align:center; white-space:normal; line-height:1.2; overflow:hidden; }
  ${QUIET} { position:fixed; z-index:4; inset-inline:var(--space-16); inline-size:auto; inset-block-end:calc(77px + env(safe-area-inset-bottom)); }
  /* The owner's own reply: the box, then Send. */
  ${REPLY} { align-items:stretch; }
  ${REPLY} > .btn { flex:none; }
  /* An order's two answers side by side; "Hand to me" alone takes the row. */
  ${ORDER}, ${TAKE} { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr); gap:var(--space-8); }
  ${ORDER} > form { display:block; margin:0; }
}
/* Wide enough for a waiting reply's three answers in one row. */
@media (min-width:481px) and (max-width:720px) and (min-height:400px) {
  ${sized('approve', APPROVE, 'clamp(168px, 40dvh, 300px)')}
  ${sized('approve', `${APPROVE}:has(> p)`, 'clamp(224px, 46dvh, 340px)', ' form.approve > p')}
  ${APPROVE} { padding-block-end:var(--space-8); }
  ${APPROVE} .acts { padding-inline-end:calc((100vw - 24px) / 3); }
  ${QUIET} { inset-inline:auto var(--space-16); inline-size:calc((100vw - 48px) / 3); }
}
.order-action-note { margin:var(--space-4) 0 0; font-size:var(--font-size-caption); line-height:1.3; color:var(--color-ink-secondary); }
/* A desk: the page's help door sits in the corner; the row keeps clear of it. */
@media (min-width:1100px) { .conversation-workspace .conv-top .dhead { padding-inline-end:var(--space-48); } }
.conversation-workspace .conversation-actions { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8) var(--space-12); margin:0; margin-inline-start:auto; }
.conversation-workspace .dhead .live + .conversation-actions { margin-inline-start:0; }
.conversation-workspace .conversation-actions .btn { min-height:44px; padding-block:var(--space-8); }
.conversation-workspace .catchup { grid-template-columns:auto minmax(0,1fr); column-gap:var(--space-12); row-gap:var(--space-4); padding:0; border:0; }
.conversation-workspace .catchup > .face-link { grid-row:1 / span 2; align-self:center; }
.conversation-workspace .catchup .face-l { inline-size:44px; block-size:44px; font-size:var(--font-size-base); }
.conversation-workspace .catchup h1.who { font-size:var(--font-size-base); font-weight:600; line-height:1.3; overflow-wrap:anywhere; }
.conversation-workspace .catchup .cu-where { line-height:1.3; }
.conversation-workspace .catchup .cu-facts { margin-block-start:var(--space-8); }
.conversation-workspace .conv-top .subline { margin:var(--space-4) 0 0; }
.conv-more { position:relative; }
.conv-more > summary { display:inline-flex; align-items:center; gap:var(--space-4); min-height:44px; padding-inline:var(--space-8); cursor:pointer; list-style:none;
  font-size:var(--font-size-small); color:var(--color-ink-secondary); border-radius:var(--radius-control); }
.conv-more > summary::-webkit-details-marker { display:none; }
.conv-more[open] > summary, .conv-more > summary:hover { color:var(--color-ink); background:var(--color-sand); }
.conv-more-menu { position:absolute; inset-inline-end:0; inset-block-start:calc(100% + var(--space-4)); z-index:4; min-inline-size:240px; padding:var(--space-8);
  background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-card); }
/* A phone (N-3): the menu is as wide as the head's row and opens under "More", wherever in the row "More" came to
   rest — hung from the button's own edge it ran off a 320 px screen by more than half. */
@media (max-width:720px) {
  .conversation-workspace .conv-top .dhead { position:relative; }
  .conversation-workspace .conv-more { position:static; }
  .conversation-workspace .conv-more-menu { inset-inline:0; inset-block-start:auto; min-inline-size:0; margin-block-start:var(--space-4); }
}
.conv-more-menu form.testing { display:flex; flex-direction:column; align-items:stretch; gap:var(--space-4); margin:0; }
.conv-more-menu .btn { justify-content:flex-start; inline-size:100%; color:var(--color-ink); }
/* The thread: the page's own heading is the region's name, so it is kept for a reader and not drawn. */
.conversation-workspace .conv-thread { padding-block:var(--space-8); outline-offset:-2px; }
.conversation-workspace .conv-thread .block > h2 { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.conversation-workspace .conv-thread .block { margin:0; }
.conversation-workspace .conv-acts > .draft:first-child, .conversation-workspace .conv-acts > .flash + .draft { padding-block-start:var(--space-16); }
.conversation-workspace .conversation-actions .file-door { display:inline-flex; }
.conversation-actions .btn, .cp-head h2, .cp-attribution { display:flex; align-items:center; gap:var(--space-8); }
.conversation-workspace .draft { background:transparent; border:0; border-block-start:1px solid var(--color-border); border-radius:0; padding:var(--space-16) 0; }
.conversation-workspace .draft .top .as { display:inline-flex; align-items:center; gap:var(--space-8); }
.conversation-workspace .draft textarea { background:var(--color-surface); color:var(--color-ink); }
.conversation-workspace .draft .btn, .conversation-workspace .replyform .btn { background:var(--color-ink); color:var(--color-surface); border-color:var(--color-ink); }
.conversation-workspace .draft .acts-more .btn, .conversation-workspace .draft .acts .btn:not(:first-child) { background:transparent; color:var(--color-ink); border-color:var(--color-control-line); }
/* One fill a card: confirming the order is the order card's act (it was drawn as a quiet button beside "Hand to me");
   "Suggest a reply" fills the box and sends nothing, so it is a quiet button beside the reply's own Send. */
.conversation-workspace #order .answer > form:first-child .btn { background:var(--color-ink); color:var(--color-surface); border-color:var(--color-ink); }
.conversation-workspace .replyform .reply-tools .btn { background:transparent; color:var(--color-ink); border:1px solid var(--color-control-line); }
.conversation-workspace .replyform .reply-tools .btn:not(:disabled):hover { background:var(--color-sand); border-color:var(--color-ink); }
.conversation-workspace .draft .acts-more .btn:not(:disabled):hover, .conversation-workspace .draft .acts .btn:not(:first-child):not(:disabled):hover { background:var(--color-sand); border-color:var(--color-ink); }
.conversation-tools { display:none; min-width:0; padding:var(--space-16); background:var(--color-paper); border-inline-start:1px solid var(--color-border); }
.conversation-workspace[data-tool-open] > .conversation-tools, .conversation-workspace:has(#customer:target) > .conversation-tools { display:block; }
.conversation-tools .panel { display:block; position:static; width:auto; height:auto; border:0; padding:0; background:none; box-shadow:none; }
.conversation-tools .panel-close, .conversation-tools .cp-back { display:none; }
.ct-head { margin-block-end:var(--space-16); }
.ct-head > a { display:inline-flex; min-height:44px; align-items:center; }
.ct-tabs { display:flex; gap:var(--space-16); border-block-end:1px solid var(--color-border); }
.ct-tabs a { display:inline-flex; gap:var(--space-8); align-items:center; min-height:44px; text-decoration:none; color:var(--color-ink-secondary); border-block-end:2px solid transparent; }
.ct-tabs a[aria-current] { color:var(--color-accent); border-block-end-color:var(--color-accent); }
.ct-status:empty { display:none; }
.ct-status, .cp-intro, .cp-allowance, .cp-history { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.copilot-panel { max-width:68ch; margin-inline:auto; overflow-wrap:anywhere; }
.cp-head h2 { font-size:var(--font-size-title); margin:0; }
.cp-head p { margin-block:var(--space-8) var(--space-16); }
.cp-prompts { display:flex; flex-direction:column; align-items:stretch; gap:var(--space-8); margin-block:var(--space-16); }
.cp-prompts form { margin:0; }
/* A suggested question is a control and is drawn as one: the quiet button's edge, its words at the start. */
.cp-prompts .btn.cp-prompt { width:100%; min-block-size:44px; text-align:start; justify-content:start; font-weight:400; background:var(--color-surface); color:var(--color-ink); border:1px solid var(--color-control-line); }
.cp-prompts .btn.cp-prompt:not(:disabled):hover { background:var(--color-sand); border-color:var(--color-ink); }
.cp-head p { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.cp-intro, .cp-question .cp-allowance { margin:0; font-size:var(--font-size-caption); }
/* The pane's heading takes the focus when it opens so a reader starts there; it is not a control and draws no ring. */
#copilot-title:focus { outline:none; }
.ct-head { position:relative; }
.ct-status { margin:0 0 var(--space-12); }
.cp-question { display:grid; gap:var(--space-8); margin-block:var(--space-16); }
.cp-question textarea { width:100%; min-width:0; resize:vertical; }
.cp-question button { justify-self:start; }
.cp-answer, .cp-suggestion blockquote { margin-block:var(--space-24); padding:var(--space-16); background:var(--color-assistant-wash); color:var(--color-ink); border:0; border-radius:var(--radius-panel); }
.cp-answer p, .cp-suggestion blockquote { white-space:pre-wrap; }
.cp-attribution { font-size:var(--font-size-small); }
.cp-sources h3, .cp-suggestion h3 { font-size:var(--font-size-base); margin-block:var(--space-24) var(--space-8); }
.reading-proof { grid-column:2 / -1; min-width:0; }
.reading-proof summary { min-height:44px; padding-block:var(--space-8); cursor:pointer; color:var(--color-accent); }
@media (max-width:560px) {
  .conversation-workspace .reasons li > span:nth-child(3) { grid-column:2 / -1; }
}
.cp-fact { border-block-end:1px solid var(--color-border); padding-block:var(--space-8); }
.cp-fact summary { cursor:pointer; min-height:44px; padding-block:var(--space-8); color:var(--color-accent); }
.cp-fact summary bdi { font-variant-numeric:tabular-nums; }
.cp-fact p, .cp-fact ul { margin-block:var(--space-8); }
.cp-suggestion blockquote { margin-inline:0; }
.cp-history { border-block-start:1px solid var(--color-border); margin-block-start:var(--space-24); padding-block-start:var(--space-16); }
/* THE UI CORRECTION (2026-11-13, audit F13) — opening Ask Nomi or the customer's facts moves nothing the owner was
   looking at. The list never leaves and the thread's own edge never moves: where the window is wide enough the pane is
   a third column at the far side (the thread gives it the room from its far edge). Where it is not, the pane takes the
   conversation's own place — never drawn over its words or its reply (V1-241) — with the way back first; the
   conversation keeps its place and its scroll under it (hidden, not removed) and is there again, unmoved, on closing.
   On a phone the pane is the whole screen, with the way back first (below). */
@media (min-width:1100px) {
  .conversation-workspace { display:grid; grid-template-columns:300px minmax(0,1fr); min-height:100dvh; align-items:start; }
  .conversation-workspace > .listpane { display:block; width:auto; padding-block:var(--space-16); background:var(--color-paper); border-inline-end:1px solid var(--color-border); position:sticky; top:0; height:100dvh; overflow-y:auto; }
  .conversation-workspace > .listpane, .conversation-workspace > .conv { grid-row:1; }
  .conversation-workspace > .conv { grid-column:2; padding:var(--space-16) var(--space-24) 0; }
  .conversation-tools { grid-row:1; position:sticky; top:0; box-sizing:border-box; max-height:100dvh; overflow-y:auto; overscroll-behavior:contain; }
}
@media (min-width:1100px) and (max-width:1299px) {
  .conversation-workspace[data-tool-open] > .conv, .conversation-workspace:has(#customer:target) > .conv { visibility:hidden; }
  .conversation-workspace > .conversation-tools { grid-column:2; block-size:100dvh; border-inline-start:0; background:var(--color-surface); padding-inline:var(--space-24); }
}
@media (min-width:1300px) {
  .conversation-workspace[data-tool-open], .conversation-workspace:has(#customer:target) { grid-template-columns:300px minmax(0,1fr) 340px; }
  .conversation-workspace > .conversation-tools { grid-column:3; }
}
@media (max-width:1099px) {
  .conversation-workspace[data-tool-open] > .conv, .conversation-workspace:has(#customer:target) > .conv { display:none; }
  .conversation-workspace[data-tool-open] > .conversation-tools, .conversation-workspace:has(#customer:target) > .conversation-tools { min-height:calc(100dvh - 80px); border:0; padding:var(--space-16) var(--space-12) var(--space-48); }
}
/* A desk-sized window: the head stays, the thread scrolls in its own region and opens on its newest message
   (a reversed column rests at its end), and the reply to act on is held under it. A short window, a phone, or a
   page zoomed until it is one, keeps the single page scroll. */
@media (min-width:1100px) and (min-height:640px) {
  .conversation-workspace > .conv { position:sticky; top:0; display:flex; flex-direction:column; block-size:100dvh; }
  .conversation-workspace .conv-top { flex:none; }
  .conversation-workspace .conv-thread { flex:1 1 0; min-block-size:120px; overflow-y:auto; display:flex; flex-direction:column-reverse; overscroll-behavior:contain; }
  .conversation-workspace .conv-thread-in { margin-block-end:auto; }
  .conversation-workspace .conv-acts { flex:0 1 auto; max-block-size:62dvh; overflow-y:auto; border-block-start:1px solid var(--color-border); padding-block-end:var(--space-16); overscroll-behavior:contain; }
  .conversation-workspace .conv-acts:empty { display:none; }
  .conversation-workspace .conv-acts > .draft:first-child { border-block-start:0; }
}
`;
