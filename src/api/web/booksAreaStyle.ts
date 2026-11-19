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
/* THE UI CORRECTION (2026-11-13, audit F21) — the Advanced entry editor. The form was held to the 40ch form measure
   with an eight-column table inside it, so a select could be 40 px wide and USD read "US". The head is a short grid;
   the lines take the page's width, and every column has a floor wide enough to read what is chosen. */
main:has(.entry-form){max-width:100%;}
.books-area .entry-form{max-width:100%;}
.entry-head{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space-16);max-width:var(--measure-column);}
.entry-head .pq{min-width:0;}.entry-head input,.entry-head select{width:100%;}
/* The fix round (2026-11-13, the tester's F-6) — a closed select shows one line and cuts what does not fit, so in a
   table the account read "6330 · Clients et comp" and a seven-figure amount lost its last figures. Every line is now
   a labelled group at EVERY width: the account on a line of its own, as wide as the page; then who and what; then the
   figures, each amount wide enough for seven figures and their cents. Where a chosen account or party is still wider
   than its box (a phone, a very long name) the page's script writes it out in full under the box (.el-echo). Nothing
   scrolls sideways at any width. */
.entry-lines{border:0;overflow:visible;}
.entry-lines thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.entry-lines table,.entry-lines tbody{display:block;width:100%;min-width:0;}
.entry-lines tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-8) var(--space-12);padding:var(--space-16) 0;border-block-start:1px solid var(--color-border);}
.books-area .entry-lines td{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;padding:0;border:0;white-space:normal;}
.entry-lines td::before{content:attr(data-label);font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.entry-lines .el-account,.entry-lines .el-party,.entry-lines .el-label{grid-column:1/-1;}
.entry-lines .el-account::before{content:attr(data-n) " · " attr(data-label);font-weight:600;color:var(--color-ink);}
.entry-lines select,.entry-lines input:not([type="checkbox"]){width:100%;min-height:44px;padding:var(--space-8);font:inherit;font-size:var(--font-size-small);
  background:var(--color-surface);color:var(--color-ink);border:1px solid var(--color-control-line);border-radius:var(--radius-control);}
.books-area .entry-lines .el-amount input{text-align:end;font-variant-numeric:tabular-nums;padding-inline:var(--space-8);}
.entry-lines .el-fx{flex-direction:row;align-items:center;min-height:44px;}
.entry-lines .el-fx input{inline-size:20px;block-size:20px;flex:none;}
.entry-lines .el-fx-hit{display:inline-flex;align-items:center;justify-content:center;min-inline-size:44px;min-block-size:44px;cursor:pointer;}
.entry-lines .el-echo{font-size:var(--font-size-caption);color:var(--color-ink-secondary);overflow-wrap:anywhere;}
.entry-lines .el-echo:empty{display:none;}
/* A tablet and a small desk: who and what share a line, the figures the next. */
@media(min-width:721px){
 .entry-lines tr{grid-template-columns:repeat(12,minmax(0,1fr));}
 .entry-lines .el-account{grid-column:1/-1;}
 .entry-lines .el-party{grid-column:span 5;}.entry-lines .el-label{grid-column:span 5;order:1;}.entry-lines .el-fx{grid-column:span 2;order:2;align-self:end;}
 .entry-lines .el-tax,.entry-lines .el-currency,.entry-lines .el-amount{grid-column:span 3;order:3;}
 .entry-lines td:not([class]){grid-column:span 4;order:4;}
}
/* A wide desk: everything but the account on one line, the amounts side by side in their own fixed columns. */
@media(min-width:1400px){
 .entry-lines tr{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 92px 144px 144px minmax(0,1.3fr) minmax(64px,auto);}
 .entry-lines .el-party,.entry-lines .el-label,.entry-lines .el-fx,.entry-lines .el-tax,.entry-lines .el-currency,.entry-lines .el-amount,.entry-lines td:not([class]){grid-column:auto;order:0;}
 .entry-lines .el-fx{align-self:end;}
}
.books-area .pcheck{min-height:44px;}
/* F22 (UI correction, Block 5) — the empty lines of a new entry behind one disclosure, in the same form. */
.el-more{margin-block:var(--space-8) var(--space-16);border-block-start:1px solid var(--color-border);}
.el-more>summary{display:flex;align-items:center;min-height:44px;cursor:pointer;font-weight:600;}
.el-more .entry-lines{margin-top:0;}
/* F22 — the books' wide tables. Words wrap, figures keep their line, end-aligned in even widths; whatever is still
   wider than the column scrolls inside the table's own frame, never the page. A link in a row is a 44 px target. */
.books-area .bk-rows th,.books-area .bk-rows td{white-space:normal;vertical-align:top;overflow-wrap:break-word;}
.books-area .bk-rows .num{text-align:end;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums;}
.books-area .bk-rows th.num{text-align:end;}
.books-area .bk-rows td.bk-date,.books-area .bk-rows td.bk-key{white-space:nowrap;overflow-wrap:normal;}
.books-area .bk-rows td>a,.books-area .bk-rows td>span>a{display:inline-flex;align-items:center;min-height:44px;}
@media(min-width:901px){.books-area .bk-cards td{vertical-align:middle;}.books-area .bk-rows td.bk-key,.books-area .bk-rows td.bk-text,.books-area .bk-rows td.bk-date,.books-area .bk-rows td.num,.books-area .bk-rows td.bk-state{padding-block:var(--space-8);}}
.books-area .bk-rows:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px;}
main:has(.bk-orders){max-width:100%;}
.bk-orders .pform{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));align-items:end;gap:var(--space-8) var(--space-12);margin:0;max-width:100%;}
.bk-orders .pform .pq{min-width:0;margin:0;}
.bk-orders .pform .btn{grid-column:1/-1;justify-self:start;}
.bk-orders .pform select{width:100%;}
/* The trial balance has six figures a row: the page gives it its width, and the account stays in view as it scrolls. */
main:has(.bk-tb){max-width:100%;}
.books-area .bk-tb th,.books-area .bk-tb td{padding-inline:var(--space-8);}
.books-area .bk-tb tbody th,.books-area .bk-tb tfoot th,.books-area .bk-tb thead tr:first-child th:first-child{position:sticky;inset-inline-start:0;z-index:1;background:var(--color-surface);min-width:9rem;}
/* A phone or a narrow tablet: each row a card, every value beside its own name; a cell with nothing in it is left out. */
@media(max-width:900px){
 .books-area .bk-rows{border:0;overflow:visible;}
 .bk-rows thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
 .bk-rows table,.bk-rows tbody,.bk-rows tfoot{display:block;width:100%;min-width:0;}
 .bk-rows tr{display:flex;flex-direction:column;gap:var(--space-4);padding-block:var(--space-12);border-block-start:1px solid var(--color-border);}
 .books-area .bk-rows tr>td,.books-area .bk-rows tr>th{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-4) var(--space-12);padding:0;border:0;text-align:start;white-space:normal;position:static;min-width:0;background:none;}
 .books-area .bk-rows tr>td.num{white-space:normal;}
 .bk-rows tr>td[data-label]::before{content:attr(data-label);font-size:var(--font-size-small);color:var(--color-ink-secondary);font-weight:400;}
 .bk-rows tr>td>*{text-align:end;min-width:0;}
 .bk-rows tr>td:empty{display:none;}
 .bk-rows tr>th{font-weight:600;padding-block-end:var(--space-4);}
 .bk-rows tfoot tr{border-block-start-width:2px;}
 .bk-rows td.bk-lead{font-weight:600;}
 .books-area .bk-rows tr>td.bk-act{display:block;min-width:0;}
 .bk-rows td.bk-act .pform{width:100%;grid-template-columns:minmax(0,1fr);}
 .books-area .bk-rows tr>td.bk-key{white-space:normal;}
 .books-area .bk-rows tr>th{display:block;}
}
/* A list of documents on a phone (entries, orders): two columns, each name over its value; the number and its state
   first, then what it is, then its date and amount; the action under them. */
