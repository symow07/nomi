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
  /** Text, or the caption when `kind` is 'image'. */
  readonly body: string;
  readonly origin: 'employee' | 'owner';
  readonly sendingSince: Date | null;
  /** M26 — 'text' (default), 'quote_card', or 'image'. */
  readonly kind?: string;
  /** M26 — where the picture is, for kind='image'. One of the owner's own
   *  product_images.url rows. Null for every text row. */
  readonly mediaUrl?: string | null;
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
  /** M22 — record a refused send so the owner can see it, with the reason it
   *  was actually refused for. Optional so in-memory test stores need not
   *  implement it. */
  recordRefusal?(outboundId: string, to: string, reason: RefusalReason): Promise<void>;
};

/**
 * M22 — every way a queued message can end without reaching the buyer.
 *
 * The six `GateRefusal` values are `gateOutbound`'s own, carried through
 * unchanged — this adds no reason of its own and makes no decision. The
 * seventh, `window_needs_owner`, is the case the gate ALLOWS but only through a
 * template: `{ allow: true, viaTemplate: true }`. No template has been approved
 * with Meta, so the message cannot go, and calling that "allowed" in the
 * owner's audit trail would be the same lie this milestone exists to remove.
 */
export type RefusalReason = GateRefusal | 'window_needs_owner' | 'media_unsupported';

export type DriveEffect =
  | { readonly kind: 'reclaimed'; readonly id: string }
  | { readonly kind: 'canceled'; readonly id: string; readonly reason: RefusalReason }
  | { readonly kind: 'sent'; readonly id: string; readonly providerMessageId: string }
  | { readonly kind: 'retry_scheduled'; readonly id: string; readonly delayMs: number }
  | { readonly kind: 'dead_lettered'; readonly id: string }
  | { readonly kind: 'failed_permanent'; readonly id: string }
  | { readonly kind: 'waiting'; readonly blockedOn: string; readonly recheckInMs: number }
  | { readonly kind: 'idle' };

/**
 * M22 — the ONE way a queued message stops here. Two writes, always both:
 * the row is canceled with the reason in `last_error` (which is what the
 * owner's surfaces read), and an audit row names the reason (which is what an
 * operator reads). Every refusal went through the first of these already; only
 * two of the six went through the second, so four of them left no trace an
 * owner could ever be shown.
 *
 * It decides nothing. `gateOutbound` has already decided; this records it.
 */
async function refuse(
  deps: { store: OutboundStore }, row: OutboundWorkRow, reason: RefusalReason,
): Promise<void> {
  await deps.store.transition(row.id, 'canceled', `canceled: ${reason}`);
  if (deps.store.recordRefusal) await deps.store.recordRefusal(row.id, row.to, reason);
}

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
        await refuse(deps, r, suppressReason);
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
    await refuse(deps, candidate, gate.reason);
    return [...effects, { kind: 'canceled', id: candidate.id, reason: gate.reason }];
  }
  if (gate.viaTemplate) {
    // The gate allows this, but ONLY through an approved template — and no
    // template exists yet (M22 §B). The message therefore does not go, and it
    // is recorded as a refusal rather than quietly dropped: "allowed" in the
    // audit trail beside a buyer who heard nothing is exactly the silence this
    // milestone removes. Meta template sending replaces this branch; nothing
    // here fakes or bypasses it.
    await refuse(deps, candidate, 'window_needs_owner');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'window_needs_owner' }];
  }

  // 5. Send, with the transition recorded on both sides of the wire.
  //
  // M26 — a picture goes out through THIS path and no other: same ordering,
  // same gate above, same transitions, same retry classification. The only
  // branch is which adapter call carries it.
  //
  // An image row whose adapter cannot send media is REFUSED, never downgraded
  // to its caption: a caption without its picture is a different message from
  // the one the owner approved, and sending it would be exactly the quiet
  // substitution this product exists to not do.
  if (candidate.kind === 'image') {
    if (!candidate.mediaUrl || !deps.adapter.sendMedia) {
      await refuse(deps, candidate, 'media_unsupported');
      return [...effects, { kind: 'canceled', id: candidate.id, reason: 'media_unsupported' }];
    }
  }
  await deps.store.transition(candidate.id, 'sending', null);
  const result = candidate.kind === 'image' && candidate.mediaUrl && deps.adapter.sendMedia
    ? await deps.adapter.sendMedia(candidate.to, { url: candidate.mediaUrl, caption: candidate.body })
    : await deps.adapter.sendText(candidate.to, candidate.body);

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
