import type { Tenant } from '../db/ports.js';
import { asksForSample, sampleAnswerContext } from '../core/commerce/samples.js';
import { asksOrderStatus, orderStatusReply } from '../core/commerce/orderState.js';
import { formatDate } from '../core/owner/i18n/format.js';
import type { Money } from '../core/types/money.js';
import type { Retriever, RetrievedProduct } from '../retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import type { ConversationId, Email } from '../core/types/ids.js';
import { extractEmail } from '../core/types/ids.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { Product, Quote, QuoteRefusal } from '../core/types/commerce.js';
import { decideTurn, type Analysis, type TurnDecision } from '../core/conversation/decide.js';
import { capabilityOf, resolveMode } from '../core/conversation/autonomy.js';
import { effectiveMode } from '../core/ops/killSwitch.js';
import type { TextProvenance } from '../core/safety/heardNumbers.js';
import { holdReasonOf, type HoldReason } from '../core/conversation/hold.js';
import { detectFastPath } from '../core/conversation/fastpath.js';
import { analyserWasAvoidable, type AnswerPath } from '../core/conversation/answerPath.js';
import { agreesOnEverything, compareWithModel, understand, type Agreement, type OwnUnderstanding } from '../core/conversation/understand.js';
import { detectInjection } from '../core/safety/injection.js';
import { guardNumerals, extractNumerals } from '../core/safety/numerals.js';
import { guardClaims } from '../core/safety/claims.js';
import { guardForbidden } from '../core/safety/forbiddenWords.js';
import { ANSWER_KINDS, type KnowledgeSnippet } from '../core/types/knowledge.js';
import { detectSignals } from '../core/scoring/detect.js';
import { WAITING_HUMAN_AGENT, aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';
import { computeScores, PROBLEM_HANDOFF_THRESHOLD, type Signal } from '../core/scoring/signals.js';
import { computeQuote, selectTier } from '../core/commerce/quote.js';
import { closureNote, withheldOf } from '../core/commerce/closures.js';
import { toConfirmableOrder } from '../core/commerce/confirmable.js';
import { proofUrl } from '../db/proofs.js';
import {
  guardFallbackReply,
  SAFE_REPLY,
  HANDOFF_REPLY,
  orderBlockedReply,
  orderConfirmedReply,
  quoteRefusalContext,
} from '../core/conversation/templates.js';

/**
 * The turn pipeline.
 *
 * SPLIT ON PURPOSE:
 *   computeTurn — reads + decisions. NO writes, NO sends. The shadow endpoint
 *                 calls ONLY this, so "shadow cannot touch a customer" is a
 *                 property of the structure, not a promise in a comment.
 *   commitTurn  — every write, in the caller's tenant transaction.
 *
 * When a human owns the conversation, assignedTo is non-null — including the
 * 'unclaimed' sentinel set at handoff, so the AI is silent from the very
 * moment of escalation, not from when a human gets around to claiming it.
 */

// Single source of truth for the ownership sentinels (M16.1). Kept exported
// under the original name so existing callers (invariants, tests) don't change.
export const UNCLAIMED_AGENT = WAITING_HUMAN_AGENT;

/** A buyer question this close to a taught FAQ/answer ships that answer verbatim. */
export const FAQ_ANSWER_MIN_RELEVANCE = 0.3;

export type TurnPorts = {
  tenant: Tenant;
  retriever: Retriever;
  analyzer: Analyzer;
  replyWriter: ReplyWriter;
  now: () => Date;
  /**
   * G11 — the address this installation is reachable at, for the proof link a
   * quote carries. Absent is a real state: no link is attached, and the owner
   * is told so on the conversation. A link to a host we do not know is a link
   * that 404s in front of a buyer.
   */
  publicBaseUrl?: string | null;
};

export type TurnRequest = {
  conversationId: ConversationId;
  messageId: string;
  text: string;
  /**
   * M34.5 — where `text` came from. Absent means typed, which is what every
   * turn was before voice notes existed. A transcript is a reading of what the
   * buyer said, and a NUMBER inside one is the machine's guess at a figure that
   * moves a price — see core/safety/heardNumbers.ts.
   */
  provenance?: TextProvenance;
};

/**
 * The decision this turn reduced to — phase, product, quantity, scores and the
 * quote, and nothing the model wrote.
 *
 * It outlived what it was built for. It existed to diff this engine against the
 * n8n one, on the principle that two engines can word a reply differently while
 * making the identical decision, so only decisions are worth comparing. n8n is
 * gone and the comparator with it (M28), but the fingerprint is still the
 * cheapest honest summary of a turn — `tests/pipeline/turn.test.ts` asserts a
 * quote through it — so the TYPE stays here, beside the only thing that builds
 * one, and the dead comparison logic does not.
 */
export type DecisionFingerprint = {
  readonly phase: string;
  readonly productId: string | null;
  readonly productConfirmed: boolean;
  readonly quantity: number | null;
  readonly problemScore: number;
  readonly leadScore: number;
  readonly pendingQuestion: string | null;
  readonly phaseAction: 'maintain' | 'advance' | 'confirm_order' | 'handoff' | 'silent';
  readonly quote: {
    readonly unitPrice: Money;
    readonly discountPct: number;
    readonly total: Money;
  } | null;
};

export type TurnResult = {
  decision: TurnDecision;
  analysis: Analysis | null;
  retrieved: readonly RetrievedProduct[];
  quote: Quote | null;
  quoteInputs: unknown;           // snapshot for the quotes table (reproducibility)
  quoteRefusal: QuoteRefusal | null;
  reply: string | null;           // null = silent (handed off)
  replyDeterministic: boolean;    // true when the reply came from a template / taught answer
  /** N1 — WHO worded the reply, and whether the analyser's call bought anything. */
  answerPath: AnswerPath;
  analyserAvoidable: boolean;
  /**
   * N2a — what HER OWN rules made of the message, and where that agrees with
   * the model's analysis. A shadow: recorded, never read to decide anything.
   * Null when no model analysed the message — there is nothing to compare with.
   */
  ownUnderstanding: { readonly own: OwnUnderstanding; readonly agrees: Agreement; readonly onEverything: boolean } | null;
  /** M13: taught facts provided to this reply (identified product + business-level). */
  knowledge: readonly KnowledgeSnippet[];
  /** M13: the knowledge row ids that SUPPORTED the reply (audit). */
  knowledgeUsed: readonly string[];
  newState: ConversationState;
  signals: readonly Signal[];
  stateBefore: ConversationState;
  provenance: { promptVersion: string | null; modelId: string | null };
  guardViolations: number;
  /**
   * M37.5 — the forbidden terms that stopped a draft, if any. The owner is told
   * WHICH word, because "she said something she should not have" is not
   * actionable and "she used 傻逼" is.
   */
  forbiddenHits: readonly { readonly term: string; readonly source: 'floor' | 'owner' }[];
  /**
   * G8 — forbidden words found in HER OWN text: her taught answer, or the
   * order-status line built from her order. Tagged by where, shown to her,
   * and never counted against her employee — the employee did not write
   * them, and counting them would block promotion for as long as the answer
   * stands.
   */
  forbiddenInHerText: readonly ForbiddenInHerText[];
  /**
   * M45 — this buyer asked for a sample.
   *
   * Decided once per turn, from the buyer's own words, by a deterministic
   * matcher — and recorded whether or not Nomi could answer. Whether she could
   * depends on the owner having stated a policy; that a buyer ASKED is a fact
   * about the buyer, and the owner needs to see it either way.
   */
  sampleRequested: boolean;
  /**
   * G7a — why this reply must wait for her whatever her autonomy says, or
   * null. Decided once, here; `commitTurn`, the trust harness and the sandbox
   * all read THIS rather than re-deriving it (core/conversation/hold.ts).
   */
  hold: HoldReason | null;
  /** Stage timings (ms) + token usage — the P1 measurement surface. */
  timings: { retrievalMs: number; analyzerMs: number; replyMs: number; totalMs: number };
  usage: { llmCalls: number; inputTokens: number; outputTokens: number };
  fingerprint: DecisionFingerprint;
};

/** G8 — a forbidden word in her own text, and which of her texts it was in. */
export type ForbiddenInHerText = {
  readonly term: string;
  readonly source: 'floor' | 'owner';
  readonly path: 'order_status' | 'taught_answer';
};

export async function computeTurn(ports: TurnPorts, req: TurnRequest): Promise<TurnResult> {
  const { tenant, retriever, analyzer, replyWriter } = ports;
  const t0 = Date.now();
  const timings = { retrievalMs: 0, analyzerMs: 0, replyMs: 0, totalMs: 0 };
  const usage = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };

  const state = await tenant.conversations.loadState(req.conversationId);
  if (!state) throw new Error(`conversation not found: ${req.conversationId}`);

  const email = extractEmail(req.text);
  // M45 — decided here, once, for every action kind. A buyer who asks for a
  // sample in the same message that triggers a handoff has still asked.
  const sampleRequested = asksForSample(req.text);

  // ── Cheap gates first: don't pay for analysis we won't use. ────────────────
  // Text-only signal detection runs BEFORE the analyzer: "I want to speak to a
  // human" must trigger the handoff without first paying for (and waiting on)
  // an LLM analysis of a message whose outcome is already determined.
  const textOnlySignals = detectSignals({
    text: req.text, state, analysis: null, unitPrice: null,
  });
  const historicEarly = await tenant.signals.unresolved(req.conversationId);
  const preScore = computeScores([...historicEarly, ...textOnlySignals]);

  const gated =
    !aiMaySpeak(ownershipOf(state.assignedTo)) ||
    preScore.problem >= PROBLEM_HANDOFF_THRESHOLD ||
    detectInjection(req.text).detected ||
    detectFastPath(req.text, state).matched;

  let retrieved: readonly RetrievedProduct[] = [];
  let analysis: Analysis | null = null;
  let promptVersion: string | null = null;
  let modelId: string | null = null;
  let ownUnderstanding: TurnResult['ownUnderstanding'] = null;

  if (!gated) {
    const tr = Date.now();
    retrieved = await retriever.byText(req.text, 20);
    timings.retrievalMs = Date.now() - tr;
    const ta = Date.now();
    const a = await analyzer.analyze({
      text: req.text,
      state,
      candidates: retrieved,
      recentMessages: [], // history injection lands with the worker's message loader
    });
    timings.analyzerMs = Date.now() - ta;
    usage.llmCalls++;
    usage.inputTokens += a.usage.inputTokens;
    usage.outputTokens += a.usage.outputTokens;
    analysis = a.analysis;
    promptVersion = a.promptVersion;
    modelId = a.modelId;
    // N2a — her own reading of the same message, from the same candidates, for
    // the record only. Computed HERE so it sees exactly what the model saw.
    const own = understand({
      text: req.text, state,
      candidates: retrieved.map((c) => ({ productId: c.productId, relevance: c.relevance, sku: c.sku, name: c.name })),
    });
    const agrees = compareWithModel(own, a.analysis, state);
    // The one number that matters later: on how many turns she would have been right about ALL of it.
    ownUnderstanding = { own, agrees, onEverything: agreesOnEverything(agrees) };

    // The model may hallucinate a product id. A candidate is only real if WE
    // retrieved it for this tenant, or it is already the conversation's product.
    const c = analysis.intent.productCandidate;
    if (
      c &&
      !retrieved.some((r) => r.productId === c.productId) &&
      state.product?.productId !== c.productId
    ) {
      analysis = {
        ...analysis,
        intent: { ...analysis.intent, productCandidate: null },
      };
    }
  }

  // ── Signals: unresolved history + what this turn adds. Dedup by kind. ──────
  const productIdForPrice =
    analysis?.intent.productCandidate?.productId ?? state.product?.productId ?? null;
  const qtyForPrice =
    analysis?.intent.quantityMentioned?.value ?? state.quantity?.value ?? 0;

  let indicativePrice: Money | null = null;
  if (productIdForPrice && qtyForPrice > 0) {
    const tiers = await tenant.catalog.priceTiers(productIdForPrice);
    indicativePrice = selectTier(tiers, qtyForPrice)?.unitPrice ?? null;
  }

  const fresh = detectSignals({ text: req.text, state, analysis, unitPrice: indicativePrice });
  const historic = historicEarly;
  const byKind = new Map<Signal['kind'], Signal>();
  for (const s of historic) byKind.set(s.kind, s);
  for (const s of fresh) byKind.set(s.kind, s); // fresh wins
  const signals = [...byKind.values()];

  // ── Decide. Pure. ───────────────────────────────────────────────────────────
  const decision = decideTurn({
    state,
    text: req.text,
    analysis,
    extractedEmail: email,
    signals,
    quote: null, // negotiation logic consults it in Week 3; gates ignore it
  });

  // ── Quote: deterministic, snapshotted, Postgres-owned. ─────────────────────
  let quote: Quote | null = null;
  let quoteRefusal: QuoteRefusal | null = null;
  let quoteInputs: unknown = null;
  let product: Product | null = null;

  if (decision.product && decision.quantity) {
    product = await tenant.catalog.product(decision.product.productId);
    if (product) {
      const [tiers, policy, rules, closures] = await Promise.all([
        tenant.catalog.priceTiers(product.id),
        tenant.catalog.pricingPolicy(product.id),
        tenant.catalog.negotiationRules(),
        // M44 — the days she said her factory is shut.
        tenant.catalog.factoryClosures(),
      ]);
      quoteInputs = { tiers, policy, rules, quantity: decision.quantity.value };
      // M36 — what she already told THIS buyer about THIS product. Empty for a
      // new buyer, which is why a first quote is never refused by this guard.
      const priorQuotes = await tenant.audit.priorQuotesForClient(state.clientId, product.id);
      const q = computeQuote({
        product, tiers, policy, rules, quantity: decision.quantity.value, priorQuotes,
        closures, now: ports.now(),
      });
      if (q.ok) quote = q.value;
      else quoteRefusal = q.error;
    }
  }

  // ── New state (what commitTurn will persist). ──────────────────────────────
  const newState: ConversationState = {
    ...state,
    phase: decision.nextPhase,
    turnCount: state.turnCount + 1,
    scores: decision.scores,
    product: decision.product,
    quantity: decision.quantity,
    contact: { email: decision.email },
    pendingQuestion: decision.pendingQuestion,
    assignedTo:
      decision.action.kind === 'handoff' && !decision.action.notifyOnly
        ? (UNCLAIMED_AGENT as ConversationState['assignedTo'])
        : state.assignedTo,
  };

  // ── The reply. Commitments are templates; prose is the model, guarded. ─────
  let reply: string | null = null;
  let replyDeterministic = false;
  // N1 — set beside every place that decides the words, so the label cannot
  // drift from the branch that produced them. `model` until something else did.
  let answerPath: AnswerPath = 'model';
  /** The product the taught-answer search ran under, for `analyserWasAvoidable`. */
  let productSearchedUnder: string | null = null;
  let guardViolations = 0;
  /** M37.5 — which forbidden terms stopped a draft, so the owner is told WHICH. */
  let forbiddenHits: readonly { readonly term: string; readonly source: 'floor' | 'owner' }[] = [];
  /** G8 — the same, found in her own text rather than in what the employee wrote. */
  const forbiddenInHerText: ForbiddenInHerText[] = [];
  /** G8 — both generated attempts failed a guard; the reply is a stand-in. */
  let guardsFailedTwice = false;
  let confirmBlockedReasons: readonly string[] = [];
  let knowledge: readonly KnowledgeSnippet[] = [];
  let knowledgeUsed: readonly string[] = [];

  switch (decision.action.kind) {
    case 'silent':
      reply = null;
      replyDeterministic = true;
      answerPath = 'silent';
      break;

    case 'canned_reply':
      reply = decision.action.reply;
      replyDeterministic = true;
      // A bare yes/no to her own question never reached a model at all.
      answerPath = detectFastPath(req.text, state).matched ? 'fast_path' : 'canned';
      break;

    case 'handoff':
      reply = HANDOFF_REPLY;
      replyDeterministic = true;
      answerPath = 'handoff';
      break;

    case 'confirm_order': {
      // G6 — HER terms, or none. This was the literal "30% deposit, 70%
      // before shipment", stamped on every order she never set terms for.
      const terms = await tenant.catalog.tradeTerms();
      const confirmable = toConfirmableOrder({
        state: newState,
        product,
        quote,
        paymentTerms: terms?.paymentTerms ?? null,
        incoterm: terms?.incoterm ?? null,
      });
      answerPath = 'order_flow';
      if (confirmable.ok) {
        // Reply text is finalized in commitTurn once the order reference exists.
        reply = null;
        replyDeterministic = true;
      } else {
        confirmBlockedReasons = confirmable.error;
        reply = orderBlockedReply(confirmable.error, quote);
        replyDeterministic = true;
      }
      break;
    }

    case 'generate_reply': {
      const claimsPolicy = await tenant.catalog.claimsPolicy();
      const forbiddenTerms = await tenant.catalog.forbiddenTerms();
      const refusalCtx = quoteRefusal ? quoteRefusalContext(quoteRefusal) : null;
      const replyLanguage =
        analysis?.language.replyIn ?? state.preferredLanguage ?? 'en';
      const nextQuestion =
        analysis?.intent.nextLogicalQuestion ?? refusalCtx?.note ?? null;

      // ── M13: enrich AFTER product identification, BEFORE reply generation.
      // Retrieve taught facts for the identified product + business-level. The
      // numeral guard's allow-set gains numbers ONLY from the identified
      // product's rows (decision 1) — business-level facts inform prose, never
      // license a number. Certifications are absent here (they gate via claims).
      const identifiedProductId = decision.product?.productId ?? null;
      productSearchedUnder = identifiedProductId;
      knowledge = await tenant.knowledge.retrieve({ query: req.text, productId: identifiedProductId, k: 6 });
      const knowledgeNumbers = identifiedProductId === null ? [] : knowledge
        .filter((s) => s.productId === identifiedProductId)
        .flatMap((s) => extractNumerals(`${s.label} ${s.content}`).map((n) => n.value));
      /**
       * M45 — "can you send a sample?"
       *
       * The sample price enters the allow-set ONLY from a row she wrote. If she
       * has stated no policy, `sampleAnswerContext` refuses, nothing is added,
       * and `guardNumerals` then makes it impossible for any reply to name a
       * sample price — the same mechanic as M44's blocked lead time. There is
       * no fallback policy and no "usually free" to fall back to.
       *
       * The detection is deterministic (`asksForSample`) because it decides
       * whether the OWNER sees a request in her inbox: a model deciding it
       * would make sample requests appear and disappear between two identical
       * messages.
       */
      const sampleCtx = sampleRequested
        ? sampleAnswerContext(await tenant.catalog.samplePolicy())
        : null;
      /**
       * G5 — a closure of hers withheld the date. M44 made the date
       * unstateable; this makes the REASON stateable, so the buyer is told why
       * no date came instead of only noticing that none did. Her label may
       * carry a year ("Spring Festival 2027"), and those digits are hers, so
       * they are sourced like her taught facts.
       */
      const closureCtx = quote?.leadTimeBlocked
        ? { note: closureNote(quote.leadTimeBlocked),
            allow: extractNumerals(quote.leadTimeBlocked.closure.label).map((n) => n.value) }
        : null;
      /**
       * A5.3 — who is speaking, and for which business. Tone and focus only.
       * The two NAMES are hers the way a closure's label is, so a digit inside
       * one ("Studio 54") is sourced and a sign-off cannot fail the guard. Her
       * note about how to sound is not: a number in it stays unsayable.
       */
      const speaker = await tenant.conversations.speaker(req.conversationId);
      const nameNumbers = speaker
        ? [speaker.name ?? '', speaker.business.name].flatMap((n) => extractNumerals(n).map((x) => x.value))
        : [];
      const numeralAllow = [
        ...(refusalCtx?.allow ?? []),
        ...knowledgeNumbers,
        ...(sampleCtx?.ok ? sampleCtx.allow : []),
        ...(closureCtx?.allow ?? []),
        ...nameNumbers,
      ];

      /**
       * M46 — "where is my order?"
       *
       * Answered from the ROW, deterministically, before any model is asked.
       * The sentence names the state and the day SHE set it, and stops: an
       * estimate assembled from a state and a lead time is a delivery promise
       * made by arithmetic, and the buyer holds HER to it.
       *
       * This is the only path that can answer the question, which is what
       * makes "she never estimates a date" a property of the code rather than
       * an instruction in a prompt.
       */
      if (asksOrderStatus(req.text)) {
        // G4 — by buyer: his order was confirmed in a conversation that
        // closed, and this question is in a new one.
        const order = await tenant.orders.latestForClient(state.clientId);
        if (order) {
          const said = orderStatusReply({
            reference: order.reference,
            update: order.update,
            // The business timezone, so "as of the 3rd" means her 3rd.
            formatDate: (d) => formatDate('en', d),
          });
          const clean = guardForbidden({ reply: said.reply, ownerTerms: forbiddenTerms });
          const guarded = clean.ok
            ? guardNumerals({ reply: clean.value, quote, state: newState, clientText: req.text, allow: said.allow })
            : null;
          // G8 — her order, her rule: tagged, and not the employee's failure.
          if (!clean.ok && clean.error.kind === 'forbidden_word') {
            forbiddenInHerText.push(...clean.error.terms.map((x) => ({ ...x, path: 'order_status' as const })));
          }
          if (guarded?.ok) {
            reply = guarded.value;
            replyDeterministic = true;
            answerPath = 'order_status';
            break;
          }
        }
        // No order, or a guard refused it: fall through. Nothing here invents
        // an answer to a question about an order that does not exist.
      }

      // Deterministic answer path: a strong FAQ / buyer_answer match ships the
      // owner's authored answer (claims-guarded — an unauthorised cert in the
      // answer still cannot pass), no LLM, no tokens. This is what makes the
      // teach→answer→correct loop deterministic and provable in the sandbox.
      const faq = knowledge.find((s) => ANSWER_KINDS.has(s.kind) && s.relevance >= FAQ_ANSWER_MIN_RELEVANCE);
      if (faq) {
        const answerAllow = [...numeralAllow, ...extractNumerals(faq.content).map((n) => n.value)];
        const claimed = guardClaims({ reply: faq.content, policy: claimsPolicy });
        // A TAUGHT answer is not exempt: the owner may have typed something in
        // her catalogue that she later forbade, and shipping it verbatim
        // because "she wrote it" is how the floor gets bypassed.
        const wordSafe = claimed.ok
          ? guardForbidden({ reply: claimed.value, ownerTerms: forbiddenTerms }) : claimed;
        const guarded = wordSafe.ok
          ? guardNumerals({ reply: wordSafe.value, quote, state: newState, clientText: req.text, allow: answerAllow })
          : null;
        // G8 — her taught answer uses a word she forbade: tagged, shown to her,
        // not counted against the employee (who did not write it).
        if (!wordSafe.ok && wordSafe.error.kind === 'forbidden_word') {
          forbiddenInHerText.push(...wordSafe.error.terms.map((x) => ({ ...x, path: 'taught_answer' as const })));
        }
        if (guarded?.ok) {
          reply = guarded.value;
          replyDeterministic = true;
          answerPath = 'taught_answer';
          knowledgeUsed = [faq.id];
        }
        // guards failed → fall through to the (also guarded) generative path;
        // the raw answer never ships.
      }

      const tw = Date.now();
      for (let attempt = 0; attempt < 2 && reply === null; attempt++) {
        const w = await replyWriter.write({
          state: newState,
          text: req.text,
          quote,
          replyLanguage,
          nextQuestion,
          retryAfterViolation: attempt > 0,
          knowledge,
          // Absent when she has stated nothing: the model is told nothing to
          // work from rather than being asked to be careful about samples.
          ...(sampleCtx?.ok ? { sampleNote: sampleCtx.note } : {}),
          ...(closureCtx ? { closureNote: closureCtx.note } : {}),
          ...(speaker ? { speaker } : {}),
        });
        usage.llmCalls++;
        usage.inputTokens += w.usage.inputTokens;
        usage.outputTokens += w.usage.outputTokens;
        promptVersion = promptVersion ?? w.promptVersion;
        const guarded = guardNumerals({
          reply: w.reply,
          quote,
          state: newState,
          clientText: req.text,
          // M13: the identified product's taught numbers are sourced, like the quote's.
          allow: numeralAllow,
        });
        if (!guarded.ok) { guardViolations++; continue; }
        // The claims guard runs beside the numeral guard: numeral-free
        // commitments ("CE certified", "we ship DDP") are exactly as binding
        // as prices, and default-deny against claims_policy. (Priority 4)
        const claimed = guardClaims({ reply: guarded.value, policy: claimsPolicy });
        if (!claimed.ok) { guardViolations++; continue; }
        // M37.5 — and the words she has forbidden. Runs beside the other two
        // guards, in the same retry loop, for the same reason: a regeneration
        // is cheap and an insult in writing is not.
        const clean = guardForbidden({ reply: claimed.value, ownerTerms: forbiddenTerms });
        if (!clean.ok) {
          guardViolations++;
          forbiddenHits = clean.error.terms;
          continue;
        }
        reply = clean.value;
        knowledgeUsed = knowledge.map((s) => s.id);   // facts provided to this reply
      }
      if (reply === null) {
        // Two violations: the model does not get a third chance to invent a
        // number. Deterministic stand-in, sourced figures only — and G8:
        //
        //  · GUARDED like everything else. It used to go out unchecked, so the
        //    analyser's question (model text) reached the buyer unguarded.
        //  · Never an internal note. `nextQuestion` falls back to the refusal
        //    context, which is guidance TO the writer ("Do not state a new
        //    price."); the stand-in takes only the analyser's question.
        //  · If even that fails, one fixed sentence with nothing to guard.
        //  · And the turn is held for her (hold.ts): "it comes to you instead"
        //    is what her forbidden-words page promises.
        guardsFailedTwice = true;
        const standIn = guardFallbackReply(quote, analysis?.intent.nextLogicalQuestion ?? null);
        const numeralsOk = guardNumerals({ reply: standIn, quote, state: newState, clientText: req.text, allow: numeralAllow });
        const passes = numeralsOk.ok
          && guardClaims({ reply: standIn, policy: claimsPolicy }).ok
          && guardForbidden({ reply: standIn, ownerTerms: forbiddenTerms }).ok;
        reply = passes ? standIn : SAFE_REPLY;
        replyDeterministic = true;
        answerPath = 'stand_in';
      }
      timings.replyMs = Date.now() - tw;
      break;
    }
  }

  const fingerprint: DecisionFingerprint = {
    phase: decision.nextPhase,
    productId: decision.product?.productId ?? null,
    productConfirmed: decision.product?.confirmedByClient ?? false,
    quantity: decision.quantity?.value ?? null,
    problemScore: decision.scores.problem,
    leadScore: decision.scores.lead,
    pendingQuestion: decision.pendingQuestion,
    phaseAction:
      decision.action.kind === 'confirm_order' && confirmBlockedReasons.length > 0
        ? 'maintain'
        : decision.action.kind === 'canned_reply' || decision.action.kind === 'generate_reply'
          ? decision.nextPhase !== state.phase ? 'advance' : 'maintain'
          : decision.action.kind,
    quote: quote && {
      unitPrice: quote.unitPrice,
      discountPct: quote.discountPct,
      total: quote.total,
    },
  };

  // G7a — her rules that hold a reply, over whatever this turn produced.
  // M34.5's heard quantity is one; her "ask me above this discount" line is
  // the other. Provenance defaults to typed, so every caller that predates
  // voice notes is unaffected.
  const hold = holdReasonOf({ provenance: req.provenance ?? 'typed', quote, turnText: req.text, guardsFailedTwice });

  timings.totalMs = Date.now() - t0;
  return {
    decision, analysis, retrieved, quote, quoteInputs, quoteRefusal,
    reply, replyDeterministic, knowledge, knowledgeUsed, newState, signals,
    answerPath,
    ownUnderstanding,
    analyserAvoidable: analyserWasAvoidable({
      path: answerPath, analyserCalled: analysis !== null,
      productBefore: state.product?.productId ?? null, productUsed: productSearchedUnder,
    }),
    stateBefore: state,
    provenance: { promptVersion, modelId },
    guardViolations,
    forbiddenHits,
    forbiddenInHerText,
    sampleRequested,
    hold,
    timings, usage,
    fingerprint,
  };
}

