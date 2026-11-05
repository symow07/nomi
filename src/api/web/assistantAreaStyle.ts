export const ASSISTANT_AREA_CSS=String.raw`
main:has(.assistant-area){max-width:var(--measure-column);}
.assistant-area{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:var(--space-32);font-size:var(--font-size-base);}
.aa-nav{display:flex;flex-direction:column;align-self:start;position:sticky;top:var(--space-24);}
.aa-nav a{display:flex;align-items:center;min-height:44px;padding:var(--space-12);color:var(--color-ink);text-decoration:none;border-inline-start:2px solid transparent;}
.aa-nav a[aria-current=page]{color:var(--color-accent);border-inline-start-color:var(--color-accent);}
.aa-nav .aa-settings{margin-top:var(--space-24);}
.aa-chooser{display:none;}
.aa-content{min-width:0;}
.aa-content>h1.page{margin-top:0;}
.assistant-area .btn,.assistant-area summary{min-height:44px;}
.assistant-area .btn{color:var(--color-surface);background:var(--color-ink);border-color:var(--color-ink);}
.assistant-area input:not([type=checkbox]):not([type=radio]),.assistant-area select,.assistant-area textarea{min-height:44px;font-size:var(--font-size-base);max-width:100%;}
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
.aa-overview .stop-here{margin-top:var(--space-32);padding-top:var(--space-24);border-top:1px solid var(--color-border);}
.aa-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--space-16);padding-block:var(--space-16);}
.aa-pager a{min-height:44px;display:flex;align-items:center;}
.aa-event{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.aa-event p{margin-block:var(--space-8);}
.ask-workspace{display:grid;grid-template-columns:minmax(0,1fr) 13rem;gap:var(--space-32);}
.ask-conversation,.ask-history{min-width:0;}
.ask-history{border-inline-start:1px solid var(--color-border);padding-inline-start:var(--space-24);}
.ask-history h2{font-size:var(--font-size-base);margin-top:var(--space-32);}
.ask-history ul{list-style:none;padding:0;}
.ask-history li{margin-bottom:var(--space-16);overflow-wrap:anywhere;}
.ask-history a{min-height:44px;display:flex;align-items:center;}
.ask-form{display:flex;flex-direction:column;gap:var(--space-12);margin-block:var(--space-24);}
.ask-form textarea{width:100%;resize:vertical;min-height:96px;padding:var(--space-16);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-control);}
.ask-form .btn{align-self:flex-start;}
.ask-line .msg{max-width:100%;margin-block:var(--space-24);}
.ask-line .bubble{max-width:100%;}
.ask-line .bubble.adv{background:var(--color-assistant-wash);padding:var(--space-24);}
.ask-line .bubble.adv>svg{width:16px;height:16px;display:block;margin-bottom:var(--space-12);}
.ask-examples li{padding-block:var(--space-8);}
.ask-sources{margin-top:var(--space-16);font-size:var(--font-size-small);}
.assistant-practice .card{background:transparent;border:0;border-top:1px solid var(--color-border);padding:var(--space-24) 0;}
.assistant-practice .sbx-note{font-size:var(--font-size-small);margin-block:var(--space-16);}
.assistant-practice .sbx-intro{font-size:var(--font-size-small);}
.assistant-practice .msgbar,.assistant-practice .scenariobar{max-width:100%;}
.assistant-practice .msgbar textarea{width:100%;}
.assistant-practice .scenariobar{display:flex;flex-wrap:wrap;gap:var(--space-12);align-items:end;}
.assistant-practice .scenariobar select{min-width:0;max-width:100%;}
.assistant-practice .practice-controls{border-top:1px solid var(--color-border);padding-block:var(--space-24);}
.assistant-practice #readiness{border-top:1px solid var(--color-border);padding-top:var(--space-24);margin-top:var(--space-32);}
.assistant-area .scheck{padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.assistant-area .scheck .proposed{border:0;font-family:inherit;font-size:var(--font-size-base);background:var(--color-assistant-wash);padding:var(--space-24);}
.assistant-area .scfix textarea{width:100%;min-height:96px;}
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
.reading-review form.pform{max-width:100%;}
.reading-review .reading-line{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--space-24);padding-block:var(--space-24);border-top:1px solid var(--color-border);}
.reading-review .reading-line label{grid-column:2;grid-row:1;align-items:start;background:var(--color-assistant-wash);padding:var(--space-16);min-height:44px;}
.reading-review .reading-line blockquote{grid-column:1;grid-row:1;margin:0;overflow-wrap:anywhere;}
.reading-review .reading-line label>span{min-width:0;}
.reading-review .reading-line label svg{display:block;margin-bottom:var(--space-8);}
@media(max-width:650px){.ak-search{display:grid;grid-template-columns:minmax(0,1fr);}.reading-review .reading-line{grid-template-columns:minmax(0,1fr);}.reading-review .reading-line blockquote,.reading-review .reading-line label{grid-column:auto;grid-row:auto;}.reading-review .reading-line blockquote{order:-1;}}
@media(max-width:1100px){.assistant-area{grid-template-columns:minmax(0,1fr);}.aa-nav{position:static;flex-direction:row;flex-wrap:wrap;border-bottom:1px solid var(--color-border);}.aa-nav a{border-inline-start:0;border-bottom:2px solid transparent;}.aa-nav a[aria-current=page]{border-bottom-color:var(--color-accent);}.aa-nav .aa-settings{margin-top:0;}}
@media(max-width:800px){.ask-workspace{grid-template-columns:minmax(0,1fr);}.ask-history{border-inline-start:0;padding-inline-start:0;border-top:1px solid var(--color-border);padding-top:var(--space-24);}}
@media(max-width:600px){.assistant-area{gap:var(--space-24);}.aa-nav{display:none;}.aa-chooser{display:block;}.aa-chooser summary{min-height:44px;display:flex;align-items:center;justify-content:space-between;}.aa-chooser nav a{display:flex;align-items:center;min-height:44px;}.aa-content .pform{max-width:100%;}.aa-pager{flex-wrap:wrap;}}
`;
