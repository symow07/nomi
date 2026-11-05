/** Spending review: original evidence, a clearly attributed reading, then explicit draft controls. */
export const BOOKS_SPENDING_CSS = String.raw`
.books-spending{min-width:0;max-width:100%;font-size:var(--font-size-base);line-height:1.5}
.books-spending h1{overflow-wrap:anywhere}
.books-spending .bs-header{margin-bottom:var(--space-32)}
.books-spending .bs-header .lede{max-width:var(--measure-prose)}
.books-spending h2{font-family:var(--font-family);font-size:var(--font-size-title);line-height:1.3;margin:0 0 var(--space-16)}
.books-spending .bs-upload{border-block:1px solid var(--color-border);padding:var(--space-16) 0;margin-bottom:var(--space-24)}
.books-spending summary{cursor:pointer;min-height:44px;align-content:center;font-weight:600}
.books-spending .bs-upload .pform{max-width:var(--measure-form);margin-top:var(--space-16)}
.books-spending .bs-filter{display:flex;align-items:end;gap:var(--space-12);margin-bottom:var(--space-24)}
.books-spending .bs-filter label{display:grid;gap:var(--space-8);min-width:0}
.books-spending input,.books-spending select{min-height:44px;font:inherit;max-width:100%;min-width:0}
.books-spending .bs-list,.books-spending .bs-saved-lines{list-style:none;padding:0;margin:0}
.books-spending .bs-list>li,.books-spending .bs-saved-lines>li{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);border-top:1px solid var(--color-border);padding:var(--space-20) 0}
.books-spending .bs-list>li:last-child,.books-spending .bs-saved-lines>li:last-child{border-bottom:1px solid var(--color-border)}
.books-spending .bs-list a{font-weight:600;display:inline-block;min-height:44px;align-content:center;overflow-wrap:anywhere}
.books-spending .bs-list p,.books-spending .bs-saved-lines p{margin:var(--space-4) 0 0}
.books-spending .bs-pagination{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-16);margin-block:var(--space-24)}
.books-spending .bs-pagination>div{display:flex;gap:var(--space-24)}
.books-spending .bs-pagination a{min-height:44px;align-content:center}
.books-spending .bs-review{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:var(--space-24)}
.books-spending .bs-original,.books-spending .bs-reading{min-width:0}
.books-spending .bs-original-image{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain;object-position:top;background:var(--color-surface);border:1px solid var(--color-border)}
.books-spending .bs-original-pdf{width:100%;height:70vh;min-height:20rem;border:1px solid var(--color-border);background:var(--color-surface)}
.books-spending .bs-reading{background:var(--color-assistant-wash);padding:var(--space-24);color:var(--color-ink)}
.books-spending .bs-reading .muted{color:var(--color-ink)}
.books-spending .bs-attribution{display:flex;gap:var(--space-8);align-items:start;font-size:var(--font-size-small)}
.books-spending .bs-attribution svg{flex-shrink:0;margin-top:var(--space-4)}
.books-spending .bs-facts{margin:var(--space-16) 0}
.books-spending .bs-facts>div{display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-16);padding:var(--space-8) 0;border-bottom:1px solid var(--color-border)}
.books-spending .bs-facts dt{flex:1;min-width:0}
.books-spending .bs-facts dd{margin:0;text-align:end;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;max-width:65%}
.books-spending .bs-read-lines{padding-inline-start:var(--space-24);margin-bottom:var(--space-24)}
.books-spending .bs-read-lines>li{margin-block:var(--space-16)}
.books-spending .bs-reading-history{border-top:1px solid var(--color-border);margin-top:var(--space-24);padding-top:var(--space-12)}
.books-spending .bs-reading-history>section{border-top:1px solid var(--color-border);padding-top:var(--space-16)}
.books-spending .bs-draft-choices,.books-spending .bs-post{margin-top:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border)}
.books-spending .pform{max-width:none}
.books-spending .bs-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-20)}
.books-spending .bs-fields .pq{display:grid;gap:var(--space-8);margin:0;min-width:0;align-content:start}
.books-spending fieldset{min-width:0;margin:var(--space-24) 0;padding:var(--space-20) 0;border:0;border-top:1px solid var(--color-border)}
.books-spending legend{max-width:100%;overflow-wrap:anywhere;padding:0 var(--space-12) 0 0;font-size:var(--font-size-base);font-weight:600}
.books-spending .bs-entry-state{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-16)}
.books-spending .bs-entry-state a{min-height:44px;align-content:center}
.books-spending .bs-post .pform{margin-bottom:var(--space-16)}
.books-spending .btn.send{background:var(--color-ink);border-color:var(--color-ink);color:var(--color-surface)}
.books-spending .bs-advanced{border-top:1px solid var(--color-border);padding-top:var(--space-24);margin-top:var(--space-24);min-width:0}
.books-spending .bs-advanced .imp-table{overflow-x:auto;max-width:100%}
@media(max-width:1100px){.books-spending .bs-review{grid-template-columns:1fr}.books-spending .bs-original-image{max-height:55vh}.books-spending .bs-original-pdf{height:55vh}}
@media(max-width:600px){
 .books-spending .bs-fields{grid-template-columns:1fr}
 .books-spending .bs-reading{padding:var(--space-16)}
 .books-spending .bs-list>li,.books-spending .bs-saved-lines>li{align-items:start;flex-direction:column;gap:var(--space-8)}
 .books-spending .bs-filter{align-items:stretch}.books-spending .bs-filter label{flex:1}
 .books-spending .bs-facts dd{max-width:60%}
 .books-spending .bs-saved-lines .bs-facts{width:100%}
}
`;
