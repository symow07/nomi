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
import { loadOrder, recordOrderUpdate, renderOrder } from './orders.js';
import {
  loadPeople, addPerson, removePerson, renderPeople, personForCode, ownerPerson,
} from './people.js';
import { OUTREACH_CHANNELS } from '../../core/channel/registry.js';
import { setOutreach } from '../../db/outreach.js';
import { recordDomainCheck, sendingDomain, setSendingDomain } from '../../db/sendingDomain.js';
import { checkDomain } from '../../core/outreach/domain.js';
import { applyUnsubscribe, claimFrom, renderUnsubscribe, renderUnsubscribed } from './unsubscribe.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { suppressionFor } from '../../core/outreach/events.js';
import { suppress as suppressIdentityRow } from '../../db/contacts.js';
import {
  type ContactsFlash, addContactFrom, archiveContactById, attestConsent,
  loadContacts, renderContacts, renderSuppressConfirm, suppressIdentity,
} from './contacts.js';
import { type Person, type OwnerOnlyAction, mayDo, heldByName } from '../../core/conversation/people.js';
import { loadEmployee, renderEmployee } from './employee.js';
import {
  loadCustomerList, loadCustomerFile, renderCustomerList, renderCustomerFile,
} from './conversations.js';
import { loadAnalytics, renderAnalytics, parseRange } from './analytics.js';
import { loadBusinessProfile, renderSettings, saveBusinessProfile, loadForbidden, addForbidden, removeForbidden, renderForbidden, loadRates, setRate, renderRate, loadClosures, addClosure, removeClosure, renderClosures,
  loadSamples, saveSamplePolicy, saveSampleAddress, markSampleHandled, renderSamples } from './settings.js';
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
  /**
   * M40.1 — the DNS lookup, injected so a test can drive it without the
   * network and so the resolver stays out of the web layer.
   */
  readonly resolveDns: import('../../outbound/dns.js').DnsLookup;
  /**
   * The `include:` mechanism her SPF record must carry — the sending provider's
   * own. NULL until a provider is configured (M52), and the check reads that as
   * "cannot verify", which refuses. Absence of a confirmation is not one.
   */
  readonly sendingInclude?: string | null;
  /**
   * M40.2 — the sending provider's webhook secret. ABSENT MOUNTS NO WEBHOOK:
   * an unverified endpoint that writes permanent suppressions is a way for
   * anyone to remove her buyers one address at a time.
   */
  readonly emailWebhookSecret?: string | null;
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

/**
 * NOTHING IS PUBLIC EXCEPT WHAT IS DECLARED HERE.
 *
 * ONE list, in the module that registers the routes. It used to be two — a
 * `PUBLIC` array inside `tests/integration/public-routes.test.ts` and another
 * inside `tools/list-routes.mjs`, which `verify-remote.sh` uses to probe a
 * deployed host. M40.2 added two public routes, updated the first copy, and the
 * DEPLOY failed on the second: the remote check reported `/u` answering a
 * stranger with a 404 where it wanted a redirect.
 *
 * That is the transcription defect this repo keeps paying for, and the fix is
 * the same one every time. Both consumers now read this.
 *
 * Every entry is an argument, not an exception. Adding one is a decision about
 * what a stranger may reach.
 */
