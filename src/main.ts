import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomBytes, createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import Anthropic from '@anthropic-ai/sdk';
import { startWorker } from './worker/main.js';
import { buildIngressApp } from './api/ingress.js';
import { registerWebApp } from './api/web/app.js';
import { anthropicAnalyzer, anthropicReplyWriter } from './llm/anthropic.js';
import { SANDBOX_BUSINESS_ID } from './demo/sandbox.js';
import { META_SHAPE } from './core/channel/metaReadiness.js';
import { assertSafeRuntimeRole } from './db/runtimeIdentity.js';
import { assertSchemaCurrent } from './db/schemaVersion.js';
import { assertPilotTenant } from './db/pilotTenant.js';
import { whatsappAdapter } from './channels/whatsapp/adapter.js';
import { metaAdapter } from './channels/whatsapp/meta.js';
import { withTenantTx, lockConversation, type Db } from './db/client.js';
import { channelStore, ensureConversation, enqueueOutboundRow } from './db/channels.js';
import { driveConversationOutbound } from './outbound/worker.js';
import { QUEUES, enqueueInbound, type NotifyJob } from './queue/boss.js';
import { deliverOwnerAlert } from './pipeline/notify.js';
import { parseBusinessId, type BusinessId } from './core/types/ids.js';
import type { ChannelAdapter } from './channels/contract.js';
import type { PgBoss } from 'pg-boss';

/**
 * PRODUCTION ENTRYPOINT (audit C1). Composes existing components — worker,
 * ingress, channel store, outbound drive — into the one process `npm start`
 * runs. No business logic lives here; only wiring.
 *
 * Routes mounted: GET/POST /webhook/whatsapp + GET /health. The legacy
 * /shadow/turn server (src/api/server.ts) is deliberately NOT mounted (H1):
 * it trusts a caller-supplied business_id, which is acceptable only for the
 * trusted n8n shadow caller, never for a public host. Tenant identity here
 * comes exclusively from the channel credential (phone_number_id).
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
 * On ephemeral hosts (Railway), run locally once and paste the .env values
 * into the host's environment — a per-boot regeneration would invalidate the
 * webhook verify token registered with the provider.
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
  overrides?: { adapter?: ChannelAdapter; logger?: boolean },
): Promise<Production> {
  // Worker first: it owns the pool and pg-boss; ingress reuses both.
  const { db, boss } = await startWorker({
    DATABASE_URL: cfg.DATABASE_URL, ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
  });

  // M19 (B0) — refuse to serve if the RUNTIME connection is not subject to
  // tenant isolation. Every RLS policy targets yiwuflow_app; a superuser or
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
  // M12.2: Live-AI sandbox is opt-in (it spends Anthropic tokens). Default is
  // scripted-only; set SANDBOX_LIVE_AI=1 to offer the Live AI mode.
  const sandboxLive = process.env['SANDBOX_LIVE_AI'] === '1'
    ? ((c) => ({ analyzer: anthropicAnalyzer(c), replyWriter: anthropicReplyWriter(c) }))(new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }))
    : {};
  const mountCommandCenter = (a: FastifyInstance) => {
    registerWebApp(a, {
      db,
      sessionSecret: createHmac('sha256', cfg.CREDENTIAL_KEY).update('yf-web-session').digest('hex'),
      accessCode: ownerAccessCode,
      businessId: PILOT_BUSINESS_ID,
      sandboxBusinessId: SANDBOX_ID,
      employeeName: process.env['EMPLOYEE_NAME'] ?? '小雅',
      avatar: process.env['EMPLOYEE_AVATAR'] ?? '👩‍💼',
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
  await boss.work<DriveJob>(QUEUES.outbound, async ([job]: { data: DriveJob }[]) => {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    if (!businessId.ok || !job.data.conversationId) return;   // poison: drop

    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, job.data.conversationId);
      if (job.data.reply) {
        await enqueueOutboundRow(tx, businessId.value, job.data.conversationId, job.data.reply);
      }
      const store = channelStore(tx, businessId.value);
      return driveConversationOutbound(
        { store, adapter, now: () => new Date() }, job.data.conversationId,
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
          // 24h window + health signals live on the channel row.
          await sql`
            update channels
               set last_inbound_at = ${e.occurredAt}, last_webhook_at = now(), updated_at = now()
             where business_id = ${bid} and kind = 'whatsapp'
          `.execute(tx);
          return conv;
        });
        await enqueueInbound(boss, {
          businessId: bid, conversationId,
          messageId: e.eventId, text: e.text ?? '',
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
      ? 'yiwuflow up in deployment mode (health + worker infra, no messaging)'
      : 'yiwuflow production up (webhook + worker)',
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
