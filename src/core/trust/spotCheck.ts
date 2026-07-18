/**
 * M5 — 抽查: the two-minute management ritual. Deterministic selection of
 * representative completed work; verdicts feed promotion/demotion evidence
 * (evidence.ts applySpotCheck). No spam: a fixed weekly budget, results
 * summarized in the review, never pushed one by one.
 */

export type CompletedWork = {
  readonly id: string;
  readonly capability: string;
  readonly buyerMessage: string;
  readonly reply: string;
  readonly replyZh: string;          // back-translation — owner judges what he can read
  readonly wasAuto: boolean;         // auto work is what spot checks exist for
  readonly at: Date;
};

export const SPOT_CHECKS_PER_WEEK = 3;

/** Deterministic hash — selection must reproduce across restarts. */
const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
};

/**
 * Pick up to `budget` items: auto-handled first (that's the unsupervised
 * surface), spread across capabilities, deterministic within each bucket.
 */
export function selectSpotChecks(
  completed: readonly CompletedWork[],
  budget: number = SPOT_CHECKS_PER_WEEK,
): readonly CompletedWork[] {
  const pool = [...completed].sort((a, b) =>
    Number(b.wasAuto) - Number(a.wasAuto) || hash(a.id) - hash(b.id));
  const picked: CompletedWork[] = [];
  const perCapability = new Map<string, number>();
  for (const w of pool) {
    if (picked.length >= budget) break;
    const n = perCapability.get(w.capability) ?? 0;
    if (n >= Math.ceil(budget / 2)) continue;   // spread across capabilities
    perCapability.set(w.capability, n + 1);
    picked.push(w);
  }
  return picked;
}

export type SpotCheckVerdict = 'correct' | 'needs_improvement' | 'serious';

/** Owner replies on the spot-check card → verdict. 好/对 pass; 有问题 serious;
 * anything substantive is a correction (needs_improvement + training text). */
export function parseSpotCheckReply(raw: string): {
  verdict: SpotCheckVerdict; correction: string | null;
} {
  const t = raw.trim();
  if (/^(好|对|没问题|可以|ok|OK|✅)$/.test(t)) return { verdict: 'correct', correction: null };
  if (/^(有问题|不行|严重|错了)$/.test(t)) return { verdict: 'serious', correction: null };
  if (t.length >= 4) return { verdict: 'needs_improvement', correction: t };
  return { verdict: 'needs_improvement', correction: null };
}
