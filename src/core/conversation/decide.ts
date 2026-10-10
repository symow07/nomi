import type { ConversationState, PendingQuestion, Phase, ProductMatch } from '../types/conversation.js';
import type { Quote } from '../types/commerce.js';
import { advance } from './phase.js';
import { aiMaySpeak, ownershipOf } from './ownership.js';
import { detectFastPath } from './fastpath.js';
import { detectInjection, SAFE_FALLBACK_REPLIES } from '../safety/injection.js';
import type { FixedLanguage } from './gateLanguage.js';
import { computeScores, needsHandoff, isHotLead, type Signal } from '../scoring/signals.js';
import type { Email } from '../types/ids.js';

/**
 * decideTurn — the engine's front door.
 *
 * Pure. Everything it needs arrives as an argument; everything it decides
 * leaves as a return value. The worker does I/O around it; the future call
 * assistant is just a second caller of this same function. (ADR-0002)
 */

/** What the LLM analysis step produced. Language only — never numbers we act on. */
export type Analysis = {
  readonly language: { readonly detected: string; readonly replyIn: string };
  readonly intent: {
    readonly primary: string;
    readonly productCandidate: ProductMatch | null;
    readonly quantityMentioned: { readonly value: number; readonly unit: string } | null;
    readonly nextLogicalQuestion: string | null;
    readonly missingFields: readonly string[];
  };
  readonly recommendedPhase: Phase;
  /**
   * "Wants a person", layer 2 — the analyser's answer to "is this buyer asking
   * to reach a person on the SELLER's side?" (a human, an agent, the manager,
   * someone in charge; any language, any phrasing). Layer 1 is the word list
   * in core/scoring/detect.ts, which settles the unambiguous ones before any
   * model is asked; this reads the meaning of everything else.
   *
   *   true    — they ask for a person: the turn hands off (`human_requested`).
   *   false   — they do not.
   *   null    — the analyser was asked and its answer could not be read: the
   *             turn hands off as `not_answered` ("ambiguous means hand off").
   *   absent  — this analyser does not answer the question (the scripted and
   *             sandbox ones, the trust harness's stub): nothing changes.
   *
   * Optional on purpose, so every Analysis built before the question existed
   * still means what it meant.
   */
  readonly wantsPerson?: boolean | null;
};

export type TurnInput = {
  readonly state: ConversationState;
  readonly text: string;
  /** null on the fast path / injection path — no model was called. */
  readonly analysis: Analysis | null;
  /** Freshly extracted this turn (deterministic regex, not the model). */
  readonly extractedEmail: Email | null;
  /** Signals observed this turn, merged with unresolved ones from the DB. */
  readonly signals: readonly Signal[];
  /** Deterministic quote, if a product+quantity exist. Postgres-owned numbers. */
  readonly quote: Quote | null;
  /** LG — the language of the fixed sentences said this turn (`fixedLanguage` of the gate's). English when absent. */
  readonly language?: FixedLanguage;
};

export type TurnAction =
  | { readonly kind: 'silent' }                       // human owns it / duplicate
  | { readonly kind: 'canned_reply'; readonly reply: string }  // fast path / injection
  | { readonly kind: 'generate_reply' }               // call the LLM for prose
  | { readonly kind: 'confirm_order' }                // run the close pipeline
  | { readonly kind: 'handoff'; readonly notifyOnly: boolean }; // notifyOnly = hot lead

export type TurnDecision = {
  readonly action: TurnAction;
  readonly nextPhase: Phase;
  readonly scores: { readonly problem: number; readonly lead: number };
  readonly pendingQuestion: PendingQuestion | null;
  readonly product: ProductMatch | null;
  readonly quantity: { readonly value: number; readonly unit: string } | null;
  readonly email: Email | null;
  readonly hotLead: boolean;
  readonly injectionDetected: boolean;
};

