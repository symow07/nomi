import { ownershipOf, aiMaySpeak } from '../conversation/ownership.js';
import type {
  AgentId,
  BusinessId,
  ClientId,
  ConversationId,
  Email,
  ProductId,
} from './ids.js';

/** The sales pipeline. Forward-only — enforced by phase.ts, not by convention. */
export const PHASES = [
  'warm_intake',
  'clarification',
  'qualification',
  'commercial_discussion',
  'confirmation',
  'escalated',
  'closed',
] as const;
export type Phase = (typeof PHASES)[number];

/**
 * A question we asked and are waiting on. Persisting this is what makes the
 * zero-AI-call fast path reachable.
 *
 * In the n8n system this field was READ (by the fast path, and by order
 * validation rule 8) but WRITTEN BY NOTHING. The fast path was therefore dead
 * code, product_confirmed_by_client could never become true, and no order could
 * ever be confirmed. See docs/adr/0003.
 */
export type PendingQuestion = 'product_confirmation' | 'order_confirmation';

/**
 * A product the AI believes the client wants.
 *
 * `confirmedByClient` is not optional. You cannot construct a ProductMatch
 * without stating whether the client actually confirmed it — which is precisely
 * the field the old system forgot to ever write.
 */
export type ProductMatch = {
  readonly productId: ProductId;
  /** 0..1 */
  readonly confidence: number;
  readonly confirmedByClient: boolean;
  readonly matchMethod: 'text' | 'alias' | 'image_vision' | 'semantic';
};

export type Quantity = {
  readonly value: number;
  readonly unit: string;
};

/**
 * Two scores, never one.
 *
 * The n8n system had a single monotonic `escalation_score` that only ever
 * increased, and order validation blocked the close at >= 70. `high_value`
 * (an order over $10k) added +60. So a large order that also discussed
 * logistics (+25) hit 85 and COULD NEVER BE CONFIRMED. The system was built to
 * prevent its best deals from closing.
 *
 * A hot lead is a BUYING signal, not a problem. Only `problem` may gate.
 */
export type Scores = {
  /** 0..100. Gates confirmation. Triggers human handoff. */
  readonly problem: number;
  /** 0..100. Notifies the sales team. NEVER gates anything. */
  readonly lead: number;
};

export type ConversationState = {
  readonly conversationId: ConversationId;
  readonly businessId: BusinessId;
  readonly clientId: ClientId;

  readonly phase: Phase;
  readonly turnCount: number;

  readonly scores: Scores;
  readonly product: ProductMatch | null;
  readonly quantity: Quantity | null;
  readonly contact: { readonly email: Email | null };
  readonly pendingQuestion: PendingQuestion | null;

  /**
   * Non-null => a human owns this conversation and THE AI MUST NOT REPLY.
   *
   * The n8n system fired a Telegram alert, set phase='escalated' — and then kept
   * replying to the customer, because nothing ever checked. The customer who
   * explicitly asked for a human got more bot. This field is the gate.
   */
  readonly assignedTo: AgentId | null;

  readonly preferredLanguage: string | null;
  readonly contextSummary: string | null;

  /**
   * When this conversation was told it is talking to an AI, on the first
   * message sent without anyone approving it. Null until then — and null again
   * for a new conversation with the same buyer, who is owed the sentence again
   * rather than a memory of having heard it once.
   */
  readonly aiDisclosedAt: Date | null;
};

/** A conversation a human has taken over. Proven at the type level. */
export type HandedOff = ConversationState & { readonly assignedTo: AgentId };

export function isHandedOff(s: ConversationState): s is HandedOff {
  // M47 — the TYPE-LEVEL statement of the one predicate, and it delegates to
  // it rather than restating it. The three behavioural copies were re-pointed
  // in this milestone; this is the fourth and last place the column's meaning
  // was written out by hand.
  return !aiMaySpeak(ownershipOf(s.assignedTo));
}
