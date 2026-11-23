import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import type { InboundMessageEvent } from '../../channels/whatsapp/parse.js';
import { CHAT_KEY, VISITOR, businessName, chatPageBusiness, newVisitor, visitorLines, visitorMark, type ChatLine } from '../../db/webChat.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { esc, publicFrame, publicTop, PUBLIC_TOP_CSS } from './layout.js';
import { parseCookies } from './session.js';
import { makeThrottle, callerKey } from './throttle.js';
import * as show from './values.js';
import { widgetScript } from '../../channels/web_chat/widget.js';

/**
 * S7 (Phase 5, item 22) — THE BUSINESS'S CHAT PAGE: `/chat/<key>`, served by Nomi, which the business links to from
 * its site, a profile or a printed code. A buyer writes there, and the answer appears there.
 *
 *   · Nothing to sign up for and nothing fetched from anywhere: the page arrives complete, works without its script
 *     (a plain form that posts and comes back; a link looks again), and the script only asks this page's own mark
 *     every twenty seconds while it is open — and this page itself when the mark moved.
 *   · UI correction Block 8 (F43): with the script, a message is sent without leaving the page. It shows at once as
 *     "Sending…", then "Sent", or "Not sent." with a Try again that posts the very same form (the same `n`: a message
 *     that did arrive is never stored twice). A new answer replaces the thread only — what is being typed stays.
 *     The send is the same POST as the form's, to the same route; no route was added.
 *   · The visitor is a random handle in the page's own cookie (`yf_chat`, this page's path only) — the browser's,
 *     never a name or an address. Clearing it starts a new conversation.
 *   · A message posted here becomes a channel event like a webhook's (`ingest`): stored once (a form sent twice is
 *     the same message), the conversation found or made, the turn queued. Everything after is the product's one
 *     path — the turn, the send gate, the owner's Stop, a person holding it.
 *   · A page switched off, or a workspace that is frozen, answers that it is not answering now, and takes nothing.
 */
export const CHAT_COOKIE = 'yf_chat';
const MAX = 2000;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
/** The page asks this often while it is open, whatever the buyer is doing. */
export const CHAT_EVERY_MS = 20_000;

export type WebChatDeps = {
  readonly db: Db;
  /** The app's one cookie writer (HttpOnly, SameSite=Lax, Secure in production). */
  readonly writeCookie: (reply: FastifyReply, name: string, value: string, o: { readonly path: string; readonly maxAgeSec: number }) => void;
  /** The visitor's message as a channel event — stored once and queued as any webhook's; 'refused' when the page is off or the workspace frozen. */
  readonly ingest: (e: InboundMessageEvent) => Promise<'new' | 'duplicate' | 'refused'>;
  readonly localeOf: (req: FastifyRequest) => Locale;
};

const nonce = (): string => randomBytes(18).toString('base64url');

/**
 * The widget's visitor (S7, on the business's own site): its handle comes with the request — in the frame's address,
 * and in the form — because a cookie inside another site's frame is a third-party cookie, which browsers refuse.
 * The handle is kept in that site's own storage by the widget, and nowhere else.
 */
function embeddedOf(req: FastifyRequest): string | null {
  const v = (req.query as { v?: unknown } | undefined)?.v ?? (req.body as { v?: unknown } | undefined)?.v;
  return typeof v === 'string' && VISITOR.test(v) ? v : null;
}
function visitorOf(req: FastifyRequest): string | null {
  const embedded = embeddedOf(req);
  if (embedded) return embedded;
  const v = parseCookies(req.headers.cookie)[CHAT_COOKIE];
  return v && VISITOR.test(v) ? v : null;
}
function giveVisitor(reply: FastifyReply, key: string, deps: WebChatDeps): string {
  const v = newVisitor();
  // This page's path only, for 180 days, 15552000 s (the registry and the privacy page say the same).
  deps.writeCookie(reply, CHAT_COOKIE, v, { path: `/chat/${key}`, maxAgeSec: 15552000 });
  return v;
}

