import { nextToSend, type OutboundRow } from './sequencer.js';
import {
  onSendFailure, shouldReclaim,
} from '../core/channel/delivery.js';
import { gateOutbound, type GateRefusal } from '../core/channel/sendGate.js';
import { sendPlan, windowState, type TemplateState } from '../core/channel/window.js';
import type { ChannelAdapter } from '../channels/contract.js';
import { redactSecrets } from '../security/credentials.js';

/**
 * M3 — The outbound drive loop for ONE conversation. Ports in, effects out;
 * the caller (pg-boss job / test) owns the transaction and the conversation
 * advisory lock. Restart-safe: stuck 'sending' rows are reclaimed, every
 * transition is recorded, and re-running a tick is always harmless.
 */

export type OutboundWorkRow = OutboundRow & {
  readonly to: string;
  readonly body: string;
  readonly origin: 'employee' | 'owner';
  readonly sendingSince: Date | null;
};

export type ConversationSendContext = {
  readonly assignedTo: string | null;
  readonly paused: boolean;
  readonly lastInboundAt: Date | null;
  readonly template: TemplateState;
  /** M18.2 — the channel is in pilot mode (allowlist enforced). Absent is
   *  treated as enforced by the gate: fail-closed. */
  readonly pilotMode?: boolean;
  /** M18.2 — is this conversation's buyer on the active allowlist? */
  readonly recipientAllowed?: boolean;
  /** M18.5 — the tenant already sent its daily maximum. */
  readonly dailyCeilingReached?: boolean;
  /** M20.1 — the owner turned messaging on. Absent = not activated. */
  readonly activated?: boolean;
};

/** The store port — DB-backed in production, in-memory in tests. Every
 * status change goes through transition() so the audit trail is structural. */
export type OutboundStore = {
  load(conversationId: string): Promise<{
    rows: readonly OutboundWorkRow[];
    ctx: ConversationSendContext;
  }>;
  transition(id: string, to: OutboundRow['status'], detail: string | null): Promise<void>;
  recordProviderId(id: string, providerMessageId: string): Promise<void>;
  scheduleRetry(id: string, delayMs: number, error: string): Promise<void>;
  deadLetter(id: string, error: string): Promise<void>;
  /** M18.2 — record a blocked send so the owner can see it. Optional so
   *  in-memory test stores need not implement it. */
  auditBlocked?(outboundId: string, to: string, reason: GateRefusal): Promise<void>;
};

export type DriveEffect =
  | { readonly kind: 'reclaimed'; readonly id: string }
  | { readonly kind: 'canceled'; readonly id: string; readonly reason: GateRefusal | 'window_needs_owner' }
  | { readonly kind: 'sent'; readonly id: string; readonly providerMessageId: string }
  | { readonly kind: 'retry_scheduled'; readonly id: string; readonly delayMs: number }
  | { readonly kind: 'dead_lettered'; readonly id: string }
  | { readonly kind: 'failed_permanent'; readonly id: string }
  | { readonly kind: 'waiting'; readonly blockedOn: string; readonly recheckInMs: number }
  | { readonly kind: 'idle' };

