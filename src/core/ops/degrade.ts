/**
 * M8 — Graceful degradation when the language model is unavailable.
 *
 * The invariant: A BUYER MESSAGE IS NEVER DROPPED. The ladder only decides
 * HOW it gets handled while the brain is down — never whether. Worst case
 * is the honest one: hold the conversation and tell the owner to reply
 * manually (OWNER_PROBLEM.needManualReply — copy shipped in M1).
 */

export type LlmOutageInput = {
  readonly consecutiveFailures: number;   // failed LLM calls for this turn
  readonly outageMinutes: number;         // since first failure across tenant
  readonly onNightShift: boolean;         // nobody is awake to reply manually
};

export type LlmOutagePlan = {
  /** The message stays queued and replayable. Structurally always true. */
  readonly holdMessage: true;
  readonly action:
    | 'retry_soon'            // transient — retry with backoff, say nothing yet
    | 'notify_owner_manual'   // sustained — owner should reply by hand
    | 'night_hold_and_ack';   // night shift — send the polite hold, owner sees it at dawn
  readonly retryDelayMs: number | null;
  /** Buyer-facing holding line (only for night_hold_and_ack; approved copy). */
  readonly buyerAckEn: string | null;
};

export const LLM_RETRY_DELAYS_MS = [5_000, 20_000, 60_000] as const;
/** After this, silence toward the owner becomes the bigger lie. */
export const OUTAGE_NOTIFY_AFTER_MIN = 5;

export const NIGHT_HOLD_ACK_EN =
  'Thanks for your message! We will get back to you first thing in the morning.';

export function llmOutagePlan(i: LlmOutageInput): LlmOutagePlan {
  const attempt = Math.min(i.consecutiveFailures, LLM_RETRY_DELAYS_MS.length) - 1;
  if (i.consecutiveFailures <= LLM_RETRY_DELAYS_MS.length && i.outageMinutes < OUTAGE_NOTIFY_AFTER_MIN) {
    return {
      holdMessage: true, action: 'retry_soon',
      retryDelayMs: LLM_RETRY_DELAYS_MS[Math.max(0, attempt)]!,
      buyerAckEn: null,
    };
  }
  if (i.onNightShift) {
    // 3am: don't wake the owner for every retry — ack the buyer once,
    // keep retrying quietly, morning digest carries the story.
    return { holdMessage: true, action: 'night_hold_and_ack', retryDelayMs: 300_000, buyerAckEn: NIGHT_HOLD_ACK_EN };
  }
  return { holdMessage: true, action: 'notify_owner_manual', retryDelayMs: 300_000, buyerAckEn: null };
}
