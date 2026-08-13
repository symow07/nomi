import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { loadOperationsSnapshot, renderOperationsHome } from './operations.js';
import { loadProof, renderProof, notFoundPage, issueProofLink, revokeProofLink, loadProofLinkState } from './proof.js';
import { loadInsights, renderInsights } from './insights.js';
import {
  loadInboxList, loadConversationDetail, renderInboxList, renderConversationDetail,
  defaultFilter, type InboxFilter,
} from './inbox.js';
import {
  loadChannels, renderChannels, renderConnectGuide, channelFlash,
  disconnectChannel, reconnectChannel, testChannel, saveOwnerPhone,
} from './channels.js';
import {
  loadProductList, loadProductDetail, renderProductList, renderProductDetail,
  renderAddForm, renderReview, reviewImport, confirmImport, importFlash, updateProduct,
  importFromPhoto, renderPhotoRefusal,
} from './products.js';
import { loadPriceRules, savePriceRules, renderPriceRules, countUnauthoredPriceRules } from './priceRules.js';
import { loadEmployee, renderEmployee } from './employee.js';
import {
  loadCustomerList, loadCustomerFile, renderCustomerList, renderCustomerFile,
} from './conversations.js';
import { loadAnalytics, renderAnalytics, parseRange } from './analytics.js';
import { loadBusinessProfile, renderSettings, saveBusinessProfile, loadForbidden, addForbidden, removeForbidden, renderForbidden, loadRates, setRate, renderRate, loadClosures, addClosure, removeClosure, renderClosures } from './settings.js';
import { loadFactory, loadFactoryRehearsal, renderFactory } from './factory.js';
import type { TemplateState } from '../../core/channel/window.js';
import { activate, deactivate } from '../../channels/activation.js';
import { addToAllowlist, archiveFromAllowlist } from '../../channels/allowlist.js';
import { ownerSendFacts } from '../../db/channels.js';
import { precheckOwnerSend } from '../../core/channel/lifecycle.js';
import {
  loadPilotRunbook, renderPilotRunbook, loadPilotFeedback, attest, runValidation, type AttestKey,
} from './pilot.js';
import { readDeployment } from './deployment.js';
import { checkMetaReadiness } from '../../core/channel/metaReadiness.js';
import {
  loadKnowledgeIndex, loadProductKnowledge, renderKnowledgeIndex, renderProductKnowledge,
  teachKnowledge, correctKnowledge, archiveKnowledge, setCertification, type KnowledgeFlash,
} from './knowledge.js';
import { loadKnowledgeOps, loadUsageFacts, renderKnowledgeOps, parseRange as parseKnowledgeRange } from './knowledge-insights.js';
import {
  loadSandboxView, renderSandbox, runSandboxTurn, resetSandbox, sandboxOutboundSink,
  activeSandboxConversationId, sandboxFlushOutbound,
  runScriptedPractice, renderPractice,
  type SandboxDeps, type SandboxMode,
} from './sandbox.js';
import { promoteCapability, revokeCapability } from '../../pipeline/capability.js';
import { answerSpotCheck } from '../../pipeline/spotChecks.js';
import { applyOwnerCommand } from '../../pipeline/approve.js';
import { takeOver, resumeAi } from '../../conversations/takeover.js';
import { ownerReply } from '../../outbound/ownerReply.js';
import { parseBusinessId } from '../../core/types/ids.js';
import type { Analyzer, ReplyWriter, PageTranscriber } from '../../llm/ports.js';
import { shell, loginPage, esc } from './layout.js';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS, type OwnerSession } from './session.js';
import { type Locale, LOCALES, resolveLocale, parseLocale } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';

/**
 * M9 — Command Center web app. Server-rendered pages over the EXISTING
 * engine: every route reads through existing repos and acts through existing
 * services. No second messaging system, no duplicated business logic. Mounted
 * on the same Fastify instance in both provider and deployment modes.
 *
 * M9.1 delivers the shell + owner authentication; sections fill in from M9.2.
 */

const COOKIE = 'yf_session';
const LOCALE_COOKIE = 'yf_locale';

export type WebDeps = {
  readonly db: Db;
  readonly sessionSecret: string;      // derived from CREDENTIAL_KEY
  readonly accessCode: string;         // owner login (env or generated)
  readonly businessId: string;         // pilot: the demo/pilot business
  readonly employeeName: string;
  readonly avatar: string;
  readonly provider: string;
  /** M25 — the installation's real template capability, derived at boot.
   *  Absent = 'none', the fail-closed answer. */
  readonly templateState?: TemplateState;
  readonly secureCookie: boolean;      // Secure flag (prod = true)
  /** The EXISTING outbound path (main.ts: boss.send(QUEUES.outbound, …)). */
  readonly kickOutbound: (businessId: string, conversationId: string, reply: string) => Promise<void>;
  /** M16.1: the bare re-drive tick (boss.send(QUEUES.outbound, {businessId, conversationId}))
   *  so an owner takeover reply, once enqueued, is delivered by the same worker. */
  readonly kickDrive?: (businessId: string, conversationId: string) => Promise<void>;
  /** M12.2 pilot sandbox: a dedicated tenant, distinct from `businessId`.
   *  Absent → the sandbox surface is not mounted. */
  readonly sandboxBusinessId?: string;
  /** Live-AI ports for the sandbox. Absent → scripted mode only. */
  readonly analyzer?: Analyzer;
  readonly replyWriter?: ReplyWriter;
  /**
   * M37 — reads a photographed price sheet. ABSENT IS A LEGITIMATE STATE:
   * without it, photographing a page refuses honestly and says so, while
   * everything else — including image MATCHING, which is a different port —
   * keeps working.
   */
  readonly pageTranscriber?: PageTranscriber;
};

