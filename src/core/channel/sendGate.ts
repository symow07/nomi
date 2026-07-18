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
};

export type GateDecision =
  | { readonly allow: true; readonly viaTemplate: boolean }
  | { readonly allow: false; readonly reason: 'handed_off' | 'paused' | 'window_closed' };

export function gateOutbound(g: GateInput): GateDecision {
  if (g.origin === 'employee') {
    if (g.assignedTo !== null) return { allow: false, reason: 'handed_off' };
    if (g.paused) return { allow: false, reason: 'paused' };
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
