import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';
import { t } from './say.js';
import {GO} from './icons.js';
export type AssistantSection='overview'|'knowledge'|'practice'|'review'|'activity'|'ask';
const sections:readonly [AssistantSection,string,MessageKey][]=[
 ['overview','/app/assistant','assistantArea.overview'],['knowledge','/app/assistant/knowledge','assistantArea.knowledge'],
 ['practice','/app/assistant/practice','assistantArea.practice'],['review','/app/assistant/review','assistantArea.review'],
 ['activity','/app/assistant/activity','assistantArea.activity'],['ask','/app/assistant/ask','assistantArea.ask'],
];
/** Old POST responses retain the daily section without moving the command. */
export function assistantSection(path:string):AssistantSection|null {
 const p=path.split(/[?#]/)[0]!;
 if(p==='/app/assistant')return 'overview';
 for(const [key,href] of sections.slice(1))if(p===href||p.startsWith(href+'/'))return key;
 if(p==='/app/advisor'||p.startsWith('/app/advisor/'))return 'ask';
 if(p==='/app/knowledge'||p.startsWith('/app/knowledge/'))return 'knowledge';
 if(p==='/app/sandbox'||p.startsWith('/app/sandbox/'))return 'practice';
 return null;
}
/** The navigation block (2026-11-25): the section sidebar (sections.ts) is the area's one menu; this is the page's frame. */
export function assistantArea(body:string,_locale:Locale,_path:string):string {
 return `<div class="assistant-area"><div class="aa-content">${body}</div></div>`;
}

/** Daily GET destinations are separate from the authoritative Settings commands. */
export function dailyAssistantScreen(screen:string):string|null {
 const daily:Record<string,string>={checks:'/app/assistant/review',history:'/app/assistant/activity',learning:'/app/assistant/knowledge?view=needs-answer',talk:'/app/assistant/knowledge#sources'};
 return daily[screen]??null;
}
