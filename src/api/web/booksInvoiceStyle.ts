/** Owner documents and editors. Commands stay outside printable paper. */
export const BOOKS_INVOICE_CSS = String.raw`
.books-invoices,.book-doc-page,.book-doc-editor{font-size:var(--font-size-base);line-height:var(--line-height);}
.bd-filters{display:flex;flex-wrap:wrap;gap:var(--space-16);align-items:end;margin-block:var(--space-24);}
.bd-filters label{display:grid;gap:var(--space-8);min-width:0;flex:1;}
.bd-filters input,.bd-filters select{font-size:var(--font-size-base);min-height:44px;width:100%;}
.bd-filters a,.bd-pager a{min-height:44px;display:flex;align-items:center;}
.bd-invoices{list-style:none;margin:0;padding:0;}
.bd-invoice-row{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(0,2fr);gap:var(--space-24);padding-block:var(--space-24);border-top:1px solid var(--color-border);scroll-margin-block-start:var(--space-24);}
.bd-invoice-name{display:flex;align-items:start;flex-direction:column;gap:var(--space-8);min-width:0;overflow-wrap:anywhere;}
.bd-invoice-name>a{min-height:44px;display:flex;align-items:center;font-weight:600;}
.bd-invoice-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-16);margin:0;font-variant-numeric:tabular-nums;}
.bd-invoice-facts dt{font-size:var(--font-size-small);margin-bottom:var(--space-4);}
.bd-invoice-facts dd{margin:0;overflow-wrap:anywhere;}
.bd-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);border-top:1px solid var(--color-border);padding-block:var(--space-16);font-size:var(--font-size-small);}
.book-document{background:var(--color-surface);border:1px solid var(--color-border);padding:var(--space-32);margin-block:var(--space-24);max-width:var(--measure-column);}
.book-document .caption,.book-doc-editor .caption{font-size:var(--font-size-small);}
.bd-header{border-bottom:1px solid var(--color-border);padding-bottom:var(--space-24);margin-bottom:var(--space-32);}
.bd-header h1{font-size:var(--font-size-hero);margin:0 0 var(--space-16);overflow-wrap:anywhere;}
.bd-header>p{margin-block:var(--space-8);}
.bd-parties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-32);margin-bottom:var(--space-32);}
.bd-parties h2{font-size:var(--font-size-base);margin:0 0 var(--space-16);}
.bd-parties p{margin-block:var(--space-8);overflow-wrap:anywhere;}
.bd-address{margin:0;}
.bd-address .row{display:block;border:0;padding-block:var(--space-4);min-width:0;}
.bd-address dt{font-size:var(--font-size-small);}
.bd-address dd{margin:0;white-space:pre-line;overflow-wrap:anywhere;}
.bd-address-text{white-space:pre-line;}
.bd-currency{font-size:var(--font-size-small);margin-top:var(--space-24);}
.bd-lines table{width:100%;border-collapse:collapse;font-size:var(--font-size-base);font-variant-numeric:tabular-nums;}
.bd-lines th,.bd-lines td{padding:var(--space-12) var(--space-8);border-bottom:1px solid var(--color-border);text-align:end;vertical-align:top;overflow-wrap:anywhere;}
.bd-lines th:first-child,.bd-lines td:first-child{text-align:start;width:35%;}
.bd-lines th{font-size:var(--font-size-small);font-weight:500;}
.bd-totals{margin:var(--space-24) 0 0 auto;max-width:var(--measure-form);font-variant-numeric:tabular-nums;}
.bd-totals .row{display:flex;justify-content:space-between;gap:var(--space-24);padding-block:var(--space-12);border-bottom:1px solid var(--color-border);}
.bd-totals dd{margin:0;text-align:end;}
.bd-totals strong{font-size:var(--font-size-title);}
.bd-outside{max-width:var(--measure-prose);}
.bd-outside .row{flex-wrap:wrap;gap:var(--space-8) var(--space-24);}
.bd-actions{margin-block:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border);}
.bd-actions>.pform{margin-top:var(--space-16);}
.book-doc-page .pq,.book-doc-editor .pq{font-size:var(--font-size-base);gap:var(--space-8);}
.book-doc-page .pq input,.book-doc-page .pq select,.book-doc-editor input,.book-doc-editor select,.book-doc-editor textarea{font-size:var(--font-size-base);min-height:44px;max-width:100%;}
.book-doc-page .btn.send,.book-doc-editor .btn.send,.bd-filters .btn{background:var(--color-ink);border-color:var(--color-ink);color:var(--color-surface);min-height:44px;}
.book-doc-editor .bd-editor-form{max-width:100%;gap:var(--space-32);}
.bd-header-fields{border:0;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-24);min-width:0;}
.bd-header-fields>legend{font-size:var(--font-size-title);font-weight:500;margin-bottom:var(--space-24);}
.bd-edit-lines{min-width:0;}
.bd-edit-lines>h2{font-size:var(--font-size-title);margin-bottom:var(--space-24);}
.bd-edit-line{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-24);border:0;border-top:1px solid var(--color-border);padding:var(--space-24) 0;margin:0 0 var(--space-24);min-width:0;}
.bd-edit-line>legend{font-size:var(--font-size-base);font-weight:600;padding-inline-end:var(--space-16);max-width:100%;overflow-wrap:anywhere;}
.bd-edit-line .pq,.bd-header-fields .pq{min-width:0;}
.bd-edit-line input,.bd-edit-line select{width:100%;}
.bd-line-description{grid-column:1/-1;}
.bd-line-facts{display:flex;flex-wrap:wrap;gap:var(--space-24);grid-column:1/-1;margin:0;}
.bd-line-facts dt{font-size:var(--font-size-small);}
.bd-line-facts dd{margin:0;}
.bd-editor-form>.btn{align-self:flex-start;}
/* THE UI CORRECTION (2026-11-13, audit F18) — the editor in its task's order: customer, one item, the rest on request, the total by Save. */
.book-doc-editor{max-width:760px;}
.book-doc-editor .lede{margin-block-end:var(--space-24);}
.bd-customer{margin-block-end:var(--space-32);}
.bd-customer>h2,.bd-edit-lines>h2{font-size:var(--font-size-title);margin:0 0 var(--space-12);}
.bd-customer>.pq select{width:100%;max-width:480px;}
.bd-customer .sr,.bd-edit-line .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.bd-optional{min-width:0;}
.bd-optional>summary{display:inline-flex;align-items:center;gap:var(--space-4);min-height:44px;cursor:pointer;font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.bd-optional[open]>summary{color:var(--color-ink);font-weight:600;}
.bd-add-customer>.pform{margin-top:var(--space-8);padding:var(--space-16);border:1px solid var(--color-border);border-radius:var(--radius-card);max-width:480px;}
.book-doc-editor .bd-editor-form{gap:var(--space-24);}
.bd-edit-line{grid-template-columns:minmax(0,3fr) minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.6fr);gap:var(--space-12) var(--space-16);padding:var(--space-16) 0 var(--space-8);margin:0;}
.bd-edit-line .bd-line-description{grid-column:auto;}
.bd-edit-line .bd-line-account{grid-column:1/-1;}
.bd-edit-line .bd-line-account>.pq{max-width:480px;margin-block:var(--space-4) var(--space-12);}
.bd-edit-line input[name^="quantity"],.bd-edit-line input[name^="price"]{text-align:end;font-variant-numeric:tabular-nums;}
.bd-add-item>summary{display:inline-flex;list-style:none;cursor:pointer;margin-block:var(--space-8);border-radius:var(--radius-control);}
.bd-add-item>summary::-webkit-details-marker,.bd-add-item>summary::before{display:none;}
.bd-add-item>summary .btn::before{content:"+";margin-inline-end:var(--space-8);font-weight:400;}
.bd-add-item[open]>summary{display:none;}
.bd-header-fields{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}
.bd-header-fields>legend{margin-bottom:var(--space-12);}
.bd-header-fields>.pq{max-width:240px;}
.bd-more-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-16);margin-block:var(--space-4) var(--space-8);}
.bd-save{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-16) var(--space-24);padding-block:var(--space-16);border-top:1px solid var(--color-border);}
.bd-save .bd-editor-total{margin:0;flex:1 1 280px;max-width:420px;}
.bd-save .btn{flex:none;}
@media(max-width:600px){
 .bd-filters{align-items:stretch;}.bd-filters label{flex-basis:100%;}.bd-filters .btn{flex:1;}
 .bd-invoice-row{grid-template-columns:minmax(0,1fr);gap:var(--space-16);}
 .book-document{padding:var(--space-20);margin-inline:0;}
 .bd-parties{grid-template-columns:minmax(0,1fr);gap:var(--space-24);}
 .bd-header h1{font-size:var(--font-size-title);}
 .bd-lines thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
 .bd-lines tbody,.bd-lines tr,.bd-lines td{display:block;width:100%;}
 .bd-lines tr{padding-block:var(--space-16);border-bottom:1px solid var(--color-border);}
 .bd-lines td,.bd-lines td:first-child{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-12);border:0;width:100%;padding:var(--space-4) 0;text-align:end;}
 .bd-lines td::before{content:attr(data-label);font-size:var(--font-size-small);text-align:start;}
 .bd-lines td:first-child{display:block;text-align:start;margin-bottom:var(--space-8);}
 .bd-lines td:first-child::before{display:none;}
 .bd-totals{max-width:100%;}.bd-totals .row{gap:var(--space-12);}
 .bd-header-fields,.bd-edit-line{grid-template-columns:minmax(0,1fr);}
 .bd-edit-line{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}
 .bd-edit-line .bd-line-description,.bd-edit-line>label:nth-of-type(4){grid-column:1/-1;}
 .bd-more-fields{grid-template-columns:minmax(0,1fr);}
 .bd-save .btn{flex:1 1 100%;}
 .bd-editor-form>.btn{align-self:stretch;}
}
/* Statement evidence stays beside its available match on wide screens. */
.books-bank,.bank-mapping{font-size:var(--font-size-base);line-height:var(--line-height);}
.books-bank .pq,.bank-mapping .pq{font-size:var(--font-size-base);gap:var(--space-8);min-width:0;}
.books-bank .pform input,.books-bank .pform select,.bank-mapping .pform select{min-height:44px;font-size:var(--font-size-base);width:100%;max-width:100%;}
.books-bank .bb-account{display:flex;flex-direction:row;align-items:end;flex-wrap:wrap;gap:var(--space-16);max-width:100%;margin-block:var(--space-24);}
.bb-account .pq{flex:1 1 20rem;}
.books-bank .btn{min-height:44px;}
.books-bank .btn:not(.ghost),.bank-mapping .btn.send{background:var(--color-ink);border-color:var(--color-ink);color:var(--color-surface);}
.bb-scope{font-size:var(--font-size-small);max-width:var(--measure-prose);}
.bb-upload{margin-block:var(--space-24);border-block:1px solid var(--color-border);padding-block:var(--space-8);}
.bb-upload>summary{cursor:pointer;min-height:44px;padding-block:var(--space-12);font-weight:500;}
.bb-upload>div{padding-block:var(--space-16);scroll-margin-block-start:var(--space-24);}
.bb-upload .caption{font-size:var(--font-size-small);}
.bb-sections{display:flex;flex-wrap:wrap;gap:var(--space-8) var(--space-24);margin-block:var(--space-24) var(--space-8);}
.bb-sections a{display:flex;align-items:center;min-height:44px;}
.bb-review{margin-block:var(--space-32);scroll-margin-block-start:var(--space-24);}
.bb-review>h2{font-size:var(--font-size-title);margin-bottom:var(--space-24);}
.bb-lines{list-style:none;padding:0;margin:0;}
.bb-review-line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-32);border-top:1px solid var(--color-border);padding-block:var(--space-24);}
.bb-wording{font-weight:500;margin:0 0 var(--space-16);overflow-wrap:anywhere;}
.bb-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-16);margin:0;}
.bb-facts dt{font-size:var(--font-size-small);margin-bottom:var(--space-4);}
.bb-facts dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.bb-reference{grid-column:1/-1;}
.bb-amount{font-weight:600;}
.bb-line-actions{min-width:0;}
.bb-suggestion+.bb-suggestion{border-top:1px solid var(--color-border);margin-top:var(--space-24);padding-top:var(--space-24);}
.bb-suggestion p,.bb-line-actions>p{margin-block:0 var(--space-8);overflow-wrap:anywhere;}
.bb-suggestion>a,.bb-line-actions>a{display:inline-flex;align-items:center;min-height:44px;font-weight:500;}
.bb-suggested{font-size:var(--font-size-small);}
.bb-line-actions .pform{margin-block:var(--space-16) 0;max-width:100%;}
.bank-mapping .bb-preview{overflow:auto;max-width:100%;border:1px solid var(--color-border);margin-bottom:var(--space-32);}
.bank-mapping .bb-preview:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px;}
.bank-mapping .bb-preview table{font-size:var(--font-size-small);min-width:100%;}
.bank-mapping .bb-map-form{max-width:100%;gap:var(--space-32);}
.bb-map-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-24);padding:0;border:0;margin:0;min-width:0;}
.bb-map-fields legend{font-size:var(--font-size-title);font-weight:500;margin-bottom:var(--space-24);}
@media(max-width:720px){
 .bb-review-line{grid-template-columns:minmax(0,1fr);gap:var(--space-24);}
 .bb-line-actions .btn{width:100%;}
 .bb-map-fields{grid-template-columns:minmax(0,1fr);}
 .books-bank .bb-account{align-items:stretch;}.bb-account .pq{flex-basis:100%;}.bb-account .btn{width:100%;}
}
@media print{
 body:has(.book-document){background:var(--color-surface);}
 body:has(.book-document) nav,body:has(.book-document) .area-chooser,body:has(.book-document) .skip,body:has(.book-document) dialog,body:has(.book-document) .flash,body:has(.book-document) .live,.bd-outside{display:none!important;}
 body:has(.book-document) main>:not(:has(.book-document)):not(.book-document){display:none!important;}
 body:has(.book-document) .layout,body:has(.book-document) .content{display:block;margin:0;padding:0;}
 body:has(.book-document) main{max-width:100%;width:100%;margin:0;padding:0;}
 .book-document{border:0;padding:0;margin:0;max-width:100%;background:var(--color-surface);}
 .bd-parties{grid-template-columns:repeat(2,minmax(0,1fr));}
 .bd-header,.bd-parties,.bd-totals,.bd-lines tr{break-inside:avoid;}
 .bd-lines thead{position:static;width:auto;height:auto;overflow:visible;clip-path:none;display:table-header-group;}
 .bd-lines tbody{display:table-row-group;}.bd-lines tr{display:table-row;}
 .bd-lines td,.bd-lines td:first-child{display:table-cell;width:auto;text-align:end;padding:var(--space-8);border-bottom:1px solid var(--color-border);}
 .bd-lines td:first-child{text-align:start;}.bd-lines td::before{display:none;}
 .book-document a{color:var(--color-ink);text-decoration:none;}
}
`;
