export const WA_CATALOGUE_CSS=String.raw`
.wa-catalogue{min-width:0;max-width:100%;}
.wa-catalogue .wc-words{unicode-bidi:isolate;text-align:match-parent;}
.wc-item,.wc-review-row{padding-block:var(--space-24);border-bottom:1px solid var(--color-border);overflow-wrap:anywhere;}
.wc-item h2,.wc-review-row h2{margin-bottom:var(--space-8);}
.wc-item summary{min-height:44px;cursor:pointer;padding-block:var(--space-12);}
.wc-form{display:grid;gap:var(--space-16);max-width:var(--measure-prose);padding-block:var(--space-16);min-width:0;}
.wc-form input,.wc-form textarea,.wc-form select{box-sizing:border-box;max-width:100%;min-width:0;}
.wc-check{display:flex;align-items:center;gap:var(--space-12);min-height:44px;}
.wc-check input{flex:none;width:20px;height:20px;}
.wc-check bdi{flex:1;min-width:0;text-align:match-parent;}
/* Match the existing isolate fallback for engines retaining logical start. */
[dir="rtl"] .wa-catalogue .wc-words:dir(ltr),[dir="rtl"] .wc-check bdi:dir(ltr),
[dir="ltr"] .wc-check bdi:dir(rtl){text-align:end;}
.wa-catalogue form>.btn{margin-block:var(--space-16);}
`;
