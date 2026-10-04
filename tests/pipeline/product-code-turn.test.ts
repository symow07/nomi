import { describe, it, expect } from 'vitest';
import { computeTurn, commitTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { SAFE_REPLIES } from '../../src/core/conversation/templates.js';
import type { ProductId } from '../../src/core/types/ids.js';
import { evaluateScenario } from '../../src/trust/harness.js';
import { runCheck } from '../../src/trust/invariants.js';
import { SCHEMA_VERSION, bags, analysis as scenarioAnalysis, type Scenario } from '../../src/trust/scenarios.js';
import { emptyState, CONVERSATION, PRODUCT, product as mkProduct } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * PC (2026-10-04) — a product's own name and code pass by their text, through
 * the turn: the writer's attempts and the stand-in are checked with the
 * business's own catalogue, read once, and the trust harness re-runs the guard
 * on exactly that text. The rule itself is tests/parity/product-code-exemption.test.ts.
 */

/** Westlake Canvas Co.'s five active products (production, read-only, 2026-10-04): name | sku. */
const WESTLAKE: readonly (readonly [string, string])[] = [
  ['Canvas tote bag 12oz natural', 'NEW-mu7040xb-0'],
  ['Canvas tote bag 12oz black', 'NEW-mu7040xc-1'],
  ['Cotton drawstring bag 20x25cm', 'NEW-mu7040xd-2'],
  ['Zipper canvas pouch A5', 'NEW-mu7040xe-3'],
  ['Jute shopping bag laminated', 'NEW-mu7040xh-4'],
];

function ports(): TurnPorts & { tenant: FakeTenant; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } {
  const p = {
    tenant: new FakeTenant(), retriever: new FakeRetriever(),
    analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-10-04T04:00:00Z'),
  };
  p.tenant.products.clear();
  p.tenant.products.set(PRODUCT, mkProduct({ sku: 'ZX-300', name: 'Insulated bottle' }));
  WESTLAKE.forEach(([name, sku], i) => {
    const id = `b0000000-0000-0000-0000-00000000010${i}` as ProductId;
    p.tenant.products.set(id, mkProduct({ id, sku, name }));
  });
  // Told on an earlier turn: this file is about what the reply says.
  p.tenant.seed(CONVERSATION, emptyState({
    aiDisclosedAt: new Date('2026-10-04T03:00:00Z'), aiDisclosureDeliveredAt: new Date('2026-10-04T03:00:00Z'),
  }));
  p.analyzer.next = analysis();
  return p;
}

const analysis = (over: Partial<Analysis['intent']> = {}): Analysis => ({
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [], ...over },
  recommendedPhase: 'clarification',
});

const req = (text: string) => ({ conversationId: CONVERSATION, messageId: `m-${text.slice(0, 12)}`, text });
async function run(p: ReturnType<typeof ports>, text: string) {
  const r = await computeTurn(p, req(text));
  const fx = await commitTurn(p, req(text), r, Date.now());
  return { r, fx, violations: p.tenant.eventRows.filter((e) => e.type === 'guard_violation').length };
}