@media(max-width:900px){
 .bk-cards tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-auto-flow:row dense;gap:var(--space-4) var(--space-16);}
 .books-area .bk-cards tr>td{flex-direction:column;flex-wrap:nowrap;align-items:flex-start;justify-content:flex-start;gap:0;}
 .bk-cards tr>td[data-label]::before{font-size:var(--font-size-caption);}
 .bk-cards tr>td>*{text-align:start;}
 .books-area .bk-cards tr>td.num,.books-area .bk-cards tr>td.bk-state{align-items:flex-end;}
 .bk-cards tr>td.num>*{text-align:end;}
 .bk-cards td.bk-key{order:0;grid-column:1;}.bk-cards td.bk-state{order:1;grid-column:2;}
 .bk-cards td.bk-text{order:2;grid-column:1/-1;}
 .bk-cards td.bk-date{order:3;grid-column:1;}.bk-cards td.num{order:4;grid-column:2;}
 .bk-cards td.bk-act{order:5;grid-column:1/-1;}
}
.ba-doors{list-style:none;padding:0;margin-block:var(--space-24);}
.ba-doors li{border-top:1px solid var(--color-border);}
.ba-doors a{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);min-height:64px;padding-block:var(--space-16);}
/* F25 (UI correction, Block 5) — the hub: reports open a page, files download; a file's name over its kind. */
.ba-hub h2{font-size:var(--font-size-title);margin-block:var(--space-32) 0;}
.ba-hub .ba-doors{margin-block-start:var(--space-12);}
.ba-file{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;}
/* F25 — a statement: one table, each figure in its own end-aligned column. On a phone each row is a card: what it
   is across the top, its date and kind side by side, then its figures side by side. */
