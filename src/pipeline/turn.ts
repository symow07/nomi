import type { Tenant } from '../db/ports.js';
import type { Retriever, RetrievedProduct } from '../retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import type { ConversationId, Email } from '../core/types/ids.js';
import { extractEmail } from '../core/types/ids.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { Product, Quote, QuoteRefusal } from '../core/types/commerce.js';
import { decideTurn, type Analysis, type TurnDecision } from '../core/conversation/decide.js';
import { capabilityOf, resolveMode } from '../core/conversation/autonomy.js';
import { effectiveMode } from '../core/ops/killSwitch.js';
import { quantityWasHeardNotTyped, type TextProvenance } from '../core/safety/heardNumbers.js';
import { detectFastPath } from '../core/conversation/fastpath.js';
import { detectInjection } from '../core/safety/injection.js';
import { guardNumerals, extractNumerals } from '../core/safety/numerals.js';
import { guardClaims } from '../core/safety/claims.js';
import { ANSWER_KINDS, type KnowledgeSnippet } from '../core/types/knowledge.js';
import { detectSignals } from '../core/scoring/detect.js';
import { WAITING_HUMAN_AGENT } from '../core/conversation/ownership.js';
import { computeScores, PROBLEM_HANDOFF_THRESHOLD, type Signal } from '../core/scoring/signals.js';
import { computeQuote, selectTier } from '../core/commerce/quote.js';
import { toConfirmableOrder } from '../core/commerce/confirmable.js';
import {
  guardFallbackReply,
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
    readonly unitPriceUsd: number;
    readonly discountPct: number;
    readonly totalUsd: number;
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
  /** M13: taught facts provided to this reply (identified product + business-level). */
  knowledge: readonly KnowledgeSnippet[];
  /** M13: the knowledge row ids that SUPPORTED the reply (audit). */
  knowledgeUsed: readonly string[];
  newState: ConversationState;
  signals: readonly Signal[];
  stateBefore: ConversationState;
  provenance: { promptVersion: string | null; modelId: string | null };
  guardViolations: number;
  /** Stage timings (ms) + token usage — the P1 measurement surface. */
  timings: { retrievalMs: number; analyzerMs: number; replyMs: number; totalMs: number };
  usage: { llmCalls: number; inputTokens: number; outputTokens: number };
  fingerprint: DecisionFingerprint;
};

