import Anthropic from '@anthropic-ai/sdk';
import { createDb, lockConversation, withTenantTx } from '../db/client.js';
import { sql } from 'kysely';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';
import { decideBatch } from '../core/conversation/batching.js';
import {
  recordFragment, pendingFragments, markFragmentsProcessed, batchConfigFor,
} from '../db/fragments.js';
import { anthropicAnalyzer, anthropicReplyWriter, anthropicVision } from '../llm/anthropic.js';
import type { Analyzer, ReplyWriter, VisionDescriber } from '../llm/ports.js';
import { computeTurn, commitTurn } from '../pipeline/turn.js';
import { hearVoiceNote, recordVoiceMessage } from '../pipeline/voiceTurn.js';
import { seeImage, recordImageMessage, productionImageDeps } from '../pipeline/imageIntake.js';
import { mediaPortsFor, type MediaPorts } from './mediaPorts.js';
import { inboundDisposition, unlistedDuringPilot } from '../core/conversation/inbound.js';
import { pilotFactsFor } from '../db/channels.js';
import { handToPerson, recordReceivedMessage, recordTypedMessage } from '../pipeline/received.js';
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

export async function startWorker(
  env: {
    DATABASE_URL: string; ANTHROPIC_API_KEY: string;
    /** G11 — the address a proof link is built on. Absent: no link is attached. */
    PUBLIC_BASE_URL?: string;
  },
  /**
   * G2b — the ports themselves, built by the entrypoint from the provider
   * config (src/worker/mediaPorts.ts). This used to be four optional STRINGS
   * that neither entrypoint passed, so both paths were dead in production.
   *
   * M34 — an absent transcriber is still a legitimate, honest state: every
   * voice note then refuses with `audio_unheard` and the owner is told why,
   * rather than the buyer receiving an answer to a question nobody heard.
   * M4.5 — an absent image fetcher means she cannot see, and every photo
   * refuses rather than being answered from its caption.
   */
  media: MediaPorts = {},
  /**
   * G2b — the model ports, for tests only. Production passes nothing and gets
   * the Anthropic-backed ports below. A test that drives a real voice note or
   * photo through this worker needs a turn to COMPLETE, and a fake key would
   * make every turn a network failure against the real API.
   */
  models: { analyzer?: Analyzer; replyWriter?: ReplyWriter; vision?: VisionDescriber } = {},
) {
  const db = createDb(env.DATABASE_URL);
  const boss = await startBoss(env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const { transcriber, audio, image: mediaFetcher } = media;
  const analyzer = models.analyzer ?? anthropicAnalyzer(anthropic);
  const replyWriter = models.replyWriter ?? anthropicReplyWriter(anthropic);
  const vision = models.vision ?? anthropicVision(anthropic);


  /**
   * ONE TURN, whatever produced it: a typed message, a merged batch of
   * fragments, a voice note, a photo.
   *
   * Extracted in M51.1 because a media message must be able to FLUSH a pending
   * text batch before it answers — two turns in one job, in the order the
   * buyer sent them. The body below is unchanged; only what decides its inputs
   * is new.
   */
  const runTurn = async (input: {
    businessId: BusinessId;
    conversationId: ConversationId;
    messageId: string;
    text: string;
    caption: string | null;
    provenance: 'typed' | 'transcribed' | 'photo';
    heard: Awaited<ReturnType<typeof hearVoiceNote>> | null;
    /** G13 — the provider's handle for the audio, kept so she can play it. */
    mediaId?: string | null;
    seen: Awaited<ReturnType<typeof seeImage>> | null;
    fragmentIds: readonly string[];
    started: number;
  }): Promise<void> => {
    const businessId = { value: input.businessId };
    const conversationId = { value: input.conversationId };
    const started = input.started;
    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, conversationId.value);
      const tenant = tenantRepos(tx, businessId.value);
      const retriever = hybridRetriever(tx, businessId.value);
      const ports = {
        tenant, retriever, analyzer, replyWriter, now: () => new Date(),
        publicBaseUrl: env.PUBLIC_BASE_URL ?? null,
      };

      if (input.heard) {
        await recordVoiceMessage(tx, conversationId.value, input.messageId, input.heard, input.mediaId);
      }

      // FAIL CLOSED. She could not hear the question, so she does not answer
      // it: the signal flags the conversation for the owner and the turn ends
      // here. Before M34 this same input reached computeTurn as empty text and
      // produced a confident reply to a question nobody had asked.
      if (input.heard?.kind === 'unheard') {
        return handToPerson(tenant, conversationId.value, {
          kind: 'audio_unheard', reason: input.heard.reason,
        });
      }

      if (input.seen) await recordImageMessage(tx, conversationId.value, input.messageId, input.caption, input.seen);

      // FAIL CLOSED, for the same reason and in the same shape. She could not
      // tell what the photo was — either the bytes never arrived, or two
      // catalogue products were within a hair of each other and MATCH_MIN_MARGIN
      // exists precisely so she does not pick one. `low_confidence_image` has
      // been in the vocabulary and rendered by the inbox since M4; until this
      // commit nothing ever wrote it, because nothing ever ran.
      if (input.seen?.kind === 'refused') {
        return handToPerson(tenant, conversationId.value, { kind: 'low_confidence_image' });
      }

      const req = {
        conversationId: conversationId.value,
        messageId: input.messageId,
        // The transcript IS the message from here on — same pipeline, same
        // gate, same price rules. Only its provenance differs. A photo becomes
        // words the same way: his caption as his, the description as a
        // description, never as something he said.
        text: input.text,
        // M34.5 — a figure inside a transcript is the machine's reading of a
        // number that moves a price. If it drove the quote, the reply waits for
        // the owner however her autonomy is set.
        provenance: input.provenance,
      };
      const result = await computeTurn(ports, req);
      const fx = await commitTurn(ports, req, result, started);
      // M51.1 — the fragments this turn answered stop being pending, in the
      // SAME transaction as the answer. A rollback leaves them pending and the
      // next wake retries: the whole reason they are rows and not a variable.
      await markFragmentsProcessed(tx, input.fragmentIds, input.messageId);
      // Budget dataset (P5) — atomic per-turn usage increment, same tx.
      await sql`select record_usage(${businessId.value}::uuid,
        ${result.usage.llmCalls}, ${result.usage.inputTokens}, ${result.usage.outputTokens})`.execute(tx);
      return fx;
    });

    // Effects enqueue AFTER the tenant tx commits — at-least-once, consumers
    // are idempotent (outbound keyed by messageId, notifications tolerated).
    if (effects.outbound) {
      await boss.send(QUEUES.outbound, {
        businessId: input.businessId,
        conversationId: input.conversationId,
        reply: effects.outbound.reply,
        channel: 'auto',
      }, { singletonKey: input.messageId });
    }
    // P3: enqueue a language-NEUTRAL alert code; the notify consumer localizes.
    // singletonKey dedups concurrent alerts for the same event.
    const alertKind = alertKindFor(effects);
    if (alertKind) {
      await boss.send(QUEUES.notify, {
        businessId: input.businessId, kind: alertKind, conversationId: input.conversationId,
      } satisfies NotifyJob, { singletonKey: `${input.businessId}:${alertKind}:${input.conversationId}` });
    }
    // NOTE: an `order.effects` job used to be enqueued here. Nothing ever
    // consumed it, so every confirmed order left a job to sit until pg-boss
    // expired it — and an expired job is what the dead-letter handler turns
    // into an owner alert. The producer went first; the queue itself was
    // deleted in M28. The order is already persisted by commitTurn; when there
    // are real post-order effects, add the consumer and the producer together.
  };

  /**
   * His typed lines that are still waiting, answered FIRST and in order —
   * before a photo, a voice note, or something she cannot read. Answering the
   * photo while three unanswered lines sit in the queue, and replying to those
   * six seconds later, reads as confusion to the owner watching.
   */
  const flushPendingText = async (
    businessId: BusinessId, conversationId: ConversationId, started: number,
  ): Promise<void> => {
    const flush = await withTenantTx(db, businessId, async (tx) => {
      const pending = await pendingFragments(tx, conversationId);
      return pending.length === 0 ? null : pending;
    });
    if (!flush) return;
    const merged = flush.map((f) => f.text.trim()).filter(Boolean).join('\n');
    if (!merged) return;
    await runTurn({
      businessId, conversationId,
      messageId: flush[flush.length - 1]!.id, text: merged, caption: null,
      provenance: 'typed', heard: null, seen: null,
      fragmentIds: flush.map((f) => f.id), started,
    });
  };

  // WHY a turn failed is logged here, redacted, before the retry. Until
  // 2026-09-17 the only trace of a failed reply was the dead letter's job
  // data — the message, never the reason — and the first real Messenger
  // message in production dead-lettered on an invalid model key that took a
  // query of the job table to find.
  await boss.work<InboundJob>(QUEUES.inbound, async ([job]: { data: InboundJob }[]) => {
    try {
      await onInbound(job);
    } catch (e) {
      console.error('[inbound failed]', redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300));
      throw e;
    }
  });

  // A declaration, hoisted on purpose: a job can arrive the moment the queue
  // is worked, before the lines below this call have run.
  async function onInbound(job: { data: InboundJob } | undefined): Promise<void> {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    const conversationId = parseConversationId(job.data.conversationId);
    if (!businessId.ok || !conversationId.ok) return; // poison job: drop, don't retry

    const started = Date.now();

    /**
     * ── G13 · SHE TYPED WHAT HE SAID, AND ASKED FOR AN ANSWER ─────────────
     *
     * A voice note the machine could not make out, corrected by a person. Her
     * words are the message from here on — provenance 'transcribed', because
     * the FIGURES in them are still one human's reading of a recording, and
     * M34.5 holds a price built on those for her.
     */
    if (job.data.answerOnly) {
      await runTurn({
        businessId: businessId.value, conversationId: conversationId.value,
        messageId: job.data.messageId, text: job.data.text, caption: null,
        provenance: 'transcribed', heard: null, seen: null, mediaId: null,
        fragmentIds: [], started,
      });
      return;
    }

    /**
     * ── G10c · A NUMBER SHE MAY NOT WRITE TO ───────────────────────────────
     *
     * Live in pilot mode, and this buyer is not on the owner's list. The send
     * gate would refuse any reply, so she writes none: before hearing, seeing
     * or a model call, the message is recorded as what it was and a person is
     * told. The owner decided this (2026-09-10): she can reply herself, or add
     * the number and hand the conversation back.
     */
    const unlisted = await withTenantTx(db, businessId.value, async (tx) =>
      unlistedDuringPilot(await pilotFactsFor(tx, businessId.value, conversationId.value)));
    if (unlisted) {
      const effects = await withTenantTx(db, businessId.value, async (tx) => {
        await lockConversation(tx, conversationId.value);
        const type = job.data.messageType ?? 'text';
        if (type === 'text') {
          await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);
        } else {
          // Named, not opened: she was not allowed to read it either.
          await recordReceivedMessage(tx, conversationId.value, job.data.messageId, job.data.text || null,
            type === 'image' ? 'photo' : type === 'audio' ? 'voice' : (job.data.received ?? 'other'));
        }
        const d = inboundDisposition(type, job.data.received);
        if (d.kind === 'ignore') return null;      // a reaction asks nothing of anyone
        return handToPerson(tenantRepos(tx, businessId.value), conversationId.value, { kind: 'unlisted_number' });
      });
      if (effects?.handoffAlert) {
        await boss.send(QUEUES.notify, {
          businessId: businessId.value, kind: 'handoff', conversationId: conversationId.value,
        } satisfies NotifyJob, { singletonKey: `${businessId.value}:handoff:${conversationId.value}` });
      }
      return;
    }

    // M34 — a voice note is heard BEFORE the turn, outside the tenant
    // transaction: a download and a transcription are seconds of network, and
    // holding a conversation lock across them would serialise every other
    // buyer behind one slow provider.
    const heard = job.data.messageType === 'audio'
      ? await hearVoiceNote({ transcriber, audio }, job.data.mediaId)
      : null;

    // M4.5 — the same treatment for a photo, and for the same reason.
    const seen = job.data.messageType === 'image'
      ? await seeImage({
          image: mediaFetcher
            ? productionImageDeps({ media: mediaFetcher, vision, db, businessId: businessId.value })
            : undefined,
        }, {
          mediaId: job.data.mediaId, caption: job.data.text || null,
        })
      : null;

    /**
     * ── G2c · SOMETHING SHE CANNOT ANSWER FROM TEXT ─────────────────────
     *
     * A reaction, a sticker, a document, a video, a location. Each used to
     * reach the turn as an EMPTY STRING and get a reply: an answer to an emoji,
     * or a confident answer to a PDF nobody opened. `inboundDisposition`
     * decides, before any turn: ignore it, or hand it to a person with a name
     * for what arrived. Text, photos and voice notes carry on as before.
     */
    const disposition = inboundDisposition(job.data.messageType ?? 'text', job.data.received);
    if (disposition.kind !== 'answer') {
      await flushPendingText(businessId.value, conversationId.value, started);
      const effects = await withTenantTx(db, businessId.value, async (tx) => {
        await lockConversation(tx, conversationId.value);
        await recordReceivedMessage(tx, conversationId.value, job.data.messageId,
          job.data.text || null, disposition.received);
        if (disposition.kind === 'ignore') return null;
        return handToPerson(tenantRepos(tx, businessId.value), conversationId.value, {
          kind: 'media_unreadable', received: disposition.received,
        });
      });
      if (effects?.handoffAlert) {
        await boss.send(QUEUES.notify, {
          businessId: businessId.value, kind: 'handoff', conversationId: conversationId.value,
        } satisfies NotifyJob, { singletonKey: `${businessId.value}:handoff:${conversationId.value}` });
      }
      return;
    }

    /**
     * ── M51.1 · DEBOUNCE-AND-BATCH ──────────────────────────────────────
     *
     * ASSUMPTIONS P1, closed at last. A buyer sends "hello" / "price?" /
     * "the bags" / "5000pcs" in ten seconds; pg-boss serialises those four
     * jobs but does not merge them — verified against pg-boss 12 rather than
     * assumed — so each was analysed alone: meaningless input, four replies,
     * four times the tokens.
     *
     * A TEXT message now joins a batch instead of becoming a turn. The
     * fragment is persisted FIRST, so nothing is lost if this process dies
     * between recording it and deciding what to do with it.
     */
    if (heard === null && seen === null) {
      const decision = await withTenantTx(db, businessId.value, async (tx) => {
        await recordFragment(tx, businessId.value, conversationId.value, {
          id: job.data.messageId, text: job.data.text, receivedAt: new Date(),
        });
        // G10a — and on the timeline, as he sent it, whatever batching does next.
        await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);
        const pending = await pendingFragments(tx, conversationId.value);
        // Another wake already merged and answered these. Not an error — and
        // NOT a reason to schedule another wake, which is how a debounce turns
        // into a loop that never empties.
        if (pending.length === 0) return null;
        return { pending, config: await batchConfigFor(tx, businessId.value) };
      });
      if (!decision) return;

      const batch = decideBatch(decision.pending, new Date(), decision.config);
      if (batch.action === 'wait') {
        // He is still typing. Come back when the quiet would have elapsed, or
        // when the hard window closes — `decideBatch` decides which, and this
        // only carries its answer to the queue.
        await boss.send(QUEUES.inbound, job.data, {
          singletonKey: conversationId.value,
          startAfter: batch.checkAgainAt,
          retryLimit: 3,
        });
        return;
      }

      // His whole thought, in the order he had it. The turn is attributed to
      // the fragment that CLOSED the batch: that is the message being answered.
      const closing = batch.fragmentIds[batch.fragmentIds.length - 1] as string;
      await runTurn({
        businessId: businessId.value, conversationId: conversationId.value,
        messageId: closing, text: batch.mergedText, caption: null,
        provenance: 'typed', heard: null, seen: null,
        fragmentIds: batch.fragmentIds, started,
      });
      return;
    }

    /**
     * A voice note or a photo is NOT merged into a text batch. Provenance is
     * the difference between a figure she typed and a figure a machine read
     * out of audio, and M34.5 treats those differently on purpose.
     *
     * It does FLUSH one, though: the text goes first, in the order he sent
     * it, and the media turn follows (`flushPendingText`).
     */
    await flushPendingText(businessId.value, conversationId.value, started);

    await runTurn({
      businessId: businessId.value, conversationId: conversationId.value,
      messageId: job.data.messageId,
      text: heard?.kind === 'heard' ? heard.transcript
        : seen?.kind === 'words' ? seen.text
        : job.data.text,
      caption: job.data.text || null,
      provenance: heard?.kind === 'heard' ? 'transcribed'
        : seen?.kind === 'words' ? 'photo' : 'typed',
      heard, seen, mediaId: job.data.mediaId ?? null, fragmentIds: [], started,
    });
  }

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
  // A development entrypoint; production runs `dist/main.js`, which validates
  // the environment before building these. This reads the same variables
  // without that validation, so a malformed value here fails at the first
  // media job rather than at boot.
  const env = process.env;
  const provider = env['WHATSAPP_PROVIDER'];
  await startWorker({
    DATABASE_URL, ANTHROPIC_API_KEY,
    ...(env['PUBLIC_BASE_URL'] ? { PUBLIC_BASE_URL: env['PUBLIC_BASE_URL'] } : {}),
  }, mediaPortsFor({
    provider: provider === 'meta' || provider === '360dialog' ? provider : 'disabled',
    META_WHATSAPP_ACCESS_TOKEN: env['META_WHATSAPP_ACCESS_TOKEN'],
    META_WHATSAPP_PHONE_NUMBER_ID: env['META_WHATSAPP_PHONE_NUMBER_ID'],
    META_APP_SECRET: env['META_APP_SECRET'],
    META_GRAPH_API_VERSION: env['META_GRAPH_API_VERSION'] ?? 'v23.0',
    D360_BASE_URL: env['D360_BASE_URL'],
    D360_API_KEY: env['D360_API_KEY'],
    TRANSCRIBE_API_KEY: env['TRANSCRIBE_API_KEY'],
    TRANSCRIBE_BASE_URL: env['TRANSCRIBE_BASE_URL'],
  }));
  console.log('worker started');
}
