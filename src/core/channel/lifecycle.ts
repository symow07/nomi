/**
 * M20.3.1 — ONE answer to "what state is this channel in?".
 *
 * The bug this closes: My factory could say "WhatsApp: Not connected" in one
 * section and "Lily can start whenever you say so" in the next. Two sections
 * were answering the same question from different facts — the connection view
 * read status + credentials + provider, while activation readiness only counted
 * whether a `channels` ROW existed. A rolled-back factory therefore read as
 * connectable.
 *
 * This is a pure reduction of facts the database already holds. No new table,
 * no second state machine, no stored status: the row remains the source of
 * truth and this only decides what it MEANS.
 *
 * The order below is the whole model. Each state answers one owner question:
 *
 *   active         she is handling conversations right now
 *   ready          everything works; you have not started her
 *   paused         it worked before and was stopped — reconnect to continue
 *   not_connected  no working connection exists
 *
 * `active` is checked first because it is the only state the owner explicitly
 * chose, and `paused` before `not_connected` because "you stopped this" and
 * "this was never set up" are different problems with different next steps.
 */

export type ChannelLifecycle = 'not_connected' | 'ready' | 'active' | 'paused';

export type ChannelFacts = {
  /** A `channels` row exists for a channel kind the product supports. */
  readonly hasChannel: boolean;
  /** `channels.status` verbatim. */
  readonly status: string | null;
  /** At least one ACTIVE credential for this channel. */
  readonly credentialActive: boolean;
  /** The installation has a messaging provider wired (WHATSAPP_PROVIDER). */
  readonly providerConfigured: boolean;
  /** `channels.activated_at` — the owner's explicit decision to go live. */
  readonly activatedAt: Date | null;
  /** `channels.disconnected_at` — it was connected once, then stopped. */
  readonly disconnectedAt: Date | null;
};

/** True only when a message could actually leave the building. */
export function isConnected(f: ChannelFacts): boolean {
  return f.hasChannel && f.status === 'connected' && f.credentialActive && f.providerConfigured;
}

export function channelLifecycle(f: ChannelFacts): ChannelLifecycle {
  // Activation without a working connection is not "active" — it is a stale
  // decision on a channel that can no longer carry a message. Saying "active"
  // there would be the same class of lie this module exists to remove.
  if (f.activatedAt !== null && isConnected(f)) return 'active';
  if (isConnected(f)) return 'ready';
  // It worked before and does not now: the owner stopped it, the credential
  // went inactive, or it dropped. `activatedAt` counts as evidence it worked —
  // a credential can go inactive without anything writing `disconnected_at`,
  // and telling that owner "not connected" would suggest it was never set up.
  const workedBefore = f.disconnectedAt !== null || f.status === 'disconnected' || f.activatedAt !== null;
  return workedBefore ? 'paused' : 'not_connected';
}

/**
 * Can the owner turn messaging on right now? Only from `ready` — an active
 * channel is already on, and both other states need the connection fixed first.
 */
export const canActivateChannel = (f: ChannelFacts): boolean => channelLifecycle(f) === 'ready';
