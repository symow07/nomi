import type { BusinessId, ClientId, ConversationId, OrderId } from '../core/types/ids.js';
import type { Money } from '../core/types/money.js';
import type { FactoryClosure } from '../core/commerce/closures.js';
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
  readonly signals: SignalRepo;
  readonly events: EventLog;
  readonly audit: AuditRepo;
  readonly autonomy: AutonomyRepo;
  readonly ops: OpsRepo;
  readonly drafts: DraftRepo;
  readonly knowledge: KnowledgeRepo;
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
    turnMessageId: string;
  }): Promise<{ draftId: string }>;
}

export interface ClientRepo {
  /** Persist a captured email so the view surfaces it on every later turn. */
  saveEmail(clientId: ClientId, email: string): Promise<void>;
  touchLastSeen(clientId: ClientId): Promise<void>;
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
  bundleRules(): Promise<BundleRule[]>;
  substitutions(productId: string): Promise<SubstitutionRule[]>;
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
