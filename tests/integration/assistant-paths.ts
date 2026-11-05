/** Content tests follow the approved daily-page moves. Commands keep their old addresses. */
export function assistantPageUrl(url:string):string {
 const u=new URL(url,'http://localhost');
 const mapped:Record<string,string>={'/app/advisor':'/app/assistant/ask','/app/advisor/earlier':'/app/assistant/ask/history','/app/knowledge':'/app/assistant/knowledge','/app/sandbox':'/app/assistant/practice','/app/ready':'/app/assistant/practice#readiness','/app/onboarding/practice':'/app/assistant/practice#checklist','/app/settings/assistant/checks':'/app/assistant/review','/app/settings/assistant/history':'/app/assistant/activity','/app/settings/assistant/learning':'/app/assistant/knowledge?view=needs-answer','/app/settings/assistant/talk':'/app/assistant/knowledge#sources'};
 const path=mapped[u.pathname]??u.pathname.replace(/^\/app\/advisor\/c\//,'/app/assistant/ask/').replace(/^\/app\/knowledge\/from-page\//,'/app/assistant/knowledge/readings/').replace(/^\/app\/knowledge\/([^/]+)$/,'/app/assistant/knowledge/products/$1');
 const target=new URL(path,'http://localhost');for(const [k,v]of u.searchParams)target.searchParams.set(k,v);if(u.hash)target.hash=u.hash;return target.pathname+target.search+target.hash;
}
