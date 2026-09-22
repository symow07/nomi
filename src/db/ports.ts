import type { BusinessId, ClientId, ConversationId, OrderId } from '../core/types/ids.js';
import type { Money } from '../core/types/money.js';
import type { FactoryClosure } from '../core/commerce/closures.js';
import type { SamplePolicy } from '../core/commerce/samples.js';
import type { OrderUpdate, ReportedOrderState } from '../core/commerce/orderState.js';
import type { WithheldLeadTime } from '../core/commerce/closures.js';
import type { TradeTerms } from '../core/commerce/terms.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { PriorQuote } from '../core/types/commerce.js';
import type {
  BundleRule,
  ConfirmableOrder,
  NegotiationRule,
  PriceTier,
  PricingPolicy,
  Product,
  SubstitutionRule,
} from '../core/types/commerce.js';
import type { Signal } from '../core/scoring/signals.js';
import type { AllowedClaim } from '../core/safety/claims.js';
import type { AutonomyGrant, Capability } from '../core/conversation/autonomy.js';
import type { KnowledgeSnippet } from '../core/types/knowledge.js';
import type { KillSwitches } from '../core/ops/killSwitch.js';
import type { Speaker } from '../core/owner/assistants.js';
import type { AnswerPath } from '../core/conversation/answerPath.js';
import type { Agreement, OwnUnderstanding } from '../core/conversation/understand.js';

/**
 * Database ports. Interfaces in Week 1; Kysely implementations in Week 2.
 *
 * TWO RULES, both non-negotiable (ADR-0005):
 *
 * 1. Every implementation runs inside `withTenant()` — a transaction that has
 *    executed `set_config('app.business_id', $id, true)`. RLS does the actual
 *    isolation; these interfaces cannot express a cross-tenant read because
 *    they never take a foreign BusinessId.
 *
 * 2. The connection is `nomi_app` (no BYPASSRLS). The service_role key is
 *    retired from application use.
 */

/** A tenant-scoped unit of work. The ONLY way application code touches the DB. */
export interface Tenant {
  readonly businessId: BusinessId;

  readonly conversations: ConversationRepo;
  readonly clients: ClientRepo;
  readonly catalog: CatalogRepo;
  readonly orders: OrderRepo;
  readonly samples: SampleRepo;
  readonly signals: SignalRepo;
  readonly events: EventLog;
  readonly audit: AuditRepo;
  readonly autonomy: AutonomyRepo;
  readonly ops: OpsRepo;
  readonly drafts: DraftRepo;
  readonly knowledge: KnowledgeRepo;
  readonly proofs: ProofRepo;
}

/**
 * G11 — the buyer's proof link, minted in the turn's own transaction.
 *
 * A quote written by this turn is not visible outside it until commit, so the
 * page that proves it could only ever be created afterwards, by the owner, by
 * hand. This port is how "every quote she sends carries a link" becomes true
 * of the turn rather than of a button.
 */
export interface ProofRepo {
  /** Idempotent: one live token per quote. Null when the quote is not ours. */
  issue(quoteId: string): Promise<{ token: string } | null>;
}

/**
 * M34.6 — live ops_flags (migration 0014). Read-only by design: the app role
 * may select these rows and nothing more, so the employee can be silenced by
 * ops but can never silence — or un-silence — herself.
 */
export interface OpsRepo {
  switches(): Promise<KillSwitches>;
}

/**
 * product_knowledge (migration 0018): descriptive facts the employee answers
 * from. The turn only READS — it retrieves the identified product's active
 * rows + business-level, ranked by relevance then confidence tier. Teaching
 * and correcting live in the owner UI (src/api/web/knowledge.ts), not here.
 */
export interface KnowledgeRepo {
  retrieve(input: { query: string; productId: string | null; k: number }): Promise<KnowledgeSnippet[]>;
}

