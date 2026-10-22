import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { withTenantTx } from '../../db/client.js';
import type { InboundMessageEvent } from '../../channels/whatsapp/parse.js';
import { CHAT_KEY, VISITOR, businessName, chatPageBusiness, newVisitor, visitorLines, visitorMark, type ChatLine } from '../../db/webChat.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { esc, publicDocument } from './layout.js';
import { parseCookies } from './session.js';
import { makeThrottle, callerKey } from './throttle.js';
import * as show from './values.js';
import { widgetScript } from '../../channels/web_chat/widget.js';

/**
 * S7 (Phase 5, item 22) — THE BUSINESS'S CHAT PAGE: `/chat/<key>`, served by Nomi, which the business links to from
 * its site, a profile or a printed code. A buyer writes there, and the answer appears there.
 *
 *   · Nothing to sign up for and nothing fetched from anywhere: the page arrives complete, works without its script
 *     (a link looks again), and the script only asks this page's own mark every twenty seconds while it is open.
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
  .chat-lines { list-style:none; margin:var(--space-16) 0; padding:0; display:flex; flex-direction:column; gap:var(--space-8); }
  .chat-line { max-width:85%; padding:var(--space-8) var(--space-12); border-radius:var(--radius-card); background:var(--color-sand);
    white-space:pre-wrap; overflow-wrap:anywhere; }
  .chat-line.mine { align-self:flex-end; background:var(--color-assistant-wash); }
  .chat-who { display:block; font-size:var(--font-size-small); color:var(--color-ink-secondary); }
  .chat-form textarea { width:100%; min-height:6em; font:inherit; padding:var(--space-8); box-sizing:border-box; }
  .chat-form button { margin-top:var(--space-8); min-height:44px; padding:0 var(--space-16); font:inherit; }
  .chat-foot { margin-top:var(--space-24); font-size:var(--font-size-small); color:var(--color-ink-secondary); }
`;

function script(key: string, mark: string, embed: string | null): string {
  // Asks only this page's own mark; looks again when it moved, unless something is being typed.
  return `<script>(function(){var m=${JSON.stringify(mark)},u=${JSON.stringify(`/chat/${key}/mark${embed ? `?v=${embed}` : ''}`)};
setInterval(function(){if(document.hidden)return;fetch(u,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.text():m}).then(function(n){
var b=document.querySelector('textarea');if(n!==m&&(!b||!b.value.trim()))location.reload();}).catch(function(){});},${CHAT_EVERY_MS});})();</script>`;
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
  const line = (x: ChatLine, i: number) => `<li class="chat-line${x.mine ? ' mine' : ''}"${i === o.lines.length - 1 ? ' id="latest"' : ''}><span class="chat-who">${esc(x.mine ? t(l, 'chat.you') : o.business)} · ${esc(show.when(l, x.at, o.now))}</span><bdi dir="auto">${esc(x.text)}</bdi></li>`;
  const notice = o.notice ? `<p role="alert">${esc(t(l, o.notice === 'off' ? 'chat.off' : 'chat.tooLong'))}</p>` : '';
  const body = `<h1>${esc(t(l, 'chat.title', { business: o.business }))}</h1>
    <p>${esc(t(l, 'chat.lede', { business: o.business }))}</p>
    ${o.lines.length ? `<ol class="chat-lines">${o.lines.map(line).join('')}</ol>` : `<p>${esc(t(l, 'chat.empty'))}</p>`}
    <p><a href="${self}#latest">${esc(t(l, 'chat.refresh'))}</a></p>
    ${notice}
    <form class="chat-form" method="post" action="/chat/${esc(o.key)}">
      <input type="hidden" name="n" value="${esc(nonce())}" />${embed ? `\n      <input type="hidden" name="v" value="${esc(embed)}" />` : ''}
      <label for="chat-text">${esc(t(l, 'chat.label'))}</label>
      <textarea id="chat-text" name="text" required maxlength="${MAX}" dir="auto"></textarea>
      <button type="submit">${esc(t(l, 'chat.send'))}</button>
    </form>
    <p class="chat-foot">${esc(t(l, 'chat.kept', { business: o.business }))} <a href="/privacy"${embed ? ' target="_blank" rel="noopener"' : ''}>${esc(t(l, 'chat.privacy'))}</a></p>
    ${script(o.key, o.mark, embed)}`;
  return publicDocument({ locale: l, title: t(l, 'chat.title', { business: o.business }), body, noindex: true, extraCss: CSS });
}

export function mountWebChat(app: FastifyInstance, deps: WebChatDeps): void {
  const perCaller = makeThrottle({ max: 30, windowMs: 60_000 });
  const page = async (req: FastifyRequest, reply: FastifyReply, notice: 'off' | 'tooLong' | null = null) => {
    const key = (req.params as { key: string }).key;
    const locale = deps.localeOf(req);
    const bid = await chatPageBusiness(deps.db, key);
    const send = (status: number, html: string) => reply.code(status).type('text/html; charset=utf-8')
      .header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-robots-tag', 'noindex, nofollow').send(html);
    if (!bid) return send(404, publicDocument({ locale, title: t(locale, 'chat.gone'), body: `<h1>${esc(t(locale, 'chat.gone'))}</h1>`, noindex: true }));
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
