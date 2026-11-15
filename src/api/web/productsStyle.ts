/** Products share the owner shell; these are reading and form layouts only. */
export const PRODUCTS_CSS = String.raw`
main:has(.product-area){max-width:var(--measure-column);}
.product-area{font-size:var(--font-size-base);color:var(--color-ink);}
.pa-nav{display:flex;flex-wrap:wrap;gap:var(--space-24);border-bottom:1px solid var(--color-border);margin-bottom:var(--space-32);}
.pa-nav a{display:flex;align-items:center;min-height:44px;padding-block:var(--space-12);color:var(--color-ink);text-decoration:none;border-bottom:2px solid transparent;}
.pa-nav a[aria-current="page"]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.pa-chooser{display:none;}
.product-area h1.page{font-family:var(--font-family);font-size:var(--font-size-overview-title);font-weight:600;line-height:var(--line-height-tight);margin-bottom:var(--space-24);overflow-wrap:anywhere;}
.product-area .block,.product-area .fblock{margin-block:var(--space-32);}
.product-area h2{font-size:var(--font-size-title);line-height:var(--line-height-tight);margin-bottom:var(--space-16);}
.product-area p{line-height:var(--line-height);}
.product-area .btn{min-height:44px;}
.product-area .btn.send,.pa-search .btn{background:var(--color-ink);border-color:var(--color-ink);color:var(--color-surface);}
.pa-search{display:flex;align-items:end;flex-wrap:wrap;gap:var(--space-16);margin-block:var(--space-24);}
.pa-search label{display:grid;gap:var(--space-8);flex:1 1 24rem;min-width:0;font-size:var(--font-size-small);}
.pa-search input{width:100%;min-height:44px;font-size:var(--font-size-base);}
.pa-search>a,.pa-pager a{display:flex;align-items:center;min-height:44px;}
.pa-products{max-width:100%;}
.pa-products .prod{min-height:88px;gap:var(--space-24);padding-block:var(--space-16);text-decoration:none;scroll-margin-block-start:var(--space-24);}
.pa-products .prod:hover .prod-h b{text-decoration:underline;text-underline-offset:.2em;}
.pa-products .prod-h{font-size:var(--font-size-base);overflow-wrap:anywhere;}
.pa-products .prod-b{font-size:var(--font-size-base);line-height:var(--line-height);font-variant-numeric:tabular-nums;}
.pa-products .p-tag{display:block;font-size:var(--font-size-small);margin-top:var(--space-4);}
.pa-thumb{flex:none;width:56px;height:56px;border-radius:var(--radius-control);object-fit:cover;background:var(--color-surface);border:1px solid var(--color-border);}
.pa-initial{display:flex;align-items:center;justify-content:center;color:var(--color-ink-secondary);font-size:var(--font-size-title);}
.pa-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);padding-block:var(--space-16);border-top:1px solid var(--color-border);font-size:var(--font-size-small);font-variant-numeric:tabular-nums;}
.pa-empty{padding-block:var(--space-32);max-width:var(--measure-prose);}
.product-detail{max-width:var(--measure-column);}
.product-detail>.subline{font-size:var(--font-size-base);margin-bottom:var(--space-16);}
.product-detail .rows,.product-detail .info,.product-detail .doors{max-width:var(--measure-prose);}
.product-detail .row{gap:var(--space-16);flex-wrap:wrap;align-items:baseline;padding-block:var(--space-12);}
.product-detail .row b{font-size:var(--font-size-base);}
.product-detail .imgs{display:flex;flex-wrap:wrap;gap:var(--space-16);}
.product-detail .imgs img{max-width:100%;width:14rem;height:14rem;object-fit:contain;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-control);}
.product-detail .pform,.product-limits .pform{max-width:var(--measure-prose);}
.product-area .pq,.product-area .fld,.product-area .pcheck,.product-area .choices legend{font-size:var(--font-size-base);}
.product-area .pq{gap:var(--space-8);}
.product-area .pq input,.product-area .pq select,.product-area .pq textarea{font-size:var(--font-size-base);min-height:44px;max-width:100%;width:100%;}
.product-area .pcheck{min-height:44px;align-items:center;}
.product-area .pcheck input{flex:none;}
.product-area .pform .caption,.product-area .fdesc{font-size:var(--font-size-small);line-height:var(--line-height);}
.product-edit{gap:var(--space-32);}
.pa-fields{display:flex;flex-direction:column;gap:var(--space-24);min-width:0;margin:0;padding:0;border:0;}
.pa-fields>legend{font-size:var(--font-size-base);font-weight:600;padding:0;margin-bottom:var(--space-16);}
.product-optional{border-block:1px solid var(--color-border);padding-block:var(--space-8);}
.product-optional>summary{min-height:44px;cursor:pointer;line-height:var(--line-height);padding-block:var(--space-12);}
.product-optional>.pq,.product-optional>.tiers{margin-block:var(--space-24);}
.product-optional>.tiers{min-width:0;}
.product-optional .tiers .pq{margin-top:var(--space-16);}
.product-edit>.btn{align-self:flex-start;}
.product-add{max-width:var(--measure-prose);}
.product-add .block{max-width:100%;}
.product-add form{display:flex;flex-direction:column;gap:var(--space-16);}
.product-add form>.btn{align-self:flex-start;}
.product-add textarea{width:100%;font-size:var(--font-size-base);}
.product-add .imp-open{border-block:1px solid var(--color-border);padding-block:var(--space-16);}
.pa-methods{display:flex;flex-wrap:wrap;gap:var(--space-8) var(--space-24);margin-block:var(--space-24);}
.pa-methods a{display:flex;align-items:center;min-height:44px;}
.product-add [id],.product-limits [id]{scroll-margin-block-start:var(--space-24);}
.product-limits{max-width:var(--measure-prose);}
.product-limits .pr-name{display:flex;flex-wrap:wrap;gap:var(--space-8) var(--space-16);font-size:var(--font-size-base);overflow-wrap:anywhere;}
.product-limits .row.lines{padding-block:var(--space-24);}
.product-limits .row .pform{margin-top:var(--space-24);}
.product-limits .pform .sub3{font-size:var(--font-size-base);}
.product-limits .acts{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-16);}
.product-limits .acts a,.product-limits summary{min-height:44px;}
.product-limits .acts a{display:flex;align-items:center;}
@media(max-width:600px){
 .pa-nav{display:none;}.pa-chooser{display:block;margin-bottom:var(--space-24);}
 .pa-chooser summary{min-height:44px;display:flex;align-items:center;cursor:pointer;}
 .pa-chooser nav a{display:flex;align-items:center;min-height:44px;}
 .product-area h1.page{font-size:var(--font-size-display);}
 .pa-search{align-items:stretch;gap:var(--space-12);}.pa-search label{flex-basis:100%;}.pa-search .btn{flex:1;}
 .pa-products .prod{gap:var(--space-12);align-items:start;}
 .pa-products .prod>.go{align-self:center;}
 .pa-thumb{width:44px;height:44px;}
 .pa-products .prod-h{gap:var(--space-4) var(--space-8);}
 .pa-pager{gap:var(--space-8);}
 .product-detail .imgs img{width:100%;height:auto;max-height:20rem;}
 .product-area .pform,.product-area .pq,.product-area .fld{min-width:0;max-width:100%;}
 .product-add form>.btn,.product-edit>.btn{align-self:stretch;}
 .product-limits .acts>.btn{flex:1;}
}
`;
