import type {
  AuditRepo, CatalogRepo, ClientRepo, ConversationRepo, EventLog, OrderRepo,
  SignalRepo, Tenant,
} from '../../src/db/ports.js';
import type { Retriever, RetrievedProduct } from '../../src/retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../../src/llm/ports.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ConversationState } from '../../src/core/types/conversation.js';
import type {
  NegotiationRule, PriceTier, PricingPolicy, Product,
} from '../../src/core/types/commerce.js';
import type { Signal } from '../../src/core/scoring/signals.js';
import type { ConversationId } from '../../src/core/types/ids.js';
import { BUSINESS, product as mkProduct, tiers as mkTiers, policy as mkPolicy } from '../parity/fixtures.js';

/**
 * In-memory Tenant. Mirrors the REAL semantics that matter:
 *  - orders are idempotent per conversation (the unique-index behaviour)
 *  - signals dedupe by kind
 *  - everything is observable for assertions
 */
export class FakeTenant implements Tenant {
  readonly businessId = BUSINESS;

  states = new Map<string, ConversationState>();
  savedStates: ConversationState[] = [];
  ordersByConversation = new Map<string, { orderId: string; orderReference: string }>();
  signalRows = new Map<string, Signal[]>();
  eventRows: Array<{ conversationId: string; type: string }> = [];
  quotesRecorded: unknown[] = [];
  turnsRecorded: unknown[] = [];
  emailsSaved: Array<{ clientId: string; email: string }> = [];
  closed: string[] = [];

  products = new Map<string, Product>([[mkProduct().id, mkProduct()]]);
  tiers = new Map<string, PriceTier[]>([[mkProduct().id, mkTiers()]]);
  policies = new Map<string, PricingPolicy>([[mkProduct().id, mkPolicy()]]);
  rules: NegotiationRule[] = [];

  private orderSeq = 0;

  conversations: ConversationRepo = {
    loadState: async (id) => this.states.get(id) ?? null,
    saveState: async (s) => {
      this.states.set(s.conversationId, s);
      this.savedStates.push(s);
    },
    findActiveByClient: async () => null,
    create: async () => { throw new Error('not used in pipeline tests'); },
    assign: async (id, agent) => {
      const s = this.states.get(id);
      if (s) this.states.set(id, { ...s, assignedTo: agent as ConversationState['assignedTo'] });
    },
    close: async (id) => { this.closed.push(id); },
  };

  clients: ClientRepo = {
    saveEmail: async (clientId, email) => { this.emailsSaved.push({ clientId, email }); },
    touchLastSeen: async () => {},
  };

  catalog: CatalogRepo = {
    product: async (id) => this.products.get(id) ?? null,
    priceTiers: async (id) => this.tiers.get(id) ?? [],
    pricingPolicy: async (id) => (id ? this.policies.get(id) ?? null : null),
    negotiationRules: async () => this.rules,
    bundleRules: async () => [],
    substitutions: async () => [],
  };

  orders: OrderRepo = {
    create: async (conversationId) => {
      const existing = this.ordersByConversation.get(conversationId);
      if (existing) return { ...existing, alreadyExisted: true } as never;
      const created = {
        orderId: `order-${++this.orderSeq}`,
        orderReference: `YW-2026-07-000${this.orderSeq}`,
      };
      this.ordersByConversation.set(conversationId, created);
      return { ...created, alreadyExisted: false } as never;
    },
  };

  signals: SignalRepo = {
    unresolved: async (id) => this.signalRows.get(id) ?? [],
    record: async (id, signal) => {
      const rows = (this.signalRows.get(id) ?? []).filter((s) => s.kind !== signal.kind);
      rows.push(signal);
      this.signalRows.set(id, rows);
    },
    resolve: async (id, kind) => {
      this.signalRows.set(id, (this.signalRows.get(id) ?? []).filter((s) => s.kind !== kind));
    },
  };

  events: EventLog = {
    append: async (conversationId, type) => {
      this.eventRows.push({ conversationId: conversationId as string, type });
    },
  };

  audit: AuditRepo = {
    recordQuote: async (q) => {
      this.quotesRecorded.push(q);
      return { quoteId: `quote-${this.quotesRecorded.length}` };
    },
    recordTurn: async (t) => { this.turnsRecorded.push(t); },
  };

  seed(id: ConversationId, state: ConversationState): void {
    this.states.set(id, state);
  }
}

export class FakeRetriever implements Retriever {
  calls = 0;
  results: RetrievedProduct[] = [{
    productId: mkProduct().id,
    sku: mkProduct().sku,
    name: mkProduct().name,
    category: 'packaging',
    moq: mkProduct().moq,
    relevance: 0.9,
    matchedVia: 'trigram',
  }];
  async byText(): Promise<RetrievedProduct[]> { this.calls++; return this.results; }
  async byImageDescription(): Promise<RetrievedProduct[]> { return this.results; }
  async explore(): Promise<RetrievedProduct[]> { return this.results; }
}

export class FakeAnalyzer implements Analyzer {
  calls = 0;
  next: Analysis | null = null;
  async analyze(): Promise<{ analysis: Analysis; promptVersion: string; modelId: string }> {
    this.calls++;
    if (!this.next) throw new Error('FakeAnalyzer.next not set');
    return { analysis: this.next, promptVersion: 'test@1', modelId: 'fake-model' };
  }
}

export class FakeReplyWriter implements ReplyWriter {
  calls = 0;
  /** queue of replies; last one repeats */
  replies: string[] = ['Happy to help with that.'];
  async write(): Promise<{ reply: string; promptVersion: string; modelId: string }> {
    const reply = this.replies[Math.min(this.calls, this.replies.length - 1)] ?? '';
    this.calls++;
    return { reply, promptVersion: 'resp@1', modelId: 'fake-model' };
  }
}
