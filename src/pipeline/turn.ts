import { rungOf } from '../core/trust/ramp.js';
import type { Tenant } from '../db/ports.js';
import { asksForSample, sampleAnswerContext } from '../core/commerce/samples.js';
import { asksOrderStatus, orderStatusReply } from '../core/commerce/orderState.js';
import { formatDate } from '../core/owner/i18n/format.js';
import type { Money } from '../core/types/money.js';
import type { Retriever, RetrievedProduct } from '../retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import type { ConversationId, Email } from '../core/types/ids.js';
import { extractEmail } from '../core/types/ids.js';
import type { ConversationState, PendingQuestion } from '../core/types/conversation.js';
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
import { guardNumerals, extractNumerals, catalogueWords } from '../core/safety/numerals.js';
import { guardClaims } from '../core/safety/claims.js';
import { guardForbidden } from '../core/safety/forbiddenWords.js';
import { guardIdentity, type IdentityViolation } from '../core/safety/identity.js';
import { promisesDeletion } from '../core/safety/deletion.js';
import { disclosureFor, withDisclosure, disclosureStanding } from '../core/conversation/disclosure.js';
import { fixedLanguage, gateLanguage, languageEvidence, UNDETERMINED } from '../core/conversation/gateLanguage.js';
import { OPT_OUT_REPLIES, optOutLanguage } from '../core/safety/optOut.js';
import type { Notice } from '../core/channel/sendGate.js';

/**
 * Why a reply that would have gone alone waits: nobody can tell its language
 * (LG), its language's sentence is unread, or does not exist.
 */
const withheldBecause = (language: string | null | undefined): 'language_unknown' | 'disclosure_not_reviewed' | 'language_without_disclosure' =>
  language === UNDETERMINED ? 'language_unknown'
    : disclosureStanding(language) === 'unwritten' ? 'language_without_disclosure' : 'disclosure_not_reviewed';
