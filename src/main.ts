import type { PendingQuestion } from './core/types/conversation.js';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { startWorker } from './worker/main.js';
import { mediaPortsFor, type MediaPorts, type PostCaptionReader, type OwnMediaReader } from './worker/mediaPorts.js';
import { metaPostCaption } from './channels/meta/posts.js';
import { buildIngressApp } from './api/ingress.js';
import { registerWebApp } from './api/web/app.js';
import { parseSiteHosts, SITE_HOSTS_SHAPE } from './api/web/site.js';
import { anthropicPageTranscriber, anthropicDocumentReader, anthropicDraftTranslator, anthropicCatalogExtractor, anthropicPageFactsReader, anthropicAdvisorModel } from './llm/anthropic.js';
import { fallbackSwitchedOn, llmFallbackFrom, llmProviderFrom, requestExtrasFor } from './llm/provider.js';
import { aiProcessor, processorForLog, HOSTING } from './core/legal/processors.js';
import { readNewMail } from './channels/email/inboxReader.js';
import { businessesReadingInbox } from './db/mailAccounts.js';
import { SANDBOX_BUSINESS_ID } from './demo/sandbox.js';
import { signupModeFrom, signupCapFrom } from './core/owner/signup.js';
import { systemSmtpConfigFrom, systemMailer, mailboxSystemMailer, firstThatSends, type SystemMail } from './channels/email/systemMail.js'
import { httpsMailConfigFrom, httpsSystemMailer, cappedMail } from './channels/email/httpsMail.js';
import { botCheckConfigFrom, botCheckFrom, SIGNUP_GUARD, type BotCheck, type SignupGuard } from './api/web/botCheck.js';
import { stripeConfigFrom, stripeClient, type StripeClient } from './billing/stripe.js';
import { subscribeSweep, billingAlerts } from './pipeline/billing.js';
import { claimMailSend, mailCapsFrom } from './db/mailCaps.js';
import { latestBackupRun } from './db/backups.js';
import { readModelView, type ConfiguredModels, type ModelHealthView } from './db/modelChecks.js';
import { deployWatchSweep, readMainChain } from './pipeline/deployWatch.js';
import { backupFreshness } from './core/ops/backups.js';
import type { BackupWatchJob } from './queue/boss.js';;
import { liveBusinessIds } from './db/accounts.js';
import { deletionDueAlert } from './pipeline/deletionWatch.js';
import type { DeletionWatchJob } from './queue/boss.js';
import { META_SHAPE } from './core/channel/metaReadiness.js';
import { assertSafeRuntimeRole } from './db/runtimeIdentity.js';
import { assertSchemaCurrent } from './db/schemaVersion.js';
import { assertPilotTenant } from './db/pilotTenant.js';
import { templateState, parseApprovedTemplates } from './core/channel/templateReadiness.js';
import { resolveSendingRecords } from './outbound/dns.js';
import { refreshDomainCheckIfDue } from './outbound/domainCheck.js';
import { whatsappAdapter } from './channels/whatsapp/adapter.js';
import { emailAdapter } from './channels/email/adapter.js';
import type { MailTransport } from './channels/email/transport.js';
import { accountMailTransport } from './channels/email/accountTransport.js';
import { smtpMailTransport } from './channels/email/smtpTransport.js';
import { smtpConfigFrom } from './channels/email/smtp.js';
import { instagramAdapter } from './channels/instagram/adapter.js';
import { socialAppSecret, metaProfileLookup, metaProfilePhoto, type MetaFetch } from './channels/meta/messaging.js';
import { fetchFaces } from './worker/faces.js';
import { metaLoginFrom, metaAccountToken } from './channels/meta/connect.js';
import { liveMetaAccount, markMetaAccountNeedsAttention, type MetaAccount } from './db/metaAccounts.js';
import { messengerAdapter } from './channels/messenger/adapter.js';
import { gmailSender, graphSender } from './channels/email/senders.js';
import { oauthClientsFrom, type OAuthFetch } from './connectors/oauth.js';
import { mintUnsubscribe, unsubscribeHeaders } from './outbound/unsubscribe.js';
import { deriveKey, acceptRetiredKeys } from './security/credentials.js';
import { apolloSource } from './connectors/apollo.js';
import { OPTIONAL_RECIPIENTS, recipientNamed, unnamedRecipientProblems, type OptionalRecipient } from './core/legal/recipients.js';
import { metaAdapter, metaMediaFetcher, metaAudioFetcher } from './channels/whatsapp/meta.js';
import type { FetchLike } from './channels/whatsapp/client.js';
import { waLoginFrom } from './channels/whatsapp/embeddedSignup.js';
import { whatsAppAccountToken } from './channels/whatsapp/connect.js';
import { activeWhatsAppNumber, liveWhatsAppAccount, markWhatsAppNeedsAttention, type WhatsAppAccount } from './db/whatsappAccounts.js';
import { withTenantTx, lockConversation, createReadOnlyDb, type Db, type Tx } from './db/client.js';
import { advisorKeysFrom, sealAdvisor, openAdvisor } from './advisor/seal.js';
import { advisorMemory } from './advisor/memory.js';
import { documentStoresFrom } from './db/documents.js';
import { channelStore, ensureConversation, enqueueOutboundRow, knownClientName } from './db/channels.js';
import { driveConversationOutbound, type AdapterFor, type MailEnvelope, type MailHeadersFor } from './outbound/worker.js';
import { QUEUES, unscheduleRetired, enqueueInbound, inboundGroup, type NotifyJob, type InboundJob, type SequenceSweepJob, type EchoJob } from './queue/boss.js';
import { handleEcho, ECHO_SETTLE_SECONDS } from './pipeline/echo.js';
import { vapidFrom, type PushFetch } from './net/webPush.js';
import { metaReviewFrom } from './core/channel/metaReview.js';
import { runDueSteps } from './outbound/sequences.js';
import { webChatAdapter } from './channels/web_chat/adapter.js';
import { telegramFrom, type TelegramFetch } from './channels/telegram/adapter.js';
import { START_CODE, telegramRoute } from './db/telegram.js';
import type { ChannelEvent, InboundMessageEvent } from './channels/whatsapp/parse.js';
import { sendDueSurveys, surveyBusinessesDue } from './db/surveys.js';
import type { SurveySigned } from './core/conversation/survey.js';
import { deliverOwnerAlert, sendAlert, lateUrgentAlert } from './pipeline/notify.js';
import type { JobWithMetadata } from 'pg-boss';
import { parseBusinessId, type BusinessId } from './core/types/ids.js';
import type { Locale } from './core/owner/i18n/locale.js';
import type { ChannelAdapter } from './channels/contract.js';
import { practiceAdapter } from './channels/practice.js';
import { isPracticeCopy, expirePractice, expireWaitingDrafts, conversationExists, PRACTICE_CHANNEL } from './db/practice.js';
import type { PgBoss } from 'pg-boss';
import type { DeployWatchJob, ErrorSweepJob, MetaErrorWatchJob, PracticeExpiryJob } from './queue/boss.js';
import { metaErrorAlert } from './pipeline/metaErrorWatch.js';
import { signupDigestAlert } from './pipeline/signupDigest.js';
import { allowanceAlerts, spendBreakerAlert } from './pipeline/allowanceWatch.js';
import { demotionAlerts, spotCheckSweep } from './pipeline/supervision.js';
import { connectionDecisionAlerts } from './pipeline/approvalWatch.js';
import { META_ERROR_ALERT_EVERY_HOURS } from './core/ops/metaErrors.js';
import type { ReportError } from './core/ops/appErrors.js';
import { installCrashReporting } from './worker/appErrors.js';
import { startHeartbeat } from './worker/heartbeat.js';
import { requestLogger } from './api/requestLog.js';
import { loggableLine, loggableMessage } from './security/loggable.js';
import { mailUnmailedLedger } from './db/erasureMail.js';
import { billingHeld } from './db/billing.js';
import { claimMorningSummaries } from './db/morningSummary.js';
import { readEveryConnectedSystem } from './books/readIn.js';
import { publicPost } from './net/publicFetch.js';

/**
 * PRODUCTION ENTRYPOINT (audit C1). Composes existing components — worker,
 * ingress, channel store, outbound drive — into the one process `npm start`
 * runs. No business logic lives here; only wiring.
 *
 * Routes mounted: GET/POST /webhook/whatsapp + GET /health. Tenant identity
 * comes exclusively from the channel credential (phone_number_id) — never from
 * anything a caller supplies. The /shadow/turn server that once broke that rule
 * (it read business_id from the request body, safe only for the trusted n8n
 * caller) was never mounted, and was deleted with n8n in M28.
 */

/** ── Env: validate names and shapes; never print values ─────────────────── */

/** 'disabled' = deployment mode: full stack up, no messaging surface —
 * for hosting the service before provider onboarding completes. Unset
 * WHATSAPP_PROVIDER means 'disabled'; an unknown value is still an error. */
export type WhatsAppProvider = 'meta' | '360dialog' | 'disabled';

export type ProdConfig = {
  provider: WhatsAppProvider;
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  WEBHOOK_VERIFY_TOKEN: string;
  CREDENTIAL_KEY: string;
  /**
   * The address on the public privacy and deletion pages. `validateEnv` REQUIRES
   * it — those pages promise a way to write in — but the type leaves it optional
   * so a test that composes a config by hand is not forced to carry the whole
   * boot's checklist. The boot is where the rule lives; the type is not a rule.
   */
  LEGAL_CONTACT_EMAIL?: string;
  PORT: number;
  // 360dialog (present iff provider === '360dialog')
  D360_API_KEY?: string;
  D360_BASE_URL?: string;
  WEBHOOK_SECRET?: string;
  // Meta Cloud API (present iff provider === 'meta')
  META_WHATSAPP_ACCESS_TOKEN?: string;
  META_WHATSAPP_PHONE_NUMBER_ID?: string;
  META_WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_API_VERSION: string;
  // G2b — speech-to-text, the one media setting that is not the channel's own
  // credential. Optional in every mode: absent, voice notes are refused with
  // `audio_unheard` and the owner is told why.
  TRANSCRIBE_API_KEY?: string;
  TRANSCRIBE_BASE_URL?: string;
  /**
   * G11 — the address buyers reach this installation at, for the proof link a
   * quote carries. Optional in every mode: absent, no link is attached and the
   * owner is told why. https only — a proof link is forwarded to a stranger's
   * phone, and it must not be sent over anything a network can read.
   */
  PUBLIC_BASE_URL?: string;
  /**
   * Phase 5 — the hosts that are the public site (`nomidoes.com,
   * www.nomidoes.com`). Optional: absent, no host is the site and `/` is the
   * door everywhere, as before. Plain host names, comma-separated.
   */
  SITE_HOSTS?: string;
  /**
   * CC-10 — the uptime heartbeat's address (a Healthchecks.io check). Optional:
   * absent, nothing is pinged and the boot says so once. A secret-ish token —
   * whoever has it can mark the check up — so it is never logged.
   */
  HEALTH_PING_URL?: string;
  /**
   * The person who runs Nomi until the company exists (the owner's decision at the Phase 4 gate, 2026-10-14): named
   * on the legal pages as who "we" means, with the contact address. Optional: absent, the pages name nobody and the
   * boot says so. Kept out of the repository on purpose: it is a person's name.
   */
  OPERATOR_PERSON?: string;
};

type Shape = (v: string) => boolean;
const BASE_SHAPES: Record<string, Shape> = {
  DATABASE_URL: (v) => v.startsWith('postgres'),
  WEBHOOK_VERIFY_TOKEN: (v) => v.length >= 16,
  CREDENTIAL_KEY: (v) => /^[0-9a-f]{64}$/i.test(v),
};
/**
 * A MODEL TO CALL — one key or the other, and the boot says which is missing.
 *
 * `ANTHROPIC_API_KEY` was unconditionally required, so an installation that
 * had moved to another provider still had to keep a live Anthropic credential
 * set to start at all — a secret kept only to satisfy a check, which is the
 * kind of secret that leaks. Either is now enough, and neither is not.
 */
const ANTHROPIC_SHAPE: Shape = (v) => v.length >= 20;

/**
 * SOMEWHERE TO WRITE — the address on the privacy and deletion pages.
 *
 * Both pages tell a buyer to ask for their data, and `/data-deletion` is the
 * URL Meta requires. Unset, the contact block rendered NOTHING: a page that
 * says "ask us" and then offers no way to ask. It is a public promise with no
 * door, so the boot refuses rather than serving it.
 *
 * A plain address — no display name, no `mailto:` — because that is what the
 * page puts inside a `mailto:` link.
 */
