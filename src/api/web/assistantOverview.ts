import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Viewer } from '../../core/conversation/people.js';
import { aloneNow } from '../../core/conversation/aloneNow.js';
import { autonomyReleased } from '../../core/conversation/disclosure.js';
import type { EmployeeProfile, HerContext } from './employee.js';
import { aloneInForce } from './employee.js';
import { t, tn, assistantName } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import { flashBanner,type Flash } from './flash.js';
import { sourceText } from './knowledge-insights.js';
export function renderAssistantOverview(e:EmployeeProfile,locale:Locale,viewer:Viewer,flash:Flash|null,context?:HerContext):string {
 const name=assistantName(locale),text=(key:MessageKey)=>esc(t(locale,key,{name}));
 const now=aloneNow({capabilities:e.capabilities,released:autonomyReleased(),named:e.assistantNamed,...(e.earned===undefined?{}:{earned:e.earned}),...(e.ramp?{rung:e.ramp.rung}:{}),stopped:e.stopped===true,silenced:e.silenced===true});
 const reasons:Record<string,MessageKey>={silenced:'today.silenced.title',stopped:'today.stopped.title',release:'her.handles.held.why.release',name:'her.handles.held.why.name',ramp:'her.handles.held.why.ramp'};
 const status=now.hold?text(reasons[now.hold]!):esc(aloneInForce(e,locale));
 // The text audit (2026-11-26): the mode is labelled and its settings are a button; the doors the sidebar already lists are gone;
 // the facts are one line with its act; Stop lives on Going live, one press from here, never drawn twice.
 return `<div class="aa-overview"><h1 class="page"><bdi>${esc(name)}</bdi></h1>${flashBanner(flash)}<div class="aa-status"><p><span class="aa-k">${text('assistantArea.mode')}</span> ${status}</p><a class="aa-go" href="/app/settings/assistant">${text('assistantArea.settings')}</a></div><section class="aa-work"><h2>${text('assistantArea.work')}</h2>${e.spotChecks.length?`<ul class="aa-doors"><li><a href="/app/assistant/review"><span>${text('assistantArea.checks')}</span><span class="pill warn">${esc(show.isolate(locale,String(e.spotChecks.length)))}</span></a></li></ul>`:`<p>${text('assistantArea.none')}</p>`}</section>${context?.gaps.length?`<section><h2>${text('assistantArea.recentQuestions')}</h2>${context.gaps.map(g=>`<blockquote>${sourceText(locale,g.question)}</blockquote><p><a href="/app/assistant/knowledge?view=needs-answer&amp;teach=${encodeURIComponent(g.question)}#teach">${text('assistantArea.teach')}</a></p>`).join('')}</section>`:''}<p class="aa-facts"><span>${esc(tn(locale,'knowledge.product.facts',e.knows))}</span><a class="aa-go" href="/app/assistant/knowledge?view=facts&amp;open=teach#teach">${text('assistantArea.teach')}</a><a class="aa-go" href="/app/results?view=assistant">${text('assistantArea.results')}</a></p>${viewer.isOwner&&e.answering&&!e.stopped?`<p class="stop-here"><a class="aa-go" href="/app/settings/assistant/ready#stop">${text('assistant.stop.action.stop')}</a></p>`:''}</div>`;
}
