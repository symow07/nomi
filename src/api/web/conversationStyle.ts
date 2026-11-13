/** Shared Inbox conversation layout. All state colors and type come from the owner theme. */
/** The heights the page's script may hold a phone's thread to (it sets no style itself: it names a step, 16 px apart). */
const THREAD_ROOM = Array.from({ length: 31 }, (_, i) => 96 + 16 * i)
  .map((h) => `  .conversation-workspace .conv-thread[data-room="${h}"] { max-block-size:${h}px; }`).join('\n');
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
/* A phone (t1r's decision 2, and the fix rounds of 2026-11-13): Send and Hand to me are never under the tab bar, and
   NOTHING rests over anything — no stuck row over the reply, no stuck block over the head or the thread. What the
   reply is, why it waits, the reply and its two answers are one block (draft-dock) in its own place under the thread.
   Where the head, the thread and that block are taller than the screen, the THREAD gives the room: the page's script
   measures how much and names the height the thread is held to (a step of 16 px), as its own scroll region opened on its newest
   message, exactly as on a desk — so the block ends just above the bar at the top of the page. Where even a short
   thread (96 px) would not make the room (a small phone, a page zoomed far in), or without script, the page is the
   plain page: everything in order, scrolled as any page is. The reply's box is held to a share of the screen and
   scrolls inside itself past that. */
@media (max-width:720px) {
  .conversation-workspace .conv-thread { overflow-y:auto; overscroll-behavior:contain; display:flex; flex-direction:column-reverse; }
  .conversation-workspace .conv-thread-in { margin-block-end:auto; }
${THREAD_ROOM}
  .conversation-workspace #approve .draft-dock textarea { max-block-size:max(4.5em, calc(60dvh - 150px)); }
  /* A door lands on the newest message near the top of the screen here (a quarter down elsewhere): the room under it
     is the reply's. */
  .conversation-workspace:has(.draft-dock) #latest { scroll-margin-top:var(--space-16); }
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
.ct-head { margin-block-end:var(--space-24); }
.ct-head > a { display:inline-flex; min-height:44px; align-items:center; }
.ct-tabs { display:flex; gap:var(--space-16); border-block-end:1px solid var(--color-border); }
.ct-tabs a { display:inline-flex; gap:var(--space-8); align-items:center; min-height:44px; text-decoration:none; color:var(--color-ink-secondary); border-block-end:2px solid transparent; }
.ct-tabs a[aria-current] { color:var(--color-accent); border-block-end-color:var(--color-accent); }
.ct-status:empty { display:none; }
.ct-status, .cp-intro, .cp-allowance, .cp-history { font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.copilot-panel { max-width:68ch; margin-inline:auto; overflow-wrap:anywhere; }
.cp-head h2 { font-size:var(--font-size-title); margin:0; }
.cp-head p { margin-block:var(--space-8) var(--space-16); }
.cp-prompts { display:flex; flex-direction:column; align-items:stretch; gap:var(--space-8); margin-block:var(--space-24); }
.cp-prompts form { margin:0; }
.cp-prompts button { width:100%; text-align:start; justify-content:start; }
.cp-question { display:grid; gap:var(--space-8); margin-block:var(--space-24); }
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
@media (min-width:1100px) {
  .conversation-workspace { display:grid; grid-template-columns:260px minmax(0,1fr); min-height:100dvh; align-items:start; }
  .conversation-workspace > .listpane { display:block; width:auto; padding-block:var(--space-16); background:var(--color-paper); border-inline-end:1px solid var(--color-border); position:sticky; top:0; height:100dvh; overflow-y:auto; }
  .conversation-workspace > .conv { padding:var(--space-16) var(--space-24) 0; }
  .conversation-workspace[data-tool-open], .conversation-workspace:has(#customer:target) { grid-template-columns:minmax(0,1fr) 340px; }
  .conversation-workspace[data-tool-open] > .listpane, .conversation-workspace:has(#customer:target) > .listpane { display:none; }
  .conversation-tools { position:sticky; top:0; max-height:100dvh; overflow-y:auto; }
}
@media (min-width:1500px) {
  .conversation-workspace[data-tool-open], .conversation-workspace:has(#customer:target) { grid-template-columns:260px minmax(0,1fr) 340px; }
  .conversation-workspace[data-tool-open] > .listpane, .conversation-workspace:has(#customer:target) > .listpane { display:block; }
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
