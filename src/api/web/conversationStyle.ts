/** Shared Inbox conversation layout. All state colors and type come from the owner theme. */
export const CONVERSATION_CSS = `
.conversation-workspace { --font-voice:var(--font-family); display:block; min-width:0; background:var(--color-surface); }
.conversation-workspace > .conv { min-width:0; padding:var(--space-16); background:var(--color-surface); }
.conversation-workspace > .listpane { display:none; }
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
   2. A reply waiting has its box and its three answers (Send, Hand to me, No reply needed) in a BAND of a fixed
      height between the region and the bar. The region ends where the band begins, so the band is over nothing; the
      band's height is set here and the box takes what the answers leave (it scrolls inside itself), so the answers
      are whole at every moment whatever the reply's length, the language or what is typed.
   Nothing is sticky. A screen under 400 px tall has no band: everything is in the region, in the page's order. */
@media (max-width:720px) {
  .owner-shell .layout:has(.conversation-workspace) { display:flex; flex-direction:column; block-size:100vh; block-size:100dvh; }
  .owner-shell .layout:has(.conversation-workspace) > nav.side { position:relative; order:2; flex:none; box-sizing:border-box; block-size:calc(69px + env(safe-area-inset-bottom)); }
  .owner-shell .layout:has(.conversation-workspace) > .content { order:1; flex:1 1 0; min-block-size:0; overflow-y:auto; padding-block-end:0; scroll-padding-block-end:var(--space-16); }
  /* A door lands on the newest message near the top of the region here (a quarter down elsewhere): the room under it
     is for what was drafted and why it waits. */
  .conversation-workspace:has(.draft-dock) #latest { scroll-margin-top:var(--space-16); }
}
@media (max-width:720px) and (min-height:400px) {
  .owner-shell .layout:has(.conversation-workspace:not([data-tool-open]) form.approve):not(:has(#customer:target)) > .content { margin-block-end:clamp(232px, 44dvh, 340px); }
  .conversation-workspace form.approve { block-size:clamp(232px, 44dvh, 340px); }
  /* The card's entrance would leave a transform in force on it, and a transformed box carries what is fixed inside it
     with the page: on a phone the card does not rise in. */
  .conversation-workspace #approve { animation:none; }
  .conversation-workspace form.approve { position:fixed; z-index:3; inset-inline:0; inset-block-end:calc(69px + env(safe-area-inset-bottom)); box-sizing:border-box;
    padding:var(--space-8) var(--space-16) 64px; background:var(--color-surface); border-block-start:1px solid var(--color-border); }
  .conversation-workspace form.approve textarea { flex:1 1 0; block-size:auto; min-block-size:0; max-block-size:none; field-sizing:fixed; resize:none; }
  .conversation-workspace form.approve > p { flex:none; margin:0; font-size:var(--font-size-caption); }
  .conversation-workspace form.approve .acts { flex:none; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:var(--space-8); }
  .conversation-workspace form.approve .acts .btn, .conversation-workspace #approve .acts-more .btn { box-sizing:border-box; block-size:48px; min-block-size:0; min-inline-size:0; padding:var(--space-4) var(--space-8);
    justify-content:center; text-align:center; white-space:normal; line-height:1.2; overflow:hidden; }
  .conversation-workspace #approve .acts-more .btn { position:fixed; z-index:4; inset-inline:var(--space-16); inset-block-end:calc(77px + env(safe-area-inset-bottom)); }
}
/* Wide enough for the three answers in one row. */
@media (min-width:481px) and (max-width:720px) and (min-height:400px) {
  .owner-shell .layout:has(.conversation-workspace:not([data-tool-open]) form.approve):not(:has(#customer:target)) > .content { margin-block-end:clamp(168px, 40dvh, 300px); }
  .conversation-workspace form.approve { block-size:clamp(168px, 40dvh, 300px); }
  .conversation-workspace form.approve { padding-block-end:var(--space-8); }
  .conversation-workspace form.approve .acts { padding-inline-end:calc((100vw - 24px) / 3); }
  .conversation-workspace #approve .acts-more .btn { inset-inline:auto var(--space-16); inline-size:calc((100vw - 48px) / 3); }
}
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
/* A prompt is a control and is drawn as one: the quiet button's edge, its words at the start. */
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