/** The two letters a language is known by here ("pt-BR" → "pt"); English when none was read. */
const languageHead = (language: string | null | undefined): string => (language ?? '').slice(0, 2).toLowerCase() || 'en';
import { ANSWER_KINDS, type KnowledgeSnippet } from '../core/types/knowledge.js';
import { detectSignals, personRequestLanguage, stockQuestionLanguage } from '../core/scoring/detect.js';
import { WAITING_HUMAN_AGENT, aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';
import { computeScores, PROBLEM_HANDOFF_THRESHOLD, type Signal } from '../core/scoring/signals.js';
import { statesAPrice } from '../core/safety/statesPrice.js';
import { computeQuote, selectTier, startingQuantity } from '../core/commerce/quote.js';
import { closureNote, withheldOf } from '../core/commerce/closures.js';
import { toConfirmableOrder } from '../core/commerce/confirmable.js';
import { proofUrl } from '../db/proofs.js';
import {
  guardFallbackReply,
  SAFE_REPLIES,
  HANDOFF_REPLIES,
  orderBlockedReply,
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
  /**
   * Q1 — the external ids of the messages this turn answers (a batch's
   * fragments). They are the message itself, so they are left out of the
   * history the analyser is shown.
   */
  answering?: readonly string[];
};

/** Q1 — how many earlier messages the analyser sees, as prompts/analysis.txt promises ("last 6 turns"). */
export const HISTORY_TURNS = 6;

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
  /**
   * PC (2026-10-04) — this business's own product names and codes, exactly as
   * the numeral guard was given them (`catalogueWords`), so the trust
   * harness re-runs the guard on the same text. Empty when no guarded path
   * wrote the reply.
   */
  catalogue: readonly string[];
  newState: ConversationState;
  signals: readonly Signal[];
  stateBefore: ConversationState;
  /**
   * LG (decision 16) — the customer's language as the gate reads it, by fixed
   * rules (core/conversation/gateLanguage.ts): a script, or Latin words the
   * analysis agrees with; `und` when nobody can tell. Never null.
   */
  gateLanguage: string;
  provenance: { promptVersion: string | null; modelId: string | null };
  guardViolations: number;
  /**
   * M37.5 — the forbidden terms that stopped a draft, if any. The owner is told
   * WHICH word, because "she said something she should not have" is not
   * actionable and "she used 傻逼" is.
   */
  forbiddenHits: readonly { readonly term: string; readonly source: 'floor' | 'owner' }[];
  /**
   * Why the identity guard stopped a reply, if it did — so the card that held
   * the turn can say which of the two it was, in the same way the
   * forbidden-word card names the word. Null on every ordinary turn.
   *
   *   denied_being_ai              she claimed to be a person
   *   identity_question_unanswered the buyer asked what they were talking to
   *                                and the reply did not say
   */
  identityViolation: IdentityViolation | null;
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
  /**
   * 0080 — the question this turn's reply asks the customer ("shall I
   * confirm?"), or null. It travels WITH the reply — on the draft, and on the
   * outbound message — and becomes the conversation's pending question only
   * when the message actually leaves. A reply nobody sent asked nothing.
   */
  asks: PendingQuestion | null;
  /**
   * 0075 — the words of a reply that promised the buyer a deletion, which was
   * therefore thrown away and never sent (layer 2, core/safety/deletion.ts).
   * Null on every other turn.
   */
  deletionPromiseWithheld: string | null;
  /**
   * 0076 — THIS message asked for the buyer's data to be deleted: its own words
   * said so (layer 1), or a reply to it promised the deletion (layer 2). Not an
   * earlier request still unresolved — that one was written down when it came.
   */
  deletionAsked: boolean;
  /**
   * 0135 — the buyer's words, this turn, asked the business to stop messaging
   * them. commitTurn records it (`opt_outs`) before anything else is written.
   */
  optedOut: boolean;
  /**
   * 0135 — the reply is one of the fixed sentences that must reach a buyer a
   * person holds: the line that answers a stop. Carried to the draft and the
   * outbound row, where the send gate reads it.
   */
  notice: Notice | null;
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
  // K5 · RT — how this business sells, read once for the turn.
  const selling = await tenant.catalog.selling();
  // M45 — decided here, once, for every action kind. A buyer who asks for a
  // sample in the same message that triggers a handoff has still asked.
  const sampleRequested = asksForSample(req.text);

  // ── Cheap gates first: don't pay for analysis we won't use. ────────────────
  // Text-only signal detection runs BEFORE the analyzer: "I want to speak to a
  // human" must trigger the handoff without first paying for (and waiting on)
  // an LLM analysis of a message whose outcome is already determined.
  //
  // That is "wants a person", layer 1 (core/scoring/detect.ts). Layer 2 is the
  // analyser's `wantsPerson`, read by the second detectSignals below — after
  // the analysis and BEFORE any reply is written, so a buyer it hands off
  // never reaches the writer: the decision is a hand-off, not a reply.
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

  /** What was said before, both sides — read once, and only when something needs it. */
  let earlier: Awaited<ReturnType<typeof tenant.conversations.recentMessages>> | null = null;
  const history = async () => (earlier ??= await tenant.conversations.recentMessages(req.conversationId, {
    limit: HISTORY_TURNS, excluding: [req.messageId, ...(req.answering ?? [])],
  }));

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
      // Q1 — what was said before, both sides, as the prompt promises.
      recentMessages: await history(),
      ...(selling.quantityFirst ? {} : { priceFirst: true }),
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

  // ── LG (decision 16): the customer's language, by fixed rules. ─────────────
  // This turn's words first; a message that says nothing of its language ("ok",
  // "200 pcs?") is read by the customer's last three. The analysis — this
  // turn's, else the one remembered on the customer — only ever confirms a
  // Latin-script reading, never makes one. A request for a person caught
  // before any model read it is in the language of the pattern that caught it.
  // The fixed sentences below are said in it where it is one of the three they
  // are written in.
  const pattern = analysis ? null : (personRequestLanguage(req.text) ?? stockQuestionLanguage(req.text) ?? optOutLanguage(req.text));
  const analysedLanguage = analysis?.language.detected ?? (pattern ? null : state.preferredLanguage);
  const gateLang = languageEvidence(req.text, analysedLanguage, pattern) ?? gateLanguage(
    (await history()).filter((m) => m.direction === 'inbound').map((m) => m.text).reverse().slice(0, 3), analysedLanguage);
  const sayIn = fixedLanguage(gateLang);

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
  /**
   * K5 · LAYER 1 — "PRICES GO TO ME". The business states no price; the
   * analysis says the customer asked one. The owner answers it: a hand-off
   * with its own reason, before any reply is written or any quote worked out.
   */
  if (selling.pricesToOwner && analysis?.intent.primary === 'price_request') byKind.set('price_to_owner', { kind: 'price_to_owner' });
  let signals: readonly Signal[] = [...byKind.values()];

  // ── Decide. Pure. ───────────────────────────────────────────────────────────
  let decision = decideTurn({
    state,
    text: req.text,
    analysis,
    extractedEmail: email,
    signals,
    quote: null, // negotiation logic consults it in Week 3; gates ignore it
    language: sayIn,
  });

  // ── Quote: deterministic, snapshotted, Postgres-owned. ─────────────────────
  let quote: Quote | null = null;
  let quoteRefusal: QuoteRefusal | null = null;
  let quoteInputs: unknown = null;
  let product: Product | null = null;

  // RT — a shop or a brand gives the price first: with the product known and no
  // quantity yet, the price at the smallest quantity it sells (one, or its
  // minimum, or its first price band). A business that asks how many first (a
  // factory, an exporter) waits for it.
  const priceFirst = !selling.quantityFirst;
  // K5 — a business whose prices go to the owner is quoted nothing, whatever it holds.
  if (decision.product && (decision.quantity || priceFirst) && !selling.pricesToOwner) {
    product = await tenant.catalog.product(decision.product.productId);
    if (product) {
      const [tiers, policy, rules, closures] = await Promise.all([
        tenant.catalog.priceTiers(product.id),
        tenant.catalog.pricingPolicy(product.id),
        tenant.catalog.negotiationRules(),
        // M44 — the days she said her factory is shut.
        tenant.catalog.factoryClosures(),
      ]);
      const quantity = decision.quantity?.value ?? startingQuantity(product, tiers);
      quoteInputs = { tiers, policy, rules, quantity, ...(decision.quantity ? {} : { priceFirst: true }) };
      // M36 — what she already told THIS buyer about THIS product. Empty for a
      // new buyer, which is why a first quote is never refused by this guard.
      const priorQuotes = await tenant.audit.priorQuotesForClient(state.clientId, product.id);
      const q = computeQuote({
        product, tiers, policy, rules, quantity, priorQuotes,
        closures, now: ports.now(),
      });
      if (q.ok) quote = q.value;
      // A quantity the customer never named is never refused to them: without
      // a price at it, the turn goes on as it did before RT, with no quote.
      else if (decision.quantity) quoteRefusal = q.error;
    }
  }

  // ── New state (what commitTurn will persist). ──────────────────────────────
  //
  // 0080 — THE PENDING QUESTION IS WHAT THE CUSTOMER WAS ACTUALLY ASKED. A
  // question this turn's reply asks is not pending yet: the reply may be a
  // draft the owner never sends. It travels with the reply (`asks`) and is set
  // when the message leaves (the send path). What this turn keeps is only a
  // question already asked that is still the one being asked; anything else
  // it clears, because the customer has written since.
  const stateAfter = (d: TurnDecision): ConversationState => ({
    ...state,
    phase: d.nextPhase,
    turnCount: state.turnCount + 1,
    scores: d.scores,
    product: d.product,
    quantity: d.quantity,
    contact: { email: d.email },
    pendingQuestion: d.pendingQuestion !== null && d.pendingQuestion === state.pendingQuestion
      ? state.pendingQuestion : null,
    assignedTo:
      d.action.kind === 'handoff' && !d.action.notifyOnly
        ? (UNCLAIMED_AGENT as ConversationState['assignedTo'])
        : state.assignedTo,
  });
  let newState = stateAfter(decision);

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
  /** Why the identity guard stopped a reply, if it did. Owner-visible. */
  let identityViolation: IdentityViolation | null = null;
  /** G8 — the same, found in her own text rather than in what the employee wrote. */
  const forbiddenInHerText: ForbiddenInHerText[] = [];
  /** G8 — both generated attempts failed a guard; the reply is a stand-in. */
  let guardsFailedTwice = false;
  let confirmBlockedReasons: readonly string[] = [];
  /** 0075 — the words of a reply, or of an attempt at one, that promised the buyer a deletion. */
  let deletionPromiseWithheld: string | null = null;
  let knowledge: readonly KnowledgeSnippet[] = [];
  let knowledgeUsed: readonly string[] = [];
  let catalogue: readonly string[] = [];

  /**
   * 0135 — THE BUYER SAID STOP, in this turn's words (core/safety/optOut.ts).
   * Recorded by commitTurn whatever happens here; answered with one fixed line,
   * then nothing — whoever holds the conversation. Never when a deletion was
   * asked too: that hand-off says nothing (0075), and the stop is still recorded.
   */
  const optingOut = textOnlySignals.some((s) => s.kind === 'opted_out');
  const answersStop = optingOut && !signals.some((s) => s.kind === 'deletion_requested');
  let notice: Notice | null = null;

  switch (decision.action.kind) {
    case 'silent':
      // A person holds the conversation: the assistant says nothing — except
      // the one line that answers a stop, which nothing else will.
      reply = answersStop ? OPT_OUT_REPLIES[sayIn] : null;
      if (answersStop) notice = 'opt_out';
      replyDeterministic = true;
      answerPath = answersStop ? 'canned' : 'silent';
      break;

    case 'canned_reply':
      reply = decision.action.reply;
      replyDeterministic = true;
      // A bare yes/no to her own question never reached a model at all.
      answerPath = detectFastPath(req.text, state).matched ? 'fast_path' : 'canned';
      break;

    case 'handoff':
      replyDeterministic = true;
      // 0075 — a buyer who asked for their data to be deleted is answered by a
      // PERSON, and nothing is said first: not the fixed "one of our
      // specialists will follow up", not a receipt. The owner's decision
      // (2026-09-27) — anything said here could be read as a promise about the
      // buyer's data that only a person can make. Any unresolved request
      // counts, not only this turn's.
      //
      // 0077 — nor when nobody could tell what the message asked (the
      // analyser's answer could not be read): the same silence as an unheard
      // voice note or an unreadable file. A person reads it and answers.
      if (signals.some((s) => s.kind === 'deletion_requested' || s.kind === 'not_answered')) {
        reply = null;
        answerPath = 'silent';
      } else if (answersStop) {
        // 0135 — a stop is answered with its own line, not "someone will reply".
        reply = OPT_OUT_REPLIES[sayIn];
        notice = 'opt_out';
        answerPath = 'handoff';
      } else {
        reply = HANDOFF_REPLIES[sayIn];
        answerPath = 'handoff';
      }
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
        reply = orderBlockedReply(confirmable.error, quote, sayIn);
        replyDeterministic = true;
      }
      break;
    }

    case 'generate_reply': {
      const claimsPolicy = await tenant.catalog.claimsPolicy();
      const forbiddenTerms = await tenant.catalog.forbiddenTerms();
      // PC (2026-10-04, the owner's decision) — her own products' names and
      // her own codes, read once for the turn: their exact words are set aside
      // by the numeral guard at every one of its four places below; their
      // figures are never sourced values (core/safety/numerals.ts).
      catalogue = catalogueWords(await tenant.catalog.productWords());
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
      // VAR (0111) — the identified product's options, whole: "in M, in
      // black?" is answered from them, not from whatever text retrieval found.
      // Their figures (a size 42, a 250 ml) are hers, sourced like her facts.
      const options = identifiedProductId === null ? [] : await tenant.catalog.productOptions(identifiedProductId);
      const optionNumbers = options.flatMap((o) => extractNumerals(`${o.name} ${o.values.join(', ')}`).map((n) => n.value));
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
        ...optionNumbers,
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
          const zone = await tenant.zone();
          const said = orderStatusReply({
            reference: order.reference,
            update: order.update,
            // The workspace's own zone, so "as of the 3rd" means its 3rd.
            formatDate: (d) => formatDate('en', d, zone),
          });
          const clean = guardForbidden({ reply: said.reply, ownerTerms: forbiddenTerms });
          const guarded = clean.ok
            ? guardNumerals({ reply: clean.value, quote, state: newState, clientText: req.text, allow: said.allow, catalogue })
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
          ? guardNumerals({ reply: wordSafe.value, quote, state: newState, clientText: req.text, allow: answerAllow, catalogue })
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
          ...(options.length ? { options } : {}),
          // Absent when she has stated nothing: the model is told nothing to
          // work from rather than being asked to be careful about samples.
          ...(sampleCtx?.ok ? { sampleNote: sampleCtx.note } : {}),
          ...(closureCtx ? { closureNote: closureCtx.note } : {}),
          ...(speaker ? { speaker } : {}),
          // RT — a price-first business: the writer gives the price as soon as the product is known.
          ...(priceFirst ? { priceFirst: true } : {}),
        });
        usage.llmCalls++;
        usage.inputTokens += w.usage.inputTokens;
        usage.outputTokens += w.usage.outputTokens;
        promptVersion = promptVersion ?? w.promptVersion;
        // 0075 — the writer read this as a request to delete the buyer's data
        // and promised it. Whatever else the attempt got wrong, that reading
        // decides the turn: no second attempt and no stand-in — layer 2, below
        // the switch, hands it to a person with nothing said.
        deletionPromiseWithheld = promisesDeletion(w.reply);
        if (deletionPromiseWithheld !== null) break;
        const guarded = guardNumerals({
          reply: w.reply,
          quote,
          state: newState,
          clientText: req.text,
          // M13: the identified product's taught numbers are sourced, like the quote's.
          allow: numeralAllow,
          catalogue,
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
        // SHE MAY NOT CLAIM TO BE HUMAN. `prompts/response.txt` tells the
        // writer never to deny being an AI; this is the same rule where it
        // cannot be talked out of. Last in the chain, so it reads the text
        // exactly as it would have left — a denial the numeral guard rewrote
        // into existence is still a denial.
        //
        // Failing here spends a retry like any other guard, and twice means
        // the turn is HELD for a person (`guardsFailedTwice` below). That is
        // the right end: a buyer who asked what they are talking to, twice
        // answered wrongly, should be answered by somebody.
        const honest = guardIdentity({ reply: clean.value, buyerText: req.text });
        if (!honest.ok) {
          guardViolations++;
          identityViolation = honest.error;
          continue;
        }
        reply = clean.value;
        knowledgeUsed = knowledge.map((s) => s.id);   // facts provided to this reply
      }
      if (reply === null && deletionPromiseWithheld === null) {
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
        const standIn = guardFallbackReply(quote, analysis?.intent.nextLogicalQuestion ?? null, sayIn);
        const numeralsOk = guardNumerals({ reply: standIn, quote, state: newState, clientText: req.text, allow: numeralAllow, catalogue });
        const passes = numeralsOk.ok
          && guardClaims({ reply: standIn, policy: claimsPolicy }).ok
          && guardForbidden({ reply: standIn, ownerTerms: forbiddenTerms }).ok;
        reply = passes ? standIn : SAFE_REPLIES[sayIn];
        replyDeterministic = true;
        answerPath = 'stand_in';
      }
      timings.replyMs = Date.now() - tw;
      break;
    }
  }

  /**
   * 0075 · LAYER 2 — NO REPLY PROMISES A DELETION.
   *
   * Layer 1 (`deletion_requested`) read the buyer's words, and a buyer can ask
   * in words it does not know. So whatever produced this reply — the writer
   * (any attempt, above), a taught answer, a stand-in — if it promises or
   * claims that the buyer's data is or will be deleted, it is thrown away, and
   * the turn becomes the same silent hand-off: a person answers, the buyer is
   * told nothing. The decision is re-made by `decideTurn` from the signals with
   * the request added, so the handoff event, the owner's alert and "Needs you"
   * read one decision; and no quote is recorded as told to a buyer who was
   * told nothing.
   */
  if (deletionPromiseWithheld === null && reply !== null) deletionPromiseWithheld = promisesDeletion(reply);
  if (deletionPromiseWithheld !== null) {
    signals = [...signals.filter((s) => s.kind !== 'deletion_requested'), { kind: 'deletion_requested' }];
    decision = decideTurn({ state, text: req.text, analysis, extractedEmail: email, signals, quote: null, language: sayIn });
    newState = stateAfter(decision);
    reply = null;
    replyDeterministic = true;
    answerPath = 'silent';
    knowledgeUsed = [];
    quote = null;
    quoteInputs = null;
    quoteRefusal = null;
  }

  /**
   * K5 · LAYER 2 — NO REPLY STATES A PRICE WHERE PRICES GO TO THE OWNER.
   *
   * Layer 1 read the analysis; a customer can ask in words it reads as
   * something else, and the numeral guard passes a figure the customer wrote
   * ("is it $20?" — "yes, $20"). So whatever produced this reply, if it states
   * a price (`statesAPrice`), it is thrown away and the turn is re-decided as
   * the owner's: the same hand-off as layer 1, its ordinary sentence and all.
   */
  if (selling.pricesToOwner && reply !== null && deletionPromiseWithheld === null
      && decision.action.kind !== 'handoff' && statesAPrice(reply)) {
    signals = [...signals.filter((s) => s.kind !== 'price_to_owner'), { kind: 'price_to_owner' }];
    decision = decideTurn({ state, text: req.text, analysis, extractedEmail: email, signals, quote: null, language: sayIn });
    newState = stateAfter(decision);
    reply = decision.action.kind === 'handoff' ? HANDOFF_REPLIES[sayIn] : null;
    replyDeterministic = true;
    answerPath = 'handoff';
    knowledgeUsed = [];
    quote = null;
    quoteInputs = null;
    quoteRefusal = null;
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
  const hold = holdReasonOf({
    provenance: req.provenance ?? 'typed', quote, turnText: req.text, guardsFailedTwice,
    identity: identityViolation?.kind ?? null,
    // 0080 — an order this customer said yes to waits for the owner.
    orderWaiting: await tenant.orderProposals.waiting(req.conversationId),
  });

  timings.totalMs = Date.now() - t0;
  return {
    decision, analysis, retrieved, quote, quoteInputs, quoteRefusal,
    reply, replyDeterministic, knowledge, knowledgeUsed, catalogue, newState, signals,
    answerPath,
    ownUnderstanding,
    analyserAvoidable: analyserWasAvoidable({
      path: answerPath, analyserCalled: analysis !== null,
      productBefore: state.product?.productId ?? null, productUsed: productSearchedUnder,
    }),
    stateBefore: state,
    gateLanguage: gateLang,
    provenance: { promptVersion, modelId },
    guardViolations,
    forbiddenHits,
    identityViolation,
    forbiddenInHerText,
    sampleRequested,
    hold,
    asks: reply !== null ? decision.pendingQuestion : null,
    deletionPromiseWithheld,
    deletionAsked: textOnlySignals.some((s) => s.kind === 'deletion_requested') || deletionPromiseWithheld !== null,
    optedOut: optingOut,
    notice: reply === null ? null : notice,
    timings, usage,
    fingerprint,
  };
}