/** autonomy_policy rows for this business — the draft/auto routing (migration 0009). */
export interface AutonomyRepo {
  grants(): Promise<readonly AutonomyGrant[]>;
  /**
   * M34.9 — a guard fired while this capability was unsupervised. Records the
   * violation as evidence and drops the capability to draft if it was in auto.
   *
   * On the tenant repo rather than a free function because it must write inside
   * the turn's own transaction: a violation recorded without the demotion it
   * caused, or the reverse, is worse than either alone.
   */
  selfDemote(input: {
    readonly capability: string;
    readonly conversationId: string;
    readonly violations: number;
  }): Promise<{ readonly demoted: boolean; readonly action: string }>;
  /**
   * Has the owner confirmed what buyers will call her assistant (0065)?
   *
   * On the autonomy repo because that is what it gates: a message sent with
   * nobody reading it first announces itself BY NAME, so a workspace where no
   * person has read that name may not send one. Every workspace activated
   * before Getting ready asked is in exactly that position.
   */
  assistantNamed(): Promise<boolean>;
  /**
   * Has the AI disclosure been read by a native speaker in every language it
   * is written in? Installation-wide, not per business — see
   * DISCLOSURE_NATIVE_REVIEW. False means nothing is sent alone ANYWHERE,
   * including by capabilities that were switched on before the rule existed.
   */
  released(): boolean;
}

/**
 * drafts (migration 0009): a reply awaiting the owner. create() is the only
 * write the turn pipeline makes here; resolution lives in the applyOwnerCommand
 * service (src/pipeline/approve.ts) — the single approval path.
 */
export interface DraftRepo {
  create(input: {
    conversationId: ConversationId;
    capability: Capability;
    draftText: string;
    /**
     * An AI disclosure went to the buyer INSTEAD of this text, because he asked
     * what he was talking to and it did not say. The approval path refuses to
     * send it unchanged; editing it is untouched.
     */
    replacedByDisclosure?: boolean;
    turnMessageId: string;
  }): Promise<{ draftId: string }>;
}

export interface ClientRepo {
  /** Persist a captured email so the view surfaces it on every later turn. */
  saveEmail(clientId: ClientId, email: string): Promise<void>;
  touchLastSeen(clientId: ClientId): Promise<void>;
  /**
   * G11 — the language the BUYER writes in, remembered on the client. The
   * column has existed since the baseline and only the demo seed ever wrote
   * it, so a buyer's own proof page fell back to English however he wrote.
   */
  savePreferredLanguage(clientId: ClientId, language: string): Promise<void>;
}

/**
 * The replay/audit record (migration 0006). Every processed turn and every
 * computed quote is persisted with its full inputs — replay is the debugger.
 */
export interface AuditRepo {
  /**
   * M36 — every price this CLIENT was already given for this product, so the
   * consistency guard can see what she already told them. Scoped to the client,
   * not the conversation: a returning buyer often starts a new thread, and that
   * is exactly the case a human salesperson would remember and this must too.
   */
  priorQuotesForClient(clientId: ClientId, productId: string): Promise<readonly PriorQuote[]>;

  recordQuote(q: {
    conversationId: ConversationId;
    productId: string;
    quantity: number;
    inputs: unknown;          // { tiers, policy, rules } snapshot
    unitPrice: Money;
    discountPct: number;
    total: Money;
    requiresHuman: boolean;
    appliedRules: readonly string[];
    /** G5 — the lead time the quote STATED, or null. */
    leadTimeDays: number | null;
    /** G5 — her closure, when it withheld the lead time. Never `wouldShipOn`. */
    leadTimeWithheld: WithheldLeadTime | null;
  }): Promise<{ quoteId: string }>;

  recordTurn(t: {
    messageId: string;
    conversationId: ConversationId;
    stateBefore: unknown;
    input: unknown;
    analysis: unknown;
    retrieved: unknown;
    decision: unknown;
    quoteId: string | null;
    promptVersion: string | null;
    modelId: string | null;
    latencyMs: number;
    /** N1 — who worded the reply and what the turn cost. Optional: an old caller records none. */
    measure?: {
      readonly path: AnswerPath; readonly analyserAvoidable: boolean;
      readonly llmCalls: number; readonly inputTokens: number; readonly outputTokens: number;
      /** N2a — her own reading beside the model's. Null when no model analysed the message. */
      readonly ownUnderstanding?: { readonly own: OwnUnderstanding; readonly agrees: Agreement; readonly onEverything: boolean } | null;
    };
  }): Promise<void>;
}

export type WithTenant = <T>(
  businessId: BusinessId,
  fn: (t: Tenant) => Promise<T>,
) => Promise<T>;

