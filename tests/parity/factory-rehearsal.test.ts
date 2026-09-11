import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { readFile } from 'node:fs/promises';
import {
  rehearseFactory, deriveProbes, PROBE_CAP,
  type FactoryFixture, type FindingReason, type RehearsalReport,
} from '../../src/trust/factoryRehearsal.js';
import { evaluateScenario, runAll } from '../../src/trust/harness.js';
import { SCENARIOS } from '../../src/trust/scenarios.js';
import { renderFactory, type FactoryView } from '../../src/api/web/factory.js';
import type { ChannelView } from '../../src/api/web/channels.js';
import { renderPilotRunbook, type PilotRunbook } from '../../src/api/web/pilot.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * M20.5 — the factory rehearsal.
 *
 * Two things are on trial here. First, that the findings are TRUE of the rows
 * they came from: "no price is set" must mean no price is set, never "the probe
 * happened not to quote". Second — and this is the load-bearing half — that the
 * universal trust gate is untouched: the twenty-five golden scenarios that
 * decide whether the product is safe at all must be byte-identical whether or
 * not this feature exists.
 */

type P = FactoryFixture['products'][number];

/** A product with a working price and no taught knowledge. Overridden per case. */
const product = (over: Partial<P>): P => ({
  id: '11111111-1111-1111-1111-111111111111',
  sku: 'BASE', name: 'Base product', moq: 1000, unit: 'pcs', leadTimeDays: 25,
  tiers: [{ minQty: 1000, maxQty: null, unitPrice: usd(0.45) }],
  policy: { floorPrice: usd(0.35), maxDiscountPct: 10, humanRequiredAbovePct: 7 },
  knowledge: [],
  ...over,
});

const fixture = (over: Partial<FactoryFixture> = {}): FactoryFixture => ({
  products: [product({})],
  allowedClaims: [{ kind: 'certification', claimKey: 'CE', allowed: true }],
  productsTotal: 1,
  ...over,
});

const reasons = (r: RehearsalReport): FindingReason[] => r.findings.map((f) => f.reason);

/**
 * `s.indexOf(missing)` is -1, and `s.slice(-1)` is a one-character string that
 * contains nothing — which has silently turned real assertions into decoration
 * twice in this repo. Every slice-by-marker in this file goes through here.
 */
function at(haystack: string, marker: string): number {
  const i = haystack.indexOf(marker);
  expect(i, `marker not present: ${marker}`).toBeGreaterThan(-1);
  return i;
}
const from = (haystack: string, marker: string): string => haystack.slice(at(haystack, marker));

const TAUGHT_SPEC = { kind: 'specification' as const, label: 'Dimensions', content: '38 x 40 cm', source: 'owner_confirmed' as const };

// ── the findings are true of the rows ────────────────────────────────────────

