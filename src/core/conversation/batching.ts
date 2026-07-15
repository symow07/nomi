/**
 * Inbound message batching. (Priority 2)
 *
 * Kills ASSUMPTIONS.md P1: real buyers send fragments —
 *   "hello" / "price?" / "the bags" / "5000pcs"  — in seconds.
 * One-fragment-one-turn analysis is meaningless and burns 4× the tokens for
 * worse answers. So: fragments accumulate; the turn runs against the MERGED
 * text once the buyer goes quiet (debounce), with hard caps so a chatty buyer
 * cannot postpone a reply forever.
 *
 * Pure decision logic. The worker supplies fragments + clock; replay is free
 * because fragments are persisted (message_fragments) and the merge is
 * deterministic.
 */

export type Fragment = {
  readonly id: string;          // external message id — dedup key, replay key
  readonly text: string;
  readonly receivedAt: Date;
};

export type BatchConfig = {
  /** quiet time that closes a batch. Default 6s — WhatsApp typing rhythm. */
  readonly debounceMs: number;
  /** hard ceiling from FIRST fragment — a monologue still gets a reply. */
  readonly maxWindowMs: number;
  /** fragment-count ceiling — burst protection. */
  readonly maxFragments: number;
};

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  debounceMs: 6_000,
  maxWindowMs: 20_000,
  maxFragments: 8,
};

export type BatchDecision =
  | { readonly action: 'wait'; readonly checkAgainAt: Date }
  | {
      readonly action: 'process';
      readonly mergedText: string;
      readonly fragmentIds: readonly string[];
      readonly stats: BatchStats;
    };

export type BatchStats = {
  readonly fragments: number;
  readonly spanMs: number;      // first → last fragment
  readonly burst: boolean;      // closed by a cap rather than by quiet
};

/**
 * Given the unprocessed fragments of one conversation, decide whether the
 * buyer is done talking. Deterministic in (fragments, now, config).
 */
export function decideBatch(
  fragments: readonly Fragment[],
  now: Date,
  config: BatchConfig = DEFAULT_BATCH_CONFIG,
): BatchDecision {
  if (fragments.length === 0) {
    return { action: 'wait', checkAgainAt: new Date(now.getTime() + config.debounceMs) };
  }

  const sorted = [...fragments].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const first = sorted[0] as Fragment;
  const last = sorted[sorted.length - 1] as Fragment;

  const quietMs = now.getTime() - last.receivedAt.getTime();
  const spanMs = last.receivedAt.getTime() - first.receivedAt.getTime();

  const quietLongEnough = quietMs >= config.debounceMs;
  const windowExhausted = now.getTime() - first.receivedAt.getTime() >= config.maxWindowMs;
  const tooMany = sorted.length >= config.maxFragments;

  if (!quietLongEnough && !windowExhausted && !tooMany) {
    // Still typing. Re-check when the debounce would elapse or the window closes,
    // whichever is sooner.
    const byDebounce = last.receivedAt.getTime() + config.debounceMs;
    const byWindow = first.receivedAt.getTime() + config.maxWindowMs;
    return { action: 'wait', checkAgainAt: new Date(Math.min(byDebounce, byWindow)) };
  }

  return {
    action: 'process',
    // Newline-joined in arrival order: the analyzer sees the buyer's whole
    // thought, exactly as a human reading the chat would.
    mergedText: sorted.map((f) => f.text.trim()).filter(Boolean).join('\n'),
    fragmentIds: sorted.map((f) => f.id),
    stats: { fragments: sorted.length, spanMs, burst: !quietLongEnough },
  };
}
