/**
 * G2c — what she does with a message, decided before any turn runs.
 *
 * WhatsApp sends many kinds of message. This product can answer three of them:
 * typed text, a photo it can see, and a voice note it can hear. Everything else
 * used to arrive as an EMPTY STRING and run a turn anyway, so an emoji
 * reaction got a reply to nothing, and a PDF request for quotation got a
 * confident answer to a document she never opened — while the owner was never
 * shown that a file had arrived at all.
 *
 * There are exactly three outcomes, and none of them is "guess":
 *
 *   answer  text, image, audio — the existing paths, each of which already
 *           refuses honestly when it cannot read what it was given.
 *   ignore  a reaction or a sticker. Nothing was asked; nothing is owed.
 *           Recorded, never answered.
 *   owner   a document, a video, a location, a contact card, or a kind this
 *           file has never heard of. Something WAS sent, she cannot read it,
 *           so the conversation goes to a person and the owner is told what
 *           arrived. An unknown kind lands here rather than in `ignore`: the
 *           cost of showing the owner something harmless is a glance, and the
 *           cost of dropping something real is a lost buyer.
 *
 * Pure per ADR-0002.
 */

/** What arrived, in words the owner surface can name. */
export const UNREADABLE_KINDS = ['document', 'video', 'location', 'contacts', 'other'] as const;
export type UnreadableKind = (typeof UNREADABLE_KINDS)[number];

/**
 * G10c — everything the timeline can NAME without showing its contents: the
 * files she cannot read, and a photo or voice note she was not allowed to
 * open because the number is not on the owner's pilot list.
 */
export const RECEIVED_KINDS = [...UNREADABLE_KINDS, 'photo', 'voice'] as const;
export type ReceivedKind = (typeof RECEIVED_KINDS)[number];

/**
 * G10c — a number the owner has not agreed to reach, while she is LIVE in
 * pilot mode: recorded and shown to a person, never answered. The send gate
 * refuses any reply to it (`not_allowlisted`), so a turn would only spend a
 * model call on a draft that can never leave.
 *
 * Only once she is live: before that nothing can reach anyone, a draft is
 * rehearsal, and her own first test messages must still be answered.
 */
export const unlistedDuringPilot = (f: {
  readonly activated: boolean; readonly pilotMode: boolean; readonly allowlisted: boolean;
}): boolean => f.activated && f.pilotMode && !f.allowlisted;

export type InboundDisposition =
  | { readonly kind: 'answer' }
  | { readonly kind: 'ignore'; readonly received: 'reaction' | 'sticker' }
  | { readonly kind: 'owner'; readonly received: UnreadableKind };

export function inboundDisposition(
  messageType: 'text' | 'image' | 'audio' | 'unsupported',
  /** The provider's own message type, lower-cased. Absent on older jobs. */
  received: string | null | undefined,
): InboundDisposition {
  if (messageType !== 'unsupported') return { kind: 'answer' };
  const r = (received ?? '').toLowerCase();
  if (r === 'reaction' || r === 'sticker') return { kind: 'ignore', received: r };
  if (r === 'document' || r === 'video' || r === 'location' || r === 'contacts') {
    return { kind: 'owner', received: r };
  }
  return { kind: 'owner', received: 'other' };
}