/** Everything commitTurn causes beyond the database, for the caller to enqueue. */
export type TurnEffects = {
  // 0135 — `outbound.notice`: the line that answers a stop, for the send gate.
  /**
   * Present only when the reply may auto-send (capability in auto mode).
   * 0080 — `asks`: the question it asks, set as the conversation's pending
   * question by the send path when the message leaves, not before.
   */
  outbound: { conversationId: ConversationId; reply: string; asks?: PendingQuestion | null; notice?: Notice | null } | null;
  /** Present when the reply needs owner approval (capability in draft mode):
   * a pending draft was persisted; the owner resolves it via applyOwnerCommand. */
  draftCreated: { conversationId: ConversationId; draftId: string } | null;
  hotLeadAlert: boolean;
  handoffAlert: boolean;
  /**
   * 0076 — the owner is told THIS was a deletion request, in its own words and
   * by e-mail as well as WhatsApp (notify.ts), instead of the ordinary hand-off
   * alert. Absent on effects that predate it: false.
   */
  deletionAlert?: boolean;
  /**
   * 0080 — the customer said yes to an order, and it now waits for the owner's
   * tap: nothing was confirmed and nothing was sent. The owner is told by
   * e-mail as well as WhatsApp (notify.ts). A turn never creates an order.
   */
  orderProposed: { proposalId: string; fresh: boolean } | null;
};