describe('M20.5 · a finding is a fact about her data, not a verdict', () => {
  it('a product with no price tiers cannot be quoted, and says exactly that', async () => {
    const r = await rehearseFactory(fixture({
      products: [product({ name: 'Canvas tote', tiers: [], policy: null, knowledge: [TAUGHT_SPEC] })],
    }));
    expect(reasons(r)).toEqual(['no_price']);
    expect(r.findings[0]?.productName).toBe('Canvas tote');
    expect(r.violations).toEqual([]);          // the engine behaved perfectly
  });

  it('price tiers that start above her own minimum order are a different problem', async () => {
    const r = await rehearseFactory(fixture({
      products: [product({ moq: 1000, tiers: [{ minQty: 5000, maxQty: null, unitPrice: usd(0.4) }], knowledge: [TAUGHT_SPEC] })],
    }));
    expect(reasons(r)).toEqual(['no_price_at_moq']);
    expect(r.violations).toEqual([]);
  });

  it('a floor above her own list price is reported to HER, not as an engine fault', async () => {
    const r = await rehearseFactory(fixture({
      products: [product({
        tiers: [{ minQty: 1000, maxQty: null, unitPrice: usd(0.45) }],
        policy: { floorPrice: usd(0.9), maxDiscountPct: 10, humanRequiredAbovePct: 7 },
        knowledge: [TAUGHT_SPEC],
      })],
    }));
    // Refusing to quote below the floor is the guard working. The DATA is wrong.
    expect(reasons(r)).toEqual(['floor_above_price']);
    expect(r.violations).toEqual([]);
  });

  it('a product she has been taught nothing about is a finding of its own', async () => {
    const r = await rehearseFactory(fixture({ products: [product({ name: 'Thermos', knowledge: [] })] }));
    expect(reasons(r)).toEqual(['nothing_taught']);
    expect(r.findings[0]?.productName).toBe('Thermos');
  });

  it('a taught answer naming an unauthorised approval cannot be said as it stands', async () => {
    const r = await rehearseFactory(fixture({
      allowedClaims: [],       // CE is NOT authorised
      products: [product({ knowledge: [
        { kind: 'faq', label: 'Is it certified for Europe?', content: 'Yes, it is CE certified.', source: 'owner_confirmed' },
      ] })],
    }));
    expect(reasons(r)).toContain('answer_withheld');
    // The guard held — she simply cannot say it yet. That is not a defect.
    expect(r.violations).toEqual([]);
  });

  it('a number inside her own taught row for that product IS sayable — no false finding', async () => {
    const r = await rehearseFactory(fixture({
      products: [product({ knowledge: [
        { kind: 'faq', label: 'How heavy is it?', content: 'Each one weighs 250 g.', source: 'owner_confirmed' },
      ] })],
    }));
    // 250 traces to a taught row of the identified product, so nothing is withheld.
    expect(reasons(r)).not.toContain('answer_withheld');
  });

  it('a factory that has authorised no certification is told so once, not per product', async () => {
    const r = await rehearseFactory(fixture({
      allowedClaims: [],
      products: [product({ id: 'a', sku: 'A', name: 'A', knowledge: [TAUGHT_SPEC] }),
                 product({ id: 'b', sku: 'B', name: 'B', knowledge: [TAUGHT_SPEC] })],
      productsTotal: 2,
    }));
    expect(reasons(r).filter((x) => x === 'claim_not_authorised')).toHaveLength(1);
    expect(r.findings.at(-1)?.productName).toBeNull();   // business-level, listed last
  });

  it('a complete product produces no finding at all — silence has to be earned', async () => {
    const r = await rehearseFactory(fixture({ products: [product({ knowledge: [TAUGHT_SPEC] })] }));
    expect(r.findings).toEqual([]);
    expect(r.violations).toEqual([]);
    expect(r.probesRun).toBeGreaterThan(0);
  });

  it('every finding names where it is fixed, and traces to a probe or a row count', async () => {
    const r = await rehearseFactory(fixture({
      allowedClaims: [],
      products: [product({ tiers: [], policy: null })],
    }));
    for (const f of r.findings) {
      // Either an engine probe produced it, or it is a direct count of her rows.
      if (f.probeId !== null) expect(f.probeId).toMatch(/^factory:/);
      expect(['no_price', 'no_price_at_moq', 'floor_above_price',
        'nothing_taught', 'answer_withheld', 'claim_not_authorised']).toContain(f.reason);
    }
  });
});

// ── the probes themselves ────────────────────────────────────────────────────