const CSS = `
  .chat-head h1 { margin-bottom:var(--space-8); }
  .chat-head p { margin:0; }
  .chat-thread { margin:var(--space-24) 0 var(--space-8); }
  .chat-empty { padding:var(--space-16); border:1px dashed var(--color-border); border-radius:var(--radius-card); }
  .chat-lines { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .chat-line { max-width:85%; padding:var(--space-8) var(--space-12); border-radius:var(--radius-card); background:var(--color-surface); border:1px solid var(--color-border);
    white-space:pre-wrap; overflow-wrap:break-word; color:var(--color-ink); scroll-margin-block-end:var(--space-48); }
  .chat-line.mine { align-self:flex-end; background:var(--color-sand); border-color:transparent; }
  .chat-who { display:block; font-size:var(--font-size-small); color:var(--color-ink-secondary); white-space:normal; }
  .chat-state { display:flex; flex-wrap:wrap; align-items:center; gap:var(--space-8); font-size:var(--font-size-small); color:var(--color-ink-secondary); white-space:normal; }
  .chat-line.failed { border-color:var(--color-warn); }
  .chat-line.failed .chat-state { color:var(--color-warn); }
  .chat-retry { min-height:44px; padding:0 var(--space-12); font:inherit; font-weight:600; }
  .chat-again { margin:0 0 var(--space-16); font-size:var(--font-size-small); }
  .chat-again a { display:inline-flex; align-items:center; min-height:44px; }
  .chat-form { position:sticky; inset-block-end:0; z-index:2; background:var(--color-paper); padding-block:var(--space-12) var(--space-16);
    border-block-start:1px solid var(--color-border); }
  .chat-form label { display:block; font-weight:600; margin-bottom:var(--space-4); }
  .chat-form textarea { width:100%; min-height:4.5em; font:inherit; padding:var(--space-12); box-sizing:border-box; border:1px solid var(--color-ink-secondary); border-radius:var(--radius-control); background:var(--color-surface); color:var(--color-ink); resize:vertical; }
  .chat-send { display:flex; justify-content:flex-end; margin-top:var(--space-8); }
  .chat-form button { min-height:44px; padding:0 var(--space-24); font:inherit; font-weight:600; }
  .chat-status { position:absolute; inline-size:1px; block-size:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  .chat-foot { margin-top:var(--space-16); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
`;

/** A value placed in the script: JSON, and never able to close the script element. */
const js = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * The page's one script. It asks only this page's own mark, and this page when the mark moved, and swaps the thread
 * (never the form: a draft stays as it is). A message goes by the form's own POST; while it travels it is shown as
 * sending, then sent, or not sent with a Try again that posts the same fields again — the same `n`, so a message
 * that did arrive is stored once. The next message gets a fresh `n` at once. Without the script none of this runs:
 * the form posts and the page comes back, as it always did. A first message's line shows once its conversation is
 * made (a moment after the post): until then it stays "Sent", and the page looks again after 2.5 s and 7 s.
 */