export async function computeTurn(ports: TurnPorts, req: TurnRequest): Promise<TurnResult> {
  const { tenant, retriever, analyzer, replyWriter } = ports;
  const t0 = Date.now();
  const timings = { retrievalMs: 0, analyzerMs: 0, replyMs: 0, totalMs: 0 };
  const usage = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };

  const state = await tenant.conversations.loadState(req.conversationId);
  if (!state) throw new Error(`conversation not found: ${req.conversationId}`);

  const email = extractEmail(req.text);

  // ── Cheap gates first: don't pay for analysis we won't use. ────────────────
  // Text-only signal detection runs BEFORE the analyzer: "I want to speak to a
  // human" must trigger the handoff without first paying for (and waiting on)
  // an LLM analysis of a message whose outcome is already determined.
  const textOnlySignals = detectSignals({
    text: req.text, state, analysis: null, unitPriceUsd: null,
  });
  const historicEarly = await tenant.signals.unresolved(req.conversationId);
  const preScore = computeScores([...historicEarly, ...textOnlySignals]);

  const gated =
    state.assignedTo !== null ||
    preScore.problem >= PROBLEM_HANDOFF_THRESHOLD ||
    detectInjection(req.text).detected ||
    detectFastPath(req.text, state).matched;

  let retrieved: readonly RetrievedProduct[] = [];
  let analysis: Analysis | null = null;
  let promptVersion: string | null = null;
  let modelId: string | null = null;

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

  let indicativePrice: number | null = null;
  if (productIdForPrice && qtyForPrice > 0) {
    const tiers = await tenant.catalog.priceTiers(productIdForPrice);
    indicativePrice = selectTier(tiers, qtyForPrice)?.unitPriceUsd ?? null;
  }

  const fresh = detectSignals({ text: req.text, state, analysis, unitPriceUsd: indicativePrice });
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
      const [tiers, policy, rules] = await Promise.all([
        tenant.catalog.priceTiers(product.id),
        tenant.catalog.pricingPolicy(product.id),
        tenant.catalog.negotiationRules(),
      ]);
      quoteInputs = { tiers, policy, rules, quantity: decision.quantity.value };
      const q = computeQuote({ product, tiers, policy, rules, quantity: decision.quantity.value });
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
  let guardViolations = 0;
  let confirmBlockedReasons: readonly string[] = [];
  let knowledge: readonly KnowledgeSnippet[] = [];
  let knowledgeUsed: readonly string[] = [];

  switch (decision.action.kind) {
    case 'silent':
      reply = null;
      replyDeterministic = true;
      break;

    case 'canned_reply':
      reply = decision.action.reply;
      replyDeterministic = true;
      break;

    case 'handoff':
      reply = HANDOFF_REPLY;
      replyDeterministic = true;
      break;

    case 'confirm_order': {
      const confirmable = toConfirmableOrder({
        state: newState,
        product,
        quote,
        paymentTerms: '30% deposit, 70% before shipment',
      });
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
      knowledge = await tenant.knowledge.retrieve({ query: req.text, productId: identifiedProductId, k: 6 });
      const knowledgeNumbers = identifiedProductId === null ? [] : knowledge
        .filter((s) => s.productId === identifiedProductId)
        .flatMap((s) => extractNumerals(`${s.label} ${s.content}`).map((n) => n.value));
      const numeralAllow = [...(refusalCtx?.allow ?? []), ...knowledgeNumbers];

      // Deterministic answer path: a strong FAQ / buyer_answer match ships the
      // owner's authored answer (claims-guarded — an unauthorised cert in the
      // answer still cannot pass), no LLM, no tokens. This is what makes the
      // teach→answer→correct loop deterministic and provable in the sandbox.
      const faq = knowledge.find((s) => ANSWER_KINDS.has(s.kind) && s.relevance >= FAQ_ANSWER_MIN_RELEVANCE);
      if (faq) {
        const answerAllow = [...numeralAllow, ...extractNumerals(faq.content).map((n) => n.value)];
        const claimed = guardClaims({ reply: faq.content, policy: claimsPolicy });
        const guarded = claimed.ok
          ? guardNumerals({ reply: claimed.value, quote, state: newState, clientText: req.text, allow: answerAllow })
          : null;
        if (guarded?.ok) {
          reply = guarded.value;
          replyDeterministic = true;
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
        reply = claimed.value;
        knowledgeUsed = knowledge.map((s) => s.id);   // facts provided to this reply
      }
      if (reply === null) {
        // Two violations: the model does not get a third chance to invent a
        // number. Deterministic fallback, sourced figures only.
        reply = guardFallbackReply(quote, nextQuestion);
        replyDeterministic = true;
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
      unitPriceUsd: quote.unitPriceUsd,
      discountPct: quote.discountPct,
      totalUsd: quote.totalUsd,
    },
  };

  timings.totalMs = Date.now() - t0;
  return {
    decision, analysis, retrieved, quote, quoteInputs, quoteRefusal,
    reply, replyDeterministic, knowledge, knowledgeUsed, newState, signals,
    stateBefore: state,
    provenance: { promptVersion, modelId },
    guardViolations,
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
    const confirmable = toConfirmableOrder({
      state: r.newState, product, quote: r.quote,
      paymentTerms: '30% deposit, 70% before shipment',
    });
    if (confirmable.ok && product) {
      const created = await tenant.orders.create(req.conversationId, confirmable.value);
      orderCreated = created;
      reply = orderConfirmedReply({
        orderReference: created.orderReference,
        productName: product.name,
        quantity: confirmable.value.quantity.value,
        unit: confirmable.value.quantity.unit,
        email: confirmable.value.email,
      });
      await tenant.events.append(req.conversationId, 'order_created', {
        orderId: created.orderId, alreadyExisted: created.alreadyExisted,
      });
      if (!created.alreadyExisted) {
        await tenant.conversations.close(req.conversationId);
      }
    }
  }

  // Quote audit record (reproducibility).
  let quoteId: string | null = null;
  if (r.quote && r.quoteInputs && r.decision.product) {
    const rec = await tenant.audit.recordQuote({
      conversationId: req.conversationId,
      productId: r.decision.product.productId,
      quantity: r.quote.quantity.value,
      inputs: r.quoteInputs,
      unitPriceUsd: r.quote.unitPriceUsd,
      discountPct: r.quote.discountPct,
      totalUsd: r.quote.totalUsd,
      requiresHuman: r.quote.requiresHuman,
      appliedRules: r.quote.appliedRules,
    });
    quoteId = rec.quoteId;
    await tenant.events.append(req.conversationId, 'quote_computed', { quoteId });
  }

  // Signals: persist fresh ones (idempotent per kind in the repo).
  for (const s of r.signals) {
    await tenant.signals.record(req.conversationId, s);
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
  });

  // Funnel events.
  if (r.decision.hotLead) await tenant.events.append(req.conversationId, 'lead_hot', {});
  if (r.decision.action.kind === 'handoff') {
    await tenant.events.append(req.conversationId, 'handoff', {});
  }
  if (r.decision.injectionDetected) {
    await tenant.events.append(req.conversationId, 'injection_blocked', {});
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
      // M34.5 — a quantity she HEARD, which then set the tier and the price,
      // does not auto-send however the owner has set her autonomy. This never
      // widens permission: auto becomes draft, draft stays draft.
      const heardPrice = quantityWasHeardNotTyped({
        provenance: req.provenance ?? 'typed', quote: r.quote, turnText: req.text,
      });
      // M34.6 — ops kill switches, applied last because they must win. Only
      // `forceDraft`/`silenceCapability` are resolved here; `globalSilence` is
      // enforced at the SEND gate, where it also catches replies queued before
      // the switch was thrown. `effectiveMode` is monotone by construction, so
      // this rung, like the one above it, can only ever remove authority.
      const mode = effectiveMode(heardPrice ? 'draft' : policyMode, capability, await tenant.ops.switches());

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
          ...(heardPrice ? { heldBecause: 'quantity_heard_not_typed' } : {}),
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