export async function commitTurn(
  ports: TurnPorts,
  req: TurnRequest,
  r: TurnResult,
  startedAt: number,
): Promise<TurnEffects> {
  const { tenant } = ports;
  let orderProposed: TurnEffects['orderProposed'] = null;
  let reply = r.reply;

  /*
   * 0080 — THE CUSTOMER'S "YES" IS A PROPOSAL, NEVER AN ORDER.
   *
   * It was: a bare "yes" created the order, closed the conversation and sent
   * "Your order is confirmed" in every mode, drafts included, with no owner
   * step. Now what they said yes to is written down, and waits for the
   * owner's tap (pipeline/orderProposal.ts). Nothing is confirmed, nothing is
   * sent, the conversation stays open, and the owner is alerted. Every mode
   * alike: the order is the owner's decision however much the assistant may
   * say alone. Only through the branded ConfirmableOrder, as the order itself.
   */
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
      const proposed = await tenant.orderProposals.propose({
        conversationId: req.conversationId, messageId: req.messageId, order: confirmable.value,
      });
      orderProposed = proposed;
      await tenant.events.append(req.conversationId, 'order_proposed', {
        proposalId: proposed.proposalId, fresh: proposed.fresh,
      });
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

  /*
   * 0076 — THE REQUEST IS WRITTEN DOWN WITH THE HAND-OFF, not later by hand.
   *
   * The hand-off's reason is cleared when the conversation is handed back, so
   * it cannot be the record: the buyer, this conversation, the message that
   * asked and when are written here, in the turn's own transaction, whoever
   * holds the conversation. The owner decides what happens on the buyer's page.
   *
   * The owner is told in its own words when it is new, and whenever the
   * conversation was handed over because of one — not for a repeat into a
   * conversation a person already holds.
   */
  let deletionAlert = r.decision.action.kind === 'handoff'
    && r.signals.some((s) => s.kind === 'deletion_requested');
  if (r.deletionAsked) {
    const noted = await tenant.deletionAsks.note({
      conversationId: req.conversationId, messageId: req.messageId, now: ports.now(),
    });
    deletionAlert ||= noted === 'noted';
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
  // 0135 — the buyer said stop: written down for them on this channel BEFORE
  // any draft is (recording supersedes the drafts waiting, and cancels what
  // was queued). Whoever holds the conversation, whatever is said back.
  if (r.optedOut) {
    const recorded = await tenant.optOuts.record({ conversationId: req.conversationId, now: ports.now() });
    await tenant.events.append(req.conversationId, 'opted_out', { recorded });
  }
  // 0075 — layer 2 threw a reply away because it promised a deletion. Kept on
  // the record with the words that did it, so the ones layer 1 missed can be
  // found and taught to it.
  if (r.deletionPromiseWithheld !== null) {
    await tenant.events.append(req.conversationId, 'deletion_promise_withheld', { words: r.deletionPromiseWithheld });
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
  // applyOwnerCommand. 0080: there is no exception any more. The order
  // confirmation is sent by the owner's tap on a proposal, never by a turn.
  let outbound: TurnEffects['outbound'] = null;
  let draftCreated: TurnEffects['draftCreated'] = null;
  if (reply) {
    const capability = capabilityOf(r.decision, r.quote !== null);
    const grants = await tenant.autonomy.grants();
    // TZ — night-shift windows are the workspace's own hours.
    const policyMode = resolveMode({ capability, grants, now: ports.now(), timeZone: await tenant.zone() });
    // G7a — her hold rules (a quantity she HEARD, M34.5; a discount past her
    // ask-first line) do not auto-send however her autonomy is set. This
    // never widens permission: auto becomes draft, draft stays draft.
    // M34.6 — ops kill switches, applied last because they must win. Only
    // `forceDraft`/`silenceCapability` are resolved here; `globalSilence` is
    // enforced at the SEND gate, where it also catches replies queued before
    // the switch was thrown. `effectiveMode` is monotone by construction, so
    // this rung, like the one above it, can only ever remove authority.
    /*
     * THE SENTENCE SHE WOULD SAY, IF SHE IS ABOUT TO SPEAK ALONE.
     *
     * Composed BEFORE the mode is settled, because whether it can be composed
     * at all is one of the things that decides the mode. Null when there is
     * no assistant name or no business name to put in it.
     *
     * One extra lookup per auto turn. Nothing at all on the turns that draft:
     * a draft is read by a person, and a person needs no disclosure.
     */
    const disclosureText = async (): Promise<string | null> => {
      const who = await tenant.conversations.speaker(req.conversationId);
      return disclosureFor({
        // LG — the sentence in the language the gate released, never another.
        detected: r.gateLanguage,
        name: who?.name ?? null,
        business: who?.business.name ?? null,
      });
    };

    /*
     * SHE MAY NOT SPEAK ALONE UNTIL SHE CAN SAY WHAT SHE IS.
     *
     * The gap this closes is a real fleet's, not a hypothetical: every
     * workspace activated BEFORE Getting ready asked for the name is live
     * today with no confirmation on file. Without this rung, autonomy on such
     * a workspace sends messages that skip the disclosure silently — the rule
     * quietly not applying to exactly the accounts that predate it, which is
     * the worst way for a safety rule to fail.
     *
     * Two conditions, and both are about the same sentence:
     *   · the owner has CONFIRMED the name (0065), because it is a name a
     *     buyer reads and she should not meet it in a transcript; and
     *   · there is actually a name and a business name to say.
     *
     * The consequence is a fall back to draft, never a silence: she keeps
     * working, the owner reads each reply, and the autonomy page says why.
     * Monotone like the rungs around it — this can only ever remove
     * authority, never grant it.
     */
    const speaksAlone = policyMode === 'auto';
    // G4 (0102) — a workspace that signed itself up sends nothing alone until
    // it has earned it (the ramp, or the operator for a pilot); a practice
    // copy answers as its workspace does. Monotone like the rest: it can only
    // take authority away.
    // R2 (0106) — and only as far as its rung: greet/qualify/recommend/follow_up
    // need rung 1 (talks), quote/negotiate rung 2 (sells).
    const earned = !speaksAlone || (await tenant.autonomy.earnedRung()) >= rungOf(capability);
    // R3 (0107) — a reply that states a product's price goes alone only after
    // the owner has sent that product's first quote themselves.
    const quotedProduct = r.quote && r.decision.product ? r.decision.product.productId : null;
    const vetted = !speaksAlone || !quotedProduct || await tenant.autonomy.quoteVetted(quotedProduct);
    // The native-review gate, at the one place that decides whether a
    // message goes out alone — so it binds capabilities switched on BEFORE
    // the rule existed, not only new choices made on the owner's page. Per
    // language (2026-09-30): the customer's, read the way the sentence itself
    // is chosen. One whose sentence is unread, or that has none, drafts.
    // LG (decision 16) — the language is the gate's, decided by fixed rules,
    // never the analysis's word alone; one nobody can tell (`und`) drafts.
    const language = r.gateLanguage;
    const released = !speaksAlone || (language !== UNDETERMINED && tenant.autonomy.released(language));
    // LG — and, in a workspace that signed itself up, only once five replies in
    // that language have gone out with the owner's approval (trust first;
    // 0108). A workspace the operator made or opened is not bound.
    const proven = !speaksAlone || !released || await tenant.autonomy.languageProven(languageHead(language));
    const sentence = speaksAlone && released ? await disclosureText() : null;
    const named = speaksAlone && released ? await tenant.autonomy.assistantNamed() : true;
    const mayDisclose = !speaksAlone || (earned && vetted && released && proven && named && sentence !== null);
    /** What the card and the timeline say about the language, when that is why it waits. */
    const languageWithheld = !released
      ? (withheldBecause(language) === 'language_unknown' ? { reason: 'language_unknown' as const }
        : { reason: withheldBecause(language), language: languageHead(language) })
      : !proven ? { reason: 'language_new' as const, language: languageHead(language) } : null;

    const mode = effectiveMode(
      (r.hold || !mayDisclose) ? 'draft' : policyMode,
      capability, await tenant.ops.switches(),
    );
    if (speaksAlone && !mayDisclose) {
      // Recorded, because a capability that silently stopped acting as the
      // owner set it is the kind of thing she should be able to find.
      await tenant.events.append(req.conversationId, 'autonomy_withheld', {
        capability,
        ...(!earned ? { reason: 'not_earned' } : !vetted ? { reason: 'first_quote' } : languageWithheld
          ? languageWithheld : { reason: named ? 'no_assistant_name' : 'assistant_not_named' }),
      });
    }

    const recordDisclosure = async (why: 'first_auto_send' | 'identity_question') => {
      // In this turn's transaction, like the draft beside it. The send is
      // queued after the commit, so a queue that never accepts it leaves this
      // conversation marked as told — the same optimism the draft path has
      // always had, and the same remedy: the owner can see it on the timeline.
      //
      // The COLUMN means "when this conversation was first told" and is not
      // moved by a later telling; the EVENT records each one, with its reason.
      if (r.newState.aiDisclosedAt === null) {
        await tenant.conversations.markAiDisclosed(req.conversationId, ports.now());
      }
      await tenant.events.append(req.conversationId, 'ai_disclosed', { reason: why });
    };

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
        // R1 (fix 3) — did the reply that was KEPT fail its guards, or was a
        // tripped attempt rewritten clean? Only the first counts as evidence.
        final: r.hold === 'guards_failed_twice',
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
      // Once per conversation: the first message nobody approved carries it,
      // and the ones after it do not. "Once" is counted by what REACHED the
      // buyer (0079): until a message carrying it has been accepted by the
      // provider, every reply sent alone carries it. One that was refused
      // (Stop, a hand-over, the allowlist) or failed told him nothing; one
      // still queued may yet fail — and a reply that overtook it would have
      // gone out alone. So two replies queued before either leaves both say
      // it: read twice, rarely, rather than not at all.
      const say = r.newState.aiDisclosureDeliveredAt === null ? sentence : null;
      outbound = {
        conversationId: req.conversationId, reply: say ? withDisclosure(say, reply) : reply, asks: r.asks,
        ...(r.notice ? { notice: r.notice } : {}),
      };
      if (say) await recordDisclosure('first_auto_send');
      // R5 (0109) — work sent alone is on the record, so it can be spot-checked
      // once it has left: the words exactly as queued, the capability, and the
      // message it answered. Approved drafts and these share one outbound path.
      await tenant.events.append(req.conversationId, 'auto_sent', { capability, messageId: req.messageId, body: outbound.reply });
    } else {
      /*
       * Decided BEFORE the draft is written, because the draft has to carry
       * it: a reply the disclosure replaced may not be sent as it stands, and
       * the approval path reads that from the row.
       */
      const disclosureInstead = policyMode === 'auto'
        && r.identityViolation?.kind === 'identity_question_unanswered'
        && sentence !== null;

      const d = await tenant.drafts.create({
        conversationId: req.conversationId, capability,
        draftText: reply, turnMessageId: req.messageId,
        ...(disclosureInstead ? { replacedByDisclosure: true } : {}),
        asks: r.asks,
        ...(r.notice ? { notice: r.notice } : {}),
      });
      draftCreated = { conversationId: req.conversationId, draftId: d.draftId };
      // G10 — the language the reply is in, so the card can say when the owner may not read it.
      const replyLanguage = r.analysis?.language.replyIn ?? r.analysis?.language.detected ?? r.newState.preferredLanguage ?? null;
      await tenant.events.append(req.conversationId, 'draft_pending', {
        draftId: d.draftId, capability,
        ...(replyLanguage ? { language: languageHead(replyLanguage) } : {}),
        // LG — the language the gate read, so the first five in it can be counted (0108).
        gate: language,
        // R3 — the product it quotes, so the owner's approval vets that product.
        ...(quotedProduct ? { productId: quotedProduct } : {}),
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
        // …and when what kept stopping her was the identity guard: a claim
        // to be human, or a buyer's direct question she did not answer. The
        // owner should know this happened; it is not an ordinary retry.
        ...(r.identityViolation
          ? { identity: { kind: r.identityViolation.kind, phrase: r.identityViolation.phrase } } : {}),
        ...(disclosureInstead ? { disclosureSent: true } : {}),
        // 2026-09-30 — it would have gone alone, but the customer's language
        // has no signed-off sentence saying who is answering: the card says so.
        ...(speaksAlone && !earned ? { withheld: { reason: 'not_earned' } }
          : speaksAlone && !vetted ? { withheld: { reason: 'first_quote' } }
          : speaksAlone && languageWithheld ? { withheld: languageWithheld } : {}),
      });

      /*
       * A BUYER WHO ASKED WHAT HE IS TALKING TO IS NOT LEFT IN SILENCE.
       *
       * He asked; she failed twice to say; the turn is held. In DRAFT that is
       * the whole answer — nothing was ever going out without the owner, and
       * she will reply herself. But in AUTO the buyer was going to get a
       * message, and the guard turning that into nothing at all is the one
       * outcome worse than a clumsy answer: a direct question met with
       * silence, from something that had been answering all along.
       *
       * So the disclosure goes out instead — the sentence he was owed — and
       * the draft above still holds the turn for her, with the reason on it.
       * Both things are true: he has been told, and she has been told to look.
       *
       * ONLY the unanswered question. A reply that CLAIMED to be human sends
       * nothing, ever, in any mode: there is no version of that turn a buyer
       * should receive, and the disclosure would be answering a question he
       * did not ask.
       *
       * NOT "once" HERE, and that is the point. The once-per-conversation
       * rule is about not repeating an announcement nobody asked for. This
       * buyer ASKED — now — and a sentence he was sent four messages ago is
       * not an answer to a question he is asking today. He gets it again.
       */
      if (mode === 'draft' && disclosureInstead) {
        outbound = { conversationId: req.conversationId, reply: sentence };
        await recordDisclosure('identity_question');
      }
    }
  }

  return {
    outbound,
    draftCreated,
    hotLeadAlert: r.decision.hotLead,
    handoffAlert: r.decision.action.kind === 'handoff',
    deletionAlert,
    orderProposed,
  };
}
