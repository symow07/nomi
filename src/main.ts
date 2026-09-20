import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { startWorker } from './worker/main.js';
import { mediaPortsFor, type MediaPorts } from './worker/mediaPorts.js';
import { buildIngressApp } from './api/ingress.js';
import { registerWebApp } from './api/web/app.js';
import { anthropicAnalyzer, anthropicReplyWriter, anthropicPageTranscriber } from './llm/anthropic.js';
import { llmClient, llmProviderFrom, requestExtrasFor } from './llm/provider.js';
import { aiProcessor, processorForLog, HOSTING } from './core/legal/processors.js';
import { readNewMail } from './channels/email/inboxReader.js';
import { businessesReadingInbox } from './db/mailAccounts.js';
import { SANDBOX_BUSINESS_ID } from './demo/sandbox.js';
import { signupModeFrom } from './core/owner/signup.js';
import { systemSmtpConfigFrom, systemMailer, mailboxSystemMailer, firstThatSends, type SystemMail } from './channels/email/systemMail.js';
import { liveBusinessIds } from './db/accounts.js';
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
import { socialAppSecret, metaProfileLookup, type MetaFetch } from './channels/meta/messaging.js';
import { metaLoginFrom, metaAccountToken } from './channels/meta/connect.js';
import { liveMetaAccount, markMetaAccountNeedsAttention, type MetaAccount } from './db/metaAccounts.js';
import { messengerAdapter } from './channels/messenger/adapter.js';
import { gmailSender, graphSender } from './channels/email/senders.js';
import { oauthClientsFrom, type OAuthFetch } from './connectors/oauth.js';
import { mintUnsubscribe, unsubscribeHeaders } from './outbound/unsubscribe.js';
import { deriveKey } from './security/credentials.js';
import { apolloSource } from './connectors/apollo.js';
import { metaAdapter } from './channels/whatsapp/meta.js';
import { withTenantTx, lockConversation, type Db } from './db/client.js';
import { channelStore, ensureConversation, enqueueOutboundRow, knownClientName } from './db/channels.js';
import { driveConversationOutbound, type MailEnvelope } from './outbound/worker.js';
import { QUEUES, enqueueInbound, type NotifyJob, type InboundJob, type SequenceSweepJob } from './queue/boss.js';
import { runDueSteps } from './outbound/sequences.js';
import { deliverOwnerAlert } from './pipeline/notify.js';
import { parseBusinessId, type BusinessId } from './core/types/ids.js';
import { markSmall } from './core/owner/brand.js';
import type { Locale } from './core/owner/i18n/locale.js';
import type { ChannelAdapter } from './channels/contract.js';
import type { PgBoss } from 'pg-boss';

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
};

export function validateEnv(env: Record<string, string | undefined>):
  | { ok: true; cfg: ProdConfig }
  | { ok: false; problems: string[] } {
  const problems: string[] = [];

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
      CREDENTIAL_KEY: env['CREDENTIAL_KEY']!,
      PORT: Number(env['PORT']) || 8787,
      META_GRAPH_API_VERSION: graphVersion,
      ...pick('D360_API_KEY'), ...pick('D360_BASE_URL'), ...pick('WEBHOOK_SECRET'),
      ...pick('META_WHATSAPP_ACCESS_TOKEN'), ...pick('META_WHATSAPP_PHONE_NUMBER_ID'),
      ...pick('META_WHATSAPP_BUSINESS_ACCOUNT_ID'), ...pick('META_APP_SECRET'),
      ...(env['TRANSCRIBE_API_KEY'] ? pick('TRANSCRIBE_API_KEY') : {}),
      ...(env['TRANSCRIBE_BASE_URL'] ? pick('TRANSCRIBE_BASE_URL') : {}),
      ...(env['PUBLIC_BASE_URL'] ? pick('PUBLIC_BASE_URL') : {}),
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
  close(): Promise<void>;
};