describe('PC · the writer’s reply, checked with her catalogue', () => {
  it('each Westlake product, named by its exact name: the reply stands, nothing refused, nothing held', async () => {
    for (const [name] of WESTLAKE) {
      const p = ports();
      const said = `Yes, the ${name} is in stock in white.`;
      p.replyWriter.replies = [said];
      const { r, violations } = await run(p, 'do you have it in white?');
      expect(r.reply, name).toBe(said);
      expect(r.guardViolations, name).toBe(0);
      expect(r.hold, name).toBeNull();
      expect(violations, name).toBe(0);
    }
  });

  it('her own code: "The ZX-300 comes in blue" stands', async () => {
    const p = ports();
    p.replyWriter.replies = ['Yes, the ZX-300 comes in blue.'];
    const { r } = await run(p, 'any other colours?');
    expect(r.reply).toBe('Yes, the ZX-300 comes in blue.');
    expect(r.guardViolations).toBe(0);
  });

  it('the catalogue is read ONCE for the turn, and carries her names and her own codes only', async () => {
    const p = ports();
    let reads = 0;
    const read = p.tenant.catalog.productWords;
    p.tenant.catalog.productWords = async () => { reads++; return read(); };
    p.replyWriter.replies = ['The ZX-300 is $300 each.'];          // two attempts, and a stand-in: four places could read it
    const { r } = await run(p, 'how much?');
    expect(reads).toBe(1);
    expect(r.catalogue).toContain('ZX-300');
    expect(r.catalogue).toContain('Cotton drawstring bag 20x25cm');
    for (const [, sku] of WESTLAKE) expect(r.catalogue).not.toContain(sku);
  });

  it('an invented figure beside the code is still refused, twice, and the turn waits for her', async () => {
    const p = ports();
    p.replyWriter.replies = ['The ZX-300 is $300 each.'];
    const { r, fx, violations } = await run(p, 'how much?');
    expect(r.guardViolations).toBe(2);
    expect(violations).toBeGreaterThan(0);
    expect(r.hold).toBe('guards_failed_twice');
    expect(r.reply).not.toContain('$300');
    expect(fx.outbound).toBeNull();
  });

  it('…and so is a quantity beside a Westlake name', async () => {
    const p = ports();
    p.replyWriter.replies = ['Cotton drawstring bag 20x25cm, 450 pieces ready.'];
    const { r } = await run(p, 'do you make drawstring bags?');
    expect(r.guardViolations).toBe(2);
    expect(r.hold).toBe('guards_failed_twice');
    expect(r.reply).not.toContain('450');
  });
});

describe('PC · the stand-in, checked with the same catalogue', () => {
  it('the analyser’s question naming her code is used, not swapped for the fixed sentence', async () => {
    const p = ports();
    p.analyzer.next = analysis({ nextLogicalQuestion: 'Which colour would you like for the ZX-300?' });
    p.replyWriter.replies = ['It is $300.'];
    const { r } = await run(p, 'hello');
    expect(r.hold).toBe('guards_failed_twice');
    expect(r.reply).toBe('Which colour would you like for the ZX-300?');
  });
  it('a question with an invented figure in it still falls back to the fixed sentence', async () => {
    const p = ports();
    p.analyzer.next = analysis({ nextLogicalQuestion: 'Would 300 pieces of the ZX-300 suit you?' });
    p.replyWriter.replies = ['It is $300.'];
    const { r } = await run(p, 'hello');
    expect(r.reply).toBe(SAFE_REPLIES.en);
  });
});

describe('PC · the trust harness holds the same rule', () => {
  const scenario = (proposedReply: string): Scenario => ({
    schemaVersion: SCHEMA_VERSION,
    id: 'pc-own-code', title: 'Her own code passes by its text', category: 'price',
    buyer: { text: 'Do you have it in blue?' },
    catalog: [bags({ sku: 'ZX-300', name: 'Insulated bottle' })],
    candidates: 'none',
    analysis: scenarioAnalysis(),
    proposedReply,
    expect: [{ invariant: 'noUnsourcedSpecNumber' }],
  });

  it('a reply naming her code passes the turn AND the invariant', async () => {
    const { report, outcome } = await evaluateScenario(scenario('Yes, the ZX-300 comes in blue.'));
    expect(outcome.result.reply).toBe('Yes, the ZX-300 comes in blue.');
    expect(outcome.result.catalogue).toEqual(['Insulated bottle', 'ZX-300']);
    expect(report.passed, JSON.stringify(report.checks)).toBe(true);
  });

  it('the invariant re-runs the guard on the turn’s catalogue: an invented figure beside the code fails it, and without the catalogue the code does', async () => {
    const { outcome } = await evaluateScenario(scenario('Yes, the ZX-300 comes in blue.'));
    const invented = runCheck({ invariant: 'noUnsourcedSpecNumber' }, { ...outcome, result: { ...outcome.result, reply: 'The ZX-300 is $300 each.' } });
    expect(invented.pass).toBe(false);
    expect(invented.detail).toContain('300');
    const bare = runCheck({ invariant: 'noUnsourcedSpecNumber' }, { ...outcome, result: { ...outcome.result, catalogue: [] } });
    expect(bare.pass).toBe(false);
  });
});
