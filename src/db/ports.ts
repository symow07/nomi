import type { BusinessId, ClientId, ConversationId, OrderId } from '../core/types/ids.js';
import type { ConversationState } from '../core/types/conversation.js';
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
 * 2. The connection is `yiwuflow_app` (no BYPASSRLS). The service_role key is
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
  readonly drafts: DraftRepo;
  readonly knowledge: KnowledgeRepo;
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
  recordQuote(q: {
    conversationId: ConversationId;
    productId: string;
    quantity: number;
    inputs: unknown;          // { tiers, policy, rules } snapshot
    unitPriceUsd: number;
    discountPct: number;
    totalUsd: number;
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