export interface ConversationRepo {
  loadState(id: ConversationId): Promise<ConversationState | null>;
  /** Full replacement of the mutable fields; optimistic on turnCount. */
  saveState(state: ConversationState): Promise<void>;
  findActiveByClient(clientId: ClientId): Promise<ConversationState | null>;
  /** Returning customer whose last conversation closed: start fresh. */
  create(clientId: ClientId, channel: string): Promise<ConversationState>;
  /** Handoff: non-null pauses the AI; null returns control. */
  assign(id: ConversationId, agent: string | null): Promise<void>;
  close(id: ConversationId): Promise<void>;
  /** A5.3 — who answers this conversation, and for which business. Null: no such conversation. */
  speaker(id: ConversationId): Promise<Speaker | null>;
  /**
   * This conversation has now been told it is talking to an AI. Its own write
   * rather than a field of saveState, because it is decided AFTER the state is
   * saved — at the moment the send/draft branch knows nobody is going to read
   * the message before the buyer does.
   */
  markAiDisclosed(id: ConversationId, at: Date): Promise<void>;
}

export interface CatalogRepo {
  product(id: string): Promise<Product | null>;
  priceTiers(productId: string): Promise<PriceTier[]>;
  pricingPolicy(productId: string | null): Promise<PricingPolicy | null>;
  negotiationRules(): Promise<NegotiationRule[]>;
  /** claims_policy rows — the claims guard's allowlist (default-deny). */
  claimsPolicy(): Promise<AllowedClaim[]>;
  /**
   * M37.5 — terms this owner has forbidden her employee from saying to a buyer.
   * Her list only; the immutable floor lives in core and is added there, so no
   * row and no repo can remove it.
   */
  forbiddenTerms(): Promise<readonly string[]>;
  /**
   * M44 — the days her factory is shut, as SHE stated them. Empty means she
   * has stated none, which is not "open all year": it is "she has not told
   * us", and the lead time is quoted exactly as before.
   */
  factoryClosures(): Promise<readonly FactoryClosure[]>;
  /**
   * M45 — what she has said about samples, or null. Null is "she has not
   * said", which is why a sample price cannot reach a reply: the numerals a
   * reply may contain come from what she wrote down.
   */
  samplePolicy(): Promise<SamplePolicy | null>;
  /**
   * G6 — the terms she puts on a proforma, newest in force; null when she has
   * stated none. Null is the answer, not a gap to fill.
   */
  tradeTerms(): Promise<TradeTerms | null>;
  bundleRules(): Promise<BundleRule[]>;
  substitutions(productId: string): Promise<SubstitutionRule[]>;
}

/**
 * M45 — a buyer asked for a sample. One row per conversation.
 *
 * Recorded whatever the reply turned out to be: whether Nomi could answer
 * depends on the owner having stated a policy, but the REQUEST is a fact about
 * a buyer and she needs to see it either way. That is the point of the
 * milestone — a request that reaches her beats an automated flow built on
 * guesses about how she ships.
 */
export interface SampleRepo {
  /** Idempotent: a buyer who asks twice is one buyer waiting for one sample. */
  record(conversationId: ConversationId, askedText: string): Promise<void>;
}

export interface OrderRepo {
  /**
   * The ONLY way an order enters the database, and it only accepts a
   * ConfirmableOrder — which only toConfirmableOrder() can produce. Validation
   * is therefore structurally unskippable.
   *
   * Idempotent: on the orders_one_open_per_conversation unique violation it
   * returns the existing order instead of throwing. Two "yes" messages, one
   * order. (ADR-0004)
   */
  create(conversationId: ConversationId, order: ConfirmableOrder): Promise<{
    orderId: OrderId;
    orderReference: string;
    alreadyExisted: boolean;
  }>;

  /**
   * M46 — this buyer's latest order, and the last thing SHE recorded about it.
   * Null when he has no order yet; that is the ordinary case for most of a
   * conversation's life.
   *
   * G4 — by BUYER, not by conversation. Confirming an order closes the
   * conversation it was confirmed in, so "where is my order?" three weeks
   * later always arrives in a NEW one — which a lookup by conversation could
   * never find. The question the roadmap named was unanswerable by design.
   */
  latestForClient(clientId: ClientId): Promise<{
    readonly orderId: string;
    readonly reference: string;
    readonly update: Omit<OrderUpdate, 'state'> & { readonly state: ReportedOrderState };
  } | null>;
}

export interface SignalRepo {
  unresolved(conversationId: ConversationId): Promise<Signal[]>;
  record(conversationId: ConversationId, signal: Signal): Promise<void>;
  resolve(conversationId: ConversationId, kind: Signal['kind']): Promise<void>;
}

/** Append-only analytics log. Funnels cannot be rebuilt from state you didn't record. */
export interface EventLog {
  append(conversationId: ConversationId, type: string, payload?: unknown): Promise<void>;
}
