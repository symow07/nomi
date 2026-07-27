import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { loadDashboardData, renderHomeBody } from '../dashboard.js';
import { shell, loginPage, underConstruction } from './layout.js';
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
  const authed = (active: string, render: (s: OwnerSession) => Promise<string> | string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const body = await render(s);
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

  // ── Home (M9.1: reuse the existing dashboard data inside the shell) ───────
  app.get('/app', authed('home', async () => {
    const data = await loadDashboardData(deps.db, deps.provider);
    return renderHomeBody(data);
  }));

  // ── Section stubs (built out M9.2+) — present so nav never 404s ───────────
  const stub = (path: string, active: string, zh: string) =>
    app.get(path, authed(active, () => underConstruction(zh)));
  stub('/app/inbox', 'inbox', '收件箱');
  stub('/app/conversations', 'conversations', '对话记录');
  stub('/app/channels', 'channels', '对话渠道');
  stub('/app/products', 'products', '产品目录');
  stub('/app/employee', 'employee', '员工档案');
  stub('/app/analytics', 'analytics', '经营数据');
}