export const PUBLIC_ROUTES: readonly {
  readonly method: 'GET' | 'POST'; readonly url: string; readonly why: string;
}[] = [
  { method: 'GET', url: '/', why: 'redirects to /login or /app; reveals nothing either way' },
  { method: 'GET', url: '/login', why: 'the login form itself' },
  { method: 'POST', url: '/login', why: 'submitting the access code' },
  { method: 'GET', url: '/locale', why: 'switching language before signing in' },
  { method: 'GET', url: '/p/:token', why: 'M35 — the buyer proof link. The unguessable token IS the credential' },
  { method: 'GET', url: '/u', why: 'M40.2 — one-click unsubscribe. Renders only; the signed token is the credential' },
  { method: 'POST', url: '/u', why: 'M40.2 — one-click unsubscribe. Suppresses exactly the address the signature names' },
  { method: 'POST', url: '/hooks/email', why: 'M40.2 — provider bounce/complaint events, HMAC-verified before a byte of body is read' },
];

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

  /**
   * M47 — WHO is this request, for the four things only the owner may do.
   *
   * A session signed before this milestone carries no person, and that is
   * read as the OWNER — which is what it could only have been when the access
   * code was a single owner. Nobody is logged out by a deploy, and nobody is
   * silently demoted either.
   */
  const personOf = (s: OwnerSession): Person =>
    s.person ?? { id: 'owner', name: 'Owner', isOwner: true };

  /**
   * The owner-only gate. One predicate (`mayDo`), one distinction, called at
   * every route in `OWNER_ONLY` — and a test walks those routes to prove none
   * of them forgot. It refuses with a redirect and a sentence rather than a
   * 403, because a sales assistant who taps the wrong thing is not an attacker.
   */
  const ownerOnly = async (
    req: FastifyRequest, reply: FastifyReply, action: OwnerOnlyAction, back: string,
  ): Promise<OwnerSession | null> => {
    const s = sessionOf(req);
    if (!s) { await reply.redirect('/login'); return null; }
    if (!mayDo(personOf(s), action)) {
      await reply.redirect(`${back}?flash=${encodeURIComponent(t(localeOf(req), 'people.notAllowed'))}`);
      return null;
    }
    return s;
  };

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
  /**
   * M40.2 — bounces and complaints, from the sending provider.
   *
   * MOUNTED ONLY WHEN CONFIGURED, exactly as the WhatsApp webhook is: without a
   * shared secret there is nothing to verify a caller with, and an unverified
   * endpoint that writes permanent suppressions is a way for anyone on the
   * internet to remove her buyers one address at a time. Absent is 404.
   *
   * THE TENANT COMES FROM THE MESSAGE, NOT FROM THE URL. Each send carries the
   * same signed token its unsubscribe link uses, the provider echoes it back on
   * every event, and the webhook reads business, channel and address out of the
   * signature. One mechanism, two uses — a second scheme for the same fact is
   * a second thing to keep true.
   */
  if (deps.emailWebhookSecret) {
    app.post('/hooks/email', async (req, reply) => {
      const given = String(req.headers['x-webhook-signature'] ?? '');
      const expected = createHmac('sha256', deps.emailWebhookSecret!)
        .update(JSON.stringify(req.body ?? {})).digest('base64url');
      const a = Buffer.from(given); const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return reply.code(404).send();

      const events = (req.body as { events?: unknown })?.events;
      if (!Array.isArray(events)) return reply.code(200).send({ ok: true });

      for (const raw of events) {
        // A provider that adds a null, a number or a string to the array must
        // not take the endpoint down: a 500 makes it replay a batch that has
        // already written permanent rows.
        if (typeof raw !== 'object' || raw === null) continue;
        const e = raw as { type?: unknown; permanent?: unknown; tag?: unknown; detail?: unknown };
        if (typeof e.type !== 'string' || typeof e.tag !== 'string') continue;
        const claim = claimFrom(deps.sessionSecret, e.tag);
        if (!claim) continue;
        const reason = suppressionFor({
          type: e.type,
          permanent: e.permanent === true,
          recipient: claim.identity,
          detail: typeof e.detail === 'string' ? e.detail : null,
        });
        // An event we do not recognise, or a soft bounce, does NOTHING. The
        // failure mode of guessing is a permanent suppression nobody asked for.
        if (!reason) continue;
        const bid = parseBusinessId(claim.businessId);
        if (!bid.ok) continue;
        await withTenantTx(deps.db, bid.value, (tx) => suppressIdentityRow(tx, bid.value, {
          channel: claim.channel, identity: claim.identity, reason,
          detail: typeof e.detail === 'string' ? e.detail.slice(0, 200) : null,
        }));
      }
      // Always 200 once the signature is good: a provider that gets an error
      // retries the batch, and a batch that half-succeeded would be replayed
      // against rows that are already permanent.
      return reply.code(200).send({ ok: true });
    });
  }

  /**
   * M40.2 — one-click unsubscribe.
   *
   * GET RENDERS, POST ACTS, and that split is not tidiness. Mail providers,
   * link scanners and security proxies fetch every URL in a message before a
   * human sees it; a GET that unsubscribed would empty her list on delivery,
   * silently, and every suppression it wrote would be permanent.
   *
   * RFC 8058's one-click POST from the mail client lands on the same route.
   *
   * THE TOKEN IS A QUERY PARAMETER, NOT A PATH SEGMENT, and that is the router
   * rather than a preference: Fastify caps a path parameter at 100 characters
   * and these are longer. Raising the cap is a SERVER option, which every place
   * that builds an app would have to remember to set — and forgetting it would
   * turn every unsubscribe link into a 414 in production while the tests that
   * set it stayed green. A query string has no such cap and no such footgun.
   */
  app.get('/u', async (req, reply) => {
    const token = String((req.query as { t?: string }).t ?? '');
    const claim = claimFrom(deps.sessionSecret, token);
    if (!claim) return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage());
    return reply.type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(renderUnsubscribe(claim, token));
  });

  app.post('/u', async (req, reply) => {
    const token = String((req.query as { t?: string }).t ?? '')
      || String((req.body as { t?: string } | undefined)?.t ?? '');
    const claim = claimFrom(deps.sessionSecret, token);
    if (!claim) return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage());
    // The result is not shown to him. Whether the write succeeded or the
    // database was unreachable, the page he sees is the same — an error here
    // would tell a visitor something about a tenant he has no business knowing,
    // and would invite him to try again on a link that already worked.
    await applyUnsubscribe(deps.db, claim);
    return reply.type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(renderUnsubscribed(claim.locale));
  });

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

    /**
     * M47 — TWO WAYS IN, AND THE OWNER'S IS UNCHANGED.
     *
     * Her code is still the environment's, compared the way it always was, so
     * a staff table can never become a way to impersonate her and losing that
     * table cannot lock her out of her own business. Staff codes are rows.
     *
     * The owner is tried FIRST: if the same string ever matched both, hers
     * wins, and the more privileged answer is the one that does not depend on
     * a query.
     */
    let person: OwnerSession['person'];
    if (codeMatches(code, deps.accessCode)) {
      /**
       * HER LOGIN NEVER DEPENDS ON A QUERY. The row is only her NAME; if the
       * database is unreachable, or `people` is empty, or the read throws, she
       * still gets in with the sentinel that has always meant her. A person
       * table that can lock the owner out of her own business is a worse
       * failure than an unnamed takeover.
       */
      const owner = await ownerPerson(deps.db, deps.businessId).catch(() => null);
      person = owner ?? { id: 'owner', name: 'Owner', isOwner: true };
    } else {
      /**
       * A STAFF CODE FAILS CLOSED, for the opposite reason: a code that cannot
       * be verified must not be accepted. An unreachable database means nobody
       * new gets in, which is the safe direction.
       */
      const staff = await personForCode(deps.db, deps.businessId, deps.sessionSecret, code)
        .catch(() => null);
      if (!staff) {
        return reply.code(401).type('text/html; charset=utf-8')
          .send(loginPage({ locale: localeOf(req), path: '/login', error: true }));
      }
      person = staff;
    }

    const token = codec.sign({ businessId: deps.businessId, exp: Date.now() + SESSION_TTL_MS, person });
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
      // M47 — so the list can name WHICH human holds each conversation.
      bodyHtml: renderInboxList(data, locale, new Date(), await loadPeople(deps.db, s.businessId)),
    }));
  });

  app.get('/app/inbox/:conversationId', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const conversationId = (req.params as { conversationId: string }).conversationId;
    // ONE clock for the request: the loader decides whether a closure blocks a
    // date with the same "now" the renderer uses for its timestamps.
    const now = new Date();
    const detail = await loadConversationDetail(deps.db, s.businessId, conversationId, now);
    if (!detail) return reply.code(404).type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.inbox'), active: 'inbox',
      bodyHtml: `<h1 class="page">${esc(t(locale, 'inbox.notFound'))}</h1><div class="block"><a href="/app/inbox">${esc(t(locale, 'inbox.detail.back'))}</a></div>`,
    }));
    const flash = typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null;
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: detail.buyer ?? t(locale, 'common.buyer'), active: 'inbox',
      bodyHtml: renderConversationDetail(detail, locale, now, flash),
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
    // M47 — whoever is signed in takes it, by name.
    const r = await takeOver({ db: deps.db, now: () => new Date() }, { businessId: bid.value, conversationId: cid, actor: personOf(s).id });
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
    const data = await loadChannels(deps.db, s.businessId, messagingEnabled, deps.templateState ?? 'none');
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
    // OWNER ONLY: the one step that cannot be undone — a buyer who has been
    // written to has been written to.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
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
    // OWNER ONLY: the one step that cannot be undone — a buyer who has been
    // written to has been written to.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
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
    // OWNER ONLY: the floor, the discount authority, the ask-above threshold.
    // Staff negotiate INSIDE her rules; they do not move them.
    const s = await ownerOnly(req, reply, 'price_rules', '/app/factory/prices');
    if (!s) return reply;
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
      // OWNER ONLY: deciding what Nomi may do unsupervised is the trust ladder
      // itself, and it is her judgement about her own business risk.
      const s = await ownerOnly(req, reply, 'capability_grant', '/app/employee');
      if (!s) return reply;
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

  // M46 — one order: what she recorded, the proforma, and the form that
  // records the next thing. Reached from the conversation it came out of.
  app.get('/app/orders/:id', authed('inbox', async (sess, req, locale) => {
    const id = (req.params as { id: string }).id;
    const v = await loadOrder(deps.db, sess.businessId, id);
    if (!v) return `<h1 class="page">${esc(t(locale, 'order.notFound'))}</h1>`
      + `<div class="block"><a href="/app/inbox">${esc(t(locale, 'inbox.detail.back'))}</a></div>`;
    return renderOrder(v, locale, typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null);
  }));

  app.post('/app/orders/:id/update', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await recordOrderUpdate(deps.db, s.businessId, id, {
      state: b['state'] ?? '', note: b['note'] ?? null, trackingReference: b['tracking'] ?? null,
      actor: 'owner', now: new Date(),
    });
    return reply.redirect(`/app/orders/${encodeURIComponent(id)}?flash=${encodeURIComponent(
      t(locale, `order.flash.${r.code === 'recorded' ? 'recorded' : r.code}` as MessageKey))}`);
  });

  // M47 — who works here. OWNER ONLY: handing someone a way in is hers.
  app.get('/app/settings/people', authed('settings', async (sess, req, locale) =>
    renderPeople({
      people: await loadPeople(deps.db, sess.businessId),
      // A code is shown ONCE, on the redirect that follows creating someone —
      // it is carried in the query string and never stored anywhere.
      justIssued: typeof (req.query as { code?: string }).code === 'string'
        ? { name: String((req.query as { who?: string }).who ?? ''), code: String((req.query as { code: string }).code) }
        : null,
    }, locale, typeof (req.query as { flash?: string }).flash === 'string'
      ? (req.query as { flash: string }).flash : null)));

  app.post('/app/settings/people', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const locale = localeOf(req);
    const name = String((req.body as { name?: string } | undefined)?.name ?? '');
    const r = await addPerson(deps.db, s.businessId, deps.sessionSecret, name);
    if (r.code !== 'added') {
      return reply.redirect(`/app/settings/people?flash=${encodeURIComponent(
        t(locale, `people.flash.${r.code}` as MessageKey))}`);
    }
    return reply.redirect('/app/settings/people?'
      + `code=${encodeURIComponent(r.accessCode)}&who=${encodeURIComponent(r.name)}`
      + `&flash=${encodeURIComponent(t(locale, 'people.flash.added', { name: r.name }))}`);
  });

  app.post('/app/settings/people/:id/remove', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const locale = localeOf(req);
    const r = await removePerson(deps.db, s.businessId, (req.params as { id: string }).id);
    return reply.redirect(`/app/settings/people?flash=${encodeURIComponent(
      t(locale, r.code === 'removed' ? 'people.flash.removed' : 'people.flash.failed'))}`);
  });

  /**
   * M40.1 — the domain her mail leaves as.
   *
   * OWNER ONLY, on the same list as turning writing-first on: a wrong record
   * here damages the address she has used with buyers for years, and the damage
   * is silent. Setting it CLEARS any previous check — see `setSendingDomain`.
   */
  app.post('/app/channels/domain', async (req, reply) => {
    const sess = await ownerOnly(req, reply, 'outreach', '/app/channels');
    if (!sess) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bid = parseBusinessId(sess.businessId);
    const domain = String(b['domain'] ?? '').trim().toLowerCase();
    const selector = String(b['selector'] ?? '').trim().toLowerCase() || 'nomi';
    const shaped = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
      && /^[a-z0-9][a-z0-9-]*$/.test(selector);
    if (!bid.ok || !shaped) {
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale,
        bid.ok ? 'domain.flash.invalid' : 'domain.flash.failed'))}`);
    }
    await withTenantTx(deps.db, bid.value, (tx) =>
      setSendingDomain(tx, bid.value, { domain, dkimSelector: selector, by: personOf(sess).name }));
    return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale, 'domain.flash.saved'))}`);
  });

  app.post('/app/channels/domain/check', async (req, reply) => {
    const sess = await ownerOnly(req, reply, 'outreach', '/app/channels');
    if (!sess) return reply;
    const locale = localeOf(req);
    const bid = parseBusinessId(sess.businessId);
    if (!bid.ok) {
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale, 'domain.flash.failed'))}`);
    }
    const row = await withTenantTx(deps.db, bid.value, (tx) => sendingDomain(tx, bid.value));
    if (!row) {
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale, 'domain.flash.failed'))}`);
    }
    // The lookup is I/O and can fail; a failure returns empty lists, which read
    // as 'missing'. It is never allowed to read as "fine".
    const found = await deps.resolveDns(row.domain, row.dkimSelector);
    const check = checkDomain(found, deps.sendingInclude ?? null);
    await withTenantTx(deps.db, bid.value, (tx) =>
      recordDomainCheck(tx, bid.value, check, new Date()));
    return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale, 'domain.flash.checked'))}`);
  });

  /**
   * M42 — letting her write to someone who never wrote first.
   *
   * OWNER ONLY, alongside `messaging_activation`. On WhatsApp this decision
   * risks the number permanently, and that is not a thing a staff code should
   * be able to do on her behalf.
   */
  app.post('/app/channels/outreach', async (req, reply) => {
    const sess = await ownerOnly(req, reply, 'outreach', '/app/channels');
    if (!sess) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const channel = OUTREACH_CHANNELS.find((c) => c === b['channel']);
    const bid = parseBusinessId(sess.businessId);
    if (!channel || !bid.ok) {
      return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale, 'outreach.flash.failed'))}`);
    }
    const enabled = b['enabled'] === 'true';
    const done = await withTenantTx(deps.db, bid.value, (tx) =>
      setOutreach(tx, bid.value, { channel, enabled, by: personOf(sess).name }));
    return reply.redirect(`/app/channels?flash=${encodeURIComponent(t(locale,
      !done ? 'outreach.flash.failed' : enabled ? 'outreach.flash.on' : 'outreach.flash.off'))}`);
  });

  /**
   * M38 — who she may write to. The list, and the two decisions about it.
   *
   * NOT owner-only: an attestation carries the name of whoever made it, and the
   * person who took the card is the person who knows. Suppressing is open in
   * the safe direction — more hands able to stop a send is never the risk.
   */
  app.get('/app/contacts', authed('contacts', async (sess, req, locale) =>
    renderContacts(await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none'), locale,
      typeof (req.query as { flash?: string }).flash === 'string'
        ? (req.query as { flash: string }).flash : null)));

  const contactsBack = (locale: Locale, r: ContactsFlash) =>
    `/app/contacts?flash=${encodeURIComponent(t(locale, `contacts.flash.${r}` as MessageKey))}`;

  app.post('/app/contacts', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return reply.redirect(contactsBack(localeOf(req), await addContactFrom(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], name: b['name'], company: b['company'],
      by: personOf(s).name,
    })));
  });

  app.post('/app/contacts/consent', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return reply.redirect(contactsBack(localeOf(req), await attestConsent(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], note: b['note'], by: personOf(s).name,
    })));
  });

  // Permanent, so it takes two presses. The row links here; this page posts.
  app.get('/app/contacts/suppress', authed('contacts', async (sess, req, locale) => {
    const q = req.query as { channel?: string; identity?: string };
    const found = (await loadContacts(deps.db, sess.businessId)).contacts
      .find((c) => c.channel === q.channel && c.identity === q.identity);
    if (!found) return renderContacts(await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none'), locale, null);
    return renderSuppressConfirm(found, locale);
  }));

  app.post('/app/contacts/suppress', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return reply.redirect(contactsBack(localeOf(req), await suppressIdentity(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], reason: b['reason'], detail: b['detail'],
    })));
  });

  app.post('/app/contacts/:id/archive', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    return reply.redirect(contactsBack(localeOf(req),
      await archiveContactById(deps.db, s.businessId, (req.params as { id: string }).id)));
  });

  // M45 — samples. Her two facts, and the buyers waiting on them.
  app.get('/app/settings/samples', authed('settings', async (sess, req, locale) =>
    renderSamples(await loadSamples(deps.db, sess.businessId), locale,
      typeof (req.query as { flash?: string }).flash === 'string'
        ? (req.query as { flash: string }).flash : null,
      new Date())));

  app.post('/app/settings/samples', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await saveSamplePolicy(deps.db, s.businessId, {
      price: b['price'] ?? null, credited: b['credited'] === 'on', now: new Date(),
    });
    const flash = r.code === 'saved'
      ? t(locale, 'samples.flash.saved', { name: deps.employeeName })
      : t(locale, `samples.flash.${r.code}` as MessageKey);
    return reply.redirect(`/app/settings/samples?flash=${encodeURIComponent(flash)}`);
  });

  app.post('/app/settings/samples/:id/address', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const address = String((req.body as { address?: string } | undefined)?.address ?? '');
    const r = await saveSampleAddress(deps.db, s.businessId, (req.params as { id: string }).id, address);
    return reply.redirect(`/app/settings/samples?flash=${encodeURIComponent(
      t(locale, r.code === 'saved' ? 'samples.flash.address' : 'samples.flash.failed'))}`);
  });

  app.post('/app/settings/samples/:id/handled', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const r = await markSampleHandled(deps.db, s.businessId, (req.params as { id: string }).id, 'owner', new Date());
    return reply.redirect(`/app/settings/samples?flash=${encodeURIComponent(
      t(locale, r.code === 'done' ? 'samples.flash.done' : 'samples.flash.failed'))}`);
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
