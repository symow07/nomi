import { aiMaySpeak, ownershipOf } from '../conversation/ownership.js';
import type { SendPlan } from './window.js';
import type { OutboundRow } from '../../outbound/sequencer.js';

/**
 * M3 — The last gate before a message leaves the building. Enqueue-time checks
 * are not enough: a takeover, a pause, or a window expiry can happen AFTER a
 * message was queued. This gate runs at send time, so a buyer can never
 * receive a follow-up after the owner took over, a reply after the
 * conversation was paused, or a free-form message into a closed window.
 */

export type GateInput = {
  /** Who authored the queued message. Owner-authored text is the owner
   * speaking — the takeover/pause gates are FOR him, not against him. */
  readonly origin: 'employee' | 'owner';
  /** Handoff state: non-null (incl. 'unclaimed') = a human owns the thread. */
  readonly assignedTo: string | null;
  /** 收回 / budget pause / owner-set pause. */
  readonly paused: boolean;
  /** Current 24h-window plan for this conversation (window.ts). */
  readonly windowPlan: SendPlan;
  /** M18.2 — the channel is in pilot mode, so the allowlist is enforced.
   *  Absent is treated as TRUE (fail-closed): a caller that forgets to pass
   *  pilot state gets the safe behaviour, not the permissive one. */
  readonly pilotMode?: boolean;
  /** M18.2 — whether THIS recipient is on the tenant's active allowlist.
   *  Resolved by the caller against pilot_allowlist. Absent = not allowed. */
  readonly recipientAllowed?: boolean;
  /** M18.5 — the tenant has already sent its daily maximum. */
  readonly dailyCeilingReached?: boolean;
  /**
   * M20.1 — the owner has explicitly turned messaging on for this channel
   * (`channels.activated_at`). CONNECTED is not ACTIVATED: working credentials
   * mean the provider is reachable, not that the owner decided to go live.
   *
   * Absent is treated as NOT activated, like every other optional here: a
   * caller that forgets to resolve activation gets silence, not a live send.
   */
  readonly activated?: boolean;
  /**
   * M34.6 — an ops `global_silence` flag is live for this tenant (ops_flags,
   * migration 0014), resolved by the caller via `switchesFrom`.
   *
   * REQUIRED, not optional like the rest. Every optional above defaults to its
   * fail-closed value, which works because forgetting them only ever refuses.
   * A kill switch is the opposite shape: the dangerous default is the permissive
   * one, and this gate exists because that switch spent six months connected to
   * nothing. A required field makes the compiler name every caller that has to
   * resolve it — including the next one, written by someone who never read this.
   */
  readonly silenced: boolean;
};

/**
 * Every way this gate can refuse, as data. The type DERIVES from the list, so a
 * reason cannot exist in one and not the other.
 *
 * It was a hand-written union with a hand-written copy in refusals.test.ts
 * ("adding a reason breaks this on purpose"). It did break on purpose — twice —
 * and a list that must be edited in two places to stay true is the transcription
 * bug this repo keeps paying for. Now there is one list, and the owner-copy
 * coverage test reads it instead of restating it.
 */
export const GATE_REFUSALS = [
  'handed_off', 'paused', 'window_closed',
  'not_activated',        // M20.1
  'not_allowlisted',      // M18.2
  'daily_ceiling',        // M18.5
  'silenced',             // M34.6
] as const;

export type GateRefusal = (typeof GATE_REFUSALS)[number];

export type GateDecision =
  | { readonly allow: true; readonly viaTemplate: boolean }
  | { readonly allow: false; readonly reason: GateRefusal };

export function gateOutbound(g: GateInput): GateDecision {
  // M20.1 — activation is a property of the CHANNEL, not of who is speaking,
  // so it binds the owner exactly as it binds the employee. It is checked
  // first: before the pilot is live, nothing else about this message matters.
  if (g.activated !== true) return { allow: false, reason: 'not_activated' };

  if (g.origin === 'employee') {
    // M34.6 — the ops kill switch. Checked at SEND time like everything else
    // here, which is the point: a reply queued a minute before the switch was
    // thrown must not still leave the building. It binds the employee only —
    // silencing the machine is not silencing the owner, who may well be
    // silencing it in order to answer the buyer himself.
    if (g.silenced) return { allow: false, reason: 'silenced' };
    if (!aiMaySpeak(ownershipOf(g.assignedTo))) return { allow: false, reason: 'handed_off' };
    if (g.paused) return { allow: false, reason: 'paused' };
  }

  // M18.2 — the pilot allowlist binds EVERYONE, including the owner. During a
  // controlled pilot the question is not "who is speaking?" but "is this buyer
  // one we agreed to reach?". Fail-closed: pilot mode is assumed on unless the
  // caller says otherwise, and an unresolved recipient is not allowed.
  const pilotMode = g.pilotMode ?? true;
  if (pilotMode && g.recipientAllowed !== true) {
    return { allow: false, reason: 'not_allowlisted' };
  }

  // M18.5 — a runaway loop must not spend the day messaging a real buyer.
  // Blocks rather than warns; owner-authored text is exempt, because a human
  // deliberately typing is not the failure mode this protects against.
  if (g.origin === 'employee' && g.dailyCeilingReached === true) {
    return { allow: false, reason: 'daily_ceiling' };
  }

  // The window binds everyone — the provider rejects violations regardless of
  // who typed the message.
  if (g.windowPlan.action === 'wait_for_buyer') {
    return { allow: false, reason: 'window_closed' };
  }
  return { allow: true, viaTemplate: g.windowPlan.action === 'send_template' };
}

/**
 * On takeover/pause/revoke: employee-authored queued messages are canceled —
 * not delayed, canceled. In-flight ('sending') rows finish their attempt; the
 * gate blocks their retries.
 */
export function cancelableOnTakeover(
  rows: readonly (OutboundRow & { readonly origin: 'employee' | 'owner' })[],
): readonly string[] {
  return rows
    .filter((r) => r.status === 'queued' && r.origin === 'employee')
    .map((r) => r.id);
}