function script(l: Locale, key: string, business: string, embed: string | null): string {
  const say = {
    you: t(l, 'chat.you'), sending: t(l, 'chat.sending'), sent: t(l, 'chat.sent'), failed: t(l, 'chat.failed'),
    retry: t(l, 'chat.retry'), fresh: t(l, 'chat.fresh', { business }),
  };
  const v = embed ? `?v=${embed}` : '';
  return `<script>(function(){var S=${js(say)},self=${js(`/chat/${key}${v}`)},u=${js(`/chat/${key}/mark${v}`)},E=${CHAT_EVERY_MS};
var f=document.querySelector('form.chat-form'),th=document.getElementById('chat-thread'),st=document.getElementById('chat-status');
if(!f||!th)return;var m=th.getAttribute('data-mark')||'0',busy=false,out=[];
function say(x){st.textContent='';setTimeout(function(){st.textContent=x;},50);}
function mine(x){var n=0,ls=th.querySelectorAll('li.chat-line.mine:not(.pending) > div');for(var i=0;i<ls.length;i++)if(ls[i].textContent===x)n++;return n;}
function theirs(){return th.querySelectorAll('li.chat-line:not(.mine)').length;}
function list(){var o=th.querySelector('ol.chat-lines');if(!o){th.textContent='';o=document.createElement('ol');o.className='chat-lines';th.appendChild(o);}return o;}
function fresh(){var a=new Uint8Array(18),c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',s='';crypto.getRandomValues(a);for(var i=0;i<a.length;i++)s+=c[a[i]&63];return s;}
function near(){return window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-160;}
function show(p,state,why){p.state=state;p.li.className='chat-line mine pending'+(state==='failed'?' failed':'');var s=p.li.querySelector('.chat-state');s.textContent='';
var w=document.createElement('span');w.textContent=state==='sending'?S.sending:state==='sent'?S.sent:(why||S.failed);s.appendChild(w);
if(state==='failed'){var b=document.createElement('button');b.type='button';b.className='chat-retry';b.textContent=S.retry;b.addEventListener('click',function(){go(p);});s.appendChild(b);}}
function swap(doc){var nt=doc&&doc.getElementById('chat-thread');if(!nt)return false;var before=theirs(),low=near();
th.innerHTML=nt.innerHTML;m=nt.getAttribute('data-mark')||m;th.setAttribute('data-mark',m);
out=out.filter(function(p){return !(p.state==='sent'&&mine(p.text)>p.had);});
for(var i=0;i<out.length;i++)list().appendChild(out[i].li);
if(theirs()>before)say(S.fresh);var last=th.querySelector('li.chat-line:last-child');if(low&&last)last.scrollIntoView({block:'nearest'});return true;}
function page(r){return r.text().then(function(h){return new DOMParser().parseFromString(h,'text/html');});}
function look(){if(busy)return;busy=true;fetch(self,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?page(r):null;}).then(function(d){busy=false;if(d)swap(d);}).catch(function(){busy=false;});}
function go(p){show(p,'sending');say(S.sending);
fetch(f.action,{method:'POST',body:p.body,credentials:'same-origin',cache:'no-store'}).then(function(r){
if(r.ok)return page(r).then(function(d){show(p,'sent');say(S.sent);swap(d);if(out.indexOf(p)>=0){setTimeout(look,2500);setTimeout(look,7000);}});
if(r.status===422)return page(r).then(function(d){var a=d.querySelector('p[role=alert]');show(p,'failed',a?a.textContent:'');say(a?a.textContent:S.failed);});
show(p,'failed');say(S.failed);}).catch(function(){show(p,'failed');say(S.failed);});}
f.addEventListener('submit',function(e){var ta=f.querySelector('textarea'),x=ta.value.trim();if(!x||!window.fetch||!window.DOMParser||!window.crypto)return;e.preventDefault();
var body=new URLSearchParams(new FormData(f)),li=document.createElement('li'),who=document.createElement('span'),d=document.createElement('div'),s=document.createElement('span');
who.className='chat-who';who.textContent=S.you;d.dir='auto';d.textContent=x;s.className='chat-state';li.appendChild(who);li.appendChild(d);li.appendChild(s);
var p={li:li,body:body,text:x,had:mine(x),state:''};out.push(p);list().appendChild(li);ta.value='';f.querySelector('input[name=n]').value=fresh();
li.scrollIntoView({block:'nearest'});go(p);});
setInterval(function(){if(document.hidden)return;fetch(u,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.text():m}).then(function(n){if(n!==m)look();}).catch(function(){});},E);})();</script>`;
}

export function renderChatPage(o: {
  readonly locale: Locale; readonly key: string; readonly business: string; readonly lines: readonly ChatLine[];
  readonly mark: string; readonly now: Date; readonly notice?: 'off' | 'tooLong' | null;
  /** The widget's visitor, when the page is inside the business's own site (no cookie: the handle travels). */
  readonly embed?: string | null;
}): string {
  const l = o.locale;
  const embed = o.embed ?? null;
  const self = `/chat/${esc(o.key)}${embed ? `?v=${esc(embed)}` : ''}`;
  const line = (x: ChatLine, i: number) => `<li class="chat-line${x.mine ? ' mine' : ''}"${i === o.lines.length - 1 ? ' id="latest"' : ''}><span class="chat-who">${esc(x.mine ? t(l, 'chat.you') : o.business)} · ${esc(show.when(l, x.at, o.now))}</span><div dir="auto">${esc(x.text)}</div></li>`;
  const notice = o.notice ? `<p role="alert">${esc(t(l, o.notice === 'off' ? 'chat.off' : 'chat.tooLong'))}</p>` : '';
  // The business's page: it opens on the business's name (whose page, and what it is), not on Nomi's top line —
  // the conversation is the business's, and inside the business's own site the frame is theirs already.
  const body = `<header class="chat-head"><h1>${esc(t(l, 'chat.title', { business: o.business }))}</h1>
    <p>${esc(t(l, 'chat.lede', { business: o.business }))}</p></header>
    <div class="chat-thread" id="chat-thread" data-mark="${esc(o.mark)}">${o.lines.length ? `<ol class="chat-lines">${o.lines.map(line).join('')}</ol>` : `<p class="chat-empty">${esc(t(l, 'chat.empty'))}</p>`}</div>
    <p class="chat-again"><a href="${self}#latest">${esc(t(l, 'chat.refresh'))}</a></p>
    <p class="chat-status" id="chat-status" role="status" aria-live="polite"></p>
    <form class="chat-form" method="post" action="/chat/${esc(o.key)}">
      ${notice}<input type="hidden" name="n" value="${esc(nonce())}" />${embed ? `\n      <input type="hidden" name="v" value="${esc(embed)}" />` : ''}
      <label for="chat-text">${esc(t(l, 'chat.label'))}</label>
      <textarea id="chat-text" name="text" required maxlength="${MAX}" dir="auto"></textarea>
      <div class="chat-send"><button type="submit">${esc(t(l, 'chat.send'))}</button></div>
    </form>
    <p class="chat-foot">${esc(t(l, 'chat.kept', { business: o.business }))} <a href="/privacy"${embed ? ' target="_blank" rel="noopener"' : ''}>${esc(t(l, 'chat.privacy'))}</a></p>
    ${script(l, o.key, o.business, embed)}`;
  return publicFrame({ locale: l, title: t(l, 'chat.title', { business: o.business }), body, noindex: true, extraCss: CSS });
}

