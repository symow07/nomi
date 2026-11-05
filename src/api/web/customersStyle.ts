/** Shared Customers directory, record and operational-order presentation. */
export const CUSTOMERS_CSS = String.raw`
main:has(.customer-area){max-width:var(--measure-column);}
.customer-area{font-size:var(--font-size-base);color:var(--color-ink);}
.ca-nav{display:flex;flex-wrap:wrap;gap:var(--space-24);border-bottom:1px solid var(--color-border);margin-block-end:var(--space-32);}
.ca-nav a{display:flex;align-items:center;min-height:44px;padding-block:var(--space-12);color:var(--color-ink);text-decoration:none;border-bottom:2px solid transparent;}
.ca-nav a[aria-current="page"]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.ca-chooser{display:none;}
.ca-heading{margin-block-end:var(--space-24);}
.ca-heading h1{margin:0 0 var(--space-12);font-family:var(--font-voice);font-size:var(--font-size-overview-title);font-weight:400;line-height:var(--line-height-tight);}
.ca-heading p,.ca-scope,.ca-basis{max-width:var(--measure-prose);line-height:var(--line-height);}
.ca-filters{display:flex;align-items:end;flex-wrap:wrap;gap:var(--space-16);margin-block-end:var(--space-24);}
.ca-filters label{display:grid;gap:var(--space-8);font-size:var(--font-size-small);min-width:0;}
.ca-search{flex:1 1 22rem;}
.ca-filters input,.ca-filters select{min-height:44px;width:100%;font-size:var(--font-size-base);}
.ca-filters button{min-height:44px;background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink);}
.ca-filters>a{display:flex;align-items:center;min-height:44px;}
.ca-customers,.ca-orders,.ca-conversations ul{list-style:none;padding:0;margin:0;}
.ca-customer{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(8rem,.6fr) minmax(22rem,1.4fr);gap:var(--space-12) var(--space-24);padding-block:var(--space-24);border-top:1px solid var(--color-border);scroll-margin-block-start:var(--space-24);}
.ca-person{display:flex;align-items:center;gap:var(--space-12);color:var(--color-ink);text-decoration:none;min-width:0;min-height:44px;}
.ca-person:hover .ca-name{text-decoration:underline;text-underline-offset:.2em;}
.ca-person>span:last-child{min-width:0;}
.ca-name{display:block;font-size:var(--font-size-base);font-weight:600;overflow-wrap:anywhere;}
.ca-contact{display:block;font-size:var(--font-size-small);margin-top:var(--space-4);overflow-wrap:anywhere;}
.ca-person .face{flex:none;width:44px;height:44px;border-radius:50%;}
.ca-person-state{display:flex;align-content:start;align-items:center;flex-wrap:wrap;gap:var(--space-8);}
.ca-wait{color:var(--color-accent);font-weight:600;}
.ca-label{font-size:var(--font-size-small);padding:var(--space-4) var(--space-8);border:1px solid var(--color-border);border-radius:var(--radius-control);min-height:44px;display:inline-flex;align-items:center;}
.ca-row-facts{display:grid;grid-template-columns:1fr .5fr 1fr;gap:var(--space-16);margin:0;align-items:start;}
.ca-row-facts dt,.ca-order-facts dt{font-size:var(--font-size-small);margin-bottom:var(--space-4);}
.ca-row-facts dd,.ca-order-facts dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.ca-value-note{grid-column:1/-1;font-size:var(--font-size-small);margin:0;max-width:var(--measure-prose);}
.ca-basis{font-size:var(--font-size-small);margin-block:var(--space-16);}
.ca-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);border-top:1px solid var(--color-border);padding-block:var(--space-16);font-size:var(--font-size-small);}
.ca-pager a{display:flex;align-items:center;min-height:44px;}
.ca-empty{padding-block:var(--space-32);max-width:var(--measure-prose);}
.customer-record{max-width:var(--measure-column);}
.customer-record .pcard{max-width:100%;background:transparent;border:0;border-radius:0;box-shadow:none;padding:0;gap:var(--space-16);}
.customer-record .pc-top{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:var(--space-24);text-align:start;}
.customer-record .pc-top>.face{grid-column:1;grid-row:1/5;margin:0;}
.customer-record .pc-top>:not(.face){grid-column:2;}
.customer-record .pc-name{margin:0;overflow-wrap:anywhere;}
.customer-record .pc-meta{justify-content:flex-start;}
.customer-record .pc-facts{display:flex;gap:var(--space-48);flex-wrap:wrap;border-block:1px solid var(--color-border);padding-block:var(--space-16);}
.customer-record .pc-facts>div{background:transparent;padding:0;border:0;border-radius:0;}
.customer-record .pc-facts dd{font-size:var(--font-size-title);font-weight:500;}
.customer-record .pc-things{max-width:var(--measure-prose);}
.customer-record .pc-open{align-self:flex-start;width:auto;background:var(--color-ink);box-shadow:none;}
.customer-record .pc-full{display:none;}
.pc-full{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:var(--space-8);}
.ca-orders-door{display:inline-flex;align-items:center;min-height:44px;margin-block:var(--space-16);}
.ca-conversations{margin-block:var(--space-32);}
.ca-conversations li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-8) var(--space-24);border-top:1px solid var(--color-border);padding-block:var(--space-16);}
.ca-conversations li>div{display:flex;flex-wrap:wrap;gap:var(--space-12);align-items:center;}
.ca-conversations li>p{grid-column:1;margin:0;font-size:var(--font-size-small);}
.ca-conversations li>a{grid-column:2;grid-row:1/3;display:flex;align-items:center;min-height:44px;}
.ca-conversations a[aria-current="page"]{font-weight:600;}
.ca-selected{border-top:1px solid var(--color-border);padding-top:var(--space-24);}
.ca-selected .need-card{background:transparent;border:0;box-shadow:none;padding:0;}
.ca-selected .block{max-width:var(--measure-prose);}
.ca-order{display:grid;grid-template-columns:minmax(13rem,.9fr) minmax(0,2fr);gap:var(--space-8) var(--space-32);border-top:1px solid var(--color-border);padding-block:var(--space-24);scroll-margin-block-start:var(--space-24);}
.ca-order-title{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-8) var(--space-16);}
.ca-order-title>a{font-weight:600;min-height:44px;display:flex;align-items:center;}
.ca-order-title>span{font-size:var(--font-size-small);}
.ca-order-customer{grid-column:1;overflow-wrap:anywhere;}
.ca-order-facts{grid-column:2;grid-row:1/3;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:var(--space-16);margin:0;}
.ca-order-facts dd>span{display:block;margin-top:var(--space-4);}
@media(max-width:1099px){
 .ca-customer{grid-template-columns:minmax(0,1fr) auto;}
 .ca-row-facts{grid-column:1/-1;}
 .ca-order{grid-template-columns:minmax(0,1fr);}
 .ca-order-facts{grid-column:1;grid-row:auto;}
}
@media(max-width:600px){
 .ca-nav{display:none;}.ca-chooser{display:block;margin-bottom:var(--space-24);}
 .ca-chooser summary{min-height:44px;display:flex;align-items:center;cursor:pointer;}
 .ca-chooser nav a{display:flex;align-items:center;min-height:44px;}
 .ca-heading h1{font-size:var(--font-size-display);}
 .ca-filters{align-items:stretch;gap:var(--space-12);}
 .ca-filters label{width:100%;}.ca-search{flex-basis:100%;}
 .ca-filters button{flex:1;}
 .ca-customer{grid-template-columns:minmax(0,1fr);gap:var(--space-12);}
 .ca-person-state{grid-column:1;}.ca-row-facts{grid-template-columns:1fr 1fr;}
 .ca-row-facts>div:last-child{grid-column:1/-1;}
 .customer-record .pc-top{column-gap:var(--space-16);}
 .customer-record .pc-top>.face{width:56px;height:56px;}
 .customer-record .pc-facts{gap:var(--space-24);}
 .ca-conversations li{grid-template-columns:minmax(0,1fr);}
 .ca-conversations li>a{grid-column:1;grid-row:auto;}
 .ca-order-facts{grid-template-columns:1fr 1fr;}.ca-order-facts>div:first-child{grid-column:1/-1;}
 .ca-pager{gap:var(--space-8);}
}
`;
