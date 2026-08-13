import type { AllowedClaim } from '../core/safety/claims.js';
import type { Money } from '../core/types/money.js';
import type { KnowledgeKind, KnowledgeSource } from '../core/types/knowledge.js';
import { ANSWER_KINDS } from '../core/types/knowledge.js';
import type { ProductId } from '../core/types/ids.js';
import { unsafeBrand } from '../core/types/brand.js';
import type { CheckResult, TurnOutcome } from './invariants.js';
import { evaluateScenario } from './harness.js';
import {
  analysis, candidate, SCHEMA_VERSION,
  type CatalogEntry, type InvariantId, type Scenario,
} from './scenarios.js';

/**
 * M20.5 — the factory rehearsal. "What can Lily not answer yet, about MY
 * products?"
 *
 * WHAT THIS IS NOT. It is not a second trust harness, not an extension of the
 * golden set, and not a grade. `scenarios.ts` — the twenty-three scenarios that
 * decide whether the product is safe AT ALL — is never read from here and never
 * changes shape; this module IMPORTS its types and builders and constructs its
 * own scenarios from the owner's real rows. The universal gate stays fixed; this
 * is a derived layer on top of it.
 *
 * WHAT IT IS. For each of the owner's products we build a scenario out of her
 * catalogue, her price rules, her taught knowledge and her authorised claims,
 * run the REAL engine over it through the existing harness, and read two
 * different things out of the result:
 *
 *   a FINDING     — her data is thin. "No price is set for X", "nothing has
 *                   been taught about Y". Hers to fix, and it never blocks
 *                   activation or touches readiness.
 *   a VIOLATION   — an invariant failed on real data. That is the ENGINE
 *                   misbehaving, not her. She cannot act on it and must not be
 *                   asked to, so it goes to the operator surface with evidence.
 *
 * COST. Pure and in-memory: no database, no clock, no network, no model call.
 * The only thing it can write to is its own return value — `TurnPorts` has no
 * outbound port, and the harness tenant's writes are no-ops.
 */

const brand = <T>(s: string): T => unsafeBrand<never>()(s) as unknown as T;

/** The page-load budget, not a priority system. See `PROBE_CAP` in the caller. */
export const PROBE_CAP = 20;

export type FactoryKnowledgeRow = {
  readonly kind: KnowledgeKind;
  readonly label: string;
  readonly content: string;
  readonly source: KnowledgeSource;
};

/** One of the owner's products, as the rehearsal needs it. Rows, not opinions. */
export type FactoryProduct = {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly moq: number;
  readonly unit: string;
  readonly leadTimeDays: number | null;
  readonly tiers: readonly { readonly minQty: number; readonly maxQty: number | null; readonly unitPrice: Money }[];
  readonly policy: { readonly floorPrice: Money; readonly maxDiscountPct: number; readonly humanRequiredAbovePct: number } | null;
  /**
   * Her ACTIVE, product-scoped taught rows. Business-level rows are deliberately
   * excluded: the harness tenant cannot represent them (a null productId is
   * coalesced to the product's own id), and "what she knows about this product"
   * is the question being asked.
   */
  readonly knowledge: readonly FactoryKnowledgeRow[];
};

export type FactoryFixture = {
  /** Already ordered and capped by the caller. */
  readonly products: readonly FactoryProduct[];
  /** claims_policy, verbatim — the guard's own allowlist. */
  readonly allowedClaims: readonly AllowedClaim[];
  /** How many active products she actually has, so the page can say "20 of 63". */
  readonly productsTotal: number;
};

export type ProbeKind = 'quote' | 'taught_answer' | 'claim_allowed' | 'claim_unauthorised';

export type FactoryProbe = {
  /** Namespaced so a probe id can never collide with a golden scenario id. */
  readonly id: string;
  readonly kind: ProbeKind;
  /** null for the two business-level claim probes. */
  readonly productName: string | null;
  readonly scenario: Scenario;
};

export type FindingReason =
  | 'no_price'              // no price configured at all
  | 'no_price_at_moq'       // tiers exist but none covers her own minimum order
  | 'floor_above_price'     // her floor sits above her own list price → refused
  | 'nothing_taught'        // no taught row for this product
  | 'answer_withheld'       // her own taught answer does not survive the guards
  | 'claim_not_authorised'; // no certification authorised, business-wide