describe('M20.5 · probes are derived from her rows, and cost what they claim', () => {
  it('claim probes run once for the business, not once per product', async () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      product({ id: `p${i}`, sku: `S${i}`, name: `P${i}`, knowledge: [TAUGHT_SPEC] }));
    const probes = deriveProbes(fixture({ products, productsTotal: 5 }));
    const kinds = probes.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'quote')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'taught_answer')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'claim_unauthorised')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'claim_allowed')).toHaveLength(1);
  });

  it('a product with nothing taught gets no taught-answer probe to run', () => {
    const probes = deriveProbes(fixture({ products: [product({ knowledge: [] })] }));
    expect(probes.some((p) => p.kind === 'taught_answer')).toBe(false);
  });

  it('the allowed-claim probe only exists once she has authorised something', () => {
    expect(deriveProbes(fixture({ allowedClaims: [] })).some((p) => p.kind === 'claim_allowed')).toBe(false);
    expect(deriveProbes(fixture()).some((p) => p.kind === 'claim_allowed')).toBe(true);
  });

  it('no claim probe states a certification containing a digit', () => {
    // `ISO 9001` would trip the NUMERAL guard first, and a claims probe that
    // fails for a numeral reason proves nothing about claims.
    for (const p of deriveProbes(fixture({ allowedClaims: [{ kind: 'certification', claimKey: 'ISO9001', allowed: true }] })))
      if (p.kind.startsWith('claim')) expect(p.scenario.proposedReply ?? '').not.toMatch(/\d/);
  });

  it('every probe declares at least one invariant — a probe that checks nothing is decoration', () => {
    for (const p of deriveProbes(fixture({ products: [product({ knowledge: [TAUGHT_SPEC] })] })))
      expect(p.scenario.expect.length, p.id).toBeGreaterThan(0);
  });

  it('a full-cap factory stays well inside a page-load budget', async () => {
    const products = Array.from({ length: PROBE_CAP }, (_, i) =>
      product({ id: `p${i}`, sku: `S${i}`, name: `P${i}`, knowledge: [TAUGHT_SPEC] }));
    const fx = fixture({ products, productsTotal: 200 });
    await rehearseFactory(fx);                                  // warm
    const t0 = performance.now();
    const r = await rehearseFactory(fx);
    const ms = performance.now() - t0;
    expect(r.probesRun).toBe(PROBE_CAP * 2 + 2);
    expect(r.productsChecked).toBe(PROBE_CAP);
    expect(r.productsTotal).toBe(200);
    expect(ms, `${r.probesRun} probes took ${ms.toFixed(0)}ms`).toBeLessThan(400);
  });
});

// ── isolation: it cannot reach the database, and it cannot send ──────────────

describe('M20.5 · the rehearsal cannot touch anything', () => {
  const SRC = new URL('../../src/trust/factoryRehearsal.ts', import.meta.url);

  it('takes no database handle — there is no argument to pass one through', async () => {
    // Structural, not a promise: `rehearseFactory` accepts a fixture and nothing
    // else, and the module imports no database module at all.
    expect(rehearseFactory.length).toBe(1);
    const src = await readFile(SRC, 'utf8');
    for (const forbidden of ['db/client', 'db/repos', 'kysely', 'withTenantTx', 'pg-boss'])
      expect(src.includes(forbidden), `imports ${forbidden}`).toBe(false);
  });

  it('cannot create a conversation or an outbound message', async () => {
    const src = await readFile(SRC, 'utf8');
    for (const forbidden of ['enqueueOutbound', 'outbound/', 'sendGate', 'gateOutbound', 'adapter'])
      expect(src.includes(forbidden), `reaches ${forbidden}`).toBe(false);
    // And the pipeline it DOES run has no outbound port to reach through:
    // TurnPorts is { tenant, retriever, analyzer, replyWriter, now }.
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    const ports = turn.slice(at(turn, 'export type TurnPorts'), at(turn, 'export type TurnRequest'));
    expect(ports).not.toMatch(/outbound|send/i);
  });

  it('makes no model call — the analyzer and reply writer are the harness stubs', async () => {
    const src = await readFile(SRC, 'utf8');
    for (const forbidden of ['anthropic', 'Anthropic', 'llm/client', 'fetch('])
      expect(src.includes(forbidden), `reaches ${forbidden}`).toBe(false);
  });

  it('is deterministic — the same rows produce the same report, twice', async () => {
    const fx = fixture({
      allowedClaims: [{ kind: 'certification', claimKey: 'CE', allowed: true }],
      products: [
        product({ id: 'a', sku: 'A', name: 'A', tiers: [], policy: null }),
        product({ id: 'b', sku: 'B', name: 'B', knowledge: [TAUGHT_SPEC] }),
      ],
      productsTotal: 2,
    });
    expect(JSON.stringify(await rehearseFactory(fx))).toBe(JSON.stringify(await rehearseFactory(fx)));
  });

  it('does not mutate the fixture it was handed', async () => {
    const fx = fixture({ products: [product({ knowledge: [TAUGHT_SPEC] })] });
    const before = JSON.stringify(fx);
    await rehearseFactory(fx);
    expect(JSON.stringify(fx)).toBe(before);
  });
});

