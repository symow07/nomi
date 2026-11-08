/** Block 4.4: scoped import forms and static status rows, on the shared paper surface. */
export const SETUP_MINUTES_CSS = String.raw`
.contact-import,.store-token,.setup-clock{min-inline-size:0;max-inline-size:var(--measure-column);font-size:var(--font-size-base);line-height:1.5;overflow-wrap:anywhere}
.contact-import h1,.contact-import h2,.setup-clock h2,.setup-clock h3{font-family:var(--font-family);overflow-wrap:anywhere}
.contact-import header,.contact-import section,.ci-form,.setup-clock{margin-block-end:var(--space-32)}
.contact-import h2,.setup-clock h2{font-size:var(--font-size-title)}
.contact-import pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--font-size-small);margin-block:var(--space-16)}
.contact-import label:not(.ci-check),.store-token label:not(.st-check){display:block;margin-block:var(--space-12) var(--space-8)}
.contact-import input:not([type=checkbox]),.contact-import select,.contact-import textarea,.store-token input:not([type=checkbox]){font:inherit;display:block;inline-size:100%;max-inline-size:100%;min-inline-size:0;min-block-size:44px;box-sizing:border-box}
.contact-import textarea{resize:vertical}
.ci-form,.store-token form{max-inline-size:var(--measure-form)}
.ci-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:var(--space-8) var(--space-16);align-items:center}
.contact-import .ci-columns label{margin:0}
.ci-check,.st-check{display:flex;align-items:center;gap:var(--space-8);min-block-size:44px;min-inline-size:44px}
.ci-check input,.st-check input{flex:none;accent-color:var(--color-ink)}
.ci-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-12);margin-block:var(--space-16)}
.ci-actions form{margin:0}
.contact-import .btn,.store-token .btn{min-block-size:44px;max-inline-size:100%;white-space:normal;margin-block:var(--space-8)}
.contact-import .btn.send,.store-token .btn.send{background:var(--color-ink);color:var(--color-surface);border-color:var(--color-ink)}
.contact-import .deeper,.contact-import .back,.store-token .deeper,.setup-clock .deeper{display:inline-flex;align-items:center;min-block-size:44px;color:var(--color-accent)}
.ci-count{color:var(--color-ink);font-variant-numeric:tabular-nums}
.ci-table{inline-size:100%;table-layout:fixed;border-collapse:collapse;margin-block:var(--space-16)}
.ci-table th,.ci-table td{text-align:start;vertical-align:top;padding:var(--space-8);overflow-wrap:anywhere;border-block-end:1px solid var(--color-border)}
.ci-selectable th:first-child{inline-size:44px}
.contact-import summary,.store-token>summary{cursor:pointer;min-block-size:44px;align-content:center}
/* The words themselves are the isolate; alignment still follows the page. */
.contact-import summary>bdi,.store-token>summary>bdi,.store-token form>p:last-child>bdi{display:block;min-inline-size:0;text-align:match-parent}
.contact-import summary>bdi,.store-token>summary>bdi{flex:1}
/* Chromium retains start for match-parent here, as it does for cut names. */
[dir="rtl"] .contact-import summary>bdi:dir(ltr),[dir="ltr"] .contact-import summary>bdi:dir(rtl),[dir="rtl"] .store-token>summary>bdi,[dir="rtl"] .store-token form>p:last-child>bdi{text-align:end}
/* Keep the list on the page's start edge, but read each decimal marker as 1. */
.store-token ol>li::marker{direction:ltr;unicode-bidi:isolate}
[dir="rtl"] .store-token ol>li{padding-inline-start:var(--space-8)}
.ci-rows,.setup-clock ol{list-style:none;padding:0;margin:0}
.ci-rows li{padding-block:var(--space-16);border-block-end:1px solid var(--color-border)}
.ci-rows p{margin-block:0 var(--space-8)}
.store-token{margin-block:var(--space-24);border-block:1px solid var(--color-border);padding-block:var(--space-12)}
.store-token form{margin-block:var(--space-16)}
.store-token fieldset{min-inline-size:0;border:0;padding:0;margin-block:var(--space-16)}
.store-token legend{font-weight:600;font-size:var(--font-size-base);padding:0}
.store-token .st-or{margin-block:var(--space-16)}
.store-token .st-check{margin-block:var(--space-16)}
.store-token .st-check>bdi{flex:1;min-inline-size:0;text-align:match-parent}
[dir="rtl"] .store-token .st-check>bdi{text-align:end}
.setup-clock li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:var(--space-8) var(--space-24);padding-block:var(--space-16);border-block-end:1px solid var(--color-border)}
.setup-clock h3{font-size:var(--font-size-base);margin:0}
.setup-clock p{margin:0}
.setup-clock li>p:last-child:not(.sc-state){grid-column:2}
.setup-clock .sc-clock{margin-block:var(--space-16);font-variant-numeric:tabular-nums}
@media(max-width:600px){
 .ci-columns{grid-template-columns:minmax(0,1fr)}
 .ci-table,.ci-table tbody{display:block}
 .ci-table thead{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%)}
 .ci-table tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-8);border-block-end:1px solid var(--color-border);padding-block:var(--space-12)}
 .ci-table td{border:0;padding:0;min-inline-size:0}
 .ci-table .ci-name{grid-column:1;grid-row:1}.ci-table .ci-phone{grid-column:2;grid-row:1}
 .ci-table .ci-language{grid-column:1;grid-row:2}.ci-table .ci-notes-cell,.ci-table td.ci-notes{grid-column:2;grid-row:2}
 .ci-selectable tr{grid-template-columns:44px minmax(0,1fr) minmax(0,1fr)}
 .ci-selectable .ci-tick{grid-column:1;grid-row:1 / span 2}
 .ci-selectable .ci-name,.ci-selectable .ci-language{grid-column:2}.ci-selectable .ci-phone,.ci-selectable .ci-notes-cell{grid-column:3}
 .setup-clock li{grid-template-columns:minmax(0,1fr)}
 .setup-clock li>p:last-child:not(.sc-state){grid-column:1}
}
`;
