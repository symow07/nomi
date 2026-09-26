import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { loadOperationsSnapshot, renderOperationsHome } from './operations.js';
import { loadProof, renderProof, notFoundPage, issueProofLink, revokeProofLink, loadProofLinkState } from './proof.js';
import { proofUrl } from '../../db/proofs.js';
import { loadInsights, renderInsights } from './insights.js';
import { connectMetaChannel, metaLinkStatus } from './metaChannels.js';
import { renderMetaPagePicker } from './metaConnect.js';
import {
  metaDialogUrl, mintMetaState, readMetaState, sameMetaNonce, completeMetaConnection, disconnectMetaAccount,
  type MetaLogin, type MetaConnectDeps, type MetaConnectOutcome,
} from '../../channels/meta/connect.js';
import type { InboundLink } from './channels.js';
import { renderPrivacy, renderDataDeletion, renderLegalTerms, type LegalFacts } from './legal.js';
import { renderSite, siteHostsInForce, hostOf, isAppPath, appAddress } from './site.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../core/legal/processors.js';
import type { OutreachChannel } from '../../core/channel/registry.js';
import { decideUncertainSend } from '../../outbound/uncertain.js';
import {
  loadInboxList, loadConversationDetail, renderInboxList, renderConversationDetail,
  defaultFilter, type InboxFilter,
} from './inbox.js';
import {
  loadChannels, renderChannels, renderConnectGuide, channelFlash,
  disconnectChannel, reconnectChannel, testChannel, saveOwnerPhone, connectConfiguredNumber,
} from './channels.js';
import {
  loadProductList, loadProductDetail, renderProductList, renderProductDetail,
  renderAddForm, renderReview, reviewImport, confirmImport, importFlash, updateProduct,
  importFromPhoto, renderPhotoRefusal, diffImport, type PhotoRefusal,
} from './products.js';
import {
  loadPriceRules, savePriceRules, renderPriceRules, countUnauthoredPriceRules,
  saveVolumeDiscount, archiveVolumeDiscount,
} from './priceRules.js';
import { loadOrder, recordOrderUpdate, renderOrder } from './orders.js';
import {
  loadPeople, addPerson, removePerson, renderPeople, personForCode, ownerPerson, hashCode,
  mintIssuedCode, readIssuedCode, ISSUED_COOKIE, ISSUED_PATH, ISSUED_TTL_MS,
} from './people.js';
import {
  addAssistantFromForm, archiveAssistantById, assistantFlash, loadAssistants, updateAssistantFromForm,
} from './assistants.js';
import { assistantNameOfConversation } from '../../db/assistants.js';
import { workspaceFacts, type WorkspaceFacts } from '../../db/workspace.js';
import { handToAssistant } from '../../conversations/assistant.js';
import { OUTREACH_CHANNELS } from '../../core/channel/registry.js';
import { outreachSettings, setOutreach } from '../../db/outreach.js';
import { DAILY_OUTREACH_CEILING } from '../../core/channel/limits.js';
import { setSendingDomain } from '../../db/sendingDomain.js';
import { applyUnsubscribe, claimFrom, renderUnsubscribe, renderUnsubscribed } from './unsubscribe.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { suppressionFor } from '../../core/outreach/events.js';
import { suppress as suppressIdentityRow } from '../../db/contacts.js';
import { normalizeIdentity } from '../../core/outreach/consent.js';
import {
  type ContactsFlash, addContactFrom, archiveContactById, attestConsent,
  loadContacts, reachOf, renderContacts, renderSuppressConfirm, renderWriteFirst, suppressIdentity,
} from './contacts.js';
import { writeFirst } from '../../outbound/writeFirst.js';
import {
  OAUTH_PROVIDERS, authorizeUrl, mintOAuthState, pkcePair, readOAuthState, sameNonce,
  type OAuthClients, type OAuthFetch,
} from '../../connectors/oauth.js';
import { completeMailConnection, disconnectMailbox } from '../../channels/email/connectMailbox.js';
import { loadAccounts, renderAccounts, mailConnectable } from './connect.js';
import { checkSendingDomainNow } from '../../outbound/domainCheck.js';
import {
  addProspect, enrichmentsFor, keyStatus, lookUpCompany, removeKey, saveKey, searchProspects,
  type ProspectDeps,
} from '../../prospects/service.js';
import type { ProspectSourceFor } from '../../connectors/contract.js';
import { failureKey, filterFromQuery, renderProspects } from './prospects.js';
import { parseInboundMail } from '../../channels/email/inbound.js';
import { recordEmailReply } from '../../pipeline/emailReply.js';
import { enroll } from '../../outbound/sequences.js';
import {
  type SequenceFlash, addStepFrom, approveSequenceFrom, archiveSequenceById, createSequenceFrom,
  confirmFollowUpById, loadSequenceDetail, loadSequenceList, renderSequenceDetail, renderSequenceList, stopEnrollmentById,
  updateStepFrom,
} from './sequences.js';
import { type Person, type OwnerOnlyAction, mayDo, heldByName } from '../../core/conversation/people.js';
import { loadEmployee, renderEmployee } from './employee.js';
import {
  loadCustomerList, loadCustomerFile, renderCustomerList, renderCustomerFile, renameBuyer,
} from './conversations.js';
import { loadAnalytics, renderAnalytics, parseRange } from './analytics.js';
import { loadBusinessProfile, renderSettings, saveBusinessProfile, loadForbidden, addForbidden, removeForbidden, renderForbidden, loadRates, setRate, renderRate, loadClosures, addClosure, removeClosure, renderClosures,
  loadSamples, saveSamplePolicy, saveSampleAddress, markSampleHandled, renderSamples,
  loadTerms, saveTerms, renderTerms } from './settings.js';
