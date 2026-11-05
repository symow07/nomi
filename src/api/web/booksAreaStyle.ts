/** Task navigation is separate from documents and data-entry surfaces. */
export const BOOKS_AREA_CSS = String.raw`
main:has(.books-area){max-width:var(--measure-column);}
.books-area{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:var(--space-32);font-size:var(--font-size-base);}
.ba-nav{display:flex;flex-direction:column;align-self:start;position:sticky;top:var(--space-24);}
.ba-nav a{display:flex;align-items:center;min-height:44px;padding:var(--space-12);color:var(--color-ink);text-decoration:none;border-inline-start:2px solid transparent;}
.ba-nav a[aria-current=page]{color:var(--color-accent);border-inline-start-color:var(--color-accent);background:transparent;}
.ba-nav .ba-advanced,.ba-nav .ba-settings{margin-top:var(--space-24);}
.ba-chooser{display:none;}
.ba-content{min-width:0;}
.ba-content>h1.page{margin-top:0;}
.books-area .btn{min-height:44px;}
.books-area .btn.send{color:var(--color-surface);background:var(--color-ink);border-color:var(--color-ink);}
.books-area input:not([type=checkbox]):not([type=radio]),.books-area select,.books-area textarea{min-height:44px;font-size:var(--font-size-base);max-width:100%;}
.books-area .imp-table{max-width:100%;}
.books-area .imp-table table{font-size:var(--font-size-small);}
.books-area .imp-table th,.books-area .imp-table td{padding:var(--space-12);}
.books-area .pcheck{min-height:44px;}
.ba-doors{list-style:none;padding:0;margin-block:var(--space-24);}
.ba-doors li{border-top:1px solid var(--color-border);}
.ba-doors a{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);min-height:64px;padding-block:var(--space-16);}
.ba-overview h2{font-size:var(--font-size-title);}
.ba-work{margin-block:var(--space-24) var(--space-32);}
.ba-money{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-24);margin-block:var(--space-24);}
.ba-money>div{border-top:1px solid var(--color-border);padding-block:var(--space-16);min-width:0;}
.ba-money dt{font-size:var(--font-size-small);margin-bottom:var(--space-12);}
.ba-money dd{margin:0;font-size:var(--font-size-title);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.ba-money p{font-size:var(--font-size-small);line-height:var(--line-height);}
.ba-actions{display:flex;flex-wrap:wrap;gap:var(--space-12);margin-block:var(--space-32);}
.ba-scope{border-block:1px solid var(--color-border);padding-block:var(--space-16);}
.ba-scope summary{cursor:pointer;min-height:44px;}
.ba-scope fieldset{margin-block:var(--space-24);padding:0;border:0;}
.ba-scope label{display:flex;align-items:center;gap:var(--space-12);min-height:44px;}
.ba-scope legend{font-weight:600;margin-bottom:var(--space-12);}
.ba-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);padding-block:var(--space-16);}
.ba-pager a{min-height:44px;display:flex;align-items:center;}
@media(max-width:1100px){.books-area{grid-template-columns:minmax(0,1fr);}.ba-nav{position:static;flex-direction:row;flex-wrap:wrap;border-bottom:1px solid var(--color-border);}.ba-nav a{border-inline-start:0;border-bottom:2px solid transparent;}.ba-nav a[aria-current=page]{border-bottom-color:var(--color-accent);}.ba-nav .ba-advanced,.ba-nav .ba-settings{margin-top:0;}}
@media(max-width:600px){.books-area{gap:var(--space-24);}.ba-nav{display:none;}.ba-chooser{display:block;}.ba-chooser summary{min-height:44px;display:flex;align-items:center;}.ba-chooser nav a{display:flex;align-items:center;min-height:44px;}.ba-money{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}.ba-actions{flex-direction:column;}.ba-actions .btn{width:100%;}.ba-content .pform{max-width:100%;min-width:0;}}
@media print{.ba-nav,.ba-chooser{display:none;}.books-area{display:block;}}
`;
