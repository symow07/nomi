import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import Anthropic from '@anthropic-ai/sdk';
import { startWorker } from './worker/main.js';
import { mediaPortsFor, type MediaPorts } from './worker/mediaPorts.js';
import { buildIngressApp } from './api/ingress.js';
import { registerWebApp } from './api/web/app.js';
import { anthropicAnalyzer, anthropicReplyWriter, anthropicPageTranscriber } from './llm/anthropic.js';
import { SANDBOX_BUSINESS_ID } from './demo/sandbox.js';
import { META_SHAPE } from './core/channel/metaReadiness.js';
import { assertSafeRuntimeRole } from './db/runtimeIdentity.js';
import { assertSchemaCurrent } from './db/schemaVersion.js';
import { assertPilotTenant } from './db/pilotTenant.js';
import { templateState, parseApprovedTemplates } from './core/channel/templateReadiness.js';
import { resolveSendingRecords } from './outbound/dns.js';
import { whatsappAdapter } from './channels/whatsapp/adapter.js';
import { emailAdapter } from './channels/email/adapter.js';
import { fakeMailTransport, type MailTransport } from './channels/email/transport.js';
import { mintUnsubscribe, unsubscribeHeaders } from './outbound/unsubscribe.js';
import { metaAdapter } from './channels/whatsapp/meta.js';
import { withTenantTx, lockConversation, type Db } from './db/client.js';
import { channelStore, ensureConversation, enqueueOutboundRow } from './db/channels.js';
import { driveConversationOutbound } from './outbound/worker.js';
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
  ANTHROPIC_API_KEY: (v) => v.length >= 20,
  WEBHOOK_VERIFY_TOKEN: (v) => v.length >= 16,
  CREDENTIAL_KEY: (v) => /^[0-9a-f]{64}$/i.test(v),
};
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
      ANTHROPIC_API_KEY: env['ANTHROPIC_API_KEY']!,
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
  close(): Promise<void>;
};