import { loadFactory, loadFactoryRehearsal, renderFactory } from './factory.js';
import { channelSendPlan, sendPlan, windowState, type TemplateState } from '../../core/channel/window.js';
import { activate, deactivate } from '../../channels/activation.js';
import { addToAllowlist, archiveFromAllowlist } from '../../channels/allowlist.js';
import { ownerSendFacts } from '../../db/channels.js';
import { precheckOwnerSend } from '../../core/channel/lifecycle.js';
import { autonomyReleased } from '../../core/conversation/disclosure.js';
import {
  loadPilotRunbook, renderPilotRunbook, renderPilotTechnical, loadPilotFeedback, attest, nameAssistant, runValidation, type AttestKey,
} from './pilot.js';
import { readDeployment } from './deployment.js';
import { checkMetaReadiness } from '../../core/channel/metaReadiness.js';
import {
  loadKnowledgeIndex, loadProductKnowledge, renderKnowledgeIndex, renderProductKnowledge,
  teachKnowledge, correctKnowledge, archiveKnowledge, setCertification, type KnowledgeFlash,
} from './knowledge.js';
import { loadKnowledgeOps, loadUsageFacts, renderKnowledgeOps, parseRange as parseKnowledgeRange } from './knowledge-insights.js';
import { renderComponents } from './components.js';
import {
  loadSandboxView, renderSandbox, runSandboxTurn, resetSandbox, sandboxOutboundSink,
  activeSandboxConversationId, sandboxFlushOutbound,
  runScriptedPractice, renderPractice,
  type SandboxDeps, type SandboxMode,
} from './sandbox.js';
import { promoteCapability, revokeCapability, chooseAutonomyLevel } from '../../pipeline/capability.js';
import { isAutonomyLevel } from '../../core/conversation/autonomyLevel.js';
import { answerSpotCheck } from '../../pipeline/spotChecks.js';
import { applyOwnerCommand } from '../../pipeline/approve.js';
import { takeOver, resumeAi, handTo } from '../../conversations/takeover.js';
import { ownerReply } from '../../outbound/ownerReply.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import type { Analyzer, ReplyWriter, PageTranscriber } from '../../llm/ports.js';
import { shell, loginPage, signupPage, verifyPage, errorPage, esc, back, isOutreachRoute } from './layout.js';
import { FLASH_COOKIE, FLASH_TTL_MS, mintFlash, readFlash, saidFlash, type Flash, type FlashPart } from './flash.js';
import type { SystemMail } from '../../channels/email/systemMail.js';
import { issueOtp, reissueOtp, redeemOtp } from '../../db/otp.js';
import {
  newOtpCode, otpHash, mintPendingOtp, readPendingOtp, mintKnownDevice, isKnownDevice, maskEmail,
  OTP_TTL_SECONDS, PENDING_TTL_MS, DEVICE_TTL_MS, type OtpPurpose,
} from '../../security/otp.js';
import { renderAccount } from './account.js';
import { loadBusinessKind, saveBusinessKind, renderBusinessKind } from './businessKind.js';
import { makeThrottle, callerKey } from './throttle.js';
import { csvFile, csvFilename } from '../../core/owner/csv.js';
import { isExportSubject, loadExport, recordExport } from './dataExport.js';
import { askWorkspaceDeletion, loadDataRights, renderDataRights, withdrawDeletion } from './dataRights.js';
import { makeLivenessCache, readLiveness, livenessKey, sessionStands } from './liveness.js';
import { lookupLogin, recordLoginAttempt, personForCodeHash, provisionAccount, inviteIsOpen, loginOfPerson, setPassword } from '../../db/accounts.js';
import { hashPassword, verifyPassword, spendAVerification, PASSWORD_MIN, PASSWORD_MAX } from '../../security/password.js';
import { validateSignup, normalizeEmail, type SignupMode, type SignupProblem, type SignupField } from '../../core/owner/signup.js';
import { makeSessionCodec, codeMatches, parseCookies, SESSION_TTL_MS, type OwnerSession } from './session.js';
import { type Locale, LOCALES, resolveLocale, parseLocale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, makeNameCache, withAssistantName, withWorkspace, outreachShown } from './say.js';

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
  readonly businessId: string;         // the ONE business the environment's access code opens
  /** A1 — who may create a workspace here. Absent means 'invite'. */
  readonly signupMode?: SignupMode;
  /**
   * A3 — the installation's own sender. With one, a code is e-mailed when an
   * account is made and when an unknown browser signs in. WITHOUT ONE NOTHING
   * ASKS FOR A CODE: sign-up and sign-in work exactly as before, because a
   * product that demands a code it cannot send locks everyone out.
   */
  readonly systemMail?: SystemMail | null;
  readonly employeeName: string;
  /** Ignored since V1 step three (the assistant is named, never drawn); kept so callers need not change. */
  readonly avatar?: string;
  /**
   * D — how long the per-business facts (name, outreach area, setup count)
   * are remembered between look-ups. A minute in production; a test that
   * flips a switch and looks at once passes 0.
   */
  readonly factsTtlMs?: number;
  readonly provider: string;
  /**
   * Whether the outbound worker runs here and some channel can carry a message.
   * Absent, "a WhatsApp provider is selected" — the whole answer until
   * 2026-09-17. A social-only installation (Page configured, number not yet)
   * passes true while `provider` stays 'disabled'.
   */
  readonly messagingEnabled?: boolean;
  /**
   * The address named on the legal pages (`LEGAL_CONTACT_EMAIL`). Absent, the
   * pages say to write to the business from the account you used, which is
   * always true; they never show a blank where an address should be.
   */
  readonly legalContact?: string | null;
  /**
   * Who processes a buyer's words, and where. The privacy page states it, so it
   * is given the answer rather than repeating one — see core/legal/processors.
   */
  readonly legalFacts?: LegalFacts;
  /** M25 — the installation's real template capability, derived at boot.
   *  Absent = 'none', the fail-closed answer. */
  readonly templateState?: TemplateState;
  /**
   * The native-review gate on autonomy (core/conversation/disclosure.ts).
   * Production never passes this: it reads the product-wide flag. A test that
   * is about what the autonomy route does AFTER release passes `() => true`
   * and says so in its setup — rather than the gate being loosened for tests.
   */
  readonly autonomyReleased?: () => boolean;
  /**
   * G11 — the address buyers reach this installation at. Absent, the owner is
   * shown that a proof link cannot be sent yet rather than a path she would
   * have to assemble a host for.
   */
  readonly publicBaseUrl?: string | null;
  /**
   * Phase 5 — the hosts that are the public site (`SITE_HOSTS`, parsed). On
   * one of them `/` is the site and the app's addresses go to
   * `publicBaseUrl`. Absent or empty, no host is the site.
   */
  readonly siteHosts?: readonly string[];
  /**
   * M40.1 — the DNS lookup, injected so a test can drive it without the
   * network and so the resolver stays out of the web layer.
   */
  readonly resolveDns: import('../../outbound/dns.js').DnsLookup;
  /**
   * The `include:` mechanism her SPF record must carry — the sending provider's
   * own, when the host names one. NULL falls back to the mailbox she connected
   * (C6, `spfIncludeFor`); with neither, the check reads "cannot verify", which
   * refuses. Absence of a confirmation is not one.
   */
  readonly sendingInclude?: string | null;
  /**
   * M40.2 — the sending provider's webhook secret. ABSENT MOUNTS NO WEBHOOK:
   * an unverified endpoint that writes permanent suppressions is a way for
   * anyone to remove her buyers one address at a time.
   */
  readonly emailWebhookSecret?: string | null;
  /**
   * G3 — the WhatsApp number this installation is configured with (Meta's
   * phone number id), or null when there is none. It is what "Connect this
   * number" connects: taken from the host's validated configuration, never
   * from anything a request supplies.
   */
  readonly connectableNumber?: string | null;
  readonly secureCookie: boolean;      // Secure flag (prod = true)
  /** The EXISTING outbound path (main.ts: boss.send(QUEUES.outbound, …)). */
  readonly kickOutbound: (businessId: string, conversationId: string, reply: string) => Promise<void>;
  /** M16.1: the bare re-drive tick (boss.send(QUEUES.outbound, {businessId, conversationId}))
   *  so an owner takeover reply, once enqueued, is delivered by the same worker. */
  readonly kickDrive?: (businessId: string, conversationId: string) => Promise<void>;
  /**
   * C5 — the installation's CREDENTIAL_KEY, derived, so a connector key she
   * pastes is encrypted before it touches a row. Absent: keys cannot be kept,
   * and the prospects page says so rather than storing one in the clear.
   */
  readonly credentialKey?: Buffer;
  /** C5 — builds a prospect source from her key (Apollo in production). */
  readonly prospectSourceFor?: ProspectSourceFor;
  /**
   * C6 — this installation's OAuth apps, per provider. A provider with no client
   * here shows "not set up here", never a Connect button that can only fail.
   */
  readonly oauthClients?: OAuthClients;
  /** The address this installation's own mail server sends as, when it has one. */
  readonly smtpFrom?: string | null;
  /** C9 — the Instagram account and Page this installation can connect, if any. */
  readonly instagramAccountId?: string | null;
  readonly messengerPageId?: string | null;
  /**
   * C10 — Meta's login for a business to connect its OWN Page and Instagram.
   * Absent, the Connect button posts the host's account (C9) or is absent.
   */
  readonly metaLogin?: MetaLogin | null;
  readonly metaConnect?: MetaConnectDeps;
  /** C6 — how the code exchange reaches the provider (tests pass a recording one). */
  readonly oauthFetch?: OAuthFetch;
  /**
   * G13 — ask the worker to answer words a person typed for a voice note. The
   * models live in the worker; this hands it the job, and everything after is
   * the ordinary turn.
   */
  readonly kickAnswer?: (
    businessId: string, conversationId: string, messageId: string, text: string,
  ) => Promise<void>;
  /**
   * G13 — the channel's audio fetcher, so the owner can PLAY the note she is
   * being asked to correct. Absent (no provider configured) → nothing to play,
   * and the page says so.
   */
  readonly audio?: import('../../channels/whatsapp/media.js').AudioFetcher;
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
  { method: 'GET', url: '/', why: 'redirects to /login or /app; reveals nothing either way. On a SITE_HOSTS host it is the public site, which reads nothing and names no tenant' },
  { method: 'GET', url: '/site', why: 'Phase 5 — the public site, previewed on any host and marked noindex; reads nothing and names no tenant' },
  { method: 'GET', url: '/login', why: 'the login form itself' },
  { method: 'POST', url: '/login', why: 'submitting an e-mail and password, or an access code' },
  { method: 'GET', url: '/signup', why: 'A1 — how a factory gets a workspace; names no tenant, and says nothing about which e-mails have one' },
  { method: 'POST', url: '/signup', why: 'A1 — creates a tenant through provision_account only; throttled, and gated by SIGNUP_MODE' },
  { method: 'GET', url: '/verify', why: 'A3 — where the e-mailed code is typed; renders only for a browser holding the signed pending cookie, and shows the address masked' },
  { method: 'POST', url: '/verify', why: 'A3 — redeems a code: five tries and ten minutes per code, counted in the database' },
  { method: 'POST', url: '/verify/resend', why: 'A3 — a new code for the same waiting sign-up; six an hour per address, counted in the database' },
  { method: 'GET', url: '/locale', why: 'switching language before signing in' },
  { method: 'GET', url: '/p/:token', why: 'M35 — the buyer proof link. The unguessable token IS the credential' },
  { method: 'GET', url: '/u', why: 'M40.2 — one-click unsubscribe. Renders only; the signed token is the credential' },
  { method: 'POST', url: '/u', why: 'M40.2 — one-click unsubscribe. Suppresses exactly the address the signature names' },
  { method: 'POST', url: '/hooks/email', why: 'M40.2 — provider bounce/complaint events, HMAC-verified before a byte of body is read' },
  { method: 'POST', url: '/hooks/email/inbound', why: 'C4.c — a buyer\'s reply to her e-mail, HMAC-verified; the tenant comes from the mail he quoted' },
  { method: 'GET', url: '/privacy', why: 'what is kept about the people who write in — Meta reads it before the app may go live; names no tenant' },
  { method: 'GET', url: '/data-deletion', why: 'how they have it removed — the page Meta requires beside the privacy one; names no tenant' },
  { method: 'GET', url: '/terms', why: 'the terms a business accepts by using this — Meta\'s Terms of Service URL; names no tenant' },
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
      await flashTo(reply, `${back}`, 'staff.notAllowed');
      return null;
    }
    return s;
  };

  /**
   * G9a — one cookie writer, for any cookie, by NAME. It used to write only
   * the session cookie; a second secret-bearing cookie deserves the same
   * flags, not a hand-copied set that forgets `Secure` in production.
   */
  const writeCookie = (
    reply: FastifyReply, name: string, value: string, o: { readonly path: string; readonly maxAgeSec: number },
  ) => {
    const flags = ['HttpOnly', `Path=${o.path}`, 'SameSite=Lax', `Max-Age=${o.maxAgeSec}`];
    if (deps.secureCookie) flags.push('Secure');
    reply.header('set-cookie', `${name}=${value}; ${flags.join('; ')}`);
  };
  const setCookie = (reply: FastifyReply, token: string, maxAgeSec: number) =>
    writeCookie(reply, COOKIE, token, { path: '/', maxAgeSec });

  /**
   * A1 + D5 — the one sentence after a POST, and where it now travels.
   *
   * `flashTo` replaces `reply.redirect(`${path}?flash=${t(locale, key)}`)` at
   * every route that ends in a notice. It carries the KEY, not the sentence,
   * in a signed cookie rather than the address bar — the reasons are in
   * `flash.ts`. It returns whatever `reply.redirect` returns, so a caller that
   * wrote `return reply.redirect(…)` keeps writing `return flashTo(…)`.
   *
   * `takeFlash` is the other half: read once, clear, translate in the locale
   * of the page being DRAWN rather than the one that posted.
   */
  const noticeOnNextPage = (
    reply: FastifyReply, key: MessageKey | readonly FlashPart[], params?: Record<string, string | number>,
  ): void => {
    const parts = typeof key === 'string' ? [{ key, ...(params ? { params } : {}) }] : key;
    writeCookie(reply, FLASH_COOKIE, mintFlash(deps.sessionSecret, parts, Date.now()),
      { path: '/', maxAgeSec: Math.ceil(FLASH_TTL_MS / 1000) });
  };

  const flashTo = (
    reply: FastifyReply, path: string, key: MessageKey | readonly FlashPart[], params?: Record<string, string | number>,
  ): FastifyReply => {
    noticeOnNextPage(reply, key, params);
    return reply.redirect(path);
  };

  const takeFlash = (req: FastifyRequest, reply: FastifyReply): Flash | null => {
    const raw = parseCookies(req.headers.cookie)[FLASH_COOKIE];
    if (raw === undefined) return null;
    // Cleared whether or not it verified: a token this build cannot read is
    // still a cookie that would be presented on every page after this one.
    writeCookie(reply, FLASH_COOKIE, '', { path: '/', maxAgeSec: 0 });
    return readFlash(deps.sessionSecret, raw, localeOf(req), Date.now());
  };

  /**
   * S1 — A REMOVED PERSON IS SIGNED OUT, and so is every other session of
   * someone who changed her password.
   *
   * The cookie alone kept verifying for seven days whatever happened to the
   * person it named. Every workspace request now asks whether that person still
   * works here — once a minute at most, and at once in this process after a
   * removal or a password change (the cache entry is dropped there).
   *
   * THE TWO DIRECTIONS OF FAILURE ARE DIFFERENT, as they are at the door. If
   * the question cannot be asked, the OWNER still gets in: her way into her own
   * business must not depend on a query. Anyone else is sent to sign in again,
   * cookie intact, so they are back the moment the database is.
   *
   * The environment's owner before M47 has no person row ('owner'); there is
   * nothing to look up and her code is her credential, so she is let through.
   */
  const liveness = makeLivenessCache();
  const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/app')) return;
    const s = sessionOf(req);
    const person = s?.person;
    if (!s || !person || !PERSON_ID.test(person.id)) return;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return;
    const key = livenessKey(s.businessId, person.id);
    const now = Date.now();
    let v = liveness.get(key, now);
    if (!v) {
      try {
        v = await readLiveness(deps.db, bid.value, person.id, true);
        liveness.set(key, v, now);
      } catch {
        if (person.isOwner) return;
        return reply.redirect('/login');
      }
    }
    if (sessionStands(v, s.pv)) return;
    setCookie(reply, '', 0);
    return reply.redirect('/login');
  });

  /**
   * Phase 5 — the site host serves the site, never the app. An app address
   * asked there goes to the same path on `PUBLIC_BASE_URL` (301; 308 for a
   * form, so a POST stays a POST), which keeps every session cookie on the
   * app's host. The S1 hook above only acts on a session cookie, which the
   * site host never sets. Without `PUBLIC_BASE_URL` it does nothing: there is
   * no other host to send anyone to.
   */
  const siteHosts = siteHostsInForce(deps.siteHosts ?? [], deps.publicBaseUrl);
  const onSiteHost = (req: FastifyRequest): boolean =>
    siteHosts.size > 0 && siteHosts.has(hostOf(req.headers.host));
  app.addHook('onRequest', async (req, reply) => {
    if (!onSiteHost(req) || !isAppPath(req.url)) return;
    const to = appAddress(deps.publicBaseUrl, req.url);
    if (!to) return;
    return reply.redirect(to, req.method === 'GET' || req.method === 'HEAD' ? 301 : 308);
  });

  /**
   * A5.2 — the assistant's name, for this request. Every sentence that says
   * `{name}` is filled from the MAIN assistant of the signed-in business; a
   * page about one conversation narrows it to that conversation's own.
   * D — and, from the same look-up, whether the outreach area is shown and how
   * far setup has come (`workspaceFacts`). Callback-style and on preHandler on
   * purpose: the handler must run INSIDE the scope, and a scope opened before
   * the body is read is lost by the time the handler is called. A failed
   * look-up leaves the page nameless and badgeless — never an error page.
   *
   * Cached for a minute per business; every write below that can change one
   * of the three facts calls `facts.evict`, so the badge and the name never
   * lag behind the thing the owner just did.
   */
  const facts = makeNameCache<WorkspaceFacts>(deps.factsTtlMs);
  app.addHook('preHandler', (req, _reply, done) => {
    if (!req.url.startsWith('/app')) return done();
    const s = sessionOf(req);
    const bid = s ? parseBusinessId(s.businessId) : null;
    if (!s || !bid || !bid.ok) return done();
    const now = Date.now();
    const hit = facts.get(s.businessId, now);
    if (hit !== undefined) return withWorkspace(hit, done);
    withTenantTx(deps.db, bid.value, (tx) => workspaceFacts(tx, bid.value)).then(
      (f) => { facts.set(s.businessId, f, now); withWorkspace(f, done); },
      () => done(),
    );
  });

  /**
   * D — the outreach area answers only where it is switched on. Hidden means
   * no route, not only no link: a page still reachable by URL is still
   * shipped. Runs after the facts hook, inside its scope; the answer is the
   * same not-found page as any wrong address.
   */
  app.addHook('preHandler', async (req, reply) => {
    // A stranger is not told what exists here: the route answers with the same
    // login redirect as every other address.
    if (isOutreachRoute(req.url) && sessionOf(req) && !outreachShown()) return reply.callNotFound();
  });

  // ADR-0008: locale from the owner's cookie, else Accept-Language, else 'en'.
  const localeOf = (req: FastifyRequest): Locale =>
    resolveLocale(parseCookies(req.headers.cookie)[LOCALE_COOKIE], req.headers['accept-language'] ?? null);

  /** Render a full page: fills locale + path + avatar from the request/deps. */
  const page = (req: FastifyRequest, o: { title: string; active: string; bodyHtml: string }): string =>
    shell({ ...o, locale: localeOf(req), path: req.url });

  /**
   * CC-19 / A13 — the wrong address and the broken page, in her language.
   *
   * These are set on the ROOT instance, which also carries `/hooks/*` and
   * `/health` (see `mountCommandCenter` in main.ts) — so they may not simply
   * answer HTML. A caller that did not ask for HTML keeps Fastify's own JSON
   * shape, byte for byte: Meta's webhook retries, the uptime probe and every
   * integration test that reads `.json()` see exactly what they saw before.
   */
  const wantsHtml = (req: FastifyRequest): boolean =>
    String(req.headers['accept'] ?? '').includes('text/html');

  app.setNotFoundHandler(async (req, reply) => {
    if (!wantsHtml(req)) {
      return reply.code(404).send({ message: `Route ${req.method}:${req.url} not found`, error: 'Not Found', statusCode: 404 });
    }
    return reply.code(404).type('text/html; charset=utf-8')
      .send(errorPage({ locale: localeOf(req), path: req.url, kind: 'notfound' }));
  });

  app.setErrorHandler(async (err: FastifyError, req, reply) => {
    // A refusal the code MEANT — a 4xx a route threw on purpose, a body over
    // the limit, a malformed multipart — is the framework's answer to give.
    // Only a genuine fault becomes the page that admits nothing.
    const status = err.statusCode ?? 500;
    if (status < 500) return reply.code(status).send(err);
    // One reference, in the log beside the reason and on the page without it.
    const reference = randomBytes(4).toString('hex');
    req.log.error({ err, reference }, 'unhandled error');
    if (!wantsHtml(req)) {
      return reply.code(500).send({ message: 'Internal Server Error', error: 'Internal Server Error', statusCode: 500 });
    }
    return reply.code(500).type('text/html; charset=utf-8')
      .send(errorPage({ locale: localeOf(req), path: req.url, kind: 'crash', reference }));
  });

  /**
   * G9a — an owner-only PAGE. Only the POSTs were gated, so the pages behind
   * them — her floor, her people and the form that issues a way in — opened
   * for anyone signed in. Same predicate, same sentence as the POST gate,
   * sent back to where the page is reached from.
   */
  const ownerPage = (
    action: OwnerOnlyAction, active: string, back: string,
    render: (s: OwnerSession, req: FastifyRequest, reply: FastifyReply, locale: Locale) => Promise<string> | string,
  ) => async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await ownerOnly(req, reply, action, back);
    if (!s) return reply;
    const locale = localeOf(req);
    const body = await render(s, req, reply, locale);
    return reply.type('text/html; charset=utf-8').send(
      page(req, { title: t(locale, `nav.${active}` as MessageKey), active, bodyHtml: body }),
    );
  };

  /**
   * G10 — would a message she sends to this buyer LEAVE? The same facts the
   * send gate reads, asked when she presses the button, because the gate runs
   * later in the worker and cannot answer her in time. Since G10 it includes
   * the buyer's own 24-hour window.
   */
  const ownerSendVerdict = async (bid: BusinessId, conversationId: string) => {
    const pre = await withTenantTx(deps.db, bid, (tx) => ownerSendFacts(tx, bid, conversationId, whatsappConfigured));
    /**
     * C4.c — an e-mail thread has no WhatsApp lifecycle to be in. Her answer to
     * his reply is refused only by what binds e-mail: messaging must be live
     * (the outbound worker runs only then), and the channel's own window — none,
     * for e-mail — asked through `channelSendPlan`, so an unknown channel still
     * reads as windowed. Everything else is the send gate's, at send time.
     */
    if (pre.channel !== 'whatsapp') {
      if (!messagingEnabled) return 'not_connected' as const;
      return channelSendPlan(pre.channel, pre.lastInboundAt, new Date(), deps.templateState ?? 'none').action
        === 'wait_for_buyer' ? 'window_closed' as const : 'ok' as const;
    }
    return precheckOwnerSend(pre.facts, {
      ...pre,
      windowAction: sendPlan(windowState(pre.lastInboundAt, new Date()), 'reply', deps.templateState ?? 'none').action,
    });
  };

  /** Wrap an authed page: verify session or redirect to /login. */
  const authed = (active: string, render: (s: OwnerSession, req: FastifyRequest, locale: Locale, reply: FastifyReply) => Promise<string> | string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const locale = localeOf(req);
      const body = await render(s, req, locale, reply);
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
    /**
     * G14 — ITS OWN SCOPE, WITH ITS OWN PARSER.
     *
     * A signature is computed over the BYTES the provider sent. This route
     * re-serialised the parsed body and hashed that, which agrees with the
     * provider only by luck — key order, spacing and unicode escapes are all
     * free to differ. Worse, in live mode the Command Center is mounted on the
     * ingress app, whose JSON parser hands every route a STRING: the code then
     * hashed `JSON.stringify("{...}")` and no real event could ever verify.
     *
     * Fastify encapsulates content-type parsers in the scope that declares
     * them, so this keeps the raw body here without changing how any other
     * route is parsed, in either mode.
     */
    void app.register(async (scope) => {
      // The inherited parser first: Fastify refuses to add a second one for a
      // type already handled in the chain, and BOTH modes have one — the
      // framework's own in deployment mode, the ingress app's in live mode.
      scope.removeContentTypeParser('application/json');
      scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_r, body, done) => done(null, body));
      /**
       * The raw body, when its signature is good; null when it is not. ONE
       * check for both e-mail routes: a second copy is where a timing-unsafe
       * comparison or a re-serialised body would come back.
       */
      const signedBody = (req: FastifyRequest): string | null => {
        const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
        const given = String(req.headers['x-webhook-signature'] ?? '');
        const expected = createHmac('sha256', deps.emailWebhookSecret!).update(rawBody).digest('base64url');
        const a = Buffer.from(given); const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b) ? rawBody : null;
      };

      /**
       * C4.c — HIS ANSWER. Signed like the events route; the tenant comes from
       * the mail he quoted, never from the request (`recordEmailReply`).
       *
       * 404 on a bad signature, exactly as the events route, so the two cannot
       * be told apart from outside. 200 on everything after it, including a
       * payload that is not a mail or a thread we never sent: a provider that
       * sees an error retries, and retrying cannot make either of those true.
       * Only a failure to WRITE is an error — that one is worth a retry.
       */
      scope.post('/hooks/email/inbound', async (req, reply) => {
        const rawBody = signedBody(req);
        if (rawBody === null) return reply.code(404).send();
        let parsed: unknown;
        try { parsed = JSON.parse(rawBody); } catch { return reply.code(200).send({ ok: true }); }
        const mail = parseInboundMail(parsed);
        if (!mail) return reply.code(200).send({ ok: true });
        const r = await recordEmailReply(deps.db, mail);
        return reply.code(200).send({ ok: true, outcome: r.outcome });
      });

      scope.post('/hooks/email', async (req, reply) => {
      const rawBody = signedBody(req);
      if (rawBody === null) return reply.code(404).send();

      let parsed: unknown;
      try { parsed = JSON.parse(rawBody); } catch { return reply.code(200).send({ ok: true }); }
      const events = (parsed as { events?: unknown })?.events;
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
        // G14 — NORMALISED, like every other write of an identity. A provider
        // that echoes 'Ahmed@Example.COM' would otherwise write a second
        // suppression row that no send ever matches, and the address would
        // keep receiving mail it asked to stop.
        const identity = normalizeIdentity(claim.channel, claim.identity);
        if (!identity.ok) continue;
        // …and GUARDED, the way the unsubscribe page is: a tenant that no
        // longer exists must not turn one bad row into a 500 the provider
        // retries against rows that are already permanent.
        try {
          await withTenantTx(deps.db, bid.value, (tx) => suppressIdentityRow(tx, bid.value, {
            channel: claim.channel, identity: identity.value, reason,
            detail: typeof e.detail === 'string' ? e.detail.slice(0, 200) : null,
          }));
        } catch { continue; }
      }
      // Always 200 once the signature is good: a provider that gets an error
      // retries the batch, and a batch that half-succeeded would be replayed
      // against rows that are already permanent.
      return reply.code(200).send({ ok: true });
      });
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

  // The legal pages. Public and indexable — Meta fetches them before the app
  // may leave development mode, and a buyer follows them from a Page. They
  // read nothing from the database and name no tenant, so there is nothing
  // here for a stranger to probe.
  // Absent (a test that builds the app by hand), the default processor is
  // Anthropic's own API — which is what an installation with no override calls.
  const legalFacts: LegalFacts = deps.legalFacts ?? { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
  app.get('/privacy', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(renderPrivacy(localeOf(req), deps.legalContact ?? null, legalFacts)));
  app.get('/data-deletion', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(renderDataDeletion(localeOf(req), deps.legalContact ?? null)));
  app.get('/terms', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(renderLegalTerms(localeOf(req), deps.legalContact ?? null)));

  // ── Auth ────────────────────────────────────────────────────────────────
  // Phase 5 — on a site host, `/` is the site; everywhere else it is the door.
  const site = (req: FastifyRequest, path: '/' | '/site', noindex: boolean): string => renderSite({
    locale: localeOf(req), path, noindex, contact: deps.legalContact ?? null,
    signIn: (onSiteHost(req) ? appAddress(deps.publicBaseUrl, '/login') : null) ?? '/login',
  });
  app.get('/', async (req, reply) =>
    onSiteHost(req)
      ? reply.type('text/html; charset=utf-8').send(site(req, '/', false))
      : reply.redirect(sessionOf(req) ? '/app' : '/login'));
  // The same page on any host, for the owner to read before the DNS exists.
  app.get('/site', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(site(req, '/site', true)));

  const signupMode: SignupMode = deps.signupMode ?? 'invite';
  // The second line of defence; the first is the per-login lock in the database.
  const loginThrottle = makeThrottle({ max: 20, windowMs: 5 * 60_000 });
  const signupThrottle = makeThrottle({ max: 5, windowMs: 60 * 60_000 });
  const callerOf = (req: FastifyRequest): string => callerKey(req.headers['x-forwarded-for'], req.ip);
  const html = (reply: FastifyReply, code: number, body: string) =>
    reply.code(code).type('text/html; charset=utf-8').send(body);
  /**
   * Opens a session. `pv` is WHICH password it was opened with (S1) — read
   * back from the row, so a later change can end this session by no longer
   * matching it. An access code has no password and passes none.
   */
  const passwordVersionOf = async (businessId: string, personId: string): Promise<number | undefined> => {
    const bid = parseBusinessId(businessId);
    if (!bid.ok) return undefined;
    return (await readLiveness(deps.db, bid.value, personId).catch(() => null))?.passwordChangedAt ?? undefined;
  };
  const signIn = (reply: FastifyReply, businessId: string, person: NonNullable<OwnerSession['person']>, next = '/app', pv?: number) => {
    setCookie(reply, codec.sign({ businessId, exp: Date.now() + SESSION_TTL_MS, person, ...(pv === undefined ? {} : { pv }) }),
      Math.floor(SESSION_TTL_MS / 1000));
    return reply.redirect(next);
  };

  app.get('/login', async (req, reply) =>
    sessionOf(req)
      ? reply.redirect('/app')
      : reply.type('text/html; charset=utf-8').send(
        loginPage({ locale: localeOf(req), path: req.url, signupOpen: signupMode !== 'closed' })));

  /**
   * A1 — a factory makes its own workspace.
   *
   * The page never says whether an address has an account before she submits,
   * and after she does it says so only about the address SHE typed — which she
   * could learn by trying to sign in anyway. The tenant is made by one definer
   * function (0055); this route cannot insert a business any other way.
   */
  app.get('/signup', async (req, reply) => {
    if (sessionOf(req)) return reply.redirect('/app');
    const invite = String((req.query as { invite?: string }).invite ?? '').trim().slice(0, 64);
    return html(reply, 200, signupPage({
      locale: localeOf(req), path: req.url, mode: signupMode, passwordMin: PASSWORD_MIN,
      contact: deps.legalContact ?? null, values: { invite },
    }));
  });

  app.post('/signup', async (req, reply) => {
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    // One name per box (`channel_whatsapp`), like the languages on her profile:
    // this app's form reader keeps the LAST of a repeated name, so a shared
    // name would silently keep one tick and drop the rest.
    const raw = {
      factory: String(b['factory'] ?? ''), name: String(b['name'] ?? ''), email: String(b['email'] ?? ''),
      password: String(b['password'] ?? ''), invite: String(b['invite'] ?? ''),
      kind: String(b['kind'] ?? ''), sells: String(b['sells'] ?? ''), country: String(b['country'] ?? ''),
      website: String(b['website'] ?? ''), teamSize: String(b['teamSize'] ?? ''),
      channels: Object.keys(b).filter((k) => k.startsWith('channel_') && b[k] !== undefined).map((k) => k.slice('channel_'.length)).slice(0, 12),
    };
    const again = (code: number, extra: { problems?: Partial<Record<SignupField, string>>; error?: string }) =>
      html(reply, code, signupPage({
        locale, path: '/signup', mode: signupMode, passwordMin: PASSWORD_MIN, contact: deps.legalContact ?? null,
        values: {
          factory: raw.factory, name: raw.name, email: raw.email, invite: raw.invite, kind: raw.kind, sells: raw.sells,
          country: raw.country.toUpperCase(), website: raw.website, teamSize: raw.teamSize, channels: raw.channels,
        }, ...extra,
      }));
    if (signupMode === 'closed') return again(403, {});
    if (!signupThrottle.allow(callerOf(req), Date.now())) return again(429, { error: t(locale, 'signup.error.slow') });

    const v = validateSignup(raw, { mode: signupMode, passwordMin: PASSWORD_MIN, passwordMax: PASSWORD_MAX });
    if (!v.ok) {
      const sentence = (p: SignupProblem): string => t(locale, `signup.problem.${p}` as MessageKey, { n: PASSWORD_MIN });
      const problems: Partial<Record<SignupField, string>> = {};
      for (const [field, p] of Object.entries(v.problems) as [SignupField, SignupProblem][]) problems[field] = sentence(p);
      return again(400, { problems });
    }
    // Checked BEFORE the slow hash is spent, so a bad ticket costs nothing.
    if (signupMode === 'invite' && !(await inviteIsOpen(deps.db, v.value.invite!).catch(() => false))) {
      return again(400, { error: t(locale, 'signup.error.invite_not_open') });
    }
    const wanted = {
      factory: v.value.factory, language: locale, ownerName: v.value.name, email: v.value.email,
      passwordHash: await hashPassword(v.value.password),
      invite: v.value.invite, inviteRequired: signupMode === 'invite',
      profile: v.value.profile,
    };
    // A3 — with a sender, the address has to answer first. An address that
    // already has a workspace is told so NOW, as before: she could learn it by
    // trying to sign in, and a code sent to it would only confuse its owner.
    if (otpOn) {
      if (await lookupLogin(deps.db, wanted.email).catch(() => null)) return again(400, { error: t(locale, 'signup.error.email_taken') });
      const sent = await sendCode(reply, locale, wanted.email, 'signup', wanted, null);
      if (sent !== 'sent') return again(sent === 'slow' ? 429 : 502, { error: t(locale, sent === 'slow' ? 'verify.error.slow' : 'verify.error.mail') });
      return reply.redirect('/verify');
    }
    const made = await provisionAccount(deps.db, wanted);
    if (made.code !== 'created') {
      return again(made.code === 'failed' ? 500 : 400, { error: t(locale, `signup.error.${made.code}` as MessageKey) });
    }
    noticeOnNextPage(reply, 'signup.welcome');
    return signIn(reply, made.businessId, { id: made.personId, name: v.value.name, isOwner: true },
      '/app/factory', await passwordVersionOf(made.businessId, made.personId));
  });

  app.post('/login', async (req, reply) => {
    const body = (req.body ?? {}) as { code?: string; email?: string; password?: string };
    const code = String(body.code ?? '');

    /**
     * A1 — HER OWN E-MAIL AND PASSWORD, for a factory that signed itself up.
     *
     * The e-mail names the business, so nobody is asked "which factory?". An
     * unknown address spends the same slow verification a known one does and
     * gets the same sentence, so the door does not say which addresses exist.
     * A locked login is told to wait WITHOUT its password being checked: the
     * lock must not become an oracle that still answers right-or-wrong.
     */
    if (typeof body.email === 'string' && body.email.trim() !== '') {
      const locale = localeOf(req);
      const email = normalizeEmail(body.email);
      const password = String(body.password ?? '');
      const refuse = (status: number, problem: 'password' | 'locked' | 'slow') =>
        html(reply, status, loginPage({ locale, path: '/login', problem, email, signupOpen: signupMode !== 'closed' }));
      if (!loginThrottle.allow(callerOf(req), Date.now())) return refuse(429, 'slow');
      const login = await lookupLogin(deps.db, email).catch(() => null);
      if (!login) { await spendAVerification(password); return refuse(401, 'password'); }
      if (login.lockedUntil && login.lockedUntil.getTime() > Date.now()) return refuse(429, 'locked');
      const ok = password.length <= PASSWORD_MAX && await verifyPassword(password, login.passwordHash);
      await recordLoginAttempt(deps.db, login.loginId, ok).catch(() => undefined);
      if (!ok) return refuse(401, 'password');
      // A3 — the password was right. From a browser we have not seen for THIS
      // login, the address has to answer too. If the code cannot be sent she is
      // let in: a sender that is down must not lock every owner out.
      if (otpOn && !isKnownDevice(deps.sessionSecret, parseCookies(req.headers.cookie)[DEVICE_COOKIE], login.loginId, Date.now())) {
        const sent = await sendCode(reply, locale, email, 'device', null, login.loginId);
        if (sent === 'sent') return reply.redirect('/verify');
        if (sent === 'slow') return refuse(429, 'slow');
      }
      return signIn(reply, login.businessId, login.person, '/app', await passwordVersionOf(login.businessId, login.person.id));
    }

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
      // A1 — a staff code names its OWN business (0055, person_for_code), so
      // the people a second factory adds can sign in too. It is tried against
      // the environment's business first, exactly as before, so nothing about
      // the pilot's staff depends on the new lookup.
      if (!loginThrottle.allow(callerOf(req), Date.now())) {
        return html(reply, 429, loginPage({ locale: localeOf(req), path: '/login', problem: 'slow', signupOpen: signupMode !== 'closed' }));
      }
      const mine = code.trim() === '' ? null
        : await personForCode(deps.db, deps.businessId, deps.sessionSecret, code).catch(() => null);
      const theirs = mine || code.trim() === '' ? null
        : await personForCodeHash(deps.db, hashCode(deps.sessionSecret, code)).catch(() => null);
      if (!mine && !theirs) {
        return reply.code(401).type('text/html; charset=utf-8')
          .send(loginPage({ locale: localeOf(req), path: '/login', error: true, signupOpen: signupMode !== 'closed' }));
      }
      if (theirs) return signIn(reply, theirs.businessId, theirs.person);
      person = mine!;
    }

    return signIn(reply, deps.businessId, person);
  });

  /**
   * A3 — A CODE BY E-MAIL, when an account is made and when a browser we have
   * not seen signs in.
   *
   * What waits is in the DATABASE (0058), not in the cookie: the cookie only
   * says WHICH waiting code this browser may type, signed, for half an hour.
   * For a sign-up the row holds everything she typed and the password HASH, so
   * nothing becomes a tenant — and no invitation is spent — until the code
   * comes back. A code is never logged and never stored; only its keyed hash.
   */
  const OTP_COOKIE = 'yf_otp';
  const DEVICE_COOKIE = 'yf_dev';
  const otpOn = Boolean(deps.systemMail);
  const verifyThrottle = makeThrottle({ max: 30, windowMs: 10 * 60_000 });

  type PendingSignup = {
    readonly factory: string; readonly language: string; readonly ownerName: string; readonly email: string;
    readonly passwordHash: string; readonly invite: string | null; readonly inviteRequired: boolean;
    readonly profile: Parameters<typeof provisionAccount>[1]['profile'];
  };

  /** Issues a code, mails it, and points the browser at /verify. False: tell her why not. */
  const sendCode = async (
    reply: FastifyReply, locale: Locale, email: string, purpose: OtpPurpose, payload: PendingSignup | null, loginId: string | null,
  ): Promise<'sent' | 'slow' | 'mail'> => {
    const code = newOtpCode();
    const id = await issueOtp(deps.db, {
      email, purpose, codeHash: otpHash(deps.sessionSecret, email, purpose, code), payload, loginId, ttlSeconds: OTP_TTL_SECONDS,
    }).catch(() => null);
    if (!id) return 'slow';
    const mailed = await deps.systemMail!.send({
      to: email, subject: t(locale, 'otp.mail.subject', { code }), text: t(locale, 'otp.mail.body', { code }),
    }).catch(() => ({ ok: false as const, error: 'unreachable' }));
    if (!mailed.ok) {
      // Said in the log, because the page can only say "try again": a fixed
      // phrase or a status code per way tried — never the address or the code.
      reply.log.warn({ reason: mailed.error, purpose }, 'system mail could not be sent');
      return 'mail';
    }
    writeCookie(reply, OTP_COOKIE, mintPendingOtp(deps.sessionSecret, { id, email, purpose }, Date.now()),
      { path: '/verify', maxAgeSec: Math.floor(PENDING_TTL_MS / 1000) });
    return 'sent';
  };
  const pendingOf = (req: FastifyRequest) =>
    readPendingOtp(deps.sessionSecret, parseCookies(req.headers.cookie)[OTP_COOKIE], Date.now());
  const rememberDevice = (reply: FastifyReply, loginId: string) =>
    writeCookie(reply, DEVICE_COOKIE, mintKnownDevice(deps.sessionSecret, loginId, Date.now()),
      { path: '/', maxAgeSec: Math.floor(DEVICE_TTL_MS / 1000) });

  app.get('/verify', async (req, reply) => {
    const pending = pendingOf(req);
    if (!pending) return reply.redirect('/login');
    const notice = (req.query as { sent?: string }).sent === '1' ? t(localeOf(req), 'verify.resent') : null;
    return html(reply, 200, verifyPage({
      locale: localeOf(req), path: '/verify', maskedEmail: maskEmail(pending.email), purpose: pending.purpose, notice,
    }));
  });

  app.post('/verify', async (req, reply) => {
    const locale = localeOf(req);
    const pending = pendingOf(req);
    if (!pending) return reply.redirect('/login');
    const again = (status: number, key: MessageKey) => html(reply, status, verifyPage({
      locale, path: '/verify', maskedEmail: maskEmail(pending.email), purpose: pending.purpose, error: t(locale, key),
    }));
    if (!verifyThrottle.allow(callerOf(req), Date.now())) return again(429, 'verify.error.slow');
    const code = String((req.body as { code?: string } | undefined)?.code ?? '');
    const r = await redeemOtp(deps.db, pending.id, otpHash(deps.sessionSecret, pending.email, pending.purpose, code))
      .catch(() => ({ ok: false as const, reason: 'gone' as const }));
    if (!r.ok) return again(r.reason === 'wrong' ? 401 : 400, `verify.error.${r.reason}` as MessageKey);

    writeCookie(reply, OTP_COOKIE, '', { path: '/verify', maxAgeSec: 0 });
    if (r.purpose === 'signup') {
      const p = r.payload as PendingSignup;
      const made = await provisionAccount(deps.db, p);
      if (made.code !== 'created') {
        // The address was taken, or the invitation spent, while the code was in her inbox.
        return html(reply, 400, signupPage({
          locale, path: '/signup', mode: signupMode, passwordMin: PASSWORD_MIN, contact: deps.legalContact ?? null,
          values: { factory: p.factory, name: p.ownerName, email: p.email, invite: p.invite ?? '' },
          error: t(locale, `signup.error.${made.code}` as MessageKey),
        }));
      }
      const login = await lookupLogin(deps.db, p.email).catch(() => null);
      if (login) rememberDevice(reply, login.loginId);
      noticeOnNextPage(reply, 'signup.welcome');
      return signIn(reply, made.businessId, { id: made.personId, name: p.ownerName, isOwner: true },
        '/app/factory', await passwordVersionOf(made.businessId, made.personId));
    }
    // A browser we had not seen, and now have.
    const login = await lookupLogin(deps.db, r.email).catch(() => null);
    if (!login || login.loginId !== r.loginId) return reply.redirect('/login');
    rememberDevice(reply, login.loginId);
    return signIn(reply, login.businessId, login.person, '/app', await passwordVersionOf(login.businessId, login.person.id));
  });

  app.post('/verify/resend', async (req, reply) => {
    const locale = localeOf(req);
    const pending = pendingOf(req);
    if (!pending || !otpOn) return reply.redirect('/login');
    const fail = (status: number, key: MessageKey) => html(reply, status, verifyPage({
      locale, path: '/verify', maskedEmail: maskEmail(pending.email), purpose: pending.purpose, error: t(locale, key),
    }));
    if (!verifyThrottle.allow(callerOf(req), Date.now())) return fail(429, 'verify.error.slow');
    const code = newOtpCode();
    const next = await reissueOtp(deps.db, pending.id, otpHash(deps.sessionSecret, pending.email, pending.purpose, code), OTP_TTL_SECONDS)
      .catch(() => null);
    if (!next) return fail(429, 'verify.error.slow');
    const mailed = await deps.systemMail!.send({
      to: next.email, subject: t(locale, 'otp.mail.subject', { code }), text: t(locale, 'otp.mail.body', { code }),
    }).catch(() => ({ ok: false as const, error: 'unreachable' }));
    if (!mailed.ok) return fail(502, 'verify.error.mail');
    writeCookie(reply, OTP_COOKIE, mintPendingOtp(deps.sessionSecret, { id: next.id, email: next.email, purpose: next.purpose }, Date.now()),
      { path: '/verify', maxAgeSec: Math.floor(PENDING_TTL_MS / 1000) });
    return reply.redirect('/verify?sent=1');
  });

  /**
   * A1 — "how do I sign in?" Her own e-mail, and her own password changed only
   * against the one she has now: a session left open on a shared computer must
   * not be enough to lock her out of her own factory.
   */
  // V1 step two — every component in every state, on one page, for review by
  // eye and by the screenshot tool. Signed-in, not owner-only: OWNER_ONLY is
  // the six business actions, and a page of buttons is not one of them.
  app.get('/app/settings/components', authed('settings', (s, req, locale) => renderComponents(locale)));

  app.get('/app/settings/account', authed('settings', async (s, req, locale, reply) => {
    const bid = parseBusinessId(s.businessId);
    const mine = bid.ok ? await loginOfPerson(deps.db, bid.value, personOf(s).id).catch(() => null) : null;
    const flash = takeFlash(req, reply);
    return renderAccount({ email: mine?.email ?? null, passwordMin: PASSWORD_MIN }, locale, flash, t(locale, 'nav.settings'));
  }));

  /**
   * Phase 2 · CC-12 + CC-02 — her data, out; and her data, gone.
   *
   * OWNER-ONLY as a PAGE, not only on submit (G9a's rule): the export is every
   * buyer, every message and every price in one file, and the deletion request
   * cannot be undone from inside the product. Staff are told whose decision it
   * is rather than shown a form that turns them away.
   */
  app.get('/app/settings/data', ownerPage('data_rights', 'settings', '/app/settings',
    async (s, req, reply, locale) => renderDataRights(
      await loadDataRights(deps.db, s.businessId), locale, takeFlash(req, reply),
      personOf(s), t(locale, 'nav.settings'))));

  /**
   * One file, streamed as an attachment.
   *
   * THE THROTTLE IS PER BUSINESS, not per caller: six links on a page that a
   * browser may prefetch, against six queries that each read a whole table.
   * The budget is generous enough that pressing every link twice is fine and
   * tight enough that a loop is not. In memory, so it does not survive a
   * restart — it is a brake on a hammering loop, not a quota anybody is owed.
   */
  const exportThrottle = makeThrottle({ max: 30, windowMs: 10 * 60_000 });
  /** A request id as the form carries it; anything else never reaches the query. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.get('/app/settings/data/:file', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'data_rights', '/app/settings');
    if (!s) return reply;
    const file = (req.params as { file: string }).file;
    const subject = file.endsWith('.csv') ? file.slice(0, -'.csv'.length) : file;
    if (!isExportSubject(subject)) return reply.callNotFound();
    if (!exportThrottle.allow(`export:${s.businessId}`, Date.now())) {
      return flashTo(reply, '/app/settings/data', 'data.export.flash.tooMany');
    }
    const sheet = await loadExport(deps.db, s.businessId, subject);
    await recordExport(deps.db, s.businessId, subject, sheet.rows.length, personOf(s).id);
    const now = new Date();
    return reply
      .type('text/csv; charset=utf-8')
      // The filename is quoted: a browser reads an unquoted one up to the first
      // space, and `nomi-buyers-2026-09-21.csv` has none today but the next
      // subject might. `attachment` so a browser saves rather than renders —
      // a CSV rendered inline is a page of somebody's private messages.
      .header('content-disposition', `attachment; filename="${csvFilename(subject, now)}"`)
      // It is her data, freshly read. Nothing between here and her laptop may
      // keep a copy to hand to the next person who asks.
      .header('cache-control', 'no-store')
      .send(csvFile(sheet.header, sheet.rows));
  });

  app.post('/app/settings/data/delete', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'data_rights', '/app/settings/data');
    if (!s) return reply;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const note = String(b['note'] ?? '').trim().slice(0, 500) || null;
    const r = await askWorkspaceDeletion(deps.db, s.businessId, String(b['name'] ?? ''), personOf(s).id, note);

    /**
     * A REQUEST NOBODY HEARS IS A ROW IN A TABLE. The page now promises the
     * buyer's business that this is done within 30 days, and the thing that
     * makes that keepable is somebody finding out the day it was asked — not
     * whenever an operator next thinks to look at `deletion_requests`.
     *
     * It goes to LEGAL_CONTACT_EMAIL, which the boot refuses to start without
     * (PR 2), and it leaves over HTTPS through the connected mailbox because
     * Railway's Hobby plan blocks every outbound SMTP port.
     *
     * AFTER the row is written and never instead of it: the record is what the
     * runbook works from, and a send that fails must not lose the request. A
     * failure is logged and the owner is still told her request was made —
     * telling her it failed would be telling her about our mail setup.
     */
    if (r === 'asked' && deps.systemMail && deps.legalContact) {
      const when = new Date().toISOString().slice(0, 10);
      void deps.systemMail.send({
        to: deps.legalContact,
        subject: `Deletion requested · ${s.businessId}`,
        // The id and the date, never the note: the note is the business's own
        // words about why they are leaving, and it is in the row already.
        text: `A workspace asked for everything to be deleted.\n\n`
          + `workspace: ${s.businessId}\nasked by: ${personOf(s).id}\nasked on: ${when}\n\n`
          + `Due within 30 days, which /data-deletion now states.\n`
          + `Follow docs/DATA-DELETION-RUNBOOK.md — offer the export first.\n`,
      }).then(
        (m) => { if (!m.ok) req.log.warn({ reason: m.error }, 'deletion request notice could not be sent'); },
        (e: unknown) => req.log.warn({ err: e }, 'deletion request notice could not be sent'),
      );
    }
    return flashTo(reply, '/app/settings/data', `data.flash.${r}` as MessageKey);
  });

  app.post('/app/settings/data/withdraw', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'data_rights', '/app/settings/data');
    if (!s) return reply;
    const id = String((req.body as { id?: string } | undefined)?.id ?? '');
    const r = UUID.test(id)
      ? await withdrawDeletion(deps.db, s.businessId, id, personOf(s).id)
      : 'failed';
    return flashTo(reply, '/app/settings/data', `data.flash.${r}` as MessageKey);
  });

  app.post('/app/settings/account/password', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as { current?: string; next?: string };
    const done = (key: MessageKey) =>
      flashTo(reply, '/app/settings/account', key, { n: PASSWORD_MIN });
    const bid = parseBusinessId(s.businessId);
    const mine = bid.ok ? await loginOfPerson(deps.db, bid.value, personOf(s).id).catch(() => null) : null;
    if (!bid.ok || !mine) return done('account.flash.failed');
    if (!loginThrottle.allow(`pw:${personOf(s).id}`, Date.now())) return done('account.flash.failed');
    if (!(await verifyPassword(String(b.current ?? ''), mine.passwordHash))) return done('account.flash.wrong');
    const next = String(b.next ?? '');
    if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) return done('account.flash.short');
    const saved = await setPassword(deps.db, bid.value, personOf(s).id, await hashPassword(next)).catch(() => false);
    if (saved) {
      // S1 — every OTHER session she has open ends now; this one is re-issued
      // with the new password's stamp, so she stays on the page she is on.
      liveness.evict(livenessKey(s.businessId, personOf(s).id));
      const pv = await passwordVersionOf(s.businessId, personOf(s).id);
      setCookie(reply, codec.sign({ businessId: s.businessId, exp: Date.now() + SESSION_TTL_MS, person: personOf(s), ...(pv === undefined ? {} : { pv }) }),
        Math.floor(SESSION_TTL_MS / 1000));
    }
    return done(saved ? 'account.flash.changed' : 'account.flash.failed');
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
  app.get('/app', authed('home', async (s, _req, locale) => {
    // Phase B: Today composes two EXISTING read models — the operations snapshot
    // and the pilot feedback loop. No new query, no new storage.
    // M34.10 — plus the insights, which are the only part of this page that
    // tells the owner what to DO rather than what happened.
    const [snapshot, feedback, insights] = await Promise.all([
      // A1 — HER business, from her session. This read the environment's one
      // business, which was the same thing until a second factory could sign in.
      loadOperationsSnapshot(deps.db, s.businessId, 'today', deps.provider, messagingEnabled),
      loadPilotFeedback(deps.db, s.businessId, 'today'),
      loadInsights(deps.db, s.businessId),
    ]);
    return renderOperationsHome(snapshot, locale, {
      conversationsNeedingYou: feedback.conversationsNeedingYou,
      reasons: feedback.handoffReasons.map((r) => ({ kind: r.kind, count: r.count })),
    }, renderInsights(insights, locale));
  }));

  // ── M9.3 Inbox: list, detail, and the ONE approval action ────────────────
  app.get('/app/inbox', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const requested = (req.query as { filter?: string } | undefined)?.filter;
    // G12 — 'mine' needs to know who is looking.
    const me = personOf(s).id;
    const list0 = await loadInboxList(deps.db, s.businessId, 'all', me);
    const filter: InboxFilter = requested === 'pending' || requested === 'all'
      || requested === 'blocked' || requested === 'mine'
      ? requested : defaultFilter(list0.waitingCount);
    const data = filter === list0.filter ? list0 : await loadInboxList(deps.db, s.businessId, filter, me);
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
    const flash = takeFlash(req, reply);
    // G11 — the proof link as a buyer would open it, built from the address
    // this installation is reachable at. Absent, the row says so.
    const withProof = {
      ...detail,
      proof: { ...detail.proof, url: detail.proof.token ? proofUrl(deps.publicBaseUrl, detail.proof.token) : null },
    };
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: detail.buyer ?? t(locale, 'common.buyer'), active: 'inbox',
      // A5.2 — this page is about ONE conversation, so it says its assistant's name.
      bodyHtml: withAssistantName(detail.assistantName, () =>
        renderConversationDetail(withProof, locale, now, flash, personOf(s))),
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
    facts.evict(s.businessId);   // D — the first approved reply is the last setup step

    // G10 — the question the reply route asks, asked here too. Approving said
    // "sent" when the gate was about to refuse it. Live, and this buyer cannot
    // be reached RIGHT NOW (his window is shut, or he is not on her pilot
    // list): the draft stays pending and she is told why — when he writes
    // again she approves it then. Not live at all: unchanged — an approval
    // before going live is her decision recorded, and she is told nothing went.
    const sends = body.command === '发送' || body.command === '改';
    const verdict = sends ? await ownerSendVerdict(bid.value, conversationId) : 'ok';
    if (verdict === 'window_closed' || verdict === 'not_allowlisted') {
      return flashTo(reply, `/app/inbox/${encodeURIComponent(conversationId)}`, `inbox.blocked.${verdict}` as MessageKey);
    }
    const notLive = !messagingEnabled || verdict === 'not_activated' || verdict === 'not_connected';

    // 改 carries the owner's text; other commands map straight to the parser.
    const rawReply = body.command === '改' ? `改：${body.edit ?? ''}` : (body.command ?? '');
    const r = await applyOwnerCommand(
      { db: deps.db, now: () => new Date(), kickOutbound: deps.kickOutbound },
      { businessId: bid.value, draftId: body.draftId, rawReply, decidedBy: personOf(s).id },
    );
    const key: MessageKey = (r.outcome === 'sent' || r.outcome === 'edited_sent') && notLive
      ? 'inbox.flash.sentNotLive'
      : `inbox.flash.${r.outcome}` as MessageKey;
    return flashTo(reply, `/app/inbox/${encodeURIComponent(conversationId)}`, key);
  });

  // ── M16.1 Human takeover: take over / owner reply / return to AI ───────────
  // Ownership moves through src/core/conversation/ownership; the owner reply
  // uses the ONE send path; nothing here is a second approval or send system.
  const takeoverFlash = (reply: FastifyReply, cid: string, outcome: string): FastifyReply => {
    const key: MessageKey = outcome === 'sent' && !messagingEnabled
      ? 'inbox.flash.sentNotLive'
      : `takeover.flash.${outcome}` as MessageKey;
    return flashTo(reply, `/app/inbox/${encodeURIComponent(cid)}`, key);
  };

  app.post('/app/inbox/:conversationId/takeover', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    // M47 — whoever is signed in takes it, by name.
    const r = await takeOver({ db: deps.db, now: () => new Date() }, { businessId: bid.value, conversationId: cid, actor: personOf(s).id });
    return takeoverFlash(reply, cid, r.outcome);
  });

  /**
   * 0052 — her answer about a message nobody could account for.
   *
   * Not owner-only, for the reason taking a conversation over is not: whoever
   * holds the thread is who can judge whether the buyer has it, and the name
   * goes on the decision either way. "Send it" produces an ordinary queued row,
   * so it meets the gate again like every other message; "leave it" closes it
   * as canceled, which is the honest record — this product never saw it leave.
   */
  const uncertainAction = (path: string, decision: 'send_again' | 'leave_it'): void => {
    app.post(path, async (req, reply) => {
      const s = sessionOf(req); if (!s) return reply.redirect('/login');
      const id = (req.params as { outboundId: string }).outboundId;
      const locale = localeOf(req);
      const r = await decideUncertainSend(deps.db, s.businessId, id, decision, personOf(s).name);
      const key: MessageKey = r.done
        ? (decision === 'send_again' ? 'unsure.flash.again' : 'unsure.flash.left')
        : 'unsure.flash.gone';
      // The worker is what sends; this only asks it to look again.
      if (r.done && decision === 'send_again' && r.conversationId) {
        await (deps.kickDrive ?? (async () => {}))(s.businessId, r.conversationId);
      }
      const where = r.conversationId ? `/app/inbox/${encodeURIComponent(r.conversationId)}` : '/app/inbox';
      return flashTo(reply, where, key);
    });
  };
  uncertainAction('/app/outbound/:outboundId/send-again', 'send_again');
  uncertainAction('/app/outbound/:outboundId/leave', 'leave_it');

  // G12 — hand it to a named colleague. Not owner-only: passing work to the
  // person who can answer it IS the job (core/conversation/people.ts).
  app.post('/app/inbox/:conversationId/handto', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const to = String((req.body as { personId?: string } | undefined)?.personId ?? '');
    const r = await handTo({ db: deps.db, now: () => new Date() },
      { businessId: bid.value, conversationId: cid, actor: personOf(s).id, toPersonId: to });
    return r.outcome === 'handed'
      ? flashTo(reply, `/app/inbox/${encodeURIComponent(cid)}`, 'takeover.flash.handed', { name: r.toName ?? '' })
      : flashTo(reply, `/app/inbox/${encodeURIComponent(cid)}`, `takeover.flash.${r.outcome}` as MessageKey);
  });

  // A5.4 — hand this buyer to another assistant. Owner-only, by the rule the
  // team page follows: who answers a buyer is who is on the team.
  app.post('/app/inbox/:conversationId/assistant', async (req, reply) => {
    const cid = (req.params as { conversationId: string }).conversationId;
    const back = `/app/inbox/${encodeURIComponent(cid)}`;
    const s = await ownerOnly(req, reply, 'people', back);
    if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const to = String((req.body as { assistant?: string } | undefined)?.assistant ?? '');
    const r = await handToAssistant(deps.db,
      { businessId: bid.value, conversationId: cid, assistantId: to, actor: personOf(s).id });
    return r.outcome === 'changed' || r.outcome === 'same'
      ? flashTo(reply, back, `conv.assistant.flash.${r.outcome}` as MessageKey, { who: r.name })
      : flashTo(reply, back, 'people.flash.failed');
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
    const verdict = await ownerSendVerdict(bid.value, cid);
    if (verdict !== 'ok') {
      return flashTo(reply, `/app/inbox/${encodeURIComponent(cid)}`, `inbox.blocked.${verdict}` as MessageKey);
    }
    const r = await ownerReply(
      { db: deps.db, now: () => new Date(), kickDrive: deps.kickDrive ?? (async () => {}) },
      { businessId: bid.value, conversationId: cid, text, actor: personOf(s).id },
    );
    return takeoverFlash(reply, cid, r.outcome);
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
  /**
   * G13 — PLAY THE NOTE. Session-gated (staff too: whoever holds the
   * conversation needs to hear it), tenant-scoped, and streamed rather than
   * stored: the bytes are fetched from the provider at the moment she presses
   * play, with her own channel credential, and never written down here.
   */
  app.get('/app/inbox/:conversationId/voice/:messageId', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const { conversationId: cid, messageId } = req.params as { conversationId: string; messageId: string };
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const expired = () => reply.code(404).type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(page(req, {
        title: t(localeOf(req), 'nav.inbox'), active: 'inbox',
        bodyHtml: `<div class="block"><p class="muted">${esc(t(localeOf(req), 'voice.expired'))}</p>`
          + `${back(`/app/inbox/${esc(cid)}`, t(localeOf(req), 'inbox.detail.back'))}</div>`,
      }));

    // The id comes from the ROW, never from the URL: a media id in a query
    // string would let anyone signed in fetch any file the token names.
    const media = await withTenantTx(deps.db, bid.value, (tx) => sql<{ media: string | null }>`
      select provider_media_id as media from messages
       where id = ${messageId}::uuid and conversation_id = ${cid}::uuid
         and direction = 'inbound' and input_type in ('voice', 'voice_transcribed')
       limit 1
    `.execute(tx).then((r) => r.rows[0]?.media ?? null));
    if (!media || !deps.audio) return expired();

    const got = await deps.audio(media);
    if (!got.ok) return expired();
    return reply
      .header('content-type', got.mediaType)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(Buffer.from(got.base64, 'base64'));
  });

  /**
   * G13 — ANSWER WHAT SHE TYPED. Her words go through the ordinary turn in the
   * worker (the models live there), so nothing here skips a guard or a rule.
   */
  app.post('/app/inbox/:conversationId/answer-now', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const messageId = String((req.body as { messageId?: string } | undefined)?.messageId ?? '');
    const bid = parseBusinessId(s.businessId);
    const back0 = `/app/inbox/${encodeURIComponent(cid)}`;
    if (!bid.ok || !messageId || !deps.kickAnswer) return reply.redirect(back0);

    const said = await withTenantTx(deps.db, bid.value, (tx) => sql<{ text: string | null }>`
      select text_content as text from messages
       where id = ${messageId}::uuid and conversation_id = ${cid}::uuid
         and direction = 'inbound' and input_type in ('voice', 'voice_transcribed')
       limit 1
    `.execute(tx).then((r) => r.rows[0]?.text ?? null));
    if (!said || !said.trim()) return reply.redirect(back0);

    /**
     * A note she could not hear put a PERSON in charge of this conversation
     * (G2c), and a person in charge is the one rule that keeps the employee
     * quiet. Asking for an answer is handing it back to her — the existing
     * `resumeAi`, which also soft-resolves the signal that flagged it, so the
     * turn does not immediately hand it over again. Already hers to answer?
     * `resumeAi` says invalid_state and nothing changes.
     */
    await resumeAi({ db: deps.db, now: () => new Date() },
      { businessId: bid.value, conversationId: cid, actor: personOf(s).id });
    await deps.kickAnswer(s.businessId, cid, `${messageId}:answer`, said);
    return flashTo(reply, `${back0}`, 'voice.flash.answering');
  });

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

    const corrected = await withTenantTx(deps.db, bid.value, async (tx) => {
      // G2a — ONLY A BUYER'S VOICE NOTE. This route used to accept any message
      // id in the conversation, so a crafted post could rewrite her own reply or
      // a typed buyer message and relabel it as something the buyer SAID.
      //
      // The ORIGINAL is whatever `transcription` already holds — set on first
      // correction, left alone on every later one, so the machine's reading
      // survives however many times the owner refines her own.
      const before = (await sql<{ text_content: string | null; transcription: string | null }>`
        select text_content, transcription from messages
         where id = ${messageId}::uuid and conversation_id = ${cid}::uuid
           and direction = 'inbound' and input_type in ('voice', 'voice_transcribed')
         limit 1
      `.execute(tx)).rows[0];
      if (!before) return false;
      // An UNHEARD note has no machine reading at all. Recording that reading as
      // the empty string — rather than leaving it null — is what lets the page
      // label her words "Corrected by you" instead of "Heard as": null would
      // claim the machine heard exactly what she typed.
      await sql`
        update messages
           set text_content = ${heard},
               transcription = coalesce(transcription, ${before.text_content ?? ''}),
               input_type = 'voice_transcribed'
         where id = ${messageId}::uuid and conversation_id = ${cid}::uuid
           and direction = 'inbound' and input_type in ('voice', 'voice_transcribed')
      `.execute(tx);
      // `channel_audit` has `channel_id` (nullable) and a NOT NULL `actor`
      // (migration 0011). The insert that named a `channel` column failed on
      // every call and rolled the correction back with it.
      await sql`
        insert into channel_audit (business_id, action, actor, detail)
        values (${bid.value}, 'transcript_corrected', ${personOf(s).id},
                ${JSON.stringify({
                  conversationId: cid, messageId,
                  before: before.transcription ?? before.text_content ?? '', after: heard,
                })}::jsonb)
      `.execute(tx);
      return true;
    });
    if (!corrected) return reply.redirect(back);
    return flashTo(reply, `${back}`, 'voice.flash.corrected');
  });

  app.post('/app/inbox/:conversationId/resume', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const cid = (req.params as { conversationId: string }).conversationId;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/inbox');
    const r = await resumeAi({ db: deps.db, now: () => new Date() }, { businessId: bid.value, conversationId: cid, actor: personOf(s).id });
    return takeoverFlash(reply, cid, r.outcome);
  });

  // ── M9.4 Channel Center: connection state over the existing channel layer ──
  // Two questions that were one until 2026-09-17. `whatsappConfigured` is about
  // the NUMBER: its lifecycle, activation, the Connect button, the test action.
  // `messagingEnabled` is about the WORKER: whether anything queued from these
  // pages leaves. A social-only installation answers no to the first and yes to
  // the second; one flag for both told her messaging was off while buyers were
  // writing to her Page.
  const whatsappConfigured = deps.provider !== 'disabled';
  const messagingEnabled = deps.messagingEnabled ?? whatsappConfigured;
  app.get('/app/channels/whatsapp/connect', authed('channels', (_s, _req, locale) => renderConnectGuide(locale)));

  const channelAction = (path: string, run: (businessId: string, actor: string) => Promise<import('./channels.js').ChannelActionResult>) =>
    app.post(path, async (req, reply) => {
      // Phase 4 — the number's lifecycle is the owner's, like connecting it:
      // a disconnect stops buyers' messages, a test writes to a real phone.
      const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels');
      if (!s) return reply;
      const r = await run(s.businessId, personOf(s).id);
      return flashTo(reply, '/app/channels', channelFlash(r.code));
    });
  // G3 — connect the number the HOST is configured with. Owner-only under the
  // same decision as activation: it is the step that lets buyers' messages in.
  // The number is never read from the form.
  /**
   * C9 — connect the Page or the Instagram account buyers write to. Owner-only,
   * on the same list as activating messaging: it decides whose conversations
   * land in this factory's inbox. The account comes from the host's settings,
   * never from the form.
   */
  for (const kind of ['instagram', 'messenger'] as const) {
    app.post(`/app/channels/${kind}/connect`, async (req, reply) => {
      const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels');
      if (!s) return reply;
      const configured = kind === 'instagram' ? deps.instagramAccountId : deps.messengerPageId;
      const r = await connectMetaChannel(deps.db, s.businessId, kind, configured ?? null, personOf(s).id);
      facts.evict(s.businessId);   // Phase 4b — any connected channel completes the setup step
      const key = r.code === 'connected' ? 'reach.inbound.flash.connected'
        : r.code === 'already_connected' ? 'reach.inbound.flash.already'
        : r.code === 'account_taken' ? 'reach.inbound.flash.taken'
        : r.code === 'not_configured' ? 'reach.inbound.flash.notConfigured'
        : 'channel.flash.failed';
      return flashTo(reply, '/app/channels', key as MessageKey);
    });
  }

  app.post('/app/channels/whatsapp/connect', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels');
    if (!s) return reply;
    const r = await connectConfiguredNumber(deps.db, s.businessId, personOf(s).id, deps.connectableNumber ?? null);
    facts.evict(s.businessId);   // D — a channel connected is a setup step done
    return flashTo(reply, '/app/channels', channelFlash(r.code));
  });
  channelAction('/app/channels/whatsapp/disconnect', (b, actor) => disconnectChannel(deps.db, b, actor));
  channelAction('/app/channels/whatsapp/reconnect', (b, actor) => reconnectChannel(deps.db, b, actor));
  channelAction('/app/channels/whatsapp/test', (b, actor) => testChannel(deps.db, b, actor, whatsappConfigured));

  // P3 follow-up: owner alert destination (minimal action, validated + audited).
  app.post('/app/settings/owner-phone', async (req, reply) => {
    // Phase 4 — where the owner's own alerts go is the owner's to change.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels');
    if (!s) return reply;
    const phone = String((req.body as { phone?: string } | undefined)?.phone ?? '');
    const r = await saveOwnerPhone(deps.db, s.businessId, phone, personOf(s).id);
    return flashTo(reply, '/app/channels', `settings.flash.${r.code}` as MessageKey);
  });

  /**
   * C9 / C10 — which inbound channels this host can offer, and which she
   * connected. One builder, read by the Channels page and by My business
   * (Phase 4b), so the two can never state a channel differently.
   */
  const inboundLinks = async (businessId: string): Promise<Map<OutreachChannel, InboundLink>> => {
    const linked = await metaLinkStatus(deps.db, businessId);
    // C10 — the login is offered whenever this installation has one; a Page she
    // connected herself is named, and is hers to disconnect.
    const login = deps.metaLogin && deps.publicBaseUrl && deps.credentialKey && deps.metaConnect
      ? { connectHref: '/app/connect/meta/start' } : {};
    const own = linked.account;
    const inboundLink = (kind: 'instagram' | 'messenger', hostConfigured: boolean, connected: boolean): InboundLink => ({
      configured: hostConfigured || 'connectHref' in login, connected, ...login,
      ...(own ? {
        connectedAs: kind === 'instagram' && own.igUsername ? `${own.pageName} · @${own.igUsername}` : own.pageName,
        ...(own.needsAttention ? { needsAttention: true } : {}),
        ...(kind === 'instagram' && !own.hasInstagram ? { noInstagram: true } : {}),
      } : {}),
    });
    return new Map<OutreachChannel, InboundLink>([
      ['instagram', inboundLink('instagram', (deps.instagramAccountId ?? null) !== null, linked.instagram)],
      ['messenger', inboundLink('messenger', (deps.messengerPageId ?? null) !== null, linked.messenger)],
    ]);
  };

  // Re-render the channels page with a flash after a redirect (?flash=).
  app.get('/app/channels', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = takeFlash(req, reply);
    const data = await loadChannels(deps.db, s.businessId, whatsappConfigured, deps.templateState ?? 'none',
      deps.connectableNumber ?? null);
    // C6 — every other account she links, read beside the WhatsApp card.
    const bid = parseBusinessId(s.businessId);
    const accounts = bid.ok ? await loadAccounts(deps.db, bid.value, {
      clients: deps.oauthClients ?? {}, publicBaseUrl: deps.publicBaseUrl ?? null,
      smtpFrom: deps.smtpFrom ?? null, apollo: await keyStatus(prospectDeps(), bid.value),
    }) : null;
    // C9 — which inbound channels this host can offer, and which she connected.
    const inbound = await inboundLinks(s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.channels'), active: 'channels',
      bodyHtml: renderChannels(data, locale, flash, personOf(s),
        accounts ? renderAccounts(accounts, locale, personOf(s), inbound) : '', inbound),
    }));
  });

  // ── Nomi Phase E · My factory ──────────────────────────────────────────────
  // One calm page over the EXISTING profile / products / claims / channel read
  // models. Read-only by design: every change still happens on the surface that
  // owns it, so there is exactly one place that writes each thing.
  app.get('/app/factory', authed('factory', async (s, req, locale, reply) => {
    const flash = takeFlash(req, reply);
    // Phase 4b (CC-11) — every channel this installation offers, as /app/channels states it.
    const offer = {
      inbound: await inboundLinks(s.businessId),
      mailConnectable: Object.values(mailConnectable(deps.oauthClients ?? {}, deps.publicBaseUrl ?? null)).some(Boolean),
    };
    return renderFactory(await loadFactory(deps.db, s.businessId, whatsappConfigured, offer), locale, flash, personOf(s));
  }));

  // M20.3 — going live, and coming back. Both go through the EXISTING service:
  // `activate` re-runs its own preconditions and refuses with the same blocker
  // codes My factory already shows, and both write channel_audit themselves.
  // Post/Redirect/Get, so a refresh never re-fires the most consequential
  // action in the product.
  const factoryFlash = (reply: FastifyReply, key: MessageKey, params?: Record<string, string | number>) =>
    flashTo(reply, '/app/factory', key, params);

  app.post('/app/factory/activate', async (req, reply) => {
    // OWNER ONLY: the one step that cannot be undone — a buyer who has been
    // written to has been written to.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const r = await activate(deps.db, bid.value, personOf(s).id, { providerConfigured: whatsappConfigured });
    // A refusal names the same blocker the page was already showing, so the
    // owner never sees a reason that contradicts what they just read.
    return r.ok
      ? factoryFlash(reply, 'activation.flash.activated')
      : factoryFlash(reply, `activation.blocker.${r.code}` as MessageKey);
  });

  // M20.4 (F-06) — the owner decides who may be reached. Reuses the existing
  // allowlist services (they normalise the number and write channel_audit); this
  // adds no model and no permission system. Every flash below is derived from
  // what the service actually persisted, never assumed.
  app.post('/app/factory/allowlist/add', async (req, reply) => {
    // Phase 4 — who may be written to during the pilot is the owner's call.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const b = (req.body ?? {}) as { phone?: string; label?: string };
    const label = String(b.label ?? '').trim() || null;
    const r = await addToAllowlist(deps.db, bid.value, String(b.phone ?? ''), label, personOf(s).id);
    return r.ok
      ? factoryFlash(reply, 'allowlist.flash.added', { who: label ?? r.phone })
      : factoryFlash(reply, 'allowlist.flash.invalid');
  });

  app.post('/app/factory/allowlist/remove', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    const phone = String((req.body as { phone?: string } | undefined)?.phone ?? '');
    const r = await archiveFromAllowlist(deps.db, bid.value, phone, personOf(s).id);
    return r.ok
      ? factoryFlash(reply, 'allowlist.flash.removed', { who: r.phone })
      : factoryFlash(reply, 'allowlist.flash.invalid');
  });

  app.post('/app/factory/deactivate', async (req, reply) => {
    // OWNER ONLY: the one step that cannot be undone — a buyer who has been
    // written to has been written to.
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/factory');
    if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return reply.redirect('/app/factory');
    await deactivate(deps.db, bid.value, personOf(s).id, 'owner stopped messaging');
    return factoryFlash(reply, 'activation.flash.deactivated');
  });

  // ── M9.5 Product Knowledge Center: view over the existing catalog + teach ──
  app.get('/app/products', authed('products', async (s, req, locale, reply) => {
    // D2 — the import redirects here with what it did; the page dropped it.
    const flash = takeFlash(req, reply);
    return renderProductList(await loadProductList(deps.db, s.businessId), locale, flash, personOf(s));
  }));
  app.get('/app/products/add', authed('products', (s, _req, locale) => renderAddForm(locale, personOf(s))));
  app.get('/app/products/:id', authed('products', async (s, req, locale, reply) => {
    const id = (req.params as { id: string }).id;
    const d = await loadProductDetail(deps.db, s.businessId, id);
    return d ? renderProductDetail(d, locale, takeFlash(req, reply), {}, {}, personOf(s))
      : `<h1 class="page">${esc(t(locale, 'product.notFound'))}</h1><div class="block"><a href="/app/products">${esc(t(locale, 'product.detail.back'))}</a></div>`;
  }));
  app.post('/app/products/add/review', async (req, reply) => {
    // Phase 4 — prices are the owner's (CC-07): a catalogue import sets them.
    const s = await ownerOnly(req, reply, 'price_rules', '/app/products');
    if (!s) return reply;
    const locale = localeOf(req);
    const text = String((req.body as { text?: string } | undefined)?.text ?? '');
    const v = reviewImport(text);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'product.review.title'), active: 'products',
      bodyHtml: renderReview(v, text, locale, await diffImport(deps.db, s.businessId, v)),
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
    const s = await ownerOnly(req, reply, 'price_rules', '/app/products');
    if (!s) return reply;
    const locale = localeOf(req);
    const refuse = (reason: PhotoRefusal) =>
      reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'product.photo.refusedTitle'), active: 'products',
        bodyHtml: renderPhotoRefusal(reason, locale),
      }));

    let imageBase64 = '';
    let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
    try {
      const file = await req.file();
      if (!file) return refuse('upload_failed');
      const mt = file.mimetype;
      if (mt !== 'image/jpeg' && mt !== 'image/png' && mt !== 'image/webp') return refuse('not_a_photo');
      mediaType = mt;
      imageBase64 = (await file.toBuffer()).toString('base64');
    } catch (err) {
      // G16 — each failure is named for what it is. Only the parser's size
      // limit is "too large"; a stream that broke off, a request that was not
      // an upload, a limit on parts no form of ours sends — the photo did not
      // arrive, and "take it smaller" would send her to fix the wrong thing.
      return refuse((err as { code?: unknown } | null)?.code === 'FST_REQ_FILE_TOO_LARGE' ? 'too_large' : 'upload_failed');
    }
    if (!imageBase64) return refuse('upload_failed');

    const out = await importFromPhoto({ transcriber: deps.pageTranscriber }, { imageBase64, mediaType });
    if (out.kind === 'refused') return refuse(out.reason);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'product.review.title'), active: 'products',
      bodyHtml: renderReview(out.review, out.text, locale, await diffImport(deps.db, s.businessId, out.review)),
    }));
  });

  // M29 — the owner edits her own product. Archive-never-erase: "stop offering
  // this" is is_active=false, and every changed field is audited old → new.
  app.post('/app/products/:id/edit', async (req, reply) => {
    // Phase 4 — a product's price, MOQ and whether it is offered are money.
    const id = (req.params as { id: string }).id;
    const s = await ownerOnly(req, reply, 'price_rules', `/app/products/${encodeURIComponent(id)}`);
    if (!s) return reply;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    facts.evict(s.businessId);   // D — a first price is a setup step done
    const r = await updateProduct(deps.db, s.businessId, id, personOf(s).id, {
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
    return flashTo(reply, `/app/products/${encodeURIComponent(id)}`,
      r.changed.length ? 'product.edit.flash.saved' : 'product.edit.flash.unchanged');
  });

  // ── M29 Price limits: the three questions, reached from My factory ────────
  // G9a — OWNER ONLY as a page: her floor is what a buyer must never learn,
  // and a sales assistant has no need to know it to negotiate inside it.
  app.get('/app/factory/prices', ownerPage('price_rules', 'factory', '/app/factory', async (s, req, reply, locale) => {
    const q = req.query as { product?: string };
    return renderPriceRules(
      await loadPriceRules(deps.db, s.businessId), locale,
      takeFlash(req, reply), {},
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
    const r = await savePriceRules(deps.db, s.businessId, personOf(s).id, {
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
    return flashTo(reply, '/app/factory/prices',
      r.activatedCount > 0 ? 'prices.flash.savedActivated'
        : r.activated ? 'prices.flash.savedAndLive'
        : r.changed.length ? 'prices.flash.saved' : 'prices.flash.unchanged',
      { n: r.activatedCount });
  });

  // G22 — WHEN she comes down, and by how much. Owner-only for the same reason
  // the floor is: staff negotiate inside her rules and do not write them.
  app.post('/app/factory/prices/volume', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'price_rules', '/app/factory/prices');
    if (!s) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await saveVolumeDiscount(deps.db, s.businessId, personOf(s).id, {
      productId: (b['productId'] ?? '').trim() || null,
      minQty: b['minQty'] ?? null,
      discountPct: b['discountPct'] ?? null,
    });
    if (!r.ok) {
      return reply.code(400).type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'prices.title'), active: 'factory',
        bodyHtml: renderPriceRules(await loadPriceRules(deps.db, s.businessId), locale, null, {}, {}, r.errors),
      }));
    }
    return flashTo(reply, '/app/factory/prices', 'prices.flash.volumeAdded');
  });

  app.post('/app/factory/prices/volume/:id/archive', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'price_rules', '/app/factory/prices');
    if (!s) return reply;
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const r = await archiveVolumeDiscount(deps.db, s.businessId, personOf(s).id, id);
    return r.ok
      ? flashTo(reply, '/app/factory/prices', 'prices.flash.volumeRemoved')
      : reply.redirect('/app/factory/prices');
  });

  app.post('/app/products/add/confirm', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'price_rules', '/app/products');
    if (!s) return reply;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const text = String(b['text'] ?? '');
    // G16 — each change the review offered is its own tick, `apply:<product>`.
    // Only ids are read here; which changes EXIST is recomputed from her own
    // catalogue inside confirmImport, so a posted id can choose, never invent.
    const apply = new Set(Object.keys(b).filter((k) => k.startsWith('apply:') && b[k] === 'on').map((k) => k.slice('apply:'.length)));
    facts.evict(s.businessId);   // D — products with prices are a setup step
    const r = await confirmImport(deps.db, s.businessId, text, { actor: personOf(s).id, apply });
    return flashTo(reply, '/app/products', importFlash(r));
  });

  // ── M9.6 Employee Profile: personnel file over the existing trust data ────
  app.get('/app/employee', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = takeFlash(req, reply);
    // Phase C: "who is she today?" composes her profile with EXISTING read
    // models — M14 knowledge (gaps + report), the operations snapshot (activity)
    // and the pilot feedback loop. No new query, no new storage.
    const [e, ops, snapshot, feedback] = await Promise.all([
      loadEmployee(deps.db, s.businessId),
      loadKnowledgeOps(deps.db, s.businessId, 'month'),
      loadOperationsSnapshot(deps.db, s.businessId, 'month', deps.provider, messagingEnabled),
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
      }, personOf(s)),
    }));
  });
  const capAction = (verb: string, run: (biz: string, cap: string, actor: string) => Promise<{ code: import('../../pipeline/capability.js').CapabilityFlash }>) =>
    app.post(`/app/employee/capability/:capability/${verb}`, async (req, reply) => {
      // OWNER ONLY: deciding what Nomi may do unsupervised is the trust ladder
      // itself, and it is her judgement about her own business risk.
      const s = await ownerOnly(req, reply, 'capability_grant', '/app/employee');
      if (!s) return reply;
      const locale = localeOf(req);
      const cap = (req.params as { capability: string }).capability;
      // The single-capability grant is the same decision as a level, so it is
      // held to the same gate. Taking one back is never refused.
      if (verb === 'promote' && !(deps.autonomyReleased ?? autonomyReleased)()) {
        return flashTo(reply, '/app/employee#on-her-own', 'autonomy.flash.notReleased');
      }
      const r = await run(s.businessId, cap, personOf(s).id);
      return flashTo(reply, '/app/employee', `employee.flash.${r.code}` as MessageKey);
    });
  // T1 — how much she does on her own is the owner's choice, from day one. The
  // same gate as a single grant: it is the same decision, made for several at once.
  app.post('/app/employee/autonomy', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'capability_grant', '/app/employee');
    if (!s) return reply;
    const locale = localeOf(req);
    const level = String((req.body as { level?: string } | undefined)?.level ?? '');
    if (!isAutonomyLevel(level)) return flashTo(reply, '/app/employee#on-her-own', 'people.flash.failed');
    // The native-review gate, enforced where the choice is SAVED rather than
    // only where it is shown. A page that hides a control is a suggestion; a
    // route that refuses it is the rule. `waits` is always allowed: it is the
    // setting that sends nothing without her, so nothing unreviewed can reach
    // a buyer through it — and it is how she takes back what she gave.
    if (level !== 'waits' && !(deps.autonomyReleased ?? autonomyReleased)()) {
      return flashTo(reply, '/app/employee#on-her-own', 'autonomy.flash.notReleased');
    }
    const r = await chooseAutonomyLevel(deps.db, s.businessId, level, personOf(s).id)
      .catch(() => ({ ok: false, changed: 0 }));
    return flashTo(reply, `/app/employee#on-her-own`, r.ok ? 'autonomy.flash.saved' : 'people.flash.failed');
  });
  capAction('promote', (b, c, actor) => promoteCapability(deps.db, b, c, actor));
  capAction('revoke', (b, c, actor) => revokeCapability(deps.db, b, c, actor));

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
    return flashTo(reply, '/app/employee', key as MessageKey);
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
      return flashTo(reply, `/app/inbox/${encodeURIComponent(cid)}`,
        `proof.owner.flash.${r.code}` as MessageKey);
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
  app.get('/app/conversations', authed('conversations', async (s, req, locale, reply) => {
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
    const flash = takeFlash(req, reply);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: file.buyer ?? t(locale, 'common.buyer'), active: 'conversations',
      bodyHtml: renderCustomerFile(file, locale, new Date(), flash),
    }));
  });

  // What she calls him — owner or staff, whoever is looking after him. The
  // channel's own name fills the blank first; this is the correction.
  app.post('/app/conversations/:conversationId/name', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const conversationId = (req.params as { conversationId: string }).conversationId;
    const raw = String((req.body as { name?: unknown } | undefined)?.name ?? '');
    const r = await renameBuyer(deps.db, s.businessId, conversationId, raw, personOf(s).name);
    if (r === 'not_found') return reply.redirect('/app/conversations');
    const key = `conv.flash.name${r === 'saved' ? 'Saved' : r === 'cleared' ? 'Cleared' : 'Invalid'}` as MessageKey;
    return flashTo(reply, `/app/conversations/${encodeURIComponent(conversationId)}`, key, { buyer: t(locale, 'common.buyer') });
  });

  // ── M9.8 Business Performance: plain counts over existing business rows ────
  app.get('/app/analytics', authed('analytics', async (s, req, locale, reply) => {
    const range = parseRange((req.query as { range?: string }).range);
    return renderAnalytics(await loadAnalytics(deps.db, s.businessId, range), locale);
  }));

  // ── M11.2/M15.1 Pilot Readiness Hub: detected readiness + owner attestations ─
  app.get('/app/onboarding', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = takeFlash(req, reply);
    const data = await loadPilotRunbook(deps.db, s.businessId, {
      sandboxBusinessId: deps.sandboxBusinessId, provider: deps.provider,
    });
    // M17.6: what actually happened — counts and dates from stored signals/events.
    const feedback = await loadPilotFeedback(deps.db, s.businessId, 'month');
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'pilot.title'), active: 'onboarding',
      bodyHtml: renderPilotRunbook(data, locale, flash, feedback, personOf(s)),
    }));
  });

  // Phase 4b (audit F2 / F4) — the machine room, one door from Getting ready
  // and owner-only: credential shapes, the engine's own checks, the build.
  app.get('/app/onboarding/technical', ownerPage('messaging_activation', 'onboarding', '/app/onboarding', async (s, _req, _reply, locale) => {
    // M17.1: which build is running — owner-authenticated only, never on /health.
    const deployment = readDeployment(process.env, new Date(), process.uptime());
    // M17.2: go-live preparation status. Reads shapes only — never a value, and
    // never contacts Meta, so opening this page can switch nothing on.
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
      ...(await (async () => {
        // D7 — connected AND started: the page said "Live" on the strength of
        // the wire alone, while every send was refused for want of the decision.
        const ch = (await loadChannels(deps.db, s.businessId, whatsappConfigured)).whatsapp;
        return { channelStatus: ch.status, activated: ch.activated };
      })()),
    });
    // M20.5: invariant violations on this factory's REAL rows are an engine
    // defect, so they surface here — beside the build version — and nowhere the
    // owner is asked to act. The findings from the same run stay in My factory.
    const rehearsal = await loadFactoryRehearsal(deps.db, s.businessId);
    // M29 follow-up — price rules the old importer fabricated. Operator-only:
    // the owner cannot fix it and did not cause it. Zero on any factory
    // provisioned after M29, which is the point.
    const unauthored = await countUnauthoredPriceRules(deps.db, s.businessId);
    return renderPilotTechnical(locale, {
      deployment, meta, rehearsal, templateState: deps.templateState ?? 'none', unauthoredPriceRules: unauthored,
    });
  }));

  // Phase 4 — Getting ready's answers are the owner's: each one is a
  // condition for going live, and going live is the owner's call.
  app.post('/app/onboarding/attest', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/onboarding');
    if (!s) return reply;
    const which = String((req.body as { which?: string } | undefined)?.which ?? '') as AttestKey;
    if (which in ({ backup_tested: 1, secrets_rotated: 1, owner_ready: 1, claims_reviewed: 1 } as Record<string, number>)) {
      await attest(deps.db, s.businessId, which);
    }
    return flashTo(reply, '/app/onboarding', 'pilot.flash.attested');
  });

  // The assistant's name, confirmed before she can be switched on. Its own
  // route rather than a branch of /attest: this one carries an answer, and the
  // attest route exists precisely because those items have no answer to carry.
  app.post('/app/onboarding/assistant-name', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/onboarding');
    if (!s) return reply;
    const raw = String((req.body as { name?: string } | undefined)?.name ?? '');
    const r = await nameAssistant(deps.db, s.businessId, raw, personOf(s).id);
    if (!r.ok) return flashTo(reply, '/app/onboarding', `pilot.assistant.problem.${r.problem}` as MessageKey);
    // Confirming is what makes the name SHOWN (chosenName), so the cached
    // "no name yet" must go now, not a minute from now.
    facts.evict(s.businessId);
    return flashTo(reply, '/app/onboarding', 'pilot.flash.attested');
  });

  app.post('/app/onboarding/validate', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/onboarding');
    if (!s) return reply;
    const r = await runValidation(deps.db, s.businessId);
    return flashTo(reply, '/app/onboarding', 'pilot.flash.validated', { pass: r.pass, total: r.total });
  });

  // ── M11.1 Business Profile & Owner Settings (owner-authenticated only) ─────
  app.get('/app/settings', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const flash = takeFlash(req, reply);
    const profile = await loadBusinessProfile(deps.db, s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.settings'), active: 'settings',
      bodyHtml: renderSettings(profile, locale, flash),
    }));
  });
  // ── A2 · what kind of business this is ────────────────────────────────────
  // Sign-up asks once; this is where she changes it, and where a workspace made
  // before sign-up asked gives the answer for the first time.
  app.get('/app/settings/business', authed('settings', async (s, req, locale, reply) => {
    const flash = takeFlash(req, reply);
    return renderBusinessKind(await loadBusinessKind(deps.db, s.businessId), locale, flash, t(locale, 'nav.settings'));
  }));
  app.post('/app/settings/business', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await saveBusinessKind(deps.db, s.businessId,
      { kind: String(b['kind'] ?? ''), country: String(b['country'] ?? ''), website: String(b['website'] ?? '') }, personOf(s).id);
    return flashTo(reply, '/app/settings/business', r === 'saved' ? 'business.kind.saved' : 'business.kind.invalid');
  });

  // ── M37.5 · the words she may never say ───────────────────────────────────
  // Reached from settings. Without this surface the guard would be M35 again:
  // something buyers are subject to that no owner can configure.
  app.get('/app/settings/forbidden', authed('settings', async (sess, req, locale, reply) =>
    renderForbidden(await loadForbidden(deps.db, sess.businessId), locale,
      takeFlash(req, reply))));

  app.post('/app/settings/forbidden', async (req, reply) => {
    const sess = sessionOf(req);
    if (!sess) return reply.redirect('/login');
    const locale = localeOf(req);
    const body = (req.body ?? {}) as { term?: string; note?: string };
    const r = await addForbidden(deps.db, sess.businessId, String(body.term ?? ''), String(body.note ?? ''));
    return flashTo(reply, '/app/settings/forbidden', `forbidden.flash.${r.code}` as MessageKey);
  });

  // M43b — the rate SHE will honour. Never a live rate she did not approve.
  app.get('/app/settings/rate', authed('settings', async (sess, req, locale, reply) =>
    renderRate(await loadRates(deps.db, sess.businessId), locale,
      takeFlash(req, reply), personOf(sess))));

  app.post('/app/settings/rate', async (req, reply) => {
    // Phase 4 — the rate she honours converts every price: money, hers.
    const s = await ownerOnly(req, reply, 'price_rules', '/app/settings/rate');
    if (!s) return reply;
    const locale = localeOf(req);
    const raw = (req.body as { rate?: string } | undefined)?.rate ?? null;
    const r = await setRate(deps.db, s.businessId, raw, new Date());
    return r.code === 'set'
      ? flashTo(reply, '/app/settings/rate', 'rate.flash.set', { rate: r.rate.rate })
      : flashTo(reply, '/app/settings/rate', `rate.flash.${r.code}` as MessageKey);
  });

  // M44 — the days her factory is shut. She states them; nothing is assumed.
  app.get('/app/settings/closures', authed('settings', async (sess, req, locale, reply) =>
    renderClosures(await loadClosures(deps.db, sess.businessId), locale,
      takeFlash(req, reply))));

  app.post('/app/settings/closures', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await addClosure(deps.db, s.businessId, {
      label: b['label'] ?? null, from: b['from'] ?? null, to: b['to'] ?? null,
    });
    return r.code === 'added'
      ? flashTo(reply, '/app/settings/closures', 'closures.flash.added', { label: r.label })
      : flashTo(reply, '/app/settings/closures', `closures.flash.${r.code}` as MessageKey);
  });

  app.post('/app/settings/closures/:id/remove', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const r = await removeClosure(deps.db, s.businessId, (req.params as { id: string }).id);
    return flashTo(reply, '/app/settings/closures', `closures.flash.${r.code}` as MessageKey);
  });

  // M46 — one order: what she recorded, the proforma, and the form that
  // records the next thing. Reached from the conversation it came out of.
  app.get('/app/orders/:id', authed('inbox', async (sess, req, locale, reply) => {
    const id = (req.params as { id: string }).id;
    const v = await loadOrder(deps.db, sess.businessId, id);
    if (!v) return `<h1 class="page">${esc(t(locale, 'order.notFound'))}</h1>`
      + `<div class="block"><a href="/app/inbox">${esc(t(locale, 'inbox.detail.back'))}</a></div>`;
    return renderOrder(v, locale, takeFlash(req, reply));
  }));

  app.post('/app/orders/:id/update', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await recordOrderUpdate(deps.db, s.businessId, id, {
      state: b['state'] ?? '', note: b['note'] ?? null, trackingReference: b['tracking'] ?? null,
      actor: personOf(s).id, now: new Date(),
    });
    return flashTo(reply, `/app/orders/${encodeURIComponent(id)}`, `order.flash.${r.code === 'recorded' ? 'recorded' : r.code}` as MessageKey);
  });

  // M47 — who works here. OWNER ONLY: handing someone a way in is hers — and
  // since G9a the page too, not only the form's POST.
  app.get('/app/settings/people', ownerPage('people', 'settings', '/app/settings', async (sess, req, reply, locale) => {
    // A code is shown ONCE: read from the cookie the POST set, and cleared in
    // the same response. Never in a URL, never stored.
    const cookie = parseCookies(req.headers.cookie)[ISSUED_COOKIE];
    const justIssued = readIssuedCode(deps.sessionSecret, cookie, Date.now());
    if (cookie !== undefined) writeCookie(reply, ISSUED_COOKIE, '', { path: ISSUED_PATH, maxAgeSec: 0 });
    return renderPeople({
      people: await loadPeople(deps.db, sess.businessId), justIssued,
      assistants: await loadAssistants(deps.db, sess.businessId),
    }, locale,
      takeFlash(req, reply));
  }));

  app.post('/app/settings/people', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const locale = localeOf(req);
    const name = String((req.body as { name?: string } | undefined)?.name ?? '');
    const r = await addPerson(deps.db, s.businessId, deps.sessionSecret, name);
    if (r.code !== 'added') {
      return flashTo(reply, '/app/settings/people', `people.flash.${r.code}` as MessageKey);
    }
    writeCookie(reply, ISSUED_COOKIE, mintIssuedCode(deps.sessionSecret, { name: r.name, code: r.accessCode }, Date.now()),
      { path: ISSUED_PATH, maxAgeSec: Math.floor(ISSUED_TTL_MS / 1000) });
    return flashTo(reply, '/app/settings/people', 'people.flash.added', { name: r.name });
  });

  // A5 — who answers buyers. Owner-only by the same rule as people: it is the team.
  const teamFlash = (reply: FastifyReply, key: MessageKey, params?: Record<string, string | number>) =>
    flashTo(reply, '/app/settings/people#assistants', key, params);

  app.post('/app/settings/people/assistants', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const r = await addAssistantFromForm(deps.db, s.businessId, (req.body ?? {}) as Record<string, unknown>, personOf(s).id);
    facts.evict(s.businessId);
    return teamFlash(reply, assistantFlash(r.outcome, 'added'), { who: r.name });
  });

  app.post('/app/settings/people/assistants/:id', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const outcome = await updateAssistantFromForm(deps.db, s.businessId, (req.params as { id: string }).id,
      (req.body ?? {}) as Record<string, unknown>, personOf(s).id);
    facts.evict(s.businessId);
    return teamFlash(reply, assistantFlash(outcome, 'saved'));
  });

  app.post('/app/settings/people/assistants/:id/archive', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const outcome = await archiveAssistantById(deps.db, s.businessId, (req.params as { id: string }).id, personOf(s).id);
    return teamFlash(reply, assistantFlash(outcome, 'archived'));
  });

  app.post('/app/settings/people/:id/remove', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'people', '/app/settings/people');
    if (!s) return reply;
    const locale = localeOf(req);
    const r = await removePerson(deps.db, s.businessId, (req.params as { id: string }).id);
    // S1 — signed out NOW, not within the minute the answer is remembered for.
    liveness.evict(livenessKey(s.businessId, (req.params as { id: string }).id));
    return flashTo(reply, '/app/settings/people', r.code === 'removed' ? 'people.flash.removed' : 'people.flash.failed');
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
      return flashTo(reply, '/app/channels', bid.ok ? 'domain.flash.invalid' : 'domain.flash.failed');
    }
    await withTenantTx(deps.db, bid.value, (tx) =>
      setSendingDomain(tx, bid.value, { domain, dkimSelector: selector, by: personOf(sess).name }));
    return flashTo(reply, '/app/channels', 'domain.flash.saved');
  });

  app.post('/app/channels/domain/check', async (req, reply) => {
    const sess = await ownerOnly(req, reply, 'outreach', '/app/channels');
    if (!sess) return reply;
    const locale = localeOf(req);
    const bid = parseBusinessId(sess.businessId);
    if (!bid.ok) {
      return flashTo(reply, '/app/channels', 'domain.flash.failed');
    }
    // The lookup is I/O and can fail; a failure returns empty lists, which read
    // as 'missing'. It is never allowed to read as "fine". The mechanism to
    // require is the host's, else the connected mailbox's own (C6); with neither
    // the check says it cannot confirm (`no_sender`). The same function the
    // sweep's clock uses, so her button and the clock cannot disagree.
    const check = await checkSendingDomainNow({
      db: deps.db, resolveDns: deps.resolveDns, sendingInclude: deps.sendingInclude ?? null,
    }, bid.value, new Date());
    if (!check) {
      return flashTo(reply, '/app/channels', 'domain.flash.failed');
    }
    return flashTo(reply, '/app/channels', 'domain.flash.checked');
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
      return flashTo(reply, '/app/channels', 'outreach.flash.failed');
    }
    const enabled = b['enabled'] === 'true';
    const done = await withTenantTx(deps.db, bid.value, (tx) =>
      setOutreach(tx, bid.value, { channel, enabled, by: personOf(sess).name }));
    return flashTo(reply, '/app/channels', !done ? 'outreach.flash.failed' : enabled ? 'outreach.flash.on' : 'outreach.flash.off');
  });

  /**
   * C4.a — the most first messages a day, on this channel. Owner-only for the
   * switch's own reason: the volume of mail that leaves in her name is her
   * decision about her name. Empty clears it back to the default, which the
   * form states as a number. Recorded as a new row carrying the switch as it
   * stands, so changing the number never changes whether writing first is on.
   */
  app.post('/app/channels/outreach/cap', async (req, reply) => {
    const sess = await ownerOnly(req, reply, 'outreach', '/app/channels');
    if (!sess) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const channel = OUTREACH_CHANNELS.find((c) => c === b['channel']);
    const bid = parseBusinessId(sess.businessId);
    const raw = typeof b['cap'] === 'string' ? b['cap'].trim() : '';
    const cap = raw === '' ? null : /^\d{1,5}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined;
    const failed = () => flashTo(reply, '/app/channels', 'outreach.flash.failed');
    if (!channel || !bid.ok || cap === undefined) return failed();
    const done = await withTenantTx(deps.db, bid.value, async (tx) => {
      const current = (await outreachSettings(tx, bid.value)).get(channel);
      return setOutreach(tx, bid.value, {
        channel, enabled: current?.enabled === true, by: personOf(sess).name, dailyCap: cap,
      });
    });
    if (!done) return failed();
    return flashTo(reply, '/app/channels', 'outreach.flash.cap', { n: String(cap ?? DAILY_OUTREACH_CEILING) });
  });

  /**
   * M38 — who she may write to. The list, and the two decisions about it.
   *
   * NOT owner-only: an attestation carries the name of whoever made it, and the
   * person who took the card is the person who knows. Suppressing is open in
   * the safe direction — more hands able to stop a send is never the risk.
   */
  /**
   * C6 · M50 — CONNECT HER MAILBOX, with a few clicks.
   *
   * OWNER ONLY, on the `outreach` action: this is the address mail leaves as,
   * in her name, to people who never wrote to her.
   *
   * THE CALLBACK IS TIED TO THE PERSON WHO STARTED IT. The start route puts a
   * signed, ten-minute cookie on this browser holding the PKCE verifier, a nonce
   * and her person id, scoped to `/app/connect`; the provider echoes the nonce in
   * `state`. A callback with no cookie, a stale one, another provider's, another
   * person's, or a mismatched nonce connects nothing — the shape of a login-CSRF
   * that would otherwise attach an attacker's mailbox to her factory.
   */
  const OAUTH_COOKIE = 'yf_oauth';
  const redirectUriFor = (provider: string) =>
    `${(deps.publicBaseUrl ?? '').replace(/\/$/, '')}/app/connect/${provider}/callback`;
  const channelsFlash = (reply: FastifyReply, key: string, vars?: Record<string, string>) =>
    flashTo(reply, '/app/channels', key as MessageKey, vars);

  app.get('/app/connect/:provider/start', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'outreach', '/app/channels'); if (!s) return reply;
    const locale = localeOf(req);
    const provider = OAUTH_PROVIDERS.find((p) => p === (req.params as { provider: string }).provider);
    const client = provider ? deps.oauthClients?.[provider] : undefined;
    if (!provider || !client || !deps.publicBaseUrl || !deps.credentialKey) {
      return channelsFlash(reply, 'connect.flash.not_configured');
    }
    const { verifier, challenge } = pkcePair();
    const nonce = randomBytes(24).toString('base64url');
    writeCookie(reply, OAUTH_COOKIE, mintOAuthState(deps.sessionSecret, { provider, verifier, nonce, personId: personOf(s).id }, Date.now()),
      { path: '/app/connect', maxAgeSec: 600 });
    // E1 — reading is asked for only when she ticked the box.
    const read = (req.query as { read?: string }).read === '1';
    return reply.redirect(authorizeUrl(provider, client, { redirectUri: redirectUriFor(provider), state: nonce, challenge, read }));
  });

  app.get('/app/connect/:provider/callback', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'outreach', '/app/channels'); if (!s) return reply;
    const locale = localeOf(req);
    const q = req.query as { code?: string; state?: string; error?: string };
    const cookie = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    // Used once, whatever happens next.
    writeCookie(reply, OAUTH_COOKIE, '', { path: '/app/connect', maxAgeSec: 0 });
    const provider = OAUTH_PROVIDERS.find((p) => p === (req.params as { provider: string }).provider);
    const state = readOAuthState(deps.sessionSecret, cookie, Date.now());
    if (!provider || !state || state.provider !== provider || state.personId !== personOf(s).id
        || typeof q.state !== 'string' || !sameNonce(q.state, state.nonce)) {
      return channelsFlash(reply, 'connect.flash.expired');
    }
    if (q.error || typeof q.code !== 'string' || !q.code) {
      return channelsFlash(reply, 'connect.flash.denied');
    }
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return channelsFlash(reply, 'connect.flash.rejected');
    const r = await completeMailConnection({
      db: deps.db, credentialKey: deps.credentialKey ?? null, clients: deps.oauthClients ?? {},
      fetchImpl: deps.oauthFetch ?? (fetch as unknown as OAuthFetch), now: () => new Date(),
    }, {
      businessId: bid.value, provider, code: q.code.slice(0, 2048), verifier: state.verifier,
      redirectUri: redirectUriFor(provider), by: personOf(s).name,
    });
    facts.evict(s.businessId);   // Phase 4b — a mailbox is a place buyers write: a setup step
    return r.outcome === 'connected'
      ? channelsFlash(reply, 'connect.flash.connected', { address: r.address ?? '' })
      : channelsFlash(reply, `connect.flash.${r.outcome}`);
  });

  app.post('/app/connect/mail/disconnect', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'outreach', '/app/channels'); if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    const done = bid.ok && await disconnectMailbox(deps.db, { businessId: bid.value, by: personOf(s).name });
    facts.evict(s.businessId);
    return channelsFlash(reply, done ? 'connect.flash.disconnected' : 'connect.flash.rejected');
  });

  /**
   * C10 — a business connects its OWN Page and Instagram through Meta's login.
   * Owner-only under the same decision as activating messaging: it decides
   * whose conversations land in this inbox, and as whom the replies leave.
   * The state cookie ties the callback to the person who pressed Connect;
   * when she manages several Pages, the user token she granted rides in that
   * state — encrypted — for the one round trip her choice takes.
   */
  const META_COOKIE = 'yf_meta';
  const metaRedirectUri = () => `${(deps.publicBaseUrl ?? '').replace(/\/$/, '')}/app/connect/meta/callback`;
  const metaReady = () => (deps.metaLogin && deps.publicBaseUrl && deps.credentialKey && deps.metaConnect) ? deps.metaConnect : null;
  const metaFlash = (reply: FastifyReply, r: MetaConnectOutcome): FastifyReply => {
    switch (r.outcome) {
      case 'connected': return channelsFlash(reply, r.instagram ? 'connect.meta.flash.connected' : 'connect.meta.flash.connectedNoIg', { page: r.page });
      case 'no_pages': case 'page_taken': case 'subscribe_failed': case 'unavailable':
        return channelsFlash(reply, `connect.meta.flash.${r.outcome}`);
      case 'not_configured': return channelsFlash(reply, 'connect.flash.not_configured');
      default: return channelsFlash(reply, 'connect.flash.rejected');
    }
  };

  app.get('/app/connect/meta/start', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels'); if (!s) return reply;
    const locale = localeOf(req);
    const mc = metaReady();
    if (!mc || !deps.metaLogin) return channelsFlash(reply, 'connect.flash.not_configured');
    const nonce = randomBytes(24).toString('base64url');
    writeCookie(reply, META_COOKIE,
      mintMetaState(deps.sessionSecret, { nonce, personId: personOf(s).id, tokenCiphertext: null }, Date.now()),
      { path: '/app/connect', maxAgeSec: 600 });
    return reply.redirect(metaDialogUrl(deps.metaLogin, { redirectUri: metaRedirectUri(), state: nonce, graphVersion: mc.graphVersion }));
  });

  app.get('/app/connect/meta/callback', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels'); if (!s) return reply;
    const locale = localeOf(req);
    const q = req.query as { code?: string; state?: string; error?: string };
    const cookie = parseCookies(req.headers.cookie)[META_COOKIE];
    // Used once, whatever happens next.
    writeCookie(reply, META_COOKIE, '', { path: '/app/connect', maxAgeSec: 0 });
    const state = readMetaState(deps.sessionSecret, cookie, Date.now());
    if (!state || state.personId !== personOf(s).id || typeof q.state !== 'string' || !sameMetaNonce(q.state, state.nonce)) {
      return channelsFlash(reply, 'connect.flash.expired');
    }
    if (q.error || typeof q.code !== 'string' || !q.code) return channelsFlash(reply, 'connect.flash.denied');
    const mc = metaReady();
    const bid = parseBusinessId(s.businessId);
    if (!mc || !bid.ok) return channelsFlash(reply, 'connect.flash.not_configured');
    const r = await completeMetaConnection(mc, {
      businessId: bid.value, by: personOf(s).name, redirectUri: metaRedirectUri(), code: q.code.slice(0, 2048),
    });
    if (r.outcome === 'choose') {
      const carried = mintMetaState(deps.sessionSecret,
        { nonce: state.nonce, personId: personOf(s).id, tokenCiphertext: r.tokenCiphertext }, Date.now());
      return reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'connect.meta.choose.title'), active: 'channels',
        bodyHtml: renderMetaPagePicker(r.pages, carried, locale),
      }));
    }
    return metaFlash(reply, r);
  });

  app.post('/app/connect/meta/choose', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels'); if (!s) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const state = readMetaState(deps.sessionSecret, typeof b['state'] === 'string' ? b['state'] : undefined, Date.now());
    if (!state || state.personId !== personOf(s).id || !state.tokenCiphertext) {
      return channelsFlash(reply, 'connect.flash.expired');
    }
    const mc = metaReady();
    const bid = parseBusinessId(s.businessId);
    if (!mc || !bid.ok) return channelsFlash(reply, 'connect.flash.not_configured');
    facts.evict(s.businessId);   // D — a Page connected is a setup step done
    const pageId = typeof b['page_id'] === 'string' ? b['page_id'].slice(0, 40) : '';
    const r = await completeMetaConnection(mc, {
      businessId: bid.value, by: personOf(s).name, redirectUri: metaRedirectUri(),
      userTokenCiphertext: state.tokenCiphertext, pageId,
    });
    return r.outcome === 'choose' ? channelsFlash(reply, 'connect.flash.rejected') : metaFlash(reply, r);
  });

  app.post('/app/connect/meta/disconnect', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'messaging_activation', '/app/channels'); if (!s) return reply;
    const mc = metaReady();
    const bid = parseBusinessId(s.businessId);
    const done = mc !== null && bid.ok && await disconnectMetaAccount(mc, { businessId: bid.value, by: personOf(s).name });
    facts.evict(s.businessId);
    return channelsFlash(reply, done ? 'connect.meta.flash.disconnected' : 'connect.flash.rejected');
  });

  /**
   * C5 — prospecting. The key is hers (owner-only, on the `outreach` action: it
   * is how she reaches people who never wrote first); searching, adding someone
   * and looking up a company are anyone's, with the name recorded — each costs a
   * credit only where its button says so.
   */
  const prospectDeps = (): ProspectDeps => ({
    db: deps.db, now: () => new Date(),
    credentialKey: deps.credentialKey ?? null, sourceFor: deps.prospectSourceFor ?? null,
  });

  app.get('/app/contacts', authed('contacts', async (sess, req, locale, reply) => {
    const view = await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none');
    const bid = parseBusinessId(sess.businessId);
    const pd = prospectDeps();
    const [companies, status] = bid.ok ? await Promise.all([
      enrichmentsFor(pd, bid.value, view.contacts.filter((c) => c.channel === 'email').map((c) => c.identity)),
      keyStatus(pd, bid.value),
    ]) : [new Map(), { kind: 'none' } as const];
    return renderContacts({
      ...view, companies,
      canLookUp: status.kind === 'stored' && status.readable && deps.prospectSourceFor !== undefined,
    }, locale, takeFlash(req, reply));
  }));

  app.post('/app/contacts/lookup', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return contactsBack(reply, 'failed');
    const r = await lookUpCompany(prospectDeps(), {
      businessId: bid.value, by: personOf(s).name,
      address: String((req.body as { identity?: unknown } | undefined)?.identity ?? ''),
    });
    return flashTo(reply, '/app/contacts',
      r === 'found' || r === 'not_found' || r === 'reused' || r === 'personal' || r === 'not_an_email'
        ? `contacts.lookup.flash.${r}` as MessageKey
        : failureKey(r));
  });

  app.get('/app/prospects', authed('prospects', async (sess, req, locale, reply) => {
    const bid = parseBusinessId(sess.businessId);
    if (!bid.ok) return '';
    const pd = prospectDeps();
    const status = await keyStatus(pd, bid.value);
    const filter = filterFromQuery(req.query as Record<string, unknown>);
    const outcome = filter && status.kind === 'stored' && status.readable
      ? await searchProspects(pd, { businessId: bid.value, filter }) : null;
    return renderProspects({ status, filter, outcome }, locale, takeFlash(req, reply), personOf(sess));
  }));

  const prospectsBack = (reply: FastifyReply, key: string, back = '') =>
    flashTo(reply, `/app/prospects${/^\?[A-Za-z0-9%&=._+-]*$/.test(back) ? back : ''}`, key as MessageKey);

  app.post('/app/prospects/key', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'outreach', '/app/prospects'); if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return prospectsBack(reply, 'prospects.flash.failed');
    const r = await saveKey(prospectDeps(), {
      businessId: bid.value, by: personOf(s).name,
      apiKey: String((req.body as { apiKey?: unknown } | undefined)?.apiKey ?? ''),
    });
    return prospectsBack(reply, r === 'saved' ? 'prospects.flash.saved'
      : r === 'invalid' ? 'prospects.flash.invalid' : 'prospects.noSource.no_key_store');
  });

  app.post('/app/prospects/key/remove', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'outreach', '/app/prospects'); if (!s) return reply;
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return prospectsBack(reply, 'prospects.flash.failed');
    const done = await removeKey(prospectDeps(), { businessId: bid.value, by: personOf(s).name });
    return prospectsBack(reply, done ? 'prospects.flash.removed' : 'prospects.flash.failed');
  });

  app.post('/app/prospects/add', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok || !str('sourceId') || !str('name')) return prospectsBack(reply, 'prospects.flash.failed');
    const r = await addProspect(prospectDeps(), {
      businessId: bid.value, by: personOf(s).name, sourceId: str('sourceId').slice(0, 64),
      name: str('name'), title: str('title') || null, organization: str('organization') || null,
    });
    const back = str('back');
    if (r === 'added' || r === 'exists' || r === 'not_found') {
      return prospectsBack(reply, `prospects.flash.${r}`, back);
    }
    return prospectsBack(reply, failureKey(r), back);
  });

  const contactsBack = (reply: FastifyReply, r: ContactsFlash) =>
    flashTo(reply, '/app/contacts', `contacts.flash.${r}` as MessageKey);

  app.post('/app/contacts', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return contactsBack(reply, await addContactFrom(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], name: b['name'], company: b['company'],
      by: personOf(s).name,
    }));
  });

  app.post('/app/contacts/consent', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return contactsBack(reply, await attestConsent(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], note: b['note'], by: personOf(s).name,
    }));
  });

  // Permanent, so it takes two presses. The row links here; this page posts.
  app.get('/app/contacts/suppress', authed('contacts', async (sess, req, locale, reply) => {
    const q = req.query as { channel?: string; identity?: string };
    const found = (await loadContacts(deps.db, sess.businessId)).contacts
      .find((c) => c.channel === q.channel && c.identity === q.identity);
    if (!found) return renderContacts(await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none'), locale, null);
    return renderSuppressConfirm(found, locale);
  }));

  app.post('/app/contacts/suppress', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const b = (req.body ?? {}) as Record<string, unknown>;
    return contactsBack(reply, await suppressIdentity(deps.db, s.businessId, {
      channel: b['channel'], identity: b['identity'], reason: b['reason'], detail: b['detail'],
    }));
  });

  /**
   * C4.a — she writes to someone who has not written to her.
   *
   * The page opens only for a buyer the gate has just said yes to — the same
   * `reachOf` the row's button was drawn from — so it never offers a send it
   * already knows will be refused. Anyone else lands back on the list, where his
   * row already says why.
   *
   * NOT owner-only, for M38's reason: the person who took the card is the person
   * who knows him, and the message carries the name of whoever sends it. What
   * IS owner-only is the switch that lets anyone write first at all.
   */
  app.get('/app/contacts/write', authed('contacts', async (sess, req, locale, reply) => {
    const q = req.query as { channel?: string; identity?: string };
    const view = await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none');
    const found = view.contacts.find((c) => c.channel === q.channel && c.identity === q.identity);
    if (!found || found.channel !== 'email') return renderContacts(view, locale, null);
    // Deployment mode has no outbound worker at all (src/main.ts): a row queued
    // here would sit until messaging is switched on and then leave, days after
    // she wrote it. Said now, before she types, rather than after.
    if (!messagingEnabled) return renderContacts(view, locale, saidFlash(locale, 'contacts.flash.notLive'));
    const reach = reachOf(view, found);
    if (!reach.ok) {
      return renderContacts(view, locale, saidFlash(locale, `refused.why.${reach.error}` as MessageKey));
    }
    return renderWriteFirst(found, locale);
  }));

  app.post('/app/contacts/write', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const bid = parseBusinessId(s.businessId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string): string => (typeof b[k] === 'string' ? b[k] as string : '');
    if (!bid.ok || b['channel'] !== 'email') return contactsBack(reply, 'failed');
    if (!messagingEnabled) {
      return flashTo(reply, '/app/contacts', 'contacts.flash.notLive');
    }

    const found = (await loadContacts(deps.db, s.businessId)).contacts
      .find((c) => c.channel === 'email' && c.identity === str('identity').trim().toLowerCase());
    const r = await writeFirst(
      {
        db: deps.db, now: () => new Date(),
        kickDrive: deps.kickDrive ?? (async () => {}),
        templateState: deps.templateState ?? 'none',
      },
      {
        businessId: bid.value, channel: 'email', identity: str('identity'),
        subject: str('subject').slice(0, 200), body: str('body').slice(0, 5000),
        actor: personOf(s).id, displayName: found?.displayName ?? null,
      },
    );

    if (r.outcome === 'queued' && r.conversationId) {
      return flashTo(reply, `/app/inbox/${encodeURIComponent(r.conversationId)}`, 'contacts.flash.queued');
    }
    // Her words come back to her when the fault is in the form, not in him.
    if (r.outcome === 'empty' && found) {
      return reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'nav.contacts'), active: 'contacts',
        bodyHtml: renderWriteFirst(found, locale, {
          draft: { subject: str('subject'), body: str('body') },
          flash: saidFlash(locale, 'contacts.flash.empty'),
        }),
      }));
    }
    return flashTo(reply, '/app/contacts',
      r.outcome === 'empty' || r.outcome === 'no_channel'
        || r.outcome === 'missing' || r.outcome === 'not_an_email' || r.outcome === 'not_a_phone'
        ? `contacts.flash.${r.outcome}` as MessageKey
        // The outreach gate's own refusal, in the words his row already uses.
        : `refused.why.${r.outcome}` as MessageKey);
  });

  /**
   * C4.b — a first e-mail and its follow-ups. See `./sequences.ts` for who may
   * do what: writing, adding someone and stopping are anyone's, with the name
   * recorded; approving and taking out of use are hers.
   */
  const seqBack = (reply: FastifyReply, id: string | null, f: SequenceFlash) =>
    flashTo(reply, `/app/sequences${id ? `/${encodeURIComponent(id)}` : ''}`, `seq.flash.${f}` as MessageKey);
  const seqId = (req: FastifyRequest) => (req.params as { id: string }).id;
  const sequenceDeps = () => ({
    db: deps.db, now: () => new Date(), templateState: deps.templateState ?? 'none',
    kickDrive: deps.kickDrive ?? (async () => {}),
    // Enrolling sends nothing; the sweep in src/main.ts is what decides this.
    repliesObservable: false,
  });

  app.get('/app/sequences', authed('sequences', async (sess, req, locale, reply) =>
    renderSequenceList(await loadSequenceList(deps.db, sess.businessId), locale, takeFlash(req, reply))));

  app.post('/app/sequences', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const r = await createSequenceFrom(deps.db, s.businessId, {
      name: (req.body as { name?: unknown } | undefined)?.name, by: personOf(s).name,
    });
    return seqBack(reply, r.id, r.flash);
  });

  app.get('/app/sequences/:id', authed('sequences', async (sess, req, locale, reply) => {
    const d = await loadSequenceDetail(deps.db, sess.businessId, seqId(req));
    if (!d) return renderSequenceList(await loadSequenceList(deps.db, sess.businessId), locale, null);
    // Who could be added right now: the SAME `reachOf` her contact list draws
    // its "write to them" button from, so the two pages cannot offer different
    // people. Only computed where adding is possible.
    const view = d.state === 'approved'
      ? await loadContacts(deps.db, sess.businessId, deps.templateState ?? 'none') : null;
    const eligible = view ? view.contacts.filter((c) => c.channel === 'email' && reachOf(view, c).ok) : [];
    return renderSequenceDetail(d, locale, takeFlash(req, reply), {
      viewer: personOf(sess), eligible, messagingEnabled,
    });
  }));

  app.post('/app/sequences/:id/steps', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const f = await addStepFrom(deps.db, s.businessId, seqId(req), (req.body ?? {}) as Record<string, unknown>);
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/sequences/:id/steps/:position', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const position = Number((req.params as { position: string }).position);
    const f = await updateStepFrom(deps.db, s.businessId, seqId(req), position, (req.body ?? {}) as Record<string, unknown>);
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/sequences/:id/approve', async (req, reply) => {
    const back = `/app/sequences/${encodeURIComponent(seqId(req))}`;
    const s = await ownerOnly(req, reply, 'outreach', back); if (!s) return reply;
    const f = await approveSequenceFrom(deps.db, s.businessId, seqId(req), {
      fingerprint: (req.body as { fingerprint?: unknown } | undefined)?.fingerprint, by: personOf(s).name,
    });
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/sequences/:id/archive', async (req, reply) => {
    const back = `/app/sequences/${encodeURIComponent(seqId(req))}`;
    const s = await ownerOnly(req, reply, 'outreach', back); if (!s) return reply;
    const f = await archiveSequenceById(deps.db, s.businessId, seqId(req));
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/sequences/:id/enroll', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const bid = parseBusinessId(s.businessId);
    if (!bid.ok) return seqBack(reply, seqId(req), 'failed');
    // Same reason as the write page: no outbound worker, no follow-ups.
    if (!messagingEnabled) return seqBack(reply, seqId(req), 'notLive');
    const r = await enroll(sequenceDeps(), {
      businessId: bid.value, sequenceId: seqId(req), by: personOf(s).name,
      identity: String((req.body as { identity?: unknown } | undefined)?.identity ?? ''),
    });
    return flashTo(reply, `/app/sequences/${encodeURIComponent(seqId(req))}`,
      r === 'enrolled' || r === 'already' || r === 'not_approved'
        ? `seq.flash.${r === 'not_approved' ? 'notApproved' : r}` as MessageKey
        : r === 'missing' || r === 'not_an_email' || r === 'not_a_phone'
          ? `contacts.flash.${r}` as MessageKey
          : `refused.why.${r}` as MessageKey);
  });

  // 0051 — a follow-up waiting for someone who has looked in her own inbox.
  app.post('/app/sequences/:id/enrollments/:eid/confirm', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const f = await confirmFollowUpById(deps.db, s.businessId, (req.params as { eid: string }).eid,
      (req.body as { position?: unknown } | undefined)?.position, personOf(s).name);
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/sequences/:id/enrollments/:eid/stop', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    const f = await stopEnrollmentById(deps.db, s.businessId, (req.params as { eid: string }).eid);
    return seqBack(reply, seqId(req), f);
  });

  app.post('/app/contacts/:id/archive', async (req, reply) => {
    const s = sessionOf(req); if (!s) return reply.redirect('/login');
    return contactsBack(reply,
      await archiveContactById(deps.db, s.businessId, (req.params as { id: string }).id));
  });

  // G6 — her terms on a proforma. Owner-only under the price-rules decision:
  // staff negotiate inside her commercial terms, they do not set them.
  app.get('/app/settings/terms', authed('settings', async (sess, req, locale, reply) =>
    renderTerms(await loadTerms(deps.db, sess.businessId), locale,
      takeFlash(req, reply), personOf(sess))));

  app.post('/app/settings/terms', async (req, reply) => {
    const s = await ownerOnly(req, reply, 'price_rules', '/app/settings/terms');
    if (!s) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await saveTerms(deps.db, s.businessId, {
      payment: b['payment'] ?? null, incoterm: b['incoterm'] ?? null,
      actor: personOf(s).id, now: new Date(),
    });
    return flashTo(reply, '/app/settings/terms', `terms.flash.${r.code}` as MessageKey);
  });

  // M45 — samples. Her two facts, and the buyers waiting on them.
  app.get('/app/settings/samples', authed('settings', async (sess, req, locale, reply) =>
    renderSamples(await loadSamples(deps.db, sess.businessId), locale,
      takeFlash(req, reply),
      new Date(), personOf(sess))));

  app.post('/app/settings/samples', async (req, reply) => {
    // Phase 4 — what a sample costs is a price. Recording an address or
    // marking one sent (below) stays the job of whoever handles it.
    const s = await ownerOnly(req, reply, 'price_rules', '/app/settings/samples');
    if (!s) return reply;
    const locale = localeOf(req);
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const r = await saveSamplePolicy(deps.db, s.businessId, {
      price: b['price'] ?? null, credited: b['credited'] === 'on', now: new Date(),
    });
    return flashTo(reply, '/app/settings/samples', `samples.flash.${r.code}` as MessageKey);
  });

  app.post('/app/settings/samples/:id/address', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const address = String((req.body as { address?: string } | undefined)?.address ?? '');
    const r = await saveSampleAddress(deps.db, s.businessId, (req.params as { id: string }).id, address);
    return flashTo(reply, '/app/settings/samples', r.code === 'saved' ? 'samples.flash.address' : 'samples.flash.failed');
  });

  app.post('/app/settings/samples/:id/handled', async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.redirect('/login');
    const locale = localeOf(req);
    const r = await markSampleHandled(deps.db, s.businessId, (req.params as { id: string }).id, personOf(s).id, new Date());
    return flashTo(reply, '/app/settings/samples', r.code === 'done' ? 'samples.flash.done' : 'samples.flash.failed');
  });

  app.post('/app/settings/forbidden/:id/remove', async (req, reply) => {
    const sess = sessionOf(req);
    if (!sess) return reply.redirect('/login');
    const locale = localeOf(req);
    const id = (req.params as { id: string }).id;
    const r = await removeForbidden(deps.db, sess.businessId, id);
    return flashTo(reply, '/app/settings/forbidden', `forbidden.flash.${r.code}` as MessageKey);
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
    const r = await saveBusinessProfile(deps.db, s.businessId, input, personOf(s).id);
    facts.evict(s.businessId);   // D — a complete profile is a setup step done
    if (r.code === 'saved') {
      return flashTo(reply, '/app/settings', 'settings.flash.profileSaved');
    }
    // M20.4 (F-07) — a rejected save re-RENDERS the owner's own submission with
    // the bad field marked. Redirecting would reload from the database and throw
    // away everything she typed, which is the M21 defect.
    const profile = await loadBusinessProfile(deps.db, s.businessId);
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'settings.profile.title'), active: 'settings',
      bodyHtml: renderSettings(profile, locale, saidFlash(locale, 'settings.flash.profileFix'), {
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
  app.get('/app/knowledge', authed('knowledge', async (s, req, locale, reply) => {
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
    const flash = takeFlash(req, reply);
    const prefill = typeof (req.query as { teach?: string }).teach === 'string' ? (req.query as { teach: string }).teach : '';
    return reply.type('text/html; charset=utf-8').send(page(req, {
      title: t(locale, 'nav.knowledge'), active: 'knowledge',
      bodyHtml: renderProductKnowledge(d, locale, flash, { usage, prefill, now: new Date() }),
    }));
  });

  // Teach/correct/archive/cert → redirect back to the product page (or the index
  // for business-level rows) with a localized flash. All owner-authenticated.
  const kBack = (reply: FastifyReply, _req: FastifyRequest, productId: string, code: KnowledgeFlash | 'invalid') =>
    (productId
      ? flashTo(reply, `/app/knowledge/${encodeURIComponent(productId)}`, `knowledge.flash.${code}` as MessageKey)
      : reply.redirect('/app/knowledge'));
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
      const q = req.query as { mode?: string; ask?: string };
      const flash = takeFlash(req, reply);
      const prefill = typeof q.ask === 'string' ? q.ask : '';
      // M20.4 (F-04) — the safety checks run IN MEMORY, so a factory provisioned
      // one minute ago can practise. Nothing here writes or sends.
      const practice = await runScriptedPractice();
      // The free-typing half still needs a practice conversation. If this
      // installation has none, say so — never render a picker that does nothing.
      const view = await loadSandboxView(sbxDeps).catch(() => null);
      return reply.type('text/html; charset=utf-8').send(page(req, {
        title: t(locale, 'nav.sandbox'), active: 'sandbox',
        bodyHtml: `<h1 class="page">${esc(t(locale, 'nav.sandbox'))}</h1>` + renderPractice(practice, locale) + (view
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
      const s = sessionOf(req);
      if (!s) return reply.redirect('/login');
      const b = (req.body ?? {}) as { draftId?: string; command?: string; edit?: string; mode?: string };
      const mode = modeOf(b.mode);
      const bid = parseBusinessId(deps.sandboxBusinessId!);
      if (bid.ok && b.draftId) {
        const rawReply = b.command === '改' ? `改：${b.edit ?? ''}` : (b.command ?? '');
        await applyOwnerCommand(
          { db: deps.db, now: () => new Date(), kickOutbound: sandboxOutboundSink(sbxDeps) },
          { businessId: bid.value, draftId: b.draftId, rawReply, decidedBy: personOf(s).id },
        );
      }
      return reply.redirect(`/app/sandbox?mode=${mode}`);
    });

    app.post('/app/sandbox/reset', async (req, reply) => {
      if (!sessionOf(req)) return reply.redirect('/login');
      await resetSandbox(sbxDeps);
      return flashTo(reply, '/app/sandbox', 'sandbox.reset.done');
    });

    // ── M16.3 sandbox human-control rehearsal ─────────────────────────────────
    // The SAME lifecycle as the inbox: takeOver / ownerReply / resumeAi on the
    // sandbox tenant. The owner reply goes through ownerReply (the one send path)
    // and is flushed to the transcript by the sandbox sink — never a real send.
    const sbxFlash = (reply: FastifyReply, outcome: string) =>
      flashTo(reply, '/app/sandbox', `takeover.flash.${outcome}` as MessageKey);
    const sbxAction = (path: string, run: (bid: import('../../core/types/ids.js').BusinessId, cid: string, req: FastifyRequest, actor: string) => Promise<{ outcome: string }>) =>
      app.post(path, async (req, reply) => {
        const s = sessionOf(req);
        if (!s) return reply.redirect('/login');
        const bid = parseBusinessId(deps.sandboxBusinessId!);
        const cid = await activeSandboxConversationId(sbxDeps);
        if (!bid.ok || !cid) return reply.redirect('/app/sandbox');
        const r = await run(bid.value, cid, req, personOf(s).id);
        return sbxFlash(reply, r.outcome);
      });
    sbxAction('/app/sandbox/takeover', (bid, cid, _req, actor) =>
      takeOver({ db: deps.db, now: () => new Date() }, { businessId: bid, conversationId: cid, actor }));
    sbxAction('/app/sandbox/reply', (bid, cid, req, actor) =>
      ownerReply(
        { db: deps.db, now: () => new Date(), kickDrive: (_b, c) => sandboxFlushOutbound(sbxDeps, c) },
        { businessId: bid, conversationId: cid, text: String((req.body as { text?: string } | undefined)?.text ?? ''), actor },
      ));
    sbxAction('/app/sandbox/resume', (bid, cid, _req, actor) =>
      resumeAi({ db: deps.db, now: () => new Date() }, { businessId: bid, conversationId: cid, actor }));
  }
}
