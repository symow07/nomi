import Fastify, { type FastifyInstance } from 'fastify';
import type { ChannelAdapter } from '../channels/contract.js';
import type { ChannelEvent } from '../channels/whatsapp/parse.js';
import { isStaleEvent } from '../channels/whatsapp/signature.js';

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
  readonly adapter: ChannelAdapter;
  /** Meta subscription-verification token (GET handshake). */
  readonly verifyToken: string;
  /** Insert into channel_events keyed on e.dedupKey (NOT eventId — statuses
   * share their message's wamid); 'duplicate' = key hit = already seen. */
  persistEvent(e: ChannelEvent, rawPayload: unknown): Promise<'new' | 'duplicate'>;
  /** Enqueue follow-on work (inbound job / status reconciliation). */
  onNewEvent(e: ChannelEvent): Promise<void>;
  readonly now?: () => Date;
  /** Structured request logging (production on; tests quiet). */
  readonly logger?: boolean;
};

export function buildIngressApp(deps: IngressDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const now = deps.now ?? (() => new Date());

  // Keep the RAW body: signatures are computed over bytes, not parsed JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  // Subscription handshake (Meta GET verification).
  app.get('/webhook/whatsapp', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === deps.verifyToken) {
      return reply.code(200).send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send('forbidden');
  });

  app.post('/webhook/whatsapp', async (request, reply) => {
    const rawBody = typeof request.body === 'string' ? request.body : '';
    const signature = request.headers['x-hub-signature-256'];

    if (!deps.adapter.verifyWebhook(rawBody, typeof signature === 'string' ? signature : undefined)) {
      return reply.code(401).send({ ok: false });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(200).send({ ok: true, received: 0 }); // ack garbage; never retry-loop it
    }

    let received = 0;
    for (const event of deps.adapter.parseWebhook(payload)) {
      if (isStaleEvent(event.occurredAt, now())) continue;
      const outcome = await deps.persistEvent(event, payload);
      if (outcome === 'new') {
        await deps.onNewEvent(event);
        received += 1;
      }
    }
    return reply.code(200).send({ ok: true, received });
  });

  return app;
}