// ── the golden set is untouched ──────────────────────────────────────────────

describe('M20.5 · the universal trust gate is exactly what it was', () => {
  /**
   * The twenty-five scenarios, frozen. Adding one here is a deliberate act.
   * G7a added `discount-above-ask-line-waits-for-owner` and G7b
   * `higher-price-than-already-given-waits-for-owner`: each made one of her
   * rules a gate, and the golden set is where a gate is proven.
   */
  const GOLDEN = [
    'price-floor-clamp-under-aggressive-discount', 'below-floor-catalog-is-refused-not-quoted',
    'standard-volume-quote-within-authority', 'higher-price-than-already-given-waits-for-owner',
    'discount-above-ask-line-waits-for-owner',
    'unsupported-ce-fda-claim-is-blocked',
    'unsupported-refund-guarantee-is-blocked', 'unsupported-ddp-incoterm-is-blocked',
    'allowed-incoterm-claim-passes', 'explicit-human-request-escalates-en',
    'arabic-human-request-escalates', 'chinese-human-request-escalates',
    'unknown-product-yields-no-quote', 'unknown-product-no-fabricated-price',
    'low-confidence-match-asks-to-confirm', 'image-match-requires-confirmation',
    'draft-by-default-holds-the-reply', 'auto-qualify-grant-sends',
    'confirm-order-stays-draft-even-with-auto-grant', 'night-window-auto-outside-window-drafts',
    'night-window-auto-inside-window-sends', 'knowledge-spec-answered-with-sourced-numbers',
    'knowledge-untaught-number-is-blocked', 'knowledge-cert-in-answer-blocked-unless-authorised',
    'knowledge-authorised-cert-answer-passes',
  ];

  it('the golden set is the same twenty-five scenarios, in the same order', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(GOLDEN);
  });

  it('all twenty-five still pass', async () => {
    const r = await runAll(SCENARIOS);
    expect(r.failed, r.scenarios.filter((s) => !s.passed).map((s) => s.id).join(', ')).toBe(0);
    expect(r.passed).toBe(25);
  });

  it('no derived probe id can ever appear in the golden set', () => {
    for (const s of SCENARIOS) expect(s.id.startsWith('factory:'), s.id).toBe(false);
  });

  it('scenarios.ts knows nothing about the factory rehearsal', async () => {
    const src = await readFile(new URL('../../src/trust/scenarios.ts', import.meta.url), 'utf8');
    for (const forbidden of ['factory:', 'factoryRehearsal', 'FactoryProbe', 'rehearse'])
      expect(src.includes(forbidden), `scenarios.ts mentions ${forbidden}`).toBe(false);
  });

  it('the owner’s practice screen still runs exactly the golden set', async () => {
    const { runScriptedPractice } = await import('../../src/api/web/sandbox.js');
    const r = await runScriptedPractice();
    expect(r.cases.map((c) => c.id)).toEqual(GOLDEN);
    expect(r.total).toBe(25);
  });

  it('a failing invariant really does become a violation — the path is not decorative', async () => {
    // Take a real probe and demand something of it that cannot hold. If the
    // plumbing that `rehearseFactory` reads were dead, this would still pass.
    const probe = deriveProbes(fixture())[0]!;
    const { report } = await evaluateScenario({
      ...probe.scenario,
      expect: [...probe.scenario.expect, { invariant: 'allowedClaimPasses', phrase: 'NEVER-SAID-THIS' }],
    });
    expect(report.passed).toBe(false);
    expect(report.checks.some((c) => !c.pass)).toBe(true);
  });
});

