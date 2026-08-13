import { computeTurn, commitTurn, BUSINESS_TZ, type TurnPorts } from '../pipeline/turn.js';
import type { OrderUpdate } from '../core/commerce/orderState.js';
import type { SamplePolicy } from '../core/commerce/samples.js';
import type { FactoryClosure } from '../core/commerce/closures.js';
import { type Money, usd } from '../core/types/money.js';
import { capabilityOf, resolveMode, type AutonomyGrant } from '../core/conversation/autonomy.js';
import { NO_KILL_SWITCHES, type KillSwitches } from '../core/ops/killSwitch.js';
import type { Retriever, RetrievedProduct } from '../retrieval/ports.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import type { Analysis } from '../core/conversation/decide.js';
import type {
  AuditRepo, AutonomyRepo, CatalogRepo, ClientRepo, ConversationRepo, DraftRepo,
  EventLog, KnowledgeRepo, OpsRepo, OrderRepo, SignalRepo, Tenant,
} from '../db/ports.js';
import type { ConversationState } from '../core/types/conversation.js';
import type { NegotiationRule, PriceTier, PricingPolicy, Product } from '../core/types/commerce.js';
import type { AllowedClaim } from '../core/safety/claims.js';
import type { KnowledgeSnippet } from '../core/types/knowledge.js';
import type { ConversationId, ClientId, ProductId } from '../core/types/ids.js';
import { unsafeBrand } from '../core/types/brand.js';
import { runCheck, type CheckResult, type TurnOutcome } from './invariants.js';
import {
  analysis as defaultAnalysis, candidate as toCandidate,
  SCHEMA_VERSION, TRUST_BUSINESS_ID, TRUST_PRODUCT_ID, type Scenario,
} from './scenarios.js';

/**
 * The trust harness (promoted from tests/harness in M15 so it runs at runtime,
 * powering the Pilot Readiness "Validate" action as well as the CI gate).
 *
 * Builds injectable ports from a scenario — an in-memory HarnessTenant + stub
 * retriever/analyzer/reply writer — runs the REAL engine (computeTurn →
 * commitTurn), then evaluates the declared invariants. No DB, no network, no
 * second engine: it proves the production pipeline's own guarantees.
 */

const DEFAULT_NOW = '2026-07-14T12:00:00Z'; // noon UTC = 20:00 Asia/Shanghai
const brand = <T>(s: string): T => unsafeBrand<never>()(s) as unknown as T;
const CONVERSATION = brand<ConversationId>('d0000000-0000-0000-0000-000000000001');
const CLIENT = brand<ClientId>('c0000000-0000-0000-0000-000000000001');

function emptyState(over: Partial<ConversationState> = {}): ConversationState {
  return {
    conversationId: CONVERSATION, businessId: TRUST_BUSINESS_ID, clientId: CLIENT,
    phase: 'warm_intake', turnCount: 0, scores: { problem: 0, lead: 0 },
    product: null, quantity: null, contact: { email: null }, pendingQuestion: null,
    assignedTo: null, preferredLanguage: null, contextSummary: null, ...over,
  };
}

const tok = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 1);

class StubRetriever implements Retriever {
  constructor(private readonly r: readonly RetrievedProduct[]) {}
  async byText(): Promise<RetrievedProduct[]> { return [...this.r]; }
  async byImageDescription(): Promise<RetrievedProduct[]> { return [...this.r]; }
  async explore(): Promise<RetrievedProduct[]> { return [...this.r]; }
}
class StubAnalyzer implements Analyzer {
  constructor(private readonly a: Analysis) {}
  async analyze() { return { analysis: this.a, promptVersion: 'harness', modelId: 'harness', usage: { inputTokens: 0, outputTokens: 0 } }; }
}
class StubReplyWriter implements ReplyWriter {
  constructor(private readonly reply: string) {}
  async write() { return { reply: this.reply, promptVersion: 'harness', modelId: 'harness', usage: { inputTokens: 0, outputTokens: 0 } }; }
}

/** In-memory Tenant configured from a scenario. Reads are real; writes are no-ops. */
class HarnessTenant implements Tenant {
  readonly businessId = TRUST_BUSINESS_ID;
  private state: ConversationState;
  readonly products = new Map<string, Product>();
  readonly tiers = new Map<string, PriceTier[]>();
  readonly policies = new Map<string, PricingPolicy>();
  private rules: NegotiationRule[] = [];
  private allowedClaims: AllowedClaim[] = [{ kind: 'payment_terms', claimKey: 'deposit_30_70', allowed: true }];
  readonly grantRows: AutonomyGrant[] = [];
  private knowledgeRows: Array<{ id: string; productId: string | null; kind: KnowledgeSnippet['kind']; label: string; content: string; source: KnowledgeSnippet['source']; status: 'active' | 'archived' }> = [];
  private orderSeq = 0;
  private draftSeq = 0;

