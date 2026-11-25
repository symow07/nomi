/** Shared Customers directory, record and operational-order presentation. */
export const CUSTOMERS_CSS = String.raw`
main:has(.customer-area){max-width:var(--measure-column);}
.customer-area{font-size:var(--font-size-base);color:var(--color-ink);}
.ca-nav{display:flex;flex-wrap:wrap;gap:var(--space-24);border-bottom:1px solid var(--color-border);margin-block-end:var(--space-32);}
.ca-nav a{display:flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding-block:var(--space-12);color:var(--color-ink);text-decoration:none;border-bottom:2px solid transparent;}
.ca-nav a[aria-current="page"]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.ca-chooser{display:none;}
.ca-heading{margin-block-end:var(--space-24);}
.ca-heading h1{margin:0 0 var(--space-12);font-family:var(--font-family);font-size:var(--font-size-overview-title);font-weight:600;line-height:var(--line-height-tight);}
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
.owner-shell .pcard .pc-open{color:var(--color-surface);background:var(--color-ink);box-shadow:none;}
.owner-shell .pcard .pc-open:hover,.owner-shell .pcard .pc-open:focus-visible{box-shadow:none;}
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
.record-section{border-block-start:1px solid var(--color-border);margin:0;padding-block:var(--space-8);min-inline-size:0;}
.record-section>summary,.record-value-basis>summary{min-block-size:44px;cursor:pointer;align-content:center;overflow-wrap:anywhere;}
.record-section>summary{font-size:var(--font-size-base);font-weight:600;}
.record-section[open]>summary{margin-block-end:var(--space-12);}
.record-section>.block{border:0;margin:0;padding-block:var(--space-16);}
.record-section .pform,.record-section .name-form{max-inline-size:var(--measure-form);}
.record-section input,.record-section select,.record-section textarea{min-inline-size:0;max-inline-size:100%;}
.record-section .btn{min-block-size:44px;}
.customer-record .record-overview{gap:var(--space-8);}
.customer-record .record-overview .pc-top{column-gap:var(--space-16);}
.customer-record .record-overview .pc-top>.face{width:56px;height:56px;}
.customer-record .record-overview .pc-meta{margin-block:var(--space-4);font-size:var(--font-size-small);}
.record-latest-order{gap:var(--space-8);font-size:var(--font-size-small);display:flex;align-items:center;min-block-size:44px;overflow-wrap:anywhere;margin-block-start:var(--space-8);}
.record-state{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-4) var(--space-16);font-size:var(--font-size-small);}
.record-summary{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:var(--space-12);padding-block:var(--space-8);}
.customer-record .record-overview .pc-facts{border:0;padding:0;margin:0;gap:var(--space-24);}
.customer-record .record-overview .pc-facts dd{font-size:var(--font-size-title);}
.customer-record .record-overview .pc-h{margin:0 0 var(--space-4);}
.customer-record .record-overview .pc-things{margin:0;padding:0;text-align:start;}
.customer-record .record-overview .pc-list{margin:0;overflow-wrap:anywhere;}
.customer-record .record-overview>.ca-basis{margin:0;}
.record-value-basis{font-size:var(--font-size-small);}
.record-value-basis .ca-basis{margin-block:var(--space-8);}
.owner-shell .customer-record .record-overview .pc-open{background:transparent;color:var(--color-ink);border:0;padding:0;min-block-size:44px;box-shadow:none;}
.customer-record .record-overview .pc-open .go{color:inherit;}
.customer-record .ca-orders-door{margin-block:0 var(--space-8);gap:var(--space-8);font-size:var(--font-size-small);font-weight:600;}
.customer-record .ca-conversations{margin:0;}
.customer-record .ca-selected{border-block-start:1px solid var(--color-border);padding-block-start:var(--space-16);}
.customer-record .ca-selected>h2{font-size:var(--font-size-small);margin:0;}
.record-channel{font-size:var(--font-size-small);margin-block:var(--space-4) var(--space-12);overflow-wrap:anywhere;}
.order-record .ord-head{margin-block-end:var(--space-16);}
.order-record .ord-head>.face-link{flex:none;}
.order-overview{padding-block:0 var(--space-16);}
.order-record .stated-now{font-size:var(--font-size-base);margin-block:0 var(--space-16);}
.order-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-12) var(--space-24);}
.order-facts .frow{align-content:start;align-items:start;display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-4);padding:0;border:0;}
.order-facts .flabel{font-size:var(--font-size-small);}
.order-facts .fval{overflow-wrap:anywhere;}
.order-record .record-section{max-inline-size:100%;}
.order-overview>.order-editor{margin-block-end:var(--space-12);border-block-end:1px solid var(--color-border);}
.order-editor .pform{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-16);max-inline-size:var(--measure-prose);}
.order-editor .pform .fld:first-of-type{grid-column:1/-1;}
.order-editor .pform .btn{justify-self:start;}
.order-document>.doc{background:var(--color-surface);border:1px solid var(--color-border);padding:var(--space-24);max-inline-size:var(--measure-prose);}
.order-progress{display:flex;flex-direction:column;list-style:none;padding:0;margin-block:0 var(--space-24);gap:var(--space-16);}
.order-progress li{border-inline-start:2px solid var(--color-border);padding-inline-start:var(--space-12);}
.order-progress li[aria-current="step"]{border-color:var(--color-ink);}
.order-progress time{display:block;font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.customer-orders .ca-heading{margin-block-end:var(--space-16);}
.customer-orders .ca-filters{gap:var(--space-12);margin-block-end:var(--space-16);}
.customer-orders .ca-order{padding-block:var(--space-12);gap:var(--space-4) var(--space-24);}
.customer-orders .ca-order-customer{min-block-size:44px;display:flex;align-items:center;}
@media(max-width:1099px){
 .ca-customer{grid-template-columns:minmax(0,1fr) auto;}
 .ca-row-facts{grid-column:1/-1;}
 .ca-order{grid-template-columns:minmax(0,1fr);}
 .ca-order-facts{grid-column:1;grid-row:auto;}
}
@media(max-width:720px){
 .ca-nav{display:none;}.ca-chooser{display:block;margin-bottom:var(--space-8);}
 .ca-chooser summary{min-height:44px;display:flex;align-items:center;cursor:pointer;}
 .ca-chooser nav a{display:flex;align-items:center;min-height:44px;}
 .order-record .ord-head,.order-record .stated-now{margin-block-end:var(--space-8);}
 .order-overview>.order-editor:not([open]){padding-block:0;margin-block-end:var(--space-8);}
 .order-overview .order-facts{margin-block-start:var(--space-8);}
}
@media(max-width:600px){
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
 .record-summary{grid-template-columns:minmax(0,1fr);gap:var(--space-12);}
 .customer-record .record-overview .pc-name{font-size:var(--font-size-display);}
 /* Stage and waiting state use the full row, keeping the product in view even
    when a complete Arabic name fills three lines beside the avatar. */
 .customer-record .record-overview .pc-top>.face{grid-row:1/3;}
 .customer-record .record-overview .record-state{grid-column:1/-1;}
 .order-record .ord-head{gap:var(--space-12);}
 .order-record .ord-head .face{width:44px;height:44px;}
 .order-editor .pform{grid-template-columns:minmax(0,1fr);}
 .order-document>.doc{padding:var(--space-16);}
 .customer-orders .ca-order-facts{gap:var(--space-8) var(--space-16);}
}
`;