@media(max-width:900px){
 .bk-cards.bk-stmt td.bk-text{order:0;grid-column:1/-1;}
 .bk-cards.bk-stmt td.bk-text[data-label]::before{content:none;}
 .bk-cards.bk-stmt td.bk-date{order:1;grid-column:1;}
 .bk-cards.bk-stmt td.bk-state{order:1;grid-column:2;}
 .bk-cards.bk-stmt td.bk-acct{order:2;grid-column:1/-1;}
 .bk-cards.bk-stmt td.num{order:3;grid-column:auto;}
 .books-area .bk-cards.bk-stmt tr>td.num,.books-area .bk-cards.bk-stmt tr>td.bk-state{align-items:flex-start;}
 .bk-cards.bk-stmt tr>td.num>*{text-align:start;}
 .books-area .bk-cards.bk-stmt td.bk-note{order:3;grid-column:1/-1;display:block;}
}
/* F25 — Year end in stages, numbered in order. */
/* F25 — on a report page every link is a 44 px target: the way back, a link on its own line, the switches. */
.ba-report>p>a,.ba-report nav.ba-actions a{display:inline-flex;align-items:center;min-height:44px;}
.ye-stages{list-style:none;padding:0;margin:var(--space-32) 0 0;counter-reset:ye;}
#years .ba-doors{margin-block:var(--space-8) 0;}
.ye-stages>li{counter-increment:ye;}.bs-progress{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-12);margin:var(--space-8) 0 var(--space-16);}.bs-progress progress{inline-size:12rem;max-inline-size:100%;block-size:8px;accent-color:var(--color-accent);}.bs-steps{list-style:none;padding:0;margin:0 0 var(--space-32);counter-reset:bs;}.bs-steps>li{counter-increment:bs;border-top:1px solid var(--color-border);}.bs-steps>li:last-child{border-bottom:1px solid var(--color-border);}.bs-steps a{display:flex;align-items:center;gap:var(--space-16);min-height:64px;padding-block:var(--space-12);color:var(--color-ink);text-decoration:none;}.bs-steps a::before{content:counter(bs);display:inline-grid;place-items:center;flex:none;inline-size:28px;block-size:28px;border-radius:var(--radius-chip);border:1px solid var(--color-border);font-variant-numeric:tabular-nums;}.bs-steps li.done a::before{background:var(--color-sand);border-color:transparent;}.bs-step{display:flex;flex-direction:column;gap:var(--space-4);flex:1;min-width:0;}.bs-steps .pill{flex:none;}#money .choices{flex-direction:column;flex-wrap:nowrap;gap:0;list-style:none;}#money .choices label{display:flex;align-items:center;gap:var(--space-8);min-block-size:44px;}@media (max-width:520px){.bs-steps a{display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:var(--space-12);row-gap:var(--space-4);}.bs-steps a::before{grid-column:1;grid-row:1 / span 2;}.bs-step{grid-column:2;grid-row:1;}.bs-steps .pill{grid-column:2;grid-row:2;justify-self:start;}.bs-steps a>svg{grid-column:3;grid-row:1 / span 2;}}.ba-methods>.ba-method{padding:0;}.ba-method>summary{flex-wrap:wrap;row-gap:var(--space-4);gap:var(--space-12);min-height:64px;padding-block:var(--space-16);font-size:inherit;}.ba-method>summary h2{margin:0;flex:1;}.ba-method>summary .pill{flex:none;}.ba-method-body{padding-bottom:var(--space-24);}#new-field form:not(:has(select[name="kind"] option[value="choice"]:checked)) .bf-choices{display:none;}.bf-required{display:flex;flex-direction:column;gap:var(--space-4);}.bf-required .caption{margin:0;}.ye-stages~.block:first-of-type{border-top:1px solid var(--color-border);padding-top:var(--space-32);}
.ye-stages>li>h2::before{content:counter(ye) ". ";}
.ba-overview h2{font-size:var(--font-size-title);}
.ba-work{margin-block:var(--space-24) var(--space-32);}
.ba-money{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-24);margin-block:var(--space-24);}
.ba-money>div{border-top:1px solid var(--color-border);padding-block:var(--space-16);min-width:0;}
.ba-money dt{font-size:var(--font-size-small);margin-bottom:var(--space-12);}
.ba-money dd{margin:0;font-size:var(--font-size-title);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.ba-money p{font-size:var(--font-size-small);line-height:var(--line-height);}
.ba-actions{display:flex;flex-wrap:wrap;gap:var(--space-12);margin-block:var(--space-32);}
/* F17: the Books home. Needs you a line each; the three actions next; one setup step; money in three groups. */
.ba-overview .ba-work{margin-block:var(--space-16) 0;}
.ba-work-head{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:var(--space-16);margin-bottom:var(--space-8);}
.ba-overview .ba-work-head h2{margin:0;}
.ba-work-head p{margin:0;font-size:var(--font-size-small);}
.ba-waiting{display:flex;flex-wrap:wrap;gap:var(--space-8);list-style:none;margin:0;padding:0;}
.ba-waiting a{display:inline-flex;align-items:center;gap:var(--space-8);min-height:44px;padding:0 var(--space-12);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);color:var(--color-ink);text-decoration:none;}
.ba-overview .ba-actions{margin-block:var(--space-16) var(--space-24);}
.ba-setup{margin-block:0 var(--space-24);padding:var(--space-12) var(--space-16);border:1px solid var(--color-border);border-radius:var(--radius-control);background:var(--color-surface);}
.ba-setup a{display:inline-flex;align-items:center;min-height:44px;}
.ba-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-24);margin-block:0 var(--space-16);}
.ba-group{min-width:0;border-top:1px solid var(--color-border);padding-top:var(--space-12);}
.ba-overview .ba-group h2{font-size:var(--font-size-base);font-weight:600;margin:0 0 var(--space-8);}
.ba-group dl{margin:0;}
.ba-fig{padding-block:var(--space-8);min-width:0;}
.ba-fig dt{font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.ba-fig dd{margin:0;font-size:var(--font-size-title);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.ba-fig dd p{font-size:var(--font-size-small);margin:0;}
.ba-period{font-size:var(--font-size-caption);color:var(--color-ink-secondary);margin:0;}
.ba-source{font-size:var(--font-size-small);margin:0;}
.ba-source a{text-decoration:underline;text-underline-offset:3px;}
.ba-source a{display:inline-flex;align-items:center;min-height:44px;}
.ba-note{font-size:var(--font-size-small);color:var(--color-ink-secondary);margin:0;}
.ba-overview>.caption a{display:inline-flex;align-items:center;min-height:44px;}
.ba-overview .rows a{display:inline-flex;flex-wrap:wrap;align-items:center;column-gap:var(--space-4);min-height:44px;}
.ba-how{border-top:1px solid var(--color-border);padding-block:var(--space-8);}
.ba-how summary{cursor:pointer;min-height:44px;display:flex;align-items:center;}
.ba-how dl{margin:0 0 var(--space-16);}
.ba-how dl>div{padding-block:var(--space-8);}
.ba-how dt{font-weight:600;}
.ba-how dd{margin:0;font-size:var(--font-size-small);line-height:var(--line-height);}
.ba-scope{border-block:1px solid var(--color-border);padding-block:var(--space-16);}
.ba-scope summary{cursor:pointer;min-height:44px;}
.ba-scope fieldset{margin-block:var(--space-24);padding:0;border:0;}
.ba-scope label{display:flex;align-items:center;gap:var(--space-12);min-height:44px;}
.ba-scope legend{font-weight:600;margin-bottom:var(--space-12);}
.ba-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);padding-block:var(--space-16);}
.ba-pager a{min-height:44px;display:flex;align-items:center;}
@media(max-width:1100px){.books-area{grid-template-columns:minmax(0,1fr);}.ba-nav{position:static;flex-direction:row;flex-wrap:wrap;border-bottom:1px solid var(--color-border);}.ba-nav a{border-inline-start:0;border-bottom:2px solid transparent;}.ba-nav a[aria-current=page]{border-bottom-color:var(--color-accent);}.ba-nav .ba-advanced,.ba-nav .ba-settings{margin-top:0;}}
@media(max-width:720px){.books-area{gap:var(--space-16);}.ba-sum{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}.ba-fig{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:var(--space-16);align-items:baseline;}.ba-fig dd{text-align:end;}.ba-period,.ba-source{grid-column:1/-1;}.ba-nav{display:none;}.ba-chooser{display:block;}.ba-chooser summary{min-height:44px;display:flex;align-items:center;}.ba-chooser nav a{display:flex;align-items:center;min-height:44px;}}
@media(max-width:600px){.ba-money{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}.ba-actions{flex-direction:column;}.ba-actions .btn{width:100%;}.ba-overview .ba-actions{flex-direction:row;gap:var(--space-8);}.ba-overview .ba-actions .btn{width:auto;}.ba-content .pform{max-width:100%;min-width:0;}}
@media print{.ba-nav,.ba-chooser{display:none;}.books-area{display:block;}}
`;
