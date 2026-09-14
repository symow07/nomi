import { nextToSend, type OutboundRow } from './sequencer.js';
import { ownershipOf, aiMaySpeak } from '../core/conversation/ownership.js';
import {
  onSendFailure, shouldReclaim,
} from '../core/channel/delivery.js';
import { GATE_REFUSALS, gateOutbound, cancelableOnTakeover, type GateRefusal } from '../core/channel/sendGate.js';
import { channelSendPlan, type TemplateState } from '../core/channel/window.js';
import type { OutreachInput } from '../core/outreach/gate.js';
import type { Locale } from '../core/owner/i18n/locale.js';
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
  /**
   * C4.a — 'outreach' is the third kind of authorship: a message that STARTS a
   * conversation, as against her employee answering a buyer ('employee') and
   * the owner typing herself ('owner'). Only this one faces the outreach gate,
   * and only this one counts against her daily outreach cap.
   */
  readonly origin: 'employee' | 'owner' | 'outreach';
  /** C4.a — which transport carries this row. Defaulted for every row written
   *  before e-mail existed, so the WhatsApp path reads exactly as it did. */
  readonly channel?: string;
  /** C4.a — what her buyer sees before he opens it. Null on WhatsApp, where
   *  the concept does not exist; required for a mail, which is why a row
   *  without one is refused rather than sent with something invented. */
  readonly subject?: string | null;
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
  /**
   * M34.6 — an ops `global_silence` flag is live (ops_flags, migration 0014).
   * REQUIRED, like the gate field it feeds: the whole defect this closes was a
   * kill switch nothing resolved, so no store gets to leave it unanswered.
   */
  readonly silenced: boolean;
  /**
   * C4.a — everything the OUTREACH gate needs about this buyer, for a message
   * that starts a conversation instead of continuing one.
   *
   * Optional because it is meaningless for a reply, and absent it is not
   * ignored: a row whose origin is 'outreach' with no facts here is REFUSED
   * (`outreach_unchecked`), never sent. A store that cannot answer the question
   * does not get to skip it.
   */
  readonly outreach?: OutreachInput;
  /**
   * C4.a — the BUYER's language, for the one thing in a mail he reads that is
   * not her words: the unsubscribe page behind the RFC 8058 headers. Absent
   * means unknown, and the caller names its own fallback rather than having one
   * assumed for him here.
   */
  readonly buyerLocale?: Locale;
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
 * Every `GateRefusal` value is `gateOutbound`'s own, carried through unchanged
 * — this adds no reason of its own and makes no decision. (The count used to be
 * written out here as "the six"; M34.6 added `silenced` and the sentence went
 * stale on the spot, which is why it now names no number.) The one reason that
 * is NOT the gate's, `window_needs_owner`, is the case the gate ALLOWS but only through a
 * template: `{ allow: true, viaTemplate: true }`. No template has been approved
 * with Meta, so the message cannot go, and calling that "allowed" in the
 * owner's audit trail would be the same lie this milestone exists to remove.
 */
export type RefusalReason =
  | GateRefusal | 'window_needs_owner' | 'media_unsupported'
  // C4.a — this build has no adapter for the row's channel, or the row is a
  // mail with no subject. Both are the product's own fault rather than hers,
  // and both are shown rather than swallowed.
  | 'channel_unavailable' | 'subject_missing' | 'no_unsubscribe'
  // C4.a — a first message whose permission could not be established at all.
  // Not a refusal BY the outreach gate: a refusal because the gate could not be
  // asked, which is the one honest answer when the facts are missing.
  | 'outreach_unchecked';

/**
 * The same union as a list, DERIVED not restated.
 *
 * M42 — this lived in `api/web/refusals.ts` as a hand-written copy of
 * `GATE_REFUSALS` plus the two below, kept in step by a test asserting the two
 * were equal. That test caught the drift twice, which is two times more than a
 * transcription should ever be allowed to cost. It sits here because "every
 * reason the worker can write" is a fact about the worker, and because the read
 * model that renders it is forbidden from naming the gate at all.
 */
export const REFUSAL_REASONS: readonly RefusalReason[] = [
  ...GATE_REFUSALS,
  // From OUTSIDE the gate — both are ways a message the gate ALLOWED still did
  // not reach the buyer, reported by the send path rather than decided by it.
  'window_needs_owner', 'media_unsupported',
  // C4.a — and the four a first message can hit: no adapter for its channel, no
  // subject, no way out for a buyer who never wrote first, or no way to tell
  // whether he may be written to at all.
  'channel_unavailable', 'subject_missing', 'no_unsubscribe', 'outreach_unchecked',
];

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

/**
 * C4.a — WHICH TRANSPORT CARRIES THIS ROW.
 *
 * One adapter was enough while WhatsApp was the only channel. Rather than a
 * second send path — the thing this product refuses, because a message that
 * leaves outside the gate has no refusal story — the caller passes the
 * adapters it has, and the row's own `channel` chooses between them at the one
 * call site the guard rails pin. A row whose channel has no adapter here is
 * refused, not dropped: `channel_unavailable` is a real answer the owner can
 * be shown.
 */
export type AdapterFor = (channel: string) => ChannelAdapter | undefined;