  constructor(s: Scenario) {
    const pid = TRUST_PRODUCT_ID as string;
    this.products.set(pid, { id: TRUST_PRODUCT_ID, businessId: TRUST_BUSINESS_ID, sku: 'BAG-NW-001', name: 'Non-woven shopping bag', moq: 1000, unit: 'pcs', leadTimeDays: 25, customizable: true });
    this.tiers.set(pid, [{ productId: TRUST_PRODUCT_ID, minQty: 1000, maxQty: null, unitPrice: usd(0.45) }]);
    this.policies.set(pid, { businessId: TRUST_BUSINESS_ID, productId: TRUST_PRODUCT_ID, floorPrice: usd(0.35), maxDiscountPct: 10, humanRequiredAbovePct: 7 });
    if (s.catalog) {
      this.products.clear(); this.tiers.clear(); this.policies.clear(); this.rules = [];
      for (const e of s.catalog) {
        this.products.set(e.id as string, { id: e.id, businessId: TRUST_BUSINESS_ID, sku: e.sku, name: e.name, moq: e.moq, unit: e.unit, leadTimeDays: e.leadTimeDays ?? 25, customizable: true });
        this.tiers.set(e.id as string, e.tiers.map((t) => ({ productId: e.id, ...t })));
        if (e.policy) this.policies.set(e.id as string, { businessId: TRUST_BUSINESS_ID, productId: e.id, ...e.policy });
        if (e.negotiationRules) this.rules.push(...e.negotiationRules);
      }
    }
    if (s.allowedClaims) this.allowedClaims = [...s.allowedClaims];
    if (s.grants) (this.grantRows as AutonomyGrant[]).push(...s.grants);
    if (s.knowledge) this.knowledgeRows = s.knowledge.map((k, i) => ({ id: `sk-${i}`, productId: k.productId ?? (TRUST_PRODUCT_ID as string), kind: k.kind, label: k.label, content: k.content, source: k.source ?? 'owner_confirmed', status: 'active' as const }));
    this.state = emptyState(s.state);
  }

  floorFor(productId: string): number | null { return this.policies.get(productId)?.floorPrice.amount ?? null; }

  conversations: ConversationRepo = {
    loadState: async () => this.state,
    saveState: async (st) => { this.state = st; },
    findActiveByClient: async () => null,
    create: async () => { throw new Error('harness: create not used'); },
    assign: async () => {},
    close: async () => {},
  };
  clients: ClientRepo = { saveEmail: async () => {}, touchLastSeen: async () => {} };
  /** M37.5 — terms the owner forbade. Empty unless a test sets it. */
  forbidden: string[] = [];
  /** M44 — days the factory is shut, as the owner stated them. */
  closures: FactoryClosure[] = [];
  /** M45 — what she has said about samples. Null unless a test sets it. */
  sample: SamplePolicy | null = null;
  catalog: CatalogRepo = {
    product: async (id) => this.products.get(id) ?? null,
    priceTiers: async (id) => this.tiers.get(id) ?? [],
    pricingPolicy: async (id) => (id ? this.policies.get(id) ?? null : null),
    negotiationRules: async () => this.rules,
    forbiddenTerms: async () => this.forbidden,
    /** M44 — closures the owner stated. Empty unless a scenario sets them. */
    factoryClosures: async () => this.closures,
    samplePolicy: async () => this.sample,
    claimsPolicy: async () => this.allowedClaims,
    bundleRules: async () => [],
    substitutions: async () => [],
  };
  orders: OrderRepo = {
    create: async () => ({ orderId: `o-${++this.orderSeq}`, orderReference: `YW-${this.orderSeq}` }) as never,
    /** M46 — no order in the harness unless a test sets one. */
    latestForConversation: async () => this.latestOrder,
  };
  signals: SignalRepo = { unresolved: async () => [], record: async () => {}, resolve: async () => {} };
  events: EventLog = { append: async () => {} };
  /** M46 — the order behind this conversation, if a test set one. */
  latestOrder: { orderId: string; reference: string; update: OrderUpdate } | null = null;
  /** M45 — sample requests recorded, so a test can assert one reached her. */
  samplesRecorded: Array<{ conversationId: string; askedText: string }> = [];
  samples: import('../db/ports.js').SampleRepo = {
    record: async (conversationId, askedText) => {
      // Idempotent, like the unique index it stands in for.
      if (this.samplesRecorded.some((x) => x.conversationId === (conversationId as string))) return;
      this.samplesRecorded.push({ conversationId: conversationId as string, askedText });
    },
  };
  /** M36 — prior prices this buyer was given. Empty unless a test sets it. */
  priorQuotes: Array<{ quantity: number; unitPrice: Money; at: Date }> = [];
  audit: AuditRepo = {
    priorQuotesForClient: async () => this.priorQuotes, recordQuote: async () => ({ quoteId: 'q-1' }), recordTurn: async () => {} };
  /** M34.9 — recorded, so a test can assert the production caller reached it.
   *  The REAL behaviour is proved against Postgres in tests/integration. */
  selfDemoted: Array<{ capability: string; violations: number }> = [];
  autonomy: AutonomyRepo = {
    grants: async () => this.grantRows,
    selfDemote: async ({ capability, violations }) => {
      this.selfDemoted.push({ capability, violations });
      return { demoted: false, action: 'none' };
    },
  };
  // M34.6 — the trust scenarios run an unsilenced employee; a scenario that
  // wants a switch thrown sets this and says so in its own name.
  switches: KillSwitches = NO_KILL_SWITCHES;
  ops: OpsRepo = { switches: async () => this.switches };
  drafts: DraftRepo = { create: async () => ({ draftId: `d-${++this.draftSeq}` }) };
  knowledge: KnowledgeRepo = {
    retrieve: async ({ query, productId, k }) => {
      const q = tok(query);
      return this.knowledgeRows
        .filter((r) => r.status === 'active' && (r.productId === productId || r.productId === null))
        .map((r) => {
          const hay = new Set(tok(`${r.label} ${r.content}`));
          const hit = q.filter((w) => hay.has(w)).length;
          return { id: r.id, productId: r.productId, kind: r.kind, label: r.label, content: r.content, source: r.source, relevance: q.length ? hit / q.length : 0 } satisfies KnowledgeSnippet;
        })
        .filter((s) => s.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, k);
    },
  };
}