export type FactoryFinding = {
  readonly reason: FindingReason;
  /** null for business-level findings. */
  readonly productName: string | null;
  /** The probe that produced it, so a finding is always traceable. */
  readonly probeId: string | null;
};

/** An invariant that failed on real data. Operator-only, with its evidence. */
export type InvariantViolation = {
  readonly probeId: string;
  readonly invariant: InvariantId;
  readonly detail: string;
  /** The input the engine was given, in one line. */
  readonly fixture: string;
  /** What the engine did with it, in one line. */
  readonly engine: string;
};

export type RehearsalReport = {
  readonly findings: readonly FactoryFinding[];
  readonly violations: readonly InvariantViolation[];
  readonly probesRun: number;
  readonly productsChecked: number;
  readonly productsTotal: number;
};

// ── probe construction ───────────────────────────────────────────────────────

/**
 * Certification keys we can state in a sentence the real detector recognises.
 * Digit-free on purpose: `ISO 9001` would trip the NUMERAL guard first, and a
 * claims probe that fails for a numeral reason is a probe that proves nothing.
 */
const CERT_PHRASE: Readonly<Record<string, string>> = {
  CE: 'CE certified',
  FDA: 'FDA approved',
  RoHS: 'RoHS compliant',
  BSCI: 'BSCI',
  food_grade: 'food-grade',
  BPA_free: 'BPA-free',
  REACH: 'REACH compliant',
  CPSIA: 'CPSIA',
};
/** Preference order for the "she has NOT authorised this" probe. */
const CERT_ORDER: readonly string[] = ['CE', 'FDA', 'RoHS', 'REACH', 'food_grade', 'BPA_free', 'BSCI', 'CPSIA'];

/** Bound the echoed answer: a taught row can be long, and this runs on a page load. */
const MAX_ECHO = 400;

const entryOf = (p: FactoryProduct): CatalogEntry => ({
  id: brand<ProductId>(p.id),
  sku: p.sku,
  name: p.name,
  moq: p.moq,
  unit: p.unit,
  leadTimeDays: p.leadTimeDays,
  tiers: p.tiers.map((t) => ({ minQty: t.minQty, maxQty: t.maxQty, unitPrice: t.unitPrice })),
  policy: p.policy,
});

/** The row she would actually answer from: a written answer first, else the first fact. */
function answerRow(p: FactoryProduct): FactoryKnowledgeRow | null {
  return p.knowledge.find((k) => ANSWER_KINDS.has(k.kind)) ?? p.knowledge[0] ?? null;
}

/**
 * Can she quote this product at her own minimum order? Runs her real tiers,
 * her real floor and her real discount ceiling through the real quote engine.
 * The proposed reply carries no digits and no claims, so the only thing under
 * test is the pricing.
 */
function quoteProbe(p: FactoryProduct, allowedClaims: readonly AllowedClaim[]): FactoryProbe {
  const e = entryOf(p);
  return {
    id: `factory:quote:${p.sku}`,
    kind: 'quote',
    productName: p.name,
    scenario: {
      schemaVersion: SCHEMA_VERSION,
      id: `factory:quote:${p.sku}`,
      title: `Can she quote ${p.name} at ${p.moq} ${p.unit}?`,
      category: 'price',
      buyer: { text: `What is your price for ${p.moq} ${p.unit}?` },
      state: { phase: 'commercial_discussion' },
      catalog: [e],
      candidates: [candidate(e)],
      analysis: analysis({
        productId: e.id, confidence: 0.95, confirmed: true,
        quantity: p.moq, unit: p.unit, phase: 'commercial_discussion',
      }),
      proposedReply: 'Let me put the pricing together for you.',
      allowedClaims,
      expect: [
        { invariant: 'priceFloorRespected' },
        { invariant: 'noFabricatedPrice' },
      ],
    },
  };
}

/**
 * Her own taught answer, offered back to a buyer who asked for exactly it. This
 * is the probe worth having: the words are HERS, so nothing is invented, and
 * the guards decide whether they can be said as they stand. A blocked answer
 * means a number with no source, or a certification she never authorised, is
 * sitting inside something she taught.
 */
