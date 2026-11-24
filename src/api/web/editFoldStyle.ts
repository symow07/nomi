/** UI Block 9 (F10): a record part's summary list and its Change fold (editFold.ts). */
export const EDIT_FOLD_CSS = `.ef-sum{display:grid;gap:var(--space-8);margin:0 0 var(--space-12);}
.ef-sum>div{display:grid;grid-template-columns:minmax(9rem,14rem) minmax(0,1fr);gap:var(--space-4) var(--space-16);align-items:baseline;}
.ef-sum dt{color:var(--color-ink-secondary);font-size:var(--font-size-small);}
.ef-sum dd{margin:0;min-width:0;overflow-wrap:anywhere;}
.ef-sum dd .ef-long{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}
.ef-fold{border-block:1px solid var(--color-border);}
.ef-fold>summary{min-block-size:44px;display:flex;align-items:center;gap:var(--space-8);cursor:pointer;font-weight:600;}
.ef-fold[open]>summary{margin-block-end:var(--space-8);}
.ef-fold .fr-acts{display:flex;flex-wrap:wrap;gap:var(--space-8);justify-content:flex-end;}
button.btn.ghost[data-edit-cancel]{background:transparent;color:var(--color-ink);border-color:transparent;font-weight:400;min-height:44px;}
button.btn.ghost[data-edit-cancel]:hover{text-decoration:underline;text-decoration-color:var(--color-brand);}
.settings-area .ef>.sgroup-h{font-size:var(--font-size-title);font-weight:600;color:var(--color-ink);margin-block:var(--space-32) var(--space-8);}
@media(max-width:600px){.ef-sum>div{grid-template-columns:minmax(0,1fr);gap:0;}}
`;