// ── what the owner sees, and what she must never see ────────────────────────

const view = (rehearsal: RehearsalReport | null): FactoryView => ({
  profile: { name: 'Yiwu Sunrise', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [], categories: [] },
  products: { total: 2, needPrice: 0, names: [] },
  promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: OFFLINE_CHANNEL, ownerPhone: null },
  nextStep: null,
  readiness: { canActivate: false, blockers: ['no_channel'], recipients: [], lifecycle: 'not_connected',
    live: false, activatedAt: null, activatedBy: null },
  rehearsal,
  prices: { businessDefault: null, products: [], unanswered: 0 },
});

const OFFLINE_CHANNEL: ChannelView = {
  kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false,
  displayId: null, lastActivityAt: null, problem: null,
};

const withFindings: RehearsalReport = {
  findings: [
    { reason: 'no_price', productName: 'Canvas tote', probeId: 'factory:quote:TOTE' },
    { reason: 'nothing_taught', productName: 'Thermos', probeId: null },
    { reason: 'claim_not_authorised', productName: null, probeId: null },
  ],
  violations: [],
  probesRun: 5, productsChecked: 2, productsTotal: 9,
};

describe('M20.5 · My factory shows findings, never a grade', () => {
  it('leads with the list, and every line goes somewhere she can act', () => {
    const html = renderFactory(view(withFindings), 'en');
    // Grouped by reason, with the affected products named under each.
    expect(html).toContain('No price is set, so she cannot quote these:');
    expect(html).toContain('<bdi>Canvas tote</bdi>');
    expect(html).toContain('You have not taught her anything about these beyond the price:');
    expect(html).toContain('<bdi>Thermos</bdi>');
    expect(html).toContain('href="/app/products"');
    expect(html).toContain('href="/app/knowledge"');
    // the list comes before the scope note, never a tally first
    expect(at(html, 'Canvas tote')).toBeLessThan(at(html, 'Checked 2 of your 9 products'));
  });

  it('says a repeated gap once, over a list of names — not once per product', () => {
    const many: RehearsalReport = {
      findings: Array.from({ length: 12 }, (_, i) =>
        ({ reason: 'nothing_taught' as const, productName: `Product ${i}`, probeId: null })),
      violations: [], probesRun: 12, productsChecked: 12, productsTotal: 12,
    };
    const html = renderFactory(view(many), 'en');
    const sentence = 'You have not taught her anything about these beyond the price:';
    // Twelve identical sentences read as an indictment; one over twelve names
    // reads as a job to do. Every name is still there.
    expect(html.split(sentence).length - 1).toBe(1);
    for (let i = 0; i < 12; i++) expect(html).toContain(`<bdi>Product ${i}</bdi>`);
  });

  it('carries no score, rating or percentage', () => {
    const html = renderFactory(view(withFindings), 'en');
    const block = from(html, 'What Lily cannot answer yet');
    expect(block).not.toMatch(/\d+\s?%/);
    for (const word of ['score', 'rating', 'grade', 'passed', 'failed', 'health'])
      expect(block.toLowerCase(), word).not.toContain(word);
  });

  it('never blocks going live — the activation decision is untouched by it', () => {
    const blocked = renderFactory(view(withFindings), 'en');
    const clean = renderFactory(view({ ...withFindings, findings: [] }), 'en');
    // Both render the SAME activation verdict; only the findings list differs.
    const verdict = (h: string) => h.slice(at(h, 'Before she talks'), at(h, 'What Lily cannot answer yet'));
    expect(verdict(blocked)).toBe(verdict(clean));
  });

  it('says what was checked rather than claiming she is ready, when nothing is wrong', () => {
    const html = renderFactory(view({ ...withFindings, findings: [], productsTotal: 2 }), 'en');
    const block = from(html, 'What Lily cannot answer yet');
    expect(block).toContain('Every product she checked has a price she can quote');
    expect(block).toContain('Checked all 2 of your products');
    // An empty findings list means "nothing was missing in what I checked" —
    // it is NOT a statement that she is ready. That verdict has its own section.
    expect(block.toLowerCase()).not.toContain('ready');
  });

  it('a factory with no products yet shows nothing at all — no empty success', () => {
    const html = renderFactory(view({ findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 }), 'en');
    expect(html).not.toContain('What Lily cannot answer yet');
  });

  it('renders in every locale without falling back to English', () => {
    for (const l of LOCALES) {
      const html = renderFactory(view(withFindings), l);
      expect(html).toContain('Canvas tote');                     // her own product name
      if (l !== 'en') expect(html).not.toContain('No price is set, so she cannot quote');
    }
  });
});