function taughtAnswerProbe(
  p: FactoryProduct, row: FactoryKnowledgeRow, allowedClaims: readonly AllowedClaim[],
): FactoryProbe {
  const e = entryOf(p);
  return {
    id: `factory:taught:${p.sku}`,
    kind: 'taught_answer',
    productName: p.name,
    scenario: {
      schemaVersion: SCHEMA_VERSION,
      id: `factory:taught:${p.sku}`,
      title: `Can she say what you taught about ${p.name}?`,
      category: 'knowledge',
      buyer: { text: row.label },
      catalog: [e],
      candidates: [candidate(e)],
      analysis: analysis({ productId: e.id, confidence: 0.95, confirmed: true, phase: 'clarification' }),
      knowledge: p.knowledge.map((k) => ({
        productId: p.id, kind: k.kind, label: k.label, content: k.content, source: k.source,
      })),
      proposedReply: row.content.slice(0, MAX_ECHO),
      allowedClaims,
      expect: [
        { invariant: 'noUnsourcedSpecNumber' },
        { invariant: 'certOnlyIfAuthorized' },
      ],
    },
  };
}

/** A certification she has NOT authorised must not survive, whoever proposes it. */
function claimUnauthorisedProbe(key: string, allowedClaims: readonly AllowedClaim[]): FactoryProbe {
  const phrase = CERT_PHRASE[key] as string;
  return {
    id: `factory:claim-blocked:${key}`,
    kind: 'claim_unauthorised',
    productName: null,
    scenario: {
      schemaVersion: SCHEMA_VERSION,
      id: `factory:claim-blocked:${key}`,
      title: `A ${key} claim you never authorised stays off the wire`,
      category: 'claims',
      buyer: { text: 'Are these certified for export?' },
      candidates: 'none',
      analysis: analysis({ primary: 'inquiry', phase: 'clarification' }),
      proposedReply: `Yes — everything we make is ${phrase}.`,
      allowedClaims,
      expect: [
        { invariant: 'certOnlyIfAuthorized' },
        { invariant: 'noUnsupportedClaim', forbidden: [phrase] },
      ],
    },
  };
}

/** A certification she DID authorise must survive — the guard is not a mute button. */
function claimAllowedProbe(key: string, allowedClaims: readonly AllowedClaim[]): FactoryProbe {
  const phrase = CERT_PHRASE[key] as string;
  return {
    id: `factory:claim-allowed:${key}`,
    kind: 'claim_allowed',
    productName: null,
    scenario: {
      schemaVersion: SCHEMA_VERSION,
      id: `factory:claim-allowed:${key}`,
      title: `The ${key} approval you authorised reaches the buyer`,
      category: 'claims',
      buyer: { text: 'Are these certified for export?' },
      candidates: 'none',
      analysis: analysis({ primary: 'inquiry', phase: 'clarification' }),
      proposedReply: `Yes — everything we make is ${phrase}.`,
      allowedClaims,
      expect: [
        { invariant: 'allowedClaimPasses', phrase },
        { invariant: 'certOnlyIfAuthorized' },
      ],
    },
  };
}

/**
 * The whole probe set for one factory. Deterministic: same rows in, same probes
 * out, in the same order — which is what makes the isolation tests provable.
 */
export function deriveProbes(fx: FactoryFixture): readonly FactoryProbe[] {
  const claims = fx.allowedClaims;
  const probes: FactoryProbe[] = [];

  for (const p of fx.products) {
    probes.push(quoteProbe(p, claims));
    const row = answerRow(p);
    if (row && row.content.trim() !== '') probes.push(taughtAnswerProbe(p, row, claims));
  }

  // Claims are business-wide, so these run ONCE rather than per product —
  // twenty identical claim probes would cost twenty turns and prove one thing.
  const authorised = new Set(
    claims.filter((c) => c.allowed && (c.kind === 'certification' || c.kind === 'compliance')).map((c) => c.claimKey),
  );
  const unauthorised = CERT_ORDER.find((k) => !authorised.has(k));
  if (unauthorised) probes.push(claimUnauthorisedProbe(unauthorised, claims));
  const allowed = CERT_ORDER.find((k) => authorised.has(k));
  if (allowed) probes.push(claimAllowedProbe(allowed, claims));

  return probes;
}

// ── running, and reading the result three ways ───────────────────────────────

