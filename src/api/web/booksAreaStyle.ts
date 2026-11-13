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
.entry-lines tbody{counter-reset:entry-line;}
.entry-lines tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-8) var(--space-12);padding:var(--space-16) 0;border-block-start:1px solid var(--color-border);counter-increment:entry-line;}
.books-area .entry-lines td{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;padding:0;border:0;white-space:normal;}
.entry-lines td::before{content:attr(data-label);font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.entry-lines .el-account,.entry-lines .el-party,.entry-lines .el-label{grid-column:1/-1;}
.entry-lines .el-account::before{content:counter(entry-line) " · " attr(data-label);font-weight:600;color:var(--color-ink);}
.entry-lines select,.entry-lines input:not([type="checkbox"]){width:100%;min-height:44px;padding:var(--space-8);font:inherit;font-size:var(--font-size-small);
  background:var(--color-surface);color:var(--color-ink);border:1px solid var(--color-control-line);border-radius:var(--radius-control);}
.books-area .entry-lines .el-amount input{text-align:end;font-variant-numeric:tabular-nums;padding-inline:var(--space-8);}
.entry-lines .el-fx{flex-direction:row;align-items:center;min-height:44px;}
.entry-lines .el-fx input{inline-size:20px;block-size:20px;flex:none;}
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
