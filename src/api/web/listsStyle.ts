/** UI correction, Block 9 (F09): long lists. On a desk the columns are named once, above the rows, and the figures sit
 * end-aligned in tabular digits; each row keeps its keys for a screen reader (and shows them on a phone). On a phone a
 * row is two or three lines. Customers (X01), Products (40) and Invoices (19). */
export const LISTS_CSS = String.raw`
.ca-head,.pa-head{display:none;}
@media(min-width:1100px){
 .ca-head,.ca-customers .ca-customer{grid-template-columns:minmax(0,1.3fr) minmax(0,.7fr) minmax(0,.8fr) minmax(6.5rem,.5fr) minmax(0,.9fr);column-gap:var(--space-24);}
 .ca-head{display:grid;align-items:end;padding-block:var(--space-8);font-size:var(--font-size-small);color:var(--color-ink-secondary);}
 .ca-head .num,.ca-customer .ca-f-value,.ca-customer .ca-f-orders{text-align:end;}
 .ca-customers .ca-customer{position:relative;align-items:center;padding-block:var(--space-16);}
 .ca-customer .ca-row-facts{display:contents;}
 .ca-customer .ca-row-facts>div{min-width:0;font-variant-numeric:tabular-nums;}
 .ca-customer .ca-row-facts dt,.pa-products .prod-k{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;}
 .pa-head,.pa-products .prod{grid-template-columns:56px minmax(0,1fr) 11rem 10rem 1.5rem;column-gap:var(--space-24);}
 .pa-head{display:grid;align-items:end;margin-block-start:var(--space-24);padding-block:var(--space-8);border-bottom:1px solid var(--color-border);font-size:var(--font-size-small);color:var(--color-ink-secondary);}
 .pa-head .num,.pa-products .prod-price,.pa-products .prod-moq{text-align:end;}
 .pa-head+.pa-products{margin-block-start:0;}
 .pa-products .prod{display:grid;position:relative;align-items:center;row-gap:0;}
 .pa-products .prod>.pa-thumb{grid-column:1;grid-row:1/span 3;}
 .pa-products .prod-m,.pa-products .prod-b{display:contents;}
 .pa-products .prod-h{grid-column:2;grid-row:1;}
 .pa-products .p-tag{grid-column:2;}
 .pa-products .prod-price{grid-column:3;grid-row:1;}
 .pa-products .prod-moq{grid-column:4;grid-row:1;}
 .pa-products .prod-sep{display:none;}
 .pa-products .prod>.go{grid-column:5;grid-row:1/span 3;justify-self:end;}
}
@media(min-width:901px){
 .books-area .bk-rows.bd-inv td.bk-date,.books-area .bk-rows.bd-inv td.bk-key{white-space:normal;}
 .books-area .bk-rows.bd-inv th,.books-area .bk-rows.bd-inv td{padding-inline:var(--space-8);}
}
@media(max-width:900px){
 .bk-cards.bd-inv tr{grid-template-columns:minmax(0,auto) minmax(0,auto) minmax(0,1fr);}
 .bk-cards.bd-inv td.bk-key{order:0;grid-column:1/span 2;}
 .bk-cards.bd-inv td.bk-state{order:1;grid-column:3;}
 .bk-cards.bd-inv td.bk-text{order:2;grid-column:1/span 2;}
 .bk-cards.bd-inv td.bd-owed{order:3;grid-column:3;}
 .bk-cards.bd-inv td.bk-date{order:4;grid-column:auto;white-space:normal;}
 .bk-cards.bd-inv td.bd-total{order:5;grid-column:3;}
 .bk-cards.bd-inv td.bk-key[data-label]::before,.bk-cards.bd-inv td.bk-text[data-label]::before,.bk-cards.bd-inv td.bk-state[data-label]::before{content:none;}
 .books-area .bk-cards.bd-inv td.bk-text{justify-content:center;}
}
@media(max-width:600px){
 .ca-customers .ca-customer{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"p v" "s s" "l o" "n n";gap:var(--space-8) var(--space-16);padding-block:var(--space-16);position:relative;}
 .ca-customer .ca-person{grid-area:p;}
 .ca-customer .ca-person-state{grid-area:s;}
 .ca-customer .ca-person-state:empty{display:none;}
 .ca-customer .ca-row-facts{display:contents;}
 .ca-customer .ca-row-facts>.ca-f-value{grid-area:v;align-self:center;text-align:end;}
 .ca-customer .ca-row-facts>.ca-f-last{grid-area:l;}
 .ca-customer .ca-row-facts>.ca-f-orders{grid-area:o;text-align:end;}
 .ca-customer .ca-f-value dt{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;}
 .ca-customer .ca-f-last dt,.ca-customer .ca-f-orders dt{display:inline;margin:0;margin-inline-end:var(--space-8);}
 .ca-customer .ca-f-last dd,.ca-customer .ca-f-orders dd{display:inline-block;}
 .ca-customer .ca-value-note{grid-area:n;}
}
.ca-order-head{display:none;}
@media(min-width:1100px){
 .ca-order-head,.customer-orders .ca-orders .ca-order{grid-template-columns:minmax(13rem,.9fr) minmax(0,2fr);column-gap:var(--space-24);}
 .ca-order-head{display:grid;align-items:end;padding-block:var(--space-8);font-size:var(--font-size-small);color:var(--color-ink-secondary);}
 .ca-oh-facts,.customer-orders .ca-order-facts{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);column-gap:var(--space-16);}
 .ca-of3 .ca-oh-facts,.customer-orders .ca-of3 .ca-order-facts{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);}
 .ca-oh-facts .num,.customer-orders .ca-of-amount{text-align:end;}
 .customer-orders .ca-orders .ca-order{position:relative;}
 .customer-orders .ca-order-facts dt{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;}
}
@media(max-width:600px){
 .customer-orders .ca-orders .ca-order{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"t t" "p a" "c s";position:relative;}
 .customer-orders .ca-order-title{grid-area:t;}
 .customer-orders .ca-order-facts{display:contents;}
 .customer-orders .ca-order-facts>div:first-child{grid-area:p;}
 .customer-orders .ca-order-facts>.ca-of-amount{grid-area:a;text-align:end;}
 .customer-orders .ca-order-facts>div:nth-child(3){grid-area:c;}
 .customer-orders .ca-order-facts>div:nth-child(4){grid-area:s;text-align:end;}
 .customer-orders .ca-order-facts>div:first-child dt,.customer-orders .ca-of-amount dt{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0;}
 .customer-orders .ca-order-facts>div:first-child dd>span{display:inline;margin:0;margin-inline-start:var(--space-8);color:var(--color-ink-secondary);}
 .customer-orders .ca-order-facts>div:nth-child(n+3) dt{display:inline;margin:0;margin-inline-end:var(--space-8);}
 .customer-orders .ca-order-facts>div:nth-child(n+3) dd{display:inline-block;}
}
@media(min-width:651px){
 .ak-head .num,.ak-cell.ak-num{text-align:end;font-variant-numeric:tabular-nums;}
}
`;
