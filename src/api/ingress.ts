import Fastify, { type FastifyInstance } from 'fastify';
import type { ChannelAdapter } from '../channels/contract.js';
import type { ChannelEvent } from '../channels/whatsapp/parse.js';
import { isStaleEvent } from '../channels/whatsapp/signature.js';
import { requestLogger } from './requestLog.js';

/**
 * M3 — Webhook ingress. The <5s ack contract: this handler verifies the
 * signature, parses, persists, enqueues — nothing else. All real work is
 * async behind pg-boss.
 *
 * Layered replay defense: HMAC over the raw body → staleness rejection →
 * dedup on the provider event id at persist time ('duplicate' short-circuits
 * the enqueue, so a webhook retried for 7 days processes exactly once).
 */

export type IngressDeps = {
  /**
   * WhatsApp, when this installation has it. Absent, `/webhook/whatsapp` is not
   * mounted — a 404, the same answer as before any channel existed — while the
   * channels in `also` are. Nothing stands in for the missing one.
   */
  readonly adapter?: ChannelAdapter;
  /** Meta subscription-verification token (GET handshake). */
  readonly verifyToken: string;
  /**
   * C9 — the other channels this installation answers on, each on its own path.
   *
   * One Meta app can carry WhatsApp, Instagram and the Page, and Meta posts all
   * three to whatever URL each product is subscribed to. They are mounted as
   * SEPARATE paths rather than one, because a payload that arrives on the wrong
   * path is then a 401 from the wrong adapter instead of a message quietly
   * parsed into the wrong channel's conversation.
   */
  readonly also?: readonly {
    readonly path: string; readonly adapter: ChannelAdapter;
    /** S7 — the header the channel signs with, when it is not Meta's (Telegram: its webhook's secret). */
    readonly signatureHeader?: string;
    /**
     * 0215 — what a signed delivery says about the ACCOUNT itself, read once before any event (TikTok: its username,
     * and a message from the EEA, Switzerland or the UK that carries nothing to answer). It never stops the delivery.
     */
    readonly observe?: (payload: unknown) => Promise<void>;
  }[];
  /**
   * S7 — which business an event is for, when the account it arrived on does not say (one Telegram bot for every
   * business): the event re-addressed to that business's account, or null — nobody's, acknowledged and dropped.
   * Asked before anything is stored. Absent: every event is addressed already.
   */
  route?(e: ChannelEvent, channel: string): Promise<ChannelEvent | null>;
  /** Insert into channel_events keyed on e.dedupKey (NOT eventId — statuses
   * share their message's wamid); 'duplicate' = key hit = already seen.
   * Audit batch 1 (A2) — production's also queues the follow-on work IN THE SAME TRANSACTION, so a failure leaves
   * no row behind to make the provider's retry a duplicate. */
  persistEvent(e: ChannelEvent, rawPayload: unknown, channel: string): Promise<'new' | 'duplicate'>;
  /** Follow-on work after a new event, for a store that does not queue it itself (tests). Production passes none. */
  onNewEvent?(e: ChannelEvent, channel: string): Promise<void>;
  readonly now?: () => Date;
  /** Structured request logging (production on; tests quiet). */
  readonly logger?: boolean;
};

export function buildIngressApp(deps: IngressDeps): FastifyInstance {
  const app = Fastify({ logger: requestLogger(deps.logger ?? false) });
  const now = deps.now ?? (() => new Date());

  // Keep the RAW body: signatures are computed over bytes, not parsed JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Every channel gets the same handshake, signature check, parse, persist and
  // enqueue, each at its own path. The shape is identical because the contract
  // is: an adapter that verifies and parses, and a store that dedups on the
  // event id. WhatsApp's payloads also carry STATUSES; those are events of the
  // same parse, and `persistEvent` records them by kind.
  if (deps.adapter) mountChannel(app, '/webhook/whatsapp', deps.adapter, deps, now);
  for (const mount of deps.also ?? []) mountChannel(app, mount.path, mount.adapter, deps, now, mount.signatureHeader, mount.observe);

  return app;
}

/**
 * One channel's webhook, mounted at its own path: the handshake Meta uses to
 * subscribe, and the POST that carries messages.
 *
 * Until 2026-09-17 the WhatsApp routes were written out beside this, line for
 * line the same, and only they could be mounted without the others. An
 * installation with a Page and no number then had no webhook at all.
 */
function mountChannel(
  app: FastifyInstance, path: string, adapter: ChannelAdapter,
  deps: IngressDeps, now: () => Date, signatureHeader = 'x-hub-signature-256',
  observe?: (payload: unknown) => Promise<void>,
): void {
  app.get(path, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === deps.verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send('forbidden');
  });

  app.post(path, async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : '';
    const signature = request.headers[signatureHeader];
    if (!adapter.verifyWebhook(rawBody, typeof signature === 'string' ? signature : undefined)) {
      return reply.code(401).send({ ok: false });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(200).send({ ok: true, received: 0 });
    }
    if (observe) await observe(payload).catch(() => undefined);
    let received = 0;
    for (const parsed of adapter.parseWebhook(payload)) {
      if (isStaleEvent(parsed.occurredAt, now())) continue;
      const event = deps.route ? await deps.route(parsed, adapter.kind) : parsed;
      if (!event) continue;
      // The channel travels with the event so the store writes it on the row:
      // two channels share this handler and a conversation belongs to one.
      const outcome = await deps.persistEvent(event, payload, adapter.kind);
      if (outcome === 'new') {
        await deps.onNewEvent?.(event, adapter.kind);
        received += 1;
      }
    }
    return reply.code(200).send({ ok: true, received });
  });
}
