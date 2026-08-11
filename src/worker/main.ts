import Anthropic from '@anthropic-ai/sdk';
import { createDb, lockConversation, withTenantTx } from '../db/client.js';
import { sql } from 'kysely';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import { anthropicAnalyzer, anthropicReplyWriter } from '../llm/anthropic.js';
import { computeTurn, commitTurn, type TurnEffects } from '../pipeline/turn.js';
import { hearVoiceNote, recordVoiceMessage } from '../pipeline/voiceTurn.js';
import { whisperTranscriber } from '../llm/transcribe.js';
import { whatsappAudioFetcher } from '../channels/whatsapp/media.js';
import { parseBusinessId, parseConversationId } from '../core/types/ids.js';
import { QUEUES, startBoss, type InboundJob, type NotifyJob } from '../queue/boss.js';
import { alertKindFor } from '../pipeline/notify.js';
import { redactSecrets } from '../security/credentials.js';

/**
 * Entrypoint 2: the worker. Becomes the LIVE engine at cutover — until then it
 * simply is not started (businesses.engine = 'n8n' routes nothing here).
 *
 * One inbound job = one turn:
 *   lock conversation → computeTurn → commitTurn → enqueue effects.
 * Everything inside one tenant transaction: state, messages, audit, and the
 * outbound/notify jobs commit together or not at all (transactional enqueue).
 */

export async function startWorker(env: {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  /**
   * M34 — speech-to-text. Absent is a legitimate, honest state: every voice
   * note then refuses with `audio_unheard` and the owner is told why, rather
   * than the buyer receiving an answer to a question nobody heard.
   */
  TRANSCRIBE_API_KEY?: string | undefined;
  TRANSCRIBE_BASE_URL?: string | undefined;
  /** Media download base + auth, from the same channel credential as photos. */
  MEDIA_BASE_URL?: string | undefined;
  MEDIA_API_KEY?: string | undefined;
}) {
  const db = createDb(env.DATABASE_URL);
  const boss = await startBoss(env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const transcriber = env.TRANSCRIBE_API_KEY
    ? whisperTranscriber({
        apiKey: env.TRANSCRIBE_API_KEY,
        ...(env.TRANSCRIBE_BASE_URL ? { baseUrl: env.TRANSCRIBE_BASE_URL } : {}),
      })
    : undefined;
  const audio = env.MEDIA_BASE_URL && env.MEDIA_API_KEY
    ? whatsappAudioFetcher({ baseUrl: env.MEDIA_BASE_URL, apiKey: env.MEDIA_API_KEY })
    : undefined;
  const analyzer = anthropicAnalyzer(anthropic);
  const replyWriter = anthropicReplyWriter(anthropic);

  await boss.work<InboundJob>(QUEUES.inbound, async ([job]: { data: InboundJob }[]) => {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    const conversationId = parseConversationId(job.data.conversationId);
    if (!businessId.ok || !conversationId.ok) return; // poison job: drop, don't retry

    const started = Date.now();

    // M34 — a voice note is heard BEFORE the turn, outside the tenant
    // transaction: a download and a transcription are seconds of network, and
    // holding a conversation lock across them would serialise every other
    // buyer behind one slow provider.
    const heard = job.data.messageType === 'audio'
      ? await hearVoiceNote({ transcriber, audio }, job.data.mediaId)
      : null;

    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, conversationId.value);
      const tenant = tenantRepos(tx, businessId.value);
      const retriever = hybridRetriever(tx, businessId.value);
      const ports = { tenant, retriever, analyzer, replyWriter, now: () => new Date() };

      if (heard) await recordVoiceMessage(tx, conversationId.value, job.data.messageId, heard);

      // FAIL CLOSED. She could not hear the question, so she does not answer
      // it: the signal flags the conversation for the owner and the turn ends
      // here. Before M34 this same input reached computeTurn as empty text and
      // produced a confident reply to a question nobody had asked.
      if (heard?.kind === 'unheard') {
        await tenant.signals.record(conversationId.value, {
          kind: 'audio_unheard', reason: heard.reason,
        });
        await tenant.events.append(conversationId.value, 'handoff', {});
        return {
          outbound: null, draftCreated: null, hotLeadAlert: false,
          handoffAlert: true, orderCreated: null,
        } satisfies TurnEffects;
      }

      const req = {
        conversationId: conversationId.value,
        messageId: job.data.messageId,
        // The transcript IS the message from here on — same pipeline, same
        // gate, same price rules. Only its provenance differs.
        text: heard?.kind === 'heard' ? heard.transcript : job.data.text,
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
    // P3: enqueue a language-NEUTRAL alert code; the notify consumer localizes.
    // singletonKey dedups concurrent alerts for the same event.
    const alertKind = alertKindFor(effects);
    if (alertKind) {
      await boss.send(QUEUES.notify, {
        businessId: job.data.businessId, kind: alertKind, conversationId: job.data.conversationId,
      } satisfies NotifyJob, { singletonKey: `${job.data.businessId}:${alertKind}:${job.data.conversationId}` });
    }
    // NOTE: an `order.effects` job used to be enqueued here. Nothing ever
    // consumed it, so every confirmed order left a job to sit until pg-boss
    // expired it — and an expired job is what the dead-letter handler turns
    // into an owner alert. The producer went first; the queue itself was
    // deleted in M28. The order is already persisted by commitTurn; when there
    // are real post-order effects, add the consumer and the producer together.
  });

  // Dead letters become alerts, not silence: an exhausted retry is a page.
  for (const name of Object.values(QUEUES)) {
    await boss.work(`${name}.dead`, async ([job]: { data: unknown }[]) => {
      if (!job) return;
      console.error(`[DEAD LETTER] ${name}`, redactSecrets(JSON.stringify(job.data)).slice(0, 500));
      // Never re-notify for a failed owner-notification — that would loop.
      if (name === QUEUES.notify) return;
      const businessId = (job.data as { businessId?: string }).businessId ?? 'unknown';
      await boss.send(QUEUES.notify, {
        businessId, kind: 'dead_letter', conversationId: null,
      } satisfies NotifyJob, { singletonKey: `${businessId}:dead_letter:${name}` });
    });
  }

  return { db, boss };
}

// Exact-file check: a suffix match ('main.js') also fires when this module is
// IMPORTED by dist/main.js — found by the production start smoke test.
const isMain = process.argv[1] !== undefined &&
  import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { DATABASE_URL, ANTHROPIC_API_KEY } = process.env;
  if (!DATABASE_URL || !ANTHROPIC_API_KEY) {
    console.error('DATABASE_URL and ANTHROPIC_API_KEY are required');
    process.exit(1);
  }
  await startWorker({ DATABASE_URL, ANTHROPIC_API_KEY });
  console.log('worker started');
}
