/** Customers' existing tools share one paper surface and the existing command forms. */
export const CUSTOMER_TOOLS_CSS = `
.customer-tools { min-inline-size:0; font-size:var(--font-size-base); }
.customer-tools h1.page { font-family:var(--font-family); font-size:var(--font-size-display); margin-block:0 var(--space-16); overflow-wrap:anywhere; }
.customer-tools > .back { margin-block-end:var(--space-16); min-block-size:44px; display:inline-flex; align-items:center; }
.customer-tools .lede, .customer-tools .block > p, .customer-tools > p { max-inline-size:var(--measure-prose); }
.customer-tools .lede { margin-block-end:var(--space-24); }
.customer-tools .block { padding-block:var(--space-24); }
.customer-tools .block h2 { font-size:var(--font-size-title); margin-block:0 var(--space-16); }
.customer-tools .btn, .customer-tools input:not([type="hidden"]), .customer-tools select { min-block-size:44px; }
.customer-tools input, .customer-tools select, .customer-tools textarea { min-inline-size:0; }
.customer-tools .btn { color:var(--color-ink); background:transparent; border-color:var(--color-ink); }
.customer-tools .btn.send { color:var(--color-surface); background:var(--color-ink); border-color:var(--color-ink); }
.customer-tools .btn.danger { color:var(--color-ink); border-color:var(--color-ink); }
.customer-tools .caption, .customer-tools .small, .customer-tools .note { font-size:var(--font-size-small); }
.customer-tools .scard { border:0; border-block-end:1px solid var(--color-border); background:transparent; border-radius:0; }
.customer-tools .srow { padding-inline:0; }
.customer-tools .sform, .customer-tools .sqform, .customer-tools .wform { max-inline-size:var(--measure-form); }
/* Stopped / archived labels carry the state; fading their whole rows made the
   names, counts and still-available doors fail text contrast. */
.customer-tools .ct.gone, .customer-tools .sq.gone, .customer-tools .en.gone { opacity:1; }
.customer-tool-doors { display:flex; flex-wrap:wrap; gap:var(--space-8) var(--space-24); margin-block:var(--space-16) var(--space-24); }
.customer-tool-doors .deeper { display:inline-flex; align-items:center; min-block-size:44px; margin:0; }
.tool-contacts .search { margin-block:var(--space-24); }
.tool-contacts .search input { flex:1; }
.tool-contacts .act-fold { margin-block:var(--space-16); }
.tool-contacts .ctgroup { margin-block:var(--space-32); }
.tool-contacts .ctgroup-h { font-size:var(--font-size-title); margin-block:0 var(--space-8); }
.tool-contacts .ct { border:0; border-block-end:1px solid var(--color-border); padding-block:var(--space-16); }
.tool-contacts .ct-h { align-items:start; flex-wrap:wrap; }
.tool-contacts .who { overflow-wrap:anywhere; }
.tool-contacts .ct-b, .tool-contacts .ct-co { font-size:var(--font-size-small); }
.tool-contacts .ct-a { gap:var(--space-8) var(--space-16); margin-block-start:var(--space-12); }
.tool-contacts .ct-more { margin:0; }
.tool-contacts .ct-more > summary { min-block-size:44px; display:flex; align-items:center; }
.tool-contacts .ct-a .deeper { display:inline-flex; align-items:center; min-block-size:44px; margin:0; }
.tool-contacts .pager { margin-block-start:var(--space-24); }
.tool-contacts .pager a, .customer-tools .clear { min-block-size:44px; display:inline-flex; align-items:center; }
.tool-suppress .confirm, .tool-write .wact { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-12); }
.tool-suppress .confirm .back { min-block-size:44px; display:inline-flex; align-items:center; }
.tool-find .rows { max-inline-size:var(--measure-column); }
.tool-find .row.lines { padding-block:var(--space-16); }
.tool-find .row .dhead { flex-wrap:wrap; margin-block-end:var(--space-8); }
.tool-find .row form { margin-block-start:var(--space-12); }
.tool-sequences .sq { border:0; border-block-end:1px solid var(--color-border); padding:var(--space-16) 0; }
.tool-sequences .sq-h { justify-content:flex-end; }
.tool-sequences .sq-name { margin-inline-end:auto; min-block-size:44px; display:inline-flex; align-items:center; font-size:var(--font-size-base); overflow-wrap:anywhere; }
.tool-sequence .sts { max-inline-size:var(--measure-prose); }
.tool-sequence .st { margin-block:var(--space-24); padding-block-end:var(--space-24); border-block-end:1px solid var(--color-border); }
.tool-sequence .st-b, .tool-sequence .st-s { overflow-wrap:anywhere; }
.tool-sequence .ens .en { padding-block:var(--space-16); }
/* Block 3 F41: browse first; edit one saved e-mail or add one deliberately.
   All consequential commands keep their original forms, fields and warnings. */
.tool-contacts > .block, .tool-sequences > .block, .tool-sequence > .block, .tool-find > .block, .tool-write > .block, .tool-suppress > .block { padding-block:var(--space-12); }
.tool-contacts > .block > .note { margin-block:0 var(--space-8); }
.contacts-toolbar { display:flex; align-items:start; flex-wrap:wrap; gap:var(--space-8) var(--space-16); }
/* A flex item must shrink before translated Search / Clear controls wrap. */
.tool-contacts .contacts-toolbar .search { flex:1 1 300px; min-inline-size:0; max-inline-size:100%; flex-wrap:wrap; margin:0; }
.tool-contacts .contacts-toolbar .search input { min-inline-size:0; flex:1 1 120px; }
.tool-contacts .contacts-toolbar .act-fold { margin:0; }
.contacts-toolbar .act-fold[open] { flex-basis:100%; }
.tool-contacts .customer-tool-doors { flex-direction:row; gap:0 var(--space-24); margin-block:var(--space-4) var(--space-12); }
.tool-contacts .ctgroup { margin-block:var(--space-16); }
.tool-contacts .ctgroup-h { font-size:var(--font-size-base); }
.tool-contacts .ct { padding-block:var(--space-12); }
.tool-contacts .ct-a { margin-block-start:var(--space-4); }
.tool-contacts .ct-consent { display:block; }
.tool-contacts .ct-consent .note { margin:0 0 var(--space-8); max-inline-size:var(--measure-prose); }
.contacts-about { margin-block-start:var(--space-16); border-block-start:1px solid var(--color-border); }
.contacts-about summary { font-size:var(--font-size-small); }
.outreach-recipient { display:flex; flex-wrap:wrap; align-items:baseline; gap:var(--space-8); margin:0; font-size:var(--font-size-small); }
.outreach-recipient bdi { overflow-wrap:anywhere; }
.tool-write .wform { max-inline-size:var(--measure-prose); }
.tool-write .wform label > .muted { font-size:var(--font-size-small); color:var(--color-ink); }
.tool-write .write-scope { font-size:var(--font-size-small); margin:0; }
.tool-write .wact { margin-block-start:var(--space-8); }
.seq-new, .seq-add, .seq-retire, .prospect-connection { margin-block:var(--space-12); border-block-start:1px solid var(--color-border); }
.seq-new > summary, .seq-add > summary { font-weight:600; }
.seq-new .sform, .seq-add .sqform, .seq-edit .sqform { padding-block:var(--space-12); }
.seq-overview { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-4) var(--space-16); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
.tool-sequence .sts { margin:0; padding:0; list-style:none; max-inline-size:var(--measure-prose); }
.tool-sequence .st { position:relative; margin:0; padding-block:var(--space-16); padding-inline:var(--space-24) 0; border-block-end:0; border-inline-start:2px solid var(--color-border); }
.tool-sequence .st::before { content:""; position:absolute; inset-inline-start:-5px; inset-block-start:24px; inline-size:8px; block-size:8px; border-radius:var(--radius-chip); background:var(--color-ink-secondary); }
.tool-sequence .st-h { justify-content:flex-start; display:flex; align-items:baseline; flex-wrap:wrap; gap:var(--space-4) var(--space-16); }
.tool-sequence .st-s { margin-block:var(--space-8); font-weight:600; }
.tool-sequence .st-b { margin:0; white-space:pre-wrap; }
.tool-sequence .sqform { max-inline-size:none; }
.tool-sequence .seq-approval { max-inline-size:var(--measure-prose); }
.tool-sequence .seq-approval p { margin-block:0 var(--space-8); }
.tool-sequence .en-a a { display:inline-flex; min-block-size:44px; align-items:center; }
.prospect-connection .setrow { grid-template-columns:minmax(0,1fr); gap:var(--space-8); }
.prospect-connection .fr-acts { justify-content:flex-start; }
.tool-contacts .contacts-toolbar .act-fold > summary { border:0; padding-inline:0; background:transparent; }
.tool-contacts .ctgroup-h > .muted { font-size:var(--font-size-small); }
.prospect-connection > p { max-inline-size:var(--measure-prose); }
.tool-labels .row { align-items:start; gap:var(--space-16); padding-block:var(--space-16); }
.tool-labels .row > span:first-child { flex:1; min-inline-size:0; }
.tool-labels .row form { gap:var(--space-8); }
.tool-labels .row input { flex:1; inline-size:auto; }
.tool-labels .row .caption { display:inline-flex; min-block-size:44px; align-items:center; }
.tool-feedback .feedback-layout { display:grid; grid-template-columns:minmax(0, 1fr); gap:var(--space-32); }
.tool-feedback .feedback-layout > .block { min-inline-size:0; }
.tool-feedback blockquote { margin:var(--space-8) 0 var(--space-24); padding:var(--space-16); background:var(--color-paper); border:1px solid var(--color-border); border-radius:var(--radius-control); font-family:var(--font-family); font-size:var(--font-size-base); overflow-wrap:anywhere; }
.tool-feedback .row { align-items:start; gap:var(--space-16); padding-block:var(--space-12); }
.tool-feedback .row > span { font-variant-numeric:tabular-nums; }
@media (min-width:1200px) {
  .tool-feedback .feedback-layout { grid-template-columns:minmax(0, 3fr) minmax(0, 2fr); }
}
@media (max-width:720px) {
  .customer-tools h1.page { font-size:var(--font-size-title); }
  .customer-tools .srow { grid-template-columns:minmax(0, 1fr); }
  .customer-tools .sform, .customer-tools .sqform, .customer-tools .wform { inline-size:100%; }
  .customer-tool-doors { flex-direction:column; align-items:start; gap:var(--space-8); }
  .tool-labels .row { flex-wrap:wrap; }
  .tool-labels .row > span:first-child { flex-basis:100%; }
  .tool-labels .row .inline { display:flex; }
  .tool-contacts .ct-h .st { margin-inline-start:0; }
  .tool-sequences .sq-h { flex-wrap:wrap; }
  .tool-feedback .row { flex-wrap:wrap; }
}
`;
