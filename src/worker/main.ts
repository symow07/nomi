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
import { llmClient, llmProviderFrom, requestExtrasFor } from '../llm/provider.js';
import type { Analyzer, ReplyWriter, VisionDescriber } from '../llm/ports.js';
import { computeTurn, commitTurn } from '../pipeline/turn.js';
import { hearVoiceNote, recordVoiceMessage } from '../pipeline/voiceTurn.js';
import { recordSpendAlone } from '../db/usage.js';
import { seeImage, recordImageMessage, productionImageDeps } from '../pipeline/imageIntake.js';
import { mediaPortsFor, type MediaPorts } from './mediaPorts.js';
import { inboundDisposition, unlistedDuringPilot } from '../core/conversation/inbound.js';
import { matchCaption, postLine, captionShown, type PostMatch } from '../core/conversation/sharedPost.js';
import { catalogueNames } from '../db/productAliases.js';
import { pilotFactsFor } from '../db/channels.js';
import { turnHold, HOLD_REASON } from '../db/assistantStop.js';
import { practiceOf, conversationExists } from '../db/practice.js';
import { notePracticeChecks } from '../trust/practiceChecks.js';
import {
  handOverUnanswered, handToPerson, recordReceivedMessage, recordTypedMessage, unansweredIn,
} from '../pipeline/received.js';
import { parseBusinessId, parseConversationId } from '../core/types/ids.js';
import { QUEUES, startBoss, INBOUND_WORK, inboundGroup, type InboundJob, type NotifyJob } from '../queue/boss.js';
import { alertKindFor, DRAFT_ALERT_EVERY_SECONDS } from '../pipeline/notify.js';
import { redactSecrets } from '../security/credentials.js';
import {
  appErrorAlertsTo, deadLetter, isAppErrorAlertJob, makeErrorReporter, reportJobFailures, secretValuesIn,
} from './appErrors.js';

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
    /**
     * CC-10 — the workspace whose owner is the OPERATOR: an error alert goes to
     * its sign-in address. Absent: errors are recorded, and nobody is told.
     */
    PILOT_BUSINESS_ID?: string;
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
  /**
   * The pre-pilot walkthrough only: behave as if the AI disclosure had passed
   * native review, so it can prove what she does once autonomy is allowed.
   * Production passes nothing and reads DISCLOSURE_NATIVE_REVIEW.
   */
  rehearsal: { autonomyReleased?: () => boolean } = {},
) {
  const db = createDb(env.DATABASE_URL);
  const boss = await startBoss(env.DATABASE_URL);
  /**
   * CC-10 — errors are written down (`app_errors`) and the operator is told.
   * Built here, beside the pool and the queue it writes through, and handed
   * back to main.ts for the web handler and the process. `boss.work` is wrapped
   * BEFORE any handler is registered, so every job that fails — here or in
   * main.ts — is recorded before pg-boss retries it.
   */
  const errors = makeErrorReporter({
    db,
    enqueue: env.PILOT_BUSINESS_ID ? appErrorAlertsTo(boss, env.PILOT_BUSINESS_ID) : null,
    knownSecrets: secretValuesIn(process.env),
  });
  reportJobFailures(boss, errors.report, isAppErrorAlertJob);
  // N6a — the same client, at whichever provider this installation pays for.
  const llm = llmProviderFrom(process.env, env.ANTHROPIC_API_KEY);
  const anthropic = llmClient(llm);

  const { transcriber, audio, image: mediaFetcher, postCaption } = media;
  const extras = requestExtrasFor(llm);
  const analyzer = models.analyzer ?? anthropicAnalyzer(anthropic, llm.model, extras);
  const replyWriter = models.replyWriter ?? anthropicReplyWriter(anthropic, llm.model, extras);
  const vision = models.vision ?? anthropicVision(anthropic, llm.model, extras);


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
    // T7 — what the turn's model calls cost, written in a transaction of their
    // own (below), so a turn that fails after paying is still on the ledger.
    let spent: { llmCalls: number; inputTokens: number; outputTokens: number } | null = null;
    let committed = false;
    // P5 — who pays: the workspace itself, or, for a practice copy, the workspace it practises for.
    let payer: BusinessId = businessId.value;
    const effects = await withTenantTx(db, businessId.value, async (tx) => {
      await lockConversation(tx, conversationId.value);
      // P5 — a practice copy's turn is the workspace's cost, on its own ledger
      // and allowance: known before any model is paid, so a turn that fails
      // after paying is charged there too.
      const practisedFor = await practiceOf(tx, businessId.value);
      if (practisedFor) payer = practisedFor;
      const base = tenantRepos(tx, businessId.value);
      const tenant = rehearsal.autonomyReleased
        ? { ...base, autonomy: { ...base.autonomy, released: rehearsal.autonomyReleased } }
        : base;
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
        return handToPerson(tenant, conversationId.value, { kind: 'low_confidence_image' },
          [{ messageId: input.messageId, text: input.caption }]);
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
        // Q1 — the batch's own messages are the question, not its history.
        answering: input.fragmentIds,
      };
      const result = await computeTurn(ports, req);
      spent = result.usage;
      const fx = await commitTurn(ports, req, result, started);
      // P3 — a practice turn (0086) is checked by the golden set's own
      // checkers, and the page shows what held. Only on a copy.
      if (practisedFor) await notePracticeChecks(tx, tenant, businessId.value, conversationId.value, result, fx, new Date());
      // M51.1 — the fragments this turn answered stop being pending, in the
      // SAME transaction as the answer. A rollback leaves them pending and the
      // next wake retries: the whole reason they are rows and not a variable.
      await markFragmentsProcessed(tx, input.fragmentIds, input.messageId);
      return fx;
    }).then((fx) => { committed = true; return fx; }).finally(async () => {
      // T7 — the budget dataset: what every attempt's calls cost, kept or not;
      // a turn is counted once, when it is kept (a retry is the same turn).
      if (spent) await recordSpendAlone(db, payer, spent, { turn: committed });
    });

    // Effects enqueue AFTER the tenant tx commits — at-least-once, consumers
    // are idempotent (outbound keyed by messageId, notifications tolerated).
    if (effects.outbound) {
      await boss.send(QUEUES.outbound, {
        businessId: input.businessId,
        conversationId: input.conversationId,
        reply: effects.outbound.reply,
        // 0080 — the question it asks, stamped when it leaves.
        asks: effects.outbound.asks ?? null,
        channel: 'auto',
      }, { singletonKey: input.messageId });
    }
    // P3: enqueue a language-NEUTRAL alert code; the notify consumer localizes.
    // singletonKey dedups concurrent alerts for the same event.
    const alertKind = alertKindFor(effects);
    if (alertKind) {
      await boss.send(QUEUES.notify, {
        businessId: input.businessId, kind: alertKind, conversationId: input.conversationId,
      } satisfies NotifyJob, {
        singletonKey: `${input.businessId}:${alertKind}:${input.conversationId}`,
        // G5 — a waiting reply is told once an hour per conversation, however many drafts it makes.
        ...(alertKind === 'draft_waiting' ? { singletonSeconds: DRAFT_ALERT_EVERY_SECONDS } : {}),
      });
    }
    // NOTE: an `order.effects` job used to be enqueued here. Nothing ever
    // consumed it, so every confirmed order left a job to sit until pg-boss
    // expired it — and an expired job is what the dead-letter handler turns
    // into an owner alert. The producer went first; the queue itself was
    // deleted in M28. The order is already persisted by commitTurn; when there
    // are real post-order effects, add the consumer and the producer together.
  };

  /**
   * The alert a hand-off earns, sent after its transaction commits: a deletion
   * request's own (0076), or the ordinary one. One per kind per conversation
   * while it is queued.
   */
  const alertHandoff = async (
    businessId: BusinessId, conversationId: ConversationId,
    effects: Parameters<typeof alertKindFor>[0] | null,
  ): Promise<void> => {
    const kind = effects ? alertKindFor(effects) : null;
    if (!kind) return;
    await boss.send(QUEUES.notify, {
      businessId, kind, conversationId,
    } satisfies NotifyJob, { singletonKey: `${businessId}:${kind}:${conversationId}` });
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
  // FAIR — several at once, never more than one per workspace, their polls
  // spread across the interval (queue/boss.ts says why).
  const onInboundJob = async ([job]: { data: InboundJob; id?: string }[]) => {
    try {
      await onInbound(job);
    } catch (e) {
      console.error('[inbound failed]', redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300));
      throw e;
    }
  };
  for (let i = 0; i < INBOUND_WORK.workers; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, (INBOUND_WORK.pollSeconds * 1000) / INBOUND_WORK.workers));
    await boss.work<InboundJob>(QUEUES.inbound, {
      localGroupConcurrency: INBOUND_WORK.localGroupConcurrency, pollingIntervalSeconds: INBOUND_WORK.pollSeconds,
    }, onInboundJob);
  }

  // A declaration, hoisted on purpose: a job can arrive the moment the queue
  // is worked, before the lines below this call have run.
  async function onInbound(job: { data: InboundJob; id?: string } | undefined): Promise<void> {
    if (!job) return;
    const businessId = parseBusinessId(job.data.businessId);
    const conversationId = parseConversationId(job.data.conversationId);
    if (!businessId.ok || !conversationId.ok) return; // poison job: drop, don't retry
    // P6 — a conversation erased while its job waited (Practice's Start over,
    // the daily erasure — 0089): nobody is there to answer. Dropped, not retried.
    if (!(await withTenantTx(db, businessId.value, (tx) => conversationExists(tx, conversationId.value)))) return;

    const started = Date.now();

    /**
     * ── 0070 / 0071 / G3 · THE ASSISTANT IS HELD: STOP, OPS, THE ALLOWANCE ─
     *
     * The owner stopped the assistant on every channel, or the ops kill switch
     * (`global_silence`) is on, or the day's allowance is used (G3, 0101: no
     * model may be asked until it renews). Checked FIRST, before an owner's "answer this"
     * too: while held the assistant writes nothing — no model call, no draft,
     * no reply. (Before 0071 the ops switch let the turn run and then threw
     * the reply away, handing nobody the buyer: an emergency control that hid
     * waiting buyers exactly when it was in use.)
     *
     * The buyer is not hidden by it. The message is recorded as it arrived
     * (named, not opened — a photo or a voice note is not read by a stopped
     * assistant either), and the conversation is handed to a person: that
     * handoff is what puts it on "Needs you" (inbox NEEDS_OWNER) and on
     * Today's count, and it sends the owner the same alert any handoff does.
     * Lines of his still waiting in a batch when Stop was pressed are closed
     * by the same handoff, so a later Start never answers them a second time
     * after a person may already have.
     */
    // BILL (0117) — and, for a customer not yet answered this month, the plan's month used.
    const hold = await withTenantTx(db, businessId.value, (tx) => turnHold(tx, businessId.value, conversationId.value));
    if (hold) {
      const effects = await withTenantTx(db, businessId.value, async (tx) => {
        await lockConversation(tx, conversationId.value);
        const type = job.data.messageType ?? 'text';
        // An owner's "answer this" names a message already on the timeline.
        if (!job.data.answerOnly) {
          if (type === 'text') {
            await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);
          } else {
            await recordReceivedMessage(tx, conversationId.value, job.data.messageId, job.data.text || null,
              type === 'image' ? 'photo' : type === 'audio' ? 'voice' : (job.data.received ?? 'other'));
          }
        }
        const waiting = await pendingFragments(tx, conversationId.value);
        const d = inboundDisposition(type, job.data.received);
        if (d.kind === 'ignore' && waiting.length === 0) return null;   // a reaction asks nothing of anyone
        const repos = tenantRepos(tx, businessId.value);
        /*
         * THE HOLD IS A TURN (the owner, 2026-09-30). The lines still waiting
         * in his batch are marked processed IN a turn — `processed_in`
         * references `turns` — and the hold wrote none, so Stop pressed while
         * his lines were being grouped failed here: the job retried, died, and
         * he reached "Needs you" as "not answered" minutes later instead of as
         * what happened. The record says it now: held, and why; nothing read,
         * nothing written, no model asked — the silent path, as the plan's HF
         * has it. Today's "handled" leaves a held turn out.
         */
        await repos.audit.recordTurn({
          messageId: job.data.messageId, conversationId: conversationId.value,
          stateBefore: (await repos.conversations.loadState(conversationId.value)) ?? {},
          input: {
            text: waiting.length ? waiting.map((f) => f.text).join('\n') : (job.data.text ?? ''),
            messageIds: waiting.length ? waiting.map((f) => f.id) : [job.data.messageId],
          },
          analysis: null, retrieved: null,
          decision: { action: { kind: 'held', reason: HOLD_REASON[hold] } },
          quoteId: null, promptVersion: null, modelId: null, latencyMs: Date.now() - started,
          // The plan's HF: a hold is the silent path — nobody answered, nothing was sent.
          measure: { path: 'silent', analyserAvoidable: false, llmCalls: 0, inputTokens: 0, outputTokens: 0 },
        });
        await markFragmentsProcessed(tx, waiting.map((f) => f.id), job.data.messageId);
        // 0076 — his words, and the lines still waiting in his batch: a
        // deletion request among them is written down now, not filed under
        // "stopped" for the owner to notice.
        return handToPerson(repos, conversationId.value,
          { kind: HOLD_REASON[hold] },
          [{ messageId: job.data.messageId, text: job.data.text || null },
           ...waiting.map((f) => ({ messageId: f.id, text: f.text }))]);
      });
      await alertHandoff(businessId.value, conversationId.value, effects);
      return;
    }

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
        return handToPerson(tenantRepos(tx, businessId.value), conversationId.value, { kind: 'unlisted_number' },
          [{ messageId: job.data.messageId, text: job.data.text || null }]);
      });
      await alertHandoff(businessId.value, conversationId.value, effects);
      return;
    }

    // M34 — a voice note is heard BEFORE the turn, outside the tenant
    // transaction: a download and a transcription are seconds of network, and
    // holding a conversation lock across them would serialise every other
    // buyer behind one slow provider.
    // T7 — each transcription is a paid call: counted, whether it heard anything or not.
    let transcriptions = 0;
    const heard = job.data.messageType === 'audio'
      ? await hearVoiceNote({
          transcriber: transcriber && ((a: Parameters<typeof transcriber>[0]) => { transcriptions++; return transcriber(a); }),
          audio,
        }, job.data.mediaId)
      : null;
    if (transcriptions > 0) await recordSpendAlone(db, businessId.value, { llmCalls: transcriptions, inputTokens: 0, outputTokens: 0 }, { turn: false });

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
    // T7 — and so is looking at a photo.
    if (seen?.usage) await recordSpendAlone(db, businessId.value, seen.usage, { turn: false });

    /**
     * ── CH7 · THE SHOP'S OWN POST, MATCHED TO A PRODUCT ─────────────────
     *
     * "price?" on a story, or a post shared with no words: the caption of the
     * shop's OWN post (Meta answers only for media its token's account owns)
     * is read with the workspace's Page token — outside any transaction, five
     * seconds at most — and looked at for one product's name or alias. One
     * product named: the turn runs with it named, on a line marked as what the
     * customer did. None, or several: nothing is guessed — words are answered
     * as before, and a post with no words goes to a person with its caption.
     * No model is asked; reading costs nothing on the ledger.
     */
    let post: { readonly caption: string | null; readonly match: PostMatch } | null = null;
    if (job.data.postId && postCaption) {
      const caption = await postCaption({ db, businessId: businessId.value, postId: job.data.postId });
      const match = caption
        ? matchCaption(caption, await withTenantTx(db, businessId.value, (tx) => catalogueNames(tx, businessId.value)))
        : { kind: 'none' as const };
      post = { caption, match };
    }
    const named = post?.match.kind === 'matched' ? post.match : null;

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
    if (disposition.kind === 'owner' && named
        && (disposition.received === 'shared_post' || disposition.received === 'story_reply')) {
      // CH7 — what he did, named: on the timeline as what arrived (and which
      // product of hers it was), and to the turn as a marked line, never as
      // words of his. Text he sent first goes first.
      await flushPendingText(businessId.value, conversationId.value, started);
      await withTenantTx(db, businessId.value, (tx) => recordReceivedMessage(tx, conversationId.value, job.data.messageId,
        job.data.text || null, disposition.received, named.name));
      await runTurn({
        businessId: businessId.value, conversationId: conversationId.value,
        messageId: job.data.messageId, text: postLine(disposition.received, named.name), caption: null,
        provenance: 'typed', heard: null, seen: null, mediaId: null, fragmentIds: [], started,
      });
      return;
    }
    if (disposition.kind !== 'answer') {
      await flushPendingText(businessId.value, conversationId.value, started);
      const effects = await withTenantTx(db, businessId.value, async (tx) => {
        await lockConversation(tx, conversationId.value);
        await recordReceivedMessage(tx, conversationId.value, job.data.messageId,
          job.data.text || null, disposition.received);
        if (disposition.kind === 'ignore') return null;
        return handToPerson(tenantRepos(tx, businessId.value), conversationId.value, {
          kind: 'media_unreadable', received: disposition.received,
          // CH7a — what it points at, when the provider said.
          ...(job.data.ref ? { ref: job.data.ref } : {}),
          // CH7 — and what the shop's own post says, read and matched to no one product.
          ...(captionShown(post?.caption) ? { caption: captionShown(post?.caption) } : {}),
        }, [{ messageId: job.data.messageId, text: job.data.text || null }]);
      });
      await alertHandoff(businessId.value, conversationId.value, effects);
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
          id: job.data.messageId,
          // CH7 — "price?" on a story of hers that names one product: the turn
          // reads which, on its own marked line. The timeline keeps his words alone.
          text: named ? `${job.data.text}\n${postLine('story_reply', named.name)}` : job.data.text,
          receivedAt: new Date(),
        });
        // G10a — and on the timeline, as he sent it, whatever batching does next.
        await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);
        const pending = await pendingFragments(tx, conversationId.value);
        // Another wake already merged and answered these. Not an error — and
        // NOT a reason to schedule another wake, which is how a debounce turns
        // into a loop that never empties.
        if (pending.length === 0) return null;
        // FAIR — several workers take the queue, and when two of one
        // workspace's jobs are fetched at once the one kept is not always the
        // older: this wake can run before the message sent right after the
        // first has even been recorded. A message of THIS conversation still
        // waiting in the queue, not yet a fragment, belongs in this batch.
        const unrecorded = (await sql<{ n: number }>`
          select count(*)::int as n from pgboss.job j
           -- 'active' too: fetched in the same poll by another worker, and
           -- about to be put back because this job holds the workspace's slot.
           where j.name = ${QUEUES.inbound} and j.state in ('created', 'retry', 'active')
             and j.singleton_key = ${conversationId.value}
             and (${job.id ?? null}::uuid is null or j.id <> ${job.id ?? null}::uuid)
             and not exists (select 1 from message_fragments f where f.id = j.data->>'messageId')`
          .execute(tx)).rows[0]?.n ?? 0;
        return { pending, unrecorded, config: await batchConfigFor(tx, businessId.value) };
      });
      if (!decision) return;

      const now = new Date();
      let batch = decideBatch(decision.pending, now, decision.config);
      // …so the batch waits for it — a second at a time, and never past the
      // batch's own hard window, after which it is answered as it stands.
      const firstAt = Math.min(...decision.pending.map((f) => f.receivedAt.getTime()));
      if (batch.action === 'process' && decision.unrecorded > 0 && now.getTime() - firstAt < decision.config.maxWindowMs) {
        batch = { action: 'wait', checkAgainAt: new Date(Math.min(now.getTime() + 1_000, firstAt + decision.config.maxWindowMs)) };
      }
      if (batch.action === 'wait') {
        // He is still typing. Come back when the quiet would have elapsed, or
        // when the hard window closes — `decideBatch` decides which, and this
        // only carries its answer to the queue.
        await boss.send(QUEUES.inbound, job.data, {
          singletonKey: conversationId.value,
          startAfter: batch.checkAgainAt,
          retryLimit: 3,
          group: inboundGroup(businessId.value),
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
    await boss.work(`${name}.dead`, async ([job]: { data: unknown; id?: string }[]) => {
      if (!job) return;
      console.error(`[DEAD LETTER] ${name}`, redactSecrets(JSON.stringify(job.data)).slice(0, 500));
      // CC-10 — written down as its own kind of error, one per queue: the job
      // gave up. Never its data (a buyer's words ride in an inbound job), and
      // never an error alert that could not be delivered — that is the loop.
      if (!isAppErrorAlertJob(name, [job])) {
        const bid = (job.data as { businessId?: unknown } | null)?.businessId;
        void errors.report(deadLetter(name, job.id ?? '?'), `worker:${name}`,
          { businessId: typeof bid === 'string' ? bid : null });
      }
      // Never re-notify for a failed owner-notification — that would loop.
      if (name === QUEUES.notify) return;
      const businessId = (job.data as { businessId?: string }).businessId ?? 'unknown';
      await boss.send(QUEUES.notify, {
        businessId, kind: 'dead_letter', conversationId: null,
      } satisfies NotifyJob, { singletonKey: `${businessId}:dead_letter:${name}` });
      // 0077 — and a turn that gave up is a buyer nobody answered: a person
      // does, told the way any hand-off is told (pipeline/received.ts). Only
      // the queue that runs turns. After the operator's alert, so a hand-off
      // that fails cannot silence it; it throws, and the dead letter retries.
      if (name === QUEUES.inbound) {
        const unanswered = unansweredIn(job.data);
        if (unanswered) {
          const effects = await withTenantTx(db, unanswered.businessId, (tx) =>
            handOverUnanswered(tx, tenantRepos(tx, unanswered.businessId), unanswered));
          await alertHandoff(unanswered.businessId, unanswered.conversationId, effects);
        }
      }
    });
  }

  return { db, boss, errors };
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
    ...(env['PILOT_BUSINESS_ID'] ? { PILOT_BUSINESS_ID: env['PILOT_BUSINESS_ID'] } : {}),
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
