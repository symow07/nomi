import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Viewer } from '../../core/conversation/people.js';
import { aloneNow } from '../../core/conversation/aloneNow.js';
import { autonomyReleased } from '../../core/conversation/disclosure.js';
import type { EmployeeProfile, HerContext } from './employee.js';
import { aloneInForce } from './employee.js';
import { t, assistantName } from './say.js';
import { esc } from './layout.js';
import * as show from './values.js';
import { icon } from './icons.js';
import { flashBanner,type Flash } from './flash.js';
export function renderAssistantOverview(e:EmployeeProfile,locale:Locale,viewer:Viewer,flash:Flash|null,context?:HerContext):string {
 const name=assistantName(locale),text=(key:MessageKey)=>esc(t(locale,key,{name}));
 const now=aloneNow({capabilities:e.capabilities,released:autonomyReleased(),named:e.assistantNamed,...(e.earned===undefined?{}:{earned:e.earned}),...(e.ramp?{rung:e.ramp.rung}:{}),stopped:e.stopped===true,silenced:e.silenced===true});
 const reasons:Record<string,MessageKey>={silenced:'today.silenced.title',stopped:'today.stopped.title',release:'her.handles.held.why.release',name:'her.handles.held.why.name',ramp:'her.handles.held.why.ramp'};
 const status=now.hold?text(reasons[now.hold]!):esc(aloneInForce(e,locale));
 const doors:readonly [string,MessageKey,MessageKey][]=[['/app/assistant/knowledge','assistantArea.knowledge','assistantArea.knowledgeHint'],['/app/assistant/practice','assistantArea.practice','assistantArea.practiceHint'],['/app/assistant/ask','assistantArea.ask','assistantArea.askHint']];
 return `<div class="aa-overview"><p class="caption">${text('nav.assistant')}</p><h1 class="page"><bdi>${esc(name)}</bdi></h1>${flashBanner(flash)}<p class="lede">${text('assistantArea.intro')}</p><div class="aa-status"><p>${status}</p><a href="/app/settings/assistant">${text('assistantArea.settings')}</a></div><section class="aa-work"><h2>${text('assistantArea.work')}</h2>${e.spotChecks.length?`<ul class="aa-doors"><li><a href="/app/assistant/review"><span>${text('assistantArea.checks')}</span><span class="pill warn">${esc(show.isolate(locale,String(e.spotChecks.length)))}</span></a></li></ul>`:`<p>${text('assistantArea.none')}</p>`}</section><ul class="aa-doors">${doors.map(([href,title,hint])=>`<li><a href="${href}"><span>${text(title)}<span class="caption">${text(hint)}</span></span>${icon('go')}</a></li>`).join('')}</ul>${context?.gaps.length?`<section><h2>${text('assistantArea.recentQuestions')}</h2><p class="caption muted">${text('assistantArea.sample')}</p>${context.gaps.map(g=>`<blockquote dir="auto">${esc(g.question)}</blockquote><p><a href="/app/assistant/knowledge?view=needs-answer&amp;teach=${encodeURIComponent(g.question)}#teach">${text('assistantArea.teach')}</a></p>`).join('')}</section>`:''}<section><h2>${text('assistantArea.savedFacts')}</h2><p>${esc(show.isolate(locale,String(e.knows)))}</p>${e.knows===0?`<p>${text('assistantArea.noFacts')}</p>`:''}<p><a href="/app/results?view=assistant">${text('assistantArea.results')}</a></p></section>${viewer.isOwner&&e.answering&&!e.stopped?`<div class="stop-here"><p>${text('her.stop.lede')}</p><form method="post" action="/app/business/stop-assistant"><input type="hidden" name="from" value="assistant"><button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${text('assistant.stop.action.stopConfirm')}">${text('assistant.stop.action.stop')}</button></form></div>`:''}</div>`;
}