function buildPorts(s: Scenario): { ports: TurnPorts; tenant: HarnessTenant; now: Date } {
  const tenant = new HarnessTenant(s);
  const candidates = s.candidates === 'none' ? [] : s.candidates ?? (s.catalog?.map(toCandidate) ?? []);
  const analyzer = new StubAnalyzer(s.analysis ?? defaultAnalysis());
  const replyWriter = new StubReplyWriter(s.proposedReply ?? 'Thanks for your message — could you tell me a little more about what you need?');
  const now = new Date(s.now ?? DEFAULT_NOW);
  return { ports: { tenant, retriever: new StubRetriever(candidates), analyzer, replyWriter, now: () => now }, tenant, now };
}

export type ScenarioReport = {
  readonly id: string; readonly title: string; readonly category: Scenario['category'];
  readonly checks: readonly CheckResult[]; readonly passed: boolean;
};
export type HarnessReport = {
  readonly scenarios: readonly ScenarioReport[];
  readonly total: number; readonly passed: number; readonly failed: number;
};

/**
 * Run one scenario and return BOTH the invariant verdict and the engine's own
 * output. `runScenario` keeps the original narrow shape; M20.5's factory
 * rehearsal needs the outcome itself, because "she cannot quote this product"
 * is read from `result.quoteRefusal`, not from a passing check. Additive: the
 * golden path below is byte-for-byte what it was.
 */
export async function evaluateScenario(
  s: Scenario,
): Promise<{ readonly report: ScenarioReport; readonly outcome: TurnOutcome }> {
  if (s.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`scenario ${s.id}: unsupported schemaVersion ${s.schemaVersion} (harness supports ${SCHEMA_VERSION})`);
  }
  const { ports, tenant, now } = buildPorts(s);
  const req = { conversationId: CONVERSATION, messageId: `m-${s.id}`, text: s.buyer.text };

  const result = await computeTurn(ports, req);
  const effects = await commitTurn(ports, req, result, Date.now());

  const capability = capabilityOf(result.decision, result.quote !== null);
  const requestedMode = resolveMode({ capability, grants: tenant.grantRows, now, timeZone: BUSINESS_TZ });
  const appliedMode: TurnOutcome['appliedMode'] = effects.outbound ? 'auto' : effects.draftCreated ? 'draft' : 'none';
  const floorOf = (productId: string): number | null => tenant.floorFor(productId);

  const outcome: TurnOutcome = { scenario: s, result, effects, floorOf, capability, requestedMode, appliedMode };
  const checks = s.expect.map((e) => runCheck(e, outcome));
  return {
    report: { id: s.id, title: s.title, category: s.category, checks, passed: checks.every((c) => c.pass) },
    outcome,
  };
}

export async function runScenario(s: Scenario): Promise<ScenarioReport> {
  return (await evaluateScenario(s)).report;
}

export async function runAll(scenarios: readonly Scenario[]): Promise<HarnessReport> {
  const reports: ScenarioReport[] = [];
  for (const s of scenarios) reports.push(await runScenario(s));
  const passed = reports.filter((r) => r.passed).length;
  return { scenarios: reports, total: reports.length, passed, failed: reports.length - passed };
}

export function formatReport(report: HarnessReport): string {
  const lines = ['Trust Harness — M12.1', '='.repeat(72)];
  for (const s of report.scenarios) {
    lines.push(`${s.passed ? '✓' : '✗'} [${s.category}] ${s.id}`);
    for (const c of s.checks) lines.push(`    ${c.pass ? '·' : '✗'} ${c.invariant}: ${c.detail}`);
  }
  lines.push('='.repeat(72));
  lines.push(`${report.passed}/${report.total} scenarios passed` + (report.failed ? ` — ${report.failed} FAILED` : ''));
  return lines.join('\n');
}
