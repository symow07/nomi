/**
 * S7 — THE WIDGET, as the business's site runs it. It draws one button; pressed, it opens the business's chat page in
 * a frame, from the same address the script came from. The visitor's handle is made once, in the visitor's own
 * browser, and kept in that site's storage — never a cookie of Nomi's on someone else's site. Nothing else is read,
 * sent or loaded.
 *
 * Its two styles are written out: it draws on the business's own page, where none of Nomi's design tokens exist, so
 * it cannot draw from them (the rule that pages draw only from the tokens is about Nomi's own pages, src/api/web).
 */
export function widgetScript(key: string, label: string): string {
  return `(function(){var me=document.currentScript;if(!me)return;var o=new URL(me.src).origin,k=${JSON.stringify(key)},s='nomi_chat_'+k,v=null;
try{v=localStorage.getItem(s)}catch(e){}
if(!v||!/^[A-Za-z0-9_-]{32}$/.test(v)){var a=new Uint8Array(24);crypto.getRandomValues(a);v=btoa(String.fromCharCode.apply(null,a)).replace(/[+]/g,'-').replace(/[/]/g,'_');try{localStorage.setItem(s,v)}catch(e){}}
var b=document.createElement('button'),f=null;b.type='button';b.setAttribute('aria-label',${JSON.stringify(label)});b.textContent='\u{1F4AC}';
b.style.cssText='position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:28px;border:0;font-size:26px;cursor:pointer;z-index:2147483646;box-shadow:0 2px 8px rgba(0,0,0,.25)';
b.onclick=function(){if(f){f.remove();f=null;return}f=document.createElement('iframe');f.src=o+'/chat/'+k+'?v='+encodeURIComponent(v);f.title=${JSON.stringify(label)};
f.style.cssText='position:fixed;right:16px;bottom:84px;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));border:1px solid #ccc;border-radius:12px;background:#fff;z-index:2147483647';
document.body.appendChild(f)};document.body.appendChild(b)})();`;
}