/**
 * C4.a — the headers that give her buyer a way out, minted per message.
 *
 * A function rather than a column: the token is signed, and the signing key is
 * derived from the installation's secret, which belongs neither in core nor in
 * the store. The composition root has it (`src/main.ts`) and hands this down,
 * the same way it hands down the adapter.
 */
export type MailHeadersFor = (
  row: OutboundWorkRow,
  /** The buyer's language, for the page the link goes to. */
  opts: { readonly locale: Locale },
) => Readonly<Record<string, string>>;

const adapterFor = (deps: { adapter: ChannelAdapter; adapters?: AdapterFor }, channel: string | undefined)
  : ChannelAdapter | undefined => {
  const wanted = channel ?? 'whatsapp';
  if (deps.adapters) return deps.adapters(wanted);
  // One adapter and no map: it serves its own kind, and nothing else.
  return deps.adapter.kind === wanted ? deps.adapter : undefined;
};

export async function driveConversationOutbound(
  deps: {
    store: OutboundStore; adapter: ChannelAdapter; adapters?: AdapterFor;
    mailHeaders?: MailHeadersFor; now: () => Date;
  },
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
  // M47 — through the ONE predicate. This was a fourth inline copy of it,
  // written before M34.11 unified the other three and missed by that sweep.
  // It agreed for every value assigned_to can hold — a latent duplication, not
  // a live defect — and now there is nothing left to drift from.
  const humanOwns = !aiMaySpeak(ownershipOf(ctx.assignedTo));
  const suppressReason = humanOwns ? 'handed_off' as const : ctx.paused ? 'paused' as const : null;
  let active = live;
  if (suppressReason) {
    // M34.10 — WHICH rows are cancelable is `cancelableOnTakeover`'s decision,
    // not this loop's. The predicate was written twice — once there, once
    // inline here — and only this copy ran, so the tested one could have
    // drifted from the shipped one without a single failure. One rule, one
    // definition; this function decides what to DO about it.
    const doomed = new Set(cancelableOnTakeover(live));
    active = [];
    for (const r of live) {
      if (doomed.has(r.id)) {
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
  //
  // C4.a — a message that STARTS a conversation answers to the outreach gate as
  // well, and it cannot be sent without the facts that gate needs. Refused here
  // rather than passed through unanswered: `gateOutbound` only asks the outreach
  // question when the field is present, so omitting it would be a silent send to
  // someone who may never have consented.
  if (candidate.origin === 'outreach' && !ctx.outreach) {
    await refuse(deps, candidate, 'outreach_unchecked');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'outreach_unchecked' }];
  }
  // And the window is the CHANNEL's, not WhatsApp's — see `channelSendPlan`.
  const plan = channelSendPlan(candidate.channel ?? 'whatsapp', ctx.lastInboundAt, now, ctx.template);
  const gate = gateOutbound({
    origin: candidate.origin,
    ...(candidate.origin === 'outreach' && ctx.outreach ? { outreach: ctx.outreach } : {}),
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
    // M34.6 — no conditional spread: the ops kill switch is required all the
    // way down, so there is no path on which it goes unresolved.
    silenced: ctx.silenced,
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
    if (!candidate.mediaUrl || !adapterFor(deps, candidate.channel)?.sendMedia) {
      await refuse(deps, candidate, 'media_unsupported');
      return [...effects, { kind: 'canceled', id: candidate.id, reason: 'media_unsupported' }];
    }
  }
  // C4.a — the adapter this row's channel needs, and the refusals that follow
  // from not having one. Both are refusals rather than throws: a queued row
  // that cannot be carried is something the owner must be able to see.
  const adapter = adapterFor(deps, candidate.channel);
  if (!adapter) {
    await refuse(deps, candidate, 'channel_unavailable');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'channel_unavailable' }];
  }
  const asMail = adapter.sendMail !== undefined;
  if (asMail && !candidate.subject) {
    // A mail with no subject is not the message she wrote, and inventing one
    // would invent the only part her buyer sees before opening it.
    await refuse(deps, candidate, 'subject_missing');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'subject_missing' }];
  }
  // 'en' is the fallback for a buyer whose language nothing has observed yet —
  // named here, at the one place that needs one, rather than assumed in the
  // store where a null would quietly become a claim about him.
  const headers = asMail && deps.mailHeaders
    ? deps.mailHeaders(candidate, { locale: ctx.buyerLocale ?? 'en' })
    : {};
  // A message to someone who never wrote to her MUST carry a way out. RFC 8058
  // is the buyer's, not ours to weigh: an outreach mail without it does not go,
  // and she is told why rather than discovering it from a complaint.
  if (asMail && candidate.origin === 'outreach' && Object.keys(headers).length === 0) {
    await refuse(deps, candidate, 'no_unsubscribe');
    return [...effects, { kind: 'canceled', id: candidate.id, reason: 'no_unsubscribe' }];
  }

  await deps.store.transition(candidate.id, 'sending', null);
  const result = asMail && adapter.sendMail
    ? await adapter.sendMail({
        to: candidate.to, subject: candidate.subject ?? '', text: candidate.body, headers,
      })
    : candidate.kind === 'image' && candidate.mediaUrl && adapter.sendMedia
      ? await adapter.sendMedia(candidate.to, { url: candidate.mediaUrl, caption: candidate.body })
      : await adapter.sendText(candidate.to, candidate.body);

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
