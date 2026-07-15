/**
 * The shadow comparator — the heart of migration safety. (ADR-0009)
 *
 * We diff DECISIONS, never prose: the LLM is nondeterministic, so two runs of
 * the SAME engine word replies differently, and a prose diff would be noise.
 * Everything below is deterministic, and it is exactly the set of things that
 * make or lose money.
 */

/** The decision fingerprint both engines are reduced to before comparison. */
export type DecisionFingerprint = {
  readonly phase: string;
  readonly productId: string | null;
  readonly productConfirmed: boolean;
  readonly quantity: number | null;
  readonly problemScore: number;
  readonly leadScore: number;
  readonly pendingQuestion: string | null;
  readonly phaseAction: 'maintain' | 'advance' | 'confirm_order' | 'handoff' | 'silent';
  readonly quote: {
    readonly unitPriceUsd: number;
    readonly discountPct: number;
    readonly totalUsd: number;
  } | null;
};

export type FieldDivergence = {
  readonly field: string;
  readonly n8n: unknown;
  readonly service: unknown;
};

export type ComparisonResult = {
  readonly diverged: boolean;
  readonly divergences: readonly FieldDivergence[];
  /** true when every divergence matches a known-intentional rule */
  readonly allExpected: boolean;
};

/**
 * Known-intentional divergences: places where the service is CORRECT and n8n is
 * the bug. Each carries a written justification; nothing is silently ignored.
 * These are the fixes the migration exists to ship. (ADR-0009 exit criteria)
 */
export type ExpectedDivergenceRule = {
  readonly field: string;
  readonly justification: string;
  readonly applies: (n8n: unknown, service: unknown, ctx: DecisionFingerprint) => boolean;
};

export const EXPECTED_DIVERGENCES: readonly ExpectedDivergenceRule[] = [
  {
    field: 'problemScore',
    justification:
      'n8n has one monotonic score that conflates problems with buying signals; ' +
      'the service splits them (ADR-0003). Lead signals no longer inflate problem.',
    applies: (n8n, service) =>
      typeof n8n === 'number' && typeof service === 'number' && service <= n8n,
  },
  {
    field: 'phaseAction',
    justification:
      'The service pauses the AI on handoff (silent) where n8n kept replying.',
    applies: (_n8n, service) => service === 'silent' || service === 'handoff',
  },
  {
    field: 'phaseAction',
    justification:
      'The service can reach confirm_order on hot leads that n8n blocked via the ' +
      'monotonic score (the unclosable-big-deal bug).',
    applies: (n8n, service, ctx) =>
      service === 'confirm_order' && n8n !== 'confirm_order' && ctx.problemScore < 70,
  },
];

const num = (n: number) => Math.round(n * 100) / 100;

export function compareDecisions(
  n8n: DecisionFingerprint,
  service: DecisionFingerprint,
  expectedRules: readonly ExpectedDivergenceRule[] = EXPECTED_DIVERGENCES,
): ComparisonResult {
  const divergences: FieldDivergence[] = [];

  const diff = (field: string, a: unknown, b: unknown) => {
    if (a !== b) divergences.push({ field, n8n: a, service: b });
  };

  diff('phase', n8n.phase, service.phase);
  diff('productId', n8n.productId, service.productId);
  diff('productConfirmed', n8n.productConfirmed, service.productConfirmed);
  diff('quantity', n8n.quantity, service.quantity);
  diff('problemScore', n8n.problemScore, service.problemScore);
  diff('leadScore', n8n.leadScore, service.leadScore);
  diff('pendingQuestion', n8n.pendingQuestion, service.pendingQuestion);
  diff('phaseAction', n8n.phaseAction, service.phaseAction);

  // Money: cent-exact or diverged. There is no tolerance on a quoted price.
  const qa = n8n.quote;
  const qb = service.quote;
  if ((qa === null) !== (qb === null)) {
    divergences.push({ field: 'quote', n8n: qa, service: qb });
  } else if (qa && qb) {
    diff('quote.unitPriceUsd', num(qa.unitPriceUsd), num(qb.unitPriceUsd));
    diff('quote.discountPct', num(qa.discountPct), num(qb.discountPct));
    diff('quote.totalUsd', num(qa.totalUsd), num(qb.totalUsd));
  }

  const allExpected =
    divergences.length > 0 &&
    divergences.every((d) =>
      expectedRules.some((r) => r.field === d.field && r.applies(d.n8n, d.service, service)),
    );

  return { diverged: divergences.length > 0, divergences, allExpected };
}
