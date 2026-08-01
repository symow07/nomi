/**
 * M18.5 — pilot guardrails that are plain, fixed limits rather than judgement.
 *
 * The failure this protects against is a loop: a bug that makes the employee
 * message a real buyer over and over. A human deliberately typing is not that
 * failure mode, so the ceiling counts EMPLOYEE messages only and never blocks
 * the owner's own reply.
 *
 * It BLOCKS rather than warns — a warning nobody reads at 3am is not a guard.
 * The number is deliberately generous: it should be invisible on a busy real
 * day and obvious during a runaway.
 */

/** Employee-authored messages a tenant may actually send in one day (Shanghai). */
export const DAILY_OUTBOUND_CEILING = 200;

/**
 * Quiet hours are NOT re-implemented here: the night-shift window machinery
 * (core/conversation/autonomy.ts `withinWindow`) already decides when the
 * employee may act on its own, and the 24h messaging window
 * (core/channel/window.ts) already decides when a message may leave at all.
 * Adding a third time rule would create a second source of truth.
 */