export function registerWebApp(app: FastifyInstance, deps: WebDeps): void {
  const codec = makeSessionCodec(deps.sessionSecret);

  /**
   * M37 — multipart, from the maintainers of the framework already here.
   *
   * NOT HAND-ROLLED, on purpose. A multipart parser is a parser over untrusted
   * input with a known catalogue of DoS vectors — unbounded parts, filename
   * traversal, boundary confusion — and this repo declines to hand-roll that
   * class of thing everywhere else. The five-dependency discipline is about
   * frameworks, not about a first-party parser for a framework already in use.
   *
   * EVERY LIMIT IS SET EXPLICITLY, with the inherited default named, because
   * two of them are unbounded and one is too small for the actual photograph:
   *
   *   fileSize      8 MB   RAISED. The plugin falls back to Fastify's
   *                        bodyLimit, 1 MB — smaller than a phone photo of a
   *                        page, so the feature would refuse every real one.
   *                        Set here rather than left to bodyLimit, which is a
   *                        different setting someone will change for another
   *                        reason and silently move this.
   *   files         1      NO DEFAULT — unlimited. One page per review; a
   *                        second file is a request no form of ours makes.
   *   fields        4      NO DEFAULT — unlimited. This form posts none.
   *   parts         6      Down from 1000.
   *   fieldSize     1 KB   Down from 1 MB.
   *   fieldNameSize 100    The busboy default, stated so a change is visible.
   *   headerPairs   200    Down from 2000 — part headers are three or four in
   *                        every real request.
   *
   * The filename is never used: the upload becomes base64 in memory and is
   * never written to disk, so path traversal has nothing to traverse.
   */
  void app.register(multipart, {
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
      parts: 6,
      fields: 4,
      fieldSize: 1024,
      fieldNameSize: 100,
      headerPairs: 200,
    },
  });

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

  // ADR-0008: locale from the owner's cookie, else Accept-Language, else 'en'.
  const localeOf = (req: FastifyRequest): Locale =>
    resolveLocale(parseCookies(req.headers.cookie)[LOCALE_COOKIE], req.headers['accept-language'] ?? null);

  /** Render a full page: fills locale + path + avatar from the request/deps. */
  const page = (req: FastifyRequest, o: { title: string; active: string; bodyHtml: string }): string =>
    shell({ ...o, locale: localeOf(req), path: req.url, avatar: deps.avatar });

  /** Wrap an authed page: verify session or redirect to /login. */
  const authed = (active: string, render: (s: OwnerSession, req: FastifyRequest, locale: Locale) => Promise<string> | string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const locale = localeOf(req);
      const body = await render(s, req, locale);
      return reply.type('text/html; charset=utf-8').send(
        page(req, { title: t(locale, `nav.${active}` as MessageKey), active, bodyHtml: body }),
      );
    };

  // ── M35 · the proof link: the ONE public page inside the app ─────────────
  //
  // No session, no login, and deliberately no way back into the app: a buyer
  // who tapped one would meet a login screen and learn there is an app here.
  // It must survive being forwarded and read on a stranger's phone.
  //
  // 404 — NEVER 403 — for unknown, revoked, or deleted. A 403 confirms the
  // quote exists, which tells whoever is guessing that they guessed right and
  // were merely unauthorised. `loadProof` returns null for every failure so
  // this handler cannot accidentally distinguish them.
  app.get('/p/:token', async (req, reply) => {
    const token = String((req.params as { token: string }).token ?? '');
    const view = token.length >= 32 ? await loadProof(deps.db, token) : null;
    if (!view) return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage());
    return reply.type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(renderProof(view));
  });

  // ── Auth ────────────────────────────────────────────────────────────────
  app.get('/', async (req, reply) =>
    reply.redirect(sessionOf(req) ? '/app' : '/login'));

  app.get('/login', async (req, reply) =>
    sessionOf(req)
      ? reply.redirect('/app')
      : reply.type('text/html; charset=utf-8').send(loginPage({ locale: localeOf(req), path: req.url })));

  app.post('/login', async (req, reply) => {
    const code = String((req.body as { code?: string } | undefined)?.code ?? '');
    if (!codeMatches(code, deps.accessCode)) {
      return reply.code(401).type('text/html; charset=utf-8')
        .send(loginPage({ locale: localeOf(req), path: '/login', error: true }));
    }
    const token = codec.sign({ businessId: deps.businessId, exp: Date.now() + SESSION_TTL_MS });
    setCookie(reply, token, Math.floor(SESSION_TTL_MS / 1000));
    return reply.redirect('/app');
  });

  app.get('/logout', async (_req, reply) => {
    setCookie(reply, '', 0);
    return reply.redirect('/login');
  });

  // ADR-0008: public language switch. Sets the yf_locale cookie, returns to `next`.
  app.get('/locale', async (req, reply) => {
    const q = req.query as { set?: string; next?: string };
    const set = parseLocale(q.set);
    const nextRaw = typeof q.next === 'string' ? q.next : '/app';
    const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/app';
    if (set) {
      const flags = ['Path=/', 'SameSite=Lax', 'Max-Age=31536000'];
      if (deps.secureCookie) flags.push('Secure');
      reply.header('set-cookie', `${LOCALE_COOKIE}=${set}; ${flags.join('; ')}`);
      // Persist for the logged-in owner so WhatsApp alerts use the same language.
      const s = sessionOf(req);
      const bid = s ? parseBusinessId(s.businessId) : null;
      if (bid?.ok) {
        try {
          await withTenantTx(deps.db, bid.value, (tx) =>
            sql`update businesses set owner_locale = ${set} where id = ${bid.value}`.execute(tx));
        } catch { /* best-effort: the cookie already applied the switch */ }
      }
    }
    return reply.redirect(next);
  });

  // ── Operations Home (M16.2b) — "what needs my attention today?" ──────────
  // The landing page now renders the M16.2a operations snapshot: the read model
  // is the boundary, so this route composes loadOperationsSnapshot +
  // renderOperationsHome and queries nothing else. Counts only; no new metrics.
  app.get('/app', authed('home', async (_s, _req, locale) => {
    // Phase B: Today composes two EXISTING read models — the operations snapshot
    // and the pilot feedback loop. No new query, no new storage.
    // M34.10 — plus the insights, which are the only part of this page that
    // tells the owner what to DO rather than what happened.
    const [snapshot, feedback, insights] = await Promise.all([
      loadOperationsSnapshot(deps.db, deps.businessId, 'today', deps.provider),
      loadPilotFeedback(deps.db, deps.businessId, 'today'),
      loadInsights(deps.db, deps.businessId),
    ]);
    return renderInsights(insights, locale) + renderOperationsHome(snapshot, locale, {
      conversationsNeedingYou: feedback.conversationsNeedingYou,
      reasons: feedback.handoffReasons.map((r) => ({ kind: r.kind, count: r.count })),
    });
  }));

  // ── M9.3 Inbox: list, detail, and the ONE approval action ────────────────
  app.get('/app/inbox', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const requested = (req.query as { filter?: string } | undefined)?.filter;
    const list0 = await loadInboxList(deps.db, s.businessId, 'all');
    const filter: InboxFilter = requested === 'pending' || requested === 'all'
      ? requested : defaultFilter(list0.waitingCount);
    const data = filter === list0.filter ? list0 : await loadInboxList(deps.db, s.businessId, filter);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.inbox'), active: 'inbox',
      bodyHtml: renderInboxList(data, locale, new Date()),
    }));
  });

  app.get('/app/inbox/:conversationId', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const detail = await loadConversationDetail(deps.db, s.businessId, conversationId);
    if (!detail) return reply.code(404).type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.inbox'), active: 'inbox',
      bodyHtml: `<h1 class="page">${esc(t(locale, 'inbox.notFound'))}</h1><div class="block"><a href="/app/inbox">${esc(t(locale, 'inbox.detail.back'))}</a></div>`,
    }));
    const flash = typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null;
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: detail.buyer ?? t(locale, 'common.buyer'), active: 'inbox',
      bodyHtml: renderConversationDetail(detail, locale, new Date(), flash),
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
    const flash = r.outcome === 'sent' && !messagingEnabled
      ? t(localeOf(req), 'inbox.flash.sentNotLive')
      : t(localeOf(req), `inbox.flash.${r.outcome}` as MessageKey);
    return reply.redirect(`/app/inbox/${encodeURIComponent(conversationId)}?flash=${encodeURIComponent(flash)}`);
  });

  // ── M16.1 Human takeover: take over / owner reply / return to AI ───────────
  // Ownership moves through src/core/conversation/ownership; the owner reply
  // uses the ONE send path; nothing here is a second approval or send system.
  const takeoverFlash = (req: FastifyRequest, cid: string, outcome: string) => {
    const msg = outcome === 'sent' && !messagingEnabled
      ? t(localeOf(req), 'inbox.flash.sentNotLive')
      : t(localeOf(req), `takeover.flash.${outcome}` as MessageKey);
    return `/app/inbox/${encodeURIComponent(cid)}?flash=${encodeURIComponent(msg)}`;
  };

  app.post('/app/inbox/:conversationId/takeover', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const r = await takeOver({ db: deps.db, now: () => new Date() }, { businessId: bid.value, conversationId: cid, actor: 'owner' });
    return reply.redirect(takeoverFlash(req, cid, r.outcome));
  });

  app.post('/app/inbox/:conversationId/reply', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    // M20.4 (F-09) — the M21 rehearsal accepted a reply after the owner had
    // stopped messaging and told her "等着发出去" (waiting to send). The gate
    // then correctly canceled it and nothing said so. Ask the SAME facts the
    // gate reads before accepting, so the answer she gets is the true one.
    const pre = await withTenantTx(deps.db, bid.value, (tx) =>
      ownerSendFacts(tx, bid.value, cid, messagingEnabled));
    const verdict = precheckOwnerSend(pre.facts, pre);
    if (verdict !== 'ok') {
      return reply.redirect(`/app/inbox/${encodeURIComponent(cid)}?flash=${encodeURIComponent(
        t(localeOf(req), `inbox.blocked.${verdict}` as MessageKey))}`);
    }
    const r = await ownerReply(
      { db: deps.db, now: () => new Date(), kickDrive: deps.kickDrive ?? (async () => {}) },
      { businessId: bid.value, conversationId: cid, text, actor: 'owner' },
    );
    return reply.redirect(takeoverFlash(req, cid, r.outcome));
  });

  /**
   * M34 — the owner corrects what was heard.
   *
   * ARCHIVE, NEVER ERASE. `transcription` keeps the machine's original reading
   * untouched; `text_content` takes the owner's words, so everything downstream
   * (the timeline, a future turn, an export) reads what she said was said. The
   * audit row carries both, so a correction reads as a correction rather than
   * as a message that was always that way.
   *
   * NOT A SECOND TRANSCRIBER. This writes down a human's testimony about what a
   * human said; it makes no claim of its own and re-runs nothing.
   */
  app.post('/app/inbox/:conversationId/heard', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const body = req.body as { messageId?: string; heard?: string } | undefined;
    const messageId = String(body?.messageId ?? '');
    const heard = String(body?.heard ?? '').trim();
    const back = `/app/inbox/${encodeURIComponent(cid)}`;
    if (!messageId || !heard) return reply.redirect(back);

    await withTenantTx(deps.db, bid.value, async (tx) => {
      // The ORIGINAL is whatever `transcription` already holds — set on first
      // correction, left alone on every later one, so the machine's reading
      // survives however many times the owner refines her own.
      const before = (await sql<{ text_content: string | null; transcription: string | null }>`
        select text_content, transcription from messages
         where id = ${messageId}::uuid and conversation_id = ${cid}::uuid limit 1
      `.execute(tx)).rows[0];
      if (!before) return;
      await sql`
        update messages
           set text_content = ${heard},
               transcription = coalesce(transcription, ${before.text_content}),
               input_type = 'voice_transcribed'
         where id = ${messageId}::uuid and conversation_id = ${cid}::uuid
      `.execute(tx);
      await sql`
        insert into channel_audit (business_id, channel, action, detail)
        values (${bid.value}, 'whatsapp', 'transcript_corrected',
                ${JSON.stringify({
                  conversationId: cid, messageId,
                  before: before.transcription ?? before.text_content, after: heard,
                })}::jsonb)
      `.execute(tx);
    });
    return reply.redirect(`${back}?flash=${encodeURIComponent(t(localeOf(req), 'voice.flash.corrected'))}`);
  });

  app.post('/app/inbox/:conversationId/resume', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const r = await resumeAi({ db: deps.db, now: () => new Date() }, { businessId: bid.value, conversationId: cid, actor: 'owner' });
    return reply.redirect(takeoverFlash(req, cid, r.outcome));
  });

  // ── M9.4 Channel Center: connection state over the existing channel layer ──
  const messagingEnabled = deps.provider !== 'disabled';
  app.get('/app/channels/whatsapp/connect', authed('channels', (_s, _req, locale) => renderConnectGuide(locale)));

  const channelAction = (path: string, run: (businessId: string) => Promise<import('./channels.js').ChannelActionResult>) =>
    app.post(path, async (req, reply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const r = await run(s.businessId);
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(channelFlash(localeOf(req), r.code))}`);
    });
  channelAction('/app/channels/whatsapp/disconnect', (b) => disconnectChannel(deps.db, b, 'owner'));
  channelAction('/app/channels/whatsapp/reconnect', (b) => reconnectChannel(deps.db, b, 'owner'));
  channelAction('/app/channels/whatsapp/test', (b) => testChannel(deps.db, b, 'owner', messagingEnabled));

  // P3 follow-up: owner alert destination (minimal action, validated + audited).
  app.post('/app/settings/owner-phone', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const phone = String((req.body as { phone?: string } | undefined)?.phone ?? '');
    const r = await saveOwnerPhone(deps.db, s.businessId, phone, 'owner');
    return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(localeOf(req), `settings.flash.${r.code}` as MessageKey))}`);
  });

  // Re-render the channels page with a flash after a redirect (?flash=).
  app.get('/app/channels', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const data = await loadChannels(deps.db, s.businessId, messagingEnabled);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.channels'), active: 'channels',
      bodyHtml: renderChannels(data, locale, flash),
    }));
  });

  // ── Nomi Phase E · My factory ──────────────────────────────────────────────
  // One calm page over the EXISTING profile / products / claims / channel read
  // models. Read-only by design: every change still happens on the surface that
  // owns it, so there is exactly one place that writes each thing.
  app.get('/app/factory', authed('factory', async (s, req, locale) => {
    const flash = typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null;
    return renderFactory(await loadFactory(deps.db, s.businessId, messagingEnabled), locale, flash);
  }));

  // M20.3 — going live, and coming back. Both go through the EXISTING service:
  // `activate` re-runs its own preconditions and refuses with the same blocker
  // codes My factory already shows, and both write channel_audit themselves.
  // Post/Redirect/Get, so a refresh never re-fires the most consequential
  // action in the product.
  const factoryFlash = (req: FastifyRequest, key: MessageKey, params?: Record<string, string | number>) =>
    `/app/factory?flash=${encodeURIComponent(t(localeOf(req), key, params))}`;

  app.post('/app/factory/activate', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const r = await activate(deps.db, bid.value, 'owner', { providerConfigured: messagingEnabled });
    // A refusal names the same blocker the page was already showing, so the
    // owner never sees a reason that contradicts what they just read.
    return reply.redirect(r.ok
      ? factoryFlash(req, 'activation.flash.activated')
      : factoryFlash(req, `activation.blocker.${r.code}` as MessageKey));
  });

  // M20.4 (F-06) — the owner decides who may be reached. Reuses the existing
  // allowlist services (they normalise the number and write channel_audit); this
  // adds no model and no permission system. Every flash below is derived from
  // what the service actually persisted, never assumed.
  app.post('/app/factory/allowlist/add', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const b = (req.body ?? {}) as { phone?: string; label?: string };
    const label = String(b.label ?? '').trim() || null;
    const r = await addToAllowlist(deps.db, bid.value, String(b.phone ?? ''), label, 'owner');
    return reply.redirect(r.ok
      ? factoryFlash(req, 'allowlist.flash.added', { who: label ?? r.phone })
      : factoryFlash(req, 'allowlist.flash.invalid'));
  });

  app.post('/app/factory/allowlist/remove', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const phone = String((req.body as { phone?: string } | undefined)?.phone ?? '');
    const r = await archiveFromAllowlist(deps.db, bid.value, phone, 'owner');
    return reply.redirect(r.ok
      ? factoryFlash(req, 'allowlist.flash.removed', { who: r.phone })
      : factoryFlash(req, 'allowlist.flash.invalid'));
  });

  app.post('/app/factory/deactivate', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    await deactivate(deps.db, bid.value, 'owner', 'owner stopped messaging');
    return reply.redirect(factoryFlash(req, 'activation.flash.deactivated'));
  });

  // ── M9.5 Product Knowledge Center: view over the existing catalog + teach ──
  app.get('/app/products', authed('products', async (s, _req, locale) =>
    renderProductList(await loadProductList(deps.db, s.businessId), locale)));
  app.get('/app/products/add', authed('products', (_s, _req, locale) => renderAddForm(locale)));
  app.get('/app/products/:id', authed('products', async (s, req, locale) => {
    const id = (req.params as { id: string }).id;
    const d = await loadProductDetail(deps.db, s.businessId, id);
    return d ? renderProductDetail(d, locale)
      : `<h1 class="page">${esc(t(locale, 'product.notFound'))}</h1><div class="block"><a href="/app/products">${esc(t(locale, 'product.detail.back'))}</a></div>`;
  }));
  app.post('/app/products/add/review', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'product.review.title'), active: 'products',
      bodyHtml: renderReview(reviewImport(text), text, locale),
    }));
  });
  /**
   * M37 — she photographs the printed price sheet instead of typing it.
   *
   * REUSES THE PASTE FLOW ENTIRELY. The transcriber turns a page into TEXT; the
   * same `reviewImport` parser turns text into products; the same confirm form
   * writes them. So the photo path has no second parser, no second writer, and
   * no migration — the staged text round-trips through the hidden field exactly
   * as a paste does.
   *
   * MULTIPART LIMITS ARE SET EXPLICITLY below, at registration.
   */
  app.post('/app/products/add/photo', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const refuse = (reason: Parameters<typeof renderPhotoRefusal>[0]) =>
      reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'product.photo.refusedTitle'), active: 'products',
        bodyHtml: renderPhotoRefusal(reason, locale),
      }));

    let imageBase64 = '';
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
    try {
      const file = await req.file();
      if (!file) return refuse('unreadable');
      const mt = file.mimetype;
      if (mt !== 'image/jpeg' && mt !== 'image/png' && mt !== 'image/webp') return refuse('unreadable');
      mediaType = mt;
      imageBase64 = (await file.toBuffer()).toString('base64');
    } catch {
      // The parser throws on a file over the limit. Over-size is its own
      // refusal because "too big" and "unreadable" ask her to do different
      // things — retake smaller, versus retake in better light.
      return refuse('too_large');
    }
    if (!imageBase64) return refuse('unreadable');

    const out = await importFromPhoto({ transcriber: deps.pageTranscriber }, { imageBase64, mediaType });
    if (out.kind === 'refused') return refuse(out.reason);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'product.review.title'), active: 'products',
      bodyHtml: renderReview(out.review, out.text, locale),
    }));
  });

  // M29 — the owner edits her own product. Archive-never-erase: "stop offering
  // this" is is_active=false, and every changed field is audited old → new.
  app.post('/app/products/:id/edit', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await updateProduct(deps.db, s.businessId, id, 'owner', {
      price: b['price'] ?? null,
      moq: b['moq'] ?? null,
      unit: b['unit'] ?? null,
      isActive: b['isActive'] === 'on',
    });
    const locale = localeOf(req);
    if (!r.ok) {
      const d = await loadProductDetail(deps.db, s.businessId, id);
      return reply.code(400).type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'product.edit.title'), active: 'products',
        bodyHtml: d ? renderProductDetail(d, locale, null, r.errors, b) : '',
      }));
    }
    const flash = t(locale, r.changed.length ? 'product.edit.flash.saved' : 'product.edit.flash.unchanged');
    return reply.redirect(`/app/products/${encodeURIComponent(id)}?flash=${encodeURIComponent(flash)}`);
  });

  // ── M29 Price limits: the three questions, reached from My factory ────────
  app.get('/app/factory/prices', authed('factory', async (s, req, locale) => {
    const q = req.query as { flash?: string; product?: string };
    return renderPriceRules(
      await loadPriceRules(deps.db, s.businessId), locale,
      typeof q.flash === 'string' ? q.flash : null, {},
      typeof q.product === 'string' ? { productId: q.product } : {},
    );
  }));
  app.post('/app/factory/prices', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const productId = (b['productId'] ?? '').trim() || null;
    const r = await savePriceRules(deps.db, s.businessId, 'owner', {
      productId,
      floor: b['floor'] ?? null,
      maxDiscountPct: b['maxDiscountPct'] ?? null,
      askAbovePct: b['askAbovePct'] ?? null,
    });
    if (!r.ok) {
      // F-07: a rejected answer re-renders WITH what she typed, never blank.
      return reply.code(400).type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'prices.title'), active: 'factory',
        bodyHtml: renderPriceRules(await loadPriceRules(deps.db, s.businessId), locale, null,
          r.errors, { productId }),
      }));
    }
    const flash = t(locale, r.activated ? 'prices.flash.savedAndLive'
      : r.changed.length ? 'prices.flash.saved' : 'prices.flash.unchanged',
      { name: deps.employeeName });
    return reply.redirect(`/app/factory/prices?flash=${encodeURIComponent(flash)}`);
  });

  app.post('/app/products/add/confirm', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    const r = await confirmImport(deps.db, s.businessId, text);
    return reply.redirect(`/app/products?flash=${encodeURIComponent(importFlash(localeOf(req), r))}`);
  });

  // ── M9.6 Employee Profile: personnel file over the existing trust data ────
  app.get('/app/employee', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    // Phase C: "who is she today?" composes her profile with EXISTING read
    // models — M14 knowledge (gaps + report), the operations snapshot (activity)
    // and the pilot feedback loop. No new query, no new storage.
    const [e, ops, snapshot, feedback] = await Promise.all([
      loadEmployee(deps.db, s.businessId),
      loadKnowledgeOps(deps.db, s.businessId, 'month'),
      loadOperationsSnapshot(deps.db, s.businessId, 'month', deps.provider),
      loadPilotFeedback(deps.db, s.businessId, 'month'),
    ]);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.employee'), active: 'employee',
      bodyHtml: renderEmployee(e, locale, flash, {
        taughtRecently: ops.report.factsAdded,
        corrected: ops.report.answersCorrected,
        handled: snapshot.activity.handled,
        draftsPrepared: snapshot.activity.draftsCreated,
        neededYou: feedback.conversationsNeedingYou,
        gaps: ops.gaps.slice(0, 5).map((g) => ({ question: g.question, count: g.count })),
      }),
    }));
  });
  const capAction = (verb: string, run: (biz: string, cap: string) => Promise<{ code: import('../../pipeline/capability.js').CapabilityFlash }>) =>
    app.post(`/app/employee/capability/:capability/${verb}`, async (req, reply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const locale = localeOf(req);
      const cap = (req.params as { capability: string }).capability;
      const r = await run(s.businessId, cap);
      return reply.redirect(`/app/employee?flash=${encodeURIComponent(t(locale, `employee.flash.${r.code}` as MessageKey))}`);
    });
  capAction('promote', (b, c) => promoteCapability(deps.db, b, c, 'owner'));
  capAction('revoke', (b, c) => revokeCapability(deps.db, b, c, 'owner'));

  // ── M34.7 抽查: the owner answers a spot check ────────────────────────────
  // The buttons post the wire words parseSpotCheckReply already understands
  // (好 / 有问题) and the correction box posts whatever she typed — the same
  // shape as the inbox's draft actions, and the reason that parser needed no
  // change to become reachable.
  app.post('/app/employee/spot-check/:id', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const answer = String((req.body as { answer?: string } | undefined)?.answer ?? '');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/employee');
    const r = await withTenantTx(deps.db, bid.value, (tx) => answerSpotCheck(tx, bid.value, id, answer));
    const key = !r.answered ? 'spotcheck.flash.gone'
      : r.verdict === 'correct' ? 'spotcheck.flash.ok'
      : r.verdict === 'serious' ? 'spotcheck.flash.problem'
      : 'spotcheck.flash.fixed';
    return reply.redirect(`/app/employee?flash=${encodeURIComponent(t(locale, key as MessageKey))}`);
  });

  // ── M35.1 · the owner issues and revokes the buyer's proof link ───────────
  //
  // It lives on the conversation because that is where the quote lives. Both
  // actions are audited on the conversation like every other owner action, and
  // both go through the same session guard as the rest of /app.
  const proofAction = (
    verb: string,
    run: (biz: string, cid: string) => Promise<{ code: 'issued' | 'revoked' | 'failed' }>,
  ) =>
    app.post(`/app/inbox/:conversationId/proof${verb}`, async (req, reply) => {
      const sess = sessionOf(req);
      if (!sess) return reply.redirect('/login');
      const locale = localeOf(req);
      const cid = (req.params as { conversationId: string }).conversationId;
      const r = await run(sess.businessId, cid);
      const flash = t(locale, `proof.owner.flash.${r.code}` as MessageKey);
      return reply.redirect(
        `/app/inbox/${encodeURIComponent(cid)}?flash=${encodeURIComponent(flash)}`);
    });

  proofAction('', async (biz, cid) => {
    const bid = parseBusinessId(biz);
    if (!bid.ok) return { code: 'failed' as const };
    const quoteId = await withTenantTx(deps.db, bid.value, (tx) =>
      loadProofLinkState(tx, cid).then((p) => p.quoteId));
    if (!quoteId) return { code: 'failed' as const };
    const issued = await issueProofLink(deps.db, biz, quoteId);
    if (!issued) return { code: 'failed' as const };
    await withTenantTx(deps.db, bid.value, (tx) =>
      tenantRepos(tx, bid.value).events.append(cid as never, 'proof_issued', { quoteId }));
    return { code: 'issued' as const };
  });

  proofAction('/revoke', async (biz, cid) => {
    const bid = parseBusinessId(biz);
    if (!bid.ok) return { code: 'failed' as const };
    const state = await withTenantTx(deps.db, bid.value, (tx) => loadProofLinkState(tx, cid));
    if (!state.token) return { code: 'failed' as const };
    const r = await revokeProofLink(deps.db, biz, state.token);
    if (!r.revoked) return { code: 'failed' as const };
    await withTenantTx(deps.db, bid.value, (tx) =>
      tenantRepos(tx, bid.value).events.append(cid as never, 'proof_revoked', { quoteId: state.quoteId }));
    return { code: 'revoked' as const };
  });

  // ── M9.7 Conversations: customer memory over existing activity ────────────
  app.get('/app/conversations', authed('conversations', async (s, req, locale) => {
    const q = typeof (req.query as { q?: string }).q === 'string' ? (req.query as { q: string }).q : '';
    return renderCustomerList(await loadCustomerList(deps.db, s.businessId, q), locale, new Date());
  }));
  app.get('/app/conversations/:conversationId', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const file = await loadCustomerFile(deps.db, s.businessId, conversationId);
    if (!file) return reply.code(404).type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'conv.title'), active: 'conversations',
      bodyHtml: `<h1 class="page">${esc(t(locale, 'conv.notFound'))}</h1><div class="block"><a href="/app/conversations">${esc(t(locale, 'conv.back'))}</a></div>`,
    }));
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: file.buyer ?? t(locale, 'common.buyer'), active: 'conversations',
      bodyHtml: renderCustomerFile(file, locale, new Date()),
    }));
  });

  // ── M9.8 Business Performance: plain counts over existing business rows ────
  app.get('/app/analytics', authed('analytics', async (s, req, locale) => {
    const range = parseRange((req.query as { range?: string }).range);
    return renderAnalytics(await loadAnalytics(deps.db, s.businessId, range), locale);
  }));

  // ── M11.2/M15.1 Pilot Readiness Hub: detected readiness + owner attestations ─
  app.get('/app/onboarding', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const data = await loadPilotRunbook(deps.db, s.businessId, {
      sandboxBusinessId: deps.sandboxBusinessId, provider: deps.provider,
    });
    // M17.1: which build is running — owner-authenticated only, never on /health.
    const deployment = readDeployment(process.env, new Date(), process.uptime());
    // M17.2: go-live preparation status. Reads shapes only — never a value, and
    // never contacts Meta, so opening this page can switch nothing on.
    // M17.6: what actually happened — counts and dates from stored signals/events.
    const feedback = await loadPilotFeedback(deps.db, s.businessId, 'month');
    const meta = checkMetaReadiness({
      values: {
        accessToken: process.env['META_WHATSAPP_ACCESS_TOKEN'],
        phoneNumberId: process.env['META_WHATSAPP_PHONE_NUMBER_ID'],
        businessAccountId: process.env['META_WHATSAPP_BUSINESS_ACCOUNT_ID'],
        appSecret: process.env['META_APP_SECRET'],
        verifyToken: process.env['WEBHOOK_VERIFY_TOKEN'],
        graphVersion: process.env['META_GRAPH_API_VERSION'] ?? 'v23.0',
      },
      provider: deps.provider,
      channelStatus: (await loadChannels(deps.db, s.businessId, messagingEnabled)).whatsapp.status,
    });
    // M20.5: invariant violations on this factory's REAL rows are an engine
    // defect, so they surface here — beside the build version — and nowhere the
    // owner is asked to act. The findings from the same run stay in My factory.
    const rehearsal = await loadFactoryRehearsal(deps.db, s.businessId);
    // M29 follow-up — price rules the old importer fabricated. Operator-only:
    // the owner cannot fix it and did not cause it. Zero on any factory
    // provisioned after M29, which is the point.
    const unauthored = await countUnauthoredPriceRules(deps.db, s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'pilot.title'), active: 'onboarding',
      bodyHtml: renderPilotRunbook(data, locale, flash, deployment, meta, feedback, rehearsal, deps.templateState ?? 'none', unauthored),
    }));
  });

  app.post('/app/onboarding/attest', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const which = String((req.body as { which?: string } | undefined)?.which ?? '') as AttestKey;
    if (which in ({ backup_tested: 1, secrets_rotated: 1, owner_ready: 1, claims_reviewed: 1 } as Record<string, number>)) {
      await attest(deps.db, s.businessId, which);
    }
    return reply.redirect(`/app/onboarding?flash=${encodeURIComponent(t(localeOf(req), 'pilot.flash.attested'))}`);
  });

  app.post('/app/onboarding/validate', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const r = await runValidation(deps.db, s.businessId);
    const flash = t(localeOf(req), 'pilot.flash.validated', { pass: r.pass, total: r.total });
    return reply.redirect(`/app/onboarding?flash=${encodeURIComponent(flash)}`);
  });

  // ── M11.1 Business Profile & Owner Settings (owner-authenticated only) ─────
  app.get('/app/settings', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const profile = await loadBusinessProfile(deps.db, s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'settings.profile.title'), active: 'settings',
      bodyHtml: renderSettings(profile, locale, flash),
    }));
  });
  // ── M37.5 · the words she may never say ───────────────────────────────────
  // Reached from settings. Without this surface the guard would be M35 again:
  // something buyers are subject to that no owner can configure.
  app.get('/app/settings/forbidden', authed('settings', async (sess, req, locale) =>
    renderForbidden(await loadForbidden(deps.db, sess.businessId), locale,
      typeof (req.query as { flash?: string }).flash === 'string'
        ? (req.query as { flash: string }).flash : null)));

  app.post('/app/settings/forbidden', async (req, reply) => {
    const sess = sessionOf(req);
    if (!sess) return reply.redirect('/login');
    const locale = localeOf(req);
    const term = String((req.body as { term?: string } | undefined)?.term ?? '');
    const r = await addForbidden(deps.db, sess.businessId, term);
    return reply.redirect(`/app/settings/forbidden?flash=${encodeURIComponent(
      t(locale, `forbidden.flash.${r.code}` as MessageKey))}`);
  });

  // M43b — the rate SHE will honour. Never a live rate she did not approve.
  app.get('/app/settings/rate', authed('settings', async (sess, req, locale) =>
    renderRate(await loadRates(deps.db, sess.businessId), locale,
      typeof (req.query as { flash?: string }).flash === 'string'
        ? (req.query as { flash: string }).flash : null)));

  app.post('/app/settings/rate', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const raw = (req.body as { rate?: string } | undefined)?.rate ?? null;
    const r = await setRate(deps.db, s.businessId, raw, new Date());
    const flash = r.code === 'set'
      ? t(locale, 'rate.flash.set', { name: deps.employeeName, rate: r.rate.rate })
      : t(locale, `rate.flash.${r.code}` as MessageKey);
    return reply.redirect(`/app/settings/rate?flash=${encodeURIComponent(flash)}`);
  });

  // M44 — the days her factory is shut. She states them; nothing is assumed.
  app.get('/app/settings/closures', authed('settings', async (sess, req, locale) =>
    renderClosures(await loadClosures(deps.db, sess.businessId), locale,
      typeof (req.query as { flash?: string }).flash === 'string'
        ? (req.query as { flash: string }).flash : null)));

  app.post('/app/settings/closures', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await addClosure(deps.db, s.businessId, {
      label: b['label'] ?? null, from: b['from'] ?? null, to: b['to'] ?? null,
    });
    const flash = r.code === 'added'
      ? t(locale, 'closures.flash.added', { name: deps.employeeName, label: r.label })
      : t(locale, `closures.flash.${r.code}` as MessageKey);
    return reply.redirect(`/app/settings/closures?flash=${encodeURIComponent(flash)}`);
  });

  app.post('/app/settings/closures/:id/remove', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const r = await removeClosure(deps.db, s.businessId, (req.params as { id: string }).id);
    return reply.redirect(`/app/settings/closures?flash=${encodeURIComponent(
      t(locale, `closures.flash.${r.code}` as MessageKey))}`);
  });

  app.post('/app/settings/forbidden/:id/remove', async (req, reply) => {
    const sess = sessionOf(req);
    if (!sess) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const r = await removeForbidden(deps.db, sess.businessId, id);
    return reply.redirect(`/app/settings/forbidden?flash=${encodeURIComponent(
      t(locale, `forbidden.flash.${r.code}` as MessageKey))}`);
  });

  app.post('/app/settings', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const input = {
      name: String(b['name'] ?? ''), description: String(b['description'] ?? ''),
      location: String(b['location'] ?? ''), workingHours: String(b['working_hours'] ?? ''),
      contactEmail: String(b['contact_email'] ?? ''), contactPhone: String(b['contact_phone'] ?? ''),
      languagesServed: LOCALES.filter((l) => b[`lang_${l}`] !== undefined),
    };
    const r = await saveBusinessProfile(deps.db, s.businessId, input, 'owner');
    if (r.code === 'saved') {
      return reply.redirect(`/app/settings?flash=${encodeURIComponent(t(locale, 'settings.flash.profileSaved'))}`);
    }
    // M20.4 (F-07) — a rejected save re-RENDERS the owner's own submission with
    // the bad field marked. Redirecting would reload from the database and throw
    // away everything she typed, which is the M21 defect.
    const profile = await loadBusinessProfile(deps.db, s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'settings.profile.title'), active: 'settings',
      bodyHtml: renderSettings(profile, locale, t(locale, 'settings.flash.profileFix'), {
        name: input.name, description: input.description, location: input.location,
        workingHours: input.workingHours, contactEmail: input.contactEmail,
        contactPhone: input.contactPhone, languagesServed: input.languagesServed,
      }, r.errors),
    }));
  });

  // ── M13/M14 Factory Knowledge: ops overview + teach/correct ────────────────
  // The Knowledge surface leads with a READ-ONLY operations view (M14) — the
  // weekly report, questions to answer (derived gaps), recent changes — then
  // the teach surface (M13). All numbers are real counts; no invented metrics.
  app.get('/app/knowledge', authed('knowledge', async (s, req, locale) => {
    const range = parseKnowledgeRange((req.query as { range?: string }).range);
    const prefill = typeof (req.query as { teach?: string }).teach === 'string' ? (req.query as { teach: string }).teach : '';
    const ops = await loadKnowledgeOps(deps.db, s.businessId, range);
    const index = await loadKnowledgeIndex(deps.db, s.businessId);
    return renderKnowledgeOps(ops, locale, new Date()) + renderKnowledgeIndex(index, locale, prefill);
  }));

  app.get('/app/knowledge/:id', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const d = await loadProductKnowledge(deps.db, s.businessId, id);
    if (!d) return reply.code(404).type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.knowledge'), active: 'knowledge',
      bodyHtml: `<h1 class="page">${esc(t(locale, 'product.notFound'))}</h1><div class="block"><a href="/app/knowledge">${esc(t(locale, 'knowledge.back'))}</a></div>`,
    }));
    const usage = await loadUsageFacts(deps.db, s.businessId, id);
    const flash = typeof (req.query as { flash?: string }).flash === 'string' ? (req.query as { flash: string }).flash : null;
    const prefill = typeof (req.query as { teach?: string }).teach === 'string' ? (req.query as { teach: string }).teach : '';
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.knowledge'), active: 'knowledge',
      bodyHtml: renderProductKnowledge(d, locale, flash, { usage, prefill, now: new Date() }),
    }));
  });

  // Teach/correct/archive/cert → redirect back to the product page (or the index
  // for business-level rows) with a localized flash. All owner-authenticated.
  const kBack = (reply: FastifyReply, req: FastifyRequest, productId: string, code: KnowledgeFlash | 'invalid') => {
    const flash = encodeURIComponent(t(localeOf(req), `knowledge.flash.${code}` as MessageKey));
    return reply.redirect(productId ? `/app/knowledge/${encodeURIComponent(productId)}?flash=${flash}` : '/app/knowledge');
  };
  app.post('/app/knowledge/teach', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as { productId?: string; kind?: string; label?: string; content?: string };
    const productId = b.productId ? String(b.productId) : null;
    const r = await teachKnowledge(deps.db, s.businessId, { productId, kind: String(b.kind ?? ''), label: String(b.label ?? ''), content: String(b.content ?? '') });
    return kBack(reply, req, productId ?? '', r.code);
  });
  app.post('/app/knowledge/correct', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as { id?: string; content?: string; productId?: string };
    const r = await correctKnowledge(deps.db, s.businessId, String(b.id ?? ''), String(b.content ?? ''));
    return kBack(reply, req, String(b.productId ?? ''), r.code);
  });
  app.post('/app/knowledge/archive', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as { id?: string; productId?: string };
    const r = await archiveKnowledge(deps.db, s.businessId, String(b.id ?? ''));
    return kBack(reply, req, String(b.productId ?? ''), r.code);
  });
  app.post('/app/knowledge/cert', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as { productId?: string; key?: string; allowed?: string };
    const r = await setCertification(deps.db, s.businessId, String(b.key ?? ''), b.allowed === '1');
    return kBack(reply, req, String(b.productId ?? ''), r.code);
  });

  // ── M12.2 Interactive pilot sandbox ───────────────────────────────────────
  // A dedicated tenant, session-gated but NEVER the pilot business. No inbox
  // changes: these routes bind to deps.sandboxBusinessId exclusively.
  if (deps.sandboxBusinessId) {
    const sbxDeps: SandboxDeps = {
      db: deps.db, businessId: deps.sandboxBusinessId, now: () => new Date(),
      analyzer: deps.analyzer, replyWriter: deps.replyWriter,
    };
    const liveAvailable = !!(deps.analyzer && deps.replyWriter);
    const modeOf = (raw: unknown): SandboxMode => (raw === 'live' && liveAvailable ? 'live' : 'scripted');

    app.get('/app/sandbox', async (req, reply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const locale = localeOf(req);
      const q = req.query as { mode?: string; flash?: string; ask?: string };
      const flash = typeof q.flash === 'string' ? q.flash : null;
      const prefill = typeof q.ask === 'string' ? q.ask : '';
      // M20.4 (F-04) — the safety checks run IN MEMORY, so a factory provisioned
      // one minute ago can practise. Nothing here writes or sends.
      const practice = await runScriptedPractice();
      // The free-typing half still needs a practice conversation. If this
      // installation has none, say so — never render a picker that does nothing.
      const view = await loadSandboxView(sbxDeps).catch(() => null);
      return reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'nav.sandbox'), active: 'sandbox',
        bodyHtml: renderPractice(practice, locale) + (view
          ? renderSandbox(view, locale, { mode: modeOf(q.mode), liveAvailable, flash, prefill })
          : `<div class="block"><p class="muted">${esc(t(locale, 'practice.live.unavailable'))}</p></div>`),
      }));
    });

    app.post('/app/sandbox/message', async (req, reply) => {
      if (!sessionOf(req)) return reply.redirect('/login');
      const b = (req.body ?? {}) as { text?: string; image?: string; mode?: string };
      const mode = modeOf(b.mode);
      await runSandboxTurn(sbxDeps, { mode, text: String(b.text ?? ''), kind: b.image === '1' ? 'image' : 'text' });
      return reply.redirect(`/app/sandbox?mode=${mode}`);
    });

    app.post('/app/sandbox/scenario', async (req, reply) => {
      if (!sessionOf(req)) return reply.redirect('/login');
      const b = (req.body ?? {}) as { scenarioId?: string; mode?: string };
      const mode = modeOf(b.mode);
      if (b.scenarioId) await runSandboxTurn(sbxDeps, { mode, scenarioId: String(b.scenarioId) });
      return reply.redirect(`/app/sandbox?mode=${mode}`);
    });

    // Approval reuses the ONE approval service; the sink records, never transmits.
    app.post('/app/sandbox/act', async (req, reply) => {
      if (!sessionOf(req)) return reply.redirect('/login');
      const b = (req.body ?? {}) as { draftId?: string; command?: string; edit?: string; mode?: string };
      const mode = modeOf(b.mode);
      const bid = parseBusinessId(deps.sandboxBusinessId!);
      if (bid.ok && b.draftId) {
        const rawReply = b.command === '改' ? `改：${b.edit ?? ''}` : (b.command ?? '');
        await applyOwnerCommand(
          { db: deps.db, now: () => new Date(), kickOutbound: sandboxOutboundSink(sbxDeps) },
          { businessId: bid.value, draftId: b.draftId, rawReply, decidedBy: 'owner' },
        );
      }
      return reply.redirect(`/app/sandbox?mode=${mode}`);
    });

    app.post('/app/sandbox/reset', async (req, reply) => {
      if (!sessionOf(req)) return reply.redirect('/login');
      await resetSandbox(sbxDeps);
      return reply.redirect(`/app/sandbox?flash=${encodeURIComponent(t(localeOf(req), 'sandbox.reset.done'))}`);
    });

    // ── M16.3 sandbox human-control rehearsal ─────────────────────────────────
    // The SAME lifecycle as the inbox: takeOver / ownerReply / resumeAi on the
    // sandbox tenant. The owner reply goes through ownerReply (the one send path)
    // and is flushed to the transcript by the sandbox sink — never a real send.
    const sbxFlash = (req: FastifyRequest, outcome: string) =>
      `/app/sandbox?flash=${encodeURIComponent(t(localeOf(req), `takeover.flash.${outcome}` as MessageKey))}`;
    const sbxAction = (path: string, run: (bid: import('../../core/types/ids.js').BusinessId, cid: string, req: FastifyRequest) => Promise<{ outcome: string }>) =>
      app.post(path, async (req, reply) => {
        if (!sessionOf(req)) return reply.redirect('/login');
        const bid = parseBusinessId(deps.sandboxBusinessId!);
        const cid = await activeSandboxConversationId(sbxDeps);
        if (!bid.ok || !cid) return reply.redirect('/app/sandbox');
        const r = await run(bid.value, cid, req);
        return reply.redirect(sbxFlash(req, r.outcome));
      });
    sbxAction('/app/sandbox/takeover', (bid, cid) =>
      takeOver({ db: deps.db, now: () => new Date() }, { businessId: bid, conversationId: cid, actor: 'owner' }));
    sbxAction('/app/sandbox/reply', (bid, cid, req) =>
      ownerReply(
        { db: deps.db, now: () => new Date(), kickDrive: (_b, c) => sandboxFlushOutbound(sbxDeps, c) },
        { businessId: bid, conversationId: cid, text: String((req.body as { text?: string } | undefined)?.text ?? ''), actor: 'owner' },
      ));
    sbxAction('/app/sandbox/resume', (bid, cid) =>
      resumeAi({ db: deps.db, now: () => new Date() }, { businessId: bid, conversationId: cid, actor: 'owner' }));
  }
}