/** A runbook with nothing interesting in it — only the engine panel is on trial. */
const runbook: PilotRunbook = {
  readiness: {
    detected: { profile: true, products: true, priceRules: true, knowledge: true, claims: false, sandbox: false, channel: false },
    attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
    validation: { at: null, pass: null, total: null },
    readyToLaunch: false,
  },
  operations: {
    range: 'week',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 0, draftsCreated: 0, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'not_connected', provider: 'disabled' },
    hasAttention: false,
  },
  rehearsal: {
    available: false,
    done: { takeover: false, ownerReply: false, resume: false, knowledgeCorrection: false, validationPassed: false },
    completed: 0, total: 5,
  },
  reliability: { stuckOutbound: 0, oldestQueuedAt: null },
};

describe('M20.5 · an engine defect goes to the operator, never to the owner', () => {
  const withViolation: RehearsalReport = {
    ...withFindings,
    violations: [{
      probeId: 'factory:quote:TOTE', invariant: 'priceFloorRespected',
      detail: 'unit $0.20 BELOW floor $0.35',
      fixture: 'buyer="What is your price for 1000 pcs?" sku=TOTE moq=1000 tiers=1 floor=$0.35',
      engine: 'action=quote quote=$0.20 refusal=none guardViolations=0',
    }],
  };

  it('My factory shows no trace of it — she cannot fix our defect', () => {
    const html = renderFactory(view(withViolation), 'en');
    for (const leak of ['priceFloorRespected', 'BELOW floor', 'guardViolations', 'factory:quote:TOTE'])
      expect(html, leak).not.toContain(leak);
  });

  it('the runbook shows it with enough evidence to reproduce it', async () => {
    const html = renderPilotRunbook(runbook, 'en', null, undefined, undefined, undefined, withViolation);
    expect(html).toContain('priceFloorRespected');        // which invariant
    expect(html).toContain('factory:quote:TOTE');         // which probe
    expect(html).toContain('sku=TOTE');                   // the input
    expect(html).toContain('quote=$0.20');                // the engine's answer
    expect(html).toContain('not something you can fix on your side');
  });

  it('says plainly when nothing failed, rather than showing a tick', () => {
    const html = renderPilotRunbook(runbook, 'en', null, undefined, undefined, undefined, withFindings);
    expect(html).toContain('All 5 checks held.');
    // No evidence block is rendered. (The stylesheet always ships, so this
    // asserts on the markup — matching 'ev-p' would pass against the CSS.)
    expect(html).not.toContain('<div class="ev">');
    expect(html).not.toContain('<pre class="ev-p">');
  });

  it('the panel is absent entirely when the rehearsal did not run', () => {
    const html = renderPilotRunbook(runbook, 'en', null);
    expect(html).not.toContain(t('en', 'runbook.engine.title'));
  });
});