/** Everything commitTurn causes beyond the database, for the caller to enqueue. */
export type TurnEffects = {
  /** Present only when the reply may auto-send (capability in auto mode). */
  outbound: { conversationId: ConversationId; reply: string } | null;
  /** Present when the reply needs owner approval (capability in draft mode):
   * a pending draft was persisted; the owner resolves it via applyOwnerCommand. */
  draftCreated: { conversationId: ConversationId; draftId: string } | null;
  hotLeadAlert: boolean;
  handoffAlert: boolean;
  orderCreated: { orderId: string; orderReference: string } | null;
};

/** The product's single timezone (M1). Night-shift windows resolve against it. */
export const BUSINESS_TZ = 'Asia/Shanghai';

export async function commitTurn(
  ports: TurnPorts,
  req: TurnRequest,
  r: TurnResult,
  startedAt: number,
): Promise<TurnEffects> {
  const { tenant } = ports;
  let orderCreated: TurnEffects['orderCreated'] = null;
  let reply = r.reply;

  // Order creation — only through the branded ConfirmableOrder, idempotent at
  // the database (ADR-0004).
  if (r.decision.action.kind === 'confirm_order' && r.reply === null) {
    const product = r.decision.product
      ? await tenant.catalog.product(r.decision.product.productId)
      : null;
    const terms = await tenant.catalog.tradeTerms();
    const confirmable = toConfirmableOrder({
      state: r.newState, product, quote: r.quote,
      paymentTerms: terms?.paymentTerms ?? null,
      incoterm: terms?.incoterm ?? null,
    });
    if (confirmable.ok && product) {
      const created = await tenant.orders.create(req.conversationId, confirmable.value);
      orderCreated = created;
      reply = orderConfirmedReply({
        orderReference: created.orderReference,
        productName: product.name,
        quantity: confirmable.value.quantity.value,
        unit: confirmable.value.quantity.unit,
      });
      await tenant.events.append(req.conversationId, 'order_created', {
        orderId: created.orderId, alreadyExisted: created.alreadyExisted,
      });
      if (!created.alreadyExisted) {
        await tenant.conversations.close(req.conversationId);
      }
    }
  }

  // M45 — the request reaches the owner even when the reply could not answer
  // it. Idempotent at the database, so a buyer who asks three times is one row.
  if (r.sampleRequested) {
    await tenant.samples.record(req.conversationId, req.text);
    await tenant.events.append(req.conversationId, 'sample_requested', {});
  }

  // Quote audit record (reproducibility).
  let quoteId: string | null = null;
  if (r.quote && r.quoteInputs && r.decision.product) {
    const rec = await tenant.audit.recordQuote({
      conversationId: req.conversationId,
      productId: r.decision.product.productId,
      quantity: r.quote.quantity.value,
      inputs: r.quoteInputs,
      unitPrice: r.quote.unitPrice,
      discountPct: r.quote.discountPct,
      total: r.quote.total,
      requiresHuman: r.quote.requiresHuman,
      appliedRules: r.quote.appliedRules,
      // G5 — what the quote said about delivery: a lead time, or that her
      // closure withheld one. The buyer's proof page reads THESE, not the
      // product's lead time, which is exactly the number M44 refused.
      leadTimeDays: r.quote.leadTimeDays,
      leadTimeWithheld: r.quote.leadTimeBlocked ? withheldOf(r.quote.leadTimeBlocked) : null,
    });
    quoteId = rec.quoteId;
    await tenant.events.append(req.conversationId, 'quote_computed', { quoteId });

    /**
     * G11 — EVERY QUOTE SHE SENDS CARRIES A LINK, which is the first line of
     * M35 and was never true: the owner had to tap a button afterwards and
     * was then shown a relative path she could not send.
     *
     * Minted in THIS transaction (the quote it proves is not visible outside
     * it yet), and appended AFTER the guards on purpose: a token's digits are
     * not sourced figures and a segment like `-FOB-` is not an authorised
     * claim, so a link inside the guarded text would be refused by the very
     * rules that make the text safe.
     */
    if (reply !== null && ports.publicBaseUrl) {
      const issued = await tenant.proofs.issue(quoteId);
      const url = issued && proofUrl(ports.publicBaseUrl, issued.token);
      if (url) {
        reply = `${reply}\n\n${url}`;
        await tenant.events.append(req.conversationId, 'proof_link_sent', { quoteId });
      }
    }
  }

  // Signals: persist fresh ones (idempotent per kind in the repo).
  for (const s of r.signals) {
    await tenant.signals.record(req.conversationId, s);
  }

  // G11 — the language he writes in, remembered on him rather than re-derived
  // from a message each time. His proof page reads it, and a turn that runs no
  // analysis (a fast path, an injection) still answers in it.
  const detected = r.analysis?.language.detected?.slice(0, 2).toLowerCase();
  if (detected && detected !== r.stateBefore.preferredLanguage) {
    await tenant.clients.savePreferredLanguage(r.newState.clientId, detected);
  }

  // State + contact.
  await tenant.conversations.saveState(r.newState);
  if (r.decision.email && r.decision.email !== r.stateBefore.contact.email) {
    await tenant.clients.saveEmail(r.newState.clientId, r.decision.email);
    await tenant.events.append(req.conversationId, 'email_captured', {});
  }

  // Replay record (the debugger for last Tuesday's conversation).
  await tenant.audit.recordTurn({
    messageId: req.messageId,
    conversationId: req.conversationId,
    stateBefore: r.stateBefore,
    input: { text: req.text, signalKinds: r.signals.map((s) => s.kind) },
    analysis: r.analysis,
    retrieved: r.retrieved,
    decision: r.decision,
    quoteId,
    promptVersion: r.provenance.promptVersion,
    modelId: r.provenance.modelId,
    latencyMs: Date.now() - startedAt,
    measure: {
      path: r.answerPath, analyserAvoidable: r.analyserAvoidable,
      llmCalls: r.usage.llmCalls, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens,
      ownUnderstanding: r.ownUnderstanding,
    },
  });

  // Funnel events.
  if (r.decision.hotLead) await tenant.events.append(req.conversationId, 'lead_hot', {});
  if (r.decision.action.kind === 'handoff') {
    await tenant.events.append(req.conversationId, 'handoff', {});
  }
  if (r.decision.injectionDetected) {
    await tenant.events.append(req.conversationId, 'injection_blocked', {});
  }
  // G8 — a word she forbade, found in her OWN text. Its own event type, so
  // `loadCapabilityEvidence` (which counts 'guard_violation') never sees it:
  // the employee did not write it. The conversation page reads it back.
  if (r.forbiddenInHerText.length > 0) {
    await tenant.events.append(req.conversationId, 'forbidden_in_her_text', {
      hits: r.forbiddenInHerText.map((x) => ({ term: x.term, source: x.source, path: x.path })),
    });
  }

  // M13: which taught knowledge rows supported this reply (usage audit).
  if (r.knowledgeUsed.length > 0) {
    await tenant.events.append(req.conversationId, 'knowledge_used',
      { ids: r.knowledgeUsed, messageId: req.messageId, deterministic: r.replyDeterministic });
  }

  // ── The trust loop: auto-send vs. pending draft ─────────────────────────
  // A reply auto-sends only when its capability is in auto mode right now
  // (resolveMode: confirm_order is always draft, night windows honoured). In
  // draft mode we persist a pending draft instead — the owner resolves it via
  // applyOwnerCommand. Order confirmations always send (the owner already
  // tapped confirm by creating the order).
  let outbound: TurnEffects['outbound'] = null;
  let draftCreated: TurnEffects['draftCreated'] = null;
  if (reply) {
    const isOrderConfirmation = orderCreated !== null;
    if (isOrderConfirmation) {
      outbound = { conversationId: req.conversationId, reply };
    } else {
      const capability = capabilityOf(r.decision, r.quote !== null);
      const grants = await tenant.autonomy.grants();
      const policyMode = resolveMode({ capability, grants, now: ports.now(), timeZone: BUSINESS_TZ });
      // G7a — her hold rules (a quantity she HEARD, M34.5; a discount past her
      // ask-first line) do not auto-send however her autonomy is set. This
      // never widens permission: auto becomes draft, draft stays draft.
      // M34.6 — ops kill switches, applied last because they must win. Only
      // `forceDraft`/`silenceCapability` are resolved here; `globalSilence` is
      // enforced at the SEND gate, where it also catches replies queued before
      // the switch was thrown. `effectiveMode` is monotone by construction, so
      // this rung, like the one above it, can only ever remove authority.
      const mode = effectiveMode(r.hold ? 'draft' : policyMode, capability, await tenant.ops.switches());

      // M34.9 — A GUARD FIRED WHILE SHE WAS UNSUPERVISED.
      //
      // guardNumerals or guardClaims refused her draft, and the capability that
      // produced it is in auto: nobody was going to see this. TRUST-PLAYBOOK
      // describes exactly this case — the capability drops to draft and she says
      // so — and until now nothing implemented it.
      //
      // The violation is recorded whatever the mode (it is evidence either way),
      // but the demotion only fires from auto: `autoDemote` refuses to act on a
      // capability already at the floor.
      if (r.guardViolations > 0) {
        await tenant.events.append(req.conversationId, 'guard_violation', {
          capability, count: r.guardViolations,
          // M37.5 — name the words. A refusal the owner cannot act on is a
          // complaint; naming the term tells her whether it was her own rule or
          // the floor, and lets her fix her list if it was hers.
          ...(r.forbiddenHits.length
            ? { forbidden: r.forbiddenHits.map((t) => ({ term: t.term, source: t.source })) }
            : {}),
        });
        if (policyMode === 'auto') {
          await tenant.autonomy.selfDemote({
            capability,
            conversationId: req.conversationId,
            violations: r.guardViolations,
          });
        }
      }

      if (mode === 'silent') {
        // The capability is switched off. She writes nothing and drafts
        // nothing — but the refusal is RECORDED, because a buyer who hears
        // nothing beside an owner who is told nothing is the silent failure
        // this product treats as a defect. The message itself is already
        // persisted and the conversation is still there to be answered by hand.
        await tenant.events.append(req.conversationId, 'send_suppressed', {
          capability, reason: 'ops_kill_switch',
        });
      } else if (mode === 'auto') {
        outbound = { conversationId: req.conversationId, reply };
      } else {
        const d = await tenant.drafts.create({
          conversationId: req.conversationId, capability,
          draftText: reply, turnMessageId: req.messageId,
        });
        draftCreated = { conversationId: req.conversationId, draftId: d.draftId };
        await tenant.events.append(req.conversationId, 'draft_pending', {
          draftId: d.draftId, capability,
          // The audit trail says WHY this one waited, so a draft the owner did
          // not ask for is explicable rather than mysterious.
          // G7a — and the inbox reads it back, so the card says why too.
          ...(r.hold ? { heldBecause: r.hold } : {}),
          // G7b — both prices and both dates, whichever reason is named: a
          // price above what he was told is on her card beside the new one.
          ...(r.quote?.contradicts ? { contradicts: r.quote.contradicts } : {}),
          // G8 — and when she could not write it, WHICH of the owner's words
          // kept stopping her. The card names them (M37.5's promise).
          ...(r.hold === 'guards_failed_twice' && r.forbiddenHits.length
            ? { forbidden: r.forbiddenHits.map((x) => x.term) } : {}),
        });
      }
    }
  }

  return {
    outbound,
    draftCreated,
    hotLeadAlert: r.decision.hotLead,
    handoffAlert: r.decision.action.kind === 'handoff',
    orderCreated,
  };
}
