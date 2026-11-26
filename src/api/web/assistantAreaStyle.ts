export const ASSISTANT_AREA_CSS=String.raw`
main:has(.assistant-area){max-width:var(--measure-column);}
.aa-go{display:inline-flex;align-items:center;min-block-size:44px;min-inline-size:44px;}
.assistant-area{font-size:var(--font-size-base);}
.aa-content{min-width:0;}
.aa-content>h1.page{margin-top:0;}
.assistant-area .btn,.assistant-area summary{min-height:44px;}
.assistant-area .btn{color:var(--color-surface);background:var(--color-ink);border-color:var(--color-ink);}
/* Block 2: Practice shares the conversation card's action hierarchy. */
.assistant-practice #approve .btn:not(.send),.assistant-practice .takeover .btn:not(.send),.assistant-practice .sbx-log-h .btn{color:var(--color-ink);background:var(--color-surface);border-color:var(--color-control-line);}
.assistant-practice .sbx-log-h .btn.danger{border-color:var(--color-control-line);border-width:1px;font-weight:400;}
.assistant-practice #approve .btn:not(.send):not(:disabled):hover,.assistant-practice .takeover .btn:not(.send):not(:disabled):hover,.assistant-practice .sbx-log-h .btn:not(:disabled):hover{background:var(--color-sand);border-color:var(--color-ink);}
.assistant-area input:not([type=checkbox]):not([type=radio]),.assistant-area select,.assistant-area textarea{max-width:100%;}
.assistant-area .pform{min-width:0;}
.assistant-area .pcheck{min-height:44px;}
.aa-status{padding-block:var(--space-16);border-block:1px solid var(--color-border);margin-block:var(--space-24) var(--space-32);}
.aa-status p{margin-block:var(--space-8);}
.aa-work{padding-block:var(--space-16);}
.aa-doors{list-style:none;padding:0;margin-block:var(--space-24);}
.aa-doors li{border-top:1px solid var(--color-border);}
.aa-doors a{display:flex;align-items:center;justify-content:space-between;gap:var(--space-24);min-height:64px;padding-block:var(--space-16);}
.aa-doors .caption{display:block;color:var(--color-ink-secondary);font-weight:400;margin-top:var(--space-8);}
.aa-overview h2{font-size:var(--font-size-title);}
.aa-overview blockquote{margin-inline:0;margin-block:var(--space-24) var(--space-8);}
/* N-1 (the third fix round) — the overview quotes the same customers' words Knowledge does, and holds them the same way (F29): the column may shrink, an unbroken address breaks, a long message folds with the whole of it one press away. */
.aa-overview,.aa-overview section,.aa-overview blockquote{min-width:0;max-width:100%;}
.aa-overview blockquote{overflow-wrap:anywhere;word-break:break-word;}
.aa-overview .stop-here{margin-top:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border);}
.aa-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);padding-block:var(--space-16);}
.aa-pager a{min-height:44px;min-width:44px;display:flex;align-items:center;}
/* UI Block 6 · F39: Activity as compact dated events, the day once; filters and pages above and below. */
.aa-filter{display:flex;flex-wrap:wrap;gap:var(--space-4) var(--space-16);border-bottom:1px solid var(--color-border);margin-block:var(--space-16) var(--space-8);}
.aa-filter a{display:flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;border-bottom:2px solid transparent;text-decoration:none;color:var(--color-ink);}
.aa-filter a[aria-current]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.aa-dayset{margin-block:var(--space-16) 0;}
.aa-day{font-size:var(--font-size-base);margin:0 0 var(--space-4);}
.aa-events{list-style:none;padding:0;margin:0;}
.aa-event{display:grid;grid-template-columns:4.5rem minmax(0,1fr);gap:var(--space-16);padding-block:var(--space-8);border-top:1px solid var(--color-border);}
.aa-event time{font-variant-numeric:tabular-nums;color:var(--color-ink-secondary);font-size:var(--font-size-small);padding-block-start:2px;}
.aa-body{min-width:0;overflow-wrap:anywhere;}
.aa-actor{display:block;font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.aa-what{margin:0;}
.aa-body a{display:inline-flex;align-items:center;min-height:44px;}
.ask-business{display:none;}
.ask-workspace{display:grid;grid-template-columns:minmax(0,1fr) 13rem;gap:var(--space-32);}
.ask-conversation,.ask-history{min-width:0;}
.ask-history{border-inline-start:1px solid var(--color-border);padding-inline-start:var(--space-24);}
.ask-history h2{font-size:var(--font-size-base);margin-top:var(--space-32);}
.ask-history ul{list-style:none;padding:0;}
.ask-history li{margin-bottom:var(--space-16);overflow-wrap:anywhere;}
.ask-history a{min-height:44px;display:flex;align-items:center;}
.ask-form{display:flex;flex-direction:column;gap:var(--space-12);margin-block:var(--space-24);}
.ask-form textarea{width:100%;resize:none;}
.ask-form .btn{align-self:flex-start;}
.ask-line .msg{max-width:100%;margin-block:var(--space-24);}
.ask-line .bubble{max-width:100%;}
.ask-line .bubble.adv{background:var(--color-assistant-wash);padding:var(--space-24);}
.ask-line .bubble.adv>svg{width:16px;height:16px;display:block;margin-bottom:var(--space-12);}
.ask-examples li{padding-block:var(--space-8);}
.ask-sources{margin-top:var(--space-16);font-size:var(--font-size-small);}
.assistant-practice .card{background:transparent;border:0;border-radius:0;border-top:1px solid var(--color-border);padding:var(--space-24) 0;}
.assistant-practice .sbx-note{font-size:var(--font-size-small);margin-block:var(--space-16);}
.assistant-practice .sbx-intro{font-size:var(--font-size-small);}
.assistant-practice .msgbar,.assistant-practice .scenariobar{max-width:100%;}
.assistant-practice .msgbar textarea{width:100%;}
.assistant-practice .scenariobar{display:flex;flex-wrap:wrap;gap:var(--space-12);align-items:end;}
.assistant-practice .scenariobar select{min-width:0;max-width:100%;}
.assistant-practice .practice-controls{border-top:1px solid var(--color-border);padding-block:var(--space-24);}
/* UI Block 6 · F38: the box with the conversation, the situation under it, the evidence beside it in one disclosure. */
.assistant-practice .sbx-pair{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;column-gap:var(--space-32);}
.assistant-practice .sbx-pair>*{margin-block:0;}
.assistant-practice .scenariobar .btn,.assistant-practice .mediabar .btn{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}
.assistant-practice .sbx-pair>.practice-trust{border-top:1px solid var(--color-border);padding-block:var(--space-12);min-width:0;}
.assistant-practice .practice-trust>summary .pcount{font-size:inherit;font-weight:400;margin:0;}
.assistant-practice .practice-trust .card{border-top:0;padding-block:var(--space-8);}
.assistant-practice .sbx-scripted{border-top:1px solid var(--color-border);padding-block:var(--space-12);}
.assistant-practice .sbx-scripted h3{font-size:var(--font-size-base);margin:0 0 var(--space-8);}
.assistant-practice .scenariobar{padding-block-start:var(--space-12);border-top:1px solid var(--color-border);}
.assistant-practice .scenariobar label{flex-basis:100%;}
.assistant-practice summary:focus-visible{outline:2px solid var(--color-ink);outline-offset:2px;}
@media (min-width:1200px){.assistant-practice .sbx-pair{grid-template-columns:minmax(0,2fr) minmax(0,1fr);}}
.assistant-practice #readiness{border-top:1px solid var(--color-border);padding-top:var(--space-24);margin-top:var(--space-32);}
.assistant-area .scheck{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.assistant-area .scheck .proposed{border:0;font-family:inherit;font-size:var(--font-size-base);background:var(--color-assistant-wash);padding:var(--space-24);}
.assistant-area .scfix textarea{width:100%;}
.assistant-area .scfix label{display:block;margin-block:var(--space-16);}
.ak-tabs{display:flex;flex-wrap:wrap;gap:var(--space-16);border-bottom:1px solid var(--color-border);margin-block:var(--space-24);}
.ak-tabs a{display:flex;align-items:center;min-height:44px;border-bottom:2px solid transparent;text-decoration:none;color:var(--color-ink);}
.ak-tabs a[aria-current]{color:var(--color-accent);border-bottom-color:var(--color-accent);}
.ak-search{display:flex;flex-wrap:wrap;gap:var(--space-12);align-items:end;margin-block:var(--space-24);}
.ak-search label{align-self:center;}
.ak-search input{min-width:0;flex:1;}
.ak-list{list-style:none;padding:0;}
.ak-list li{border-top:1px solid var(--color-border);}
.ak-list a{display:flex;flex-direction:column;gap:var(--space-8);padding-block:var(--space-24);overflow-wrap:anywhere;}
.ak-list .caption{color:var(--color-ink-secondary);}
.ak-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-8) var(--space-16);margin-block:var(--space-16) var(--space-8);}
/* The controls pass (2026-11-25): the summary is the shared button (class btn); only its fold behaviour is here. */
.ak-add>summary{cursor:pointer;list-style:none;}
.ak-add[open]{flex-basis:100%;}

.ak-add .teach>.sub3,.ak-add #from-page>h2{display:none;}
.ak-add #from-page{margin:0;padding:0;border:0;}
.ak-add>form,.ak-add>.block,.ak-add>p,.ak-add>a{margin-top:var(--space-16);}
.ak-addproduct{display:inline-flex;align-items:center;min-height:44px;}
.ak-found{flex-basis:100%;margin:0;color:var(--color-ink-secondary);}
.ak-head,.ak-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,minmax(6rem,8.5rem));gap:var(--space-4) var(--space-16);align-items:baseline;}
.ak-head{padding-block:var(--space-8);border-bottom:1px solid var(--color-ink);font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.ak-rows{list-style:none;margin:0;padding:0;}
.ak-row{padding-block:var(--space-12);border-bottom:1px solid var(--color-border);}
.ak-main{min-width:0;overflow-wrap:anywhere;word-break:break-word;}
.ak-row .ak-main .kc{margin:var(--space-4) 0 0;color:var(--color-ink-secondary);}
a.ak-name{display:inline-flex;align-items:center;min-height:44px;}
.ak-cell{min-width:0;overflow-wrap:anywhere;font-size:var(--font-size-small);}
.ak-k{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.ak-row .knowledge-change{grid-column:1/-1;}
.ak-row .knowledge-change>summary{display:inline-flex;align-items:center;min-height:44px;}
.assistant-knowledge:has(.ak-products) .ak-head,.ak-products .ak-row{grid-template-columns:minmax(0,1fr) repeat(2,minmax(6rem,8.5rem));}
.aa-pager-above{padding-block:var(--space-8);}
.ki-older>summary{display:inline-flex;align-items:center;min-height:44px;}
.ki-all a{display:inline-flex;align-items:center;min-height:44px;}
.ak-sources{margin-top:var(--space-32);padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.assistant-area .kpage,.assistant-knowledge{max-width:100%;}
.assistant-area .kitem{background:transparent;border-inline:0;border-bottom:0;padding-inline:0;padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.assistant-area .kitem textarea{width:100%;}
.assistant-area .krow-actions{margin-top:var(--space-16);}
.assistant-area .kh{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-8);}
.assistant-area .kh .src{font-size:var(--font-size-small);}
.assistant-area .kc{white-space:pre-wrap;overflow-wrap:anywhere;margin-block:var(--space-16);}
.assistant-area .gap{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.assistant-area .ki-q{font-size:var(--font-size-base);}
/* THE UI CORRECTION (2026-11-13, audit F29) — nothing a customer wrote can widen the page: every column here may shrink,
   an unbroken address breaks where it must, and a long message folds to its first lines with the whole of it in place. */
.assistant-area .aa-content,.assistant-knowledge,.assistant-knowledge .block,.assistant-area .gap,.assistant-area .ki-q,.assistant-area .reqs li,.assistant-area .reqs .q{min-width:0;max-width:100%;}
.assistant-area .src-text,.assistant-area .ki-q,.assistant-area .reqs .q,.assistant-area .ki-acts li{overflow-wrap:anywhere;word-break:break-word;}
.assistant-area .reqs li{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-4) var(--space-12);padding-block:var(--space-8);border-block-end:1px solid var(--color-border);}
.assistant-area .reqs .q{flex:1 1 20ch;}
.src-long{min-width:0;}
.src-long>summary{display:block;cursor:pointer;list-style:none;border-radius:var(--radius-control);}
.src-long>summary::-webkit-details-marker,.src-long>summary::before{display:none;}
.src-long .src-more{display:inline-flex;align-items:center;min-height:44px;font-size:var(--font-size-small);font-weight:600;color:var(--color-ink);text-decoration:underline;text-underline-offset:3px;}
.src-long .src-more::after{content:"";inline-size:0.45em;block-size:0.45em;margin-inline-start:var(--space-8);border-inline-end:1.5px solid currentColor;border-block-end:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px);}
.src-long[open] .src-more::after{transform:rotate(-135deg) translateY(-2px);}
.src-long[open] .src-preview{display:none;}
.src-long .src-full{display:block;white-space:pre-wrap;padding:var(--space-12) var(--space-16);background:var(--color-sand);border-radius:var(--radius-control);max-block-size:50dvh;overflow-y:auto;}
/* Teach and Set aside, and Teach and Try it: two acts, never touching. */
.assistant-area .gacts{flex-wrap:wrap;gap:var(--space-8) var(--space-24);}
.assistant-area .gap>form.given-dismiss{display:block;margin-block-start:var(--space-16);}
.reading-review form.pform{max-width:100%;}
.reading-heads,.reading-review .reading-line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-24);}
.reading-heads{padding-block:var(--space-8);border-bottom:1px solid var(--color-ink);}.reading-heads span{font-size:var(--font-size-small);color:var(--color-ink-secondary);}
.reading-review .reading-lines,.reading-heads{margin:0;max-width:var(--measure-prose);}
.reading-review .reading-line{padding-block:var(--space-16);border-top:0;border-bottom:1px solid var(--color-border);align-items:start;}
.reading-review .reading-line label,.reading-review .reading-line .reading-fact{grid-column:2;grid-row:1;align-items:start;background:none;padding:0;min-height:44px;}
.reading-review .reading-line blockquote{grid-column:1;grid-row:1;margin:0;overflow-wrap:anywhere;}
.reading-review .reading-line blockquote p{margin:0;}
.reading-review .rl-name{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.reading-review .rl-fact,.reading-review .reading-fact{display:flex;flex-direction:column;gap:var(--space-4);min-width:0;overflow-wrap:anywhere;}
.reading-review .reading-line svg{display:inline-block;vertical-align:-2px;margin-inline-end:var(--space-8);}
.reread-confirm{max-width:var(--measure-column);border:1px solid var(--color-border);border-radius:var(--radius-control);padding:var(--space-16) var(--space-24);background:var(--color-surface);}
.reread-confirm p{margin-block:0 var(--space-12);}
.reread-confirm .rr-source{overflow-wrap:anywhere;color:var(--color-ink-secondary);font-size:var(--font-size-small);}
.reread-confirm .rr-cost{border-top:1px solid var(--color-border);padding-top:var(--space-12);}
.reread-confirm .pform{margin:0;}
.reading-review .reading-line label>span{min-width:0;}

@media(max-width:650px){.ak-head{display:none;}.ak-row{display:flex;flex-wrap:wrap;gap:var(--space-4) var(--space-16);}.ak-row>.ak-main,.ak-row>.knowledge-change{flex-basis:100%;}.ak-k{position:static;width:auto;height:auto;overflow:visible;clip-path:none;white-space:normal;color:var(--color-ink-secondary);}.ak-search{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--space-8);}.ak-search label,.ak-search select,.ak-found{grid-column:1/-1;}.reading-heads{display:none;}.reading-review .reading-line{grid-template-columns:minmax(0,1fr);gap:var(--space-8);}.reading-review .reading-line blockquote,.reading-review .reading-line label,.reading-review .reading-line .reading-fact{grid-column:auto;grid-row:auto;}.reading-review .reading-line blockquote{order:-1;}.reading-review .rl-name{position:static;width:auto;height:auto;overflow:visible;clip-path:none;white-space:normal;display:block;}.reading-review .reading-line label,.reading-review .reading-line .reading-fact{border-inline-start:2px solid var(--color-border);padding-inline-start:var(--space-12);}.reading-review .reading-line blockquote{border-inline-start:2px solid var(--color-border);padding-inline-start:var(--space-12);}.reread-confirm{padding:var(--space-16);}}
@media(max-width:800px){.ask-workspace{grid-template-columns:minmax(0,1fr);}.ask-history{border-inline-start:0;padding-inline-start:0;border-top:1px solid var(--color-border);padding-top:var(--space-24);}}
@media(max-width:600px){main:has(.ask-page)>.business-name{display:none;}
.ask-business{display:block;margin:0 0 var(--space-12);font-size:var(--font-size-caption);color:var(--color-ink-secondary);}
.aa-content .pform{max-width:100%;}.aa-pager{flex-wrap:wrap;}
/* Audit F04: where the page IS the section, the chooser is its title (drawn once); the h1 stays for a reader. */
}
`;