export function mountWebChat(app: FastifyInstance, deps: WebChatDeps): void {
  const perCaller = makeThrottle({ max: 30, windowMs: 60_000 });
  const page = async (req: FastifyRequest, reply: FastifyReply, notice: 'off' | 'tooLong' | null = null) => {
    const key = (req.params as { key: string }).key;
    const locale = deps.localeOf(req);
    const bid = await chatPageBusiness(deps.db, key);
    const send = (status: number, html: string) => reply.code(status).type('text/html; charset=utf-8')
      .header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-robots-tag', 'noindex, nofollow').send(html);
    // Block 8 (F42) — a chat link that does not work says what may have happened and how to reach the business anyway;
    // like every other 404 here, it names no business (it would say that the page had existed).
    if (!bid) return send(404, publicFrame({ locale, title: t(locale, 'chat.gone'), noindex: true, extraCss: PUBLIC_TOP_CSS,
      body: `${publicTop(locale, '/site', null)}<h1>${esc(t(locale, 'chat.gone'))}</h1><p>${esc(t(locale, 'chat.goneNext'))}</p>` }));
    const embed = embeddedOf(req);
    const visitor = visitorOf(req) ?? giveVisitor(reply, key, deps);
    const { business, lines, mark } = await withTenantTx(deps.db, bid, async (tx) => ({
      business: await businessName(tx, bid), lines: await visitorLines(tx, bid, visitor), mark: await visitorMark(tx, bid, visitor),
    }));
    return send(notice ? 422 : 200, renderChatPage({ locale, key, business, lines, mark, now: new Date(), notice, embed }));
  };

  app.get('/chat/:key', async (req, reply) => page(req, reply));

  app.get('/chat/:key/mark', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    const bid = await chatPageBusiness(deps.db, key);
    const visitor = visitorOf(req);
    if (!bid || !visitor) return reply.code(404).header('cache-control', 'no-store').send('');
    return reply.type('text/plain; charset=utf-8').header('cache-control', 'no-store')
      .send(await withTenantTx(deps.db, bid, (tx) => visitorMark(tx, bid, visitor)));
  });

  app.post('/chat/:key', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (!CHAT_KEY.test(key)) return page(req, reply);
    if (!perCaller.allow(callerKey(req.headers['x-forwarded-for'], req.ip), Date.now())) return reply.code(429).send('');
    const b = (req.body ?? {}) as { text?: unknown; n?: unknown };
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text || text.length > MAX) return page(req, reply, 'tooLong');
    const visitor = visitorOf(req) ?? giveVisitor(reply, key, deps);
    const n = typeof b.n === 'string' && NONCE.test(b.n) ? b.n : nonce();
    const id = `wc:${visitor.slice(0, 8)}:${n}`;
    const r = await deps.ingest({
      kind: 'message', eventId: id, dedupKey: id, waId: visitor, profileName: null, phoneNumberId: key,
      occurredAt: new Date(), messageType: 'text', received: 'text', text, mediaId: null,
    });
    if (r === 'refused') return page(req, reply, 'off');
    const embed = embeddedOf(req);
    return reply.redirect(`/chat/${key}${embed ? `?v=${embed}` : ''}#latest`, 303);
  });

  // The widget: one line on the business's own site draws a button that opens this page in a frame.
  app.get('/chat/:key/widget.js', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (!(await chatPageBusiness(deps.db, key))) return reply.code(404).header('cache-control', 'no-store').send('');
    return reply.type('text/javascript; charset=utf-8').header('cache-control', 'public, max-age=300')
      .send(widgetScript(key, t(deps.localeOf(req), 'chat.open')));
  });
}
