import { computeTurn, commitTurn, BUSINESS_TZ, type TurnPorts } from '../../src/pipeline/turn.js';
import { capabilityOf, resolveMode } from '../../src/core/conversation/autonomy.js';
import type { Retriever, RetrievedProduct } from '../../src/retrieval/ports.js';
import { FakeTenant, FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { BUSINESS, CONVERSATION, emptyState } from '../parity/fixtures.js';
import { analysis, candidate, SCHEMA_VERSION, TRUST_PRODUCT_ID, type Scenario } from '../../src/trust/scenarios.js';
import { runCheck, type CheckResult, type TurnOutcome } from '../../src/trust/invariants.js';

/**
 * M12.1 — Trust Harness runner.
 *
 * Builds injectable ports from a scenario (a FakeTenant + stub retriever /
 * analyzer / reply writer), runs the REAL engine (computeTurn → commitTurn),
 * then evaluates the declared invariants against the outcome. No DB, no network,
 * no second engine — the harness proves the production pipeline's own guarantees.
 */

const DEFAULT_NOW = '2026-07-14T12:00:00Z'; // noon UTC = 20:00 Asia/Shanghai

/** A stub retriever that returns exactly the candidates the scenario specifies. */
class StubRetriever implements Retriever {
  constructor(private readonly results: readonly RetrievedProduct[]) {}
  async byText(): Promise<RetrievedProduct[]> { return [...this.results]; }
  async byImageDescription(): Promise<RetrievedProduct[]> { return [...this.results]; }
  async explore(): Promise<RetrievedProduct[]> { return [...this.results]; }
}

/** Assemble the FakeTenant + stub ports described by a scenario. */
function buildPorts(s: Scenario): { ports: TurnPorts; tenant: FakeTenant; now: Date } {
  const tenant = new FakeTenant();

  if (s.catalog) {
    tenant.products.clear();
    tenant.tiers.clear();
    tenant.policies.clear();
    tenant.rules = [];
    for (const e of s.catalog) {
      tenant.products.set(e.id, {
        id: e.id, businessId: BUSINESS, sku: e.sku, name: e.name,
        moq: e.moq, unit: e.unit, leadTimeDays: e.leadTimeDays ?? 25, customizable: true,
      });
      tenant.tiers.set(e.id, e.tiers.map((t) => ({ productId: e.id, ...t })));
      if (e.policy) tenant.policies.set(e.id, { businessId: BUSINESS, productId: e.id, ...e.policy });
      if (e.negotiationRules) tenant.rules.push(...e.negotiationRules);
    }
  }
  if (s.allowedClaims) tenant.allowedClaims = [...s.allowedClaims];
  if (s.grants) tenant.grantRows = [...s.grants];
  if (s.knowledge) {
    tenant.knowledgeRows = s.knowledge.map((k, i) => ({
      id: `sk-${i}`, productId: k.productId ?? (TRUST_PRODUCT_ID as string),
      kind: k.kind, label: k.label, content: k.content,
      source: k.source ?? 'owner_confirmed', status: 'active' as const,
    }));
  }
  tenant.seed(CONVERSATION, emptyState(s.state));

  const candidates =
    s.candidates === 'none' ? [] : s.candidates ?? (s.catalog?.map(candidate) ?? []);
  const retriever = new StubRetriever(candidates);

  const analyzer = new FakeAnalyzer();
  analyzer.next = s.analysis ?? analysis();

  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = [s.proposedReply ?? 'Thanks for your message — could you tell me a little more about what you need?'];

  const now = new Date(s.now ?? DEFAULT_NOW);
  const ports: TurnPorts = { tenant, retriever, analyzer, replyWriter, now: () => now };
  return { ports, tenant, now };
}

export type ScenarioReport = {
  readonly id: string;
  readonly title: string;
  readonly category: Scenario['category'];
  readonly checks: readonly CheckResult[];
  readonly passed: boolean;
};

export type HarnessReport = {
  readonly scenarios: readonly ScenarioReport[];
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
};

/** Run one scenario through the real engine and evaluate its invariants. */
export async function runScenario(s: Scenario): Promise<ScenarioReport> {
  if (s.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`scenario ${s.id}: unsupported schemaVersion ${s.schemaVersion} (harness supports ${SCHEMA_VERSION})`);
  }
  const { ports, tenant, now } = buildPorts(s);
  const req = { conversationId: CONVERSATION, messageId: `m-${s.id}`, text: s.buyer.text };

  const result = await computeTurn(ports, req);
  const effects = await commitTurn(ports, req, result, Date.now());

  const capability = capabilityOf(result.decision, result.quote !== null);
  const requestedMode = resolveMode({ capability, grants: tenant.grantRows, now, timeZone: BUSINESS_TZ });
  const appliedMode: TurnOutcome['appliedMode'] =
    effects.outbound ? 'auto' : effects.draftCreated ? 'draft' : 'none';
  const floorOf = (productId: string): number | null => tenant.policies.get(productId)?.floorPriceUsd ?? null;

  const ctx: TurnOutcome = { scenario: s, result, effects, floorOf, capability, requestedMode, appliedMode };
  const checks = s.expect.map((e) => runCheck(e, ctx));

  return { id: s.id, title: s.title, category: s.category, checks, passed: checks.every((c) => c.pass) };
}

/** Run the whole golden set and aggregate. */
export async function runAll(scenarios: readonly Scenario[]): Promise<HarnessReport> {
  const reports: ScenarioReport[] = [];
  for (const s of scenarios) reports.push(await runScenario(s));
  const passed = reports.filter((r) => r.passed).length;
  return { scenarios: reports, total: reports.length, passed, failed: reports.length - passed };
}

/** A readable pass/fail report — printed by the vitest gate and `npm run trust`. */
export function formatReport(report: HarnessReport): string {
  const lines: string[] = [];
  lines.push('Trust Harness — M12.1');
  lines.push('='.repeat(72));
  for (const s of report.scenarios) {
    lines.push(`${s.passed ? '✓' : '✗'} [${s.category}] ${s.id}`);
    for (const c of s.checks) {
      lines.push(`    ${c.pass ? '·' : '✗'} ${c.invariant}: ${c.detail}`);
    }
  }
  lines.push('='.repeat(72));
  lines.push(`${report.passed}/${report.total} scenarios passed` + (report.failed ? ` — ${report.failed} FAILED` : ''));
  return lines.join('\n');
}