/** One line of evidence for the operator: what went in. */
function fixtureLine(probe: FactoryProbe): string {
  const s = probe.scenario;
  const cat = s.catalog?.[0];
  const parts = [`buyer=${JSON.stringify(s.buyer.text)}`];
  if (cat) {
    parts.push(`sku=${cat.sku}`, `moq=${cat.moq}`, `tiers=${cat.tiers.length}`,
      `floor=${cat.policy ? `${cat.policy.floorPrice.currency} ${cat.policy.floorPrice.amount}` : 'none'}`);
  }
  if (s.knowledge?.length) parts.push(`taught=${s.knowledge.length}`);
  parts.push(`claims=[${(s.allowedClaims ?? []).filter((c) => c.allowed).map((c) => c.claimKey).join(',') || 'none'}]`);
  parts.push(`proposed=${JSON.stringify(s.proposedReply ?? '')}`);
  return parts.join(' ');
}

/** One line of evidence for the operator: what came out. */
function engineLine(o: TurnOutcome): string {
  const r = o.result;
  return [
    `action=${r.decision.action.kind}`,
    `quote=${r.quote ? `${r.quote.unitPrice.currency} ${r.quote.unitPrice.amount}` : 'null'}`,
    `refusal=${r.quoteRefusal?.kind ?? 'none'}`,
    `guardViolations=${r.guardViolations}`,
    `deterministic=${r.replyDeterministic}`,
    `applied=${o.appliedMode}`,
    `reply=${JSON.stringify((r.reply ?? '').slice(0, 160))}`,
  ].join(' ');
}

const violationsOf = (probe: FactoryProbe, checks: readonly CheckResult[], o: TurnOutcome): InvariantViolation[] =>
  checks.filter((c) => !c.pass).map((c) => ({
    probeId: probe.id, invariant: c.invariant, detail: c.detail,
    fixture: fixtureLine(probe), engine: engineLine(o),
  }));

/**
 * What this probe says about HER DATA — separate from whether the engine held.
 * A quote that was refused `below_floor` is the engine working perfectly and
 * her floor being wrong; both facts are true and they go to different people.
 */
function findingOf(probe: FactoryProbe, o: TurnOutcome): FactoryFinding | null {
  const mk = (reason: FindingReason): FactoryFinding =>
    ({ reason, productName: probe.productName, probeId: probe.id });

  if (probe.kind === 'quote') {
    if (o.result.quote !== null) return null;
    switch (o.result.quoteRefusal?.kind) {
      case 'below_floor': return mk('floor_above_price');
      case 'no_price_tier': case 'below_moq': return mk('no_price_at_moq');
      default: return mk('no_price');
    }
  }
  if (probe.kind === 'taught_answer') {
    // Her own words were rewritten before they could be sent.
    return o.result.guardViolations > 0 ? mk('answer_withheld') : null;
  }
  return null;   // the claim probes are safety checks; their finding is data-derived
}

export async function rehearseFactory(fx: FactoryFixture): Promise<RehearsalReport> {
  const probes = deriveProbes(fx);
  const findings: FactoryFinding[] = [];
  const violations: InvariantViolation[] = [];

  // Data-derived findings first — these need no engine run at all, because
  // "you have taught her nothing about this" is a row count, not a verdict.
  const untaught = new Set<string>();
  for (const p of fx.products) if (p.knowledge.length === 0) untaught.add(p.id);

  const byProduct = new Map<string, FactoryFinding[]>();
  for (const probe of probes) {
    const { report, outcome } = await evaluateScenario(probe.scenario);
    violations.push(...violationsOf(probe, report.checks, outcome));
    const f = findingOf(probe, outcome);
    if (f === null) continue;
    const key = f.productName ?? '';
    const list = byProduct.get(key);
    if (list) list.push(f); else byProduct.set(key, [f]);
  }

  // Grouped by product, in the fixture's own order, so the list reads as a walk
  // through her catalogue rather than a bag of unrelated complaints.
  for (const p of fx.products) {
    findings.push(...(byProduct.get(p.name) ?? []));
    if (untaught.has(p.id)) findings.push({ reason: 'nothing_taught', productName: p.name, probeId: null });
  }

  const hasCert = fx.allowedClaims.some((c) => c.allowed && (c.kind === 'certification' || c.kind === 'compliance'));
  if (!hasCert) findings.push({ reason: 'claim_not_authorised', productName: null, probeId: null });

  return {
    findings,
    violations,
    probesRun: probes.length,
    productsChecked: fx.products.length,
    productsTotal: fx.productsTotal,
  };
}
