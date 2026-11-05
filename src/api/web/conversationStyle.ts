/** Shared Inbox conversation layout. All state colors and type come from the owner theme. */
export const CONVERSATION_CSS = `
.conversation-workspace { --font-voice:var(--font-family); display:block; min-width:0; background:var(--color-surface); }
.conversation-workspace > .conv { min-width:0; padding:var(--space-16); background:var(--color-surface); }
.conversation-workspace > .listpane { display:none; }
.conversation-workspace .catchup { border:0; border-block-end:1px solid var(--color-border); border-radius:0; background:none; padding:0 0 var(--space-16); }
.conversation-workspace .catchup h1.who { font-size:var(--font-size-title); }
.conversation-workspace .conversation-actions { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-12); margin-block:var(--space-16); }
.conversation-workspace .conversation-actions .file-door { display:inline-flex; }
.conversation-actions .btn, .cp-head h2, .cp-attribution { display:flex; align-items:center; gap:var(--space-8); }
.conversation-actions .btn { background:var(--color-ink); color:var(--color-surface); border-color:var(--color-ink); }
.conversation-actions .btn .mark { background:var(--color-surface); }
.conversation-workspace .draft { background:transparent; border:0; border-block-start:1px solid var(--color-border); border-radius:0; padding:var(--space-24) 0; }
.conversation-workspace .draft .top .as { display:inline-flex; align-items:center; gap:var(--space-8); }
.conversation-workspace .draft textarea { background:var(--color-assistant-wash); color:var(--color-ink); }
.conversation-workspace .draft .btn, .conversation-workspace .replyform .btn { background:var(--color-ink); color:var(--color-surface); border-color:var(--color-ink); }
.conversation-workspace .draft .acts-more .btn, .conversation-workspace .draft .acts .btn:not(:first-child) { background:transparent; color:var(--color-ink); border-color:var(--color-border); }
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
  .conversation-workspace > .conv { padding:var(--space-24); }
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
`;