export async function buildProduction(
  cfg: ProdConfig,
  overrides?: {
    adapter?: ChannelAdapter;
    logger?: boolean;
    /** A3 — tests read the code out of what would have been mailed. */
    systemMail?: SystemMail;
    /**
     * G2b — the transcriber and media fetchers, beside `adapter` and for the
     * same reason: a test that swaps the provider must also swap where media
     * comes from, or a simulated voice note would be fetched from Meta.
     */
    media?: MediaPorts;
    /** G2b — model ports, tests only; production builds them from the key. */
    models?: Parameters<typeof startWorker>[2];
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
  },
): Promise<Production> {
  // Worker first: it owns the pool and pg-boss; ingress reuses both.
  // G2b — and it is handed the ports it needs to hear and see. Before this
  // call carried them, both paths were dead in production however the host
  // was configured.
  // G13 — ONE set of media ports for this process: the worker hears with them
  // and the Command Center plays back through the same fetcher. Built once, so
  // a test that injects its own cannot end up with the web app using another.
  const mediaPorts = overrides?.media ?? mediaPortsFor(cfg);
  const { db, boss } = await startWorker({
    DATABASE_URL: cfg.DATABASE_URL, ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
    // G11 — the worker mints the proof link a quote carries, so it needs the
    // address as much as the web app does.
    ...(cfg.PUBLIC_BASE_URL ? { PUBLIC_BASE_URL: cfg.PUBLIC_BASE_URL } : {}),
  }, mediaPorts, overrides?.models ?? {});

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
  const PILOT_BUSINESS_ID = process.env['PILOT_BUSINESS_ID'] ?? 'de300000-0000-4000-8000-0000000000b1';
  const SANDBOX_ID = process.env['SANDBOX_BUSINESS_ID'] ?? SANDBOX_BUSINESS_ID;
  await assertPilotTenant(db, {
    pilotBusinessId: PILOT_BUSINESS_ID,
    sandboxBusinessId: SANDBOX_ID,
    production: process.env['NODE_ENV'] === 'production',
  });

  // /health is the one route both modes share. providerStatus reports the
  // messaging surface; db is probed live; the worker infra is up in both modes.
  const mountHealth = (a: FastifyInstance, providerStatus: 'active' | 'disabled') => {
    a.get('/health', async (_req, reply) => {
      let dbOk = false;
      try { await sql`select 1`.execute(db); dbOk = true; } catch { /* → 503 */ }
      return reply.code(dbOk ? 200 : 503)
        .send({ ok: dbOk, db: dbOk, worker: true, provider: providerStatus });
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

  const whatsappHere = overrides?.adapter !== undefined || cfg.provider !== 'disabled';
  const channelsHere: readonly string[] = [
    ...(whatsappHere ? ['whatsapp'] : []),
    ...Object.keys(socialIngress),
  ];

  const webSessionSecret = createHmac('sha256', cfg.CREDENTIAL_KEY).update('yf-web-session').digest('hex');
  /**
   * C6 — this installation's own OAuth apps. Each provider needs BOTH its id and
   * its secret; half a pair is not configured, and says so at boot rather than
   * sending her to a provider page that will refuse the app.
   */
  const oauthClients = oauthClientsFrom(process.env);

  const TEMPLATE_STATE = templateState({
    providerConfigured: cfg.provider !== 'disabled',
    approvedTemplates: parseApprovedTemplates(process.env['META_TEMPLATE_NAMES']),
  });
  // N6a — one provider for every model-backed part of this process.
  const llm = llmProviderFrom(process.env, cfg.ANTHROPIC_API_KEY);
  if (llm.name === 'custom') console.log(`Model provider: ${new URL(llm.baseURL!).host} · ${llm.model}`);
  // The privacy page names this company. Derived here, from the same provider
  // the model client is built from, so the two can never disagree again.
  const legalFacts = { processor: aiProcessor(llm.baseURL), hosting: HOSTING };
  console.log(`Privacy page names: ${processorForLog(legalFacts.processor)} · hosted on ${processorForLog(HOSTING)}`);
  if (legalFacts.processor.country === null) {
    console.warn(`Model provider ${legalFacts.processor.name} is not a host this build can name a country for — the privacy page will not state where messages are processed.`);
  }
  // M12.2: Live-AI sandbox is opt-in (it spends Anthropic tokens). Default is
  // scripted-only; set SANDBOX_LIVE_AI=1 to offer the Live AI mode.
  const sandboxLive = process.env['SANDBOX_LIVE_AI'] === '1'
    ? ((c) => ({ analyzer: anthropicAnalyzer(c, llm.model, requestExtrasFor(llm)), replyWriter: anthropicReplyWriter(c, llm.model, requestExtrasFor(llm)) }))(llmClient(llm))
    : {};
  // M37 — the page reader, wired at the production entrypoint. A feature whose
  // tests pass is not built; a feature a route reaches is. Absent key → absent
  // port → the photo path refuses and says so, which is the designed state.
  const pageTranscriber = anthropicPageTranscriber(llmClient(llm), llm.model, requestExtrasFor(llm));
  const mountCommandCenter = (a: FastifyInstance) => {
    registerWebApp(a, {
      db,
      pageTranscriber,
      sessionSecret: webSessionSecret,
      accessCode: ownerAccessCode,
      businessId: PILOT_BUSINESS_ID,
      // A1 — who may create a workspace here. Unset is 'invite'.
      signupMode: signupModeFrom(process.env['SIGNUP_MODE']),
      // A3 — the installation's own sender. Unset, nothing ever asks for a code.
      systemMail,
      templateState: TEMPLATE_STATE,
      // G11 — so the owner's copy of a proof link is one she can send.
      publicBaseUrl: cfg.PUBLIC_BASE_URL ?? null,
      // G13 — the same fetcher the worker hears with, so she can play a note.
      ...(mediaPorts.audio ? { audio: mediaPorts.audio } : {}),
      kickAnswer: (businessId, conversationId, messageId, text) =>
        boss.send(QUEUES.inbound, {
          businessId, conversationId, messageId, text, answerOnly: true,
        } satisfies InboundJob, { retryLimit: 1 }).then(() => undefined),
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
    prospectSourceFor: (apiKey: string) => apolloSource({ apiKey }),
    // C6 — connecting her mailbox; the redirect goes back to PUBLIC_BASE_URL.
    oauthClients,
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
    // Her own mail server (SMTP), so the accounts page can say what actually sends.
    smtpFrom: smtpConfig?.from ?? null,
      sandboxBusinessId: SANDBOX_ID,
      employeeName: process.env['EMPLOYEE_NAME'] ?? '小雅',
      // Named on /privacy and /data-deletion; absent, those pages say to write
      // to the business from the account you used.
      legalContact: process.env['LEGAL_CONTACT_EMAIL']?.trim() || null,
      legalFacts,
      // The mark is the default; an operator who sets EMPLOYEE_AVATAR still gets
      // their emoji, unchanged. The small cut, because the header avatar is 30px.
      avatar: process.env['EMPLOYEE_AVATAR'] ?? markSmall(30, null),
      provider: cfg.provider,
      // Whether anything queued from these pages will leave: the outbound
      // worker runs whenever some channel is here, WhatsApp or not.
      messagingEnabled: channelsHere.length > 0,
      secureCookie: process.env['NODE_ENV'] === 'production',
      // The EXISTING outbound path — the same QUEUES.outbound worker the turn
      // pipeline uses. applyOwnerCommand (inbox actions) sends through this.
      kickOutbound: async (businessId, conversationId, reply) => {
        await boss.send(QUEUES.outbound, { businessId, conversationId, reply },
          { singletonKey: conversationId });
      },
      // M16.1: bare re-drive tick — delivers an owner takeover reply through the
      // SAME outbound worker (no second send path).
      kickDrive: async (businessId, conversationId) => {
        await boss.send(QUEUES.outbound, { businessId, conversationId },
          { singletonKey: conversationId });
      },
      ...sandboxLive,
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
    app: a, db, boss, ownerAccessCode, ownerAccessCodeGenerated: !process.env['OWNER_ACCESS_CODE'],
    channels: channelsHere,
    async close() {
      if (closing) return;
      closing = true;
      await a.close();                         // 1. stop accepting requests
      await boss.stop().catch(() => {});       // 2–3. stop workers + pg-boss
      await db.destroy().catch(() => {});      // 5. release the pool
    },
  });

  // DEPLOYMENT MODE: full stack up, NO messaging surface. No adapter, no
  // webhook routes, no outbound worker — for hosting before ANY channel is
  // configured. An override adapter (tests) always takes the messaging path so
  // composition stays covered.
  if (channelsHere.length === 0) {
    const app = Fastify({ logger: overrides?.logger ?? true });
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

  // Outbound drive: consumes both reply jobs (from turn effects) and bare
  // re-drive ticks (from status webhooks / wait-recheck).
  type DriveJob = { businessId: string; conversationId: string; reply?: string };
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
  const credentialKey = deriveKey(cfg.CREDENTIAL_KEY);
  const oauthFetch = fetch as unknown as OAuthFetch;
  const tokenCache = new Map<string, { token: string; until: number }>();
  const mailSenders = { google: gmailSender(oauthFetch), microsoft: graphSender(oauthFetch) };
  // A3 — built here, where its parts exist; called only when a code is mailed.
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

  const adaptersFor = (businessId: BusinessId, metaAccount: MetaAccount | null = null) => {
    const email = emailAdapter({
      transport: overrides?.mailTransport ?? (smtpConfig
        ? smtpMailTransport({ db, businessId, config: smtpConfig })
        : accountMailTransport({
          db, businessId, credentialKey, clients: oauthClients, senders: mailSenders,
          fetchImpl: oauthFetch, cache: tokenCache,
        })),
    });
    const byChannel: Record<string, ChannelAdapter | undefined> = {
      ...(adapter ? { [adapter.kind]: adapter } : {}), email, ...metaAdaptersFor(businessId, metaAccount),
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
    return {
      headers: unsubscribeHeaders(`${cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/u?t=${encodeURIComponent(token)}`),
      tag: token,
    };
  };

  await boss.work<DriveJob>(QUEUES.outbound, async ([job]: { data: DriveJob }[]) => {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    if (!businessId.ok || !job.data.conversationId) return;   // poison: drop

    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, job.data.conversationId);
      if (job.data.reply) {
        await enqueueOutboundRow(tx, businessId.value, job.data.conversationId, job.data.reply);
      }
      const store = channelStore(tx, businessId.value, { template: TEMPLATE_STATE });
      // C10 — read inside the same transaction as the send it authorises, so a
      // disconnect takes effect on the next reply, not the next boot.
      const metaAccount = await liveMetaAccount(tx, businessId.value);
      return driveConversationOutbound(
        {
          store, ...(adapter ? { adapter } : {}), adapters: adaptersFor(businessId.value, metaAccount),
          mailHeaders: mailHeadersFor(businessId.value), now: () => new Date(),
        },
        job.data.conversationId,
      );
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
  });

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
        }, tenant, new Date()).catch((e: unknown) => { console.warn('[domain-check]', e instanceof Error ? e.message : e); return 'checked' as const; });
        if (r === 'checked') lookedUp++;
      }
      if (spent()) return;
      await runDueSteps(sequenceDeps, tenant)
        .catch((e: unknown) => console.warn('[sequences]', e instanceof Error ? e.message : e));
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
      .catch((e: unknown) => { console.warn('[inbox]', e instanceof Error ? e.message : e); return [] as readonly string[]; });
    for (const id of readable) {
      const b = parseBusinessId(id);
      if (!b.ok) continue;
      const tenant = b.value;
      if (spent() || inboxesRead >= INBOX_READS_PER_SWEEP) return;
      const read = await readNewMail({
        db, credentialKey, clients: oauthClients, fetchImpl: oauthFetch, cache: tokenCache,
        ownAddresses: systemSmtp ? [systemSmtp.from, systemSmtp.user] : [],
        enqueue: (job) => enqueueInbound(boss, { ...job, messageType: 'text' }),
      }, tenant).catch((e: unknown) => { console.warn('[inbox]', e instanceof Error ? e.message : e); return null; });
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
  await boss.work<NotifyJob>(QUEUES.notify, async ([job]: { data: NotifyJob }[]) => {
    if (!job) return;
    await deliverOwnerAlert({ db, adapter: adapter ?? noNumberForAlerts }, job.data);   // throws on retryable failure → pg-boss retries
  });

  // The provider that carried THIS channel's event: Meta for the Page and
  // Instagram, whichever was selected for WhatsApp. It was the WhatsApp
  // adapter's for every channel, which on a 360dialog installation would have
  // recorded an Instagram message as theirs.
  const inboundAdapters: Record<string, ChannelAdapter> = Object.fromEntries(
    [...(adapter ? [adapter] : []), ...Object.values(socialIngress)].map((a) => [a.kind, a]),
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

  const app = buildIngressApp({
    ...(adapter ? { adapter } : {}),
    verifyToken: cfg.WEBHOOK_VERIFY_TOKEN,
    logger: overrides?.logger ?? true,
    // C9 — one path per channel, so a payload delivered to the wrong one is a
    // 401 rather than a message parsed into the wrong conversation.
    also: [
      ...(socialIngress.instagram ? [{ path: '/webhook/instagram', adapter: socialIngress.instagram }] : []),
      ...(socialIngress.messenger ? [{ path: '/webhook/messenger', adapter: socialIngress.messenger }] : []),
    ],

    persistEvent: async (e, rawPayload, channel) => {
      const bid = await resolveTenant(e.phoneNumberId, channel);
      if (!bid) return 'duplicate';   // unknown credential: ack, never process
      return withTenantTx(db, bid, async (tx) => {
        const r = await sql<{ id: string }>`
          insert into channel_events
            (id, business_id, channel, provider, event_type, conversation_external_id, payload, occurred_at)
          values
            (${e.dedupKey}, ${bid}, ${channel}, ${providerOf[channel] ?? 'unknown'},
             ${e.kind === 'message' ? 'message.inbound' : 'status'},
             ${e.kind === 'message' ? `${channel}:${e.waId}:${e.phoneNumberId}` : null},
             ${JSON.stringify(rawPayload)}::jsonb, ${e.occurredAt})
          on conflict (id) do nothing
          returning id
        `.execute(tx);
        return r.rows.length > 0 ? 'new' : 'duplicate';
      });
    },

    onNewEvent: async (e, channel) => {
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
        });
      } else {
        const r = await withTenantTx(db, bid, (tx) =>
          channelStore(tx, bid).reconcileStatus(e.eventId, e.status, e.errorDetail));
        if (r.conversationId) {
          await boss.send(QUEUES.outbound,
            { businessId: bid, conversationId: r.conversationId },
            { singletonKey: r.conversationId });
        }
      }
    },
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
  await prod.app.listen({ port: v.cfg.PORT, host: '0.0.0.0' });
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
