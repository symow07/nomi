/** Presentation destinations only. POST handlers, callbacks and downloads keep their original paths. */
export type SettingsGroup = 'business'|'channels'|'assistant'|'books'|'team'|'billing'|'personal';
export const SETTINGS_MOVES: Readonly<Record<string,string>> = {
 '/app/business':'/app/settings/business',
 '/app/business/how-you-sell':'/app/settings/business/selling',
 '/app/business/selling':'/app/settings/business/selling',
 '/app/business/promises':'/app/settings/assistant/promises',
 '/app/business/ready':'/app/settings/assistant/ready',
 '/app/business/allowlist':'/app/settings/channels/whatsapp/test-numbers',
 '/app/business/channels':'/app/settings/channels',
 '/app/channels/alerts':'/app/settings/personal/notifications#whatsapp',
 '/app/channels/whatsapp':'/app/settings/channels/whatsapp',
 '/app/channels/whatsapp/connect':'/app/settings/channels/whatsapp/connect',
 '/app/channels/meta':'/app/settings/channels/meta',
 '/app/channels/email':'/app/settings/channels/email',
 '/app/channels/chat':'/app/settings/channels/chat',
 '/app/channels/telegram':'/app/settings/channels/telegram',
 '/app/channels/tiktok':'/app/settings/channels/tiktok',
 '/app/help/meta':'/app/settings/channels/meta/help',
 '/app/onboarding/technical':'/app/settings/channels/technical',
 '/app/settings/profile':'/app/settings/business/profile',
 '/app/settings/closures':'/app/settings/business/hours',
 '/app/settings/rate':'/app/settings/business/currency',
 '/app/settings/terms':'/app/settings/business/terms',
 '/app/settings/samples':'/app/settings/business/samples',
 '/app/settings/data':'/app/settings/business/data',
 '/app/settings/forbidden':'/app/settings/assistant/words',
 '/app/settings/people':'/app/settings/team',
 '/app/settings/account':'/app/settings/personal/account',
 '/app/settings/language':'/app/settings/personal/language',
 '/app/settings/alerts':'/app/settings/personal/notifications',
 '/app/settings/advisor-history':'/app/settings/personal/advisor-history',
 '/app/settings/setup':'/app/settings',
 '/app/settings/assistant/next':'/app/settings/assistant#progress',
 '/app/settings/assistant/replies':'/app/settings/assistant#reply-types',
 '/app/settings/assistant/one-kind':'/app/settings/assistant#reply-types',
};
export function settingsDestination(path:string):string|null {
 if(SETTINGS_MOVES[path])return SETTINGS_MOVES[path]!;
 const selling=/^\/app\/business\/selling\/([a-z_]+)(\/confirm)?$/.exec(path);
 return selling?'/app/settings/business/selling/'+selling[1]!.replaceAll('_','-')+(selling[2]??''):null;
}
export function settingsHref(path:string):string {
 if(!path.startsWith('/app/')||path.includes('\\'))return path;
 const u=new URL(path,'http://nomi.local'),target=settingsDestination(u.pathname);
 if(!target)return path;
 const next=new URL(target,u.origin);
 next.search=u.search;
 if(!next.hash)next.hash=u.hash;
 if(u.pathname==='/app/settings/people'&&u.hash==='#assistants')return '/app/settings/assistant/name'+u.search+'#assistants';
 return next.pathname+next.search+next.hash;
}
/** Old command refusals still select their subject, without turning commands into navigable GETs. */
export function settingsGroup(path:string):SettingsGroup|null {
 const p=settingsHref(path).split(/[?#]/)[0]!;
 if(p.startsWith('/app/settings/people/assistants'))return 'assistant';
 for(const group of ['business','channels','assistant','books','team','billing','personal'] as const)
  if(p==='/app/settings/'+group||p.startsWith('/app/settings/'+group+'/'))return group;
 if(/^\/app\/settings\/(?:profile|closures|rate|terms|samples|data)(?:\/|$)/.test(p))return 'business';
 if(/^\/app\/settings\/forbidden(?:\/|$)/.test(p))return 'assistant';
 if(/^\/app\/settings\/people(?:\/|$)/.test(p))return 'team';
 if(/^\/app\/settings\/(?:account|language|alerts|advisor-history)(?:\/|$)/.test(p))return 'personal';
 if(p.startsWith('/app/business/'))return /\/(?:promises|ready)(?:\/|$)/.test(p)?'assistant':p.includes('/allowlist')?'channels':'business';
 if(p.startsWith('/app/channels/'))return p.startsWith('/app/channels/alerts')?'personal':'channels';
 return null;
}
