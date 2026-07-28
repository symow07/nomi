import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { loadHomeData, renderHome } from './home.js';
import {
  loadInboxList, loadConversationDetail, renderInboxList, renderConversationDetail,
  defaultFilter, type InboxFilter,
} from './inbox.js';
import {
  loadChannels, renderChannels, renderConnectGuide,
  disconnectChannel, reconnectChannel, testChannel,
} from './channels.js';
import {
  loadProductList, loadProductDetail, renderProductList, renderProductDetail,
  renderAddForm, renderReview, reviewImport, confirmImport,
} from './products.js';
import { loadEmployee, renderEmployee } from './employee.js';
import {
  loadCustomerList, loadCustomerFile, renderCustomerList, renderCustomerFile,
} from './conversations.js';
import { loadAnalytics, renderAnalytics, parseRange } from './analytics.js';
import { promoteCapability, revokeCapability } from '../../pipeline/capability.js';
import { applyOwnerCommand } from '../../pipeline/approve.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { shell, loginPage } from './layout.js';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS, type OwnerSession } from './session.js';

/**
 * M9 — Command Center web app. Server-rendered pages over the EXISTING
 * engine: every route reads through existing repos and acts through existing
 * services. No second messaging system, no duplicated business logic. Mounted
 * on the same Fastify instance in both provider and deployment modes.
 *
 * M9.1 delivers the shell + owner authentication; sections fill in from M9.2.
 */

const COOKIE = 'yf_session';

export type WebDeps = {
  readonly db: Db;
  readonly sessionSecret: string;      // derived from CREDENTIAL_KEY
  readonly accessCode: string;         // owner login (env or generated)
  readonly businessId: string;         // pilot: the demo/pilot business
  readonly employeeName: string;
  readonly avatar: string;
  readonly provider: string;
  readonly secureCookie: boolean;      // Secure flag (prod = true)
  /** The EXISTING outbound path (main.ts: boss.send(QUEUES.outbound, …)). */
  readonly kickOutbound: (businessId: string, conversationId: string, reply: string) => Promise<void>;
};