export async function buildProduction(
  cfg: ProdConfig,
  overrides?: {
    adapter?: ChannelAdapter;
    logger?: boolean;
    /**
     * G2b — the transcriber and media fetchers, beside `adapter` and for the
     * same reason: a test that swaps the provider must also swap where media
     * comes from, or a simulated voice note would be fetched from Meta.
     */
    media?: MediaPorts;
    /** G2b — model ports, tests only; production builds them from the key. */
    models?: Parameters<typeof startWorker>[2];
    /**
     * C4.a — the mail transport. Absent is the recording fake, which is what
     * every environment has until a provider arrives with M52: it keeps what
     * would have left, so a test can assert the subject, the recipient and the
     * unsubscribe headers rather than only that something was called.
     */
    mailTransport?: MailTransport;
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
  const webSessionSecret = createHmac('sha256', cfg.CREDENTIAL_KEY).update('yf-web-session').digest('hex');

  const TEMPLATE_STATE = templateState({
    providerConfigured: cfg.provider !== 'disabled',
    approvedTemplates: parseApprovedTemplates(process.env['META_TEMPLATE_NAMES']),
  });
  // M12.2: Live-AI sandbox is opt-in (it spends Anthropic tokens). Default is
  // scripted-only; set SANDBOX_LIVE_AI=1 to offer the Live AI mode.
  const sandboxLive = process.env['SANDBOX_LIVE_AI'] === '1'
    ? ((c) => ({ analyzer: anthropicAnalyzer(c), replyWriter: anthropicReplyWriter(c) }))(new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }))
    : {};
  // M37 — the page reader, wired at the production entrypoint. A feature whose
  // tests pass is not built; a feature a route reaches is. Absent key → absent
  // port → the photo path refuses and says so, which is the designed state.
  const pageTranscriber = anthropicPageTranscriber(new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }));
  const mountCommandCenter = (a: FastifyInstance) => {
    registerWebApp(a, {
      db,
      pageTranscriber,
      sessionSecret: webSessionSecret,
      accessCode: ownerAccessCode,
      businessId: PILOT_BUSINESS_ID,
      templateState: TEMPLATE_STATE,
      // G11 — so the owner's copy of a proof link is one she can send.
      publicBaseUrl: cfg.PUBLIC_BASE_URL ?? null,
      // G13 — the same fetcher the worker hears with, so she can play a note.
      ...(mediaPorts.audio ? { audio: mediaPorts.audio } : {}),
      kickAnswer: (businessId, conversationId, messageId, text) =>
        boss.send(QUEUES.inbound, {
          businessId, conversationId, messageId, text, answerOnly: true,
        } satisfies InboundJob, { retryLimit: 1 }).then(() => undefined),
    // M40.1 — the real resolver. `SENDING_SPF_INCLUDE` arrives with the sending
    // provider (M52); until then the SPF check cannot confirm authorisation and
    // says so, which refuses rather than assumes.
    resolveDns: resolveSendingRecords,
    sendingInclude: process.env['SENDING_SPF_INCLUDE'] ?? null,
    // M40.2 — absent mounts no webhook, exactly as an absent WhatsApp provider
    // mounts none. There is nothing to verify a caller with.
    emailWebhookSecret: process.env['EMAIL_WEBHOOK_SECRET'] ?? null,
    // G3 — the number "Connect this number" connects, from the validated
    // config. Only Meta names one; without it the page shows the guide.
    connectableNumber: cfg.provider === 'meta' ? (cfg.META_WHATSAPP_PHONE_NUMBER_ID ?? null) : null,
      sandboxBusinessId: SANDBOX_ID,
      employeeName: process.env['EMPLOYEE_NAME'] ?? '小雅',
      // The mark is the default; an operator who sets EMPLOYEE_AVATAR still gets
      // their emoji, unchanged. The small cut, because the header avatar is 30px.
      avatar: process.env['EMPLOYEE_AVATAR'] ?? markSmall(30, null),
      provider: cfg.provider,
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
  const finalize = (a: FastifyInstance): Production => ({
    app: a, db, boss, ownerAccessCode, ownerAccessCodeGenerated: !process.env['OWNER_ACCESS_CODE'],
    async close() {
      if (closing) return;
      closing = true;
      await a.close();                         // 1. stop accepting requests
      await boss.stop().catch(() => {});       // 2–3. stop workers + pg-boss
      await db.destroy().catch(() => {});      // 5. release the pool
    },
  });

  // DEPLOYMENT MODE: full stack up, NO messaging surface. No adapter, no
  // webhook routes, no outbound worker — for hosting before provider
  // onboarding completes. An override adapter (tests) always takes the
  // provider path so composition stays covered.
  if (cfg.provider === 'disabled' && !overrides?.adapter) {
    const app = Fastify({ logger: overrides?.logger ?? true });
    mountHealth(app, 'disabled');
    mountCommandCenter(app);
    app.log.warn('No messaging provider configured. Running in deployment mode.');
    return finalize(app);
  }

  const adapter = overrides?.adapter ?? (cfg.provider === 'meta'
    ? metaAdapter({
        accessToken: cfg.META_WHATSAPP_ACCESS_TOKEN!,
        phoneNumberId: cfg.META_WHATSAPP_PHONE_NUMBER_ID!,
        appSecret: cfg.META_APP_SECRET!,
        graphVersion: cfg.META_GRAPH_API_VERSION,
      })
    : whatsappAdapter({
        baseUrl: cfg.D360_BASE_URL!, apiKey: cfg.D360_API_KEY!, webhookSecret: cfg.WEBHOOK_SECRET!,
      }));

  /** Tenant from the channel credential — NEVER from the payload. */
  async function resolveTenant(phoneNumberId: string): Promise<BusinessId | null> {
    const r = await sql<{ business_id: string }>`
      select business_id from resolve_tenant('whatsapp', ${phoneNumberId})
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
   * C4.a — the adapters this installation has, by channel.
   *
   * WhatsApp is whichever provider the environment selected. E-mail is always
   * present in the sense that the code exists; what decides whether a message
   * can actually leave is her verified sending domain and her outreach switch,
   * both of which the gate reads — not whether an object was constructed here.
   * Until a real provider arrives with M52 the transport is the fake one, and
   * it records rather than pretends, so what would have left is inspectable.
   */
  const mailTransport = overrides?.mailTransport ?? fakeMailTransport();
  const email = emailAdapter({ transport: mailTransport });
  const byChannel: Record<string, ChannelAdapter> = { [adapter.kind]: adapter, email };
  const adapterFor = (channel: string): ChannelAdapter | undefined => byChannel[channel];

  /**
   * C4.a — RFC 8058 headers, minted per message from the same signing key the
   * unsubscribe page reads with. Empty when this installation has no public
   * address to send anyone to, which is a refusal rather than a mail without a
   * way out (`no_unsubscribe`).
   */
  const mailHeaders = (
    row: { readonly to: string }, opts: { readonly locale: Locale },
  ): Readonly<Record<string, string>> => {
    if (!cfg.PUBLIC_BASE_URL) return {};
    const token = mintUnsubscribe(webSessionSecret, {
      // The BUYER's language, resolved by the store from his own client row: the
      // page behind this link is the one thing in her mail he reads that she did
      // not write, and it is no use to him in a language he does not read.
      businessId: PILOT_BUSINESS_ID, channel: 'email', identity: row.to, locale: opts.locale,
    });
    return unsubscribeHeaders(`${cfg.PUBLIC_BASE_URL.replace(/\/$/, '')}/u?t=${encodeURIComponent(token)}`);
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
      return driveConversationOutbound(
        { store, adapter, adapters: adapterFor, mailHeaders, now: () => new Date() },
        job.data.conversationId,
      );
    });

    const waiting = effects.find((e) => e.kind === 'waiting');
    const progressed = effects.some((e) => e.kind === 'sent' || e.kind === 'reclaimed');
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
    kickDrive: async (businessId: string, conversationId: string) => {
      await boss.send(QUEUES.outbound, { businessId, conversationId }, { singletonKey: conversationId });
    },
  };
  await boss.schedule(QUEUES.sequences, '* * * * *', { businessId: PILOT_BUSINESS_ID } satisfies SequenceSweepJob);
  await boss.work<SequenceSweepJob>(QUEUES.sequences, async ([job]: { data: SequenceSweepJob }[]) => {
    if (!job) return;
    const tenant = parseBusinessId(PILOT_BUSINESS_ID);
    if (!tenant.ok) return;
    await runDueSteps(sequenceDeps, tenant.value);
  });

  // P3: owner alerts. QUEUES.notify → resolve owner locale/destination → send the
  // localized alert through the SAME adapter. Registered only with messaging live.
  await boss.work<NotifyJob>(QUEUES.notify, async ([job]: { data: NotifyJob }[]) => {
    if (!job) return;
    await deliverOwnerAlert({ db, adapter }, job.data);   // throws on retryable failure → pg-boss retries
  });

  const app = buildIngressApp({
    adapter,
    verifyToken: cfg.WEBHOOK_VERIFY_TOKEN,
    logger: overrides?.logger ?? true,

    persistEvent: async (e, rawPayload) => {
      const bid = await resolveTenant(e.phoneNumberId);
      if (!bid) return 'duplicate';   // unknown credential: ack, never process
      return withTenantTx(db, bid, async (tx) => {
        const r = await sql<{ id: string }>`
          insert into channel_events
            (id, business_id, channel, provider, event_type, conversation_external_id, payload, occurred_at)
          values
            (${e.dedupKey}, ${bid}, 'whatsapp', ${adapter.provider},
             ${e.kind === 'message' ? 'message.inbound' : 'status'},
             ${e.kind === 'message' ? `whatsapp:${e.waId}:${e.phoneNumberId}` : null},
             ${JSON.stringify(rawPayload)}::jsonb, ${e.occurredAt})
          on conflict (id) do nothing
          returning id
        `.execute(tx);
        return r.rows.length > 0 ? 'new' : 'duplicate';
      });
    },

    onNewEvent: async (e) => {
      const bid = await resolveTenant(e.phoneNumberId);
      if (!bid) return;

      if (e.kind === 'message') {
        const { conversationId } = await withTenantTx(db, bid, async (tx) => {
          const conv = await ensureConversation(tx, bid, e.waId, e.profileName);
          // Health signals live on the channel row: "when did anything arrive".
          await sql`
            update channels
               set last_inbound_at = ${e.occurredAt}, last_webhook_at = now(), updated_at = now()
             where business_id = ${bid} and kind = 'whatsapp'
          `.execute(tx);
          // G10b — the 24-hour window is THIS buyer's. It lived on the channel
          // row, which any buyer's message moved, so one chatty buyer kept a
          // silent one's window open and Meta rejected what the gate allowed.
          // `greatest`, because webhooks can arrive out of order.
          await sql`
            update client_channels
               set last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), ${e.occurredAt})
             where channel = 'whatsapp' and channel_user_id = ${e.waId}
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

  mountHealth(app, 'active');
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
    { port: v.cfg.PORT, provider: v.cfg.provider },
    v.cfg.provider === 'disabled'
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