const LEGAL_CONTACT_SHAPE: Shape = (v) => /^[A-Za-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
const D360_SHAPES: Record<string, Shape> = {
  D360_API_KEY: (v) => v.length >= 8,
  D360_BASE_URL: (v) => v.startsWith('https://'),
  WEBHOOK_SECRET: (v) => v.length >= 32,
};
// M17.2: the Meta shapes are defined ONCE in core, so this fail-closed boot
// check and the owner-facing readiness page can never disagree about what
// "correctly configured" means.
const META_SHAPES: Record<string, Shape> = {
  META_WHATSAPP_ACCESS_TOKEN: META_SHAPE.accessToken,
  META_WHATSAPP_PHONE_NUMBER_ID: META_SHAPE.phoneNumberId,
  META_WHATSAPP_BUSINESS_ACCOUNT_ID: META_SHAPE.businessAccountId,
  META_APP_SECRET: META_SHAPE.appSecret,
};
// G2b — checked only when set. Absent is a real state (she refuses voice notes
// and says why); malformed is not, and must fail at boot rather than at the
// first voice note a buyer sends.
const OPTIONAL_SHAPES: Record<string, Shape> = {
  TRANSCRIBE_API_KEY: (v) => v.length >= 20,
  TRANSCRIBE_BASE_URL: (v) => v.startsWith('https://'),
  // G11 — a host, not a path: '/p/<token>' is appended to it.
  PUBLIC_BASE_URL: (v) => /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v),
  // Phase 5 — host names only: no scheme, no port, no path.
  SITE_HOSTS: SITE_HOSTS_SHAPE,
  // CC-10 — https, a host AND a path: the path is the check's key, so a bare
  // host would ping nothing, and `/fail` is appended to it on a bad tick.
  HEALTH_PING_URL: (v) => /^https:\/\/[^\s/?#]+\/[^\s]+$/.test(v),
  // REKEY — the key CREDENTIAL_KEY replaced, only during a rotation: read with, never sealed with.
  CREDENTIAL_KEY_PREVIOUS: (v) => /^[0-9a-f]{64}$/i.test(v),
  // A person's name as written: letters (any script), spaces, the marks names carry; 2–80 characters.
  OPERATOR_PERSON: (v) => /^\p{L}[\p{L}\p{M} .'’-]{1,79}$/u.test(v.trim()),
};

export function validateEnv(env: Record<string, string | undefined>, recipients: readonly OptionalRecipient[] = OPTIONAL_RECIPIENTS):
  | { ok: true; cfg: ProdConfig }
  | { ok: false; problems: string[] } {
  // D18 — a service that would receive someone's data, switched on before the privacy page names it.
  const problems: string[] = [...unnamedRecipientProblems(env, recipients)];

  // Explicit provider choice; unset = deployment mode (no messaging).
  const provider = env['WHATSAPP_PROVIDER'] ?? 'disabled';
  if (provider !== 'meta' && provider !== '360dialog' && provider !== 'disabled') {
    problems.push(`WHATSAPP_PROVIDER: must be 'meta', '360dialog', or 'disabled'`);
  }
  const shapes: Record<string, Shape> = {
    ...BASE_SHAPES,
    ...(provider === '360dialog' ? D360_SHAPES : {}),
    ...(provider === 'meta' ? META_SHAPES : {}),
  };
  for (const [name, shape] of Object.entries(shapes)) {
    const v = env[name];
    if (!v) problems.push(`${name}: missing`);
    else if (v.includes('CHANGE_ME')) problems.push(`${name}: placeholder`);
    else if (!shape(v)) problems.push(`${name}: invalid shape`);
  }
  // The public legal pages must have a working address on them.
  const legalContact = env['LEGAL_CONTACT_EMAIL'];
  if (!legalContact) problems.push('LEGAL_CONTACT_EMAIL: missing (the privacy and data-deletion pages are public and must carry an address a customer can write to)');
  else if (!LEGAL_CONTACT_SHAPE(legalContact)) problems.push('LEGAL_CONTACT_EMAIL: invalid shape (a plain address, e.g. privacy@example.com — no display name, no mailto:)');

  // N6a — the model provider: Anthropic's key, or another provider's trio.
  const anthropicKey = env['ANTHROPIC_API_KEY'];
  const otherProvider = llmProviderFrom(env, '').name === 'custom';
  if (!otherProvider) {
    if (!anthropicKey) problems.push('ANTHROPIC_API_KEY: missing (or set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL for another provider)');
    else if (anthropicKey.includes('CHANGE_ME')) problems.push('ANTHROPIC_API_KEY: placeholder');
    else if (!ANTHROPIC_SHAPE(anthropicKey)) problems.push('ANTHROPIC_API_KEY: invalid shape');
  }
  const graphVersion = env['META_GRAPH_API_VERSION'] ?? 'v23.0';
  if (provider === 'meta' && !/^v\d+\.\d+$/.test(graphVersion)) {
    problems.push('META_GRAPH_API_VERSION: invalid shape');
  }
  // G2b — OPTIONAL, but checked when present: a malformed key would otherwise
  // boot green and refuse every voice note at the first one a buyer sends.
  for (const [name, shape] of Object.entries(OPTIONAL_SHAPES)) {
    const v = env[name];
    if (v === undefined || v === '') continue;
    if (v.includes('CHANGE_ME')) problems.push(`${name}: placeholder`);
    else if (!shape(v)) problems.push(`${name}: invalid shape`);
  }
  if (problems.length) return { ok: false, problems };

  const pick = (name: string): { [k: string]: string } | Record<string, never> =>
    env[name] !== undefined ? { [name]: env[name] } : {};
  return {
    ok: true,
    cfg: {
      provider: provider as WhatsAppProvider,
      DATABASE_URL: env['DATABASE_URL']!,
      ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY'] ?? '',
      WEBHOOK_VERIFY_TOKEN: env['WEBHOOK_VERIFY_TOKEN']!,
      LEGAL_CONTACT_EMAIL: env['LEGAL_CONTACT_EMAIL']!.trim(),
      CREDENTIAL_KEY: env['CREDENTIAL_KEY']!,
      PORT: Number(env['PORT']) || 8787,
      META_GRAPH_API_VERSION: graphVersion,
      ...pick('D360_API_KEY'), ...pick('D360_BASE_URL'), ...pick('WEBHOOK_SECRET'),
      ...pick('META_WHATSAPP_ACCESS_TOKEN'), ...pick('META_WHATSAPP_PHONE_NUMBER_ID'),
      ...pick('META_WHATSAPP_BUSINESS_ACCOUNT_ID'), ...pick('META_APP_SECRET'),
      ...(env['TRANSCRIBE_API_KEY'] ? pick('TRANSCRIBE_API_KEY') : {}),
      ...(env['TRANSCRIBE_BASE_URL'] ? pick('TRANSCRIBE_BASE_URL') : {}),
      ...(env['PUBLIC_BASE_URL'] ? pick('PUBLIC_BASE_URL') : {}),
      ...(env['SITE_HOSTS'] ? pick('SITE_HOSTS') : {}),
      ...(env['HEALTH_PING_URL'] ? pick('HEALTH_PING_URL') : {}),
      ...(env['OPERATOR_PERSON'] ? pick('OPERATOR_PERSON') : {}),
    },
  };
}

/** ── Internal application secrets: generated, never a stop condition ────── */

const GENERATED_SECRETS: readonly { name: string; bytes: number }[] = [
  { name: 'WEBHOOK_SECRET', bytes: 32 },
  { name: 'WEBHOOK_VERIFY_TOKEN', bytes: 16 },
  { name: 'CREDENTIAL_KEY', bytes: 32 },
];

/**
 * Generate any missing internal secret with crypto.randomBytes, persist it to
 * .env (append-only — an existing value is NEVER overwritten), and export it
 * to the current process. Values are never logged; callers get names only.
 *
 * ON EPHEMERAL HOSTS THIS IS A DATA-LOSS HAZARD, NOT A CONVENIENCE.
 *
 * .env does not survive a Railway deploy. An installation that never set these
 * in the HOST environment regenerates them on every boot, and the three
 * secrets fail very differently:
 *
 *   WEBHOOK_VERIFY_TOKEN  regenerating breaks provider registration — the
 *                         webhook stops verifying until it is re-registered.
 *
 *   CREDENTIAL_KEY        regenerating is unrecoverable. It is the AES-256-GCM
 *                         key for `channel_credentials` (src/security/credentials.ts),
 *                         so every stored WhatsApp credential becomes
 *                         permanently undecryptable — the ciphertext is still
 *                         there and nothing can read it again. It is ALSO the
 *                         seed for the web session secret (see `sessionSecret`
 *                         below), so every owner session is invalidated at the
 *                         same moment. The owner is logged out of a product
 *                         whose channel has just gone dark, and re-entering the
 *                         credentials is the only way back.
 *
 * validateEnv cannot catch any of this: generation runs first and always
 * succeeds, so by the time validation looks, the variable is present and
 * well-formed. Presence is not stability. That is what
 * `assertStableCredentialKey` below is for.
 *
 * Run locally once and paste the .env values into the host's environment.
 */
export function ensureGeneratedSecrets(envPath = '.env'): string[] {
  const generated: string[] = [];
  let toAppend = '';
  for (const { name, bytes } of GENERATED_SECRETS) {
    if (process.env[name]) continue;
    const value = randomBytes(bytes).toString('hex');
    process.env[name] = value;
    toAppend += `${name}=${value}\n`;
    generated.push(name);
  }
  if (toAppend) {
    appendFileSync(envPath, (existsSync(envPath) ? '' : '# generated secrets\n') + toAppend, { mode: 0o600 });
  }
  return generated;
}

/**
 * Boot gate — CREDENTIAL_KEY must be SUPPLIED, not generated.
 *
 * Joins runtimeIdentity, schemaVersion and pilotTenant as a refuse-to-serve
 * guard, with the same production/non-production asymmetry: production throws,
 * everywhere else warns, so a developer on a fresh checkout is never locked out
 * of their own machine.
 *
 * It runs EARLIER than the other three, before the database is even opened,
 * because unlike them it needs nothing but the result of secret generation —
 * and because every boot past this point with a fresh key is one that has
 * already orphaned the stored credentials.
 *
 * Stronger than M27's OWNER_ACCESS_CODE guard, deliberately. A regenerated
 * access code locks the owner out until someone reads a log line; a regenerated
 * CREDENTIAL_KEY destroys data that no log line can recover.
 */
export function assertStableCredentialKey(
  generatedNames: readonly string[],
  opts: { readonly production: boolean; readonly warn?: (msg: string) => void },
): void {
  if (!generatedNames.includes('CREDENTIAL_KEY')) return;

  const problem =
    'CREDENTIAL_KEY was generated at boot, not supplied by the environment.\n' +
    'It was written to .env, which does not survive a deploy on an ephemeral\n' +
    'host, so the next boot generates a different one. When that happens:\n' +
    '  - every stored WhatsApp credential in channel_credentials becomes\n' +
    '    permanently undecryptable (the ciphertext survives; the key does not)\n' +
    '  - every owner session is invalidated, because the web session secret is\n' +
    '    derived from this key\n' +
    'Set it in the HOST environment and redeploy. To keep the credentials that\n' +
    'are already stored, use the value currently in .env:\n' +
    '  grep ^CREDENTIAL_KEY= .env\n' +
    'If .env is gone, the stored credentials are unrecoverable and the channel\n' +
    'must be re-authorised — see docs/SECRET-ROTATION.md.';

  if (opts.production) throw new Error(problem);
  (opts.warn ?? ((m: string) => console.warn(m)))(
    `WARNING (not enforced outside production):\n${problem}`,
  );
}

/** Minimal .env loader (no dependency; Railway injects env directly). */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? '';
  }
}

/** ── Composition ────────────────────────────────────────────────────────── */

export type Production = {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly boss: PgBoss;
  readonly ownerAccessCode: string;
  readonly ownerAccessCodeGenerated: boolean;
  /** The channels with a webhook mounted here — empty in deployment mode. */
  readonly channels: readonly string[];
  /** CC-10 — the process's error recorder; the CLI hands it the process's own crashes. */
  readonly reportError: ReportError;
  /** 0165 — the provider and model this deployment is configured for: what /health and the heartbeat ask about. */
  readonly primaryModel: ConfiguredModels;
  close(): Promise<void>;
};

/**
 * PILOT_BUSINESS_ID's default: the demo's business, which exists only in a
 * seeded development database (M23 — production refuses to boot on it).
 */
const DEMO_PILOT_BUSINESS_ID = 'de300000-0000-4000-8000-0000000000b1';

/**
 * CH7 — the caption of the shop's own post, with the token a customer's name
 * is looked up with: the workspace's OWN Page token when it connected one, the
 * installation's otherwise (only the pilot's accounts route there). A token
 * that needs attention reads nothing.
 */
function postCaptionReader(cfg: {
  readonly credentialKey: Buffer;
  readonly envToken: string | null;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch | undefined;
}): PostCaptionReader {
  return async ({ db, businessId, postId }) => {
    try {
      const account = await withTenantTx(db, businessId, (tx) => liveMetaAccount(tx, businessId));
      const token = account ? (account.needsAttention ? null : metaAccountToken(account, cfg.credentialKey)) : cfg.envToken;
      if (!token) return null;
      return await metaPostCaption({ accessToken: token, graphVersion: cfg.graphVersion, fetchImpl: cfg.fetchImpl })(postId);
    } catch {
      return null;
    }
  };
}

/**
 * WA — a business's own WhatsApp number fetches its own photos and voice
 * notes, with its own token. Null when it has none, or the token needs
 * attention: the installation's fetchers serve, as before.
 */
function ownMediaReader(cfg: {
  readonly credentialKey: Buffer; readonly appSecret: string; readonly graphVersion: string;
  readonly fetchImpl?: FetchLike | undefined;
}): OwnMediaReader {
  return async ({ db, businessId }) => {
    try {
      const account = await withTenantTx(db, businessId, (tx) => liveWhatsAppAccount(tx, businessId));
      if (!account || account.needsAttention) return null;
      const token = whatsAppAccountToken(account, cfg.credentialKey);
      if (!token) return null;
      const c = {
        accessToken: token, phoneNumberId: account.phoneNumberId, appSecret: cfg.appSecret, graphVersion: cfg.graphVersion,
        ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
      };
      return { image: metaMediaFetcher(c), audio: metaAudioFetcher(c) };
    } catch {
      return null;
    }
  };
}

