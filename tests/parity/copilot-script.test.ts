import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { COPILOT_SCRIPT } from '../../src/api/web/copilotScript.js';

/** A DOM stand-in exercises the actual shipped script, including asynchronous validation. */
class Element {
  attrs: Record<string,string>; children: Element[] = []; parent: Element | null = null; form: Element | null = null;
  value = ''; textContent = ''; hidden = false; isConnected = true; action = ''; name = '';
  selectionStart = 0; selectionEnd = 0; selectionDirection = 'none'; events: string[] = []; focused = false;
  constructor(attrs: Record<string,string> = {}, readonly tag = 'div') { this.attrs = attrs; }
  add(...children: Element[]) { children.forEach((c) => { this.children.push(c); c.parent = this; }); return this; }
  getAttribute(k:string) { return this.attrs[k] ?? null; }
  hasAttribute(k:string) { return k in this.attrs; }
  setAttribute(k:string,v:string) { this.attrs[k] = v; }
  removeAttribute(k:string) { delete this.attrs[k]; }
  contains(c:Element):boolean { return c === this || this.children.some(x => x.contains(c)); }
  matches(s:string):boolean {
    if (s.includes(',')) return s.split(',').some(x => this.matches(x.trim()));
    if (s[0] === '#') return this.attrs['id'] === s.slice(1);
    const m = /^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);
    return !!m && (!m[1] || this.tag === m[1]) && this.hasAttribute(m[2]!) && (m[3] === undefined || this.getAttribute(m[2]!) === m[3]);
  }
  querySelectorAll(s:string):Element[] { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]); }
  querySelector(s:string) { return this.querySelectorAll(s)[0] ?? null; }
  closest(s:string):Element|null { return this.matches(s) ? this : this.parent?.closest(s) ?? null; }
  focus() { this.focused = true; }
  setSelectionRange(a:number,b:number,d='none') { this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d; }
  dispatchEvent(e:{type:string}) { this.events.push(e.type); return true; }
  replaceChildren(c:Element) { this.children=[];this.add(c); }
}
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
function fixture(phone = false, delayAsk = false) {
  const handlers:Record<string,((e:any)=>void)[]> = {};
  const root = new Element({'data-conversation':'c1'});
  const ask = new Element({'data-open-tool':'ask'}), customer = new Element({'data-open-tool':'customer'});
  const form = new Element({},'form'), id = new Element({name:'draftId'},'input'); id.value='actual-draft';
  const box = new Element({'data-keep':'c1:edit'},'textarea'); box.value='my exact words';box.setSelectionRange(3,7);box.form=form; form.add(id,box);
  const slot = new Element({'data-copilot-slot':''}), status = new Element({'data-tool-status':'','data-stale':'stale','data-used':'used','data-no-composer':'take over','data-failed':'failed','data-busy':'Working on your question…'});
  const close = new Element({'data-close-tool':''});
  const tabs = ['customer','ask'].map(x => new Element({'data-tool-tab':x}));
  const panes = ['customer','ask'].map(x => new Element({'data-tool-content':x}));
  const tools = new Element({'data-conversation-tools':'','data-copilot-url':'/app/inbox/c1/copilot'}).add(close,...tabs,...panes,slot,status);
  root.add(ask,customer,form,tools);
  const doc = new Element().add(root) as Element & {addEventListener:Function;importNode:Function};
  doc.addEventListener=(kind:string,handler:(e:any)=>void)=>{(handlers[kind]??=[]).push(handler);};doc.importNode=(x:Element)=>x;
  const calls:{url:string;options:any}[]=[];
  let resolveReply:(x:any)=>void=()=>{};
  const panel = new Element({'data-copilot-panel':'','data-conversation-id':'c1'}).add(new Element({id:'copilot-title'}));
  const fetch = (url:string,options:any) => {
    calls.push({url,options});
    if (url.endsWith('/reply')) return new Promise(resolve => {resolveReply=(answer)=>resolve({json:()=>Promise.resolve(answer)});});
    if (delayAsk && options.method === 'POST') return new Promise(() => {});
    return Promise.resolve({ok:true,text:()=>Promise.resolve('panel')});
  };
  const scrolls: number[][] = [];
  const window = {fetch,addEventListener:doc.addEventListener,scrollX:0,scrollY:420,matchMedia:()=>({matches:phone}),scrollTo(x:number,y:number){scrolls.push([x,y]);this.scrollY=y;}};
  runInNewContext(COPILOT_SCRIPT,{document:doc,window,fetch,location:{pathname:'/app/inbox/c1',search:'',hash:'',href:'https://nomi.test/app/inbox/c1'},history:{pushState(){},replaceState(){}},URL,URLSearchParams,
    FormData:class { [Symbol.iterator]() {return [['revision','r1'],['q','draft a reply']][Symbol.iterator]();} },
    DOMParser:class {parseFromString(){return new Element().add(panel);}},Event:class {constructor(readonly type:string){}}});
  const fire=(kind:string,target:Element,extra:Record<string,unknown>={})=>{const e={target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};handlers[kind]?.forEach(h=>h(e));return e;};
  const use = new Element({'data-copilot-use':''},'form'); use.action='/app/inbox/c1/copilot/reply'; tools.add(use);
  return {scrolls,root,box,id,ask,customer,close,tabs,status,calls,use,tools,fire,resolve:(x:any)=>resolveReply(x)};
}
describe('context panel keeps owner work',()=>{
  it('opening uses only GET, tabs never replace the composer, Escape returns focus and selection',async()=>{
    const f=fixture();f.fire('click',f.ask);await flush();
    expect(f.calls.map(c=>c.options.method)).toEqual(['GET']);
    f.fire('click',f.tabs[0]!);f.fire('click',f.tabs[1]!);
    f.fire('keydown',f.close,{key:'Escape'});
    expect(f.box.value).toBe('my exact words');expect([f.box.selectionStart,f.box.selectionEnd]).toEqual([3,7]);
    expect(f.ask.focused).toBe(true);expect(f.root.hasAttribute('data-tool-open')).toBe(false);
  });
  it('starts a phone pane at its heading and restores the exact conversation scroll on close', () => {
    const f=fixture(true);f.fire('click',f.customer);expect(f.scrolls.at(-1)).toEqual([0,0]);
    f.fire('click',f.close);expect(f.scrolls.at(-1)).toEqual([0,420]);
    expect(f.box.value).toBe('my exact words');expect([f.box.selectionStart,f.box.selectionEnd]).toEqual([3,7]);
  });
  it('keeps the latest caret when the owner edits while a desktop pane is open',()=>{
    const f=fixture();f.fire('click',f.customer);f.box.value+=' typed';f.box.setSelectionRange(19,19);
    f.fire('click',f.close);expect([f.box.selectionStart,f.box.selectionEnd]).toEqual([19,19]);
  });
  it('validates only once, appends to words typed during validation and never submits the reply',async()=>{
    const f=fixture();f.fire('submit',f.use);f.fire('submit',f.use);f.box.value+=' while waiting';
    f.resolve({ok:true,text:'Checked suggestion',revision:'r1',draftId:'actual-draft',assignedTo:null});await flush();
    expect(f.calls).toHaveLength(1);expect(f.calls[0]?.url).toBe('/app/inbox/c1/copilot/reply');
    expect(f.box.value).toBe('my exact words while waiting\n\nChecked suggestion');expect(f.id.value).toBe('actual-draft');expect(f.box.events).toEqual(['input']);
  });
  it('discards pending Use when a new ask starts, its form is removed, or the pane closes', async () => {
    for (const invalidate of ['new ask', 'removed form', 'close']) {
      const f=fixture();f.fire('click',f.ask);await flush();f.fire('submit',f.use);
      if (invalidate === 'new ask') {
        const nextAsk = new Element({'data-copilot-ask':''},'form');nextAsk.action='/app/inbox/c1/copilot';f.tools.add(nextAsk);
        f.fire('submit',nextAsk); // Invalidate immediately, before the replacement fragment arrives.
      } else if (invalidate === 'removed form') f.use.isConnected=false;
      else f.fire('click',f.close);
      f.resolve({ok:true,text:'Old 5% suggestion',draftId:'actual-draft',assignedTo:null});await flush();
      expect(f.box.value).toBe('my exact words');expect(f.box.events).toEqual([]);
      if (invalidate === 'new ask') expect(f.root.getAttribute('data-tool-open')).toBe('ask');
    }
  });
  it('clears dismissed validation status but preserves a newer question status', async () => {
    for (const next of ['close', 'tab', 'new ask']) {
      const f=fixture(false,true);f.fire('click',f.ask);await flush();f.fire('submit',f.use);
      expect(f.status.textContent).toBe('Working on your question…');
      if (next === 'new ask') {
        const form=new Element({'data-copilot-ask':''},'form');form.action='/app/inbox/c1/copilot';f.tools.add(form);f.fire('submit',form);
      }
      f.fire('click',next === 'tab' ? f.tabs[0]! : f.close);
      f.fire('click',f.ask);
      expect(f.status.textContent).toBe(next === 'new ask' ? 'Working on your question…' : '');
      f.resolve({ok:true,text:'Dismissed suggestion',draftId:'actual-draft',assignedTo:null});await flush();
      expect(f.box.value).toBe('my exact words');
      expect(f.status.textContent).toBe(next === 'new ask' ? 'Working on your question…' : '');
    }
  });
  it('does not apply a fresh panel answer to an older visible approval', async () => {
    const f=fixture();f.fire('submit',f.use);
    f.resolve({ok:true,text:'For the replacement draft',revision:'fresh',draftId:'replacement-draft',assignedTo:null});await flush();
    expect(f.box.value).toBe('my exact words');expect(f.status.textContent).toBe('stale');
  });
  it('a manual reply keeps its existing ownership context and never takes over', async () => {
    for (const holder of ['owner','another-person']) {
      const f=fixture();f.box.attrs['data-keep']='c1:reply';f.box.attrs['data-copilot-holder']='owner';f.id.attrs['name']='not-draft';
      f.fire('submit',f.use);f.resolve({ok:true,text:'Manual suggestion',draftId:null,assignedTo:holder});await flush();
      expect(f.box.value).toBe(holder==='owner' ? 'my exact words\n\nManual suggestion' : 'my exact words');
      expect(f.calls.every(c=>c.url.endsWith('/copilot/reply'))).toBe(true);
    }
  });
  it('stale advice or a changed actual draft leaves typed words untouched',async()=>{
    for(const serverStale of [true,false]) {
      const f=fixture();f.fire('submit',f.use);if(!serverStale)f.id.value='replacement-draft';
      f.resolve(serverStale?{ok:false,reason:'stale'}:{ok:true,text:'Do not insert'});await flush();
      expect(f.box.value).toBe('my exact words');expect(f.box.events).toEqual([]);expect(f.status.textContent).toBe('stale');
    }
  });
});
