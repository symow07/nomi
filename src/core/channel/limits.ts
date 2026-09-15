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
 * C4.a — FIRST messages, to people who never wrote to her, in one day.
 *
 * An order of magnitude below the reply ceiling, and that gap is the point. The
 * ceiling above protects her from a loop answering a buyer who is already
 * talking to her; this one protects the ADDRESS SHE HAS USED FOR YEARS. A
 * thousand cold mails in an afternoon is how a domain's reputation dies, and
 * unlike a WhatsApp number it dies quietly and takes months to rebuild.
 *
 * It applies when she has stated no number of her own (`outreach_settings.
 * daily_cap` is null). Deliberately low rather than generous: the reply ceiling
 * should be invisible on a busy day, and this one should be something she raises
 * ON PURPOSE, having decided that is the volume she wants her name on.
 */
export const DAILY_OUTREACH_CEILING = 50;

/**
 * Quiet hours are NOT re-implemented here: the night-shift window machinery
 * (core/conversation/autonomy.ts `withinWindow`) already decides when the
 * employee may act on its own, and the 24h messaging window
 * (core/channel/window.ts) already decides when a message may leave at all.
 * Adding a third time rule would create a second source of truth.
 */
