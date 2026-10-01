import type { Money } from '../../src/core/types/money.js';
import type { TradeTerms } from '../../src/core/commerce/terms.js';
import type { SellingFacts } from '../../src/db/ports.js';
import type { OrderUpdate } from '../../src/core/commerce/orderState.js';
import type { SamplePolicy } from '../../src/core/commerce/samples.js';
import type { FactoryClosure } from '../../src/core/commerce/closures.js';
import type {
  AuditRepo, AutonomyRepo, CatalogRepo, ClientRepo, ConversationRepo, DraftRepo,
  EventLog, KnowledgeRepo, OrderRepo, SampleRepo, SignalRepo, Tenant, OpsRepo,
} from '../../src/db/ports.js';
import type { KnowledgeSnippet } from '../../src/core/types/knowledge.js';
import { SOURCE_RANK } from '../../src/core/types/knowledge.js';
import type { AutonomyGrant } from '../../src/core/conversation/autonomy.js';
import { NO_KILL_SWITCHES, type KillSwitches } from '../../src/core/ops/killSwitch.js';
import type { Retriever, RetrievedProduct } from '../../src/retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../../src/llm/ports.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ConversationState } from '../../src/core/types/conversation.js';
import type {
  NegotiationRule, PriceTier, PricingPolicy, Product,
} from '../../src/core/types/commerce.js';
import type { Signal } from '../../src/core/scoring/signals.js';
import type { AllowedClaim } from '../../src/core/safety/claims.js';
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
  /** Payloads kept, so a test can read what a turn said about itself (G7a's `heldBecause`). */
  eventRows: Array<{ conversationId: string; type: string; payload?: unknown }> = [];
  quotesRecorded: unknown[] = [];
  turnsRecorded: unknown[] = [];
  emailsSaved: Array<{ clientId: string; email: string }> = [];
  closed: string[] = [];
  /** A5.3 — who the turn is told is speaking. Null: nobody named, as before. */
  /**
   * Who is speaking. Named by default: confirming the name is what CREATES the
   * assistants row, so "no speaker" is not a state a workspace that may send
   * alone can be in. A test about the gate sets it null and says so.
   */
  speakerIs: import('../../src/core/owner/assistants.js').Speaker | null = {
    name: 'Lily', role: 'sales', note: null,
    business: { name: 'Yiwu Canvas Co', kind: null, country: null, description: null },
  };
  /** When each conversation was told it is talking to an AI — the 0066 column. */
  disclosedAt = new Map<string, Date>();

  products = new Map<string, Product>([[mkProduct().id, mkProduct()]]);
  tiers = new Map<string, PriceTier[]>([[mkProduct().id, mkTiers()]]);
  policies = new Map<string, PricingPolicy>([[mkProduct().id, mkPolicy()]]);
  rules: NegotiationRule[] = [];
  allowedClaims: AllowedClaim[] = [
    { kind: 'payment_terms', claimKey: 'deposit_30_70', allowed: true },
  ];

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
    speaker: async () => this.speakerIs,
    markAiDisclosed: async (id, at) => {
      this.disclosedAt.set(id, at);
      const s = this.states.get(id);
      if (s) this.states.set(id, { ...s, aiDisclosedAt: at });
    },
    // Q1 — what the conversation said before, as a test lays it down.
    recentMessages: async (_id, { limit }) => this.history.slice(-limit),
  };
  /** Q1 — the earlier messages a test gives the conversation, oldest first. */
  history: { direction: 'inbound' | 'outbound'; text: string }[] = [];

  /**
   * 0079 — the send path's half, as the outbound worker does it: the provider
   * accepted a message carrying the disclosure. Nothing else in these fakes
   * sends, so a test that means "it went out" says so with this.
   */
  deliverDisclosure(id: string, at = new Date('2026-07-14T03:30:00Z')): void {
    const s = this.states.get(id);
    if (s && s.aiDisclosureDeliveredAt === null) this.states.set(id, { ...s, aiDisclosureDeliveredAt: at });
  }

  /** G11 — the language remembered for this buyer, if a turn wrote one. */
  preferredLanguage: string | null = null;
  clients: ClientRepo = {
    saveEmail: async (clientId, email) => { this.emailsSaved.push({ clientId, email }); },
    touchLastSeen: async () => {},
    savePreferredLanguage: async (_clientId, language) => { this.preferredLanguage = language; },
  };

  /** G11 — proof tokens this turn minted, so a test can read the link it sent. */
  proofsIssued: string[] = [];
  proofs: import('../../src/db/ports.js').ProofRepo = {
    issue: async (quoteId) => {
      this.proofsIssued.push(quoteId);
      return { token: `tok-${this.proofsIssued.length}` };
    },
  };

  /** TZ — the workspace's zone. The fixtures' clocks are written in Shanghai time; a test may set another. */
  timeZone = 'Asia/Shanghai';
  zone = async (): Promise<string> => this.timeZone;

  /** M37.5 — terms the owner forbade. Empty unless a test sets it. */
  forbidden: string[] = [];
  /** M44 — days the factory is shut, as the owner stated them. */
  closures: FactoryClosure[] = [];
  /** M45 — what she has said about samples. Null unless a test sets it. */
  sample: SamplePolicy | null = null;
  /** G6 — her proforma terms. Null (she has stated none) unless a test sets them. */
  terms: TradeTerms | null = null;
  /** K5 · RT — how the business sells; a test sets what it needs. */
  selling: SellingFacts = { pricesToOwner: false, kind: null, quantityFirst: true };
  catalog: CatalogRepo = {
    product: async (id) => this.products.get(id) ?? null,
    priceTiers: async (id) => this.tiers.get(id) ?? [],
    pricingPolicy: async (id) => (id ? this.policies.get(id) ?? null : null),
    negotiationRules: async () => this.rules,
    forbiddenTerms: async () => this.forbidden,
    factoryClosures: async () => this.closures,
    samplePolicy: async () => this.sample,
    tradeTerms: async () => this.terms,
    selling: async () => this.selling,
    claimsPolicy: async () => this.allowedClaims,
    bundleRules: async () => [],
    substitutions: async () => [],
  };

  /** G6 — every order handed to the repo, so a test can read what it carried. */
  ordersCreated: Array<Parameters<OrderRepo['create']>[1]> = [];
  orders: OrderRepo = {
    create: async (conversationId, order) => {
      this.ordersCreated.push(order);
      const existing = this.ordersByConversation.get(conversationId);
      if (existing) return { ...existing, alreadyExisted: true } as never;
      const created = {
        orderId: `order-${++this.orderSeq}`,
        orderReference: `YW-2026-07-000${this.orderSeq}`,
      };
      this.ordersByConversation.set(conversationId, created);
      return { ...created, alreadyExisted: false } as never;
    },
    /** M46 — no order in the harness unless a test sets one. */
    latestForClient: async () => this.latestOrder,
  };

  /**
   * 0080 — what customers said yes to. One waiting per conversation, like the
   * unique index it stands in for; `orderWaiting` lets a test set one directly.
   */
  orderProposals_: Array<{ proposalId: string; conversationId: string; messageId: string; order: Parameters<OrderRepo['create']>[1] }> = [];
  orderWaiting = false;
  orderProposals: import('../../src/db/ports.js').OrderProposalRepo = {
    propose: async ({ conversationId, messageId, order }) => {
      const waiting = this.orderProposals_.find((x) => x.conversationId === (conversationId as string));
      if (waiting) return { proposalId: waiting.proposalId, fresh: false };
      const proposalId = `proposal-${this.orderProposals_.length + 1}`;
      this.orderProposals_.push({ proposalId, conversationId: conversationId as string, messageId, order });
      return { proposalId, fresh: true };
    },
    waiting: async (conversationId) =>
      this.orderWaiting || this.orderProposals_.some((x) => x.conversationId === (conversationId as string)),
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
    append: async (conversationId, type, payload) => {
      this.eventRows.push({ conversationId: conversationId as string, type, payload });
    },
  };

  /** M46 — the order behind this conversation, if a test set one. */
  latestOrder: { orderId: string; reference: string; update: OrderUpdate } | null = null;
  /** M45 — sample requests recorded, so a test can assert one reached her. */
  samplesRecorded: Array<{ conversationId: string; askedText: string }> = [];
  samples: SampleRepo = {
    record: async (conversationId, askedText) => {
      // Idempotent, like the unique index it stands in for.
      if (this.samplesRecorded.some((x) => x.conversationId === (conversationId as string))) return;
      this.samplesRecorded.push({ conversationId: conversationId as string, askedText });
    },
  };

  /**
   * 0076 — each deletion request the turn wrote down, and what the store said.
   * One waiting per conversation here (a buyer is one conversation in these
   * fakes); `recorded` stands for a request the owner already recorded.
   */
  deletionAsksNoted: Array<{ conversationId: string; messageId: string; outcome: import('../../src/db/deletionAsks.js').DeletionAskNoted }> = [];
  deletionRecorded = false;
  deletionAsks: import('../../src/db/ports.js').DeletionAskRepo = {
    note: async ({ conversationId, messageId }) => {
      const outcome = this.deletionRecorded ? 'already_recorded' as const
        : this.deletionAsksNoted.some((x) => x.conversationId === (conversationId as string) && x.outcome === 'noted') ? 'asked_again' as const
        : 'noted' as const;
      this.deletionAsksNoted.push({ conversationId: conversationId as string, messageId, outcome });
      return outcome;
    },
  };

  /** M36 — prior prices this buyer was given. Empty unless a test sets it. */
  priorQuotes: Array<{ quantity: number; unitPrice: Money; at: Date }> = [];
  audit: AuditRepo = {
    priorQuotesForClient: async () => this.priorQuotes,
    recordQuote: async (q) => {
      this.quotesRecorded.push(q);
      return { quoteId: `quote-${this.quotesRecorded.length}` };
    },
    recordTurn: async (t) => { this.turnsRecorded.push(t); },
  };

  // Autonomy defaults to empty → every capability resolves to draft (the safe
  // default). Tests set grants to exercise the auto-send path.
  grantRows: AutonomyGrant[] = [];
  draftsCreated: Array<{
    draftId: string; conversationId: string; capability: string; draftText: string;
    /** 0067 — a disclosure went to the buyer instead of this text. */
    replacedByDisclosure: boolean;
    /** 0080 — the question it asks, set only if it is sent unchanged. */
    asks: string | null;
  }> = [];
  private draftSeq = 0;

  /** M34.9 — recorded, so a test can assert the production caller reached it.
   *  The REAL behaviour is proved against Postgres in tests/integration. */
  selfDemoted: Array<{ capability: string; violations: number }> = [];
  /**
   * The owner has confirmed what buyers will call her assistant (0065). TRUE
   * by default so that every test written before the gate still describes the
   * situation it meant to; a test about the gate sets it false and says so.
   */
  assistantNamedFlag = true;
  /** The native-review gate (DISCLOSURE_NATIVE_REVIEW). A test about it sets false. */
  releasedFlag = true;
  /** Per language, when a test needs it (the real gate is per language since 2026-09-30). */
  releasedFor: ((language?: string | null) => boolean) | null = null;
  /** G4 / R2 — the rung earned; 2 unless a test about a self-serve workspace says otherwise. */
  earnedRungValue: 0 | 1 | 2 = 2;
  /** R3 — every product's first quote already sent, unless a test says otherwise. */
  quoteVettedFlag = true;
  /** LG — five replies already approved in every language, unless a test says otherwise. */
  languageProvenFor: (language: string) => boolean = () => true;
  autonomy: AutonomyRepo = {
    grants: async () => this.grantRows,
    selfDemote: async ({ capability, violations }) => {
      this.selfDemoted.push({ capability, violations });
      return { demoted: false, action: 'none' };
    },
    assistantNamed: async () => this.assistantNamedFlag,
    // Released by default: these fakes describe what she does once autonomy is
    // allowed at all. The gate itself is proved against the real flag.
    released: (language?: string | null) => (this.releasedFor ? this.releasedFor(language) : this.releasedFlag),
    earnedRung: async () => this.earnedRungValue,
    quoteVetted: async () => this.quoteVettedFlag,
    languageProven: async (language: string) => this.languageProvenFor(language),
  };

  /** M34.6 — ops kill switches. None set is the normal state, so tests that do
   *  not care read exactly as they did before. */
  switches: KillSwitches = NO_KILL_SWITCHES;
  ops: OpsRepo = {
    switches: async () => this.switches,
  };

  drafts: DraftRepo = {
    create: async (input) => {
      const draftId = `draft-${++this.draftSeq}`;
      this.draftsCreated.push({
        draftId, conversationId: input.conversationId as string,
        capability: input.capability, draftText: input.draftText,
        replacedByDisclosure: input.replacedByDisclosure ?? false,
        asks: input.asks ?? null,
      });
      return { draftId };
    },
  };

  // Knowledge (M13). Seed rows via knowledgeRows; retrieve mirrors the real
  // scope (identified product + business-level, active), token-overlap ranked.
  knowledgeRows: Array<{
    id: string; productId: string | null; kind: KnowledgeSnippet['kind'];
    label: string; content: string; source: KnowledgeSnippet['source']; status: 'active' | 'archived';
  }> = [];

  knowledge: KnowledgeRepo = {
    retrieve: async ({ query, productId, k }) => {
      const q = tokens(query);
      return this.knowledgeRows
        .filter((r) => r.status === 'active' && (r.productId === productId || r.productId === null))
        .map((r) => {
          const hay = new Set(tokens(`${r.label} ${r.content}`));
          const hit = q.filter((w) => hay.has(w)).length;
          const relevance = q.length ? hit / q.length : 0;
          return {
            id: r.id, productId: r.productId, kind: r.kind, label: r.label,
            content: r.content, source: r.source, relevance,
          } satisfies KnowledgeSnippet;
        })
        .filter((s) => s.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance || SOURCE_RANK[b.source] - SOURCE_RANK[a.source])
        .slice(0, k);
    },
  };

  seed(id: ConversationId, state: ConversationState): void {
    this.states.set(id, state);
  }
}

const tokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 1);

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
  /**
   * 2026-09-28 — an answer for one message in particular ("wants a person",
   * layer 2): its text → the analysis to return. `next` answers the rest.
   */
  byText = new Map<string, Analysis>();
  /** The texts it was asked about, in order — so a test can say no model was asked. */
  texts: string[] = [];
  /** Q1 — the history it was shown with each text, in the same order. */
  histories: (readonly { direction: string; text: string }[])[] = [];
  async analyze(input?: Parameters<Analyzer['analyze']>[0]): Promise<{ analysis: Analysis; promptVersion: string; modelId: string; usage: { inputTokens: number; outputTokens: number } }> {
    this.calls++;
    if (input) { this.texts.push(input.text); this.histories.push(input.recentMessages); }
    const analysis = (input && this.byText.get(input.text)) ?? this.next;
    if (!analysis) throw new Error('FakeAnalyzer.next not set');
    return { analysis, promptVersion: 'test@1', modelId: 'fake-model', usage: { inputTokens: 500, outputTokens: 120 } };
  }
}

export class FakeReplyWriter implements ReplyWriter {
  calls = 0;
  /** queue of replies; last one repeats */
  replies: string[] = ['Happy to help with that.'];
  /** A5.3 — what the writer was handed, most recent last. */
  inputs: Parameters<ReplyWriter['write']>[0][] = [];
  async write(input?: Parameters<ReplyWriter['write']>[0]): Promise<{ reply: string; promptVersion: string; modelId: string; usage: { inputTokens: number; outputTokens: number } }> {
    if (input) this.inputs.push(input);
    const reply = this.replies[Math.min(this.calls, this.replies.length - 1)] ?? '';
    this.calls++;
    return { reply, promptVersion: 'resp@1', modelId: 'fake-model', usage: { inputTokens: 300, outputTokens: 80 } };
  }
}

