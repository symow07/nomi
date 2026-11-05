/** Presentation return context never authorizes a command or accepts an outside address. */
export function assistantReturnHref(value:unknown,fallback='/app/assistant/knowledge'):string {
 if(typeof value!=='string'||/[\\\u0000-\u001f]/.test(value)||!value.startsWith('/app/assistant/knowledge')||value.length>2000)return fallback;
 try{
  const u=new URL(value,'http://localhost');
  if(u.origin!=='http://localhost'||!/^\/app\/assistant\/knowledge(?:\/(?:products|readings)\/[0-9a-f-]{36}(?:\/again)?)?$/.test(u.pathname))return fallback;
  const q=new URLSearchParams();
  for(const key of ['view','q','page','range','state','teach']){const v=u.searchParams.get(key);if(v!==null)q.set(key,v.slice(0,key==='teach'?1000:200));}
  const hash=/^#(?:teach|sources|period|answers-given|from-page|fact-[0-9a-f-]{36})$/.test(u.hash)?u.hash:'';
  return u.pathname+(q.size?'?'+q.toString():'')+hash;
 }catch{return fallback;}
}
