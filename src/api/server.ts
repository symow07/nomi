import Fastify from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createDb, withTenantTx } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import { anthropicAnalyzer, anthropicReplyWriter } from '../llm/anthropic.js';
import { computeTurn } from '../pipeline/turn.js';
import { parseBusinessId, parseConversationId } from '../core/types/ids.js';
import { sql } from 'kysely';

/**
 * Entrypoint 1: the HTTP surface.
 *
 * During the shadow phase this hosts exactly one meaningful route:
 *
 *   POST /shadow/turn — mirror of live traffic. Calls computeTurn ONLY.
 *   No commitTurn, no outbound, no order creation: the shadow cannot touch a
 *   customer because the code path to do so is not present. (ADR-0009)
 *
 * n8n posts here fire-and-forget with neverError, so a service outage is
 * invisible to the live path.
 */

const ShadowTurnBody = z.object({
  message_id: z.string().min(1),
  business_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  text: z.string().default(''),
});

export async function buildServer(env: { DATABASE_URL: string; ANTHROPIC_API_KEY: string }) {
  const app = Fastify({ logger: true });
  const db = createDb(env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const analyzer = anthropicAnalyzer(anthropic);
  const replyWriter = anthropicReplyWriter(anthropic);

  app.get('/health', async () => ({ ok: true }));

  app.post('/shadow/turn', async (request, reply) => {
    const parsed = ShadowTurnBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const businessId = parseBusinessId(parsed.data.business_id);
    const conversationId = parseConversationId(parsed.data.conversation_id);
    if (!businessId.ok || !conversationId.ok) {
      return reply.code(400).send({ error: 'invalid ids' });
    }

    const started = Date.now();
    try {
      const result = await withTenantTx(db, businessId.value, async (tx) => {
        const tenant = tenantRepos(tx, businessId.value);
        const retriever = hybridRetriever(tx, businessId.value);

        const r = await computeTurn(
          { tenant, retriever, analyzer, replyWriter, now: () => new Date() },
          {
            conversationId: conversationId.value,
            messageId: parsed.data.message_id,
            text: parsed.data.text,
          },
        );

        // The ONLY write the shadow makes: its own decision record, in the
        // shadow schema. The nightly diff job fills n8n_decision from the
        // canonical tables and computes divergence.
        await sql`
          insert into shadow.turn_decisions
            (message_id, conversation_id, business_id, svc_decision)
          values
            (${parsed.data.message_id}, ${conversationId.value},
             ${businessId.value}, ${JSON.stringify(r.fingerprint)}::jsonb)
          on conflict (message_id) do nothing
        `.execute(tx);

        return { fingerprint: r.fingerprint, timings: r.timings, usage: r.usage,
                 guardViolations: r.guardViolations };
      });

      // P1 measurement surface: stage latency + token usage per shadow turn.
      return reply.code(200).send({
        ok: true,
        latency_ms: Date.now() - started,
        ...result,
      });
    } catch (e: unknown) {
      // Shadow failures are logged, counted, and NEVER propagated to n8n.
      request.log.error(e, 'shadow turn failed');
      return reply.code(200).send({ ok: false, error: String(e) });
    }
  });

  return app;
}

// Direct execution: node --experimental-strip-types src/api/server.ts (or via tsx/dist)
const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const { DATABASE_URL, ANTHROPIC_API_KEY } = process.env;
  if (!DATABASE_URL || !ANTHROPIC_API_KEY) {
    console.error('DATABASE_URL and ANTHROPIC_API_KEY are required');
    process.exit(1);
  }
  const app = await buildServer({ DATABASE_URL, ANTHROPIC_API_KEY });
  await app.listen({ port: Number(process.env['PORT'] ?? 8787), host: '0.0.0.0' });
}