/**
 * THE MODEL, UNPLUGGED — for every integration test that boots the production
 * composition and never meant to call one.
 *
 * `validateEnv` refuses to boot without a shape-valid model key, so each of
 * those tests passes a dummy ('test-key-not-real-just-shape-valid') to get past
 * the check — and `buildProduction` then hands that dummy to a REAL client.
 * Any inbound message that reached a turn made a live HTTPS request to
 * api.anthropic.com and came back 401, which is how a suite with no business
 * near the network ended up depending on it: two of five local runs failed in
 * the e-mail and day-one files, always with `invalid x-api-key` in the log.
 *
 * IT FAILS RATHER THAN ANSWERING, on purpose. Returning a neutral analysis
 * would let a test quietly depend on a model nobody scripted. This reproduces
 * exactly what those tests were already getting — a model that does not
 * answer — deterministically, locally, and in microseconds. A test that needs
 * a turn to SUCCEED scripts `FakeAnalyzer`/`FakeReplyWriter` instead, and the
 * error below says so.
 */
const refuseToAnswer = (): never => {
  throw new Error(
    'offlineModels(): this test booted buildProduction without scripting a model, '
    + 'and something asked one a question. Pass models: { analyzer, replyWriter } '
    + 'with FakeAnalyzer/FakeReplyWriter if the turn is meant to succeed.',
  );
};

/**
 * Both ports, unplugged. Spread into `buildProduction`'s `models` override.
 *
 * A standalone refusal rather than a method on a class: these are handed to the
 * composition and passed around as bare functions, and one that reached for
 * `this` would fail with "Cannot read properties of undefined" — a confusing
 * error in place of the clear one above, at the exact moment somebody needs to
 * read it.
 */
export const offlineModels = (): { analyzer: Analyzer; replyWriter: ReplyWriter } => ({
  analyzer: { analyze: async () => refuseToAnswer() } as unknown as Analyzer,
  replyWriter: { write: async () => refuseToAnswer() } as unknown as ReplyWriter,
});