export async function buildProduction(
  cfg: ProdConfig,
  overrides?: {
    adapter?: ChannelAdapter;
    logger?: boolean;
    /** A3 — tests read the code out of what would have been mailed. */
    systemMail?: SystemMail;
    /** BOT — tests only: a check that answers without calling a provider. */
    botCheck?: BotCheck;
    /**
     * BOT — tests only: the database's limits on the door. Absent is
     * production's (SIGNUP_GUARD); null, none — for a file that signs many
     * workspaces up from one address within the hour. The limits themselves
     * are held by tests/integration/bot-check.test.ts, on production's.
     */
    signupGuard?: SignupGuard | null;
    /** BILL — tests only: Stripe's client with the network a recorder, and its webhook secret. */
    stripe?: { readonly client: StripeClient; readonly webhookSecret: string };
    /**
     * G2b — the transcriber and media fetchers, beside `adapter` and for the
     * same reason: a test that swaps the provider must also swap where media
     * comes from, or a simulated voice note would be fetched from Meta.
     */
    media?: MediaPorts;
    /** G2b — model ports, tests only; production builds them from the key. */
    models?: Parameters<typeof startWorker>[2];
    /**
     * S6 — tests only: survey sentences as if a reader had signed them. Production never passes it: a sentence is
     * signed in src/core/conversation/survey.ts, by name, in the commit that names the reader.
     */
    surveySigned?: SurveySigned;
    /** S7 — tests only: Telegram's Bot API, instead of the network. */
    telegramFetch?: TelegramFetch;
    /** CH3 — tests only: how long an echo waits before it is read (production: ECHO_SETTLE_SECONDS). */
    echoSettleSeconds?: number;
    /** G5b — tests only: the push service, instead of the network. */
    pushFetch?: PushFetch;
    /** G10 — tests only: the translator, instead of the model. */
    draftTranslator?: import('./llm/ports.js').DraftTranslator;
    /** The advisor batch — tests only: the advisor's model, instead of the provider. */
    advisorModel?: import('./llm/ports.js').AdvisorModel;
    /**
     * The pre-pilot walkthrough only: as if the AI disclosure had passed native
     * review. Production never passes it — there is no environment variable
     * for this, on purpose: an escape hatch on this gate would be typed at
     * 2 a.m. from a terminal history.
     */
    autonomyReleased?: () => boolean;
    /**
     * C4.a — the mail transport, tests only. Absent is production's own
     * (C6): `accountMailTransport`, bound to each job's business, sending
     * through the mailbox she connected and refusing when there is none. A test
     * passes the recording fake so it can assert the subject, the recipient
     * and the unsubscribe headers rather than only that something was called.
     */
    mailTransport?: MailTransport;
    /**
     * The fetch the Instagram and Messenger adapters call Meta with — tests
     * only, so a name lookup or a send never leaves the process. Production
     * uses the platform fetch.
     */
    metaFetch?: MetaFetch;
    /** WA — Meta's WhatsApp API as a test sees it: a business's own number sends and fetches through this. */
    whatsappFetch?: FetchLike;
  },
): Promise<Production> {
  // Worker first: it owns the pool and pg-boss; ingress reuses both.
  // G2b — and it is handed the ports it needs to hear and see. Before this
  // call carried them, both paths were dead in production however the host
  // was configured.
  // G13 — ONE set of media ports for this process: the worker hears with them
  // and the Command Center plays back through the same fetcher. Built once, so
  // a test that injects its own cannot end up with the web app using another.
  const mediaPorts: MediaPorts = {
    // CH7 — the shop's own post, read with its own Page token: before the
    // given ports, so a test's own media ports still have it, and a test's
    // own `postCaption` wins.
    postCaption: postCaptionReader({
      credentialKey: deriveKey(cfg.CREDENTIAL_KEY),
      envToken: process.env['META_PAGE_ACCESS_TOKEN']?.trim() || null,
      graphVersion: cfg.META_GRAPH_API_VERSION,
      fetchImpl: overrides?.metaFetch,
    }),
    // WA — a business's own number fetches its own media.
    ownMedia: ownMediaReader({
      credentialKey: deriveKey(cfg.CREDENTIAL_KEY), appSecret: cfg.META_APP_SECRET ?? '',
      graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: overrides?.whatsappFetch,
    }),
    ...(overrides?.media ?? mediaPortsFor(cfg)),
  };
  // REKEY — a rotation in progress: tokens sealed with the key this one
  // replaced are still opened (never sealed) until tools/rekey.mjs re-seals them.
  const retired = process.env['CREDENTIAL_KEY_PREVIOUS'];
  acceptRetiredKeys(retired ? [deriveKey(retired)] : []);
  if (retired) console.log('CREDENTIAL_KEY_PREVIOUS is set: tokens sealed with the old key are still opened until tools/rekey.mjs re-seals them. Remove it afterwards (docs/SECRET-ROTATION.md).');
  const { db, boss, errors, watch, health, modelClient, primaryModel } = await startWorker({
    DATABASE_URL: cfg.DATABASE_URL, ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
    // G11 — the worker mints the proof link a quote carries, so it needs the
    // address as much as the web app does.
    ...(cfg.PUBLIC_BASE_URL ? { PUBLIC_BASE_URL: cfg.PUBLIC_BASE_URL } : {}),
    // CC-10 — whoever runs this installation hears of its errors.
    PILOT_BUSINESS_ID: process.env['PILOT_BUSINESS_ID'] ?? DEMO_PILOT_BUSINESS_ID,
  }, mediaPorts, overrides?.models ?? {},
    overrides?.autonomyReleased ? { autonomyReleased: overrides.autonomyReleased } : {});

  // M19 (B0) — refuse to serve if the RUNTIME connection is not subject to
  // tenant isolation. Every RLS policy targets nomi_app; a superuser or
  // BYPASSRLS connection ignores row security while /health still reports
  // green. In production this throws; elsewhere it warns, so migrations, seeds
  // and tests (which connect as the admin role on purpose) are unaffected.
  await assertSafeRuntimeRole(db, { production: process.env['NODE_ENV'] === 'production' });

  // Release hardening — refuse to serve on a STALE schema. `select 1` succeeds
  // on the old schema, so a version gap used to deploy green and only surface
  // when the send path touched a column that was not there yet. Ahead is fine
  // (migrations are additive, ADR-0007) — that is what keeps rollback safe.
  await assertSchemaCurrent(db, { production: process.env['NODE_ENV'] === 'production' });

  // M23 — WHOSE factory is this? PILOT_BUSINESS_ID decides which business every
  // owner surface reads, and it defaults to the DEMO id, which exists only in a
  // seeded development database. On live production the sole business was the
  // practice sandbox, so the owner was going to land on an absent tenant (loud:
  // the first product dies on a foreign key) or inside the sandbox itself
  // (silent: it all works, into the space whose reset archives conversations).
  // Neither shows on /health. Refuse, as with role and schema.
  const PILOT_BUSINESS_ID = process.env['PILOT_BUSINESS_ID'] ?? DEMO_PILOT_BUSINESS_ID;
  const SANDBOX_ID = process.env['SANDBOX_BUSINESS_ID'] ?? SANDBOX_BUSINESS_ID;
  await assertPilotTenant(db, {
    pilotBusinessId: PILOT_BUSINESS_ID,
    sandboxBusinessId: SANDBOX_ID,
    production: process.env['NODE_ENV'] === 'production',
  });

  /**
   * 0128 — BILLING RESILIENCE: the model provider's account, in both modes
   * (Practice runs turns in deployment mode too). Every five minutes: while it
   * refuses for billing, one small call asks whether it answers again, the
   * operator's escalating alert goes when due, and the end is told. Every hour,
   * where the provider has a balance to read (DeepSeek): the low-balance steps.
   * Each run is a few rows read when nothing is wrong (src/pipeline/providerWatch.ts).
   */
  await boss.schedule(QUEUES.provider, '*/5 * * * *', {});
  // 0165 — and every five minutes, the smallest real call to the model, timed: what /health says (modelHealth.ts).
  await boss.work(QUEUES.provider, async () => { await health.check(); await watch.sweep(); });
  void health.check();   // once at boot, so /health is not "unknown" for the first five minutes
  await boss.schedule(QUEUES.providerBalance, '25 * * * *', {});
  await boss.work(QUEUES.providerBalance, async () => { await watch.balanceSweep(); });

  // /health is the one route both modes share. providerStatus reports the
  // messaging surface; db is probed live; the worker infra is up in both modes.
  //
  // 0128 / 0165 — and `model` says what the last REAL call to the model provider
  // said (src/pipeline/modelHealth.ts: a check every five minutes, and every
  // call the app makes): 'answering', 'slow', 'not_answering' (with
  // `model_reason`), 'refusing' while it refuses for billing, 'unknown' when
  // nothing checked in the last twelve minutes. It said 'answering' through a
  // whole day on which every call timed out (2026-10-15). Still a 200:
  // the app serves, the owner answers by hand, and Railway reads /health only
  // to let a deploy go live ("Railway does not monitor the healthcheck endpoint
  // after the deployment has gone live", docs.railway.com/reference/healthchecks)
  // — a 503 here would block the very deploy that might fix it. The heartbeat
  // reads this field and pings its /fail (src/worker/heartbeat.ts).
  const mountHealth = (a: FastifyInstance, providerStatus: 'active' | 'disabled') => {
    a.get('/health', async (_req, reply) => {
      let dbOk = false;
      try { await sql`select 1`.execute(db); dbOk = true; } catch { /* → 503 */ }
      // 0165 — what the last real call said: answering, slow, not answering (with why), refusing for billing, or
      // unknown when nothing has checked lately. Never "answering" without a call that answered.
      let view: ModelHealthView = { model: 'unknown', ms: null, checkedAt: null, reason: null, fallback: 'off', fallbackOn: false, serving: 'none' };
      if (dbOk) {
        try { view = await readModelView(db, primaryModel); } catch { /* unknown */ }
      }
      return reply.code(dbOk ? 200 : 503).send({
        ok: dbOk, db: dbOk, worker: true, provider: providerStatus, model: view.model,
        model_ms: view.ms, model_checked_at: view.checkedAt?.toISOString() ?? null,
        ...(view.reason ? { model_reason: view.reason } : {}),
        // 0166 — the fallback's own word ('off': none configured), whether failing over is on, and who writes now.
        fallback: view.fallback, fallback_on: view.fallbackOn, serving: view.serving,
      });
    });
  };

  // M9 Command Center: owner-facing web control surface over the existing
  // engine, behind owner login. Mounted in both modes so the owner can manage
  // products/employee/etc. even before messaging is live.
  // Owner login: explicit OWNER_ACCESS_CODE, else generated (logged once by
  // the CLI so the founder can grab it; set it in the host for stability).
  const ownerAccessCode = process.env['OWNER_ACCESS_CODE'] || randomBytes(4).toString('hex');
  // M25 — the installation's REAL template capability, resolved once. A template
  // is approved by Meta, not by us, and we must not call Meta to find out — so
  // the operator records it beside the credentials. Empty (the state today) =
  // 'none', which keeps an out-of-window message with the owner.
  // One derivation of the web session secret: the Command Center signs its
  // cookies with it and C4.a's unsubscribe tokens are keyed from it, and two
  // copies of that line would be two secrets the day one of them is edited.
  /**
   * Her own mail server, when the host configured one. It TAKES PRECEDENCE over
   * a connected mailbox: an operator who set SMTP_* said which server this
   * installation sends through, and silently preferring a mailbox somebody
   * connected months ago would send her mail from an address she did not choose
   * today. Unset, this is null and the mailbox path (C6) is what runs.
   */
  const smtpConfig = smtpConfigFrom(process.env);
  // A3 — mail from the INSTALLATION (sign-in codes), never a business's outreach.
  const systemSmtp = systemSmtpConfigFrom(process.env);
  // The operator's connected mailbox first (HTTPS — works where the host blocks
  // SMTP, as Railway's Hobby plan does), then SMTP. Only the mailbox the
  // operator NAMED as SYSTEM_SMTP_USER, and only in the operator's own workspace.
  const systemMail: SystemMail | null = overrides?.systemMail ?? (systemSmtp ? firstThatSends([
    { name: 'mailbox', mailer: mailboxSystemMailer(systemSmtp.from, () => systemMailboxTransport()) },
    { name: 'smtp', mailer: systemMailer(systemSmtp) },
  ]) : null);
  /**
   * MAIL (decision 36) — the mail strangers cause (sign-in codes, reset links,
   * owner alerts) leaves through a dedicated HTTPS sender when the operator set
   * one, under daily caps per address and for the installation (0112); the
   * operator's own mailbox then carries operator mail only. Unset, both go as
   * before, through `systemMail` — capped all the same. A test's own sender
   * (`overrides.systemMail`) is used as given.
   */
  const dedicatedMail = (() => { const c = httpsMailConfigFrom(process.env); return c ? httpsSystemMailer(c) : null; })();
  const mailCaps = mailCapsFrom(process.env);
  const strangerMail = overrides?.systemMail ? null : (dedicatedMail ?? systemMail);
  const codeMail: SystemMail | null = overrides?.systemMail
    ?? (strangerMail ? cappedMail(strangerMail, (to) => claimMailSend(db, 'code', to, mailCaps.code)) : null);
  const alertMail: SystemMail | null = overrides?.systemMail
    ?? (strangerMail ? cappedMail(strangerMail, (to) => claimMailSend(db, 'alert', to, mailCaps.alert)) : null);
  /**
   * BOT (decision 36) — a bot check before any sign-up code is sent, from three
   * variables or none. Without one, open sign-up reads as invite (in the app,
   * on every request, whichever switch asked for open); the boot says so.
   */
  const botCheck = overrides?.botCheck ?? (() => { const c = botCheckConfigFrom(process.env); return c ? botCheckFrom(c) : null; })();
  /**
   * BILL (0117) — Stripe, from STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, both
   * or none. Unset (today): Billing says payments are not set up, no card is
   * taken, nothing is charged, and nobody is held for it.
   */
  const stripe = overrides?.stripe ?? (() => {
    const c = stripeConfigFrom(process.env);
    return c ? { client: stripeClient(c), webhookSecret: c.webhookSecret } : null;
  })();
  if (!botCheck && signupModeFrom(process.env['SIGNUP_MODE']) === 'open') {
    console.warn('SIGNUP_MODE=open needs a bot check (BOT_CHECK_PROVIDER, BOT_CHECK_SITE_KEY, BOT_CHECK_SECRET): until one is set, sign-up reads as invite.');
  }
  /**
   * C9 — Instagram and Messenger, when this installation has a Page.
   *
   * Both ride the Meta app that WhatsApp already uses: the same app secret
   * signs their webhooks, and one Page access token authorises the Page and the
   * Instagram account connected to it. Absent, they are simply not built, and
   * the channels page says they are not connected — the same honest absence as
   * a missing mail app.
   */
  const pageToken = process.env['META_PAGE_ACCESS_TOKEN']?.trim();
  const pageId = process.env['META_PAGE_ID']?.trim();
  const igAccountId = process.env['META_IG_ACCOUNT_ID']?.trim();
  // These two may live in their own Meta app, which signs with its own secret.
  const socialSecret = socialAppSecret(process.env, cfg.META_APP_SECRET);
  const metaMessaging = socialSecret && pageToken
    ? {
      ...(pageId ? {
        messenger: messengerAdapter({
          accountId: pageId, accessToken: pageToken,
          appSecret: socialSecret, graphVersion: cfg.META_GRAPH_API_VERSION,
          ...(overrides?.metaFetch ? { fetchImpl: overrides.metaFetch } : {}),
        }),
      } : {}),
      // Instagram replies leave through the Page, so the Page id is needed too.
      ...(igAccountId && pageId ? {
        instagram: instagramAdapter({
          pageId, accessToken: pageToken,
          appSecret: socialSecret, graphVersion: cfg.META_GRAPH_API_VERSION,
          ...(overrides?.metaFetch ? { fetchImpl: overrides.metaFetch } : {}),
        }),
      } : {}),
    }
    : {};

  /**
   * What this installation can carry. WhatsApp is here when a provider is
   * selected (or a test injected one); Instagram and Messenger when the host
   * configured the Page. Deployment mode is the case where this is EMPTY — and
   * only that case. Until 2026-09-17 it was "no WhatsApp provider", which
   * silently swallowed the two channels a factory can have while Meta still
   * withholds its number: the Page token was set, the routes were never
   * mounted, and Meta's verification failed against a 404.
   */
  /**
   * C10 — the login a business connects its OWN Page with: the social app's id
   * and a login configuration, beside the secret that already signs webhooks.
   * With it, the two webhook routes are mounted for the app secret alone — a
   * Page connected through the dialog must be able to deliver before any
   * account is in the environment. The environment's account, when set, stays
   * the answer for a business that connected nothing: this one, today.
   */
  const metaLogin = metaLoginFrom(process.env, socialSecret);
  // WA — Embedded Signup, through the WhatsApp app (its secret signs /webhook/whatsapp).
  const waLogin = waLoginFrom(process.env, cfg.META_APP_SECRET);
  const metaFetch: MetaFetch = overrides?.metaFetch ?? (fetch as unknown as MetaFetch);
  const socialIngress: Partial<Record<'instagram' | 'messenger', ChannelAdapter>> =
    socialSecret && (metaLogin !== null || Object.keys(metaMessaging).length > 0)
      ? {
        // With no account in the environment these verify and parse only: a
        // send through them would be refused by Meta, and nothing routes a
        // send here — `adaptersFor` answers with the business's own account.
        instagram: metaMessaging.instagram ?? instagramAdapter({
          pageId: '', accessToken: '', appSecret: socialSecret, graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: metaFetch,
        }),
        messenger: metaMessaging.messenger ?? messengerAdapter({
          accountId: '', accessToken: '', appSecret: socialSecret, graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: metaFetch,
        }),
      }
      : {};

  /**
   * S7 — Telegram: Nomi's one bot for every business (the owner's choice, 2026-10-22), from the environment, and only
   * while the privacy page names Telegram (D18). A business turns it on and shares its own start link.
   */
  const telegramBot = recipientNamed('telegram') ? telegramFrom(process.env, overrides?.telegramFetch) : null;

  const whatsappHere = overrides?.adapter !== undefined || cfg.provider !== 'disabled';
  const channelsHere: readonly string[] = [
    ...(whatsappHere ? ['whatsapp'] : []),
    ...Object.keys(socialIngress),
    ...(telegramBot ? ['telegram'] : []),
  ];

  const webSessionSecret = createHmac('sha256', cfg.CREDENTIAL_KEY).update('yf-web-session').digest('hex');
  /**
   * C6 — this installation's own OAuth apps. Each provider needs BOTH its id and
   * its secret; half a pair is not configured, and says so at boot rather than
   * sending her to a provider page that will refuse the app.
   */
  const oauthClients = oauthClientsFrom(process.env);
  /**
   * PWR2 — what a mailbox send needs, made HERE, before the deployment-mode
   * return below. They were made after it, so an installation with no messaging
   * channel yet answered every system mail's mailbox try with "Cannot access
   * 'credentialKey' before initialization": sign-in codes and reset links could
   * leave only by SMTP, which the host blocks. Found by
   * tests/integration/password-reset-mailbox.test.ts.
   */
  const credentialKey = deriveKey(cfg.CREDENTIAL_KEY);
  const oauthFetch = fetch as unknown as OAuthFetch;
  const tokenCache = new Map<string, { token: string; until: number }>();
  const mailSenders = { google: gmailSender(oauthFetch), microsoft: graphSender(oauthFetch) };

  const TEMPLATE_STATE = templateState({
    providerConfigured: cfg.provider !== 'disabled',
    approvedTemplates: parseApprovedTemplates(process.env['META_TEMPLATE_NAMES']),
  });
  // N6a — one provider for every model-backed part of this process.
  const llm = llmProviderFrom(process.env, cfg.ANTHROPIC_API_KEY);
  if (llm.name === 'custom') console.log(`Model provider: ${new URL(llm.baseURL!).host} · ${llm.model}`);
  // The privacy page names this company. Derived here, from the same provider
  // the model client is built from, so the two can never disagree again.
  // 0166 — and the fallback, while failing over to it is switched on: a reply may be drafted there.
  const fallbackLlm = llmFallbackFrom(process.env);
  const legalFacts = {
    processor: aiProcessor(llm.baseURL), hosting: HOSTING,
    ...(fallbackSwitchedOn(process.env, fallbackLlm) && fallbackLlm ? { fallback: aiProcessor(fallbackLlm.baseURL) } : {}),
    // S7 — Telegram, while Nomi's bot is on here (named whenever it is: recipients.ts).
    ...((process.env['TELEGRAM_BOT_TOKEN'] ?? '').trim() ? { telegram: true } : {}),
  };
  console.log(`Privacy page names: ${processorForLog(legalFacts.processor)} · hosted on ${processorForLog(HOSTING)}`);
  // The owner's decision at the Phase 4 gate (2026-10-14): the legal pages name who runs Nomi before any real business
  // uses it. The name is not logged; only whether one is set.
  console.log(cfg.OPERATOR_PERSON?.trim() ? 'Legal pages name who runs Nomi (OPERATOR_PERSON).'
    : 'Legal pages name nobody as running Nomi: OPERATOR_PERSON is unset.');
  if (legalFacts.processor.country === null) {
    console.warn(`Model provider ${legalFacts.processor.name} is not a host this build can name a country for — the privacy page will not state where messages are processed.`);
  }
  // M37 — the page reader, wired at the production entrypoint. A feature whose
  // tests pass is not built; a feature a route reaches is. Absent key → absent
  // port → the photo path refuses and says so, which is the designed state.
  const pageTranscriber = anthropicPageTranscriber(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  // D6 — a receipt, invoice or bill read for the books, on the same provider (a draft at most, never posted).
  const documentReader = anthropicDocumentReader(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  // EXT — the closer reading of a list's lines, on the same provider.
  const catalogExtractor = anthropicCatalogExtractor(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  // EXT — a page of her site read into facts she ticks.
  const pageFactsReader = anthropicPageFactsReader(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  // G10 — a draft in a language its owner may not read, translated on request (never sent).
  const draftTranslator = overrides?.draftTranslator ?? anthropicDraftTranslator(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  // THE ADVISOR BATCH — the owner's advisor: the same provider the assistant uses (the privacy page says so),
  // and its own small pool, read-only at the server, the only database it is given.
  const advisorModel = overrides?.advisorModel ?? anthropicAdvisorModel(modelClient(watch.observe), llm.model, requestExtrasFor(llm));
  const advisorDb = createReadOnlyDb(cfg.DATABASE_URL);
  // THE ADVISOR'S MEMORY (0130; D8) — the key its history is sealed with. Missing or wrong, the advisor answers
  // as ever and nothing is kept: said once here, never a reason not to start. Proven by a round trip, and the
  // rows a rotation has not yet reached are counted (never opened).
  const advisorKeys = advisorKeysFrom(process.env);
  {
    const probe = sealAdvisor(advisorKeys, 'advisor-key-check');
    const works = !!probe && openAdvisor(advisorKeys, probe.ciphertext, probe.sealedWith)?.plain === 'advisor-key-check';
    if (!works) {
      console.warn(`[advisor] ADVISOR_KEY is ${advisorKeys.problem === 'shape' ? 'not a 64-hex key' : 'not set'}: the advisor answers, and nothing is kept`);
    } else {
      const census = await sql<{ sealed_with: string; rows: string }>`select sealed_with, rows::text as rows from advisor_seal_census()`
        .execute(db).then((r) => r.rows).catch(() => []);
      const behind = census.filter((c) => c.sealed_with !== advisorKeys.current?.id).reduce((n, c) => n + Number(c.rows), 0);
      if (behind > 0) console.log(`[advisor] ${behind} stored row(s) still sealed with an earlier key: each is sealed again when it is opened; keep ADVISOR_KEY_PREVIOUS set until none are left`);
    }
  }
  // 0130 — each person's own advisor history, on the app's pool (row security by workspace and person), the
  // only thing that writes or opens it. Handed to the advisor's routes as a port, never as a pool.
  const advisorHistory = advisorMemory(db, advisorKeys);
  // A4 (0174) — where the workspaces' papers live: DOCUMENT_STORES, read once. A map that cannot be read stops the boot
  // here, by name, rather than refusing the first upload later.
  const documentStores = documentStoresFrom(process.env, credentialKey);
  // G5b — phone alerts: the installation's VAPID pair (pasted by the operator),
  // and the way out to a push service. Unset: no phone alerts, and the page says so.
  const vapid = vapidFrom(process.env);
  if (!vapid) console.warn('Phone alerts are off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are not all set (docs/env-checklist.md).');
  const pushOut = vapid ? {
    keys: vapid,
    fetch: overrides?.pushFetch ?? ((url: string, init: { method: string; headers: Record<string, string>; body: Buffer; signal?: AbortSignal }) => fetch(url, init)),
  } : null;
  /** S7 — the chat page's way in, set once the ingress exists (messaging path only; deployment mode has none). */
  let ingestWebChat: ((e: InboundMessageEvent) => Promise<'new' | 'duplicate' | 'refused'>) | null = null;
  const mountCommandCenter = (a: FastifyInstance) => {
    registerWebApp(a, {
      db,
      pageTranscriber,
      ...(ingestWebChat ? { chatIngest: ingestWebChat } : {}),
      ...(telegramBot && ingestWebChat ? { telegramBot: { username: telegramBot.username } } : {}),
      documentReader,
      // EXT — a PDF is offered only where the provider reads documents (Anthropic's does;
      // this installation's custom provider answered one with nothing, 2026-10-01).
      pdfReadable: llm.name === 'anthropic',
      catalogExtractor,
      pageFactsReader,
      draftTranslator,
      advisorDb,
      advisorModel,
      advisorMemory: advisorHistory,
      documents: documentStores,
      advisorProvider: { name: legalFacts.processor.name, model: llm.model },
      sessionSecret: webSessionSecret,
      accessCode: ownerAccessCode,
      businessId: PILOT_BUSINESS_ID,
      // A1 — who may create a workspace here. Unset is 'invite'.
      signupMode: signupModeFrom(process.env['SIGNUP_MODE']),
      // G1 — the cohort cap, counted in the database; unset: no cap.
      signupCap: signupCapFrom(process.env['SIGNUP_CAP']),
      // A3 — the installation's own sender. Unset, nothing ever asks for a code.
      systemMail,
      // MAIL — codes and reset links by the sender strangers' mail uses.
      codeMail,
      // BOT — the check before a sign-up code, and the database's limits on the door (0114).
      botCheck,
      signupGuard: overrides?.signupGuard === undefined ? SIGNUP_GUARD : overrides.signupGuard,
      // BILL — the payment provider; null until the owner pastes its keys.
      stripe,
      templateState: TEMPLATE_STATE,
      ...(overrides?.autonomyReleased ? { autonomyReleased: overrides.autonomyReleased } : {}),
      // G11 — so the owner's copy of a proof link is one she can send.
      publicBaseUrl: cfg.PUBLIC_BASE_URL ?? null,
      // Phase 5 — which hosts are the public site (nomidoes.com).
      siteHosts: parseSiteHosts(cfg.SITE_HOSTS),
      // G13 — the same fetcher the worker hears with, so she can play a note.
      ...(mediaPorts.audio ? { audio: mediaPorts.audio } : {}),
      // CC-10 — a crashed page is written down, and the operator hears of it.
      reportError: errors.report,
      // G5b — the phone alerts' keys, for the page that turns them on and its test.
      push: pushOut,
      // CH4 — where Nomi stands with Meta, said on Channels (the operator's variable).
      metaReview: metaReviewFrom(process.env),
      // V1-006 — the component gallery, for a local instance only (the run-nomi smoke script sets it).
      componentGallery: process.env['COMPONENT_GALLERY'] === 'on',
      kickAnswer: (businessId, conversationId, messageId, text) =>
        boss.send(QUEUES.inbound, {
          businessId, conversationId, messageId, text, answerOnly: true,
        } satisfies InboundJob, { retryLimit: 1, group: inboundGroup(businessId) }).then(() => undefined),
    // M40.1 — the real resolver. `SENDING_SPF_INCLUDE` names a sending
    // provider's SPF mechanism explicitly; unset, the check requires the one
    // belonging to the mailbox she connected (C6), and with neither it cannot
    // confirm authorisation and says so, which refuses rather than assumes.
    resolveDns: resolveSendingRecords,
    sendingInclude: process.env['SENDING_SPF_INCLUDE'] ?? null,
    // M40.2 — absent mounts no webhook, exactly as an absent WhatsApp provider
    // mounts none. There is nothing to verify a caller with.
    emailWebhookSecret: process.env['EMAIL_WEBHOOK_SECRET'] ?? null,
    // G3 — the number "Connect this number" connects, from the validated
    // config. Only Meta names one; without it the page shows the guide.
    connectableNumber: cfg.provider === 'meta' ? (cfg.META_WHATSAPP_PHONE_NUMBER_ID ?? null) : null,
    // C5 — her connector keys are encrypted with the same key as every other
    // credential; Apollo is built from her key per request, never held.
    credentialKey: deriveKey(cfg.CREDENTIAL_KEY),
    // D18 — Apollo receives prospect searches: wired only once the privacy page names it.
    ...(recipientNamed('apollo') ? { prospectSourceFor: (apiKey: string) => apolloSource({ apiKey }) } : {}),
    // C6 — connecting her mailbox; the redirect goes back to PUBLIC_BASE_URL.
    oauthClients,
    // B3 — the books in the owner's Google Sheets: the installation's own Google client (drive.file only), wired only
    // once the privacy page names Google Sheets (D18 stops the boot before that).
    ...(recipientNamed('googleSheets') && process.env['SHEETS_CLIENT_ID']?.trim() && process.env['SHEETS_CLIENT_SECRET']?.trim()
      ? { sheetsClient: { clientId: process.env['SHEETS_CLIENT_ID'].trim(), clientSecret: process.env['SHEETS_CLIENT_SECRET'].trim() } } : {}),
    // D8 — the shop's own Xero: the installation's Xero client, wired only once the privacy page names Xero (D18
    // stops the boot before that).
    ...(recipientNamed('xero') && process.env['XERO_CLIENT_ID']?.trim() && process.env['XERO_CLIENT_SECRET']?.trim()
      ? { xeroClient: { clientId: process.env['XERO_CLIENT_ID'].trim(), clientSecret: process.env['XERO_CLIENT_SECRET'].trim() } } : {}),
    // D9 — the shop's own QuickBooks: the installation's Intuit client, wired only once the privacy page names Intuit.
    ...(recipientNamed('intuit') && process.env['QBO_CLIENT_ID']?.trim() && process.env['QBO_CLIENT_SECRET']?.trim()
      ? { qboClient: { clientId: process.env['QBO_CLIENT_ID'].trim(), clientSecret: process.env['QBO_CLIENT_SECRET'].trim() } } : {}),
    // C9 — the accounts buyers write to, when the host configured them.
    instagramAccountId: igAccountId ?? null,
    messengerPageId: pageId ?? null,
    // C10 — the login a business connects its OWN Page with, and what it takes
    // to finish the connection when Meta sends her back.
    metaLogin,
    metaConnect: {
      db, credentialKey: deriveKey(cfg.CREDENTIAL_KEY), login: metaLogin,
      fetchImpl: metaFetch, graphVersion: cfg.META_GRAPH_API_VERSION,
    },
    // WA — a business connects its OWN WhatsApp number (Embedded Signup).
    waLogin,
    waConnect: {
      db, credentialKey: deriveKey(cfg.CREDENTIAL_KEY), login: waLogin,
      fetchImpl: metaFetch, graphVersion: cfg.META_GRAPH_API_VERSION,
      installationWabaId: cfg.META_WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
    },
    // WA — and plays back a voice note with that number's own token.
    audioFor: async (businessIdRaw: string) => {
      const b = parseBusinessId(businessIdRaw);
      return b.ok ? (await mediaPorts.ownMedia?.({ db, businessId: b.value }))?.audio : undefined;
    },
    // Her own mail server (SMTP), so the accounts page can say what actually sends.
    smtpFrom: smtpConfig?.from ?? null,
      employeeName: process.env['EMPLOYEE_NAME'] ?? '小雅',
      // Named on /privacy and /data-deletion; absent, those pages say to write
      // to the business from the account you used.
      legalContact: cfg.LEGAL_CONTACT_EMAIL ?? null,
      // Phase 4 gate (2026-10-14) — who "we" means on the legal pages until the company exists.
      operatorPerson: cfg.OPERATOR_PERSON?.trim() || null,
      legalFacts,
      // The mark is the default; an operator who sets EMPLOYEE_AVATAR still gets
      // their emoji, unchanged. The small cut, because the header avatar is 30px.
      // V1 step three — no face in the header: the assistant is named, never drawn.
      // EMPLOYEE_AVATAR is no longer read.

      provider: cfg.provider,
      // Whether anything queued from these pages will leave: the outbound
      // worker runs whenever some channel is here, WhatsApp or not.
      messagingEnabled: channelsHere.length > 0,
      secureCookie: process.env['NODE_ENV'] === 'production',
      // The EXISTING outbound path — the same QUEUES.outbound worker the turn
      // pipeline uses. applyOwnerCommand (inbox actions) sends through this.
      // 0136 — every kick is a person's act (a draft sent, an order confirmed): approved.
      kickOutbound: async (businessId, conversationId, reply, asks, notice) => {
        await boss.send(QUEUES.outbound, { businessId, conversationId, reply, asks: asks ?? null, notice: notice ?? null, approved: true },
          { singletonKey: conversationId });
      },
      // M16.1: bare re-drive tick — delivers an owner takeover reply through the
      // SAME outbound worker (no second send path).
      kickDrive: async (businessId, conversationId) => {
        await boss.send(QUEUES.outbound, { businessId, conversationId },
          { singletonKey: conversationId });
      },
      // P3 — a practice message joins the SAME inbound queue a customer's does.
      enqueueInbound: (job) => enqueueInbound(boss, job),
    });
  };

  let closing = false;
  /** The minute's sweep gives way to the next minute, and looks up few domains at a time. */
  const SWEEP_BUDGET_MS = 40_000;
  const DOMAIN_CHECKS_PER_SWEEP = 3;
  // E1 — an inbox read is a handful of calls to Google. Same discipline as a
  // domain check: a few a minute, so one slow mailbox never costs the sends.
  const INBOX_READS_PER_SWEEP = 3;
  const finalize = (a: FastifyInstance): Production => ({
    app: a, db, boss, ownerAccessCode, ownerAccessCodeGenerated: !process.env['OWNER_ACCESS_CODE'], primaryModel,
    channels: channelsHere, reportError: errors.report,
    async close() {
      if (closing) return;
      closing = true;
      // 0. CC-10 — the heartbeat first: a tick between the server closing and
      //    the workers stopping would find no /health and report a deploy as
      //    an outage. (No heartbeat worker here: a no-op.)
      await boss.offWork(QUEUES.heartbeat).catch(() => {});
      await a.close();                         // 1. stop accepting requests
      await boss.stop().catch(() => {});       // 2–3. stop workers + pg-boss
      await db.destroy().catch(() => {});      // 5. release the pool
      await advisorDb.destroy().catch(() => {});   // …and the advisor's
    },
  });

  // Outbound drive: consumes both reply jobs (from turn effects) and bare
  // re-drive ticks (from status webhooks / wait-recheck).
  // 0080 — `asks`: the question the reply asks, written on its outbound row.
  type DriveJob = { businessId: string; conversationId: string; reply?: string; asks?: PendingQuestion | null; notice?: 'handoff' | 'opt_out' | null; approved?: boolean };
  type Drivers = { adapter?: ChannelAdapter; adapters?: AdapterFor; mailHeaders?: MailHeadersFor; mediaOrigin?: string | null };
  /**
   * P3 — PRACTICE'S SENDS (docs/PRACTICE.md). A practice copy's replies go
   * through this worker and its send gate like anyone's — Stop, the window,
   * the ceiling — and end at the practice adapter, which has no network. It is
   * picked by the BUSINESS: a copy is handed this map and nothing else, never
   * the installation's WhatsApp adapter or an account's Page.
   */
  const practiceChannel = practiceAdapter();
  const practiceDrivers: Drivers = { adapters: (channel) => (channel === PRACTICE_CHANNEL ? practiceChannel : undefined) };
  /** The one outbound handler; `real` gives a real business its adapters, inside the send's own transaction. */
  const driveOutbound = (real: (tx: Tx, businessId: BusinessId) => Promise<Drivers>) =>
    async ([job]: { data: DriveJob }[]): Promise<void> => {
      if (!job) return;
      const businessId = parseBusinessId(job.data.businessId);
      if (!businessId.ok || !job.data.conversationId) return;   // poison: drop

      const effects = await withTenantTx(db, businessId.value, async (tx) => {
        await lockConversation(tx, job.data.conversationId);
        // P6 — a conversation that is gone (Practice's Start over, an erasure)
        // has nobody to send to: the job asks nothing of anyone.
        if (!(await conversationExists(tx, job.data.conversationId))) return [];
        if (job.data.reply) {
          await enqueueOutboundRow(tx, businessId.value, job.data.conversationId, job.data.reply,
            'employee', null, job.data.asks ?? null,
            // 0135 — only the two notices; anything else a job says is not one.
            job.data.notice === 'opt_out' || job.data.notice === 'handoff' ? job.data.notice : null,
            job.data.approved === true);
        }
        const store = channelStore(tx, businessId.value, { template: TEMPLATE_STATE });
        const practice = await isPracticeCopy(tx, businessId.value);
        const drivers = practice ? practiceDrivers : await real(tx, businessId.value);
        const fx = await driveConversationOutbound({ store, ...drivers, now: () => new Date() }, job.data.conversationId);
        // The practice customer's phone is the page: a reply accepted is a reply
        // delivered. Recorded through the receipt path a status webhook takes, so
        // the next reply is not held for a receipt that could never come (the
        // sequencer waits up to 90 s for one on Instagram).
        if (practice) {
          for (const e of fx) if (e.kind === 'sent') await store.reconcileStatus(e.providerMessageId, 'delivered', null);
        }
        return fx;
      });

      const waiting = effects.find((e) => e.kind === 'waiting');
      const progressed = effects.some((e) => e.kind === 'sent');
      if (waiting && waiting.kind === 'waiting') {
        await boss.send(QUEUES.outbound,
          { businessId: job.data.businessId, conversationId: job.data.conversationId },
          { startAfter: Math.max(1, Math.ceil(waiting.recheckInMs / 1000)), singletonKey: job.data.conversationId });
      } else if (progressed) {
        await boss.send(QUEUES.outbound,
          { businessId: job.data.businessId, conversationId: job.data.conversationId },
          { startAfter: 1, singletonKey: job.data.conversationId });
      }
    };

  /**
   * P6 — PRACTICE IS NOT KEPT (0089): once a day, every copy's practice
   * conversations quiet for thirty days are erased — a customer's words put
   * there through "Try it" must not outlive a deletion request by long. In
   * both modes: Practice runs with no channel configured, too.
   */
  const erasePracticeDaily = async (): Promise<void> => {
    await boss.schedule(QUEUES.practiceExpiry, '40 3 * * *', {} satisfies PracticeExpiryJob);
    await boss.work<PracticeExpiryJob>(QUEUES.practiceExpiry, async () => {
      const n = await expirePractice(db);
      if (n > 0) console.log(`[practice] ${n} practice conversation(s) quiet for thirty days erased`);
    });
    // THE ADVISOR'S MEMORY (0130; D5) — a conversation not opened for twelve months is deleted, once a day,
    // through the same deletion and ledger as every other (`advisor_expire`). Counts only, never words.
    await boss.schedule(QUEUES.advisorExpiry, '50 3 * * *', {});
    await boss.work(QUEUES.advisorExpiry, async () => {
      const n = Number((await sql<{ n: string }>`select advisor_expire()::text as n`.execute(db)).rows[0]?.n ?? 0);
      if (n > 0) console.log(`[advisor] ${n} conversation(s) not opened for twelve months deleted`);
    });
    // B5 (0180) — every morning, every connected system (Google Sheets, Odoo, Xero, QuickBooks) is read into the books as the owner's
    // "Read it in" does: entries as drafts, the same change once, a refusal written down for the books' page.
    await boss.schedule(QUEUES.booksRead, '20 5 * * *', {});
    await boss.work(QUEUES.booksRead, async () => {
      const sheetsId = process.env['SHEETS_CLIENT_ID']?.trim(); const sheetsSecret = process.env['SHEETS_CLIENT_SECRET']?.trim();
      const xeroId = process.env['XERO_CLIENT_ID']?.trim(); const xeroSecret = process.env['XERO_CLIENT_SECRET']?.trim();
      const qboId = process.env['QBO_CLIENT_ID']?.trim(); const qboSecret = process.env['QBO_CLIENT_SECRET']?.trim();
      const t = await readEveryConnectedSystem({
        db, credentialKey,
        ...(recipientNamed('googleSheets') && sheetsId && sheetsSecret ? { sheets: { client: { clientId: sheetsId, clientSecret: sheetsSecret }, fetch: oauthFetch } } : {}),
        odoo: { post: publicPost, today: () => new Date().toISOString().slice(0, 10) },
        ...(recipientNamed('xero') && xeroId && xeroSecret ? { xero: { client: { clientId: xeroId, clientSecret: xeroSecret }, fetch: oauthFetch } } : {}),
        ...(recipientNamed('intuit') && qboId && qboSecret ? { quickbooks: { client: { clientId: qboId, clientSecret: qboSecret }, fetch: oauthFetch } } : {}),
      });
      if (t.read + t.refused + t.problems > 0) console.log(`[books] morning read: ${t.read} read, ${t.refused} refused, ${t.problems} with problems`);
    });
    // D1 (0137) — a sign-up never finished is not kept: its form and address go an hour after its code
    // expired. In both modes: sign-up runs with no channel configured, too.
    await boss.schedule(QUEUES.signupExpiry, '45 3 * * *', {});
    await boss.work(QUEUES.signupExpiry, async () => {
      const n = Number((await sql<{ n: string }>`select login_codes_forget()::text as n`.execute(db)).rows[0]?.n ?? 0);
      if (n > 0) console.log(`[signup] ${n} unfinished sign-up(s) forgotten`);
      // D2 (0138) — and the sign-up guard's hashed callers, past two days.
      const c = Number((await sql<{ n: string }>`select signup_throttles_forget()::text as n`.execute(db)).rows[0]?.n ?? 0);
      if (c > 0) console.log(`[signup] ${c} sign-up caller count(s) forgotten`);
      // Phase 1 (0148) — and the sign-up's marks: an attempt's after two days, a workspace's after 180.
      const m = Number((await sql<{ n: string }>`select signup_marks_forget()::text as n`.execute(db)).rows[0]?.n ?? 0);
      if (m > 0) console.log(`[signup] ${m} sign-up mark(s) forgotten`);
    });
    // D12 (0141) — every erasure's ledger line reaches the operator's mailbox, the copy that outlives a total
    // loss: what the app did not mail at once (the advisor's deletions, the twelve-month expiry, a team member
    // removed, an operator's tool, a mail that failed). Ids only.
    await boss.schedule(QUEUES.erasureMail, '*/15 * * * *', {});
    await boss.work(QUEUES.erasureMail, async () => {
      const n = await mailUnmailedLedger(db, systemMail, cfg.LEGAL_CONTACT_EMAIL ?? null);
      if (n > 0) console.log(`[erasure] ${n} ledger line(s) mailed to the operator`);
    });
  };

  // DEPLOYMENT MODE: full stack up, NO messaging surface. No adapter, no
  // webhook routes — for hosting before ANY channel is configured. An override
  // adapter (tests) always takes the messaging path so composition stays
  // covered. The outbound worker runs for Practice (P3): a copy's replies reach
  // the practice adapter; anything else queued here is refused
  // `channel_unavailable`, where the owner sees it, since nothing can carry it.
  if (channelsHere.length === 0) {
    await boss.work<DriveJob>(QUEUES.outbound, driveOutbound(async () => ({})));
    await erasePracticeDaily();
    const app = Fastify({ logger: requestLogger(overrides?.logger ?? true) });
    mountHealth(app, 'disabled');
    mountCommandCenter(app);
    app.log.warn('No messaging channel configured. Running in deployment mode.');
    return finalize(app);
  }

  // WhatsApp, when a provider is selected. Absent — the Page configured, the
  // number not yet — nothing here stands in for it: the outbound worker refuses
  // a WhatsApp row as `channel_unavailable`, owner alerts have nowhere to go,
  // and `/webhook/whatsapp` is not mounted. The same honest absence as e-mail
  // with no mailbox, rather than a stub that answers for a channel it is not.
  const adapter: ChannelAdapter | undefined = overrides?.adapter ?? (cfg.provider === 'meta'
    ? metaAdapter({
        accessToken: cfg.META_WHATSAPP_ACCESS_TOKEN!,
        phoneNumberId: cfg.META_WHATSAPP_PHONE_NUMBER_ID!,
        appSecret: cfg.META_APP_SECRET!,
        graphVersion: cfg.META_GRAPH_API_VERSION,
      })
    : cfg.provider === '360dialog'
      ? whatsappAdapter({
          baseUrl: cfg.D360_BASE_URL!, apiKey: cfg.D360_API_KEY!, webhookSecret: cfg.WEBHOOK_SECRET!,
        })
      : undefined);

  /**
   * Tenant from the channel credential — NEVER from the payload.
   *
   * C9 — by CHANNEL as well as by account id: one Meta app carries WhatsApp,
   * Instagram and the Page, and the same number-shaped id could in principle
   * exist on two of them. The credential row says which business owns which
   * account on which channel, and nothing else is trusted.
   */
  async function resolveTenant(accountId: string, channel = 'whatsapp'): Promise<BusinessId | null> {
    const r = await sql<{ business_id: string }>`
      select business_id from resolve_tenant(${channel}, ${accountId})
    `.execute(db);
    const raw = r.rows[0]?.business_id;
    if (!raw) return null;
    const parsed = parseBusinessId(raw);
    return parsed.ok ? parsed.value : null;
  }

  /**
   * C4.a / C6 — the adapters this installation has, by channel, FOR ONE BUSINESS.
   *
   * WhatsApp is whichever provider the environment selected. E-mail leaves
   * through the mailbox the business connected (`mail_accounts`, C6): the
   * transport is bound to the job's own business, reads its live account on
   * every send, and REFUSES — says why, never pretends — when none is connected,
   * when the installation has no OAuth app for it, or when the mailbox is not on
   * her verified domain. The recording fake that stood here until C6 said `ok` to
   * mail that went nowhere; tests still pass one in as `overrides.mailTransport`.
   */
  // A3 — built here, where its parts exist; called only when a code is mailed.
  // Its parts (`credentialKey`, `oauthFetch`, `tokenCache`, `mailSenders`) are
  // made above the deployment-mode return — see PWR2 there.
  function systemMailboxTransport(): MailTransport {
    const operator = parseBusinessId(PILOT_BUSINESS_ID);
    if (!operator.ok || !systemSmtp) {
      return { provider: 'account', send: async () => ({ ok: false, retryable: false, error: 'no operator workspace' }) };
    }
    return accountMailTransport({
      db, businessId: operator.value, credentialKey, clients: oauthClients, senders: mailSenders,
      fetchImpl: oauthFetch, cache: tokenCache,
      system: { from: systemSmtp.from, onlyMailbox: systemSmtp.user },
    });
  }
  /**
   * C10 — the Page and Instagram adapters for ONE business, from the account
   * it connected itself. The token is opened for this drive and held in
   * memory only. A token Meta refuses (401) is recorded on the row, so the
   * page asks her to connect again and every later reply says why instead of
   * failing with nobody told. A row that already needs her answers with no
   * adapter — `channel_unavailable`, the honest refusal — never with the
   * environment's account, which would be someone else's Page.
   */
  const metaAdaptersFor = (businessId: BusinessId, account: MetaAccount | null): Partial<Record<string, ChannelAdapter>> => {
    if (!account) return metaMessaging;
    if (account.needsAttention) return {};
    const token = metaAccountToken(account, credentialKey);
    if (!token) return {};
    const noted = (a: ChannelAdapter): ChannelAdapter => ({
      ...a,
      sendText: async (to, body) => {
        const r = await a.sendText(to, body);
        if (!r.ok && !r.retryable && r.error.startsWith('meta 401')) {
          await withTenantTx(db, businessId, (tx) => markMetaAccountNeedsAttention(tx, account.id, 'revoked')).catch(() => undefined);
        }
        return r;
      },
    });
    const common = { accessToken: token, appSecret: socialSecret ?? '', graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: metaFetch };
    return {
      messenger: noted(messengerAdapter({ accountId: account.pageId, ...common })),
      ...(account.igAccountId ? { instagram: noted(instagramAdapter({ pageId: account.pageId, ...common })) } : {}),
    };
  };

  /**
   * WA (0120) — a business that connected its OWN WhatsApp number sends from
   * it, with its own token. With none, the installation's number serves the
   * business that holds it, as before. A token that needs attention sends
   * nothing — `channel_unavailable`, never the installation's number, which
   * would be someone else's. A 401 marks it, once, so the page asks the owner.
   */
  const waAdaptersFor = (businessId: BusinessId, account: WhatsAppAccount | null): Partial<Record<string, ChannelAdapter | undefined>> => {
    if (!account) return {};
    if (account.needsAttention) return { whatsapp: undefined };
    const token = whatsAppAccountToken(account, credentialKey);
    if (!token) return { whatsapp: undefined };
    const base = metaAdapter({
      accessToken: token, phoneNumberId: account.phoneNumberId, appSecret: cfg.META_APP_SECRET ?? '',
      graphVersion: cfg.META_GRAPH_API_VERSION, ...(overrides?.whatsappFetch ? { fetchImpl: overrides.whatsappFetch } : {}),
    });
    const noted = async <R extends { ok: boolean; retryable?: boolean; error?: string }>(r: R): Promise<R> => {
      if (!r.ok && r.retryable === false && (r.error ?? '').startsWith('401')) {
        await withTenantTx(db, businessId, (tx) => markWhatsAppNeedsAttention(tx, account.id, 'revoked')).catch(() => undefined);
      }
      return r;
    };
    return {
      whatsapp: {
        ...base,
        sendText: async (to, body) => noted(await base.sendText(to, body)),
        ...(base.sendMedia ? { sendMedia: async (to: string, m: Parameters<NonNullable<ChannelAdapter['sendMedia']>>[1]) => noted(await base.sendMedia!(to, m)) } : {}),
        ...(base.sendTemplate ? { sendTemplate: async (to: string, tpl: Parameters<NonNullable<ChannelAdapter['sendTemplate']>>[1]) => noted(await base.sendTemplate!(to, tpl)) } : {}),
      },
    };
  };

  /**
   * The installation's own WhatsApp number (the Meta provider's), when there is one. It sends ONLY for the business
   * whose live credential is that number (2026-10-14, the operator tool): a business with no number of its own — one
   * attached and since disconnected, one that never had one — is refused (`channel_unavailable`), never answered from
   * another workspace's number. Unknown (no Meta number configured) keeps the one provider for every business.
   */
  const installationNumber = cfg.provider === 'meta' ? (cfg.META_WHATSAPP_PHONE_NUMBER_ID ?? null) : null;

  const adaptersFor = (
    businessId: BusinessId, metaAccount: MetaAccount | null = null, waAccount: WhatsAppAccount | null = null,
    waNumber: string | null = null,
  ) => {
    const email = emailAdapter({
      transport: overrides?.mailTransport ?? (smtpConfig
        ? smtpMailTransport({ db, businessId, config: smtpConfig })
        : accountMailTransport({
          db, businessId, credentialKey, clients: oauthClients, senders: mailSenders,
          fetchImpl: oauthFetch, cache: tokenCache,
        })),
    });
    const byChannel: Record<string, ChannelAdapter | undefined> = {
      // S7 — the chat page: accepted here, written to the conversation by the send path, read on the page.
      ...(adapter ? { [adapter.kind]: adapter } : {}), email, web_chat: webChatAdapter(), ...(telegramBot ? { telegram: telegramBot.adapter } : {}),
      ...metaAdaptersFor(businessId, metaAccount),
      ...waAdaptersFor(businessId, waAccount),
      ...(waAccount === null && installationNumber !== null && waNumber !== installationNumber ? { whatsapp: undefined } : {}),
    };
    return (channel: string): ChannelAdapter | undefined => byChannel[channel];
  };

  /**
   * C4.a — RFC 8058 headers, minted per message from the same signing key the
   * unsubscribe page reads with, for the business the mail is sent for. Empty
   * when this installation has no public address to send anyone to, which is a
   * refusal rather than a mail without a way out (`no_unsubscribe`).
   */
  const mailHeadersFor = (businessId: BusinessId) => (
    row: { readonly to: string }, opts: { readonly locale: Locale },
  ): MailEnvelope => {
    if (!cfg.PUBLIC_BASE_URL) return { headers: {}, tag: null };
    const token = mintUnsubscribe(webSessionSecret, {
      // The BUYER's language, resolved by the store from his own client row: the
      // page behind this link is the one thing in her mail he reads that she did
      // not write, and it is no use to him in a language he does not read.
      businessId, channel: 'email', identity: row.to, locale: opts.locale,
    });
    // C4.c — the same token as the provider's event tag, so a bounce or a
    // complaint about this mail resolves to this business and this address.
    // 0133 — the same address, for the link a person can see in a marketing e-mail's footer.
    const unsubscribeUrl = `${cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/u?t=${encodeURIComponent(token)}`;
    return { headers: unsubscribeHeaders(unsubscribeUrl), tag: token, unsubscribeUrl };
  };

  await boss.work<DriveJob>(QUEUES.outbound, driveOutbound(async (tx, businessId) => {
    // C10 — read inside the same transaction as the send it authorises, so a
    // disconnect takes effect on the next reply, not the next boot.
    const metaAccount = await liveMetaAccount(tx, businessId);
    // WA — and the business's own WhatsApp number, read the same way.
    const waAccount = await liveWhatsAppAccount(tx, businessId);
    // …and, with none of its own, which number its credential routes: the installation's serves only its holder.
    const waNumber = waAccount ? null : await activeWhatsAppNumber(tx, businessId);
    return {
      ...(adapter ? { adapter } : {}), adapters: adaptersFor(businessId, metaAccount, waAccount, waNumber),
      mailHeaders: mailHeadersFor(businessId),
      // F1 — a picture is sent only from Nomi's own public address.
      mediaOrigin: cfg.PUBLIC_BASE_URL ?? null,
    };
  }));

  /**
   * C4.b — follow-ups. Once a minute, whatever is due for this installation's
   * tenant. Registered only on the messaging path, beside the outbound worker it
   * feeds: in deployment mode there is no worker to send what it would queue, and
   * a follow-up queued there would leave days late when messaging came on.
   *
   * The schedule is upserted on every boot, so a deploy never leaves two. The
   * tenant comes from this process, never from the job: a tick is a reminder to
   * look, not an instruction about whom to write to.
   */
  const sequenceDeps = {
    db, now: () => new Date(), templateState: TEMPLATE_STATE,
    // Her mail leaves through her own mailbox (C6), and a buyer's answer lands
    // there, unread by this product: no follow-up goes without a person
    // confirming he has not answered. True only for a transport whose replies
    // reach /hooks/email/inbound — none is wired in production today.
    repliesObservable: false,
    kickDrive: async (businessId: string, conversationId: string) => {
      await boss.send(QUEUES.outbound, { businessId, conversationId }, { singletonKey: conversationId });
    },
  };
  await boss.schedule(QUEUES.sequences, '* * * * *', { businessId: PILOT_BUSINESS_ID } satisfies SequenceSweepJob);
  await boss.work<SequenceSweepJob>(QUEUES.sequences, async ([job]: { data: SequenceSweepJob }[]) => {
    if (!job) return;
    /**
     * A1 — THE CLOCK LOOKS AT EVERY FACTORY. It looked at the one business the
     * environment named, so a factory that signed itself up would have had
     * follow-ups that never left and a domain check that lapsed. The schedule
     * still carries one id (it is what is already queued); the list comes from
     * `live_business_ids` — the businesses with a follow-up still running or a
     * sending domain, not every workspace that exists. The environment's
     * business is ALWAYS among them, listed or not, and is the whole list if
     * the read fails: the behaviour before this milestone, never less.
     *
     * One factory's failure must not cost the others their minute.
     */
    /**
     * A MINUTE'S WORK FITS IN A MINUTE, AND STOPS WHEN TOLD TO.
     *
     * With one business this loop could not run long. With many it can: a
     * domain check is three DNS look-ups, and a name that does not resolve
     * waits out its timeout — a few hundred of those held the process open
     * past its shutdown deadline (found on a test database full of workspaces
     * whose domains never existed). So: it leaves the moment the process is
     * closing, it stops after forty seconds so the next minute never overlaps
     * it, and it looks up at most three domains a minute. A checked domain is
     * not due again for an hour at least, so the next minute takes the next
     * three and nobody is starved. The ORDER is unchanged: her domain is looked
     * at before her sends in the same minute, so a follow-up is not held for
     * want of someone pressing "Look again".
     */
    const started = Date.now();
    const listed = await liveBusinessIds(db).catch(() => [] as readonly string[]);
    const tenants = [...new Set([PILOT_BUSINESS_ID, ...listed])]
      .map((id) => parseBusinessId(id)).flatMap((b) => (b.ok ? [b.value] : []));
    const spent = (): boolean => closing || Date.now() - started > SWEEP_BUDGET_MS;

    let lookedUp = 0;
    let inboxesRead = 0;
    for (const tenant of tenants) {
      if (spent()) return;
      // Her domain check lapses after a week by design; the clock looks again
      // before it does. Its failure must not cost the minute's sends — and
      // cannot authorise one: a lookup that fails records `missing`.
      if (lookedUp < DOMAIN_CHECKS_PER_SWEEP) {
        const r = await refreshDomainCheckIfDue({
          db, resolveDns: resolveSendingRecords, sendingInclude: process.env['SENDING_SPF_INCLUDE'] ?? null,
        }, tenant, new Date()).catch((e: unknown) => { console.warn('[domain-check]', loggableMessage(e instanceof Error ? e.message : String(e))); void errors.report(e, `worker:${QUEUES.sequences}`, { businessId: tenant }); return 'checked' as const; });
        if (r === 'checked') lookedUp++;
      }
      if (spent()) return;
      await runDueSteps(sequenceDeps, tenant)
        .catch((e: unknown) => { console.warn('[sequences]', loggableMessage(e instanceof Error ? e.message : String(e))); void errors.report(e, `worker:${QUEUES.sequences}`, { businessId: tenant }); });
    }

    /**
     * S6 (0202) — THE SURVEYS DUE, in every workspace that has one: each asked (an automated message, held by the send
     * gate like a follow-up) or set aside with its reason, in that workspace's own transaction; then sent like any reply.
     */
    const surveying = spent() ? [] : await surveyBusinessesDue(db).catch(() => [] as readonly string[]);
    for (const id of surveying) {
      if (spent()) return;
      const b = parseBusinessId(id);
      if (!b.ok) continue;
      const queued = await withTenantTx(db, b.value, (tx) => sendDueSurveys(tx, b.value, new Date(), overrides?.surveySigned))
        .catch((e: unknown) => { console.warn('[surveys]', loggableMessage(e instanceof Error ? e.message : String(e))); void errors.report(e, `worker:${QUEUES.sequences}`, { businessId: b.value }); return [] as readonly string[]; });
      for (const c of queued) await sequenceDeps.kickDrive(id, c);
    }

    /**
     * E1 — HER INBOX, LAST. Reading is network work: a mailbox whose provider
     * accepts the connection and then says nothing would delay a send that was
     * already due. So every send in this minute goes first, and reading takes
     * what is left — bounded per call and per read in the reader itself, and to
     * a few mailboxes here, so the next minute takes the next few.
     *
     * E1.2 — and WHICH mailboxes is one question, not one per business: asking
     * each tenant in turn cost a query a minute per live business to learn that
     * almost none reads mail, and the sweep ran out of budget before the
     * follow-ups that were due (the suite caught it, on a database with four
     * hundred of them).
     */
    const readable = spent() ? [] : await businessesReadingInbox(db, INBOX_READS_PER_SWEEP)
      .catch((e: unknown) => { console.warn('[inbox]', loggableMessage(e instanceof Error ? e.message : String(e))); return [] as readonly string[]; });
    for (const id of readable) {
      const b = parseBusinessId(id);
      if (!b.ok) continue;
      const tenant = b.value;
      if (spent() || inboxesRead >= INBOX_READS_PER_SWEEP) return;
      const read = await readNewMail({
        db, credentialKey, clients: oauthClients, fetchImpl: oauthFetch, cache: tokenCache,
        ownAddresses: systemSmtp ? [systemSmtp.from, systemSmtp.user] : [],
        enqueue: (job) => enqueueInbound(boss, { ...job, messageType: 'text' }),
      }, tenant).catch((e: unknown) => { console.warn('[inbox]', loggableMessage(e instanceof Error ? e.message : String(e))); void errors.report(e, `worker:${QUEUES.sequences}`, { businessId: tenant }); return null; });
      if (read && read.outcome !== 'not_reading') inboxesRead++;
      if (read && read.outcome === 'read' && read.recorded > 0) console.log(`[inbox] ${read.recorded} new mail(s) recorded`);
    }
  });

  // P3: owner alerts. QUEUES.notify → resolve owner locale/destination → send the
  // localized alert through the SAME adapter. Registered only with messaging live.
  // An alert travels by WhatsApp. Without it, the job is consumed and dropped as
  // a permanent failure — never left queued for a number connected weeks later,
  // when it would announce a conversation long since resolved.
  const noNumberForAlerts = {
    sendText: async () => ({ ok: false as const, retryable: false, error: 'no WhatsApp adapter: owner alerts need a number' }),
  };
  await boss.work(QUEUES.notify, { includeMetadata: true }, async ([job]: JobWithMetadata<NotifyJob>[]) => {
    if (!job) return;
    // The owner's word after the 106 seconds (2026-10-13): an urgent alert that waited too long in the queue is
    // reported, so whatever held it back is named the day it happens (`lateUrgentAlert`).
    const late = lateUrgentAlert(job.data.kind, job.createdOn, new Date());
    if (late !== null) void errors.report(new Error(`an urgent alert (${job.data.kind}) waited ${Math.round(late / 1000)} s in the queue`),
      `worker:${QUEUES.notify}`, { businessId: job.data.businessId });
    // Phase 8 of the warmth run — WhatsApp is a way out of Nomi only once Meta
    // approved Nomi (`META_APP_REVIEW=approved:<date>`): the day it does, everyone
    // on the default notification way is on WhatsApp, with nothing rebuilt.
    const whatsappApproved = metaReviewFrom(process.env).state === 'approved';
    // The backup alert also travels by the installation's own mail (A3), so
    // it reaches the owner with no channel connected at all.
    await deliverOwnerAlert({ db, adapter: adapter ?? noNumberForAlerts, mail: alertMail, operatorMail: systemMail, publicBaseUrl: cfg.PUBLIC_BASE_URL ?? null, push: pushOut, whatsappApproved }, job.data);   // throws on retryable failure → pg-boss retries
  });

  // CH3 — a reply the owner typed in Instagram's or Messenger's own app. Our
  // own echoes are recognised by Nomi's Meta app id, or by the id our send
  // recorded (src/pipeline/echo.ts).
  const ourMetaAppIds = [...new Set([metaLogin?.appId, process.env['META_SOCIAL_APP_ID']?.trim()]
    .filter((x): x is string => !!x))];
  await boss.work<EchoJob>(QUEUES.echo, async ([job]: { data: EchoJob }[]) => {
    if (!job) return;
    const outcome = await handleEcho(db, job.data, ourMetaAppIds);
    if (outcome === 'recorded') console.log(`[echo] the owner replied in ${job.data.channel}'s own app; the conversation is theirs`);
  });

  /**
   * Has the scheduled backup completed lately? Once a day, after the 03:00 UTC
   * job has had its turn: read the newest row it left in `backup_runs`, and if
   * it is older than 36 hours — or there is none — tell the owner. The check
   * is small on purpose; the backup itself runs elsewhere (backup/run.sh), and
   * this process only asks whether it did. A missed day is one alert a day
   * until it is fixed, never a flood.
   */
  await boss.schedule(QUEUES.backups, '30 6 * * *', { businessId: PILOT_BUSINESS_ID } satisfies BackupWatchJob);
  await boss.work<BackupWatchJob>(QUEUES.backups, async ([job]: { data: BackupWatchJob }[]) => {
    if (!job) return;
    const latest = await latestBackupRun(db);
    const fresh = backupFreshness(latest?.uploadedAt ?? null, new Date());
    if (!fresh.stale) { console.log(`[backups] last completed ${fresh.hoursSince.toFixed(1)} h ago (${latest?.name})`); return; }
    console.warn(`[backups] STALE: ${fresh.hoursSince === null ? 'no completed backup ever' : `${fresh.hoursSince.toFixed(1)} h since ${latest?.name}`}`);
    await sendAlert(boss, {
      businessId: job.data.businessId, kind: 'backup_stale', conversationId: null,
      lastBackupAt: latest?.uploadedAt.toISOString() ?? null,
    } satisfies NotifyJob, { singletonKey: 'backup_stale' });
  });

  /**
   * CC-02a — the deletion deadlines. /data-deletion promises every buyer that
   * Nomi's operator carries a deletion out within 30 days of the business
   * recording it. Once a day, after the backup check, ask across every
   * business which open requests are within 7 days of that or past it, and
   * tell whoever runs this installation — the operator alert, by e-mail
   * always (`deletionDueAlert`). A singleton per day on top of the daily
   * schedule: a redeploy or a retry never makes it two, and a request left
   * late is news again the next morning, every morning, until it is done.
   */
  await boss.schedule(QUEUES.deletions, '0 7 * * *', { businessId: PILOT_BUSINESS_ID } satisfies DeletionWatchJob);
  await boss.work<DeletionWatchJob>(QUEUES.deletions, async ([job]: { data: DeletionWatchJob }[]) => {
    if (!job) return;
    const alert = await deletionDueAlert(db, job.data.businessId, new Date());
    if (!alert) { console.log('[deletions] nothing due within 7 days'); return; }
    console.warn(`[deletions] ${alert.deletionsDue?.length ?? 0} request(s) due within 7 days or late`);
    await sendAlert(boss, alert satisfies NotifyJob,
      { singletonKey: 'deletion_due', singletonSeconds: 24 * 3600 });
  });

  /**
   * D4 (the owner's decision, 2026-10-12; 0147) — A DELETION REQUEST NOBODY
   * ANSWERS IS CHASED, NEVER CARRIED OUT. Once a day: every request waiting for
   * an owner (noted from a message, or recorded and not done) is claimed at its
   * furthest step due, once — reminded at 7 and 30 days (the owner's alert,
   * e-mail always), flagged in the app at 60 (Today and the customer's page read
   * the age). Every chase is recorded (`deletion_chases`); the business, the
   * controller, decides — Nomi deletes nothing on its own.
   */
  await boss.schedule(QUEUES.deletionChase, '15 7 * * *', {});
  await boss.work(QUEUES.deletionChase, async () => {
    const due = (await sql<{ business_id: string; step: string }>`
      select business_id::text as business_id, step from claim_deletion_chases()`.execute(db)).rows;
    for (const c of due) {
      if (c.step === '60d') continue;   // the app flags it; the chase is recorded
      // The owner's decision (2026-10-12): the reminder carries no customer data — no date, no conversation.
      await sendAlert(boss, { businessId: c.business_id, kind: 'deletion_reminder', conversationId: null } satisfies NotifyJob);
    }
    if (due.length > 0) console.log(`[deletions] ${due.length} waiting request(s) chased`);
  });

  /**
   * Phase 2a (0150) — THE MORNING SUMMARY. Every fifteen minutes: each owner whose business's clock is at or past
   * 08:00, outside their quiet hours, with the summary on, is claimed once for that local day; the notify worker
   * builds it as it leaves and sends it the owner's way (nothing on a day with nothing to say).
   */
  await boss.schedule(QUEUES.morningSummary, '*/15 * * * *', {});
  await boss.work(QUEUES.morningSummary, async () => {
    for (const due of await claimMorningSummaries(db)) {
      await sendAlert(boss, {
        businessId: due.businessId, kind: 'morning_summary', conversationId: null, personId: due.personId, summaryDay: due.day,
      } satisfies NotifyJob, { singletonKey: `morning:${due.personId}:${due.day}`, singletonSeconds: 20 * 3600 });
    }
  });

  /**
   * CEIL — every hour, Meta's error rate per workspace (0085): the operator is
   * told of any workspace over the line (src/core/ops/metaErrors.ts), by e-mail
   * always, at most once in six hours — the next hour's check would repeat it.
   */
  /**
   * THE WARMTH RUN (0123) — customers' photos, fetched in the background: a
   * handful every ten minutes, each with its business's own Page token. A
   * business whose Page needs attention is not asked (`faces_due` leaves it
   * out); a look that fails is tried again later, and a kept photo stays.
   */
  await boss.schedule(QUEUES.faces, '*/10 * * * *', {});
  await boss.work(QUEUES.faces, async () => {
    const r = await fetchFaces({
      db,
      look: async (due) => {
        const bid = parseBusinessId(due.businessId);
        if (!bid.ok) return { state: 'failed' };
        const account = await withTenantTx(db, bid.value, (tx) => liveMetaAccount(tx, bid.value));
        const token = account && !account.needsAttention ? metaAccountToken(account, credentialKey) : null;
        if (!token) return { state: 'failed' };
        return metaProfilePhoto({ accessToken: token, graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: metaFetch })(due.channelUserId);
      },
    });
    if (r.looked > 0) console.warn(`[faces] looked at ${r.looked}, kept ${r.kept}`);
  });

  await boss.schedule(QUEUES.metaErrors, '15 * * * *', { businessId: PILOT_BUSINESS_ID } satisfies MetaErrorWatchJob);
  await boss.work<MetaErrorWatchJob>(QUEUES.metaErrors, async ([job]: { data: MetaErrorWatchJob }[]) => {
    if (!job) return;
    const alert = await metaErrorAlert(db, job.data.businessId, new Date());
    if (!alert) return;
    console.warn(`[meta-errors] ${alert.metaErrors?.length ?? 0} workspace(s) over the line`);
    await sendAlert(boss, alert satisfies NotifyJob,
      { singletonKey: 'meta_errors', singletonSeconds: META_ERROR_ALERT_EVERY_HOURS * 3600 });
  });

  /**
   * 0167 — THE DEPLOY ALARM: every ten minutes, does this process have every merge main has had for an hour? A merge
   * that has not arrived is the operator's alert, once per merge; caught up, once more (src/pipeline/deployWatch.ts). Off where the process was not deployed
   * from git (local, a hand upload): it says so once.
   */
  const runningCommit = process.env['RAILWAY_GIT_COMMIT_SHA']?.trim() || null;
  const deployRepo = process.env['RAILWAY_GIT_REPO_OWNER'] && process.env['RAILWAY_GIT_REPO_NAME']
    ? `${process.env['RAILWAY_GIT_REPO_OWNER']}/${process.env['RAILWAY_GIT_REPO_NAME']}` : null;
  if (runningCommit && deployRepo) {
    console.log(`Deploy watch: this process runs ${runningCommit.slice(0, 7)}; main is compared every ten minutes.`);
    await boss.schedule(QUEUES.deployWatch, '*/10 * * * *', { businessId: PILOT_BUSINESS_ID } satisfies DeployWatchJob);
    await boss.work<DeployWatchJob>(QUEUES.deployWatch, async ([job]: { data: DeployWatchJob }[]) => {
      if (!job) return;
      await deployWatchSweep({
        db, running: runningCommit, readMain: () => readMainChain(deployRepo, runningCommit), operatorBusinessId: job.data.businessId,
        send: async (j, key) => { await sendAlert(boss, j satisfies NotifyJob, { singletonKey: key }); },
      });
    });
  } else {
    await boss.unschedule(QUEUES.deployWatch).catch(() => undefined);
    console.log('Deploy watch: off — this process was not deployed from git (no RAILWAY_GIT_COMMIT_SHA).');
  }

  /**
   * CC-10 — no error waits for ever behind the hourly limit. At most six error
   * alerts leave in an hour; one owed while the hour is full is held and
   * counted in the next alert. When the flood has stopped there may be no
   * next one, so every five minutes the oldest held error gets the alert it
   * was owed, once the hour has room (src/db/appErrors.ts).
   */
  await erasePracticeDaily();

  // G1 — the operator's list of the last day's sign-ups, once a day.
  await boss.schedule(QUEUES.signupDigest, '15 7 * * *', {});
  await boss.work(QUEUES.signupDigest, async () => {
    const digest = await signupDigestAlert(db, PILOT_BUSINESS_ID, new Date());
    if (!digest) return;
    await sendAlert(boss, digest satisfies NotifyJob, { singletonKey: 'signup_digest', singletonSeconds: 23 * 3600 });
  });

  // G3 — every five minutes: an owner whose workspace crossed 80% or 100% of
  // today's allowance is told, once a day per line (the claim keeps the count).
  // R5 — and an owner whose assistant stepped back on its own is told, once.
  await boss.schedule(QUEUES.allowance, '*/5 * * * *', {});
  await boss.work(QUEUES.allowance, async () => {
    // KS5 — and the operator, once a day, when the installation passes its ceiling.
    const breaker = await spendBreakerAlert(db, PILOT_BUSINESS_ID);
    // BILL — a subscription for each workspace whose first channel connected with a card saved; then its e-mails, each once.
    if (stripe) await subscribeSweep(db, stripe.client, new Date()).catch((e: unknown) => console.warn(`[billing] sweep: ${loggableMessage(e instanceof Error ? e.message : String(e))}`));
    // KS6 — and each decision on a first connection, told to its owner once.
    for (const job of [...await allowanceAlerts(db, new Date()), ...await demotionAlerts(db), ...(breaker ? [breaker] : []), ...await connectionDecisionAlerts(db), ...await billingAlerts(db)]) {
      await sendAlert(boss, job satisfies NotifyJob);
    }
  });

  // RET (0116) is RETIRED (0126, the owner's direction of 2026-10-04): nothing
  // is erased after 90 days, so nothing warns of it. Its daily job had a
  // schedule in pg-boss's own table; 0126 removed it, and so does every boot,
  // in case an older instance wrote it back before it stopped.
  await unscheduleRetired(boss);

  // R5 — once a day: spot checks offered on work that went out alone.
  await boss.schedule(QUEUES.spotChecks, '20 5 * * *', {});
  await boss.work(QUEUES.spotChecks, async () => {
    const n = await spotCheckSweep(db);
    if (n > 0) console.log(`[spot checks] ${n} offered on work sent alone`);
  });

  // G5b — a reply waiting past the day its channel allows is marked expired:
  // the owner sees why it was never sent, not a Send the channel refuses.
  await boss.schedule(QUEUES.draftExpiry, '*/10 * * * *', {});
  await boss.work(QUEUES.draftExpiry, async () => {
    const n = await expireWaitingDrafts(db);
    if (n > 0) console.log(`[drafts] ${n} waiting repl${n === 1 ? 'y' : 'ies'} past the channel's day marked expired`);
  });

  await boss.schedule(QUEUES.errors, '*/5 * * * *', { businessId: PILOT_BUSINESS_ID } satisfies ErrorSweepJob);
  await boss.work<ErrorSweepJob>(QUEUES.errors, async ([job]: { data: ErrorSweepJob }[]) => {
    if (!job) return;
    await errors.releaseHeld();
  });

  // The provider that carried THIS channel's event: Meta for the Page and
  // Instagram, whichever was selected for WhatsApp. It was the WhatsApp
  // adapter's for every channel, which on a 360dialog installation would have
  // recorded an Instagram message as theirs.
  const inboundAdapters: Record<string, ChannelAdapter> = Object.fromEntries(
    [...(adapter ? [adapter] : []), ...Object.values(socialIngress), ...(telegramBot ? [telegramBot.adapter] : [])].map((a) => [a.kind, a]),
  );
  const providerOf: Record<string, string> = Object.fromEntries(
    Object.values(inboundAdapters).map((a) => [a.kind, a.provider]),
  );

  /**
   * The buyer's name for a channel whose webhook carries none. Asked ONLY when
   * it would fill a blank — a known, named buyer costs no call — and outside
   * the tenant transaction, because it is a network call and a name is not
   * worth holding a connection for. Whatever the channel answers, the message
   * is recorded; she can name him on his page.
   */
  const nameFor = async (bid: BusinessId, channel: string, e: { waId: string; profileName: string | null }) => {
    if (e.profileName) return e.profileName;
    if (channel !== 'instagram' && channel !== 'messenger') return null;
    const known = await withTenantTx(db, bid, (tx) => knownClientName(tx, channel, e.waId));
    if (known) return known;
    // C10 — with the business's OWN Page token when it connected one; the
    // environment's account otherwise.
    const account = await withTenantTx(db, bid, (tx) => liveMetaAccount(tx, bid));
    const token = account && !account.needsAttention ? metaAccountToken(account, credentialKey) : null;
    const ask = token
      ? metaProfileLookup({ channel, accessToken: token, graphVersion: cfg.META_GRAPH_API_VERSION, fetchImpl: metaFetch })
      : inboundAdapters[channel]?.nameOf;
    return ask ? ask(e.waId) : null;
  };

  // The stored-once gate and the turn's queue, for every channel's events (the webhooks, and S7's chat page).
  const persistEvent = async (e: ChannelEvent, rawPayload: unknown, channel: string): Promise<'new' | 'duplicate'> => {
      const bid = await resolveTenant(e.phoneNumberId, channel);
      if (!bid) return 'duplicate';   // unknown credential: ack, never process
      // D4 (2026-10-12) — a frozen workspace (its subscription lapsed) receives nothing: the event is
      // acknowledged and dropped, never stored, and no turn runs. The channel stays connected, so renewing
      // resumes at once.
      if (await withTenantTx(db, bid, (tx) => billingHeld(tx))) return 'duplicate';
      return withTenantTx(db, bid, async (tx) => {
        const r = await sql<{ id: string }>`
          insert into channel_events
            (id, business_id, channel, provider, event_type, conversation_external_id, payload, occurred_at)
          values
            (${e.dedupKey}, ${bid}, ${channel}, ${providerOf[channel] ?? 'unknown'},
             ${e.kind === 'message' ? 'message.inbound' : e.kind === 'echo' ? 'message.echo' : 'status'},
             ${e.kind === 'message' || e.kind === 'echo' ? `${channel}:${e.waId}:${e.phoneNumberId}` : null},
             ${JSON.stringify(rawPayload)}::jsonb, ${e.occurredAt})
          on conflict (id) do nothing
          returning id
        `.execute(tx);
        return r.rows.length > 0 ? 'new' : 'duplicate';
      });
    };

  const onNewEvent = async (e: ChannelEvent, channel: string): Promise<void> => {
      const bid = await resolveTenant(e.phoneNumberId, channel);
      if (!bid) return;

      if (e.kind === 'message') {
        const profileName = await nameFor(bid, channel, e);
        const { conversationId } = await withTenantTx(db, bid, async (tx) => {
          const conv = await ensureConversation(tx, bid, e.waId, profileName,
            channel as 'whatsapp' | 'instagram' | 'messenger');
          // Health signals live on the channel row: "when did anything arrive".
          await sql`
            update channels
               set last_inbound_at = ${e.occurredAt}, last_webhook_at = now(), updated_at = now()
             where business_id = ${bid} and kind = ${channel}
          `.execute(tx);
          // G10b — the 24-hour window is THIS buyer's. It lived on the channel
          // row, which any buyer's message moved, so one chatty buyer kept a
          // silent one's window open and Meta rejected what the gate allowed.
          // `greatest`, because webhooks can arrive out of order.
          await sql`
            update client_channels
               set last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), ${e.occurredAt})
             where channel = ${channel} and channel_user_id = ${e.waId}
          `.execute(tx);
          return conv;
        });
        await enqueueInbound(boss, {
          businessId: bid, conversationId,
          messageId: e.eventId, text: e.text ?? '',
          // M34 — the parser has captured these since M3; nothing carried them
          // past the webhook until now, which is why a voice note arrived as
          // empty text and was answered as though nothing had been said.
          messageType: e.messageType, mediaId: e.mediaId,
          // G2c — what it WAS, so an unreadable message reaches a person by name.
          received: e.received,
          // CH7a — and what it points at, so the owner can open it.
          ...(e.ref ? { ref: e.ref } : {}),
          // CH7 — and the shop's own post it is about, so its caption can be read.
          ...(e.postId ? { postId: e.postId } : {}),
        });
      } else if (e.kind === 'echo') {
        // CH3 — read a little later, so a send of ours has written its id first.
        if (channel !== 'instagram' && channel !== 'messenger') return;
        await boss.send(QUEUES.echo, {
          businessId: bid, channel, mid: e.eventId, customer: e.waId, account: e.phoneNumberId,
          text: e.text, received: e.received, appId: e.appId, occurredAt: e.occurredAt.toISOString(),
        } satisfies EchoJob, { startAfter: overrides?.echoSettleSeconds ?? ECHO_SETTLE_SECONDS, singletonKey: e.dedupKey });
      } else {
        const r = await withTenantTx(db, bid, (tx) =>
          channelStore(tx, bid).reconcileStatus(e.eventId, e.status, e.errorDetail));
        if (r.conversationId) {
          await boss.send(QUEUES.outbound,
            { businessId: bid, conversationId: r.conversationId },
            { singletonKey: r.conversationId });
        }
      }
    };

  /**
   * S7 — the chat page's message: stored once and queued exactly as a webhook's. A page switched off, or a frozen
   * workspace, takes nothing (`persistEvent` answers 'duplicate' for both, as it does a webhook's).
   */
  ingestWebChat = async (e: InboundMessageEvent): Promise<'new' | 'duplicate' | 'refused'> => {
    const page = await resolveTenant(e.phoneNumberId, 'web_chat');
    if (!page || await withTenantTx(db, page, (tx) => billingHeld(tx))) return 'refused';
    const r = await persistEvent(e, { text: e.text }, 'web_chat');
    if (r === 'new') await onNewEvent(e, 'web_chat');
    return r;
  };

  /**
   * S7 — which business a Telegram message is for. "/start <code>" (the business's own link) ties the chat to that
   * business — a handle there, and the newest, so it is the one written to — and is not itself a message. Anything
   * else goes to the business the chat started last, while it has Telegram on; a chat that started none, to nobody.
   */
  const routeTelegram = async (e: InboundMessageEvent): Promise<ChannelEvent | null> => {
    const text = (e.text ?? '').trim();
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start) {
      const code = start[1] && START_CODE.test(start[1]) ? start[1] : null;
      const bid = code ? await resolveTenant(code, 'telegram') : null;
      if (bid && !(await withTenantTx(db, bid, (tx) => billingHeld(tx)))) {
        await withTenantTx(db, bid, async (tx) => {
          await ensureConversation(tx, bid, e.waId, e.profileName, 'telegram');
          await sql`update client_channels set last_inbound_at = ${e.occurredAt} where channel = 'telegram' and channel_user_id = ${e.waId}`.execute(tx);
        });
      }
      return null;
    }
    const code = await telegramRoute(db, e.waId);
    return code ? { ...e, phoneNumberId: code } : null;
  };

  const app = buildIngressApp({
    ...(adapter ? { adapter } : {}),
    verifyToken: cfg.WEBHOOK_VERIFY_TOKEN,
    logger: overrides?.logger ?? true,
    // C9 — one path per channel, so a payload delivered to the wrong one is a
    // 401 rather than a message parsed into the wrong conversation.
    also: [
      ...(socialIngress.instagram ? [{ path: '/webhook/instagram', adapter: socialIngress.instagram }] : []),
      ...(socialIngress.messenger ? [{ path: '/webhook/messenger', adapter: socialIngress.messenger }] : []),
      // S7 — Telegram signs with the secret its webhook was set with, in its own header.
      ...(telegramBot ? [{ path: '/webhook/telegram', adapter: telegramBot.adapter, signatureHeader: 'x-telegram-bot-api-secret-token' }] : []),
    ],
    route: async (e, channel) => (channel === 'telegram' && e.kind === 'message' ? routeTelegram(e) : e),

    persistEvent,
    onNewEvent,
  });

  // /health's `provider` is WhatsApp's, as it always was: 'disabled' here means
  // the number is not configured, while `channels` on the process says what is.
  mountHealth(app, whatsappHere ? 'active' : 'disabled');
  mountCommandCenter(app);
  return finalize(app);
}

/** ── CLI ────────────────────────────────────────────────────────────────── */

const isMain = process.argv[1] !== undefined &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  loadDotEnv();
  const generated = ensureGeneratedSecrets();
  if (generated.length) {
    console.error(`generated internal secrets (values in .env, never logged): ${generated.join(', ')}`);
  }
  // Before the database, before validateEnv: a generated CREDENTIAL_KEY means
  // the stored credentials are already orphaned, and every further step makes
  // it worse. Refuse in production; warn elsewhere.
  assertStableCredentialKey(generated, { production: process.env['NODE_ENV'] === 'production' });
  const v = validateEnv(process.env);
  if (!v.ok) {
    console.error('environment invalid:\n  ' + v.problems.join('\n  '));
    process.exit(1);
  }

  const prod = await buildProduction(v.cfg);
  // CC-10 — a crash is written down, and the operator told, before the process
  // ends with code 1 as it always did (Railway restarts it).
  installCrashReporting(process, {
    report: prod.reportError,
    exit: (code) => process.exit(code),
    log: (line, err) => console.error(line, loggableLine(err)),
  });
  await prod.app.listen({ port: v.cfg.PORT, host: '0.0.0.0' });
  // CC-10 — the dead-man's switch: only now that /health can answer on loopback.
  await startHeartbeat(prod.boss, { url: v.cfg.HEALTH_PING_URL ?? null, port: v.cfg.PORT, db: prod.db, model: prod.primaryModel });
  if (prod.ownerAccessCodeGenerated) {
    // The owner needs this to log into the command center. Set OWNER_ACCESS_CODE
    // in the host to make it stable across deploys.
    prod.app.log.warn(`command center login code (set OWNER_ACCESS_CODE to fix): ${prod.ownerAccessCode}`);
  }
  prod.app.log.info(
    { port: v.cfg.PORT, provider: v.cfg.provider, channels: prod.channels },
    prod.channels.length === 0
      ? 'nomi up in deployment mode (health + worker infra, no messaging)'
      : 'nomi production up (webhook + worker)',
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;                 // idempotent: second signal is a no-op
    shuttingDown = true;
    prod.app.log.info({ signal }, 'shutdown started');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();                            // bounded: never hang a deploy
    void prod.close().then(() => {
      prod.app.log.info('shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
