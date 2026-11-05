/** Area 2 list and saved-reply surfaces. Conversation geometry belongs to conversationStyle.ts. */
export const INBOX_LIST_CSS = `
.si-fils .si-fil .si-tabn { margin-inline-start:var(--space-8); color:var(--color-accent); }
.il-page { padding:var(--space-24) var(--space-24) var(--space-32); }
.il-header { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-16); margin-block-end:var(--space-24); }
.il-header h1 { margin:0; flex:1; font-family:var(--font-family); font-size:var(--font-size-hero); }
.il-business { display:none; }
.il-header .sp-new { margin:0; }
.il-header .sp-btn { min-block-size:44px; }
.il-header > .live { flex-basis:100%; }
.il-workspace { display:grid; grid-template-columns:200px minmax(0, 1fr); gap:var(--space-24); }
.il-menu { min-inline-size:0; padding-inline-end:var(--space-16); border-inline-end:1px solid var(--color-border); }
.il-main.sp-sheet { min-inline-size:0; background:var(--color-surface); border:0; border-radius:0; }
.il-views .si-tabs { display:flex; flex-direction:column; overflow:visible; border:0; margin:0; gap:var(--space-4); }
.il-views .si-tab { display:flex; justify-content:space-between; gap:var(--space-12); white-space:normal; min-block-size:44px; padding:var(--space-8) var(--space-12); border:0; border-radius:var(--radius-control); color:var(--color-ink); }
.il-views .si-tab.on { color:var(--color-accent); background:var(--color-assistant-wash); }
.il-views .si-tabn { color:var(--color-accent); font-variant-numeric:tabular-nums; }
.il-views .si-tab:hover { background:var(--color-sand); }
.il-view-form { display:none; grid-template-columns:minmax(0, 1fr) auto; align-items:end; gap:var(--space-8); margin:0; }
.il-view-form label { display:grid; gap:var(--space-8); min-inline-size:0; margin:0; }
.il-view-form label > span { font-size:var(--font-size-small); }
.il-view-form select { inline-size:100%; min-inline-size:0; min-block-size:44px; margin:0; color:var(--color-ink); background:var(--color-surface); }
.il-view-form .sp-btn { min-block-size:44px; margin:0; }
.il-views.is-compact .il-view-form { display:grid; }
.il-menu .si-doors { display:grid; gap:var(--space-4); margin-block-start:var(--space-24); padding-block-start:var(--space-16); border-block-start:1px solid var(--color-border); }
.il-menu .si-doors .deeper { display:flex; min-block-size:44px; align-items:center; margin:0; }
.il-page .si-tools { padding:var(--space-16); }
.il-page .si-search input { flex:1; min-inline-size:0; min-block-size:44px; margin:0; font-size:var(--font-size-base); }
.il-page .si-search .sp-btn { min-block-size:44px; }
.il-filter { margin:0; }
.il-filter > summary { min-block-size:44px; display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-8); font-size:var(--font-size-small); }
.il-filter .si-filters { align-items:start; gap:var(--space-8) var(--space-16); }
.il-filter .si-fils { flex-wrap:wrap; overflow:visible; }
.il-filter .si-fil { min-block-size:44px; }
.il-filter .si-fil.on { color:var(--color-accent); }
.il-filter .si-fil.on::before { background:var(--color-assistant-wash); }
.il-page .si-list, .il-page .si-pager { padding-inline:var(--space-16); }
.il-page .si-group > .sp-cap { padding-block:var(--space-16) var(--space-8); margin:0; }
.il-page .sp-rows > li, .il-compact-list .sp-rows > li { scroll-margin-block-start:calc(3 * var(--space-32)); }
.il-page .si-row, .il-compact-list .si-row { min-block-size:80px; }
.il-page .si-row .si-face::after, .il-compact-list .si-row .si-face::after { content:""; position:absolute; inset:-4px; }
.il-page .si-row.is-selected, .il-compact-list .si-row.is-selected { background:var(--color-assistant-wash); }
.il-page .si-row.is-selected .sp-rname, .il-compact-list .si-row.is-selected .sp-rname { color:var(--color-accent); }
.il-page .si-door .sp-rname, .il-compact-list .si-door .sp-rname { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; max-inline-size:100%; white-space:normal; overflow:hidden; overflow-wrap:anywhere; text-overflow:ellipsis; }
.il-page .sp-chip.is-order, .il-compact-list .sp-chip.is-order { color:var(--color-ink); background:var(--color-sand); }
.il-page .sp-rname, .il-compact-list .sp-rname { font-size:var(--font-size-base); }
.il-page .si-why, .il-page .si-said, .il-compact-list .si-why, .il-compact-list .si-said { font-size:var(--font-size-small); }
.il-page .sp-rval, .il-compact-list .sp-rval { font-variant-numeric:tabular-nums; }
.il-empty { max-inline-size:65ch; padding:var(--space-24) 0 var(--space-32); }
.il-empty h3 { margin-block:0 var(--space-8); font-size:var(--font-size-title); }
.il-empty p { margin-block:0 var(--space-16); }
.il-empty .deeper { min-block-size:44px; display:inline-flex; align-items:center; }
.il-compact-list .si-row { grid-template-columns:8px 36px minmax(0, 1fr) 28px auto 16px; grid-template-areas:"dot face name name val go" "dot face chip thumb day go" "dot face why why why go" "dot face said said said go"; gap:var(--space-4) var(--space-8); padding:var(--space-12) var(--space-8); }
.il-compact-list .si-dot { grid-area:dot; }
.il-compact-list .si-row .si-face { grid-area:face; }
.il-compact-list .si-who, .il-compact-list .si-line { display:contents; }
.il-compact-list .si-door { grid-area:name; min-inline-size:0; }
.il-compact-list .si-why { grid-area:why; min-inline-size:0; }
.il-compact-list .si-said { grid-area:said; }
.il-compact-list .si-row .sp-thumb { grid-area:thumb; }
.il-compact-list .sp-chip { grid-area:chip; justify-self:start; }
.il-compact-list .sp-rval { grid-area:val; }
.il-compact-list .sp-rday { grid-area:day; }
.il-compact-list .si-row .go { grid-area:go; }
.il-compact-list .si-group > h2 { font-size:var(--font-size-small); margin:var(--space-16) var(--space-8) var(--space-8); }
.saved-replies-page { max-inline-size:960px; }
.saved-replies-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-16); margin-block:var(--space-16) var(--space-24); }
.saved-replies-header h1 { min-inline-size:0; overflow-wrap:anywhere; margin:0; }
.saved-replies-header .deeper { min-block-size:44px; display:inline-flex; align-items:center; margin:0; }
.saved-replies-intro { max-inline-size:70ch; margin-block:0 var(--space-32); }
.saved-reply-rows { list-style:none; margin:0; padding:0; }
.saved-reply-row { display:grid; grid-template-columns:minmax(0, 1fr) auto 16px; align-items:center; gap:var(--space-16); min-block-size:80px; padding-block:var(--space-16); border-block-end:1px solid var(--color-border); text-decoration:none; color:var(--color-ink); }
.saved-reply-row:hover .saved-reply-title { text-decoration:underline; }
.saved-reply-copy { min-inline-size:0; display:grid; gap:var(--space-8); }
.saved-reply-title { font-weight:600; overflow-wrap:anywhere; }
.saved-reply-preview { min-inline-size:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--color-ink-secondary); font-size:var(--font-size-small); }
.saved-reply-languages { color:var(--color-ink-secondary); font-size:var(--font-size-small); max-inline-size:22ch; }
.saved-reply-editor { max-inline-size:70ch; margin-block-start:var(--space-32); padding-block-start:var(--space-24); border-block-start:1px solid var(--color-border); }
.saved-reply-form { gap:var(--space-24); }
.saved-reply-form .pq { margin:0; }
.saved-reply-form input, .saved-reply-form textarea { font-size:var(--font-size-base); }
.saved-reply-form input { min-block-size:44px; }
.saved-languages { min-inline-size:0; margin:0; padding:0; border:0; }
.saved-languages legend { font-weight:600; margin-block-end:var(--space-8); }
.saved-language { border-block-end:1px solid var(--color-border); }
.saved-language > summary, .saved-archive > summary { min-block-size:44px; padding-block:var(--space-8); }
.saved-language textarea { margin-block:var(--space-8) var(--space-16); inline-size:100%; }
.saved-archive { margin-block-start:var(--space-24); }
.saved-reply-state { margin:0; }
.saved-replies-page .btn { min-block-size:44px; }
@media (max-width: 1000px) {
  .il-workspace { grid-template-columns:minmax(0, 1fr); gap:var(--space-16); }
  .il-menu { border:0; padding:0; }
  .il-views .si-tabs { display:none; }
  .il-view-form { display:grid; }
  .il-menu .si-doors { display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-16); margin-block-start:var(--space-12); padding:0; border:0; }
}
@media (max-width: 720px) {
  .il-page { padding:var(--space-16) var(--space-12) var(--space-24); }
  .il-header h1 { font-size:var(--font-size-display); }
  .il-business { display:block; flex-basis:100%; margin:0; font-size:var(--font-size-small); }
  .il-page .si-tools { padding:var(--space-12); }
  .il-page .si-list, .il-page .si-pager { padding-inline:var(--space-12); }
  .il-page .si-row { grid-template-columns:8px 36px minmax(0, 1fr) 28px auto 16px; grid-template-areas:"dot face name name val go" "dot face chip thumb day go" "dot face why why why go" "dot face said said said go"; gap:var(--space-4) var(--space-8); }
  .il-page .si-row .sp-thumb { grid-area:thumb; }
  .il-page .si-why { grid-area:why; }
  .saved-reply-row { grid-template-columns:minmax(0, 1fr) 16px; gap:var(--space-8) var(--space-12); }
  .saved-reply-copy { grid-column:1; }
  .saved-reply-row .go { grid-column:2; grid-row:1 / 3; }
  .saved-reply-languages { grid-column:1; max-inline-size:none; }
  .saved-replies-header { align-items:start; }
}
`;