export function registerWebApp(app: FastifyInstance, deps: WebDeps): void {
  const codec = makeSessionCodec(deps.sessionSecret);

  // Owner login posts a form; parse urlencoded bodies (dependency-free).
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' },
    (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(body as string))); }
      catch (e) { done(e as Error, undefined); }
    });

  const sessionOf = (req: FastifyRequest): OwnerSession | null =>
    codec.verify(parseCookies(req.headers.cookie)[COOKIE], Date.now());

  const setCookie = (reply: FastifyReply, token: string, maxAgeSec: number) => {
    const flags = ['HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (deps.secureCookie) flags.push('Secure');
    reply.header('set-cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
  };

  /** Wrap an authed page: verify session or redirect to /login. */
  const authed = (active: string, render: (s: OwnerSession, req: FastifyRequest) => Promise<string> | string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const body = await render(s, req);
      return reply.type('text/html; charset=utf-8').send(
        shell({ title: active, active, employeeName: deps.employeeName, avatar: deps.avatar, bodyHtml: body }),
      );
    };

  // ── Auth ────────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) =>
    reply.redirect(sessionOf(req) ? '/app' : '/login'));

  app.get('/login', async (req, reply) =>
    sessionOf(req)
      ? reply.redirect('/app')
      : reply.type('text/html; charset=utf-8').send(loginPage({})));

  app.post('/login', async (req, reply) => {
    const code = String((req.body as { code?: string } | undefined)?.code ?? '');
    if (!codeMatches(code, deps.accessCode)) {
      return reply.code(401).type('text/html; charset=utf-8')
        .send(loginPage({ error: '密码不对，再试一次。' }));
    }
    const token = codec.sign({ businessId: deps.businessId, exp: Date.now() + SESSION_TTL_MS });
    setCookie(reply, token, Math.floor(SESSION_TTL_MS / 1000));
    return reply.redirect('/app');
  });

  app.get('/logout', async (_req, reply) => {
    setCookie(reply, '', 0);
    return reply.redirect('/login');
  });

  // ── Home (M9.2: owner briefing — a view over existing data) ──────────────
  app.get('/app', authed('home', async () => {
    const data = await loadHomeData(deps.db, deps.businessId, new Date());
    return renderHome(data);
  }));

  // ── M9.3 Inbox: list, detail, and the ONE approval action ────────────────
  app.get('/app/inbox', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const requested = (req.query as { filter?: string } | undefined)?.filter;
    const list0 = await loadInboxList(deps.db, s.businessId, '全部');
    const filter: InboxFilter = requested === '等你处理' || requested === '全部'
      ? requested : defaultFilter(list0.waitingCount);
    const data = filter === list0.filter ? list0 : await loadInboxList(deps.db, s.businessId, filter);
    return reply.type('text/html; charset=utf-8').send(shell({
      title: '收件箱', active: 'inbox', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderInboxList(data, new Date()),
    }));
  });

  app.get('/app/inbox/:conversationId', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const detail = await loadConversationDetail(deps.db, s.businessId, conversationId);
    if (!detail) return reply.code(404).type('text/html; charset=utf-8').send(shell({
      title: '收件箱', active: 'inbox', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: `<h1 class="page">找不到这个对话</h1><div class="card"><a href="/app/inbox">← 回收件箱</a></div>`,
    }));
    const flash = typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null;
    return reply.type('text/html; charset=utf-8').send(shell({
      title: detail.buyer, active: 'inbox', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderConversationDetail(detail, new Date(), flash),
    }));
  });

  // The ONLY mutation: resolve a pending draft through applyOwnerCommand.
  // POST only; Post/Redirect/Get so a refresh never re-submits.
  app.post('/app/inbox/:conversationId/act', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const body = (req.body ?? {}) as { draftId?: string; command?: string; edit?: string };
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok || !body.draftId) return reply.redirect(`/app/inbox/${encodeURIComponent(conversationId)}`);

    // 改 carries the owner's text; other commands map straight to the parser.
    const rawReply = body.command === '改' ? `改：${body.edit ?? ''}` : (body.command ?? '');
    const r = await applyOwnerCommand(
      { db: deps.db, now: () => new Date(), kickOutbound: deps.kickOutbound },
      { businessId: bid.value, draftId: body.draftId, rawReply, decidedBy: 'owner' },
    );
    return reply.redirect(`/app/inbox/${encodeURIComponent(conversationId)}?flash=${encodeURIComponent(r.messageZh)}`);
  });

  // ── M9.4 Channel Center: connection state over the existing channel layer ──
  const messagingEnabled = deps.provider !== 'disabled';
  app.get('/app/channels/whatsapp/connect', authed('channels', () => renderConnectGuide()));

  const channelAction = (path: string, run: (businessId: string) => Promise<{ messageZh: string }>) =>
    app.post(path, async (req, reply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const r = await run(s.businessId);
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(r.messageZh)}`);
    });
  channelAction('/app/channels/whatsapp/disconnect', (b) => disconnectChannel(deps.db, b, 'owner'));
  channelAction('/app/channels/whatsapp/reconnect', (b) => reconnectChannel(deps.db, b, 'owner'));
  channelAction('/app/channels/whatsapp/test', (b) => testChannel(deps.db, b, 'owner', messagingEnabled));

  // Re-render the channels page with a flash after a redirect (?flash=).
  app.get('/app/channels', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const data = await loadChannels(deps.db, s.businessId, deps.employeeName, messagingEnabled);
    return reply.type('text/html; charset=utf-8').send(shell({
      title: '销售渠道', active: 'channels', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderChannels(data, flash),
    }));
  });

  // ── M9.5 Product Knowledge Center: view over the existing catalog + teach ──
  app.get('/app/products', authed('products', async (s) =>
    renderProductList(await loadProductList(deps.db, s.businessId))));
  app.get('/app/products/add', authed('products', () => renderAddForm()));
  app.get('/app/products/:id', authed('products', async (s, req) => {
    const id = (req.params as { id: string }).id;
    const d = await loadProductDetail(deps.db, s.businessId, id);
    return d ? renderProductDetail(d) : `<h1 class="page">找不到这个产品</h1><div class="card"><a href="/app/products">← 产品目录</a></div>`;
  }));
  app.post('/app/products/add/review', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    return reply.type('text/html; charset=utf-8').send(shell({
      title: '确认产品', active: 'products', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderReview(reviewImport(text), text),
    }));
  });
  app.post('/app/products/add/confirm', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    const r = await confirmImport(deps.db, s.businessId, text);
    const msg = `已学习 ${r.learned} 个产品${r.needsConfirm > 0 ? `，${r.needsConfirm} 个缺价格待确认` : ''}。`;
    return reply.redirect(`/app/products?flash=${encodeURIComponent(msg)}`);
  });

  // ── M9.6 Employee Profile: personnel file over the existing trust data ────
  app.get('/app/employee', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const e = await loadEmployee(deps.db, s.businessId, deps.employeeName);
    return reply.type('text/html; charset=utf-8').send(shell({
      title: '员工档案', active: 'employee', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderEmployee(e, flash),
    }));
  });
  const capAction = (verb: string, run: (biz: string, cap: string) => Promise<{ messageZh: string }>) =>
    app.post(`/app/employee/capability/:capability/${verb}`, async (req, reply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const cap = (req.params as { capability: string }).capability;
      const r = await run(s.businessId, cap);
      return reply.redirect(`/app/employee?flash=${encodeURIComponent(r.messageZh)}`);
    });
  capAction('promote', (b, c) => promoteCapability(deps.db, b, c, 'owner'));
  capAction('revoke', (b, c) => revokeCapability(deps.db, b, c, 'owner'));

  // ── M9.7 Conversations: customer memory over existing activity ────────────
  app.get('/app/conversations', authed('conversations', async (s, req) => {
    const q = typeof (req.query as { q?: string }).q === 'string' ? (req.query as { q: string }).q : '';
    return renderCustomerList(await loadCustomerList(deps.db, s.businessId, q), new Date());
  }));
  app.get('/app/conversations/:conversationId', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const file = await loadCustomerFile(deps.db, s.businessId, conversationId);
    if (!file) return reply.code(404).type('text/html; charset=utf-8').send(shell({
      title: '客户', active: 'conversations', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: `<h1 class="page">找不到这位客户</h1><div class="card"><a href="/app/conversations">← 回客户列表</a></div>`,
    }));
    return reply.type('text/html; charset=utf-8').send(shell({
      title: file.buyer, active: 'conversations', employeeName: deps.employeeName, avatar: deps.avatar,
      bodyHtml: renderCustomerFile(file, new Date()),
    }));
  });

  // ── M9.8 Business Performance: plain counts over existing business rows ────
  app.get('/app/analytics', authed('analytics', async (s, req) => {
    const range = parseRange((req.query as { range?: string }).range);
    return renderAnalytics(await loadAnalytics(deps.db, s.businessId, range));
  }));
}
