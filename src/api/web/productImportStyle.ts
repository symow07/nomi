/** The import remains a sequence of explicit review and confirmation forms. */
export const PRODUCT_IMPORT_CSS = String.raw`
.product-import{font-size:var(--font-size-base);}
.product-import>header{margin-block-end:var(--space-24);}
.product-import>header h1{margin-block:var(--space-16);}
.product-import>header p{max-width:var(--measure-prose);}
.product-import .block{max-width:100%;}
.product-import .imp{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-32);align-items:start;}
.product-import .imp-rows,.product-import .imp-sources{min-width:0;}
.product-import .imp-rows>.block{margin-top:0;margin-bottom:var(--space-32);}
.product-import .imp-row{font-size:var(--font-size-base);padding-block:var(--space-24);}
.product-import .imp-row.need{border-inline-start-color:var(--color-accent);}
.product-import .imp-h{display:block;}
.product-import .imp-h>b{display:block;margin-bottom:var(--space-8);}
.product-import .imp-h .muted{display:block;}
.product-import .imp-warn,.product-import .imp-note,.product-import .rev-src{font-size:var(--font-size-small);line-height:var(--line-height);overflow-wrap:anywhere;}
.product-import .imp-warn{margin-top:var(--space-12);}
.product-import .imp-edit summary{color:var(--color-accent);}
.product-import .imp-edit input:not([type=checkbox]),.product-import .imp-edit textarea,.product-import .imp-edit select{width:100%;min-width:0;font-size:var(--font-size-base);}
.product-import .imp-edit label{margin-block:var(--space-16);}
.product-import .imp-edit .pcheck,.product-import .imp-tick,.product-import .imp-floor{min-height:44px;align-items:flex-start;}
.product-import .imp-typed{align-items:flex-start;flex-direction:column;padding-block:var(--space-12);}
.product-import .imp-typed input{max-width:100%;}
.product-import .imp-acts{border-top:1px solid var(--color-border);padding-top:var(--space-24);margin-top:var(--space-24);}
.product-import .imp-acts .btn{min-height:44px;}
.product-import .imp-sources{position:static;border-top:1px solid var(--color-border);padding-top:var(--space-24);scroll-margin-block-start:var(--space-24);}
.product-import .imp-sources h2{margin-top:0;}
.product-import .imp-photo{padding-block:var(--space-16);}
.product-import .imp-photo textarea{width:100%;font-size:var(--font-size-base);}
.product-import .imp-photo summary{min-height:44px;display:flex;align-items:center;}
.product-import .import-reading{display:flex;align-items:center;gap:var(--space-8);color:var(--color-accent);font-size:var(--font-size-small);font-weight:600;}
.product-import .imp-rows.is-read,.product-import .imp-row.is-read,.product-import .rev:has(.import-reading){background:var(--color-assistant-wash);padding:var(--space-24);}
.product-import .import-source-door,.product-import .import-return{display:inline-flex;align-items:center;min-height:44px;}
.product-import #import-review{scroll-margin-block-start:var(--space-24);}
.product-import-columns .imp-table{max-width:100%;}
.product-import-columns .imp-table:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;}
.product-import-columns .imp-table table{font-size:var(--font-size-small);}
.product-import-columns .imp-table th,.product-import-columns .imp-table td{padding:var(--space-12);}
.product-import-columns .imp-cols{max-width:var(--measure-prose);}
.product-import-columns .imp-cols select{width:100%;min-width:0;font-size:var(--font-size-base);}
.product-import-floors .imp-floor{padding-block:var(--space-24);gap:var(--space-12);}
.product-import-floors .imp-floor>span>span{display:block;margin-top:var(--space-8);}
.product-import-floors .block{max-width:var(--measure-prose);}
@media(min-width:1100px){
 .product-import .imp.with-photos{grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);}
 .product-import .with-photos>.imp-rows{grid-column:2;grid-row:1;}
 .product-import .with-photos>.imp-sources{grid-column:1;grid-row:1;}
}
@media(max-width:600px){
 .product-import .imp-rows.is-read{padding:var(--space-16);}
 .product-import .imp-acts{align-items:stretch;flex-direction:column;}
 .product-import .imp-acts .btn{width:100%;}
 .product-import .imp-pct{max-width:100%;}
}
`;