export async function driveConversationOutbound(
  deps: { store: OutboundStore; adapter: ChannelAdapter; now: () => Date },
  conversationId: string,
): Promise<readonly DriveEffect[]> {
  const effects: DriveEffect[] = [];
  const { rows, ctx } = await deps.store.load(conversationId);
  const now = deps.now();

  // 1. Restart safety: reclaim rows stuck mid-send.
  const live: OutboundWorkRow[] = [];
  for (const r of rows) {
    if (r.status === 'sending' && shouldReclaim(r.sendingSince, now)) {
      await deps.store.transition(r.id, 'queued', 'reclaimed: interrupted send');
      effects.push({ kind: 'reclaimed', id: r.id });
      live.push({ ...r, status: 'queued', sendingSince: null });
    } else {
      live.push(r);
    }
  }

  // 2. Send-time suppression: takeover/pause cancels queued employee messages
  //    outright — a buyer must never hear from the employee after a human
  //    took over or the owner hit pause.
  const humanOwns = ctx.assignedTo !== null;
  const suppressReason = humanOwns ? 'handed_off' as const : ctx.paused ? 'paused' as const : null;
  let active = live;
  if (suppressReason) {
    active = [];
    for (const r of live) {
      if (r.status === 'queued' && r.origin === 'employee') {
        await deps.store.transition(r.id, 'canceled', `canceled: ${suppressReason}`);
        effects.push({ kind: 'canceled', id: r.id, reason: suppressReason });
      } else {
        active.push(r);
      }
    }
  }

  // 3. Ordering decision.
  const decision = nextToSend(active, now);
  if (decision.action === 'idle') return [...effects, { kind: 'idle' }];
  if (decision.action === 'wait') {
    return [...effects, { kind: 'waiting', blockedOn: decision.blockedOn, recheckInMs: decision.recheckInMs }];
  }

  const candidate = active.find((r) => r.id === decision.id);
  if (!candidate) return effects; // row vanished mid-tick — next tick resolves

  // 4. Final gate: 24h window + suppression, evaluated at SEND time.
  const plan = sendPlan(windowState(ctx.lastInboundAt, now), 'reply', ctx.template);
  const gate = gateOutbound({
    origin: candidate.origin,
    assignedTo: ctx.assignedTo,
    paused: ctx.paused,
    windowPlan: plan,
    // M18.2/M18.5 — pilot allowlist + daily ceiling. Both default to the SAFE
    // interpretation inside the gate when a store does not supply them.
    ...(ctx.pilotMode !== undefined ? { pilotMode: ctx.pilotMode } : {}),
    ...(ctx.recipientAllowed !== undefined ? { recipientAllowed: ctx.recipientAllowed } : {}),
    ...(ctx.dailyCeilingReached !== undefined ? { dailyCeilingReached: ctx.dailyCeilingReached } : {}),
    // M20.1 — same fail-closed convention: a store that does not resolve
    // activation gets the safe answer.
    ...(ctx.activated !== undefined ? { activated: ctx.activated } : {}),
  });
  if (!gate.allow) {
    await deps.store.transition(candidate.id, 'canceled', `canceled: ${gate.reason}`);
    // M18.2 — a refusal to reach a non-allowlisted buyer is a safety event, not
    // routine flow control: record it where the owner can see it. The status
    // transition above already makes it non-silent; this makes it visible.
    if ((gate.reason === 'not_allowlisted' || gate.reason === 'not_activated') && deps.store.auditBlocked) {
      await deps.store.auditBlocked(candidate.id, candidate.to, gate.reason);
    }
    return [...effects, { kind: 'canceled', id: candidate.id, reason: gate.reason }];
  }
  if (gate.viaTemplate) {
    // No self-serve template sending yet: outside the window, contact goes
    // back to the owner (需要你确认后再联系) instead of auto-sending.
    await deps.store.transition(candidate.id, 'canceled', 'canceled: window_needs_owner');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'window_needs_owner' }];
  }

  // 5. Send, with the transition recorded on both sides of the wire.
  await deps.store.transition(candidate.id, 'sending', null);
  const result = await deps.adapter.sendText(candidate.to, candidate.body);

  if (result.ok) {
    await deps.store.recordProviderId(candidate.id, result.providerMessageId);
    await deps.store.transition(candidate.id, 'sent', null);
    return [...effects, { kind: 'sent', id: candidate.id, providerMessageId: result.providerMessageId }];
  }

  const attempts = candidate.attempts + 1;
  const failure = onSendFailure({ retryable: result.retryable, error: result.error }, attempts);
  // Provider error text passes through redaction BEFORE any sink — persistence
  // (last_error) and logs must never carry secret-shaped content (audit M3).
  const safeError = redactSecrets(result.error);
  if (failure.kind === 'retry') {
    await deps.store.transition(candidate.id, 'queued', `retry ${attempts}: ${safeError}`);
    await deps.store.scheduleRetry(candidate.id, failure.delayMs, safeError);
    return [...effects, { kind: 'retry_scheduled', id: candidate.id, delayMs: failure.delayMs }];
  }
  await deps.store.transition(candidate.id, 'failed', safeError);
  if (failure.kind === 'dead_letter') {
    await deps.store.deadLetter(candidate.id, safeError);
    return [...effects, { kind: 'dead_lettered', id: candidate.id }];
  }
  return [...effects, { kind: 'failed_permanent', id: candidate.id }];
}
