import Anthropic from '@anthropic-ai/sdk';
import { createDb, lockConversation, withTenantTx } from '../db/client.js';
import { sql } from 'kysely';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import { anthropicAnalyzer, anthropicReplyWriter } from '../llm/anthropic.js';
import { computeTurn, commitTurn } from '../pipeline/turn.js';
import { parseBusinessId, parseConversationId } from '../core/types/ids.js';
import { QUEUES, startBoss, type InboundJob, type NotifyJob } from '../queue/boss.js';

/**
 * Entrypoint 2: the worker. Becomes the LIVE engine at cutover — until then it
 * simply is not started (businesses.engine = 'n8n' routes nothing here).
 *
 * One inbound job = one turn:
 *   lock conversation → computeTurn → commitTurn → enqueue effects.
 * Everything inside one tenant transaction: state, messages, audit, and the
 * outbound/notify jobs commit together or not at all (transactional enqueue).
 */

export async function startWorker(env: { DATABASE_URL: string; ANTHROPIC_API_KEY: string }) {
  const db = createDb(env.DATABASE_URL);
  const boss = await startBoss(env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const analyzer = anthropicAnalyzer(anthropic);
  const replyWriter = anthropicReplyWriter(anthropic);

  await boss.work<InboundJob>(QUEUES.inbound, async ([job]: { data: InboundJob }[]) => {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    const conversationId = parseConversationId(job.data.conversationId);
    if (!businessId.ok || !conversationId.ok) return; // poison job: drop, don't retry

    const started = Date.now();

    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, conversationId.value);
      const tenant = tenantRepos(tx, businessId.value);
      const retriever = hybridRetriever(tx, businessId.value);
      const ports = { tenant, retriever, analyzer, replyWriter, now: () => new Date() };

      const req = {
        conversationId: conversationId.value,
        messageId: job.data.messageId,
        text: job.data.text,
      };
      const result = await computeTurn(ports, req);
      const fx = await commitTurn(ports, req, result, started);
      // Budget dataset (P5) — atomic per-turn usage increment, same tx.
      await sql`select record_usage(${businessId.value}::uuid,
        ${result.usage.llmCalls}, ${result.usage.inputTokens}, ${result.usage.outputTokens})`.execute(tx);
      return fx;
    });

    // Effects enqueue AFTER the tenant tx commits — at-least-once, consumers
    // are idempotent (outbound keyed by messageId, notifications tolerated).
    if (effects.outbound) {
      await boss.send(QUEUES.outbound, {
        businessId: job.data.businessId,
        conversationId: job.data.conversationId,
        reply: effects.outbound.reply,
        channel: 'auto',
      }, { singletonKey: job.data.messageId });
    }
    if (effects.hotLeadAlert || effects.handoffAlert) {
      const notify: NotifyJob = {
        businessId: job.data.businessId,
        kind: effects.handoffAlert ? 'handoff' : 'hot_lead',
        conversationId: job.data.conversationId,
        summary: effects.handoffAlert
          ? 'Client needs a human — conversation paused and waiting to be claimed.'
          : 'Hot lead: strong buying signals. AI is continuing the close.',
      };
      await boss.send(QUEUES.notify, notify, {});
    }
    if (effects.orderCreated) {
      await boss.send(QUEUES.orderEffects, {
        businessId: job.data.businessId,
        conversationId: job.data.conversationId,
        orderId: effects.orderCreated.orderId,
      }, { singletonKey: effects.orderCreated.orderId });
    }
  });

  // Dead letters become alerts, not silence: an exhausted retry is a page.
  for (const name of Object.values(QUEUES)) {
    await boss.work(`${name}.dead`, async ([job]: { data: unknown }[]) => {
      if (!job) return;
      console.error(`[DEAD LETTER] ${name}`, JSON.stringify(job.data).slice(0, 500));
      await boss.send(QUEUES.notify, {
        businessId: (job.data as { businessId?: string }).businessId ?? 'unknown',
        kind: 'dead_letter',
        conversationId: null,
        summary: `Job exhausted retries on ${name}`,
      } satisfies NotifyJob, {});
    });
  }

  return { db, boss };
}

const isMain = process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js');
if (isMain) {
  const { DATABASE_URL, ANTHROPIC_API_KEY } = process.env;
  if (!DATABASE_URL || !ANTHROPIC_API_KEY) {
    console.error('DATABASE_URL and ANTHROPIC_API_KEY are required');
    process.exit(1);
  }
  await startWorker({ DATABASE_URL, ANTHROPIC_API_KEY });
  console.log('worker started');
}