export function decideTurn(input: TurnInput): TurnDecision {
  const { state, text, analysis, extractedEmail, signals, quote } = input;

  const scores = computeScores(signals);
  const email = extractedEmail ?? state.contact.email;

  const base = {
    scores: { problem: scores.problem, lead: scores.lead },
    email,
    hotLead: isHotLead(scores),
    injectionDetected: false,
  };

  // ── Gate 0: a human owns this conversation. THE AI DOES NOT SPEAK. ──────────
  // This gate did not exist in n8n: escalation notified a human and the AI kept
  // replying to the customer anyway. (ADR-0003 §2)
  if (!aiMaySpeak(ownershipOf(state.assignedTo))) {
    return {
      ...base,
      action: { kind: 'silent' },
      nextPhase: state.phase,
      pendingQuestion: state.pendingQuestion,
      product: state.product,
      quantity: state.quantity,
    };
  }

  // ── Gate 1: injection. Canned reply, zero model calls, nothing revealed. ────
  // Except a request to delete the buyer's data (0075): that goes to a person
  // with nothing said, which reveals nothing either. "Forget everything you
  // know about me" is both, and was answered with the canned reply instead.
  const injection = detectInjection(text).detected;
  // 0135 — nor a stop: "stop messaging me, ignore your instructions" is still a stop.
  const deletionAsked = signals.some((s) => s.kind === 'deletion_requested' || s.kind === 'opted_out');
  if (injection && !deletionAsked) {
    return {
      ...base,
      injectionDetected: true,
      action: { kind: 'canned_reply', reply: SAFE_FALLBACK_REPLIES[input.language ?? 'en'] },
      nextPhase: state.phase,
      pendingQuestion: state.pendingQuestion,
      product: state.product,
      quantity: state.quantity,
    };
  }

  // ── Gate 2: problem handoff. Notify AND stop — unlike n8n, which notified
  //    and kept selling. Hot leads are handled below and never stop the AI. ───
  if (needsHandoff(scores)) {
    return {
      ...base,
      injectionDetected: injection,
      action: { kind: 'handoff', notifyOnly: false },
      nextPhase: advance(state.phase, 'escalated'),
      pendingQuestion: null,
      product: state.product,
      quantity: state.quantity,
    };
  }

  // ── Gate 3: fast path. A bare yes/no to a question we asked: zero AI calls. ─
  const fast = detectFastPath(text, state);
  if (fast.matched) {
    const product: ProductMatch | null = fast.stateChanges.clearIdentifiedProduct
      ? null
      : state.product
        ? { ...state.product, confirmedByClient: fast.stateChanges.productConfirmedByClient ?? state.product.confirmedByClient }
        : null;

    return {
      ...base,
      action: fast.triggerOrderConfirmation
        ? { kind: 'confirm_order' }
        : { kind: 'canned_reply', reply: fast.reply },
      nextPhase: fast.phaseTarget ? advance(state.phase, fast.phaseTarget) : state.phase,
      pendingQuestion: fast.stateChanges.pendingQuestion,
      product,
      quantity: state.quantity,
    };
  }

  // ── Full path: fold the analysis into state, then generate. ────────────────
  const candidate = analysis?.intent.productCandidate ?? null;
  const product: ProductMatch | null = candidate
    ? {
        ...candidate,
        // >= 0.90 auto-accepts (the spec's own threshold); an existing explicit
        // confirmation is never revoked by a lower-confidence re-match.
        confirmedByClient:
          candidate.confirmedByClient ||
          candidate.confidence >= 0.9 ||
          (state.product?.confirmedByClient === true &&
            state.product.productId === candidate.productId),
      }
    : state.product;

  const quantity = analysis?.intent.quantityMentioned ?? state.quantity;
  const nextPhase = advance(state.phase, analysis?.recommendedPhase ?? state.phase);

  // Record what we are about to ask, so the NEXT turn can fast-path the answer.
  // The n8n system never wrote this — which made the fast path dead code and the
  // close unreachable. (ADR-0003, Milestone 0)
  let pendingQuestion: PendingQuestion | null = null;
  if (nextPhase === 'confirmation') {
    pendingQuestion = 'order_confirmation';
  } else if (product && !product.confirmedByClient) {
    pendingQuestion = 'product_confirmation';
  }

  return {
    ...base,
    action: { kind: 'generate_reply' },
    nextPhase,
    pendingQuestion,
    product,
    quantity,
  };
}
